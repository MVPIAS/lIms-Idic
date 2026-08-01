"use client";

/**
 * SPC · Control Estadístico de Procesos · LIMS IDIC (contrato 4.2.2 / 4.3.6)
 *
 * Pantalla de SOLO LECTURA que agrega los resultados históricos numéricos de un
 * analito/método (tabla `resultado.valor_numerico`, materializada por el puente
 * del catálogo v2) y los presenta como:
 *   · Gráfico de control X̄ (Shewhart): media (LC) ± 3σ (LSC/LIC), puntos fuera
 *     de control en rojo.
 *   · Gráfico de amplitud (R): rango móvil entre puntos consecutivos + su límite.
 *   · Histograma de la distribución de valores en bins.
 *   · Tarjetas con media, σ, n y Cp/Cpk (si el histórico arrastra especificación).
 *
 * Contrato backend (apps/api/src/spc/spc.module.ts):
 *   GET /api/spc/analitos  -> [{ catAnalitoId, catMetodoId, n, codigo, nombre, unidad, metodo }]
 *   GET /api/spc/series?catAnalitoId&catMetodoId&desde&hasta -> { puntos[], estadisticos }
 *
 * Charts en SVG puro (sin dependencias externas): seguro para el CSP estricto y
 * el despliegue on-premise sin internet. NO enlazada en Sidebar.tsx (lo integra
 * el coordinador); se llega por /spc.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { fecha as fmtFecha, num } from "@/lib/format";
import { errorMensaje } from "@/lib/apiError";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const auth = () => ({
  Authorization: `Bearer ${localStorage.getItem("lims_token")}`,
  "Content-Type": "application/json",
});

type AnalitoOpt = {
  catAnalitoId: string;
  catMetodoId: string | null;
  n: number;
  codigo: string;
  nombre: string;
  unidad: string | null;
  metodo: { id: string; codigo: string; nombre: string } | null;
};

type Punto = {
  fecha: string;
  valor: number;
  otCodigo?: string | null;
  muestraCodigo?: string | null;
};

type Estadisticos = {
  n: number;
  media: number | null;
  desviacion: number | null;
  min: number | null;
  max: number | null;
  lc: number | null;
  lsc: number | null;
  lic: number | null;
  rangoMovilMedio: number | null;
  lscR: number | null;
  licR: number | null;
  sigmaEstimadaR: number | null;
  fueraDeControl: number[];
  especInf: number | null;
  especSup: number | null;
  cp: number | null;
  cpk: number | null;
};

type Serie = {
  catAnalitoId: string;
  catMetodoId: string | null;
  analito: { id: string; codigo: string; nombre: string; unidad: string | null } | null;
  metodo: { id: string; codigo: string; nombre: string } | null;
  puntos: Punto[];
  estadisticos: Estadisticos;
};

/** Clave estable para un par analito/método en el selector. */
const claveOpt = (o: AnalitoOpt) => `${o.catAnalitoId}::${o.catMetodoId ?? ""}`;

/** Formatea un número (o "—") con hasta 3 decimales, convención es-CL. */
const n3 = (v: number | null | undefined) => (v == null ? "—" : num(v, 3));

/* =========================== Gráfico de control genérico =========================== */

type LineaLimite = { y: number; label: string; color: string; dash?: boolean };

/**
 * Dibuja una carta de control genérica (sirve para X̄ y para R): serie de puntos
 * unidos por una línea, con líneas horizontales de límite (LC/LSC/LIC) y puntos
 * marcados en rojo cuando `fuera` incluye su índice. Todo en SVG puro.
 */
