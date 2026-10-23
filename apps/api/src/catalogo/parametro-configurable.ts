/**
 * Parámetros de la entrega R1 que se editan desde «Parámetros del sistema» ·
 * reglas PURAS (sin BD), probadas en parametro-configurable.spec.ts.
 *
 * Cada parámetro tiene un TIPO y el valor se valida según él antes de guardarse
 * en `parametro_sistema` con la forma que leen sus lectores (circuito-config.ts,
 * numeracion-cotizacion.ts, recepcion.service.ts, metrologia-ot.datos.ts, metrologia/ficha.reglas.ts,
 * equipo-captura.ts, veredicto.ts (criterioIndeterminado), alcance-resultado.ts
 * (configSegregacion), ot-desde-proceso.service.ts (plazo de la internación) y la
 * función fn_encuesta_al_cerrar_ot). Igual que los
 * porcentajes de la tasa (parametro-porcentaje.ts): todo cambio exige motivo y
 * queda en `parametro_sistema_historial` (quién, cuándo, antes, después y por qué).
 *
 * Tipos:
 *   entero      número entero entre `min` y `max` (dígitos, meses, inicio…)
 *   porcentaje  0–100 con coma decimal (se guarda con punto)
 *   sino        Sí / No (se guarda «si» / «no»)
 *   opcion      una de `opciones`
 *   multiple    varias de `opciones` (se guarda separadas por coma)
 *   formato     plantilla de número con {AAAA} y {N}
 *   obligatorio Sí / No guardado en la columna `activo` (producto obligatorio por laboratorio)
 *   campo       definición JSON de un campo propio de la recepción
 *               {tipo, obligatorio, opciones, ayuda} + `activo`
 *   variante    formulario de captura especializado de un método o laboratorio
 *               (valor = variante; `activo` = si rige) — frente r2a
 *   tabla       filas JSON con columnas tipadas (tabla de amenazas del LRB,
 *               HCP por tipo de vehículo, planes n, c, m, M, rangos sensoriales)
 *   campo_prep  campo de la preparación de muestras de un laboratorio
 *               {tipo, obligatorio, bloquea, unidad, opciones, ayuda} + `activo`
 */
import { formatearNumeroCotizacion, configNumeracion } from "../cotizacion/numeracion-cotizacion";
import { CLASES_CUSTODIA, TIPOS_CAMPO, leerCampo, type TipoCampo } from "../recepcion/reglas-recepcion";
import { leerPorcentaje, valorGuardado } from "./parametro-porcentaje";
import { AQLS, ETIQUETA_NIVEL, NIVELES, textoAql } from "../muestreo/nch44";
import { DIFUSION_TASA } from "../common/parametros-r4d";
import { OPCIONES_VARIANTE, esVariante } from "../formularios/variantes";
// NCh 44 de los formularios especializados (frente r2a): AQL como texto con coma.
import { jsonCampoPrep, normalizarCampoPrep } from "../formularios/preparacion";

/** Columnas de AQL de la tabla 2-A como opciones (se guarda con punto, se muestra con coma). */
const OPCIONES_AQL: Opcion[] = AQLS.map((a) => ({ valor: String(a), etiqueta: String(a).replace(".", ",") }));
/*
 * Las dos familias de parámetros AQL («Muestreo del lote» e «Inspección por
 * atributos») toman sus opciones de la MISMA tabla (`muestreo/nch44.ts`). Se
 * guardan con la escritura que ya tenían («2.5» en el muestreo, «2,5» en la
 * inspección) para no cambiar lo configurado ni lo que leen sus pantallas.
 */
const AQLS_FORM: string[] = AQLS.map(textoAql);
const NIVELES_FORM = NIVELES;

export type TipoValor = "entero" | "porcentaje" | "sino" | "opcion" | "multiple" | "formato" | "obligatorio" | "campo" | "variante" | "tabla" | "campo_prep";

/** Columna de un parámetro de tipo «tabla» (tabla de amenazas, HCP, planes RSA…). */
export interface ColumnaTabla {
  clave: string;
  etiqueta: string;
  tipo: "texto" | "numero" | "entero" | "opcion" | "sino";
  opciones?: Opcion[];
  obligatoria?: boolean;
  min?: number;
  max?: number;
  /** Largo máximo del texto. */
  largo?: number;
}

export type AltaPatron = "laboratorio" | "campo" | "metodo" | "plantilla";

export interface Opcion {
  valor: string;
  etiqueta: string;
}

export interface DefValor {
  tipo: TipoValor;
  /** Nombre que se muestra (la etiqueta de la fila puede traer pistas técnicas). */
  nombre: string;
  ayuda?: string;
  min?: number;
  max?: number;
  /** Unidad del número («meses», «dígitos»). */
  unidad?: string;
  opciones?: Opcion[];
  /** Valor que rige si la fila falta o no se entiende (lo que hacen los lectores). */
  porDefecto?: string;
  /**
   * Opciones que se leen de la base al servir la pantalla y al validar (no fijas):
   * «laboratorios» = las unidades que reciben muestras (código · nombre).
   */
  opcionesDe?: "laboratorios";
  /** Tipo «tabla»: columnas y máximo de filas. */
  columnas?: ColumnaTabla[];
  maxFilas?: number;
}

export interface GrupoConfig {
  categoria: string;
  titulo: string;
  /** Dónde surte efecto (pantalla o paso). */
  donde: string;
  /** Pregunta abierta al IDIC, si la hay. */
  porConfirmar?: string;
  /** Códigos fijos. */
  codigos?: Record<string, DefValor>;
  /** Cualquier código de la categoría (uno por laboratorio o por campo), con alta desde la pantalla. */
  patron?: DefValor & { alta: AltaPatron };
}

const SI_NO: Opcion[] = [
  { valor: "si", etiqueta: "Sí" },
  { valor: "no", etiqueta: "No" },
];

/** Orígenes de OT (reglas-ot.ts ORIGENES_OT + los de BPCH). */
export const ORIGENES_OT_ENCUESTA: Opcion[] = [
  { valor: "COTIZACION", etiqueta: "Cotización" },
  { valor: "DISPOSICION", etiqueta: "Disposición del Director" },
  { valor: "INTERLABORATORIO", etiqueta: "Interlaboratorio" },
  { valor: "OT_INTERNA", etiqueta: "OT interna" },
  { valor: "INTERNACION", etiqueta: "Internación (BPCH)" },
  { valor: "REINSPECCION", etiqueta: "Reinspección (BPCH)" },
  { valor: "PRODUCCION_NACIONAL", etiqueta: "Producción Nacional (BPCH)" },
  { valor: "PROTOTIPO", etiqueta: "Prototipo (BPCH)" },
];

const TIPO_CAMPO_ETIQUETA: Record<TipoCampo, string> = {
  texto: "Texto",
  numero: "Número",
  entero: "Número entero",
  fecha: "Fecha",
  lista: "Lista de opciones",
  casilla: "Casilla (sí / no)",
};
export const OPCIONES_TIPO_CAMPO: Opcion[] = TIPOS_CAMPO.map((t) => ({ valor: t, etiqueta: TIPO_CAMPO_ETIQUETA[t] }));

/** Métodos del catálogo de la D11 (DTCG-PG03) que puede cargar cada camino del arma. */
export const METODOS_D11: Opcion[] = [
  { valor: "1292", etiqueta: "1292 · Clasificación de armas (IT05)" },
  { valor: "1291", etiqueta: "1291 · Reconocimiento de cuño (IT01)" },
  { valor: "1213", etiqueta: "1213 · Inspección ocular antes y después del disparo (IT02)" },
  { valor: "1202", etiqueta: "1202 · Tensión del disparador (IT03)" },
  { valor: "1203", etiqueta: "1203 · Prueba de funcionamiento (IT04)" },
  { valor: "3500", etiqueta: "3500 · Evidencia balística · IBIS (IT12)" },
  { valor: "2755", etiqueta: "2755 · Acuñación de armas (IT08)" },
  { valor: "3454", etiqueta: "3454 · Remarca de armas (IT09)" },
  { valor: "2322", etiqueta: "2322 · Inspección ocular de accesorios (IT10)" },
  { valor: "3706", etiqueta: "3706 · Inspección ocular de máquinas recargadoras (IT12)" },
  { valor: "3455", etiqueta: "3455 · Emisión de certificado (IT11)" },
];

