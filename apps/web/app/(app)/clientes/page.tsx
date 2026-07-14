"use client";

import CrudTable from "@/components/CrudTable";

const badge = (v: any) => (
  <span className={`text-[11px] px-2 py-0.5 rounded-full ${v ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
    {v ? "bloqueado" : "activo"}
  </span>
);

export default function ClientesPage() {
  return (
    <CrudTable
      recurso="clientes"
      titulo="Clientes"
      subtitulo="Instituciones y empresas que solicitan ensayos. El flujo comercial arranca aquí."
      columnas={[
        { campo: "rut", titulo: "RUT" },
        { campo: "razonSocial", titulo: "Razón social" },
        { campo: "tipo", titulo: "Tipo" },
        { campo: "ciudad", titulo: "Ciudad" },
        { campo: "telefono", titulo: "Teléfono" },
        { campo: "bloqueado", titulo: "Estado", render: badge },
      ]}
      campos={[
        { campo: "rut", label: "RUT", requerido: true },
        { campo: "razonSocial", label: "Razón social", requerido: true },
        { campo: "tipo", label: "Tipo", tipo: "select", opciones: ["institucional", "gubernamental", "externo", "laboratorio_asociado"] },
        { campo: "ciudad", label: "Ciudad" },
        { campo: "region", label: "Región" },
        { campo: "telefono", label: "Teléfono" },
        { campo: "email", label: "Email", tipo: "email" },
      ]}
    />
  );
}