function CartaControl({
  valores,
  lineas,
  fuera,
  etiqueta,
  yLabel,
  colorPunto = "#2563eb",
}: {
  valores: number[];
  lineas: LineaLimite[];
  fuera: Set<number>;
  etiqueta: (i: number) => string;
  yLabel: string;
  colorPunto?: string;
}) {
  const W = 760;
  const H = 300;
  const M = { top: 16, right: 90, bottom: 46, left: 56 };
  const iw = W - M.left - M.right;
  const ih = H - M.top - M.bottom;

  const ys = [...valores, ...lineas.map((l) => l.y)];
  let yMin = Math.min(...ys);
  let yMax = Math.max(...ys);
  if (!isFinite(yMin) || !isFinite(yMax)) {
    yMin = 0;
    yMax = 1;
  }
  if (yMin === yMax) {
    yMin -= 1;
    yMax += 1;
  }
  const pad = (yMax - yMin) * 0.08;
  yMin -= pad;
  yMax += pad;

  const n = valores.length;
  const x = (i: number) => M.left + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => M.top + ih - ((v - yMin) / (yMax - yMin)) * ih;

  const path = valores.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");

  // Ticks del eje X: como mucho ~8 etiquetas para no saturar.
  const paso = Math.max(1, Math.ceil(n / 8));
  const ticks: number[] = [];
  for (let i = 0; i < n; i += paso) ticks.push(i);
  if (n > 0 && ticks[ticks.length - 1] !== n - 1) ticks.push(n - 1);

  return (
    <div style={{ width: "100%", overflowX: "auto" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ maxWidth: W, minWidth: 480, display: "block" }}
        role="img"
        aria-label={`Carta de control ${yLabel}`}
      >
        {/* marco */}
        <rect x={M.left} y={M.top} width={iw} height={ih} fill="var(--card, #fff)" stroke="#e2e8f0" />
        {/* eje Y: 4 gridlines */}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const val = yMax - f * (yMax - yMin);
          const yy = M.top + f * ih;
          return (
            <g key={f}>
              <line x1={M.left} y1={yy} x2={M.left + iw} y2={yy} stroke="#f1f5f9" />
              <text x={M.left - 8} y={yy + 4} textAnchor="end" fontSize="11" fill="#64748b">
                {num(val, 2)}
              </text>
            </g>
          );
        })}
        {/* líneas de límite */}
        {lineas.map((l, k) => {
          const yy = y(l.y);
          if (!isFinite(yy)) return null;
          return (
            <g key={k}>
              <line
                x1={M.left}
                y1={yy}
                x2={M.left + iw}
                y2={yy}
                stroke={l.color}
                strokeWidth={1.5}
                strokeDasharray={l.dash ? "5 4" : undefined}
              />
              <text x={M.left + iw + 6} y={yy + 4} fontSize="11" fill={l.color} fontWeight={600}>
                {l.label}
              </text>
            </g>
          );
        })}
        {/* serie */}
        {n > 1 && <path d={path} fill="none" stroke={colorPunto} strokeWidth={1.5} opacity={0.7} />}
        {valores.map((v, i) => {
          const bad = fuera.has(i);
          return (
            <circle
              key={i}
              cx={x(i)}
              cy={y(v)}
              r={bad ? 5 : 3.5}
              fill={bad ? "#dc2626" : colorPunto}
              stroke="#fff"
              strokeWidth={1}
            >
              <title>{`${etiqueta(i)}: ${num(v, 3)}${bad ? " · FUERA DE CONTROL" : ""}`}</title>
            </circle>
          );
        })}
        {/* eje X */}
        {ticks.map((i) => (
          <text
            key={i}
            x={x(i)}
            y={H - M.bottom + 16}
            textAnchor="middle"
            fontSize="10"
            fill="#64748b"
            transform={`rotate(-30 ${x(i)} ${H - M.bottom + 16})`}
          >
            {etiqueta(i)}
          </text>
        ))}
        <text x={M.left} y={H - 6} fontSize="11" fill="#94a3b8">
          n = {n}
        </text>
        <text
          x={14}
          y={M.top + ih / 2}
          fontSize="11"
          fill="#94a3b8"
          textAnchor="middle"
          transform={`rotate(-90 14 ${M.top + ih / 2})`}
        >
          {yLabel}
        </text>
      </svg>
    </div>
  );
}

/* =============================== Histograma =============================== */

