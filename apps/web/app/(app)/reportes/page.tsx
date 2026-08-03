"use client";

// ===========================================================================
// Reportes · KPIs (contrato §4.5.3) + Exportador CSV con filtros (§4.6.6/§4.6.7).
// Solo lectura: consume /api/reportes/* (agrega datos existentes). Los gráficos
// son SVG a mano (barras), sin librerías externas.
// ===========================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { clp, num, pct, fecha } from "@/lib/format";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const auth = () => ({
  Authorization: `Bearer ${localStorage.getItem("lims_token")}`,
  "Content-Type": "application/json",
});

type Tab = "productividad" | "conformidad" | "plazos" | "comercial" | "exportador";

const TABS: { key: Tab; label: string }[] = [
  { key: "productividad", label: "Productividad" },
  { key: "conformidad", label: "Conformidad" },
  { key: "plazos", label: "Plazos" },
  { key: "comercial", label: "Comercial" },
  { key: "exportador", label: "Exportador CSV" },
];

async function getJson(path: string): Promise<any> {
  const res = await fetch(`${API}${path}`, { headers: auth() });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `Error ${res.status}`);
  return res.json();
}

export default function ReportesPage() {
  const [tab, setTab] = useState<Tab>("productividad");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");

  const rango = useMemo(() => {
    const p = new URLSearchParams();
    if (desde) p.set("desde", desde);
    if (hasta) p.set("hasta", hasta);
    const s = p.toString();
    return s ? `?${s}` : "";
  }, [desde, hasta]);

  return (
    <div>
      <h1 className="page">Reportes e indicadores</h1>
      <p className="subtitle">
        Indicadores de gestión (KPIs, §4.5.3) y exportación de datos a CSV con filtros (§4.6.6 / §4.6.7).
        Todos los reportes son de solo lectura y respetan el rango de fechas seleccionado.
      </p>

      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Desde</label>
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Hasta</label>
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </div>
          {(desde || hasta) && (
            <button className="btn sm" onClick={() => { setDesde(""); setHasta(""); }}>Limpiar fechas</button>
          )}
        </div>
      </div>

      <div className="tabs" style={{ marginBottom: 14 }}>
        {TABS.map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "productividad" && <Productividad rango={rango} />}
      {tab === "conformidad" && <Conformidad rango={rango} />}
      {tab === "plazos" && <Plazos rango={rango} />}
      {tab === "comercial" && <Comercial rango={rango} />}
      {tab === "exportador" && <Exportador desde={desde} hasta={hasta} />}
    </div>
  );
}

// --- hook común de carga por rango -----------------------------------------

function useReporte(path: string, rango: string) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const cargar = useCallback(() => {
    setLoading(true);
    setError("");
    getJson(`${path}${rango}`)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [path, rango]);

  useEffect(() => { cargar(); }, [cargar]);
  return { data, error, loading };
}

function Estado({ error, loading }: { error: string; loading: boolean }) {
  if (loading) return <div className="card" style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>Cargando…</div>;
  if (error) return <div className="alert warn">{error}</div>;
  return null;
}

// --- gráfico de barras SVG a mano ------------------------------------------

function Barras({ items }: { items: { label: string; value: number; color?: string }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const rowH = 26;
  const w = 520;
  const labelW = 150;
  const barW = w - labelW - 60;
  const h = items.length * rowH + 6;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ maxWidth: w }} role="img">
      {items.map((it, idx) => {
        const y = idx * rowH + 3;
        const bw = Math.round((it.value / max) * barW);
        return (
          <g key={idx}>
            <text x={0} y={y + 15} fontSize={11.5} fill="var(--muted)">{it.label.slice(0, 22)}</text>
            <rect x={labelW} y={y + 4} width={Math.max(bw, 1)} height={14} rx={3} fill={it.color ?? "var(--accent)"} />
            <text x={labelW + Math.max(bw, 1) + 6} y={y + 15} fontSize={11} fill="var(--ink)">{num(it.value)}</text>
          </g>
        );
      })}
    </svg>
  );
}

// --- Productividad ----------------------------------------------------------

