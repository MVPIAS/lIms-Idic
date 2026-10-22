"use client";

/**
 * Piezas comunes de los formularios especializados (frente r2a): pasos
 * numerados del procedimiento, chip de veredicto, bitácora del registro y
 * envío de archivos. Patrón de las maquetas: pasos numerados, formulario por
 * paso, botón «Verbo → siguiente», estado visible y documento renderizado.
 */
import type { ReactNode } from "react";
import { fechaHora } from "@/lib/format";
import { errorMensajeDe } from "@/lib/apiError";

export interface PasoFormulario {
  clave: string;
  titulo: string;
  /** hecho | actual | pendiente */
  estado: "hecho" | "actual" | "pendiente";
  detalle?: string | null;
}

/** Barra de pasos numerados (como la maqueta): se puede ir a cualquiera. */
export function Pasos({ pasos, activo, onElegir }: { pasos: PasoFormulario[]; activo: string; onElegir: (clave: string) => void }) {
  return (
    <nav className="wizard" aria-label="Pasos del procedimiento" style={{ flexWrap: "wrap", rowGap: 8 }}>
      {pasos.map((p, i) => (
        <button
          key={p.clave}
          type="button"
          onClick={() => onElegir(p.clave)}
          className={`st${p.estado === "hecho" ? " done" : ""}${p.clave === activo ? " cur" : ""}`}
          aria-current={p.clave === activo ? "step" : undefined}
          style={{ background: "none", border: 0, cursor: "pointer", textAlign: "left", padding: "2px 6px", minWidth: 150 }}
        >
          <span className="n" aria-hidden>{p.estado === "hecho" && p.clave !== activo ? "✓" : i + 1}</span>
          <span style={{ display: "flex", flexDirection: "column" }}>
            <b style={{ fontSize: 12, color: p.clave === activo ? "var(--primary)" : "var(--ink)" }}>{p.titulo}</b>
            {p.detalle && <small style={{ color: "var(--muted)", fontSize: 10.5 }}>{p.detalle}</small>}
          </span>
        </button>
      ))}
    </nav>
  );
}

const VEREDICTO: Record<string, { texto: string; pill: string }> = {
  cumple: { texto: "Cumple", pill: "green" },
  no_cumple: { texto: "No cumple", pill: "red" },
  pendiente: { texto: "Pendiente", pill: "amber" },
  informativo: { texto: "Informativo", pill: "blue" },
};
export function Veredicto({ v, prefijo }: { v: string | null | undefined; prefijo?: string }) {
  const d = VEREDICTO[v ?? "pendiente"] ?? VEREDICTO.pendiente;
  return <span className={`pill ${d.pill}`}>{prefijo ? `${prefijo}: ` : ""}{d.texto}</span>;
}

const ACCION: Record<string, string> = {
  crear: "Creó el registro", cabecera: "Guardó el lote y las unidades", disparo: "Registró un disparo", corregir_disparo: "Corrigió un disparo",
  cerrar_panel: "Cerró un panel", concluir: "Concluyó el lote", reabrir: "Reabrió el registro", guardar: "Guardó", corregir: "Corrigió",
  registrar: "Registró", evaluar: "Evaluó", lote: "Guardó los datos del lote", acciones: "Anotó acciones del proveedor", emitir_acta: "Emitió el acta",
  asignar: "Asignó comisión y equipos", enviar: "Envió a aprobación", validar: "Validó", aprobar: "Aprobó", devolver: "Devolvió",
  confirmar: "Confirmó el resultado", plan: "Generó el plan de sesión", cartillas: "Guardó las cartillas", consolidar: "Consolidó el panel",
};

/** Bitácora del registro: quién, cuándo, qué y por qué. Nada se borra. */
export function Bitacora({ eventos }: { eventos: any[] }) {
  if (!eventos?.length) return null;
  return (
    <details className="card" style={{ padding: 12 }}>
      <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 13 }}>Bitácora ({eventos.length})</summary>
      <table className="data" style={{ marginTop: 8 }}>
        <thead><tr><th>Fecha</th><th>Quién</th><th>Qué</th><th>Motivo o comentario</th></tr></thead>
        <tbody>
          {eventos.map((e) => (
            <tr key={e.id}>
              <td style={{ whiteSpace: "nowrap" }}>{fechaHora(e.createdAt)}</td>
              <td>{e.usuarioNombre ?? "—"}</td>
              <td>{ACCION[e.accion] ?? e.accion}{e.cambioDatos ? <span className="pill gray" style={{ marginLeft: 6 }}>versión anterior guardada</span> : null}</td>
              <td>{e.motivo ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** Campo con etiqueta asociada (accesible) para los formularios por paso. */
export function Campo({ id, etiqueta, req, children, ayuda, span }: { id: string; etiqueta: ReactNode; req?: boolean; children: ReactNode; ayuda?: ReactNode; span?: 2 | 3 }) {
  return (
    <div className={`field${span ? ` span-${span}` : ""}`}>
      <label htmlFor={id}>{etiqueta}{req ? <span className="req"> *</span> : null}</label>
      {children}
      {ayuda ? <small style={{ color: "var(--muted)", fontSize: 11, marginTop: 2 }}>{ayuda}</small> : null}
    </div>
  );
}

/** Número escrito con coma decimal → número (o null si vacío; NaN si no se entiende). */
export const aNum = (s: string | number | null | undefined): number | null => {
  if (s === null || s === undefined) return null;
  const t = String(s).trim().replace(/\s/g, "");
  if (!t) return null;
  return /^-?\d+([.,]\d+)?$/.test(t) ? Number(t.replace(",", ".")) : NaN;
};
export const conComa = (n: number | null | undefined, dec = 2) => (n == null || !Number.isFinite(n) ? "" : n.toLocaleString("es-CL", { maximumFractionDigits: dec }));

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
/** Sube un archivo (multipart) a la API. */
export async function subirArchivo<T = any>(ruta: string, archivo: File): Promise<T> {
  const f = new FormData();
  f.append("archivo", archivo);
  const t = typeof window !== "undefined" ? localStorage.getItem("lims_token") : null;
  const r = await fetch(`${API}${ruta}`, { method: "POST", headers: t ? { Authorization: `Bearer ${t}` } : {}, body: f });
  if (r.ok) return r.json();
  const j: any = await r.json().catch(() => null);
  throw new Error(Array.isArray(j?.message) ? j.message.join(", ") : errorMensajeDe(j, r.status));
}
/** DELETE a la API. */
export async function borrar<T = any>(ruta: string): Promise<T> {
  const t = typeof window !== "undefined" ? localStorage.getItem("lims_token") : null;
  const r = await fetch(`${API}${ruta}`, { method: "DELETE", headers: t ? { Authorization: `Bearer ${t}` } : {} });
  if (r.ok) return r.json();
  const j: any = await r.json().catch(() => null);
  throw new Error(errorMensajeDe(j, r.status));
}
/** Abre en otra pestaña un recurso protegido (HTML del acta, adjuntos). */
export async function abrirProtegido(ruta: string, descargar?: string) {
  const t = typeof window !== "undefined" ? localStorage.getItem("lims_token") : null;
  const r = await fetch(`${API}${ruta}`, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
  if (!r.ok) throw new Error(errorMensajeDe(await r.json().catch(() => null), r.status));
  const url = URL.createObjectURL(await r.blob());
  if (descargar) {
    const a = document.createElement("a");
    a.href = url;
    a.download = descargar;
    a.click();
  } else window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
