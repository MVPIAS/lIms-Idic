"use client";

/**
 * Validez de las cotizaciones por tipo de cliente y laboratorio (reunión 2 · 28-10-2026)
 * -----------------------------------------------------------------------------
 * Respuestas del IDIC: particulares 45 días (60 en Metrología y Resistencia
 * Balística); Ejército, Fuerzas Armadas y de Orden hasta el 31-12 (las emitidas
 * desde octubre, 6 meses). Cada regla indica un tipo de cliente, un laboratorio
 * o ambos. Prioridad: tipo + laboratorio › tipo › laboratorio (solo para
 * particulares) › regla general (Parámetros › validez_cotizacion).
 * Leer: cotizacion.ver · Cambiar: comercial.configurar (Planificación y Control).
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePermisos } from "@/lib/permisos";
import { pedir, type ConfigCotizacion } from "../_components/comercial";

type Regla = { id: string; tipoCliente: string | null; centroCostoId: string | null; centroCosto: string | null; regla: "DIAS" | "FIN_ANIO"; dias: number | null; mesesOctDic: number | null; activo: boolean; nota: string | null };
const VACIA = { tipoCliente: "", centroCostoId: "", regla: "DIAS" as "DIAS" | "FIN_ANIO", dias: "45", mesesOctDic: "", nota: "" };

export default function ValidezCotizacionesPage() {
  const { puede } = usePermisos();
  const editar = puede("comercial.configurar");
  const [reglas, setReglas] = useState<Regla[]>([]);
  const [cfg, setCfg] = useState<ConfigCotizacion | null>(null);
  const [nueva, setNueva] = useState(VACIA);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const cargar = useCallback(() => pedir<Regla[]>("GET", "/comercial/validez-reglas").then(setReglas).catch((e) => setError(e.message)), []);
  useEffect(() => {
    cargar();
    pedir<ConfigCotizacion>("GET", "/cotizaciones/config").then(setCfg).catch(() => {});
  }, [cargar]);

  const tipos = cfg?.parametros?.tipo_cliente ?? [];
  const etiquetaTipo = (c: string | null) => (c ? tipos.find((t) => t.codigo === c)?.etiqueta ?? c : "Todos los tipos");
  const texto = (r: Pick<Regla, "regla" | "dias" | "mesesOctDic">) =>
    r.regla === "FIN_ANIO" ? `Hasta el 31 de diciembre (emitidas oct–dic: ${r.mesesOctDic ?? cfg?.validez?.ejercitoMesesOctDic ?? 6} meses)` : `${r.dias} días corridos`;

  async function hacer(f: () => Promise<any>, ok: string) {
    setError(""); setMsg("");
    try { await f(); setMsg(ok); await cargar(); } catch (e: any) { setError(e.message); }
  }
  const crear = () =>
    hacer(
      () => pedir("POST", "/comercial/validez-reglas", {
        tipoCliente: nueva.tipoCliente || null,
        centroCostoId: nueva.centroCostoId || null,
        regla: nueva.regla,
        dias: nueva.regla === "DIAS" ? Number(nueva.dias) : null,
        mesesOctDic: nueva.regla === "FIN_ANIO" && nueva.mesesOctDic ? Number(nueva.mesesOctDic) : null,
        nota: nueva.nota.trim() || null,
      }).then(() => setNueva(VACIA)),
      "Regla agregada.",
    );

  return (
    <div>
      <Link href={"/cotizaciones" as any} className="subtitle" style={{ display: "inline-block", color: "var(--accent)", textDecoration: "none" }}>← Cotizaciones</Link>
      <h1 className="page">Validez de las cotizaciones</h1>
      <p className="subtitle">
        La validez se calcula sola al emitir la cotización, según el tipo de cliente elegido en ella y su laboratorio. Manda la regla más específica: tipo y laboratorio, luego el tipo y, para particulares, el laboratorio. Sin regla rige la general:
        particulares {cfg?.validez?.particularDias ?? 45} días; Ejército hasta el 31-12.
      </p>
      {error && <div className="alert warn" role="alert">{error}</div>}
      {msg && <div className="alert info" role="status">{msg}</div>}
      <div className="card card--table">
        <table className="data">
          <thead><tr><th>Tipo de cliente</th><th>Laboratorio</th><th>Validez</th><th>Nota</th><th>Activa</th>{editar && <th />}</tr></thead>
          <tbody>
            {reglas.map((r) => (
              <tr key={r.id} style={r.activo ? undefined : { opacity: 0.55 }}>
                <td>{etiquetaTipo(r.tipoCliente)}</td>
                <td>{r.centroCosto ?? "Todos los laboratorios"}</td>
                <td>{texto(r)}</td>
                <td style={{ fontSize: 12 }}>{r.nota ?? "—"}</td>
                <td>{r.activo ? "Sí" : "No"}</td>
                {editar && (
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn outline sm" onClick={() => hacer(() => pedir("PATCH", `/comercial/validez-reglas/${r.id}`, { activo: !r.activo }), r.activo ? "Regla desactivada." : "Regla activada.")}>{r.activo ? "Desactivar" : "Activar"}</button>{" "}
                    <button className="btn outline sm" onClick={() => hacer(() => fetchBorrar(r.id), "Regla eliminada.")}>Eliminar</button>
                  </td>
                )}
              </tr>
            ))}
            {!reglas.length && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: 18 }}>Sin reglas: rige la validez general.</td></tr>}
          </tbody>
        </table>
      </div>
      {editar && (
        <div className="card">
          <h2>Agregar regla</h2>
          <div className="form-grid cols-3">
            <div className="field">
              <label htmlFor="v-tipo">Tipo de cliente</label>
              <select id="v-tipo" value={nueva.tipoCliente} onChange={(e) => setNueva({ ...nueva, tipoCliente: e.target.value })}>
                <option value="">Todos los tipos</option>
                {tipos.map((t) => <option key={t.codigo} value={t.codigo}>{t.etiqueta}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="v-cc">Laboratorio (centro de costo)</label>
              <select id="v-cc" value={nueva.centroCostoId} onChange={(e) => setNueva({ ...nueva, centroCostoId: e.target.value })}>
                <option value="">Todos los laboratorios</option>
                {(cfg?.centrosCosto ?? []).map((c) => <option key={c.id} value={c.id}>{c.nombre} ({c.codigo})</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="v-regla">Validez</label>
              <select id="v-regla" value={nueva.regla} onChange={(e) => setNueva({ ...nueva, regla: e.target.value as any })}>
                <option value="DIAS">Días corridos desde la emisión</option>
                <option value="FIN_ANIO">Hasta el 31 de diciembre</option>
              </select>
            </div>
            {nueva.regla === "DIAS" ? (
              <div className="field">
                <label htmlFor="v-dias">Días</label>
                <input id="v-dias" type="number" min={1} max={730} value={nueva.dias} onChange={(e) => setNueva({ ...nueva, dias: e.target.value })} />
              </div>
            ) : (
              <div className="field">
                <label htmlFor="v-meses">Meses si se emite entre octubre y diciembre</label>
                <input id="v-meses" type="number" min={1} max={24} value={nueva.mesesOctDic} placeholder={String(cfg?.validez?.ejercitoMesesOctDic ?? 6)} onChange={(e) => setNueva({ ...nueva, mesesOctDic: e.target.value })} />
              </div>
            )}
            <div className="field" style={{ gridColumn: "span 2" }}>
              <label htmlFor="v-nota">Nota</label>
              <input id="v-nota" maxLength={300} value={nueva.nota} onChange={(e) => setNueva({ ...nueva, nota: e.target.value })} placeholder="De dónde sale la regla (procedimiento, acuerdo…)" />
            </div>
          </div>
          <div className="toolbar"><div className="spacer" /><button className="btn primary sm" disabled={!nueva.tipoCliente && !nueva.centroCostoId} onClick={crear}>Agregar regla</button></div>
        </div>
      )}
    </div>
  );
}

/** DELETE con el mismo manejo de errores que `pedir` (que no expone DELETE). */
async function fetchBorrar(id: string) {
  const API = process.env.NEXT_PUBLIC_API_URL || "/api";
  const t = typeof window !== "undefined" ? localStorage.getItem("lims_token") : null;
  const r = await fetch(`${API}/comercial/validez-reglas/${id}`, { method: "DELETE", headers: t ? { Authorization: `Bearer ${t}` } : {} });
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.message ?? `Error ${r.status}`);
}
