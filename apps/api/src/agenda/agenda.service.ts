import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { hoyChile, sumarDiasCalendario } from "../common/fecha-chile";
import { AlcanceService } from "../rbac/alcance.service";
import {
  MAX_DIAS_CONSULTA,
  RECURRENCIAS,
  TIPOS_EVENTO,
  TIPOS_RECURSO,
  bloque,
  costoUso,
  diasEntre,
  esDia,
  esHora,
  minutos,
  minutosJornada,
  minutosOcupados,
  ocurrencias,
  rangoVista,
  seSolapan,
  ultimaOcurrencia,
  type Bloque,
  type DefRecurrencia,
  type Recurrencia,
} from "./recurrencia";

// ===========================================================================
// Agenda de recursos y eventos (contrato §4.5.8, §4.5.9) · packages/db/align_agenda_recursos.sql
//
// Quién ve qué:
//   · un recurso con unidad solo lo ven (y reservan) quienes tienen esa unidad
//     en su alcance; uno sin unidad es institucional y lo ven todos;
//   · un evento lo ve quien lo organiza, sus participantes, y quien tiene en su
//     alcance la unidad del evento (sin unidad: todos);
//   · los costos los ven quienes gestionan recursos o ven reportes.
// Un recurso no se puede reservar dos veces a la misma hora: el choque con otro
// evento, o con la programación de análisis del equipo ligado, se rechaza (409).
// Todos los valores viajan como parámetros posicionales.
// ===========================================================================

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
const importe = (v: unknown, que: string): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1e11) throw new BadRequestException(`${que}: indique un número mayor o igual a 0.`);
  return Math.round(n * 100) / 100;
};
const listaDias = (v: unknown): number[] | null => {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v) || v.some((x) => !Number.isInteger(Number(x)) || Number(x) < 1 || Number(x) > 7))
    throw new BadRequestException("Días de la semana: números del 1 (lunes) al 7 (domingo).");
  return [...new Set(v.map(Number))].sort((a, b) => a - b);
};
const fmtUnidad = (u: any) => (u ? `${u.codigo} · ${u.nombre}` : null);

/** Horizonte con que se revisan choques de una serie sin fin. */
const HORIZONTE_SIN_FIN = 366;

interface Contexto {
  tenantId: string;
  usuarioId: string | null;
  unidades: string[] | null; // null = global
  gestiona: boolean;
  verCostos: boolean;
}

interface RecursoFila {
  id: string;
  tipo: string;
  nombre: string;
  descripcion: string | null;
  unidadId: string | null;
  equipoId: string | null;
  vehiculoId: string | null;
  ubicacionId: string | null;
  capacidad: number | null;
  costoHora: number | null;
  costoUso: number | null;
  moneda: string;
  horaDesde: string;
  horaHasta: string;
  diasHabiles: number[];
  activo: boolean;
}

interface EventoFila extends DefRecurrencia {
  id: string;
  titulo: string;
  tipo: string;
  lugar: string | null;
  unidadId: string | null;
  todoDia: boolean;
  horaInicio: string | null;
  horaFin: string | null;
  organizadorId: string | null;
  organizador: string | null;
  recursos: string[];
  participantes: string[];
}

const SELECT_RECURSO = `
  SELECT id, tipo, nombre, descripcion, unidad_id AS "unidadId", equipo_id AS "equipoId", vehiculo_id AS "vehiculoId",
         ubicacion_id AS "ubicacionId", capacidad, costo_hora::float8 AS "costoHora", costo_uso::float8 AS "costoUso", moneda,
         to_char(hora_desde, 'HH24:MI') AS "horaDesde", to_char(hora_hasta, 'HH24:MI') AS "horaHasta",
         dias_habiles::int[] AS "diasHabiles", activo
    FROM agenda_recurso`;

const SELECT_EVENTO = `
  SELECT e.id, e.titulo, e.tipo, e.lugar, e.unidad_id AS "unidadId", to_char(e.fecha, 'YYYY-MM-DD') AS fecha, e.todo_dia AS "todoDia",
         to_char(e.hora_inicio, 'HH24:MI') AS "horaInicio", to_char(e.hora_fin, 'HH24:MI') AS "horaFin",
         e.recurrencia, e.intervalo::int AS intervalo, e.dias_semana::int[] AS "diasSemana",
         to_char(e.repetir_hasta, 'YYYY-MM-DD') AS "repetirHasta", e.repeticiones::int AS repeticiones,
         e.organizador_id AS "organizadorId", u.nombre_completo AS organizador,
         COALESCE((SELECT array_agg(to_char(x.fecha, 'YYYY-MM-DD')) FROM agenda_evento_excepcion x WHERE x.evento_id = e.id), '{}') AS excepciones,
         COALESCE((SELECT array_agg(r.recurso_id) FROM agenda_evento_recurso r WHERE r.evento_id = e.id), '{}') AS recursos,
         COALESCE((SELECT array_agg(p.usuario_id) FROM agenda_evento_participante p WHERE p.evento_id = e.id), '{}') AS participantes
    FROM agenda_evento e
    LEFT JOIN usuario u ON u.id = e.organizador_id`;

@Injectable()
export class AgendaService {
  readonly prisma = new PrismaClient();

  constructor(private readonly alcance: AlcanceService) {}

