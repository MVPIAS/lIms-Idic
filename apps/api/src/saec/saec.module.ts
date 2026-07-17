import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { AuthGuard } from "@nestjs/passport";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { PrismaClient } from "@prisma/client";
import { createHash, randomInt } from "node:crypto";
import { z } from "zod";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso, RequierePermisoCrud } from "../auth/permisos.decorator";
import { Public } from "../auth/public.decorator";
// RF-K07.1 · el certificado SAEC se renderiza y se sella con el MISMO motor,
// el mismo envoltorio imprimible y el mismo generador de PDF/A que los informes.
// Aquí solo vive el cuerpo propio del dominio (saec-certificado.plantilla.ts).
import { documentoCompleto, type Sello } from "../plantilla-render/plantilla-defecto";
import { generarPdf } from "../plantilla-render/pdf.renderer";
import { fmtFecha } from "../plantilla-render/html.util";
import { cuerpoCertificadoSaec, tituloCertificadoSaec } from "./saec-certificado.plantilla";

/**
 * Código de verificación corto e imprimible del certificado SAEC.
 *
 * Alfabeto Crockford base32 sin I/L/O/U — mismo criterio que los informes
 * (`PlantillaRenderService.nuevoCodigoVerificacion`): no se confunde 0/O ni 1/I
 * al teclearlo desde el papel y no forma palabras. 10 símbolos ~= 51 bits: no es
 * adivinable por fuerza bruta contra el endpoint público.
 *
 * Sustituye a `randomBytes(8).toString("hex")`, que daba 16 caracteres
 * hexadecimales donde 0/O y 1/I sí se confunden al copiarlos de un papel — y un
 * código mal tecleado en una fiscalía se lee como "certificado no auténtico".
 * `randomInt` usa el CSPRNG del sistema (no Math.random).
 */
function nuevoCodigoVerificacionSaec(): string {
  const A = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let s = "";
  for (let i = 0; i < 10; i++) s += A[randomInt(A.length)];
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}

// ---------------------------------------------------------------------------
// Módulo SAEC · Armas, Evidencias y Certificados (bloque RF-K del SRS).
//
// Cubre §4.11 y el Anexo C de Requerimientos_LIMS_IDIC_Aiuken.docx:
//   RF-K01 casos · RF-K02 elementos · RF-K03 importación IBIS/Forensic (ESI v3.2)
//   RF-K04 banco de evidencias · RF-K05 cadena de custodia · RF-K06 préstamos
//   RF-K07 certificados verificables · RF-K08 integraciones · RF-K09 auditoría
//
// Las tablas (packages/db/saec.sql) NO están en el schema de Prisma, por lo que
// este módulo usa SQL crudo tipado con parámetros posicionales sobre un
// PrismaClient propio — mismo patrón e idéntico aislamiento por tenant que
// crm.module.ts. Todos los SELECT/UPDATE filtran por tenant_id y deleted_at.
// ---------------------------------------------------------------------------

// --- catálogos de dominio ---------------------------------------------------

const TIPOS_ELEMENTO = ["arma", "vainilla", "proyectil", "explosivo", "otro"] as const; // RF-K02.3
const ESTADOS_EVIDENCIA = [
  "ingresada", "en_analisis", "analizada", "almacenada", "prestada", "devuelta", "destruida",
] as const;
const EVENTOS_CUSTODIA = [
  "entrada", "salida", "cambio_ubicacion", "prestamo", "devolucion", "analisis", "destruccion",
] as const; // RF-K05.1
const TIPOS_ARMA = ["pistola", "revolver", "fusil", "subfusil", "escopeta", "hechiza", "otro"] as const;
const ESTADOS_REGISTRAL = [
  "inscrita", "no_inscrita", "robada", "encargo_vigente", "decomisada", "destruida", "en_tramite",
] as const;
const ESTADOS_CASO = ["abierto", "en_proceso", "cerrado", "archivado"] as const;

const emptyToNull = (v: unknown) => (v === "" ? null : v);
const uuidOpt = z.preprocess(emptyToNull, z.string().uuid().nullable().optional());
const strOpt = (max: number) => z.preprocess(emptyToNull, z.string().max(max).nullable().optional());
const textOpt = z.preprocess(emptyToNull, z.string().nullable().optional());

// ===========================================================================
// Parser XML ESI v3.2 · sin dependencias externas
//
// DECISIÓN (justificada): no se añade `fast-xml-parser` ni ninguna otra
// dependencia a apps/api/package.json. Motivos:
//   1. El despliegue es ON-PREMISE y sin licencias: añadir una dep obliga a un
//      `pnpm install` con red en el entorno del Ejército, que no está garantizado.
//   2. El Anexo C fija una gramática CERRADA y simple (Export → Cases/Exhibits/
//      Hits, sin namespaces ni DTD), que no justifica una librería general.
//   3. Se implementa un tokenizador de descenso recursivo REAL (no regex):
//      respeta anidamiento, atributos, self-closing, comentarios, CDATA,
//      declaración XML y entidades. Un regex no sabe anidar y habría sido frágil
//      sobre un fichero forense que debe ser prueba judicial.
// Si el cliente exige después XSD/namespaces, se sustituye por libxmljs sin
// tocar la capa de ETL: todo pasa por parsearXml() → NodoXml.
// ===========================================================================

interface NodoXml {
  nombre: string;
  attrs: Record<string, string>;
  hijos: NodoXml[];
  texto: string;
}

const ENTIDADES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
};

function decodificar(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, ent: string) => {
    if (ent[0] === "#") {
      const cp = ent[1] === "x" || ent[1] === "X"
        ? parseInt(ent.slice(2), 16)
        : parseInt(ent.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return ENTIDADES[ent] ?? m;
  });
}

/** Parser de descenso recursivo. Lanza Error con posición si el XML no cierra bien. */
export function parsearXml(xml: string): NodoXml {
  let i = 0;
  const n = xml.length;

  const saltarEspacios = () => { while (i < n && /\s/.test(xml[i])) i++; };

  // Descarta prólogo: declaración XML, comentarios, doctype, PIs.
  const saltarProlgo = () => {
    for (;;) {
      saltarEspacios();
      if (xml.startsWith("<?", i)) {
        const fin = xml.indexOf("?>", i);
        if (fin < 0) throw new Error("Declaración XML sin cerrar");
        i = fin + 2;
      } else if (xml.startsWith("<!--", i)) {
        const fin = xml.indexOf("-->", i);
        if (fin < 0) throw new Error("Comentario sin cerrar");
        i = fin + 3;
      } else if (xml.startsWith("<!", i)) {
        const fin = xml.indexOf(">", i);
        if (fin < 0) throw new Error("Declaración <!…> sin cerrar");
        i = fin + 1;
      } else break;
    }
  };

  const leerNombre = (): string => {
    const ini = i;
    while (i < n && /[^\s/>=]/.test(xml[i])) i++;
    if (i === ini) throw new Error(`Nombre de etiqueta vacío en la posición ${ini}`);
    return xml.slice(ini, i);
  };

  const leerAtributos = (): Record<string, string> => {
    const attrs: Record<string, string> = {};
    for (;;) {
      saltarEspacios();
      if (i >= n || xml[i] === ">" || xml[i] === "/") return attrs;
      const nombre = leerNombre();
      saltarEspacios();
      if (xml[i] !== "=") { attrs[nombre] = ""; continue; } // atributo sin valor
      i++; // '='
      saltarEspacios();
      const comilla = xml[i];
      if (comilla !== '"' && comilla !== "'") throw new Error(`Atributo ${nombre} sin comillas`);
      i++;
      const ini = i;
      while (i < n && xml[i] !== comilla) i++;
      if (i >= n) throw new Error(`Atributo ${nombre} sin cerrar`);
      attrs[nombre] = decodificar(xml.slice(ini, i));
      i++; // comilla de cierre
    }
  };

  const leerElemento = (): NodoXml => {
    if (xml[i] !== "<") throw new Error(`Se esperaba '<' en la posición ${i}`);
    i++;
    const nombre = leerNombre();
    const attrs = leerAtributos();
    saltarEspacios();
    const nodo: NodoXml = { nombre, attrs, hijos: [], texto: "" };

    if (xml.startsWith("/>", i)) { i += 2; return nodo; }
    if (xml[i] !== ">") throw new Error(`Etiqueta <${nombre}> mal formada`);
    i++;

    const partesTexto: string[] = [];
    for (;;) {
      if (i >= n) throw new Error(`Etiqueta <${nombre}> sin cerrar`);

      if (xml.startsWith("</", i)) {
        i += 2;
        const cierre = leerNombre();
        saltarEspacios();
        if (xml[i] !== ">") throw new Error(`Cierre </${cierre}> mal formado`);
        i++;
        if (cierre !== nombre) throw new Error(`Se esperaba </${nombre}> y se encontró </${cierre}>`);
        nodo.texto = decodificar(partesTexto.join("")).trim();
        return nodo;
      }
      if (xml.startsWith("<![CDATA[", i)) {
        const fin = xml.indexOf("]]>", i);
        if (fin < 0) throw new Error("CDATA sin cerrar");
        partesTexto.push(xml.slice(i + 9, fin)); // el CDATA no se decodifica
        i = fin + 3;
        continue;
      }
      if (xml.startsWith("<!--", i)) {
        const fin = xml.indexOf("-->", i);
        if (fin < 0) throw new Error("Comentario sin cerrar");
        i = fin + 3;
        continue;
      }
      if (xml[i] === "<") { nodo.hijos.push(leerElemento()); continue; }

      const ini = i;
      while (i < n && xml[i] !== "<") i++;
      partesTexto.push(xml.slice(ini, i));
    }
  };

  saltarProlgo();
  if (i >= n) throw new Error("XML vacío");
  const raiz = leerElemento();
  return raiz;
}

// --- helpers de navegación del árbol ---------------------------------------

/** Todos los descendientes con ese nombre (búsqueda en profundidad). */
export function buscarTodos(nodo: NodoXml, nombre: string): NodoXml[] {
  const out: NodoXml[] = [];
  const pila = [...nodo.hijos];
  while (pila.length) {
    const x = pila.pop()!;
    if (x.nombre === nombre) out.push(x);
    else pila.push(...x.hijos); // no se anidan Case dentro de Case
  }
  return out;
}

/**
 * Elementos VIVOS de un bloque: `<Cases><Case>`, `<Exhibits><Exhibit>`, …
 *
 * No se puede usar buscarTodos() sobre la raíz: los bloques de borrado
 * (<RemovedCases>, <RemovedExhibits>, <RemovedHits>) repiten <Case>/<Exhibit>/
 * <Hit> en su interior, y el ETL los daría de alta justo antes de borrarlos.
 * Se acota la búsqueda al contenedor y, si el fichero no lo trae, se recorre la
 * raíz saltando explícitamente los subárboles Removed*.
 */
export function buscarElementos(raiz: NodoXml, contenedor: string, nombre: string): NodoXml[] {
  const bloques = raiz.hijos.filter((h) => h.nombre === contenedor);
  if (bloques.length) return bloques.flatMap((b) => buscarTodos(b, nombre));
  const sinBorrados: NodoXml = { ...raiz, hijos: raiz.hijos.filter((h) => !h.nombre.startsWith("Removed")) };
  return buscarTodos(sinBorrados, nombre);
}

const hijo = (nodo: NodoXml, nombre: string): NodoXml | undefined =>
  nodo.hijos.find((h) => h.nombre === nombre);

/** Texto de un hijo directo (o del atributo homónimo), o null. */
export function txt(nodo: NodoXml | undefined, nombre: string): string | null {
  if (!nodo) return null;
  const h = hijo(nodo, nombre);
  if (h && h.texto) return h.texto;
  const a = nodo.attrs[nombre];
  return a ? a : null;
}

/**
 * Valor de lista del ESI: "código fijo + texto descriptivo". El Anexo C no fija
 * la serialización exacta, así que se aceptan las dos formas habituales de ESI:
 *   <EventType Code="HOM">Homicidio</EventType>
 *   <EventType><Code>HOM</Code><Text>Homicidio</Text></EventType>
 */
export function codigoTexto(nodo: NodoXml | undefined, nombre: string): { codigo: string | null; texto: string | null } {
  if (!nodo) return { codigo: null, texto: null };
  const h = hijo(nodo, nombre);
  // Sin hijo: la única forma posible es el atributo homónimo, que solo da texto.
  if (!h) return { codigo: null, texto: nodo.attrs[nombre] ?? null };
  const codigo = h.attrs["Code"] ?? h.attrs["code"] ?? txt(h, "Code") ?? txt(h, "code") ?? null;
  const texto = h.texto || txt(h, "Text") || txt(h, "Description") || null;
  return { codigo, texto };
}

function boolEsi(v: string | null): boolean | null {
  if (v == null) return null;
  const s = v.trim().toLowerCase();
  if (["true", "1", "yes", "y", "si", "sí"].includes(s)) return true;
  if (["false", "0", "no", "n"].includes(s)) return false;
  return null;
}

