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
 * Internación y Reinspección (las fases del expediente BPCH).
 */
import { faltantesParaCerrar } from "./plazos";
import { condicionFinal, TEXTO_CONDICION } from "../bpch/comun/reglas-bpch";

export type EstadoEtapa = "hecho" | "en_curso" | "pendiente" | "no_aplica" | "bloqueado";
export type TipoRuta = "laboratorio" | "interna" | "metrologia" | "internacion" | "reinspeccion";
/** Pestañas del expediente de la OT a las que puede llevar el «Siguiente paso». */
export type PestanaOt = "cabecera" | "asignacion" | "muestras" | "resultados" | "informe";

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
}

/* ------------------------------------------------------------- entrada --- */

export interface DocumentoAvance {
  id: string;
  numero: string;
  /** en_firma | oficial | emitido | devuelto | anulado */
  estado: string;
  tipoDocumento?: string | null;
  entregadoAt: Date | string | null;
  /** Pasos de firma pendientes ahora (solo si está en firma). */
  pendientes?: { rol: string; unidad: string | null; personas: { id: string; nombre: string }[] }[];
}

export interface CalibracionAvance {
  codigo: string;
  numeroCertificado?: string | null;
  /** borrador | calculada | en_revision | en_firma | emitida | reemplazada */
  estado: string;
}

export interface HechosOt {
  id: string;
  codigo: string;
  estado: string;
  origen: string | null;
  conCobro: boolean;
  opiPendiente?: boolean;
  unidad: { codigo: string; esMetrologia?: boolean } | null;
  cotizacion?: { codigo: string; estado: string } | null;
  fechaCierre?: Date | string | null;
  muestras: { total: number; recepcionIncompleta: number; veredictos?: (string | null)[] };
  /** Nombres de las personas asignadas a la OT (o a sus ensayos). */
  analistas: string[];
  resultados: { total: number; pendientes: number; capturados: number; revisados: number; aprobados: number; devueltos: number };
  documentos: DocumentoAvance[];
  factura: { numero: string; estado: string } | null;
  /** Calibraciones de Metrología ligadas a la OT (por id o por su código). */
  calibraciones?: CalibracionAvance[];
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
}

/* ------------------------------------------------------------- reglas --- */

const OFICIAL = ["oficial", "emitido"];
const esOficialDoc = (d: { estado: string }) => OFICIAL.includes(d.estado);
/** Documentos vivos: los anulados no cuentan para nada. */
const vivos = (docs: DocumentoAvance[]) => docs.filter((d) => d.estado !== "anulado");
const ORIGENES_INTERNOS = ["OT_INTERNA", "INTERLABORATORIO"];

