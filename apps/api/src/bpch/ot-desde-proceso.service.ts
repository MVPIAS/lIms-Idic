import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma.service";
import { generarCodigoOt } from "../common/codigo";
import { AlcanceService } from "../rbac/alcance.service";
import { descendientes } from "../rbac/alcance";
import { LaboratorioOtService, UnidadResumen } from "../ot/laboratorio-ot.service";
import { CODIGO_BPCH, CODIGO_SCC, puedeOperarEnUnidad, filtroExpedientesBpch, expedienteVisible } from "./alcance-bpch";

/** Cliente con el que se escribe: el servicio o la transacción en curso. */
type Tx = Prisma.TransactionClient | PrismaService;

export interface DatosOtProceso {
  tenantId: string;
  usuarioId: string | null;
  clienteId: string;
  unidad: UnidadResumen;
  /** Origen de la OT (parametro_sistema · origen_trabajo). */
  origen: "PRODUCCION_NACIONAL" | "PROTOTIPO" | "INTERNACION" | "REINSPECCION";
  conCobro: boolean;
  /** Resolución DGMN (RAF o solicitud del prototipo) → orden_trabajo.numero_ley. */
  resolucion: string | null;
  descripcion: string;
  elementoGenerico?: string | null;
  catElementoId?: string | null;
  /** orden_trabajo.tipo_trabajo (p. ej. CERTIFICACION, REINSPECCION). */
  tipoTrabajo?: string | null;
  /**
   * Tipo del hecho en ot_historial. Por defecto 'origen_bpch' con
   * { origen, ...detalleHistorial }; con un tipo propio (bpch_internacion,
   * bpch_reinspeccion) se guarda detalleHistorial tal cual.
   */
  tipoHistorial?: string;
  detalleHistorial: Record<string, unknown>;
}

/**
 * Piezas comunes de los procesos BPCH que se apoyan en el flujo general:
 * crean la OT (mismo correlativo OT-AAAA-NNNN y mismo alta del laboratorio
 * responsable que POST /ot), validan que la unidad sea del Banco de Pruebas y
 * aplican la regla de alcance de alcance-bpch.ts. Es el ÚNICO lugar donde se
 * crean las OT de los procesos BPCH (Producción Nacional, Prototipos,
 * Internación y Reinspección) y se toman sus correlativos (revisión r3,
 * hallazgo 16).
 */
