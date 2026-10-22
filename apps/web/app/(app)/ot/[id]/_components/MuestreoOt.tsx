"use client";

/**
 * Pestaña «Muestreo» de la OT (EP-01 1.1, EP-02 1.1, EP-03 0.4, EP-05 3.2 y 5.3,
 * EP-10 10.4): formulario de muestreo según quién muestrea, plan NCh 44 (letra,
 * n y Ac/Re propuestos), selección NCh 43 con sus reemplazos, sellos y registro
 * fotográfico, «Registrar muestreo → entregar al laboratorio», «recibido
 * conforme» del laboratorio y la conclusión del lote por clase de defecto.
 * Reglas: apps/api/src/muestreo (servidor). API: /muestreo/*.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PasosProceso from "@/components/ui/PasosProceso";
import Modal from "@/components/documentos/Modal";
import { confirmar, toast } from "@/components/ui/feedback";
import { ImagenFoto, prepararFoto } from "@/components/informes/FotosInforme";
import { enviarInforme } from "@/lib/informes";
import { api } from "@/lib/api";
import { llamar, qs } from "@/lib/laboratorio";
import { fechaHora } from "@/lib/format";
import { AYUDA_FORMULARIO, CLASE_DEFECTO, ESTADO_MUESTREO, aLocalChile, coma, type ClaseDefecto } from "@/lib/especificaciones";

const CLASES: ClaseDefecto[] = ["critico", "mayor", "menor"];
const ETIQ_UNIDAD = { posicion: "Posición", identificacion: "Serie", talla: "Talla", ubicacion: "Panel o ubicación" } as const;

interface Opcion { valor: string; etiqueta: string }
interface Unidad { id: string; orden: number; posicion: number | null; identificacion: string | null; talla: string | null; ubicacion: string | null; reemplazaId: string | null; reemplazada: boolean; motivoReemplazo: string | null }
interface Plan {
  nivel: string; tabla: string; aql: Partial<Record<ClaseDefecto, number>>; letra: string; nPropuesto: number | null; n: number; motivoN: string | null;
  clases: Partial<Record<ClaseDefecto, { letra: string; n: number; ac: number; re: number; aql: number | null; manual: boolean }>>;
  inspeccion100: boolean; seleccion: { metodo: string; inicio: number | null; paso: number | null }; avisos: string[];
}
interface Muestreo {
  id: string; numeroFormulario: string; tipoFormulario: string; lugar: string | null; fechaToma: string | null; responsable: string | null; solicitadoPor: string | null;
  producto: string | null; proveedor: string | null; guiaDespacho: string | null; identificacionLote: string | null; fechaElaboracion: string | null;
  tamanoLote: number | null; unidadPresentacion: string | null; tamanoMuestra: number | null; cantidadEnvase: string | null; materialAdicional: string | null;
  sellos: string[]; registroFotoNumero: string | null; devolucionExcedente: boolean | null; costoUf: number | null; tiempoRespuesta: string | null; observaciones: string | null;
  plan: Plan | null; lineaMovil: boolean; lineaMovilPlan: string | null; estado: string;
  createdAt: string; creadoPorNombre: string | null; registradoAt: string | null; registradoPorNombre: string | null;
  recibidoConforme: boolean | null; recibidoObservacion: string | null; recibidoAt: string | null; recibidoPorNombre: string | null;
  veredictoLote: string | null; conclusion: string | null; concluidoAt: string | null; concluidoPorNombre: string | null; anuladoMotivo: string | null;
  unidades: Unidad[]; fotos: { id: string; pie: string | null; url: string }[]; muestras: string[]; faltantes: string[];
}
interface DatosMuestreo {
  ot: { id: string; codigo: string; estado: string; laboratorio: string | null };
  porDefecto: { nivel: string; aql: Partial<Record<ClaseDefecto, string | null>>; reglaSinPlan: string };
  opciones: { formularios: Opcion[]; niveles: Opcion[]; aql: Opcion[] };
  puede: { registrar: boolean; recibir: boolean; concluir: boolean };
  muestras: { id: string; codigo: string; nombre: string | null; muestreoId: string | null; selloNumero: string | null; sellosVerificados: boolean | null }[];
  muestreos: Muestreo[];
}

export default function MuestreoOt({ otId, onCambio }: { otId: string; onCambio?: () => void }) {
  const [d, setD] = useState<DatosMuestreo | null>(null);
  const [error, setError] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState(false);

  const recibir = useCallback((r: DatosMuestreo) => {
    setD(r);
    setSel((s) => (s && r.muestreos.some((m) => m.id === s) ? s : r.muestreos.find((m) => m.estado !== "anulado")?.id ?? r.muestreos[0]?.id ?? null));
  }, []);
  const cargar = useCallback(async () => {
    try { recibir(await llamar<DatosMuestreo>("GET", `/muestreo/ot/${otId}`)); setError(""); }
    catch (e: any) { setError(e.message); }
  }, [otId, recibir]);
  useEffect(() => { cargar(); }, [cargar]);

  const actualizar = useCallback((r: DatosMuestreo) => { recibir(r); onCambio?.(); }, [recibir, onCambio]);

  if (error) return <div className="alert warn" role="alert">{error}</div>;
  if (!d) return <p className="subtitle">Cargando el muestreo…</p>;
  const actual = d.muestreos.find((m) => m.id === sel) ?? null;

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div className="toolbar" style={{ margin: 0, flexWrap: "wrap", gap: 6 }}>
        {d.muestreos.length > 0 && (
          <div role="tablist" aria-label="Muestreos de la OT" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {d.muestreos.map((m) => (
              <button key={m.id} type="button" role="tab" aria-selected={m.id === sel} className={`btn sm ${m.id === sel ? "primary" : "outline"}`} onClick={() => setSel(m.id)}>
                Nº {m.numeroFormulario} <span className={`pill ${ESTADO_MUESTREO[m.estado]?.pill ?? "gray"}`} style={{ marginLeft: 4 }}>{ESTADO_MUESTREO[m.estado]?.texto ?? m.estado}</span>
              </button>
            ))}
          </div>
        )}
        <span className="spacer" />
        {d.puede.registrar && <button type="button" className="btn outline sm" onClick={() => setNuevo(true)}>＋ Nuevo muestreo</button>}
      </div>
      {d.muestreos.length === 0 && (
        <div className="empty" style={{ padding: 18, textAlign: "center" }}>
          <div className="empty-tit">Esta OT no tiene muestreo</div>
          <div className="empty-txt">
            Regístrelo cuando la muestra se extrae de un lote (Sección Muestreo, toma en terreno o plan NCh 44). Si el cliente entrega la muestra, recepciónela en «Muestras».
          </div>
        </div>
      )}
      {actual && <FichaMuestreo key={actual.id} d={d} m={actual} onCambio={actualizar} />}
      {nuevo && <NuevoMuestreo otId={otId} opciones={d.opciones.formularios} onCerrar={() => setNuevo(false)} onCreado={(r, id) => { setNuevo(false); actualizar(r); setSel(id); }} />}
    </div>
  );
}

function NuevoMuestreo({ otId, opciones, onCerrar, onCreado }: { otId: string; opciones: Opcion[]; onCerrar: () => void; onCreado: (r: DatosMuestreo, id: string) => void }) {
  const [tipo, setTipo] = useState("extraccion");
  const [numero, setNumero] = useState("");
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  async function crear() {
    if (!numero.trim()) return setError("Indique el Nº de formulario de muestreo.");
    setOcupado(true);
    try {
      const r = await llamar<DatosMuestreo & { id: string }>("POST", `/muestreo/ot/${otId}`, { tipoFormulario: tipo, numeroFormulario: numero.trim() });
      toast.ok("Muestreo creado: complete el formulario.");
      onCreado(r, r.id);
    } catch (e: any) { setError(e.message); }
    finally { setOcupado(false); }
  }
  return (
    <Modal titulo="Nuevo muestreo" onCerrar={onCerrar}
      acciones={<><button type="button" className="btn outline sm" onClick={onCerrar}>Cancelar</button><button type="button" className="btn primary sm" disabled={ocupado} onClick={crear}>Crear → completar el formulario</button></>}>
      {error && <div className="alert warn" role="alert">{error}</div>}
      <div className="field">
        <label htmlFor="nm-tipo">Formulario</label>
        <select id="nm-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
          {opciones.map((o) => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
        </select>
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{AYUDA_FORMULARIO[tipo]}</span>
      </div>
      <div className="field" style={{ marginTop: 8 }}>
        <label htmlFor="nm-numero">Nº de formulario <span className="req">*</span></label>
        <input id="nm-numero" value={numero} maxLength={60} onChange={(e) => setNumero(e.target.value)} />
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Único en el instituto.</span>
      </div>
    </Modal>
  );
}

/* --------------------------------------------------------- ficha --- */

