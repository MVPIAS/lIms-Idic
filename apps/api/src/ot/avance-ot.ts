/**
 * «Ruta de la OT» · reglas PURAS (sin BD), probadas en avance-ot.spec.ts.
 * Contrato: docs/FLUJO_LABORATORIO.md §«Ruta de la OT».
 *
 * La etapa de una OT NO se guarda: se DEDUCE de lo que ya existe y el servidor
 * ya valida (muestras, asignación, resultados por estado, documentos y sus
 * firmas, entrega, cierre, factura). Es el mismo patrón que las fases de BPCH
 * Internación y Reinspección. Una sola función (`calcularAvance`) da a la vez
 * la barra de etapas y el «Siguiente paso · Le toca a», así que nunca dicen
 * cosas distintas.
 *
 * Etapas de una OT de laboratorio (decisión del frente M, ver la doc):
 *   apertura → recepcion → asignacion → analisis → revision → aprobacion →
 *   emision → firmas → entrega → cierre → factura → pago
 * Variantes: OT interna / interlaboratorio / sin cobro (factura y pago no
 * aplican), Metrología (calibración en vez de captura estándar), BPCH
 * Internación y Reinspección (las fases del expediente BPCH). En el DSA, si la
 * documentación del trabajo se aprueba antes de ejecutar (EP-05 2.2–2.3), entre
 * la asignación y el análisis va la etapa «Preparación del trabajo» (frente r2a).
 */
import { generoDocumentoTrabajo } from "../formularios/trabajo";
import { faltantesParaCerrar } from "./plazos";
import { condicionFinal, TEXTO_CONDICION } from "../bpch/comun/reglas-bpch";
import { calibracionVigente, documentosDeMetrologia, esEntregableNoCalibrable, faltantesInstrumentos, type DocumentoNoCalibrable } from "../metrologia/metrologia-ot.reglas";

export type EstadoEtapa = "hecho" | "en_curso" | "pendiente" | "no_aplica" | "bloqueado";
export type TipoRuta = "laboratorio" | "interna" | "metrologia" | "internacion" | "reinspeccion" | "armas" | "bpch";
/** Pestañas del expediente de la OT a las que puede llevar el «Siguiente paso». */
export type PestanaOt = "cabecera" | "asignacion" | "muestreo" | "muestras" | "preparacion" | "instrumentos" | "resultados" | "informe";

export interface Etapa {
  clave: string;
  titulo: string;
  estado: EstadoEtapa;
  detalle: string | null;
}

export interface LeToca {
  /** Rol que debe actuar («Jefe de Laboratorio», «Analista revisor»…). */
  rol: string;
  /** Laboratorio o unidad (código), si el rol es de una unidad. */
  unidad: string | null;
  /** Personas concretas, solo si están asignadas (analistas, firmantes de la matriz). */
  personas: string[];
}

export interface AccionRuta {
  texto: string;
  /** Pestaña del expediente donde se hace… */
  pestana?: PestanaOt;
  /** …o pantalla a la que lleva (ruta de la web). */
  ruta?: string;
  /** Basta UNO de estos permisos para ofrecer el botón (vacío = basta con ver la OT). */
  permisos: string[];
  /** Si se indica, solo estas personas pueden hacerlo (p. ej. el firmante del paso). */
  usuarios?: string[];
}

export interface SiguientePaso {
  etapa: string;
  texto: string;
  leToca: LeToca | null;
  accion: AccionRuta | null;
}

export interface AvanceOt {
  tipo: TipoRuta;
  etapas: Etapa[];
  /** Clave de la etapa actual (la primera sin terminar); null si todo está hecho. */
  etapaActual: string | null;
  siguiente: SiguientePaso | null;
  /** Solo si la OT está cerrada: fecha y factura, para la línea «OT cerrada el …». */
  cierre: { fecha: string | null; conCobro: boolean; factura: { numero: string; estado: string } | null } | null;
  avisos: string[];
  /**
   * Pestañas del expediente que aplican a esta OT. «Muestreo» y «Preparación» son
   * de los laboratorios (EP-01/02/03/05); en el BPCH el muestreo NCh 44 vive en el
   * expediente de inspección (EP-10 10.4) y la D11 trabaja en Certificación de armas.
   */
  pestanas: { muestreo: boolean; preparacion: boolean };
}

/* ------------------------------------------------------------- entrada --- */

export interface DocumentoAvance {
  id: string;
  numero: string;
  /** en_firma | oficial | emitido | devuelto | anulado */
  estado: string;
  tipoDocumento?: string | null;
  entregadoAt: Date | string | null;
  /** Destino del despacho del documento (DCO, LAB_SOLICITANTE, BPCH, CLIENTE), si se despachó (frente r4c). */
  despachadoA?: string | null;
  /** Pasos de firma pendientes ahora (solo si está en firma). */
  pendientes?: { rol: string; unidad: string | null; personas: { id: string; nombre: string }[] }[];
}

/** Orden interna de la OT (derivación a otro laboratorio): estado y si el solicitante ya la integró. */
export interface OrdenInternaAvance {
  id: string;
  numero: string;
  /** abierta | recibida | cerrada | anulada */
  estado: string;
  /** Código de la unidad de destino. */
  destino: string | null;
  respondida: boolean;
  /** El solicitante la dio por recibida («Dar por recibido → evaluación»). */
  aceptada: boolean;
}

export interface CalibracionAvance {
  id?: string;
  /** Ítem (instrumento) de la OT del que nace la calibración. */
  instrumentoId?: string | null;
  codigo: string;
  numeroCertificado?: string | null;
  /** borrador | calculada | en_revision | en_firma | emitida | reemplazada */
  estado: string;
  entregadoAt?: Date | string | null;
}

/** Instrumento (ítem) de una OT de calibración (EP-04). */
export interface InstrumentoAvance {
  id: string;
  numero: number;
  descripcion: string;
  /** por_recibir | recibido | no_apto | devuelto | anulado */
  estado: string;
  metrologo?: string | null;
  metrologoId?: string | null;
}

export interface HechosOt {
  id: string;
  codigo: string;
  estado: string;
  origen: string | null;
  conCobro: boolean;
  opiPendiente?: boolean;
  unidad: { codigo: string; esMetrologia?: boolean } | null;
  /** Rama del organigrama de la unidad: BPCH (sin la D11), la D11 o ninguna. */
  rama?: "bpch" | "d11" | null;
  cotizacion?: { codigo: string; estado: string } | null;
  fechaCierre?: Date | string | null;
  muestras: { total: number; recepcionIncompleta: number; veredictos?: (string | null)[] };
  /** Nombres de las personas asignadas a la OT (o a sus ensayos). */
  analistas: string[];
  resultados: { total: number; pendientes: number; capturados: number; revisados: number; aprobados: number; devueltos: number };
  documentos: DocumentoAvance[];
  factura: { numero: string; estado: string } | null;
  /** Calibraciones de Metrología ligadas a la OT. */
  calibraciones?: CalibracionAvance[];
  /** Órdenes internas emitidas desde la OT (sin las anuladas). */
  ordenesInternas?: OrdenInternaAvance[];
  /** Muestreos de la OT (sin los anulados): borrador, registrado (entregado) o recibido. */
  muestreos?: { numero: string; estado: string; recibidoConforme: boolean | null }[];
  /** D03-19: la OT se registró con «¿Requiere muestreo? Sí» (ot_encargo.requiere_muestreo). */
  requiereMuestreo?: boolean | null;
  /** Documentos por muestra, producto o laboratorio: lo que falta cubrir para cerrar. */
  coberturaPendiente?: string[];
  /** OT del BPCH: lo que le falta a la cabecera de inspección para emitir el Informe de Inspección (EP-10 10.11). */
  cabeceraBpch?: string[];
  /** Instrumentos de la OT de calibración y si el cierre exige su devolución (parámetro). */
  instrumentos?: InstrumentoAvance[];
  /** Informe técnico y certificado externo de los no calibrables (cuentan como documento para el cierre). */
  documentosNoCalibrables?: DocumentoNoCalibrable[];
  exigeDevolucion?: boolean;
  internacion?: {
    id: string;
    numero: string;
    unidad: string | null;
    lotes: number;
    lotesRegistrados: number;
    /** Certificado al que está inscrito cada elemento en la Codificación Única (null = sin inscribir). */
    codificacionCertificados: (string | null)[];
    sujetaTasa: boolean;
    tasaRemitida: boolean;
    tasaEnCurso: boolean;
    documentacion: string | null;
  } | null;
  reinspeccion?: {
    id: string;
    numero: string;
    unidad: string | null;
    loteRegistrado: boolean;
    conCodificacion: boolean;
    trazabilidadHecha: boolean;
  } | null;
  /** Documentación del trabajo del DSA (formularios/trabajo-avance.ts); null fuera del DSA. */
  trabajoDsa?: {
    laboratorio: string;
    titulo: string;
    exige: boolean;
    /** borrador | en_aprobacion | validada | aprobada | devuelta | registrada | null (sin preparar) */
    estado: string | null;
    texto: string;
  } | null;
  /**
   * OT de armas de la Delegación Nº 11 (EP-11): pasos del expediente D11
   * (saec/d11/reglas-d11.ts › avanceD11). Con ellos la OT sigue su ruta propia.
   */
  armas?: {
    pasos: { clave: string; titulo: string; boton: string; leToca: string; estado: "hecho" | "en_curso" | "pendiente"; detalle: string }[];
  } | null;
}

