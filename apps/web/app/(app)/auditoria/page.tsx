"use client";

/**
 * Auditoría · bitácora de cambios (audit_log, RF-H04.3). Solo lectura.
 * Cada creación, modificación o anulación que termina bien queda registrada con
 * quién, cuándo, desde dónde y qué cambió. Filtros por fecha, persona, entidad
 * (módulo), acción y código. Las jefaturas acotadas a unidades solo ven lo hecho
 * por las personas de sus unidades (lo impone el servidor).
 * API: GET /auditoria?desde=&hasta=&usuarioId=&recurso=&accion=&entidadCodigo=&page=&limit=
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fechaHora } from "@/lib/format";
import { PageHeader, EmptyState, SkeletonRows } from "@/components/ui/PageHeader";
import RequierePermiso from "@/components/RequierePermiso";
import { RECURSO_PERSONAS, etiquetaPersona, type Persona } from "@/lib/personas";
import { hoyChile, sumarDiasCalendario } from "@/lib/fecha-chile";

const ACCION_LABEL: Record<string, string> = {
  crear: "Creación",
  modificar: "Modificación",
  eliminar: "Eliminación / anulación",
  vencer: "Vencimiento automático",
};
const ACCION_PILL: Record<string, string> = { crear: "green", modificar: "blue", eliminar: "red", vencer: "amber" };
/** Texto de la acción: el que manda la API (etiqueta-accion.ts) o, si falta, el del mapa. */
const textoAccion = (a: any) => a.accionEtiqueta ?? ACCION_LABEL[a.accion] ?? a.accion;
/** «PUT /api/ot/:id»: la ruta guardada ya empieza por el verbo (no se repite). */
const textoRuta = (m: any) => {
  const ruta = String(m?.ruta ?? "");
  if (!ruta) return "—";
  return m?.metodo && !ruta.startsWith(`${m.metodo} `) ? `${m.metodo} ${ruta}` : ruta;
};

const hace = (dias: number) => sumarDiasCalendario(hoyChile(), -dias);

export default function AuditoriaPage() {
  return (
    <RequierePermiso perm="audit.ver" titulo="la auditoría">
      <Auditoria />
    </RequierePermiso>
  );
}

