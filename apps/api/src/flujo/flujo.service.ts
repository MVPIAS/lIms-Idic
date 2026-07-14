import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

/**
 * Motor BPM · los flujos viven como DATOS (flujo_def/version/paso/transicion)
 * y este servicio los ejecuta (flujo_instancia/paso_ejecucion/tarea_asignada).
 *
 * Reglas de avance:
 *  - INICIO   se completa al instanciar y avanza solo.
 *  - AUTO     se ejecuta y avanza solo (hook de automatismos).
 *  - DECISION evalúa las transiciones salientes en orden: la primera cuya
 *             condición sea verdadera contra el contexto gana; sin condición = default.
 *  - ACTIVIDAD / ESPERA  crean paso_ejecucion pendiente + tarea en bandeja;
 *             avanzan cuando alguien llama completarTarea().
 *  - FIN      completa la instancia.
 */
@Injectable()
export class FlujoService {
  private prisma = new PrismaClient();

  // ---------------------------------------------------------------- catálogo
  async listarDefs(tenantId?: string) {
    return this.prisma.flujoDef.findMany({
      // FlujoDef tiene tenant_id: solo los flujos del tenant del usuario.
      where: { ...(tenantId ? { tenantId } : {}) },
      orderBy: { codigo: "asc" },
      include: {
        versiones: {
          orderBy: { version: "desc" },
          take: 1,
          select: { id: true, version: true, estado: true, vigenteDesde: true },
        },
      },
    });
  }

  async detalleVersion(versionId: string) {
    const ver = await this.prisma.flujoVersion.findUnique({
      where: { id: versionId },
      include: {
        def: true,
        pasos: { orderBy: { numero: "asc" } },
        transiciones: { orderBy: { orden: "asc" } },
      },
    });
    if (!ver) throw new NotFoundException("Versión de flujo no encontrada");
    return ver;
  }

  async detallePorCodigo(codigo: string) {
    const def = await this.prisma.flujoDef.findFirst({
      where: { codigo },
      include: { versiones: { orderBy: { version: "desc" } } },
    });
    if (!def) throw new NotFoundException(`Flujo ${codigo} no existe`);
    const vigente =
      def.versiones.find((v) => v.estado === "publicado") ?? def.versiones[0];
    return this.detalleVersion(vigente.id);
  }

  // ------------------------------------------------------- diseño (no-code)
  /**
   * Guarda un borrador desde el diseñador visual. Recibe pasos con ids
   * temporales (tmpId) y transiciones que los referencian; crea una nueva
   * versión completa (inmutable frente a la publicada anterior).
   */
  async guardarBorrador(body: {
    codigo: string;
    nombre: string;
    categoria?: string;
    descripcion?: string;
    pasos: Array<{
      tmpId: string; numero: number; tipo: string; actividad: string;
      slaMinutos?: number; sistema?: string; condicion?: string;
    }>;
    transiciones: Array<{
      origenTmp: string; destinoTmp: string; condicion?: string;
      etiqueta?: string; orden?: number;
    }>;
  }, tenantIdArg?: string) {
    if (!body.pasos?.length) throw new BadRequestException("El flujo no tiene pasos");
    const tiposValidos = new Set(["INICIO","ACTIVIDAD","DECISION","AUTO","ESPERA","FIN","SUBPROCESO"]);
    for (const p of body.pasos)
      if (!tiposValidos.has(p.tipo))
        throw new BadRequestException(`Tipo de paso inválido: ${p.tipo}`);
    if (body.pasos.filter((p) => p.tipo === "INICIO").length !== 1)
      throw new BadRequestException("El flujo debe tener exactamente un paso INICIO");
    if (!body.pasos.some((p) => p.tipo === "FIN"))
      throw new BadRequestException("El flujo debe tener al menos un paso FIN");

    const tenantId = tenantIdArg ?? "00000000-0000-0000-0000-000000000000"; // del JWT (fallback DEV)

    return this.prisma.$transaction(async (tx) => {
      let def = await tx.flujoDef.findFirst({ where: { tenantId, codigo: body.codigo } });
      if (!def) {
        def = await tx.flujoDef.create({
          data: {
            tenantId, codigo: body.codigo, nombre: body.nombre,
            categoria: body.categoria, descripcion: body.descripcion,
          },
        });
      }
      const nVersiones = await tx.flujoVersion.count({ where: { flujoDefId: def.id } });
      const ver = await tx.flujoVersion.create({
        data: { flujoDefId: def.id, version: `v${nVersiones + 1}.0`, estado: "borrador" },
      });

      const idPorTmp = new Map<string, string>();
      for (const p of body.pasos) {
        const creado = await tx.flujoPaso.create({
          data: {
            flujoVersionId: ver.id, bpmnElementId: p.tmpId, numero: p.numero,
            tipo: p.tipo, actividad: p.actividad, slaMinutos: p.slaMinutos,
            sistema: p.sistema, condicion: p.condicion,
          },
        });
        idPorTmp.set(p.tmpId, creado.id);
      }
      for (const t of body.transiciones ?? []) {
        const origen = idPorTmp.get(t.origenTmp);
        const destino = idPorTmp.get(t.destinoTmp);
        if (!origen || !destino)
          throw new BadRequestException(`Transición con paso inexistente: ${t.origenTmp} → ${t.destinoTmp}`);
        await tx.flujoTransicion.create({
          data: {
            flujoVersionId: ver.id, origenPasoId: origen, destinoPasoId: destino,
            condicion: t.condicion, etiqueta: t.etiqueta, orden: t.orden ?? 0,
          },
        });
      }
      return { defId: def.id, versionId: ver.id, version: ver.version, estado: ver.estado };
    });
  }

