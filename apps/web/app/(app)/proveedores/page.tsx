"use client";

import CrudTable from "@/components/CrudTable";

export default function ProveedoresPage() {
  return (
    <CrudTable
      recurso="proveedores"
      titulo="Proveedores"
      subtitulo="Maestro de proveedores para órdenes de compra e insumos."
      columnas={[
        { campo: "rut", titulo: "RUT" },
        { campo: "razonSocial", titulo: "Razón social" },
        { campo: "rubro", titulo: "Rubro" },
        { campo: "estado", titulo: "Estado", render: (v) => <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100">{v}</span> },
      ]}
      campos={[
        { campo: "rut", label: "RUT", requerido: true },
        { campo: "razonSocial", label: "Razón social", requerido: true },
        { campo: "rubro", label: "Rubro" },
        { campo: "contacto", label: "Contacto" },
        { campo: "email", label: "Email", tipo: "email" },
        { campo: "condicionPago", label: "Condición de pago" },
        { campo: "estado", label: "Estado", tipo: "select", opciones: ["habilitado", "en_evaluacion", "inhabilitado"] },
      ]}
    />
  );
}
