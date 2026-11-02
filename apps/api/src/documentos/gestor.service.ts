import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";
import { anioChile } from "../common/fecha-chile";
import { AlcanceService } from "../rbac/alcance.service";
import { arbolCarpetas, esDescendiente, nombreSeguro, subarbol, tipoArchivo, type CarpetaFila, type CarpetaNodo } from "./gestor";

// ===========================================================================
// Gestor documental (contrato §4.6.1, §4.6.2, §4.6.3) · packages/db/align_gestor_documental.sql
//
// Quién ve qué:
//   · una carpeta con unidad (propia o heredada) solo la ven quienes tienen esa
//     unidad en su alcance; los perfiles globales lo ven todo;
//   · un documento «restringido» solo lo ven quienes figuran en doc_acceso,
//     quien lo creó y los perfiles globales con documento.gestionar;
//   · quien solo tiene documento.ver descarga la versión PUBLICADA; los
//     borradores y versiones anteriores, quien puede editar el documento.
// Todos los valores viajan como parámetros posicionales.
// ===========================================================================

type Archivo = { originalname?: string; mimetype?: string; buffer?: Buffer; size?: number } | undefined;

const tenantDe = (req: any): string => {
  const id = req?.user?.tenantId;
  if (!id) throw new NotFoundException("Tenant no resuelto en el token");
  return id;
};
const usuarioDe = (req: any): string | null => req?.user?.sub ?? req?.user?.id ?? null;
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
const verdadero = (v: unknown) => v === true || v === "true" || v === "1" || v === "si";

interface Contexto {
  tenantId: string;
  usuarioId: string | null;
  unidades: string[] | null; // null = global
  gestiona: boolean;
}

@Injectable()
export class GestorDocumentalService {
  readonly prisma = new PrismaClient();

  constructor(private readonly alcance: AlcanceService) {}

  private async ctx(req: any): Promise<Contexto> {
    return {
      tenantId: tenantDe(req),
      usuarioId: usuarioDe(req),
      unidades: await this.alcance.filtroUnidades(req, "documento.ver"),
      gestiona: tiene(req, "documento.gestionar"),
    };
  }

  /* ----------------------------------------------------------- carpetas --- */

