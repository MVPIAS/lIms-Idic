"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fecha } from "@/lib/format";
import { leerReplicas, llamar, veredictoInfo, ESTADO_RESULTADO } from "@/lib/laboratorio";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("lims_token")}`, "Content-Type": "application/json" });

function stats(rep: number[]) {
  const xs = rep.filter((x) => Number.isFinite(x));
  const n = xs.length;
  if (!n) return { n: 0, promedio: 0, desviacion: 0, cv: 0 };
  const m = xs.reduce((a, b) => a + b, 0) / n;
  const s = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)) : 0;
  return { n, promedio: m, desviacion: s, cv: m ? (s / Math.abs(m)) * 100 : 0 };
}

/**
 * Ciclo de vida del resultado (RF-E01), tal y como lo devuelve la API en
 * `estado`. El vocabulario es el de `common/estados.ts`: el estado intermedio
 * es `revisado_n1`, no `revisado`.
 */
const ESTADO = ESTADO_RESULTADO;

export default function CapturaPage() {
  const [muestras, setMuestras] = useState<any[]>([]);
  const [analitos, setAnalitos] = useState<any[]>([]);
  const [equipos, setEquipos] = useState<any[]>([]);
  const [muestraId, setMuestraId] = useState("");
  const [analitoId, setAnalitoId] = useState("");
  const [equipoId, setEquipoId] = useState("");
  // Sin datos de ejemplo: el analista escribe sus lecturas.
  const [raw, setRaw] = useState("");
  const [saved, setSaved] = useState<any>(null);
  const [error, setError] = useState("");
  // Búsqueda en el servidor (antes se cargaban las 100 primeras muestras y 200 analitos).
  const [buscaMuestra, setBuscaMuestra] = useState("");
  const [buscaAnalito, setBuscaAnalito] = useState("");
  // Corrección de un resultado devuelto (?corregir=<id>): se recalcula en el mismo registro.
  const [corrigiendo, setCorrigiendo] = useState<any | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const eq = await fetch(`${API}/equipos?limit=200`, { headers: auth() }).then((x) => x.json());
        setEquipos(eq.data ?? []);
        const id = new URLSearchParams(window.location.search).get("corregir");
        if (id) {
          const r = await llamar("GET", `/resultados/${id}`);
          setCorrigiendo(r);
          setMuestras(r?.muestra ? [r.muestra] : []);
          setAnalitos(r?.analito ? [r.analito] : []);
          setMuestraId(r?.muestraId ?? "");
          setAnalitoId(r?.analitoId ?? "");
          setEquipoId(r?.equipoId ?? "");
          setRaw((Array.isArray(r?.replicas) ? r.replicas : []).map((x: number) => String(x).replace(".", ",")).join(" "));
        }
      } catch (e: any) { setError(e.message); }
    })();
  }, []);

  useEffect(() => {
    if (corrigiendo) return;
    const t = setTimeout(() => {
      llamar("GET", `/muestras?limit=30${buscaMuestra.trim() ? `&search=${encodeURIComponent(buscaMuestra.trim())}` : ""}`)
        .then((m) => setMuestras(m.data ?? []))
        .catch((e) => setError(e.message));
    }, buscaMuestra ? 300 : 0);
    return () => clearTimeout(t);
  }, [buscaMuestra, corrigiendo]);

  useEffect(() => {
    if (corrigiendo) return;
    const t = setTimeout(() => {
      llamar("GET", `/analitos?limit=50${buscaAnalito.trim() ? `&search=${encodeURIComponent(buscaAnalito.trim())}` : ""}`)
        .then((a) => setAnalitos(a.data ?? []))
        .catch((e) => setError(e.message));
    }, buscaAnalito ? 300 : 0);
    return () => clearTimeout(t);
  }, [buscaAnalito, corrigiendo]);

  // Coma decimal chilena: «12,4» es UNA lectura. Separan: espacio, «;» o «, ».
  const lectura = useMemo(() => leerReplicas(raw), [raw]);
  const replicas = lectura.valores;
  const st = useMemo(() => stats(replicas), [replicas]);

  // Analito seleccionado y su fórmula (RF-A06). La fórmula NO se evalúa aquí:
  // el motor vive en la API (apps/api/src/common/formula.ts) y es el servidor
  // quien la aplica al guardar. Duplicar el evaluador en el navegador daría dos
  // implementaciones que pueden divergir — y el valor que vale es el que se
  // persiste, no el que se pinta.
  const analito = useMemo(() => analitos.find((a) => a.id === analitoId), [analitos, analitoId]);
  const formula: string = (analito?.formula ?? "").trim();

  // Equipo seleccionado (RF-D04.2). La API marca cada equipo con `apto` /
  // `calibracion_vencida` / `estado`; con ellos se avisa ANTES de guardar de que
  // el equipo no puede usarse. El BLOQUEO real lo hace el servidor (409 al
  // capturar): esto es sólo el aviso preventivo, la fuente de verdad es la API.
  const equipo = useMemo(() => equipos.find((e) => e.id === equipoId), [equipos, equipoId]);
  const motivoNoApto = (e: any): string | null => {
    if (!e) return null;
    if (e.estado === "en_calibracion") return "en calibración";
    if (e.estado === "fuera_servicio") return "fuera de servicio";
    if (e.estado !== "operativo") return `no operativo (${e.estado})`;
    if (!e.proxima_calibracion) return "sin calibración registrada";
    if (e.calibracion_vencida) return `calibración vencida (${fecha(e.proxima_calibracion)})`;
    return null;
  };
  const equipoLabel = (e: any) => {
    const m = motivoNoApto(e);
    return `${e.codigo} · ${e.nombre}${m ? `  ⚠ ${m}` : ""}`;
  };

  async function guardar() {
    setError(""); setSaved(null);
    if (!muestraId || !analitoId) { setError("Seleccione la muestra y el analito."); return; }
    if (lectura.invalidos.length) { setError(`No se entiende como número: ${lectura.invalidos.map((t) => `«${t}»`).join(", ")}. Use coma o punto decimal y separe las réplicas con espacio o punto y coma.`); return; }
    if (!replicas.length) { setError("Ingrese al menos una réplica."); return; }
    try {
      const cuerpo = { replicasTexto: raw, ...(equipoId ? { equipoId } : {}) };
      const r = corrigiendo
        ? await llamar("POST", `/resultados/${corrigiendo.id}/recapturar`, cuerpo)
        : await llamar("POST", "/resultados", { muestraId, analitoId, ...cuerpo });
      setSaved(r);
      if (corrigiendo) setCorrigiendo({ ...corrigiendo, ...r });
    } catch (e: any) { setError(e.message); }
  }

  const num = (x: any, d = 3) => Number(x ?? 0).toLocaleString("es-CL", { maximumFractionDigits: d });

  return (
    <div>
      <h1 className="page">Captura de resultados</h1>
      <p className="subtitle">Réplicas RN1..RNn → promedio, desviación estándar y CV → fórmula del analito (si tiene) → veredicto contra el límite del producto. El resultado nace en estado «capturado» y pasa por revisión y aprobación. Los ensayos de una OT se capturan en <Link href={"/captura-ot" as any} style={{ color: "var(--accent)" }}>Captura y revisión por OT</Link>.</p>
      {error && <div className="alert warn">{error}</div>}
      {corrigiendo && (
        <div className="alert warn">
          Corrigiendo un resultado <b>{ESTADO[corrigiendo.estado]?.texto ?? corrigiendo.estado}</b>
          {corrigiendo.motivoDevolucion ? <> · motivo: <b>{corrigiendo.motivoDevolucion}</b></> : null}.
          Al guardar se recalcula en el mismo registro y vuelve a revisión.
        </div>
      )}

      <div className="card">
        <h2>Datos del ensayo</h2>
        <div className="form-grid cols-2">
          {!corrigiendo && (
            <>
              <div className="field">
                <label>Buscar muestra</label>
                <input value={buscaMuestra} onChange={(e) => setBuscaMuestra(e.target.value)} placeholder="Código, nombre o código de barras" />
              </div>
              <div className="field">
                <label>Buscar analito</label>
                <input value={buscaAnalito} onChange={(e) => setBuscaAnalito(e.target.value)} placeholder="Código o nombre" />
              </div>
            </>
          )}
          <div className="field">
            <label>Muestra</label>
            <select value={muestraId} disabled={!!corrigiendo} onChange={(e) => setMuestraId(e.target.value)}>
              <option value="">— seleccionar —</option>
              {muestras.map((m) => <option key={m.id} value={m.id}>{m.codigo} · {m.nombre ?? ""}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Analito {analitos.length === 0 && <span style={{ textTransform: "none", color: "var(--muted)", fontStyle: "italic" }}>(sin analitos cargados)</span>}</label>
            <select value={analitoId} disabled={!!corrigiendo} onChange={(e) => setAnalitoId(e.target.value)}>
              <option value="">— seleccionar —</option>
              {analitos.map((a) => <option key={a.id} value={a.id}>{a.codigo} · {a.nombre} {a.unidad ? `(${a.unidad})` : ""}</option>)}
            </select>
          </div>
          <div className="field span-2">
            <label>Equipo <span style={{ textTransform: "none", color: "var(--muted)", fontStyle: "italic" }}>(opcional · ISO 17025 RF-D04.2)</span></label>
            <select value={equipoId} onChange={(e) => setEquipoId(e.target.value)}>
              <option value="">— sin equipo —</option>
              {equipos.map((e) => <option key={e.id} value={e.id}>{equipoLabel(e)}</option>)}
            </select>
            {equipo && motivoNoApto(equipo) ? (
              <span style={{ marginTop: 6, display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span className="pill red">No apto</span>
                <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
                  Equipo {motivoNoApto(equipo)}. El servidor bloqueará la captura con este equipo (ISO/IEC 17025): recalíbrelo o elija otro.
                </span>
              </span>
            ) : equipo ? (
              <span style={{ marginTop: 6, display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span className="pill green">Apto</span>
                {equipo.proxima_calibracion && (
                  <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Calibración vigente hasta {fecha(equipo.proxima_calibracion)}.</span>
                )}
              </span>
            ) : (
              <span style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4, display: "block" }}>
                Sin equipo asociado. Informe un equipo para registrar con qué instrumento se ejecutó el ensayo; los descalibrados o fuera de servicio se bloquean al guardar.
              </span>
            )}
          </div>
          <div className="field span-2">
            <label>Réplicas (separadas por espacio o punto y coma · coma decimal: 12,4)</label>
            <input style={{ fontFamily: "'JetBrains Mono', monospace" }} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="12,4  12,6  12,5" />
            {lectura.invalidos.length > 0 && (
              <span style={{ fontSize: 11.5, color: "var(--red)", marginTop: 4 }}>
                No se entiende como número: {lectura.invalidos.map((t) => `«${t}»`).join(", ")}. Escriba 12,4 o 12.4 y separe las réplicas con espacio.
              </span>
            )}
          </div>
          {analitoId && (
            <div className="field span-2">
              <label>Fórmula del analito</label>
              {formula ? (
                <>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5, background: "#f6f9fc", border: "1px solid var(--line)", borderRadius: 7, padding: "8px 10px", wordBreak: "break-word" }}>
                    {formula}
                  </div>
                  <span style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, display: "block" }}>
                    Se evalúa en el servidor al guardar, con las réplicas (RN1..RN{st.n || "n"}), PROMEDIO, DE, CV y N.
                    El valor que devuelve sustituye al promedio como valor del ensayo para el veredicto.
                  </span>
                </>
              ) : (
                <span style={{ fontSize: 12, color: "var(--muted)", fontStyle: "italic" }}>
                  Este analito no tiene fórmula: el valor del ensayo es el promedio de las réplicas.
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="kpis">
        <div className="kpi k-blue"><div className="lab">n réplicas</div><div className="val">{st.n}</div></div>
        <div className="kpi"><div className="lab">Promedio</div><div className="val">{num(st.promedio)}</div></div>
        <div className="kpi k-violet"><div className="lab">Desv. estándar</div><div className="val">{num(st.desviacion)}</div></div>
        <div className="kpi k-amber"><div className="lab">CV %</div><div className="val">{num(st.cv, 2)}</div></div>
        {formula && (
          <div className="kpi k-green">
            <div className="lab">Valor final (fórmula)</div>
            <div className="val">{saved?.resultadoFinal != null ? num(saved.resultadoFinal) : "—"}</div>
            <div className="delta">{saved?.resultadoFinal != null ? "calculado por el servidor" : "se calcula al guardar"}</div>
          </div>
        )}
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button onClick={guardar} className="btn primary sm">{corrigiendo ? "Guardar corrección" : "Guardar resultado"}</button>
        </div>
      </div>

      {saved && (
        <div className="card">
          <h2>Resultado persistido</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", fontSize: 12.5 }}>
            <span>Promedio: <b>{num(saved.promedio)}</b> {saved.unidad}</span>
            {saved.resultadoFinal != null && (
              <span>Valor final (fórmula): <b>{num(saved.resultadoFinal)}</b> {saved.unidad}</span>
            )}
            <span>DE: <b>{num(saved.desviacion)}</b></span>
            <span>CV: <b>{num(saved.cv, 2)}%</b></span>
            <span className={`pill ${veredictoInfo(saved.veredicto).pill}`}>{veredictoInfo(saved.veredicto).texto}</span>
            <span className={`pill ${ESTADO[saved.estado]?.pill ?? "gray"}`}>{ESTADO[saved.estado]?.texto ?? saved.estado}</span>
            {saved.equipoId && (
              <span>Equipo: <b>{equipos.find((e) => e.id === saved.equipoId)?.codigo ?? saved.equipoId}</b></span>
            )}
          </div>
          {saved.formulaAplicada && (
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>
              Fórmula aplicada: <code style={{ fontFamily: "'JetBrains Mono', monospace" }}>{saved.formulaAplicada}</code>
              {" · "}se guarda con el resultado para que siga siendo reproducible aunque el catálogo cambie.
            </div>
          )}
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
            El resultado queda en <b>capturado</b>. Debe revisarlo y aprobarlo otro usuario:
            quien captura no puede revisar ni aprobar su propio resultado (ISO/IEC 17025).
          </div>
        </div>
      )}
    </div>
  );
}
