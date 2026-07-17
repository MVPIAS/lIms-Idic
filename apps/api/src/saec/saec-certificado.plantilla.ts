/**
 * RF-K07.1 · Cuerpo del certificado de evidencia / peritaje balístico (SAEC).
 *
 * ---------------------------------------------------------------------------
 * QUÉ REUTILIZA Y QUÉ APORTA
 * ---------------------------------------------------------------------------
 * NO duplica nada de `plantilla-render`: usa su motor (`renderizar`), su
 * escapado (`escapeHtml`), su envoltorio imprimible (`documentoCompleto`) y su
 * generador de PDF/A (`generarPdf`). Lo único que aporta este fichero es el
 * CUERPO propio del dominio SAEC —membrete IDIC, ficha de la evidencia/arma,
 * cadena de custodia, peritaje y hits IBIS— y los bloques de tabla que ese
 * cuerpo necesita, que son los que `plantilla-render` no puede conocer porque
 * viven en tablas fuera del schema de Prisma.
 *
 * Se maqueta con las MISMAS clases que `plantilla-defecto.ts`
 * (membrete/escudo/org/doc, table.meta, table.rep, .num, .ok, .no, .vacio,
 * .nota, .firmas/.firma). No es decorativo: el renderizador de PDF
 * (`pdf.renderer.ts`) reconoce exactamente ese subconjunto de clases y las
 * dibuja; cualquier otra clase degradaría a texto plano en el PDF.
 *
 * ---------------------------------------------------------------------------
 * MODELO DE CONFIANZA
 * ---------------------------------------------------------------------------
 * Igual que en los informes: el CUERPO (este fichero) es código, o sea
 * contenido de confianza. Los DATOS (descripción de la evidencia, motivos de
 * custodia, conclusiones del perito) los teclean usuarios y NO son de
 * confianza: todos salen por `escapeHtml`. Aquí no hay plantilla editable por
 * el usuario, así que el cuerpo se construye directamente en vez de leerlo de
 * `plantilla_informe`.
 */
import {
  escapeHtml,
  fmtFecha,
  fmtFechaHora,
  renderizar,
} from "../plantilla-render/template.engine";

/* ========================================================================== */
/* Tipos del contexto                                                          */
/* ========================================================================== */

/** Fila cruda de `evidencia` + los `to_jsonb` que trae la consulta. */
export type EvidenciaCert = Record<string, any>;

export type ContextoCertificadoSaec = {
  certificado: { codigo: string; codigoVerificacion: string; fecha: Date };
  evidencia: EvidenciaCert;
  caso: Record<string, any> | null;
  arma: Record<string, any> | null;
  peritajes: Array<Record<string, any>>;
  movimientos: Array<Record<string, any>>;
  hits: Array<Record<string, any>>;
  emisor: { nombre: string | null; unidad: string | null };
};

const GUION = "—";

/** Celda: escapa y sustituye el vacío por un guion (una celda en blanco es ambigua). */
function celda(v: unknown, clase = ""): string {
  const texto = v === null || v === undefined || String(v).trim() === "" ? GUION : escapeHtml(String(v));
  return `<td${clase ? ` class="${clase}"` : ""}>${texto}</td>`;
}

/** Fila etiqueta/valor de una `table.meta`. */
function metaFila(pares: Array<[string, unknown]>): string {
  return (
    "<tr>" +
    pares
      .map(([k, v]) => `<th>${escapeHtml(k)}</th>` + celda(v))
      .join("") +
    "</tr>"
  );
}

function tablaVacia(mensaje: string): string {
  return `<table class="rep"><tbody><tr><td class="vacio">${escapeHtml(mensaje)}</td></tr></tbody></table>`;
}

/* ========================================================================== */
/* Bloques generados                                                           */
/* ========================================================================== */

const ETIQUETA_EVENTO: Record<string, string> = {
  entrada: "Entrada",
  salida: "Salida",
  cambio_ubicacion: "Cambio de ubicación",
  prestamo: "Préstamo",
  devolucion: "Devolución",
  analisis: "Análisis",
  destruccion: "Destrucción",
};

/**
 * RF-K05 · cadena de custodia completa, en orden cronológico.
 *
 * Va ÍNTEGRA y sin paginar a propósito: es la parte del certificado que sostiene
 * la trazabilidad de la evidencia ante un tribunal. Un resumen ("últimos 5
 * movimientos") destruiría justamente su valor probatorio.
 *
 * `firma_hash` se imprime recortado: es el SHA-256 del acta de firma (el texto
 * original no se guarda nunca, ver `CrearMovimientoSchema.firmaTexto`). Sirve
 * para cotejar el acta en papel, y los primeros 16 caracteres bastan para eso
 * sin llenar la columna.
 */
