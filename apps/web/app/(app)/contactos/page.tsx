"use client";

import CrudTable from "@/components/CrudTable";

const principalBadge = (v: any) => (
  <span className={`pill ${v ? "green" : "gray"}`}>{v ? "principal" : "secundario"}</span>
);

export default function ContactosPage() {
  return (
    <CrudTable
      recurso="contactos"
      titulo="Contactos"
      subtitulo="Personas de contacto asociadas a cada cliente. Uno puede marcarse como principal."
      columnas={[
        { campo: "nombre", titulo: "Nombre" },
        { campo: "cargo", titulo: "Cargo" },
        { campo: "email", titulo: "Email" },
        { campo: "telefono", titulo: "Teléfono" },
        { campo: "principal", titulo: "Rol", render: principalBadge },
      ]}
      campos={[
        { campo: "clienteId", label: "Cliente", tipo: "ref", refRecurso: "clientes", requerido: true },
        { campo: "nombre", label: "Nombre", requerido: true },
        { campo: "cargo", label: "Cargo" },
        { campo: "email", label: "Email", tipo: "email" },
        { campo: "telefono", label: "Teléfono" },
      ]}
    />
  );
}