/** Registro de los parámetros R1 editables, en el orden de la pantalla. */
export const GRUPOS_CONFIG: GrupoConfig[] = [
  {
    categoria: "numeracion_cotizacion",
    titulo: "Numeración de la cotización",
    donde: "Comercial › Cotizaciones: el número se asigna al crear la cotización. Las ya numeradas no cambian.",
    porConfirmar: "Formato y si el correlativo es global o anual (EP-00 §10 P6).",
    codigos: {
      formato: {
        tipo: "formato",
        nombre: "Formato del número",
        ayuda: "{AAAA} = año de emisión, {N} = correlativo. Ejemplo: {AAAA}-{N} → 2026-14324.",
        porDefecto: "{AAAA}-{N}",
      },
      digitos: { tipo: "entero", nombre: "Dígitos mínimos del correlativo", min: 1, max: 10, unidad: "dígitos", ayuda: "Se rellena con ceros a la izquierda.", porDefecto: "5" },
      reinicio: {
        tipo: "opcion",
        nombre: "Reinicio del correlativo",
        opciones: [
          { valor: "global", etiqueta: "Nunca (correlativo continuo)" },
          { valor: "anual", etiqueta: "Cada año vuelve a 1" },
        ],
        porDefecto: "global",
      },
      inicio: {
        tipo: "entero",
        nombre: "Último número ya usado",
        min: 0,
        max: 999_999_999,
        ayuda: "El siguiente número será este + 1 (sirve para continuar la numeración del Sistema Comercial). Bajarlo no reutiliza números ya emitidos.",
        porDefecto: "0",
      },
    },
  },
  {
    categoria: "circuito_cotizacion",
    titulo: "Circuito de la cotización",
    donde: "Comercial › Cotización: costeo con el laboratorio, V°B°, firma del Jefe DCO y registro de la aceptación.",
    porConfirmar: "Niveles de V°B° y si la firma y la consulta al laboratorio son obligatorias (EP-00 §10 P1–P2).",
    codigos: {
      vb_niveles: {
        tipo: "opcion",
        nombre: "V°B° que exige la respuesta del laboratorio",
        opciones: [
          { valor: "lab_depto", etiqueta: "Laboratorio y departamento" },
          { valor: "lab", etiqueta: "Solo el laboratorio" },
          { valor: "ninguno", etiqueta: "Ninguno" },
        ],
        porDefecto: "lab_depto",
      },
      exigir_consulta_laboratorio: {
        tipo: "sino",
        nombre: "Exigir al menos una consulta al laboratorio antes de firmar",
        opciones: SI_NO,
        porDefecto: "no",
      },
      exigir_firma_para_aceptar: {
        tipo: "sino",
        nombre: "Exigir la firma del Jefe DCO antes de registrar la aceptación",
        opciones: SI_NO,
        ayuda: "Con «No», la cotización se puede aceptar sin firmar.",
        porDefecto: "si",
      },
      cfa_pct: { tipo: "porcentaje", nombre: "Costo fijo asociado (CFA) del Formulario de costeo", min: 0, max: 100, porDefecto: "12" },
      margen_particular_pct: { tipo: "porcentaje", nombre: "Recargo del precio particular sobre el costo total", min: 0, max: 100, porDefecto: "20" },
    },
  },
  {
    categoria: "encuesta",
    titulo: "Encuestas de satisfacción",
    donde: "Al cerrar o finalizar una OT nace su encuesta pendiente (Comercial › Encuestas), salvo para estos orígenes.",
    codigos: {
      excluir_origenes: {
        tipo: "multiple",
        nombre: "Orígenes de OT que NO generan encuesta",
        opciones: ORIGENES_OT_ENCUESTA,
        ayuda: "Marque los orígenes sin cliente externo. Sin ninguno marcado, toda OT cerrada genera encuesta.",
        porDefecto: "OT_INTERNA,INTERLABORATORIO",
      },
    },
  },
  {
    categoria: "metrologia",
    titulo: "Metrología · cierre de la OT de calibración",
    donde: "OT de Metrología › Cerrar OT y la lista «OT por cerrar».",
    codigos: {
      cierre_exige_devolucion: {
        tipo: "sino",
        nombre: "El cierre exige registrar la devolución de cada instrumento",
        opciones: SI_NO,
        porDefecto: "si",
      },
    },
  },
  {
    categoria: "metrologia_ficha",
    titulo: "Metrología · ficha de calibración y certificado",
    donde:
      "Metrología › Ficha de calibración (error normalizado, patrones), emisión y entrega del certificado; OT de calibración › Cerrar técnicamente.",
    porConfirmar: "Criterio de Eₙ, aviso al solicitante, equipo del laboratorio dueño e informe técnico o servicio externo del no calibrable (EP-04 §10 P5, P6, P9 y P13).",
    codigos: {
      criterio_en: {
        tipo: "opcion",
        nombre: "Criterio del error normalizado (informativo)",
        opciones: [
          { valor: "<=1", etiqueta: "Eₙ ≤ 1 (como P-808 y L-4359)" },
          { valor: "<1", etiqueta: "Eₙ < 1 (como M-3889)" },
        ],
        porDefecto: "<=1",
      },
      patron_fuera_rango: {
        tipo: "opcion",
        nombre: "Punto medido con un patrón fuera de su rango calibrado",
        opciones: [
          { valor: "bloquear", etiqueta: "Bloquear el guardado (no se acepta extrapolar, R15 P6)" },
          { valor: "avisar", etiqueta: "Solo avisar" },
        ],
        ayuda: "Solo se controla con los patrones que tienen su rango numérico en el maestro.",
        porDefecto: "bloquear",
      },
      notificar_emision: {
        tipo: "sino",
        nombre: "Al emitir, enviar el certificado por correo al contacto de la OT",
        opciones: SI_NO,
        ayuda: "En OT interna, al jefe del laboratorio dueño. Si el correo no sale, la emisión no se detiene y queda en la bitácora de Mensajería.",
        porDefecto: "si",
      },
      actualizar_equipo: {
        tipo: "opcion",
        nombre: "Actualizar el equipo del laboratorio dueño (OT interna)",
        opciones: [
          { valor: "emitir", etiqueta: "Al emitir el certificado" },
          { valor: "entregar", etiqueta: "Al registrar la entrega del certificado" },
          { valor: "no", etiqueta: "No actualizar (lo hace el laboratorio dueño)" },
        ],
        porDefecto: "emitir",
      },
      no_apto_exige_documento: {
        tipo: "sino",
        nombre: "El cierre técnico exige el informe técnico emitido o el servicio externo validado del ítem no calibrable",
        opciones: SI_NO,
        porDefecto: "no",
      },
    },
  },
  {
    categoria: "recepcion_producto_obligatorio",
    titulo: "Recepción · producto obligatorio por laboratorio",
    donde: "OT › Muestras › Recepción: el laboratorio marcado no puede dar la muestra por recibida sin elegir el producto (matriz).",
    patron: {
      tipo: "obligatorio",
      nombre: "Producto obligatorio al recepcionar",
      opciones: SI_NO,
      alta: "laboratorio",
      porDefecto: "no",
    },
  },
  {
    categoria: "numeracion_muestra",
    titulo: "Recepción · Nº de muestra interno",
    donde: "OT › Muestras › «Asignar número».",
    codigos: {
      inicio: {
        tipo: "entero",
        nombre: "Primer Nº de muestra interno",
        min: 1,
        max: 999_999_999,
        ayuda: "Si se continúa la numeración del LIMS antiguo, ponga aquí el siguiente número. No reutiliza números ya asignados.",
        porDefecto: "1",
      },
    },
  },
  {
    categoria: "retencion_muestra",
    titulo: "Recepción · plazos de retención",
    donde: "Muestras › Custodia: antes de cumplirse el plazo no se puede registrar la destrucción. Vale para las muestras que se reciban desde el cambio.",
    codigos: {
      testigo: { tipo: "entero", nombre: "Muestra testigo · tiempo en bodega antes de destruirla", min: 1, max: 600, unidad: "meses", porDefecto: "1" },
      contramuestra: { tipo: "entero", nombre: "Contramuestra · tiempo de retención", min: 1, max: 600, unidad: "meses", porDefecto: "12" },
    },
  },
  {
    categoria: "recepcion_campo",
    titulo: "Recepción · campos propios de cada laboratorio",
    donde: "OT › Muestras › Recepción: campos adicionales que pide cada laboratorio (lote, fabricante, verificaciones…).",
    patron: { tipo: "campo", nombre: "Campo de recepción", alta: "campo" },
  },
  {
    categoria: "captura_equipo",
    titulo: "Captura · equipo usado",
    donde: "Captura y revisión por OT: cuándo es obligatorio indicar el equipo (contrato §4.4.2).",
    codigos: {
      obligatorio: {
        tipo: "opcion",
        nombre: "Equipo obligatorio al capturar",
        opciones: [
          { valor: "metodo", etiqueta: "Solo en los métodos marcados «exige equipo»" },
          { valor: "numerico", etiqueta: "En todo ensayo numérico y en los métodos marcados" },
          { valor: "siempre", etiqueta: "En todo ensayo" },
        ],
        porDefecto: "metodo",
      },
    },
  },
  // --- Reglas del recorrido MP-02 / MP-06 (frente r1g), editables desde r1h ---
  {
    categoria: "captura_ld",
    titulo: "Captura · resultado bajo el límite de detección («< LD»)",
    donde:
      "Captura y revisión por OT: veredicto de un «< 10» que no se puede decidir contra el requisito (p. ej. «< 10» frente a Máx 5). Vale para lo que se capture desde el cambio.",
    porConfirmar: "Criterio cuando el límite es menor que el LD (EP-02 §10.2).",
    codigos: {
      indeterminado: {
        tipo: "opcion",
        nombre: "Veredicto de un «< LD» que no se puede decidir",
        opciones: [
          { valor: "pendiente", etiqueta: "Pendiente: lo decide el revisor (bloquea la aprobación hasta entonces)" },
          { valor: "no_cumple", etiqueta: "No cumple" },
          { valor: "cumple", etiqueta: "Cumple" },
        ],
        porDefecto: "pendiente",
      },
    },
  },
  {
    categoria: "segregacion_resultado",
    titulo: "Revisión y aprobación de resultados",
    donde: "Captura y revisión por OT: quien revisó un resultado no lo aprueba (también en «Aprobar todo lo revisado»).",
    porConfirmar: "Laboratorios de dos personas donde la misma persona revisa y aprueba (no hay casos documentados para resultados).",
    codigos: {
      revisor_aprobador: {
        tipo: "opcion",
        nombre: "Revisión y aprobación de un resultado",
        opciones: [
          { valor: "distintas", etiqueta: "Por personas distintas" },
          { valor: "misma_persona", etiqueta: "La misma persona puede revisar y aprobar" },
        ],
        porDefecto: "distintas",
      },
      excepciones: {
        tipo: "multiple",
        nombre: "Laboratorios donde la misma persona puede revisar y aprobar",
        opcionesDe: "laboratorios",
        ayuda: "Solo cuenta con «Por personas distintas». Ninguno marcado = la regla vale en todos los laboratorios.",
        porDefecto: "",
      },
    },
  },
  {
    categoria: "ot_plazo",
    titulo: "Plazo de la OT de internación",
    donde: "BPCH › Internaciones: fecha de compromiso de la OT al generarla (hoy en Chile + el plazo). Las OT ya generadas no cambian.",
    porConfirmar: "Plazo real de la OT de internación (EP-06).",
    codigos: {
      internacion_dias: {
        tipo: "entero",
        nombre: "Plazo de la OT de internación",
        min: 1,
        max: 365,
        unidad: "días corridos",
        porDefecto: "10",
      },
    },
  },
  // --- Avisos y oficio conductor (frente r4c, T20 y T03) ---
  {
    categoria: "avisos",
    titulo: "Avisos internos y por correo",
    donde:
      "Mi bandeja › Avisos y correo: OT vencidas y por vencer, resultados No cumple o Contaminado, documentos oficiales, despachos y oficios. Sin correo configurado el aviso queda en la bandeja y en la bitácora de Mensajería.",
    porConfirmar: "Umbral de «por vencer» (Sistema Comercial: 4 días) y aviso al cliente de un No cumple (EP-00 P9, EP-02 P7 / DQO-07).",
    codigos: {
      dias_por_vencer: { tipo: "entero", nombre: "Días antes del compromiso en que se avisa «por vencer»", min: 1, max: 30, unidad: "días", porDefecto: "3" },
      revision_automatica: { tipo: "sino", nombre: "Revisar los plazos cada hora y avisar al laboratorio y al ejecutivo", opciones: SI_NO, porDefecto: "si" },
      enviar_correo: { tipo: "sino", nombre: "Enviar también por correo los avisos", opciones: SI_NO, porDefecto: "si" },
      no_cumple_al_cliente: {
        tipo: "sino",
        nombre: "Avisar al cliente por correo un resultado No cumple o Contaminado al aprobarlo",
        opciones: SI_NO,
        ayuda: "Al Jefe de Laboratorio y al ejecutivo se les avisa siempre (contrato §4.2.6).",
        porDefecto: "no",
      },
      documento_listo: { tipo: "sino", nombre: "Avisar a Comercial cuando un documento queda oficial", opciones: SI_NO, porDefecto: "si" },
    },
  },
  {
    categoria: "oficio_conductor",
    titulo: "Oficio conductor exigido para entregar",
    donde: "Registrar la entrega o el despacho al cliente de un documento: estos tipos, en estos departamentos, necesitan un oficio conductor firmado.",
    porConfirmar: "Tipos y departamentos que salen con oficio (EP-05 7.2; LEM «¿se requiere oficio?»).",
    codigos: {
      exige_tipos: {
        tipo: "multiple",
        nombre: "Documentos que salen con oficio conductor",
        opciones: [
          { valor: "IVC", etiqueta: "IVC" },
          { valor: "INFORME_TECNICO", etiqueta: "Informe Técnico" },
          { valor: "INFORME_RECHAZO", etiqueta: "Informe de Ensayo de Rechazo" },
          { valor: "INFORME_ENSAYO", etiqueta: "Informe de Ensayo" },
          { valor: "CERTIFICADO_RESISTENCIA_BALISTICA", etiqueta: "Certificado de Resistencia Balística" },
        ],
        porDefecto: "IVC,INFORME_TECNICO,INFORME_RECHAZO",
      },
      exige_departamentos: {
        tipo: "multiple",
        nombre: "Departamentos donde rige",
        opciones: [
          { valor: "DSA", etiqueta: "Armamento y Munición (DSA)" },
          { valor: "DQO", etiqueta: "Químico (DQO)" },
          { valor: "BPCH", etiqueta: "Banco de Pruebas (BPCH)" },
        ],
        porDefecto: "DSA",
      },
    },
  },
  // --- Comercial, cobro y OT (frente r4d) ---
  {
    categoria: "aceptacion_oc",
    titulo: "Aceptación por orden de compra · discrepancias",
    donde: "Registrar aceptación de la cotización con O/C: compara el monto de la O/C con el total cotizado (EP-00 4.2).",
    porConfirmar: "Margen que el DCO acepta sin registrar discrepancia (EP-00 4.2; no consta en DCO-PG01-P01).",
    codigos: {
      tolerancia: { tipo: "entero", nombre: "Diferencia que no se considera discrepancia", min: 0, max: 100000000, unidad: "CLP", ayuda: "0 = cualquier diferencia exige registrar la discrepancia o anular la orden del cliente.", porDefecto: "0" },
    },
  },
  {
    categoria: "cotizacion_lrb",
    titulo: "Cotización del LRB · unidades de reposición",
    donde: "Nueva cotización del LRB: el lote cotizado suma estas unidades de reposición (EP-05 0.2).",
    porConfirmar: "Regla de +4 unidades de reposición del LRB (EP-05 0.2, LRB R02).",
    codigos: {
      reposicion: { tipo: "entero", nombre: "Unidades de reposición que se suman al lote", min: 0, max: 50, unidad: "unidades", porDefecto: "4" },
    },
  },
  {
    categoria: "ot_institucional",
    titulo: "OT institucional sin cobro",
    donde: "Registrar OT con origen «Institucional sin cobro» (EP-01/02 0.5).",
    porConfirmar: "Quién abre la OT institucional y con qué documento (EP-01 §10 P17).",
    codigos: {
      exige_oficio: { tipo: "sino", nombre: "Exigir el Nº y la fecha del oficio", opciones: SI_NO, porDefecto: "si" },
    },
  },
  {
    categoria: "tasa_informe",
    titulo: "Informe mensual de la tasa 1,5 %",
    donde: "Internaciones › Tasa 1,5 % mensual › «Emitir informe mensual → difusión» (EP-06 6.23).",
    porConfirmar: "Destinatarios de la difusión del informe mensual (EP-06 6.23).",
    codigos: {
      difusion: { tipo: "multiple", nombre: "Destinatarios de la difusión", opciones: DIFUSION_TASA, porDefecto: "DIRECCION,SUBDIRECCION,BPCH,CONTRALORIA,DFZ" },
    },
  },
  // --- Muestreo y veredicto del lote (frente r2b, T13 y T11) ---
  {
    categoria: "muestreo_plan",
    titulo: "Muestreo · plan NCh 44 con que se abre cada lote",
    donde:
      "OT › Muestreo › «Plan de muestreo del lote»: nivel de inspección y AQL por clase con que se propone el plan. Quien muestrea los cambia en cada lote; los planes ya registrados no cambian.",
    porConfirmar: "Nivel de inspección y AQL por laboratorio y por clase de defecto (EP-05 §10 P6 y P15; EP-03 §0.4 y §3.7).",
    codigos: {
      nivel: {
        tipo: "opcion",
        nombre: "Nivel de inspección",
        opciones: NIVELES.map((n) => ({ valor: n, etiqueta: ETIQUETA_NIVEL[n] })),
        porDefecto: "II",
      },
      aql_critico: {
        tipo: "opcion",
        nombre: "AQL de los defectos críticos",
        opciones: [{ valor: "ninguno", etiqueta: "Sin AQL: un defecto crítico rechaza el lote" }, ...OPCIONES_AQL],
        porDefecto: "ninguno",
      },
      aql_mayor: {
        tipo: "opcion",
        nombre: "AQL de los defectos mayores",
        opciones: [{ valor: "ninguno", etiqueta: "Sin AQL" }, ...OPCIONES_AQL],
        porDefecto: "2.5",
      },
      aql_menor: {
        tipo: "opcion",
        nombre: "AQL de los defectos menores",
        opciones: [{ valor: "ninguno", etiqueta: "Sin AQL" }, ...OPCIONES_AQL],
        porDefecto: "4",
      },
    },
  },
  {
    categoria: "veredicto_lote",
    titulo: "Veredicto del lote por clase de defecto",
    donde:
      "OT › Muestreo › «Conclusión del lote»: cómo cuentan las no conformidades de una clase que no tiene Ac/Re en el plan. Con Ac/Re rige el plan (acepta con defectuosas ≤ Ac, rechaza con ≥ Re).",
    porConfirmar: "Regla del lote y quién clasifica mayor/menor (EP-05 §10 P15 y P19; carta LEM-01 y SVM-02).",
    codigos: {
      regla_sin_plan: {
        tipo: "opcion",
        nombre: "Clase sin Ac/Re en el plan",
        opciones: [
          { valor: "cualquier_nc", etiqueta: "Una unidad no conforme de cualquier clase rechaza el lote" },
          { valor: "critica_o_mayor", etiqueta: "Rechaza una no conformidad crítica o mayor; las menores se informan" },
        ],
        porDefecto: "cualquier_nc",
      },
    },
  },
  // --- Formularios especializados, preparación y trabajo DSA (frente r2a) ---
  {
    categoria: "captura_variante_metodo",
    titulo: "Captura · formulario especializado por método",
    donde:
      "Captura y revisión por OT: el ensayo de este método se registra en su formulario (disparos del LRB, HCP del SVM, AQL, microbiología, sensorial) y su veredicto pasa al resultado. Sin fila, captura estándar.",
    porConfirmar: "Microbiología y sensorial quedan inactivas hasta que el IDIC decida si quiere las etapas o solo el resultado (EP-02 P1).",
    patron: { tipo: "variante", nombre: "Formulario de captura", opciones: OPCIONES_VARIANTE, alta: "metodo", porDefecto: "estandar" },
  },
  {
    categoria: "captura_variante_laboratorio",
    titulo: "Captura · formulario especializado por laboratorio",
    donde: "Para los métodos de un laboratorio que no tengan su propia fila arriba (manda el método).",
    patron: { tipo: "variante", nombre: "Formulario de captura del laboratorio", opciones: OPCIONES_VARIANTE, alta: "laboratorio", porDefecto: "estandar" },
  },
  {
    categoria: "lrb",
    titulo: "LRB · registro de disparos",
    donde: "Registro de disparos, CRB e Informe de Ensayo de Rechazo del Laboratorio de Resistencia Balística (EP-05 4.1, 5.3, 7.1).",
    porConfirmar: "Tabla oficial de amenazas (EP-05 P3), si manda V1, V2 o el promedio (P4), disparos con trauma (P5).",
    codigos: {
      amenazas: {
        tipo: "tabla",
        nombre: "Tabla de amenazas por norma y nivel",
        ayuda: "Valores de los informes reales a la espera de la tabla oficial. La «clave» identifica la fila en los registros: no la cambie si ya se usó.",
        maxFilas: 60,
        columnas: [
          { clave: "clave", etiqueta: "Clave", tipo: "texto", obligatoria: true, largo: 40 },
          { clave: "norma", etiqueta: "Norma", tipo: "texto", obligatoria: true, largo: 40 },
          { clave: "nivel", etiqueta: "Nivel", tipo: "texto", obligatoria: true, largo: 10 },
          { clave: "elemento", etiqueta: "Elemento", tipo: "opcion", obligatoria: true, opciones: [{ valor: "chaleco", etiqueta: "Chaleco" }, { valor: "casco", etiqueta: "Casco" }, { valor: "probeta", etiqueta: "Probeta" }] },
          { clave: "municion", etiqueta: "Munición", tipo: "texto", obligatoria: true, largo: 60 },
          { clave: "masa_g", etiqueta: "Masa (g)", tipo: "numero", min: 0, max: 100 },
          { clave: "v_min", etiqueta: "V mín. (m/s)", tipo: "numero", obligatoria: true, min: 0, max: 3000 },
          { clave: "v_max", etiqueta: "V máx. (m/s)", tipo: "numero", obligatoria: true, min: 0, max: 3000 },
          { clave: "disparos", etiqueta: "Disparos", tipo: "entero", obligatoria: true, min: 1, max: 20 },
          { clave: "trauma_max", etiqueta: "Trauma máx. (mm)", tipo: "numero", min: 0, max: 200 },
          { clave: "disparos_trauma", etiqueta: "Trauma en disparos 1 a", tipo: "entero", min: 0, max: 20 },
          { clave: "testigo", etiqueta: "Testigo", tipo: "sino" },
          { clave: "criterio", etiqueta: "Criterio", tipo: "texto", largo: 160 },
        ],
      },
      velocidad_manda: {
        tipo: "opcion",
        nombre: "Velocidad que se compara con la ventana",
        opciones: [
          { valor: "v1", etiqueta: "V1" },
          { valor: "v2", etiqueta: "V2" },
          { valor: "promedio", etiqueta: "Promedio de V1 y V2" },
        ],
        porDefecto: "v1",
      },
      plazo_apelacion: { tipo: "entero", nombre: "Plazo de apelación del Informe de Rechazo", min: 1, max: 60, unidad: "días hábiles", porDefecto: "5" },
    },
  },
  {
    categoria: "inspeccion_aql",
    titulo: "Inspección por atributos · nivel y AQL (NCh 44)",
    donde:
      "Inspección por atributos del IVC (EP-03 3.7) y regla del lote de la HCP del SVM por clase de defecto (EP-05 5.3). La tabla de la norma (letras, n, Ac/Re) está en el sistema.",
    porConfirmar: "Nivel y AQL que aplica el IDIC (EP-03 P5) y AQL por clase A/B/C del SVM (EP-05 P15).",
    codigos: {
      nivel: { tipo: "opcion", nombre: "Nivel de inspección", opciones: NIVELES_FORM.map((n) => ({ valor: n, etiqueta: n })), porDefecto: "II" },
      aql_inspeccion: { tipo: "opcion", nombre: "AQL por defecto de una inspección del IVC", opciones: AQLS_FORM.map((a) => ({ valor: a, etiqueta: a })), porDefecto: "2,5" },
      aql_clase_a: { tipo: "opcion", nombre: "AQL clase A (crítico)", opciones: [{ valor: "0", etiqueta: "Una N/C rechaza (Ac 0 / Re 1)" }, ...AQLS_FORM.map((a) => ({ valor: a, etiqueta: a }))], porDefecto: "0" },
      aql_clase_b: { tipo: "opcion", nombre: "AQL clase B (mayor)", opciones: [{ valor: "0", etiqueta: "Una N/C rechaza (Ac 0 / Re 1)" }, ...AQLS_FORM.map((a) => ({ valor: a, etiqueta: a }))], porDefecto: "2,5" },
      aql_clase_c: { tipo: "opcion", nombre: "AQL clase C (menor)", opciones: [{ valor: "0", etiqueta: "Una N/C rechaza (Ac 0 / Re 1)" }, ...AQLS_FORM.map((a) => ({ valor: a, etiqueta: a }))], porDefecto: "6,5" },
    },
  },
  {
    categoria: "hcp_plantilla",
    titulo: "SVM · Hoja de Control de Pruebas por tipo de vehículo",
    donde:
      "HCP por vehículo (EP-05 4.6): ítems agrupados con su clase A/B/C; «Método» lleva el veredicto de esos ítems al ensayo del catálogo; Mín/Máx hacen cuantitativo un ítem (giro, frenado, pendientes).",
    porConfirmar: "HCP de los otros tipos de vehículo (EP-05 P16): se recibió solo la del VLCB.",
    patron: {
      tipo: "tabla",
      nombre: "Ítems de la HCP",
      alta: "plantilla",
      maxFilas: 600,
      columnas: [
        { clave: "item", etiqueta: "Ítem", tipo: "texto", obligatoria: true, largo: 12 },
        { clave: "grupo", etiqueta: "Grupo", tipo: "texto", obligatoria: true, largo: 80 },
        { clave: "subgrupo", etiqueta: "Subgrupo", tipo: "texto", largo: 80 },
        { clave: "requisito", etiqueta: "Requisito", tipo: "texto", obligatoria: true, largo: 700 },
        { clave: "cantidad", etiqueta: "Cantidad", tipo: "texto", largo: 10 },
        { clave: "clase", etiqueta: "Clase", tipo: "opcion", obligatoria: true, opciones: [{ valor: "A", etiqueta: "A" }, { valor: "B", etiqueta: "B" }, { valor: "C", etiqueta: "C" }] },
        { clave: "metodo", etiqueta: "Método", tipo: "texto", largo: 30 },
        { clave: "min", etiqueta: "Mín.", tipo: "numero" },
        { clave: "max", etiqueta: "Máx.", tipo: "numero" },
        { clave: "unidad", etiqueta: "Unidad", tipo: "texto", largo: 12 },
      ],
    },
  },
  {
    categoria: "preparacion_campo",
    titulo: "Preparación y acondicionamiento de muestras · campos por laboratorio",
    donde:
      "OT › Preparación: lo que registra cada laboratorio al preparar la muestra (EP-01/02/03 3.1, EP-05 3.3). «Bloquea»: una casilla sin marcar, una fecha vencida o un equipo no apto detienen la captura de esa muestra.",
    patron: { tipo: "campo_prep", nombre: "Campo de preparación", alta: "campo" },
  },
  {
    categoria: "preparacion_obligatoria",
    titulo: "Preparación de muestras · obligatoria antes de capturar",
    donde: "Captura y revisión por OT: el laboratorio marcado no captura una muestra sin registrar antes su preparación.",
    patron: { tipo: "obligatorio", nombre: "Preparación obligatoria antes de capturar", opciones: SI_NO, alta: "laboratorio", porDefecto: "no" },
  },
  {
    categoria: "preparacion_trabajo",
    titulo: "DSA · aprobación de la documentación del trabajo",
    donde:
      "OT › Preparación (EP-05 2.2–2.3): qué laboratorios aprueban la documentación antes de ejecutar. El LEM la aprueba solo en terreno (Jefe de Sección valida, Jefe DSA aprueba).",
    codigos: {
      exige_aprobacion: {
        tipo: "multiple",
        nombre: "Laboratorios cuya documentación se aprueba antes de ejecutar",
        opciones: [
          { valor: "LRB", etiqueta: "LRB · Planilla de trabajo" },
          { valor: "LAM", etiqueta: "LAM · Plan de trabajo" },
          { valor: "SEO", etiqueta: "SEO · Plan de inspección" },
          { valor: "SVM", etiqueta: "SVM · Paquete técnico" },
        ],
        porDefecto: "LRB,SVM",
      },
      bloquea_captura: { tipo: "sino", nombre: "La captura espera la aprobación", opciones: SI_NO, porDefecto: "si" },
    },
  },
  {
    categoria: "micro",
    titulo: "LMB · microbiología",
    donde: "Formulario «Siembra, incubación y lectura» (EP-02 3.4): lecturas programadas desde el inicio de la incubación, con aviso de pendiente y vencida.",
    porConfirmar: "Temperaturas, tiempos y medios por ensayo (EP-02 P3).",
    codigos: {
      lecturas_h: {
        tipo: "multiple",
        nombre: "Lecturas programadas (horas desde el inicio de la incubación)",
        opciones: ["12", "24", "48", "72", "96", "120", "168"].map((h) => ({ valor: h, etiqueta: `${h} h` })),
        porDefecto: "24,48,72",
      },
    },
  },
  {
    categoria: "rsa_criterios",
    titulo: "LMB · planes n, c, m, M del RSA",
    donde:
      "Formulario de microbiología: plan de 2 o 3 clases por método (código del catálogo) y, si se indica, por producto. Sin plan, rige el Máx del ensayo («según RSA vigente»).",
    porConfirmar: "n, c, m, M por producto y artículo del RSA (EP-02 P2).",
    codigos: {
      tabla: {
        tipo: "tabla",
        nombre: "Planes por ensayo y producto",
        maxFilas: 200,
        columnas: [
          { clave: "metodo", etiqueta: "Método", tipo: "texto", obligatoria: true, largo: 30 },
          { clave: "producto", etiqueta: "Producto", tipo: "texto", largo: 120 },
          { clave: "n", etiqueta: "n", tipo: "entero", obligatoria: true, min: 1, max: 60 },
          { clave: "c", etiqueta: "c", tipo: "entero", obligatoria: true, min: 0, max: 60 },
          { clave: "m", etiqueta: "m", tipo: "numero", obligatoria: true, min: 0 },
          { clave: "M", etiqueta: "M", tipo: "numero", min: 0 },
          { clave: "articulo", etiqueta: "Artículo RSA", tipo: "texto", largo: 60 },
        ],
      },
    },
  },
  {
    categoria: "sensorial",
    titulo: "LES · panel sensorial",
    donde: "Formulario «Panel sensorial» (EP-02 3.6–3.8): jueces mínimos, nivel α del estadístico y rangos por atributo.",
    porConfirmar: "Nº de jueces, α y rangos vigentes por atributo (EP-02 P4: el Listado LES y el LIMS antiguo difieren).",
    codigos: {
      alfa: { tipo: "opcion", nombre: "Nivel de significancia α", opciones: [{ valor: "0,05", etiqueta: "0,05" }, { valor: "0,01", etiqueta: "0,01" }, { valor: "0,001", etiqueta: "0,001" }], porDefecto: "0,05" },
      jueces_min: { tipo: "entero", nombre: "Jueces válidos mínimos", min: 1, max: 60, unidad: "jueces", porDefecto: "6" },
      rangos: {
        tipo: "tabla",
        nombre: "Rangos por atributo",
        maxFilas: 60,
        columnas: [
          { clave: "prueba", etiqueta: "Prueba", tipo: "texto", obligatoria: true, largo: 40 },
          { clave: "atributo", etiqueta: "Atributo", tipo: "texto", obligatoria: true, largo: 40 },
          { clave: "min", etiqueta: "Mín.", tipo: "numero", obligatoria: true, min: 0, max: 10 },
          { clave: "max", etiqueta: "Máx.", tipo: "numero", obligatoria: true, min: 0, max: 10 },
        ],
      },
    },
  },
  // --- BPCH · prototipos (frente r4b, EP-08 8.11) ---
  {
    categoria: "bpch_prototipo",
    titulo: "BPCH · Prototipos · parametrización del elemento",
    donde: "BPCH › Prototipos: si la OT de evaluación exige el panel del elemento validado por la jefatura (paso 4).",
    porConfirmar: "Quién es el «Analista Experto BPCH» y la «Sección Gestión y Control» y si el elemento entra al catálogo antes del dictamen (EP-08 P4).",
    codigos: {
      exige_parametrizacion: {
        tipo: "sino",
        nombre: "La OT de evaluación exige la parametrización validada",
        opciones: SI_NO,
        ayuda: "Con «sí», no se genera la OT del prototipo sin el panel (Mín/Nom/Máx, fórmula) validado.",
        porDefecto: "no",
      },
    },
  },
  // --- Delegación Nº 11 · certificación de armas (frente r4b, EP-11) ---
  {
    categoria: "d11",
    titulo: "Delegación Nº 11 · camino del arma, acuñación y vigencia del certificado",
    donde:
      "BPCH · SAEC › Certificación de armas: ensayos que carga cada camino al clasificar el arma, si el arma con cuño CIP se acuña y vigencia del certificado por arma. Rige para lo que se clasifique o emita desde el cambio.",
    porConfirmar: "Ensayos de cada camino y si un arma con cuño CIP se dispara y se acuña (EP-11 P1, P4); vigencia al vencer (P11).",
    codigos: {
      metodos_registro: { tipo: "multiple", nombre: "Ensayos al registrar el arma (clasificación)", opciones: METODOS_D11, porDefecto: "1292" },
      metodos_cip: { tipo: "multiple", nombre: "Ensayos del camino «Con cuño CIP · reconocimiento»", opciones: METODOS_D11, porDefecto: "1291,3500" },
      metodos_completa: { tipo: "multiple", nombre: "Ensayos del camino «Sin cuño CIP · prueba completa»", opciones: METODOS_D11, porDefecto: "1213,1202,1203,3500" },
      metodos_accesorio: { tipo: "multiple", nombre: "Ensayos de un accesorio (directo al certificado)", opciones: METODOS_D11, porDefecto: "2322" },
      metodos_maquina: { tipo: "multiple", nombre: "Ensayos de una máquina recargadora (directo al certificado)", opciones: METODOS_D11, porDefecto: "3706" },
      metodos_fuego: {
        tipo: "multiple",
        nombre: "Ensayos con fuego real (IT04) que gastan munición de prueba",
        opciones: METODOS_D11,
        ayuda: "Al guardar estos ensayos el armero indica el lote y los cartuchos usados; se descuentan del inventario de munición de prueba (EP-11 11.17).",
        porDefecto: "1203",
      },
      acunacion_cip: {
        tipo: "sino",
        nombre: "Un arma con cuño CIP también se acuña con el cuño BPCH",
        opciones: SI_NO,
        ayuda: "El Bizagi de la D11 no acuña las armas con cuño CIP; el LIMS actual sí. Por defecto se sigue el Bizagi.",
        porDefecto: "no",
      },
      vigencia_anios: { tipo: "entero", nombre: "Vigencia del certificado por arma", min: 1, max: 10, unidad: "años", porDefecto: "4" },
    },
  },
];

