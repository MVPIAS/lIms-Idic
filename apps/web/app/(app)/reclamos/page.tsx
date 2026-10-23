"use client";

/**
 * Reclamos de clientes (EP-00 9.2, BL-219).
 * -----------------------------------------------------------------------------
 * Comercial (SVT/SPC) registra el reclamo con fecha, cliente y OT, motivo y el
 * rol responsable («Registrar reclamo → responsable»), anota la respuesta al
 * cliente y lo cierra. Por debajo es una no conformidad de tipo «Reclamo de
 * cliente»: si exige una acción correctiva técnica, Calidad la trata en
 * «No conformidades».
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader, EmptyState, SkeletonRows } from "@/components/ui/PageHeader";
import RequierePermiso from "@/components/RequierePermiso";
import { toast } from "@/components/ui/feedback";
import { fechaDia, fechaHora, hoyISO } from "@/lib/format";
import { llamar } from "@/lib/laboratorio";
import Panel from "../cotizaciones/_components/Panel";

interface Reclamo {
  id: string; codigo: string; motivo: string; fecha: string | null; cliente: string | null; clienteId: string; otId: string | null; otCodigo: string | null;
  unidadCodigo: string | null; responsableRol: string | null; responsable: string | null; respuesta: string | null; respondidoAt: string | null;
  respondidoPor: string | null; cerradoAt: string | null; cerradoPor: string | null; cierreComentario: string | null; estadoReclamo: "abierto" | "respondido" | "cerrado";
  registradoPor: string | null; criticidad: string;
}
type Rol = { codigo: string; etiqueta: string };
const PILL: Record<Reclamo["estadoReclamo"], [string, string]> = { abierto: ["Abierto", "red"], respondido: ["Respondido", "amber"], cerrado: ["Cerrado", "green"] };

export default function ReclamosPage() {
  return (
    <RequierePermiso perm={["reclamo.ver", "reclamo.gestionar"]} titulo="los reclamos de clientes">
      <Reclamos />
    </RequierePermiso>
  );
}

function Reclamos() {
  const [filtro, setFiltro] = useState<"" | Reclamo["estadoReclamo"]>("");
  const [datos, setDatos] = useState<{ data: Reclamo[]; roles: Rol[]; resumen: Record<string, number>; puedeGestionar?: boolean } | null>(null);
  const [error, setError] = useState("");
  const [nuevo, setNuevo] = useState(false);
  const [sel, setSel] = useState<Reclamo | null>(null);

  const cargar = useCallback(async () => {
    try {
      setDatos(await llamar("GET", `/reclamos${filtro ? `?estado=${filtro}` : ""}`));
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, [filtro]);
  useEffect(() => void cargar(), [cargar]);

  const rolDe = (c: string | null) => datos?.roles.find((r) => r.codigo === c)?.etiqueta ?? c ?? "—";

  return (
    <div>
      <PageHeader
        icono="📣"
        titulo="Reclamos de clientes"
        subtitulo="Registro, respuesta y cierre de los reclamos de clientes. Cada reclamo queda con su responsable y su respuesta."
        migas={[{ label: "Comercial" }, { label: "Reclamos" }]}
        acciones={datos?.puedeGestionar ? <button className="btn primary sm" onClick={() => { setNuevo(true); setSel(null); }}>＋ Registrar reclamo</button> : undefined}
      />
      {error && <div className="alert warn" role="alert">{error}</div>}
      <div className="toolbar" style={{ gap: 6, flexWrap: "wrap" }}>
        {([["", "Todos"], ["abierto", "Abiertos"], ["respondido", "Respondidos"], ["cerrado", "Cerrados"]] as const).map(([k, l]) => (
          <button key={k} className={`btn sm ${filtro === k ? "primary" : "outline"}`} onClick={() => setFiltro(k)}>
            {l}{k && datos ? ` (${datos.resumen[`${k}s`] ?? 0})` : ""}
          </button>
        ))}
      </div>
      <div className="card card--table">
        {!datos ? (
          <table className="data"><tbody><SkeletonRows cols={7} rows={4} /></tbody></table>
        ) : datos.data.length === 0 ? (
          <EmptyState icono="✅" titulo="Sin reclamos" texto="No hay reclamos para este filtro." />
        ) : (
          <table className="data">
            <thead><tr><th>Código</th><th>Fecha</th><th>Cliente</th><th>OT</th><th>Motivo</th><th>Responsable</th><th>Estado</th></tr></thead>
            <tbody>
              {datos.data.map((r) => (
                <tr key={r.id} style={{ cursor: "pointer" }} onClick={() => { setSel(r); setNuevo(false); }} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setSel(r)}>
                  <td className="codigo">{r.codigo}</td>
                  <td>{r.fecha ? fechaDia(r.fecha) : "—"}</td>
                  <td>{r.cliente ?? "—"}</td>
                  <td>{r.otId ? <Link href={`/ot/${r.otId}` as any} className="codigo" onClick={(e) => e.stopPropagation()}>{r.otCodigo}</Link> : "—"}</td>
                  <td style={{ maxWidth: 320 }}>{r.motivo.length > 90 ? `${r.motivo.slice(0, 90)}…` : r.motivo}</td>
                  <td>{rolDe(r.responsableRol)}{r.responsable ? ` · ${r.responsable}` : ""}</td>
                  <td><span className={`pill ${PILL[r.estadoReclamo][1]}`}>{PILL[r.estadoReclamo][0]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {nuevo && datos && <Nuevo roles={datos.roles} onCerrar={() => setNuevo(false)} onHecho={async (r) => { setNuevo(false); toast.ok(`Reclamo ${r.codigo} registrado.`); await cargar(); setSel(r); }} />}
      {sel && <Detalle r={sel} rol={rolDe(sel.responsableRol)} gestiona={!!datos?.puedeGestionar} onCerrar={() => setSel(null)} onCambio={async (r) => { setSel(r); await cargar(); }} />}
    </div>
  );
}

function Nuevo({ roles, onCerrar, onHecho }: { roles: Rol[]; onCerrar: () => void; onHecho: (r: Reclamo) => void }) {
  const [clientes, setClientes] = useState<{ id: string; razonSocial: string }[]>([]);
  const [ots, setOts] = useState<{ id: string; codigo: string }[]>([]);
  const [f, setF] = useState({ fecha: hoyISO(), clienteId: "", otId: "", motivo: "", responsableRol: "", criticidad: "media" });
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    llamar<any>("GET", "/clientes?limit=200").then((r) => setClientes(r.data ?? [])).catch(() => setClientes([]));
  }, []);
  useEffect(() => {
    if (!f.clienteId) { setOts([]); return; }
    llamar<any>("GET", `/ot?clienteId=${f.clienteId}&limit=200`).then((r) => setOts((Array.isArray(r) ? r : r.data ?? []).filter((o: any) => o.clienteId === f.clienteId || o.cliente?.id === f.clienteId))).catch(() => setOts([]));
  }, [f.clienteId]);

  async function guardar() {
    setError("");
    if (!f.clienteId) return setError("Elija el cliente.");
    if (f.motivo.trim().length < 5) return setError("Describa el motivo del reclamo.");
    if (!f.responsableRol) return setError("Indique el rol responsable.");
    setOcupado(true);
    try {
      onHecho(await llamar<Reclamo>("POST", "/reclamos", { ...f, otId: f.otId || null, motivo: f.motivo.trim() }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Panel titulo="Registrar reclamo" onCerrar={onCerrar} ancho={620}>
      {error && <div className="alert warn" role="alert">{error}</div>}
      <div className="form-grid cols-2">
        <div className="field"><label htmlFor="rc-fecha">Fecha <span className="req">*</span></label><input id="rc-fecha" type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></div>
        <div className="field">
          <label htmlFor="rc-crit">Criticidad</label>
          <select id="rc-crit" value={f.criticidad} onChange={(e) => setF({ ...f, criticidad: e.target.value })}>
            <option value="baja">Baja</option><option value="media">Media</option><option value="alta">Alta</option><option value="critica">Crítica</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="rc-cli">Cliente <span className="req">*</span></label>
          <select id="rc-cli" value={f.clienteId} onChange={(e) => setF({ ...f, clienteId: e.target.value, otId: "" })}>
            <option value="">— elija —</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.razonSocial}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="rc-ot">OT</label>
          <select id="rc-ot" value={f.otId} disabled={!f.clienteId} onChange={(e) => setF({ ...f, otId: e.target.value })}>
            <option value="">{f.clienteId ? (ots.length ? "— sin OT —" : "El cliente no tiene OT a la vista") : "Elija primero el cliente"}</option>
            {ots.map((o) => <option key={o.id} value={o.id}>{o.codigo}</option>)}
          </select>
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="rc-mot">Motivo <span className="req">*</span></label>
          <textarea id="rc-mot" rows={3} maxLength={5000} value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} />
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="rc-rol">Responsable (rol) <span className="req">*</span></label>
          <select id="rc-rol" value={f.responsableRol} onChange={(e) => setF({ ...f, responsableRol: e.target.value })}>
            <option value="">— elija —</option>
            {roles.map((r) => <option key={r.codigo} value={r.codigo}>{r.etiqueta}</option>)}
          </select>
        </div>
      </div>
      <div className="toolbar" style={{ marginTop: 12 }}>
        <button className="btn outline sm" onClick={onCerrar}>Cancelar</button>
        <div className="spacer" />
        <button className="btn primary sm" disabled={ocupado} onClick={guardar}>{ocupado ? "Registrando…" : "Registrar reclamo → responsable"}</button>
      </div>
    </Panel>
  );
}

function Detalle({ r, rol, gestiona, onCerrar, onCambio }: { r: Reclamo; rol: string; gestiona: boolean; onCerrar: () => void; onCambio: (r: Reclamo) => void }) {
  const [respuesta, setRespuesta] = useState(r.respuesta ?? "");
  const [comentario, setComentario] = useState("");
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => setRespuesta(r.respuesta ?? ""), [r.id, r.respuesta]);
  const accion = async (ruta: string, cuerpo: object, okTexto: string) => {
    setOcupado(true);
    try {
      onCambio(await llamar<Reclamo>("POST", `/reclamos/${r.id}/${ruta}`, cuerpo));
      toast.ok(okTexto);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  };
  const cerrado = r.estadoReclamo === "cerrado" || !gestiona;
  return (
    <Panel titulo={<><span className="codigo">{r.codigo}</span> · {r.cliente}</>} modo="drawer" ancho={620} onCerrar={onCerrar}>
      <p style={{ margin: "0 0 6px", fontSize: 12.5 }}>
        <span className={`pill ${PILL[r.estadoReclamo][1]}`}>{PILL[r.estadoReclamo][0]}</span>{" "}
        {r.fecha ? fechaDia(r.fecha) : ""} · responsable: <b>{rol}</b>{r.otCodigo ? <> · OT <Link href={`/ot/${r.otId}` as any} className="codigo">{r.otCodigo}</Link></> : null}
        {r.registradoPor ? ` · registrado por ${r.registradoPor}` : ""}
      </p>
      <div style={{ whiteSpace: "pre-wrap", marginBottom: 10 }}>{r.motivo}</div>
      <div className="field">
        <label htmlFor="rc-resp">Respuesta al cliente</label>
        {cerrado ? <div style={{ whiteSpace: "pre-wrap" }}>{r.respuesta}</div> : <textarea id="rc-resp" rows={4} maxLength={5000} value={respuesta} onChange={(e) => setRespuesta(e.target.value)} />}
        {r.respondidoAt && <small style={{ color: "var(--muted)" }}>Respondido el {fechaHora(r.respondidoAt)}{r.respondidoPor ? ` por ${r.respondidoPor}` : ""}</small>}
      </div>
      {cerrado ? (
        <p style={{ fontSize: 12.5 }}>Cerrado el {r.cerradoAt ? fechaHora(r.cerradoAt) : "—"}{r.cerradoPor ? ` por ${r.cerradoPor}` : ""}. {r.cierreComentario}</p>
      ) : (
        <>
          <div className="toolbar" style={{ marginTop: 8 }}>
            <div className="spacer" />
            <button className="btn primary sm" disabled={ocupado || respuesta.trim().length < 5} onClick={() => accion("responder", { respuesta: respuesta.trim() }, "Respuesta registrada.")}>Guardar respuesta</button>
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label htmlFor="rc-com">Comentario de cierre</label>
            <input id="rc-com" maxLength={2000} value={comentario} onChange={(e) => setComentario(e.target.value)} />
          </div>
          <div className="toolbar" style={{ marginTop: 8 }}>
            <div className="spacer" />
            <button className="btn success sm" disabled={ocupado || r.estadoReclamo !== "respondido"} title={r.estadoReclamo !== "respondido" ? "Primero registre la respuesta al cliente" : undefined}
              onClick={() => accion("cerrar", { comentario: comentario.trim() || undefined }, "Reclamo cerrado.")}>Cerrar reclamo</button>
          </div>
        </>
      )}
    </Panel>
  );
}
