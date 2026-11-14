"use client";

/**
 * Encuestas de satisfacción (EP-00 9.1 · decisión del 20-10-2026).
 * -----------------------------------------------------------------------------
 * Toda OT que se cierra genera una encuesta pendiente. No se publica a internet
 * ni la llena el cliente: Comercial la registra a mano con lo que el cliente
 * contesta (teléfono, correo, en persona o formulario en papel).
 * Pestañas: Pendientes · Registradas · Reporte por laboratorio · Preguntas · Formularios.
 * Cada encuesta usa el formulario de su tipo de cliente (DCO-PG01-P04-IT05
 * FORM01 a FORM05 e IDIC-PG03-FORM01); el formulario se asigna al cerrar la OT
 * y se puede cambiar al registrar. Las que no nacen de una OT (cotización
 * vencida, asistencia técnica, cliente interno) se crean con «Nueva encuesta».
 * El informe trimestral (Anexos 01 a 06) está en la Zona de informes.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fechaDia, fechaHora, num } from "@/lib/format";
import { usePermisos } from "@/lib/permisos";
import Panel from "../cotizaciones/_components/Panel";
import { hoyISO, pedir } from "../cotizaciones/_components/comercial";

type Tab = "pendiente" | "registradas" | "reporte" | "preguntas" | "formularios";
interface Pregunta { id?: string; codigo: string; texto: string; escala: number[]; orden: number; obligatoria: boolean; activo: boolean; tipoCodigo?: string | null; comentarioSiMenor?: number | null }
interface TipoEnc {
  codigo: string; nombre: string; formulario: string; formularioRevision: string | null; anexoNumero: string | null; anexoRevision: string | null;
  anexoEmision: string | null; tituloInforme: string; objetoInforme: string; agruparPor: "laboratorio" | "sucursal"; umbralPct: number;
  origenes: string | null; tiposCliente: string | null; reglaCliente: string | null; porDefecto: boolean; distribucion: string[]; orden: number; activo: boolean;
}

function useTipos(): TipoEnc[] {
  const [t, setT] = useState<TipoEnc[]>([]);
  useEffect(() => { pedir<TipoEnc[]>("GET", "/encuestas/tipos").then((x) => setT(x ?? [])).catch(() => setT([])); }, []);
  return t;
}

const MEDIOS: [string, string][] = [
  ["telefono", "Teléfono"],
  ["correo", "Correo electrónico"],
  ["presencial", "En persona"],
  ["formulario_fisico", "Formulario en papel"],
];
const PILL: Record<string, string> = { pendiente: "amber", registrada: "green", sin_respuesta: "gray" };

export default function EncuestasPage() {
  const { puede } = usePermisos();
  const [tab, setTab] = useState<Tab>("pendiente");
  const [msg, setMsg] = useState("");
  const [registrando, setRegistrando] = useState<any | null>(null);
  const [cerrando, setCerrando] = useState<any | null>(null);
  const [creando, setCreando] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const e = new URLSearchParams(window.location.search).get("estado");
    if (e === "registrada" || e === "sin_respuesta") setTab("registradas");
  }, []);

  const tabs: [Tab, string][] = [
    ["pendiente", "Pendientes"],
    ["registradas", "Registradas"],
    ["reporte", "Reporte"],
    ...(puede("encuesta.configurar") ? ([["preguntas", "Preguntas"], ["formularios", "Formularios"]] as [Tab, string][]) : []),
  ];

  return (
    <div>
      <h1 className="page">Encuestas de satisfacción</h1>
      <p className="subtitle">
        Al cerrarse una OT se abre su encuesta con el formulario de su tipo de cliente. Comercial consulta al cliente y registra aquí sus respuestas; si el cliente no responde, se cierra sin respuesta con el motivo.
        Para una cotización vencida, una asistencia técnica o un cliente interno, use «Nueva encuesta».
      </p>
      <div className="toolbar" style={{ gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {puede("encuesta.registrar") && <button className="btn primary sm" onClick={() => setCreando(true)}>＋ Nueva encuesta</button>}
        <div className="spacer" />
        <Link className="btn outline sm" href={"/zona-informes/encuestas-trimestral" as any}>Informe trimestral (Anexos 01 a 06) →</Link>
      </div>
      {msg && <div className="alert info" role="status">{msg}</div>}
      <div className="tabs" role="tablist" style={{ marginBottom: 10 }}>
        {tabs.map(([t, l]) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`tab${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>{l}</button>
        ))}
      </div>
      {(tab === "pendiente" || tab === "registradas") && (
        <Lista
          key={`${tab}-${version}`}
          modo={tab}
          puedeRegistrar={puede("encuesta.registrar")}
          onRegistrar={setRegistrando}
          onCerrar={setCerrando}
        />
      )}
      {tab === "reporte" && <Reporte />}
      {tab === "preguntas" && <Preguntas onMensaje={setMsg} />}
      {tab === "formularios" && <Formularios onMensaje={setMsg} />}
      {creando && (
        <NuevaEncuesta
          onCerrar={() => setCreando(false)}
          onHecho={(m) => { setCreando(false); setMsg(m); setTab("pendiente"); setVersion((v) => v + 1); }}
        />
      )}
      {registrando && (
        <FormularioEncuesta
          encuestaId={registrando.id}
          onCerrar={() => setRegistrando(null)}
          onHecho={(m) => { setRegistrando(null); setMsg(m); setVersion((v) => v + 1); }}
        />
      )}
      {cerrando && (
        <SinRespuesta
          e={cerrando}
          onCerrar={() => setCerrando(null)}
          onHecho={(m) => { setCerrando(null); setMsg(m); setVersion((v) => v + 1); }}
        />
      )}
    </div>
  );
}

function Lista({ modo, puedeRegistrar, onRegistrar, onCerrar }: { modo: "pendiente" | "registradas"; puedeRegistrar: boolean; onRegistrar: (e: any) => void; onCerrar: (e: any) => void }) {
  const [filas, setFilas] = useState<any[]>([]);
  const [conteos, setConteos] = useState<Record<string, number>>({});
  const [buscar, setBuscar] = useState("");
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState(modo === "pendiente" ? "pendiente" : "registrada");
  const [tipo, setTipo] = useState("");
  const tipos = useTipos();
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const p = new URLSearchParams({ estado, limit: "100" });
      if (q.trim()) p.set("q", q.trim());
      if (tipo) p.set("tipo", tipo);
      const r = await pedir<any>("GET", `/encuestas?${p}`);
      setFilas(r?.data ?? []);
      setConteos(r?.conteos ?? {});
      setError("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, [estado, q, tipo]);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    const t = setTimeout(() => setQ(buscar), 350);
    return () => clearTimeout(t);
  }, [buscar]);

  return (
    <div>
      {error && <div className="alert warn" role="alert">{error}</div>}
      <div className="toolbar" style={{ gap: 6, flexWrap: "wrap" }}>
        {modo === "registradas" && (
          <>
            <button className={`btn sm ${estado === "registrada" ? "primary" : "outline"}`} aria-pressed={estado === "registrada"} onClick={() => setEstado("registrada")}>Con respuesta {conteos.registrada ?? 0}</button>
            <button className={`btn sm ${estado === "sin_respuesta" ? "primary" : "outline"}`} aria-pressed={estado === "sin_respuesta"} onClick={() => setEstado("sin_respuesta")}>Sin respuesta {conteos.sin_respuesta ?? 0}</button>
          </>
        )}
        <select aria-label="Formulario" value={tipo} onChange={(e) => setTipo(e.target.value)} style={{ maxWidth: 300 }}>
          <option value="">Todos los formularios</option>
          {tipos.filter((t) => t.activo).map((t) => <option key={t.codigo} value={t.codigo}>{t.formulario} · {t.nombre}</option>)}
        </select>
        <input aria-label="Buscar encuestas" placeholder="Buscar por OT, referencia o cliente…" style={{ flex: 1, minWidth: 200 }} value={buscar} onChange={(e) => setBuscar(e.target.value)} />
      </div>
      <div className="card card--table">
        <table className="data">
          <thead>
            <tr>
              <th>OT / referencia</th>
              <th>Formulario</th>
              <th>Cliente</th>
              <th>Laboratorio</th>
              <th>Abierta</th>
              <th>Estado</th>
              {modo === "registradas" && <><th className="num">Promedio</th><th>Registrada</th></>}
              <th><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.id}>
                <td style={{ whiteSpace: "nowrap" }}>{f.otId ? <Link href={`/ot/${f.otId}` as any} className="codigo" style={{ textDecoration: "underline" }}>{f.otCodigo}</Link> : <span className="codigo">{f.referencia ?? f.codigo}</span>}{f.cotizacionCodigo ? <div style={{ fontSize: 11.5, color: "var(--muted)" }}>Cot. {f.cotizacionCodigo}</div> : null}</td>
                <td style={{ fontSize: 12 }} title={f.formulario ?? undefined}>{f.tipoNombre ?? <span style={{ color: "var(--muted)" }}>Sin formulario</span>}</td>
                <td>{f.cliente ?? f.clienteTexto ?? "—"}</td>
                <td title={f.unidadNombre}>{f.unidadCodigo ?? "—"}</td>
                <td>{fechaDia(f.fechaApertura ?? f.createdAt)}</td>
                <td><span className={`pill ${PILL[f.estado] ?? "gray"}`}>{f.etiquetaEstado}</span></td>
                {modo === "registradas" && (
                  <>
                    <td className="num">{f.promedio !== null && f.promedio !== undefined ? `${num(f.promedio, 1)} / 7` : "—"}</td>
                    <td style={{ fontSize: 12 }}>{fechaHora(f.registradaAt)} · {f.registradaPorNombre ?? "—"}{f.motivoSinRespuesta ? <div style={{ color: "var(--muted)" }}>{f.motivoSinRespuesta}</div> : null}</td>
                  </>
                )}
                <td>
                  {modo === "pendiente" && puedeRegistrar ? (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button className="btn primary sm" onClick={() => onRegistrar(f)}>Registrar respuestas</button>
                      <button className="btn outline sm" onClick={() => onCerrar(f)}>Sin respuesta</button>
                    </div>
                  ) : modo === "registradas" ? (
                    <button className="btn outline sm" onClick={() => onRegistrar(f)}>Ver</button>
                  ) : null}
                </td>
              </tr>
            ))}
            {!cargando && filas.length === 0 && (
              <tr><td colSpan={9} style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>{modo === "pendiente" ? "No hay encuestas pendientes de registrar." : "Sin encuestas en este estado."}</td></tr>
            )}
            {cargando && <tr><td colSpan={9} style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>Cargando…</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FormularioEncuesta({ encuestaId, onCerrar, onHecho }: { encuestaId: string; onCerrar: () => void; onHecho: (m: string) => void }) {
  const [e, setE] = useState<any | null>(null);
  const [valores, setValores] = useState<Record<string, number | null>>({});
  const [comentario, setComentario] = useState("");
  const [nombre, setNombre] = useState("");
  const [cargo, setCargo] = useState("");
  const [medio, setMedio] = useState("telefono");
  const [fecha, setFecha] = useState(hoyISO());
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [tipoSel, setTipoSel] = useState<string>("");
  const [todas, setTodas] = useState<Pregunta[]>([]);

  useEffect(() => {
    pedir<any>("GET", `/encuestas/${encuestaId}`).then((x) => { setE(x); setTipoSel(x?.tipo ?? ""); }).catch((x) => setError(x.message));
    pedir<Pregunta[]>("GET", "/encuestas/preguntas").then((x) => setTodas(x ?? [])).catch(() => setTodas([]));
  }, [encuestaId]);

  if (!e) return <Panel titulo="Encuesta" onCerrar={onCerrar}>{error ? <div className="alert warn" role="alert">{error}</div> : <p aria-busy="true">Cargando…</p>}</Panel>;

  const soloLectura = e.estado !== "pendiente";
  const preguntas: Pregunta[] = soloLectura
    ? (e.respuestas ?? []).map((r: any) => ({ ...r, obligatoria: false, activo: true, orden: 0 }))
    : tipoSel === (e.tipo ?? "")
      ? e.preguntas
      : todas.filter((p) => p.activo && (p.tipoCodigo ?? "") === tipoSel);
  const valorDe = (codigo: string) => (soloLectura ? (e.respuestas ?? []).find((r: any) => r.codigo === codigo)?.valor ?? null : valores[codigo] ?? null);

  async function guardar() {
    setError("");
    const faltan = preguntas.filter((p) => p.obligatoria && valorDe(p.codigo) === null);
    if (faltan.length) return setError(`Falta la respuesta de: ${faltan.map((p) => p.texto).join(" · ")}.`);
    const bajas = preguntas.filter((p) => p.comentarioSiMenor != null && (valorDe(p.codigo) ?? 99) < Number(p.comentarioSiMenor));
    if (bajas.length && !comentario.trim()) return setError(`«${bajas[0].texto}» tiene nota menor que ${bajas[0].comentarioSiMenor}: pregunte al cliente el motivo y anótelo en el comentario.`);
    if (cargo.trim().length < 2) return setError("Indique el cargo de quien respondió.");
    setEnviando(true);
    try {
      const r = await pedir<any>("POST", `/encuestas/${encuestaId}/registrar`, {
        ...(tipoSel ? { tipo: tipoSel } : {}),
        respuestas: preguntas.map((p) => ({ codigo: p.codigo, valor: valores[p.codigo] ?? null })),
        comentario: comentario.trim() || null,
        nombreRespondente: nombre.trim() || null,
        cargoRespondente: cargo.trim(),
        medio,
        fechaRespuesta: fecha,
      });
      onHecho(r?.mensaje ?? "Encuesta registrada.");
    } catch (x: any) {
      setError(x.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Panel modo="drawer" ancho={720} onCerrar={onCerrar} titulo={<>Encuesta de satisfacción · {e.otCodigo ? "OT " : ""}<span className="codigo">{e.otCodigo ?? e.referencia ?? e.codigo}</span></>}>
      <p className="subtitle" style={{ marginTop: 0 }}>
        {e.cliente ?? e.clienteTexto ?? "—"} · {e.unidadCodigo ?? "sin laboratorio"} · {e.otCodigo ? `OT cerrada el ${fechaDia(e.otFechaCierre)}` : `servicio del ${fechaDia(e.fechaApertura)}`}
        {soloLectura ? <> · {e.etiquetaEstado}{e.promedio !== null ? ` · promedio ${num(e.promedio, 1)} / 7` : ""}</> : null}
      </p>
      {error && <div className="alert warn" role="alert">{error}</div>}
      {soloLectura && e.estado === "sin_respuesta" && <div className="alert info">Cerrada sin respuesta: {e.motivoSinRespuesta}</div>}
      {soloLectura ? (
        <p style={{ fontSize: 12.5, margin: "0 0 8px" }}>Formulario: {e.formulario ?? "—"} · {e.tipoNombre ?? "sin formulario"}</p>
      ) : (
        <div className="field" style={{ marginBottom: 10 }}>
          <label htmlFor="enc-tipo">Formulario de la encuesta</label>
          <select id="enc-tipo" value={tipoSel} onChange={(x) => { setTipoSel(x.target.value); setValores({}); }}>
            {!e.tipo && <option value="">Sin formulario (preguntas generales)</option>}
            {(e.tipos ?? []).map((t: any) => <option key={t.codigo} value={t.codigo}>{t.formulario} · {t.nombre}</option>)}
          </select>
          <small style={{ color: "var(--muted)" }}>Se asignó según el origen de la OT y el tipo de cliente. Cámbielo si no corresponde.</small>
        </div>
      )}
      {!soloLectura && !preguntas.length && <div className="alert warn">Este formulario no tiene preguntas activas: configúrelas en la pestaña «Preguntas».</div>}
      {preguntas.map((p) => (
        <fieldset key={p.codigo} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "8px 12px", margin: "0 0 8px" }}>
          <legend style={{ fontSize: 13, fontWeight: 600, padding: "0 4px" }}>
            {p.codigo} · {p.texto} {p.obligatoria && !soloLectura && <span className="req">*</span>}
          </legend>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            {p.escala.map((v) => (
              <label key={v} style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 400 }}>
                <input type="radio" name={`p-${p.codigo}`} style={{ width: "auto" }} disabled={soloLectura} checked={valorDe(p.codigo) === v}
                  onChange={() => setValores({ ...valores, [p.codigo]: v })} />
                {v}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      {!soloLectura && <p className="subtitle" style={{ fontSize: 11.5, margin: "0 0 8px" }}>Escala: 1 = muy malo · 7 = excelente (formulario Ejército: 1 muy malo, 3 malo, 5 bueno, 7 muy bueno).</p>}
      {soloLectura ? (
        <div className="form-grid cols-2">
          <div className="field readonly"><label>Respondió</label><div>{e.nombreRespondente ?? "—"}{e.cargoRespondente ? ` · ${e.cargoRespondente}` : ""}</div></div>
          <div className="field readonly"><label>Medio y fecha</label><div>{MEDIOS.find(([k]) => k === e.medio)?.[1] ?? e.medio ?? "—"} · {fechaDia(e.fechaRespuesta)}</div></div>
          <div className="field readonly" style={{ gridColumn: "1 / -1" }}><label>Comentario</label><div>{e.comentario ?? "—"}</div></div>
          <div className="field readonly"><label>Registrada por</label><div>{e.registradaPorNombre ?? "—"} · {fechaHora(e.registradaAt)}</div></div>
        </div>
      ) : (
        <>
          <div className="form-grid cols-2">
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label htmlFor="enc-com">Comentario del cliente</label>
              <textarea id="enc-com" rows={3} maxLength={4000} value={comentario} onChange={(x) => setComentario(x.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="enc-nom">Nombre de quien respondió (opcional)</label>
              <input id="enc-nom" maxLength={200} value={nombre} onChange={(x) => setNombre(x.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="enc-car">Cargo <span className="req">*</span></label>
              <input id="enc-car" maxLength={200} value={cargo} onChange={(x) => setCargo(x.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="enc-medio">Medio <span className="req">*</span></label>
              <select id="enc-medio" value={medio} onChange={(x) => setMedio(x.target.value)}>
                {MEDIOS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="enc-fecha">Fecha de la respuesta <span className="req">*</span></label>
              <input id="enc-fecha" type="date" value={fecha} max={hoyISO()} onChange={(x) => setFecha(x.target.value)} />
            </div>
          </div>
          <div className="toolbar" style={{ marginTop: 12 }}>
            <button className="btn outline sm" onClick={onCerrar}>Cancelar</button>
            <div className="spacer" />
            <button className="btn primary sm" disabled={enviando} onClick={guardar}>{enviando ? "Guardando…" : "Registrar encuesta"}</button>
          </div>
        </>
      )}
    </Panel>
  );
}

function SinRespuesta({ e, onCerrar, onHecho }: { e: any; onCerrar: () => void; onHecho: (m: string) => void }) {
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  async function guardar() {
    setError("");
    if (motivo.trim().length < 5) return setError("Indique el motivo (al menos 5 caracteres).");
    setEnviando(true);
    try {
      const r = await pedir<any>("POST", `/encuestas/${e.id}/sin-respuesta`, { motivo: motivo.trim() });
      onHecho(r?.mensaje ?? "Encuesta cerrada sin respuesta.");
    } catch (x: any) {
      setError(x.message);
    } finally {
      setEnviando(false);
    }
  }
  return (
    <Panel titulo={<>Cerrar sin respuesta · <span className="codigo">{e.otCodigo ?? e.referencia ?? e.codigo}</span></>} onCerrar={onCerrar} ancho={480}>
      {error && <div className="alert warn" role="alert">{error}</div>}
      <div className="field">
        <label htmlFor="sr-motivo">Motivo <span className="req">*</span></label>
        <textarea id="sr-motivo" rows={3} maxLength={1000} value={motivo} onChange={(x) => setMotivo(x.target.value)} placeholder="p. ej. tres intentos de contacto sin respuesta" />
      </div>
      <div className="toolbar" style={{ marginTop: 12 }}>
        <button className="btn outline sm" onClick={onCerrar}>Cancelar</button>
        <div className="spacer" />
        <button className="btn primary sm" disabled={enviando} onClick={guardar}>{enviando ? "Guardando…" : "Cerrar sin respuesta"}</button>
      </div>
    </Panel>
  );
}

function Reporte() {
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [r, setR] = useState<any | null>(null);
  const [error, setError] = useState("");
  const cargar = useCallback(async () => {
    try {
      const p = new URLSearchParams();
      if (desde) p.set("desde", desde);
      if (hasta) p.set("hasta", hasta);
      setR(await pedir<any>("GET", `/encuestas/reporte?${p}`));
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, [desde, hasta]);
  useEffect(() => { cargar(); }, [cargar]);
  const codigos: { codigo: string; texto: string }[] = r?.total?.porPregunta ?? [];
  const celda = (v: number | null | undefined) => (v === null || v === undefined ? "—" : num(v, 1));
  return (
    <div>
      {error && <div className="alert warn" role="alert">{error}</div>}
      <div className="toolbar" style={{ gap: 8, flexWrap: "wrap" }}>
        <div className="field" style={{ margin: 0 }}><label htmlFor="rep-desde">Abiertas desde</label><input id="rep-desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
        <div className="field" style={{ margin: 0 }}><label htmlFor="rep-hasta">hasta</label><input id="rep-hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
      </div>
      {r && (
        <div className="card card--table">
          <table className="data">
            <caption className="sr-only">Encuestas por laboratorio: estados, tasa de respuesta y promedios (escala 1 a 7)</caption>
            <thead>
              <tr>
                <th>Laboratorio</th><th className="num">Total</th><th className="num">Pendientes</th><th className="num">Registradas</th><th className="num">Sin respuesta</th>
                <th className="num">Tasa de respuesta</th><th className="num">Promedio</th>
                {codigos.map((p) => <th key={p.codigo} className="num" title={p.texto}>{p.codigo}</th>)}
              </tr>
            </thead>
            <tbody>
              {r.laboratorios.map((l: any) => (
                <tr key={l.unidad}>
                  <td>{l.unidad}</td><td className="num">{l.total}</td><td className="num">{l.pendientes}</td><td className="num">{l.registradas}</td><td className="num">{l.sinRespuesta}</td>
                  <td className="num">{l.tasaRespuesta === null ? "—" : `${num(l.tasaRespuesta, 1)} %`}</td><td className="num">{celda(l.promedio)}</td>
                  {codigos.map((p) => <td key={p.codigo} className="num">{celda(l.porPregunta.find((x: any) => x.codigo === p.codigo)?.promedio)}</td>)}
                </tr>
              ))}
              {r.laboratorios.length === 0 && <tr><td colSpan={7 + codigos.length} style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>Sin encuestas en el período.</td></tr>}
            </tbody>
            {r.laboratorios.length > 0 && (
              <tfoot>
                <tr style={{ fontWeight: 700 }}>
                  <td>Total</td><td className="num">{r.total.total}</td><td className="num">{r.total.pendientes}</td><td className="num">{r.total.registradas}</td><td className="num">{r.total.sinRespuesta}</td>
                  <td className="num">{r.total.tasaRespuesta === null ? "—" : `${num(r.total.tasaRespuesta, 1)} %`}</td><td className="num">{celda(r.total.promedio)}</td>
                  {codigos.map((p) => <td key={p.codigo} className="num">{celda(r.total.porPregunta.find((x: any) => x.codigo === p.codigo)?.promedio)}</td>)}
                </tr>
              </tfoot>
            )}
          </table>
          {codigos.length > 0 && (
            <p style={{ fontSize: 11.5, color: "var(--muted)", padding: "6px 10px", margin: 0 }}>
              {codigos.map((p) => `${p.codigo}: ${p.texto}`).join(" · ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Preguntas({ onMensaje }: { onMensaje: (m: string) => void }) {
  const [ps, setPs] = useState<Pregunta[]>([]);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const tipos = useTipos();
  const [tipo, setTipo] = useState<string>("");
  useEffect(() => {
    pedir<Pregunta[]>("GET", "/encuestas/preguntas").then(setPs).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { if (!tipo && tipos.length) setTipo(tipos[0].codigo); }, [tipos, tipo]);
  const set = (i: number, cambios: Partial<Pregunta>) => setPs(ps.map((p, j) => (j === i ? { ...p, ...cambios } : p)));
  const visibles = ps.map((p, i) => ({ p, i })).filter(({ p }) => (p.tipoCodigo ?? "") === tipo);
  const tipoActual = tipos.find((t) => t.codigo === tipo);
  async function guardar() {
    setError("");
    setGuardando(true);
    try {
      const r = await pedir<any>("PUT", "/encuestas/preguntas", {
        preguntas: ps.map(({ codigo, texto, escala, orden, obligatoria, activo, tipoCodigo, comentarioSiMenor }) => ({ codigo, texto, escala, orden, obligatoria, activo, tipoCodigo: tipoCodigo || null, comentarioSiMenor: comentarioSiMenor ?? null })),
      });
      setPs(r?.preguntas ?? ps);
      onMensaje(r?.mensaje ?? "Preguntas guardadas.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }
  function agregar() {
    const pref = (tipo || "P").replace(/^FORM/, "F").slice(0, 6);
    let k = visibles.length + 1;
    while (ps.some((p) => p.codigo === `${pref}_${String(k).padStart(2, "0")}`)) k++;
    const escala = tipo === "FORM03" ? [1, 3, 5, 7] : [1, 2, 3, 4, 5, 6, 7];
    setPs([...ps, { codigo: `${pref}_${String(k).padStart(2, "0")}`, texto: "", escala, orden: visibles.length + 1, obligatoria: true, activo: true, tipoCodigo: tipo || null, comentarioSiMenor: null }]);
  }
  return (
    <div>
      <p className="subtitle" style={{ marginTop: 0 }}>
        Preguntas de cada formulario de la instrucción DCO-PG01-P04-IT05 (FORM01 a FORM05) y del formulario de cliente interno IDIC-PG03-FORM01. Una pregunta no se borra: se desactiva. Las encuestas ya registradas conservan las preguntas con que se respondieron.
      </p>
      {error && <div className="alert warn" role="alert">{error}</div>}
      <div className="toolbar" style={{ gap: 6 }}>
        <label htmlFor="preg-tipo" style={{ fontWeight: 600 }}>Formulario</label>
        <select id="preg-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} style={{ maxWidth: 420 }}>
          {tipos.map((t) => <option key={t.codigo} value={t.codigo}>{t.formulario} · {t.nombre}{t.activo ? "" : " (desactivado)"}</option>)}
          {ps.some((p) => !p.tipoCodigo) && <option value="">Sin formulario (preguntas antiguas)</option>}
        </select>
      </div>
      <table className="data">
        <thead><tr><th style={{ width: 90 }}>Código</th><th>Pregunta</th><th style={{ width: 130 }}>Escala</th><th style={{ width: 110 }} title="Si la nota es menor, el comentario es obligatorio">Comentario si nota menor que</th><th style={{ width: 70 }}>Orden</th><th style={{ width: 90 }}>Obligatoria</th><th style={{ width: 70 }}>Activa</th></tr></thead>
        <tbody>
          {visibles.map(({ p, i }) => (
            <tr key={p.id ?? `n${i}`}>
              <td><input className="celda" aria-label={`Código ${i + 1}`} value={p.codigo} disabled={!!p.id} maxLength={20} onChange={(e) => set(i, { codigo: e.target.value.toUpperCase() })} /></td>
              <td><input className="celda" aria-label={`Texto ${i + 1}`} value={p.texto} maxLength={300} onChange={(e) => set(i, { texto: e.target.value })} /></td>
              <td><input className="celda" aria-label={`Escala ${i + 1}`} value={p.escala.join(",")} onChange={(e) => set(i, { escala: e.target.value.split(/[,;\s]+/).filter(Boolean).map(Number).filter((x) => Number.isInteger(x)) })} /></td>
              <td><input className="celda" aria-label={`Comentario obligatorio si la nota es menor que ${i + 1}`} inputMode="decimal" value={p.comentarioSiMenor ?? ""} placeholder="—" onChange={(e) => { const v = e.target.value.replace(",", ".").replace(/[^\d.]/g, ""); set(i, { comentarioSiMenor: v === "" ? null : Number(v) }); }} /></td>
              <td><input className="celda" aria-label={`Orden ${i + 1}`} inputMode="numeric" value={p.orden} onChange={(e) => set(i, { orden: Number(e.target.value.replace(/\D/g, "")) || 0 })} /></td>
              <td><input className="celda" aria-label={`Obligatoria ${i + 1}`} type="checkbox" style={{ width: "auto" }} checked={p.obligatoria} onChange={(e) => set(i, { obligatoria: e.target.checked })} /></td>
              <td><input className="celda" aria-label={`Activa ${i + 1}`} type="checkbox" style={{ width: "auto" }} checked={p.activo} onChange={(e) => set(i, { activo: e.target.checked })} /></td>
            </tr>
          ))}
          {!visibles.length && <tr><td colSpan={7} style={{ textAlign: "center", padding: 18, color: "var(--muted)" }}>Este formulario no tiene preguntas.</td></tr>}
        </tbody>
      </table>
      {tipoActual && <p style={{ fontSize: 11.5, color: "var(--muted)" }}>Informe: {tipoActual.tituloInforme} · índice sobre el {Math.round(tipoActual.umbralPct)} % · agrupa por {tipoActual.agruparPor}.</p>}
      <div className="toolbar" style={{ marginTop: 8 }}>
        <button className="btn outline sm" onClick={agregar}>＋ Agregar pregunta a este formulario</button>
        <div className="spacer" />
        <button className="btn primary sm" disabled={guardando} onClick={guardar}>{guardando ? "Guardando…" : "Guardar preguntas"}</button>
      </div>
    </div>
  );
}

function Formularios({ onMensaje }: { onMensaje: (m: string) => void }) {
  const [ts, setTs] = useState<TipoEnc[]>([]);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { pedir<TipoEnc[]>("GET", "/encuestas/tipos").then((x) => setTs(x ?? [])).catch((e) => setError(e.message)); }, []);
  const set = (i: number, c: Partial<TipoEnc>) => setTs(ts.map((t, j) => (j === i ? { ...t, ...c } : t)));
  async function guardar() {
    setError("");
    setGuardando(true);
    try {
      const r = await pedir<any>("PUT", "/encuestas/tipos", {
        tipos: ts.map((t) => ({ ...t, umbralPct: Number(t.umbralPct), distribucion: (t.distribucion ?? []).map((d) => d.trim()).filter(Boolean) })),
      });
      setTs(r?.tipos ?? ts);
      onMensaje(r?.mensaje ?? "Formularios guardados.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }
  return (
    <div>
      <p className="subtitle" style={{ marginTop: 0 }}>
        Un formulario por tipo de cliente, con el anexo de su informe trimestral. Al cerrarse una OT, la encuesta toma el primer formulario cuyo
        <b> origen de OT</b> coincide; si ninguno, el de su <b>tipo de cliente</b>; luego el de la <b>regla</b> del tipo de cliente (Ejército o particular); y si nada coincide, el marcado <b>por defecto</b>.
      </p>
      {error && <div className="alert warn" role="alert">{error}</div>}
      {ts.map((t, i) => (
        <fieldset key={t.codigo} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "8px 12px", margin: "0 0 10px" }}>
          <legend style={{ fontWeight: 600, fontSize: 13, padding: "0 4px" }}>{t.codigo} · {t.formulario}</legend>
          <div className="form-grid cols-3">
            <div className="field"><label htmlFor={`ft-nom-${i}`}>Nombre</label><input id={`ft-nom-${i}`} maxLength={200} value={t.nombre} onChange={(e) => set(i, { nombre: e.target.value })} /></div>
            <div className="field"><label htmlFor={`ft-form-${i}`}>Código del formulario</label><input id={`ft-form-${i}`} maxLength={60} value={t.formulario} onChange={(e) => set(i, { formulario: e.target.value })} /></div>
            <div className="field"><label htmlFor={`ft-frev-${i}`}>Revisión del formulario</label><input id={`ft-frev-${i}`} maxLength={10} value={t.formularioRevision ?? ""} onChange={(e) => set(i, { formularioRevision: e.target.value })} /></div>
            <div className="field"><label htmlFor={`ft-anx-${i}`}>Anexo Nº del informe</label><input id={`ft-anx-${i}`} maxLength={4} value={t.anexoNumero ?? ""} onChange={(e) => set(i, { anexoNumero: e.target.value })} /></div>
            <div className="field"><label htmlFor={`ft-arev-${i}`}>Revisión del anexo</label><input id={`ft-arev-${i}`} maxLength={10} value={t.anexoRevision ?? ""} onChange={(e) => set(i, { anexoRevision: e.target.value })} /></div>
            <div className="field"><label htmlFor={`ft-aem-${i}`}>Fecha de emisión del anexo</label><input id={`ft-aem-${i}`} maxLength={10} placeholder="dd/mm/aaaa" value={t.anexoEmision ?? ""} onChange={(e) => set(i, { anexoEmision: e.target.value })} /></div>
            <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor={`ft-tit-${i}`}>Título del informe</label><input id={`ft-tit-${i}`} maxLength={300} value={t.tituloInforme} onChange={(e) => set(i, { tituloInforme: e.target.value })} /></div>
            <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor={`ft-obj-${i}`}>«adjunto se remite cuadro informe de…»</label><input id={`ft-obj-${i}`} maxLength={300} value={t.objetoInforme} onChange={(e) => set(i, { objetoInforme: e.target.value })} /></div>
            <div className="field"><label htmlFor={`ft-agr-${i}`}>Agrupar por</label><select id={`ft-agr-${i}`} value={t.agruparPor} onChange={(e) => set(i, { agruparPor: e.target.value as any })}><option value="laboratorio">Laboratorio</option><option value="sucursal">Sucursal</option></select></div>
            <div className="field"><label htmlFor={`ft-umb-${i}`}>Umbral del índice (%)</label><input id={`ft-umb-${i}`} inputMode="decimal" value={t.umbralPct} onChange={(e) => set(i, { umbralPct: Number(e.target.value.replace(",", ".").replace(/[^\d.]/g, "")) || 0 })} /></div>
            <div className="field"><label htmlFor={`ft-reg-${i}`}>Regla del tipo de cliente</label><select id={`ft-reg-${i}`} value={t.reglaCliente ?? ""} onChange={(e) => set(i, { reglaCliente: e.target.value || null })}><option value="">—</option><option value="EJERCITO">Ejército</option><option value="PARTICULAR">Particular</option></select></div>
            <div className="field"><label htmlFor={`ft-ori-${i}`}>Orígenes de OT (separados por coma)</label><input id={`ft-ori-${i}`} maxLength={500} value={t.origenes ?? ""} placeholder="p. ej. PRODUCCION_NACIONAL" onChange={(e) => set(i, { origenes: e.target.value })} /></div>
            <div className="field"><label htmlFor={`ft-tc-${i}`}>Tipos de cliente (códigos, por coma)</label><input id={`ft-tc-${i}`} maxLength={500} value={t.tiposCliente ?? ""} placeholder="p. ej. ejercito" onChange={(e) => set(i, { tiposCliente: e.target.value })} /></div>
            <div className="field"><label htmlFor={`ft-dis-${i}`}>Distribución (una por línea)</label><textarea id={`ft-dis-${i}`} rows={3} value={(t.distribucion ?? []).join("\n")} onChange={(e) => set(i, { distribucion: e.target.value.split("\n") })} /></div>
            <div className="field"><label><input type="checkbox" style={{ width: "auto" }} checked={t.porDefecto} onChange={(e) => set(i, { porDefecto: e.target.checked })} /> Por defecto</label></div>
            <div className="field"><label><input type="checkbox" style={{ width: "auto" }} checked={t.activo} onChange={(e) => set(i, { activo: e.target.checked })} /> Activo</label></div>
          </div>
        </fieldset>
      ))}
      <div className="toolbar" style={{ marginTop: 8 }}>
        <div className="spacer" />
        <button className="btn primary sm" disabled={guardando || !ts.length} onClick={guardar}>{guardando ? "Guardando…" : "Guardar formularios"}</button>
      </div>
    </div>
  );
}

function NuevaEncuesta({ onCerrar, onHecho }: { onCerrar: () => void; onHecho: (m: string) => void }) {
  const tipos = useTipos();
  const [tipo, setTipo] = useState("FORM02");
  const [unidades, setUnidades] = useState<{ id: string; texto: string }[]>([]);
  const [unidadId, setUnidadId] = useState("");
  const [referencia, setReferencia] = useState("");
  const [clienteTexto, setClienteTexto] = useState("");
  const [fecha, setFecha] = useState(hoyISO());
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  useEffect(() => {
    pedir<any>("GET", "/unidades")
      .then((r) => setUnidades(
        (Array.isArray(r) ? r : r?.data ?? [])
          .filter((u: any) => u.activa !== false && u.activo !== false && ["LABORATORIO", "SUCURSAL", "DELEGACION", "SECCION"].includes(u.tipo))
          .map((u: any) => ({ id: u.id, texto: u.sigla ? `${u.sigla} · ${u.nombre}` : u.nombre }))
          .sort((a: any, b: any) => a.texto.localeCompare(b.texto, "es")),
      ))
      .catch(() => setUnidades([]));
  }, []);
  const ayuda: Record<string, string> = {
    FORM02: "N° de la cotización vencida que no aceptó el cliente.",
    FORM04: "N° de OT o PIA de la asistencia técnica.",
    FORM05: "N° de OT o PIA de la inspección.",
    INTERNO: "N° de la OT interna evaluada.",
  };
  async function guardar() {
    setError("");
    if (!unidadId) return setError("Elija el laboratorio o la sucursal que prestó el servicio.");
    if (!referencia.trim()) return setError("Indique el número de referencia (OT, PIA, cotización u OT interna).");
    setEnviando(true);
    try {
      const r = await pedir<any>("POST", "/encuestas", { tipo, unidadId, referencia: referencia.trim(), clienteTexto: clienteTexto.trim() || null, fechaServicio: fecha });
      onHecho(r?.mensaje ?? "Encuesta creada.");
    } catch (x: any) {
      setError(x.message);
    } finally {
      setEnviando(false);
    }
  }
  return (
    <Panel titulo="Nueva encuesta" onCerrar={onCerrar} ancho={560}>
      <p className="subtitle" style={{ marginTop: 0 }}>Para encuestas que no nacen del cierre de una OT. Queda pendiente y se registra como las demás.</p>
      {error && <div className="alert warn" role="alert">{error}</div>}
      <div className="form-grid cols-2">
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="ne-tipo">Formulario <span className="req">*</span></label>
          <select id="ne-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            {tipos.filter((t) => t.activo).map((t) => <option key={t.codigo} value={t.codigo}>{t.formulario} · {t.nombre}</option>)}
          </select>
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="ne-unidad">Laboratorio o sucursal <span className="req">*</span></label>
          <select id="ne-unidad" value={unidadId} onChange={(e) => setUnidadId(e.target.value)}>
            <option value="">Elija…</option>
            {unidades.map((u) => <option key={u.id} value={u.id}>{u.texto}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ne-ref">Referencia <span className="req">*</span></label>
          <input id="ne-ref" maxLength={60} value={referencia} onChange={(e) => setReferencia(e.target.value)} />
          <small style={{ color: "var(--muted)" }}>{ayuda[tipo] ?? "N° de OT, PIA, cotización u OT interna."}</small>
        </div>
        <div className="field">
          <label htmlFor="ne-fecha">Fecha del servicio <span className="req">*</span></label>
          <input id="ne-fecha" type="date" value={fecha} max={hoyISO()} onChange={(e) => setFecha(e.target.value)} />
          <small style={{ color: "var(--muted)" }}>Define el trimestre del informe (cierre o vencimiento).</small>
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="ne-cli">Empresa, cliente o laboratorio solicitante (opcional)</label>
          <input id="ne-cli" maxLength={200} value={clienteTexto} onChange={(e) => setClienteTexto(e.target.value)} />
        </div>
      </div>
      <div className="toolbar" style={{ marginTop: 12 }}>
        <button className="btn outline sm" onClick={onCerrar}>Cancelar</button>
        <div className="spacer" />
        <button className="btn primary sm" disabled={enviando} onClick={guardar}>{enviando ? "Creando…" : "Crear encuesta pendiente"}</button>
      </div>
    </Panel>
  );
}
