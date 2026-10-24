"use client";

import Link from "next/link";
import CrudTable from "@/components/CrudTable";
import { fecha } from "@/lib/format";
import { useListaParametro } from "@/lib/lista-parametro";

/** activa (boolean) ⇄ «si»/«no» del select del formulario. */
const conActiva = (d: any) => ({ ...d, activa: d.activa === "no" ? false : d.activa === "si" ? true : undefined });

export default function ListasPrecioPage() {
  // Frente f5: la moneda sale del parámetro «moneda» (CLP y USD); una lista
  // guardada en otra moneda (UF, EUR… migrada) es histórica y de solo lectura.
  const monedas = useListaParametro("moneda");
  const historica = (m: any) => monedas.cargado && !!m && !monedas.vigente(String(m));
  return (
    <CrudTable
      recurso="listas-precio"
      titulo="Listas de Precio"
      subtitulo="Tarifario de servicios con su estructura de costos. La cotización a un cliente particular toma el neto de la lista vigente."
      columnas={[
        {
          campo: "codigo",
          titulo: "Código",
          render: (v, row) => (
            <Link href={`/listas-precio/${row.id}` as any} className="codigo" style={{ textDecoration: "underline" }}>
              {v}
            </Link>
          ),
        },
        { campo: "nombre", titulo: "Nombre" },
        {
          campo: "moneda",
          titulo: "Moneda",
          render: (v) =>
            historica(v) ? (
              <span className="pill gray" title="Moneda histórica (dato migrado): la lista se muestra tal cual y es de solo lectura. El LIMS trabaja en CLP y USD.">
                {v} · histórica, solo lectura
              </span>
            ) : (
              <span className="tag">{v ?? "CLP"}</span>
            ),
        },
        { campo: "activa", titulo: "Estado", render: (v) => <span className={`pill ${v === false ? "gray" : "green"}`}>{v === false ? "inactiva" : "activa"}</span> },
        { campo: "vigenteDesde", titulo: "Vigente desde", render: (v) => fecha(v) },
        { campo: "vigenteHasta", titulo: "Vigente hasta", render: (v) => (v ? fecha(v) : "—") },
        {
          campo: "id",
          titulo: "Servicios",
          render: (v, row) => (
            <Link href={`/listas-precio/${v}` as any} className="btn outline sm">
              Ver servicios y costos{Array.isArray(row.items) ? ` (${row.items.length})` : ""}
            </Link>
          ),
        },
      ]}
      campos={[
        { campo: "codigo", label: "Código", requerido: true },
        { campo: "nombre", label: "Nombre", requerido: true },
        {
          campo: "moneda",
          label: "Moneda",
          tipo: "select",
          requerido: true,
          opcionesEndpoint: "parametros?categoria=moneda&activo=true&limit=20",
          soloLecturaEnEdicion: true,
          ayuda: "CLP o USD (Parámetros del sistema › moneda). No cambia después: los precios no se convierten.",
        },
        { campo: "vigenteDesde", label: "Vigente desde", tipo: "date" },
      ]}
      camposEditar={[
        { campo: "codigo", label: "Código", requerido: true },
        { campo: "nombre", label: "Nombre", requerido: true },
        { campo: "moneda", label: "Moneda", tipo: "select", opcionesEndpoint: "parametros?categoria=moneda&activo=true&limit=20", soloLecturaEnEdicion: true },
        { campo: "activa", label: "Estado", tipo: "select", opciones: ["si", "no"], ayuda: "«no» = inactiva: la cotización deja de tomar sus precios." },
      ]}
      prepararEditar={(row) => ({ codigo: row.codigo, nombre: row.nombre, moneda: row.moneda, activa: row.activa === false ? "no" : "si" })}
      prepararActualizar={conActiva}
    />
  );
}
