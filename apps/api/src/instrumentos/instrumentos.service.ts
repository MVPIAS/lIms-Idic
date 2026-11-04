import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, UnauthorizedException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import * as path from "path";
import { AuthService } from "../auth/auth.service";
import { PuenteAnalisisService } from "../flujo-real/flujo-real.module";
import { motivoNoCapturable } from "../laboratorio/flujo-resultado";
import { teniaValor } from "../laboratorio/traza";
import { AlcanceService } from "../rbac/alcance.service";
import { FORMATOS, LecturaError, SEPARADORES, decodificar, leerArchivo, normalizar, type FilaLeida, type Perfil } from "./lector";
import { IngestaError, datosDispositivo, generarToken, hashToken, textoDeLecturas, tokenDeCabeceras } from "./dispositivos";

// ===========================================================================
// Adquisición de datos desde instrumentos (contrato §4.4.6, §4.4.7) ·
// packages/db/align_instrumentos_importacion.sql
//
//   1. Vista previa: se lee el archivo con el perfil del instrumento y cada fila
//      se empareja con un ensayo de la OT (código de la muestra + nombre o
//      código del analito o del método, o su equivalencia). Nada se escribe en
//      los resultados; el archivo íntegro queda guardado (dato bruto + SHA-256).
//   2. Aplicar: cada fila elegida entra por la captura estándar
//      (PuenteAnalisisService.capturarValor), con las mismas reglas que la
//      captura a mano. Lo que falla en una fila no detiene las demás.
//   3. Lectura automática: si el perfil tiene carpeta y el servidor define
//      INSTRUMENTOS_DIR, el LIMS revisa esa carpeta cada minuto, importa los
//      archivos nuevos a nombre del responsable del perfil (solo los ensayos sin
//      valor; las correcciones y los avisos quedan para una persona) y los mueve
//      a «procesados» o «errores».
//   4. Dispositivos (serie RS-232 / Ethernet): el agente de instrumentos
//      (tools/agente-instrumentos) envía las tramas con un token de dispositivo
//      (alta y revocación en «Dispositivos conectados»). Se interpretan con el
//      perfil y quedan como lectura pendiente (PREVISTA, sin dueño): cualquier
//      analista del laboratorio la revisa y la captura desde «Lecturas pendientes».
// ===========================================================================

const tenantDe = (req: any): string => {
  const id = req?.user?.tenantId;
  if (!id) throw new NotFoundException("Tenant no resuelto en el token");
  return id;
};
const esSuper = (req: any) => (req?.user?.roles ?? []).includes("SUPERADMIN");
const tiene = (req: any, p: string) => esSuper(req) || (req?.user?.permisos ?? []).includes(p);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOpcional = (v: unknown, que: string): string | null => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !UUID_RE.test(v)) throw new BadRequestException(`${que} inválido.`);
  return v;
};
const texto = (v: unknown, max: number, que: string, obligatorio = false): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) {
    if (obligatorio) throw new BadRequestException(`Indique ${que}.`);
    return null;
  }
  if (s.length > max) throw new BadRequestException(`${que[0].toUpperCase()}${que.slice(1)}: como máximo ${max} caracteres.`);
  return s;
};

export const MAX_ARCHIVO_BYTES = 5 * 1024 * 1024;
const EXTENSIONES = /\.(csv|txt|tsv|xml|dat|prn)$/i;
const CARPETA_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;

/** Estado de una fila en la vista previa (lo que pasará al aplicar). */
export type EstadoFila =
  | "listo" // ensayo sin valor: se captura
  | "corrige" // ya tiene valor sin revisar: se captura solo con motivo de corrección
  | "bloqueado" // revisado o aprobado: no se toca
  | "sin_muestra"
  | "sin_ensayo"
  | "ambiguo"
  | "otra_ot"
  | "fuera_alcance"
  | "duplicado" // el mismo ensayo aparece más abajo en el archivo: vale la última fila
  | "invalido" // la fila del archivo no trae muestra, ensayo o valor
  // tras aplicar:
  | "capturado"
  | "aviso"
  | "error";

export interface FilaPrevia extends FilaLeida {
  estado: EstadoFila;
  detalle: string | null;
  resultadoId: string | null;
  otCodigo: string | null;
  ensayoLims: string | null;
  valorAnterior: string | null;
}

interface PerfilFila {
  id: string;
  nombre: string;
  descripcion: string | null;
  equipoId: string | null;
  unidadId: string | null;
  formato: Perfil["formato"];
  separador: string;
  decimal: "," | ".";
  filaCabecera: number;
  elementoRegistro: string | null;
  colMuestra: string;
  colEnsayo: string | null;
  colValor: string;
  colUnidad: string | null;
  colFecha: string | null;
  ensayoFijo: string | null;
  equivalencias: Record<string, string>;
  carpeta: string | null;
  responsableId: string | null;
  activo: boolean;
}

const SELECT_PERFIL = `
  SELECT p.id, p.nombre, p.descripcion, p.equipo_id AS "equipoId", p.unidad_id AS "unidadId", p.formato, p.separador, p.decimal,
         p.fila_cabecera::int AS "filaCabecera", p.elemento_registro AS "elementoRegistro", p.col_muestra AS "colMuestra",
         p.col_ensayo AS "colEnsayo", p.col_valor AS "colValor", p.col_unidad AS "colUnidad", p.col_fecha AS "colFecha",
         p.ensayo_fijo AS "ensayoFijo", p.equivalencias, p.carpeta, p.responsable_id AS "responsableId", p.activo
    FROM instrumento_perfil p`;

@Injectable()
export class InstrumentosService implements OnModuleInit, OnModuleDestroy {
  readonly prisma = new PrismaClient();
  private readonly log = new Logger("Instrumentos");
  private reloj: NodeJS.Timeout | null = null;
  private revisando = false;

  constructor(
    private readonly alcance: AlcanceService,
    private readonly puente: PuenteAnalisisService,
    private readonly auth: AuthService,
  ) {}

  private enAlcance(unidades: string[] | null, unidadId: string | null) {
    return !unidades || !unidadId || unidades.includes(unidadId);
  }

  /* ------------------------------------------------------------ perfiles --- */

