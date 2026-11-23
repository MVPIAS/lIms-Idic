"use client";

/**
 * Comercial › Proyectos (quinto envío IDIC, lote 3).
 *
 * Proyecto de cliente con código PROY/correlativo/año (lo asigna el sistema) y
 * nombre. Pertenece a UN cliente: solo sus cotizaciones pueden llevarlo, y la OT
 * lo hereda al aceptarse la cotización. No se borran: se desactivan (un proyecto
 * inactivo no se ofrece en las cotizaciones nuevas).
 * Ver: quien ve cotizaciones · crear y editar: permiso `proyecto.gestionar`.
 */
import Link from "next/link";
import CrudTable, { renderRef } from "@/components/CrudTable";

const ESTADOS = ["activo", "inactivo"];

const limpiar = (d: any) => {
  const out: any = { nombre: d.nombre, descripcion: d.descripcion ?? "" };
  if (d.clienteId) out.clienteId = d.clienteId;
  if (d.estado) out.activo = d.estado === "activo";
  return out;
};

export default function ProyectosPage() {
  return (
    <CrudTable
      recurso="proyectos"
      titulo="Proyectos"
      subtitulo="Proyectos de cada cliente (código PROY/correlativo/año). Se eligen en la cotización, la OT los hereda y la Zona de informes filtra y consolida por proyecto."
      columnas={[
        { campo: "codigo", titulo: "Código", render: (v) => <span className="codigo">{v ?? "—"}</span> },
        { campo: "nombre", titulo: "Nombre" },
        { campo: "clienteId", titulo: "Cliente", render: renderRef("cliente", (c: any) => c?.razonSocial ?? "") },
        {
          campo: "cotizaciones",
          titulo: "Cotizaciones",
          right: true,
          render: (v, row) =>
            v ? (
              <Link href={`/cotizaciones?proyecto=${row.id}&proyectoTexto=${encodeURIComponent(row.codigo)}` as any} style={{ textDecoration: "underline" }}>
                {v}
              </Link>
            ) : (
              "0"
            ),
        },
        { campo: "ots", titulo: "OT", right: true, render: (v) => String(v ?? 0) },
        { campo: "activo", titulo: "Estado", render: (v) => <span className={`pill ${v === false ? "gray" : "green"}`}>{v === false ? "inactivo" : "activo"}</span> },
      ]}
      campos={[
        { campo: "clienteId", label: "Cliente", tipo: "ref", refRecurso: "clientes", refLabel: (c: any) => [c.rut, c.razonSocial].filter(Boolean).join(" · "), requerido: true, ayuda: "Un proyecto pertenece a un solo cliente: no se cambia después." },
        { campo: "nombre", label: "Nombre del proyecto", requerido: true, span: 2 },
        { campo: "descripcion", label: "Descripción", tipo: "textarea", span: 3 },
      ]}
      camposEditar={[
        { campo: "nombre", label: "Nombre del proyecto", requerido: true, span: 2, ayuda: "Las OT que llevan el texto automático del proyecto («código · nombre») lo actualizan." },
        { campo: "estado", label: "Estado", tipo: "select", opciones: ESTADOS, requerido: true, ayuda: "Un proyecto inactivo no se ofrece en las cotizaciones nuevas; las que ya lo llevan lo conservan." },
        { campo: "descripcion", label: "Descripción", tipo: "textarea", span: 3 },
      ]}
      prepararCrear={limpiar}
      prepararEditar={(r: any) => ({ nombre: r.nombre ?? "", descripcion: r.descripcion ?? "", estado: r.activo === false ? "inactivo" : "activo" })}
      permitirEliminar={false}
      etiquetaFila={(r: any) => `${r.codigo} · ${r.nombre}`}
    />
  );
}