/* ------------------------------------------------------------- reglas --- */

const OFICIAL = ["oficial", "emitido"];
const esOficialDoc = (d: { estado: string }) => OFICIAL.includes(d.estado);
/** Documentos vivos: los anulados no cuentan para nada. */
const vivos = (docs: DocumentoAvance[]) => docs.filter((d) => d.estado !== "anulado");
const ORIGENES_INTERNOS = ["OT_INTERNA", "INTERLABORATORIO"];

/** Tipo de ruta que corresponde a la OT. */
export function tipoRuta(h: HechosOt): TipoRuta {
  if (h.armas) return "armas";
  if (h.internacion) return "internacion";
  if (h.reinspeccion) return "reinspeccion";
  // Metrología: laboratorio de la Sección Metrología que trabaja con calibraciones
  // (si la OT usa la captura estándar, sigue la ruta de laboratorio).
  if (h.unidad?.esMetrologia && ((h.calibraciones?.length ?? 0) > 0 || (h.instrumentos?.length ?? 0) > 0 || h.resultados.total === 0)) return "metrologia";
  if (h.origen && ORIGENES_INTERNOS.includes(h.origen)) return "interna";
  // OT directa o de Producción Nacional del BPCH (EP-10, EP-07): fases de la inspección (BL-158).
  if (h.rama === "bpch") return "bpch";
  return "laboratorio";
}

const plural = (n: number, s: string, p = `${s}s`) => `${n} ${n === 1 ? s : p}`;
const lab = (h: HechosOt) => h.unidad?.codigo ?? null;
const etapa = (clave: string, titulo: string, estado: EstadoEtapa, detalle?: string | null): Etapa => ({ clave, titulo, estado, detalle: detalle ?? null });

/** Texto de la apertura: de dónde viene la OT. */
function detalleApertura(h: HechosOt): string {
  const origen =
    h.cotizacion
      ? `Cotización ${h.cotizacion.codigo}${h.cotizacion.estado === "aceptada" ? " aceptada" : ` (${h.cotizacion.estado})`}`
      : h.origen === "OT_INTERNA"
        ? "OT interna"
        : h.origen === "INTERLABORATORIO"
          ? "OT interlaboratorio"
          : h.origen === "DISPOSICION"
            ? "Disposición del Director"
            : h.origen
              ? h.origen.toLowerCase().replace(/_/g, " ")
              : "Registro directo";
  return `${origen}${h.unidad ? ` · ${h.unidad.codigo}` : " · sin laboratorio"}`;
}

/** Estado de los resultados para las etapas Análisis, Revisión y Aprobación. */
function etapasResultados(h: HechosOt): { analisis: Etapa; revision: Etapa; aprobacion: Etapa } {
  const r = h.resultados;
  const porCapturar = r.pendientes + r.devueltos;
  const analisisHecho = r.total > 0 && porCapturar === 0;
  const revisionHecha = analisisHecho && r.capturados === 0;
  const aprobacionHecha = r.total > 0 && r.aprobados === r.total;
  const hechos = r.total - porCapturar;
  return {
    analisis: etapa(
      "analisis",
      "Análisis",
      analisisHecho ? "hecho" : hechos > 0 ? "en_curso" : "pendiente",
      r.total === 0 ? null : `${hechos} de ${plural(r.total, "ensayo")} capturados${r.devueltos ? ` · ${r.devueltos} devuelto(s)` : ""}`,
    ),
    revision: etapa(
      "revision",
      "Revisión",
      revisionHecha ? "hecho" : r.revisados + r.aprobados > 0 ? "en_curso" : "pendiente",
      r.total ? `${r.revisados + r.aprobados} de ${r.total} revisados` : null,
    ),
    aprobacion: etapa(
      "aprobacion",
      "Aprobación",
      aprobacionHecha ? "hecho" : r.aprobados > 0 ? "en_curso" : "pendiente",
      r.total ? `${r.aprobados} de ${r.total} aprobados` : null,
    ),
  };
}

/** Siguiente paso de los resultados (captura → revisión → aprobación), según lo que falte primero. */
function pasoResultados(h: HechosOt, clave: string): Omit<SiguientePaso, "etapa"> {
  const r = h.resultados;
  const u = lab(h);
  const rutaCaptura = `/captura-ot?otId=${h.id}`;
  if (r.total === 0)
    return {
      texto: "La OT no tiene ensayos por analizar: regístrelos con las muestras",
      leToca: { rol: "Recepción de muestras", unidad: u, personas: [] },
      accion: { texto: "Ir a Muestras", pestana: "muestras", permisos: ["muestra.crear"] },
    };
  const porCapturar = r.pendientes + r.devueltos;
  if (porCapturar > 0 || clave === "analisis")
    return {
      texto: `Capturar resultados de ${plural(porCapturar, "ensayo")}${r.devueltos ? ` (${r.devueltos} devuelto(s) para corregir)` : ""}`,
      leToca: { rol: "Analista", unidad: u, personas: h.analistas },
      accion: { texto: "Ir a Captura", ruta: rutaCaptura, permisos: ["resultado.crear"] },
    };
  if (r.capturados > 0 || clave === "revision")
    return {
      texto: `Revisar ${plural(r.capturados, "resultado capturado", "resultados capturados")}`,
      leToca: { rol: "Analista revisor", unidad: u, personas: [] },
      accion: { texto: "Ir a Revisión", ruta: rutaCaptura, permisos: ["resultado.revisar"] },
    };
  const porAprobar = r.total - r.aprobados;
  return {
    texto: `Aprobar ${plural(porAprobar, "resultado revisado", "resultados revisados")}`,
    leToca: { rol: "Jefe de Laboratorio", unidad: u, personas: [] },
    accion: { texto: "Ir a Aprobación", ruta: rutaCaptura, permisos: ["resultado.aprobar"] },
  };
}

/** Siguiente paso de un documento en firma: quién firma ahora según la matriz. */
function pasoFirma(d: DocumentoAvance): Omit<SiguientePaso, "etapa"> {
  const p = d.pendientes?.[0];
  const personas = (d.pendientes ?? []).flatMap((x) => x.personas);
  return {
    texto: `Firmar ${d.numero}${p ? ` (paso de ${p.rol})` : ""}`,
    leToca: p ? { rol: p.rol, unidad: p.unidad, personas: [...new Set(personas.map((x) => x.nombre))] } : null,
    accion: { texto: "Ir a Documentos por firmar", ruta: "/informes/por-firmar", permisos: [], usuarios: [...new Set(personas.map((x) => x.id))] },
  };
}

