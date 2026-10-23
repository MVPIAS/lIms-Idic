"use client";

/**
 * Ficha de una especificación técnica del cliente (EP-05 5.1, EP-03 1.3 y 3.6):
 * datos y PDF de la versión, requisitos por punto (Punto · Componente ·
 * Característica · Ensayo · Tipo · Requisito · Unidad · Defecto), versiones y
 * OT que la usan. El borrador se edita y se publica («Publicar → vigente»); la
 * vigente se congela y se cambia con «Nueva versión» (con motivo).
 * API: /especificaciones-tecnicas/:id (et.ver; editar: et.gestionar).
 */
import ClienteEt, { type ClienteElegido } from "../_components/ClienteEt";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import PasosProceso from "@/components/ui/PasosProceso";
import Modal from "@/components/documentos/Modal";
import { toast } from "@/components/ui/feedback";
import { llamar, qs } from "@/lib/laboratorio";
import { enviarInforme, imagenConSesion } from "@/lib/informes";
import { fechaDia, fechaHora } from "@/lib/format";
import {
  CLASE_DEFECTO,
  ESTADO_ET,
  ORIGEN_ET,
  TIPO_PUNTO,
  coma,
  leerNumero,
  textoRequisito,
  type ClaseDefecto,
  type EstadoEt,
  type TipoPunto,
} from "@/lib/especificaciones";

interface Punto {
  punto: string;
  componente: string;
  caracteristica: string;
  catMetodoId: string | null;
  catAnalitoId: string | null;
  metodoCodigo?: string | null;
  metodoNombre?: string | null;
  analitoNombre?: string | null;
  tipo: TipoPunto;
  limiteInf: string;
  nominal: string;
  limiteSup: string;
  unidad: string;
  requisito: string;
  cond2Etiqueta: string;
  cond2Inf: number | null;
  cond2Sup: number | null;
  cond2Unidad: string;
  planN: number | null;
  planC: number | null;
  planM: number | null;
  planMM: number | null;
  claseDefecto: ClaseDefecto | null;
  observacion: string;
}
interface Et {
  id: string;
  codigo: string;
  version: number;
  nombre: string;
  origen: string;
  clienteId: string | null;
  clienteNombre: string | null;
  mandante: string | null;
  licitacion: string | null;
  producto: string | null;
  laboratorios: string[];
  laboratoriosCodigos: string[];
  reutilizable: boolean;
  estado: EstadoEt;
  vigenteDesde: string | null;
  observaciones: string | null;
  motivoVersion: string | null;
  creadaPorNombre: string | null;
  createdAt: string;
  publicadaAt: string | null;
  publicadaPorNombre: string | null;
  anuladaMotivo: string | null;
  pdf: { nombre: string; bytes: number; subidoAt: string } | null;
  puntos: any[];
  versiones: { id: string; version: number; estado: EstadoEt; publicadaAt: string | null; motivoVersion: string | null }[];
  uso: { id: string; codigo: string; estado: string }[];
  laboratorios_?: never;
  erroresPublicar: string[];
  acciones: { editar: boolean; publicar: boolean; nuevaVersion: boolean; anular: boolean; subirPdf: boolean };
}

const vacioPunto = (): Punto => ({
  punto: "", componente: "", caracteristica: "", catMetodoId: null, catAnalitoId: null, tipo: "numerico",
  limiteInf: "", nominal: "", limiteSup: "", unidad: "", requisito: "", cond2Etiqueta: "", cond2Inf: null, cond2Sup: null, cond2Unidad: "",
  planN: null, planC: null, planM: null, planMM: null, claseDefecto: null, observacion: "",
});
const aPunto = (p: any): Punto => ({
  ...vacioPunto(),
  ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v ?? (typeof (vacioPunto() as any)[k] === "string" ? "" : null)])),
});
/** Cuerpo de PUT /puntos: vacíos → null y solo lo que el tipo usa. */
const cuerpoPunto = (p: Punto) => ({
  punto: p.punto.trim(), componente: p.componente.trim() || null, caracteristica: p.caracteristica.trim(),
  catMetodoId: p.catMetodoId, catAnalitoId: p.catAnalitoId, tipo: p.tipo,
  limiteInf: p.limiteInf.trim() || null, nominal: p.nominal.trim() || null, limiteSup: p.limiteSup.trim() || null,
  unidad: p.unidad.trim() || null, requisito: p.requisito.trim() || null,
  cond2Etiqueta: p.tipo === "numerico" ? p.cond2Etiqueta.trim() || null : null,
  cond2Inf: p.tipo === "numerico" ? p.cond2Inf : null, cond2Sup: p.tipo === "numerico" ? p.cond2Sup : null,
  cond2Unidad: p.tipo === "numerico" ? p.cond2Unidad.trim() || null : null,
  planN: p.tipo === "clases" ? p.planN : null, planC: p.tipo === "clases" ? p.planC : null,
  planM: p.tipo === "clases" ? p.planM : null, planMM: p.tipo === "clases" ? p.planMM : null,
  claseDefecto: p.claseDefecto, observacion: p.observacion.trim() || null,
});