/** Tipo de ruta que corresponde a la OT. */
export function tipoRuta(h: HechosOt): TipoRuta {
  if (h.internacion) return "internacion";
  if (h.reinspeccion) return "reinspeccion";
  // Metrología: laboratorio de la Sección Metrología que trabaja con calibraciones
  // (si la OT usa la captura estándar, sigue la ruta de laboratorio).
  if (h.unidad?.esMetrologia && ((h.calibraciones?.length ?? 0) > 0 || h.resultados.total === 0)) return "metrologia";
  if (h.origen && ORIGENES_INTERNOS.includes(h.origen)) return "interna";
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

/** Etapa Cierre y su siguiente paso: usa EXACTAMENTE la regla del cierre (plazos.ts). */
function etapaCierre(h: HechosOt): { etapa: Etapa; paso: Omit<SiguientePaso, "etapa"> } {
  const cerrada = h.estado === "cerrada";
  const faltan = cerrada
    ? []
    : faltantesParaCerrar({
        estado: h.estado,
        documentos: h.documentos.map((d) => ({ numero: d.numero, estado: d.estado, entregadoAt: d.entregadoAt })),
        resultadosNoAprobados: h.resultados.total - h.resultados.aprobados,
      });
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

function rutaLaboratorio(h: HechosOt): Ruta {
  const u = lab(h);
  const res = etapasResultados(h);
  const docs = etapasDocumentos(h.documentos);
  const cierre = etapaCierre(h);
  const fac = etapasFactura(h);
  // La asignación ordena el trabajo pero no lo bloquea: si ya hay capturas, se da por hecha.
  const trabajoEmpezado = h.resultados.total - h.resultados.pendientes > 0;
  const etapas = [
    etapa("apertura", "Apertura de la OT", h.unidad ? "hecho" : "pendiente", detalleApertura(h)),
    etapa(
      "recepcion",
      "Recepción de muestras",
      h.muestras.total > 0 ? "hecho" : "pendiente",
      h.muestras.total ? `${plural(h.muestras.total, "muestra")}${h.muestras.recepcionIncompleta ? ` · ${h.muestras.recepcionIncompleta} con recepción incompleta` : ""}` : null,
    ),
    etapa(
      "asignacion",
      "Asignación",
      h.analistas.length || trabajoEmpezado ? "hecho" : "pendiente",
      h.analistas.length ? h.analistas.join(", ") : trabajoEmpezado ? "Sin asignación formal" : null,
    ),
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
        case "recepcion":
          return {
            texto: "Registrar las muestras recibidas y sus ensayos",
            leToca: { rol: "Recepción de muestras", unidad: u, personas: [] },
            accion: { texto: "Ir a Muestras", pestana: "muestras", permisos: ["muestra.crear"] },
          };
        case "asignacion":
          return {
            texto: "Asignar los analistas de la OT",
            leToca: { rol: "Jefe de Laboratorio", unidad: u, personas: [] },
            accion: { texto: "Ir a Asignación", pestana: "asignacion", permisos: ["ot.asignar"] },
          };
        case "analisis":
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
  const ninguna = cals.length === 0;
  const todasEnviadas = !ninguna && n("borrador") === 0;
  const todasFirma = todasEnviadas && n("en_revision") === 0;
  const todasEmitidas = !ninguna && n("emitida") === cals.length;
  const docs = etapasDocumentos(h.documentos, "Informe del flujo general");
  const cierre = etapaCierre(h);
  const fac = etapasFactura(h);
  const oficialesEntregados = vivos(h.documentos).some((d) => esOficialDoc(d) && d.entregadoAt);
  // El certificado de calibración aún no se liga a la OT: su entrega no se registra en
  // la OT y el cierre sigue pidiendo un documento del flujo general (ver la doc).
  const entrega = todasEmitidas && !oficialesEntregados && h.estado !== "cerrada"
    ? etapa("entrega", "Entrega al cliente", "bloqueado", "La entrega del certificado de calibración aún no se registra en la OT")
    : h.estado === "cerrada" ? etapa("entrega", "Entrega al cliente", "hecho", docs.entrega.detalle) : docs.entrega;
  const etapas = [
    etapa("apertura", "Apertura de la OT", h.unidad ? "hecho" : "pendiente", detalleApertura(h)),
    etapa("calibracion", "Toma de datos y cálculo", todasEnviadas ? "hecho" : ninguna ? "pendiente" : "en_curso",
      ninguna ? "Sin calibración registrada" : cals.map((c) => `${nombre(c)} · ${TEXTO_CAL[est(c)] ?? est(c)}`).join("; ")),
    etapa("revision_tecnica", "Revisión técnica", todasFirma ? "hecho" : n("en_revision") ? "en_curso" : "pendiente", n("en_revision") ? lista("en_revision") : null),
    etapa("firma_emision", "Firma y emisión del certificado", todasEmitidas ? "hecho" : n("en_firma") ? "en_curso" : "pendiente", n("emitida") ? lista("emitida") : null),
    entrega,
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
        case "calibracion":
          return {
            texto: ninguna
              ? `Registrar la calibración indicando la OT ${h.codigo}`
              : `Completar y enviar a revisión ${lista("borrador")}`,
            leToca: { rol: "Metrólogo", unidad: u, personas: h.analistas },
            accion: { texto: ninguna ? "Ir a Nueva calibración" : "Ir a Calibraciones", ruta: ninguna ? "/metrologia/nueva" : "/metrologia", permisos: ["metrologia.crear"] },
          };
        case "revision_tecnica":
          return {
            texto: `Revisión técnica de ${lista("en_revision")}`,
            leToca: { rol: "Jefe de Laboratorio de Metrología", unidad: u, personas: [] },
            accion: { texto: "Ir a Calibraciones", ruta: "/metrologia", permisos: ["metrologia.emitir"] },
          };
        case "firma_emision":
          return {
            texto: `Firmar y emitir ${lista("en_firma") || "el certificado de calibración"}`,
            leToca: { rol: "Jefe de Departamento", unidad: null, personas: [] },
            accion: { texto: "Ir a Calibraciones", ruta: "/metrologia", permisos: ["metrologia.emitir"] },
          };
        case "entrega":
          if (entrega.estado === "bloqueado")
            return {
              texto: "Entregar el certificado de calibración y cerrar la OT: el cierre aún exige un informe del flujo general (integración de Metrología con la OT pendiente)",
              leToca: { rol: "Planificación y Control", unidad: null, personas: [] },
              accion: { texto: "Ir a Informe y cierre", pestana: "informe", permisos: ["ot.cerrar", "certificado.entregar"] },
            };
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
    tipo === "internacion" ? rutaInternacion(h)
    : tipo === "reinspeccion" ? rutaReinspeccion(h)
    : tipo === "metrologia" ? rutaMetrologia(h)
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
  };
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
