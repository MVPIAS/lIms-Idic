"use client";

/**
 * Reportes › Tendencias (contrato §4.5.7): consulta en tiempo real (la foto
 * «ahora», que se refresca sola cada minuto) e histórica por mes y laboratorio,
 * con la media móvil de 3 meses y la recta de tendencia de cada serie, y el
 * sentido (sube / baja / estable) y el aviso de mes atípico que calcula la API
 * (/reportes/tendencias, reportes/tendencias.ts). Gráficos SVG a mano.
 */
import { useCallback, useEffect, useState } from "react";
import { num } from "@/lib/format";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("lims_token")}` });

interface Serie {
  valores: (number | null)[];
  pendiente: number | null;
  cambioPct: number | null;
  sentido: "sube" | "baja" | "estable" | "sin_datos";
  mediaMovil: (number | null)[];
  atipico: boolean;
}
interface Bloque {
  ot: Serie;
  muestras: Serie;
  pctNoCumple: Serie;
  diasRespuesta: Serie;
  evaluados: number[];
  cerradas: number[];
}

/** Qué serie se grafica y si subir es bueno o malo (para el color del sentido). */
const SERIES: { clave: "ot" | "muestras" | "pctNoCumple" | "diasRespuesta"; titulo: string; unidad: string; subirEsMalo: boolean }[] = [
  { clave: "ot", titulo: "OT ingresadas por mes", unidad: "OT", subirEsMalo: false },
  { clave: "muestras", titulo: "Muestras registradas por mes", unidad: "muestras", subirEsMalo: false },
  { clave: "pctNoCumple", titulo: "% No cumple de los resultados evaluados", unidad: "%", subirEsMalo: true },
  { clave: "diasRespuesta", titulo: "Días de respuesta de las OT cerradas (promedio)", unidad: "días", subirEsMalo: true },
];

const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const etiquetaMes = (m: string) => `${MES[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;

export default function Tendencias({ rango }: { rango: string }) {
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState("");
  const [lab, setLab] = useState("");

  const cargar = useCallback(() => {
    setError("");
    fetch(`${API}/reportes/tendencias${rango}`, { headers: auth() })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? `Error ${r.status}`);
        return r.json();
      })
      .then(setD)
      .catch((e) => setError(e.message));
  }, [rango]);

  useEffect(() => {
    setD(null);
    cargar();
    // Tiempo real: la foto «ahora» y el mes en curso se refrescan cada minuto.
    const t = setInterval(cargar, 60_000);
    return () => clearInterval(t);
  }, [cargar]);

  if (error) return <div className="alert warn">{error}</div>;
  if (!d) return <div className="card" style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>Cargando…</div>;

  const elegido = d.laboratorios.find((l: any) => l.id === lab);
  const bloque: Bloque = elegido ?? d.total;

  return (
    <div>
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
          <h2 style={{ margin: 0 }}>Ahora</h2>
          <span className="subtitle" style={{ margin: 0 }}>
            Actualizado {d.generado} · se refresca cada minuto{" "}
            <button className="btn sm" onClick={cargar}>Actualizar</button>
          </span>
        </div>
        <div className="kpis" style={{ marginTop: 10, marginBottom: 0 }}>
          <div className="kpi k-blue"><div className="lab">OT abiertas</div><div className="val">{num(d.ahora.otAbiertas)}</div></div>
          <div className="kpi k-red"><div className="lab">OT vencidas</div><div className="val">{num(d.ahora.otVencidas)}</div></div>
          <div className="kpi k-green"><div className="lab">OT ingresadas hoy</div><div className="val">{num(d.ahora.otIngresadasHoy)}</div></div>
          <div className="kpi k-amber"><div className="lab">Resultados por revisar</div><div className="val">{num(d.ahora.resultadosPorRevisar)}</div></div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="field" style={{ margin: 0, minWidth: 260 }}>
            <label>Laboratorio</label>
            <select value={lab} onChange={(e) => setLab(e.target.value)}>
              <option value="">Todos los de mi alcance</option>
              {d.laboratorios.map((l: any) => (
                <option key={l.id} value={l.id}>{l.codigo} · {l.nombre}</option>
              ))}
            </select>
          </div>
          <p className="subtitle" style={{ margin: 0 }}>
            Histórico de {etiquetaMes(d.meses[0])} a {etiquetaMes(d.meses[d.meses.length - 1])} (hora de Chile). Sin fechas: últimos 12 meses.
            La línea punteada es la media móvil de 3 meses; la gris, la tendencia (mínimos cuadrados). Si el periodo llega a hoy, el último mes está en curso.
          </p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 12, marginBottom: 12 }}>
        {SERIES.map((s) => (
          <div key={s.clave} className="card">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
              <h2 style={{ margin: 0, fontSize: 15 }}>{s.titulo}</h2>
              <Sentido serie={bloque[s.clave]} subirEsMalo={s.subirEsMalo} />
            </div>
            <Linea meses={d.meses} serie={bloque[s.clave]} unidad={s.unidad} />
            {bloque[s.clave].atipico && (
              <p className="subtitle" style={{ margin: "4px 0 0", color: "var(--warn, #b7791f)" }}>
                El último mes se sale de lo habitual (más de 2 desviaciones de la media de los meses anteriores).
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Comparación por laboratorio</h2>
        <div style={{ overflowX: "auto" }}>
          <table className="data">
            <thead>
              <tr>
                <th>Laboratorio</th>
                <th className="num">OT</th>
                <th>Tendencia OT</th>
                <th className="num">% No cumple</th>
                <th>Tendencia % No cumple</th>
                <th className="num">Días de respuesta</th>
                <th>Tendencia días</th>
              </tr>
            </thead>
            <tbody>
              {d.laboratorios.map((l: any) => {
                const totOt = l.ot.valores.reduce((a: number, b: number | null) => a + (b ?? 0), 0);
                const ev = l.evaluados.reduce((a: number, b: number) => a + b, 0);
                const nc = l.pctNoCumple.valores.reduce((a: number, b: number | null, i: number) => a + ((b ?? 0) * l.evaluados[i]) / 100, 0);
                const ce = l.cerradas.reduce((a: number, b: number) => a + b, 0);
                const di = l.diasRespuesta.valores.reduce((a: number, b: number | null, i: number) => a + (b ?? 0) * l.cerradas[i], 0);
                return (
                  <tr key={l.id}>
                    <td><b>{l.codigo}</b> {l.nombre}</td>
                    <td className="num">{num(totOt)}</td>
                    <td><Sentido serie={l.ot} subirEsMalo={false} /></td>
                    <td className="num">{ev ? `${num((nc / ev) * 100, 1)} %` : "—"}</td>
                    <td><Sentido serie={l.pctNoCumple} subirEsMalo /></td>
                    <td className="num">{ce ? num(di / ce, 1) : "—"}</td>
                    <td><Sentido serie={l.diasRespuesta} subirEsMalo /></td>
                  </tr>
                );
              })}
              {!d.laboratorios.length && (
                <tr><td colSpan={7} className="subtitle">Sin datos en el periodo.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** Chip con el sentido de la tendencia: verde si va bien, rojo si va mal, gris si estable. */
function Sentido({ serie, subirEsMalo }: { serie: Serie; subirEsMalo: boolean }) {
  if (serie.sentido === "sin_datos") return <span className="pill" style={{ background: "var(--bg-soft, #eef1f4)", color: "var(--muted)" }}>Pocos datos</span>;
  if (serie.sentido === "estable") return <span className="pill" style={{ background: "var(--bg-soft, #eef1f4)", color: "var(--ink)" }}>→ Estable</span>;
  const malo = (serie.sentido === "sube") === subirEsMalo;
  const flecha = serie.sentido === "sube" ? "↗ Sube" : "↘ Baja";
  return (
    <span
      className="pill"
      title={`Pendiente ${num(serie.pendiente ?? 0, 2)} por mes`}
      style={{ background: malo ? "#fde8e6" : "#e3f4ea", color: malo ? "#a1271b" : "#1d6b3e" }}
    >
      {flecha}{serie.cambioPct != null ? ` ${num(Math.abs(serie.cambioPct), 0)} %` : ""}
    </span>
  );
}

/** Línea mensual con media móvil (punteada) y recta de tendencia (gris). */
function Linea({ meses, serie, unidad }: { meses: string[]; serie: Serie; unidad: string }) {
  const W = 520;
  const H = 180;
  const ml = 40;
  const mr = 10;
  const mt = 10;
  const mb = 28;
  const vals = serie.valores.filter((v): v is number => v != null);
  if (!vals.length) return <p className="subtitle">Sin datos en el periodo.</p>;
  const max = Math.max(...vals, ...serie.mediaMovil.filter((v): v is number => v != null), 1);
  const techo = max <= 5 ? Math.ceil(max) : Math.ceil(max / 5) * 5;
  const n = meses.length;
  const x = (i: number) => ml + (n === 1 ? (W - ml - mr) / 2 : (i * (W - ml - mr)) / (n - 1));
  const y = (v: number) => mt + (H - mt - mb) * (1 - v / techo);
  const tramos = (vs: (number | null)[]) => {
    const t: string[] = [];
    let actual = "";
    vs.forEach((v, i) => {
      if (v == null) {
        if (actual) t.push(actual);
        actual = "";
      } else actual += `${actual ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    });
    if (actual) t.push(actual);
    return t;
  };
  // Recta de tendencia: misma regresión que la API, sobre los puntos con dato.
  const pts = serie.valores.map((v, i) => ({ i, v })).filter((p): p is { i: number; v: number } => p.v != null);
  let recta: string | null = null;
  if (serie.pendiente != null && pts.length >= 3) {
    const mx = pts.reduce((s, p) => s + p.i, 0) / pts.length;
    const my = pts.reduce((s, p) => s + p.v, 0) / pts.length;
    const a = my - serie.pendiente * mx;
    const i0 = pts[0].i;
    const i1 = pts[pts.length - 1].i;
    const lim = (v: number) => Math.min(Math.max(v, 0), techo);
    recta = `M${x(i0)},${y(lim(a + serie.pendiente * i0))}L${x(i1)},${y(lim(a + serie.pendiente * i1))}`;
  }
  const paso = Math.max(1, Math.ceil(n / 8));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label={`Serie mensual en ${unidad}`}>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={ml} x2={W - mr} y1={y(techo * f)} y2={y(techo * f)} stroke="var(--line, #dfe3e8)" strokeWidth={1} />
          <text x={ml - 6} y={y(techo * f) + 4} textAnchor="end" fontSize={10} fill="var(--muted, #6b7280)">{num(techo * f, techo * f % 1 ? 1 : 0)}</text>
        </g>
      ))}
      {meses.map((m, i) =>
        (i % paso === 0 && n - 1 - i >= paso) || i === n - 1 ? (
          <text key={m} x={x(i)} y={H - 8} textAnchor={n > 1 && i === n - 1 ? "end" : i === 0 && n > 1 ? "start" : "middle"} fontSize={10} fill="var(--muted, #6b7280)">{etiquetaMes(m)}</text>
        ) : null,
      )}
      {recta && <path d={recta} stroke="var(--muted, #9aa3ad)" strokeWidth={1.5} fill="none" />}
      {tramos(serie.mediaMovil).map((p, k) => (
        <path key={`mm${k}`} d={p} stroke="var(--primary, #1f5f8b)" strokeOpacity={0.55} strokeDasharray="4 3" strokeWidth={1.5} fill="none" />
      ))}
      {tramos(serie.valores).map((p, k) => (
        <path key={`v${k}`} d={p} stroke="var(--primary, #1f5f8b)" strokeWidth={2} fill="none" />
      ))}
      {serie.valores.map((v, i) =>
        v == null ? null : (
          <circle key={i} cx={x(i)} cy={y(v)} r={i === n - 1 ? 4 : 2.5} fill={i === n - 1 && serie.atipico ? "#c0392b" : "var(--primary, #1f5f8b)"}>
            <title>{`${etiquetaMes(meses[i])}: ${num(v, v % 1 ? 1 : 0)} ${unidad}`}</title>
          </circle>
        ),
      )}
    </svg>
  );
}
