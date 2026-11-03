"use client";

// ===========================================================================
// Reportes · KPIs (contrato §4.5.3) + Exportador a Excel/CSV con filtros,
// resumen dinámico, gráfico y plantillas guardadas (§4.6.6/§4.6.7).
// Solo lectura: consume /api/reportes/* (agrega datos existentes). Los gráficos
// son SVG a mano (barras), sin librerías externas.
// ===========================================================================

import Gestion from "./_components/Gestion";
import Tendencias from "./_components/Tendencias";
import { useCallback, useEffect, useMemo, useState } from "react";
import { clp, num, pct, fecha } from "@/lib/format";
import { usePermisos } from "@/lib/permisos";
import { hoyChile, sumarDiasCalendario } from "@/lib/fecha-chile";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const auth = () => ({
  Authorization: `Bearer ${localStorage.getItem("lims_token")}`,
  "Content-Type": "application/json",
});

type Tab = "gestion" | "tendencias" | "productividad" | "conformidad" | "plazos" | "comercial" | "exportador";

/** Cada pestaña con el permiso que exige su API (/reportes/*). */
const TABS: { key: Tab; label: string; perm: string }[] = [
  { key: "gestion", label: "Gestión", perm: "reporte.ver" },
  { key: "tendencias", label: "Tendencias", perm: "reporte.ver" },
  { key: "productividad", label: "Productividad", perm: "reporte.ver" },
  { key: "conformidad", label: "Conformidad", perm: "reporte.ver" },
  { key: "plazos", label: "Plazos", perm: "reporte.ver" },
  { key: "comercial", label: "Comercial", perm: "reporte.comercial.ver" },
  { key: "exportador", label: "Exportar a Excel", perm: "reporte.ver" },
];

async function getJson(path: string): Promise<any> {
  const res = await fetch(`${API}${path}`, { headers: auth() });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `Error ${res.status}`);
  return res.json();
}

