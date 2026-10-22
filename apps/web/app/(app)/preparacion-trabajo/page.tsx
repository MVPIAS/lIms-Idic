"use client";

/**
 * Preparación del trabajo por aprobar (EP-05 2.3): la documentación del
 * trabajo del DSA que espera la decisión de quien la consulta (Jefe de
 * Laboratorio; LEM en terreno: Jefe de Sección valida y Jefe DSA aprueba).
 * Cada fila lleva a la pestaña «Preparación» de su OT.
 *
 * API: GET /formularios/pendientes-aprobacion
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader, SkeletonCards } from "@/components/ui/PageHeader";
import { fechaHora } from "@/lib/format";
import { llamar } from "@/lib/laboratorio";

export default function PreparacionTrabajoPage() {
  const [filas, setFilas] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    llamar<any[]>("GET", "/formularios/pendientes-aprobacion").then(setFilas).catch((e) => setError(e.message));
  }, []);
  return (
    <div>
      <PageHeader
        titulo="Preparación del trabajo por aprobar"
        subtitulo="Planillas de trabajo, paquetes técnicos y Proyectos de Párrafo que esperan su decisión antes de ejecutar (EP-05 2.3). Apruebe o devuelva con comentario en la pestaña «Preparación» de la OT."
        migas={[{ label: "Laboratorio" }, { label: "Preparación del trabajo por aprobar" }]}
      />
      {error && <div className="alert warn">{error}</div>}
      {!filas && !error && <SkeletonCards n={2} />}
      {filas && (
        <div className="card card--table">
          <table className="data">
            <thead><tr><th>OT</th><th>Laboratorio</th><th>Documentación</th><th>Le toca</th><th>Enviada o actualizada</th><th /></tr></thead>
            <tbody>
              {filas.length === 0 && <tr><td colSpan={6} style={{ color: "var(--muted)", padding: 16 }}>No hay documentación esperando su aprobación.</td></tr>}
              {filas.map((f) => (
                <tr key={f.id}>
                  <td className="codigo" style={{ whiteSpace: "nowrap" }}>{f.otCodigo}</td>
                  <td>{f.laboratorio}</td>
                  <td>{f.titulo}<span className={`pill ${f.estado === "validada" ? "blue" : "amber"}`} style={{ marginLeft: 6 }}>{f.estado === "validada" ? "Validada por la Sección" : "Pendiente"}</span></td>
                  <td>{f.paso}</td>
                  <td style={{ fontSize: 12 }}>{fechaHora(f.updatedAt)}{f.enviadoPor ? ` · ${f.enviadoPor}` : ""}</td>
                  <td style={{ whiteSpace: "nowrap" }}><Link className="btn primary sm" href={f.ruta as any}>{f.accion === "validar" ? "Validar →" : "Revisar y aprobar →"}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
