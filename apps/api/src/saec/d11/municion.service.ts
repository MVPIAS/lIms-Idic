import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../common/prisma.service";
import { AlcanceService } from "../../rbac/alcance.service";
import { anioChile } from "../../common/fecha-chile";
import { escapeHtml, fmtFechaHora } from "../../plantilla-render/html.util";
import {
  CierreBody,
  EntregaBody,
  LoteBody,
  MovimientoLoteBody,
  NOMBRE_ESTADO_SOLICITUD,
  NOMBRE_MOVIMIENTO,
  SolicitudBody,
  UsoFuegoBody,
  erroresCierre,
  erroresSalida,
  mismoCalibre,
  type TipoMovimiento,
} from "./municion";

const tenantDe = (req: any): string => {
  const t = req?.user?.tenantId;
  if (!t) throw new ForbiddenException("Sesión sin institución.");
  return t;
};
const usuarioDe = (req: any): string | null => req?.user?.sub ?? null;

type Tx = Pick<PrismaService, "$queryRawUnsafe" | "$executeRawUnsafe">;

const SALDO = `COALESCE((SELECT SUM(CASE WHEN m.tipo IN ('entrada','devolucion') THEN m.cantidad ELSE -m.cantidad END)
                          FROM d11_municion_movimiento m WHERE m.lote_id = l.id), 0)::int`;

const SELECT_SOLICITUD = `SELECT s.id, s.codigo, s.estado, s.unidad_id AS "unidadId", un.codigo AS "unidadCodigo", un.nombre AS "unidadNombre",
       s.ot_id AS "otId", o.codigo AS "otCodigo", s.item_hcp AS "itemHcp", s.norma, s.nivel, s.calibre,
       s.masa_bala_g::float8 AS "masaBalaG", s.velocidad_ms::float8 AS "velocidadMs", s.velocidad_tol_ms::float8 AS "velocidadTolMs",
       s.cantidad_pedida AS "cantidadPedida", s.lote_id AS "loteId", l.lote AS "lote", s.entregados, s.usados, s.devueltos,
       s.observaciones, s.created_at AS "createdAt", us.nombre_completo AS "solicitadoPor",
       s.entregado_at AS "entregadoAt", ue.nombre_completo AS "entregadoPor", s.cerrado_at AS "cerradoAt", uc.nombre_completo AS "cerradoPor"
  FROM d11_municion_solicitud s
  JOIN unidad un ON un.id = s.unidad_id
  LEFT JOIN orden_trabajo o ON o.id = s.ot_id
  LEFT JOIN d11_municion_lote l ON l.id = s.lote_id
  LEFT JOIN usuario us ON us.id = s.solicitado_por
  LEFT JOIN usuario ue ON ue.id = s.entregado_por
  LEFT JOIN usuario uc ON uc.id = s.cerrado_por`;

/**
 * Munición de prueba (EP-11 11.40 / 11.17): inventario por lote de la D11 y
 * orden interna de los laboratorios (LRB, LAM). La D11 gestiona el inventario,
 * entrega y cierra el acta; el laboratorio pide y ve solo sus órdenes.
 */