/** ISO-8601/UTC según el Anexo C. Devuelve null si no es una fecha válida. */
function fechaEsi(v: string | null): string | null {
  if (!v) return null;
  const d = new Date(v.trim());
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function intEsi(v: string | null): number {
  const x = parseInt((v ?? "").trim(), 10);
  return Number.isFinite(x) ? x : 0;
}

// --- schemas Zod ------------------------------------------------------------

const CrearCasoSchema = z.object({
  numeroCaso: z.string().min(1).max(60).optional(),
  agenciaOrigenRef: strOpt(120),
  agenciaOrigenNombre: strOpt(200),
  tipoEventoCodigo: strOpt(40),
  tipoEventoTexto: strOpt(160),
  fechaOcurrencia: textOpt,
  investigadorId: uuidOpt,
  supervisorId: uuidOpt,
  peritoBalisticoId: uuidOpt,
  responsableId: uuidOpt,
  unidadId: uuidOpt,
  estado: z.enum(ESTADOS_CASO).optional(),
  restringido: z.coerce.boolean().optional(),
  altoPerfil: z.coerce.boolean().optional(),
  comentario: textOpt,
});
const ActualizarCasoSchema = CrearCasoSchema.partial();

const CrearEvidenciaSchema = z.object({
  tipo: z.enum(TIPOS_ELEMENTO),
  descripcion: textOpt,
  casoId: uuidOpt,
  exhibitNumber: strOpt(60),
  categoriaCodigo: strOpt(40),
  categoriaTexto: strOpt(160),
  calibreCodigo: strOpt(40),
  calibreTexto: strOpt(160),
  firingPinShape: strOpt(160),
  breechFaceClass: strOpt(160),
  marca: strOpt(120),
  composicion: strOpt(120),
  estado: z.enum(ESTADOS_EVIDENCIA).optional(),
  codigoBarras: strOpt(60),
  ubicacion: strOpt(120),
  soporte: z.enum(["fisica", "digital", "mixta"]).optional(),
  documentoId: uuidOpt,
  otId: uuidOpt,
  muestraId: uuidOpt,
  clienteId: uuidOpt,
  peritoId: uuidOpt,
  procedencia: strOpt(200),
  organismoSolicitante: strOpt(200),
  /** RF-K02.4 · crea la OT automáticamente (exige clienteId). */
  crearOt: z.coerce.boolean().optional(),
});
const ActualizarEvidenciaSchema = CrearEvidenciaSchema.partial();

const COLS_EVIDENCIA: Record<string, string> = {
  tipo: "tipo", descripcion: "descripcion", casoId: "caso_id", exhibitNumber: "exhibit_number",
  categoriaCodigo: "categoria_codigo", categoriaTexto: "categoria_texto",
  calibreCodigo: "calibre_codigo", calibreTexto: "calibre_texto",
  firingPinShape: "firing_pin_shape", breechFaceClass: "breech_face_class",
  marca: "marca", composicion: "composicion", estado: "estado", codigoBarras: "codigo_barras",
  ubicacion: "ubicacion", soporte: "soporte", documentoId: "documento_id",
  otId: "ot_id", muestraId: "muestra_id", clienteId: "cliente_id", peritoId: "perito_id",
  procedencia: "procedencia", organismoSolicitante: "organismo_solicitante",
};
const CAST_EVIDENCIA: Record<string, string> = {
  caso_id: "::uuid", documento_id: "::uuid", ot_id: "::uuid",
  muestra_id: "::uuid", cliente_id: "::uuid", perito_id: "::uuid",
};

const CrearArmaSchema = z.object({
  serie: strOpt(80),
  serieBorrada: z.coerce.boolean().optional(),
  marca: strOpt(120),
  modelo: strOpt(120),
  calibre: strOpt(80),
  tipo: z.enum(TIPOS_ARMA),
  estadoRegistral: z.enum(ESTADOS_REGISTRAL).optional(),
  inscripcionDgmn: strOpt(60),
  fechaInscripcionDgmn: textOpt,
  propietarioRegistrado: strOpt(200),
  rutPropietario: strOpt(20),
  estado: z.enum(["en_custodia", "en_analisis", "prestada", "devuelta", "destruida"]).optional(),
  ubicacion: strOpt(120),
  evidenciaId: uuidOpt,
  observaciones: textOpt,
});
const ActualizarArmaSchema = CrearArmaSchema.partial();

const COLS_ARMA: Record<string, string> = {
  serie: "serie", serieBorrada: "serie_borrada", marca: "marca", modelo: "modelo",
  calibre: "calibre", tipo: "tipo", estadoRegistral: "estado_registral",
  inscripcionDgmn: "inscripcion_dgmn", fechaInscripcionDgmn: "fecha_inscripcion_dgmn",
  propietarioRegistrado: "propietario_registrado", rutPropietario: "rut_propietario",
  estado: "estado", ubicacion: "ubicacion", evidenciaId: "evidencia_id",
  observaciones: "observaciones",
};
const CAST_ARMA: Record<string, string> = {
  evidencia_id: "::uuid", fecha_inscripcion_dgmn: "::date",
};

const CrearMovimientoSchema = z.object({
  evidenciaId: z.string().uuid(),
  evento: z.enum(EVENTOS_CUSTODIA),
  fecha: textOpt,
  desdeUsuarioId: uuidOpt,
  haciaUsuarioId: uuidOpt,
  desdeOrganismo: strOpt(200),
  haciaOrganismo: strOpt(200),
  ubicacionOrigen: strOpt(120),
  ubicacionDestino: strOpt(120),
  motivo: z.string().min(1),
  selloNumero: strOpt(40),
  selloIntegro: z.preprocess(emptyToNull, z.coerce.boolean().nullable().optional()),
  firmaNombre: strOpt(200),
  /** Texto del acta/firma: se guarda su SHA-256, nunca el original. */
  firmaTexto: textOpt,
  firmaElectronicaId: uuidOpt,
  observaciones: textOpt,
});

const CrearPrestamoSchema = z.object({
  tipo: z.enum(["entrega", "devolucion"]).optional(),
  organismoSolicitante: z.string().min(1).max(200),
  solicitanteNombre: z.string().min(1).max(200),
  solicitanteDocumento: strOpt(40),
  motivo: z.string().min(1),
  fechaDevolucionPrevista: textOpt,
  responsableId: uuidOpt,
});

const PeritajeManualSchema = z.object({
  resultado: z.enum(["concluyente", "no_concluyente", "sin_coincidencia", "pendiente"]).optional(),
  conclusiones: textOpt,
  peritoId: uuidOpt,
  datos: z.record(z.any()).optional(),
});

const ImportarIbisSchema = z.object({
  xml: z.string().min(1, "El XML es obligatorio"),
  nombreArchivo: strOpt(260),
  /** Reprocesa aunque el hash ya exista (RF-K03.4 lo impide por defecto). */
  forzar: z.coerce.boolean().optional(),
});

const IntegracionSchema = z.object({
  origen: z.enum(["dgmn", "aduanas", "fiscalia", "pdi", "ibis"]),
  direccion: z.enum(["entrada", "notificacion"]).optional(),
  tipo: z.string().min(1).max(60),
  referencia: strOpt(120),
  evidenciaId: uuidOpt,
  armaId: uuidOpt,
  casoId: uuidOpt,
  fechaProgramada: textOpt,
  ubicacion: strOpt(120),
  payload: z.record(z.any()).optional(),
});

// ===========================================================================
// Base común: tenant, paginación, auditoría (RF-K09.2)
// ===========================================================================

/**
 * Superficie SQL cruda común a `PrismaClient` y al cliente de transacción que
 * entrega `$transaction`. Permite que los helpers (siguienteCodigo, auditar)
 * funcionen igual dentro y fuera de una transacción sin recurrir a `any`.
 */
type ClienteSql = {
  $queryRawUnsafe<T = unknown>(sql: string, ...valores: any[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...valores: any[]): Promise<number>;
};

abstract class SaecBase {
  protected prisma = new PrismaClient();

  protected tenantId(req: any): string {
    const id = req?.user?.tenantId;
    if (!id) throw new NotFoundException("Tenant no resuelto en el token");
    return id;
  }

  /** IP normalizada para la columna INET (Express devuelve ::ffff:1.2.3.4). */
  protected ip(req: any): string | null {
    const raw: string | undefined = req?.ip ?? req?.socket?.remoteAddress;
    if (!raw) return null;
    return raw.startsWith("::ffff:") ? raw.slice(7) : raw;
  }

  protected paginacion(page?: string, limit?: string) {
    const p = Math.max(1, parseInt(page ?? "1") || 1);
    const l = Math.min(200, Math.max(1, parseInt(limit ?? "100") || 100));
    return { p, l, offset: (p - 1) * l };
  }

  /** RF-K09.2 · registra usuario, fecha/hora e IP de cada acción. */
  protected async auditar(
    req: any, entidad: string, entidadId: string | null, accion: string, detalle: any = {},
    tx: ClienteSql = this.prisma,
  ) {
    await tx.$executeRawUnsafe(
      `INSERT INTO saec_auditoria (tenant_id, entidad, entidad_id, accion, usuario_id, usuario_nombre, ip_origen, detalle)
       VALUES ($1::uuid, $2, $3::uuid, $4, $5::uuid, $6, $7::inet, $8::jsonb)`,
      this.tenantId(req),
      entidad,
      entidadId,
      accion,
      req?.user?.sub ?? req?.user?.id ?? null,
      req?.user?.nombreCompleto ?? req?.user?.username ?? null,
      this.ip(req),
      JSON.stringify(detalle ?? {}),
    );
  }

  /** Correlativo por tenant sobre un prefijo tipo EV-2026-. */
  protected async siguienteCodigo(tabla: string, prefijo: string, tenantId: string, tx: ClienteSql = this.prisma) {
    const rows = await tx.$queryRawUnsafe<any[]>(
      `SELECT COALESCE(MAX(NULLIF(regexp_replace(codigo, '^.*-', ''), '')::int), 0) + 1 AS next
         FROM ${tabla}
        WHERE tenant_id = $1::uuid AND codigo LIKE $2`,
      tenantId,
      `${prefijo}%`,
    );
    return `${prefijo}${String(Number(rows[0]?.next ?? 1)).padStart(4, "0")}`;
  }

  /** PATCH dinámico genérico: solo columnas del mapa (nunca entrada del usuario). */
  protected construirSet(d: Record<string, unknown>, cols: Record<string, string>, casts: Record<string, string>, args: any[]) {
    const sets: string[] = [];
    for (const [key, col] of Object.entries(cols)) {
      if (key in d) {
        args.push(d[key] ?? null);
        sets.push(`${col} = $${args.length}${casts[col] ?? ""}`);
      }
    }
    return sets;
  }
}

// ===========================================================================
// RF-K01 · Casos
// ===========================================================================

@ApiTags("saec · casos")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@RequierePermisoCrud({ ver: "caso.ver", crear: "caso.crear", editar: "caso.editar", eliminar: "caso.eliminar" })
@Controller("saec/casos")
export class SaecCasoController extends SaecBase {
  private async cargarPropio(id: string, tenantId: string) {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT c.*,
              to_jsonb(ui.*) AS investigador,
              to_jsonb(us.*) AS supervisor,
              to_jsonb(up.*) AS perito_balistico,
              (SELECT COUNT(*)::int FROM evidencia e WHERE e.caso_id = c.id AND e.deleted_at IS NULL) AS total_evidencias
         FROM saec_caso c
         LEFT JOIN usuario ui ON ui.id = c.investigador_id
         LEFT JOIN usuario us ON us.id = c.supervisor_id
         LEFT JOIN usuario up ON up.id = c.perito_balistico_id
        WHERE c.id = $1::uuid AND c.tenant_id = $2::uuid AND c.deleted_at IS NULL
        LIMIT 1`,
      id, tenantId,
    );
    if (!rows.length) throw new NotFoundException("Caso no encontrado");
    return rows[0];
  }

  @Get()
  async listar(
    @Query("page") page?: string, @Query("limit") limit?: string,
    @Query("estado") estado?: string, @Query("q") q?: string, @Req() req?: any,
  ) {
    const tenantId = this.tenantId(req);
    const { p, l, offset } = this.paginacion(page, limit);

    const filtros: string[] = [];
    const args: any[] = [tenantId];
    if (estado) { args.push(estado); filtros.push(`AND c.estado = $${args.length}`); }
    if (q) { args.push(`%${q}%`); filtros.push(`AND (c.numero_caso ILIKE $${args.length} OR c.agencia_origen_nombre ILIKE $${args.length})`); }
    const where = filtros.join(" ");

    const data = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT c.*,
              (SELECT COUNT(*)::int FROM evidencia e WHERE e.caso_id = c.id AND e.deleted_at IS NULL) AS total_evidencias
         FROM saec_caso c
        WHERE c.tenant_id = $1::uuid AND c.deleted_at IS NULL ${where}
        ORDER BY c.created_at DESC
        LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      ...args, l, offset,
    );
    const totalRows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS total FROM saec_caso c
        WHERE c.tenant_id = $1::uuid AND c.deleted_at IS NULL ${where}`,
      ...args,
    );
    return { data, meta: { page: p, limit: l, total: Number(totalRows[0]?.total ?? 0) } };
  }

  @Get(":id")
  async detalle(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const tenantId = this.tenantId(req);
    const caso = await this.cargarPropio(id, tenantId);
    const evidencias = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM evidencia WHERE tenant_id = $1::uuid AND caso_id = $2::uuid AND deleted_at IS NULL ORDER BY codigo`,
      tenantId, id,
    );
    const comentarios = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT cc.*, u.nombre_completo AS autor_nombre
         FROM saec_caso_comentario cc
         LEFT JOIN usuario u ON u.id = cc.autor_id
        WHERE cc.tenant_id = $1::uuid AND cc.caso_id = $2::uuid AND cc.deleted_at IS NULL
        ORDER BY cc.created_at DESC`,
      tenantId, id,
    );
    return { ...caso, evidencias, comentarios };
  }

  @Post()
  async crear(@Body() body: unknown, @Req() req: any) {
    const tenantId = this.tenantId(req);
    const d = CrearCasoSchema.parse(body);
    // saec_caso no tiene columna `codigo`: su correlativo va sobre numero_caso.
    const numero = d.numeroCaso ?? (await this.correlativoCaso(tenantId));

    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `INSERT INTO saec_caso
         (tenant_id, numero_caso, agencia_origen_ref, agencia_origen_nombre, tipo_evento_codigo,
          tipo_evento_texto, fecha_ocurrencia, investigador_id, supervisor_id, perito_balistico_id,
          responsable_id, unidad_id, estado, restringido, alto_perfil, comentario, origen, created_by)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::timestamptz, $8::uuid, $9::uuid, $10::uuid,
               $11::uuid, $12::uuid, $13, $14, $15, $16, 'manual', $17::uuid)
       RETURNING *`,
      tenantId, numero, d.agenciaOrigenRef ?? null, d.agenciaOrigenNombre ?? null,
      d.tipoEventoCodigo ?? null, d.tipoEventoTexto ?? null, d.fechaOcurrencia ?? null,
      d.investigadorId ?? null, d.supervisorId ?? null, d.peritoBalisticoId ?? null,
      d.responsableId ?? null, d.unidadId ?? null, d.estado ?? "abierto",
      d.restringido ?? false, d.altoPerfil ?? false, d.comentario ?? null,
      req?.user?.sub ?? null,
    );
    await this.auditar(req, "caso", rows[0].id, "crear", { numeroCaso: numero });
    return rows[0];
  }

  /** CASO-<año>-NNNN por tenant. */
  private async correlativoCaso(tenantId: string) {
    const anio = new Date().getFullYear();
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT COALESCE(MAX(split_part(numero_caso, '-', 3)::int), 0) + 1 AS next
         FROM saec_caso WHERE tenant_id = $1::uuid AND numero_caso LIKE $2`,
      tenantId, `CASO-${anio}-%`,
    );
    return `CASO-${anio}-${String(Number(rows[0]?.next ?? 1)).padStart(4, "0")}`;
  }

  @Patch(":id")
  async actualizar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const tenantId = this.tenantId(req);
    const d = ActualizarCasoSchema.parse(body) as Record<string, unknown>;
    await this.cargarPropio(id, tenantId);

    const cols: Record<string, string> = {
      numeroCaso: "numero_caso", agenciaOrigenRef: "agencia_origen_ref",
      agenciaOrigenNombre: "agencia_origen_nombre", tipoEventoCodigo: "tipo_evento_codigo",
      tipoEventoTexto: "tipo_evento_texto", fechaOcurrencia: "fecha_ocurrencia",
      investigadorId: "investigador_id", supervisorId: "supervisor_id",
      peritoBalisticoId: "perito_balistico_id", responsableId: "responsable_id",
      unidadId: "unidad_id", estado: "estado", restringido: "restringido",
      altoPerfil: "alto_perfil", comentario: "comentario",
    };
    const casts: Record<string, string> = {
      fecha_ocurrencia: "::timestamptz", investigador_id: "::uuid", supervisor_id: "::uuid",
      perito_balistico_id: "::uuid", responsable_id: "::uuid", unidad_id: "::uuid",
    };
    const args: any[] = [id, tenantId];
    const sets = this.construirSet(d, cols, casts, args);
    if (!sets.length) return this.cargarPropio(id, tenantId);

    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `UPDATE saec_caso SET ${sets.join(", ")}
        WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL
        RETURNING *`,
      ...args,
    );
    await this.auditar(req, "caso", id, "editar", d);
    return rows[0];
  }

  @Delete(":id")
  async eliminar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const tenantId = this.tenantId(req);
    await this.cargarPropio(id, tenantId);
    const usadas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS n FROM evidencia WHERE tenant_id = $1::uuid AND caso_id = $2::uuid AND deleted_at IS NULL`,
      tenantId, id,
    );
    if (Number(usadas[0]?.n ?? 0) > 0) {
      throw new BadRequestException("El caso tiene evidencias asociadas; primero deben darse de baja o reasignarse.");
    }
    await this.prisma.$executeRawUnsafe(
      `UPDATE saec_caso SET deleted_at = now() WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL`,
      id, tenantId,
    );
    await this.auditar(req, "caso", id, "eliminar");
    return { ok: true };
  }

  /** RF-K01.4 · comentarios del caso. */
  @Post(":id/comentarios")
  @RequierePermiso("caso.editar")
  async comentar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const tenantId = this.tenantId(req);
    const { texto } = z.object({ texto: z.string().min(1) }).parse(body);
    await this.cargarPropio(id, tenantId);
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `INSERT INTO saec_caso_comentario (tenant_id, caso_id, texto, autor_id)
       VALUES ($1::uuid, $2::uuid, $3, $4::uuid) RETURNING *`,
      tenantId, id, texto, req?.user?.sub ?? null,
    );
    await this.auditar(req, "caso", id, "editar", { comentario: true });
    return rows[0];
  }
}

