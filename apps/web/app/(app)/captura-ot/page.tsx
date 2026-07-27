"use client";

/**
 * Captura dinámica por OT (puente catálogo ↔ operativo) · LIMS IDIC · RF-D01/D02
 *
 * Flujo: se elige una Orden de Trabajo; el sistema carga los resultados que el
 * puente materializó para sus muestras (un resultado por método × analito, con
 * la especificación —límites/nominal/unidad/fórmula— congelada del catálogo).
 * El usuario captura el valor de cada fila y el SERVIDOR devuelve el veredicto
 * (cumple / no_cumple / pendiente) aplicando las reglas de doble cota, una cota
 * o comparación cualitativa. Toda la operativa es por UI: no se evalúa nada en
 * el navegador, el veredicto que vale es el que persiste la API.
 *
 * Contrato backend (apps/api/src/flujo-real/flujo-real.module.ts):
 *   GET  /api/flujo/ot/:id/resultados  -> { otId, muestras, resumen, resultados[] }
 *   POST /api/flujo/resultado/:id/valor  body { valor } -> resultado con veredicto
 *   GET  /api/ot -> { data:[{ id, codigo, cliente:{ razonSocial } }] }
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { num } from "@/lib/format";
import { errorMensaje } from "@/lib/apiError";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const auth = () => ({
  Authorization: `Bearer ${localStorage.getItem("lims_token")}`,
  "Content-Type": "application/json",
});

type Ot = { id: string; codigo: string; cliente?: { razonSocial?: string } };

type Veredicto = "cumple" | "no_cumple" | "pendiente" | string;

type Resultado = {
  id: string;
  unidad?: string | null;
  formula?: string | null;
  limiteInf?: string | number | null;
  nominal?: string | number | null;
  limiteSup?: string | number | null;
  valorNumerico?: string | number | null;
  valorTexto?: string | null;
  veredicto: Veredicto;
  catAnalito?: { codigo?: string; nombre?: string; unidad?: string | null } | null;
  analito?: { codigo?: string; nombre?: string } | null;
  catMetodo?: { codigo?: string; nombre?: string; norma?: string | null } | null;
  muestra?: { codigo?: string; nombre?: string | null } | null;
};

type Resumen = { total: number; cumple: number; no_cumple: number; pendiente: number };

const VEREDICTO: Record<string, { texto: string; pill: string }> = {
  cumple: { texto: "Cumple", pill: "green" },
  no_cumple: { texto: "No cumple", pill: "red" },
  pendiente: { texto: "Pendiente", pill: "gray" },
};

/** Texto legible del límite: "inf – sup", ">= inf", "<= sup", "= nominal" o "—". */
function limiteTexto(r: Resultado): string {
  const inf = r.limiteInf ?? null;
  const sup = r.limiteSup ?? null;
  const nom = r.nominal ?? null;
  const fmt = (v: any) => (typeof v === "number" || (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v.replace(",", "."))))
    ? num(v, 3)
    : String(v));
  if (inf != null && sup != null) return `${fmt(inf)} – ${fmt(sup)}`;
  if (inf != null) return `≥ ${fmt(inf)}`;
  if (sup != null) return `≤ ${fmt(sup)}`;
  if (nom != null) return `= ${fmt(nom)}`;
  return "—";
}

/** Valor actual mostrado en el input (numérico si lo hay, si no el texto). */
function valorActual(r: Resultado): string {
  if (r.valorNumerico != null && r.valorNumerico !== "") return String(r.valorNumerico);
  if (r.valorTexto != null) return r.valorTexto;
  return "";
}