export const CATEGORIAS_CONFIGURABLES = GRUPOS_CONFIG.map((g) => g.categoria);

export const grupoDe = (categoria: string) => GRUPOS_CONFIG.find((g) => g.categoria === categoria) ?? null;

/** Definición del valor de (categoría, código), o null si no es un parámetro configurable. */
export function defConfigurable(categoria: string, codigo: string): DefValor | null {
  const g = grupoDe(categoria);
  if (!g) return null;
  if (g.codigos) return g.codigos[codigo] ?? null;
  if (g.patron) return codigoValido(g.patron.alta, codigo) ? g.patron : null;
  return null;
}

/**
 * Completa las opciones que se leen de la base (`opcionesDe`). Sin lista (o sin
 * opciones dinámicas) devuelve la definición tal cual.
 */
export function conOpciones(def: DefValor, laboratorios: { codigo: string; nombre: string }[]): DefValor {
  if (def.opcionesDe !== "laboratorios") return def;
  return { ...def, opciones: laboratorios.map((l) => ({ valor: l.codigo.toUpperCase(), etiqueta: `${l.codigo} · ${l.nombre}` })) };
}

/** Código válido de un parámetro por patrón: «LME» o «LME.lote». */
export function codigoValido(alta: AltaPatron, codigo: string): boolean {
  if (alta === "laboratorio") return /^[A-Z][A-Z0-9]{1,11}$/.test(codigo);
  if (alta === "metodo") return /^[0-9A-Z][0-9A-Z._-]{0,29}$/.test(codigo);
  if (alta === "plantilla") return /^[A-Z][A-Z0-9_]{1,19}$/.test(codigo);
  return /^[A-Z][A-Z0-9]{1,11}\.[a-z][a-z0-9_]{0,39}$/.test(codigo);
}