// ===========================================================================
// RF-K02 / RF-K04 / RF-K09.1 · Evidencias (elementos)
// ===========================================================================

@ApiTags("saec · evidencias")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@RequierePermisoCrud({
  ver: "evidencia.ver", crear: "evidencia.crear",
  editar: "evidencia.editar", eliminar: "evidencia.eliminar",
})
@Controller("evidencias")
export class EvidenciaController extends SaecBase {
  private async cargarPropia(id: string, tenantId: string) {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT e.*,
              to_jsonb(c.*)  AS caso,
              to_jsonb(cl.*) AS cliente,
              to_jsonb(p.*)  AS perito,
              to_jsonb(ot.*) AS ot
         FROM evidencia e
         LEFT JOIN saec_caso c    ON c.id = e.caso_id
         LEFT JOIN cliente cl     ON cl.id = e.cliente_id
         LEFT JOIN usuario p      ON p.id = e.perito_id
         LEFT JOIN orden_trabajo ot ON ot.id = e.ot_id
        WHERE e.id = $1::uuid AND e.tenant_id = $2::uuid AND e.deleted_at IS NULL
        LIMIT 1`,
      id, tenantId,
    );
    if (!rows.length) throw new NotFoundException("Evidencia no encontrada");
    return rows[0];
  }

  @Get()
  async listar(
    @Query("page") page?: string, @Query("limit") limit?: string,
    @Query("estado") estado?: string, @Query("tipo") tipo?: string,
    @Query("casoId") casoId?: string, @Query("ubicacion") ubicacion?: string,
    @Query("q") q?: string, @Req() req?: any,
  ) {
    const tenantId = this.tenantId(req);
    const { p, l, offset } = this.paginacion(page, limit);

    const filtros: string[] = [];
    const args: any[] = [tenantId];
    if (estado) { args.push(estado); filtros.push(`AND e.estado = $${args.length}`); }
    if (tipo) { args.push(tipo); filtros.push(`AND e.tipo = $${args.length}`); }
    if (casoId) { args.push(casoId); filtros.push(`AND e.caso_id = $${args.length}::uuid`); }
    if (ubicacion) { args.push(ubicacion); filtros.push(`AND e.ubicacion = $${args.length}`); }
    if (q) {
      args.push(`%${q}%`);
      filtros.push(`AND (e.codigo ILIKE $${args.length} OR e.descripcion ILIKE $${args.length}
                        OR e.exhibit_number ILIKE $${args.length} OR e.codigo_barras ILIKE $${args.length})`);
    }
    const where = filtros.join(" ");

    const data = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT e.*, to_jsonb(c.*) AS caso
         FROM evidencia e
         LEFT JOIN saec_caso c ON c.id = e.caso_id
        WHERE e.tenant_id = $1::uuid AND e.deleted_at IS NULL ${where}
        ORDER BY e.created_at DESC
        LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      ...args, l, offset,
    );
    const totalRows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS total FROM evidencia e
        WHERE e.tenant_id = $1::uuid AND e.deleted_at IS NULL ${where}`,
      ...args,
    );
    return { data, meta: { page: p, limit: l, total: Number(totalRows[0]?.total ?? 0) } };
  }

  /** RF-K04.2 · inventario de bodega y control de existencias. */
  @Get("inventario")
  async inventario(@Req() req: any) {
    const tenantId = this.tenantId(req);
    const porUbicacion = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT COALESCE(e.ubicacion, '(sin ubicación)') AS ubicacion,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE e.estado = 'prestada')::int AS prestadas
         FROM evidencia e
        WHERE e.tenant_id = $1::uuid AND e.deleted_at IS NULL
        GROUP BY e.ubicacion
        ORDER BY 1`,
      tenantId,
    );
    const porTipo = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT e.tipo, COUNT(*)::int AS total
         FROM evidencia e
        WHERE e.tenant_id = $1::uuid AND e.deleted_at IS NULL
        GROUP BY e.tipo ORDER BY 2 DESC`,
      tenantId,
    );
    const porEstado = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT e.estado, COUNT(*)::int AS total
         FROM evidencia e
        WHERE e.tenant_id = $1::uuid AND e.deleted_at IS NULL
        GROUP BY e.estado ORDER BY 2 DESC`,
      tenantId,
    );
    return { data: { porUbicacion, porTipo, porEstado } };
  }

  /** RF-K04.4 · escaneo de código de barras para identificación rápida. */
  @Get("barras/:codigo")
  async porCodigoBarras(@Param("codigo") codigo: string, @Req() req: any) {
    const tenantId = this.tenantId(req);
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT e.*, to_jsonb(c.*) AS caso
         FROM evidencia e
         LEFT JOIN saec_caso c ON c.id = e.caso_id
        WHERE e.tenant_id = $1::uuid AND e.deleted_at IS NULL
          AND (e.codigo_barras = $2 OR e.codigo = $2)
        LIMIT 1`,
      tenantId, codigo,
    );
    if (!rows.length) throw new NotFoundException("No hay ninguna evidencia con ese código");
    return rows[0];
  }

  /** RF-K09.1 · ficha de solo lectura con el historial completo del proceso. */
  @Get(":id")
  async detalle(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const tenantId = this.tenantId(req);
    const evidencia = await this.cargarPropia(id, tenantId);

    const [movimientos, peritajes, hits, prestamos, certificados, arma, auditoria] = await Promise.all([
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT m.*, du.nombre_completo AS desde_usuario, hu.nombre_completo AS hacia_usuario
           FROM evidencia_movimiento m
           LEFT JOIN usuario du  ON du.id = m.desde_usuario_id
           LEFT JOIN usuario hu  ON hu.id = m.hacia_usuario_id
          WHERE m.tenant_id = $1::uuid AND m.evidencia_id = $2::uuid
          ORDER BY m.fecha ASC`,
        tenantId, id),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT p.*, u.nombre_completo AS perito_nombre
           FROM peritaje_balistico p
           LEFT JOIN usuario u ON u.id = p.perito_id
          WHERE p.tenant_id = $1::uuid AND p.evidencia_id = $2::uuid AND p.deleted_at IS NULL
          ORDER BY p.fecha_peritaje DESC`,
        tenantId, id),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT h.*, ea.codigo AS evidencia_a_codigo, eb.codigo AS evidencia_b_codigo
           FROM ibis_hit h
           LEFT JOIN evidencia ea ON ea.id = h.evidencia_a_id
           LEFT JOIN evidencia eb ON eb.id = h.evidencia_b_id
          WHERE h.tenant_id = $1::uuid AND h.deleted_at IS NULL
            AND (h.evidencia_a_id = $2::uuid OR h.evidencia_b_id = $2::uuid)
          ORDER BY h.score DESC NULLS LAST`,
        tenantId, id),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT * FROM evidencia_prestamo
          WHERE tenant_id = $1::uuid AND evidencia_id = $2::uuid AND deleted_at IS NULL
          ORDER BY created_at DESC`,
        tenantId, id),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT id, codigo, codigo_verificacion, hash_documento, estado, emitido_at
           FROM saec_certificado
          WHERE tenant_id = $1::uuid AND evidencia_id = $2::uuid AND deleted_at IS NULL
          ORDER BY emitido_at DESC`,
        tenantId, id),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT * FROM arma
          WHERE tenant_id = $1::uuid AND evidencia_id = $2::uuid AND deleted_at IS NULL
          LIMIT 1`,
        tenantId, id),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT accion, usuario_nombre, ip_origen, created_at, detalle
           FROM saec_auditoria
          WHERE tenant_id = $1::uuid AND entidad = 'evidencia' AND entidad_id = $2::uuid
          ORDER BY created_at DESC LIMIT 100`,
        tenantId, id),
    ]);

    return {
      ...evidencia,
      arma: arma[0] ?? null,
      movimientos, peritajes, hits, prestamos, certificados, auditoria,
    };
  }

  @Post()
  async crear(@Body() body: unknown, @Req() req: any) {
    const tenantId = this.tenantId(req);
    const d = CrearEvidenciaSchema.parse(body);
    if (d.crearOt && !d.clienteId) {
      throw new BadRequestException("Para crear la OT automáticamente (RF-K02.4) hace falta un clienteId.");
    }

    return this.prisma.$transaction(async (tx: ClienteSql) => {
      const codigo = await this.siguienteCodigo("evidencia", "EV-2026-", tenantId, tx);

      // RF-K02.4 · creación automática de la OT.
      let otId = d.otId ?? null;
      if (d.crearOt && !otId) {
        const codOt = await this.siguienteCodigo("orden_trabajo", "OT-2026-", tenantId, tx);
        // `orden_trabajo` viene del modelo Prisma: su id NO tiene DEFAULT
        // gen_random_uuid() y la tabla no tiene columna created_by.
        const ot = await tx.$queryRawUnsafe<any[]>(
          `INSERT INTO orden_trabajo (id, tenant_id, codigo, cliente_id, prioridad, fecha_recepcion,
                                      solicitante, origen_trabajo, estado, notas, created_at, updated_at)
           VALUES (gen_random_uuid(), $1::uuid, $2, $3::uuid, 'normal', now(), $4, 'SAEC', 'recepcionada', $5, now(), now())
           RETURNING id`,
          tenantId, codOt, d.clienteId, d.organismoSolicitante ?? null,
          `OT generada automáticamente por el SAEC para la evidencia ${codigo} (RF-K02.4).`,
        );
        otId = ot[0].id;
      }

      // RF-K02.2 · código de barras único por elemento (por defecto, el NUE).
      const codigoBarras = d.codigoBarras ?? codigo;

      const rows = await tx.$queryRawUnsafe<any[]>(
        `INSERT INTO evidencia
           (tenant_id, codigo, caso_id, exhibit_number, tipo, descripcion, categoria_codigo,
            categoria_texto, calibre_codigo, calibre_texto, firing_pin_shape, breech_face_class,
            marca, composicion, estado, codigo_barras, ubicacion, soporte, documento_id,
            ot_id, muestra_id, cliente_id, perito_id, procedencia, organismo_solicitante, created_by)
         VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                 $16, $17, $18, $19::uuid, $20::uuid, $21::uuid, $22::uuid, $23::uuid, $24, $25, $26::uuid)
         RETURNING *`,
        tenantId, codigo, d.casoId ?? null, d.exhibitNumber ?? null, d.tipo, d.descripcion ?? null,
        d.categoriaCodigo ?? null, d.categoriaTexto ?? null, d.calibreCodigo ?? null, d.calibreTexto ?? null,
        d.firingPinShape ?? null, d.breechFaceClass ?? null, d.marca ?? null, d.composicion ?? null,
        d.estado ?? "ingresada", codigoBarras, d.ubicacion ?? null, d.soporte ?? "fisica",
        d.documentoId ?? null, otId, d.muestraId ?? null, d.clienteId ?? null, d.peritoId ?? null,
        d.procedencia ?? null, d.organismoSolicitante ?? null, req?.user?.sub ?? null,
      );
      const evidencia = rows[0];

      // RF-K05.1 · el ingreso abre la cadena de custodia.
      await tx.$executeRawUnsafe(
        `INSERT INTO evidencia_movimiento
           (tenant_id, evidencia_id, evento, desde_organismo, hacia_organismo, ubicacion_destino,
            motivo, registrado_por, ip_origen)
         VALUES ($1::uuid, $2::uuid, 'entrada', $3, 'IDIC · Bodega de evidencias', $4, $5, $6::uuid, $7::inet)`,
        tenantId, evidencia.id, d.organismoSolicitante ?? d.procedencia ?? null,
        d.ubicacion ?? null, "Ingreso inicial de la evidencia al banco del SAEC.",
        req?.user?.sub ?? null, this.ip(req),
      );

      // RF-K02.4 · notificación al perito/analista asignado. El núcleo no tiene
      // tabla de notificaciones, así que se encola como evento de integración
      // (misma tabla que usa RF-K08.3 para notificar a entidades).
      if (d.peritoId) {
        await tx.$executeRawUnsafe(
          `INSERT INTO saec_integracion_evento (tenant_id, origen, direccion, tipo, evidencia_id, caso_id, payload)
           VALUES ($1::uuid, 'ibis', 'notificacion', 'notificacion_perito', $2::uuid, $3::uuid, $4::jsonb)`,
          tenantId, evidencia.id, d.casoId ?? null,
          JSON.stringify({ peritoId: d.peritoId, evidencia: codigo, otId, motivo: "Asignación de elemento (RF-K02.4)" }),
        );
      }

      await this.auditar(req, "evidencia", evidencia.id, "crear", { codigo, tipo: d.tipo, otId }, tx);
      return evidencia;
    });
  }

  @Patch(":id")
  async actualizar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const tenantId = this.tenantId(req);
    const d = ActualizarEvidenciaSchema.parse(body) as Record<string, unknown>;
    const antes = await this.cargarPropia(id, tenantId);

    const args: any[] = [id, tenantId];
    const sets = this.construirSet(d, COLS_EVIDENCIA, CAST_EVIDENCIA, args);
    if (!sets.length) return this.cargarPropia(id, tenantId);

    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `UPDATE evidencia SET ${sets.join(", ")}
        WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL
        RETURNING *`,
      ...args,
    );

    // RF-K05.1 · un cambio de ubicación por la ficha también deja rastro.
    if ("ubicacion" in d && d.ubicacion !== antes.ubicacion) {
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO evidencia_movimiento
           (tenant_id, evidencia_id, evento, ubicacion_origen, ubicacion_destino, motivo, registrado_por, ip_origen)
         VALUES ($1::uuid, $2::uuid, 'cambio_ubicacion', $3, $4, $5, $6::uuid, $7::inet)`,
        tenantId, id, antes.ubicacion ?? null, (d.ubicacion as string) ?? null,
        "Cambio de ubicación registrado desde la ficha de la evidencia.",
        req?.user?.sub ?? null, this.ip(req),
      );
    }
    await this.auditar(req, "evidencia", id, "editar", d);
    return rows[0];
  }

  @Delete(":id")
  async eliminar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const tenantId = this.tenantId(req);
    const e = await this.cargarPropia(id, tenantId);
    if (e.estado === "prestada") {
      throw new BadRequestException("No se puede dar de baja una evidencia que está prestada; regístrese primero la devolución.");
    }
    await this.prisma.$executeRawUnsafe(
      `UPDATE evidencia SET deleted_at = now() WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL`,
      id, tenantId,
    );
    await this.auditar(req, "evidencia", id, "eliminar", { codigo: e.codigo });
    return { ok: true };
  }

  /** RF-K03.5 · registro manual de resultados (elementos no balísticos). */
  @Post(":id/peritaje")
  @RequierePermiso("peritaje.registrar")
  async peritajeManual(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const tenantId = this.tenantId(req);
    const d = PeritajeManualSchema.parse(body);
    await this.cargarPropia(id, tenantId);

    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `INSERT INTO peritaje_balistico
         (tenant_id, evidencia_id, origen, resultado, conclusiones, perito_id, datos)
       VALUES ($1::uuid, $2::uuid, 'manual', $3, $4, $5::uuid, $6::jsonb)
       RETURNING *`,
      tenantId, id, d.resultado ?? "pendiente", d.conclusiones ?? null,
      d.peritoId ?? req?.user?.sub ?? null, JSON.stringify(d.datos ?? {}),
    );
    await this.prisma.$executeRawUnsafe(
      `UPDATE evidencia SET estado = 'analizada'
        WHERE id = $1::uuid AND tenant_id = $2::uuid AND estado IN ('ingresada', 'en_analisis')`,
      id, tenantId,
    );
    await this.auditar(req, "evidencia", id, "editar", { peritajeManual: true, resultado: d.resultado });
    return rows[0];
  }

  /** RF-K06.1 · formulario de solicitud de entrega/devolución. */
  @Post(":id/prestamos")
  @RequierePermiso("evidencia.prestar")
  async solicitarPrestamo(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const tenantId = this.tenantId(req);
    const d = CrearPrestamoSchema.parse(body);
    const e = await this.cargarPropia(id, tenantId);
    if (d.tipo !== "devolucion" && e.estado === "prestada") {
      throw new BadRequestException("La evidencia ya está prestada.");
    }

    const codigo = await this.siguienteCodigo("evidencia_prestamo", "PRE-2026-", tenantId);
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `INSERT INTO evidencia_prestamo
         (tenant_id, evidencia_id, codigo, tipo, organismo_solicitante, solicitante_nombre,
          solicitante_documento, motivo, fecha_devolucion_prevista, responsable_id, estado, created_by)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9::date, $10::uuid, 'solicitado', $11::uuid)
       RETURNING *`,
      tenantId, id, codigo, d.tipo ?? "entrega", d.organismoSolicitante, d.solicitanteNombre,
      d.solicitanteDocumento ?? null, d.motivo, d.fechaDevolucionPrevista ?? null,
      d.responsableId ?? null, req?.user?.sub ?? null,
    );

    // RF-K06.2 · notificación al responsable.
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO saec_integracion_evento (tenant_id, origen, direccion, tipo, evidencia_id, referencia, payload)
       VALUES ($1::uuid, $2, 'notificacion', 'notificacion_responsable_prestamo', $3::uuid, $4, $5::jsonb)`,
      tenantId, "fiscalia", id, codigo,
      JSON.stringify({ responsableId: d.responsableId, organismo: d.organismoSolicitante, motivo: d.motivo }),
    );
    await this.auditar(req, "prestamo", rows[0].id, "crear", { codigo, evidenciaId: id });
    return rows[0];
  }

  /**
   * RF-K07.1 / K07.2 · emisión del certificado: RENDERIZA el documento, lo
   * sella con SHA-256, le asigna correlativo y código de verificación.
   *
   * ---------------------------------------------------------------------------
   * QUÉ SE SELLA (anti-repudio)
   * ---------------------------------------------------------------------------
   * `hash_documento = sha256(documento_html)`, donde `documento_html` es el
   * CUERPO renderizado del certificado, guardado tal cual en la fila. Misma
   * semántica exacta que los informes (`PlantillaRenderService.emitir`), para
   * que haya UNA sola definición de "sello" en todo el LIMS.
   *
   * Antes el hash se calculaba sobre `JSON.stringify(contenido)`, lo que era
   * un sello sobre un objeto que NO era el documento: no existía documento que
   * verificar, y el orden de claves de `JSON.stringify` no está garantizado
   * entre versiones de motor, así que el hash ni siquiera era estable por
   * construcción. `contenido` se sigue guardando como snapshot legible por
   * máquina, pero YA NO es lo que se sella.
   *
   * El pie con el hash y el código de verificación NO entra en lo sellado
   * (sería circular: un texto no puede contener su propio hash). Lo añade la
   * capa de presentación (`documentoCompleto` / `generarPdf`).
   *
   * Todo va en UNA transacción: reservar correlativo -> renderizar -> insertar.
   * Un fallo al renderizar no debe dejar un correlativo quemado.
   */
  @Post(":id/certificado")
  @RequierePermiso("saec.certificado.emitir")
  async emitirCertificado(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const tenantId = this.tenantId(req);
    const evidencia = await this.cargarPropia(id, tenantId);

    // RF-K07.1 · solo se certifica una vez registrados los resultados.
    const peritajes = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT p.*, u.nombre_completo AS perito_nombre
         FROM peritaje_balistico p
         LEFT JOIN usuario u ON u.id = p.perito_id
        WHERE p.tenant_id = $1::uuid AND p.evidencia_id = $2::uuid AND p.deleted_at IS NULL
        ORDER BY p.fecha_peritaje DESC`,
      tenantId, id,
    );
    if (!peritajes.length) {
      throw new BadRequestException(
        "No se puede emitir el certificado: la evidencia no tiene resultados de peritaje registrados (RF-K07.1).",
      );
    }

    // Resto del expediente que va al documento. En paralelo: son lecturas
    // independientes y el certificado las necesita todas.
    const [movimientos, hits, armas] = await Promise.all([
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT m.*, du.nombre_completo AS desde_usuario, hu.nombre_completo AS hacia_usuario
           FROM evidencia_movimiento m
           LEFT JOIN usuario du ON du.id = m.desde_usuario_id
           LEFT JOIN usuario hu ON hu.id = m.hacia_usuario_id
          WHERE m.tenant_id = $1::uuid AND m.evidencia_id = $2::uuid
          ORDER BY m.fecha ASC`,
        tenantId, id),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT h.*, ea.codigo AS evidencia_a_codigo, eb.codigo AS evidencia_b_codigo
           FROM ibis_hit h
           LEFT JOIN evidencia ea ON ea.id = h.evidencia_a_id
           LEFT JOIN evidencia eb ON eb.id = h.evidencia_b_id
          WHERE h.tenant_id = $1::uuid AND h.deleted_at IS NULL
            AND (h.evidencia_a_id = $2::uuid OR h.evidencia_b_id = $2::uuid)
          ORDER BY h.score DESC NULLS LAST`,
        tenantId, id),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT * FROM arma
          WHERE tenant_id = $1::uuid AND evidencia_id = $2::uuid AND deleted_at IS NULL
          LIMIT 1`,
        tenantId, id),
    ]);

    const fecha = new Date();
    const codigoVerificacion = nuevoCodigoVerificacionSaec();

    return this.prisma.$transaction(async (tx: ClienteSql) => {
      const codigo = await this.siguienteCodigo("saec_certificado", "CERT-SAEC-2026-", tenantId, tx);

      // El CUERPO imprime el número de certificado, así que el hash depende de
      // él: no se puede sellar antes de haberlo reservado.
      const { html: documentoHtml, faltantes } = cuerpoCertificadoSaec({
        certificado: { codigo, codigoVerificacion, fecha },
        evidencia,
        caso: evidencia.caso ?? null,
        arma: armas[0] ?? null,
        peritajes,
        movimientos,
        hits,
        emisor: {
          nombre: req?.user?.nombreCompleto ?? req?.user?.username ?? null,
          unidad: null,
        },
      });
      const hash = createHash("sha256").update(documentoHtml, "utf8").digest("hex");

      // Snapshot legible por máquina. Se conserva porque es útil para explotación
      // y para la integración con terceros, pero NO es el sello.
      const contenido = {
        certificado: codigo,
        emitidoAt: fecha.toISOString(),
        evidencia: {
          codigo: evidencia.codigo, tipo: evidencia.tipo, descripcion: evidencia.descripcion,
          exhibitNumber: evidencia.exhibit_number, calibre: evidencia.calibre_texto,
          caso: evidencia.caso?.numero_caso ?? null,
        },
        peritajes: peritajes.map((p) => ({
          origen: p.origen, resultado: p.resultado, conclusiones: p.conclusiones,
          fecha: p.fecha_peritaje, hitCount: p.hit_count,
        })),
        totales: { movimientos: movimientos.length, hits: hits.length },
        emisor: { tenant: tenantId, usuario: req?.user?.username ?? null },
      };

      const rows = await tx.$queryRawUnsafe<any[]>(
        `INSERT INTO saec_certificado
           (tenant_id, evidencia_id, codigo, codigo_verificacion, hash_documento, contenido,
            documento_html, emitido_por, emitido_at)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb, $7, $8::uuid, $9::timestamptz)
         RETURNING *`,
        tenantId, id, codigo, codigoVerificacion, hash, JSON.stringify(contenido),
        documentoHtml, req?.user?.sub ?? null, fecha.toISOString(),
      );

      await this.auditar(
        req, "certificado", rows[0].id, "emitir",
        { codigo, evidenciaId: id, hash, faltantes: faltantes.length ? faltantes : undefined },
        tx,
      );
      return rows[0];
    });
  }
}

// ===========================================================================
// Armas · ficha registral (DGMN)
// ===========================================================================

@ApiTags("saec · armas")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@RequierePermisoCrud({ ver: "arma.ver", crear: "arma.crear", editar: "arma.editar", eliminar: "arma.eliminar" })
@Controller("armas")
export class ArmaController extends SaecBase {
  private async cargarPropia(id: string, tenantId: string) {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT a.*, to_jsonb(e.*) AS evidencia
         FROM arma a
         LEFT JOIN evidencia e ON e.id = a.evidencia_id
        WHERE a.id = $1::uuid AND a.tenant_id = $2::uuid AND a.deleted_at IS NULL
        LIMIT 1`,
      id, tenantId,
    );
    if (!rows.length) throw new NotFoundException("Arma no encontrada");
    return rows[0];
  }

  @Get()
  async listar(
    @Query("page") page?: string, @Query("limit") limit?: string,
    @Query("estadoRegistral") estadoRegistral?: string, @Query("tipo") tipo?: string,
    @Query("q") q?: string, @Req() req?: any,
  ) {
    const tenantId = this.tenantId(req);
    const { p, l, offset } = this.paginacion(page, limit);

    const filtros: string[] = [];
    const args: any[] = [tenantId];
    if (estadoRegistral) { args.push(estadoRegistral); filtros.push(`AND a.estado_registral = $${args.length}`); }
    if (tipo) { args.push(tipo); filtros.push(`AND a.tipo = $${args.length}`); }
    if (q) {
      args.push(`%${q}%`);
      filtros.push(`AND (a.serie ILIKE $${args.length} OR a.marca ILIKE $${args.length}
                        OR a.modelo ILIKE $${args.length} OR a.inscripcion_dgmn ILIKE $${args.length})`);
    }
    const where = filtros.join(" ");

    const data = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT a.*, e.codigo AS evidencia_codigo
         FROM arma a
         LEFT JOIN evidencia e ON e.id = a.evidencia_id
        WHERE a.tenant_id = $1::uuid AND a.deleted_at IS NULL ${where}
        ORDER BY a.created_at DESC
        LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      ...args, l, offset,
    );
    const totalRows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS total FROM arma a
        WHERE a.tenant_id = $1::uuid AND a.deleted_at IS NULL ${where}`,
      ...args,
    );
    return { data, meta: { page: p, limit: l, total: Number(totalRows[0]?.total ?? 0) } };
  }

  @Get(":id")
  async detalle(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const tenantId = this.tenantId(req);
    const arma = await this.cargarPropia(id, tenantId);
    const consultasDgmn = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM saec_integracion_evento
        WHERE tenant_id = $1::uuid AND arma_id = $2::uuid AND deleted_at IS NULL
        ORDER BY created_at DESC`,
      tenantId, id,
    );
    return { ...arma, consultasDgmn };
  }

  @Post()
  async crear(@Body() body: unknown, @Req() req: any) {
    const tenantId = this.tenantId(req);
    const d = CrearArmaSchema.parse(body);
    if (!d.serie && !d.serieBorrada) {
      throw new BadRequestException("Indique el número de serie o marque la serie como borrada/limada.");
    }
    if (d.evidenciaId) {
      const ev = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT id FROM evidencia WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL`,
        d.evidenciaId, tenantId,
      );
      if (!ev.length) throw new NotFoundException("Evidencia no encontrada");
    }

    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `INSERT INTO arma
         (tenant_id, evidencia_id, serie, serie_borrada, marca, modelo, calibre, tipo,
          estado_registral, inscripcion_dgmn, fecha_inscripcion_dgmn, propietario_registrado,
          rut_propietario, estado, ubicacion, observaciones, created_by)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11::date, $12, $13, $14, $15, $16, $17::uuid)
       RETURNING *`,
      tenantId, d.evidenciaId ?? null, d.serie ?? null, d.serieBorrada ?? false,
      d.marca ?? null, d.modelo ?? null, d.calibre ?? null, d.tipo,
      d.estadoRegistral ?? "no_inscrita", d.inscripcionDgmn ?? null, d.fechaInscripcionDgmn ?? null,
      d.propietarioRegistrado ?? null, d.rutPropietario ?? null, d.estado ?? "en_custodia",
      d.ubicacion ?? null, d.observaciones ?? null, req?.user?.sub ?? null,
    );
    await this.auditar(req, "arma", rows[0].id, "crear", { serie: d.serie, marca: d.marca });
    return rows[0];
  }

  @Patch(":id")
  async actualizar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const tenantId = this.tenantId(req);
    const d = ActualizarArmaSchema.parse(body) as Record<string, unknown>;
    await this.cargarPropia(id, tenantId);

    const args: any[] = [id, tenantId];
    const sets = this.construirSet(d, COLS_ARMA, CAST_ARMA, args);
    if (!sets.length) return this.cargarPropia(id, tenantId);

    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `UPDATE arma SET ${sets.join(", ")}
        WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL
        RETURNING *`,
      ...args,
    );
    await this.auditar(req, "arma", id, "editar", d);
    return rows[0];
  }

  @Delete(":id")
  async eliminar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const tenantId = this.tenantId(req);
    await this.cargarPropia(id, tenantId);
    await this.prisma.$executeRawUnsafe(
      `UPDATE arma SET deleted_at = now() WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL`,
      id, tenantId,
    );
    await this.auditar(req, "arma", id, "eliminar");
    return { ok: true };
  }
}

// ===========================================================================
// RF-K05 · Cadena de custodia
// ===========================================================================

@ApiTags("saec · custodia")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("custodia-evidencia")
export class CustodiaEvidenciaController extends SaecBase {
  /** RF-K05.1 · trazabilidad completa de una evidencia. */
  @Get()
  @RequierePermiso("evidencia.ver")
  async listar(
    @Query("evidenciaId") evidenciaId?: string,
    @Query("page") page?: string, @Query("limit") limit?: string, @Req() req?: any,
  ) {
    const tenantId = this.tenantId(req);
    const { p, l, offset } = this.paginacion(page, limit);

    const args: any[] = [tenantId];
    let filtro = "";
    if (evidenciaId) {
      if (!/^[0-9a-f-]{36}$/i.test(evidenciaId)) throw new BadRequestException("evidenciaId no es un UUID válido");
      // Valida pertenencia: 404 si la evidencia es de otro tenant.
      const ev = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT id FROM evidencia WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL`,
        evidenciaId, tenantId,
      );
      if (!ev.length) throw new NotFoundException("Evidencia no encontrada");
      args.push(evidenciaId);
      filtro = `AND m.evidencia_id = $${args.length}::uuid`;
    }

    const data = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT m.*, e.codigo AS evidencia_codigo,
              du.nombre_completo AS desde_usuario, hu.nombre_completo AS hacia_usuario,
              rp.nombre_completo AS registrado_por_nombre
         FROM evidencia_movimiento m
         JOIN evidencia e       ON e.id = m.evidencia_id
         LEFT JOIN usuario du   ON du.id = m.desde_usuario_id
         LEFT JOIN usuario hu   ON hu.id = m.hacia_usuario_id
         LEFT JOIN usuario rp   ON rp.id = m.registrado_por
        WHERE m.tenant_id = $1::uuid ${filtro}
        ORDER BY m.fecha DESC
        LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      ...args, l, offset,
    );
    const totalRows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS total FROM evidencia_movimiento m
        WHERE m.tenant_id = $1::uuid ${filtro}`,
      ...args,
    );
    return { data, meta: { page: p, limit: l, total: Number(totalRows[0]?.total ?? 0) } };
  }

  /** RF-K05.1 · registrar un traspaso. El registro es inmutable (RF-K05.2). */
  @Post()
  @RequierePermiso("evidencia.custodiar")
  async registrar(@Body() body: unknown, @Req() req: any) {
    const tenantId = this.tenantId(req);
    const d = CrearMovimientoSchema.parse(body);

    const ev = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM evidencia WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL`,
      d.evidenciaId, tenantId,
    );
    if (!ev.length) throw new NotFoundException("Evidencia no encontrada");
    const evidencia = ev[0];

    // La firma del acta se guarda como huella SHA-256, nunca en claro.
    const firmaHash = d.firmaTexto ? createHash("sha256").update(d.firmaTexto).digest("hex") : null;

    return this.prisma.$transaction(async (tx: ClienteSql) => {
      const rows = await tx.$queryRawUnsafe<any[]>(
        `INSERT INTO evidencia_movimiento
           (tenant_id, evidencia_id, evento, fecha, desde_usuario_id, hacia_usuario_id,
            desde_organismo, hacia_organismo, ubicacion_origen, ubicacion_destino,
            motivo, sello_numero, sello_integro, firma_nombre, firma_hash, firma_electronica_id,
            observaciones, registrado_por, ip_origen)
         VALUES ($1::uuid, $2::uuid, $3, COALESCE($4::timestamptz, now()), $5::uuid, $6::uuid,
                 $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::uuid, $17, $18::uuid, $19::inet)
         RETURNING *`,
        tenantId, d.evidenciaId, d.evento, d.fecha ?? null,
        d.desdeUsuarioId ?? null, d.haciaUsuarioId ?? null,
        d.desdeOrganismo ?? null, d.haciaOrganismo ?? null,
        d.ubicacionOrigen ?? evidencia.ubicacion ?? null, d.ubicacionDestino ?? null,
        d.motivo, d.selloNumero ?? null, d.selloIntegro ?? null,
        d.firmaNombre ?? null, firmaHash, d.firmaElectronicaId ?? null,
        d.observaciones ?? null, req?.user?.sub ?? null, this.ip(req),
      );

      // RF-K05.1 / K06.3 · el movimiento actualiza ubicación y estado de la evidencia.
      const nuevoEstado =
        d.evento === "prestamo" || d.evento === "salida" ? "prestada"
        : d.evento === "devolucion" ? "almacenada"
        : d.evento === "destruccion" ? "destruida"
        : d.evento === "analisis" ? "en_analisis"
        : null;

      if (d.ubicacionDestino || nuevoEstado) {
        await tx.$executeRawUnsafe(
          `UPDATE evidencia
              SET ubicacion = COALESCE($3, ubicacion),
                  estado    = COALESCE($4, estado)
            WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL`,
          d.evidenciaId, tenantId, d.ubicacionDestino ?? null, nuevoEstado,
        );
      }

      await this.auditar(req, "evidencia", d.evidenciaId, "custodiar", { evento: d.evento, motivo: d.motivo }, tx);
      return rows[0];
    });
  }
}

