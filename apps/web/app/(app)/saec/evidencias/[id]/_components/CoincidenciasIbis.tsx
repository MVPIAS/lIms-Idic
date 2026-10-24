"use client";

/**
 * RF-K03.2 · Coincidencias balísticas (IBIS) de la evidencia. B-044: el perito
 * confirma o descarta cada coincidencia desde la ficha, con motivo (antes solo
 * por la API). Queda quién, cuándo y por qué.
 */
import { useState } from "react";
import { fechaHora } from "@/lib/format";
import { usePermisos } from "@/lib/permisos";
import { toast } from "@/components/ui/feedback";
import Modal from "@/components/documentos/Modal";
import { pedir } from "@/lib/d11";

const ESTADO: Record<string, { texto: string; pill: string }> = {
  sin_confirmar: { texto: "Sin confirmar", pill: "amber" },
  confirmado: { texto: "Confirmada", pill: "green" },
  descartado: { texto: "Descartada", pill: "gray" },
};
type Accion = { hit: any; estado: "confirmado" | "descartado" | "sin_confirmar" };
const TITULO: Record<Accion["estado"], string> = {
  confirmado: "Confirmar la coincidencia",
  descartado: "Descartar la coincidencia",
  sin_confirmar: "Volver a «sin confirmar»",
};

export default function CoincidenciasIbis({ hits, onCambio }: { hits: any[]; onCambio: () => void }) {
  const { puede } = usePermisos();
  const decide = puede("peritaje.registrar");
  const [accion, setAccion] = useState<Accion | null>(null);
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  const abrir = (hit: any, estado: Accion["estado"]) => { setAccion({ hit, estado }); setMotivo(""); setError(""); };
  async function guardar() {
    if (!accion) return;
    if (motivo.trim().length < 5) return setError("Indique el motivo (mínimo 5 caracteres).");
    setOcupado(true);
    try {
      await pedir("POST", `/ibis/hits/${accion.hit.id}/estado`, { estado: accion.estado, motivo: motivo.trim() });
      toast.ok(accion.estado === "confirmado" ? "Coincidencia confirmada." : accion.estado === "descartado" ? "Coincidencia descartada." : "Coincidencia sin confirmar.");
      setAccion(null);
      onCambio();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="card card--table" style={{ marginBottom: 12 }}>
      <h3 style={{ marginTop: 0 }}>Coincidencias balísticas (IBIS)</h3>
      <table className="data">
        <thead>
          <tr><th>Evidencia A</th><th>Evidencia B</th><th className="num">Score</th><th>Estado</th><th>Fecha</th>{decide && <th style={{ textAlign: "right" }}>Acciones</th>}</tr>
        </thead>
        <tbody>
          {hits.map((h) => {
            const e = ESTADO[h.estado] ?? { texto: h.estado, pill: "gray" };
            return (
              <tr key={h.id}>
                <td className="codigo">{h.evidencia_a_codigo ?? h.uuid_evidencia_a ?? "—"}</td>
                <td className="codigo">{h.evidencia_b_codigo ?? h.uuid_evidencia_b ?? "—"}</td>
                <td className="num">{h.score ?? "—"}</td>
                <td>
                  <span className={`pill ${e.pill}`}>{e.texto}</span>
                  {h.estado_motivo && <small style={{ display: "block", color: "var(--muted)" }}>{h.estado_motivo}{h.estado_at ? ` · ${fechaHora(h.estado_at)}` : ""}</small>}
                </td>
                <td>{fechaHora(h.fecha_hit)}</td>
                {decide && (
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {h.estado === "sin_confirmar" ? (
                      <>
                        <button className="btn primary sm" onClick={() => abrir(h, "confirmado")}>Confirmar…</button>{" "}
                        <button className="btn outline sm" onClick={() => abrir(h, "descartado")}>Descartar…</button>
                      </>
                    ) : (
                      <button className="btn outline sm" onClick={() => abrir(h, "sin_confirmar")}>Volver a sin confirmar…</button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
          {hits.length === 0 && (
            <tr><td colSpan={decide ? 6 : 5} style={{ textAlign: "center", color: "var(--muted)", padding: 14 }}>Sin coincidencias.</td></tr>
          )}
        </tbody>
      </table>
      {accion && (
        <Modal titulo={TITULO[accion.estado]} onCerrar={() => setAccion(null)} acciones={<>
          <button className="btn outline" onClick={() => setAccion(null)}>Cancelar</button>
          <button className="btn primary" disabled={ocupado} onClick={guardar}>{TITULO[accion.estado]}</button>
        </>}>
          <p style={{ marginTop: 0, color: "var(--muted)" }}>
            {accion.hit.evidencia_a_codigo ?? accion.hit.uuid_evidencia_a} ↔ {accion.hit.evidencia_b_codigo ?? accion.hit.uuid_evidencia_b} · score {accion.hit.score ?? "—"}.
            Queda registrado con su nombre, la fecha y el motivo.
          </p>
          {error && <div className="alert warn" role="alert">{error}</div>}
          <div className="field">
            <label htmlFor="hit-motivo">Motivo <span className="req">*</span></label>
            <textarea id="hit-motivo" rows={3} maxLength={1000} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </div>
        </Modal>
      )}
    </div>
  );
}