export default function FichaEtPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [et, setEt] = useState<Et | null>(null);
  const [error, setError] = useState("");
  const [puntos, setPuntos] = useState<Punto[]>([]);
  const [sucio, setSucio] = useState(false);
  const [editando, setEditando] = useState<number | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [dialogo, setDialogo] = useState<"version" | "anular" | null>(null);

  const recibir = useCallback((d: Et) => {
    setEt(d);
    setPuntos(d.puntos.map(aPunto));
    setSucio(false);
    setEditando(null);
  }, []);
  const cargar = useCallback(async () => {
    try { recibir(await llamar<Et>("GET", `/especificaciones-tecnicas/${id}`)); setError(""); }
    catch (e: any) { setError(e.message); }
  }, [id, recibir]);
  useEffect(() => { cargar(); }, [cargar]);

  // Aviso al salir con puntos sin guardar.
  useEffect(() => {
    if (!sucio) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [sucio]);

  const editable = !!et?.acciones.editar;

  async function accion(fn: () => Promise<Et>, ok: string) {
    setOcupado(true);
    try { recibir(await fn()); toast.ok(ok); }
    catch (e: any) { toast.error(e.message); }
    finally { setOcupado(false); }
  }
  const guardarPuntos = () => accion(() => llamar("PUT", `/especificaciones-tecnicas/${id}/puntos`, { puntos: puntos.map(cuerpoPunto) }), "Puntos guardados.");
  const publicar = () => accion(() => llamar("POST", `/especificaciones-tecnicas/${id}/publicar`), "E.T. publicada: ya se puede elegir en las OT.");

  async function verPdf() {
    try {
      const url = await imagenConSesion(`especificaciones-tecnicas/${id}/pdf`);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: any) { toast.error(`No se pudo abrir el PDF (${e.message}).`); }
  }
  const pdfRef = useRef<HTMLInputElement>(null);
  async function subirPdf() {
    const a = pdfRef.current?.files?.[0];
    if (!a) return toast.error("Elija el PDF de la E.T.");
    if (a.type && a.type !== "application/pdf") return toast.error("El archivo debe ser un PDF.");
    if (a.size > 10 * 1024 * 1024) return toast.error("El PDF no puede superar 10 MB.");
    const form = new FormData();
    form.append("archivo", a, a.name);
    await accion(() => enviarInforme(`/especificaciones-tecnicas/${id}/pdf`, "POST", form), "PDF adjuntado.");
    if (pdfRef.current) pdfRef.current.value = "";
  }

  const paso = !et ? 1 : et.estado === "borrador" ? 2 : 3;
  const componentes = useMemo(() => [...new Set(puntos.map((p) => p.componente.trim()).filter(Boolean))], [puntos]);

  if (!et) return <div>{error ? <div className="alert warn" role="alert">{error}</div> : <p className="subtitle">Cargando la E.T.…</p>}</div>;
  const est = ESTADO_ET[et.estado];

  return (
    <div>
      <PageHeader
        icono="📘"
        titulo={<>{et.codigo} <span style={{ fontWeight: 400, color: "var(--muted)" }}>v{et.version}</span> <span className={`pill ${est.pill}`} title={est.ayuda} style={{ verticalAlign: "middle" }}>{est.texto}</span></>}
        subtitulo={et.nombre}
        migas={[{ label: "Laboratorio" }, { label: "Especificaciones técnicas", href: "/especificaciones" }, { label: `${et.codigo} v${et.version}` }]}
        acciones={
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {et.acciones.nuevaVersion && <button type="button" className="btn outline sm" disabled={ocupado} onClick={() => setDialogo("version")}>Nueva versión</button>}
            {et.acciones.anular && <button type="button" className="btn ghost-danger sm" disabled={ocupado} onClick={() => setDialogo("anular")}>Anular</button>}
          </div>
        }
      />
      <PasosProceso
        etiqueta="Ciclo de la especificación técnica"
        pasos={[
          { titulo: "Datos y PDF", detalle: et.creadaPorNombre ? `Creó ${et.creadaPorNombre}` : null },
          { titulo: "Requisitos por punto", detalle: `${et.puntos.length} punto(s)` },
          { titulo: "Vigente en las OT", detalle: et.publicadaAt ? `Desde ${fechaDia(et.vigenteDesde ?? et.publicadaAt)}` : "Al publicar" },
        ]}
        actual={paso}
        completo={et.estado !== "borrador"}
        anulado={et.estado === "anulada"}
      />
      {error && <div className="alert warn" role="alert">{error}</div>}
      {et.estado === "reemplazada" && (
        <div className="alert info">Esta versión fue reemplazada por una posterior. Las OT que la eligieron la conservan; las nuevas eligen la vigente.</div>
      )}
      {et.estado === "anulada" && <div className="alert warn">Anulada{et.anuladaMotivo ? ` · ${et.anuladaMotivo}` : ""}. Ya no se puede elegir.</div>}
      {et.motivoVersion && <p className="subtitle" style={{ margin: "0 0 10px" }}>Motivo de esta versión: {et.motivoVersion}</p>}

      <div className="split-2" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: 13, alignItems: "start" }}>
        <DatosEt et={et} editable={editable} onGuardado={recibir} />
        <div className="card" style={{ margin: 0 }}>
          <h2>Documento de la E.T.</h2>
          {et.pdf ? (
            <p style={{ margin: "0 0 8px", fontSize: 12.5 }}>
              📄 <button type="button" className="btn outline sm" onClick={verPdf}>Abrir {et.pdf.nombre}</button>
              <span style={{ display: "block", fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>
                {et.pdf.bytes < 1024 ? "menos de 1" : (et.pdf.bytes / 1024).toLocaleString("es-CL", { maximumFractionDigits: 0 })} KB · subido el {fechaHora(et.pdf.subidoAt)}
              </span>
            </p>
          ) : (
            <p className="subtitle" style={{ margin: "0 0 8px" }}>Sin PDF.</p>
          )}
          {et.acciones.subirPdf && (
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="et-pdf">{et.pdf ? "Reemplazar el PDF" : "Adjuntar el PDF (máx. 10 MB)"}</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <input id="et-pdf" ref={pdfRef} type="file" accept="application/pdf" disabled={ocupado} />
                <button type="button" className="btn outline sm" disabled={ocupado} onClick={subirPdf}>Subir PDF</button>
              </div>
            </div>
          )}
          <h2 style={{ marginTop: 14 }}>Versiones</h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 12.5 }}>
            {et.versiones.map((v) => (
              <li key={v.id} style={{ padding: "3px 0" }}>
                {v.id === et.id ? <b>v{v.version}</b> : <Link href={`/especificaciones/${v.id}` as any} style={{ color: "var(--accent)" }}>v{v.version}</Link>}{" "}
                <span className={`pill ${ESTADO_ET[v.estado].pill}`}>{ESTADO_ET[v.estado].texto}</span>
                {v.publicadaAt && <span style={{ color: "var(--muted)", fontSize: 11.5 }}> · {fechaDia(v.publicadaAt)}</span>}
              </li>
            ))}
          </ul>
          <h2 style={{ marginTop: 14 }}>OT que la usan</h2>
          {et.uso.length ? (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 12.5, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {et.uso.map((o) => <li key={o.id}><Link href={`/ot/${o.id}` as any} className="codigo" style={{ color: "var(--accent)" }}>{o.codigo}</Link></li>)}
            </ul>
          ) : <p className="subtitle" style={{ margin: 0 }}>Ninguna todavía.</p>}
        </div>
      </div>

      <div className="card">
        <h2>
          Requisitos por punto
          <span className="right">{componentes.length ? `Componentes: ${componentes.join(" · ")}` : "Sin componentes: todo es del producto"}</span>
        </h2>
        <p className="subtitle" style={{ margin: "0 0 8px" }}>
          Cada ensayo de la OT toma el requisito del punto con su mismo analito (o del método, si tiene uno solo). Las inspecciones son el checklist del producto; los componentes se desglosan como submuestras.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Punto</th><th scope="col">Componente</th><th scope="col">Característica</th><th scope="col">Ensayo</th>
                <th scope="col">Tipo</th><th scope="col">Requisito</th><th scope="col">Defecto</th>{editable && <th scope="col"><span className="sr-only">Acciones</span></th>}
              </tr>
            </thead>
            <tbody>
              {puntos.length === 0 && (
                <tr><td colSpan={editable ? 8 : 7} style={{ color: "var(--muted)" }}>{editable ? "Agregue el primer punto con «＋ Agregar punto»." : "Sin puntos."}</td></tr>
              )}
              {puntos.map((p, i) => (
                <tr key={i} style={editando === i ? { background: "#eef8fa" } : undefined}>
                  <td className="codigo">{p.punto || "—"}</td>
                  <td>{p.componente || <span style={{ color: "var(--muted)" }}>Producto</span>}</td>
                  <td>{p.caracteristica}</td>
                  <td>
                    {p.metodoNombre ? <>{p.metodoCodigo} · {p.metodoNombre}{p.analitoNombre ? <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{p.analitoNombre}</div> : null}</>
                      : <span className="pill amber" title="Sin ensayo del catálogo no se puede capturar">Sin ensayo</span>}
                  </td>
                  <td>{TIPO_PUNTO[p.tipo].texto}</td>
                  <td>{textoRequisito(p)}</td>
                  <td>{p.claseDefecto ? <span className={`pill ${CLASE_DEFECTO[p.claseDefecto].pill}`}>{CLASE_DEFECTO[p.claseDefecto].texto}</span> : "—"}</td>
                  {editable && (
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button type="button" className="btn outline sm" onClick={() => setEditando(i)} aria-label={`Editar el punto ${p.punto}`}>Editar</button>{" "}
                      <button type="button" className="btn ghost-danger sm" aria-label={`Quitar el punto ${p.punto}`}
                        onClick={() => { setPuntos((xs) => xs.filter((_, j) => j !== i)); setSucio(true); setEditando(null); }}>Quitar</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {editable && editando !== null && (
          <EditorPunto
            key={editando}
            inicial={puntos[editando] ?? vacioPunto()}
            laboratorios={et.laboratorios}
            componentes={componentes}
            onCancelar={() => { if (!puntos[editando]?.caracteristica) setPuntos((xs) => xs.filter((_, j) => j !== editando)); setEditando(null); }}
            onListo={(p) => { setPuntos((xs) => xs.map((x, j) => (j === editando ? p : x))); setSucio(true); setEditando(null); }}
          />
        )}
        {editable && (
          <div className="toolbar" style={{ marginTop: 10, marginBottom: 0 }}>
            <button type="button" className="btn outline sm" disabled={editando !== null} onClick={() => { setPuntos((xs) => [...xs, vacioPunto()]); setEditando(puntos.length); }}>＋ Agregar punto</button>
            <span className="spacer" />
            {sucio && <span className="pill amber" role="status">Cambios sin guardar</span>}
            <button type="button" className="btn primary sm" disabled={ocupado || !sucio || editando !== null} onClick={guardarPuntos}>Guardar puntos</button>
          </div>
        )}
        {et.estado === "borrador" && et.erroresPublicar.length > 0 && !sucio && (
          <div className="alert warn" style={{ marginTop: 10 }}>
            <b>Para publicar falta:</b>
            <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>{et.erroresPublicar.map((e) => <li key={e}>{e}</li>)}</ul>
          </div>
        )}
        {et.acciones.publicar && (
          <div className="toolbar" style={{ marginTop: 10, marginBottom: 0, justifyContent: "flex-end" }}>
            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Al publicar, la versión vigente anterior queda reemplazada.</span>
            <button type="button" className="btn primary" disabled={ocupado || sucio || et.erroresPublicar.length > 0} onClick={publicar}>Publicar → vigente</button>
          </div>
        )}
      </div>

      {dialogo && (
        <DialogoMotivo
          titulo={dialogo === "version" ? `Nueva versión de ${et.codigo}` : `Anular ${et.codigo} v${et.version}`}
          texto={dialogo === "version"
            ? "Se crea un borrador con la versión siguiente y una copia de los puntos (sin el PDF). La versión vigente sigue rigiendo hasta que publique la nueva."
            : "La E.T. ya no se podrá elegir. Las OT que la usan la conservan."}
          boton={dialogo === "version" ? "Crear versión → editar" : "Anular"}
          peligro={dialogo === "anular"}
          onCerrar={() => setDialogo(null)}
          onConfirmar={async (motivo) => {
            setOcupado(true);
            try {
              const r = await llamar<Et>("POST", `/especificaciones-tecnicas/${id}/${dialogo === "version" ? "nueva-version" : "anular"}`, { motivo });
              setDialogo(null);
              if (dialogo === "version") { toast.ok(`Borrador v${r.version} creado.`); router.push(`/especificaciones/${r.id}` as any); }
              else { recibir(r); toast.ok("E.T. anulada."); }
            } catch (e: any) { toast.error(e.message); }
            finally { setOcupado(false); }
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------- datos de la E.T. --- */

function DatosEt({ et, editable, onGuardado }: { et: Et; editable: boolean; onGuardado: (e: Et) => void }) {
  const [f, setF] = useState({ nombre: et.nombre, producto: et.producto ?? "", licitacion: et.licitacion ?? "", mandante: et.mandante ?? "", observaciones: et.observaciones ?? "", reutilizable: et.reutilizable });
  const [guardando, setGuardando] = useState(false);
  // B-036: el cliente de la E.T. se fija o corrige en borrador.
  const [cliente, setCliente] = useState<ClienteElegido | null>(et.clienteId ? { id: et.clienteId, nombre: et.clienteNombre ?? "" } : null);
  useEffect(() => {
    setCliente(et.clienteId ? { id: et.clienteId, nombre: et.clienteNombre ?? "" } : null);
    setF({ nombre: et.nombre, producto: et.producto ?? "", licitacion: et.licitacion ?? "", mandante: et.mandante ?? "", observaciones: et.observaciones ?? "", reutilizable: et.reutilizable });
  }, [et]);
  const cambio = f.nombre !== et.nombre || f.producto !== (et.producto ?? "") || f.licitacion !== (et.licitacion ?? "") || f.mandante !== (et.mandante ?? "")
    || f.observaciones !== (et.observaciones ?? "") || f.reutilizable !== et.reutilizable || (cliente?.id ?? null) !== (et.clienteId ?? null);
  async function guardar() {
    setGuardando(true);
    try {
      onGuardado(await llamar<Et>("PUT", `/especificaciones-tecnicas/${et.id}`, {
        nombre: f.nombre.trim(), producto: f.producto.trim() || null, licitacion: f.licitacion.trim() || null, mandante: f.mandante.trim() || null,
        observaciones: f.observaciones.trim() || null, reutilizable: f.reutilizable, clienteId: cliente?.id ?? null,
      }));
      toast.ok("Datos de la E.T. guardados.");
    } catch (e: any) { toast.error(e.message); }
    finally { setGuardando(false); }
  }
  const ro = !editable;
  return (
    <div className="card" style={{ margin: 0 }}>
      <h2>Datos de la E.T. <span className="right">{ORIGEN_ET[et.origen] ?? et.origen}</span></h2>
      <div className="form-grid cols-2">
        <div className={`field${ro ? " readonly" : ""}`} style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="et-nombre">Nombre</label>
          <input id="et-nombre" value={f.nombre} readOnly={ro} maxLength={300} onChange={(e) => setF({ ...f, nombre: e.target.value })} />
        </div>
        <ClienteEt id="et-cliente" valor={cliente} onChange={setCliente} soloLectura={ro} />
        <div className="field readonly"><label>Laboratorios</label><input value={et.laboratoriosCodigos.join(", ") || "General (todos)"} readOnly /></div>
        <div className={`field${ro ? " readonly" : ""}`}>
          <label htmlFor="et-producto">Producto</label>
          <input id="et-producto" value={f.producto} readOnly={ro} maxLength={240} onChange={(e) => setF({ ...f, producto: e.target.value })} />
        </div>
        <div className={`field${ro ? " readonly" : ""}`}>
          <label htmlFor="et-licitacion">Licitación o contrato</label>
          <input id="et-licitacion" value={f.licitacion} readOnly={ro} maxLength={120} onChange={(e) => setF({ ...f, licitacion: e.target.value })} />
        </div>
        <div className={`field${ro ? " readonly" : ""}`}>
          <label htmlFor="et-mandante">Mandante</label>
          <input id="et-mandante" value={f.mandante} readOnly={ro} maxLength={120} onChange={(e) => setF({ ...f, mandante: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="et-reutilizable">Reutilizable en otras OT</label>
          <select id="et-reutilizable" value={f.reutilizable ? "si" : "no"} disabled={ro} onChange={(e) => setF({ ...f, reutilizable: e.target.value === "si" })}>
            <option value="si">Sí, en OT de cualquier cliente</option>
            <option value="no">No, solo en OT de su cliente</option>
          </select>
          {!f.reutilizable && !cliente && <small style={{ color: "#7a4b00" }}>Indique el cliente: una E.T. no reutilizable solo se aplica en las OT de su cliente.</small>}
        </div>
        <div className={`field${ro ? " readonly" : ""}`} style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="et-obs">Observaciones</label>
          <textarea id="et-obs" rows={2} value={f.observaciones} readOnly={ro} maxLength={4000} onChange={(e) => setF({ ...f, observaciones: e.target.value })} />
        </div>
      </div>
      {editable && (
        <div className="toolbar" style={{ marginTop: 8, marginBottom: 0, justifyContent: "flex-end" }}>
          <button type="button" className="btn outline sm" disabled={!cambio || guardando} onClick={guardar}>Guardar datos</button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------- editor de punto --- */

interface MetodoCat { id: string; codigo: string; nombre: string; norma: string | null; ensayo: string | null; analitos: { id: string; nombre: string; unidad: string | null; catalogoMin: string | null; catalogoMax: string | null }[] }

function EditorPunto({ inicial, laboratorios, componentes, onCancelar, onListo }: {
  inicial: Punto; laboratorios: string[]; componentes: string[]; onCancelar: () => void; onListo: (p: Punto) => void;
}) {
  const [p, setP] = useState<Punto>(inicial);
  const [busca, setBusca] = useState("");
  const [metodos, setMetodos] = useState<MetodoCat[]>([]);
  const [metodo, setMetodo] = useState<MetodoCat | null>(null);
  const [error, setError] = useState("");
  const set = <K extends keyof Punto>(k: K, v: Punto[K]) => setP((x) => ({ ...x, [k]: v }));

  // Métodos del catálogo: los del laboratorio de la E.T. (o búsqueda en todo el catálogo).
  useEffect(() => {
    const t = setTimeout(() => {
      const lab = laboratorios.length === 1 ? laboratorios[0] : undefined;
      if (!lab && busca.trim().length < 2) { setMetodos([]); return; }
      llamar<{ metodos: MetodoCat[] }>("GET", `/especificaciones-tecnicas/catalogo/metodos${qs({ laboratorio: lab, q: busca.trim() })}`)
        .then((r) => setMetodos(r.metodos)).catch(() => setMetodos([]));
    }, 250);
    return () => clearTimeout(t);
  }, [busca, laboratorios]);
  useEffect(() => {
    if (p.catMetodoId && !metodo) {
      const m = metodos.find((x) => x.id === p.catMetodoId);
      if (m) setMetodo(m);
    }
  }, [metodos, p.catMetodoId, metodo]);

  const analito = metodo?.analitos.find((a) => a.id === p.catAnalitoId) ?? (metodo?.analitos.length === 1 ? metodo.analitos[0] : null);

  function listo() {
    if (!p.punto.trim()) return setError("Indique el punto de la E.T. (p. ej. «7.2.1»).");
    if (!p.caracteristica.trim()) return setError("Indique la característica.");
    onListo({
      ...p,
      metodoCodigo: metodo?.codigo ?? p.metodoCodigo ?? null,
      metodoNombre: metodo?.nombre ?? p.metodoNombre ?? null,
      analitoNombre: metodo ? (metodo.analitos.find((a) => a.id === p.catAnalitoId)?.nombre ?? null) : p.analitoNombre ?? null,
    });
  }

  const num = (v: number | null) => (v == null ? "" : coma(v));
  return (
    <div className="card" style={{ margin: "10px 0 0", borderColor: "var(--accent)", background: "#fbfeff" }} role="group" aria-label="Editar punto">
      <h2 style={{ fontSize: 13.5 }}>{inicial.caracteristica ? `Punto ${inicial.punto}` : "Nuevo punto"}</h2>
      {error && <div className="alert warn" role="alert">{error}</div>}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="ep-punto">Punto <span className="req">*</span></label>
          <input id="ep-punto" value={p.punto} maxLength={40} onChange={(e) => set("punto", e.target.value)} placeholder="7.2.1" />
        </div>
        <div className="field">
          <label htmlFor="ep-comp">Componente</label>
          <input id="ep-comp" list="ep-componentes" value={p.componente} maxLength={120} disabled={p.tipo === "inspeccion"}
            onChange={(e) => set("componente", e.target.value)} placeholder="Vacío = el producto" />
          <datalist id="ep-componentes">{componentes.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
        <div className="field" style={{ gridColumn: "span 2" }}>
          <label htmlFor="ep-car">Característica <span className="req">*</span></label>
          <input id="ep-car" value={p.caracteristica} maxLength={300} onChange={(e) => set("caracteristica", e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="ep-tipo">Tipo</label>
          <select id="ep-tipo" value={p.tipo} onChange={(e) => set("tipo", e.target.value as TipoPunto)}>
            {(Object.keys(TIPO_PUNTO) as TipoPunto[]).map((t) => <option key={t} value={t}>{TIPO_PUNTO[t].texto}</option>)}
          </select>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>{TIPO_PUNTO[p.tipo].ayuda}</span>
        </div>
        <div className="field">
          <label htmlFor="ep-clase">Clase de defecto si no cumple</label>
          <select id="ep-clase" value={p.claseDefecto ?? ""} onChange={(e) => set("claseDefecto", (e.target.value || null) as ClaseDefecto | null)}>
            <option value="">Sin clase</option>
            {(Object.keys(CLASE_DEFECTO) as ClaseDefecto[]).map((c) => <option key={c} value={c}>{CLASE_DEFECTO[c].texto}</option>)}
          </select>
        </div>
      </div>

      <fieldset style={{ border: "1px solid var(--line)", borderRadius: 7, padding: "8px 10px", margin: "10px 0" }}>
        <legend style={{ fontSize: 11.5, fontWeight: 600, padding: "0 4px" }}>Ensayo del catálogo</legend>
        {p.catMetodoId && (metodo || p.metodoNombre) ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12.5 }}>
            <b>{metodo?.codigo ?? p.metodoCodigo} · {metodo?.nombre ?? p.metodoNombre}</b>
            {metodo && metodo.analitos.length > 1 && (
              <select aria-label="Analito" value={p.catAnalitoId ?? ""} onChange={(e) => set("catAnalitoId", e.target.value || null)}>
                <option value="">Todo el método (solo si tiene un analito)</option>
                {metodo.analitos.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
              </select>
            )}
            {analito && (analito.catalogoMin || analito.catalogoMax) && (
              <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Catálogo: {analito.catalogoMin ? `Mín ${coma(analito.catalogoMin)}` : ""} {analito.catalogoMax ? `Máx ${coma(analito.catalogoMax)}` : ""}</span>
            )}
            <button type="button" className="btn outline sm" onClick={() => { set("catMetodoId", null); set("catAnalitoId", null); setMetodo(null); }}>Cambiar</button>
          </div>
        ) : (
          <>
            <label className="sr-only" htmlFor="ep-busca">Buscar método</label>
            <input id="ep-busca" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por código, nombre o ensayo"
              style={{ width: "100%", padding: "6px 9px", border: "1px solid var(--line)", borderRadius: 5 }} />
            {metodos.length > 0 && (
              <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0, maxHeight: 180, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 5 }}>
                {metodos.slice(0, 60).map((m) => (
                  <li key={m.id}>
                    <button type="button" style={{ width: "100%", textAlign: "left", border: "none", background: "none", padding: "5px 8px", cursor: "pointer", fontSize: 12 }}
                      onClick={() => {
                        setMetodo(m);
                        setP((x) => ({ ...x, catMetodoId: m.id, catAnalitoId: m.analitos.length === 1 ? m.analitos[0].id : null, unidad: x.unidad || m.analitos[0]?.unidad || "" }));
                      }}>
                      <b>{m.codigo}</b> · {m.nombre} <span style={{ color: "var(--muted)" }}>· {m.analitos.length} analito(s)</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <span style={{ fontSize: 11, color: "var(--muted)" }}>Sin ensayo del catálogo, el punto queda en la E.T. pero no se puede capturar.</span>
          </>
        )}
      </fieldset>

      {p.tipo === "clases" ? (
        <div className="form-grid">
          {([["planN", "n · unidades"], ["planC", "c · admitidas entre m y M"], ["planM", "m"], ["planMM", "M (vacío = 2 clases)"]] as const).map(([k, l]) => (
            <div className="field" key={k}>
              <label htmlFor={`ep-${k}`}>{l}</label>
              <input id={`ep-${k}`} inputMode="decimal" value={num(p[k])} onChange={(e) => set(k, leerNumero(e.target.value))} />
            </div>
          ))}
          <div className="field">
            <label htmlFor="ep-unidad">Unidad</label>
            <input id="ep-unidad" value={p.unidad} maxLength={30} onChange={(e) => set("unidad", e.target.value)} placeholder="ufc/g" />
          </div>
        </div>
      ) : p.tipo === "numerico" ? (
        <>
          <div className="form-grid">
            <div className="field"><label htmlFor="ep-min">Mín</label><input id="ep-min" inputMode="decimal" value={p.limiteInf} onChange={(e) => set("limiteInf", e.target.value)} /></div>
            <div className="field"><label htmlFor="ep-nom">Nominal</label><input id="ep-nom" inputMode="decimal" value={p.nominal} onChange={(e) => set("nominal", e.target.value)} /></div>
            <div className="field"><label htmlFor="ep-max">Máx</label><input id="ep-max" inputMode="decimal" value={p.limiteSup} onChange={(e) => set("limiteSup", e.target.value)} /></div>
            <div className="field"><label htmlFor="ep-unidad">Unidad</label><input id="ep-unidad" value={p.unidad} maxLength={30} onChange={(e) => set("unidad", e.target.value)} /></div>
          </div>
          <fieldset style={{ border: "1px dashed var(--line)", borderRadius: 7, padding: "6px 10px", margin: "8px 0 0" }}>
            <legend style={{ fontSize: 11.5, fontWeight: 600, padding: "0 4px" }}>Segunda condición de la misma fila (opcional) · «X kgf con Y mm»</legend>
            <div className="form-grid">
              <div className="field"><label htmlFor="ep-c2e">Qué se mide</label><input id="ep-c2e" value={p.cond2Etiqueta} maxLength={120} onChange={(e) => set("cond2Etiqueta", e.target.value)} placeholder="Alargamiento" /></div>
              <div className="field"><label htmlFor="ep-c2i">Mín</label><input id="ep-c2i" inputMode="decimal" value={num(p.cond2Inf)} onChange={(e) => set("cond2Inf", leerNumero(e.target.value))} /></div>
              <div className="field"><label htmlFor="ep-c2s">Máx</label><input id="ep-c2s" inputMode="decimal" value={num(p.cond2Sup)} onChange={(e) => set("cond2Sup", leerNumero(e.target.value))} /></div>
              <div className="field"><label htmlFor="ep-c2u">Unidad</label><input id="ep-c2u" value={p.cond2Unidad} maxLength={30} onChange={(e) => set("cond2Unidad", e.target.value)} placeholder="mm" /></div>
            </div>
          </fieldset>
        </>
      ) : (
        <div className="form-grid cols-2">
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="ep-req">Requisito en texto</label>
            <input id="ep-req" value={p.requisito} maxLength={2000} onChange={(e) => set("requisito", e.target.value)} placeholder="Según figuras · etiqueta legible y cosida" />
          </div>
        </div>
      )}
      <div className="toolbar" style={{ marginTop: 10, marginBottom: 0, justifyContent: "flex-end" }}>
        <button type="button" className="btn outline sm" onClick={onCancelar}>Cancelar</button>
        <button type="button" className="btn primary sm" onClick={listo}>Listo</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------- diálogo motivo --- */

function DialogoMotivo({ titulo, texto, boton, peligro, onCerrar, onConfirmar }: {
  titulo: string; texto: string; boton: string; peligro?: boolean; onCerrar: () => void; onConfirmar: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState("");
  return (
    <Modal
      titulo={titulo}
      onCerrar={onCerrar}
      acciones={
        <>
          <button type="button" className="btn outline sm" onClick={onCerrar}>Cancelar</button>
          <button type="button" className={`btn sm ${peligro ? "ghost-danger" : "primary"}`} disabled={motivo.trim().length < 5} onClick={() => onConfirmar(motivo.trim())}>{boton}</button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>{texto}</p>
      <div className="field">
        <label htmlFor="dm-motivo">Motivo <span className="req">*</span></label>
        <textarea id="dm-motivo" rows={3} value={motivo} maxLength={1000} onChange={(e) => setMotivo(e.target.value)} autoFocus />
        <span style={{ fontSize: 11, color: "var(--muted)" }}>Mínimo 5 caracteres. Queda en el registro de la E.T.</span>
      </div>
    </Modal>
  );
}
