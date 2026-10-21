"use client";

/**
 * Encuestas de satisfacción (EP-00 9.1 · decisión del 20-10-2026).
 * -----------------------------------------------------------------------------
 * Toda OT que se cierra genera una encuesta pendiente. No se publica a internet
 * ni la llena el cliente: Comercial la registra a mano con lo que el cliente
 * contesta (teléfono, correo, en persona o formulario en papel).
 * Pestañas: Pendientes · Registradas · Reporte por laboratorio · Preguntas.
 * Preguntas por defecto = formulario de evaluación del Sistema Comercial
 * (criterios 01–04, escala 1/3/5/7); se editan en «Preguntas».
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fechaDia, fechaHora, num } from "@/lib/format";
import { usePermisos } from "@/lib/permisos";
import Panel from "../cotizaciones/_components/Panel";
import { hoyISO, pedir } from "../cotizaciones/_components/comercial";

type Tab = "pendiente" | "registradas" | "reporte" | "preguntas";
interface Pregunta { id?: string; codigo: string; texto: string; escala: number[]; orden: number; obligatoria: boolean; activo: boolean }

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
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const e = new URLSearchParams(window.location.search).get("estado");
    if (e === "registrada" || e === "sin_respuesta") setTab("registradas");
  }, []);

  const tabs: [Tab, string][] = [
    ["pendiente", "Pendientes"],
    ["registradas", "Registradas"],
    ["reporte", "Reporte"],
    ...(puede("encuesta.configurar") ? ([["preguntas", "Preguntas"]] as [Tab, string][]) : []),
  ];

  return (
    <div>
      <h1 className="page">Encuestas de satisfacción</h1>
      <p className="subtitle">
        Al cerrarse una OT se abre su encuesta. Comercial consulta al cliente y registra aquí sus respuestas; si el cliente no responde, se cierra sin respuesta con el motivo.
      </p>
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
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const p = new URLSearchParams({ estado, limit: "100" });
      if (q.trim()) p.set("q", q.trim());
      const r = await pedir<any>("GET", `/encuestas?${p}`);
      setFilas(r?.data ?? []);
      setConteos(r?.conteos ?? {});
      setError("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, [estado, q]);
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
        <input aria-label="Buscar encuestas" placeholder="Buscar por OT o cliente…" style={{ flex: 1, minWidth: 200 }} value={buscar} onChange={(e) => setBuscar(e.target.value)} />
      </div>
      <div className="card card--table">
        <table className="data">
          <thead>
            <tr>
              <th>OT</th>
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
                <td style={{ whiteSpace: "nowrap" }}>{f.otId ? <Link href={`/ot/${f.otId}` as any} className="codigo" style={{ textDecoration: "underline" }}>{f.otCodigo}</Link> : f.codigo}{f.cotizacionCodigo ? <div style={{ fontSize: 11.5, color: "var(--muted)" }}>Cot. {f.cotizacionCodigo}</div> : null}</td>
                <td>{f.cliente ?? "—"}</td>
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
              <tr><td colSpan={8} style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>{modo === "pendiente" ? "No hay encuestas pendientes de registrar." : "Sin encuestas en este estado."}</td></tr>
            )}
            {cargando && <tr><td colSpan={8} style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>Cargando…</td></tr>}
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

  useEffect(() => {
    pedir<any>("GET", `/encuestas/${encuestaId}`).then(setE).catch((x) => setError(x.message));
  }, [encuestaId]);

  if (!e) return <Panel titulo="Encuesta" onCerrar={onCerrar}>{error ? <div className="alert warn" role="alert">{error}</div> : <p aria-busy="true">Cargando…</p>}</Panel>;

  const soloLectura = e.estado !== "pendiente";
  const preguntas: Pregunta[] = soloLectura ? (e.respuestas ?? []).map((r: any) => ({ ...r, obligatoria: false, activo: true, orden: 0 })) : e.preguntas;
  const valorDe = (codigo: string) => (soloLectura ? (e.respuestas ?? []).find((r: any) => r.codigo === codigo)?.valor ?? null : valores[codigo] ?? null);

  async function guardar() {
    setError("");
    const faltan = preguntas.filter((p) => p.obligatoria && valorDe(p.codigo) === null);
    if (faltan.length) return setError(`Falta la respuesta de: ${faltan.map((p) => p.texto).join(" · ")}.`);
    if (nombre.trim().length < 2 || cargo.trim().length < 2) return setError("Indique el nombre y el cargo de quien respondió.");
    setEnviando(true);
    try {
      const r = await pedir<any>("POST", `/encuestas/${encuestaId}/registrar`, {
        respuestas: preguntas.map((p) => ({ codigo: p.codigo, valor: valores[p.codigo] ?? null })),
        comentario: comentario.trim() || null,
        nombreRespondente: nombre.trim(),
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
    <Panel modo="drawer" ancho={720} onCerrar={onCerrar} titulo={<>Encuesta de satisfacción · OT <span className="codigo">{e.otCodigo ?? e.codigo}</span></>}>
      <p className="subtitle" style={{ marginTop: 0 }}>
        {e.cliente ?? "—"} · {e.unidadCodigo ?? "sin laboratorio"} · OT cerrada el {fechaDia(e.otFechaCierre)}
        {soloLectura ? <> · {e.etiquetaEstado}{e.promedio !== null ? ` · promedio ${num(e.promedio, 1)} / 7` : ""}</> : null}
      </p>
      {error && <div className="alert warn" role="alert">{error}</div>}
      {soloLectura && e.estado === "sin_respuesta" && <div className="alert info">Cerrada sin respuesta: {e.motivoSinRespuesta}</div>}
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
      {!soloLectura && <p className="subtitle" style={{ fontSize: 11.5, margin: "0 0 8px" }}>Escala: 1 = muy insatisfecho · 7 = muy satisfecho.</p>}
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
              <label htmlFor="enc-nom">Nombre de quien respondió <span className="req">*</span></label>
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
    <Panel titulo={<>Cerrar sin respuesta · OT <span className="codigo">{e.otCodigo}</span></>} onCerrar={onCerrar} ancho={480}>
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
  useEffect(() => {
    pedir<Pregunta[]>("GET", "/encuestas/preguntas").then(setPs).catch((e) => setError(e.message));
  }, []);
  const set = (i: number, cambios: Partial<Pregunta>) => setPs(ps.map((p, j) => (j === i ? { ...p, ...cambios } : p)));
  async function guardar() {
    setError("");
    setGuardando(true);
    try {
      const r = await pedir<any>("PUT", "/encuestas/preguntas", { preguntas: ps.map(({ codigo, texto, escala, orden, obligatoria, activo }) => ({ codigo, texto, escala, orden, obligatoria, activo })) });
      setPs(r?.preguntas ?? ps);
      onMensaje(r?.mensaje ?? "Preguntas guardadas.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }
  return (
    <div>
      <p className="subtitle" style={{ marginTop: 0 }}>
        Las preguntas por defecto son las del formulario de evaluación del Sistema Comercial. Pendiente de confirmar con el IDIC (EP-00, pregunta 15). Una pregunta no se borra: se desactiva. Las encuestas ya registradas conservan las preguntas con que se respondieron.
      </p>
      {error && <div className="alert warn" role="alert">{error}</div>}
      <table className="data">
        <thead><tr><th style={{ width: 90 }}>Código</th><th>Pregunta</th><th style={{ width: 130 }}>Escala</th><th style={{ width: 70 }}>Orden</th><th style={{ width: 90 }}>Obligatoria</th><th style={{ width: 70 }}>Activa</th></tr></thead>
        <tbody>
          {ps.map((p, i) => (
            <tr key={p.id ?? `n${i}`}>
              <td><input className="celda" aria-label={`Código ${i + 1}`} value={p.codigo} disabled={!!p.id} maxLength={20} onChange={(e) => set(i, { codigo: e.target.value.toUpperCase() })} /></td>
              <td><input className="celda" aria-label={`Texto ${i + 1}`} value={p.texto} maxLength={300} onChange={(e) => set(i, { texto: e.target.value })} /></td>
              <td><input className="celda" aria-label={`Escala ${i + 1}`} value={p.escala.join(",")} onChange={(e) => set(i, { escala: e.target.value.split(/[,;\s]+/).filter(Boolean).map(Number).filter((x) => Number.isInteger(x)) })} /></td>
              <td><input className="celda" aria-label={`Orden ${i + 1}`} inputMode="numeric" value={p.orden} onChange={(e) => set(i, { orden: Number(e.target.value.replace(/\D/g, "")) || 0 })} /></td>
              <td><input className="celda" aria-label={`Obligatoria ${i + 1}`} type="checkbox" style={{ width: "auto" }} checked={p.obligatoria} onChange={(e) => set(i, { obligatoria: e.target.checked })} /></td>
              <td><input className="celda" aria-label={`Activa ${i + 1}`} type="checkbox" style={{ width: "auto" }} checked={p.activo} onChange={(e) => set(i, { activo: e.target.checked })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="toolbar" style={{ marginTop: 8 }}>
        <button className="btn outline sm" onClick={() => setPs([...ps, { codigo: `C0${ps.length + 1}`.slice(-3), texto: "", escala: [1, 3, 5, 7], orden: ps.length + 1, obligatoria: true, activo: true }])}>＋ Agregar pregunta</button>
        <div className="spacer" />
        <button className="btn primary sm" disabled={guardando} onClick={guardar}>{guardando ? "Guardando…" : "Guardar preguntas"}</button>
      </div>
    </div>
  );
}