/** Etapas Emisión · Firmas · Entrega sobre los documentos de la OT. */
function etapasDocumentos(docs: DocumentoAvance[], nombre = "Emisión del informe"): { emision: Etapa; firmas: Etapa; entrega: Etapa } {
  const v = vivos(docs);
  const vigentes = v.filter((d) => d.estado !== "devuelto");
  const devueltos = v.filter((d) => d.estado === "devuelto");
  const enFirma = v.filter((d) => d.estado === "en_firma");
  const oficiales = v.filter(esOficialDoc);
  const sinEntregar = oficiales.filter((d) => !d.entregadoAt);
  const emitido = vigentes.length > 0 && devueltos.length === 0;
  return {
    emision: etapa(
      "emision",
      nombre,
      emitido ? "hecho" : devueltos.length ? "en_curso" : "pendiente",
      devueltos.length ? `${devueltos.map((d) => d.numero).join(", ")} devuelto` : vigentes.map((d) => d.numero).join(", ") || null,
    ),
    firmas: etapa(
      "firmas",
      "Firmas",
      emitido && enFirma.length === 0 ? "hecho" : enFirma.length ? "en_curso" : "pendiente",
      enFirma.length ? `${enFirma.map((d) => d.numero).join(", ")} en firma` : oficiales.length ? `${plural(oficiales.length, "documento oficial", "documentos oficiales")}` : null,
    ),
    entrega: etapa(
      "entrega",
      "Entrega al cliente",
      emitido && enFirma.length === 0 && sinEntregar.length === 0 ? "hecho" : oficiales.length > sinEntregar.length ? "en_curso" : "pendiente",
      oficiales.length ? `${oficiales.length - sinEntregar.length} de ${oficiales.length} entregados` : null,
    ),
  };
}

/** Siguiente paso de las etapas de documentos. */
function pasoDocumentos(h: HechosOt, clave: string): Omit<SiguientePaso, "etapa"> {
  const v = vivos(h.documentos);
  const devuelto = v.find((d) => d.estado === "devuelto");
  const u = lab(h);
  if (clave === "emision") {
    if (devuelto)
      return {
        texto: `El documento ${devuelto.numero} fue devuelto: corríjalo y reemítalo (o anúlelo)`,
        leToca: { rol: "Jefe de Laboratorio", unidad: u, personas: [] },
        accion: { texto: "Ir a Informe y cierre", pestana: "informe", permisos: ["certificado.emitir"] },
      };
    if (h.cabeceraBpch?.length)
      return {
        texto: `Completar la cabecera de inspección antes de emitir el Informe de Inspección: ${h.cabeceraBpch.join(" ")}`,
        leToca: { rol: "Jefe de Sucursal o inspector", unidad: u, personas: h.analistas },
        accion: { texto: "Ir a Cabecera", pestana: "cabecera", permisos: ["bpch.cabecera.gestionar"] },
      };
    return {
      texto: "Emitir el informe con los resultados aprobados",
      leToca: { rol: "Jefe de Laboratorio", unidad: u, personas: [] },
      accion: { texto: "Ir a Informe y cierre", pestana: "informe", permisos: ["certificado.emitir"] },
    };
  }
  if (clave === "firmas") {
    const d = v.find((x) => x.estado === "en_firma");
    if (d) return pasoFirma(d);
  }
  const sinEntregar = v.filter((d) => esOficialDoc(d) && !d.entregadoAt);
  return {
    texto: `Registrar la entrega de ${sinEntregar.map((d) => d.numero).join(", ") || "los documentos"} al cliente`,
    leToca: { rol: "Planificación y Control o Ventas", unidad: null, personas: [] },
    accion: { texto: "Ir a Informe y cierre", pestana: "informe", permisos: ["certificado.entregar"] },
  };
}

/** Calibraciones de la OT con la forma de las reglas de Metrología (metrologia-ot.reglas.ts). */
const calsOt = (h: HechosOt) =>
  (h.calibraciones ?? []).map((c, i) => ({
    id: c.id ?? `cal-${i}`, instrumentoId: c.instrumentoId ?? null, codigo: c.codigo, numeroCertificado: c.numeroCertificado ?? null,
    estado: c.estado, entregadoAt: c.entregadoAt ?? null,
  }));

/** Etapa Cierre y su siguiente paso: usa EXACTAMENTE la regla del cierre (plazos.ts). */
function etapaCierre(h: HechosOt): { etapa: Etapa; paso: Omit<SiguientePaso, "etapa"> } {
  const cerrada = h.estado === "cerrada";
  const faltan = cerrada
    ? []
    : [
        ...faltantesParaCerrar({
          estado: h.estado,
          documentos: [
            ...h.documentos.map((d) => ({ numero: d.numero, estado: d.estado, entregadoAt: d.entregadoAt })),
            ...documentosDeMetrologia(calsOt(h), h.documentosNoCalibrables ?? []),
          ],
          resultadosNoAprobados: h.resultados.total - h.resultados.aprobados,
          coberturaPendiente: h.coberturaPendiente,
        }),
        ...faltantesInstrumentos(h.instrumentos ?? [], calsOt(h), h.exigeDevolucion ?? true),
      ];
  return {
    etapa: etapa("cierre", "Cierre de la OT", cerrada ? "hecho" : "pendiente", cerrada ? "Cerrada" : faltan.length ? null : "Lista para cerrar"),
    paso: {
      texto: faltan.length ? `Antes de cerrar: ${faltan.join(" ")}` : "Cerrar la OT: todo está aprobado, oficial y entregado",
      leToca: { rol: "Planificación y Control", unidad: null, personas: [] },
      accion: { texto: "Ir a Informe y cierre", pestana: "informe", permisos: ["ot.cerrar"] },
    },
  };
}

const TEXTO_FACTURA: Record<string, string> = {
  pendiente: "por emitir",
  emitida: "emitida · pago pendiente",
  parcial: "pago parcial",
  pagada: "pagada",
};

/** Etapas Factura y Pago (solo OT con cobro). */
function etapasFactura(h: HechosOt): { factura: Etapa; pago: Etapa } {
  if (!h.conCobro)
    return { factura: etapa("factura", "Factura", "no_aplica", "Sin cobro"), pago: etapa("pago", "Pago", "no_aplica", "Sin cobro") };
  const f = h.factura;
  const emitida = Boolean(f && ["emitida", "parcial", "pagada"].includes(f.estado));
  return {
    factura: etapa("factura", "Factura", emitida ? "hecho" : f ? "en_curso" : "pendiente", f ? `${f.numero} · ${TEXTO_FACTURA[f.estado] ?? f.estado}` : null),
    pago: etapa("pago", "Pago", f?.estado === "pagada" ? "hecho" : f?.estado === "parcial" ? "en_curso" : "pendiente", f && emitida ? TEXTO_FACTURA[f.estado] ?? f.estado : null),
  };
}

function pasoFactura(h: HechosOt, clave: string): Omit<SiguientePaso, "etapa"> {
  const f = h.factura;
  if (clave === "factura")
    return {
      texto: f ? `Emitir la factura ${f.numero} con su folio` : "Crear la factura de la OT cerrada",
      leToca: { rol: "Finanzas", unidad: null, personas: [] },
      accion: { texto: "Ir a Facturas", ruta: "/facturas", permisos: ["factura.emitir"] },
    };
  return {
    texto: `Registrar el pago de la factura ${f?.numero ?? ""}`.trim(),
    leToca: { rol: "Finanzas", unidad: null, personas: [] },
    accion: { texto: "Ir a Facturas", ruta: "/facturas", permisos: ["factura.cobrar"] },
  };
}

/* ----------------------------------------------------------- variantes --- */

type Paso = Omit<SiguientePaso, "etapa">;
/** Cada variante devuelve sus etapas y cómo se calcula el siguiente paso de cada una. */
interface Ruta {
  etapas: Etapa[];
  paso: (clave: string) => Paso | null;
}

/**
 * Órdenes internas que frenan el análisis: las que el destino aún no cierra
 * (abierta o recibida) y las cerradas que el solicitante no ha dado por
 * recibidas (EP-01 3.7 «Dar por recibido → evaluación»).
 */
