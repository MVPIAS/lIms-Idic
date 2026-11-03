/**
 * Envío automático de correos por etapa de la actividad (contrato §4.5.4).
 *
 * Escucha los eventos de negocio (common/eventos.ts) y, si la etapa tiene una
 * plantilla ACTIVA con «envío automático» encendido en Mensajería › Plantillas,
 * envía el correo al cliente de la OT con MensajeriaService (queda en la
 * bitácora `correo_enviado`, tipo «etapa»). Las etapas automáticas nacen
 * apagadas: las enciende el IDIC. Nada de esto afecta a la operación que
 * originó el evento.
 *
 *   ot.creada              → «OT creada»
 *   muestras.registradas   → «Muestras recibidas»
 *   documento.oficial      → «Informe oficial»
 */
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, forwardRef } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { alEvento } from "../common/eventos";
import { fechaChile } from "../common/fecha-chile";
import { MensajeriaService } from "./mensajeria.module";

@Injectable()
export class EtapasCorreoService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(EtapasCorreoService.name);
  private bajas: (() => void)[] = [];

  constructor(
    private readonly prisma: PrismaService,
    // forwardRef: mensajeria.module importa este archivo (import circular).
    @Inject(forwardRef(() => MensajeriaService)) private readonly mensajeria: MensajeriaService,
  ) {}

  onModuleInit() {
    const seguro = (f: () => Promise<unknown>) => f().catch((e) => this.log.warn(`correo de etapa omitido: ${e?.message ?? e}`));
    this.bajas.push(alEvento("ot.creada", (d) => seguro(() => this.otCreada(d.otId))));
    this.bajas.push(alEvento("muestras.registradas", (d) => seguro(() => this.muestrasRecibidas(d.otId, d.muestraIds))));
    this.bajas.push(alEvento("documento.oficial", (d) => seguro(() => this.documentoOficial(d.certificadoId, d.tenantId))));
  }

  onModuleDestroy() {
    this.bajas.forEach((b) => b());
  }

  private async ot(otId: string) {
    const [o] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT o.id, o.codigo, o.tenant_id, o.cliente_id, o.created_at, o.fecha_compromiso::text AS fecha_compromiso,
              c.razon_social AS cliente, COALESCE(NULLIF(c.contacto_email, ''), c.email) AS correo,
              u.codigo AS unidad_codigo, u.nombre AS unidad_nombre
         FROM orden_trabajo o
         LEFT JOIN cliente c ON c.id = o.cliente_id
         LEFT JOIN unidad u ON u.id = o.unidad_principal
        WHERE o.id = $1::uuid`,
      otId,
    );
    return o ?? null;
  }

  async otCreada(otId: string) {
    const o = await this.ot(otId);
    if (!o) return null;
    return this.mensajeria.enviarAutomatico(
      o.tenant_id,
      "ot_creada",
      { correo: o.correo, otId: o.id, clienteId: o.cliente_id },
      {
        cliente: o.cliente ?? "cliente",
        codigo: o.codigo,
        laboratorio: o.unidad_nombre ? `${o.unidad_codigo} · ${o.unidad_nombre}` : "laboratorio",
        fecha: fechaChile(o.created_at ?? new Date()),
        fecha_compromiso: o.fecha_compromiso ? o.fecha_compromiso.slice(0, 10).split("-").reverse().join("-") : "por confirmar",
      },
    );
  }

  async muestrasRecibidas(otId: string, muestraIds: string[]) {
    const o = await this.ot(otId);
    if (!o) return null;
    const muestras = await this.prisma.$queryRawUnsafe<{ codigo: string }[]>(
      `SELECT codigo FROM muestra
        WHERE ot_id = $1::uuid AND deleted_at IS NULL AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))
        ORDER BY codigo`,
      otId,
      muestraIds.length ? muestraIds : null,
    );
    if (!muestras.length) return null;
    const lista = muestras.map((m) => m.codigo);
    return this.mensajeria.enviarAutomatico(
      o.tenant_id,
      "muestras_recibidas",
      { correo: o.correo, otId: o.id, clienteId: o.cliente_id },
      {
        cliente: o.cliente ?? "cliente",
        codigo: o.codigo,
        cantidad: String(lista.length),
        muestras: lista.length > 12 ? `${lista.slice(0, 12).join(", ")} y ${lista.length - 12} más` : lista.join(", "),
        fecha: fechaChile(new Date()),
      },
    );
  }

  async documentoOficial(certificadoId: string, tenantId: string) {
    const [c] = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT COALESCE(c.numero, c.codigo) AS numero, c.ot_id FROM certificado c WHERE c.id = $1::uuid AND c.tenant_id = $2::uuid`,
      certificadoId,
      tenantId,
    );
    if (!c?.ot_id) return null;
    const o = await this.ot(c.ot_id);
    if (!o) return null;
    return this.mensajeria.enviarAutomatico(
      tenantId,
      "documento_oficial",
      { correo: o.correo, otId: o.id, clienteId: o.cliente_id },
      { cliente: o.cliente ?? "cliente", codigo: o.codigo, documento: String(c.numero ?? ""), fecha: fechaChile(new Date()) },
    );
  }
}
