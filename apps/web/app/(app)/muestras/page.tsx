"use client";

import CrudTable, { renderRef } from "@/components/CrudTable";

/** La OT se identifica por su código, con el cliente como desempate. */
const etiquetaOt = (o: any) => [o.codigo, o.cliente?.razonSocial].filter(Boolean).join(" · ");

export default function MuestrasPage() {
  return (
    <CrudTable
      recurso="muestras"
      titulo="Muestras"
      subtitulo="Maestro de muestras. A cada muestra se le asignan 1..n ensayos. La recepción (toma de muestra, condición, sello, identificación del cliente y otros laboratorios) se registra en el expediente de la OT, pestaña «Muestras»."
      columnas={[
        { campo: "codigo", titulo: "Código", render: (v) => <span className="codigo">{v}</span> },
        { campo: "nombre", titulo: "Muestra" },
        { campo: "tipoMuestraId", titulo: "Tipo", render: renderRef("tipoMuestra") },
        { campo: "grupoId", titulo: "Grupo", render: renderRef("grupo") },
        { campo: "codigoBarras", titulo: "Cód. barras", render: (v) => (v ? <span className="codigo">{v}</span> : "—") },
        { campo: "ubicacion", titulo: "Ubicación" },
        // Recepción (se registra o corrige desde el expediente de la OT, pestaña «Muestras»).
        { campo: "identificacionCliente", titulo: "Id. del cliente", render: (v) => v || "—" },
        { campo: "selloNumero", titulo: "Sello", render: (v) => (v ? <span className="codigo">{v}</span> : "—") },
        {
          campo: "condicionRecepcion",
          titulo: "Recepción",
          render: (v, row) =>
            v ? (
              <span className={`pill ${v === "cumple" ? "green" : "red"}`} title={row?.condicionObservacion ?? undefined}>{v === "cumple" ? "Cumple" : "No cumple"}</span>
            ) : (
              <span className="pill amber" title="Complete la recepción en el expediente de la OT">incompleta</span>
            ),
        },
        { campo: "estado", titulo: "Estado", render: (v) => <span className={`pill ${v === "finalizada" ? "green" : v === "en_analisis" ? "amber" : "blue"}`}>{v ?? "—"}</span> },
      ]}
      campos={[
        { campo: "codigo", label: "Código", requerido: true },
        { campo: "nombre", label: "Nombre de la muestra", requerido: true },
        { campo: "otId", label: "OT", tipo: "ref", refRecurso: "ot", refLabel: etiquetaOt },
        { campo: "clienteId", label: "Cliente", tipo: "ref", refRecurso: "clientes" },
        { campo: "tipoMuestraId", label: "Tipo de muestra", tipo: "ref", refRecurso: "tipos-muestra", requerido: true },
        // Eje Producto: Gran Grupo → Grupo (el backend no filtra el grupo por gran grupo; se eligen por separado).
        { campo: "granGrupoId", label: "Gran Grupo", tipo: "ref", refRecurso: "gran-grupos" },
        { campo: "grupoId", label: "Grupo", tipo: "ref", refRecurso: "grupos" },
        { campo: "codigoBarras", label: "Código de barras" },
        { campo: "ubicacion", label: "Ubicación" },
        { campo: "estado", label: "Estado", tipo: "select", opciones: ["recibida", "en_analisis", "finalizada"] },
      ]}
    />
  );
}