function ordenesPendientes(h: HechosOt) {
  const oi = (h.ordenesInternas ?? []).filter((o) => o.estado !== "anulada");
  return {
    enDestino: oi.filter((o) => o.estado === "abierta" || o.estado === "recibida"),
    porIntegrar: oi.filter((o) => o.estado === "cerrada" && !o.aceptada),
  };
}

/** Etapa «Preparación del trabajo» del DSA (EP-05 2.2–2.3): solo si la documentación se aprueba. */
function etapaTrabajo(h: HechosOt): { etapa: Etapa; paso: Paso } | null {
  const t = h.trabajoDsa;
  if (!t?.exige) return null;
  const estado: EstadoEtapa = t.estado === "aprobada" ? "hecho" : t.estado === "en_aprobacion" || t.estado === "validada" ? "en_curso" : "pendiente";
  const lem = t.laboratorio === "LEM";
  const g = generoDocumentoTrabajo(t.titulo);
  const paso: Paso =
    t.estado === "en_aprobacion"
      ? {
          texto: lem ? `Validar ${g.art} ${t.titulo} (Jefe de Sección) antes de la aprobación del Jefe DSA` : `Aprobar ${g.art} ${t.titulo} antes de ejecutar`,
          leToca: { rol: lem ? "Jefe de Sección Ensayos Mecánicos" : "Jefe de Laboratorio", unidad: lem ? "SEM" : t.laboratorio, personas: [] },
          accion: { texto: "Ir a Preparación", pestana: "preparacion", permisos: ["ot.preparacion.aprobar"] },
        }
      : t.estado === "validada"
        ? {
            texto: `Aprobar ${g.art} ${t.titulo} (validad${g.o} por el Jefe de Sección)`,
            leToca: { rol: "Jefe del Departamento Sistemas de Armas", unidad: "DSA", personas: [] },
            accion: { texto: "Ir a Preparación", pestana: "preparacion", permisos: ["ot.preparacion.aprobar"] },
          }
        : {
            texto: t.estado === "devuelta" ? `Corregir ${g.art} ${t.titulo} devuelt${g.o} y enviar${g.lo} de nuevo a aprobación` : `Preparar ${g.art} ${t.titulo} y enviar${g.lo} a aprobación`,
            leToca: { rol: lem ? "Jefe de Laboratorio" : "Analista", unidad: t.laboratorio, personas: h.analistas },
            accion: { texto: "Ir a Preparación", pestana: "preparacion", permisos: ["resultado.crear", "ot.asignar"] },
          };
  return { etapa: etapa("preparacion", "Preparación del trabajo", estado, `${t.titulo}: ${t.texto}`), paso };
}

/** Siguiente paso de una orden interna pendiente: le toca al destino o al solicitante. */
function pasoOrdenInterna(h: HechosOt): Paso | null {
  const { enDestino, porIntegrar } = ordenesPendientes(h);
  const o = enDestino[0];
  if (o)
    return {
      texto:
        o.estado === "abierta"
          ? `Recibir la orden interna ${o.numero} en ${o.destino ?? "el laboratorio de destino"}`
          : o.respondida
            ? `Cerrar la orden interna ${o.numero} y devolver el informe`
            : `Responder la orden interna ${o.numero}: resultados, horas y costo directo`,
      leToca: { rol: "Jefe de Laboratorio", unidad: o.destino, personas: [] },
      accion: { texto: "Ir a la orden interna", ruta: `/ordenes-internas/${o.id}`, permisos: ["orden_interna.responder"] },
    };
  const p = porIntegrar[0];
  if (p)
    return {
      texto: `Dar por recibido el informe de la orden interna ${p.numero} e integrar sus resultados`,
      leToca: { rol: "Jefe de Laboratorio", unidad: lab(h), personas: [] },
      accion: { texto: "Ir a la orden interna", ruta: `/ordenes-internas/${p.id}`, permisos: ["orden_interna.emitir"] },
    };
  return null;
}

function rutaLaboratorio(h: HechosOt): Ruta {
  const u = lab(h);
  const res = etapasResultados(h);
  // Una orden interna sin cerrar o sin integrar deja el análisis en curso.
  const oiPend = ordenesPendientes(h);
  const nOi = oiPend.enDestino.length + oiPend.porIntegrar.length;
  // La Ruta muestra siempre las órdenes internas pendientes (recorrido MP-02, D02-22),
  // no solo cuando lo propio ya está capturado.
  if (nOi > 0)
    res.analisis = {
      ...res.analisis,
      estado: res.analisis.estado === "hecho" ? "en_curso" : res.analisis.estado,
      detalle: `${res.analisis.detalle ?? ""}${res.analisis.detalle ? " · " : ""}${plural(nOi, "orden interna pendiente", "órdenes internas pendientes")}`,
    };
  const docs = etapasDocumentos(h.documentos);
  const cierre = etapaCierre(h);
  const fac = etapasFactura(h);
  // La asignación ordena el trabajo pero no lo bloquea: si ya hay capturas, se da por hecha.
  const trabajoEmpezado = h.resultados.total - h.resultados.pendientes > 0;
  const trabajo = etapaTrabajo(h);
  // D03-19: la OT que requiere muestreo sigue en la Recepción hasta que el laboratorio recibe
  // un muestreo, aunque sus muestras ya existan (nacieron con la OT o la E.T.).
  const faltaMuestreo = !!h.requiereMuestreo && !(h.muestreos ?? []).some((x) => x.estado === "recibido");
  const etapas = [
    etapa("apertura", "Apertura de la OT", h.unidad ? "hecho" : "pendiente", detalleApertura(h)),
    etapa(
      "recepcion",
      "Recepción de muestras",
      h.muestras.total > 0 && !faltaMuestreo ? "hecho" : "pendiente",
      [
        h.muestras.total ? `${plural(h.muestras.total, "muestra")}${h.muestras.recepcionIncompleta ? ` · ${h.muestras.recepcionIncompleta} con recepción incompleta` : ""}` : "",
        faltaMuestreo ? "requiere muestreo: aún sin recibir" : "",
      ].filter(Boolean).join(" · ") || null,
    ),
    etapa(
      "asignacion",
      "Asignación",
      h.analistas.length || trabajoEmpezado ? "hecho" : "pendiente",
      h.analistas.length ? h.analistas.join(", ") : trabajoEmpezado ? "Sin asignación formal" : null,
    ),
    ...(trabajo ? [trabajo.etapa] : []),
    res.analisis,
    res.revision,
    res.aprobacion,
    docs.emision,
    docs.firmas,
    docs.entrega,
    cierre.etapa,
    fac.factura,
    fac.pago,
  ];
  return {
    etapas,
    paso: (clave) => {
      switch (clave) {
        case "apertura":
          return {
            texto: "Fijar el laboratorio responsable de la OT",
            leToca: { rol: "Planificación y Control", unidad: null, personas: [] },
            accion: { texto: "Ir a Cabecera", pestana: "cabecera", permisos: ["ot.cambiar_laboratorio"] },
          };
        case "recepcion": {
          // Un muestreo en curso va antes que la recepción (EP-01 1.1, EP-03 0.4).
          const enCurso = (h.muestreos ?? []).find((x) => x.estado === "borrador" || x.estado === "registrado");
          if (enCurso?.estado === "borrador")
            return {
              texto: `Completar el muestreo Nº ${enCurso.numero} y entregarlo al laboratorio`,
              leToca: { rol: "Sección Muestreo", unidad: null, personas: [] },
              accion: { texto: "Ir a Muestreo", pestana: "muestreo", permisos: ["muestreo.registrar"] },
            };
          if (enCurso)
            return {
              texto: `Recibir el muestreo Nº ${enCurso.numero} («recibido conforme») y recepcionar sus muestras`,
              leToca: { rol: "Recepción de muestras", unidad: u, personas: [] },
              accion: { texto: "Ir a Muestreo", pestana: "muestreo", permisos: ["muestra.crear"] },
            };
          if (faltaMuestreo)
            return {
              texto: "Registrar el muestreo de la OT (requiere muestreo) y entregarlo al laboratorio",
              leToca: { rol: "Sección Muestreo", unidad: null, personas: [] },
              accion: { texto: "Ir a Muestreo", pestana: "muestreo", permisos: ["muestreo.registrar"] },
            };
          return {
            texto: "Recepcionar las muestras: producto, condición de recepción, Nº interno y sus ensayos",
            leToca: { rol: "Recepción de muestras", unidad: u, personas: [] },
            accion: { texto: "Ir a Muestras", pestana: "muestras", permisos: ["muestra.crear"] },
          };
        }
        case "asignacion":
          return {
            texto: "Asignar los analistas de la OT",
            leToca: { rol: "Jefe de Laboratorio", unidad: u, personas: [] },
            accion: { texto: "Ir a Asignación", pestana: "asignacion", permisos: ["ot.asignar"] },
          };
        case "preparacion":
          return trabajo?.paso ?? null;
        case "analisis":
          // Con todo lo propio capturado, lo que falta es la orden interna.
          if (h.resultados.pendientes + h.resultados.devueltos === 0 && h.resultados.total > 0) {
            const oi = pasoOrdenInterna(h);
            if (oi) return oi;
          }
          {
            const p = pasoResultados(h, clave);
            // Mientras se captura lo propio, se nombran las derivaciones en curso (D02-22).
            const enCurso = [...oiPend.enDestino, ...oiPend.porIntegrar];
            if (!enCurso.length) return p;
            const lista = enCurso
              .slice(0, 3)
              .map((o) => `${o.numero}${o.destino ? ` en ${o.destino}` : ""} (${o.estado === "abierta" ? "por recibir" : o.estado === "recibida" ? "en análisis" : "por integrar"})`)
              .join(", ");
            return { ...p, texto: `${p.texto} · órdenes internas pendientes: ${lista}${enCurso.length > 3 ? "…" : ""}` };
          }
        case "revision":
        case "aprobacion":
          return pasoResultados(h, clave);
        case "emision":
        case "firmas":
        case "entrega":
          return pasoDocumentos(h, clave);
        case "cierre":
          return cierre.paso;
        case "factura":
        case "pago":
          return pasoFactura(h, clave);
      }
      return null;
    },
  };
}

