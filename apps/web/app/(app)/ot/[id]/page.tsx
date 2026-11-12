"use client";

import { useCambiosOt } from "@/lib/refresco";
import DatosEncargoOt from "./_components/DatosEncargoOt";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { recordarOtActiva } from "@/lib/ot-activa";
import { fecha, fechaHora, fechaDia, rut, clp, num, hoyISO } from "@/lib/format";
import { ACEPTACION_LABEL, ORIGEN_LABEL } from "../../cotizaciones/_components/comercial";
import { usePermisos } from "@/lib/permisos";
import ComercialOt from "./_components/ComercialOt";
import { llamar, etiquetaUnidad } from "@/lib/laboratorio";
import { toast } from "@/components/ui/feedback";
import { textoMedio } from "@/lib/etiquetas";
import { useMediosEnvio } from "@/lib/lista-parametro";
import SelectorLaboratorio from "@/components/SelectorLaboratorio";
import Asignacion from "./_components/Asignacion";
import TerrenoOt from "./_components/TerrenoOt";
import RegistroMuestras from "./_components/RegistroMuestras";
import OrdenesInternasOt from "./_components/OrdenesInternasOt";
import CabeceraInspeccionOt from "./_components/CabeceraInspeccionOt";
import EspecificacionTecnicaOt from "./_components/EspecificacionTecnicaOt";
import MuestreoOt from "./_components/MuestreoOt";
import FotosOt from "./_components/FotosOt";
import EstadoPorLaboratorio from "./_components/EstadoPorLaboratorio";
import CarpetaOt from "./_components/CarpetaOt";
import PanelCierreOt from "@/components/documentos/PanelCierreOt";
import SeguimientoOt from "@/components/documentos/SeguimientoOt";
import OrigenBpchOt from "@/components/bpch-procesos/OrigenBpchOt";
import NotificacionDgmn from "@/components/bpch-procesos/NotificacionDgmn";
import RevisionDocumental from "@/components/bpch-procesos/RevisionDocumental";
import { MOTOR_FLUJOS_VISIBLE } from "@/lib/motorFlujos";
import FlujoBpmOt from "./_components/FlujoBpmOt";
import { EtapasOt, SiguientePasoOt, type AvanceOt } from "@/components/ot/RutaOt";
import InstrumentosOt from "@/components/metrologia/InstrumentosOt";
import PreparacionOt from "@/components/formularios/PreparacionOt";
import RemitirDco from "@/components/bpch-procesos/RemitirDco";
import ConsumosOt from "@/components/consumibles/ConsumosOt";

/** Laboratorios de la Sección Metrología: sus OT trabajan con instrumentos, no con muestras (EP-04). */
const LABS_METROLOGIA = ["LMT", "LMTE", "LNF", "LCAD"];