function Histograma({ valores, media, lsc, lic }: { valores: number[]; media: number | null; lsc: number | null; lic: number | null }) {
  const W = 760;
  const H = 260;
  const M = { top: 16, right: 20, bottom: 42, left: 48 };
  const iw = W - M.left - M.right;
  const ih = H - M.top - M.bottom;

  const { bins, edges } = useMemo(() => {
    if (valores.length === 0) return { bins: [] as number[], edges: [] as number[] };
    const lo = Math.min(...valores);
    const hi = Math.max(...valores);
    const k = Math.max(1, Math.min(12, Math.ceil(Math.sqrt(valores.length))));
    if (lo === hi) return { bins: [valores.length], edges: [lo, lo + 1] };
    const w = (hi - lo) / k;
    const b = new Array(k).fill(0);
    for (const v of valores) {
      let idx = Math.floor((v - lo) / w);
      if (idx >= k) idx = k - 1;
      if (idx < 0) idx = 0;
      b[idx]++;
    }
    const e = new Array(k + 1).fill(0).map((_, i) => lo + i * w);
    return { bins: b, edges: e };
  }, [valores]);

  if (bins.length === 0) return <p className="subtitle">Sin datos.</p>;

  const maxCount = Math.max(...bins, 1);
  const lo = edges[0];
  const hi = edges[edges.length - 1];
  const bw = iw / bins.length;
  const xVal = (v: number) => M.left + ((v - lo) / (hi - lo)) * iw;

  return (
    <div style={{ width: "100%", overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, minWidth: 480, display: "block" }} role="img" aria-label="Histograma de valores">
        <rect x={M.left} y={M.top} width={iw} height={ih} fill="var(--card, #fff)" stroke="#e2e8f0" />
        {[0, 0.5, 1].map((f) => {
          const yy = M.top + f * ih;
          const c = Math.round(maxCount - f * maxCount);
          return (
            <g key={f}>
              <line x1={M.left} y1={yy} x2={M.left + iw} y2={yy} stroke="#f1f5f9" />
              <text x={M.left - 6} y={yy + 4} textAnchor="end" fontSize="11" fill="#64748b">
                {c}
              </text>
            </g>
          );
        })}
        {bins.map((c, i) => {
          const h = (c / maxCount) * ih;
          return (
            <rect
              key={i}
              x={M.left + i * bw + 1}
              y={M.top + ih - h}
              width={Math.max(1, bw - 2)}
              height={h}
              fill="#2563eb"
              opacity={0.75}
            >
              <title>{`[${num(edges[i], 2)}, ${num(edges[i + 1], 2)}): ${c}`}</title>
            </rect>
          );
        })}
        {/* líneas de referencia media / límites */}
        {[
          { v: media, color: "#16a34a", label: "μ" },
          { v: lsc, color: "#dc2626", label: "LSC" },
          { v: lic, color: "#dc2626", label: "LIC" },
        ].map((r, k) =>
          r.v != null && r.v >= lo && r.v <= hi ? (
            <g key={k}>
              <line x1={xVal(r.v)} y1={M.top} x2={xVal(r.v)} y2={M.top + ih} stroke={r.color} strokeWidth={1.5} strokeDasharray="4 3" />
              <text x={xVal(r.v)} y={M.top - 4} fontSize="10" fill={r.color} textAnchor="middle" fontWeight={600}>
                {r.label}
              </text>
            </g>
          ) : null,
        )}
        {/* eje X: extremos + centro */}
        {[0, Math.floor(bins.length / 2), bins.length].map((i) => {
          const vx = M.left + i * bw;
          return (
            <text key={i} x={vx} y={H - M.bottom + 16} textAnchor="middle" fontSize="10" fill="#64748b">
              {num(edges[i] ?? hi, 2)}
            </text>
          );
        })}
        <text x={M.left} y={H - 6} fontSize="11" fill="#94a3b8">
          Distribución de valores (bins)
        </text>
      </svg>
    </div>
  );
}

/* =============================== Página =============================== */