const TEXTO_CAL: Record<string, string> = {
  borrador: "borrador",
  calculada: "borrador",
  en_revision: "en revisión técnica",
  en_firma: "en firma",
  emitida: "emitida",
};

function rutaMetrologia(h: HechosOt): Ruta {
  const u = lab(h);
  const cals = (h.calibraciones ?? []).filter((c) => c.estado !== "reemplazada");
  const est = (c: CalibracionAvance) => (c.estado === "calculada" ? "borrador" : c.estado);
  const n = (e: string) => cals.filter((c) => est(c) === e).length;
  const nombre = (c: CalibracionAvance) => c.numeroCertificado || c.codigo;
  const lista = (e: string) => cals.filter((c) => est(c) === e).map(nombre).join(", ");
  const primera = (e: string) => cals.find((c) => est(c) === e);
  const ficha = (c?: CalibracionAvance) => (c?.id ? `/metrologia/${c.id}` : "/metrologia");
  // Instrumentos (EP-04): un ítem por instrumento; los anulados no cuentan.
  const items = (h.instrumentos ?? []).filter((i) => i.estado !== "anulado");
  const porRecibir = items.filter((i) => i.estado === "por_recibir");
  const calOt = calsOt(h);
  const sinCalibrar = items.filter((i) => i.estado === "recibido" && !calibracionVigente(calOt, i.id));
  const sinMetrologo = items.filter((i) => (i.estado === "por_recibir" || i.estado === "recibido") && !i.metrologoId && !calibracionVigente(calOt, i.id));
  const enCustodia = items.filter((i) => i.estado === "recibido" || i.estado === "no_apto");
  const exigeDevolucion = h.exigeDevolucion ?? true;
  const ninguna = cals.length === 0;
  // Todos los instrumentos recibidos y ninguno por calibrar sin calibración: son no calibrables
  // (informe técnico o servicio externo, B-004). Calibración, revisión y firma no aplican y la
  // ruta sigue con la devolución y el cierre, igual que «Cerrar técnicamente».
  const sinCalibracion = ninguna && items.length > 0 && porRecibir.length === 0 && sinCalibrar.length === 0;
  const todasEnviadas = sinCalibracion || (!ninguna && n("borrador") === 0 && sinCalibrar.length === 0 && porRecibir.length === 0);
  const todasFirma = todasEnviadas && n("en_revision") === 0;
  const todasEmitidas = sinCalibracion || (!ninguna && n("emitida") === cals.length && sinCalibrar.length === 0 && porRecibir.length === 0);
  // Documentos que se entregan: certificados emitidos, y el informe técnico emitido o el
  // certificado externo validado del no calibrable (cuentan para el cierre, decisión 24-10).
  const noCal = (h.documentosNoCalibrables ?? []).filter(esEntregableNoCalibrable);
  const emitidas = [
    ...cals.filter((c) => est(c) === "emitida").map((c) => ({ texto: `certificado ${nombre(c)}`, entregadoAt: c.entregadoAt ?? null })),
    ...noCal.map((d) => ({
      texto: `${d.tipo === "informe_tecnico" ? "informe técnico" : "certificado externo"} ${d.numero ?? ""}`.trim(),
      entregadoAt: d.entregadoAt ?? null,
    })),
  ];
  const sinEntregar = emitidas.filter((c) => !c.entregadoAt);
  const porDevolver = exigeDevolucion ? enCustodia : [];
  const cierre = etapaCierre(h);
  const fac = etapasFactura(h);
  const cerrada = h.estado === "cerrada";
  const item = (i: InstrumentoAvance) => `ítem ${i.numero} (${i.descripcion})`;
  const etapas = [
    etapa("apertura", "Apertura de la OT", h.unidad ? "hecho" : "pendiente", detalleApertura(h)),
    etapa(
      "asignacion",
      "Programación (metrólogo)",
      items.length && !sinMetrologo.length ? "hecho" : "pendiente",
      [...new Set(items.map((i) => i.metrologo).filter(Boolean))].join(", ") || null,
    ),
    etapa(
      "recepcion",
      "Recepción del instrumento",
      items.length && !porRecibir.length ? "hecho" : items.length > porRecibir.length ? "en_curso" : "pendiente",
      items.length ? `${items.length - porRecibir.length} de ${plural(items.length, "instrumento")} recibidos` : "Sin instrumentos registrados",
    ),
    etapa("calibracion", "Toma de datos y cálculo", todasEnviadas ? "hecho" : ninguna && !items.length ? "pendiente" : ninguna ? "pendiente" : "en_curso",
      sinCalibracion ? "Sin calibración: instrumentos no calibrables" : ninguna ? "Sin calibración registrada" : cals.map((c) => `${nombre(c)} · ${TEXTO_CAL[est(c)] ?? est(c)}`).join("; ")),
    etapa("revision_tecnica", "Revisión técnica", todasFirma ? "hecho" : n("en_revision") ? "en_curso" : "pendiente", n("en_revision") ? lista("en_revision") : null),
    etapa("firma_emision", "Firma y emisión del certificado", todasEmitidas ? "hecho" : n("en_firma") ? "en_curso" : "pendiente", n("emitida") ? lista("emitida") : null),
    etapa(
      "entrega",
      "Entrega del certificado y devolución",
      cerrada || (todasEmitidas && !sinEntregar.length && !porDevolver.length) ? "hecho" : emitidas.length > sinEntregar.length || sinCalibracion ? "en_curso" : "pendiente",
      emitidas.length
        ? `${emitidas.length - sinEntregar.length} de ${emitidas.length} entregados${exigeDevolucion ? ` · ${items.filter((i) => i.estado === "devuelto").length} de ${items.length} devueltos` : ""}`
        : sinCalibracion && exigeDevolucion
          ? `${items.filter((i) => i.estado === "devuelto").length} de ${items.length} devueltos`
          : null,
    ),
    cierre.etapa,
    fac.factura,
    fac.pago,
  ];
  const instr = (texto: string, rol: string, permisos: string[], personas: string[] = []): Paso => ({
    texto, leToca: { rol, unidad: u, personas }, accion: { texto: "Ir a Instrumentos", pestana: "instrumentos", permisos },
  });
  return {
    etapas,
    paso: (clave) => {
      switch (clave) {
        case "apertura":
          return {
            texto: "Fijar el laboratorio responsable de la OT",
            leToca: { rol: "Planificación y Control", unidad: null, personas: [] },
            accion: { texto: "Ir a Cabecera", pestana: "cabecera", permisos: ["ot.cambiar_laboratorio"] },
          };
        case "recepcion":
          if (!items.length)
            return instr("Registrar los instrumentos de la OT (uno por instrumento)", "Jefe de Laboratorio de Metrología", ["ot.crear", "ot.asignar", "metrologia.crear"]);
          return instr(`Registrar la recepción de ${porRecibir.map(item).join(", ")}`, "Metrólogo", ["metrologia.crear", "muestra.crear"]);
        case "asignacion":
          if (!items.length)
            return instr("Registrar los instrumentos de la OT (uno por instrumento)", "Jefe de Laboratorio de Metrología", ["ot.crear", "ot.asignar", "metrologia.crear"]);
          return instr(`Asignar el metrólogo de ${sinMetrologo.map(item).join(", ")}`, "Jefe de Laboratorio de Metrología", ["ot.asignar"]);
        case "calibracion": {
          if (sinCalibrar.length)
            return instr(`Calibrar ${sinCalibrar.map(item).join(", ")}`, "Metrólogo", ["metrologia.crear"],
              [...new Set(sinCalibrar.map((i) => i.metrologo).filter((x): x is string => !!x))]);
          return {
            texto: `Completar y enviar a revisión ${lista("borrador")}`,
            leToca: { rol: "Metrólogo", unidad: u, personas: h.analistas },
            accion: { texto: "Ir a la ficha de calibración", ruta: ficha(primera("borrador")), permisos: ["metrologia.crear"] },
          };
        }
        case "revision_tecnica":
          return {
            texto: `Revisión técnica de ${lista("en_revision")}`,
            leToca: { rol: "Jefe de Laboratorio de Metrología", unidad: u, personas: [] },
            accion: { texto: "Ir a la ficha de calibración", ruta: ficha(primera("en_revision")), permisos: ["metrologia.ver"] },
          };
        case "firma_emision":
          return {
            texto: `Firmar y emitir ${lista("en_firma") || "el certificado de calibración"}`,
            leToca: { rol: "Jefe de Departamento", unidad: null, personas: [] },
            accion: { texto: "Ir a la ficha de calibración", ruta: ficha(primera("en_firma")), permisos: ["metrologia.ver"] },
          };
        case "entrega":
          if (sinEntregar.length)
            return instr(`Registrar la entrega del ${sinEntregar.map((d) => d.texto).join(", ")}`, "Metrólogo o Comercial", ["certificado.entregar", "metrologia.crear"]);
          return instr(`Registrar la devolución de ${porDevolver.map(item).join(", ")} (acta)`, "Metrólogo o Comercial", ["metrologia.crear", "certificado.entregar"]);
        case "cierre":
          return cierre.paso;
        case "factura":
        case "pago":
          return pasoFactura(h, clave);
      }
      return null;
    },
  };
}

