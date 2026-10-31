"use client";

/**
 * Configuración del laboratorio › Versiones de plantillas.
 *
 * Repositorio de plantillas con versiones (packages/db/align_plantilla_versiones.sql):
 *  · editar el cuerpo (membrete, textos, notas aclaratorias, firmas) escribe en
 *    el BORRADOR; la versión VIGENTE no cambia hasta que se aprueba;
 *  · lista de variables y bloques sacada del motor real (con una OT elegida);
 *  · vista previa en HTML y PDF con una OT real;
 *  · aprobar (plantilla.aprobar, nunca quien redactó), historial, comparar,
 *    volver a una versión anterior (= borrador copia) y duplicar la plantilla.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, EmptyState } from "@/components/ui/PageHeader";
import RequierePermiso from "@/components/RequierePermiso";
import { api } from "@/lib/api";
import { usePermisos } from "@/lib/permisos";
import { toast } from "@/components/ui/feedback";
import { enviarInforme } from "@/lib/informes";

const API = process.env.NEXT_PUBLIC_API_URL ?? "/api";

type Plantilla = { id: string; repid: string; nombre: string; tipo: string; version: string | null };
type Version = {
  id: string;
  numero: number;
  estado: "BORRADOR" | "VIGENTE" | "RETIRADA";
  motivo: string | null;
  origen: string;
  creadoEn: string;
  creadoPorNombre: string | null;
  actualizadoPorNombre: string | null;
  aprobadoPorNombre: string | null;
  aprobadoEn: string | null;
  basadaEnNumero: number | null;
  documentos: number;
  largoCuerpo?: number;
  cuerpoHtml?: string | null;
};
type Historial = { plantilla: Plantilla; vigente: Version | null; borrador: Version | null; versiones: Version[] };
type Ot = { id: string; codigo: string };
type Linea = { tipo: "igual" | "quitada" | "agregada"; texto: string };

const PILL: Record<string, string> = { VIGENTE: "teal", BORRADOR: "blue", RETIRADA: "gray" };
const ORIGEN: Record<string, string> = { migracion: "Migración", pantalla: "Pantalla", script: "Script de despliegue", restaurada: "Vuelta a versión anterior", duplicada: "Duplicada" };
const fecha = (s: string | null) => (s ? new Date(s).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" }) : "—");

function token() {
  return typeof window === "undefined" ? null : localStorage.getItem("lims_token");
}

export default function VersionesPlantillasPage() {
  return (
    <RequierePermiso perm={["plantilla.gestionar", "plantilla.aprobar"]} titulo="Versiones de plantillas">
      <Contenido />
    </RequierePermiso>
  );
}

function Contenido() {
  const { puede } = usePermisos();
  const gestiona = puede("plantilla.gestionar");
  const aprueba = puede("plantilla.aprobar");
  const [plantillas, setPlantillas] = useState<Plantilla[] | null>(null);
  const [filtro, setFiltro] = useState("");
  const [sel, setSel] = useState("");
  const [hist, setHist] = useState<Historial | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.list<Plantilla>("plantillas", { limit: 300 }).then((r) => setPlantillas(r.data)).catch((e) => { setError(e.message); setPlantillas([]); });
  }, []);

  const cargar = useCallback(async (id: string) => {
    if (!id) return setHist(null);
    try {
      setHist(await api.getRaw<Historial>(`informes/plantillas/${id}/versiones`));
    } catch (e: any) {
      setError(e.message);
    }
  }, []);
  useEffect(() => { cargar(sel); }, [sel, cargar]);

  const visibles = useMemo(() => {
    const t = filtro.trim().toLowerCase();
    return (plantillas ?? []).filter((p) => !t || `${p.repid} ${p.nombre} ${p.tipo}`.toLowerCase().includes(t));
  }, [plantillas, filtro]);

  return (
    <div>
      <PageHeader
        icono="🗂"
        titulo="Versiones de plantillas"
        subtitulo="Cuerpo de cada plantilla (membrete, textos, notas aclaratorias y firmas) con historial. Editar crea un borrador; rige cuando otra persona lo aprueba. Los documentos emitidos guardan la versión con que se emitieron."
        migas={[{ label: "Configuración del laboratorio" }, { label: "Versiones de plantillas" }]}
      />
      {error && <div className="alert warn" role="alert">{error}</div>}
      <div className="card" style={{ padding: 14 }}>
        <div className="form-grid cols-2">
          <div className="field">
            <label htmlFor="pv-buscar">Buscar plantilla</label>
            <input id="pv-buscar" value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="REPID, nombre o tipo" />
          </div>
          <div className="field">
            <label htmlFor="pv-sel">Plantilla</label>
            <select id="pv-sel" value={sel} onChange={(e) => setSel(e.target.value)} disabled={plantillas === null}>
              <option value="">{plantillas === null ? "Cargando…" : `— Seleccione (${visibles.length}) —`}</option>
              {visibles.map((p) => <option key={p.id} value={p.id}>{p.repid} · {p.nombre} ({p.tipo})</option>)}
            </select>
          </div>
        </div>
      </div>
      {hist ? (
        <Detalle key={hist.plantilla.id} hist={hist} gestiona={gestiona} aprueba={aprueba} recargar={() => cargar(sel)}
          alDuplicar={(id) => { api.list<Plantilla>("plantillas", { limit: 300 }).then((r) => setPlantillas(r.data)); setSel(id); }} />
      ) : (
        plantillas !== null && <EmptyState icono="🗂" titulo="Elija una plantilla" texto="Seleccione la plantilla cuyo cuerpo o historial quiere revisar." />
      )}
    </div>
  );
}

function Detalle({ hist, gestiona, aprueba, recargar, alDuplicar }: { hist: Historial; gestiona: boolean; aprueba: boolean; recargar: () => void; alDuplicar: (id: string) => void }) {
  const p = hist.plantilla;
  const [cuerpo, setCuerpo] = useState("");
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [ver, setVer] = useState<Version | null>(null);
  const [comparar, setComparar] = useState<{ a: number; b: number; cuerpo: Linea[]; formato: Linea[] } | null>(null);
  const [selA, setSelA] = useState("");
  const [ots, setOts] = useState<Ot[]>([]);
  const [otId, setOtId] = useState("");
  const [vars, setVars] = useState<{ conOt: boolean; datos: string[]; bloques: { clave: string; descripcion: string }[] } | null>(null);
  const [previa, setPrevia] = useState<{ html: string; avisos: string[] } | null>(null);
  const [dup, setDup] = useState({ repid: "", nombre: "" });

  // Contenido del borrador (o de la vigente, para empezar uno).
  useEffect(() => {
    const base = hist.borrador ?? hist.vigente;
    setMotivo(hist.borrador?.motivo ?? "");
    if (!base) return setCuerpo("");
    api.getRaw<Version>(`informes/plantillas/versiones/${base.id}`).then((v) => setCuerpo(v.cuerpoHtml ?? "")).catch(() => setCuerpo(""));
  }, [hist]);
  useEffect(() => {
    api.list<Ot>("ot", { limit: 100 }).then((r) => setOts(r.data)).catch(() => setOts([]));
  }, []);
  useEffect(() => {
    api.getRaw(`informes/plantillas/${p.id}/variables${otId ? `?otId=${otId}` : ""}`).then(setVars).catch((e) => toast.error(e.message));
  }, [p.id, otId]);

  async function accion(fn: () => Promise<unknown>, ok: string) {
    setOcupado(true);
    try {
      await fn();
      toast.ok(ok);
      recargar();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }

  const guardar = () =>
    accion(() => enviarInforme(`/informes/plantillas/${p.id}/borrador`, "POST", { cuerpoHtml: cuerpo, motivo: motivo || null }),
      "Borrador guardado. La versión vigente no cambia hasta que se apruebe.");

  async function verPrevia(formato: "html" | "pdf") {
    const v = hist.borrador ?? hist.vigente;
    if (!v || !otId) return toast.error("Elija una OT para la vista previa (y guarde el borrador si lo cambió).");
    setOcupado(true);
    try {
      const r = await fetch(`${API}/informes/plantillas/versiones/${v.id}/previsualizar`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token() ? { Authorization: `Bearer ${token()}` } : {}) },
        body: JSON.stringify({ otId, formato }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.message ?? `Error ${r.status}`);
      }
      if (formato === "pdf") window.open(URL.createObjectURL(await r.blob()), "_blank", "noopener");
      else setPrevia(await r.json());
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }

  async function abrir(v: Version) {
    try {
      setVer(await api.getRaw<Version>(`informes/plantillas/versiones/${v.id}`));
    } catch (e: any) {
      toast.error(e.message);
    }
  }
  async function compararCon(b: Version) {
    if (!selA) return toast.error("Elija la versión con que comparar.");
    try {
      const r = await api.getRaw<any>(`informes/plantillas/versiones/${b.id}/comparar/${selA}`);
      setComparar({ a: r.a.numero, b: r.b.numero, cuerpo: r.cuerpo, formato: r.formato });
    } catch (e: any) {
      toast.error(e.message);
    }
  }
  const insertar = (t: string) => setCuerpo((c) => `${c}${t}`);
  const editable = gestiona;

  return (
    <>
      <div className="card" style={{ padding: 14 }}>
        <h2 style={{ fontSize: 14, margin: "0 0 6px" }}>{p.repid} · {p.nombre}</h2>
        <p className="subtitle" style={{ margin: 0 }}>
          Vigente: {hist.vigente ? <b>v{hist.vigente.numero}</b> : <b>ninguna (se emite con el cuerpo por defecto del tipo)</b>}
          {hist.borrador && <> · Borrador: <b>v{hist.borrador.numero}</b> de {hist.borrador.creadoPorNombre ?? "—"}</>}
        </p>
      </div>

      <div className="card" style={{ padding: 14 }}>
        <h3 style={{ fontSize: 13, margin: "0 0 8px" }}>{hist.borrador ? `Borrador v${hist.borrador.numero}` : "Cuerpo vigente (al guardar se crea un borrador)"}</h3>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 3fr) minmax(0, 1fr)", gap: 12 }}>
          <div className="field">
            <label htmlFor="pv-cuerpo">Cuerpo HTML</label>
            <textarea id="pv-cuerpo" value={cuerpo} onChange={(e) => setCuerpo(e.target.value)} readOnly={!editable}
              rows={22} spellCheck={false} style={{ fontFamily: "monospace", fontSize: 12, width: "100%" }} />
            <label htmlFor="pv-motivo" style={{ marginTop: 8 }}>Motivo del cambio (obligatorio para aprobar)</label>
            <input id="pv-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={1000} readOnly={!editable} />
          </div>
          <div>
            <div className="field">
              <label htmlFor="pv-ot">OT para variables y vista previa</label>
              <select id="pv-ot" value={otId} onChange={(e) => setOtId(e.target.value)}>
                <option value="">— Sin OT (solo bloques) —</option>
                {ots.map((o) => <option key={o.id} value={o.id}>{o.codigo}</option>)}
              </select>
            </div>
            <div style={{ maxHeight: 380, overflow: "auto", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, padding: 6 }}>
              <b>Bloques</b>
              {vars?.bloques.map((b) => (
                <div key={b.clave}><button type="button" className="btn link sm" disabled={!editable} title={b.descripcion} onClick={() => insertar(`{{${b.clave}}}`)}>{`{{${b.clave}}}`}</button></div>
              ))}
              <b>Variables {vars?.conOt ? "" : "(elija una OT para verlas)"}</b>
              {vars?.datos.map((d) => (
                <div key={d}><button type="button" className="btn link sm" disabled={!editable} onClick={() => insertar(`{{${d}}}`)}>{`{{${d}}}`}</button></div>
              ))}
              <p style={{ color: "var(--muted)" }}>Condicionales: {"{{#si ruta}}…{{/si}}"} y {"{{#no ruta}}…{{/no}}"}. Los datos se escapan siempre.</p>
            </div>
          </div>
        </div>
        <div className="toolbar" style={{ marginTop: 10, marginBottom: 0, flexWrap: "wrap" }}>
          {editable && <button className="btn primary sm" disabled={ocupado} onClick={guardar}>Guardar borrador</button>}
          <button className="btn outline sm" disabled={ocupado} onClick={() => verPrevia("html")}>Vista previa</button>
          <button className="btn outline sm" disabled={ocupado} onClick={() => verPrevia("pdf")}>Vista previa PDF</button>
          {hist.borrador && aprueba && (
            <button className="btn primary sm" disabled={ocupado}
              onClick={() => accion(() => enviarInforme(`/informes/plantillas/versiones/${hist.borrador!.id}/aprobar`, "POST", motivo ? { motivo } : {}), `Versión ${hist.borrador!.numero} aprobada: ya es la vigente.`)}>
              Aprobar borrador
            </button>
          )}
          {hist.borrador && editable && (
            <button className="btn outline sm" disabled={ocupado}
              onClick={() => confirm("¿Descartar el borrador? La vigente no cambia.") && accion(() => api.remove("informes/plantillas/versiones", hist.borrador!.id), "Borrador descartado.")}>
              Descartar borrador
            </button>
          )}
        </div>
        <small style={{ color: "var(--muted)" }}>Quien redacta o modifica un borrador no puede aprobarlo. La vista previa usa el borrador si existe (guárdelo antes) o la vigente.</small>
      </div>

      {previa && (
        <div className="card" style={{ padding: 14 }}>
          <div className="toolbar"><b>Vista previa</b><button className="btn outline sm" onClick={() => setPrevia(null)}>Cerrar</button></div>
          {previa.avisos.length > 0 && <div className="alert warn">{previa.avisos.join(" ")}</div>}
          <iframe title="Vista previa de la plantilla" sandbox="" srcDoc={previa.html} style={{ width: "100%", height: 700, border: "1px solid var(--border)", background: "#fff" }} />
        </div>
      )}

      <div className="card" style={{ padding: 14 }}>
        <h3 style={{ fontSize: 13, margin: "0 0 8px" }}>Historial</h3>
        <div className="field" style={{ maxWidth: 360 }}>
          <label htmlFor="pv-comp">Comparar con</label>
          <select id="pv-comp" value={selA} onChange={(e) => setSelA(e.target.value)}>
            <option value="">— versión —</option>
            {hist.versiones.map((v) => <option key={v.id} value={v.id}>v{v.numero} · {v.estado}</option>)}
          </select>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Versión</th><th>Estado</th><th>Origen</th><th>Motivo</th><th>Redactó</th><th>Aprobó</th><th>Documentos</th><th></th></tr>
            </thead>
            <tbody>
              {hist.versiones.map((v) => (
                <tr key={v.id}>
                  <td>v{v.numero}{v.basadaEnNumero ? <small style={{ color: "var(--muted)" }}> (desde v{v.basadaEnNumero})</small> : null}</td>
                  <td><span className={`pill ${PILL[v.estado]}`}>{v.estado}</span></td>
                  <td>{ORIGEN[v.origen] ?? v.origen}</td>
                  <td>{v.motivo ?? "—"}</td>
                  <td>{v.creadoPorNombre ?? "—"}<br /><small>{fecha(v.creadoEn)}</small></td>
                  <td>{v.aprobadoPorNombre ?? (v.estado === "BORRADOR" ? "Pendiente" : "—")}<br /><small>{fecha(v.aprobadoEn)}</small></td>
                  <td>{v.documentos}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn link sm" onClick={() => abrir(v)}>Ver</button>
                    <button className="btn link sm" onClick={() => compararCon(v)} disabled={!selA || selA === v.id}>Comparar</button>
                    {editable && v.estado !== "BORRADOR" && !hist.borrador && (
                      <button className="btn link sm" disabled={ocupado}
                        onClick={() => accion(() => enviarInforme(`/informes/plantillas/versiones/${v.id}/restaurar`, "POST", {}), `Borrador creado a partir de la v${v.numero}.`)}>
                        Volver a esta
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {ver && (
        <div className="card" style={{ padding: 14 }}>
          <div className="toolbar"><b>Versión v{ver.numero} · {ver.estado}</b><button className="btn outline sm" onClick={() => setVer(null)}>Cerrar</button></div>
          <pre style={{ maxHeight: 400, overflow: "auto", fontSize: 11, whiteSpace: "pre-wrap" }}>{ver.cuerpoHtml ?? "(sin cuerpo: se usa el del tipo)"}</pre>
        </div>
      )}

      {comparar && (
        <div className="card" style={{ padding: 14 }}>
          <div className="toolbar"><b>Cambios de v{comparar.a} a v{comparar.b}</b><button className="btn outline sm" onClick={() => setComparar(null)}>Cerrar</button></div>
          <Diff titulo="Cuerpo" lineas={comparar.cuerpo} />
          <Diff titulo="Formato" lineas={comparar.formato} />
        </div>
      )}

      {editable && (
        <div className="card" style={{ padding: 14 }}>
          <h3 style={{ fontSize: 13, margin: "0 0 8px" }}>Duplicar plantilla (p. ej. para otro laboratorio)</h3>
          <div className="form-grid cols-3">
            <div className="field"><label htmlFor="pv-dr">REPID nuevo</label><input id="pv-dr" maxLength={20} value={dup.repid} onChange={(e) => setDup({ ...dup, repid: e.target.value })} /></div>
            <div className="field"><label htmlFor="pv-dn">Nombre nuevo</label><input id="pv-dn" maxLength={160} value={dup.nombre} onChange={(e) => setDup({ ...dup, nombre: e.target.value })} /></div>
            <div className="field" style={{ alignSelf: "end" }}>
              <button className="btn outline sm" disabled={ocupado || !dup.repid.trim() || !dup.nombre.trim()}
                onClick={async () => {
                  setOcupado(true);
                  try {
                    const r = await enviarInforme(`/informes/plantillas/${p.id}/duplicar`, "POST", dup);
                    toast.ok(`Plantilla ${dup.repid} creada con su v1 en borrador: revísela y que otra persona la apruebe.`);
                    alDuplicar(r.plantilla.id);
                  } catch (e: any) {
                    toast.error(e.message);
                  } finally {
                    setOcupado(false);
                  }
                }}>
                Duplicar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Diff({ titulo, lineas }: { titulo: string; lineas: Linea[] }) {
  const cambios = lineas.filter((l) => l.tipo !== "igual").length;
  return (
    <div style={{ marginTop: 8 }}>
      <b>{titulo}</b> <small>({cambios} línea(s) distintas)</small>
      <pre style={{ maxHeight: 360, overflow: "auto", fontSize: 11, whiteSpace: "pre-wrap" }}>
        {lineas.filter((l) => l.tipo !== "igual").map((l, i) => (
          <div key={i} style={{ background: l.tipo === "quitada" ? "rgba(220,38,38,.12)" : "rgba(22,163,74,.12)" }}>
            {l.tipo === "quitada" ? "− " : "+ "}{l.texto}
          </div>
        ))}
      </pre>
    </div>
  );
}
