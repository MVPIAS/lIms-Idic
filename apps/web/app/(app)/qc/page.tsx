"use client";

/**
 * Control de Calidad por OT · LIMS IDIC · contrato 4.2.3 / 4.2.4 / 4.3.7 / 4.3.8
 *
 * Se elige una Orden de Trabajo; el sistema lista los MÉTODOS de sus muestras
 * que EXIGEN control de calidad (cat_metodo.qc_requerido) y sus controles ya
 * registrados. El usuario registra blancos, estándares, curvas de calibración y
 * duplicados con su valor esperado/obtenido y criterio; el SERVIDOR evalúa el
 * resultado (aprobado/rechazado) — no se calcula nada en el navegador. El estado
 * global "QC aprobado / pendiente" indica qué métodos faltan por aprobar; hasta
 * que no falte ninguno, la emisión del informe queda BLOQUEADA en el backend.
 *
 * Contrato backend (apps/api/src/qc/qc.module.ts):
 *   GET   /api/qc/ot/:otId                 -> { estado:{aprobado,faltantes[]}, metodos[], controles[] }
 *   POST  /api/qc/ot/:otId/control  body   -> control con resultado evaluado
 *   PATCH /api/qc/control/:id       body    -> aprobación/rechazo manual
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { errorMensaje } from "@/lib/apiError";
import { esNumero } from "@/lib/validate";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const auth = () => ({
  Authorization: `Bearer ${localStorage.getItem("lims_token")}`,
  "Content-Type": "application/json",
});

type Ot = { id: string; codigo: string; cliente?: { razonSocial?: string } };
type Metodo = { id: string; codigo: string; nombre: string; aprobado: boolean };
type Tipo = "blanco" | "estandar" | "curva" | "duplicado";
type ResultadoQc = "aprobado" | "rechazado" | "pendiente" | string;

type Control = {
  id: string;
  tipo: Tipo | string;
  valorEsperado?: string | number | null;
  valorObtenido?: string | number | null;
  criterio?: string | null;
  resultado: ResultadoQc;
  rCuadrado?: string | number | null;
  recuperacionPct?: string | number | null;
  cvPct?: string | number | null;
  aprobadoPor?: string | null;
  observaciones?: string | null;
  catMetodo?: { id: string; codigo?: string; nombre?: string } | null;
};

type Estado = { aprobado: boolean; faltantes: { id: string; codigo: string; nombre: string }[] };

const RESULTADO_PILL: Record<string, { texto: string; pill: string }> = {
  aprobado: { texto: "Aprobado", pill: "green" },
  rechazado: { texto: "Rechazado", pill: "red" },
  pendiente: { texto: "Pendiente", pill: "gray" },
};

const TIPO_LABEL: Record<Tipo, string> = {
  blanco: "Blanco",
  estandar: "Estándar",
  curva: "Curva de calibración",
  duplicado: "Duplicado",
};

/** Pista del criterio esperado según el tipo (solo ayuda de UI). */
const CRITERIO_HINT: Record<Tipo, string> = {
  blanco: "LD (máx.), p. ej. 0.5",
  estandar: "rango %recup., p. ej. 80-120",
  curva: "umbral R², p. ej. 0.995",
  duplicado: "umbral %CV, p. ej. 10",
};

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.round(n * 10000) / 10000) : String(v);
}