export function tablaCadenaCustodia(movs: Array<Record<string, any>>): string {
  if (movs.length === 0) {
    return tablaVacia("Sin movimientos de custodia registrados para este elemento.");
  }
  const filas = movs
    .map((m) => {
      const sello = m.sello_numero
        ? `${m.sello_numero}${m.sello_integro === false ? " (VIOLADO)" : m.sello_integro === true ? " (íntegro)" : ""}`
        : "";
      // El sello violado es lo único que un perito necesita ver de un vistazo.
      const claseSello = m.sello_integro === false ? "no" : m.sello_integro === true ? "ok" : "";
      return (
        "<tr>" +
        celda(fmtFechaHora(m.fecha)) +
        celda(ETIQUETA_EVENTO[m.evento] ?? m.evento) +
        celda(m.desde_organismo ?? m.desde_usuario) +
        celda(m.hacia_organismo ?? m.hacia_usuario) +
        celda(m.ubicacion_destino ?? m.ubicacion_origen) +
        celda(m.motivo) +
        celda(sello, claseSello) +
        celda(m.firma_hash ? String(m.firma_hash).slice(0, 16) : "") +
        "</tr>"
      );
    })
    .join("");
  return (
    `<table class="rep"><thead><tr>` +
    `<th>Fecha y hora</th><th>Evento</th><th>Desde</th><th>Hacia</th>` +
    `<th>Ubicación</th><th>Motivo</th><th>Sello</th><th>Firma (SHA-256)</th>` +
    `</tr></thead><tbody>${filas}</tbody></table>`
  );
}

const ETIQUETA_RESULTADO: Record<string, string> = {
  concluyente: "Concluyente",
  no_concluyente: "No concluyente",
  sin_coincidencia: "Sin coincidencia",
  pendiente: "Pendiente",
};

/** RF-K03 · resultados del peritaje balístico (IBIS o manual). */
export function tablaPeritajes(peritajes: Array<Record<string, any>>): string {
  if (peritajes.length === 0) return tablaVacia("Sin resultados de peritaje registrados.");
  const filas = peritajes
    .map((p) => {
      const r = String(p.resultado ?? "").toLowerCase();
      // Verde solo lo concluyente; rojo lo que quedó abierto. `sin_coincidencia`
      // es un resultado válido y firme, no un fallo: se deja neutro.
      const clase = r === "concluyente" ? "ok" : r === "pendiente" || r === "no_concluyente" ? "no" : "";
      return (
        "<tr>" +
        celda(fmtFechaHora(p.fecha_peritaje)) +
        celda(p.origen === "ibis" ? "IBIS (automático)" : "Manual") +
        celda(ETIQUETA_RESULTADO[r] ?? p.resultado, clase) +
        celda(p.hit_count === null || p.hit_count === undefined ? "" : String(p.hit_count), "num") +
        celda(p.perito_nombre) +
        celda(p.conclusiones) +
        "</tr>"
      );
    })
    .join("");
  return (
    `<table class="rep"><thead><tr>` +
    `<th>Fecha</th><th>Origen</th><th>Resultado</th><th class="num">Hits</th>` +
    `<th>Perito</th><th>Conclusiones</th>` +
    `</tr></thead><tbody>${filas}</tbody></table>`
  );
}

/**
 * RF-K03 · coincidencias IBIS.
 *
 * `score` se imprime tal cual lo dio IBIS, sin redondear ni reinterpretar: es un
 * dato de un sistema externo que puede acabar discutido en juicio, y el LIMS no
 * es quién para maquillarlo.
 */
