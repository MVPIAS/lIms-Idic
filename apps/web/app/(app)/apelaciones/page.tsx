"use client";

/**
 * Apelaciones de Informes de Rechazo (LRB · EP-05 8.2, BL-166).
 * -----------------------------------------------------------------------------
 * El cliente apela dentro del plazo en días hábiles desde que recibió el
 * informe (parámetro «Plazo de apelación del Informe de Rechazo», 5 por
 * defecto). El Jefe del Departamento o del Laboratorio la registra con su
 * fundamento y antecedentes («Registrar apelación → Director») y el Director la
 * resuelve («Resolver → cerrar»): acoge o rechaza, decisión inapelable. Un lote
 * nuevo exige otra OT.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader, EmptyState, SkeletonRows } from "@/components/ui/PageHeader";
import RequierePermiso from "@/components/RequierePermiso";
import { toast } from "@/components/ui/feedback";
import { fechaDia, fechaHora, hoyISO } from "@/lib/format";
import { llamar } from "@/lib/laboratorio";
import { usePermisos } from "@/lib/permisos";
import { descargarAdjunto, subirFormulario } from "@/lib/d11";
import Panel from "../cotizaciones/_components/Panel";

interface Apelacion {
  id: string; codigo: string; otId: string; otCodigo: string; unidadCodigo: string | null; cliente: string | null; documento: string | null;
  fechaRecepcionDoc: string; fechaIngreso: string; plazoDias: number; venceEl: string; fueraDePlazo: boolean; fundamento: string; antecedentes: string | null;
  estado: "registrada" | "resuelta"; decision: "acoge" | "rechaza" | null; resolucionFecha: string | null; resolucionTexto: string | null;
  resueltaPor: string | null; registradaPor: string | null; registradaAt: string; adjuntos?: { id: string; nombre: string; createdAt: string }[];
}

export default function ApelacionesPage() {
  return (
    <RequierePermiso perm="apelacion.ver" titulo="las apelaciones">
      <Apelaciones />
    </RequierePermiso>
  );
}

function Apelaciones() {
  const { puede } = usePermisos();
  const [datos, setDatos] = useState<{ data: Apelacion[]; plazoDias: number } | null>(null);
  const [error, setError] = useState("");
  const [nueva, setNueva] = useState(false);
  const [sel, setSel] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      setDatos(await llamar("GET", "/apelaciones"));
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    void cargar();
    const qs = new URLSearchParams(window.location.search);
    if (qs.get("nueva")) setNueva(true);
  }, [cargar]);

  return (
    <div>
      <PageHeader
        icono="⚖"
        titulo="Apelaciones de Informes de Rechazo"
        subtitulo={`El cliente apela dentro de ${datos?.plazoDias ?? 5} días hábiles desde que recibe el informe. La resuelve el Director; su decisión es inapelable.`}
        migas={[{ label: "Laboratorio" }, { label: "Apelaciones" }]}
        acciones={puede("apelacion.registrar") ? <button className="btn primary sm" onClick={() => setNueva(true)}>＋ Registrar apelación</button> : undefined}
      />
      {error && <div className="alert warn" role="alert">{error}</div>}
      <div className="card card--table">
        {!datos ? (
          <table className="data"><tbody><SkeletonRows cols={8} rows={3} /></tbody></table>
        ) : datos.data.length === 0 ? (
          <EmptyState icono="⚖" titulo="Sin apelaciones" texto="No hay apelaciones registradas en sus laboratorios." />
        ) : (
          <table className="data">
            <thead><tr><th>Código</th><th>OT</th><th>Informe</th><th>Cliente</th><th>Ingreso</th><th>Vence</th><th>Estado</th><th>Decisión</th></tr></thead>
            <tbody>
              {datos.data.map((a) => (
                <tr key={a.id} style={{ cursor: "pointer" }} tabIndex={0} onClick={() => setSel(a.id)} onKeyDown={(e) => e.key === "Enter" && setSel(a.id)}>
                  <td className="codigo">{a.codigo}</td>
                  <td><Link href={`/ot/${a.otId}` as any} className="codigo" onClick={(e) => e.stopPropagation()}>{a.otCodigo}</Link>{a.unidadCodigo ? ` · ${a.unidadCodigo}` : ""}</td>
                  <td>{a.documento ?? "—"}</td>
                  <td>{a.cliente ?? "—"}</td>
                  <td>{fechaDia(a.fechaIngreso)}</td>
                  <td>{fechaDia(a.venceEl)}{a.fueraDePlazo && <span className="pill red" style={{ marginLeft: 6 }}>fuera de plazo</span>}</td>
                  <td><span className={`pill ${a.estado === "resuelta" ? "green" : "amber"}`}>{a.estado === "resuelta" ? "Resuelta" : "En trámite"}</span></td>
                  <td>{a.decision === "acoge" ? "Acoge" : a.decision === "rechaza" ? "Rechaza" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {nueva && datos && <Nueva plazoDias={datos.plazoDias} onCerrar={() => setNueva(false)} onHecho={async (a, aviso) => { setNueva(false); toast.ok(`Apelación ${a.codigo} registrada.`); if (aviso) toast.info(aviso); await cargar(); setSel(a.id); }} />}
      {sel && <Detalle id={sel} onCerrar={() => setSel(null)} onCambio={cargar} />}
    </div>
  );
}

function Nueva({ plazoDias, onCerrar, onHecho }: { plazoDias: number; onCerrar: () => void; onHecho: (a: Apelacion, aviso?: string | null) => void }) {
  const [codigoOt, setCodigoOt] = useState("");
  const [ot, setOt] = useState<{ id: string; codigo: string } | null>(null);
  const [docs, setDocs] = useState<{ id: string; numero: string | null; codigo: string | null; estado: string }[]>([]);
  const [f, setF] = useState({ certificadoId: "", documentoNumero: "", fechaRecepcionDoc: hoyISO(), fechaIngreso: hoyISO(), fundamento: "", antecedentes: "" });
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function buscarOt() {
    setError("");
    try {
      const r = await llamar<any>("GET", `/ot?q=${encodeURIComponent(codigoOt.trim())}&limit=5`);
      const o = (Array.isArray(r) ? r : r.data ?? []).find((x: any) => String(x.codigo).toUpperCase() === codigoOt.trim().toUpperCase());
      if (!o) return setError(`No se encontró la OT ${codigoOt.trim()} en sus laboratorios.`);
      setOt({ id: o.id, codigo: o.codigo });
      // Los documentos de la OT (Nº del informe de rechazo) se listan desde Documentos.
      const d = await llamar<any>("GET", `/documentos?otId=${o.id}&limit=50`).catch(() => null);
      const nums = ((d?.data ?? []) as any[]).filter((x) => x.origen === "informe").map((x) => x.codigo);
      setDocs(nums.map((n: string) => ({ id: "", numero: n, codigo: n, estado: "oficial" })));
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function guardar() {
    setError("");
    if (!ot) return setError("Busque primero la OT del informe de rechazo.");
    if (!f.certificadoId && !f.documentoNumero.trim()) return setError("Indique el informe de rechazo que se apela.");
    if (f.fundamento.trim().length < 10) return setError("Escriba el fundamento (mínimo 10 caracteres).");
    setOcupado(true);
    try {
      const r = await llamar<Apelacion & { aviso?: string | null }>("POST", "/apelaciones", {
        otId: ot.id,
        certificadoId: f.certificadoId || null,
        documentoNumero: f.documentoNumero.trim() || null,
        fechaRecepcionDoc: f.fechaRecepcionDoc,
        fechaIngreso: f.fechaIngreso,
        fundamento: f.fundamento.trim(),
        antecedentes: f.antecedentes.trim() || null,
      });
      onHecho(r, r.aviso);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Panel titulo="Registrar apelación" onCerrar={onCerrar} ancho={640}>
      {error && <div className="alert warn" role="alert">{error}</div>}
      <div className="form-grid cols-2">
        <div className="field">
          <label htmlFor="ap-ot">OT del informe <span className="req">*</span></label>
          <div style={{ display: "flex", gap: 6 }}>
            <input id="ap-ot" value={codigoOt} onChange={(e) => { setCodigoOt(e.target.value); setOt(null); }} placeholder="OT-2026-…" style={{ flex: 1, minWidth: 0 }} />
            <button type="button" className="btn outline sm" onClick={buscarOt} disabled={!codigoOt.trim()}>Buscar</button>
          </div>
          {ot && <small style={{ color: "var(--muted)" }}>OT {ot.codigo}</small>}
        </div>
        <div className="field">
          <label htmlFor="ap-doc">Informe de rechazo</label>
          {docs.length ? (
            <select id="ap-doc" value={f.documentoNumero} onChange={(e) => setF({ ...f, documentoNumero: e.target.value })}>
              <option value="">— elija —</option>
              {docs.map((d) => <option key={d.codigo ?? ""} value={d.codigo ?? ""}>{d.numero ?? d.codigo}</option>)}
            </select>
          ) : (
            <input id="ap-doc" value={f.documentoNumero} maxLength={80} onChange={(e) => setF({ ...f, documentoNumero: e.target.value })} placeholder="Nº del informe" />
          )}
        </div>
        <div className="field"><label htmlFor="ap-rec">Recepción del informe por el cliente <span className="req">*</span></label><input id="ap-rec" type="date" value={f.fechaRecepcionDoc} onChange={(e) => setF({ ...f, fechaRecepcionDoc: e.target.value })} /></div>
        <div className="field"><label htmlFor="ap-ing">Ingreso de la apelación <span className="req">*</span></label><input id="ap-ing" type="date" value={f.fechaIngreso} onChange={(e) => setF({ ...f, fechaIngreso: e.target.value })} /></div>
        <p style={{ gridColumn: "1 / -1", margin: 0, fontSize: 12, color: "var(--muted)" }}>Plazo: {plazoDias} días hábiles desde la recepción del informe. Fuera de plazo se registra igual, con la marca, y la decide el Director.</p>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="ap-fund">Fundamento <span className="req">*</span></label>
          <textarea id="ap-fund" rows={4} maxLength={10000} value={f.fundamento} onChange={(e) => setF({ ...f, fundamento: e.target.value })} />
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="ap-ant">Antecedentes (los archivos se adjuntan después)</label>
          <textarea id="ap-ant" rows={2} maxLength={5000} value={f.antecedentes} onChange={(e) => setF({ ...f, antecedentes: e.target.value })} />
        </div>
      </div>
      <div className="toolbar" style={{ marginTop: 12 }}>
        <button className="btn outline sm" onClick={onCerrar}>Cancelar</button>
        <div className="spacer" />
        <button className="btn primary sm" disabled={ocupado} onClick={guardar}>{ocupado ? "Registrando…" : "Registrar apelación → Director"}</button>
      </div>
    </Panel>
  );
}

function Detalle({ id, onCerrar, onCambio }: { id: string; onCerrar: () => void; onCambio: () => Promise<void> }) {
  const { puede } = usePermisos();
  const [a, setA] = useState<Apelacion | null>(null);
  const [r, setR] = useState({ decision: "", resolucionFecha: hoyISO(), resolucionTexto: "" });
  const [ocupado, setOcupado] = useState(false);
  const cargar = useCallback(async () => {
    try { setA((await llamar<{ data: Apelacion[] }>("GET", "/apelaciones")).data.find((x) => x.id === id) ?? null); } catch (e: any) { toast.error(e.message); }
  }, [id]);
  useEffect(() => void cargar(), [cargar]);
  if (!a) return null;

  async function resolver() {
    if (!r.decision) return toast.error("Elija la decisión.");
    setOcupado(true);
    try {
      setA(await llamar<Apelacion>("POST", `/apelaciones/${id}/resolver`, { ...r, resolucionTexto: r.resolucionTexto.trim() }));
      toast.ok("Apelación resuelta.");
      await onCambio();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }
  async function adjuntar(archivo: File) {
    const f = new FormData();
    f.append("archivo", archivo, archivo.name);
    try {
      setA(await subirFormulario<Apelacion>(`/apelaciones/${id}/adjuntos`, f));
      toast.ok("Antecedente adjuntado.");
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  return (
    <Panel titulo={<><span className="codigo">{a.codigo}</span> · OT {a.otCodigo}</>} modo="drawer" ancho={640} onCerrar={onCerrar}>
      <p style={{ margin: "0 0 6px", fontSize: 12.5 }}>
        Informe {a.documento ?? "—"} · recibido el {fechaDia(a.fechaRecepcionDoc)} · apelación el {fechaDia(a.fechaIngreso)} · vence el {fechaDia(a.venceEl)} ({a.plazoDias} días hábiles)
        {a.fueraDePlazo && <span className="pill red" style={{ marginLeft: 6 }}>fuera de plazo</span>}
      </p>
      <h3 style={{ fontSize: 13, margin: "8px 0 4px" }}>Fundamento</h3>
      <div style={{ whiteSpace: "pre-wrap" }}>{a.fundamento}</div>
      {a.antecedentes && <><h3 style={{ fontSize: 13, margin: "8px 0 4px" }}>Antecedentes</h3><div style={{ whiteSpace: "pre-wrap" }}>{a.antecedentes}</div></>}
      <ul style={{ paddingLeft: 18 }}>
        {(a.adjuntos ?? []).map((x) => (
          <li key={x.id}><button type="button" style={{ background: "none", border: 0, padding: 0, color: "var(--accent)", textDecoration: "underline", cursor: "pointer" }}
            onClick={() => descargarAdjunto(`/apelaciones/${id}/adjuntos/${x.id}`, x.nombre).catch((e) => toast.error(e.message))}>{x.nombre}</button></li>
        ))}
      </ul>
      {a.estado === "registrada" && puede("apelacion.registrar") && (
        <div className="field">
          <label htmlFor="ap-arch">Adjuntar antecedente (PDF o imagen, máx. 5 MB)</label>
          <input id="ap-arch" type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => { const x = e.target.files?.[0]; if (x) void adjuntar(x); e.target.value = ""; }} />
        </div>
      )}
      {a.estado === "resuelta" ? (
        <div className={`alert ${a.decision === "acoge" ? "success" : "warn"}`} style={{ marginTop: 10 }}>
          El Director <b>{a.decision === "acoge" ? "acoge" : "rechaza"}</b> la apelación ({a.resolucionFecha ? fechaDia(a.resolucionFecha) : ""}{a.resueltaPor ? `, ${a.resueltaPor}` : ""}): {a.resolucionTexto}
        </div>
      ) : puede("apelacion.resolver") ? (
        <div className="card" style={{ padding: 10, marginTop: 10 }}>
          <h3 style={{ fontSize: 13, margin: "0 0 6px" }}>Resolución del Director</h3>
          <div className="form-grid cols-2">
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend style={{ fontSize: 12, fontWeight: 600 }}>Decisión <span className="req">*</span></legend>
              <label style={{ display: "flex", gap: 6, fontWeight: 400 }}><input type="radio" name="ap-dec" style={{ width: "auto" }} checked={r.decision === "acoge"} onChange={() => setR({ ...r, decision: "acoge" })} /> Acoge</label>
              <label style={{ display: "flex", gap: 6, fontWeight: 400 }}><input type="radio" name="ap-dec" style={{ width: "auto" }} checked={r.decision === "rechaza"} onChange={() => setR({ ...r, decision: "rechaza" })} /> Rechaza</label>
            </fieldset>
            <div className="field"><label htmlFor="ap-rf">Fecha de la resolución <span className="req">*</span></label><input id="ap-rf" type="date" value={r.resolucionFecha} onChange={(e) => setR({ ...r, resolucionFecha: e.target.value })} /></div>
            <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="ap-rt">Resolución <span className="req">*</span></label><textarea id="ap-rt" rows={3} maxLength={10000} value={r.resolucionTexto} onChange={(e) => setR({ ...r, resolucionTexto: e.target.value })} /></div>
          </div>
          <div className="toolbar" style={{ marginTop: 8 }}><div className="spacer" /><button className="btn primary sm" disabled={ocupado} onClick={resolver}>Resolver → cerrar</button></div>
        </div>
      ) : (
        <p className="subtitle">En trámite: la resuelve el Director.</p>
      )}
      <p style={{ fontSize: 11.5, color: "var(--muted)" }}>Registrada por {a.registradaPor ?? "—"} el {fechaHora(a.registradaAt)}.</p>
    </Panel>
  );
}