export default function QcPage() {
  const [ots, setOts] = useState<Ot[]>([]);
  const [otId, setOtId] = useState("");
  const [metodos, setMetodos] = useState<Metodo[]>([]);
  const [controles, setControles] = useState<Control[]>([]);
  const [estado, setEstado] = useState<Estado | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  // Formulario de nuevo control.
  const [fMetodo, setFMetodo] = useState("");
  const [fTipo, setFTipo] = useState<Tipo>("estandar");
  const [fEsperado, setFEsperado] = useState("");
  const [fObtenido, setFObtenido] = useState("");
  const [fCriterio, setFCriterio] = useState("");
  const [fObs, setFObs] = useState("");
  const [saving, setSaving] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API}/ot?limit=200`, { headers: auth() });
        if (!r.ok) throw new Error(await errorMensaje(r));
        const j = await r.json();
        setOts(Array.isArray(j) ? j : j.data ?? []);
      } catch (e: any) {
        setError(e.message);
      }
    })();
  }, []);

  const cargar = useCallback(async (id: string) => {
    if (!id) {
      setMetodos([]);
      setControles([]);
      setEstado(null);
      return;
    }
    setError("");
    setOk("");
    setLoading(true);
    try {
      const r = await fetch(`${API}/qc/ot/${id}`, { headers: auth() });
      if (!r.ok) throw new Error(await errorMensaje(r));
      const j = await r.json();
      setMetodos(j.metodos ?? []);
      setControles(j.controles ?? []);
      setEstado(j.estado ?? null);
      setFMetodo((prev) => prev || (j.metodos?.[0]?.id ?? ""));
    } catch (e: any) {
      setError(e.message);
      setMetodos([]);
      setControles([]);
      setEstado(null);
    } finally {
      setLoading(false);
    }
  }, []);

  function onSelectOt(id: string) {
    setOtId(id);
    setFMetodo("");
    cargar(id);
  }

  async function registrar() {
    // Validación de campos antes de enviar (el servidor evalúa; aquí garantizamos números).
    const v: Record<string, string> = {};
    if (!fMetodo) v.metodo = "Elija el método al que pertenece el control.";
    if (fObtenido.trim() === "" || !esNumero(fObtenido)) {
      v.obtenido = fTipo === "curva" ? "Indique el R² obtenido (número)." : "Indique el valor obtenido (número).";
    }
    if ((fTipo === "estandar" || fTipo === "duplicado") && (fEsperado.trim() === "" || !esNumero(fEsperado))) {
      v.esperado = "Indique el valor esperado (número).";
    }
    if (fEsperado.trim() !== "" && !esNumero(fEsperado)) v.esperado = "El valor esperado debe ser numérico.";
    setErrs(v);
    if (Object.keys(v).length) {
      setError("");
      return;
    }
    setError("");
    setOk("");
    setSaving(true);
    try {
      const body: any = { catMetodoId: fMetodo, tipo: fTipo };
      const esp = Number(fEsperado.replace(",", "."));
      const obt = Number(fObtenido.replace(",", "."));
      if (fEsperado.trim() !== "" && Number.isFinite(esp)) body.valorEsperado = esp;
      if (fObtenido.trim() !== "" && Number.isFinite(obt)) body.valorObtenido = obt;
      if (fCriterio.trim() !== "") body.criterio = fCriterio.trim();
      if (fObs.trim() !== "") body.observaciones = fObs.trim();

      const r = await fetch(`${API}/qc/ot/${otId}/control`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await errorMensaje(r));
      const c: Control = await r.json();
      setOk(`Control registrado: ${RESULTADO_PILL[c.resultado]?.texto ?? c.resultado}.`);
      setFEsperado("");
      setFObtenido("");
      setFObs("");
      await cargar(otId);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function revisar(id: string, resultado: "aprobado" | "rechazado") {
    setError("");
    setOk("");
    try {
      const r = await fetch(`${API}/qc/control/${id}`, {
        method: "PATCH",
        headers: auth(),
        body: JSON.stringify({ resultado }),
      });
      if (!r.ok) throw new Error(await errorMensaje(r));
      await cargar(otId);
    } catch (e: any) {
      setError(e.message);
    }
  }

  const otSel = useMemo(() => ots.find((o) => o.id === otId), [ots, otId]);

  return (
    <div>
      <h1 className="page">Control de Calidad</h1>
      <p className="subtitle">
        Elija una Orden de Trabajo y registre blancos, estándares, curvas de calibración y duplicados
        de los métodos que exigen QC. El servidor evalúa cada control (aprobado / rechazado). La emisión
        del informe queda bloqueada mientras un método que requiere QC no tenga control aprobado. —
        contrato 4.2.3 / 4.2.4 / 4.3.7 / 4.3.8.
      </p>
      {error && <div className="alert warn">{error}</div>}
      {ok && <div className="alert">{ok}</div>}

      <div className="card">
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
      </div>

      {otId && estado && (
        <div
          className="alert"
          style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
        >
          <span className={`pill ${estado.aprobado ? "green" : "gray"}`}>
            {estado.aprobado ? "QC aprobado" : "QC pendiente"}
          </span>
          {estado.aprobado ? (
            <span>
              La OT {otSel?.codigo} tiene aprobado el control de calidad de todos los métodos que lo
              exigen: la emisión de informe no está bloqueada por QC.
            </span>
          ) : estado.faltantes.length ? (
            <span>
              Falta aprobar QC de: {estado.faltantes.map((m) => `${m.codigo} · ${m.nombre}`).join("; ")}.
              La emisión del informe está BLOQUEADA hasta aprobarlos.
            </span>
          ) : (
            <span>Esta OT no tiene métodos que exijan control de calidad.</span>
          )}
        </div>
      )}

      {otId && (
        <div className="card">
          <h2>Métodos que requieren QC</h2>
          {loading ? (
            <p className="subtitle">Cargando…</p>
          ) : metodos.length === 0 ? (
            <p className="subtitle">
              Ningún método presente en las muestras de esta OT tiene <code>qc_requerido</code>. Marque
              el método como &quot;QC requerido&quot; en el catálogo y materialice sus análisis para
              exigir control de calidad.
            </p>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Método</th>
                  <th>Estado QC</th>
                </tr>
              </thead>
              <tbody>
                {metodos.map((m) => (
                  <tr key={m.id}>
                    <td style={{ fontFamily: "'JetBrains Mono', monospace" }}>{m.codigo}</td>
                    <td>{m.nombre}</td>
                    <td>
                      <span className={`pill ${m.aprobado ? "green" : "gray"}`}>
                        {m.aprobado ? "Aprobado" : "Pendiente"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {otId && metodos.length > 0 && (
        <div className="card">
          <h2>Registrar control</h2>
          <div className="form-grid cols-2">
            <div className="field">
              <label>Método</label>
              <select value={fMetodo} onChange={(e) => setFMetodo(e.target.value)}>
                <option value="">— seleccionar —</option>
                {metodos.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.codigo} · {m.nombre}
                  </option>
                ))}
              </select>
              {errs.metodo && <small style={{ color: "var(--red)", fontSize: 11 }}>{errs.metodo}</small>}
            </div>
            <div className="field">
              <label>Tipo de control</label>
              <select value={fTipo} onChange={(e) => setFTipo(e.target.value as Tipo)}>
                {(Object.keys(TIPO_LABEL) as Tipo[]).map((t) => (
                  <option key={t} value={t}>
                    {TIPO_LABEL[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Valor esperado</label>
              <input
                inputMode="decimal"
                value={fEsperado}
                onChange={(e) => setFEsperado(e.target.value)}
                placeholder={fTipo === "curva" ? "(no aplica)" : "esperado"}
                style={{ fontFamily: "'JetBrains Mono', monospace" }}
              />
              {errs.esperado && <small style={{ color: "var(--red)", fontSize: 11 }}>{errs.esperado}</small>}
            </div>
            <div className="field">
              <label>{fTipo === "curva" ? "R² obtenido" : "Valor obtenido"}</label>
              <input
                inputMode="decimal"
                value={fObtenido}
                onChange={(e) => setFObtenido(e.target.value)}
                placeholder={fTipo === "curva" ? "p. ej. 0.998" : "obtenido"}
                style={{ fontFamily: "'JetBrains Mono', monospace" }}
              />
              {errs.obtenido && <small style={{ color: "var(--red)", fontSize: 11 }}>{errs.obtenido}</small>}
            </div>
            <div className="field">
              <label>Criterio</label>
              <input
                value={fCriterio}
                onChange={(e) => setFCriterio(e.target.value)}
                placeholder={CRITERIO_HINT[fTipo]}
                style={{ fontFamily: "'JetBrains Mono', monospace" }}
              />
            </div>
            <div className="field">
              <label>Observaciones</label>
              <input value={fObs} onChange={(e) => setFObs(e.target.value)} placeholder="opcional" />
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <button className="btn primary" onClick={registrar} disabled={saving}>
              {saving ? "Registrando…" : "Registrar y evaluar"}
            </button>
          </div>
        </div>
      )}

      {otId && (
        <div className="card">
          <h2>Controles registrados</h2>
          {controles.length === 0 ? (
            <p className="subtitle">Aún no hay controles registrados para esta OT.</p>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Método</th>
                  <th>Tipo</th>
                  <th>Esperado</th>
                  <th>Obtenido</th>
                  <th>Criterio</th>
                  <th>Métrica</th>
                  <th>Resultado</th>
                  <th>Aprobó</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {controles.map((c) => {
                  const rp = RESULTADO_PILL[c.resultado] ?? { texto: c.resultado, pill: "gray" };
                  const metrica =
                    c.tipo === "curva"
                      ? `R² ${fmt(c.rCuadrado)}`
                      : c.tipo === "estandar"
                        ? `${fmt(c.recuperacionPct)}%`
                        : c.tipo === "duplicado"
                          ? `CV ${fmt(c.cvPct)}%`
                          : "—";
                  return (
                    <tr key={c.id}>
                      <td>{c.catMetodo?.codigo ?? c.catMetodo?.nombre ?? "—"}</td>
                      <td>{TIPO_LABEL[c.tipo as Tipo] ?? c.tipo}</td>
                      <td style={{ fontFamily: "'JetBrains Mono', monospace" }}>{fmt(c.valorEsperado)}</td>
                      <td style={{ fontFamily: "'JetBrains Mono', monospace" }}>{fmt(c.valorObtenido)}</td>
                      <td style={{ fontFamily: "'JetBrains Mono', monospace" }}>{c.criterio ?? "—"}</td>
                      <td style={{ fontFamily: "'JetBrains Mono', monospace" }}>{metrica}</td>
                      <td>
                        <span className={`pill ${rp.pill}`}>{rp.texto}</span>
                      </td>
                      <td style={{ fontSize: 12, color: "var(--muted)" }}>{c.aprobadoPor ?? "—"}</td>
                      <td>
                        <div style={{ display: "flex", gap: 6 }}>
                          {c.resultado !== "aprobado" && (
                            <button className="btn sm" onClick={() => revisar(c.id, "aprobado")}>
                              Aprobar
                            </button>
                          )}
                          {c.resultado !== "rechazado" && (
                            <button className="btn sm" onClick={() => revisar(c.id, "rechazado")}>
                              Rechazar
                            </button>
                          )}
                        </div>
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