@Injectable()
export class OtDesdeProcesoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
    private readonly labs: LaboratorioOtService,
  ) {}

  /** La unidad existe, es operativa (LaboratorioOtService) y cuelga de BPCH. */
  async unidadDeBpch(tenantId: string, unidadId: string): Promise<UnidadResumen> {
    const u = await this.labs.validarUnidad(tenantId, unidadId);
    const arbol = await this.alcance.arbol(tenantId);
    const raiz = arbol.porCodigo.get(CODIGO_BPCH);
    if (raiz && !descendientes(arbol, raiz.id, true).includes(u.id))
      throw new BadRequestException(`${u.codigo} · ${u.nombre} no pertenece al Banco de Pruebas de Chile.`);
    return u;
  }

  /** Unidades del Banco de Pruebas que pueden ser responsables de una OT (selector). */
  async unidadesBpch(tenantId: string): Promise<(UnidadResumen & { codsucdel: string | null })[]> {
    const arbol = await this.alcance.arbol(tenantId);
    const raiz = arbol.porCodigo.get(CODIGO_BPCH);
    const todas = await this.labs.laboratorios(tenantId);
    if (!raiz) return todas;
    const rama = new Set(descendientes(arbol, raiz.id, true));
    return todas.filter((u) => rama.has(u.id));
  }

  /**
   * Filtro de unidades para listar expedientes BPCH con unidad (prototipos,
   * clasificaciones): null = todos (global, o la SCC en su alcance).
   * Con el permiso de la ruta (alcance por asignación).
   */
  async filtroExpedientes(req: any): Promise<string[] | null> {
    const visibles = await this.alcance.filtroUnidades(req);
    const arbol = await this.alcance.arbol(req?.user?.tenantId);
    return filtroExpedientesBpch(visibles, arbol.porCodigo.get(CODIGO_SCC)?.id ?? null);
  }

  /** 403 si el expediente (por su unidad) no está en el alcance del usuario. */
  async exigirExpediente(req: any, unidadId: string | null | undefined, que: string) {
    if (!expedienteVisible(await this.filtroExpedientes(req), unidadId))
      throw new ForbiddenException(
        unidadId
          ? `Fuera de su alcance: ${que} es de una unidad que usted no tiene asignada.`
          : `Fuera de su alcance: ${que} aún no tiene unidad asignada; lo gestionan la Sección Certificación de la Conformidad y la jefatura del BPCH.`,
      );
  }

  /** 403 si el usuario no puede programar ni generar OT para esa unidad (alcance-bpch.ts). */
  async exigirOperarEnUnidad(req: any, unidad: UnidadResumen) {
    const visibles = await this.alcance.filtroUnidades(req);
    const arbol = await this.alcance.arbol(req?.user?.tenantId);
    const scc = arbol.porCodigo.get(CODIGO_SCC)?.id ?? null;
    if (!puedeOperarEnUnidad(visibles, unidad.id, scc))
      throw new ForbiddenException(
        `Fuera de su alcance: no puede programar ni generar OT para ${unidad.codigo} · ${unidad.nombre}.`,
      );
  }

  /** Correlativo propio (PROTO / CLS / ITPN / INT / REI) por tenant y año, atómico: «PROTO-2026-0001». */
  async correlativo(tx: Pick<PrismaService, "$queryRawUnsafe">, tenantId: string, tipo: string): Promise<string> {
    const anio = new Date().getFullYear();
    const filas = await tx.$queryRawUnsafe<{ ultimo: number }[]>(
      `INSERT INTO bpch_correlativo (tenant_id, tipo, anio, ultimo) VALUES ($1::uuid, $2, $3, 1)
       ON CONFLICT (tenant_id, tipo, anio) DO UPDATE SET ultimo = bpch_correlativo.ultimo + 1, updated_at = now()
       RETURNING ultimo`,
      tenantId,
      tipo,
      anio,
    );
    return `${tipo}-${anio}-${String(Number(filas[0]?.ultimo ?? 1)).padStart(4, "0")}`;
  }

  /**
   * Crea la OT del proceso DENTRO de la transacción `tx`: correlativo, origen,
   * cobro, resolución, laboratorio responsable (con su historial) y el hecho
   * «origen_bpch» en ot_historial. Devuelve { id, codigo }.
   */
  async crearOt(tx: Tx, d: DatosOtProceso): Promise<{ id: string; codigo: string }> {
    const codigo = await generarCodigoOt(tx, d.tenantId);
    const ot = await tx.ordenTrabajo.create({
      data: {
        tenantId: d.tenantId,
        codigo,
        clienteId: d.clienteId,
        prioridad: "normal",
        estado: "recepcionada",
        fechaRecepcion: new Date(),
        origenTrabajo: d.origen,
        conCobro: d.conCobro,
        numeroLey: d.resolucion?.slice(0, 40) || null,
        descripcionTrabajo: d.descripcion.slice(0, 4000),
        elementoGenerico: d.elementoGenerico?.slice(0, 240) || null,
        catElementoId: d.catElementoId ?? null,
        tipoTrabajo: d.tipoTrabajo?.slice(0, 120) || null,
      },
      select: { id: true, codigo: true },
    });
    if (d.usuarioId) await tx.$executeRawUnsafe(`UPDATE orden_trabajo SET created_by = $2::uuid WHERE id = $1::uuid`, ot.id, d.usuarioId);
    await this.labs.fijar(tx as any, {
      tenantId: d.tenantId,
      otId: ot.id,
      unidad: d.unidad,
      usuarioId: d.usuarioId,
      origen: "alta_indicado",
    });
    await this.labs.anotar(tx as any, {
      tenantId: d.tenantId,
      otId: ot.id,
      tipo: d.tipoHistorial ?? "origen_bpch",
      usuarioId: d.usuarioId,
      detalle: d.tipoHistorial ? d.detalleHistorial : { origen: d.origen, ...d.detalleHistorial },
    });
    return ot;
  }

  /** Resultados vivos de una OT (estado y veredicto) para dictámenes y resúmenes. */
  async resultadosDeOt(otId: string): Promise<{ estado: string; veredicto: string | null }[]> {
    return this.prisma.$queryRawUnsafe(
      `SELECT estado, veredicto FROM resultado WHERE ot_id = $1::uuid AND deleted_at IS NULL`,
      otId,
    );
  }
}