/** Laboratorio de un código por patrón («LME.lote» → «LME»). */
export const laboratorioDe = (codigo: string) => codigo.split(".")[0];

/* ------------------------------------------------------------- lectura --- */

export interface Fila {
  codigo: string;
  valor: string | null;
  activo: boolean;
}

export interface DefCampo {
  tipo: TipoCampo;
  obligatorio: boolean;
  opciones: Opcion[];
  ayuda: string;
  activo: boolean;
}

const siNoDe = (v: string | null | undefined, def: boolean): boolean => {
  const t = String(v ?? "").trim().toLowerCase();
  if (["si", "sí", "true", "1", "s"].includes(t)) return true;
  if (["no", "false", "0", "n"].includes(t)) return false;
  return def;
};

function campoDe(valor: string | null, activo: boolean): DefCampo {
  let d: any = {};
  try {
    d = valor ? JSON.parse(valor) : {};
  } catch {
    d = {};
  }
  if (!d || typeof d !== "object" || Array.isArray(d)) d = {};
  return {
    tipo: (TIPOS_CAMPO as readonly string[]).includes(d.tipo) ? d.tipo : "texto",
    obligatorio: d.obligatorio === true,
    opciones: Array.isArray(d.opciones)
      ? d.opciones
          .map((o: any) =>
            typeof o === "string" ? { valor: o.trim(), etiqueta: o.trim() } : { valor: String(o?.valor ?? "").trim(), etiqueta: String(o?.etiqueta ?? o?.valor ?? "").trim() },
          )
          .filter((o: Opcion) => o.valor)
      : [],
    ayuda: typeof d.ayuda === "string" ? d.ayuda : "",
    activo,
  };
}