  private async ctx(req: any): Promise<Contexto> {
    const gestiona = tiene(req, "recurso.gestionar");
    return {
      tenantId: tenantDe(req),
      usuarioId: usuarioDe(req),
      unidades: await this.alcance.filtroUnidades(req, "agenda.ver"),
      gestiona,
      verCostos: gestiona || tiene(req, "reporte.ver"),
    };
  }

  private enAlcance(k: Contexto, unidadId: string | null) {
    return !k.unidades || !unidadId || k.unidades.includes(unidadId);
  }

  private async unidades(tenantId: string): Promise<Map<string, string>> {
    const u = await this.prisma.$queryRawUnsafe<any[]>(`SELECT id, codigo, nombre FROM unidad WHERE tenant_id = $1::uuid`, tenantId);
    return new Map(u.map((x) => [x.id, fmtUnidad(x)!]));
  }

  /* ----------------------------------------------------------- recursos --- */

  private async recursosVisibles(k: Contexto, incluirInactivos = false): Promise<RecursoFila[]> {
    const f = await this.prisma.$queryRawUnsafe<RecursoFila[]>(
      `${SELECT_RECURSO} WHERE tenant_id = $1::uuid AND deleted_at IS NULL ${incluirInactivos ? "" : "AND activo"} ORDER BY tipo, lower(nombre)`,
      k.tenantId,
    );
    return f.filter((r) => this.enAlcance(k, r.unidadId));
  }

  private async recurso(k: Contexto, id: string): Promise<RecursoFila> {
    const r = (await this.recursosVisibles(k, true)).find((x) => x.id === id);
    if (!r) throw new NotFoundException("Recurso no encontrado.");
    return r;
  }

  private publico(k: Contexto, r: RecursoFila, u: Map<string, string>) {
    const { costoHora, costoUso, ...resto } = r;
    return { ...resto, unidad: r.unidadId ? u.get(r.unidadId) ?? null : null, ...(k.verCostos ? { costoHora, costoUso } : {}) };
  }