  /** Publica una versión: pasa a 'publicado' y archiva la publicada anterior. */
  async publicar(versionId: string) {
    const ver = await this.prisma.flujoVersion.findUnique({ where: { id: versionId } });
    if (!ver) throw new NotFoundException();
    await this.prisma.flujoVersion.updateMany({
      where: { flujoDefId: ver.flujoDefId, estado: "publicado" },
      data: { estado: "archivado", vigenteHasta: new Date() },
    });
    return this.prisma.flujoVersion.update({
      where: { id: versionId },
      data: { estado: "publicado", vigenteDesde: new Date(), publicadoAt: new Date() },
    });
  }

  // ------------------------------------------------------------- ejecución
  /** Crea una instancia del flujo (p. ej. al generar una OT) y avanza lo automático. */
  async instanciar(versionId: string, body: { otId?: string; metadata?: Record<string, any>; usuarioId?: string }) {
    const ver = await this.detalleVersion(versionId);
    if (ver.estado !== "publicado")
      throw new BadRequestException("Solo se instancian versiones publicadas");
    const inicio = ver.pasos.find((p) => p.tipo === "INICIO");
    if (!inicio) throw new BadRequestException("El flujo no tiene paso INICIO");

    const instancia = await this.prisma.flujoInstancia.create({
      data: {
        tenantId: ver.def.tenantId, flujoVersionId: versionId, otId: body.otId,
        estado: "en_ejecucion", pasoActualId: inicio.id,
        iniciadoPor: body.usuarioId, metadata: body.metadata ?? {},
      },
    });
    await this.prisma.pasoEjecucion.create({
      data: {
        instanciaId: instancia.id, pasoId: inicio.id, estado: "completado",
        iniciadoAt: new Date(), completadoAt: new Date(),
      },
    });
    await this.avanzarDesde(instancia.id, inicio.id);
    return this.estadoInstancia(instancia.id);
  }

  /** Completa una tarea humana (ACTIVIDAD/ESPERA) y avanza el flujo. */
  async completarTarea(pasoEjecucionId: string, body: { resultado?: Record<string, any>; usuarioId?: string; notas?: string }) {
    const pe = await this.prisma.pasoEjecucion.findUnique({
      where: { id: pasoEjecucionId },
      include: { instancia: true, paso: true },
    });
    if (!pe) throw new NotFoundException("Ejecución de paso no encontrada");
    if (pe.estado === "completado") throw new BadRequestException("El paso ya está completado");

    const inicio = pe.iniciadoAt ?? new Date();
    const ahora = new Date();
    const durMin = Math.round((ahora.getTime() - inicio.getTime()) / 60000);
    await this.prisma.pasoEjecucion.update({
      where: { id: pe.id },
      data: {
        estado: "completado", completadoAt: ahora, duracionRealMin: durMin,
        excedioSla: pe.paso.slaMinutos ? durMin > pe.paso.slaMinutos : false,
        resultado: body.resultado ?? {},
      },
    });
    await this.prisma.tareaAsignada.updateMany({
      where: { pasoEjecucionId: pe.id, estado: { in: ["pendiente", "en_curso"] } },
      data: { estado: "completada", completadaAt: ahora, notasUsuario: body.notas },
    });
    // fusionar el resultado al contexto de la instancia (variables del flujo)
    const meta = { ...((pe.instancia.metadata as object) ?? {}), ...(body.resultado ?? {}) };
    await this.prisma.flujoInstancia.update({ where: { id: pe.instanciaId }, data: { metadata: meta } });

    await this.avanzarDesde(pe.instanciaId, pe.pasoId);
    return this.estadoInstancia(pe.instanciaId);
  }

  /** Bandeja de tareas pendientes (por usuario, o todas). */
  async bandeja(usuarioId?: string) {
    return this.prisma.tareaAsignada.findMany({
      where: {
        estado: { in: ["pendiente", "en_curso"] },
        ...(usuarioId ? { asignadoA: usuarioId } : {}),
      },
      orderBy: [{ venceAt: "asc" }, { prioridad: "desc" }],
      include: {
        pasoEjecucion: {
          include: { paso: true, instancia: { include: { version: { include: { def: true } } } } },
        },
      },
    });
  }