/** Valor tipado para el formulario de la pantalla (lo que rige hoy). */
export function valorFormulario(def: DefValor, f: Fila): unknown {
  const v = f.valor;
  switch (def.tipo) {
    case "entero": {
      const n = Number(String(v ?? "").trim());
      return Number.isSafeInteger(n) ? n : null;
    }
    case "porcentaje": {
      const n = Number(String(v ?? "").replace(",", "."));
      return Number.isFinite(n) ? n : null;
    }
    case "sino":
      return siNoDe(v, siNoDe(def.porDefecto, true));
    case "opcion": {
      const t = String(v ?? "").trim().toLowerCase();
      return def.opciones?.some((o) => o.valor === t) ? t : def.porDefecto ?? null;
    }
    case "multiple": {
      const marcados = String(v ?? "").toUpperCase().replace(/\s/g, "").split(",").filter(Boolean);
      return (def.opciones ?? []).filter((o) => marcados.includes(o.valor)).map((o) => o.valor);
    }
    case "formato":
      return String(v ?? "");
    case "obligatorio":
      return f.activo;
    case "campo":
      return campoDe(v, f.activo);
    case "variante":
      return { variante: esVariante(String(v ?? "").trim()) ? String(v).trim() : def.porDefecto ?? "estandar", activo: f.activo };
    case "tabla":
      return filasTabla(v);
    case "campo_prep": {
      let d: any = {};
      try {
        d = v ? JSON.parse(v) : {};
      } catch {
        d = {};
      }
      if (!d || typeof d !== "object" || Array.isArray(d)) d = {};
      return {
        tipo: typeof d.tipo === "string" ? d.tipo : "texto",
        obligatorio: d.obligatorio === true,
        bloquea: d.bloquea === true,
        unidad: typeof d.unidad === "string" ? d.unidad : "",
        opciones: Array.isArray(d.opciones) ? d.opciones : [],
        ayuda: typeof d.ayuda === "string" ? d.ayuda : "",
        activo: f.activo,
      };
    }
  }
}