@Injectable()
export class MunicionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alcance: AlcanceService,
  ) {}

  /* ------------------------------------------------------ inventario --- */

  async lotes(req: any) {
    return this.prisma.$queryRawUnsafe<any[]>(
      `SELECT l.id, l.lote, l.calibre, l.descripcion, l.norma, l.nivel, l.masa_bala_g::float8 AS "masaBalaG",
              l.velocidad_ms::float8 AS "velocidadMs", l.activo, ${SALDO} AS saldo, l.created_at AS "createdAt"
         FROM d11_municion_lote l WHERE l.tenant_id = $1::uuid ORDER BY l.activo DESC, l.calibre, l.lote`,
      tenantDe(req),
    );
  }

  private async lote(tx: Tx, tenantId: string, loteId: string, bloquear = false) {
    const [l] = await tx.$queryRawUnsafe<any[]>(
      `SELECT l.id, l.lote, l.calibre, l.activo FROM d11_municion_lote l WHERE l.id = $1::uuid AND l.tenant_id = $2::uuid ${bloquear ? "FOR UPDATE" : ""}`,
      loteId,
      tenantId,
    );
    if (!l) throw new NotFoundException("Lote de munición no encontrado.");
    const [s] = await tx.$queryRawUnsafe<any[]>(`SELECT ${SALDO} AS saldo FROM d11_municion_lote l WHERE l.id = $1::uuid`, loteId);
    return { ...l, saldo: Number(s?.saldo ?? 0) } as { id: string; lote: string; calibre: string; activo: boolean; saldo: number };
  }

  private async mover(
    tx: Tx,
    p: { tenantId: string; loteId: string; tipo: TipoMovimiento; cantidad: number; solicitudId?: string | null; otId?: string | null; armaOtId?: string | null; observaciones?: string | null; usuarioId: string | null },
  ) {
    await tx.$executeRawUnsafe(
      `INSERT INTO d11_municion_movimiento (tenant_id, lote_id, tipo, cantidad, solicitud_id, ot_id, arma_ot_id, observaciones, registrado_por)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid, $6::uuid, $7::uuid, $8, $9::uuid)`,
      p.tenantId,
      p.loteId,
      p.tipo,
      p.cantidad,
      p.solicitudId ?? null,
      p.otId ?? null,
      p.armaOtId ?? null,
      p.observaciones?.trim() || null,
      p.usuarioId,
    );
  }

  async crearLote(req: any, body: unknown) {
    const tenantId = tenantDe(req);
    const d = LoteBody.parse(body ?? {});
    return this.prisma.$transaction(async (tx) => {
      const rep = await tx.$queryRawUnsafe<any[]>(
        `SELECT 1 FROM d11_municion_lote WHERE tenant_id = $1::uuid AND upper(lote) = upper($2) AND upper(calibre) = upper($3)`,
        tenantId,
        d.lote,
        d.calibre,
      );
      if (rep.length) throw new ConflictException(`El lote ${d.lote} de calibre ${d.calibre} ya existe: registre una entrada en ese lote.`);
      const [l] = await tx.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO d11_municion_lote (tenant_id, lote, calibre, descripcion, norma, nivel, masa_bala_g, velocidad_ms, created_by)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::uuid) RETURNING id`,
        tenantId,
        d.lote,
        d.calibre,
        d.descripcion || null,
        d.norma || null,
        d.nivel || null,
        d.masaBalaG ?? null,
        d.velocidadMs ?? null,
        usuarioDe(req),
      );
      await this.mover(tx, { tenantId, loteId: l.id, tipo: "entrada", cantidad: d.cantidad, observaciones: "Carga inicial del lote", usuarioId: usuarioDe(req) });
      return l;
    });
  }

  async moverLote(req: any, loteId: string, body: unknown) {
    const tenantId = tenantDe(req);
    const d = MovimientoLoteBody.parse(body ?? {});
    return this.prisma.$transaction(async (tx) => {
      const l = await this.lote(tx, tenantId, loteId, true);
      if (d.tipo === "ajuste_baja") {
        const e = erroresSalida(l, d.cantidad);
        if (e.length) throw new BadRequestException(e.join(" "));
        if (!d.observaciones?.trim()) throw new BadRequestException("Indique el motivo de la baja.");
      } else if (!l.activo) throw new BadRequestException(`El lote ${l.lote} está dado de baja.`);
      await this.mover(tx, { tenantId, loteId, tipo: d.tipo, cantidad: d.cantidad, observaciones: d.observaciones, usuarioId: usuarioDe(req) });
      return this.lote(tx, tenantId, loteId);
    });
  }

  async movimientos(req: any, loteId: string) {
    const tenantId = tenantDe(req);
    await this.lote(this.prisma, tenantId, loteId);
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT m.id, m.tipo, m.cantidad, m.observaciones, m.created_at AS "createdAt", u.nombre_completo AS usuario,
              s.codigo AS solicitud, o.codigo AS ot, mu.codigo AS arma
         FROM d11_municion_movimiento m
         LEFT JOIN usuario u ON u.id = m.registrado_por
         LEFT JOIN d11_municion_solicitud s ON s.id = m.solicitud_id
         LEFT JOIN orden_trabajo o ON o.id = m.ot_id
         LEFT JOIN d11_arma_ot a ON a.id = m.arma_ot_id
         LEFT JOIN muestra mu ON mu.id = a.muestra_id
        WHERE m.lote_id = $1::uuid AND m.tenant_id = $2::uuid ORDER BY m.created_at DESC`,
      loteId,
      tenantId,
    );
    return filas.map((f) => ({ ...f, tipoNombre: NOMBRE_MOVIMIENTO[f.tipo as TipoMovimiento] ?? f.tipo }));
  }

  /** 11.17 · cartuchos gastados en la prueba de fuego de un arma (lo llama D11Service al guardar ensayos). */
  async usarEnPrueba(tx: Tx, req: any, p: { otId: string; armaOtId: string; muestra: string }, body: unknown) {
    const tenantId = tenantDe(req);
    const d = UsoFuegoBody.parse(body);
    const l = await this.lote(tx, tenantId, d.loteId, true);
    const e = erroresSalida(l, d.cartuchos);
    if (e.length) throw new BadRequestException(e.join(" "));
    await this.mover(tx, {
      tenantId,
      loteId: l.id,
      tipo: "uso",
      cantidad: d.cartuchos,
      otId: p.otId,
      armaOtId: p.armaOtId,
      observaciones: `Prueba de fuego del arma ${p.muestra}`,
      usuarioId: usuarioDe(req),
    });
    return { lote: l.lote, cartuchos: d.cartuchos };
  }

  /* -------------------------------------------- órdenes internas LRB/LAM --- */

  private async solicitud(tenantId: string, id: string) {
    const [s] = await this.prisma.$queryRawUnsafe<any[]>(`${SELECT_SOLICITUD} WHERE s.id = $1::uuid AND s.tenant_id = $2::uuid`, id, tenantId);
    if (!s) throw new NotFoundException("Orden de munición no encontrada.");
    return { ...s, estadoNombre: NOMBRE_ESTADO_SOLICITUD[s.estado as keyof typeof NOMBRE_ESTADO_SOLICITUD] ?? s.estado };
  }

  /** Lo que ve el laboratorio: sus órdenes (o todas si su alcance es global). */
  async misSolicitudes(req: any) {
    const tenantId = tenantDe(req);
    const unidades = await this.alcance.filtroUnidades(req, "municion.solicitar");
    const filas = await this.prisma.$queryRawUnsafe<any[]>(
      `${SELECT_SOLICITUD} WHERE s.tenant_id = $1::uuid AND ($2::uuid[] IS NULL OR s.unidad_id = ANY($2::uuid[]))
        ORDER BY s.created_at DESC LIMIT 200`,
      tenantId,
      unidades,
    );
    return filas.map((s) => ({ ...s, estadoNombre: NOMBRE_ESTADO_SOLICITUD[s.estado as keyof typeof NOMBRE_ESTADO_SOLICITUD] ?? s.estado }));
  }

  /** Lo que ve la D11: todas las órdenes del tenant. */
  async todasLasSolicitudes(req: any) {
    const filas = await this.prisma.$queryRawUnsafe<any[]>(`${SELECT_SOLICITUD} WHERE s.tenant_id = $1::uuid ORDER BY s.created_at DESC LIMIT 500`, tenantDe(req));
    return filas.map((s) => ({ ...s, estadoNombre: NOMBRE_ESTADO_SOLICITUD[s.estado as keyof typeof NOMBRE_ESTADO_SOLICITUD] ?? s.estado }));
  }

  /** Unidades desde las que el usuario puede pedir munición (las suyas). */
  async unidadesSolicitantes(req: any) {
    const unidades = await this.alcance.filtroUnidades(req, "municion.solicitar");
    return this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, codigo, nombre FROM unidad
        WHERE tenant_id = $1::uuid AND activa AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))
          AND ($2::uuid[] IS NOT NULL OR codigo IN ('LRB', 'LAM'))
        ORDER BY codigo`,
      tenantDe(req),
      unidades,
    );
  }

  async solicitar(req: any, body: unknown) {
    const tenantId = tenantDe(req);
    const d = SolicitudBody.parse(body ?? {});
    await this.alcance.exigirUnidad(req, d.unidadId, "el laboratorio solicitante", "municion.solicitar");
    if (d.otId) {
      const [o] = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT unidad_principal FROM orden_trabajo WHERE id = $1::uuid AND tenant_id = $2::uuid`,
        d.otId,
        tenantId,
      );
      if (!o) throw new BadRequestException("La OT indicada no existe.");
      if (o.unidad_principal !== d.unidadId) throw new BadRequestException("La OT indicada no es del laboratorio solicitante.");
    }
    return this.prisma.$transaction(async (tx) => {
      const anio = anioChile();
      const [c] = await tx.$queryRawUnsafe<{ ultimo: number }[]>(
        `INSERT INTO bpch_correlativo (tenant_id, tipo, anio, ultimo) VALUES ($1::uuid, 'MP', $2, 1)
         ON CONFLICT (tenant_id, tipo, anio) DO UPDATE SET ultimo = bpch_correlativo.ultimo + 1, updated_at = now()
         RETURNING ultimo`,
        tenantId,
        anio,
      );
      const codigo = `MP-${anio}-${String(Number(c.ultimo)).padStart(4, "0")}`;
      const [s] = await tx.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO d11_municion_solicitud (tenant_id, codigo, unidad_id, ot_id, item_hcp, norma, nivel, calibre, masa_bala_g,
                                             velocidad_ms, velocidad_tol_ms, cantidad_pedida, observaciones, solicitado_por)
         VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::uuid) RETURNING id`,
        tenantId,
        codigo,
        d.unidadId,
        d.otId ?? null,
        d.itemHcp || null,
        d.norma,
        d.nivel || null,
        d.calibre,
        d.masaBalaG ?? null,
        d.velocidadMs ?? null,
        d.velocidadTolMs ?? null,
        d.cantidadPedida,
        d.observaciones || null,
        usuarioDe(req),
      );
      return { id: s.id, codigo };
    });
  }

  async anular(req: any, id: string) {
    const tenantId = tenantDe(req);
    const s = await this.solicitud(tenantId, id);
    await this.alcance.exigirUnidad(req, s.unidadId, "la orden de munición", "municion.solicitar");
    if (s.estado !== "solicitada") throw new ConflictException("Solo se anula una orden que la D11 aún no entregó.");
    await this.prisma.$executeRawUnsafe(`UPDATE d11_municion_solicitud SET estado = 'anulada' WHERE id = $1::uuid AND tenant_id = $2::uuid`, id, tenantId);
    return this.solicitud(tenantId, id);
  }

  async entregar(req: any, id: string, body: unknown) {
    const tenantId = tenantDe(req);
    const d = EntregaBody.parse(body ?? {});
    return this.prisma.$transaction(async (tx) => {
      const [s] = await tx.$queryRawUnsafe<any[]>(
        `SELECT id, estado, calibre, codigo FROM d11_municion_solicitud WHERE id = $1::uuid AND tenant_id = $2::uuid FOR UPDATE`,
        id,
        tenantId,
      );
      if (!s) throw new NotFoundException("Orden de munición no encontrada.");
      if (s.estado !== "solicitada") throw new ConflictException("La orden ya se entregó, se cerró o se anuló.");
      const l = await this.lote(tx, tenantId, d.loteId, true);
      if (!mismoCalibre(l.calibre, s.calibre)) throw new BadRequestException(`El lote ${l.lote} es de calibre ${l.calibre} y la orden pide ${s.calibre}.`);
      const e = erroresSalida(l, d.cantidad);
      if (e.length) throw new BadRequestException(e.join(" "));
      await this.mover(tx, { tenantId, loteId: l.id, tipo: "entrega", cantidad: d.cantidad, solicitudId: id, observaciones: d.observaciones ?? `Entrega ${s.codigo}`, usuarioId: usuarioDe(req) });
      await tx.$executeRawUnsafe(
        `UPDATE d11_municion_solicitud SET estado = 'entregada', lote_id = $3::uuid, entregados = $4, entregado_por = $5::uuid, entregado_at = now()
          WHERE id = $1::uuid AND tenant_id = $2::uuid`,
        id,
        tenantId,
        l.id,
        d.cantidad,
        usuarioDe(req),
      );
      return { ok: true };
    }).then(() => this.solicitud(tenantId, id));
  }

  async cerrar(req: any, id: string, body: unknown) {
    const tenantId = tenantDe(req);
    const d = CierreBody.parse(body ?? {});
    await this.prisma.$transaction(async (tx) => {
      const [s] = await tx.$queryRawUnsafe<any[]>(
        `SELECT id, estado, entregados, lote_id, codigo FROM d11_municion_solicitud WHERE id = $1::uuid AND tenant_id = $2::uuid FOR UPDATE`,
        id,
        tenantId,
      );
      if (!s) throw new NotFoundException("Orden de munición no encontrada.");
      if (s.estado !== "entregada") throw new ConflictException("Solo se cierra una orden entregada.");
      const e = erroresCierre(Number(s.entregados), d.usados, d.devueltos);
      if (e.length) throw new BadRequestException(e.join(" "));
      if (d.devueltos > 0)
        await this.mover(tx, { tenantId, loteId: s.lote_id, tipo: "devolucion", cantidad: d.devueltos, solicitudId: id, observaciones: `Devolución ${s.codigo}`, usuarioId: usuarioDe(req) });
      await tx.$executeRawUnsafe(
        `UPDATE d11_municion_solicitud SET estado = 'cerrada', usados = $3, devueltos = $4, cerrado_por = $5::uuid, cerrado_at = now(),
                observaciones = COALESCE($6, observaciones)
          WHERE id = $1::uuid AND tenant_id = $2::uuid`,
        id,
        tenantId,
        d.usados,
        d.devueltos,
        usuarioDe(req),
        d.observaciones?.trim() || null,
      );
    });
    return this.solicitud(tenantId, id);
  }

  /** Acta de entrega y rendición (entregados / usados / devueltos). */
  async acta(req: any, id: string, comoD11: boolean) {
    const tenantId = tenantDe(req);
    const s = await this.solicitud(tenantId, id);
    if (!comoD11) await this.alcance.exigirUnidad(req, s.unidadId, "la orden de munición", "municion.solicitar");
    if (s.estado === "solicitada" || s.estado === "anulada") throw new ConflictException("El acta existe cuando la D11 entregó la munición.");
    const f = (k: string, v: unknown) => `<tr><th>${k}</th><td>${escapeHtml(v == null || v === "" ? "—" : String(v))}</td></tr>`;
    const coma = (n: number | null) => (n == null ? "—" : String(n).replace(".", ","));
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Acta ${escapeHtml(s.codigo)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;margin:18mm;color:#111;font-size:12px}
  h1{font-size:16px;margin:0 0 4px} .sub{color:#444;margin-bottom:12px}
  table{border-collapse:collapse;width:100%;margin-top:10px} th,td{border:1px solid #999;padding:5px 7px;text-align:left}
  th{background:#eef2f6;width:34%} .firmas{display:grid;grid-template-columns:1fr 1fr;gap:30mm;margin-top:28mm;text-align:center}
  .firmas div{border-top:1px solid #333;padding-top:4px} .barra{margin-bottom:10px;color:#444} @media print{.barra{display:none}}
</style></head><body>
<div class="barra">Imprima con Ctrl + P: una copia para el laboratorio y otra para la D11.</div>
<h1>ACTA DE MUNICIÓN DE PRUEBA · ${escapeHtml(s.codigo)}</h1>
<div class="sub">Instituto de Investigaciones y Control · Delegación Nº 11 → ${escapeHtml(s.unidadNombre)}</div>
<table>
${f("Laboratorio solicitante", `${s.unidadCodigo} · ${s.unidadNombre}`)}
${f("OT · ítem HCP", `${s.otCodigo ?? "—"} · ${s.itemHcp ?? "—"}`)}
${f("Norma · nivel", `${s.norma} · ${s.nivel ?? "—"}`)}
${f("Calibre", s.calibre)}
${f("Masa de bala (g) · velocidad (m/s)", `${coma(s.masaBalaG)} · ${coma(s.velocidadMs)}${s.velocidadTolMs != null ? ` ± ${coma(s.velocidadTolMs)}` : ""}`)}
${f("Cartuchos pedidos", s.cantidadPedida)}
${f("Lote de origen", s.lote)}
${f("Entregados", s.entregados)}
${f("Usados", s.usados ?? "pendiente de rendir")}
${f("Devueltos", s.devueltos ?? "pendiente de rendir")}
${f("Entregó · fecha", `${s.entregadoPor ?? "—"} · ${s.entregadoAt ? fmtFechaHora(s.entregadoAt) : "—"}`)}
${f("Cerró · fecha", `${s.cerradoPor ?? "—"} · ${s.cerradoAt ? fmtFechaHora(s.cerradoAt) : "—"}`)}
</table>
<div class="firmas"><div>Entrega · Delegación Nº 11</div><div>Recibe · ${escapeHtml(s.unidadCodigo)}</div></div>
</body></html>`;
  }
}
