/**
 * Sistema · respaldos programados (contrato §4.8.4) e inteligencia de negocio
 * (Metabase, §4.7.5 / §4.5.7 / §4.6.5). Guía de operación: docs/RESPALDOS_Y_BI.md.
 *
 * Rutas:
 *   GET  respaldos            · estado (verde/rojo), último, próximo, política e historial (admin.respaldos)
 *   POST respaldos/solicitar  · «Respaldar ahora»: deja una solicitud que el servicio atiende en ≤ 1 min (admin.respaldos)
 *   GET  sistema/bi           · dirección de Metabase (variable URL_BI) para el menú (reporte.ver)
 *
 * Los respaldos los hace el servicio «respaldo» de docker-compose.prod.yml (o
 * backup.sh en on-premise); esta API solo lee `respaldo_registro` /
 * `respaldo_servicio` y avisa a quien tenga admin.respaldos si un respaldo
 * falla o se atrasa (Mi bandeja › Avisos y correo, una vez por fallo / por día).
 */
import { ConflictException, Controller, Get, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PrismaService } from "../common/prisma.service";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";
import { AvisosService } from "../avisos/avisos.service";
import { hoyCl } from "../ot/plazos";
import { estadoRespaldos, politicaDe, proximoRespaldo, servicioActivo, tamanoLegible, type ServicioRespaldo } from "./respaldos.reglas";
import { urlBi } from "./bi.reglas";

const QUINCE_MIN = 15 * 60 * 1000;

interface FilaRegistro {
  id: number;
  tipo: string;
  resultado: string;
  solicitadoAt: Date;
  solicitadoPor: string | null;
  inicio: Date | null;
  fin: Date | null;
  duracionS: number | null;
  tamanoBytes: string | null;
  objetos: number | null;
  archivo: string | null;
  nivel: string | null;
  disponible: boolean;
  mensaje: string | null;
  servidor: string | null;
}

const COLUMNAS = `r.id::int AS id, r.tipo, r.resultado, r.solicitado_at AS "solicitadoAt",
  COALESCE(u.nombre_completo, u.username) AS "solicitadoPor", r.inicio, r.fin, r.duracion_s AS "duracionS",
  r.tamano_bytes::text AS "tamanoBytes", r.objetos, r.archivo, r.nivel, r.disponible, r.mensaje, r.servidor`;