/** Filas de un parámetro de tipo tabla (JSON); [] si no se entiende. */
export function filasTabla(v: string | null | undefined): Record<string, unknown>[] {
  try {
    const f = JSON.parse(v ?? "[]");
    return Array.isArray(f) ? f.filter((x) => x && typeof x === "object" && !Array.isArray(x)) : [];
  } catch {
    return [];
  }
}

/**
 * Valida y normaliza las filas de una tabla según sus columnas: texto (largo),
 * número con coma decimal, entero, opción y sí/no. Reglas de cada tabla
 * (claves únicas, V máx. ≥ V mín., c < n, M ≥ m…) en `reglasTabla`.
 */
export function normalizarTabla(def: DefValor, entrada: unknown, categoria = ""): { errores: string[]; filas?: Record<string, unknown>[] } {
  if (!Array.isArray(entrada)) return { errores: ["Las filas de la tabla van como una lista."] };
  const cols = def.columnas ?? [];
  const max = def.maxFilas ?? 200;
  if (entrada.length > max) return { errores: [`La tabla admite como máximo ${max} filas.`] };
  const e: string[] = [];
  const filas = entrada.map((x, i) => {
    const o = (x && typeof x === "object" && !Array.isArray(x) ? x : {}) as Record<string, unknown>;
    const fila: Record<string, unknown> = {};
    for (const c of cols) {
      const v = o[c.clave];
      const donde = `Fila ${i + 1} · ${c.etiqueta}`;
      const vacio = v === undefined || v === null || (typeof v === "string" && v.trim() === "");
      if (vacio) {
        if (c.obligatoria) e.push(`${donde}: es obligatorio.`);
        fila[c.clave] = c.tipo === "sino" ? false : null;
        continue;
      }
      switch (c.tipo) {
        case "texto": {
          const t = String(v).trim();
          if (t.length > (c.largo ?? 200)) e.push(`${donde}: máximo ${c.largo ?? 200} caracteres.`);
          fila[c.clave] = t;
          break;
        }
        case "numero":
        case "entero": {
          const t = typeof v === "number" ? String(v) : String(v).trim().replace(",", ".");
          const n = Number(t);
          if (!/^-?\d+(\.\d+)?$/.test(t) || !Number.isFinite(n)) e.push(`${donde}: escriba un número${c.tipo === "entero" ? " entero" : " (coma decimal)"}.`);
          else if (c.tipo === "entero" && !Number.isInteger(n)) e.push(`${donde}: escriba un número entero.`);
          else if ((c.min != null && n < c.min) || (c.max != null && n > c.max)) e.push(`${donde}: debe estar entre ${c.min ?? "—"} y ${c.max ?? "—"}.`);
          fila[c.clave] = n;
          break;
        }
        case "opcion": {
          const t = String(v).trim();
          if (!c.opciones?.some((op) => op.valor === t)) e.push(`${donde}: elija una de las opciones (${(c.opciones ?? []).map((op) => op.etiqueta).join(", ")}).`);
          fila[c.clave] = t;
          break;
        }
        case "sino":
          fila[c.clave] = v === true || v === "si" || v === "sí" || v === "Sí";
          break;
      }
    }
    return fila;
  });
  if (e.length) return { errores: e.slice(0, 20).concat(e.length > 20 ? [`… y ${e.length - 20} errores más.`] : []) };
  const reglas = reglasTabla(categoria, filas);
  if (reglas.length) return { errores: reglas };
  return { errores: [], filas };
}