  /**
   * Unidades donde vale ALGUNO de los permisos (unión de sus alcances; null =
   * global). Quien solo configura (Calidad, con instrumento.configurar) ve y
   * edita perfiles sin poder capturar.
   */
  private async unidadesDeAlguno(req: any, permisos: string[]): Promise<string[] | null> {
    const propios = permisos.filter((p) => tiene(req, p));
    const out = new Set<string>();
    for (const p of propios) {
      const u = await this.alcance.filtroUnidades(req, p);
      if (!u) return null;
      u.forEach((x) => out.add(x));
    }
    return [...out];
  }

  private async perfilesVisibles(req: any, incluirInactivos = false, permisos: string[] = ["instrumento.importar"]): Promise<PerfilFila[]> {
    const unidades = await this.unidadesDeAlguno(req, permisos);
    const f = await this.prisma.$queryRawUnsafe<PerfilFila[]>(
      `${SELECT_PERFIL} WHERE p.tenant_id = $1::uuid AND p.deleted_at IS NULL ${incluirInactivos ? "" : "AND p.activo"} ORDER BY lower(p.nombre)`,
      tenantDe(req),
    );
    return f.filter((p) => this.enAlcance(unidades, p.unidadId));
  }

  private async perfil(req: any, id: string, permisos?: string[]): Promise<PerfilFila> {
    const p = (await this.perfilesVisibles(req, true, permisos)).find((x) => x.id === id);
    if (!p) throw new NotFoundException("Perfil de instrumento no encontrado.");
    return p;
  }

