"use client";

import CrudTable, { renderRef } from "@/components/CrudTable";

const estadoBadge = (v: string) => (
  <span className={`pill ${v === "anulado" ? "red" : "green"}`}>{v ?? "emitido"}</span>
);

/** La OT se identifica por su código, con el cliente como desempate. */
const etiquetaOt = (o: any) => [o.codigo, o.cliente?.razonSocial].filter(Boolean).join(" · ");

export default function CertificadosPage() {
  return (
    <CrudTable
      recurso="certificados"
      titulo="Certificados / Informes emitidos"
      subtitulo="Documentos emitidos por OT (certificado, informe de ensayo, etc.) con hash y URL de verificación."
      columnas={[
        { campo: "codigo", titulo: "Código", render: (v) => <span className="codigo">{v}</span> },
        { campo: "tipo", titulo: "Tipo", render: (v) => (v ? <span className="tag">{v}</span> : "—") },
        { campo: "otId", titulo: "OT", render: renderRef("ot", etiquetaOt) },
        { campo: "plantillaId", titulo: "Plantilla", render: renderRef("plantilla") },
        { campo: "estado", titulo: "Estado", render: estadoBadge },
      ]}
      campos={[
        { campo: "otId", label: "OT", tipo: "ref", refRecurso: "ot", refLabel: etiquetaOt, requerido: true },
        { campo: "codigo", label: "Código", requerido: true },
        { campo: "tipo", label: "Tipo" },
        { campo: "plantillaId", label: "Plantilla", tipo: "ref", refRecurso: "plantillas" },
        { campo: "estado", label: "Estado", tipo: "select", opciones: ["emitido", "anulado"] },
      ]}
    />
  );
}