/** Reglas propias de cada tabla configurable. */
function reglasTabla(categoria: string, filas: Record<string, unknown>[]): string[] {
  const e: string[] = [];
  const repetidas = (clave: string) => {
    const vistos = new Set<string>();
    for (const f of filas) {
      const k = String(f[clave] ?? "").toUpperCase();
      if (vistos.has(k)) e.push(`«${f[clave]}» está repetido en la columna ${clave}.`);
      vistos.add(k);
    }
  };
  if (categoria === "lrb") {
    if (!filas.length) e.push("La tabla de amenazas necesita al menos una fila.");
    repetidas("clave");
    filas.forEach((f, i) => {
      if (Number(f.v_max) < Number(f.v_min)) e.push(`Fila ${i + 1}: la velocidad máxima es menor que la mínima.`);
    });
  }
  if (categoria === "hcp_plantilla") {
    if (!filas.length) e.push("La HCP necesita al menos un ítem.");
    repetidas("item");
    filas.forEach((f, i) => {
      if (f.min != null && f.max != null && Number(f.max) < Number(f.min)) e.push(`Fila ${i + 1}: Máx. menor que Mín.`);
    });
  }
  if (categoria === "rsa_criterios")
    filas.forEach((f, i) => {
      if (Number(f.c) >= Number(f.n)) e.push(`Fila ${i + 1}: c debe ser menor que n.`);
      if (f.M != null && Number(f.M) < Number(f.m)) e.push(`Fila ${i + 1}: M debe ser mayor o igual que m.`);
    });
  if (categoria === "sensorial")
    filas.forEach((f, i) => {
      if (Number(f.max) < Number(f.min)) e.push(`Fila ${i + 1}: Máx. menor que Mín.`);
    });
  return e;
}

/* ---------------------------------------------------------- validación --- */

export interface ValorNormalizado {
  /** Nuevo `valor` de la fila (undefined = no cambia). */
  valor?: string | null;
  /** Nuevo `activo` de la fila. */
  activo: boolean;
  /** Representación para el historial. */
  historial: string;
}

const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const esSiNo = (v: unknown): boolean | null => (typeof v === "boolean" ? v : v === "si" || v === "sí" ? true : v === "no" ? false : null);

/** Valida un formato de número: solo {AAAA} y {N} (este una vez), letras, dígitos y - _ / . espacio. */
export function erroresFormato(formato: string): string[] {
  const e: string[] = [];
  if (!formato) return ["Escriba el formato del número (debe contener {N})."];
  if (formato.length > 40) e.push("El formato admite como máximo 40 caracteres.");
  if ((formato.match(/\{N\}/g) ?? []).length !== 1) e.push("El formato debe contener {N} (el correlativo) exactamente una vez.");
  const resto = formato.replace(/\{AAAA\}|\{N\}/g, "");
  if (/[{}]/.test(resto)) e.push("Solo se admiten las marcas {AAAA} y {N}.");
  else if (!/^[A-Za-z0-9\-_/. ]*$/.test(resto)) e.push("Use solo letras, dígitos, guion, guion bajo, barra, punto o espacio además de {AAAA} y {N}.");
  return e;
}

/** Ejemplo de número con un formato (para la pantalla). */
export function ejemploFormato(formato: string, digitos: number, anio: number, n: number): string {
  return formatearNumeroCotizacion(configNumeracion({ formato, digitos: String(digitos) }), anio, n);
}

/** Normaliza y valida la definición de un campo de recepción. */
export function normalizarCampo(codigo: string, etiqueta: string, entrada: unknown): { errores: string[]; def?: Omit<DefCampo, "activo">; activo: boolean } {
  const e: string[] = [];
  const d = (entrada && typeof entrada === "object" && !Array.isArray(entrada) ? entrada : {}) as Record<string, unknown>;
  const tipo = texto(d.tipo) as TipoCampo;
  if (!(TIPOS_CAMPO as readonly string[]).includes(tipo)) e.push(`Elija el tipo del campo (${TIPOS_CAMPO.join(", ")}).`);
  const obligatorio = esSiNo(d.obligatorio ?? false);
  if (obligatorio === null) e.push("«Obligatorio» debe ser sí o no.");
  const activo = esSiNo(d.activo ?? true);
  if (activo === null) e.push("«Activo» debe ser sí o no.");
  const ayuda = texto(d.ayuda);
  if (ayuda.length > 300) e.push("La ayuda admite como máximo 300 caracteres.");
  let opciones: Opcion[] = [];
  if (tipo === "lista") {
    if (!Array.isArray(d.opciones)) e.push("Indique las opciones de la lista.");
    else {
      opciones = d.opciones.map((o: any) => ({ valor: texto(o?.valor), etiqueta: texto(o?.etiqueta) || texto(o?.valor) }));
      if (!opciones.length) e.push("Una lista necesita al menos una opción.");
      if (opciones.length > 30) e.push("Como máximo 30 opciones.");
      if (opciones.some((o) => !o.valor)) e.push("Cada opción necesita su valor.");
      if (opciones.some((o) => o.valor.length > 60 || o.etiqueta.length > 120)) e.push("El valor de una opción admite 60 caracteres y su texto 120.");
      if (new Set(opciones.map((o) => o.valor)).size !== opciones.length) e.push("Hay opciones con el mismo valor.");
    }
  }
  const campo = codigo.split(".")[1] ?? "";
  if (campo === "clase_custodia" && (tipo !== "lista" || opciones.some((o) => !(CLASES_CUSTODIA as readonly string[]).includes(o.valor))))
    e.push(`El destino de la muestra (clase_custodia) es una lista cuyos valores solo pueden ser: ${CLASES_CUSTODIA.join(", ")}.`);
  if (e.length) return { errores: e, activo: activo ?? true };
  const def = { tipo, obligatorio: obligatorio!, opciones, ayuda };
  // La recepción debe entender lo que se guarda (mismo lector que usa al recibir).
  const json = jsonCampo(def);
  if (!leerCampo({ codigo, etiqueta, valor: json, activo: true }, laboratorioDe(codigo)))
    return { errores: ["La recepción no podría usar esta definición: revise el tipo y las opciones."], activo: activo! };
  return { errores: [], def, activo: activo! };
}

/** JSON con que se guarda un campo (sin claves vacías). */
export function jsonCampo(def: Omit<DefCampo, "activo">): string {
  const o: Record<string, unknown> = { tipo: def.tipo };
  if (def.obligatorio) o.obligatorio = true;
  if (def.tipo === "lista") o.opciones = def.opciones;
  if (def.ayuda) o.ayuda = def.ayuda;
  return JSON.stringify(o);
}

/**
 * Valida el nuevo valor según el tipo y devuelve cómo se guarda. Lista de
 * errores vacía = válido. `fila` es la fila actual (código, etiqueta).
 */