/** Texto legible de un hecho del historial de la OT. */
function textoHistorial(h: any): string {
  const d = h.detalle ?? {};
  if (h.tipo === "laboratorio") {
    const hacia = d.hacia?.codigo ?? "—";
    if (d.desde) return `Laboratorio cambiado de ${d.desde.codigo} a ${hacia}${d.motivo ? ` · motivo: ${d.motivo}` : ""}`;
    const como: Record<string, string> = {
      alta_indicado: "indicado al registrar la OT",
      alta_deducido: "deducido del catálogo al registrar la OT",
      aceptacion_indicado: "indicado al aceptar la cotización",
      aceptacion_deducido: "deducido de la cotización al aceptarla",
      saec: "OT del SAEC (Delegación Nº 11)",
      metodos_de_la_muestra: "deducido de los métodos de la muestra",
    };
    return `Laboratorio responsable: ${hacia}${como[d.origen] ? ` (${como[d.origen]})` : ""}`;
  }
  // Recorrido 30 (fallo 17): documento de aceptación de la cotización y discrepancia de la O/C.
  if (h.tipo === "aceptacion_cotizacion")
    return `Cotización ${d.cotizacion ?? ""} aceptada con ${ACEPTACION_LABEL[d.tipoDocumento] ?? d.tipoDocumento ?? "—"}${d.numero ? ` Nº ${d.numero}` : ""}${d.fecha ? ` del ${fechaDia(d.fecha)}` : ""}` +
      (d.adjunto ? ` · documento «${d.adjunto}» (adjunto en la cotización)` : "") +
      (d.montoOc != null ? ` · monto de la O/C ${clp(d.montoOc)}` : "") +
      (d.discrepancia ? ` · discrepancia con la cotización: ${d.discrepancia}` : "");
  if (h.tipo === "registro_muestras") {
    const ms: any[] = d.muestras ?? [];
    const ensayos = ms.reduce((s, m) => s + Number(m.ensayos ?? 0), 0);
    return `Se registraron ${ms.length} muestra(s) (${ms.map((m) => m.codigo).join(", ")}) con ${ensayos} ensayo(s) por analizar`;
  }
  if (h.tipo === "reapertura_resultado") {
    const docs: any[] = d.documentosAnulados ?? [];
    return `Resultado reabierto: ${d.muestra ?? ""} · ${d.ensayo ?? ""}${d.motivo ? ` · motivo: ${d.motivo}` : ""}` +
      (docs.length ? ` · se anuló ${docs.map((x) => x.numero).join(", ")} (reemitir tras aprobar de nuevo)` : "");
  }
  if (h.tipo === "recepcion_muestra") {
    const cond = (c?: string | null) => (c === "cumple" ? "Cumple" : c === "no_cumple" ? "No cumple" : "sin condición");
    const campos = camposRecepcionCambiados(d.anterior, d.nuevo);
    const condicion = (d.anterior?.condicionRecepcion ?? null) !== (d.nuevo?.condicionRecepcion ?? null)
      ? ` · condición ${cond(d.anterior?.condicionRecepcion)} → ${cond(d.nuevo?.condicionRecepcion)}`
      : "";
    return `Recepción de ${d.muestra ?? "la muestra"} corregida${campos.length ? `: ${campos.join(", ")}` : ""}${condicion}`;
  }
  // F032: la anulación con su causa y su motivo (ot_historial.detalle).
  if (h.tipo === "ot_anulada")
    return `OT anulada${d.causaTexto ? ` · causa: ${String(d.causaTexto).toLowerCase()}` : ""}${d.motivo ? ` · motivo: ${d.motivo}` : ""}`;
  if (h.tipo === "metodos_agregados")
    return `Se agregaron ${(d.ensayos ?? []).length} método(s) a ${d.muestra ?? "la muestra"}${(d.ensayos ?? []).length ? `: ${(d.ensayos as string[]).join(", ")}` : ""}${d.motivo ? ` · motivo: ${d.motivo}` : ""}`;
  if (h.tipo === "numero_muestra") return `Nº interno ${d.numeroInterno ?? "—"} asignado a la muestra ${d.muestra ?? ""}`;
  if (h.tipo === "validacion_laboratorio")
    return `OT recepcionada en el laboratorio (alcance conforme)${d.fechaTermino ? ` · término ${fechaDia(d.fechaTermino)}` : ""}${d.fechaInforme ? ` · informe ${fechaDia(d.fechaInforme)}` : ""}${d.observacion ? ` · ${d.observacion}` : ""}`;
  if (h.tipo === "devuelta_ventas") return `OT devuelta a Ventas por alcance no conforme${d.observacion ? ` · ${d.observacion}` : ""}`;
  if (h.tipo === "encargo") return `Datos del encargo actualizados${(d.campos ?? []).length ? ` (${(d.campos as string[]).length} campo(s))` : ""}`;
  if (h.tipo === "muestreo") return `Formulario de muestreo ${d.formulario ?? ""}: ${d.accion === "recibir" ? (d.conforme ? "recibido conforme" : "recibido no conforme") : d.accion ?? ""}${d.observacion ? ` · ${d.observacion}` : ""}`;
  if (h.tipo === "pnc") return `${d.clase ?? "PNC"} ${d.codigo ?? ""} registrado${(d.ensayos ?? []).length ? ` · ${d.ensayos.length} ensayo(s) afectado(s)` : ""}`;
  if (h.tipo === "apelacion") return `Apelación registrada · vence el ${fechaDia(d.venceEl)}${d.fueraDePlazo ? " (fuera de plazo)" : ""}`;
  if (h.tipo === "notificacion_dgmn") return `Notificación a la DGMN del informe ${d.informe ?? ""}${d.oficio ? ` · oficio ${d.oficio}` : ""}`;
  if (h.tipo === "especificacion_tecnica") return `Especificación técnica asignada: ${d.et ?? "—"}`;
  if (h.tipo === "desglose_componentes") return `Desglose en componentes de ${d.muestra ?? "la muestra"} según la E.T. ${d.et ?? ""}`;
  if (h.tipo === "bpch_internacion") return `Internación ${d.internacion ?? ""} · resolución ${d.resolucion ?? "—"}`;
  if (h.tipo === "bpch_reinspeccion") return `Reinspección ${d.reinspeccion ?? ""} desde la OT ${d.origenOt ?? ""}`;
  if (h.tipo === "origen_bpch") return `Origen BPCH registrado${d.ocNumero ? ` · OC ${d.ocNumero}` : ""}${d.rafNumero ? ` · RAF ${d.rafNumero}` : ""}`;
  if (h.tipo === "costos_reales")
    return d.accion === "reabrir" ? `Planilla de costos reales reabierta · motivo: ${d.motivo ?? ""}` : `Planilla de costos reales cerrada · total $${Math.round(Number(d.total ?? 0)).toLocaleString("es-CL")}`;
  // Hitos del seguimiento (frente r4c): avisos, plazo, recepción DCO, despacho, envío y carpeta.
  if (h.tipo === "aviso") return `Aviso enviado: ${d.titulo ?? d.tipo ?? ""}${d.personas ? ` (${d.personas} persona${d.personas === 1 ? "" : "s"})` : ""}`;
  if (h.tipo === "plazo_notificado") return `Plazo informado al cliente: entrega el ${d.fecha ?? "—"}${d.medio ? ` · por ${textoMedio(d.medio)}` : ""}`;
  if (h.tipo === "recepcion_dco") return `Recepción del informe en DCO el ${d.fecha ?? "—"} · ${d.estado ?? ""}${d.texto ? ` (${d.texto})` : ""}`;
  if (h.tipo === "despacho") return `Documento ${d.numero ?? ""} despachado a ${d.destino ?? "—"}${d.ejemplares ? ` · ${d.ejemplares} ejemplar(es)` : ""}`;
  if (h.tipo === "despacho_recibido") return `Documento ${d.numero ?? ""} recibido por ${d.destino ?? "el destino"}`;
  if (h.tipo === "envio_cliente") return `Envío al cliente por ${textoMedio(d.medio)} a ${d.destinatario ?? "—"}: ${(d.documentos ?? []).join(", ")}`;
  if (h.tipo === "documento_registro") return `Documento ${d.tipo ?? ""} Nº ${d.numero ?? ""} registrado${d.version > 1 ? ` (versión ${d.version})` : ""}`;
  if (h.tipo === "carpeta_archivada") return `Carpeta de Trabajo archivada${d.ubicacion ? ` en ${d.ubicacion}` : ""}`;
  if (h.tipo === "oficio") return `Oficio ${d.numero ?? ""} ${d.accion ?? ""}`;
  if (h.tipo === "fecha_compromiso")
    return `Fecha de compromiso ${d.desde ? `cambiada del ${fechaDia(d.desde)} al` : "fijada el"} ${fechaDia(d.hacia)}${d.motivo ? ` · motivo: ${d.motivo}` : ""}`;
  const n = (d.usuarios ?? []).length;
  if (h.tipo === "asignacion") return `Se asignaron ${n} persona${n === 1 ? "" : "s"} a la OT`;
  if (h.tipo === "desasignacion") return `Se retiraron ${n} persona${n === 1 ? "" : "s"} de la OT${d.motivo ? ` (${d.motivo})` : ""}`;
  if (h.tipo === "asignacion_ensayo")
    return d.usuario ? `Asignación de ${d.actualizados ?? ""} ensayo(s) a una persona concreta` : `Se retiró la asignación concreta de ${d.actualizados ?? ""} ensayo(s)`;
  // Hechos sin texto propio: su código, legible («d11_llegada» → «D11 llegada»).
  return String(h.tipo ?? "").replace(/^d11_/, "D11 ").replace(/_/g, " ");
}