/** Último documento vigente de un tipo (mismo criterio que bpch-comun › estadoOt). */
function vigenteDeTipo(docs: DocumentoAvance[], tipo: string): DocumentoAvance | null {
  return docs.filter((d) => d.tipoDocumento === tipo && ["en_firma", "oficial", "emitido", "devuelto"].includes(d.estado)).slice(-1)[0] ?? null;
}

/** Siguiente paso de un documento BPCH: emitirlo, firmarlo, reemitirlo o entregarlo. */
function pasoDocumentoBpch(doc: DocumentoAvance | null, nombre: string, enlace: string, unidad: string | null): Paso {
  if (!doc)
    return {
      texto: `Emitir el ${nombre}`,
      leToca: { rol: "Inspector o Jefe de la unidad inspectora", unidad, personas: [] },
      accion: { texto: "Ir al expediente BPCH", ruta: enlace, permisos: ["certificado.emitir"] },
    };
  if (doc.estado === "en_firma") return pasoFirma(doc);
  if (doc.estado === "devuelto")
    return {
      texto: `El ${nombre} ${doc.numero} fue devuelto: corríjalo y reemítalo`,
      leToca: { rol: "Inspector o Jefe de la unidad inspectora", unidad, personas: [] },
      accion: { texto: "Ir al expediente BPCH", ruta: enlace, permisos: ["certificado.emitir"] },
    };
  return {
    texto: `Registrar la entrega del ${nombre} ${doc.numero}`,
    leToca: { rol: "Sección Certificación de la Conformidad", unidad: null, personas: [] },
    accion: { texto: "Ir a Informe y cierre", pestana: "informe", permisos: ["certificado.entregar"] },
  };
}

function rutaInternacion(h: HechosOt): Ruta {
  const i = h.internacion!;
  const enlace = `/bpch/internaciones/${i.id}`;
  const r = h.resultados;
  const condicion = condicionFinal(h.muestras.veredictos ?? []);
  const informe = vigenteDeTipo(h.documentos, "INFORME_INSPECCION");
  const certificado = vigenteDeTipo(h.documentos, "CERTIFICADO_CONFORMIDAD");
  const incumplimiento = vigenteDeTipo(h.documentos, "INFORME_INCUMPLIMIENTO");
  const final = condicion === "no_cumple" ? incumplimiento : certificado;
  const nombreFinal = condicion === "no_cumple" ? "Informe de Incumplimiento" : "Certificado de Conformidad";
  const lotesOk = i.lotes > 0 && i.lotesRegistrados === i.lotes;
  const codificado = condicion === "cumple" && Boolean(certificado) && i.codificacionCertificados.length > 0 && i.codificacionCertificados.every((c) => c === certificado!.id);
  const finalHecho = Boolean(final && esOficialDoc(final) && (condicion !== "no_cumple" || final.entregadoAt));
  const cierre = etapaCierre(h);
  const etapas = [
    etapa("registro", "Resolución DGMN y análisis técnico", "hecho", i.numero),
    etapa("lotes", "OT y lotes a inspeccionar", lotesOk ? "hecho" : "en_curso", `${i.lotesRegistrados} de ${plural(i.lotes, "lote")} con muestra`),
    etapa("resultados", "Resultados de la inspección", r.total > 0 && r.aprobados === r.total ? "hecho" : r.total - r.pendientes - r.devueltos > 0 ? "en_curso" : "pendiente",
      r.total ? `${r.aprobados} de ${r.total} aprobados` : null),
    etapa("informe", "Informe de Inspección", informe && esOficialDoc(informe) ? "hecho" : informe ? "en_curso" : "pendiente", informe?.numero ?? null),
    etapa("documento_final", condicion === "no_cumple" ? "Informe de Incumplimiento → DGMN" : "Certificado de Conformidad",
      finalHecho ? "hecho" : final ? "en_curso" : "pendiente", final?.numero ?? `Condición: ${TEXTO_CONDICION[condicion]}`),
    etapa("codificacion", "Codificación Única", condicion === "no_cumple" ? "no_aplica" : codificado ? "hecho" : "pendiente"),
    etapa("tasa", "Tasa de internación → facturación", !i.sujetaTasa ? "no_aplica" : i.tasaRemitida ? "hecho" : i.tasaEnCurso ? "en_curso" : "pendiente",
      i.sujetaTasa ? `Documentación: ${i.documentacion ?? "pendiente"}` : "No sujeta a tasa"),
    cierre.etapa,
  ];
  return {
    etapas,
    paso: (clave) => {
      switch (clave) {
        case "lotes":
          return {
            texto: "Registrar la muestra de cada lote a inspeccionar",
            leToca: { rol: "Inspector", unidad: i.unidad, personas: h.analistas },
            accion: { texto: "Ir al expediente BPCH", ruta: enlace, permisos: ["bpch.internacion.gestionar"] },
          };
        case "resultados":
          return pasoResultados(h, "resultados");
        case "informe":
          return pasoDocumentoBpch(informe, "Informe de Inspección", enlace, i.unidad);
        case "documento_final":
          return pasoDocumentoBpch(final, nombreFinal, enlace, i.unidad);
        case "codificacion":
          return {
            texto: "Inscribir los elementos certificados en la Codificación Única",
            leToca: { rol: "Sección Certificación de la Conformidad", unidad: null, personas: [] },
            accion: { texto: "Ir al expediente BPCH", ruta: enlace, permisos: ["bpch.internacion.gestionar", "bpch.codificacion.gestionar"] },
          };
        case "tasa":
          return {
            texto: "Calcular la tasa de internación y remitirla a facturación",
            leToca: { rol: "Comercial (DCO)", unidad: null, personas: [] },
            accion: { texto: "Ir al expediente BPCH", ruta: enlace, permisos: ["bpch.tasa.gestionar"] },
          };
        case "cierre":
          return cierre.paso;
      }
      return null;
    },
  };
}