export default function SpcPage() {
  const [opciones, setOpciones] = useState<AnalitoOpt[]>([]);
  const [clave, setClave] = useState<string>("");
  const [serie, setSerie] = useState<Serie | null>(null);
  const [cargandoOpts, setCargandoOpts] = useState(true);
  const [cargandoSerie, setCargandoSerie] = useState(false);
  const [error, setError] = useState<string>("");

  // Carga inicial del selector.
  useEffect(() => {
    (async () => {
      setCargandoOpts(true);
      setError("");
      try {
        const res = await fetch(`${API}/spc/analitos`, { headers: auth() });
        if (!res.ok) throw new Error(await errorMensaje(res));
        const data: AnalitoOpt[] = await res.json();
        setOpciones(data);
        if (data.length > 0) setClave(claveOpt(data[0]));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setCargandoOpts(false);
      }
    })();
  }, []);

  const opt = useMemo(() => opciones.find((o) => claveOpt(o) === clave) ?? null, [opciones, clave]);

  // Carga de la serie al cambiar la selección.
  const cargarSerie = useCallback(async (o: AnalitoOpt | null) => {
    if (!o) {
      setSerie(null);
      return;
    }
    setCargandoSerie(true);
    setError("");
    try {
      const p = new URLSearchParams({ catAnalitoId: o.catAnalitoId });
      if (o.catMetodoId) p.set("catMetodoId", o.catMetodoId);
      const res = await fetch(`${API}/spc/series?${p.toString()}`, { headers: auth() });
      if (!res.ok) throw new Error(await errorMensaje(res));
      const data: Serie = await res.json();
      setSerie(data);
    } catch (e) {
      setError((e as Error).message);
      setSerie(null);
    } finally {
      setCargandoSerie(false);
    }
  }, []);

  useEffect(() => {
    cargarSerie(opt);
  }, [opt, cargarSerie]);

  const st = serie?.estadisticos;
  const valores = useMemo(() => serie?.puntos.map((p) => p.valor) ?? [], [serie]);
  const rangos = useMemo(() => {
    const r: number[] = [];
    for (let i = 1; i < valores.length; i++) r.push(Math.abs(valores[i] - valores[i - 1]));
    return r;
  }, [valores]);
  const fuera = useMemo(() => new Set(st?.fueraDeControl ?? []), [st]);
  const etiquetaX = useCallback(
    (i: number) => {
      const p = serie?.puntos[i];
      return p ? fmtFecha(p.fecha) : String(i + 1);
    },
    [serie],
  );
  const unidad = serie?.analito?.unidad ?? opt?.unidad ?? "";

  return (
    <div>
      <h1 className="page">Control Estadístico de Procesos (SPC)</h1>
      <p className="subtitle">
        Cartas de control X̄ (Shewhart), amplitud (R) e histograma sobre los resultados históricos de un analito/método.
        Vista de solo lectura sobre datos ya capturados (contrato 4.2.2 / 4.3.6).
      </p>

      {error && <div className="alert error">{error}</div>}

      <div className="card">
        <div className="form-grid">
          <label>
            <span className="lab">Analito / método</span>
            {cargandoOpts ? (
              <div className="subtitle">Cargando analitos…</div>
            ) : opciones.length === 0 ? (
              <div className="subtitle">No hay analitos con suficientes resultados numéricos todavía.</div>
            ) : (
              <select value={clave} onChange={(e) => setClave(e.target.value)}>
                {opciones.map((o) => (
                  <option key={claveOpt(o)} value={claveOpt(o)}>
                    {o.codigo} · {o.nombre}
                    {o.metodo ? ` — ${o.metodo.codigo}` : ""} ({o.n})
                  </option>
                ))}
              </select>
            )}
          </label>
        </div>
      </div>

      {cargandoSerie && <p className="subtitle">Calculando estadísticos…</p>}

      {serie && st && (
        <>
          {/* Tarjetas KPI */}
          <div className="kpis">
            <div className="kpi">
              <div className="lab">n (muestras)</div>
              <div className="val">{st.n}</div>
            </div>
            <div className="kpi k-blue">
              <div className="lab">Media (LC)</div>
              <div className="val">{n3(st.media)}</div>
            </div>
            <div className="kpi k-amber">
              <div className="lab">σ (n−1)</div>
              <div className="val">{n3(st.desviacion)}</div>
            </div>
            <div className="kpi k-green">
              <div className="lab">Rango móvil medio</div>
              <div className="val">{n3(st.rangoMovilMedio)}</div>
            </div>
            <div className={`kpi ${st.cp != null && st.cp < 1 ? "k-red" : "k-violet"}`}>
              <div className="lab">Cp</div>
              <div className="val">{st.cp == null ? "—" : num(st.cp, 2)}</div>
            </div>
            <div className={`kpi ${st.cpk != null && st.cpk < 1 ? "k-red" : "k-violet"}`}>
              <div className="lab">Cpk</div>
              <div className="val">{st.cpk == null ? "—" : num(st.cpk, 2)}</div>
            </div>
          </div>

          <p className="subtitle" style={{ marginTop: 4 }}>
            {unidad ? `Unidad: ${unidad}. ` : ""}
            LSC = {n3(st.lsc)} · LIC = {n3(st.lic)}
            {st.especInf != null || st.especSup != null
              ? ` · Especificación: ${st.especInf != null ? n3(st.especInf) : "—"} … ${st.especSup != null ? n3(st.especSup) : "—"}`
              : " · Sin especificación (Cp/Cpk no disponibles)"}
            {fuera.size > 0 ? ` · ${fuera.size} punto(s) fuera de control` : ""}
          </p>

          {/* Carta X̄ */}
          <div className="card">
            <h2>Gráfico de control X̄ (Shewhart)</h2>
            <p className="subtitle">
              Cada punto es un resultado en el tiempo. Línea central (LC) = media; LSC/LIC = media ± 3σ. Puntos fuera de control en rojo.
            </p>
            {valores.length > 0 ? (
              <CartaControl
                valores={valores}
                fuera={fuera}
                etiqueta={etiquetaX}
                yLabel={`Valor${unidad ? ` (${unidad})` : ""}`}
                lineas={[
                  ...(st.lc != null ? [{ y: st.lc, label: "LC", color: "#16a34a" }] : []),
                  ...(st.lsc != null ? [{ y: st.lsc, label: "LSC", color: "#dc2626", dash: true }] : []),
                  ...(st.lic != null ? [{ y: st.lic, label: "LIC", color: "#dc2626", dash: true }] : []),
                  ...(st.especSup != null ? [{ y: st.especSup, label: "LSE", color: "#9333ea", dash: true }] : []),
                  ...(st.especInf != null ? [{ y: st.especInf, label: "LIE", color: "#9333ea", dash: true }] : []),
                ]}
              />
            ) : (
              <p className="subtitle">Sin resultados numéricos.</p>
            )}
          </div>

          {/* Carta R */}
          <div className="card">
            <h2>Gráfico de amplitud (R · rango móvil)</h2>
            <p className="subtitle">
              Rango móvil |xi − xi−1| entre resultados consecutivos. Línea central = rango móvil medio; LSC = D4·MR̄ (n=2, D4 = 3,267).
            </p>
            {rangos.length > 0 ? (
              <CartaControl
                valores={rangos}
                fuera={new Set()}
                etiqueta={(i) => etiquetaX(i + 1)}
                yLabel="Rango móvil"
                colorPunto="#0891b2"
                lineas={[
                  ...(st.rangoMovilMedio != null ? [{ y: st.rangoMovilMedio, label: "MR̄", color: "#16a34a" }] : []),
                  ...(st.lscR != null ? [{ y: st.lscR, label: "LSC", color: "#dc2626", dash: true }] : []),
                  ...(st.licR != null ? [{ y: st.licR, label: "LIC", color: "#dc2626", dash: true }] : []),
                ]}
              />
            ) : (
              <p className="subtitle">Se necesitan ≥ 2 resultados para el rango móvil.</p>
            )}
          </div>

          {/* Histograma */}
          <div className="card">
            <h2>Histograma</h2>
            <p className="subtitle">Distribución de los valores en bins (regla √n). Líneas: media (μ) y límites de control.</p>
            <Histograma valores={valores} media={st.media} lsc={st.lsc} lic={st.lic} />
          </div>
        </>
      )}
    </div>
  );
}