  async estadoInstancia(instanciaId: string) {
    const ins = await this.prisma.flujoInstancia.findUnique({
      where: { id: instanciaId },
      include: {
        version: { include: { def: true } },
        pasoActual: true,
        ejecuciones: { include: { paso: true }, orderBy: { iniciadoAt: "asc" } },
      },
    });
    if (!ins) throw new NotFoundException("Instancia no encontrada");
    return ins;
  }

  // ------------------------------------------------------------- interno
  /** Avanza desde un paso completado siguiendo las transiciones, resolviendo
   *  DECISION/AUTO en cadena hasta topar con trabajo humano o un FIN. */
  private async avanzarDesde(instanciaId: string, pasoCompletadoId: string): Promise<void> {
    const instancia = await this.prisma.flujoInstancia.findUniqueOrThrow({ where: { id: instanciaId } });
    const contexto = (instancia.metadata as Record<string, any>) ?? {};

    const siguiente = await this.resolverSiguiente(instancia.flujoVersionId, pasoCompletadoId, contexto);
    if (!siguiente) return; // sin transición saliente: el flujo queda donde está

    await this.prisma.flujoInstancia.update({
      where: { id: instanciaId }, data: { pasoActualId: siguiente.id },
    });

    if (siguiente.tipo === "FIN") {
      await this.prisma.pasoEjecucion.create({
        data: { instanciaId, pasoId: siguiente.id, estado: "completado", iniciadoAt: new Date(), completadoAt: new Date() },
      });
      await this.prisma.flujoInstancia.update({
        where: { id: instanciaId }, data: { estado: "completado", completadoAt: new Date() },
      });
      return;
    }

    if (siguiente.tipo === "AUTO" || siguiente.tipo === "DECISION") {
      // AUTO: hook de automatismos (cálculo, notificación, ETL...). DECISION: no requiere humano.
      await this.prisma.pasoEjecucion.create({
        data: { instanciaId, pasoId: siguiente.id, estado: "completado", iniciadoAt: new Date(), completadoAt: new Date() },
      });
      return this.avanzarDesde(instanciaId, siguiente.id);
    }

    // ACTIVIDAD / ESPERA / SUBPROCESO → trabajo humano: paso pendiente + tarea en bandeja
    const pe = await this.prisma.pasoEjecucion.create({
      data: {
        instanciaId, pasoId: siguiente.id, estado: "pendiente", iniciadoAt: new Date(),
        asignadoA: instancia.iniciadoPor,
      },
    });
    await this.prisma.tareaAsignada.create({
      data: {
        pasoEjecucionId: pe.id,
        asignadoA: instancia.iniciadoPor ?? "00000000-0000-0000-0000-000000000000",
        estado: "pendiente",
        venceAt: siguiente.slaMinutos ? new Date(Date.now() + siguiente.slaMinutos * 60000) : null,
      },
    });
  }

  private async resolverSiguiente(versionId: string, origenId: string, contexto: Record<string, any>) {
    const salientes = await this.prisma.flujoTransicion.findMany({
      where: { flujoVersionId: versionId, origenPasoId: origenId },
      orderBy: { orden: "asc" },
      include: { destino: true },
    });
    if (!salientes.length) return null;
    // primera transición cuya condición sea verdadera; sin condición = default
    for (const t of salientes) {
      if (!t.condicion || evaluarCondicion(t.condicion, contexto)) return t.destino;
    }
    return salientes[salientes.length - 1].destino; // fallback: la última (rama 'No')
  }
}

/**
 * Evaluador seguro de condiciones (sin eval): soporta comparaciones
 * `variable op literal` unidas por && / ||.  Ej: "cumple == true",
 * "monto > 1000000 && moneda == 'CLP'".
 */
export function evaluarCondicion(expr: string, ctx: Record<string, any>): boolean {
  const orParts = expr.split("||");
  return orParts.some((orP) =>
    orP.split("&&").every((andP) => evaluarComparacion(andP.trim(), ctx)),
  );
}

function evaluarComparacion(cmp: string, ctx: Record<string, any>): boolean {
  const m = cmp.match(/^([\w.]+)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if (!m) return false;
  const [, variable, op, litRaw] = m;
  const actual = variable.split(".").reduce((o: any, k) => (o == null ? undefined : o[k]), ctx);
  const lit = parseLiteral(litRaw.trim());
  switch (op) {
    case "==": return actual == lit;         // eslint-disable-line eqeqeq
    case "!=": return actual != lit;         // eslint-disable-line eqeqeq
    case ">":  return Number(actual) >  Number(lit);
    case "<":  return Number(actual) <  Number(lit);
    case ">=": return Number(actual) >= Number(lit);
    case "<=": return Number(actual) <= Number(lit);
    default:   return false;
  }
}

function parseLiteral(s: string): any {
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s.replace(/^['"]|['"]$/g, "");
}