  async listarPerfiles(req: any) {
    if (!tiene(req, "instrumento.importar") && !tiene(req, "instrumento.configurar"))
      throw new ForbiddenException("Permiso insuficiente. Requiere uno de: instrumento.importar, instrumento.configurar");
    const tenantId = tenantDe(req);
    const lista = await this.perfilesVisibles(req, tiene(req, "instrumento.configurar"), ["instrumento.importar", "instrumento.configurar"]);
    const nombres = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT p.id, eq.codigo || ' · ' || COALESCE(eq.nombre, eq.descripcion, '') AS equipo, u.codigo || ' · ' || u.nombre AS unidad, us.nombre_completo AS responsable
         FROM instrumento_perfil p
         LEFT JOIN equipo eq ON eq.id = p.equipo_id
         LEFT JOIN unidad u ON u.id = p.unidad_id
         LEFT JOIN usuario us ON us.id = p.responsable_id
        WHERE p.tenant_id = $1::uuid`,
      tenantId,
    );
    const n = new Map(nombres.map((x) => [x.id, x]));
    return {
      puedeConfigurar: tiene(req, "instrumento.configurar"),
      // Cargar archivos e historial exigen además capturar resultados.
      puedeImportar: tiene(req, "instrumento.importar") && tiene(req, "resultado.crear"),
      lecturaAutomatica: !!process.env.INSTRUMENTOS_DIR,
      // Lecturas de dispositivos sin revisar en los perfiles visibles (insignia de «Lecturas pendientes»).
      pendientes: await this.contarPendientes(tenantId, lista.map((p) => p.id)),
      perfiles: lista.map((p) => ({ ...p, equipo: n.get(p.id)?.equipo ?? null, unidad: n.get(p.id)?.unidad ?? null, responsable: n.get(p.id)?.responsable ?? null })),
    };
  }

  private datosPerfil(b: any, previo?: PerfilFila) {
    const v = (campo: keyof PerfilFila, def: any) => (b && campo in b ? b[campo] : def);
    const formato = v("formato", previo?.formato ?? "CSV");
    if (!FORMATOS.includes(formato)) throw new BadRequestException(`Formato: ${FORMATOS.join(", ")}.`);
    const separador = v("separador", previo?.separador ?? "auto");
    if (!(SEPARADORES as readonly string[]).includes(separador)) throw new BadRequestException("Separador inválido.");
    const decimal = v("decimal", previo?.decimal ?? ",");
    if (decimal !== "," && decimal !== ".") throw new BadRequestException("Decimal: «,» o «.».");
    const filaCabecera = Number(v("filaCabecera", previo?.filaCabecera ?? 1));
    if (!Number.isInteger(filaCabecera) || filaCabecera < 0 || filaCabecera > 50) throw new BadRequestException("Fila de cabecera: entre 0 (sin cabecera) y 50.");
    const col = (campo: keyof PerfilFila, que: string, oblig = false) => texto(v(campo, (previo as any)?.[campo] ?? null), 80, que, oblig);
    const elementoRegistro = formato === "XML" ? col("elementoRegistro", "el elemento XML de cada registro", true) : null;
    if (elementoRegistro && !/^[\w.:-]+$/.test(elementoRegistro)) throw new BadRequestException("Elemento XML: solo letras, números, «_», «.», «-» y «:».");
    const colEnsayo = col("colEnsayo", "la columna del ensayo");
    const ensayoFijo = texto(v("ensayoFijo", previo?.ensayoFijo ?? null), 120, "el ensayo fijo");
    if (!colEnsayo && !ensayoFijo) throw new BadRequestException("Indique la columna del ensayo o el ensayo fijo que mide el instrumento.");
    const eq = v("equivalencias", previo?.equivalencias ?? {});
    if (typeof eq !== "object" || eq === null || Array.isArray(eq) || Object.keys(eq).length > 300 || Object.entries(eq).some(([k, x]) => typeof x !== "string" || k.length > 120 || (x as string).length > 120))
      throw new BadRequestException("Equivalencias: pares «nombre en el instrumento → ensayo del LIMS» (máximo 300).");
    const carpeta = texto(v("carpeta", previo?.carpeta ?? null), 80, "la carpeta");
    if (carpeta && !CARPETA_RE.test(carpeta)) throw new BadRequestException("Carpeta: un nombre simple (letras, números, «_», «.», «-»), sin rutas.");
    const responsableId = uuidOpcional(v("responsableId", previo?.responsableId ?? null), "Responsable");
    if (carpeta && !responsableId) throw new BadRequestException("La lectura automática necesita un responsable: los valores se capturan a su nombre.");
    return {
      nombre: b?.nombre !== undefined ? texto(b.nombre, 120, "el nombre del perfil", true)! : previo!.nombre,
      descripcion: b?.descripcion !== undefined ? texto(b.descripcion, 500, "la descripción") : previo?.descripcion ?? null,
      equipoId: uuidOpcional(v("equipoId", previo?.equipoId ?? null), "Equipo"),
      unidadId: uuidOpcional(v("unidadId", previo?.unidadId ?? null), "Unidad"),
      formato,
      separador,
      decimal,
      filaCabecera,
      elementoRegistro,
      colMuestra: col("colMuestra", "la columna de la muestra", true)!,
      colEnsayo,
      colValor: col("colValor", "la columna del valor", true)!,
      colUnidad: col("colUnidad", "la columna de la unidad"),
      colFecha: col("colFecha", "la columna de la fecha"),
      ensayoFijo,
      equivalencias: Object.fromEntries(Object.entries(eq as Record<string, string>).map(([k, x]) => [k.trim(), x.trim()]).filter(([k, x]) => k && x)),
      carpeta,
      responsableId,
      activo: b?.activo === undefined ? previo?.activo ?? true : b.activo === true || b.activo === "true",
    };
  }

  private async guardarPerfil(req: any, d: ReturnType<InstrumentosService["datosPerfil"]>, id?: string) {
    const tenantId = tenantDe(req);
    const unidades = await this.alcance.filtroUnidades(req, "instrumento.configurar");
    if (unidades && (!d.unidadId || !unidades.includes(d.unidadId))) throw new ForbiddenException("Asigne el perfil a un laboratorio de su alcance.");
    if (d.equipoId) {
      const e = await this.prisma.$queryRawUnsafe<any[]>(`SELECT unidad_id FROM equipo WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL`, d.equipoId, tenantId);
      if (!e[0]) throw new BadRequestException("El equipo no existe.");
      if (d.unidadId && e[0].unidad_id && e[0].unidad_id !== d.unidadId) throw new BadRequestException("El equipo es de otro laboratorio.");
    }
    if (d.responsableId) {
      const u = await this.prisma.$queryRawUnsafe<any[]>(`SELECT 1 FROM usuario WHERE id = $1::uuid AND tenant_id = $2::uuid AND deleted_at IS NULL`, d.responsableId, tenantId);
      if (!u[0]) throw new BadRequestException("El responsable no existe.");
    }
    const args = [tenantId, d.nombre, d.descripcion, d.equipoId, d.unidadId, d.formato, d.separador, d.decimal, d.filaCabecera, d.elementoRegistro, d.colMuestra, d.colEnsayo, d.colValor, d.colUnidad, d.colFecha, d.ensayoFijo, JSON.stringify(d.equivalencias), d.carpeta, d.responsableId, d.activo];
    try {
      if (!id) {
        const r = await this.prisma.$queryRawUnsafe<any[]>(
          `INSERT INTO instrumento_perfil (tenant_id, nombre, descripcion, equipo_id, unidad_id, formato, separador, decimal, fila_cabecera, elemento_registro, col_muestra, col_ensayo, col_valor, col_unidad, col_fecha, ensayo_fijo, equivalencias, carpeta, responsable_id, activo, creado_por)
           VALUES ($1::uuid, $2, $3, $4::uuid, $5::uuid, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18, $19::uuid, $20, $21::uuid) RETURNING id`,
          ...args, req?.user?.sub ?? null,
        );
        return r[0].id as string;
      }
      await this.prisma.$executeRawUnsafe(
        `UPDATE instrumento_perfil SET nombre = $2, descripcion = $3, equipo_id = $4::uuid, unidad_id = $5::uuid, formato = $6, separador = $7, decimal = $8, fila_cabecera = $9,
                elemento_registro = $10, col_muestra = $11, col_ensayo = $12, col_valor = $13, col_unidad = $14, col_fecha = $15, ensayo_fijo = $16, equivalencias = $17::jsonb,
                carpeta = $18, responsable_id = $19::uuid, activo = $20, actualizado_en = now()
          WHERE tenant_id = $1::uuid AND id = $21::uuid`,
        ...args, id,
      );
      return id;
    } catch (e: any) {
      if (/23505/.test(String(e?.message ?? ""))) throw new ConflictException("Ya existe un perfil con ese nombre o con esa carpeta.");
      throw e;
    }
  }

  async crearPerfil(req: any, b: any) {
    return { id: await this.guardarPerfil(req, this.datosPerfil(b)) };
  }

  async editarPerfil(req: any, id: string, b: any) {
    const previo = await this.perfil(req, id, ["instrumento.configurar"]);
    await this.guardarPerfil(req, this.datosPerfil(b, previo), id);
    return { id };
  }

  async borrarPerfil(req: any, id: string) {
    await this.perfil(req, id, ["instrumento.configurar"]);
    await this.prisma.$executeRawUnsafe(`UPDATE instrumento_perfil SET deleted_at = now(), carpeta = NULL WHERE tenant_id = $1::uuid AND id = $2::uuid`, tenantDe(req), id);
    return { ok: true };
  }

  /**
   * Opciones del formulario de perfil (laboratorios, equipos y usuarios) para
   * quien configura: no depende de ot.ver, equipo.ver ni agenda.crear.
   */
  async opcionesPerfil(req: any) {
    const tenantId = tenantDe(req);
    const unidades = await this.alcance.filtroUnidades(req, "instrumento.configurar");
    const [labs, equipos, usuarios] = await Promise.all([
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT id, codigo, nombre FROM unidad WHERE tenant_id = $1::uuid AND activa
            AND COALESCE(tipo, 'LABORATORIO') IN ('LABORATORIO', 'SECCION', 'SUCURSAL', 'DELEGACION')
            AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[])) ORDER BY codigo`,
        tenantId,
        unidades,
      ),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT id, codigo, nombre, descripcion, unidad_id AS "unidadId" FROM equipo
          WHERE tenant_id = $1::uuid AND deleted_at IS NULL AND COALESCE(estado, 'operativo') <> 'baja'
            AND ($2::uuid[] IS NULL OR unidad_id IS NULL OR unidad_id = ANY($2::uuid[])) ORDER BY codigo LIMIT 1000`,
        tenantId,
        unidades,
      ),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT id, nombre_completo AS nombre, username FROM usuario
          WHERE tenant_id = $1::uuid AND deleted_at IS NULL AND COALESCE(estado, 'activo') = 'activo' ORDER BY nombre_completo LIMIT 500`,
        tenantId,
      ),
    ]);
    return { unidades: labs, equipos, usuarios };
  }

  /* -------------------------------------------------------- emparejamiento --- */

  /** Empareja las filas leídas con los ensayos de las muestras indicadas (y de la OT, si se eligió). */
  private async emparejar(req: any, filas: FilaLeida[], otId: string | null, unidadesFijas?: string[] | null): Promise<FilaPrevia[]> {
    const tenantId = tenantDe(req);
    const codigos = [...new Set(filas.filter((f) => f.muestra).map((f) => f.muestra.toUpperCase()))];
    const muestras = codigos.length
      ? await this.prisma.$queryRawUnsafe<any[]>(
          `SELECT m.id, upper(m.codigo) AS clave, m.ot_id, o.codigo AS ot_codigo, o.unidad_principal
             FROM muestra m LEFT JOIN orden_trabajo o ON o.id = m.ot_id
            WHERE m.tenant_id = $1::uuid AND upper(m.codigo) = ANY($2::text[])`,
          tenantId, codigos,
        )
      : [];
    const porCodigo = new Map(muestras.map((m) => [m.clave, m]));
    const ids = muestras.map((m) => m.id);
    const resultados = ids.length
      ? await this.prisma.$queryRawUnsafe<any[]>(
          `SELECT r.id, r.muestra_id, r.estado, r.tipo_dato, r.valor_numerico AS "valorNumerico", r.valor_texto AS "valorTexto",
                  r.resultado_final AS "resultadoFinal", r.promedio,
                  ca.codigo AS ca_codigo, ca.nombre AS ca_nombre, cm.codigo AS cm_codigo, cm.nombre AS cm_nombre, a.codigo AS a_codigo, a.nombre AS a_nombre
             FROM resultado r
             LEFT JOIN cat_analito ca ON ca.id = r.cat_analito_id
             LEFT JOIN cat_metodo cm ON cm.id = r.cat_metodo_id
             LEFT JOIN analito a ON a.id = r.analito_id
            WHERE r.muestra_id = ANY($1::uuid[]) AND r.deleted_at IS NULL`,
          ids,
        )
      : [];
    // Lecturas de un dispositivo: el laboratorio del perfil (no hay usuario en la petición).
    const unidades = unidadesFijas !== undefined ? unidadesFijas : await this.alcance.filtroUnidades(req, "resultado.crear");
    const usados = new Map<string, number>(); // resultadoId → índice de la última fila que lo usa

    const salida: FilaPrevia[] = filas.map((f) => {
      const base: FilaPrevia = { ...f, estado: "invalido", detalle: f.error, resultadoId: null, otCodigo: null, ensayoLims: null, valorAnterior: null };
      if (f.error) return base;
      const m = porCodigo.get(f.muestra.toUpperCase());
      if (!m) return { ...base, estado: "sin_muestra", detalle: `No existe la muestra ${f.muestra}.` };
      if (!this.enAlcance(unidades, m.unidad_principal)) return { ...base, estado: "fuera_alcance", detalle: "La muestra es de un laboratorio fuera de su alcance." };
      if (otId && m.ot_id !== otId) return { ...base, estado: "otra_ot", otCodigo: m.ot_codigo, detalle: `La muestra es de la OT ${m.ot_codigo}, no de la elegida.` };
      const n = normalizar(f.ensayo);
      const candidatos = resultados.filter(
        (r) => r.muestra_id === m.id && [r.ca_codigo, r.ca_nombre, r.cm_codigo, r.cm_nombre, r.a_codigo, r.a_nombre].some((x) => x && normalizar(String(x)) === n),
      );
      const conOt = { ...base, otCodigo: m.ot_codigo };
      if (!candidatos.length) return { ...conOt, estado: "sin_ensayo", detalle: `La muestra no tiene el ensayo «${f.ensayo}». Revise las equivalencias del perfil.` };
      if (candidatos.length > 1) return { ...conOt, estado: "ambiguo", detalle: `«${f.ensayo}» corresponde a ${candidatos.length} ensayos de la muestra: use el código del método en las equivalencias.` };
      const r = candidatos[0];
      const ensayoLims = r.ca_nombre ?? r.cm_nombre ?? r.a_nombre ?? f.ensayo;
      const anterior = r.valorTexto ?? (r.resultadoFinal ?? r.valorNumerico ?? r.promedio)?.toString() ?? null;
      const fila: FilaPrevia = { ...conOt, resultadoId: r.id, ensayoLims, valorAnterior: anterior };
      if (r.tipo_dato === "ATRIBUTO") return { ...fila, estado: "bloqueado", detalle: "Ensayo de atributo (Cumple / No cumple): se registra a mano." };
      const bloqueo = motivoNoCapturable(r.estado);
      if (bloqueo) return { ...fila, estado: "bloqueado", detalle: bloqueo };
      return teniaValor(r)
        ? { ...fila, estado: "corrige", detalle: `Ya tiene el valor ${anterior}: se corrige solo si indica el motivo.` }
        : { ...fila, estado: "listo", detalle: null };
    });
    salida.forEach((f, i) => f.resultadoId && ["listo", "corrige"].includes(f.estado) && usados.set(f.resultadoId, i));
    return salida.map((f, i) =>
      f.resultadoId && ["listo", "corrige"].includes(f.estado) && usados.get(f.resultadoId) !== i
        ? { ...f, estado: "duplicado", detalle: `El mismo ensayo se repite en la fila ${salida[usados.get(f.resultadoId)!].fila}: vale la última.` }
        : f,
    );
  }

  /* -------------------------------------------------------- importaciones --- */

  /** Vista previa: lee, empareja y guarda el archivo (estado PREVISTA). */
  async vistaPrevia(req: any, b: { perfilId?: string; otId?: string; otCodigo?: string }, archivo: { originalname?: string; buffer?: Buffer; size?: number } | undefined, origen: "MANUAL" | "CARPETA" = "MANUAL") {
    const tenantId = tenantDe(req);
    const perfilId = uuidOpcional(b?.perfilId, "Perfil");
    if (!perfilId) throw new BadRequestException("Elija el perfil del instrumento.");
    const p = await this.perfil(req, perfilId);
    if (!p.activo) throw new BadRequestException("El perfil está inactivo.");
    if (!archivo?.buffer?.length) throw new BadRequestException("Adjunte el archivo exportado por el instrumento.");
    if (archivo.buffer.length > MAX_ARCHIVO_BYTES) throw new BadRequestException("El archivo supera 5 MB.");
    const nombre = (archivo.originalname ?? "archivo").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 200);
    if (!EXTENSIONES.test(nombre)) throw new BadRequestException("Tipos admitidos: .csv, .txt, .tsv, .xml, .dat, .prn.");
    let otId = uuidOpcional(b?.otId, "OT");
    const otCodigo = texto((b as any)?.otCodigo, 40, "la OT");
    if (!otId && otCodigo) {
      const o = await this.prisma.$queryRawUnsafe<any[]>(`SELECT id FROM orden_trabajo WHERE tenant_id = $1::uuid AND upper(codigo) = upper($2) LIMIT 1`, tenantId, otCodigo);
      if (!o[0]) throw new BadRequestException(`No existe la OT ${otCodigo}.`);
      otId = o[0].id;
    }
    if (otId) {
      const o = await this.prisma.$queryRawUnsafe<any[]>(`SELECT unidad_principal FROM orden_trabajo WHERE id = $1::uuid AND tenant_id = $2::uuid`, otId, tenantId);
      if (!o[0]) throw new BadRequestException("La OT no existe.");
      await this.alcance.exigirUnidad(req, o[0].unidad_principal, "la OT", "resultado.crear");
    }
    let filas: FilaLeida[];
    try {
      filas = leerArchivo(decodificar(archivo.buffer), { ...p, separador: p.separador as Perfil["separador"] });
    } catch (e) {
      if (e instanceof LecturaError) throw new BadRequestException(`El archivo no se pudo leer con el perfil «${p.nombre}»: ${e.message}`);
      throw e;
    }
    const previas = await this.emparejar(req, filas, otId);
    const hash = createHash("sha256").update(archivo.buffer).digest("hex");
    const anteriores = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, estado, creado_en AS "creadoEn" FROM instrumento_importacion WHERE tenant_id = $1::uuid AND hash_sha256 = $2 AND estado = 'APLICADA' ORDER BY creado_en DESC LIMIT 3`,
      tenantId, hash,
    );
    const r = await this.prisma.$queryRawUnsafe<any[]>(
      `INSERT INTO instrumento_importacion (tenant_id, perfil_id, origen, archivo_nombre, archivo_bytes, hash_sha256, contenido, ot_id, filas, total, usuario_id)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::uuid, $9::jsonb, $10, $11::uuid) RETURNING id`,
      tenantId, p.id, origen, nombre, archivo.buffer.length, hash, archivo.buffer.toString("base64"), otId, JSON.stringify(previas), previas.length, req?.user?.sub ?? null,
    );
    return { id: r[0].id, perfil: p.nombre, archivo: nombre, hashSha256: hash, yaImportado: anteriores, resumen: resumir(previas), filas: previas };
  }

  private async importacion(req: any, id: string) {
    const f = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT i.*, p.nombre AS perfil, p.equipo_id, p.unidad_id AS perfil_unidad, d.nombre AS dispositivo_nombre
         FROM instrumento_importacion i JOIN instrumento_perfil p ON p.id = i.perfil_id
         LEFT JOIN instrumento_dispositivo d ON d.id = i.dispositivo_id
        WHERE i.tenant_id = $1::uuid AND i.id = $2::uuid`,
      tenantDe(req), id,
    );
    const unidades = await this.alcance.filtroUnidades(req, "instrumento.importar");
    if (!f[0] || !this.enAlcance(unidades, f[0].perfil_unidad)) throw new NotFoundException("Importación no encontrada.");
    return f[0];
  }

  /**
   * Captura las filas elegidas (por defecto, todas las «listo»; las «corrige» solo
   * con motivo). Cada fila pasa por la captura estándar; un error no detiene las demás.
   */
  async aplicar(req: any, id: string, b: { filas?: number[]; motivo?: string; confirmarAvisos?: boolean }) {
    const imp = await this.importacion(req, id);
    if (imp.estado !== "PREVISTA") throw new ConflictException(`La importación ya está ${String(imp.estado).toLowerCase()}.`);
    if (imp.usuario_id && imp.usuario_id !== req?.user?.sub) throw new ForbiddenException("La aplica quien cargó el archivo: es quien queda como analista de los valores.");
    const motivo = typeof b?.motivo === "string" ? b.motivo.trim() : "";
    if (motivo && motivo.length < 5) throw new BadRequestException("Motivo de la corrección: mínimo 5 caracteres.");
    const elegidas = Array.isArray(b?.filas) ? new Set(b.filas.map(Number)) : null;
    const filas: FilaPrevia[] = imp.filas;
    let aplicadas = 0;
    let errores = 0;
    for (const f of filas) {
      const quiere = elegidas ? elegidas.has(f.fila) : f.estado === "listo" || (f.estado === "corrige" && !!motivo);
      if (!quiere || !f.resultadoId || !["listo", "corrige"].includes(f.estado)) continue;
      if (f.estado === "corrige" && !motivo) {
        f.estado = "error";
        f.detalle = "Ya tenía valor: falta el motivo de la corrección.";
        errores++;
        continue;
      }
      try {
        await this.puente.capturarValor(
          f.resultadoId,
          {
            valor: f.valor,
            ...(imp.equipo_id ? { equipoId: imp.equipo_id } : {}),
            ...(f.estado === "corrige" ? { motivo: `${motivo} (archivo ${imp.archivo_nombre})` } : {}),
            ...(b?.confirmarAvisos ? { confirmarAvisos: true } : {}),
          },
          imp.tenant_id,
          req,
        );
        f.estado = "capturado";
        f.detalle = null;
        aplicadas++;
      } catch (e: any) {
        const r = e?.getResponse?.();
        const avisos = r && typeof r === "object" && Array.isArray((r as any).avisos);
        f.estado = avisos ? "aviso" : "error";
        f.detalle = (typeof r === "object" ? (Array.isArray((r as any).message) ? (r as any).message.join("; ") : (r as any).message) : null) ?? e?.message ?? "Error al capturar.";
        errores++;
      }
    }
    await this.prisma.$executeRawUnsafe(
      // Lectura de un dispositivo (sin dueño): queda a nombre de quien la revisó y capturó.
      `UPDATE instrumento_importacion SET estado = 'APLICADA', filas = $2::jsonb, aplicadas = $3, con_error = $4, aplicado_en = now(), usuario_id = COALESCE(usuario_id, $5::uuid) WHERE id = $1::uuid`,
      id, JSON.stringify(filas), aplicadas, errores, req?.user?.sub ?? null,
    );
    return { id, aplicadas, errores, resumen: resumir(filas), filas };
  }

  async descartar(req: any, id: string) {
    const imp = await this.importacion(req, id);
    if (imp.estado !== "PREVISTA") throw new ConflictException("Solo se descarta una vista previa sin aplicar.");
    await this.prisma.$executeRawUnsafe(`UPDATE instrumento_importacion SET estado = 'DESCARTADA' WHERE id = $1::uuid`, id);
    return { ok: true };
  }

  async historial(req: any, perfilId?: string, soloPendientes = false) {
    const tenantId = tenantDe(req);
    const visibles = new Set((await this.perfilesVisibles(req, true)).map((p) => p.id));
    const args: any[] = [tenantId];
    let w = "";
    const pid = uuidOpcional(perfilId, "Perfil");
    if (pid) {
      args.push(pid);
      w = " AND i.perfil_id = $2::uuid";
    }
    // «Lecturas pendientes»: lo recibido de los dispositivos que nadie ha revisado aún.
    if (soloPendientes) w += " AND i.estado = 'PREVISTA' AND i.origen = 'DISPOSITIVO'";
    const f = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT i.id, i.perfil_id AS "perfilId", p.nombre AS perfil, i.origen, i.archivo_nombre AS archivo, i.archivo_bytes AS bytes, i.hash_sha256 AS "hashSha256",
              i.estado, i.total, i.aplicadas, i.con_error AS "conError", o.codigo AS "otCodigo", u.nombre_completo AS usuario, i.creado_en AS "creadoEn", i.aplicado_en AS "aplicadoEn",
              d.nombre AS dispositivo
         FROM instrumento_importacion i
         JOIN instrumento_perfil p ON p.id = i.perfil_id
         LEFT JOIN instrumento_dispositivo d ON d.id = i.dispositivo_id
         LEFT JOIN orden_trabajo o ON o.id = i.ot_id
         LEFT JOIN usuario u ON u.id = i.usuario_id
        WHERE i.tenant_id = $1::uuid ${w}
        ORDER BY i.creado_en DESC LIMIT 100`,
      ...args,
    );
    return f.filter((x) => visibles.has(x.perfilId));
  }

  async detalle(req: any, id: string) {
    const imp = await this.importacion(req, id);
    // Lectura de un dispositivo aún sin aplicar: se vuelve a emparejar con el
    // alcance de quien la revisa y con el estado actual de los ensayos (pudieron
    // capturarse a mano después de recibirla).
    if (imp.origen === "DISPOSITIVO" && imp.estado === "PREVISTA") {
      const p = await this.perfilPorId(imp.tenant_id, imp.perfil_id);
      try {
        const filas = leerArchivo(decodificar(Buffer.from(imp.contenido, "base64")), { ...p, separador: p.separador as Perfil["separador"] });
        imp.filas = await this.emparejar(req, filas, imp.ot_id ?? null);
        await this.prisma.$executeRawUnsafe(`UPDATE instrumento_importacion SET filas = $2::jsonb, total = $3 WHERE id = $1::uuid`, id, JSON.stringify(imp.filas), imp.filas.length);
      } catch (e) {
        if (!(e instanceof LecturaError)) throw e;
      }
    }
    return {
      id: imp.id,
      perfil: imp.perfil,
      origen: imp.origen,
      dispositivo: imp.dispositivo_nombre ?? null,
      archivo: imp.archivo_nombre,
      hashSha256: imp.hash_sha256,
      estado: imp.estado,
      creadoEn: imp.creado_en,
      aplicadoEn: imp.aplicado_en,
      puedeAplicar: imp.estado === "PREVISTA" && (!imp.usuario_id || imp.usuario_id === req?.user?.sub),
      resumen: resumir(imp.filas),
      filas: imp.filas,
    };
  }

  async original(req: any, id: string) {
    const imp = await this.importacion(req, id);
    return { nombre: imp.archivo_nombre as string, datos: Buffer.from(imp.contenido, "base64") };
  }

  /* ------------------------------------------- dispositivos (serie/Ethernet) --- */

  private async perfilPorId(tenantId: string, id: string): Promise<PerfilFila> {
    const f = await this.prisma.$queryRawUnsafe<PerfilFila[]>(`${SELECT_PERFIL} WHERE p.tenant_id = $1::uuid AND p.id = $2::uuid`, tenantId, id);
    if (!f[0]) throw new NotFoundException("Perfil de instrumento no encontrado.");
    return f[0];
  }

  private async contarPendientes(tenantId: string, perfiles: string[]): Promise<number> {
    if (!perfiles.length) return 0;
    const [r] = await this.prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM instrumento_importacion WHERE tenant_id = $1::uuid AND estado = 'PREVISTA' AND origen = 'DISPOSITIVO' AND perfil_id = ANY($2::uuid[])`,
      tenantId,
      perfiles,
    );
    return Number(r?.n ?? 0);
  }

  /** Dispositivos de los perfiles que el usuario configura (o importa), activos y revocados. */
  async listarDispositivos(req: any) {
    const tenantId = tenantDe(req);
    const visibles = new Set((await this.perfilesVisibles(req, true, ["instrumento.importar", "instrumento.configurar"])).map((p) => p.id));
    const f = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT d.id, d.nombre, d.conexion, d.ubicacion, d.token_prefijo AS "tokenPrefijo", d.perfil_id AS "perfilId", p.nombre AS perfil,
              d.creado_en AS "creadoEn", uc.nombre_completo AS "creadoPor", d.revocado_en AS "revocadoEn", ur.nombre_completo AS "revocadoPor",
              d.motivo_revocacion AS "motivoRevocacion", d.ultimo_contacto AS "ultimoContacto", d.ultima_ip AS "ultimaIp",
              d.version_agente AS "versionAgente", d.envios,
              (SELECT count(*)::int FROM instrumento_importacion i WHERE i.dispositivo_id = d.id AND i.estado = 'PREVISTA') AS pendientes
         FROM instrumento_dispositivo d
         JOIN instrumento_perfil p ON p.id = d.perfil_id
         LEFT JOIN usuario uc ON uc.id = d.creado_por
         LEFT JOIN usuario ur ON ur.id = d.revocado_por
        WHERE d.tenant_id = $1::uuid
        ORDER BY (d.revocado_en IS NULL) DESC, lower(d.nombre)`,
      tenantId,
    );
    return f.filter((x) => visibles.has(x.perfilId));
  }

  /** Alta: devuelve el token UNA sola vez (en la BD queda solo su SHA-256). */
  async crearDispositivo(req: any, b: any) {
    const tenantId = tenantDe(req);
    let d: ReturnType<typeof datosDispositivo>;
    try {
      d = datosDispositivo(b);
    } catch (e) {
      if (e instanceof IngestaError) throw new BadRequestException(e.message);
      throw e;
    }
    const p = await this.perfil(req, d.perfilId, ["instrumento.configurar"]);
    if (!p.activo) throw new BadRequestException("El perfil está inactivo: actívelo antes de conectar un dispositivo.");
    const t = generarToken();
    try {
      const r = await this.prisma.$queryRawUnsafe<any[]>(
        `INSERT INTO instrumento_dispositivo (tenant_id, perfil_id, nombre, conexion, ubicacion, token_hash, token_prefijo, creado_por)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::uuid) RETURNING id`,
        tenantId, p.id, d.nombre, d.conexion, d.ubicacion, t.hash, t.prefijo, req?.user?.sub ?? null,
      );
      return { id: r[0].id, nombre: d.nombre, perfil: p.nombre, token: t.token };
    } catch (e: any) {
      if (/23505/.test(String(e?.message ?? ""))) throw new ConflictException(`Ya hay un dispositivo activo llamado «${d.nombre}».`);
      throw e;
    }
  }

  /** Revocación: el token deja de valer de inmediato; las lecturas recibidas se conservan. */
  async revocarDispositivo(req: any, id: string, b: any) {
    const tenantId = tenantDe(req);
    const motivo = texto(b?.motivo, 500, "el motivo de la revocación", true)!;
    if (motivo.length < 5) throw new BadRequestException("Motivo de la revocación: mínimo 5 caracteres.");
    const [d] = await this.prisma.$queryRawUnsafe<any[]>(`SELECT perfil_id, revocado_en FROM instrumento_dispositivo WHERE id = $1::uuid AND tenant_id = $2::uuid`, id, tenantId);
    if (!d) throw new NotFoundException("Dispositivo no encontrado.");
    await this.perfil(req, d.perfil_id, ["instrumento.configurar"]);
    if (d.revocado_en) throw new ConflictException("El dispositivo ya estaba revocado.");
    await this.prisma.$executeRawUnsafe(
      `UPDATE instrumento_dispositivo SET revocado_en = now(), revocado_por = $3::uuid, motivo_revocacion = $4 WHERE id = $1::uuid AND tenant_id = $2::uuid AND revocado_en IS NULL`,
      id, tenantId, req?.user?.sub ?? null, motivo,
    );
    return { id, ok: true };
  }

  /**
   * Autentica al agente por su token (no por usuario): dispositivo vigente,
   * perfil activo. Registra el último contacto, la IP y la versión del agente.
   */
  async autenticarDispositivo(req: any) {
    const token = tokenDeCabeceras(req?.headers);
    if (!token) throw new UnauthorizedException("Falta el token del dispositivo.");
    const [d] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT d.id, d.tenant_id, d.perfil_id, d.nombre, d.conexion, d.revocado_en, p.activo AS perfil_activo, p.deleted_at AS perfil_baja
         FROM instrumento_dispositivo d JOIN instrumento_perfil p ON p.id = d.perfil_id
        WHERE d.token_hash = $1`,
      hashToken(token),
    );
    if (!d || d.revocado_en) throw new UnauthorizedException("Token de dispositivo inválido o revocado.");
    if (d.perfil_baja || !d.perfil_activo) throw new ForbiddenException("El perfil del instrumento está inactivo o dado de baja.");
    const version = typeof req?.headers?.["x-agente-version"] === "string" ? req.headers["x-agente-version"].slice(0, 40) : null;
    await this.prisma.$executeRawUnsafe(
      `UPDATE instrumento_dispositivo SET ultimo_contacto = now(), ultima_ip = $2, version_agente = COALESCE($3, version_agente) WHERE id = $1::uuid`,
      d.id, String(req?.ip ?? "").slice(0, 64) || null, version,
    );
    return d as { id: string; tenant_id: string; perfil_id: string; nombre: string; conexion: string };
  }

  /** Lo que el agente necesita del perfil para separar e informar las lecturas en su registro local. */
  async infoDispositivo(d: { tenant_id: string; perfil_id: string; nombre: string; conexion: string }) {
    const p = await this.perfilPorId(d.tenant_id, d.perfil_id);
    return {
      dispositivo: d.nombre,
      conexion: d.conexion,
      perfil: {
        nombre: p.nombre, formato: p.formato, separador: p.separador, decimal: p.decimal, filaCabecera: p.filaCabecera,
        colMuestra: p.colMuestra, colEnsayo: p.colEnsayo, colValor: p.colValor, colUnidad: p.colUnidad, ensayoFijo: p.ensayoFijo,
      },
    };
  }

  /**
   * Lecturas enviadas por el agente: se interpretan con el perfil (mismo lector
   * que los archivos), se emparejan con los ensayos del laboratorio del perfil
   * y quedan como importación PREVISTA de origen DISPOSITIVO, sin dueño, con
   * las tramas tal como llegaron (dato bruto + SHA-256). No se captura nada
   * hasta que un analista la revisa.
   */
  async ingestar(d: { id: string; tenant_id: string; perfil_id: string; nombre: string }, b: any) {
    const p = await this.perfilPorId(d.tenant_id, d.perfil_id);
    let lote: { texto: string; tramas: number };
    try {
      lote = textoDeLecturas(b, p);
    } catch (e) {
      if (e instanceof IngestaError) throw new BadRequestException(e.message);
      throw e;
    }
    const buffer = Buffer.from(lote.texto, "utf8");
    const hash = createHash("sha256").update(buffer).digest("hex");
    const sello = new Date().toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15);
    const nombre = `${d.nombre.replace(/[^A-Za-z0-9 _.()áéíóúñÁÉÍÓÚÑ-]/g, "_").slice(0, 150)}_${sello}.txt`;
    let previas: FilaPrevia[] = [];
    let estado = "PREVISTA";
    let mensaje: string | null = null;
    try {
      const filas = leerArchivo(lote.texto, { ...p, separador: p.separador as Perfil["separador"] });
      previas = await this.emparejar({ user: { tenantId: d.tenant_id } }, filas, null, p.unidadId ? [p.unidadId] : null);
    } catch (e) {
      if (!(e instanceof LecturaError)) throw e;
      // Lo recibido no encaja con el perfil: se guarda igual (dato bruto) como ERROR, para revisarlo.
      estado = "ERROR";
      mensaje = `Las tramas no se pudieron leer con el perfil «${p.nombre}»: ${e.message}`;
      previas = [{ fila: 0, muestra: "", ensayo: "", ensayoArchivo: "", valor: "", unidad: null, fecha: null, error: mensaje, estado: "invalido", detalle: mensaje, resultadoId: null, otCodigo: null, ensayoLims: null, valorAnterior: null }];
    }
    const r = await this.prisma.$queryRawUnsafe<any[]>(
      `INSERT INTO instrumento_importacion (tenant_id, perfil_id, origen, archivo_nombre, archivo_bytes, hash_sha256, contenido, filas, total, estado, dispositivo_id)
       VALUES ($1::uuid, $2::uuid, 'DISPOSITIVO', $3, $4, $5, $6, $7::jsonb, $8, $9, $10::uuid) RETURNING id`,
      d.tenant_id, p.id, nombre, buffer.length, hash, buffer.toString("base64"), JSON.stringify(previas), previas.length, estado, d.id,
    );
    await this.prisma.$executeRawUnsafe(`UPDATE instrumento_dispositivo SET envios = envios + 1 WHERE id = $1::uuid`, d.id);
    return { id: r[0].id, estado, tramas: lote.tramas, resumen: estado === "ERROR" ? {} : resumir(previas), mensaje };
  }

  /* ---------------------------------------------------- lectura automática --- */

  onModuleInit() {
    const raiz = process.env.INSTRUMENTOS_DIR;
    if (!raiz) return;
    const seg = Math.max(15, Number(process.env.INSTRUMENTOS_INTERVALO_S) || 60);
    this.reloj = setInterval(() => void this.revisarCarpetas().catch((e) => this.log.error(`Lectura automática: ${e?.message ?? e}`)), seg * 1000);
    this.reloj.unref?.();
    this.log.log(`Lectura automática de instrumentos en ${raiz} cada ${seg} s`);
  }

  onModuleDestroy() {
    if (this.reloj) clearInterval(this.reloj);
  }

  /** Una pasada por las carpetas de los perfiles activos. Devuelve lo procesado (para pruebas y registro). */
  async revisarCarpetas(): Promise<{ perfil: string; archivo: string; aplicadas: number; errores: number; estado: string }[]> {
    const raiz = process.env.INSTRUMENTOS_DIR;
    if (!raiz || this.revisando) return [];
    this.revisando = true;
    const hecho: { perfil: string; archivo: string; aplicadas: number; errores: number; estado: string }[] = [];
    try {
      const perfiles = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT id, tenant_id, nombre, carpeta, responsable_id FROM instrumento_perfil WHERE deleted_at IS NULL AND activo AND carpeta IS NOT NULL AND responsable_id IS NOT NULL`,
      );
      for (const p of perfiles) {
        const dir = path.join(raiz, p.carpeta);
        if (path.relative(raiz, dir).startsWith("..")) continue;
        let entradas: string[];
        try {
          entradas = await fs.readdir(dir);
        } catch {
          continue; // la carpeta aún no existe
        }
        for (const nombre of entradas) {
          const ruta = path.join(dir, nombre);
          const st = await fs.stat(ruta).catch(() => null);
          // Solo archivos admitidos y quietos hace 5 s (el instrumento terminó de escribirlos).
          if (!st?.isFile() || !EXTENSIONES.test(nombre) || Date.now() - st.mtimeMs < 5000) continue;
          const reg = await this.procesarArchivo(p, ruta, nombre);
          hecho.push({ perfil: p.nombre, archivo: nombre, ...reg });
        }
      }
    } finally {
      this.revisando = false;
    }
    return hecho;
  }

  private async procesarArchivo(p: any, ruta: string, nombre: string): Promise<{ aplicadas: number; errores: number; estado: string }> {
    const mover = async (sub: "procesados" | "errores") => {
      const destino = path.join(path.dirname(ruta), sub);
      await fs.mkdir(destino, { recursive: true });
      const sello = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
      await fs.rename(ruta, path.join(destino, `${sello}_${nombre}`));
    };
    try {
      const buffer = await fs.readFile(ruta);
      const hash = createHash("sha256").update(buffer).digest("hex");
      const ya = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT 1 FROM instrumento_importacion WHERE perfil_id = $1::uuid AND hash_sha256 = $2 AND estado = 'APLICADA' LIMIT 1`,
        p.id, hash,
      );
      if (ya[0]) {
        await mover("procesados");
        return { aplicadas: 0, errores: 0, estado: "repetido" };
      }
      // Sesión del responsable: sus permisos y su alcance, como si cargara el archivo él mismo.
      const s = await this.auth.rolesYPermisos(p.responsable_id, p.tenant_id);
      const req = { user: { sub: p.responsable_id, tenantId: p.tenant_id, roles: s.roles, permisos: s.permisos, unidades: s.unidades, unidadGlobal: s.unidadGlobal } };
      if (!tiene(req, "instrumento.importar") || !tiene(req, "resultado.crear")) throw new Error("el responsable del perfil no tiene permiso para capturar resultados");
      const prev = await this.vistaPrevia(req, { perfilId: p.id }, { originalname: nombre, buffer, size: buffer.length }, "CARPETA");
      const r = await this.aplicar(req, prev.id, {});
      await mover("procesados");
      this.log.log(`${p.nombre}: ${nombre} → ${r.aplicadas} capturados, ${r.errores} con error`);
      return { aplicadas: r.aplicadas, errores: r.errores, estado: "aplicada" };
    } catch (e: any) {
      this.log.warn(`${p.nombre}: ${nombre} no se pudo importar: ${e?.response?.message ?? e?.message ?? e}`);
      await mover("errores").catch(() => undefined);
      return { aplicadas: 0, errores: 1, estado: "error" };
    }
  }
}

export function resumir(filas: FilaPrevia[]): Record<string, number> {
  const r: Record<string, number> = {};
  for (const f of filas) r[f.estado] = (r[f.estado] ?? 0) + 1;
  return r;
}
