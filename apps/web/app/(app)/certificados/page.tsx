"use client";

import CrudTable from "@/components/CrudTable";

const estadoBadge = (v: string) => (
  <span className={`pill ${v === "anulado" ? "red" : "green"}`}>{v ?? "emitido"}</span>
);

export default function CertificadosPage() {
  return (
    <CrudTable
      recurso="certificados"
      titulo="Certificados / Informes emitidos"
      subtitulo="Documentos emitidos por OT (certificado, informe de ensayo, etc.) con hash y URL de verificación."
      columnas={[
        { campo: "codigo", titulo: "Código", render: (v) => <span className="codigo">{v}</span> },
        { campo: "tipo", titulo: "Tipo", render: (v) => (v ? <span className="tag">{v}</span> : "—") },
        { campo: "otId", titulo: "OT (id)", render: (v) => (v ? <span className="tag">{String(v).slice(0, 8)}…</span> : "—") },
        { campo: "estado", titulo: "Estado", render: estadoBadge },
      ]}
      campos={[
        // otId y plantillaId son FK (uuid): por ahora se ingresan los ids a mano.
        { campo: "otId", label: "OT (id)", requerido: true },
        { campo: "codigo", label: "Código", requerido: true },
        { campo: "tipo", label: "Tipo" },
        { campo: "plantillaId", label: "Plantilla (id)" },
        { campo: "estado", label: "Estado", tipo: "select", opciones: ["emitido", "anulado"] },
      ]}
    />
  );
}