type Campo = { k: keyof Muestreo; l: string; tipo?: "texto" | "numero" | "fecha" | "fechahora" | "sino" | "area"; max?: number; para?: string[]; req?: string[]; ayuda?: string };
const CAMPOS: Campo[] = [
  { k: "lugar", l: "Lugar de muestreo", max: 240, req: ["extraccion", "numform", "it01_form06", "planilla_nch44"] },
  { k: "fechaToma", l: "Fecha y hora de la toma", tipo: "fechahora", req: ["extraccion", "numform", "it01_form06", "planilla_nch44"] },
  { k: "responsable", l: "Responsable de la toma", max: 200, req: ["it01_form06"] },
  { k: "solicitadoPor", l: "Solicitado por", max: 200, para: ["numform", "extraccion"], req: ["numform"] },
  { k: "producto", l: "Producto / E.T.", max: 240, req: ["extraccion", "numform"] },
  { k: "proveedor", l: "Proveedor", max: 240, req: ["extraccion", "numform"] },
  { k: "guiaDespacho", l: "Guía de despacho", max: 60, para: ["numform", "extraccion", "planilla_nch44"] },
  { k: "identificacionLote", l: "Identificación del lote", max: 120, req: ["planilla_nch44"] },
  { k: "fechaElaboracion", l: "Fecha de elaboración", tipo: "fecha", para: ["numform"] },
  { k: "tamanoLote", l: "Tamaño del lote", tipo: "numero", req: ["extraccion", "numform", "planilla_nch44"] },
  { k: "unidadPresentacion", l: "Unidad de presentación", max: 40, para: ["planilla_nch44", "extraccion"], ayuda: "Cajas, sacos, unidades, pares…" },
  { k: "tamanoMuestra", l: "Tamaño de la muestra", tipo: "numero", req: ["extraccion", "planilla_nch44"], ayuda: "Con plan NCh 44 es su n." },
  { k: "cantidadEnvase", l: "Cantidad y envase", max: 200, req: ["numform", "it01_form06"] },
  { k: "registroFotoNumero", l: "Registro fotográfico Nº", max: 60, para: ["extraccion", "planilla_nch44"], ayuda: "O adjunte las fotos abajo." },
  { k: "devolucionExcedente", l: "¿Se devuelve el excedente?", tipo: "sino", req: ["numform"], para: ["extraccion"] },
  { k: "costoUf", l: "Costo (UF)", tipo: "numero", para: ["extraccion", "numform"] },
  { k: "tiempoRespuesta", l: "Tiempo de respuesta", max: 60, para: ["extraccion", "numform"] },
  { k: "materialAdicional", l: "Material adicional / certificados", tipo: "area", para: ["it01_form06", "extraccion"] },
  { k: "observaciones", l: "Observaciones", tipo: "area" },
];

