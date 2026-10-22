"use client";

/**
 * EP-11 11.34 · Peritajes de la evidencia: los importados de IBIS y los que
 * registra el perito (tipo, resultado, conclusiones y adjuntos PDF/PNG/JPEG).
 * Al registrar el primero la evidencia pasa a «analizada».
 */
import { useState } from "react";
import { fechaHora } from "@/lib/format";
import { usePermisos } from "@/lib/permisos";
import { toast } from "@/components/ui/feedback";
import { descargarAdjunto, pedir, subirPlanilla } from "@/lib/d11";

const TIPOS = [
  { valor: "balistico_comparativo", texto: "Balístico comparativo" },
  { valor: "funcionamiento", texto: "Funcionamiento del arma" },
  { valor: "identificacion", texto: "Identificación del elemento" },
  { valor: "explosivos", texto: "Explosivos" },
  { valor: "otro", texto: "Otro" },
];
const RESULTADOS: Record<string, { texto: string; pill: string }> = {
  concluyente: { texto: "Concluyente", pill: "green" },
  no_concluyente: { texto: "No concluyente", pill: "amber" },
  sin_coincidencia: { texto: "Sin coincidencia", pill: "gray" },
  pendiente: { texto: "Pendiente", pill: "gray" },
};
const VACIO = { tipo: "", resultado: "", conclusiones: "" };

export default function Peritajes({ evidenciaId, peritajes, onCambio }: { evidenciaId: string; peritajes: any[]; onCambio: () => void }) {
  const { puede } = usePermisos();
  const registra = puede("peritaje.registrar");
  const [abierto, setAbierto] = useState(false);
  const [f, setF] = useState({ ...VACIO });
  const [archivo, setArchivo] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function registrar(ev: React.FormEvent) {
    ev.preventDefault();
    setError("");
    const faltan = [!f.tipo && "el tipo de peritaje", !f.resultado && "el resultado", !f.conclusiones.trim() && "las conclusiones"].filter(Boolean);
    if (faltan.length) return setError(`Indique ${faltan.join(", ")}.`);
    setOcupado(true);
    try {
      const p = await pedir<any>("POST", `/evidencias/${evidenciaId}/peritaje`, { tipo: f.tipo, resultado: f.resultado, conclusiones: f.conclusiones.trim() });
      if (archivo) await subirPlanilla(`/evidencias/${evidenciaId}/peritajes/${p.id}/adjuntos`, archivo);
      toast.ok("Peritaje registrado. La evidencia queda analizada.");
      setF({ ...VACIO });
      setArchivo(null);
      setAbierto(false);
      onCambio();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setOcupado(false);
    }
  }

  async function adjuntar(peritajeId: string, file: File | undefined) {
    if (!file) return;
    try {
      await subirPlanilla(`/evidencias/${evidenciaId}/peritajes/${peritajeId}/adjuntos`, file);
      toast.ok("Adjunto agregado al peritaje.");
      onCambio();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  return (
    <div className="card card--table" style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h3 style={{ margin: 0, flex: 1 }}>Peritajes</h3>
        {registra && (
          <button type="button" className="btn sm primary" onClick={() => setAbierto((x) => !x)} aria-expanded={abierto}>
            {abierto ? "Cerrar" : "＋ Registrar peritaje"}
          </button>
        )}
      </div>
      {abierto && (
        <form onSubmit={registrar} style={{ margin: "10px 0 14px" }} aria-label="Registrar peritaje">
          {error && <div className="alert warn" role="alert">{error}</div>}
          <div className="form-grid">
            <div className="field">
              <label htmlFor="pe-tipo">Tipo de peritaje <span className="req">*</span></label>
              <select id="pe-tipo" value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
                <option value="">Elija…</option>
                {TIPOS.map((t) => <option key={t.valor} value={t.valor}>{t.texto}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="pe-res">Resultado <span className="req">*</span></label>
              <select id="pe-res" value={f.resultado} onChange={(e) => setF({ ...f, resultado: e.target.value })}>
                <option value="">Elija…</option>
                {Object.entries(RESULTADOS).map(([k, v]) => <option key={k} value={k}>{v.texto}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="pe-adj">Adjunto (PDF, PNG o JPEG, máx. 5 MB)</label>
              <input id="pe-adj" type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
            </div>
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label htmlFor="pe-con">Conclusiones <span className="req">*</span></label>
              <textarea id="pe-con" rows={3} value={f.conclusiones} onChange={(e) => setF({ ...f, conclusiones: e.target.value })} />
            </div>
          </div>
          <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
            <button className="btn primary sm" disabled={ocupado}>Registrar peritaje → certificado</button>
          </div>
        </form>
      )}
      <table className="data" style={{ marginTop: 8 }}>
        <thead>
          <tr><th>Origen · tipo</th><th>Resultado</th><th className="num">Hits</th><th>Conclusiones</th><th>Adjuntos</th><th>Perito</th><th>Fecha</th></tr>
        </thead>
        <tbody>
          {peritajes.map((p: any) => (
            <tr key={p.id}>
              <td>
                <span className={`pill ${p.origen === "ibis" ? "blue" : "gray"}`}>{p.origen === "ibis" ? "IBIS" : "Manual"}</span>
                {p.datos?.tipoNombre && <small style={{ display: "block" }}>{p.datos.tipoNombre}</small>}
              </td>
              <td><span className={`pill ${RESULTADOS[p.resultado]?.pill ?? "gray"}`}>{RESULTADOS[p.resultado]?.texto ?? p.resultado ?? "—"}</span></td>
              <td className="num">{p.hit_count ?? 0}</td>
              <td style={{ maxWidth: 300 }}>{p.conclusiones ?? "—"}</td>
              <td>
                {(p.adjuntos ?? []).map((a: any) => (
                  <button key={a.id} type="button" className="btn sm ghost" style={{ display: "block", marginBottom: 2 }}
                    onClick={() => descargarAdjunto(`/evidencias/${evidenciaId}/adjuntos/${a.id}`, a.nombre).catch((e) => toast.error(e.message))}>
                    ⭳ {a.nombre}
                  </button>
                ))}
                {registra && p.origen !== "ibis" && (
                  <label className="btn sm ghost" style={{ cursor: "pointer" }}>
                    ＋ Adjunto
                    <input type="file" accept="application/pdf,image/png,image/jpeg" hidden onChange={(e) => adjuntar(p.id, e.target.files?.[0])} />
                  </label>
                )}
                {!(p.adjuntos ?? []).length && !registra && "—"}
              </td>
              <td>{p.perito_nombre ?? "—"}</td>
              <td>{fechaHora(p.fecha_peritaje)}</td>
            </tr>
          ))}
          {peritajes.length === 0 && (
            <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--muted)", padding: 14 }}>Sin peritajes registrados. El certificado de evidencia exige al menos uno.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
