"use client";

import CrudTable from "@/components/CrudTable";

const principalBadge = (v: any) => (
  <span className={`pill ${v ? "green" : "gray"}`}>{v ? "principal" : "secundario"}</span>
);

/** «Sí»/«No» del formulario → booleano; vacíos fuera (la API no admite ""). */
const aBooleano = (d: any) => {
  const out: any = { ...d, principal: d.principal === "Sí" };
  for (const k of ["cargo", "email", "telefono"]) if (out[k] === "" || out[k] == null) delete out[k];
  return out;
};

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
        { campo: "telefono", label: "Teléfono", tipo: "telefono" },
        // B-038: el principal es el que propone la cotización como solicitante y pasa a la ficha del cliente.
        { campo: "principal", label: "Contacto principal", tipo: "select", opciones: ["Sí", "No"], ayuda: "Solo puede haber uno por cliente: al marcarlo, los demás pasan a secundarios y la ficha del cliente toma sus datos." },
      ]}
      prepararCrear={aBooleano}
      prepararEditar={(r: any) => ({ clienteId: r.clienteId, nombre: r.nombre ?? "", cargo: r.cargo ?? "", email: r.email ?? "", telefono: r.telefono ?? "", principal: r.principal ? "Sí" : "No" })}
    />
  );
}