export function tablaHitsIbis(hits: Array<Record<string, any>>, codigoEvidencia: string): string {
  if (hits.length === 0) {
    return tablaVacia("Sin coincidencias IBIS asociadas a este elemento.");
  }
  const filas = hits
    .map((h) => {
      // El hit relaciona A con B; en el certificado interesa "contra quién".
      const esA = h.evidencia_a_codigo === codigoEvidencia;
      const contra = esA ? h.evidencia_b_codigo ?? h.uuid_evidencia_b : h.evidencia_a_codigo ?? h.uuid_evidencia_a;
      const estado = String(h.estado ?? "").toLowerCase();
      const clase = estado === "confirmado" ? "ok" : estado === "descartado" ? "no" : "";
      return (
        "<tr>" +
        celda(fmtFechaHora(h.fecha_hit)) +
        celda(contra) +
        celda(h.score === null || h.score === undefined ? "" : String(h.score), "num") +
        celda(h.estado, clase) +
        celda(h.uuid_ibis) +
        "</tr>"
      );
    })
    .join("");
  return (
    `<table class="rep"><thead><tr>` +
    `<th>Fecha</th><th>Coincide con</th><th class="num">Score</th>` +
    `<th>Estado</th><th>UUID IBIS</th>` +
    `</tr></thead><tbody>${filas}</tbody></table>`
  );
}

/* ========================================================================== */
/* Cuerpo                                                                      */
/* ========================================================================== */

const TIPOS_LEGIBLES: Record<string, string> = {
  arma: "Arma de fuego",
  vainilla: "Vainilla",
  proyectil: "Proyectil",
  explosivo: "Explosivo",
  otro: "Otro elemento",
};

/**
 * Plantilla del certificado. Los `{{...}}` los resuelve el motor de
 * `plantilla-render` contra el contexto aplanado de `datosPlantilla`, y los
 * bloques `{{tabla_*}}` se inyectan ya construidos.
 *
 * Se escribe como plantilla (y no concatenando strings) para que pase por el
 * mismo camino que los informes: un solo motor, un solo escapado, una sola
 * forma de fallar.
 */
const CUERPO = `
<div class="membrete">
  <div class="escudo">IDIC</div>
  <div class="org">
    <b>INSTITUTO DE INVESTIGACIONES Y CONTROL</b>
    <span>Ejército de Chile &middot; Sistema de Armas, Evidencias y Certificados (SAEC)</span>
  </div>
  <div class="doc">
    <b>{{certificado.codigo}}</b>
    <span>Certificado de peritaje &middot; RF-K07</span>
  </div>
</div>

<h1>CERTIFICADO DE EVIDENCIA Y PERITAJE</h1>

<table class="meta">
  <tr><th>N.º de elemento (NUE)</th><td>{{evidencia.codigo}}</td><th>Fecha de emisión</th><td>{{fecha}}</td></tr>
  <tr><th>Tipo de elemento</th><td>{{evidencia.tipo}}</td><th>Estado actual</th><td>{{evidencia.estado}}</td></tr>
  <tr><th>Caso</th><td>{{caso.numero}}</td><th>Agencia de origen</th><td>{{caso.agencia}}</td></tr>
</table>

<h2>Identificación del elemento</h2>
<table class="meta">
  <tr><th>Descripción</th><td>{{evidencia.descripcion}}</td><th>N.º de evidencia (ESI)</th><td>{{evidencia.exhibitNumber}}</td></tr>
  <tr><th>Categoría</th><td>{{evidencia.categoria}}</td><th>Calibre</th><td>{{evidencia.calibre}}</td></tr>
  <tr><th>Código de barras</th><td>{{evidencia.codigoBarras}}</td><th>Ubicación actual</th><td>{{evidencia.ubicacion}}</td></tr>
  <tr><th>Procedencia</th><td>{{evidencia.procedencia}}</td><th>Organismo solicitante</th><td>{{evidencia.organismoSolicitante}}</td></tr>
</table>

{{#si arma.presente}}
<h2>Ficha registral del arma (DGMN)</h2>
<table class="meta">
  <tr><th>Serie</th><td>{{arma.serie}}</td><th>Tipo</th><td>{{arma.tipo}}</td></tr>
  <tr><th>Marca</th><td>{{arma.marca}}</td><th>Modelo</th><td>{{arma.modelo}}</td></tr>
  <tr><th>Calibre</th><td>{{arma.calibre}}</td><th>Estado registral</th><td>{{arma.estadoRegistral}}</td></tr>
  <tr><th>Inscripción DGMN</th><td>{{arma.inscripcionDgmn}}</td><th>Propietario registrado</th><td>{{arma.propietario}}</td></tr>
</table>
{{#si arma.serieBorrada}}
<p class="nota">La serie de esta arma figura como BORRADA o adulterada. El número consignado, si lo hay,
procede de la restauración pericial del troquelado.</p>
{{/si}}
{{/si}}

<h2>Resultado del peritaje balístico</h2>
{{tabla_peritajes}}

<h2>Coincidencias IBIS</h2>
{{tabla_hits}}

<h2>Cadena de custodia</h2>
{{tabla_custodia}}

<p class="nota">Este certificado acredita la trazabilidad del elemento identificado y el resultado del
peritaje registrado en el SAEC a la fecha de emisión. Los resultados se refieren exclusivamente al
elemento descrito. El documento no podrá ser reproducido parcialmente sin autorización escrita del
Instituto. Su autenticidad e integridad se comprueban en la dirección indicada al pie mediante el
código de verificación y el sello SHA-256.</p>

<div class="firmas">
  <div class="firma"><span class="linea"></span>Perito balístico responsable</div>
  <div class="firma"><span class="linea"></span>Jefe del Departamento de Balística</div>
</div>`;