/** Campos de la recepción de una muestra con su nombre en pantalla (historial «recepción corregida»). */
const CAMPOS_RECEPCION: Record<string, string> = {
  tomaMuestra: "toma de muestra",
  condicionObservacion: "observación de la condición",
  selloNumero: "sello",
  identificacionCliente: "identificación del cliente",
  requiereOtrosLabs: "otros laboratorios",
  otrosLabs: "otros laboratorios",
  otrosLabsDetalle: "detalle para otros laboratorios",
  catElementoId: "producto",
  clienteId: "cliente",
  sellosVerificados: "sellos verificados",
  claseCustodia: "clase de custodia",
  ubicacion: "ubicación",
  datos: "datos del laboratorio",
  temperaturaRecepcion: "temperatura de llegada",
  fechaTomaMuestra: "fecha de toma",
  formularioMuestreo: "formulario de muestreo",
};

/** Qué cambió en una corrección de recepción (sin repetir campos ni contar los sellos de quién y cuándo). */
function camposRecepcionCambiados(anterior: any, nuevo: any): string[] {
  if (!anterior || !nuevo) return [];
  const igual = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const nombres = Object.keys(CAMPOS_RECEPCION)
    .filter((k) => k in nuevo || (k === "datos" && "datosRecepcion" in nuevo))
    .filter((k) => !igual(anterior[k], k === "datos" ? nuevo.datosRecepcion ?? nuevo.datos : nuevo[k]))
    .map((k) => CAMPOS_RECEPCION[k]);
  return [...new Set(nombres)];
}

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("lims_token")}` });
const authJson = () => ({ ...auth(), "Content-Type": "application/json" });

export default function ExpedientePage() {
  useMediosEnvio(); // frente f5: textos de los medios de envío (Parámetros del sistema)
  const { id } = useParams<{ id: string }>();
  // F049: «Emitir informe» (también desde el menú) propone la OT cuya ficha se está viendo.
  useEffect(() => {
    if (typeof id === "string") recordarOtActiva(id);
  }, [id]);
  const [ot, setOt] = useState<any>(null);
  const [muestras, setMuestras] = useState<any[]>([]);
  const [tab, setTab] = useState<"cabecera" | "asignacion" | "muestreo" | "muestras" | "preparacion" | "instrumentos" | "ordenes" | "resultados" | "fotos" | "consumos" | "informe" | "carpeta" | "flujo" | "historial" | "terreno">("cabecera");
  /** Laboratorio propuesto como destino al pulsar «Emitir orden interna» en la recepción de una muestra. */
  const [destinoOi, setDestinoOi] = useState<string | null>(null);
  const { puede, listo: permisosListos } = usePermisos();
  // Sin muestra.ver (p. ej. Finanzas) no se piden las muestras: la API respondía 403 y la
  // OT abría con «Permiso insuficiente» y «Muestras (0)» (F033).
  const verMuestras = puede("muestra.ver");
  const [historial, setHistorial] = useState<any[]>([]);
  const [cambiandoLab, setCambiandoLab] = useState(false);
  const [labNuevo, setLabNuevo] = useState("");
  const [labMotivo, setLabMotivo] = useState("");
  const [error, setError] = useState("");

  const [busy, setBusy] = useState(false);

  // Ruta de la OT: etapas y siguiente paso deducidos en el servidor del estado real.
  const [avance, setAvance] = useState<AvanceOt | null>(null);
  const [avanceError, setAvanceError] = useState(false);
  const cargarAvance = async () => {
    try { setAvance(await llamar<AvanceOt>("GET", `/ot/${id}/avance`)); setAvanceError(false); }
    catch { setAvance(null); setAvanceError(true); }
  };

  const cargarOt = async () => {
    try {
      const o = await llamar("GET", `/ot/${id}`);
      setOt(o);
    } catch (e: any) { setError(e.message); }
    cargarAvance();
  };
  const cargarHistorial = async () => {
    try { setHistorial(await llamar("GET", `/ot/${id}/historial`)); } catch { setHistorial([]); }
  };
  // B-041: una acción en cualquier bloque de la OT refresca la cabecera, la ruta y la bitácora.
  useCambiosOt(typeof id === "string" ? id : null, () => { cargarOt(); cargarHistorial(); });

  const cargarMuestras = async () => {
    if (!verMuestras) { setMuestras([]); return; }
    try {
      // Solo las muestras de ESTA OT (antes se traían 200 y se filtraban aquí).
      const m = await llamar("GET", `/muestras?otId=${id}&limit=200`);
      setMuestras(m.data ?? []);
    } catch (e: any) { setError(e.message); }
  };

  useEffect(() => {
    cargarOt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  // Las muestras, cuando ya se leyeron los permisos (antes de eso «puede» es falso).
  useEffect(() => {
    if (permisosListos) cargarMuestras();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, permisosListos, verMuestras]);

  // Pestaña inicial desde la URL (?tab=muestras: bandeja de entrada del laboratorio).
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && ["cabecera", "asignacion", "muestreo", "muestras", "preparacion", "instrumentos", "ordenes", "resultados", "fotos", "consumos", "informe", "carpeta", "historial", "terreno"].includes(t)) setTab(t as typeof tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tab === "historial") cargarHistorial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // ---- Laboratorio responsable (PATCH /ot/:id/laboratorio) ----
  const guardarLaboratorio = async () => {
    if (!labNuevo) return;
    if (ot?.unidadPrincipal && labMotivo.trim().length < 5) { toast.error("Indique el motivo del cambio (mínimo 5 caracteres)."); return; }
    setBusy(true);
    try {
      const r = await llamar("PATCH", `/ot/${id}/laboratorio`, { unidadPrincipalId: labNuevo, motivo: labMotivo.trim() || undefined });
      toast.ok(`Laboratorio responsable: ${r?.unidad?.codigo ?? ""}.`);
      setCambiandoLab(false); setLabNuevo(""); setLabMotivo("");
      await cargarOt();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  // ---- SVT7 · registrar OPI (limpia «OPI pendiente») ----
  const [opiNumero, setOpiNumero] = useState("");
  const [opiFecha, setOpiFecha] = useState(() => hoyISO());
  const [opiMsg, setOpiMsg] = useState("");
  // Una OT anulada ya no regulariza la OPI: no se marca ni se ofrece registrarla (F031).
  const opiVigente = !!ot?.opiPendiente && ot?.estado !== "anulada";
  const registrarOpi = async () => {
    setBusy(true); setOpiMsg("");
    try {
      const res = await fetch(`${API}/ot/${id}/registrar-opi`, {
        method: "POST", headers: authJson(), body: JSON.stringify({ numero: opiNumero.trim(), fecha: opiFecha }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.message ?? `Error ${res.status}`);
      setOt((prev: any) => ({ ...prev, ...j }));
    } catch (e: any) { setOpiMsg(String(e.message)); }
    finally { setBusy(false); }
  };

  const etapaActual = avance?.etapas.find((e) => e.clave === avance.etapaActual) ?? null;
  const esMetrologia = LABS_METROLOGIA.includes(ot?.unidad?.codigo ?? "");
  // «Muestreo» y «Preparación» las decide la Ruta de la OT (no aplican en BPCH, D11 ni Metrología);
  // mientras carga, no se muestran para no hacerlas aparecer y desaparecer.
  const conMuestreo = avance?.pestanas ? avance.pestanas.muestreo : false;
  const conPreparacion = avance?.pestanas ? avance.pestanas.preparacion : false;
  // R10: trabajo en terreno (SVM, LAM, SEO). R6: a quien solo muestrea se le oculta la asignación.
  const conTerreno = !!avance?.pestanas?.terreno;
  const conAsignacion = avance?.pestanas?.asignacion !== false;
  const perfilPestanas = avance?.pestanas?.perfil ?? null;
  const codOt = ot?.codigo ?? ot?.numero ?? (typeof id === "string" ? id.slice(0, 8) : "");
  const tabBtn = (t: typeof tab, l: string) =>
    <button onClick={() => setTab(t)} className={`tab${tab === t ? " active" : ""}`}>{l}</button>;

  return (
    <div>
      <Link href={"/ot" as any} className="subtitle" style={{ display: "inline-block", color: "var(--accent)", textDecoration: "none" }}>← Expedientes / OT</Link>
      {error && <div className="alert warn">{error}</div>}

      <div className="exphead">
        <div className="id">🗂 {codOt}</div>
        <div className="meta">
          Cliente: <b>{ot?.cliente?.razonSocial ?? "—"}</b>
          {ot?.cliente?.rut ? <> ({rut(ot.cliente.rut)})</> : null}
          {" · "}{ot?.estado === "cerrada" || ot?.estado === "anulada"
            ? <>Estado: <b>{ot.estado}</b></>
            : <>Etapa: <b>{etapaActual?.titulo ?? "—"}</b></>} · Prioridad: <b>{ot?.prioridad ?? "normal"}</b>
          {ot?.origenTrabajo ? <> · Origen: <b>{ORIGEN_LABEL[ot.origenTrabajo] ?? ot.origenTrabajo}</b></> : null}
          {" · "}Laboratorio: {ot?.unidad ? <b title={ot.unidad.nombre}>{ot.unidad.codigo}</b> : <span className="pill amber">sin laboratorio</span>}
          {ot?.fechaCompromiso ? <> · Compromiso: <b>{fechaDia(ot.fechaCompromiso)}</b></> : null}
          {opiVigente && <span className="pill amber" style={{ marginLeft: 8 }}>OPI pendiente</span>}
          {ot?.conCobro === false && <span className="pill gray" style={{ marginLeft: 8 }}>Sin cobro</span>}
        </div>
      </div>

      {/* B-002: un laboratorio que participa en la OT de otro (orden interna) ve el expediente con sus ensayos. */}
      {ot?.participacion?.laboratorios?.length > 0 && (
        <div className="alert info">
          Usted participa en esta OT con <b>{ot.participacion.laboratorios.map((l: { codigo: string }) => l.codigo).join(", ")}</b>:
          ve la muestra compartida con los ensayos de su laboratorio, registra su preparación y emite su documento («Un laboratorio»).
          Lo demás de la OT lo gestiona {ot?.unidad?.codigo ?? "el laboratorio responsable"}.
        </div>
      )}

      {ot && <OrigenBpchOt otId={ot.id} origenTrabajo={ot.origenTrabajo} />}

      {/* Delegación Nº 11 (EP-11): las armas se trabajan en su expediente propio. */}
      {ot?.unidad?.codigo === "D11" && puede("arma.ver") && (
        <div className="alert info" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ flex: 1 }}>OT de armas de la Delegación Nº 11: la recepción, el registro de cada arma, los ensayos, la acuñación, los certificados por arma y la entrega se hacen en su expediente.</span>
          <Link href={`/saec/ot/${ot.id}` as any} className="btn outline sm">Ir a Certificación de armas</Link>
        </div>
      )}

      {ot && !ot.unidadPrincipal && (
        <div className="alert warn">
          Esta OT <b>no tiene laboratorio responsable</b>: nadie del laboratorio la ve.
          {puede("ot.cambiar_laboratorio") ? " Fíjelo en la pestaña «Cabecera»." : " Pida a Planificación o a la jefatura que lo fije."}
        </div>
      )}

      {/* SVT7 · OT por disposición del Director con cobro: falta la OPI. */}
      {opiVigente && (
        <div className="alert warn">
          <div style={{ marginBottom: 6 }}>
            OT creada por <b>disposición del Director</b>{ot.disposicionRef ? <> ({ot.disposicionRef})</> : null} con cobro: está <b>pendiente la OPI</b>.
          </div>
          {!puede("ot.crear") ? (
            <div>La registra Comercial o Planificación cuando llegue la OPI.</div>
          ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div className="field"><label>Nº OPI</label><input value={opiNumero} onChange={(e) => setOpiNumero(e.target.value)} maxLength={60} /></div>
            <div className="field"><label>Fecha OPI</label><input type="date" value={opiFecha} onChange={(e) => setOpiFecha(e.target.value)} /></div>
            <button className="btn primary sm" disabled={busy || !opiNumero.trim() || !opiFecha} onClick={registrarOpi}>Registrar OPI</button>
          </div>
          )}
          {opiMsg && <div style={{ marginTop: 6 }}>{opiMsg}</div>}
        </div>
      )}

      {/* Comercial (reuniones 1 y 2): plazo de la OPI y anular la OT si el cliente desiste. */}
      {ot && <ComercialOt ot={ot} onCambio={() => { cargarOt(); cargarHistorial(); cargarAvance(); }} />}

      {typeof id === "string" && <SiguientePasoOt avance={avance} otId={id} onPestana={setTab} />}

      <div className="expgrid">
        {/* Ruta de la OT: etapas deducidas del estado real (GET /ot/:id/avance). */}
        <EtapasOt avance={avance} error={avanceError} />

        <div className="card" style={{ padding: 0 }}>
          <div className="tabs" style={{ padding: "0 8px" }}>
            {tabBtn("cabecera", "Cabecera")}
            {conAsignacion && tabBtn("asignacion", `Asignación${ot?.analistas?.length ? ` (${ot.analistas.length})` : ""}`)}
            {conTerreno && tabBtn("terreno", "Terreno")}
            {esMetrologia && tabBtn("instrumentos", "Instrumentos")}
            {conMuestreo && tabBtn("muestreo", "Muestreo")}
            {verMuestras && (!esMetrologia || muestras.length > 0) && tabBtn("muestras", `Muestras (${muestras.length})`)}
            {conPreparacion && tabBtn("preparacion", "Preparación")}
            {tabBtn("ordenes", "Órdenes internas")}
            {tabBtn("resultados", "Resultados")}
            {puede(["resultado.ver", "certificado.emitir"]) && tabBtn("fotos", "Fotos")}
            {/* §4.4.5: reactivos y consumibles usados en la OT y sus muestras. */}
            {puede("ot.ver") && tabBtn("consumos", "Consumos")}
            {tabBtn("informe", "Informe y cierre")}
            {tabBtn("carpeta", "Carpeta de trabajo")}
            {MOTOR_FLUJOS_VISIBLE && tabBtn("flujo", "Flujo")}
            {tabBtn("historial", "Historial")}
          </div>
          <div style={{ padding: 15 }}>
            {tab === "cabecera" && (
              <div style={{ display: "grid", gap: 12 }}>
              <div className="card" style={{ padding: 10, margin: 0 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>Laboratorio responsable</div>
                    <div style={{ fontWeight: 700 }}>{ot?.unidad ? etiquetaUnidad(ot.unidad) : "Sin laboratorio"}</div>
                    {ot?.unidadAsignadaAt && (
                      <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                        Fijado el {fechaHora(ot.unidadAsignadaAt)}{ot.unidadAsignadaPorNombre ? ` por ${ot.unidadAsignadaPorNombre}` : ""}. Ver «Historial».
                      </div>
                    )}
                  </div>
                  <div style={{ flex: 1 }} />
                  {puede("ot.cambiar_laboratorio") && !["cerrada", "anulada"].includes(ot?.estado) && !cambiandoLab && (
                    <button className="btn outline sm" onClick={() => setCambiandoLab(true)}>
                      {ot?.unidadPrincipal ? "Cambiar laboratorio" : "Fijar laboratorio"}
                    </button>
                  )}
                </div>
                {cambiandoLab && (
                  <div className="form-grid cols-2" style={{ marginTop: 10 }}>
                    <SelectorLaboratorio valor={labNuevo} onCambio={setLabNuevo} excluirId={ot?.unidadPrincipal} etiqueta="Nuevo laboratorio responsable" />
                    {ot?.unidadPrincipal ? (
                      <div className="field">
                        <label>Motivo del cambio <span className="req">*</span></label>
                        <input value={labMotivo} onChange={(e) => setLabMotivo(e.target.value)} maxLength={500} />
                      </div>
                    ) : <div />}
                    <p className="hint" style={{ margin: 0, gridColumn: "1 / -1", fontSize: 11.5, color: "var(--muted)" }}>
                      {ot?.unidadPrincipal
                        ? "Al cambiar de laboratorio se retiran las asignaciones del personal del laboratorio anterior. Queda registrado quién y cuándo."
                        : "Queda registrado quién lo fijó y cuándo."}
                    </p>
                    <div className="toolbar" style={{ gridColumn: "1 / -1", margin: 0 }}>
                      <button className="btn outline sm" onClick={() => { setCambiandoLab(false); setLabNuevo(""); setLabMotivo(""); }}>Cancelar</button>
                      <button className="btn primary sm" disabled={busy || !labNuevo} onClick={guardarLaboratorio}>Guardar</button>
                    </div>
                  </div>
                )}
              </div>
              <div className="form-grid">
                <div className="field readonly"><label>Código OT</label><input value={ot?.codigo ?? "—"} readOnly /></div>
                <div className="field readonly"><label>Cliente</label><input value={ot?.cliente?.razonSocial ?? "—"} readOnly /></div>
                <div className="field readonly"><label>RUT cliente</label><input value={ot?.cliente?.rut ? rut(ot.cliente.rut) : "—"} readOnly /></div>
                <div className="field readonly"><label>Estado</label><input value={ot?.estado ?? "—"} readOnly /></div>
                <div className="field readonly"><label>Prioridad</label><input value={ot?.prioridad ?? "normal"} readOnly /></div>
                <div className="field readonly"><label>Ingreso</label><input value={fecha(ot?.fechaIngreso ?? ot?.createdAt)} readOnly /></div>
                <div className="field readonly"><label>Origen</label><input value={ot?.origenTrabajo ? ORIGEN_LABEL[ot.origenTrabajo] ?? ot.origenTrabajo : "—"} readOnly /></div>
                <div className="field readonly"><label>Cobro</label><input value={ot ? (ot.conCobro === false ? "Sin cobro" : "Con cobro") : "—"} readOnly /></div>
                <div className="field readonly"><label>OPI</label><input value={ot?.opiNumero ? `${ot.opiNumero} · ${fechaDia(ot.opiFecha)}` : opiVigente ? "Pendiente" : "—"} readOnly /></div>
                {ot?.disposicionRef && <div className="field readonly"><label>Disposición del Director</label><input value={`${ot.disposicionRef}${ot.disposicionFecha ? ` · ${fechaDia(ot.disposicionFecha)}` : ""}`} readOnly /></div>}
                {ot?.numeroLey && <div className="field readonly"><label>Resolución DGMN</label><input value={ot.numeroLey} readOnly /></div>}
                <div className="field readonly"><label>Horas hombre</label><input value={num(ot?.horasHombre, 1)} readOnly /></div>
                <div className="field readonly"><label>Costo estimado</label><input value={clp(ot?.costoEstimado)} readOnly /></div>
                {/* La fecha de compromiso se fija en «Informe y cierre» (PUT /ot/:id/fecha-compromiso):
                    ahí queda registrado quién la fijó, cuándo y por qué se cambió. */}
                <div className="field readonly"><label>Fecha de compromiso</label><input value={ot?.fechaCompromiso ? fechaDia(ot.fechaCompromiso) : "Sin fecha (ver «Informe y cierre»)"} readOnly /></div>
              </div>
              {/* Datos del encargo y recepción en el laboratorio (frente r4d · EP-00 5.1, EP-05 0.3/1.2). */}
              {typeof id === "string" && <DatosEncargoOt otId={id} onCambio={cargarOt} />}
              {/* Especificación técnica del cliente (EP-03 0.5, EP-05 5.1): la E.T. que rige la OT y sus muestras. */}
              {typeof id === "string" && !esMetrologia && <EspecificacionTecnicaOt otId={id} onCambio={() => { cargarMuestras(); cargarAvance(); }} />}
              {/* OT del BPCH: cabecera de inspección (EP-10 10.3); en otras unidades no se muestra. */}
              {typeof id === "string" && <CabeceraInspeccionOt otId={id} />}
              </div>
            )}
            {perfilPestanas && <div style={{ padding: "6px 0 0" }}><span className="pill blue">Perfil: {perfilPestanas}</span></div>}
            {tab === "asignacion" && conAsignacion && typeof id === "string" && <Asignacion otId={id} onCambio={cargarOt} />}
            {tab === "terreno" && conTerreno && typeof id === "string" && <TerrenoOt otId={id} onCambio={cargarAvance} />}
            {/* Preparación del trabajo (DSA, EP-05 2.1–2.3) y de las muestras (T29). */}
            {tab === "preparacion" && conPreparacion && typeof id === "string" && <PreparacionOt otId={id} laboratorio={ot?.unidad?.codigo ?? null} onCambio={cargarAvance} />}
            {tab === "historial" && (
              historial.length ? (
                <table className="data">
                  <thead><tr><th>Fecha</th><th>Quién</th><th>Qué</th></tr></thead>
                  <tbody>
                    {historial.map((h) => (
                      <tr key={h.id}><td style={{ whiteSpace: "nowrap" }}>{fechaHora(h.createdAt)}</td><td>{h.usuarioNombre ?? "—"}</td><td>{textoHistorial(h)}</td></tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="subtitle" style={{ margin: 0 }}>Sin movimientos registrados de laboratorio ni de asignación.</p>
            )}
            {/* Muestra compartida entre laboratorios (EP-02 4.2): estado de cada uno. */}
            {tab === "muestras" && typeof id === "string" && <EstadoPorLaboratorio otId={id} version={muestras.length} />}
            {tab === "muestras" && typeof id === "string" && (
              <RegistroMuestras otId={id} onCambio={cargarMuestras}
                onOrdenInterna={(unidadId) => { setDestinoOi(unidadId ?? null); setTab("ordenes"); }}
                onRecepcionado={() => setTab("asignacion")} />
            )}
            {tab === "instrumentos" && typeof id === "string" && <InstrumentosOt otId={id} onCambio={cargarOt} />}
            {tab === "muestreo" && conMuestreo && typeof id === "string" && <MuestreoOt otId={id} onCambio={() => { cargarMuestras(); cargarAvance(); }} />}
            {tab === "ordenes" && typeof id === "string" && (
              <OrdenesInternasOt otId={id} otCodigo={ot?.codigo} otEstado={ot?.estado}
                destinoSugerido={destinoOi} onSugerenciaUsada={() => setDestinoOi(null)}
                /* Emitir, editar o anular una orden interna cambia la Ruta y el siguiente paso (D02-26). */
                onCambio={cargarAvance} />
            )}
            {tab === "resultados" && typeof id === "string" && ot?.origenTrabajo === "PRODUCCION_NACIONAL" && <RevisionDocumental otId={id} onCambio={cargarAvance} />}
            {tab === "resultados" && (
              <div style={{ display: "grid", gap: 8 }}>
                <p className="subtitle" style={{ margin: 0 }}>
                  Los resultados de esta OT se capturan, revisan y aprueban en{" "}
                  <Link href={`/captura-ot?otId=${id}` as any} style={{ color: "var(--accent)" }}>Captura y revisión por OT</Link>:
                  ahí se ve quién capturó, revisó y aprobó cada valor, y cuándo.
                </p>
                <div className="toolbar" style={{ margin: 0 }}>
                  {puede("resultado.ver") && <Link href={`/ot/${id}/calculos` as any} className="btn outline sm">Planilla de registros y cálculos</Link>}
                  {puede("costo_real.ver") && <Link href={`/ot/${id}/costos` as any} className="btn outline sm">Planilla de costos reales</Link>}
                  {puede(["resultado.ver", "certificado.emitir"]) && <button type="button" className="btn outline sm" onClick={() => setTab("fotos")}>Fotos del anexo</button>}
                </div>
              </div>
            )}
            {tab === "fotos" && typeof id === "string" && <FotosOt otId={id} otEstado={ot?.estado} />}
            {tab === "consumos" && typeof id === "string" && <ConsumosOt otId={id} />}
            {/* Fecha de compromiso, documentos (firma y entrega) y cierre de la OT. */}
            {tab === "informe" && typeof id === "string" && esMetrologia && <InstrumentosOt otId={id} onCambio={cargarOt} modo="cierre" />}
            {tab === "informe" && typeof id === "string" && <NotificacionDgmn otId={id} onCambio={cargarOt} />}
            {/* B-018: OT directa o de Producción Nacional del BPCH: el mismo bloque «Remitir a DCO» que el expediente de internación.
                D08-09: no en el prototipo, cuya ruta marca «Remitir a DCO · No aplica» (el dictamen se entrega desde BPCH › Prototipos). */}
            {tab === "informe" && typeof id === "string" && avance?.tipo === "bpch"
              && avance.etapas?.find((e) => e.clave === "remision_dco")?.estado !== "no_aplica" && <RemitirDco otId={id} conInspeccion={ot?.origenTrabajo === "PRODUCCION_NACIONAL"} onCambio={() => { cargarOt(); cargarAvance(); }} />}
            {tab === "informe" && typeof id === "string" && <PanelCierreOt otId={id} onCambio={cargarOt} />}
            {/* Plazo al cliente, recepción DCO, documentos no-informe y envío (frente r4c). */}
            {tab === "informe" && typeof id === "string" && <div style={{ marginTop: 16 }}><SeguimientoOt otId={id} onCambio={cargarOt} /></div>}
            {tab === "carpeta" && typeof id === "string" && <CarpetaOt otId={id} />}
            {MOTOR_FLUJOS_VISIBLE && tab === "flujo" && typeof id === "string" && <FlujoBpmOt otId={id} />}
          </div>
        </div>
      </div>
    </div>
  );
}