// ===========================================================================
// RF-K06 · Préstamo / devolución
// ===========================================================================

@ApiTags("saec · préstamos")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("prestamos-evidencia")
export class PrestamoEvidenciaController extends SaecBase {
  private async cargarPropio(id: string, tenantId: string) {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT p.*, e.codigo AS evidencia_codigo, e.estado AS evidencia_estado, e.ubicacion
         FROM evidencia_prestamo p
         JOIN evidencia e ON e.id = p.evidencia_id
        WHERE p.id = $1::uuid AND p.tenant_id = $2::uuid AND p.deleted_at IS NULL
        LIMIT 1`,
      id, tenantId,
    );
    if (!rows.length) throw new NotFoundException("Solicitud de préstamo no encontrada");
    return rows[0];
  }

  @Get()
  @RequierePermiso("evidencia.ver")
  async listar(
    @Query("estado") estado?: string, @Query("evidenciaId") evidenciaId?: string,
    @Query("page") page?: string, @Query("limit") limit?: string, @Req() req?: any,
  ) {
    const tenantId = this.tenantId(req);
    const { p, l, offset } = this.paginacion(page, limit);
    const filtros: string[] = [];
    const args: any[] = [tenantId];
    if (estado) { args.push(estado); filtros.push(`AND p.estado = $${args.length}`); }
    if (evidenciaId) { args.push(evidenciaId); filtros.push(`AND p.evidencia_id = $${args.length}::uuid`); }
    const where = filtros.join(" ");

    const data = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT p.*, e.codigo AS evidencia_codigo, e.tipo AS evidencia_tipo
         FROM evidencia_prestamo p
         JOIN evidencia e ON e.id = p.evidencia_id
        WHERE p.tenant_id = $1::uuid AND p.deleted_at IS NULL ${where}
        ORDER BY p.created_at DESC
        LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      ...args, l, offset,
    );
    const totalRows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS total FROM evidencia_prestamo p
        WHERE p.tenant_id = $1::uuid AND p.deleted_at IS NULL ${where}`,
      ...args,
    );
    return { data, meta: { page: p, limit: l, total: Number(totalRows[0]?.total ?? 0) } };
  }

  /** RF-K06.2 · aprobación. */
  @Post(":id/aprobar")
  @RequierePermiso("evidencia.aprobar")
  async aprobar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const tenantId = this.tenantId(req);
    const p = await this.cargarPropio(id, tenantId);
    if (p.estado !== "solicitado") throw new BadRequestException(`La solicitud ya está en estado '${p.estado}'.`);
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `UPDATE evidencia_prestamo
          SET estado = 'aprobado', resuelto_por = $3::uuid, resuelto_at = now()
        WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL
        RETURNING *`,
      id, tenantId, req?.user?.sub ?? null,
    );
    await this.auditar(req, "prestamo", id, "aprobar", { codigo: p.codigo });
    return rows[0];
  }

  /** RF-K06.2 · rechazo. */
  @Post(":id/rechazar")
  @RequierePermiso("evidencia.aprobar")
  async rechazar(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const tenantId = this.tenantId(req);
    const { motivoRechazo } = z.object({ motivoRechazo: z.string().min(1) }).parse(body);
    const p = await this.cargarPropio(id, tenantId);
    if (p.estado !== "solicitado") throw new BadRequestException(`La solicitud ya está en estado '${p.estado}'.`);
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `UPDATE evidencia_prestamo
          SET estado = 'rechazado', motivo_rechazo = $3, resuelto_por = $4::uuid, resuelto_at = now()
        WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL
        RETURNING *`,
      id, tenantId, motivoRechazo, req?.user?.sub ?? null,
    );
    await this.auditar(req, "prestamo", id, "rechazar", { codigo: p.codigo, motivoRechazo });
    return rows[0];
  }

  /** RF-K06.3 · registro de salida + actualización de la ubicación. */
  @Post(":id/entregar")
  @RequierePermiso("evidencia.custodiar")
  async entregar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const tenantId = this.tenantId(req);
    const p = await this.cargarPropio(id, tenantId);
    if (p.estado !== "aprobado") throw new BadRequestException("Solo se puede entregar una solicitud aprobada.");

    return this.prisma.$transaction(async (tx: ClienteSql) => {
      const mov = await tx.$queryRawUnsafe<any[]>(
        `INSERT INTO evidencia_movimiento
           (tenant_id, evidencia_id, evento, desde_organismo, hacia_organismo, ubicacion_origen,
            motivo, firma_nombre, registrado_por, ip_origen)
         VALUES ($1::uuid, $2::uuid, 'prestamo', 'IDIC · Bodega de evidencias', $3, $4, $5, $6, $7::uuid, $8::inet)
         RETURNING id`,
        tenantId, p.evidencia_id, p.organismo_solicitante, p.ubicacion ?? null,
        `Entrega por solicitud ${p.codigo}: ${p.motivo}`, p.solicitante_nombre,
        req?.user?.sub ?? null, this.ip(req),
      );
      await tx.$executeRawUnsafe(
        `UPDATE evidencia SET estado = 'prestada', ubicacion = NULL
          WHERE id = $1::uuid AND tenant_id = $2::uuid`,
        p.evidencia_id, tenantId,
      );
      const rows = await tx.$queryRawUnsafe<any[]>(
        `UPDATE evidencia_prestamo SET estado = 'entregado', movimiento_salida_id = $3::uuid
          WHERE id = $1::uuid AND tenant_id = $2::uuid RETURNING *`,
        id, tenantId, mov[0].id,
      );
      await this.auditar(req, "prestamo", id, "editar", { accion: "entregar", codigo: p.codigo }, tx);
      return rows[0];
    });
  }

  /** RF-K06.3 · registro de entrada + actualización de la ubicación. */
  @Post(":id/devolver")
  @RequierePermiso("evidencia.custodiar")
  async devolver(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const tenantId = this.tenantId(req);
    const { ubicacionRetorno, observaciones } = z.object({
      ubicacionRetorno: strOpt(120),
      observaciones: textOpt,
    }).parse(body ?? {});
    const p = await this.cargarPropio(id, tenantId);
    if (p.estado !== "entregado") throw new BadRequestException("Solo se puede devolver una evidencia entregada.");

    return this.prisma.$transaction(async (tx: ClienteSql) => {
      const mov = await tx.$queryRawUnsafe<any[]>(
        `INSERT INTO evidencia_movimiento
           (tenant_id, evidencia_id, evento, desde_organismo, hacia_organismo, ubicacion_destino,
            motivo, observaciones, registrado_por, ip_origen)
         VALUES ($1::uuid, $2::uuid, 'devolucion', $3, 'IDIC · Bodega de evidencias', $4, $5, $6, $7::uuid, $8::inet)
         RETURNING id`,
        tenantId, p.evidencia_id, p.organismo_solicitante, (ubicacionRetorno as string) ?? null,
        `Devolución de la solicitud ${p.codigo}`, (observaciones as string) ?? null,
        req?.user?.sub ?? null, this.ip(req),
      );
      await tx.$executeRawUnsafe(
        `UPDATE evidencia SET estado = 'almacenada', ubicacion = COALESCE($3, ubicacion)
          WHERE id = $1::uuid AND tenant_id = $2::uuid`,
        p.evidencia_id, tenantId, (ubicacionRetorno as string) ?? null,
      );
      const rows = await tx.$queryRawUnsafe<any[]>(
        `UPDATE evidencia_prestamo
            SET estado = 'devuelto', movimiento_retorno_id = $3::uuid, ubicacion_retorno = $4
          WHERE id = $1::uuid AND tenant_id = $2::uuid RETURNING *`,
        id, tenantId, mov[0].id, (ubicacionRetorno as string) ?? null,
      );
      await this.auditar(req, "prestamo", id, "editar", { accion: "devolver", codigo: p.codigo }, tx);
      return rows[0];
    });
  }
}