export default function CapturaOtPage() {
  const [ots, setOts] = useState<Ot[]>([]);
  const [otId, setOtId] = useState("");
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Carga inicial de OTs.
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API}/ot?limit=200`, { headers: auth() });
        if (!r.ok) throw new Error(await errorMensaje(r));
        const j = await r.json();
        // /api/ot devuelve un array plano (no `{data}`); se tolera ambas formas.
        setOts(Array.isArray(j) ? j : j.data ?? []);
      } catch (e: any) {
        setError(e.message);
      }
    })();
  }, []);

  // Carga de resultados al elegir OT.
  const cargar = useCallback(async (id: string) => {
    if (!id) {
      setResultados([]);
      setResumen(null);
      setDrafts({});
      return;
    }
    setError("");
    setLoading(true);
    try {
      const r = await fetch(`${API}/flujo/ot/${id}/resultados`, { headers: auth() });
      if (!r.ok) throw new Error(await errorMensaje(r));
      const j = await r.json();
      const res: Resultado[] = j.resultados ?? [];
      setResultados(res);
      setResumen(j.resumen ?? null);
      // El borrador de cada input arranca con el valor ya capturado (si lo hay).
      const d: Record<string, string> = {};
      for (const x of res) d[x.id] = valorActual(x);
      setDrafts(d);
    } catch (e: any) {
      setError(e.message);
      setResultados([]);
      setResumen(null);
    } finally {
      setLoading(false);
    }
  }, []);

  function onSelectOt(id: string) {
    setOtId(id);
    cargar(id);
  }

  // Recalcula el resumen localmente a partir de las filas (tras cada captura).
  const recomputarResumen = useCallback((filas: Resultado[]): Resumen => {
    const rs: Resumen = { total: filas.length, cumple: 0, no_cumple: 0, pendiente: 0 };
    for (const f of filas) {
      if (f.veredicto === "cumple") rs.cumple++;
      else if (f.veredicto === "no_cumple") rs.no_cumple++;
      else rs.pendiente++;
    }
    return rs;
  }, []);

  // Guarda el valor de una fila y aplica el resultado (con veredicto) devuelto.
  async function guardarFila(r: Resultado) {
    const raw = (drafts[r.id] ?? "").trim();
    if (raw === "") {
      setError("Escriba un valor antes de guardar.");
      return;
    }
    // Numérico si el texto es un número (admite coma decimal); si no, cualitativo.
    const asNum = Number(raw.replace(",", "."));
    const valor: number | string = Number.isFinite(asNum) && raw !== "" && !/[a-zA-Z]/.test(raw) ? asNum : raw;

    setError("");
    setSavingId(r.id);
    try {
      const resp = await fetch(`${API}/flujo/resultado/${r.id}/valor`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ valor }),
      });
      if (!resp.ok) throw new Error(await errorMensaje(resp));
      const actualizado: Resultado = await resp.json();
      setResultados((prev) => {
        // La respuesta no reincluye analito/muestra: se conservan de la fila previa.
        const filas = prev.map((f) => (f.id === r.id ? { ...f, ...actualizado } : f));
        setResumen(recomputarResumen(filas));
        return filas;
      });
      setDrafts((d) => ({ ...d, [r.id]: valorActual(actualizado) }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingId(null);
    }
  }

  const otSel = useMemo(() => ots.find((o) => o.id === otId), [ots, otId]);
  const listo = resumen != null && resumen.total > 0 && resumen.pendiente === 0;

  return (
    <div>
      <h1 className="page">Captura por OT</h1>
      <p className="subtitle">
        Elija una Orden de Trabajo y capture el valor de cada método × analito. El servidor calcula el
        veredicto en vivo (doble cota, una cota o cualitativo) contra la especificación congelada del
        catálogo. Cuando no quedan pendientes, la OT está lista para emitir informe. — RF-D01/D02.
      </p>
      {error && <div className="alert warn">{error}</div>}

      <div className="card">
        <div className="form-grid cols-2">
          <div className="field">
            <label>Orden de Trabajo</label>
            <select value={otId} onChange={(e) => onSelectOt(e.target.value)}>
              <option value="">— seleccionar —</option>
              {ots.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.codigo}
                  {o.cliente?.razonSocial ? ` · ${o.cliente.razonSocial}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ display: "flex", alignItems: "flex-end", justifyContent: "flex-end" }}>
            {otId && (
              <Link
                href={"/informes" as any}
                className={`btn sm ${listo ? "primary" : ""}`}
                title={listo ? "Todos los analitos tienen veredicto: puede emitir el informe" : "Aún hay analitos pendientes de captura"}
              >
                🖨 Emitir informe
              </Link>
            )}
          </div>
        </div>
      </div>

      {resumen && (
        <div className="kpis">
          <div className="kpi k-blue"><div className="lab">Total analitos</div><div className="val">{resumen.total}</div></div>
          <div className="kpi k-green"><div className="lab">Cumple</div><div className="val">{resumen.cumple}</div></div>
          <div className="kpi k-red"><div className="lab">No cumple</div><div className="val">{resumen.no_cumple}</div></div>
          <div className="kpi"><div className="lab">Pendiente</div><div className="val">{resumen.pendiente}</div></div>
        </div>
      )}

      {listo && (
        <div className="alert" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="pill green">Lista</span>
          <span>
            La OT {otSel?.codigo} no tiene analitos pendientes: todos tienen veredicto. Ya puede{" "}
            <Link href={"/informes" as any}>emitir el informe</Link>.
          </span>
        </div>
      )}

      {otId && (
        <div className="card">
          <h2>Resultados por analizar</h2>
          {loading ? (
            <p className="subtitle">Cargando resultados…</p>
          ) : resultados.length === 0 ? (
            <p className="subtitle">
              Esta OT no tiene resultados materializados. Genere el análisis desde el flujo de la OT
              (materializa los métodos del panel como resultados por analizar) antes de capturar.
            </p>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Método</th>
                  <th>Analito</th>
                  <th>Unidad</th>
                  <th>Límite</th>
                  <th style={{ width: 220 }}>Valor</th>
                  <th>Veredicto</th>
                </tr>
              </thead>
              <tbody>
                {resultados.map((r) => {
                  const analito = r.catAnalito?.nombre ?? r.analito?.nombre ?? r.catAnalito?.codigo ?? r.analito?.codigo ?? "—";
                  const metodo = r.catMetodo?.nombre ?? r.catMetodo?.codigo ?? "—";
                  const vd = VEREDICTO[r.veredicto] ?? { texto: r.veredicto, pill: "gray" };
                  const saving = savingId === r.id;
                  return (
                    <tr key={r.id}>
                      <td>
                        {metodo}
                        {r.catMetodo?.codigo && r.catMetodo?.nombre ? (
                          <div style={{ fontSize: 11, color: "var(--muted)" }}>{r.catMetodo.codigo}</div>
                        ) : null}
                      </td>
                      <td>{analito}</td>
                      <td>{r.unidad ?? r.catAnalito?.unidad ?? "—"}</td>
                      <td style={{ fontFamily: "'JetBrains Mono', monospace" }}>{limiteTexto(r)}</td>
                      <td>
                        <div style={{ display: "flex", gap: 6 }}>
                          <input
                            value={drafts[r.id] ?? ""}
                            onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") guardarFila(r);
                            }}
                            placeholder="valor"
                            style={{ fontFamily: "'JetBrains Mono', monospace" }}
                            disabled={saving}
                          />
                          <button className="btn sm" onClick={() => guardarFila(r)} disabled={saving}>
                            {saving ? "…" : "Guardar"}
                          </button>
                        </div>
                      </td>
                      <td>
                        <span className={`pill ${vd.pill}`}>{vd.texto}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
