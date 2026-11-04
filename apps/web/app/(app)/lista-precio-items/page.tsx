"use client";

import CrudTable, { renderRef } from "@/components/CrudTable";
import { monto } from "@/lib/format";

const num = (data: any) => ({
  ...data,
  precio: data.precio === "" || data.precio == null ? undefined : Number(data.precio),
});
/** Contrato 4.1.3 · al editar, dejar vacío el ensayo del catálogo QUITA el enlace (viaja como null). */
const alActualizar = (data: any) => ({ ...num(data), catEnsayoId: data.catEnsayoId || null });
const etiquetaEnsayo = (e: any) => `${e.codigo ?? ""} · ${e.nombre ?? ""}`;

export default function ListaPrecioItemsPage() {
  return (
    <CrudTable
      recurso="lista-precio-items"
      titulo="Ítems de Lista de Precio"
      subtitulo="Líneas de tarifario: servicios, HH/HM, viáticos e insumos con su precio. Un ítem enlazado con un ensayo del catálogo da el precio de ese ensayo en la cotización."
      prepararCrear={num}
      prepararActualizar={alActualizar}
      columnas={[
        // La relación Prisma se llama `lista`, no `listaPrecio`.
        { campo: "listaPrecioId", titulo: "Lista", render: renderRef("lista") },
        { campo: "codigo", titulo: "Código", render: (v) => <span className="codigo">{v}</span> },
        { campo: "descripcion", titulo: "Descripción" },
        {
          campo: "catEnsayoId",
          titulo: "Ensayo del catálogo",
          render: (_v, row) =>
            row?.catEnsayo ? (
              <span>
                <span className="codigo">{row.catEnsayo.codigo}</span> {row.catEnsayo.nombre}
              </span>
            ) : (
              <span className="pill amber" title="Sin enlace, la cotización no toma este precio">sin enlace</span>
            ),
        },
        { campo: "tipo", titulo: "Tipo", render: (v) => (v ? <span className="tag">{v}</span> : "—") },
        { campo: "cc", titulo: "CC" },
        { campo: "precio", titulo: "Precio", right: true, render: (v, row) => monto(v, row.lista?.moneda) },
      ]}
      campos={[
        { campo: "listaPrecioId", label: "Lista de precio", tipo: "ref", refRecurso: "listas-precio", requerido: true },
        { campo: "codigo", label: "Código", requerido: true },
        { campo: "descripcion", label: "Descripción", requerido: true },
        // Contrato 4.1.3: enlace con el ensayo del catálogo desde la pantalla (antes solo por la carga oficial).
        {
          campo: "catEnsayoId",
          label: "Ensayo del catálogo",
          tipo: "ref",
          refRecurso: "cat/ensayos",
          refLabel: etiquetaEnsayo,
          span: 2,
          ayuda: "Busque por código o nombre. La cotización usa este precio para ese ensayo (un ensayo, un solo ítem por lista). Vacío = sin enlace.",
        },
        { campo: "cc", label: "Centro de costo" },
        { campo: "tipo", label: "Tipo", tipo: "select", opciones: ["servicio", "HH", "HM", "viatico", "insumo"] },
        { campo: "precio", label: "Precio", tipo: "moneda", requerido: true },
      ]}
    />
  );
}
