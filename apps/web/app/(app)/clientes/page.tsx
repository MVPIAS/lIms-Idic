"use client";

import CrudTable from "@/components/CrudTable";

const badge = (v: any) => (
  <span className={`pill ${v ? "red" : "green"}`}>{v ? "bloqueado" : "activo"}</span>
);

export default function ClientesPage() {
  return (
    <CrudTable
      recurso="clientes"
      titulo="Clientes"
      subtitulo="Instituciones y empresas que solicitan ensayos. El flujo comercial arranca aquí."
      columnas={[
        { campo: "rut", titulo: "RUT", render: (v) => <span className="codigo">{v}</span> },
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