function Productividad({ rango }: { rango: string }) {
  const { data, error, loading } = useReporte("/reportes/productividad", rango);
  if (loading || error) return <Estado error={error} loading={loading} />;

  return (
    <div>
      <div className="kpis">
        <div className="kpi k-blue"><div className="lab">Órdenes de trabajo</div><div className="val">{num(data.totales.ordenesTrabajo)}</div></div>
        <div className="kpi k-green"><div className="lab">Muestras</div><div className="val">{num(data.totales.muestras)}</div></div>
        <div className="kpi k-violet"><div className="lab">Certificados</div><div className="val">{num(data.totales.certificados)}</div></div>
        <div className="kpi k-amber"><div className="lab">Certificados emitidos</div><div className="val">{num(data.totales.certificadosEmitidos)}</div></div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <h2>OT por estado</h2>
        {data.otPorEstado.length ? (
          <Barras items={data.otPorEstado.map((r: any) => ({ label: r.estado, value: Number(r.total) }))} />
        ) : <p className="subtitle">Sin datos en el rango.</p>}
      </div>

      <div className="card">
        <h2>OT por mes</h2>
        {data.otPorMes.length ? (
          <Barras items={data.otPorMes.map((r: any) => ({ label: r.mes, value: Number(r.total), color: "var(--primary)" }))} />
        ) : <p className="subtitle">Sin datos en el rango.</p>}
      </div>
    </div>
  );
}

// --- Conformidad ------------------------------------------------------------

function Conformidad({ rango }: { rango: string }) {
  const { data, error, loading } = useReporte("/reportes/conformidad", rango);
  if (loading || error) return <Estado error={error} loading={loading} />;

  const g = data.global;
  return (
    <div>
      <div className="kpis">
        <div className="kpi k-blue"><div className="lab">Resultados</div><div className="val">{num(g.total)}</div></div>
        <div className="kpi k-green"><div className="lab">Tasa de cumplimiento</div><div className="val">{g.tasaCumplimiento == null ? "—" : pct(g.tasaCumplimiento, 1)}</div></div>
        <div className="kpi k-red"><div className="lab">No cumple</div><div className="val">{num(g.no_cumple)}</div></div>
        <div className="kpi k-amber"><div className="lab">Pendientes</div><div className="val">{num(g.pendiente)}</div></div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <h2>Global</h2>
        <Barras items={[
          { label: "Cumple", value: Number(g.cumple), color: "#2e9e5b" },
          { label: "No cumple", value: Number(g.no_cumple), color: "#c0392b" },
          { label: "Pendiente", value: Number(g.pendiente), color: "#d9a012" },
        ]} />
      </div>

      <TablaConformidad titulo="Por método" filas={data.porMetodo} keyCod="metodo_codigo" keyNom="metodo_nombre" />
      <TablaConformidad titulo="Por ensayo" filas={data.porEnsayo} keyCod="ensayo_codigo" keyNom="ensayo_nombre" />
    </div>
  );
}

