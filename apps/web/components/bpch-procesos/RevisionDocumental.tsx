"use client";

/**
 * EP-07 7.3 · Registro y análisis de documentos DGMN / AF (SAC-PG01-IT08) en la
 * OT de una inspección de Producción Nacional: checklist por documento legal
 * (Aplica · Conforme / Pendiente / No conforme, con defecto crítico o menor) y
 * traslado de los defectos al ensayo «Rev. Doc. Legal» de la OT.
 * API: GET/PUT /bpch/pn/ot/:otId/revision-documental
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "@/components/ui/feedback";
import { usePermisos } from "@/lib/permisos";
import { llamar } from "@/lib/laboratorio";
import { fechaHora } from "@/lib/format";

type Item = { clave: string; aplica: boolean; estado?: string | null; defecto?: string | null; nombre?: string | null; observacion?: string | null };
type Doc = { clave: string; nombre: string; aplica: "si" | "si_corresponde" | "segun_trabajo" };

const APLICA: Record<Doc["aplica"], string> = { si: "Sí", si_corresponde: "Si corresponde", segun_trabajo: "Según el trabajo" };
const RESULTADO: Record<string, { t: string; pill: string }> = {
  pendiente: { t: "Pendiente", pill: "amber" },
  conforme: { t: "Documentación conforme", pill: "green" },
  no_conforme: { t: "No conforme", pill: "red" },
};

export default function RevisionDocumental({ otId, onCambio }: { otId: string; onCambio?: () => void }) {
  const { puede } = usePermisos();
  const [d, setD] = useState<any>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const r = await llamar<any>("GET", `/bpch/pn/ot/${otId}/revision-documental`);
      setD(r);
      const previos: Item[] = r.revision?.items ?? [];
      setItems(r.documentos.map((doc: Doc) => previos.find((p) => p.clave === doc.clave) ?? { clave: doc.clave, aplica: doc.aplica === "si" }));
    } catch {
      setD(null);
    }
  }, [otId]);
  useEffect(() => {
    cargar();
  }, [cargar]);

  if (!d?.aplica) return null;
  const edita = d.otAbierta && puede("resultado.crear");
  const poner = (clave: string, x: Partial<Item>) => setItems((l) => l.map((i) => (i.clave === clave ? { ...i, ...x } : i)));

  async function guardar() {
    setError("");
    setBusy(true);
    try {
      const r = await llamar<any>("PUT", `/bpch/pn/ot/${otId}/revision-documental`, { items });
      toast.ok(r.resultado === "pendiente" ? "Revisión guardada: queda pendiente." : `Revisión registrada: ${r.criticos} crítico(s), ${r.menores} menor(es) trasladados al ensayo «Rev. Doc. Legal».`);
      await cargar();
      onCambio?.();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="rd-titulo" style={{ marginBottom: 10 }}>
      <h2 id="rd-titulo" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        Revisión documental · SAC-PG01-IT08
        {d.revision && <span className={`pill ${RESULTADO[d.revision.resultado]?.pill ?? "gray"}`}>{RESULTADO[d.revision.resultado]?.t}</span>}
        <span className="right">Inspector LCA · EP-07 7.3</span>
      </h2>
      <p className="subtitle" style={{ marginTop: 0 }}>
        Defecto <b>crítico</b>: no presentar el documento, diferencias de nombre/RUT o de productos, documento no vigente. <b>Menor</b>: otras diferencias (6 o más menores equivalen a crítico).
        {d.revision && <> Última revisión: {d.revision.registradoPor ?? "—"}, {fechaHora(d.revision.registradoAt)}{d.revision.trasladadoAt ? " · trasladada al ensayo" : ""}.</>}
      </p>
      {error && <div className="alert warn" role="alert">{error}</div>}
      <table className="data">
        <thead><tr><th>Documento legal</th><th>Aplica</th><th>Estado</th><th>Defecto</th><th>Observación</th></tr></thead>
        <tbody>
          {d.documentos.map((doc: Doc) => {
            const i = items.find((x) => x.clave === doc.clave) ?? { clave: doc.clave, aplica: false };
            return (
              <tr key={doc.clave}>
                <td>
                  {doc.nombre}
                  {doc.clave === "otro" && i.aplica && (
                    <input aria-label="Nombre del otro documento" placeholder="Nombre del documento" value={i.nombre ?? ""} disabled={!edita} onChange={(e) => poner(doc.clave, { nombre: e.target.value })} style={{ display: "block", marginTop: 4 }} />
                  )}
                </td>
                <td>
                  {doc.aplica === "si" ? APLICA.si : (
                    <label style={{ whiteSpace: "nowrap" }}>
                      <input type="checkbox" checked={i.aplica} disabled={!edita} onChange={(e) => poner(doc.clave, { aplica: e.target.checked })} /> {APLICA[doc.aplica]}
                    </label>
                  )}
                </td>
                <td>
                  {i.aplica ? (
                    <select aria-label={`Estado de ${doc.nombre}`} value={i.estado ?? ""} disabled={!edita} onChange={(e) => poner(doc.clave, { estado: e.target.value || null, ...(e.target.value !== "no_conforme" ? { defecto: null } : {}) })}>
                      <option value="">Elija…</option>
                      <option value="conforme">Conforme</option>
                      <option value="pendiente">Pendiente</option>
                      <option value="no_conforme">No conforme</option>
                    </select>
                  ) : "—"}
                </td>
                <td>
                  {i.aplica && i.estado === "no_conforme" ? (
                    <select aria-label={`Defecto de ${doc.nombre}`} value={i.defecto ?? ""} disabled={!edita} onChange={(e) => poner(doc.clave, { defecto: e.target.value || null })}>
                      <option value="">Elija…</option>
                      <option value="critico">Crítico</option>
                      <option value="menor">Menor</option>
                    </select>
                  ) : "—"}
                </td>
                <td>
                  {i.aplica ? (
                    <input aria-label={`Observación de ${doc.nombre}`} value={i.observacion ?? ""} disabled={!edita} onChange={(e) => poner(doc.clave, { observacion: e.target.value })} maxLength={1000} placeholder={i.estado === "no_conforme" ? "Describa la diferencia (obligatorio)" : ""} />
                  ) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!d.ensayo.length && <p className="subtitle" style={{ color: "var(--red)" }}>La OT no tiene el ensayo «Rev. Doc. Legal»: regístrelo en la muestra para trasladar los defectos.</p>}
      {edita && (
        <div className="toolbar">
          <button type="button" className="btn primary" disabled={busy} onClick={guardar}>Documentación revisada → inspección</button>
          {d.revision && <small style={{ color: "var(--muted)" }}>{d.revision.criticos} crítico(s) · {d.revision.menores} menor(es)</small>}
        </div>
      )}
    </section>
  );
}
