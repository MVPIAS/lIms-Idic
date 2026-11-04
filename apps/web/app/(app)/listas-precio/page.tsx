"use client";

import Link from "next/link";
import CrudTable from "@/components/CrudTable";
import { fecha } from "@/lib/format";
import { useListaParametro } from "@/lib/lista-parametro";

/** activa (boolean) ⇄ «si»/«no» del select del formulario. */
const conActiva = (d: any) => ({ ...d, activa: d.activa === "no" ? false : d.activa === "si" ? true : undefined });
/**
 * Contrato 4.1.3 · «Vigente hasta» vacío = sin fin (viaja como null para poder
 * quitarlo) y «Uso» (general / especial de cliente) ⇄ booleano `especial`.
 */
const conVigencia = (d: any) => ({
  ...d,
  vigenteHasta: d.vigenteHasta ? d.vigenteHasta : null,
  especial: d.especial === "especial" ? true : d.especial === "general" ? false : undefined,
});
const USO_GENERAL = "general";
const USO_ESPECIAL = "especial";
/** Fecha de la fila (Date serializado) al AAAA-MM-DD del campo de fecha. */
const diaDe = (v: any) => (v ? String(v).slice(0, 10) : "");

export default function ListasPrecioPage() {
  // Frente f5: la moneda sale del parámetro «moneda» (CLP y USD); una lista
  // guardada en otra moneda (UF, EUR… migrada) es histórica y de solo lectura.
  const monedas = useListaParametro("moneda");
  const historica = (m: any) => monedas.cargado && !!m && !monedas.vigente(String(m));
  return (
    <CrudTable
      recurso="listas-precio"
      titulo="Listas de Precio"
      subtitulo="Tarifario de servicios con su estructura de costos. La cotización a un cliente particular toma el neto de la lista vigente; un cliente con lista propia (ficha del cliente) toma primero la suya."
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
          campo: "especial",
          titulo: "Uso",
          render: (v, row) =>
            v ? (
              <span className="pill blue" title="Solo la toman los clientes que la tienen asignada en su ficha">
                Especial de cliente · {row?.clientesAsignados ?? 0} {row?.clientesAsignados === 1 ? "cliente" : "clientes"}
              </span>
            ) : (
              <span>
                General{row?.clientesAsignados ? <small style={{ color: "var(--muted)" }}> · propia de {row.clientesAsignados} {row.clientesAsignados === 1 ? "cliente" : "clientes"}</small> : null}
              </span>
            ),
        },
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
        { campo: "vigenteHasta", label: "Vigente hasta", tipo: "date", ayuda: "Vacío = sin fecha de término. Desde el día siguiente la cotización deja de tomar sus precios." },
        {
          campo: "especial",
          label: "Uso",
          tipo: "select",
          opciones: [USO_GENERAL, USO_ESPECIAL],
          ayuda: "«general»: la toma toda cotización mientras esté vigente. «especial»: lista especial de cliente, solo la usan los clientes que la tienen asignada en su ficha (Clientes › Editar › «Lista de precios propia»).",
        },
      ]}
      camposEditar={[
        { campo: "codigo", label: "Código", requerido: true },
        { campo: "nombre", label: "Nombre", requerido: true },
        { campo: "moneda", label: "Moneda", tipo: "select", opcionesEndpoint: "parametros?categoria=moneda&activo=true&limit=20", soloLecturaEnEdicion: true },
        { campo: "vigenteDesde", label: "Vigente desde", tipo: "date" },
        { campo: "vigenteHasta", label: "Vigente hasta", tipo: "date", ayuda: "Vacío = sin fecha de término. Desde el día siguiente la cotización deja de tomar sus precios." },
        {
          campo: "especial",
          label: "Uso",
          tipo: "select",
          opciones: [USO_GENERAL, USO_ESPECIAL],
          ayuda: "«especial» = lista especial de cliente: solo la usan los clientes que la tienen asignada en su ficha.",
        },
        { campo: "activa", label: "Estado", tipo: "select", opciones: ["si", "no"], ayuda: "«no» = inactiva: la cotización deja de tomar sus precios." },
      ]}
      prepararCrear={conVigencia}
      prepararEditar={(row) => ({
        codigo: row.codigo,
        nombre: row.nombre,
        moneda: row.moneda,
        vigenteDesde: diaDe(row.vigenteDesde),
        vigenteHasta: diaDe(row.vigenteHasta),
        especial: row.especial ? USO_ESPECIAL : USO_GENERAL,
        activa: row.activa === false ? "no" : "si",
      })}
      prepararActualizar={(d) => conVigencia(conActiva(d))}
    />
  );
}