/**
 * Aplana el contexto a las rutas que usa la plantilla.
 *
 * Los nombres de columna crudos (`exhibit_number`, `categoria_texto`) se
 * traducen aquí a rutas legibles: la plantilla no tiene por qué conocer el
 * esquema, y así un `ALTER TABLE ... RENAME` rompe en un solo sitio.
 */
function datosPlantilla(ctx: ContextoCertificadoSaec) {
  const { evidencia: e, caso, arma, certificado } = ctx;
  return {
    certificado: {
      codigo: certificado.codigo,
      codigoVerificacion: certificado.codigoVerificacion,
    },
    fecha: fmtFecha(certificado.fecha),
    fecha_hora: fmtFechaHora(certificado.fecha),
    evidencia: {
      codigo: e.codigo ?? "",
      tipo: TIPOS_LEGIBLES[String(e.tipo ?? "")] ?? e.tipo ?? "",
      estado: e.estado ?? "",
      descripcion: e.descripcion ?? "",
      exhibitNumber: e.exhibit_number ?? "",
      categoria: e.categoria_texto ?? e.categoria_codigo ?? "",
      calibre: e.calibre_texto ?? e.calibre_codigo ?? "",
      codigoBarras: e.codigo_barras ?? "",
      ubicacion: e.ubicacion ?? "",
      procedencia: e.procedencia ?? "",
      organismoSolicitante: e.organismo_solicitante ?? "",
    },
    caso: {
      numero: caso?.numero_caso ?? "",
      agencia: caso?.agencia_origen_nombre ?? caso?.agencia_origen_ref ?? "",
      tipoEvento: caso?.tipo_evento_texto ?? "",
    },
    arma: {
      // `presente` gobierna el {{#si}}: sin arma, la sección entera desaparece
      // en vez de imprimir una ficha registral llena de guiones.
      presente: arma ? true : false,
      serie: arma?.serie ?? "",
      serieBorrada: arma?.serie_borrada === true,
      tipo: arma?.tipo ?? "",
      marca: arma?.marca ?? "",
      modelo: arma?.modelo ?? "",
      calibre: arma?.calibre ?? "",
      estadoRegistral: arma?.estado_registral ?? "",
      inscripcionDgmn: arma?.inscripcion_dgmn ?? "",
      propietario: arma?.propietario_registrado ?? "",
    },
    emisor: {
      nombre: ctx.emisor.nombre ?? "",
      unidad: ctx.emisor.unidad ?? "",
    },
  };
}

/**
 * Construye el CUERPO del certificado SAEC: es exactamente lo que se sella
 * (hash) y lo que se guarda en `saec_certificado.documento_html`.
 *
 * Devuelve también los `faltantes` que reporta el motor, por si un elemento sin
 * datos deja huecos: el llamador los registra en la auditoría en vez de
 * tragárselos.
 */
export function cuerpoCertificadoSaec(ctx: ContextoCertificadoSaec): {
  html: string;
  faltantes: string[];
} {
  const bloques = {
    tabla_peritajes: tablaPeritajes(ctx.peritajes),
    tabla_hits: tablaHitsIbis(ctx.hits, String(ctx.evidencia.codigo ?? "")),
    tabla_custodia: tablaCadenaCustodia(ctx.movimientos),
  };
  return renderizar(CUERPO, datosPlantilla(ctx), bloques);
}

/** Título legible del documento (metadatos del PDF y <title>). */
export function tituloCertificadoSaec(codigo: string, codigoEvidencia: string): string {
  return `${codigo} · Certificado de evidencia y peritaje · ${codigoEvidencia}`;
}