  private async filasCarpetas(tenantId: string): Promise<(CarpetaFila & { descripcion: string | null })[]> {
    const f = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, padre_id, nombre, unidad_id, descripcion FROM doc_carpeta WHERE tenant_id = $1::uuid AND deleted_at IS NULL`,
      tenantId,
    );
    return f.map((x) => ({ id: x.id, padreId: x.padre_id, nombre: x.nombre, unidadId: x.unidad_id, descripcion: x.descripcion }));
  }

  private visible(c: CarpetaNodo, k: Contexto) {
    return !k.unidades || !c.unidadEfectiva || k.unidades.includes(c.unidadEfectiva);
  }

  /** Carpetas visibles. Una carpeta oculta oculta también su subárbol. */
  private async carpetasVisibles(k: Contexto): Promise<CarpetaNodo[]> {
    const filas = await this.filasCarpetas(k.tenantId);
    const arbol = arbolCarpetas(filas);
    const ocultas = new Set<string>();
    for (const c of arbol) if (!this.visible(c, k)) for (const id of subarbol(filas, c.id)) ocultas.add(id);
    return arbol.filter((c) => !ocultas.has(c.id));
  }

  private async carpeta(k: Contexto, id: string): Promise<CarpetaNodo> {
    const c = (await this.carpetasVisibles(k)).find((x) => x.id === id);
    if (!c) throw new NotFoundException("Carpeta no encontrada.");
    return c;
  }

  async arbol(req: any) {
    const k = await this.ctx(req);
    const vis = await this.carpetasVisibles(k);
    const cuenta = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT carpeta_id, count(*)::int AS n FROM doc_documento WHERE tenant_id = $1::uuid AND deleted_at IS NULL GROUP BY carpeta_id`,
      k.tenantId,
    );
    const n = new Map(cuenta.map((x) => [x.carpeta_id, x.n]));
    const unidades = await this.prisma.$queryRawUnsafe<any[]>(`SELECT id, codigo, nombre FROM unidad WHERE tenant_id = $1::uuid`, k.tenantId);
    const u = new Map(unidades.map((x) => [x.id, `${x.codigo} · ${x.nombre}`]));
    return {
      puedeGestionar: k.gestiona,
      carpetas: vis.map((c) => ({
        ...c,
        unidad: c.unidadId ? u.get(c.unidadId) ?? null : null,
        unidadHeredada: !c.unidadId && c.unidadEfectiva ? u.get(c.unidadEfectiva) ?? null : null,
        documentos: n.get(c.id) ?? 0,
      })),
    };
  }

  private async exigirUnidadPropia(k: Contexto, unidadId: string | null) {
    if (unidadId && k.unidades && !k.unidades.includes(unidadId))
      throw new ForbiddenException("Solo puede restringir carpetas a unidades de su alcance.");
  }

  async crearCarpeta(req: any, b: any) {
    const k = await this.ctx(req);
    const nombre = texto(b?.nombre, 120, "el nombre de la carpeta", true)!;
    if (/[\/\\]/.test(nombre)) throw new BadRequestException("El nombre no puede llevar / ni \\.");
    const padreId = uuidOpcional(b?.padreId, "Carpeta padre");
    if (padreId) await this.carpeta(k, padreId);
    else if (k.unidades) throw new ForbiddenException("Las carpetas raíz las crea un perfil global (Calidad, Dirección o Administración).");
    const unidadId = uuidOpcional(b?.unidadId, "Unidad");
    await this.exigirUnidadPropia(k, unidadId);
    try {
      const r = await this.prisma.$queryRawUnsafe<any[]>(
        `INSERT INTO doc_carpeta (tenant_id, padre_id, nombre, descripcion, unidad_id, creado_por)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid, $6::uuid) RETURNING id`,
        k.tenantId, padreId, nombre, texto(b?.descripcion, 500, "la descripción"), unidadId, k.usuarioId,
      );
      return { id: r[0].id };
    } catch (e: any) {
      if (/23505/.test(String(e?.message ?? ""))) throw new ConflictException("Ya existe una carpeta con ese nombre en el mismo lugar.");
      throw e;
    }
  }

  async editarCarpeta(req: any, id: string, b: any) {
    const k = await this.ctx(req);
    const c = await this.carpeta(k, id);
    const sets: string[] = [];
    const args: any[] = [id, k.tenantId];
    if (b?.nombre !== undefined) {
      const nombre = texto(b.nombre, 120, "el nombre de la carpeta", true)!;
      if (/[\/\\]/.test(nombre)) throw new BadRequestException("El nombre no puede llevar / ni \\.");
      args.push(nombre);
      sets.push(`nombre = $${args.length}`);
    }
    if (b?.padreId !== undefined) {
      const padreId = uuidOpcional(b.padreId, "Carpeta padre");
      if (padreId) {
        await this.carpeta(k, padreId);
        if (esDescendiente(await this.filasCarpetas(k.tenantId), id, padreId)) throw new BadRequestException("No se puede mover una carpeta dentro de sí misma.");
      } else if (k.unidades) throw new ForbiddenException("Solo un perfil global deja una carpeta en la raíz.");
      args.push(padreId);
      sets.push(`padre_id = $${args.length}::uuid`);
    }
    if (b?.unidadId !== undefined) {
      const unidadId = uuidOpcional(b.unidadId, "Unidad");
      await this.exigirUnidadPropia(k, unidadId);
      if (!unidadId && c.unidadId && k.unidades) throw new ForbiddenException("Solo un perfil global quita la restricción de unidad.");
      args.push(unidadId);
      sets.push(`unidad_id = $${args.length}::uuid`);
    }
    if (b?.descripcion !== undefined) {
      args.push(texto(b.descripcion, 500, "la descripción"));
      sets.push(`descripcion = $${args.length}`);
    }
    if (!sets.length) return { id };
    try {
      await this.prisma.$executeRawUnsafe(
        `UPDATE doc_carpeta SET ${sets.join(", ")}, actualizado_en = now() WHERE id = $1::uuid AND tenant_id = $2::uuid`,
        ...args,
      );
    } catch (e: any) {
      if (/23505/.test(String(e?.message ?? ""))) throw new ConflictException("Ya existe una carpeta con ese nombre en el mismo lugar.");
      throw e;
    }
    return { id };
  }

  async borrarCarpeta(req: any, id: string) {
    const k = await this.ctx(req);
    await this.carpeta(k, id);
    const r = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT (SELECT count(*)::int FROM doc_carpeta WHERE padre_id = $1::uuid AND deleted_at IS NULL) AS hijas,
              (SELECT count(*)::int FROM doc_documento WHERE carpeta_id = $1::uuid AND deleted_at IS NULL) AS docs`,
      id,
    );
    if (r[0].hijas || r[0].docs) throw new ConflictException("Solo se elimina una carpeta vacía (sin subcarpetas ni documentos).");
    await this.prisma.$executeRawUnsafe(`UPDATE doc_carpeta SET deleted_at = now() WHERE id = $1::uuid AND tenant_id = $2::uuid`, id, k.tenantId);
    return { ok: true };
  }

  /* --------------------------------------------------------- documentos --- */

  /** Condición SQL (alias `d`) de documentos visibles para quien consulta; añade parámetros a `args`. */
  private condicionVisible(k: Contexto, carpetas: string[], args: any[]): string {
    args.push(carpetas);
    let s = ` AND d.carpeta_id = ANY($${args.length}::uuid[])`;
    if (!(k.gestiona && !k.unidades)) {
      args.push(k.usuarioId);
      const u = `$${args.length}::uuid`;
      s += ` AND (NOT d.restringido OR d.creado_por = ${u} OR EXISTS (SELECT 1 FROM doc_acceso a WHERE a.documento_id = d.id AND a.usuario_id = ${u}))`;
    }
    return s;
  }

  async listar(req: any, q: { carpetaId?: string; otId?: string; muestraId?: string; clienteId?: string; texto?: string; subcarpetas?: string }) {
    const k = await this.ctx(req);
    const vis = await this.carpetasVisibles(k);
    let ids = vis.map((c) => c.id);
    const carpetaId = uuidOpcional(q.carpetaId, "Carpeta");
    if (carpetaId) {
      if (!ids.includes(carpetaId)) throw new NotFoundException("Carpeta no encontrada.");
      ids = verdadero(q.subcarpetas) ? subarbol(vis, carpetaId).filter((x) => ids.includes(x)) : [carpetaId];
    }
    const args: any[] = [k.tenantId];
    let w = this.condicionVisible(k, ids, args);
    for (const [col, v, que] of [["ot_id", q.otId, "OT"], ["muestra_id", q.muestraId, "Muestra"], ["cliente_id", q.clienteId, "Cliente"]] as const) {
      const id = uuidOpcional(v, que);
      if (id) {
        args.push(id);
        w += ` AND d.${col} = $${args.length}::uuid`;
      }
    }
    if (q.texto?.trim()) {
      args.push(`%${q.texto.trim().slice(0, 100)}%`);
      w += ` AND (d.titulo ILIKE $${args.length} OR d.codigo ILIKE $${args.length} OR d.descripcion ILIKE $${args.length})`;
    }
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT d.id, d.codigo, d.titulo, d.descripcion, d.carpeta_id, d.restringido, d.version_publicada,
              d.creado_en, d.actualizado_en, d.ot_id, d.muestra_id, d.cliente_id,
              ot.codigo AS ot_codigo, m.codigo AS muestra_codigo, cl.razon_social AS cliente,
              uc.nombre_completo AS creado_por_nombre,
              (SELECT max(v.numero) FROM doc_version v WHERE v.documento_id = d.id) AS ultima_version,
              (SELECT v.nombre_archivo FROM doc_version v WHERE v.documento_id = d.id
                 ORDER BY (v.estado = 'PUBLICADA') DESC, v.numero DESC LIMIT 1) AS archivo
         FROM doc_documento d
         LEFT JOIN orden_trabajo ot ON ot.id = d.ot_id
         LEFT JOIN muestra m        ON m.id = d.muestra_id
         LEFT JOIN cliente cl       ON cl.id = d.cliente_id
         LEFT JOIN usuario uc       ON uc.id = d.creado_por
        WHERE d.tenant_id = $1::uuid AND d.deleted_at IS NULL ${w}
        ORDER BY d.titulo
        LIMIT 500`,
      ...args,
    );
    const ruta = new Map(vis.map((c) => [c.id, c.ruta]));
    return filas.map((f) => ({
      id: f.id,
      codigo: f.codigo,
      titulo: f.titulo,
      descripcion: f.descripcion,
      carpetaId: f.carpeta_id,
      carpeta: ruta.get(f.carpeta_id) ?? null,
      restringido: f.restringido,
      versionPublicada: f.version_publicada,
      ultimaVersion: f.ultima_version,
      archivo: f.archivo,
      otId: f.ot_id,
      otCodigo: f.ot_codigo,
      muestraId: f.muestra_id,
      muestraCodigo: f.muestra_codigo,
      clienteId: f.cliente_id,
      cliente: f.cliente,
      creadoPor: f.creado_por_nombre,
      creadoEn: f.creado_en,
      actualizadoEn: f.actualizado_en,
    }));
  }

  /** Documento visible + si quien consulta puede editarlo. */
  private async documento(k: Contexto, id: string) {
    const vis = await this.carpetasVisibles(k);
    const args: any[] = [k.tenantId, id];
    const w = this.condicionVisible(k, vis.map((c) => c.id), args);
    const f = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT d.* FROM doc_documento d WHERE d.tenant_id = $1::uuid AND d.id = $2::uuid AND d.deleted_at IS NULL ${w}`,
      ...args,
    );
    if (!f.length) throw new NotFoundException("Documento no encontrado.");
    const d = f[0];
    let edita = k.gestiona;
    if (edita && d.restringido && !(k.gestiona && !k.unidades) && d.creado_por !== k.usuarioId) {
      const a = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT nivel FROM doc_acceso WHERE documento_id = $1::uuid AND usuario_id = $2::uuid`,
        id,
        k.usuarioId,
      );
      edita = a[0]?.nivel === "editar";
    }
    return { d, edita, carpetas: vis };
  }

  private exigirEdicion(edita: boolean) {
    if (!edita) throw new ForbiddenException("No tiene permiso para modificar este documento.");
  }

  async ver(req: any, id: string) {
    const k = await this.ctx(req);
    const { d, edita, carpetas } = await this.documento(k, id);
    const versiones = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT v.numero, v.nombre_archivo, v.mime, v.bytes, v.hash_sha256, v.estado, v.comentario,
              v.subido_en, us.nombre_completo AS subido_por, v.publicado_en, up.nombre_completo AS publicado_por
         FROM doc_version v
         LEFT JOIN usuario us ON us.id = v.subido_por
         LEFT JOIN usuario up ON up.id = v.publicado_por
        WHERE v.documento_id = $1::uuid ORDER BY v.numero DESC`,
      id,
    );
    const accesos = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT a.usuario_id, u.nombre_completo AS nombre, u.username, a.nivel FROM doc_acceso a JOIN usuario u ON u.id = a.usuario_id
        WHERE a.documento_id = $1::uuid ORDER BY u.nombre_completo`,
      id,
    );
    const v = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT (SELECT codigo FROM orden_trabajo WHERE id = $1::uuid) AS ot,
              (SELECT codigo FROM muestra WHERE id = $2::uuid) AS muestra,
              (SELECT razon_social FROM cliente WHERE id = $3::uuid) AS cliente,
              (SELECT nombre_completo FROM usuario WHERE id = $4::uuid) AS creador`,
      d.ot_id,
      d.muestra_id,
      d.cliente_id,
      d.creado_por,
    );
    return {
      id: d.id,
      codigo: d.codigo,
      titulo: d.titulo,
      descripcion: d.descripcion,
      carpetaId: d.carpeta_id,
      carpeta: carpetas.find((c) => c.id === d.carpeta_id)?.ruta ?? null,
      restringido: d.restringido,
      versionPublicada: d.version_publicada,
      otId: d.ot_id,
      otCodigo: v[0].ot,
      muestraId: d.muestra_id,
      muestraCodigo: v[0].muestra,
      clienteId: d.cliente_id,
      cliente: v[0].cliente,
      creadoPor: v[0].creador,
      creadoEn: d.creado_en,
      puedeEditar: edita,
      // Quien solo lee ve únicamente la versión publicada.
      versiones: (edita ? versiones : versiones.filter((x) => x.estado === "PUBLICADA")).map((x) => ({
        numero: x.numero,
        archivo: x.nombre_archivo,
        mime: x.mime,
        bytes: x.bytes,
        hashSha256: x.hash_sha256,
        estado: x.estado,
        comentario: x.comentario,
        subidoEn: x.subido_en,
        subidoPor: x.subido_por,
        publicadoEn: x.publicado_en,
        publicadoPor: x.publicado_por,
      })),
      accesos: edita ? accesos.map((a) => ({ usuarioId: a.usuario_id, nombre: a.nombre, username: a.username, nivel: a.nivel })) : [],
    };
  }

  private validarArchivo(archivo: Archivo) {
    if (!archivo?.buffer?.length) throw new BadRequestException("Adjunte el archivo.");
    const nombre = nombreSeguro(archivo.originalname);
    const t = tipoArchivo(nombre, archivo.buffer);
    if ("error" in t) throw new BadRequestException(t.error);
    return { nombre, mime: t.mime, datos: archivo.buffer };
  }

  /** Valida que la OT, la muestra y el cliente existan y estén en el alcance. */
  private async vinculos(k: Contexto, req: any, b: any) {
    // La pantalla puede indicar la OT y la muestra por su código.
    const porCodigo = async (tabla: "orden_trabajo" | "muestra", codigo: unknown, que: string): Promise<string | null> => {
      const c = typeof codigo === "string" ? codigo.trim() : "";
      if (!c) return null;
      const f = await this.prisma.$queryRawUnsafe<any[]>(`SELECT id FROM ${tabla} WHERE tenant_id = $1::uuid AND upper(codigo) = upper($2) LIMIT 1`, k.tenantId, c);
      if (!f.length) throw new BadRequestException(`No existe ${que} ${c}.`);
      return f[0].id;
    };
    const otId = uuidOpcional(b?.otId, "OT") ?? (await porCodigo("orden_trabajo", b?.otCodigo, "la OT"));
    const muestraId = uuidOpcional(b?.muestraId, "Muestra") ?? (await porCodigo("muestra", b?.muestraCodigo, "la muestra"));
    let clienteId = uuidOpcional(b?.clienteId, "Cliente");
    if (otId) {
      const o = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT unidad_principal, cliente_id FROM orden_trabajo WHERE id = $1::uuid AND tenant_id = $2::uuid`, otId, k.tenantId);
      if (!o.length) throw new BadRequestException("La OT no existe.");
      await this.alcance.exigirUnidad(req, o[0].unidad_principal, "la OT", "documento.ver");
      clienteId = clienteId ?? o[0].cliente_id ?? null;
    }
    if (muestraId) {
      const m = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT m.ot_id, o.unidad_principal FROM muestra m LEFT JOIN orden_trabajo o ON o.id = m.ot_id
          WHERE m.id = $1::uuid AND m.tenant_id = $2::uuid`, muestraId, k.tenantId);
      if (!m.length) throw new BadRequestException("La muestra no existe.");
      if (otId && m[0].ot_id !== otId) throw new BadRequestException("La muestra no pertenece a la OT indicada.");
      await this.alcance.exigirUnidad(req, m[0].unidad_principal, "la muestra", "documento.ver");
    }
    if (clienteId) {
      const c = await this.prisma.$queryRawUnsafe<any[]>(`SELECT 1 FROM cliente WHERE id = $1::uuid AND tenant_id = $2::uuid`, clienteId, k.tenantId);
      if (!c.length) throw new BadRequestException("El cliente no existe.");
    }
    return { otId, muestraId, clienteId };
  }

  async crear(req: any, archivo: Archivo, b: any) {
    const k = await this.ctx(req);
    const a = this.validarArchivo(archivo);
    const carpetaId = uuidOpcional(b?.carpetaId, "Carpeta");
    if (!carpetaId) throw new BadRequestException("Indique la carpeta.");
    await this.carpeta(k, carpetaId);
    const titulo = texto(b?.titulo, 200, "el título") ?? a.nombre.replace(/\.[^.]+$/, "");
    const v = await this.vinculos(k, req, b);
    const publicar = verdadero(b?.publicar);
    const id = await this.prisma.$transaction(async (tx) => {
      const r = await tx.$queryRawUnsafe<any[]>(
        `INSERT INTO doc_documento (tenant_id, codigo, carpeta_id, titulo, descripcion, ot_id, muestra_id, cliente_id, creado_por, version_publicada)
         VALUES ($1::uuid, 'DOC-' || $10::text || '-' || lpad(nextval('doc_documento_seq')::text, 5, '0'),
                 $2::uuid, $3, $4, $5::uuid, $6::uuid, $7::uuid, $8::uuid, $9) RETURNING id, codigo`,
        k.tenantId, carpetaId, titulo, texto(b?.descripcion, 2000, "la descripción"), v.otId, v.muestraId, v.clienteId, k.usuarioId, publicar ? 1 : null, String(anioChile()),
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO doc_version (tenant_id, documento_id, numero, nombre_archivo, mime, bytes, datos, hash_sha256, estado, comentario, subido_por, publicado_por, publicado_en)
         VALUES ($1::uuid, $2::uuid, 1, $3, $4, $5, $6, $7, $8, $9, $10::uuid, $11::uuid, $12::timestamptz)`,
        k.tenantId, r[0].id, a.nombre, a.mime, a.datos.length, a.datos.toString("base64"),
        createHash("sha256").update(a.datos).digest("hex"), publicar ? "PUBLICADA" : "BORRADOR",
        texto(b?.comentario, 500, "el comentario") ?? "Versión inicial", k.usuarioId, publicar ? k.usuarioId : null, publicar ? new Date() : null,
      );
      return r[0].id as string;
    });
    return this.ver(req, id);
  }

  async nuevaVersion(req: any, id: string, archivo: Archivo, b: any) {
    const k = await this.ctx(req);
    const { edita } = await this.documento(k, id);
    this.exigirEdicion(edita);
    const a = this.validarArchivo(archivo);
    const publicar = verdadero(b?.publicar);
    await this.prisma.$transaction(async (tx) => {
      // Bloquea el documento: dos subidas a la vez no toman el mismo número.
      await tx.$queryRawUnsafe(`SELECT 1 FROM doc_documento WHERE id = $1::uuid FOR UPDATE`, id);
      const n = await tx.$queryRawUnsafe<any[]>(`SELECT COALESCE(max(numero), 0) + 1 AS n FROM doc_version WHERE documento_id = $1::uuid`, id);
      const numero = Number(n[0].n);
      // Los borradores anteriores quedan en el historial; se publica el que se elija.
      await tx.$executeRawUnsafe(
        `INSERT INTO doc_version (tenant_id, documento_id, numero, nombre_archivo, mime, bytes, datos, hash_sha256, estado, comentario, subido_por)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, 'BORRADOR', $9, $10::uuid)`,
        k.tenantId, id, numero, a.nombre, a.mime, a.datos.length, a.datos.toString("base64"),
        createHash("sha256").update(a.datos).digest("hex"), texto(b?.comentario, 500, "el comentario"), k.usuarioId,
      );
      await tx.$executeRawUnsafe(`UPDATE doc_documento SET actualizado_en = now(), actualizado_por = $2::uuid WHERE id = $1::uuid`, id, k.usuarioId);
      if (publicar) await this.publicarEn(tx, id, numero, k.usuarioId);
    });
    return this.ver(req, id);
  }

  private async publicarEn(tx: any, id: string, numero: number, usuarioId: string | null) {
    await tx.$executeRawUnsafe(`UPDATE doc_version SET estado = 'REEMPLAZADA' WHERE documento_id = $1::uuid AND estado = 'PUBLICADA' AND numero <> $2`, id, numero);
    await tx.$executeRawUnsafe(
      `UPDATE doc_version SET estado = 'PUBLICADA', publicado_por = $3::uuid, publicado_en = now() WHERE documento_id = $1::uuid AND numero = $2`,
      id, numero, usuarioId,
    );
    await tx.$executeRawUnsafe(
      `UPDATE doc_documento SET version_publicada = $2, actualizado_en = now(), actualizado_por = $3::uuid WHERE id = $1::uuid`,
      id, numero, usuarioId,
    );
  }

  async publicar(req: any, id: string, numero: number) {
    const k = await this.ctx(req);
    const { edita } = await this.documento(k, id);
    this.exigirEdicion(edita);
    const v = await this.prisma.$queryRawUnsafe<any[]>(`SELECT estado FROM doc_version WHERE documento_id = $1::uuid AND numero = $2`, id, numero);
    if (!v.length) throw new NotFoundException("Versión no encontrada.");
    if (v[0].estado === "PUBLICADA") throw new ConflictException("Esa versión ya es la publicada.");
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT 1 FROM doc_documento WHERE id = $1::uuid FOR UPDATE`, id);
      await this.publicarEn(tx, id, numero, k.usuarioId);
    });
    return this.ver(req, id);
  }

  async editar(req: any, id: string, b: any) {
    const k = await this.ctx(req);
    const { d, edita } = await this.documento(k, id);
    this.exigirEdicion(edita);
    const sets: string[] = [];
    const args: any[] = [id, k.usuarioId];
    if (b?.titulo !== undefined) {
      args.push(texto(b.titulo, 200, "el título", true));
      sets.push(`titulo = $${args.length}`);
    }
    if (b?.descripcion !== undefined) {
      args.push(texto(b.descripcion, 2000, "la descripción"));
      sets.push(`descripcion = $${args.length}`);
    }
    if (b?.carpetaId !== undefined) {
      const carpetaId = uuidOpcional(b.carpetaId, "Carpeta");
      if (!carpetaId) throw new BadRequestException("Indique la carpeta.");
      await this.carpeta(k, carpetaId);
      args.push(carpetaId);
      sets.push(`carpeta_id = $${args.length}::uuid`);
    }
    if ([b?.otId, b?.muestraId, b?.clienteId, b?.otCodigo, b?.muestraCodigo].some((x) => x !== undefined)) {
      const v = await this.vinculos(k, req, {
        otId: b?.otId !== undefined ? b.otId : b?.otCodigo !== undefined ? null : d.ot_id,
        otCodigo: b?.otCodigo,
        muestraId: b?.muestraId !== undefined ? b.muestraId : b?.muestraCodigo !== undefined ? null : d.muestra_id,
        muestraCodigo: b?.muestraCodigo,
        clienteId: b?.clienteId !== undefined ? b.clienteId : d.cliente_id,
      });
      for (const [col, val] of [["ot_id", v.otId], ["muestra_id", v.muestraId], ["cliente_id", v.clienteId]] as const) {
        args.push(val);
        sets.push(`${col} = $${args.length}::uuid`);
      }
    }
    if (!sets.length) return this.ver(req, id);
    await this.prisma.$executeRawUnsafe(
      `UPDATE doc_documento SET ${sets.join(", ")}, actualizado_en = now(), actualizado_por = $2::uuid WHERE id = $1::uuid`,
      ...args,
    );
    return this.ver(req, id);
  }

  async accesos(req: any, id: string, b: any) {
    const k = await this.ctx(req);
    const { edita } = await this.documento(k, id);
    this.exigirEdicion(edita);
    const lista: { usuarioId: string; nivel: string }[] = Array.isArray(b?.accesos) ? b.accesos : [];
    if (lista.length > 200) throw new BadRequestException("Como máximo 200 usuarios.");
    for (const a of lista) {
      if (!UUID_RE.test(String(a?.usuarioId ?? ""))) throw new BadRequestException("Usuario inválido.");
      if (!["ver", "editar"].includes(a?.nivel)) throw new BadRequestException("Nivel inválido: ver o editar.");
    }
    const ids = [...new Set(lista.map((a) => a.usuarioId))];
    if (ids.length) {
      const ok = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT count(*)::int AS n FROM usuario WHERE id = ANY($1::uuid[]) AND tenant_id = $2::uuid`, ids, k.tenantId);
      if (ok[0].n !== ids.length) throw new BadRequestException("Algún usuario no existe.");
    }
    const restringido = verdadero(b?.restringido);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`UPDATE doc_documento SET restringido = $2, actualizado_en = now() WHERE id = $1::uuid`, id, restringido);
      await tx.$executeRawUnsafe(`DELETE FROM doc_acceso WHERE documento_id = $1::uuid`, id);
      for (const a of lista)
        await tx.$executeRawUnsafe(
          `INSERT INTO doc_acceso (documento_id, usuario_id, nivel, otorgado_por) VALUES ($1::uuid, $2::uuid, $3, $4::uuid)
           ON CONFLICT (documento_id, usuario_id) DO UPDATE SET nivel = EXCLUDED.nivel`,
          id, a.usuarioId, a.nivel, k.usuarioId,
        );
    });
    return this.ver(req, id);
  }

  async borrar(req: any, id: string) {
    const k = await this.ctx(req);
    const { edita } = await this.documento(k, id);
    this.exigirEdicion(edita);
    await this.prisma.$executeRawUnsafe(
      `UPDATE doc_documento SET deleted_at = now(), actualizado_por = $2::uuid WHERE id = $1::uuid`, id, k.usuarioId);
    return { ok: true };
  }

  async descargar(req: any, id: string, numero?: number) {
    const k = await this.ctx(req);
    const { d, edita } = await this.documento(k, id);
    const n = numero ?? d.version_publicada;
    if (!n) throw new NotFoundException("El documento no tiene versión publicada.");
    if (!edita && n !== d.version_publicada) throw new ForbiddenException("Solo puede descargar la versión publicada.");
    const v = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT nombre_archivo, mime, datos FROM doc_version WHERE documento_id = $1::uuid AND numero = $2`, id, n);
    if (!v.length) throw new NotFoundException("Versión no encontrada.");
    return { nombre: v[0].nombre_archivo, mime: v[0].mime, datos: Buffer.from(v[0].datos, "base64") };
  }

  /** Usuarios activos para la lista de permisos (solo quien gestiona). */
  async usuarios(req: any, q?: string) {
    const k = await this.ctx(req);
    const args: any[] = [k.tenantId];
    let w = "";
    if (q?.trim()) {
      args.push(`%${q.trim().slice(0, 60)}%`);
      w = ` AND (nombre_completo ILIKE $2 OR username::text ILIKE $2)`;
    }
    return this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, nombre_completo AS nombre, username FROM usuario
        WHERE tenant_id = $1::uuid AND deleted_at IS NULL AND COALESCE(estado, 'activo') = 'activo' ${w} ORDER BY nombre_completo LIMIT 30`,
      ...args,
    );
  }
}