function rutaReinspeccion(h: HechosOt): Ruta {
  const x = h.reinspeccion!;
  const enlace = `/bpch/reinspecciones/${x.id}`;
  const r = h.resultados;
  const informe = vigenteDeTipo(h.documentos, "INFORME_INSPECCION") ?? vivos(h.documentos).slice(-1)[0] ?? null;
  const oficial = Boolean(informe && esOficialDoc(informe));
  const cierre = etapaCierre(h);
  const etapas = [
    etapa("solicitud", "Solicitud de reinspección", "hecho", x.numero),
    etapa("lote", "OT y lote a inspeccionar", x.loteRegistrado ? "hecho" : "en_curso", h.codigo),
    etapa("resultados", "Resultados de la inspección", r.total > 0 && r.aprobados === r.total ? "hecho" : r.total - r.pendientes - r.devueltos > 0 ? "en_curso" : "pendiente",
      r.total ? `${r.aprobados} de ${r.total} aprobados` : null),
    etapa("informe", "Informe de Inspección (reinspección)", oficial && informe!.entregadoAt ? "hecho" : informe ? "en_curso" : "pendiente", informe?.numero ?? null),
    etapa("trazabilidad", "Trazabilidad en Codificación Única", x.trazabilidadHecha ? "hecho" : x.conCodificacion ? "pendiente" : "no_aplica"),
    cierre.etapa,
  ];
  return {
    etapas,
    paso: (clave) => {
      switch (clave) {
        case "lote":
          return {
            texto: "Registrar la muestra del lote a reinspeccionar",
            leToca: { rol: "Inspector", unidad: x.unidad, personas: h.analistas },
            accion: { texto: "Ir al expediente BPCH", ruta: enlace, permisos: ["bpch.reinspeccion.gestionar"] },
          };
        case "resultados":
          return pasoResultados(h, "resultados");
        case "informe":
          return pasoDocumentoBpch(informe, "Informe de Inspección", enlace, x.unidad);
        case "trazabilidad":
          return {
            texto: "Registrar la trazabilidad de la reinspección en la Codificación Única",
            leToca: { rol: "Sección Certificación de la Conformidad", unidad: null, personas: [] },
            accion: { texto: "Ir al expediente BPCH", ruta: enlace, permisos: ["bpch.reinspeccion.gestionar"] },
          };
        case "cierre":
          return cierre.paso;
      }
      return null;
    },
  };
}

/**
 * OT de armas de la D11 (EP-11): las etapas son los pasos del expediente D11
 * (recepción, registro, ensayos, revisión, acuñación, certificados por arma y
 * entrega), más la tasa si la internación la lleva y el cierre. La revisión y
 * aprobación es la del flujo general; lo demás se hace en Certificación de armas.
 */
function rutaArmas(h: HechosOt): Ruta {
  const x = h.armas!;
  const enlace = `/saec/ot/${h.id}`;
  const cierre = etapaCierre(h);
  const i = h.internacion;
  const etapas: Etapa[] = [
    ...(i ? [etapa("registro", "Resolución DGMN y análisis técnico", "hecho", i.numero)] : []),
    ...x.pasos.map((p) => etapa(`d11_${p.clave}`, p.titulo, p.estado, p.detalle)),
    ...(i
      ? [etapa("tasa", "Tasa de internación → facturación", !i.sujetaTasa ? "no_aplica" : i.tasaRemitida ? "hecho" : i.tasaEnCurso ? "en_curso" : "pendiente",
          i.sujetaTasa ? `Documentación: ${i.documentacion ?? "pendiente"}` : "No sujeta a tasa")]
      : []),
    cierre.etapa,
  ];
  return {
    etapas,
    paso: (clave) => {
      if (clave === "cierre") return cierre.paso;
      if (clave === "tasa")
        return {
          texto: "Calcular la tasa de internación y remitirla a facturación",
          leToca: { rol: "Comercial (DCO)", unidad: null, personas: [] },
          accion: { texto: "Ir al expediente BPCH", ruta: `/bpch/internaciones/${i!.id}`, permisos: ["bpch.tasa.gestionar"] },
        };
      if (clave === "d11_revision") return pasoResultados(h, "d11_revision");
      const p = x.pasos.find((y) => `d11_${y.clave}` === clave);
      if (!p) return null;
      return {
        texto: `${p.titulo} · ${p.boton}`,
        leToca: { rol: p.leToca, unidad: lab(h), personas: [] },
        accion: {
          texto: "Ir a Certificación de armas",
          ruta: enlace,
          permisos: clave === "d11_programacion" ? ["arma.programar"] : clave === "d11_certificados" ? ["certificado.emitir"] : ["arma.registrar"],
        },
      };
    },
  };
}

/**
 * OT directa o de Producción Nacional del BPCH (EP-10 §3, EP-07; BL-158): las
 * fases de la inspección en vez de las del laboratorio. Cabecera de inspección →
 * lotes (muestras) → resultados → Informe de Inspección → documento final
 * (Certificado de Conformidad o Informe de Incumplimiento según la condición;
 * en Producción Nacional el informe técnico va en la correlación de la O/C) →
 * remisión a DCO → entrega → cierre → factura y pago.
 */
