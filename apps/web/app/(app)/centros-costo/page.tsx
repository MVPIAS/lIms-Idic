"use client";

import CrudTable from "@/components/CrudTable";

const activoBadge = (v: any) => (
  <span className={`pill ${v === false ? "gray" : "green"}`}>{v === false ? "inactivo" : "activo"}</span>
);

// Comercial R2 (SVT2): los centros de costo incluyen las sucursales BPCH y la
// Delegación Nº 11; el `tipo` agrupa el combo de la cotización.
const TIPO_LABEL: Record<string, string> = {
  laboratorio: "Laboratorio",
  sucursal_bpch: "Sucursal BPCH",
  delegacion_bpch: "Delegación BPCH",
};

export default function CentrosCostoPage() {
  return (
    <CrudTable
      recurso="centros-costo"
      titulo="Centros de Costo"
      subtitulo="Laboratorios, sucursales BPCH y Delegación Nº 11. Cada uno puede tener su texto base de condiciones adicionales y su validez para particulares."
      columnas={[
        { campo: "codigo", titulo: "Código", render: (v) => <span className="codigo">{v}</span> },
        { campo: "nombre", titulo: "Nombre" },
        { campo: "tipo", titulo: "Tipo", render: (v) => <span className="pill gray">{TIPO_LABEL[v] ?? v ?? "Laboratorio"}</span> },
        { campo: "laboratorio", titulo: "Laboratorio", render: (v) => (v ? <span className="tag">{v}</span> : "—") },
        { campo: "validezParticularDias", titulo: "Validez particulares", render: (v) => (v ? `${v} días` : "general (45)") },
        { campo: "condicionesBase", titulo: "Texto base", render: (v) => (v ? <span className="pill teal">definido</span> : "—") },
        { campo: "activo", titulo: "Estado", render: activoBadge },
      ]}
      campos={[
        { campo: "codigo", label: "Código", requerido: true },
        { campo: "nombre", label: "Nombre", requerido: true },
        { campo: "tipo", label: "Tipo", tipo: "select", opciones: ["laboratorio", "sucursal_bpch", "delegacion_bpch"] },
        { campo: "laboratorio", label: "Laboratorio (sigla)" },
        { campo: "validezParticularDias", label: "Validez cotización a particulares (días; vacío = 45)", tipo: "entero" },
        { campo: "condicionesBase", label: "Texto base de condiciones adicionales (máx. 2000)", tipo: "textarea" },
      ]}
      prepararCrear={(d) => ({
        ...d,
        validezParticularDias: d.validezParticularDias === "" || d.validezParticularDias == null ? null : Number(d.validezParticularDias),
        condicionesBase: d.condicionesBase ? String(d.condicionesBase).slice(0, 2000) : null,
        tipo: d.tipo || undefined,
      })}
    />
  );
}