// ===========================================================================
// RF-K03 · Importación IBIS/Forensic · ETL del XML ESI v3.2
// ===========================================================================

@ApiTags("saec · ibis")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("ibis")
export class IbisController extends SaecBase {
  /** RF-K03.4 · bitácora de importación. */
  @Get("importaciones")
  @RequierePermiso("ibis.ver")
  async listarImportaciones(@Query("page") page?: string, @Query("limit") limit?: string, @Req() req?: any) {
    const tenantId = this.tenantId(req);
    const { p, l, offset } = this.paginacion(page, limit);
    const data = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT i.id, i.nombre_archivo, i.hash_sha256, i.tamano_bytes, i.version_esi, i.estado,
              i.casos_creados, i.casos_actualizados, i.evidencias_creadas, i.evidencias_actualizadas,
              i.hits_creados, i.peritajes_creados, i.eliminados, i.errores, i.bitacora,
              i.created_at, u.nombre_completo AS importado_por_nombre
         FROM ibis_importacion i
         LEFT JOIN usuario u ON u.id = i.importado_por
        WHERE i.tenant_id = $1::uuid AND i.deleted_at IS NULL
        ORDER BY i.created_at DESC
        LIMIT $2 OFFSET $3`,
      tenantId, l, offset,
    );
    const totalRows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS total FROM ibis_importacion WHERE tenant_id = $1::uuid AND deleted_at IS NULL`,
      tenantId,
    );
    return { data, meta: { page: p, limit: l, total: Number(totalRows[0]?.total ?? 0) } };
  }

  @Get("importaciones/:id")
  @RequierePermiso("ibis.ver")
  async detalleImportacion(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const tenantId = this.tenantId(req);
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM ibis_importacion
        WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL LIMIT 1`,
      id, tenantId,
    );
    if (!rows.length) throw new NotFoundException("Importación no encontrada");
    return rows[0];
  }

  /** RF-K03.2 · coincidencias (Hits) cruzadas por IBIS. */
  @Get("hits")
  @RequierePermiso("ibis.ver")
  async listarHits(@Query("estado") estado?: string, @Query("limit") limit?: string, @Req() req?: any) {
    const tenantId = this.tenantId(req);
    const { l } = this.paginacion("1", limit);
    const args: any[] = [tenantId];
    let filtro = "";
    if (estado) { args.push(estado); filtro = `AND h.estado = $${args.length}`; }
    const data = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT h.*, ea.codigo AS evidencia_a_codigo, eb.codigo AS evidencia_b_codigo,
              ca.numero_caso AS caso_a_numero, cb.numero_caso AS caso_b_numero
         FROM ibis_hit h
         LEFT JOIN evidencia ea ON ea.id = h.evidencia_a_id
         LEFT JOIN evidencia eb ON eb.id = h.evidencia_b_id
         LEFT JOIN saec_caso ca ON ca.id = h.caso_a_id
         LEFT JOIN saec_caso cb ON cb.id = h.caso_b_id
        WHERE h.tenant_id = $1::uuid AND h.deleted_at IS NULL ${filtro}
        ORDER BY h.created_at DESC
        LIMIT $${args.length + 1}`,
      ...args, l,
    );
    return { data, meta: { total: data.length } };
  }

  /**
   * RF-K03.1–K03.4 · ETL de un XML ESI v3.2 depositado por Forensic.
   *
   * RF-K03.1 dice que Forensic deposita el fichero en una CARPETA FTP. Este
   * endpoint recibe el XML en el body (es lo que consume la pantalla de
   * importación manual y lo que permite reprocesar un fichero). El barrido
   * automático del FTP es un worker programado que debe llamar a este mismo
   * endpoint: no se implementa aquí porque la ruta/credenciales del FTP son un
   * dato pendiente del cliente (ver informe).
   *
   * Toda la carga es atómica: o entra el XML completo o no entra nada.
   */
  @Post("importar")
  @RequierePermiso("ibis.importar")
  async importar(@Body() body: unknown, @Req() req: any) {
    const tenantId = this.tenantId(req);
    const d = ImportarIbisSchema.parse(body);
    const xml = d.xml.trim();
    const hash = createHash("sha256").update(xml, "utf8").digest("hex");

    // RF-K03.4 · control de archivos ya procesados: no reprocesar.
    const previa = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, created_at, estado, resultado FROM ibis_importacion
        WHERE tenant_id = $1::uuid AND hash_sha256 = $2 AND deleted_at IS NULL LIMIT 1`,
      tenantId, hash,
    );
    if (previa.length && !d.forzar) {
      return {
        data: {
          duplicado: true,
          importacionId: previa[0].id,
          procesadoAt: previa[0].created_at,
          estado: previa[0].estado,
          mensaje: "Este archivo ya fue procesado (RF-K03.4). Use forzar=true para reprocesarlo.",
          resultado: previa[0].resultado,
        },
      };
    }

    // --- parseo -------------------------------------------------------------
    let raiz: NodoXml;
    try {
      raiz = parsearXml(xml);
    } catch (e: any) {
      // El fallo de parseo también se registra en la bitácora (RF-K03.4).
      const err = [{ tipo: "parseo", mensaje: e?.message ?? String(e) }];
      const rows = await this.prisma.$queryRawUnsafe<any[]>(
        `INSERT INTO ibis_importacion
           (tenant_id, nombre_archivo, hash_sha256, xml_crudo, tamano_bytes, estado, errores, importado_por, ip_origen)
         VALUES ($1::uuid, $2, $3, $4, $5, 'error', $6::jsonb, $7::uuid, $8::inet)
         ON CONFLICT (tenant_id, hash_sha256) DO UPDATE SET estado = 'error', errores = EXCLUDED.errores
         RETURNING id`,
        tenantId, d.nombreArchivo ?? null, hash, xml, Buffer.byteLength(xml, "utf8"),
        JSON.stringify(err), req?.user?.sub ?? null, this.ip(req),
      );
      await this.auditar(req, "ibis", rows[0]?.id ?? null, "importar", { estado: "error", error: e?.message });
      throw new BadRequestException(`XML ESI no válido: ${e?.message ?? e}`);
    }

    if (raiz.nombre !== "Export") {
      throw new BadRequestException(`La raíz del XML ESI debe ser <Export> y es <${raiz.nombre}>.`);
    }

    const bitacora: any[] = [];
    const errores: any[] = [];
    const contadores = {
      casosCreados: 0, casosActualizados: 0,
      evidenciasCreadas: 0, evidenciasActualizadas: 0,
      hitsCreados: 0, peritajesCreados: 0, eliminados: 0,
    };
    const correlaciones: any[] = [];

    const resultado = await this.prisma.$transaction(async (tx: ClienteSql) => {
      // ---------------- Casos (Cases) ----------------
      for (const c of buscarElementos(raiz, "Cases", "Case")) {
        try {
          const uuid = txt(c, "UUID");
          const numero = txt(c, "CaseNumber");
          if (!uuid && !numero) { errores.push({ tipo: "case", mensaje: "Case sin UUID ni CaseNumber" }); continue; }
          const evento = codigoTexto(c, "EventType");

          const existe = await tx.$queryRawUnsafe<any[]>(
            `SELECT id FROM saec_caso
              WHERE tenant_id = $1::uuid AND deleted_at IS NULL
                AND ((uuid_ibis IS NOT NULL AND uuid_ibis = $2) OR numero_caso = $3)
              LIMIT 1`,
            tenantId, uuid, numero,
          );

          const valores = [
            uuid, numero ?? uuid, txt(c, "OriginatingAgencyReference"), txt(c, "OriginatingAgencyName"),
            evento.codigo, evento.texto, fechaEsi(txt(c, "OccurrenceDate")),
            boolEsi(txt(c, "Restricted")) ?? false, boolEsi(txt(c, "HighProfile")) ?? false,
            boolEsi(txt(c, "HitIndicator")) ?? false, txt(c, "Comment"),
          ];

          if (existe.length) {
            await tx.$executeRawUnsafe(
              `UPDATE saec_caso
                  SET uuid_ibis = COALESCE($3, uuid_ibis), numero_caso = COALESCE($4, numero_caso),
                      agencia_origen_ref = COALESCE($5, agencia_origen_ref),
                      agencia_origen_nombre = COALESCE($6, agencia_origen_nombre),
                      tipo_evento_codigo = COALESCE($7, tipo_evento_codigo),
                      tipo_evento_texto = COALESCE($8, tipo_evento_texto),
                      fecha_ocurrencia = COALESCE($9::timestamptz, fecha_ocurrencia),
                      restringido = $10, alto_perfil = $11, hit_indicator = $12,
                      comentario = COALESCE($13, comentario), origen = 'ibis'
                WHERE id = $1::uuid AND tenant_id = $2::uuid`,
              existe[0].id, tenantId, ...valores,
            );
            contadores.casosActualizados++;
            bitacora.push({ entidad: "Case", accion: "actualizado", numero, uuid });
          } else {
            await tx.$executeRawUnsafe(
              `INSERT INTO saec_caso
                 (tenant_id, uuid_ibis, numero_caso, agencia_origen_ref, agencia_origen_nombre,
                  tipo_evento_codigo, tipo_evento_texto, fecha_ocurrencia, restringido, alto_perfil,
                  hit_indicator, comentario, origen, estado)
               VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9, $10, $11, $12, 'ibis', 'abierto')`,
              tenantId, ...valores,
            );
            contadores.casosCreados++;
            bitacora.push({ entidad: "Case", accion: "creado", numero, uuid });
          }
        } catch (e: any) {
          errores.push({ tipo: "case", mensaje: e?.message ?? String(e) });
        }
      }

      // ---------------- Evidencias (Exhibits) ----------------
      for (const x of buscarElementos(raiz, "Exhibits", "Exhibit")) {
        try {
          const uuid = txt(x, "UUID");
          if (!uuid) { errores.push({ tipo: "exhibit", mensaje: "Exhibit sin UUID" }); continue; }
          const parentUuid = txt(x, "ParentUUID");
          const exhibitNumber = txt(x, "ExhibitNumber");
          const tipoEsi = (txt(x, "Type") ?? "").toLowerCase();
          // RF-K02.3 · tipificación a partir del Type del ESI.
          const tipo = tipoEsi.includes("cartridge") ? "vainilla"
            : tipoEsi.includes("bullet") ? "proyectil"
            : tipoEsi.includes("firearm") || tipoEsi.includes("weapon") ? "arma"
            : "otro";

          const categoria = codigoTexto(x, "Category");
          const calibre = codigoTexto(x, "Caliber");
          const fps = codigoTexto(x, "FiringPinShape");
          const bfc = codigoTexto(x, "BreechFaceClassCharacteristics");
          const hitCount = intEsi(txt(x, "HitIndicator") ?? txt(hijo(x, "HitIndicator"), "Count"));

          const casoRows = parentUuid
            ? await tx.$queryRawUnsafe<any[]>(
                `SELECT id FROM saec_caso WHERE tenant_id = $1::uuid AND uuid_ibis = $2 AND deleted_at IS NULL LIMIT 1`,
                tenantId, parentUuid)
            : [];
          const casoId = casoRows[0]?.id ?? null;
          if (parentUuid && !casoId) {
            errores.push({ tipo: "exhibit", uuid, mensaje: `ParentUUID ${parentUuid} sin caso correspondiente` });
          }

          const existe = await tx.$queryRawUnsafe<any[]>(
            `SELECT id, codigo FROM evidencia
              WHERE tenant_id = $1::uuid AND uuid_ibis = $2 AND deleted_at IS NULL LIMIT 1`,
            tenantId, uuid,
          );

          const fpsTexto = [fps.codigo, fps.texto].filter(Boolean).join(" · ") || null;
          const bfcTexto = [bfc.codigo, bfc.texto].filter(Boolean).join(" · ") || null;

          let evidenciaId: string;
          if (existe.length) {
            await tx.$executeRawUnsafe(
              `UPDATE evidencia
                  SET caso_id = COALESCE($3::uuid, caso_id),
                      exhibit_number = COALESCE($4, exhibit_number),
                      tipo = $5,
                      categoria_codigo = COALESCE($6, categoria_codigo),
                      categoria_texto = COALESCE($7, categoria_texto),
                      calibre_codigo = COALESCE($8, calibre_codigo),
                      calibre_texto = COALESCE($9, calibre_texto),
                      firing_pin_shape = COALESCE($10, firing_pin_shape),
                      breech_face_class = COALESCE($11, breech_face_class),
                      marca = COALESCE($12, marca),
                      composicion = COALESCE($13, composicion),
                      hit_count = $14
                WHERE id = $1::uuid AND tenant_id = $2::uuid`,
              existe[0].id, tenantId, casoId, exhibitNumber, tipo,
              categoria.codigo, categoria.texto, calibre.codigo, calibre.texto,
              fpsTexto, bfcTexto, txt(x, "Make"), txt(x, "Composition"), hitCount,
            );
            evidenciaId = existe[0].id;
            contadores.evidenciasActualizadas++;
            bitacora.push({ entidad: "Exhibit", accion: "actualizado", exhibitNumber, uuid });
          } else {
            const codigo = await this.siguienteCodigo("evidencia", "EV-2026-", tenantId, tx);
            const ins = await tx.$queryRawUnsafe<any[]>(
              `INSERT INTO evidencia
                 (tenant_id, codigo, uuid_ibis, caso_id, exhibit_number, tipo, descripcion,
                  categoria_codigo, categoria_texto, calibre_codigo, calibre_texto,
                  firing_pin_shape, breech_face_class, marca, composicion, hit_count,
                  estado, codigo_barras, soporte, procedencia, organismo_solicitante)
               VALUES ($1::uuid, $2, $3, $4::uuid, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
                       'analizada', $2, 'fisica', 'Importación IBIS/Forensic (ESI v3.2)', 'IBIS')
               RETURNING id`,
              tenantId, codigo, uuid, casoId, exhibitNumber, tipo,
              `Elemento importado desde IBIS/Forensic (${exhibitNumber ?? uuid}).`,
              categoria.codigo, categoria.texto, calibre.codigo, calibre.texto,
              fpsTexto, bfcTexto, txt(x, "Make"), txt(x, "Composition"), hitCount,
            );
            evidenciaId = ins[0].id;
            contadores.evidenciasCreadas++;
            bitacora.push({ entidad: "Exhibit", accion: "creado", exhibitNumber, uuid, codigo });

            // La evidencia nace en la cadena de custodia (RF-K05.1).
            await tx.$executeRawUnsafe(
              `INSERT INTO evidencia_movimiento (tenant_id, evidencia_id, evento, desde_organismo, hacia_organismo, motivo, registrado_por, ip_origen)
               VALUES ($1::uuid, $2::uuid, 'entrada', 'IBIS/Forensic', 'IDIC · SAEC', $3, $4::uuid, $5::inet)`,
              tenantId, evidenciaId,
              "Alta automática por importación del XML ESI v3.2 de IBIS/Forensic (RF-K03.3).",
              req?.user?.sub ?? null, this.ip(req),
            );
          }

          // RF-K03.3 · carga de los resultados balísticos en la ficha (upsert).
          const peritajeExiste = await tx.$queryRawUnsafe<any[]>(
            `SELECT id FROM peritaje_balistico
              WHERE tenant_id = $1::uuid AND evidencia_id = $2::uuid AND origen = 'ibis' AND deleted_at IS NULL
              LIMIT 1`,
            tenantId, evidenciaId,
          );
          const datosEsi = JSON.stringify({
            uuid, exhibitNumber, type: txt(x, "Type"),
            category: categoria, caliber: calibre, firingPinShape: fps,
            breechFaceClassCharacteristics: bfc,
            make: txt(x, "Make"), composition: txt(x, "Composition"), hitCount,
          });
          if (peritajeExiste.length) {
            await tx.$executeRawUnsafe(
              `UPDATE peritaje_balistico
                  SET calibre_texto = $3, firing_pin_shape = $4, breech_face_class = $5,
                      hit_count = $6, resultado = $7, datos = $8::jsonb, fecha_peritaje = now()
                WHERE id = $1::uuid AND tenant_id = $2::uuid`,
              peritajeExiste[0].id, tenantId, calibre.texto, fpsTexto, bfcTexto,
              hitCount, hitCount > 0 ? "concluyente" : "sin_coincidencia", datosEsi,
            );
          } else {
            await tx.$executeRawUnsafe(
              `INSERT INTO peritaje_balistico
                 (tenant_id, evidencia_id, origen, uuid_ibis, calibre_texto, firing_pin_shape,
                  breech_face_class, hit_count, resultado, datos)
               VALUES ($1::uuid, $2::uuid, 'ibis', $3, $4, $5, $6, $7, $8, $9::jsonb)`,
              tenantId, evidenciaId, uuid, calibre.texto, fpsTexto, bfcTexto,
              hitCount, hitCount > 0 ? "concluyente" : "sin_coincidencia", datosEsi,
            );
            contadores.peritajesCreados++;
          }
        } catch (e: any) {
          errores.push({ tipo: "exhibit", mensaje: e?.message ?? String(e) });
        }
      }

      // ---------------- Coincidencias (Hits) ----------------
      for (const h of buscarElementos(raiz, "Hits", "Hit")) {
        try {
          const uuid = txt(h, "UUID");
          // Los dos extremos del cruce: el ESI los nombra de varias formas según el perfil.
          const uuidA = txt(h, "ExhibitUUID") ?? txt(h, "SourceExhibitUUID") ?? txt(h, "FromExhibitUUID");
          const uuidB = txt(h, "MatchedExhibitUUID") ?? txt(h, "TargetExhibitUUID") ?? txt(h, "ToExhibitUUID");
          if (!uuidA && !uuidB) { errores.push({ tipo: "hit", uuid, mensaje: "Hit sin evidencias correlacionadas" }); continue; }

          const resolver = async (u: string | null) => {
            if (!u) return null;
            const r = await tx.$queryRawUnsafe<any[]>(
              `SELECT id, codigo, caso_id FROM evidencia
                WHERE tenant_id = $1::uuid AND uuid_ibis = $2 AND deleted_at IS NULL LIMIT 1`,
              tenantId, u,
            );
            return r[0] ?? null;
          };
          const a = await resolver(uuidA);
          const b = await resolver(uuidB);
          const score = parseFloat(txt(h, "Score") ?? txt(h, "MatchScore") ?? "");

          const existe = uuid
            ? await tx.$queryRawUnsafe<any[]>(
                `SELECT id FROM ibis_hit WHERE tenant_id = $1::uuid AND uuid_ibis = $2 LIMIT 1`, tenantId, uuid)
            : [];

          if (existe.length) {
            await tx.$executeRawUnsafe(
              `UPDATE ibis_hit
                  SET evidencia_a_id = COALESCE($3::uuid, evidencia_a_id),
                      evidencia_b_id = COALESCE($4::uuid, evidencia_b_id),
                      score = COALESCE($5, score), deleted_at = NULL, datos = $6::jsonb
                WHERE id = $1::uuid AND tenant_id = $2::uuid`,
              existe[0].id, tenantId, a?.id ?? null, b?.id ?? null,
              Number.isFinite(score) ? score : null,
              JSON.stringify({ uuid, uuidA, uuidB, score }),
            );
          } else {
            await tx.$executeRawUnsafe(
              `INSERT INTO ibis_hit
                 (tenant_id, uuid_ibis, evidencia_a_id, evidencia_b_id, uuid_evidencia_a, uuid_evidencia_b,
                  caso_a_id, caso_b_id, score, fecha_hit, datos)
               VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5, $6, $7::uuid, $8::uuid, $9, $10::timestamptz, $11::jsonb)`,
              tenantId, uuid, a?.id ?? null, b?.id ?? null, uuidA, uuidB,
              a?.caso_id ?? null, b?.caso_id ?? null,
              Number.isFinite(score) ? score : null,
              fechaEsi(txt(h, "HitDate") ?? txt(h, "Date")),
              JSON.stringify({ uuid, uuidA, uuidB, score }),
            );
            contadores.hitsCreados++;
          }
          correlaciones.push({
            uuid,
            evidenciaA: a?.codigo ?? uuidA,
            evidenciaB: b?.codigo ?? uuidB,
            score: Number.isFinite(score) ? score : null,
            resueltas: Boolean(a && b),
          });
          bitacora.push({ entidad: "Hit", accion: existe.length ? "actualizado" : "creado", uuid });
        } catch (e: any) {
          errores.push({ tipo: "hit", mensaje: e?.message ?? String(e) });
        }
      }

      // ---------------- Bloques de borrado (Removed*) ----------------
      const borrar = async (bloque: string, tabla: string) => {
        const cont = buscarTodos(raiz, bloque);
        for (const nodo of cont) {
          const uuids = [
            ...(nodo.texto ? [nodo.texto] : []),
            ...buscarTodos(nodo, "UUID").map((u) => u.texto),
            ...nodo.hijos.map((hh) => txt(hh, "UUID")).filter(Boolean) as string[],
          ].filter(Boolean);
          for (const u of new Set(uuids)) {
            const n = await tx.$executeRawUnsafe(
              `UPDATE ${tabla} SET deleted_at = now()
                WHERE tenant_id = $1::uuid AND uuid_ibis = $2 AND deleted_at IS NULL`,
              tenantId, u,
            );
            if (n) { contadores.eliminados += Number(n); bitacora.push({ entidad: bloque, accion: "eliminado", uuid: u }); }
          }
        }
      };
      await borrar("RemovedCases", "saec_caso");
      await borrar("RemovedExhibits", "evidencia");
      await borrar("RemovedHits", "ibis_hit");

      // ---------------- Registro de la importación ----------------
      const estado = errores.length === 0 ? "procesado" : (
        contadores.casosCreados + contadores.evidenciasCreadas + contadores.hitsCreados > 0 ? "parcial" : "error"
      );
      const resumen = { ...contadores, correlaciones, estado, hash };

      const imp = await tx.$queryRawUnsafe<any[]>(
        `INSERT INTO ibis_importacion
           (tenant_id, nombre_archivo, hash_sha256, xml_crudo, tamano_bytes, version_esi, estado,
            casos_creados, casos_actualizados, evidencias_creadas, evidencias_actualizadas,
            hits_creados, peritajes_creados, eliminados, errores, bitacora, resultado,
            importado_por, ip_origen)
         VALUES ($1::uuid, $2, $3, $4, $5, '3.2', $6, $7, $8, $9, $10, $11, $12, $13,
                 $14::jsonb, $15::jsonb, $16::jsonb, $17::uuid, $18::inet)
         ON CONFLICT (tenant_id, hash_sha256) DO UPDATE
           SET estado = EXCLUDED.estado, errores = EXCLUDED.errores, bitacora = EXCLUDED.bitacora,
               resultado = EXCLUDED.resultado, casos_creados = EXCLUDED.casos_creados,
               casos_actualizados = EXCLUDED.casos_actualizados,
               evidencias_creadas = EXCLUDED.evidencias_creadas,
               evidencias_actualizadas = EXCLUDED.evidencias_actualizadas,
               hits_creados = EXCLUDED.hits_creados, peritajes_creados = EXCLUDED.peritajes_creados,
               eliminados = EXCLUDED.eliminados
         RETURNING id, created_at`,
        tenantId, d.nombreArchivo ?? null, hash, xml, Buffer.byteLength(xml, "utf8"), estado,
        contadores.casosCreados, contadores.casosActualizados,
        contadores.evidenciasCreadas, contadores.evidenciasActualizadas,
        contadores.hitsCreados, contadores.peritajesCreados, contadores.eliminados,
        JSON.stringify(errores), JSON.stringify(bitacora), JSON.stringify(resumen),
        req?.user?.sub ?? null, this.ip(req),
      );

      // Enlaza los peritajes de esta pasada con la importación que los generó.
      await tx.$executeRawUnsafe(
        `UPDATE peritaje_balistico SET ibis_importacion_id = $1::uuid
          WHERE tenant_id = $2::uuid AND origen = 'ibis' AND ibis_importacion_id IS NULL`,
        imp[0].id, tenantId,
      );
      await tx.$executeRawUnsafe(
        `UPDATE ibis_hit SET ibis_importacion_id = $1::uuid
          WHERE tenant_id = $2::uuid AND ibis_importacion_id IS NULL`,
        imp[0].id, tenantId,
      );

      await this.auditar(req, "ibis", imp[0].id, "importar", { hash, ...contadores, estado }, tx);

      return {
        duplicado: false,
        importacionId: imp[0].id,
        procesadoAt: imp[0].created_at,
        nombreArchivo: d.nombreArchivo ?? null,
        hash,
        versionEsi: "3.2",
        estado,
        ...contadores,
        correlaciones,
        errores,
        bitacora,
      };
    }, { timeout: 120_000 });

    return { data: resultado };
  }

  /** Confirma o descarta una coincidencia balística cruzada por IBIS. */
  @Post("hits/:id/estado")
  @RequierePermiso("peritaje.registrar")
  async cambiarEstadoHit(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const tenantId = this.tenantId(req);
    const { estado } = z.object({ estado: z.enum(["sin_confirmar", "confirmado", "descartado"]) }).parse(body);
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `UPDATE ibis_hit SET estado = $3, confirmado_por = $4::uuid
        WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL
        RETURNING *`,
      id, tenantId, estado, req?.user?.sub ?? null,
    );
    if (!rows.length) throw new NotFoundException("Coincidencia no encontrada");
    await this.auditar(req, "ibis", id, "editar", { hitEstado: estado });
    return rows[0];
  }
}

// ===========================================================================
// RF-K07 · Certificados y verificación pública
// ===========================================================================

@ApiTags("saec · certificados")
@Controller("saec/certificados")
export class SaecCertificadoController extends SaecBase {
  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard("jwt"), PermisoGuard)
  @RequierePermiso("evidencia.ver")
  async listar(@Query("page") page?: string, @Query("limit") limit?: string, @Req() req?: any) {
    const tenantId = this.tenantId(req);
    const { p, l, offset } = this.paginacion(page, limit);
    const data = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT c.*, e.codigo AS evidencia_codigo, u.nombre_completo AS emitido_por_nombre
         FROM saec_certificado c
         JOIN evidencia e   ON e.id = c.evidencia_id
         LEFT JOIN usuario u ON u.id = c.emitido_por
        WHERE c.tenant_id = $1::uuid AND c.deleted_at IS NULL
        ORDER BY c.emitido_at DESC
        LIMIT $2 OFFSET $3`,
      tenantId, l, offset,
    );
    const totalRows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS total FROM saec_certificado WHERE tenant_id = $1::uuid AND deleted_at IS NULL`,
      tenantId,
    );
    return { data, meta: { page: p, limit: l, total: Number(totalRows[0]?.total ?? 0) } };
  }

  /** Carga un certificado validando tenant (404 en cross-tenant, no 403). */
  private async certificadoDelTenant(id: string, tenantId: string) {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT c.*, e.codigo AS evidencia_codigo
         FROM saec_certificado c
         JOIN evidencia e ON e.id = c.evidencia_id
        WHERE c.id = $1::uuid AND c.tenant_id = $2::uuid AND c.deleted_at IS NULL
        LIMIT 1`,
      id, tenantId,
    );
    if (!rows.length) throw new NotFoundException("Certificado no encontrado");
    return rows[0];
  }

  /** El sello que va al pie del documento (fuera de lo hasheado). */
  private sello(c: any): Sello {
    return {
      numero: c.codigo,
      codigoVerificacion: c.codigo_verificacion ?? "—",
      hash: c.hash_documento ?? "",
      fecha: fmtFecha(c.emitido_at),
      urlVerificacion: `${(process.env.URL_VERIFICACION ?? "https://verificar.idic.cl/c").replace(/\/+$/, "")}/${c.codigo_verificacion}`,
    };
  }

  /**
   * Documento sellado de un certificado, o 404 explicando por qué no lo hay.
   * Un certificado sin `documento_html` es uno emitido antes de RF-K07.1: no se
   * puede reconstruir sin re-renderizar (y re-renderizar rompería el sello).
   */
  private documentoSellado(c: any): string {
    if (!c.documento_html) {
      throw new NotFoundException(
        `El certificado ${c.codigo} se emitió antes de que se guardara el documento sellado y no puede regenerarse. Emita uno nuevo.`,
      );
    }
    return c.documento_html;
  }

  /**
   * RF-K07.1 · PDF/A del certificado, generado desde el HTML SELLADO en la BD.
   *
   * No se re-renderiza a partir de la evidencia: el PDF de hoy y el de dentro de
   * un año son el mismo documento aunque la cadena de custodia haya seguido
   * creciendo o el peritaje se haya reabierto. Es lo que hace que el hash del
   * pie siga cuadrando.
   *
   * `evidencia.ver` y no `saec.certificado.emitir`: descargar un certificado ya
   * emitido es una LECTURA; quien consulta el expediente no tiene por qué poder
   * emitir. Mismo criterio que `informes/:id/pdf`.
   */
  @Get(":id/pdf")
  @ApiBearerAuth()
  @UseGuards(AuthGuard("jwt"), PermisoGuard)
  @RequierePermiso("evidencia.ver")
  async pdf(@Param("id", ParseUUIDPipe) id: string, @Req() req: any, @Res() res: Response) {
    const tenantId = this.tenantId(req);
    const c = await this.certificadoDelTenant(id, tenantId);
    const buffer = await generarPdf(
      this.documentoSellado(c),
      this.sello(c),
      tituloCertificadoSaec(c.codigo, c.evidencia_codigo),
    );
    // RF-K09.2 · quién se descarga el certificado de una evidencia forense es
    // justo lo que una auditoría quiere poder reconstruir.
    await this.auditar(req, "certificado", id, "descargar", { formato: "pdf", codigo: c.codigo });
    // Nombre de fichero seguro: saneado a [A-Za-z0-9._-], sin ruta ni comillas,
    // así no puede inyectar CRLF ni cerrar la cabecera.
    const nombre = `${String(c.codigo).replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${nombre}"`,
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(buffer);
  }

  /** Mismo documento en HTML imprimible (`@media print` A4). Alternativa al PDF. */
  @Get(":id/html")
  @ApiBearerAuth()
  @UseGuards(AuthGuard("jwt"), PermisoGuard)
  @RequierePermiso("evidencia.ver")
  @Header("Content-Type", "text/html; charset=utf-8")
  @Header("Cache-Control", "private, no-store")
  async html(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const tenantId = this.tenantId(req);
    const c = await this.certificadoDelTenant(id, tenantId);
    return documentoCompleto(
      this.documentoSellado(c),
      this.sello(c),
      tituloCertificadoSaec(c.codigo, c.evidencia_codigo),
    );
  }

  /**
   * RF-K07.3 · verificación PÚBLICA de la autenticidad de un certificado.
   *
   * Es deliberadamente @Public(): un tercero (fiscal, tribunal) valida el
   * documento sin cuenta en el LIMS. Por eso NO filtra por tenant (el código de
   * verificación es único global y aleatorio) y devuelve el mínimo
   * imprescindible: nunca el contenido íntegro ni datos del caso.
   *
   * INTEGRIDAD: el hash se RECALCULA sobre el documento sellado en lugar de leer
   * la columna `hash_documento`. Así el endpoint detecta también una
   * manipulación del hash directamente en la base de datos: quien altere el
   * documento tendría que alterar además la columna, y aun así no cuadraría con
   * lo que dice el papel. Antes se devolvía la columna tal cual, que es
   * autorreferencial y no prueba nada. Mismo criterio que
   * `PlantillaRenderService.verificar`.
   */
  @Get("verificar/:codigoVerificacion")
  @Public()
  async verificar(@Param("codigoVerificacion") codigo: string) {
    const limpio = (codigo ?? "").trim().toUpperCase();
    // Filtro de forma antes de tocar la BD: el código es corto y de alfabeto
    // conocido, no un UUID ni texto libre.
    if (!/^[0-9A-Z-]{5,24}$/.test(limpio)) {
      return { data: { valido: false, mensaje: "No existe ningún certificado con ese código de verificación." } };
    }
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT c.codigo, c.codigo_verificacion, c.hash_documento, c.documento_html, c.estado,
              c.emitido_at, c.anulado_at, e.codigo AS evidencia_codigo, t.nombre AS emisor
         FROM saec_certificado c
         JOIN evidencia e ON e.id = c.evidencia_id
         JOIN tenant t    ON t.id = c.tenant_id
        WHERE c.codigo_verificacion = $1 AND c.deleted_at IS NULL
        LIMIT 1`,
      limpio,
    );
    if (!rows.length) {
      return { data: { valido: false, mensaje: "No existe ningún certificado con ese código de verificación." } };
    }
    const c = rows[0];

    if (c.estado !== "emitido") {
      return {
        data: {
          valido: false, estado: c.estado, certificado: c.codigo,
          evidencia: c.evidencia_codigo, emisor: c.emisor,
          emitidoAt: c.emitido_at, anuladoAt: c.anulado_at,
          hashDocumento: c.hash_documento,
          mensaje: "El certificado existe pero está ANULADO.",
        },
      };
    }

    // Sin documento no se puede afirmar integridad. NO se da por válido: un
    // "válido" que no se ha comprobado es peor que un "no comprobable".
    const hashReal = c.documento_html
      ? createHash("sha256").update(c.documento_html, "utf8").digest("hex")
      : null;
    const integro = hashReal !== null && hashReal === c.hash_documento;

    return {
      data: {
        valido: integro,
        estado: c.estado,
        certificado: c.codigo,
        evidencia: c.evidencia_codigo,
        emisor: c.emisor,
        emitidoAt: c.emitido_at,
        anuladoAt: c.anulado_at,
        hashDocumento: c.hash_documento,
        mensaje: integro
          ? "Certificado auténtico. Compare el HASH con el impreso en el documento en su poder."
          : hashReal === null
            ? "Certificado registrado, pero se emitió sin documento sellado y su integridad NO puede comprobarse."
            : "ALERTA: el sello de integridad del documento no coincide. El certificado puede haber sido manipulado.",
      },
    };
  }

  @Post(":id/anular")
  @ApiBearerAuth()
  @UseGuards(AuthGuard("jwt"), PermisoGuard)
  @RequierePermiso("saec.certificado.emitir")
  async anular(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: any) {
    const tenantId = this.tenantId(req);
    const { motivo } = z.object({ motivo: z.string().min(1) }).parse(body);
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `UPDATE saec_certificado
          SET estado = 'anulado', anulado_at = now(), motivo_anulacion = $3
        WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL AND estado = 'emitido'
        RETURNING *`,
      id, tenantId, motivo,
    );
    if (!rows.length) throw new NotFoundException("Certificado no encontrado o ya anulado");
    await this.auditar(req, "certificado", id, "editar", { anulado: true, motivo });
    return rows[0];
  }
}

// ===========================================================================
// RF-K08 · Integraciones externas de entrada + notificaciones
// ===========================================================================

@ApiTags("saec · integraciones")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("saec/integraciones")
export class SaecIntegracionController extends SaecBase {
  @Get()
  @RequierePermiso("evidencia.ver")
  async listar(
    @Query("origen") origen?: string, @Query("estado") estado?: string,
    @Query("page") page?: string, @Query("limit") limit?: string, @Req() req?: any,
  ) {
    const tenantId = this.tenantId(req);
    const { p, l, offset } = this.paginacion(page, limit);
    const filtros: string[] = [];
    const args: any[] = [tenantId];
    if (origen) { args.push(origen); filtros.push(`AND i.origen = $${args.length}`); }
    if (estado) { args.push(estado); filtros.push(`AND i.estado = $${args.length}`); }
    const where = filtros.join(" ");

    const data = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT i.*, e.codigo AS evidencia_codigo, a.serie AS arma_serie, c.numero_caso
         FROM saec_integracion_evento i
         LEFT JOIN evidencia e ON e.id = i.evidencia_id
         LEFT JOIN arma a      ON a.id = i.arma_id
         LEFT JOIN saec_caso c ON c.id = i.caso_id
        WHERE i.tenant_id = $1::uuid AND i.deleted_at IS NULL ${where}
        ORDER BY COALESCE(i.fecha_programada, i.created_at) DESC
        LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      ...args, l, offset,
    );
    const totalRows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS total FROM saec_integracion_evento i
        WHERE i.tenant_id = $1::uuid AND i.deleted_at IS NULL ${where}`,
      ...args,
    );
    return { data, meta: { page: p, limit: l, total: Number(totalRows[0]?.total ?? 0) } };
  }

  /**
   * RF-K08.1 / K08.2 / K08.3 · buzón de entrada asíncrono.
   * Registra lo que llega de la DGMN (API/WebService), el calendario de Aduanas
   * y las notificaciones a entidades. La conexión real con cada organismo queda
   * pendiente del contrato de interfaz de cada uno (ver informe): este endpoint
   * es el punto de entrada estable contra el que se programarán esos adaptadores.
   */
  @Post()
  @RequierePermiso("evidencia.editar")
  async registrar(@Body() body: unknown, @Req() req: any) {
    const tenantId = this.tenantId(req);
    const d = IntegracionSchema.parse(body);
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `INSERT INTO saec_integracion_evento
         (tenant_id, origen, direccion, tipo, referencia, evidencia_id, arma_id, caso_id,
          fecha_programada, ubicacion, payload)
       VALUES ($1::uuid, $2, $3, $4, $5, $6::uuid, $7::uuid, $8::uuid, $9::timestamptz, $10, $11::jsonb)
       RETURNING *`,
      tenantId, d.origen, d.direccion ?? "entrada", d.tipo, d.referencia ?? null,
      d.evidenciaId ?? null, d.armaId ?? null, d.casoId ?? null,
      d.fechaProgramada ?? null, d.ubicacion ?? null, JSON.stringify(d.payload ?? {}),
    );
    await this.auditar(req, "evidencia", d.evidenciaId ?? null, "editar", { integracion: d.origen, tipo: d.tipo });
    return rows[0];
  }

  @Post(":id/procesar")
  @RequierePermiso("evidencia.editar")
  async procesar(@Param("id", ParseUUIDPipe) id: string, @Req() req: any) {
    const tenantId = this.tenantId(req);
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `UPDATE saec_integracion_evento
          SET estado = 'procesado', procesado_at = now()
        WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL
        RETURNING *`,
      id, tenantId,
    );
    if (!rows.length) throw new NotFoundException("Evento de integración no encontrado");
    return rows[0];
  }
}

@Module({
  controllers: [
    SaecCasoController,
    EvidenciaController,
    ArmaController,
    CustodiaEvidenciaController,
    PrestamoEvidenciaController,
    IbisController,
    SaecCertificadoController,
    SaecIntegracionController,
  ],
})
export class SaecModule {}