function FichaMuestreo({ d, m, onCambio }: { d: DatosMuestreo; m: Muestreo; onCambio: (r: DatosMuestreo) => void }) {
  const editable = m.estado === "borrador" && d.puede.registrar;
  const [ocupado, setOcupado] = useState(false);
  const [dialogo, setDialogo] = useState<"anular" | "noConforme" | null>(null);

  async function hacer(fn: () => Promise<DatosMuestreo>, ok: string) {
    setOcupado(true);
    try { onCambio(await fn()); toast.ok(ok); }
    catch (e: any) { toast.error(e.message); }
    finally { setOcupado(false); }
  }

  const paso = m.estado === "borrador" ? (m.faltantes.length ? (m.plan || m.tipoFormulario !== "planilla_nch44" ? 2 : 1) : 3)
    : m.estado === "registrado" ? 4 : 5;
  const formulario = d.opciones.formularios.find((f) => f.valor === m.tipoFormulario)?.etiqueta ?? m.tipoFormulario;

  return (
    <div className="card" style={{ margin: 0 }} aria-label={`Muestreo Nº ${m.numeroFormulario}`}>
      <h2>
        Muestreo Nº {m.numeroFormulario}
        <span className="right">{formulario}</span>
      </h2>
      <PasosProceso
        etiqueta="Pasos del muestreo"
        pasos={[
          { titulo: "Formulario", detalle: m.creadoPorNombre ? `Inició ${m.creadoPorNombre}` : null },
          { titulo: "Plan y unidades", detalle: m.plan ? `NCh 44 · letra ${m.plan.letra} · n ${m.plan.n}` : "NCh 43/44" },
          { titulo: "Entregar al laboratorio", detalle: m.registradoAt ? fechaHora(m.registradoAt) : "Sección Muestreo" },
          { titulo: "Recibido conforme", detalle: m.recibidoAt ? `${m.recibidoConforme ? "Conforme" : "No conforme"} · ${fechaHora(m.recibidoAt)}` : "Laboratorio" },
          { titulo: "Conclusión del lote", detalle: m.veredictoLote ? (m.veredictoLote === "acepta" ? "Acepta" : "Rechaza") : "Jefatura" },
        ]}
        actual={paso}
        completo={!!m.veredictoLote}
        anulado={m.estado === "anulado"}
      />
      {m.estado === "anulado" && <div className="alert warn">Muestreo anulado · {m.anuladoMotivo}</div>}
      {m.estado === "recibido" && m.recibidoConforme === false && (
        <div className="alert warn">Recibido NO conforme por {m.recibidoPorNombre} el {fechaHora(m.recibidoAt)}: {m.recibidoObservacion}</div>
      )}

      <FormularioMuestreo m={m} editable={editable} onCambio={onCambio} />
      <PlanMuestreo d={d} m={m} editable={editable} onCambio={onCambio} />
      <UnidadesMuestreo m={m} editable={editable} puedeReemplazar={d.puede.registrar && m.estado !== "anulado" && !m.veredictoLote} onCambio={onCambio} />
      <FotosMuestreo m={m} editable={d.puede.registrar && ["borrador", "registrado"].includes(m.estado)} onCambio={onCambio} />

      {m.estado === "borrador" && d.puede.registrar && (
        <div className="siguiente-paso" style={{ marginTop: 12, padding: 10, border: "1px solid var(--line)", borderRadius: 8, background: "#fafcfd" }}>
          {m.faltantes.length > 0 ? (
            <div role="status" style={{ fontSize: 12.5 }}>
              <b>Para entregar al laboratorio falta:</b> {m.faltantes.join(" · ")}.
            </div>
          ) : (
            <div role="status" style={{ fontSize: 12.5 }}>El formulario está completo.</div>
          )}
          <div className="toolbar" style={{ marginTop: 8, marginBottom: 0, justifyContent: "flex-end" }}>
            <button type="button" className="btn ghost-danger sm" disabled={ocupado} onClick={() => setDialogo("anular")}>Anular</button>
            <button type="button" className="btn primary" disabled={ocupado || m.faltantes.length > 0} onClick={() => hacer(() => llamar("POST", `/muestreo/${m.id}/registrar`), "Muestreo entregado al laboratorio.")}>
              Registrar muestreo → entregar al laboratorio
            </button>
          </div>
        </div>
      )}

      {m.estado === "registrado" && (
        <div style={{ marginTop: 12, padding: 10, border: "1px solid var(--accent)", borderRadius: 8, background: "#f3fbfc" }}>
          <div style={{ fontSize: 12.5 }}>
            Entregado al laboratorio por {m.registradoPorNombre ?? "—"} el {fechaHora(m.registradoAt)}.
            {m.sellos.length > 0 && <> Verifique los sellos <b>{m.sellos.join(", ")}</b> al recibir.</>}
          </div>
          <div className="toolbar" style={{ marginTop: 8, marginBottom: 0, flexWrap: "wrap" }}>
            {d.puede.registrar && <button type="button" className="btn ghost-danger sm" disabled={ocupado} onClick={() => setDialogo("anular")}>Anular</button>}
            <span className="spacer" />
            {d.puede.recibir ? (
              <>
                <button type="button" className="btn outline sm" disabled={ocupado} onClick={() => setDialogo("noConforme")}>No conforme…</button>
                <button type="button" className="btn primary" disabled={ocupado} onClick={() => hacer(() => llamar("POST", `/muestreo/${m.id}/recibir`, { conforme: true }), "Muestreo recibido conforme.")}>
                  Recibido conforme → recepcionar muestras
                </button>
              </>
            ) : <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Lo recibe el laboratorio.</span>}
          </div>
        </div>
      )}
      {m.estado === "recibido" && m.recibidoConforme && (
        <p className="subtitle" style={{ margin: "10px 0 0" }}>Recibido conforme por {m.recibidoPorNombre} el {fechaHora(m.recibidoAt)}.</p>
      )}

      {m.estado !== "anulado" && <MuestrasDelMuestreo d={d} m={m} onCambio={onCambio} />}
      {m.estado === "recibido" && <ConclusionLote d={d} m={m} onCambio={onCambio} />}

      {dialogo && (
        <MotivoModal
          titulo={dialogo === "anular" ? `Anular el muestreo Nº ${m.numeroFormulario}` : `Muestreo Nº ${m.numeroFormulario} no conforme`}
          etiqueta={dialogo === "anular" ? "Motivo de la anulación" : "¿Qué no está conforme?"}
          boton={dialogo === "anular" ? "Anular" : "Registrar no conforme"}
          onCerrar={() => setDialogo(null)}
          onConfirmar={(t) => {
            const fn = dialogo === "anular"
              ? () => llamar<DatosMuestreo>("POST", `/muestreo/${m.id}/anular`, { motivo: t })
              : () => llamar<DatosMuestreo>("POST", `/muestreo/${m.id}/recibir`, { conforme: false, observacion: t });
            setDialogo(null);
            hacer(fn, dialogo === "anular" ? "Muestreo anulado." : "Recepción no conforme registrada.");
          }}
        />
      )}
    </div>
  );
}

/* ----------------------------------------------------- formulario --- */