function rutaBpch(h: HechosOt): Ruta {
  const u = lab(h);
  const r = h.resultados;
  const pn = h.origen === "PRODUCCION_NACIONAL";
  // B-020 (recorrido MP-08, D08-06): la OT de prototipo no tiene Informe de Inspección
  // previo ni remisión a DCO; su documento es el dictamen del tipo (EP-08).
  const proto = h.origen === "PROTOTIPO";
  const condicion = condicionFinal(h.muestras.veredictos ?? []);
  const informe = vigenteDeTipo(h.documentos, "INFORME_INSPECCION");
  const certificado = vigenteDeTipo(h.documentos, "CERTIFICADO_CONFORMIDAD");
  const incumplimiento = vigenteDeTipo(h.documentos, "INFORME_INCUMPLIMIENTO");
  const final = proto ? certificado ?? incumplimiento : condicion === "no_cumple" ? incumplimiento : certificado;
  const nombreFinal = proto ? "dictamen del tipo" : condicion === "no_cumple" ? "Informe de Incumplimiento" : "Certificado de Conformidad";
  const informeOficial = Boolean(informe && esOficialDoc(informe));
  const finalAplica = !pn || Boolean(certificado || incumplimiento);
  const aRemitir = finalAplica ? final : informe;
  const remitido = Boolean(aRemitir?.despachadoA === "DCO");
  const docs = etapasDocumentos(h.documentos);
  const cierre = etapaCierre(h);
  const fac = etapasFactura(h);
  const etapas = [
    etapa("apertura", "Apertura de la OT", h.unidad ? "hecho" : "pendiente", detalleApertura(h)),
    etapa("cabecera", "Cabecera de inspección", !h.cabeceraBpch?.length || informe ? "hecho" : "pendiente",
      h.cabeceraBpch?.length && !informe ? `Falta: ${h.cabeceraBpch.length} dato(s)` : "Lugar, fecha, inspectores y procedimiento"),
    etapa("lotes", "Lotes a inspeccionar", h.muestras.total > 0 ? "hecho" : "pendiente",
      h.muestras.total ? plural(h.muestras.total, "lote registrado", "lotes registrados") : null),
    etapa("resultados", "Resultados de la inspección", r.total > 0 && r.aprobados === r.total ? "hecho" : r.total - r.pendientes - r.devueltos > 0 ? "en_curso" : "pendiente",
      r.total ? `${r.aprobados} de ${r.total} aprobados` : null),
    proto
      ? etapa("informe", "Informe de Inspección", "no_aplica", "Prototipo: sin Informe de Inspección previo")
      : etapa("informe", "Informe de Inspección", informeOficial ? "hecho" : informe ? "en_curso" : "pendiente", informe?.numero ?? null),
    proto
      ? etapa("documento_final", "Dictamen del tipo (aprobación o rechazo)", final && esOficialDoc(final) ? "hecho" : final ? "en_curso" : "pendiente",
          final?.numero ?? "Se emite desde BPCH › Prototipos")
      : etapa(
          "documento_final",
          condicion === "no_cumple" ? "Informe de Incumplimiento → DGMN" : "Certificado de Conformidad",
          !finalAplica ? "no_aplica" : final && esOficialDoc(final) ? "hecho" : final ? "en_curso" : "pendiente",
          !finalAplica ? "Producción Nacional: el informe técnico va en la correlación de la O/C" : final?.numero ?? `Condición: ${TEXTO_CONDICION[condicion]}`,
        ),
    proto
      ? etapa("remision_dco", "Remitir a DCO", "no_aplica", "Prototipo: el dictamen se entrega desde BPCH › Prototipos")
      : etapa("remision_dco", "Remitir a DCO", remitido ? "hecho" : "pendiente", remitido ? `${aRemitir!.numero} remitido` : null),
    docs.entrega,
    cierre.etapa,
    fac.factura,
    fac.pago,
  ];
  const ir = (texto: string, pestana: PestanaOt, permisos: string[], rol = "Inspector o Jefe de Sucursal"): Paso => ({
    texto, leToca: { rol, unidad: u, personas: h.analistas }, accion: { texto: pestana === "cabecera" ? "Ir a Cabecera" : pestana === "muestras" ? "Ir a Muestras" : "Ir a Informe y cierre", pestana, permisos },
  });
  return {
    etapas,
    paso: (clave) => {
      switch (clave) {
        case "apertura":
          return ir("Fijar la sucursal responsable de la OT", "cabecera", ["ot.cambiar_laboratorio"], "Sección Certificación de la Conformidad");
        case "cabecera":
          return ir(`Completar la cabecera de inspección: ${(h.cabeceraBpch ?? []).join(" ")}`, "cabecera", ["bpch.cabecera.gestionar"]);
        case "lotes":
          return ir("Registrar cada lote a inspeccionar como muestra con sus ensayos", "muestras", ["muestra.crear"], "Inspector");
        case "resultados":
          return pasoResultados(h, "resultados");
        case "informe":
          if (informe?.estado === "en_firma") return pasoFirma(informe);
          return ir(informe?.estado === "devuelto" ? `El Informe de Inspección ${informe.numero} fue devuelto: corríjalo y reemítalo` : "Emitir el Informe de Inspección", "informe", ["certificado.emitir"]);
        case "documento_final":
          if (final?.estado === "en_firma") return pasoFirma(final);
          return ir(`Emitir el ${nombreFinal}`, "informe", ["certificado.emitir"]);
        case "remision_dco":
          return ir(`Remitir ${aRemitir?.numero ?? "el documento"} a DCO (con o sin tasa, cumpla o no)`, "informe", ["certificado.despachar"], "Jefe de Sucursal o SCC");
        case "entrega":
          return pasoDocumentos(h, "entrega");
        case "cierre":
          return cierre.paso;
        case "factura":
        case "pago":
          return pasoFactura(h, clave);
      }
      return null;
    },
  };
}

/* ------------------------------------------------------------ principal --- */

/**
 * Barra de etapas y siguiente paso de la OT.
 * La etapa actual es la primera que no está hecha ni «no aplica»; las
 * posteriores que no estén hechas se muestran como pendientes (así la barra
 * tiene siempre UN solo punto actual, como en las maquetas).
 */
export function calcularAvance(h: HechosOt): AvanceOt {
  const tipo = tipoRuta(h);
  const ruta =
    tipo === "armas" ? rutaArmas(h)
    : tipo === "internacion" ? rutaInternacion(h)
    : tipo === "reinspeccion" ? rutaReinspeccion(h)
    : tipo === "metrologia" ? rutaMetrologia(h)
    : tipo === "bpch" ? rutaBpch(h)
    : rutaLaboratorio(h);

  const anulada = h.estado === "anulada";
  const cerrada = h.estado === "cerrada";
  // OT cerrada: lo que quedó atrás sin hacer ya no se hará (p. ej. una OT sin
  // asignación formal): se muestra como «no aplica», no como pendiente.
  const iCierre = ruta.etapas.findIndex((e) => e.clave === "cierre");
  const base = cerrada
    ? ruta.etapas.map((e, i) => (i < iCierre && e.estado !== "hecho" ? { ...e, estado: "no_aplica" as EstadoEtapa } : e))
    : ruta.etapas;
  const idx = anulada ? -1 : base.findIndex((e) => e.estado !== "hecho" && e.estado !== "no_aplica");
  const etapas = base.map((e, i) => {
    if (idx < 0 || i < idx || e.estado === "hecho" || e.estado === "no_aplica") return e;
    if (i === idx) return { ...e, estado: e.estado === "bloqueado" ? "bloqueado" : ("en_curso" as EstadoEtapa) };
    return { ...e, estado: "pendiente" as EstadoEtapa };
  });
  const actual = idx >= 0 ? etapas[idx] : null;
  const paso = actual ? ruta.paso(actual.clave) : null;

  const avisos: string[] = [];
  if (anulada) avisos.push("La OT está anulada.");
  if (h.opiPendiente) avisos.push("OPI pendiente: OT por disposición del Director con cobro.");
  const noConforme = (h.muestreos ?? []).filter((x) => x.estado === "recibido" && x.recibidoConforme === false);
  if (noConforme.length && !cerrada && !anulada)
    avisos.push(`Muestreo recibido no conforme: ${noConforme.map((x) => `Nº ${x.numero}`).join(", ")}.`);
    if (h.muestras.recepcionIncompleta && !cerrada && !anulada) avisos.push(`${plural(h.muestras.recepcionIncompleta, "muestra")} con la recepción incompleta (toma de muestra o condición).`);

  return {
    tipo,
    etapas,
    etapaActual: actual?.clave ?? null,
    siguiente: actual && paso ? { etapa: actual.clave, ...paso } : null,
    cierre: cerrada
      ? {
          fecha: h.fechaCierre ? new Date(h.fechaCierre).toISOString() : null,
          conCobro: h.conCobro,
          factura: h.factura ? { numero: h.factura.numero, estado: h.factura.estado } : null,
        }
      : null,
    avisos,
    pestanas: pestanasOt(h, tipo),
  };
}

/** Pestañas «Muestreo» y «Preparación»: solo en OT de laboratorio fuera del BPCH y la D11. */
export function pestanasOt(h: HechosOt, tipo: TipoRuta = tipoRuta(h)): AvanceOt["pestanas"] {
  const deLaboratorio = (tipo === "laboratorio" || tipo === "interna") && !h.rama && !h.unidad?.esMetrologia;
  return { muestreo: deLaboratorio, preparacion: deLaboratorio };
}

/** ¿Puede este usuario hacer la acción del siguiente paso? (para mostrar el botón o «Esperando a…»). */
export function puedeActuar(
  accion: AccionRuta | null | undefined,
  usuario: { id?: string | null; permisos?: string[]; roles?: string[] },
): boolean {
  if (!accion) return false;
  const roles = usuario.roles ?? [];
  if (accion.usuarios) return Boolean(usuario.id && accion.usuarios.includes(usuario.id));
  if (roles.includes("SUPERADMIN")) return true;
  if (!accion.permisos.length) return true;
  const permisos = usuario.permisos ?? [];
  return accion.permisos.some((p) => permisos.includes(p));
}
