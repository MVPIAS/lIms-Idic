/**
 * Bloqueo de clientes por mora · COM-05 (reglas en mora.ts).
 *
 *   · Proceso diario (y 1 minuto después de arrancar la API) que recorre los
 *     clientes con facturas vencidas: avisa a los 30 días, bloquea a los 60 y
 *     alerta «derivar al CDE» a los 90 (tramos en parámetros mora_cliente).
 *     Desactivable con MORA_AUTOMATICA=false.
 *   · Además se calcula AL CONSULTAR: crear una cotización, aceptarla (genera la
 *     OT) o abrir una OT directa llaman a exigirClienteHabilitado, que aplica el
 *     bloqueo en ese momento aunque el proceso diario aún no haya corrido.
 */
import { ConflictException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { AvisosService } from "../avisos/avisos.service";
import { hoyChile } from "../common/fecha-chile";
import { configMora, estadoMoraCliente, mensajeClienteBloqueado, motivoBloqueoMora, type EstadoMora, type FacturaMora } from "./mora";

const UN_DIA = 24 * 60 * 60 * 1000;

/** Facturas con saldo de uno o varios clientes (pagos y notas de crédito descontados). */
async function facturasConSaldo(db: any, tenantId: string, clienteId?: string): Promise<(FacturaMora & { clienteId: string })[]> {
  const filas: any[] = await db.$queryRawUnsafe(
    `SELECT f.id, f.numero, f.estado, f.cliente_id AS "clienteId",
            to_char(f.fecha_emision, 'YYYY-MM-DD') AS "fechaEmision", to_char(f.fecha_vencimiento, 'YYYY-MM-DD') AS "fechaVencimiento",
            c.dias_credito AS "diasCredito",
            (f.total - COALESCE((SELECT sum(p.monto) FROM pago p WHERE p.factura_id = f.id), 0)
                     - COALESCE((SELECT sum(n.monto) FROM nota_credito n WHERE n.factura_id = f.id), 0))::float8 AS saldo
       FROM factura f JOIN cliente c ON c.id = f.cliente_id
      WHERE f.tenant_id = $1::uuid AND f.deleted_at IS NULL AND f.estado IN ('emitida', 'parcial')
        AND ($2::uuid IS NULL OR f.cliente_id = $2::uuid)`,
    tenantId,
    clienteId ?? null,
  );
  return filas.map((f) => ({ ...f, saldo: Number(f.saldo), diasCredito: f.diasCredito == null ? null : Number(f.diasCredito) }));
}

async function leerConfig(db: any, tenantId: string) {
  const filas = await db
    .$queryRawUnsafe(`SELECT codigo, valor, activo FROM parametro_sistema WHERE tenant_id = $1::uuid AND categoria = 'mora_cliente'`, tenantId)
    .catch(() => []);
  return configMora(filas);
}

/** Facturas cubiertas por desbloqueos (excepciones) del Jefe DCO. */
async function exceptuadas(db: any, clienteId: string): Promise<string[]> {
  const f: { id: string }[] = await db
    .$queryRawUnsafe(
      `SELECT DISTINCT unnest(facturas)::text AS id FROM cliente_desbloqueo WHERE cliente_id = $1::uuid AND facturas IS NOT NULL`,
      clienteId,
    )
    .catch(() => []);
  return f.map((x) => x.id);
}

/** Estado de mora de un cliente, calculado ahora. */
export async function estadoMora(db: any, tenantId: string, clienteId: string, hoy = hoyChile()): Promise<EstadoMora> {
  const [cfg, facturas, exc] = await Promise.all([leerConfig(db, tenantId), facturasConSaldo(db, tenantId, clienteId), exceptuadas(db, clienteId)]);
  return estadoMoraCliente(facturas, hoy, cfg, exc);
}

/**
 * Aplica el bloqueo por mora a la ficha: bloquea si corresponde y levanta el
 * bloqueo AUTOMÁTICO cuando ya no hay mora. Un bloqueo manual no se toca.
 * Devuelve la ficha resultante.
 */
export async function aplicarMora(db: any, tenantId: string, clienteId: string, e?: EstadoMora) {
  const est = e ?? (await estadoMora(db, tenantId, clienteId));
  const [c]: { bloqueado: boolean; bloqueo_origen: string | null; motivo_bloqueo: string | null; razon_social: string }[] = await db.$queryRawUnsafe(
    `SELECT bloqueado, bloqueo_origen, motivo_bloqueo, razon_social FROM cliente WHERE id = $1::uuid`,
    clienteId,
  );
  if (!c) return null;
  if (est.bloquear && !c.bloqueado) {
    const motivo = motivoBloqueoMora(est);
    await db.$executeRawUnsafe(
      `UPDATE cliente SET bloqueado = TRUE, bloqueo_origen = 'mora', motivo_bloqueo = $2, bloqueado_at = now(), updated_at = now() WHERE id = $1::uuid`,
      clienteId,
      motivo,
    );
    // Historial de bloqueos del cliente (el mismo del bloqueo manual del Jefe DCO).
    const vencido = est.facturas.filter((f) => !f.exceptuada).reduce((a, f) => a + f.saldo, 0);
    await db.$executeRawUnsafe(
      `INSERT INTO cliente_bloqueo (tenant_id, cliente_id, motivo, monto_pendiente, contador_no_pago, bloqueado_por, activo)
       VALUES ($1::uuid, $2::uuid, $3, $4::numeric, $5::int, NULL, TRUE)`,
      tenantId,
      clienteId,
      motivo,
      Math.round(vencido * 100) / 100,
      est.facturas.length,
    ).catch(() => undefined);
    return { ...c, bloqueado: true, bloqueo_origen: "mora", motivo_bloqueo: motivo, recienBloqueado: true };
  }
  if (!est.bloquear && c.bloqueado && c.bloqueo_origen === "mora") {
    await db.$executeRawUnsafe(
      `UPDATE cliente SET bloqueado = FALSE, bloqueo_origen = NULL, motivo_bloqueo = NULL, bloqueado_at = NULL, updated_at = now() WHERE id = $1::uuid`,
      clienteId,
    );
    await db.$executeRawUnsafe(`UPDATE cliente_bloqueo SET activo = FALSE, desbloqueado_at = now() WHERE cliente_id = $1::uuid AND activo`, clienteId).catch(() => undefined);
    return { ...c, bloqueado: false, bloqueo_origen: null, motivo_bloqueo: null };
  }
  return c;
}

/**
 * COM-05: impide cotizar o abrir una OT para un cliente bloqueado (por mora,
 * calculada al momento, o a mano). 409 con el motivo.
 */
export async function exigirClienteHabilitado(db: any, tenantId: string | null | undefined, clienteId: string | null | undefined) {
  if (!clienteId) return;
  const [cli]: { tenant_id: string }[] = await db.$queryRawUnsafe(`SELECT tenant_id FROM cliente WHERE id = $1::uuid`, clienteId);
  if (!cli) return;
  const c = await aplicarMora(db, tenantId ?? cli.tenant_id, clienteId);
  if (c?.bloqueado) throw new ConflictException(mensajeClienteBloqueado(c.razon_social, c.motivo_bloqueo));
}

@Injectable()
export class MoraClienteService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(MoraClienteService.name);
  private reloj: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly avisos: AvisosService,
  ) {}

  onModuleInit() {
    if (process.env.MORA_AUTOMATICA !== "false" && process.env.NODE_ENV !== "test") {
      this.reloj = setInterval(() => this.revisarTodos().catch(() => undefined), UN_DIA);
      this.reloj.unref?.();
      setTimeout(() => this.revisarTodos().catch(() => undefined), 60_000).unref?.();
    }
  }

  onModuleDestroy() {
    if (this.reloj) clearInterval(this.reloj);
  }

  async revisarTodos() {
    const tenants = await this.prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM tenant`).catch(() => []);
    for (const t of tenants) await this.revisar(t.id).catch((e) => this.log.warn(`revisión de mora omitida: ${e?.message ?? e}`));
  }

  /** Revisión de un tenant: bloqueos, desbloqueos automáticos y avisos por tramo. */
  async revisar(tenantId: string) {
    const hoy = hoyChile();
    const cfg = await leerConfig(this.prisma, tenantId);
    const todas = await facturasConSaldo(this.prisma, tenantId);
    const porCliente = new Map<string, FacturaMora[]>();
    for (const f of todas) porCliente.set(f.clienteId, [...(porCliente.get(f.clienteId) ?? []), f]);
    // También los bloqueados por mora sin facturas pendientes (para levantar el bloqueo).
    const bloqueados = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM cliente WHERE tenant_id = $1::uuid AND bloqueado AND bloqueo_origen = 'mora'`,
      tenantId,
    );
    for (const b of bloqueados) if (!porCliente.has(b.id)) porCliente.set(b.id, []);
    const [dco] = await this.prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM unidad WHERE tenant_id = $1::uuid AND codigo = 'DCO' LIMIT 1`, tenantId);
    let bloqueos = 0;
    let avisos = 0;
    for (const [clienteId, facturas] of porCliente) {
      const e = estadoMoraCliente(facturas, hoy, cfg, await exceptuadas(this.prisma, clienteId));
      const c: any = await aplicarMora(this.prisma, tenantId, clienteId, e);
      if (c?.recienBloqueado) bloqueos++;
      for (const f of e.facturas) {
        const destinatarios =
          f.tramo === "aviso"
            ? { roles: [{ rol: "COMERCIAL" }, { rol: "FINANZAS" }] }
            : { roles: [{ rol: "COMERCIAL" }, { rol: "FINANZAS" }], jefesDe: [dco?.id] };
        const texto =
          f.tramo === "cde"
            ? `lleva ${f.dias} días vencida: corresponde derivar la deuda al Consejo de Defensa del Estado (CDE).`
            : f.tramo === "bloqueo"
              ? `lleva ${f.dias} días vencida: el cliente queda bloqueado para nuevas cotizaciones y OT${f.exceptuada ? " (con excepción autorizada por el Jefe DCO)" : ""}.`
              : `lleva ${f.dias} días vencida.`;
        const r = await this.avisos
          .emitir(
            tenantId,
            {
              tipo: f.tramo === "aviso" ? "mora_aviso" : f.tramo === "bloqueo" ? "mora_bloqueo" : "mora_cde",
              titulo: `${f.tramo === "cde" ? "Derivar al CDE" : f.tramo === "bloqueo" ? "Cliente bloqueado por mora" : "Factura vencida"} · ${c?.razon_social ?? ""}`.slice(0, 200),
              mensaje: `La factura ${f.numero} de ${c?.razon_social ?? "el cliente"} ${texto}`,
              ruta: `/facturas?estado=por_cobrar`,
              // Una vez por factura y tramo.
              clave: `mora_${f.tramo}:${f.id}`,
            },
            destinatarios,
          )
          .catch(() => ({ nuevos: 0 }));
        avisos += r.nuevos;
      }
    }
    return { clientes: porCliente.size, bloqueos, avisos };
  }
}