function Auditoria() {
  const [desde, setDesde] = useState(hace(7));
  const [hasta, setHasta] = useState(hace(0));
  const [usuarioId, setUsuarioId] = useState("");
  const [recurso, setRecurso] = useState("");
  const [accion, setAccion] = useState("");
  const [codigo, setCodigo] = useState("");
  const [page, setPage] = useState(1);
  const [filas, setFilas] = useState<any[]>([]);
  const [meta, setMeta] = useState<{ total: number; totalPages: number; acotada?: boolean } | null>(null);
  // `acciones`: familias del filtro (Creación, Modificación, Paso del flujo…) con su texto.
  const [opciones, setOpciones] = useState<{ recursos: string[]; acciones: { valor: string; etiqueta: string }[] }>({ recursos: [], acciones: [] });
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [abierta, setAbierta] = useState<any | null>(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    api.getRaw<any>("auditoria/opciones").then(setOpciones).catch(() => undefined);
    api.list<Persona>(RECURSO_PERSONAS, { limit: 500 }).then((r) => setPersonas(r.data ?? [])).catch(() => undefined);
  }, []);

  const buscar = useCallback(async (pagina = 1) => {
    setCargando(true);
    setError("");
    try {
      const qs = new URLSearchParams({ page: String(pagina), limit: "50" });
      if (desde) qs.set("desde", desde);
      if (hasta) qs.set("hasta", hasta);
      if (usuarioId) qs.set("usuarioId", usuarioId);
      if (recurso) qs.set("recurso", recurso);
      if (accion) qs.set("accion", accion);
      if (codigo.trim()) qs.set("entidadCodigo", codigo.trim());
      const r = await api.getRaw<any>(`auditoria?${qs}`);
      setFilas(r?.data ?? []);
      setMeta(r?.meta ?? null);
      setPage(pagina);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, usuarioId, recurso, accion, codigo]);

  useEffect(() => {
    void buscar(1);
    // Primera carga (últimos 7 días); luego se busca con el botón.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function limpiar() {
    setDesde(hace(7));
    setHasta(hace(0));
    setUsuarioId("");
    setRecurso("");
    setAccion("");
    setCodigo("");
  }

  return (
    <div>
      <PageHeader
        icono="🧾"
        titulo="Auditoría"
        subtitulo="Bitácora de cambios: quién hizo qué, cuándo y desde dónde. Es de solo lectura y no se puede modificar."
        migas={[{ label: "Reportes y comunicación" }, { label: "Auditoría" }]}
      />

      {meta?.acotada && (
        <div className="alert info">Ve las acciones de las personas de sus unidades y las suyas. Dirección, Calidad y Administración ven la bitácora completa.</div>
      )}
      {error && <div className="alert warn">{error}</div>}

      <form className="card" style={{ padding: 12 }} onSubmit={(e) => { e.preventDefault(); void buscar(1); }}>
        <div className="form-grid cols-3">
          <div className="field">
            <label htmlFor="aud-desde">Desde</label>
            <input id="aud-desde" type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="aud-hasta">Hasta (incluido)</label>
            <input id="aud-hasta" type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="aud-persona">Persona</label>
            <select id="aud-persona" value={usuarioId} onChange={(e) => setUsuarioId(e.target.value)}>
              <option value="">Todas</option>
              {personas.map((p) => <option key={p.id} value={p.id}>{etiquetaPersona(p)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="aud-recurso">Entidad / módulo</label>
            <select id="aud-recurso" value={recurso} onChange={(e) => setRecurso(e.target.value)}>
              <option value="">Todas</option>
              {opciones.recursos.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="aud-accion">Acción</label>
            <select id="aud-accion" value={accion} onChange={(e) => setAccion(e.target.value)}>
              <option value="">Todas</option>
              {opciones.acciones.map((a) => <option key={a.valor} value={a.valor}>{a.etiqueta}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="aud-codigo">Código (OT, cotización…)</label>
            <input id="aud-codigo" value={codigo} maxLength={60} onChange={(e) => setCodigo(e.target.value)} />
          </div>
        </div>
        <div className="toolbar" style={{ marginTop: 10, marginBottom: 0 }}>
          <button type="submit" className="btn primary sm" disabled={cargando}>{cargando ? "Buscando…" : "Buscar"}</button>
          <button type="button" className="btn outline sm" onClick={limpiar}>Limpiar filtros</button>
          <div className="spacer" />
          {meta && <span style={{ fontSize: 12, color: "var(--muted)" }}>{meta.total} registro(s)</span>}
        </div>
      </form>

      <div className="card card--table">
        <table className="data">
          <thead>
            <tr>
              <th>Fecha y hora</th>
              <th>Persona</th>
              <th>Acción</th>
              <th>Entidad</th>
              <th>Código</th>
              <th>Origen</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {cargando && filas.length === 0 && <tr><td colSpan={7}><SkeletonRows cols={6} rows={4} /></td></tr>}
            {filas.map((a) => (
              <tr key={`${a.id}-${a.ocurridoAt}`}>
                <td style={{ whiteSpace: "nowrap" }}>{fechaHora(a.ocurridoAt)}</td>
                <td>{a.username ?? <span style={{ color: "var(--muted)" }}>sistema</span>}</td>
                <td><span className={`pill ${ACCION_PILL[a.accion] ?? "gray"}`}>{textoAccion(a)}</span></td>
                <td>{a.entidadTipo}</td>
                <td>{a.entidadCodigo ? <span className="codigo">{a.entidadCodigo}</span> : "—"}</td>
                <td style={{ fontSize: 11.5, color: "var(--muted)" }}>{a.ip ?? "—"}</td>
                <td><button className="btn outline sm" onClick={() => setAbierta(a)}>Detalle</button></td>
              </tr>
            ))}
            {!cargando && filas.length === 0 && (
              <tr><td colSpan={7}><EmptyState compacto icono="🔎" titulo="Sin registros" texto="No hay acciones que coincidan con los filtros. Amplíe el rango de fechas." /></td></tr>
            )}
          </tbody>
        </table>
      </div>

      {meta && meta.totalPages > 1 && (
        <div className="toolbar">
          <button className="btn outline sm" disabled={page <= 1 || cargando} onClick={() => void buscar(page - 1)}>← Anterior</button>
          <span style={{ fontSize: 12 }}>Página {page} de {meta.totalPages}</span>
          <button className="btn outline sm" disabled={page >= meta.totalPages || cargando} onClick={() => void buscar(page + 1)}>Siguiente →</button>
        </div>
      )}

      {abierta && (
        <div className="card" style={{ borderTop: "3px solid var(--accent)" }}>
          <div className="toolbar" style={{ marginBottom: 6 }}>
            <h2 style={{ margin: 0 }}>Detalle del registro</h2>
            <div className="spacer" />
            <button className="btn outline sm" onClick={() => setAbierta(null)}>Cerrar</button>
          </div>
          <p style={{ fontSize: 12.5, margin: "0 0 8px" }}>
            {fechaHora(abierta.ocurridoAt)} · {abierta.username ?? "sistema"} · {textoAccion(abierta)} en <b>{abierta.entidadTipo}</b>
            {abierta.entidadCodigo ? <> · <span className="codigo">{abierta.entidadCodigo}</span></> : null}
            {abierta.motivo ? <> · Motivo: {abierta.motivo}</> : null}
          </p>
          <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "0 0 8px" }}>
            Ruta: {textoRuta(abierta.metadata)} · Navegador: {abierta.userAgent ?? "—"}
          </p>
          <DatosRegistrados diff={abierta.diff} />
          <p style={{ fontSize: 11, color: "var(--muted)", margin: 0 }}>Las contraseñas y tokens nunca se guardan en la bitácora (aparecen como [REDACTADO]).</p>
        </div>
      )}
    </div>
  );
}

/** Datos del cambio como «campo: valor»; el JSON completo queda plegado debajo. */
function DatosRegistrados({ diff }: { diff: any }) {
  const despues = diff?.despues && typeof diff.despues === "object" ? Object.entries(diff.despues as Record<string, unknown>) : [];
  const texto = (v: unknown) => (v == null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));
  return (
    <>
      {despues.length > 0 ? (
        <table className="data" style={{ fontSize: 12, marginBottom: 8 }}>
          <thead><tr><th>Dato enviado</th><th>Valor</th></tr></thead>
          <tbody>
            {despues.map(([k, v]) => (
              <tr key={k}><td>{k}</td><td style={{ wordBreak: "break-word" }}>{texto(v)}</td></tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p style={{ fontSize: 12, margin: "0 0 8px" }}>
          {diff?.eliminado ? <>Registro eliminado: <span className="codigo">{diff.eliminado}</span></> : "Sin datos enviados."}
          {diff?.truncado ? " (cambio demasiado grande: solo se guardaron los nombres de los campos)" : null}
        </p>
      )}
      <details>
        <summary style={{ fontSize: 11.5, cursor: "pointer" }}>Ver el registro completo (técnico)</summary>
        <pre style={{ fontSize: 11.5, background: "var(--bg, #f6f8fa)", padding: 10, borderRadius: 6, overflow: "auto", maxHeight: 320 }}>
          {JSON.stringify(diff ?? {}, null, 2)}
        </pre>
      </details>
    </>
  );
}