@Injectable()
export class RespaldosService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(RespaldosService.name);
  private reloj: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly avisos: AvisosService,
  ) {}

  onModuleInit() {
    // Revisión de fallos y atrasos cada 15 minutos (desactivable como los demás avisos).
    if (process.env.AVISOS_AUTOMATICOS !== "false" && process.env.NODE_ENV !== "test") {
      this.reloj = setInterval(() => this.revisarAvisos().catch((e) => this.log.warn(`revisión de respaldos omitida: ${e?.message ?? e}`)), QUINCE_MIN);
      this.reloj.unref?.();
      setTimeout(() => this.revisarAvisos().catch(() => undefined), 60_000).unref?.();
    }
  }

  onModuleDestroy() {
    if (this.reloj) clearInterval(this.reloj);
  }

  private async parametros(tenantId: string) {
    return this.prisma
      .$queryRawUnsafe<{ codigo: string; valor: string | null; activo: boolean }[]>(
        `SELECT codigo, valor, activo FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = 'respaldos'`,
        tenantId,
      )
      .catch(() => []);
  }

  private async servicio(): Promise<(ServicioRespaldo & { detalle: Record<string, unknown> }) | null> {
    const [s] = await this.prisma
      .$queryRawUnsafe<{ modo: string; latidoAt: Date; detalle: Record<string, unknown> }[]>(
        `SELECT modo, latido_at AS "latidoAt", detalle FROM respaldo_servicio WHERE id = 1`,
      )
      .catch(() => []);
    return s ?? null;
  }

  private async filas(where: string, limite: number): Promise<FilaRegistro[]> {
    return this.prisma.$queryRawUnsafe<FilaRegistro[]>(
      `SELECT ${COLUMNAS} FROM respaldo_registro r LEFT JOIN usuario u ON u.id = r.solicitado_por
        WHERE ${where} ORDER BY r.id DESC LIMIT $1::int`,
      limite,
    );
  }

  /** Todo lo que muestra Administración › Respaldos. */
  async panel(tenantId: string) {
    const ahora = new Date();
    let instalado = true;
    const [filasParam, servicio, historial, [ultimoTerminado], [ultimoOk], [pendiente]] = await Promise.all([
      this.parametros(tenantId),
      this.servicio(),
      this.filas("TRUE", 60).catch(() => {
        instalado = false;
        return [] as FilaRegistro[];
      }),
      this.filas("r.resultado IN ('OK', 'ERROR')", 1).catch(() => [] as FilaRegistro[]),
      this.filas("r.resultado = 'OK'", 1).catch(() => [] as FilaRegistro[]),
      this.filas("r.resultado IN ('SOLICITADO', 'EN_CURSO')", 1).catch(() => [] as FilaRegistro[]),
    ]);
    const politica = politicaDe(filasParam, servicio);
    const estado = estadoRespaldos({ ultimoTerminado: ultimoTerminado ?? null, ultimoOk: ultimoOk ?? null, servicio, ahora, horasAlerta: politica.horasAlerta });
    const conTexto = (f?: FilaRegistro | null) => (f ? { ...f, tamanoTexto: f.tamanoBytes ? tamanoLegible(f.tamanoBytes) : null } : null);
    const d = servicio?.detalle ?? {};
    return {
      // false = falta align_brechas_6.sql en esta base.
      instalado,
      estado,
      politica,
      proximo: proximoRespaldo(ahora, politica.hora).toISOString(),
      servicio: servicio
        ? {
            modo: servicio.modo,
            latidoAt: servicio.latidoAt,
            activo: estado.servicioActivo,
            directorio: typeof d.directorio === "string" ? d.directorio : null,
            libreMb: Number.isFinite(Number(d.libre_mb)) ? Number(d.libre_mb) : null,
            servidor: typeof d.servidor === "string" ? d.servidor : null,
          }
        : null,
      // «Respaldar ahora» solo lo atiende el servicio en contenedor (backup.sh corre por systemd).
      puedeSolicitar: servicio?.modo === "contenedor" && estado.servicioActivo && !pendiente,
      ultimo: conTexto(ultimoTerminado),
      ultimoOk: conTexto(ultimoOk),
      pendiente: conTexto(pendiente),
      historial: historial.map((f) => conTexto(f)!),
    };
  }

  /** «Respaldar ahora»: el servicio la toma en su próxima vuelta (cada minuto). */
  async solicitar(usuarioId: string | null) {
    const servicio = await this.servicio();
    if (!servicio || servicio.modo !== "contenedor" || !servicioActivo(servicio, new Date(), 24)) {
      throw new ConflictException(
        "No se puede pedir un respaldo inmediato: el servicio de respaldo programado no está en marcha en este servidor. Avise al administrador de la plataforma.",
      );
    }
    const [enCurso] = await this.filas("r.resultado IN ('SOLICITADO', 'EN_CURSO')", 1);
    if (enCurso) {
      throw new ConflictException(`Ya hay un respaldo ${enCurso.resultado === "EN_CURSO" ? "en curso" : "pedido"} (n.º ${enCurso.id}). Espere a que termine para pedir otro.`);
    }
    const [r] = await this.prisma.$queryRawUnsafe<{ id: number }[]>(
      `INSERT INTO respaldo_registro (tipo, resultado, solicitado_por) VALUES ('manual', 'SOLICITADO', $1::uuid) RETURNING id::int AS id`,
      usuarioId,
    );
    return { id: r.id, mensaje: `Respaldo n.º ${r.id} pedido. El servicio lo empieza en menos de un minuto; esta pantalla se actualiza sola.` };
  }

  /** Personas que reciben los avisos de respaldo: quien tenga admin.respaldos por alguno de sus roles vigentes. */
  private async destinatarios(tenantId: string): Promise<string[]> {
    const f = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT DISTINCT ur.usuario_id AS id
         FROM usuario_rol ur
         JOIN rol r          ON r.id = ur.rol_id AND r.tenant_id = $1::uuid
         JOIN rol_permiso rp ON rp.rol_id = r.id
         JOIN permiso p      ON p.id = rp.permiso_id AND p.codigo = 'admin.respaldos'
        WHERE (ur.vigente_desde IS NULL OR ur.vigente_desde <= now()) AND (ur.vigente_hasta IS NULL OR ur.vigente_hasta > now())`,
      tenantId,
    );
    return f.map((x) => x.id);
  }

  /**
   * Avisos a los administradores (Mi bandeja › Avisos y correo):
   *   · cada respaldo fallido, una vez;
   *   · estado en rojo por atraso o servicio detenido, una vez al día.
   * Solo si hay un servicio de respaldo instalado (sin él, la pantalla lo dice en rojo, sin avisos diarios).
   */
  async revisarAvisos() {
    const servicio = await this.servicio();
    const fallos = await this.prisma
      .$queryRawUnsafe<{ id: number; tipo: string; mensaje: string | null; inicio: Date | null }[]>(
        `SELECT id::int AS id, tipo, mensaje, COALESCE(inicio, solicitado_at) AS inicio FROM respaldo_registro
          WHERE resultado = 'ERROR' AND avisado_at IS NULL ORDER BY id LIMIT 20`,
      )
      .catch(() => null);
    if (fallos === null) return; // falta align_brechas_6.sql
    const tenants = await this.prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM tenant`).catch(() => []);
    for (const t of tenants) {
      const politica = politicaDe(await this.parametros(t.id), servicio);
      if (!politica.avisarFallo) continue;
      const usuarios = await this.destinatarios(t.id);
      if (!usuarios.length) continue;
      for (const f of fallos) {
        await this.avisos.emitir(
          t.id,
          {
            tipo: "respaldo",
            titulo: `Respaldo de la base de datos fallido (n.º ${f.id})`,
            mensaje: `El respaldo ${f.tipo === "manual" ? "pedido a mano" : "programado"} n.º ${f.id} falló${f.mensaje ? `: ${f.mensaje}` : "."} Revise Administración › Respaldos.`,
            ruta: "/admin/respaldos",
            clave: `respaldo_fallo:${f.id}`,
          },
          { usuarios },
        );
      }
      if (!servicio) continue;
      const [ultimoTerminado] = await this.filas("r.resultado IN ('OK', 'ERROR')", 1);
      const [ultimoOk] = await this.filas("r.resultado = 'OK'", 1);
      const estado = estadoRespaldos({ ultimoTerminado: ultimoTerminado ?? null, ultimoOk: ultimoOk ?? null, servicio, ahora: new Date(), horasAlerta: politica.horasAlerta });
      // El fallo ya tiene su aviso propio; el diario es por atraso o servicio detenido.
      const otros = estado.motivos.filter((m) => !m.startsWith("El último respaldo falló"));
      if (otros.length) {
        await this.avisos.emitir(
          t.id,
          {
            tipo: "respaldo",
            titulo: "Respaldo de la base de datos atrasado",
            mensaje: `${otros.join(" ")} Revise Administración › Respaldos.`,
            ruta: "/admin/respaldos",
            clave: `respaldo_atrasado:${hoyCl()}`,
          },
          { usuarios },
        );
      }
    }
    if (fallos.length) {
      await this.prisma.$executeRawUnsafe(`UPDATE respaldo_registro SET avisado_at = now() WHERE id = ANY($1::bigint[])`, fallos.map((f) => f.id));
    }
  }
}

@ApiTags("respaldos")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("respaldos")
export class RespaldosController {
  constructor(private readonly svc: RespaldosService) {}

  @Get()
  @RequierePermiso("admin.respaldos")
  panel(@Req() req: any) {
    return this.svc.panel(req.user.tenantId);
  }

  @Post("solicitar")
  @RequierePermiso("admin.respaldos")
  solicitar(@Req() req: any) {
    return this.svc.solicitar(req?.user?.sub ?? null);
  }
}

@ApiTags("sistema")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("sistema")
export class SistemaController {
  /** Menú «Análisis e inteligencia de negocio (Metabase)»: la dirección sale de URL_BI. */
  @Get("bi")
  @RequierePermiso("reporte.ver")
  bi() {
    const url = urlBi(process.env.URL_BI);
    return { configurado: !!url, url };
  }
}

@Module({
  controllers: [RespaldosController, SistemaController],
  providers: [RespaldosService],
})
export class SistemaModule {}