export function normalizarValor(
  def: DefValor,
  fila: { codigo: string; etiqueta: string },
  entrada: unknown,
  /** Categoría del parámetro (reglas propias de cada tabla). */
  categoria = "",
): { errores: string[]; valor?: ValorNormalizado } {
  switch (def.tipo) {
    case "entero": {
      const t = typeof entrada === "number" ? String(entrada) : texto(entrada);
      const n = Number(t);
      if (!/^-?\d+$/.test(t) || !Number.isSafeInteger(n)) return { errores: ["Escriba un número entero, sin decimales."] };
      if ((def.min != null && n < def.min) || (def.max != null && n > def.max))
        return { errores: [`El valor debe estar entre ${def.min ?? "—"} y ${def.max?.toLocaleString("es-CL") ?? "—"}${def.unidad ? ` ${def.unidad}` : ""}.`] };
      return { errores: [], valor: { valor: String(n), activo: true, historial: String(n) } };
    }
    case "porcentaje": {
      const n = leerPorcentaje(entrada);
      if (!Number.isFinite(n)) return { errores: ["Escriba el porcentaje como número, con coma decimal (p. ej. 12,5)."] };
      if (n < (def.min ?? 0) || n > (def.max ?? 100)) return { errores: [`El porcentaje debe estar entre ${def.min ?? 0} y ${def.max ?? 100}.`] };
      if (Math.abs(n * 10000 - Math.round(n * 10000)) > 1e-6) return { errores: ["Como máximo 4 decimales."] };
      const g = valorGuardado(n);
      return { errores: [], valor: { valor: g, activo: true, historial: g } };
    }
    case "sino": {
      const b = esSiNo(entrada);
      if (b === null) return { errores: ["Elija Sí o No."] };
      const g = b ? "si" : "no";
      return { errores: [], valor: { valor: g, activo: true, historial: g } };
    }
    case "opcion": {
      const t = texto(entrada);
      if (!def.opciones?.some((o) => o.valor === t)) return { errores: [`Elija una de las opciones: ${(def.opciones ?? []).map((o) => o.etiqueta).join(" · ")}.`] };
      return { errores: [], valor: { valor: t, activo: true, historial: t } };
    }
    case "multiple": {
      if (!Array.isArray(entrada) || entrada.some((x) => typeof x !== "string")) return { errores: ["Marque las opciones como una lista."] };
      const validas = new Set((def.opciones ?? []).map((o) => o.valor));
      const malas = entrada.filter((x) => !validas.has(x));
      if (malas.length) return { errores: [`Opciones desconocidas: ${malas.join(", ")}.`] };
      const g = (def.opciones ?? []).filter((o) => entrada.includes(o.valor)).map((o) => o.valor).join(",");
      return { errores: [], valor: { valor: g, activo: true, historial: g } };
    }
    case "formato": {
      const t = texto(entrada);
      const e = erroresFormato(t);
      if (e.length) return { errores: e };
      return { errores: [], valor: { valor: t, activo: true, historial: t } };
    }
    case "obligatorio": {
      const b = esSiNo(entrada);
      if (b === null) return { errores: ["Elija Sí o No."] };
      return { errores: [], valor: { activo: b, historial: b ? "si" : "no" } };
    }
    case "campo": {
      const r = normalizarCampo(fila.codigo, fila.etiqueta, entrada);
      if (r.errores.length || !r.def) return { errores: r.errores };
      const json = jsonCampo(r.def);
      return { errores: [], valor: { valor: json, activo: r.activo, historial: historialCampo(json, r.activo) } };
    }
    case "variante": {
      const d = (entrada && typeof entrada === "object" && !Array.isArray(entrada) ? entrada : { variante: entrada }) as Record<string, unknown>;
      const v = texto(d.variante);
      if (!esVariante(v)) return { errores: [`Elija el formulario: ${(def.opciones ?? []).map((o) => o.etiqueta).join(" · ")}.`] };
      const activo = esSiNo(d.activo ?? true);
      if (activo === null) return { errores: ["«Activo» es sí o no."] };
      return { errores: [], valor: { valor: v, activo, historial: historialVariante(v, activo) } };
    }
    case "tabla": {
      const r = normalizarTabla(def, entrada, categoria);
      if (r.errores.length || !r.filas) return { errores: r.errores };
      const json = JSON.stringify(r.filas);
      return { errores: [], valor: { valor: json, activo: true, historial: json } };
    }
    case "campo_prep": {
      const r = normalizarCampoPrep(entrada);
      if (r.errores.length || !r.def) return { errores: r.errores };
      const json = jsonCampoPrep(r.def);
      return { errores: [], valor: { valor: json, activo: r.activo, historial: historialCampo(json, r.activo) } };
    }
  }
}

/** Representación de un campo en el historial: su JSON con «activo». */
export function historialCampo(valor: string | null, activo: boolean): string {
  let d: Record<string, unknown> = {};
  try {
    d = valor ? JSON.parse(valor) : {};
  } catch {
    d = {};
  }
  return JSON.stringify({ ...d, activo });
}

/** Representación actual de una fila para el historial (para comparar y registrar «antes»). */
export function historialDeFila(def: DefValor, f: Fila): string {
  if (def.tipo === "obligatorio") return f.activo ? "si" : "no";
  if (def.tipo === "campo" || def.tipo === "campo_prep") return historialCampo(f.valor, f.activo);
  if (def.tipo === "variante") return historialVariante(f.valor ?? "", f.activo);
  return f.valor ?? "";
}

/** Representación de una variante en el historial: «lrb_disparos · activa». */
export function historialVariante(valor: string, activo: boolean): string {
  return `${valor} · ${activo ? "activa" : "inactiva"}`;
}

/** Errores del motivo (mismo criterio que los porcentajes de la tasa). */
export function erroresMotivo(motivo: unknown): string[] {
  const m = typeof motivo === "string" ? motivo.trim() : "";
  if (m.length < 5) return ["Indique el motivo del cambio (mínimo 5 caracteres)."];
  if (m.length > 500) return ["El motivo admite como máximo 500 caracteres."];
  return [];
}

/* ------------------------------------------------------- texto legible --- */

/** Texto legible de un valor guardado (tabla y historial). */
export function textoValor(def: DefValor, guardado: string | null | undefined): string {
  const v = guardado ?? "";
  switch (def.tipo) {
    case "entero":
      return v === "" ? "—" : `${Number(v).toLocaleString("es-CL")}${def.unidad && def.unidad !== "dígitos" ? ` ${def.unidad}` : ""}`;
    case "porcentaje": {
      const n = Number(v.replace(",", "."));
      return v === "" || !Number.isFinite(n) ? "—" : `${n.toLocaleString("es-CL", { maximumFractionDigits: 4 })} %`;
    }
    case "sino":
    case "obligatorio":
      return siNoDe(v, false) ? "Sí" : "No";
    case "opcion":
      return def.opciones?.find((o) => o.valor === v.trim())?.etiqueta ?? (v || "—");
    case "multiple": {
      const marcados = v.toUpperCase().replace(/\s/g, "").split(",").filter(Boolean);
      return marcados.length ? marcados.map((m) => def.opciones?.find((o) => o.valor === m)?.etiqueta ?? m).join(", ") : "Ninguno";
    }
    case "formato":
      return v || "—";
    case "variante": {
      const [valor, estado] = v.split(" · ");
      const etq = def.opciones?.find((o) => o.valor === valor.trim())?.etiqueta ?? (valor || "—");
      return estado ? `${etq}${estado.trim() === "inactiva" ? " (inactiva)" : ""}` : etq;
    }
    case "tabla": {
      const n = filasTabla(v).length;
      return n === 1 ? "1 fila" : `${n.toLocaleString("es-CL")} filas`;
    }
    case "campo_prep":
    case "campo": {
      let d: any = {};
      try {
        d = v ? JSON.parse(v) : {};
      } catch {
        return v || "—";
      }
      const tipo = d?.tipo === "equipo" ? "Equipo del laboratorio" : TIPO_CAMPO_ETIQUETA[d?.tipo as TipoCampo] ?? "Texto";
      const partes = [tipo + (d?.unidad ? ` (${d.unidad})` : "") + (d?.tipo === "lista" && Array.isArray(d?.opciones) ? `: ${d.opciones.map((o: any) => o?.etiqueta ?? o?.valor ?? o).join(" / ")}` : "")];
      partes.push(d?.obligatorio ? "obligatorio" : "opcional");
      if (d?.bloquea) partes.push("bloquea la captura");
      if (d?.activo === false) partes.push("inactivo");
      return partes.join(" · ");
    }
  }
}