export default function ReportesPage() {
  const { puede, listo, unidadGlobal } = usePermisos();
  // Solo las pestañas que el perfil puede ver; abre en la primera permitida.
  const tabs = useMemo(() => (listo ? TABS.filter((t) => puede(t.perm)) : []), [listo, puede]);
  const [tabElegida, setTab] = useState<Tab | null>(null);
  const tab: Tab | null = tabs.some((t) => t.key === tabElegida) ? tabElegida : tabs[0]?.key ?? null;
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
        Indicadores de gestión (KPIs, §4.5.3), tendencias en tiempo real e históricas (§4.5.7) y exportación de datos a CSV con filtros (§4.6.6 / §4.6.7).
        Todos los reportes son de solo lectura y respetan el rango de fechas seleccionado.
        {listo && !unidadGlobal && " Las cifras corresponden a los laboratorios de su alcance."}
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
        {tabs.map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {listo && !tabs.length && <div className="alert warn">Su perfil no tiene acceso a ningún reporte.</div>}
      {tab === "gestion" && <Gestion rango={rango} />}
      {tab === "tendencias" && <Tendencias rango={rango} />}
      {tab === "productividad" && <Productividad rango={rango} />}
      {tab === "conformidad" && <Conformidad rango={rango} />}
      {tab === "plazos" && <Plazos rango={rango} />}
      {tab === "comercial" && <Comercial rango={rango} />}
      {tab === "exportador" && <Exportador desde={desde} hasta={hasta} setDesde={setDesde} setHasta={setHasta} />}
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

// --- Exportador (configurador de tabla -> Excel / CSV, §4.6.6 y §4.6.7) ------
// Columnas y filtros a elección, resumen dinámico (filas × columnas con conteo,
// suma, promedio, mínimo o máximo) con gráfico nativo de Excel, y plantillas de
// exportación guardadas para repetir el mismo reporte.

// El servidor ya entrega solo las entidades que el perfil puede exportar.
interface EntidadInfo { campos: string[]; etiquetas?: Record<string, string>; etiqueta: string; permiso: string | null; limite?: number }
interface Resumen { filas: string; columnas: string; valor: string; agregado: string; grafico: string }
interface PlantillaExport {
  id: string;
  nombre: string;
  descripcion: string | null;
  entidad: string;
  campos: string[];
  filtros: { desde?: string; hasta?: string; ultimosDias?: number };
  resumen: Partial<Resumen> | null;
  compartida: boolean;
  creadoPor: string | null;
  propia: boolean;
  /** Puede actualizarla o eliminarla: quien la creó o Administración (misma regla que el servidor). */
  editable: boolean;
}
const RESUMEN_VACIO: Resumen = { filas: "", columnas: "", valor: "", agregado: "conteo", grafico: "columna" };
const AGREGADOS_UI = [
  { v: "conteo", t: "Cantidad de registros" },
  { v: "suma", t: "Suma" },
  { v: "promedio", t: "Promedio" },
  { v: "minimo", t: "Mínimo" },
  { v: "maximo", t: "Máximo" },
];
const GRAFICOS_UI = [
  { v: "columna", t: "Columnas" },
  { v: "barra", t: "Barras horizontales" },
  { v: "linea", t: "Líneas" },
  { v: "torta", t: "Torta" },
  { v: "ninguno", t: "Sin gráfico" },
];

const restarDias = (n: number): string => sumarDiasCalendario(hoyChile(), -n);
const miles = (n: number) => n.toLocaleString("es-CL");
/** Aviso cuando el resultado supera el tope de filas de una descarga. */
const avisoTope = (total: number, limite: number) =>
  `Se exportan las primeras ${miles(limite)} de ${miles(total)} filas (las más recientes); acote los filtros para obtener el resto.`;

function Exportador({ desde, hasta, setDesde, setHasta }: { desde: string; hasta: string; setDesde: (v: string) => void; setHasta: (v: string) => void }) {
  const { puede } = usePermisos();
  const [entidades, setEntidades] = useState<Record<string, EntidadInfo>>({});
  const [entidad, setEntidad] = useState("ot");
  const [seleccion, setSeleccion] = useState<Record<string, boolean>>({});
  const [resumen, setResumen] = useState<Resumen>(RESUMEN_VACIO);
  const [titulo, setTitulo] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [plantillas, setPlantillas] = useState<PlantillaExport[]>([]);
  const [plantillaId, setPlantillaId] = useState("");
  // Al cargar una plantilla, sus columnas se aplican después de cambiar de entidad.
  const [pendiente, setPendiente] = useState<PlantillaExport | null>(null);
  // Privada por defecto: solo la ve quien la crea, salvo que marque «Compartir con todos».
  const [compartir, setCompartir] = useState(false);
  const [aviso, setAviso] = useState("");

  const cargarPlantillas = useCallback(() => getJson("/reportes/plantillas").then(setPlantillas).catch(() => setPlantillas([])), []);
  useEffect(() => {
    getJson("/reportes/entidades").then(setEntidades).catch((e) => setError(e.message));
    cargarPlantillas();
  }, [cargarPlantillas]);

  const visibles = Object.entries(entidades).filter(([, e]) => !e.permiso || puede(e.permiso));
  const campos = entidades[entidad]?.campos ?? [];
  const limite = entidades[entidad]?.limite ?? 10000;
  const et = (c: string) => entidades[entidad]?.etiquetas?.[c] ?? c;

  // Si la entidad elegida no está entre las que el perfil puede exportar, toma la primera.
  useEffect(() => {
    if (visibles.length && !visibles.some(([k]) => k === entidad)) setEntidad(visibles[0][0]);
  }, [entidades]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!campos.length) return;
    if (pendiente && pendiente.entidad === entidad) {
      setSeleccion(Object.fromEntries(campos.map((c) => [c, pendiente.campos.includes(c)])));
      setResumen({ ...RESUMEN_VACIO, ...(pendiente.resumen ?? {}), columnas: pendiente.resumen?.columnas ?? "", valor: pendiente.resumen?.valor ?? "" } as Resumen);
      setPendiente(null);
    } else if (!pendiente) {
      setSeleccion(Object.fromEntries(campos.map((c) => [c, true])));
      setResumen(RESUMEN_VACIO);
    }
    setPreview(null);
    setAviso("");
  }, [entidad, entidades]); // eslint-disable-line react-hooks/exhaustive-deps

  const seleccionadas = campos.filter((c) => seleccion[c]);
  const resumenActivo = !!resumen.filas;

  const queryBase = useCallback(
    (formato: "csv" | "json" | "xlsx") => {
      const p = new URLSearchParams();
      p.set("entidad", entidad);
      if (seleccionadas.length) p.set("campos", seleccionadas.join(","));
      if (desde) p.set("desde", desde);
      if (hasta) p.set("hasta", hasta);
      p.set("formato", formato);
      if (formato === "xlsx" && resumen.filas) {
        p.set("resumenFilas", resumen.filas);
        if (resumen.columnas) p.set("resumenColumnas", resumen.columnas);
        if (resumen.valor && resumen.agregado !== "conteo") p.set("resumenValor", resumen.valor);
        p.set("resumenAgregado", resumen.agregado);
        p.set("grafico", resumen.grafico);
        if (titulo.trim()) p.set("titulo", titulo.trim());
      }
      return p.toString();
    },
    [entidad, seleccionadas, desde, hasta, resumen, titulo],
  );

  async function previsualizar() {
    setError("");
    setAviso("");
    if (!seleccionadas.length) { setError("Selecciona al menos una columna."); return; }
    setLoading(true);
    try {
      const p = new URLSearchParams(queryBase("json"));
      p.set("limit", "25");
      const r = await getJson(`/reportes/tabla?${p.toString()}`);
      setPreview(r);
      if (r?.meta?.total > limite) setAviso(avisoTope(r.meta.total, limite));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function descargar(formato: "csv" | "xlsx") {
    setError("");
    if (!seleccionadas.length) { setError("Selecciona al menos una columna."); return; }
    if (formato === "xlsx" && resumenActivo && resumen.agregado !== "conteo" && !resumen.valor) { setError("Elige el campo de valor del resumen."); return; }
    setAviso("");
    try {
      // Antes de descargar: cuántas filas cumplen los filtros (la descarga se corta en el tope).
      const c = new URLSearchParams(queryBase("json"));
      c.set("limit", "1");
      const total: number = (await getJson(`/reportes/tabla?${c.toString()}`))?.meta?.total ?? 0;
      if (total > limite && !confirm(`El resultado tiene ${miles(total)} filas y una descarga trae como máximo ${miles(limite)} (las más recientes). ¿Descargar igualmente las primeras ${miles(limite)}?`)) {
        setAviso(avisoTope(total, limite));
        return;
      }
      const res = await fetch(`${API}/reportes/tabla?${queryBase(formato)}`, { headers: auth() });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `Error ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const base = plantillas.find((x) => x.id === plantillaId)?.nombre.replace(/[^\p{L}\p{N} _-]/gu, "_") || `reporte_${entidad}`;
      a.download = `${base}_${hoyChile()}.${formato}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      if (total > limite) setAviso(avisoTope(total, limite));
    } catch (e: any) {
      setError(e.message);
    }
  }

  function aplicarPlantilla(id: string) {
    setPlantillaId(id);
    const p = plantillas.find((x) => x.id === id);
    if (!p) return;
    const f = p.filtros ?? {};
    if (f.ultimosDias) {
      setDesde(restarDias(f.ultimosDias));
      setHasta(hoyChile());
    } else {
      setDesde(f.desde ?? "");
      setHasta(f.hasta ?? "");
    }
    setTitulo(p.nombre);
    setCompartir(!!p.compartida);
    if (p.entidad === entidad) {
      setSeleccion(Object.fromEntries(campos.map((c) => [c, p.campos.includes(c)])));
      setResumen({ ...RESUMEN_VACIO, ...(p.resumen ?? {}), columnas: p.resumen?.columnas ?? "", valor: p.resumen?.valor ?? "" } as Resumen);
      setPreview(null);
    } else {
      setPendiente(p);
      setEntidad(p.entidad);
    }
  }

  async function guardarPlantilla(comoNueva: boolean) {
    const actual = plantillas.find((x) => x.id === plantillaId);
    const nombre = comoNueva || !actual ? prompt("Nombre de la plantilla de exportación:", titulo || "") : actual.nombre;
    if (!nombre?.trim()) return;
    const diasTxt = prompt("Rango de fechas: deja vacío para guardar el rango actual, o escribe N para «últimos N días» al usarla.", actual?.filtros?.ultimosDias ? String(actual.filtros.ultimosDias) : "");
    if (diasTxt === null) return;
    // «abc» o «x» no es un número: antes se guardaba como «Sin rango de fechas» sin avisar.
    const dias = diasTxt.trim();
    if (dias && !(/^\d+$/.test(dias) && Number(dias) >= 1 && Number(dias) <= 3660)) {
      setError("«Últimos días» debe ser un entero entre 1 y 3660.");
      return;
    }
    const filtros = dias ? { ultimosDias: Number(dias) } : { ...(desde ? { desde } : {}), ...(hasta ? { hasta } : {}) };
    const cuerpo = {
      nombre: nombre.trim(),
      entidad,
      campos: seleccionadas,
      filtros,
      resumen: resumen.filas ? { filas: resumen.filas, columnas: resumen.columnas || undefined, valor: resumen.agregado !== "conteo" ? resumen.valor || undefined : undefined, agregado: resumen.agregado, grafico: resumen.grafico } : null,
      compartida: compartir,
    };
    try {
      const r = await fetch(`${API}/reportes/plantillas${!comoNueva && actual ? `/${actual.id}` : ""}`, { method: !comoNueva && actual ? "PATCH" : "POST", headers: auth(), body: JSON.stringify(cuerpo) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(Array.isArray(j.message) ? j.message.join(", ") : j.message ?? `Error ${r.status}`);
      await cargarPlantillas();
      setPlantillaId(j.id);
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function borrarPlantilla() {
    const p = plantillas.find((x) => x.id === plantillaId);
    if (!p || !confirm(`¿Eliminar la plantilla «${p.nombre}»?`)) return;
    const r = await fetch(`${API}/reportes/plantillas/${p.id}`, { method: "DELETE", headers: auth() });
    if (!r.ok) return setError((await r.json().catch(() => ({}))).message ?? `Error ${r.status}`);
    setPlantillaId("");
    cargarPlantillas();
  }

  const plantillaSel = plantillas.find((x) => x.id === plantillaId);
  const opcionCampo = (vacio: string) => [<option key="" value="">{vacio}</option>, ...seleccionadas.map((c) => <option key={c} value={c}>{et(c)}</option>)];

  return (
    <div>
      {error && <div className="alert warn">{error}</div>}
      {aviso && <div className="alert warn" role="status">{aviso}</div>}

      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="field" style={{ margin: 0, minWidth: 260 }}>
            <label htmlFor="ex-plantilla">Plantilla de exportación</label>
            <select id="ex-plantilla" value={plantillaId} onChange={(e) => (e.target.value ? aplicarPlantilla(e.target.value) : (setPlantillaId(""), setCompartir(false)))}>
              <option value="">(sin plantilla · configurar a mano)</option>
              {plantillas.map((p) => <option key={p.id} value={p.id}>{p.nombre}{p.propia ? "" : p.creadoPor ? ` · de ${p.creadoPor}` : ""}{p.compartida ? "" : " · privada"}</option>)}
            </select>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }} title="Sin marcar, la plantilla solo la ve usted">
            <input type="checkbox" checked={compartir} onChange={(e) => setCompartir(e.target.checked)} style={{ width: "auto" }} />
            Compartir con todos
          </label>
          <button type="button" className="btn sm" onClick={() => guardarPlantilla(true)}>Guardar como plantilla nueva</button>
          {plantillaSel?.editable && (
            <>
              <button type="button" className="btn sm" onClick={() => guardarPlantilla(false)}>Actualizar «{plantillaSel.nombre}»</button>
              <button type="button" className="btn ghost sm" onClick={borrarPlantilla}>Eliminar plantilla</button>
            </>
          )}
        </div>
        {plantillaSel && (
          <p className="subtitle" style={{ margin: "6px 0 0" }}>
            {plantillaSel.compartida ? "Compartida con todos · " : "Privada (solo la ve quien la creó) · "}
            {plantillaSel.descripcion ? `${plantillaSel.descripcion} · ` : ""}
            {plantillaSel.filtros?.ultimosDias ? `Rango: últimos ${plantillaSel.filtros.ultimosDias} días` : plantillaSel.filtros?.desde || plantillaSel.filtros?.hasta ? `Rango fijo: ${plantillaSel.filtros.desde ?? "…"} → ${plantillaSel.filtros.hasta ?? "…"}` : "Sin rango de fechas"}
          </p>
        )}
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="field" style={{ maxWidth: 320 }}>
          <label htmlFor="ex-entidad">Qué exportar</label>
          <select id="ex-entidad" value={entidad} onChange={(e) => { setPlantillaId(""); setEntidad(e.target.value); }}>
            {visibles.map(([k, e]) => <option key={k} value={k}>{e.etiqueta}</option>)}
          </select>
        </div>

        <div style={{ marginTop: 12 }}>
          <label style={{ fontWeight: 600, fontSize: 12.5 }}>Columnas ({seleccionadas.length}/{campos.length})</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", marginTop: 8 }}>
            {campos.map((c) => (
              <label key={c} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
                <input type="checkbox" checked={!!seleccion[c]} onChange={(e) => setSeleccion({ ...seleccion, [c]: e.target.checked })} style={{ width: "auto" }} />
                {et(c)}
              </label>
            ))}
          </div>
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <button className="btn sm" type="button" onClick={() => setSeleccion(Object.fromEntries(campos.map((c) => [c, true])))}>Todas</button>
            <button className="btn sm" type="button" onClick={() => setSeleccion({})}>Ninguna</button>
          </div>
        </div>

        <fieldset style={{ marginTop: 14, border: "1px solid var(--line)", borderRadius: 8, padding: "8px 12px" }}>
          <legend style={{ fontSize: 12.5, fontWeight: 600, padding: "0 4px" }}>Resumen dinámico y gráfico (solo Excel)</legend>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="ex-rf">Agrupar filas por</label>
              <select id="ex-rf" value={resumen.filas} onChange={(e) => setResumen({ ...resumen, filas: e.target.value })}>{opcionCampo("(sin resumen)")}</select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="ex-rc">Columnas por (opcional)</label>
              <select id="ex-rc" value={resumen.columnas} disabled={!resumenActivo} onChange={(e) => setResumen({ ...resumen, columnas: e.target.value })}>{opcionCampo("(ninguna)")}</select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="ex-ra">Calcular</label>
              <select id="ex-ra" value={resumen.agregado} disabled={!resumenActivo} onChange={(e) => setResumen({ ...resumen, agregado: e.target.value })}>
                {AGREGADOS_UI.map((a) => <option key={a.v} value={a.v}>{a.t}</option>)}
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="ex-rv">Del campo</label>
              <select id="ex-rv" value={resumen.valor} disabled={!resumenActivo || resumen.agregado === "conteo"} onChange={(e) => setResumen({ ...resumen, valor: e.target.value })}>{opcionCampo("(elegir)")}</select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="ex-rg">Gráfico</label>
              <select id="ex-rg" value={resumen.grafico} disabled={!resumenActivo} onChange={(e) => setResumen({ ...resumen, grafico: e.target.value })}>
                {GRAFICOS_UI.map((g) => <option key={g.v} value={g.v}>{g.t}</option>)}
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="ex-tit">Título del gráfico</label>
              <input id="ex-tit" value={titulo} maxLength={120} disabled={!resumenActivo} onChange={(e) => setTitulo(e.target.value)} placeholder="Automático" />
            </div>
          </div>
          <p className="subtitle" style={{ margin: "6px 0 0", fontSize: 11.5 }}>
            El Excel trae la hoja «Resumen» con la tabla cruzada y sus totales, el gráfico nativo de Excel, la hoja «Datos» con filtros por columna y la hoja «Filtros» con lo exportado.
          </p>
        </fieldset>

        <div style={{ marginTop: 14, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn sm" onClick={previsualizar} disabled={loading}>Previsualizar</button>
          <button className="btn primary sm" onClick={() => descargar("xlsx")}>⬇ Descargar Excel</button>
          <button className="btn sm" onClick={() => descargar("csv")}>⬇ CSV</button>
          <span className="subtitle" style={{ margin: 0 }}>
            {desde || hasta ? `Filtro: ${desde || "…"} → ${hasta || "…"}` : "Sin filtro de fechas"} · cada descarga trae como máximo {miles(limite)} filas
          </span>
        </div>
      </div>

      {loading && <div className="card" style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>Cargando…</div>}

      {preview && (
        <div className="card card--table">
          <h2 style={{ padding: "0 4px" }}>Vista previa · {miles(preview.meta.total)} fila(s) en total (se muestran hasta 25)</h2>
          <table className="data">
            <thead>
              <tr>{preview.campos.map((c: string, i: number) => <th key={c}>{preview.etiquetas?.[i] ?? et(c)}</th>)}</tr>
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