  async listarRecursos(req: any, incluirInactivos?: string) {
    const k = await this.ctx(req);
    const u = await this.unidades(k.tenantId);
    const lista = await this.recursosVisibles(k, incluirInactivos === "true" && k.gestiona);
    // Nombre de la ficha de origen (equipo, vehículo, sala) para mostrarlo junto al recurso.
    const origen = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT r.id, COALESCE(eq.codigo || ' · ' || COALESCE(eq.nombre, eq.descripcion), v.patente || ' · ' || COALESCE(v.marca, '') || ' ' || COALESCE(v.modelo, ''), ub.codigo || ' · ' || ub.nombre) AS origen
         FROM agenda_recurso r
         LEFT JOIN equipo eq ON eq.id = r.equipo_id
         LEFT JOIN vehiculo v ON v.id = r.vehiculo_id
         LEFT JOIN ubicacion ub ON ub.id = r.ubicacion_id
        WHERE r.tenant_id = $1::uuid AND r.deleted_at IS NULL`,
      k.tenantId,
    );
    const o = new Map(origen.map((x) => [x.id, x.origen]));
    return {
      puedeGestionar: k.gestiona,
      puedeCrearEventos: tiene(req, "agenda.crear"),
      verCostos: k.verCostos,
      recursos: lista.map((r) => ({ ...this.publico(k, r, u), origen: o.get(r.id) ?? null })),
    };
  }

  /** Fichas que se pueden ligar a un recurso: equipos, vehículos o ubicaciones (salas). */
  async origenes(req: any, tipo: string, q?: string) {
    const k = await this.ctx(req);
    const args: any[] = [k.tenantId];
    const filtro = q?.trim() ? (args.push(`%${q.trim().slice(0, 60)}%`), "$2") : null;
    if (tipo === "EQUIPO") {
      const f = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT id, codigo || ' · ' || COALESCE(nombre, descripcion, '') AS nombre, unidad_id AS "unidadId" FROM equipo
          WHERE tenant_id = $1::uuid AND deleted_at IS NULL ${filtro ? `AND (codigo ILIKE ${filtro} OR nombre ILIKE ${filtro} OR descripcion ILIKE ${filtro})` : ""}
          ORDER BY codigo LIMIT 50`,
        ...args,
      );
      return f.filter((x) => this.enAlcance(k, x.unidadId));
    }
    if (tipo === "VEHICULO")
      return this.prisma.$queryRawUnsafe<any[]>(
        `SELECT id, patente || ' · ' || COALESCE(marca, '') || ' ' || COALESCE(modelo, '') AS nombre, NULL::uuid AS "unidadId" FROM vehiculo
          WHERE tenant_id = $1::uuid ${filtro ? `AND (patente ILIKE ${filtro} OR marca ILIKE ${filtro} OR modelo ILIKE ${filtro})` : ""}
          ORDER BY patente LIMIT 50`,
        ...args,
      );
    if (tipo === "SALA") {
      const f = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT id, codigo || ' · ' || nombre AS nombre, unidad_id AS "unidadId" FROM ubicacion
          WHERE tenant_id = $1::uuid AND COALESCE(activa, TRUE) ${filtro ? `AND (codigo ILIKE ${filtro} OR nombre ILIKE ${filtro})` : ""}
          ORDER BY path LIMIT 50`,
        ...args,
      );
      return f.filter((x) => this.enAlcance(k, x.unidadId));
    }
    return [];
  }

  private datosRecurso(b: any, previo?: RecursoFila) {
    const tipo = b?.tipo ?? previo?.tipo;
    if (!TIPOS_RECURSO.includes(tipo)) throw new BadRequestException(`Tipo de recurso inválido. Válidos: ${TIPOS_RECURSO.join(", ")}.`);
    const horaDesde = b?.horaDesde ?? previo?.horaDesde ?? "08:30";
    const horaHasta = b?.horaHasta ?? previo?.horaHasta ?? "17:30";
    if (!esHora(horaDesde) || !esHora(horaHasta) || minutos(horaHasta) <= minutos(horaDesde))
      throw new BadRequestException("Horario disponible: indique «desde» y «hasta» (HH:MM), con «hasta» posterior.");
    const moneda = b?.moneda ?? previo?.moneda ?? "CLP";
    if (!["CLP", "USD"].includes(moneda)) throw new BadRequestException("Moneda: CLP o USD.");
    const capacidad = b?.capacidad === undefined ? previo?.capacidad ?? null : b.capacidad === null || b.capacidad === "" ? null : Number(b.capacidad);
    if (capacidad !== null && (!Number.isInteger(capacidad) || capacidad < 0 || capacidad > 10000)) throw new BadRequestException("Capacidad: número entero.");
    const liga = (campo: string, de: string) => (b && campo in b ? uuidOpcional(b[campo], de) : ((previo as any)?.[campo] ?? null));
    return {
      tipo,
      nombre: b?.nombre !== undefined ? texto(b.nombre, 120, "el nombre del recurso", true)! : previo!.nombre,
      descripcion: b?.descripcion !== undefined ? texto(b.descripcion, 500, "la descripción") : previo?.descripcion ?? null,
      unidadId: b && "unidadId" in b ? uuidOpcional(b.unidadId, "Unidad") : previo?.unidadId ?? null,
      equipoId: tipo === "EQUIPO" ? liga("equipoId", "Equipo") : null,
      vehiculoId: tipo === "VEHICULO" ? liga("vehiculoId", "Vehículo") : null,
      ubicacionId: tipo === "SALA" ? liga("ubicacionId", "Sala") : null,
      capacidad,
      costoHora: b && "costoHora" in b ? importe(b.costoHora, "Costo por hora") : previo?.costoHora ?? null,
      costoUso: b && "costoUso" in b ? importe(b.costoUso, "Costo por uso") : previo?.costoUso ?? null,
      moneda,
      horaDesde,
      horaHasta,
      diasHabiles: listaDias(b?.diasHabiles) ?? previo?.diasHabiles ?? [1, 2, 3, 4, 5],
      activo: b?.activo === undefined ? previo?.activo ?? true : b.activo === true || b.activo === "true",
    };
  }

  private async guardarRecurso(k: Contexto, d: ReturnType<AgendaService["datosRecurso"]>, id?: string): Promise<string> {
    if (d.unidadId && k.unidades && !k.unidades.includes(d.unidadId)) throw new ForbiddenException("Solo puede asignar recursos a unidades de su alcance.");
    if (!d.unidadId && k.unidades) throw new ForbiddenException("Los recursos institucionales (sin unidad) los registra un perfil global.");
    const args = [k.tenantId, d.tipo, d.nombre, d.descripcion, d.unidadId, d.equipoId, d.vehiculoId, d.ubicacionId, d.capacidad, d.costoHora, d.costoUso, d.moneda, d.horaDesde, d.horaHasta, d.diasHabiles, d.activo];
    try {
      if (!id) {
        const r = await this.prisma.$queryRawUnsafe<any[]>(
          `INSERT INTO agenda_recurso (tenant_id, tipo, nombre, descripcion, unidad_id, equipo_id, vehiculo_id, ubicacion_id, capacidad, costo_hora, costo_uso, moneda, hora_desde, hora_hasta, dias_habiles, activo, creado_por)
           VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6::uuid, $7::uuid, $8::uuid, $9, $10, $11, $12, $13::time, $14::time, $15::smallint[], $16, $17::uuid) RETURNING id`,
          ...args, k.usuarioId,
        );
        return r[0].id;
      }
      await this.prisma.$executeRawUnsafe(
        `UPDATE agenda_recurso SET tipo = $2, nombre = $3, descripcion = $4, unidad_id = $5::uuid, equipo_id = $6::uuid, vehiculo_id = $7::uuid, ubicacion_id = $8::uuid,
                capacidad = $9, costo_hora = $10, costo_uso = $11, moneda = $12, hora_desde = $13::time, hora_hasta = $14::time, dias_habiles = $15::smallint[], activo = $16,
                actualizado_en = now()
          WHERE tenant_id = $1::uuid AND id = $17::uuid`,
        ...args, id,
      );
      return id;
    } catch (e: any) {
      if (/23505/.test(String(e?.message ?? ""))) throw new ConflictException("Ya existe un recurso con ese nombre.");
      throw e;
    }
  }

  async crearRecurso(req: any, b: any) {
    const k = await this.ctx(req);
    return { id: await this.guardarRecurso(k, this.datosRecurso(b)) };
  }

  async editarRecurso(req: any, id: string, b: any) {
    const k = await this.ctx(req);
    const previo = await this.recurso(k, id);
    await this.guardarRecurso(k, this.datosRecurso(b, previo), id);
    return { id };
  }

  /** Baja lógica; se rechaza si tiene reservas futuras. */
  async borrarRecurso(req: any, id: string) {
    const k = await this.ctx(req);
    await this.recurso(k, id);
    const futuras = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT count(*)::int AS n FROM agenda_evento_recurso er JOIN agenda_evento e ON e.id = er.evento_id
        WHERE er.recurso_id = $1::uuid AND e.deleted_at IS NULL AND (e.ultima_fecha IS NULL OR e.ultima_fecha >= $2::date)`,
      id, hoyChile(),
    );
    if (futuras[0].n) throw new ConflictException(`El recurso tiene ${futuras[0].n} evento(s) vigentes. Quítelo de esos eventos o márquelo inactivo.`);
    await this.prisma.$executeRawUnsafe(`UPDATE agenda_recurso SET deleted_at = now() WHERE tenant_id = $1::uuid AND id = $2::uuid`, k.tenantId, id);
    return { ok: true };
  }

  /* ------------------------------------------------------------ eventos --- */

  private async eventosEnRango(tenantId: string, desde: string, hasta: string, extra = "", extraArgs: any[] = []): Promise<EventoFila[]> {
    return this.prisma.$queryRawUnsafe<EventoFila[]>(
      `${SELECT_EVENTO}
        WHERE e.tenant_id = $1::uuid AND e.deleted_at IS NULL AND e.fecha <= $3::date AND (e.ultima_fecha IS NULL OR e.ultima_fecha >= $2::date) ${extra}`,
      tenantId, desde, hasta, ...extraArgs,
    );
  }

  private ve(k: Contexto, e: EventoFila) {
    return this.enAlcance(k, e.unidadId) || e.organizadorId === k.usuarioId || (!!k.usuarioId && e.participantes.includes(k.usuarioId));
  }

  private puedeEditar(k: Contexto, e: { organizadorId: string | null; unidadId: string | null }) {
    return e.organizadorId === k.usuarioId || (k.gestiona && this.enAlcance(k, e.unidadId));
  }

  /** Programación de análisis que ocupa equipos ligados a recursos (solo lectura). */
  private async programacionEquipos(tenantId: string, desde: string, hasta: string) {
    return this.prisma.$queryRawUnsafe<any[]>(
      `SELECT r.id AS "recursoId", to_char(p.fecha_programada, 'YYYY-MM-DD') AS dia,
              to_char(p.hora_inicio, 'HH24:MI') AS "horaInicio", to_char(p.hora_fin, 'HH24:MI') AS "horaFin",
              ot.codigo AS "otCodigo", p.estado
         FROM programacion p
         JOIN agenda_recurso r ON r.equipo_id = p.equipo_id AND r.deleted_at IS NULL AND r.tenant_id = p.tenant_id
         LEFT JOIN orden_trabajo ot ON ot.id = p.ot_id
        WHERE p.tenant_id = $1::uuid AND p.fecha_programada BETWEEN $2::date AND $3::date
          AND COALESCE(p.estado, '') NOT IN ('cancelado', 'anulado')`,
      tenantId, desde, hasta,
    );
  }

  /** Rango de días pedido: por vista (día/semana/mes) o desde/hasta explícitos. */
  private rango(q: { vista?: string; fecha?: string; desde?: string; hasta?: string }) {
    let { desde, hasta } = q;
    if (!desde || !hasta) ({ desde, hasta } = rangoVista(q.vista ?? "semana", esDia(q.fecha) ? q.fecha : hoyChile()));
    if (!esDia(desde) || !esDia(hasta) || hasta < desde) throw new BadRequestException("Rango de fechas inválido (aaaa-mm-dd).");
    if (diasEntre(desde, hasta) > MAX_DIAS_CONSULTA) throw new BadRequestException(`Consulte como máximo ${MAX_DIAS_CONSULTA} días.`);
    return { desde, hasta };
  }

  async calendario(req: any, q: { vista?: string; fecha?: string; desde?: string; hasta?: string; recursoId?: string; soloMios?: string }) {
    const k = await this.ctx(req);
    const { desde, hasta } = this.rango(q);
    const recursos = await this.recursosVisibles(k, true);
    const porId = new Map(recursos.map((r) => [r.id, r]));
    const recursoId = uuidOpcional(q.recursoId, "Recurso");
    const soloMios = q.soloMios === "true";
    const eventos = (await this.eventosEnRango(k.tenantId, desde, hasta)).filter(
      (e) => this.ve(k, e) && (!recursoId || e.recursos.includes(recursoId)) && (!soloMios || e.organizadorId === k.usuarioId || (!!k.usuarioId && e.participantes.includes(k.usuarioId))),
    );
    const salida: any[] = [];
    for (const e of eventos)
      for (const dia of ocurrencias(e, desde, hasta))
        salida.push({
          eventoId: e.id,
          fecha: dia,
          titulo: e.titulo,
          tipo: e.tipo,
          lugar: e.lugar,
          todoDia: e.todoDia,
          horaInicio: e.horaInicio,
          horaFin: e.horaFin,
          recurrente: e.recurrencia !== "NINGUNA",
          organizador: e.organizador,
          participantes: e.participantes.length,
          recursos: e.recursos.map((id) => porId.get(id)).filter(Boolean).map((r) => ({ id: r!.id, nombre: r!.nombre, tipo: r!.tipo })),
          puedeEditar: this.puedeEditar(k, e),
        });
    const prog = (await this.programacionEquipos(k.tenantId, desde, hasta))
      .filter((p) => porId.has(p.recursoId) && (!recursoId || p.recursoId === recursoId) && !soloMios)
      .map((p) => ({ ...p, recurso: porId.get(p.recursoId)!.nombre }));
    salida.sort((a, b) => (a.fecha + (a.todoDia ? "00:00" : a.horaInicio)).localeCompare(b.fecha + (b.todoDia ? "00:00" : b.horaInicio)));
    return { desde, hasta, ocurrencias: salida, programacion: prog };
  }

  /** §4.5.8 · Disponibilidad y valoración por recurso y día. */
  async disponibilidad(req: any, q: { vista?: string; fecha?: string; desde?: string; hasta?: string; tipo?: string }) {
    const k = await this.ctx(req);
    const { desde, hasta } = this.rango(q);
    const recursos = (await this.recursosVisibles(k)).filter((r) => !q.tipo || r.tipo === q.tipo);
    const u = await this.unidades(k.tenantId);
    const eventos = await this.eventosEnRango(k.tenantId, desde, hasta);
    const prog = await this.programacionEquipos(k.tenantId, desde, hasta);
    const dias: string[] = [];
    for (let d = desde; d <= hasta; d = sumarDiasCalendario(d, 1)) dias.push(d);

    const filas = recursos.map((r) => {
      const jornada = { desde: r.horaDesde, hasta: r.horaHasta };
      const usos = new Map<string, { bloques: Bloque[]; costo: number; eventos: number; analisis: number }>();
      const anotar = (b: Bloque, deAnalisis: boolean) => {
        const x = usos.get(b.dia) ?? { bloques: [], costo: 0, eventos: 0, analisis: 0 };
        x.bloques.push(b);
        x.costo += costoUso(r, Math.max(0, b.fin - b.inicio));
        if (deAnalisis) x.analisis++;
        else x.eventos++;
        usos.set(b.dia, x);
      };
      for (const e of eventos) if (e.recursos.includes(r.id)) for (const d of ocurrencias(e, desde, hasta)) anotar(bloque(d, e, jornada), false);
      for (const p of prog) if (p.recursoId === r.id) anotar(bloque(p.dia, { todoDia: !p.horaInicio || !p.horaFin, horaInicio: p.horaInicio, horaFin: p.horaFin }, jornada), true);

      let tJornada = 0;
      let tOcupado = 0;
      let tCosto = 0;
      const porDia = dias.map((dia) => {
        const x = usos.get(dia);
        const jor = minutosJornada(r, dia);
        const ocu = x ? minutosOcupados(x.bloques, jornada) : 0;
        tJornada += jor;
        tOcupado += Math.min(ocu, jor || ocu);
        tCosto += x?.costo ?? 0;
        return {
          dia,
          jornada: jor,
          ocupado: ocu,
          eventos: x?.eventos ?? 0,
          analisis: x?.analisis ?? 0,
          ...(k.verCostos ? { costo: Math.round((x?.costo ?? 0) * 100) / 100 } : {}),
        };
      });
      return {
        recurso: { ...this.publico(k, r, u) },
        dias: porDia,
        total: {
          jornada: tJornada,
          ocupado: tOcupado,
          ocupacion: tJornada ? Math.round((1000 * tOcupado) / tJornada) / 10 : null,
          ...(k.verCostos ? { costo: Math.round(tCosto * 100) / 100 } : {}),
        },
      };
    });
    return { desde, hasta, dias, verCostos: k.verCostos, recursos: filas };
  }

  private async evento(k: Contexto, id: string): Promise<EventoFila> {
    const f = await this.prisma.$queryRawUnsafe<EventoFila[]>(`${SELECT_EVENTO} WHERE e.tenant_id = $1::uuid AND e.id = $2::uuid AND e.deleted_at IS NULL`, k.tenantId, id);
    if (!f[0] || !this.ve(k, f[0])) throw new NotFoundException("Evento no encontrado.");
    return f[0];
  }

  async ficha(req: any, id: string) {
    const k = await this.ctx(req);
    const e = await this.evento(k, id);
    const extra = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT e.descripcion, e.ot_id AS "otId", ot.codigo AS "otCodigo", e.creado_en AS "creadoEn", e.actualizado_en AS "actualizadoEn", to_char(e.ultima_fecha, 'YYYY-MM-DD') AS "ultimaFecha"
         FROM agenda_evento e LEFT JOIN orden_trabajo ot ON ot.id = e.ot_id WHERE e.id = $1::uuid`,
      id,
    );
    const participantes = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT p.usuario_id AS "usuarioId", u.nombre_completo AS nombre, u.username, p.respuesta
         FROM agenda_evento_participante p JOIN usuario u ON u.id = p.usuario_id WHERE p.evento_id = $1::uuid ORDER BY u.nombre_completo`,
      id,
    );
    const u = await this.unidades(k.tenantId);
    const todos = await this.prisma.$queryRawUnsafe<RecursoFila[]>(`${SELECT_RECURSO} WHERE tenant_id = $1::uuid`, k.tenantId);
    const recursos = todos.filter((r) => e.recursos.includes(r.id));
    const duracion = (r: RecursoFila) => (e.todoDia ? minutos(r.horaHasta) - minutos(r.horaDesde) : minutos(e.horaFin!) - minutos(e.horaInicio!));
    const costoOcurrencia = recursos.reduce((s, r) => s + costoUso(r, duracion(r)), 0);
    const proximas = ocurrencias(e, hoyChile(), sumarDiasCalendario(hoyChile(), 366)).slice(0, 10);
    return {
      ...e,
      ...extra[0],
      unidad: e.unidadId ? u.get(e.unidadId) ?? null : null,
      participantes,
      recursos: recursos.map((r) => this.publico(k, r, u)),
      ...(k.verCostos ? { costoOcurrencia: Math.round(costoOcurrencia * 100) / 100 } : {}),
      proximas,
      puedeEditar: this.puedeEditar(k, e),
      soyParticipante: !!k.usuarioId && e.participantes.includes(k.usuarioId),
    };
  }

  private datosEvento(b: any, previo?: EventoFila & { descripcion?: string | null; otId?: string | null }) {
    const v = <T>(campo: string, def: T): any => (b && campo in b ? b[campo] : def);
    const fecha = v("fecha", previo?.fecha);
    if (!esDia(fecha)) throw new BadRequestException("Indique la fecha del evento (aaaa-mm-dd).");
    const td = v("todoDia", previo?.todoDia ?? false);
    const todoDia = td === true || td === "true";
    const horaInicio = todoDia ? null : v("horaInicio", previo?.horaInicio ?? null);
    const horaFin = todoDia ? null : v("horaFin", previo?.horaFin ?? null);
    if (!todoDia && (!esHora(horaInicio) || !esHora(horaFin) || minutos(horaFin) <= minutos(horaInicio)))
      throw new BadRequestException("Indique hora de inicio y de término (HH:MM), con el término posterior al inicio, o marque «día completo».");
    const recurrencia = v("recurrencia", previo?.recurrencia ?? "NINGUNA") as Recurrencia;
    if (!RECURRENCIAS.includes(recurrencia)) throw new BadRequestException(`Repetición inválida. Válidas: ${RECURRENCIAS.join(", ")}.`);
    const intervalo = Number(v("intervalo", previo?.intervalo ?? 1));
    if (!Number.isInteger(intervalo) || intervalo < 1 || intervalo > 99) throw new BadRequestException("«Cada»: entero entre 1 y 99.");
    const repetirHasta = recurrencia === "NINGUNA" ? null : v("repetirHasta", previo?.repetirHasta ?? null) || null;
    if (repetirHasta && (!esDia(repetirHasta) || repetirHasta < fecha)) throw new BadRequestException("«Repetir hasta» debe ser una fecha igual o posterior al inicio.");
    const rep = recurrencia === "NINGUNA" ? null : v("repeticiones", previo?.repeticiones ?? null);
    const repeticiones = rep === null || rep === "" || rep === undefined ? null : Number(rep);
    if (repeticiones !== null && (!Number.isInteger(repeticiones) || repeticiones < 1 || repeticiones > 500)) throw new BadRequestException("Número de repeticiones: entre 1 y 500.");
    if (recurrencia !== "NINGUNA" && !repetirHasta && !repeticiones) throw new BadRequestException("Una serie debe terminar: indique «repetir hasta» o el número de repeticiones.");
    if (repetirHasta && diasEntre(fecha, repetirHasta) > 366 * 3) throw new BadRequestException("Una serie puede durar como máximo 3 años.");
    const tipo = v("tipo", previo?.tipo ?? "REUNION");
    if (!(TIPOS_EVENTO as readonly string[]).includes(tipo)) throw new BadRequestException(`Tipo de evento inválido. Válidos: ${TIPOS_EVENTO.join(", ")}.`);
    const ids = (x: unknown, que: string) => {
      if (!Array.isArray(x)) throw new BadRequestException(`${que}: lista de identificadores.`);
      if (x.length > 60) throw new BadRequestException(`${que}: como máximo 60.`);
      return [...new Set(x.map((i) => uuidOpcional(i, que)!).filter(Boolean))];
    };
    const def: DefRecurrencia = {
      fecha,
      recurrencia,
      intervalo,
      diasSemana: recurrencia === "SEMANAL" ? listaDias(v("diasSemana", previo?.diasSemana ?? null)) : null,
      repetirHasta,
      repeticiones,
      excepciones: previo?.excepciones ?? [],
    };
    return {
      ...def,
      titulo: b?.titulo !== undefined ? texto(b.titulo, 160, "el título", true)! : previo!.titulo,
      descripcion: b?.descripcion !== undefined ? texto(b.descripcion, 2000, "la descripción") : previo?.descripcion ?? null,
      tipo,
      lugar: b?.lugar !== undefined ? texto(b.lugar, 160, "el lugar") : previo?.lugar ?? null,
      unidadId: b && "unidadId" in b ? uuidOpcional(b.unidadId, "Unidad") : previo?.unidadId ?? null,
      otCodigo: b?.otCodigo !== undefined ? texto(b.otCodigo, 40, "la OT") : undefined,
      todoDia,
      horaInicio,
      horaFin,
      recursos: b?.recursos !== undefined ? ids(b.recursos, "Recursos") : previo?.recursos ?? [],
      participantes: b?.participantes !== undefined ? ids(b.participantes, "Participantes") : previo?.participantes ?? [],
      ultimaFecha: ultimaOcurrencia(def),
    };
  }

  /**
   * Choques de recursos: otras reservas (eventos o análisis programados) que pisan
   * alguna ocurrencia. Una serie sin fin se revisa en el próximo año.
   */
  private async choques(k: Contexto, d: ReturnType<AgendaService["datosEvento"]>, recursos: RecursoFila[], excluirId?: string): Promise<string[]> {
    if (!recursos.length) return [];
    const desde = d.fecha;
    const hasta = d.ultimaFecha ?? sumarDiasCalendario(d.fecha, HORIZONTE_SIN_FIN);
    const propias = ocurrencias(d, desde, hasta);
    if (!propias.length) return [];
    const otros = (await this.eventosEnRango(k.tenantId, desde, hasta, excluirId ? "AND e.id <> $4::uuid" : "", excluirId ? [excluirId] : [])).filter((e) =>
      e.recursos.some((r) => recursos.some((x) => x.id === r)),
    );
    const prog = await this.programacionEquipos(k.tenantId, desde, hasta);
    const salida: string[] = [];
    for (const r of recursos) {
      const jornada = { desde: r.horaDesde, hasta: r.horaHasta };
      const mios = new Map(propias.map((dia) => [dia, bloque(dia, d, jornada)]));
      for (const e of otros) {
        if (!e.recursos.includes(r.id)) continue;
        for (const dia of ocurrencias(e, desde, hasta)) {
          const m = mios.get(dia);
          if (m && seSolapan(m, bloque(dia, e, jornada))) {
            salida.push(`${r.nombre}: ${dia} ya reservado para «${e.titulo}»${e.todoDia ? " (día completo)" : ` ${e.horaInicio}–${e.horaFin}`}`);
            break;
          }
        }
      }
      for (const p of prog) {
        if (p.recursoId !== r.id) continue;
        const m = mios.get(p.dia);
        if (m && seSolapan(m, bloque(p.dia, { todoDia: !p.horaInicio || !p.horaFin, horaInicio: p.horaInicio, horaFin: p.horaFin }, jornada))) {
          salida.push(`${r.nombre}: ${p.dia} con análisis programado${p.otCodigo ? ` (OT ${p.otCodigo})` : ""}`);
          break;
        }
      }
    }
    return salida;
  }

  private async resolverOt(k: Contexto, codigo: string | null | undefined): Promise<string | null | undefined> {
    if (codigo === undefined) return undefined;
    if (codigo === null) return null;
    const r = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, unidad_principal FROM orden_trabajo WHERE tenant_id = $1::uuid AND upper(codigo) = upper($2) LIMIT 1`,
      k.tenantId, codigo,
    );
    if (!r[0] || !this.enAlcance(k, r[0].unidad_principal)) throw new BadRequestException(`No se encontró la OT ${codigo} en su alcance.`);
    return r[0].id;
  }

  private async guardarEvento(k: Contexto, d: ReturnType<AgendaService["datosEvento"]>, id?: string): Promise<string> {
    if (d.unidadId && !this.enAlcance(k, d.unidadId)) throw new ForbiddenException("Solo puede asociar eventos a unidades de su alcance.");
    const visibles = await this.recursosVisibles(k, true);
    const recursos = d.recursos.map((rid) => {
      const r = visibles.find((x) => x.id === rid);
      if (!r) throw new BadRequestException("Uno de los recursos no existe o no está en su alcance.");
      if (!r.activo && !id) throw new BadRequestException(`El recurso «${r.nombre}» está inactivo.`);
      return r;
    });
    if (d.participantes.length) {
      const ok = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT count(*)::int AS n FROM usuario WHERE tenant_id = $1::uuid AND deleted_at IS NULL AND id = ANY($2::uuid[])`,
        k.tenantId, d.participantes,
      );
      if (ok[0].n !== d.participantes.length) throw new BadRequestException("Uno de los participantes no existe.");
    }
    const choques = await this.choques(k, d, recursos, id);
    if (choques.length) throw new ConflictException(`Recurso no disponible. ${choques.slice(0, 5).join(" · ")}${choques.length > 5 ? ` · y ${choques.length - 5} más` : ""}`);
    const otId = await this.resolverOt(k, d.otCodigo);

    return this.prisma.$transaction(async (tx) => {
      const args = [k.tenantId, d.titulo, d.descripcion, d.tipo, d.lugar, d.unidadId, d.fecha, d.todoDia, d.horaInicio, d.horaFin, d.recurrencia, d.intervalo, d.diasSemana, d.repetirHasta, d.repeticiones, d.ultimaFecha, k.usuarioId];
      let eid = id;
      if (!eid) {
        const r = await tx.$queryRawUnsafe<any[]>(
          `INSERT INTO agenda_evento (tenant_id, titulo, descripcion, tipo, lugar, unidad_id, fecha, todo_dia, hora_inicio, hora_fin, recurrencia, intervalo, dias_semana, repetir_hasta, repeticiones, ultima_fecha, organizador_id, ot_id)
           VALUES ($1::uuid, $2, $3, $4, $5, $6::uuid, $7::date, $8, $9::time, $10::time, $11, $12, $13::smallint[], $14::date, $15, $16::date, $17::uuid, $18::uuid) RETURNING id`,
          ...args, otId ?? null,
        );
        eid = r[0].id as string;
      } else {
        await tx.$executeRawUnsafe(
          `UPDATE agenda_evento SET titulo = $2, descripcion = $3, tipo = $4, lugar = $5, unidad_id = $6::uuid, fecha = $7::date, todo_dia = $8, hora_inicio = $9::time, hora_fin = $10::time,
                  recurrencia = $11, intervalo = $12, dias_semana = $13::smallint[], repetir_hasta = $14::date, repeticiones = $15, ultima_fecha = $16::date,
                  actualizado_por = $17::uuid, actualizado_en = now() ${otId !== undefined ? ", ot_id = $19::uuid" : ""}
            WHERE tenant_id = $1::uuid AND id = $18::uuid`,
          ...args, eid, ...(otId !== undefined ? [otId] : []),
        );
        await tx.$executeRawUnsafe(`DELETE FROM agenda_evento_recurso WHERE evento_id = $1::uuid`, eid);
        await tx.$executeRawUnsafe(`DELETE FROM agenda_evento_participante WHERE evento_id = $1::uuid AND NOT (usuario_id = ANY($2::uuid[]))`, eid, d.participantes);
        // Las excepciones anteriores al nuevo inicio ya no aplican.
        await tx.$executeRawUnsafe(`DELETE FROM agenda_evento_excepcion WHERE evento_id = $1::uuid AND fecha < $2::date`, eid, d.fecha);
      }
      if (recursos.length)
        await tx.$executeRawUnsafe(`INSERT INTO agenda_evento_recurso (evento_id, recurso_id) SELECT $1::uuid, unnest($2::uuid[])`, eid, recursos.map((r) => r.id));
      if (d.participantes.length)
        await tx.$executeRawUnsafe(
          `INSERT INTO agenda_evento_participante (evento_id, usuario_id) SELECT $1::uuid, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
          eid, d.participantes,
        );
      return eid!;
    });
  }

  async crearEvento(req: any, b: any) {
    const k = await this.ctx(req);
    return { id: await this.guardarEvento(k, this.datosEvento(b)) };
  }

  async editarEvento(req: any, id: string, b: any) {
    const k = await this.ctx(req);
    const e = await this.evento(k, id);
    if (!this.puedeEditar(k, e)) throw new ForbiddenException("Solo el organizador o quien gestiona recursos puede modificar el evento.");
    const extra = await this.prisma.$queryRawUnsafe<any[]>(`SELECT descripcion FROM agenda_evento WHERE id = $1::uuid`, id);
    await this.guardarEvento(k, this.datosEvento(b, { ...e, descripcion: extra[0]?.descripcion ?? null }), id);
    return { id };
  }

  /** Anula una ocurrencia de una serie (o el evento único, que equivale a borrarlo). */
  async anularOcurrencia(req: any, id: string, fecha: unknown) {
    const k = await this.ctx(req);
    const e = await this.evento(k, id);
    if (!this.puedeEditar(k, e)) throw new ForbiddenException("Solo el organizador o quien gestiona recursos puede anular ocurrencias.");
    if (!esDia(fecha)) throw new BadRequestException("Indique la fecha a anular (aaaa-mm-dd).");
    if (e.recurrencia === "NINGUNA") throw new BadRequestException("El evento no se repite: elimínelo.");
    if (!ocurrencias(e, fecha, fecha).length) throw new BadRequestException("Esa fecha no es una ocurrencia del evento.");
    await this.prisma.$executeRawUnsafe(`INSERT INTO agenda_evento_excepcion (evento_id, fecha) VALUES ($1::uuid, $2::date) ON CONFLICT DO NOTHING`, id, fecha);
    return { ok: true };
  }

  async borrarEvento(req: any, id: string) {
    const k = await this.ctx(req);
    const e = await this.evento(k, id);
    if (!this.puedeEditar(k, e)) throw new ForbiddenException("Solo el organizador o quien gestiona recursos puede eliminar el evento.");
    await this.prisma.$executeRawUnsafe(`UPDATE agenda_evento SET deleted_at = now(), actualizado_por = $2::uuid WHERE id = $1::uuid`, id, k.usuarioId);
    return { ok: true };
  }

  async responder(req: any, id: string, respuesta: unknown) {
    const k = await this.ctx(req);
    const e = await this.evento(k, id);
    if (!k.usuarioId || !e.participantes.includes(k.usuarioId)) throw new ForbiddenException("No figura como participante de este evento.");
    if (!["ACEPTA", "RECHAZA", "PENDIENTE"].includes(String(respuesta))) throw new BadRequestException("Respuesta: ACEPTA, RECHAZA o PENDIENTE.");
    await this.prisma.$executeRawUnsafe(
      `UPDATE agenda_evento_participante SET respuesta = $3 WHERE evento_id = $1::uuid AND usuario_id = $2::uuid`,
      id, k.usuarioId, String(respuesta),
    );
    return { ok: true };
  }

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