function TablaConformidad({ titulo, filas, keyCod, keyNom }: { titulo: string; filas: any[]; keyCod: string; keyNom: string }) {
  return (
    <div className="card card--table" style={{ marginBottom: 12 }}>
      <h2 style={{ padding: "0 4px" }}>{titulo}</h2>
      <table className="data">
        <thead>
          <tr>
            <th>Código</th><th>Nombre</th>
            <th className="num">Total</th><th className="num">Cumple</th>
            <th className="num">No cumple</th><th className="num">Pendiente</th>
            <th className="num">Tasa cumpl.</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((r: any, i: number) => (
            <tr key={i}>
              <td className="codigo">{r[keyCod] ?? "—"}</td>
              <td>{r[keyNom] ?? "—"}</td>
              <td className="num">{num(r.total)}</td>
              <td className="num">{num(r.cumple)}</td>
              <td className="num">{num(r.no_cumple)}</td>
              <td className="num">{num(r.pendiente)}</td>
              <td className="num">{r.tasaCumplimiento == null ? "—" : pct(r.tasaCumplimiento, 1)}</td>
            </tr>
          ))}
          {filas.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--muted)", padding: 16 }}>Sin datos en el rango.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// --- Plazos -----------------------------------------------------------------

function Plazos({ rango }: { rango: string }) {
  const { data, error, loading } = useReporte("/reportes/plazos", rango);
  if (loading || error) return <Estado error={error} loading={loading} />;

  const r = data.resumen;
  return (
    <div>
      <div className="kpis">
        <div className="kpi k-blue"><div className="lab">OT cerradas</div><div className="val">{num(r.otCerradas)}</div></div>
        <div className="kpi k-green"><div className="lab">Días promedio</div><div className="val">{r.diasPromedio == null ? "—" : num(r.diasPromedio, 1)}</div></div>
        <div className="kpi k-violet"><div className="lab">Con compromiso</div><div className="val">{num(r.conCompromiso)}</div></div>
        <div className="kpi k-amber"><div className="lab">% dentro de plazo</div><div className="val">{r.pctDentroPlazo == null ? "—" : pct(r.pctDentroPlazo, 1)}</div></div>
      </div>

      <div className="card card--table">
        <h2 style={{ padding: "0 4px" }}>Detalle por OT (últimas 200 cerradas)</h2>
        <table className="data">
          <thead>
            <tr>
              <th>Código</th><th>Estado</th><th>Recepción</th><th>Cierre</th>
              <th>Compromiso</th><th className="num">Días</th><th>Plazo</th>
            </tr>
          </thead>
          <tbody>
            {data.detalle.map((d: any, i: number) => (
              <tr key={i}>
                <td className="codigo">{d.codigo}</td>
                <td>{d.estado}</td>
                <td>{fecha(d.fecha_recepcion)}</td>
                <td>{fecha(d.fecha_cierre)}</td>
                <td>{d.fecha_compromiso ? fecha(d.fecha_compromiso) : "—"}</td>
                <td className="num">{d.dias == null ? "—" : num(d.dias, 1)}</td>
                <td>
                  {d.dentro_plazo == null ? <span className="pill gray">s/compromiso</span>
                    : d.dentro_plazo ? <span className="pill green">En plazo</span>
                    : <span className="pill red">Atrasada</span>}
                </td>
              </tr>
            ))}
            {data.detalle.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--muted)", padding: 16 }}>Sin OT cerradas en el rango.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Comercial --------------------------------------------------------------

function Comercial({ rango }: { rango: string }) {
  const { data, error, loading } = useReporte("/reportes/comercial", rango);
  if (loading || error) return <Estado error={error} loading={loading} />;

  const t = data.totales;
  return (
    <div>
      <div className="kpis">
        <div className="kpi k-blue"><div className="lab">Cotizaciones</div><div className="val">{num(t.cantidad)}</div></div>
        <div className="kpi k-green"><div className="lab">Monto total</div><div className="val">{clp(t.monto)}</div></div>
        <div className="kpi k-violet"><div className="lab">Aceptadas</div><div className="val">{num(t.aceptadas)}</div></div>
        <div className="kpi k-amber"><div className="lab">Tasa de aceptación</div><div className="val">{t.tasaAceptacion == null ? "—" : pct(t.tasaAceptacion, 1)}</div></div>
      </div>

      <div className="card card--table" style={{ marginBottom: 12 }}>
        <h2 style={{ padding: "0 4px" }}>Por estado</h2>
        <table className="data">
          <thead><tr><th>Estado</th><th className="num">Cantidad</th><th className="num">Monto</th></tr></thead>
          <tbody>
            {data.porEstado.map((r: any, i: number) => (
              <tr key={i}><td>{r.estado}</td><td className="num">{num(r.total)}</td><td className="num">{clp(r.monto)}</td></tr>
            ))}
            {data.porEstado.length === 0 && <tr><td colSpan={3} style={{ textAlign: "center", color: "var(--muted)", padding: 16 }}>Sin datos en el rango.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Cotizaciones por mes</h2>
        {data.porMes.length ? (
          <Barras items={data.porMes.map((r: any) => ({ label: r.mes, value: Number(r.total), color: "var(--primary)" }))} />
        ) : <p className="subtitle">Sin datos en el rango.</p>}
      </div>
    </div>
  );
}

// --- Exportador (configurador de tabla -> CSV) ------------------------------

const ENTIDADES_UI: { key: string; label: string }[] = [
  { key: "ot", label: "Órdenes de trabajo" },
  { key: "muestra", label: "Muestras" },
  { key: "resultado", label: "Resultados" },
  { key: "cotizacion", label: "Cotizaciones" },
  { key: "certificado", label: "Certificados" },
];

function Exportador({ desde, hasta }: { desde: string; hasta: string }) {
  const [entidades, setEntidades] = useState<Record<string, { campos: string[] }>>({});
  const [entidad, setEntidad] = useState("ot");
  const [seleccion, setSeleccion] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getJson("/reportes/entidades").then(setEntidades).catch((e) => setError(e.message));
  }, []);

  const campos = entidades[entidad]?.campos ?? [];

  // Al cambiar de entidad, se seleccionan todas las columnas por defecto.
  useEffect(() => {
    if (!campos.length) return;
    setSeleccion(Object.fromEntries(campos.map((c) => [c, true])));
    setPreview(null);
  }, [entidad, entidades]); // eslint-disable-line react-hooks/exhaustive-deps

  const seleccionadas = campos.filter((c) => seleccion[c]);

  const queryBase = useCallback((formato: "csv" | "json") => {
    const p = new URLSearchParams();
    p.set("entidad", entidad);
    if (seleccionadas.length) p.set("campos", seleccionadas.join(","));
    if (desde) p.set("desde", desde);
    if (hasta) p.set("hasta", hasta);
    p.set("formato", formato);
    return p.toString();
  }, [entidad, seleccionadas, desde, hasta]);

  async function previsualizar() {
    setError("");
    setLoading(true);
    try {
      const p = new URLSearchParams(queryBase("json"));
      p.set("limit", "25");
      setPreview(await getJson(`/reportes/tabla?${p.toString()}`));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function descargar() {
    setError("");
    if (!seleccionadas.length) { setError("Selecciona al menos una columna."); return; }
    try {
      const res = await fetch(`${API}/reportes/tabla?${queryBase("csv")}`, { headers: auth() });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `Error ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `reporte_${entidad}_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div>
      {error && <div className="alert warn">{error}</div>}

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="field" style={{ maxWidth: 320 }}>
          <label>Entidad a exportar</label>
          <select value={entidad} onChange={(e) => setEntidad(e.target.value)}>
            {ENTIDADES_UI.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
          </select>
        </div>

        <div style={{ marginTop: 12 }}>
          <label style={{ fontWeight: 600, fontSize: 12.5 }}>Columnas ({seleccionadas.length}/{campos.length})</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", marginTop: 8 }}>
            {campos.map((c) => (
              <label key={c} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
                <input
                  type="checkbox"
                  checked={!!seleccion[c]}
                  onChange={(e) => setSeleccion({ ...seleccion, [c]: e.target.checked })}
                  style={{ width: "auto" }}
                />
                {c}
              </label>
            ))}
          </div>
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <button className="btn sm" type="button" onClick={() => setSeleccion(Object.fromEntries(campos.map((c) => [c, true])))}>Todas</button>
            <button className="btn sm" type="button" onClick={() => setSeleccion({})}>Ninguna</button>
          </div>
        </div>

        <div style={{ marginTop: 14, display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn sm" onClick={previsualizar} disabled={loading}>Previsualizar</button>
          <button className="btn primary sm" onClick={descargar}>⬇ Descargar CSV</button>
          <span className="subtitle" style={{ margin: 0 }}>
            {desde || hasta ? `Filtro: ${desde || "…"} → ${hasta || "…"}` : "Sin filtro de fechas"}
          </span>
        </div>
      </div>

      {loading && <div className="card" style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>Cargando…</div>}

      {preview && (
        <div className="card card--table">
          <h2 style={{ padding: "0 4px" }}>Vista previa · {preview.meta.total} fila(s) (máx. 25 mostradas)</h2>
          <table className="data">
            <thead>
              <tr>{preview.campos.map((c: string) => <th key={c}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {preview.data.map((row: any, i: number) => (
                <tr key={i}>{preview.campos.map((c: string) => <td key={c}>{formatoCelda(row[c])}</td>)}</tr>
              ))}
              {preview.data.length === 0 && (
                <tr><td colSpan={preview.campos.length || 1} style={{ textAlign: "center", color: "var(--muted)", padding: 16 }}>Sin filas en el rango.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatoCelda(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return fecha(v);
  return String(v);
}
