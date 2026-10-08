"use client";

/**
 * Órdenes internas (tabla `orden_interna`): derivaciones de una OT entre
 * laboratorios, órdenes genéricas internas y de muestreo. Se crean desde el
 * flujo de la OT; aquí se consultan y se actualiza su estado
 * (abierta → recibida → cerrada) y el detalle.
 */

import Link from "next/link";
import CrudTable from "@/components/CrudTable";
import { fechaHora } from "@/lib/format";

const ESTADOS = ["abierta", "recibida", "cerrada"];
const TIPOS: Record<string, string> = {
  interna: "Derivación interna",
  generica_interna: "Genérica interna",
  muestreo: "Muestreo",
};
const ESTADO_PILL: Record<string, string> = { abierta: "amber", recibida: "blue", cerrada: "green" };

export default function OrdenesInternasPage() {
  return (
    <CrudTable
      recurso="ordenes-internas"
      titulo="Órdenes internas"
      subtitulo="Derivaciones de una OT a otro laboratorio, órdenes genéricas internas y de muestreo. Se generan desde la OT; aquí puedes seguir su estado y anotar el detalle."
      migas={[{ label: "Laboratorio" }, { label: "Órdenes internas" }]}
      columnas={[
        { campo: "numero", titulo: "Número", render: (v) => <span className="codigo">{v}</span> },
        { campo: "tipo", titulo: "Tipo", render: (v) => TIPOS[v] ?? v ?? "—" },
        {
          campo: "otId",
          titulo: "OT",
          render: (v) => (v ? <Link href={`/ot/${v}` as any} className="btn outline sm">Abrir OT</Link> : "—"),
        },
        {
          campo: "estado",
          titulo: "Estado",
          render: (v) => <span className={`pill ${ESTADO_PILL[v] ?? "gray"}`}>{v ?? "—"}</span>,
          editable: { tipo: "select", opciones: ESTADOS, requerido: true },
        },
        { campo: "detalle", titulo: "Detalle", editable: true },
        { campo: "createdAt", titulo: "Creada", render: (v) => fechaHora(v) },
      ]}
      camposEditar={[
        { campo: "estado", label: "Estado", tipo: "select", opciones: ESTADOS, requerido: true },
        { campo: "detalle", label: "Detalle", tipo: "textarea", span: 2 },
      ]}
      permitirCrear={false}
      permitirEliminar={false}
      etiquetaFila={(r) => `Orden interna ${r.numero}`}
    />
  );
}