function FormularioMuestreo({ m, editable, onCambio }: { m: Muestreo; editable: boolean; onCambio: (r: DatosMuestreo) => void }) {
  const inicial = useMemo(() => {
    const v: Record<string, string> = {};
    for (const c of CAMPOS) {
      const x = m[c.k] as any;
      v[c.k] = c.tipo === "fechahora" ? aLocalChile(x) : c.tipo === "sino" ? (x == null ? "" : x ? "si" : "no") : c.tipo === "numero" ? coma(x) : x ?? "";
    }
    v.sellos = m.sellos.join(", ");
    v.lineaMovilPlan = m.lineaMovilPlan ?? "";
    return v;
  }, [m]);
  const [v, setV] = useState(inicial);
  const [lineaMovil, setLineaMovil] = useState(m.lineaMovil);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { setV(inicial); setLineaMovil(m.lineaMovil); }, [inicial, m.lineaMovil]);
  const campos = CAMPOS.filter((c) => !c.para && !c.req ? true : (c.req ?? []).includes(m.tipoFormulario) || (c.para ?? []).includes(m.tipoFormulario));
  const cambio = Object.keys(inicial).some((k) => inicial[k] !== v[k]) || lineaMovil !== m.lineaMovil;

  async function guardar() {
    const cuerpo: Record<string, unknown> = {};
    for (const c of campos) {
      const x = v[c.k as string];
      if (x === inicial[c.k as string]) continue;
      if (c.tipo === "numero") {
        const n = x.trim() ? Number(x.trim().replace(",", ".")) : null;
        if (n != null && !Number.isFinite(n)) return toast.error(`${c.l}: escriba un número.`);
        cuerpo[c.k] = c.k === "costoUf" ? n : n == null ? null : Math.round(n);
      } else if (c.tipo === "sino") cuerpo[c.k] = x === "" ? null : x === "si";
      else cuerpo[c.k] = x.trim() || null;
    }
    if (v.sellos !== inicial.sellos) cuerpo.sellos = v.sellos;
    if (lineaMovil !== m.lineaMovil) cuerpo.lineaMovil = lineaMovil;
    if (v.lineaMovilPlan !== inicial.lineaMovilPlan) cuerpo.lineaMovilPlan = v.lineaMovilPlan.trim() || null;
    setGuardando(true);
    try { onCambio(await llamar<DatosMuestreo>("PUT", `/muestreo/${m.id}`, cuerpo)); toast.ok("Formulario guardado."); }
    catch (e: any) { toast.error(e.message); }
    finally { setGuardando(false); }
  }

  return (
    <section aria-labelledby={`mf-${m.id}`} style={{ marginTop: 6 }}>
      <h3 id={`mf-${m.id}`} style={{ fontSize: 13, margin: "6px 0" }}>1 · Formulario de muestreo</h3>
      <p className="subtitle" style={{ margin: "0 0 6px" }}>{AYUDA_FORMULARIO[m.tipoFormulario]}</p>
      <div className="form-grid">
        {campos.map((c) => {
          const id = `mu-${m.id}-${String(c.k)}`;
          const oblig = (c.req ?? []).includes(m.tipoFormulario);
          const val = v[c.k as string] ?? "";
          const set = (x: string) => setV((p) => ({ ...p, [c.k]: x }));
          return (
            <div key={String(c.k)} className={`field${editable ? "" : " readonly"}`} style={c.tipo === "area" ? { gridColumn: "1 / -1" } : undefined}>
              <label htmlFor={id}>{c.l}{oblig && <span className="req"> *</span>}</label>
              {c.tipo === "sino" ? (
                <select id={id} value={val} disabled={!editable} onChange={(e) => set(e.target.value)}>
                  <option value="">—</option><option value="si">Sí</option><option value="no">No</option>
                </select>
              ) : c.tipo === "area" ? (
                <textarea id={id} rows={2} value={val} readOnly={!editable} maxLength={4000} onChange={(e) => set(e.target.value)} />
              ) : (
                <input id={id} value={val} readOnly={!editable} maxLength={c.max ?? 40}
                  type={c.tipo === "fechahora" ? "datetime-local" : c.tipo === "fecha" ? "date" : "text"}
                  inputMode={c.tipo === "numero" ? "decimal" : undefined} onChange={(e) => set(e.target.value)} />
              )}
              {c.ayuda && <span style={{ fontSize: 11, color: "var(--muted)" }}>{c.ayuda}</span>}
            </div>
          );
        })}
        <div className={`field${editable ? "" : " readonly"}`} style={{ gridColumn: "span 2" }}>
          <label htmlFor={`mu-${m.id}-sellos`}>Sellos Nº{m.tipoFormulario === "extraccion" && <span className="req"> *</span>}</label>
          <input id={`mu-${m.id}-sellos`} value={v.sellos} readOnly={!editable} maxLength={4000} onChange={(e) => setV((p) => ({ ...p, sellos: e.target.value }))} placeholder="Separados por coma" />
        </div>
      </div>
      <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, marginTop: 8 }}>
        <input type="checkbox" checked={lineaMovil} disabled={!editable} onChange={(e) => setLineaMovil(e.target.checked)} />
        Línea de fabricación móvil (camión fábrica): SAC-PG01-IT10 no aplica el muestreo NCh 44
      </label>
      {lineaMovil && (
        <div className={`field${editable ? "" : " readonly"}`} style={{ marginTop: 6 }}>
          <label htmlFor={`mu-${m.id}-lmp`}>Plan aplicado en la línea móvil <span className="req">*</span></label>
          <textarea id={`mu-${m.id}-lmp`} rows={2} value={v.lineaMovilPlan} readOnly={!editable} maxLength={2000} onChange={(e) => setV((p) => ({ ...p, lineaMovilPlan: e.target.value }))} />
          <span style={{ fontSize: 11, color: "var(--muted)" }}>Por confirmar con el IDIC: qué plan rige en la línea móvil.</span>
        </div>
      )}
      {editable && (
        <div className="toolbar" style={{ marginTop: 8, marginBottom: 0, justifyContent: "flex-end" }}>
          <button type="button" className="btn outline sm" disabled={!cambio || guardando} onClick={guardar}>{guardando ? "Guardando…" : "Guardar formulario"}</button>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------ plan --- */

interface Propuesta {
  letra: string; nLetra: number; n: number; nExtraer: number; inspeccion100: boolean; periodo: number; avisos: string[];
  clases: Partial<Record<ClaseDefecto, { letra: string; n: number; ac: number; re: number; aql: number; nEfectivo: number; flecha: string | null }>>;
}

function PlanMuestreo({ d, m, editable, onCambio }: { d: DatosMuestreo; m: Muestreo; editable: boolean; onCambio: (r: DatosMuestreo) => void }) {
  const p = m.plan;
  const [nivel, setNivel] = useState(p?.nivel ?? d.porDefecto.nivel);
  const [tabla, setTabla] = useState(p?.tabla ?? "normal");
  const [aql, setAql] = useState<Record<ClaseDefecto, string>>(() => {
    const base = Object.fromEntries(CLASES.map((c) => [c, p ? (p.aql[c] != null ? String(p.aql[c]) : "ninguno") : d.porDefecto.aql[c] ?? "ninguno"]));
    return base as Record<ClaseDefecto, string>;
  });
  const [n, setN] = useState(p && p.nPropuesto != null && p.n !== p.nPropuesto ? String(p.n) : p && p.tabla !== "normal" ? String(p.n) : "");
  const [motivoN, setMotivoN] = useState(p?.motivoN ?? "");
  const [manual, setManual] = useState<Record<ClaseDefecto, { ac: string; re: string }>>(() =>
    Object.fromEntries(CLASES.map((c) => [c, { ac: p?.clases[c]?.manual ? String(p.clases[c]!.ac) : "", re: p?.clases[c]?.manual ? String(p.clases[c]!.re) : "" }])) as any,
  );
  const [prop, setProp] = useState<Propuesta | null>(null);
  const [errProp, setErrProp] = useState("");
  const [guardando, setGuardando] = useState(false);

  // Propuesta en vivo (GET /muestreo/plan).
  useEffect(() => {
    if (!m.tamanoLote || m.tamanoLote < 2) { setProp(null); setErrProp("Indique el tamaño del lote en el formulario para calcular el plan."); return; }
    const t = setTimeout(() => {
      llamar<Propuesta>("GET", `/muestreo/plan${qs({ tamanoLote: m.tamanoLote, nivel, tabla, aql_critico: aql.critico, aql_mayor: aql.mayor, aql_menor: aql.menor })}`)
        .then((r) => { setProp(r); setErrProp(""); })
        .catch((e) => { setProp(null); setErrProp(e.message); });
    }, 200);
    return () => clearTimeout(t);
  }, [m.tamanoLote, nivel, tabla, aql]);

  async function guardar() {
    const cuerpo: any = {
      plan: {
        nivel, tabla,
        aql: Object.fromEntries(CLASES.map((c) => [c, aql[c] === "ninguno" ? null : aql[c]])),
        n: n.trim() ? Number(n) : null,
        motivoN: motivoN.trim() || null,
        manual: tabla === "normal" ? undefined : Object.fromEntries(CLASES.filter((c) => aql[c] !== "ninguno").map((c) => [c, { ac: Number(manual[c].ac), re: Number(manual[c].re) }])),
      },
    };
    setGuardando(true);
    try { onCambio(await llamar<DatosMuestreo>("PUT", `/muestreo/${m.id}`, cuerpo)); toast.ok("Plan de muestreo guardado."); }
    catch (e: any) { toast.error(e.message); }
    finally { setGuardando(false); }
  }

  const nDistinto = tabla === "normal" && n.trim() !== "" && prop && Number(n) !== prop.nExtraer;
  const opcionesAql = [{ valor: "ninguno", etiqueta: "Sin AQL" }, ...d.opciones.aql];
  return (
    <section aria-labelledby={`mp-${m.id}`} style={{ marginTop: 14 }}>
      <h3 id={`mp-${m.id}`} style={{ fontSize: 13, margin: "6px 0" }}>
        2 · Plan de muestreo NCh 44 {m.tipoFormulario === "planilla_nch44" ? <span className="req">*</span> : <span style={{ fontWeight: 400, color: "var(--muted)" }}>(opcional)</span>}
      </h3>
      {editable ? (
        <>
          <div className="form-grid">
            <div className="field">
              <label htmlFor={`pl-niv-${m.id}`}>Nivel de inspección</label>
              <select id={`pl-niv-${m.id}`} value={nivel} onChange={(e) => setNivel(e.target.value)}>
                {d.opciones.niveles.map((o) => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`pl-tab-${m.id}`}>Tabla</label>
              <select id={`pl-tab-${m.id}`} value={tabla} onChange={(e) => setTabla(e.target.value)}>
                <option value="normal">2-A · inspección normal</option>
                <option value="estricta">2-B · estricta (n y Ac/Re a mano)</option>
                <option value="reducida">2-C · reducida (n y Ac/Re a mano)</option>
              </select>
            </div>
            {CLASES.map((c) => (
              <div className="field" key={c}>
                <label htmlFor={`pl-aql-${c}-${m.id}`}>AQL · {CLASE_DEFECTO[c].texto.toLowerCase()}</label>
                <select id={`pl-aql-${c}-${m.id}`} value={aql[c]} onChange={(e) => setAql((x) => ({ ...x, [c]: e.target.value }))}>
                  {opcionesAql.map((o) => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
                </select>
              </div>
            ))}
          </div>
          {errProp && <p className="subtitle" style={{ margin: "6px 0 0" }}>{errProp}</p>}
          {prop && (
            <div style={{ marginTop: 8 }}>
              <table className="data" aria-label="Plan propuesto">
                <thead><tr><th scope="col">Clase</th><th scope="col">AQL</th><th scope="col">Letra</th><th scope="col">n</th><th scope="col">Ac</th><th scope="col">Re</th></tr></thead>
                <tbody>
                  <tr><td>Lote de {m.tamanoLote}</td><td>—</td><td><b>{prop.letra}</b></td><td>{prop.n}</td><td colSpan={2} style={{ color: "var(--muted)" }}>Tabla 1 · nivel {nivel}</td></tr>
                  {CLASES.filter((c) => aql[c] !== "ninguno").map((c) => {
                    const x = prop.clases[c];
                    return (
                      <tr key={c}>
                        <td><span className={`pill ${CLASE_DEFECTO[c].pill}`}>{CLASE_DEFECTO[c].texto}</span></td>
                        <td>{coma(aql[c])}</td>
                        {tabla === "normal" && x ? (
                          <><td>{x.letra}{x.flecha ? (x.flecha === "abajo" ? " ↓" : " ↑") : ""}</td><td>{x.nEfectivo}</td><td>{x.ac}</td><td>{x.re}</td></>
                        ) : (
                          <>
                            <td>{prop.letra}</td><td>{n || "—"}</td>
                            <td><input aria-label={`Ac ${CLASE_DEFECTO[c].texto}`} inputMode="numeric" style={{ width: 54, padding: "3px 6px", border: "1px solid var(--line)", borderRadius: 5 }} value={manual[c].ac} onChange={(e) => setManual((y) => ({ ...y, [c]: { ...y[c], ac: e.target.value } }))} /></td>
                            <td><input aria-label={`Re ${CLASE_DEFECTO[c].texto}`} inputMode="numeric" style={{ width: 54, padding: "3px 6px", border: "1px solid var(--line)", borderRadius: 5 }} value={manual[c].re} onChange={(e) => setManual((y) => ({ ...y, [c]: { ...y[c], re: e.target.value } }))} /></td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {prop.avisos.map((a) => <div key={a} className="alert info" style={{ marginTop: 6 }}>{a}</div>)}
              <div className="form-grid" style={{ marginTop: 6 }}>
                <div className="field">
                  <label htmlFor={`pl-n-${m.id}`}>Tamaño de muestra a extraer</label>
                  <input id={`pl-n-${m.id}`} inputMode="numeric" value={n} placeholder={tabla === "normal" ? `Propuesto: ${prop.nExtraer}` : "Escriba n"} onChange={(e) => setN(e.target.value)} />
                </div>
                {(nDistinto || tabla !== "normal") && (
                  <div className="field" style={{ gridColumn: "span 3" }}>
                    <label htmlFor={`pl-mot-${m.id}`}>Motivo{tabla !== "normal" ? " y tabla de la que salen n, Ac y Re" : " del cambio de n"} <span className="req">*</span></label>
                    <input id={`pl-mot-${m.id}`} value={motivoN} maxLength={500} onChange={(e) => setMotivoN(e.target.value)} />
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="toolbar" style={{ marginTop: 8, marginBottom: 0, justifyContent: "flex-end" }}>
            {p && <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Guardado: letra {p.letra} · n {p.n}</span>}
            <button type="button" className="btn outline sm" disabled={guardando || !prop} onClick={guardar}>{guardando ? "Guardando…" : "Guardar plan"}</button>
          </div>
        </>
      ) : p ? (
        <table className="data" aria-label="Plan de muestreo">
          <thead><tr><th scope="col">Clase</th><th scope="col">AQL</th><th scope="col">Letra</th><th scope="col">n</th><th scope="col">Ac</th><th scope="col">Re</th></tr></thead>
          <tbody>
            <tr><td>Lote de {m.tamanoLote}</td><td>—</td><td><b>{p.letra}</b></td><td>{p.n}{p.inspeccion100 ? " (100 %)" : ""}</td><td colSpan={2} style={{ color: "var(--muted)" }}>Nivel {p.nivel} · tabla {p.tabla}{p.motivoN ? ` · ${p.motivoN}` : ""}</td></tr>
            {CLASES.filter((c) => p.clases[c]).map((c) => (
              <tr key={c}><td><span className={`pill ${CLASE_DEFECTO[c].pill}`}>{CLASE_DEFECTO[c].texto}</span></td><td>{coma(p.clases[c]!.aql)}</td><td>{p.clases[c]!.letra}</td><td>{p.clases[c]!.n}</td><td>{p.clases[c]!.ac}</td><td>{p.clases[c]!.re}</td></tr>
            ))}
          </tbody>
        </table>
      ) : <p className="subtitle" style={{ margin: 0 }}>Sin plan NCh 44.</p>}
    </section>
  );
}

/* --------------------------------------------------------- unidades --- */

function UnidadesMuestreo({ m, editable, puedeReemplazar, onCambio }: { m: Muestreo; editable: boolean; puedeReemplazar: boolean; onCambio: (r: DatosMuestreo) => void }) {
  const [filas, setFilas] = useState(m.unidades.map((u) => ({ posicion: u.posicion == null ? "" : String(u.posicion), identificacion: u.identificacion ?? "", talla: u.talla ?? "", ubicacion: u.ubicacion ?? "" })));
  const [inicio, setInicio] = useState(m.plan?.seleccion.inicio ? String(m.plan.seleccion.inicio) : "");
  const [ocupado, setOcupado] = useState(false);
  const [reemplazo, setReemplazo] = useState<Unidad | null>(null);
  useEffect(() => {
    setFilas(m.unidades.map((u) => ({ posicion: u.posicion == null ? "" : String(u.posicion), identificacion: u.identificacion ?? "", talla: u.talla ?? "", ubicacion: u.ubicacion ?? "" })));
  }, [m.unidades]);
  const paso = m.tamanoLote && m.tamanoMuestra ? Math.max(1, Math.floor(m.tamanoLote / m.tamanoMuestra)) : null;

  async function hacer(fn: () => Promise<DatosMuestreo>, ok: string) {
    setOcupado(true);
    try { onCambio(await fn()); toast.ok(ok); }
    catch (e: any) { toast.error(e.message); }
    finally { setOcupado(false); }
  }
  const sellosDe = (u: Unidad) => (u.reemplazaId ? m.unidades.find((x) => x.id === u.reemplazaId) : null);

  return (
    <section aria-labelledby={`mu-u-${m.id}`} style={{ marginTop: 14 }}>
      <h3 id={`mu-u-${m.id}`} style={{ fontSize: 13, margin: "6px 0" }}>Unidades seleccionadas · NCh 43</h3>
      {editable && (
        <div className="toolbar" style={{ flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
          <span style={{ fontSize: 12 }}>
            Selección sistemática: período {paso ?? "—"}{paso ? ` (lote ${m.tamanoLote} / muestra ${m.tamanoMuestra})` : " · indique lote y muestra"}
          </span>
          <label className="sr-only" htmlFor={`sel-ini-${m.id}`}>Punto de partida</label>
          <input id={`sel-ini-${m.id}`} inputMode="numeric" placeholder={paso ? `Inicio 1–${paso}` : "Inicio"} style={{ width: 92 }} value={inicio} onChange={(e) => setInicio(e.target.value)} />
          <button type="button" className="btn outline sm" disabled={ocupado || !paso || !inicio.trim()} onClick={() => hacer(() => llamar("POST", `/muestreo/${m.id}/seleccion`, { inicio: Number(inicio) }), "Unidades seleccionadas.")}>Seleccionar desde el inicio</button>
          <button type="button" className="btn outline sm" disabled={ocupado || !paso} onClick={() => hacer(() => llamar("POST", `/muestreo/${m.id}/seleccion`, { sortear: true }), "Punto de partida sorteado.")}>Sortear el inicio</button>
        </div>
      )}
      {m.unidades.length === 0 && !editable ? (
        <p className="subtitle" style={{ margin: 0 }}>Sin unidades registradas.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="data" aria-label="Unidades seleccionadas">
            <thead><tr><th scope="col">#</th><th scope="col">Posición en el lote</th><th scope="col">Serie / identificación</th><th scope="col">Talla</th><th scope="col">Panel / ubicación</th><th scope="col">{editable ? <span className="sr-only">Quitar</span> : "Reemplazo"}</th></tr></thead>
            <tbody>
              {editable
                ? filas.map((f, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      {(["posicion", "identificacion", "talla", "ubicacion"] as const).map((k) => (
                        <td key={k}>
                          <input aria-label={`${ETIQ_UNIDAD[k]} de la unidad ${i + 1}`} value={f[k]} inputMode={k === "posicion" ? "numeric" : undefined}
                            style={{ width: k === "identificacion" ? 160 : 90, padding: "4px 7px", border: "1px solid var(--line)", borderRadius: 5, font: "inherit", fontSize: 12.5 }}
                            onChange={(e) => setFilas((xs) => xs.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} />
                        </td>
                      ))}
                      <td><button type="button" className="btn ghost-danger sm" onClick={() => setFilas((xs) => xs.filter((_, j) => j !== i))} aria-label={`Quitar la unidad ${i + 1}`}>Quitar</button></td>
                    </tr>
                  ))
                : m.unidades.map((u, i) => (
                    <tr key={u.id} style={u.reemplazada ? { color: "var(--muted)", textDecoration: "line-through" } : undefined}>
                      <td>{i + 1}</td><td>{u.posicion ?? "—"}</td><td>{u.identificacion ?? "—"}</td><td>{u.talla ?? "—"}</td><td>{u.ubicacion ?? "—"}</td>
                      <td style={{ textDecoration: "none" }}>
                        {u.reemplazada ? <span title={u.motivoReemplazo ?? ""}>Reemplazada · {u.motivoReemplazo}</span>
                          : sellosDe(u) ? <span className="pill blue">Reemplaza a la posición {sellosDe(u)!.posicion ?? sellosDe(u)!.identificacion}</span>
                          : puedeReemplazar ? <button type="button" className="btn outline sm" onClick={() => setReemplazo(u)}>Reemplazar…</button> : "—"}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}
      {editable && (
        <div className="toolbar" style={{ marginTop: 6, marginBottom: 0 }}>
          <button type="button" className="btn outline sm" onClick={() => setFilas((xs) => [...xs, { posicion: "", identificacion: "", talla: "", ubicacion: "" }])}>＋ Agregar unidad</button>
          <span className="spacer" />
          <button type="button" className="btn outline sm" disabled={ocupado}
            onClick={() => hacer(() => llamar("PUT", `/muestreo/${m.id}/unidades`, {
              unidades: filas.map((f) => ({ posicion: f.posicion.trim() ? Number(f.posicion) : null, identificacion: f.identificacion.trim() || null, talla: f.talla.trim() || null, ubicacion: f.ubicacion.trim() || null })),
            }), "Unidades guardadas.")}>Guardar unidades</button>
        </div>
      )}
      {reemplazo && (
        <ReemplazoModal u={reemplazo} onCerrar={() => setReemplazo(null)}
          onConfirmar={(c) => { setReemplazo(null); hacer(() => llamar("POST", `/muestreo/${m.id}/unidades/${reemplazo.id}/reemplazo`, c), "Reemplazo registrado."); }} />
      )}
    </section>
  );
}

function ReemplazoModal({ u, onCerrar, onConfirmar }: { u: Unidad; onCerrar: () => void; onConfirmar: (c: { identificacion: string; posicion: number | null; motivo: string }) => void }) {
  const [ident, setIdent] = useState("");
  const [pos, setPos] = useState("");
  const [motivo, setMotivo] = useState("");
  return (
    <Modal titulo={`Reemplazar la unidad ${u.posicion ?? u.identificacion ?? ""}`} onCerrar={onCerrar}
      acciones={<><button type="button" className="btn outline sm" onClick={onCerrar}>Cancelar</button>
        <button type="button" className="btn primary sm" disabled={!ident.trim() || motivo.trim().length < 5} onClick={() => onConfirmar({ identificacion: ident.trim(), posicion: pos.trim() ? Number(pos) : null, motivo: motivo.trim() })}>Registrar reemplazo</button></>}>
      <p style={{ marginTop: 0 }}>La unidad queda tachada con su motivo (p. ej. serie destruida) y se agrega la de reemplazo.</p>
      <div className="form-grid cols-2">
        <div className="field"><label htmlFor="rz-id">Unidad de reemplazo <span className="req">*</span></label><input id="rz-id" value={ident} maxLength={120} onChange={(e) => setIdent(e.target.value)} placeholder="Serie o Nº" /></div>
        <div className="field"><label htmlFor="rz-pos">Posición en el lote</label><input id="rz-pos" inputMode="numeric" value={pos} onChange={(e) => setPos(e.target.value)} /></div>
        <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="rz-mot">Motivo <span className="req">*</span></label><input id="rz-mot" value={motivo} maxLength={1000} onChange={(e) => setMotivo(e.target.value)} /></div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------ fotos --- */

function FotosMuestreo({ m, editable, onCambio }: { m: Muestreo; editable: boolean; onCambio: (r: DatosMuestreo) => void }) {
  const archivo = useRef<HTMLInputElement>(null);
  const [pie, setPie] = useState("");
  const [subiendo, setSubiendo] = useState(false);
  async function adjuntar() {
    const a = archivo.current?.files?.[0];
    if (!a) return toast.error("Elija la foto que quiere adjuntar.");
    setSubiendo(true);
    try {
      const blob = await prepararFoto(a);
      const form = new FormData();
      form.append("archivo", blob, a.name);
      if (pie.trim()) form.append("pie", pie.trim());
      onCambio(await enviarInforme(`/muestreo/${m.id}/fotos`, "POST", form));
      setPie("");
      if (archivo.current) archivo.current.value = "";
      toast.ok("Foto del muestreo adjuntada.");
    } catch (e: any) { toast.error(e.message); }
    finally { setSubiendo(false); }
  }
  async function quitar(id: string) {
    if (!(await confirmar({ titulo: "¿Quitar la foto?", mensaje: "Deja de estar en el registro fotográfico del muestreo.", confirmarTexto: "Quitar", peligro: true }))) return;
    try { onCambio(await api.remove("muestreo/fotos", id) as any); toast.ok("Foto quitada."); }
    catch (e: any) { toast.error(e.message); }
  }
  return (
    <section aria-labelledby={`mu-f-${m.id}`} style={{ marginTop: 14 }}>
      <h3 id={`mu-f-${m.id}`} style={{ fontSize: 13, margin: "6px 0" }}>Registro fotográfico · {m.fotos.length} foto(s){m.registroFotoNumero ? ` · Nº ${m.registroFotoNumero}` : ""}</h3>
      {m.fotos.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 8px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
          {m.fotos.map((f, i) => (
            <li key={f.id} style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 6, background: "#fff" }}>
              <ImagenFoto url={f.url} alt={f.pie || `Foto ${i + 1} del muestreo ${m.numeroFormulario}`} />
              <div style={{ fontSize: 11.5, marginTop: 4 }}>{f.pie || <span style={{ color: "var(--muted)" }}>Sin pie</span>}</div>
              {editable && <button type="button" className="btn ghost-danger sm" style={{ marginTop: 4 }} onClick={() => quitar(f.id)}>Quitar</button>}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <div className="toolbar" style={{ margin: 0, alignItems: "flex-end", flexWrap: "wrap", gap: 8 }}>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor={`muf-${m.id}`}>Foto (PNG o JPEG)</label>
            <input id={`muf-${m.id}`} ref={archivo} type="file" accept="image/png,image/jpeg" disabled={subiendo} />
          </div>
          <div className="field" style={{ margin: 0, flex: 1, minWidth: 180 }}>
            <label htmlFor={`mufp-${m.id}`}>Pie</label>
            <input id={`mufp-${m.id}`} value={pie} maxLength={500} onChange={(e) => setPie(e.target.value)} placeholder="Lote, sellos, rótulo…" disabled={subiendo} />
          </div>
          <button type="button" className="btn outline sm" disabled={subiendo} onClick={adjuntar}>{subiendo ? "Subiendo…" : "Adjuntar foto"}</button>
        </div>
      )}
    </section>
  );
}

/* --------------------------------------------- muestras del muestreo --- */

function MuestrasDelMuestreo({ d, m, onCambio }: { d: DatosMuestreo; m: Muestreo; onCambio: (r: DatosMuestreo) => void }) {
  const [elegidas, setElegidas] = useState<string[]>(m.muestras);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => setElegidas(m.muestras), [m.muestras]);
  if (!d.muestras.length) return null;
  const cambio = elegidas.slice().sort().join() !== m.muestras.slice().sort().join();
  return (
    <section aria-labelledby={`mu-m-${m.id}`} style={{ marginTop: 14 }}>
      <h3 id={`mu-m-${m.id}`} style={{ fontSize: 13, margin: "6px 0" }}>Muestras que salen de este muestreo</h3>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px" }}>
        {d.muestras.map((x) => {
          const otro = x.muestreoId && x.muestreoId !== m.id;
          return (
            <label key={x.id} style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 12.5 }} title={otro ? "Enlazada a otro muestreo" : undefined}>
              <input type="checkbox" disabled={!d.puede.recibir} checked={elegidas.includes(x.id)}
                onChange={(e) => setElegidas((xs) => (e.target.checked ? [...xs, x.id] : xs.filter((y) => y !== x.id)))} />
              <span className="codigo">{x.codigo}</span>{x.nombre ? ` · ${x.nombre}` : ""}{otro ? <span className="pill gray">otro muestreo</span> : null}
            </label>
          );
        })}
      </div>
      {d.puede.recibir && (
        <div className="toolbar" style={{ marginTop: 6, marginBottom: 0, justifyContent: "flex-end" }}>
          <button type="button" className="btn outline sm" disabled={!cambio || guardando}
            onClick={async () => {
              setGuardando(true);
              try { onCambio(await llamar("PUT", `/muestreo/${m.id}/muestras`, { muestraIds: elegidas })); toast.ok("Muestras enlazadas al muestreo."); }
              catch (e: any) { toast.error(e.message); }
              finally { setGuardando(false); }
            }}>Guardar muestras del muestreo</button>
        </div>
      )}
    </section>
  );
}

/* ---------------------------------------------- conclusión del lote --- */

interface Conclusion {
  muestreo: { veredictoLote: string | null; conclusion: string | null; concluidoAt: string | null; concluidoPorNombre: string | null };
  reglaSinPlan: string;
  alcance: string;
  pendientes: number;
  sinEnsayos: boolean;
  sinClase: number;
  propuesta: { veredicto: string; regla: string; detalle: { clase: ClaseDefecto; defectuosas: number; ac: number | null; re: number | null; decision: string }[] };
  noConformes: { id: string; muestraCodigo: string; ensayo: string | null; claseDefecto: string | null; especFuente: string | null }[];
  puedeConcluir: boolean;
}

function ConclusionLote({ d, m, onCambio }: { d: DatosMuestreo; m: Muestreo; onCambio: (r: DatosMuestreo) => void }) {
  const [c, setC] = useState<Conclusion | null>(null);
  const [def, setDef] = useState<Record<ClaseDefecto, string>>({ critico: "", mayor: "", menor: "" });
  const [texto, setTexto] = useState("");
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const cargar = useCallback(() => {
    llamar<Conclusion>("GET", `/muestreo/${m.id}/conclusion`).then((r) => {
      setC(r);
      setDef(Object.fromEntries(r.propuesta.detalle.map((x) => [x.clase, String(x.defectuosas)])) as any);
      setTexto(r.muestreo.conclusion ?? "");
    }).catch(() => setC(null));
  }, [m.id]);
  useEffect(() => { cargar(); }, [cargar, m.veredictoLote]);
  if (!c) return null;
  const cambiadas = c.propuesta.detalle.filter((x) => def[x.clase] !== String(x.defectuosas));
  const vista = c.propuesta.detalle.map((x) => {
    const n = Number(def[x.clase]);
    const usada = Number.isFinite(n) ? n : x.defectuosas;
    return { ...x, usada, decision: x.re == null ? "acepta" : usada >= x.re ? "rechaza" : "acepta" };
  });
  const veredicto = vista.some((x) => x.decision === "rechaza") ? "rechaza" : c.pendientes || c.sinEnsayos ? "pendiente" : "acepta";
  const pill = (v: string) => (v === "rechaza" ? "red" : v === "acepta" ? "green" : "amber");
  const textoV = (v: string) => (v === "rechaza" ? "Rechaza el lote" : v === "acepta" ? "Acepta el lote" : "Pendiente");
  const editable = c.puedeConcluir && d.puede.concluir;

  async function concluir() {
    setOcupado(true);
    try {
      await llamar("POST", `/muestreo/${m.id}/concluir`, {
        conclusion: texto.trim(),
        defectuosas: Object.fromEntries(cambiadas.map((x) => [x.clase, Number(def[x.clase])])),
        motivo: motivo.trim() || undefined,
      });
      toast.ok("Lote concluido.");
      onCambio(await llamar<DatosMuestreo>("GET", `/muestreo/ot/${d.ot.id}`));
    } catch (e: any) { toast.error(e.message); }
    finally { setOcupado(false); }
  }

  return (
    <section aria-labelledby={`mu-c-${m.id}`} style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
      <h3 id={`mu-c-${m.id}`} style={{ fontSize: 13, margin: "6px 0", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        Conclusión del lote
        <span className={`pill ${pill(c.muestreo.veredictoLote ?? veredicto)}`} role="status">
          {c.muestreo.veredictoLote ? `${textoV(c.muestreo.veredictoLote)} · concluido` : `Propuesta: ${textoV(veredicto)}`}
        </span>
      </h3>
      <p className="subtitle" style={{ margin: "0 0 6px" }}>
        {c.propuesta.regla} Cuenta {c.alcance}.{c.sinClase ? ` ${c.sinClase} no conformidad(es) sin clase cuentan como mayores.` : ""}
        {c.sinEnsayos ? " Las muestras aún no tienen ensayos." : c.pendientes ? ` Quedan ${c.pendientes} ensayo(s) sin decidir.` : ""}
      </p>
      <table className="data" aria-label="Unidades no conformes por clase">
        <thead><tr><th scope="col">Clase</th><th scope="col">Unidades no conformes</th><th scope="col">Ac</th><th scope="col">Re</th><th scope="col">Decisión</th></tr></thead>
        <tbody>
          {vista.map((x) => (
            <tr key={x.clase}>
              <td><span className={`pill ${CLASE_DEFECTO[x.clase].pill}`}>{CLASE_DEFECTO[x.clase].texto}</span></td>
              <td>
                {editable && !c.muestreo.veredictoLote ? (
                  <input aria-label={`Unidades no conformes ${CLASE_DEFECTO[x.clase].texto}`} inputMode="numeric" style={{ width: 70, padding: "3px 6px", border: "1px solid var(--line)", borderRadius: 5 }} value={def[x.clase]}
                    onChange={(e) => setDef((y) => ({ ...y, [x.clase]: e.target.value }))} />
                ) : x.usada}
                {String(x.usada) !== String(x.defectuosas) && <span style={{ fontSize: 11, color: "var(--muted)" }}> (el sistema cuenta {x.defectuosas})</span>}
              </td>
              <td>{x.ac ?? "—"}</td><td>{x.re ?? "—"}</td>
              <td><span className={`pill ${pill(x.decision)}`}>{x.decision === "rechaza" ? "Rechaza" : "Acepta"}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      {c.noConformes.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary style={{ cursor: "pointer", fontSize: 12.5 }}>{c.noConformes.length} ensayo(s) no conforme(s)</summary>
          <ul style={{ margin: "4px 0 0 18px", padding: 0, fontSize: 12 }}>
            {c.noConformes.map((n) => (
              <li key={n.id}>{n.muestraCodigo} · {n.ensayo ?? "ensayo"} · {n.claseDefecto ? CLASE_DEFECTO[n.claseDefecto as ClaseDefecto]?.texto ?? n.claseDefecto : "sin clase"}{n.especFuente ? ` · ${n.especFuente}` : ""}</li>
            ))}
          </ul>
        </details>
      )}
      {c.muestreo.veredictoLote ? (
        <p style={{ fontSize: 12.5, margin: "8px 0 0" }}>{c.muestreo.conclusion} <span style={{ color: "var(--muted)" }}>— {c.muestreo.concluidoPorNombre}, {fechaHora(c.muestreo.concluidoAt)}</span></p>
      ) : editable ? (
        <div className="form-grid cols-2" style={{ marginTop: 8 }}>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label htmlFor={`cl-txt-${m.id}`}>Conclusión <span className="req">*</span></label>
            <textarea id={`cl-txt-${m.id}`} rows={2} value={texto} maxLength={4000} onChange={(e) => setTexto(e.target.value)} />
          </div>
          {cambiadas.length > 0 && (
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label htmlFor={`cl-mot-${m.id}`}>Motivo de las unidades verificadas distintas <span className="req">*</span></label>
              <input id={`cl-mot-${m.id}`} value={motivo} maxLength={1000} onChange={(e) => setMotivo(e.target.value)} />
            </div>
          )}
          <div className="toolbar" style={{ gridColumn: "1 / -1", margin: 0, justifyContent: "flex-end" }}>
            <button type="button" className="btn primary" disabled={ocupado || texto.trim().length < 5 || veredicto === "pendiente" || (cambiadas.length > 0 && motivo.trim().length < 5)} onClick={concluir}>
              Concluir → revisión técnica
            </button>
          </div>
        </div>
      ) : (
        <p className="subtitle" style={{ margin: "6px 0 0" }}>La conclusión la registra la jefatura del laboratorio.</p>
      )}
    </section>
  );
}

function MotivoModal({ titulo, etiqueta, boton, onCerrar, onConfirmar }: { titulo: string; etiqueta: string; boton: string; onCerrar: () => void; onConfirmar: (t: string) => void }) {
  const [t, setT] = useState("");
  return (
    <Modal titulo={titulo} onCerrar={onCerrar}
      acciones={<><button type="button" className="btn outline sm" onClick={onCerrar}>Cancelar</button><button type="button" className="btn primary sm" disabled={t.trim().length < 5} onClick={() => onConfirmar(t.trim())}>{boton}</button></>}>
      <div className="field">
        <label htmlFor="mm-texto">{etiqueta} <span className="req">*</span></label>
        <textarea id="mm-texto" rows={3} value={t} maxLength={2000} onChange={(e) => setT(e.target.value)} autoFocus />
        <span style={{ fontSize: 11, color: "var(--muted)" }}>Mínimo 5 caracteres. Queda en el historial de la OT.</span>
      </div>
    </Modal>
  );
}
