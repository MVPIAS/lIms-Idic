/**
 * Plantillas de correo editables por etapa (contrato §4.5.4) · tabla
 * `correo_plantilla` (align_comunicacion.sql).
 *
 * Mensajería › Plantillas las lista por etapa; quien tiene
 * `correo_plantilla.editar` cambia asunto y cuerpo, las activa o desactiva y
 * enciende el envío automático en las etapas con disparador. Sin fila en la
 * tabla se usa el texto de respaldo de correo-plantillas.ts.
 */
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { ETAPAS_CORREO, PLANTILLAS_CORREO, etapaCorreo, plantillaPorClave, variablesNoAdmitidas } from "./correo-plantillas";

export interface PlantillaBd {
  id: string | null;
  clave: string;
  etapa: string;
  nombre: string;
  asunto: string;
  cuerpo: string;
  destino: "cliente" | "interno";
  automatico: boolean;
  activa: boolean;
}

export const PlantillaBody = z.object({
  nombre: z.string().trim().min(3).max(120).optional(),
  asunto: z.string().trim().min(3).max(300).optional(),
  cuerpo: z.string().trim().min(10, "El cuerpo es muy corto.").max(20_000).optional(),
  automatico: z.boolean().optional(),
  activa: z.boolean().optional(),
});

export const NuevaPlantillaBody = z.object({
  etapa: z.string().trim().max(40),
  nombre: z.string().trim().min(3).max(120),
  asunto: z.string().trim().min(3).max(300),
  cuerpo: z.string().trim().min(10, "El cuerpo es muy corto.").max(20_000),
});

const COLS = `id, clave, etapa, nombre, asunto, cuerpo, destino, automatico, activa,
  actualizado_en AS "actualizadoEn", (SELECT nombre_completo FROM usuario u WHERE u.id = actualizado_por) AS "actualizadoPor"`;

/** Respaldo en código con la forma de la tabla (cotización y resultado). */
function respaldo(clave: string): PlantillaBd | null {
  const p = plantillaPorClave(clave);
  if (!p) return null;
  const etapa = p.tipo === "cotizacion" ? "cotizacion_enviada" : "resultado";
  return { id: null, clave: p.clave, etapa, nombre: p.nombre, asunto: p.asunto, cuerpo: p.cuerpo, destino: "cliente", automatico: false, activa: true };
}

@Injectable()
export class CorreoPlantillasService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(tenantId: string) {
    const filas = await this.prisma
      .$queryRawUnsafe<any[]>(`SELECT ${COLS} FROM correo_plantilla WHERE tenant_id = $1::uuid ORDER BY etapa, nombre`, tenantId)
      .catch(() => [] as any[]);
    const usadas = new Set(filas.map((f) => f.clave));
    // Respaldo de código que la tabla aún no tiene (instalación a medias).
    const faltan = PLANTILLAS_CORREO.filter((p) => !usadas.has(p.clave)).map((p) => respaldo(p.clave)!);
    return {
      etapas: ETAPAS_CORREO,
      data: [...filas, ...faltan].map((f) => ({ ...f, etapaNombre: etapaCorreo(f.etapa)?.nombre ?? f.etapa })),
    };
  }

  /** La plantilla por clave (activa o no) o el respaldo de código. */
  async porClave(tenantId: string, clave: string): Promise<PlantillaBd | null> {
    const [f] = await this.prisma
      .$queryRawUnsafe<PlantillaBd[]>(`SELECT ${COLS} FROM correo_plantilla WHERE tenant_id = $1::uuid AND clave = $2`, tenantId, clave)
      .catch(() => [] as PlantillaBd[]);
    return f ?? respaldo(clave);
  }

  /**
   * Plantilla con que se envía una etapa: la clave pedida si es de la etapa; si
   * no, la automática activa de la etapa o la primera activa. null si la etapa
   * no tiene ninguna activa.
   */
  async deEtapa(tenantId: string, etapa: string, clave?: string | null): Promise<PlantillaBd | null> {
    if (clave) {
      const p = await this.porClave(tenantId, clave);
      if (p && p.activa && p.etapa === etapa) return p;
      if (p && p.etapa !== etapa) throw new BadRequestException(`La plantilla «${p.nombre}» no es de la etapa «${etapaCorreo(etapa)?.nombre ?? etapa}».`);
      if (p && !p.activa) throw new BadRequestException(`La plantilla «${p.nombre}» está desactivada.`);
    }
    const [f] = await this.prisma
      .$queryRawUnsafe<PlantillaBd[]>(
        `SELECT ${COLS} FROM correo_plantilla WHERE tenant_id = $1::uuid AND etapa = $2 AND activa
          ORDER BY automatico DESC, created_at LIMIT 1`,
        tenantId,
        etapa,
      )
      .catch(() => [] as PlantillaBd[]);
    if (f) return f;
    const r = PLANTILLAS_CORREO.find((p) => (p.tipo === "cotizacion" ? "cotizacion_enviada" : "resultado") === etapa);
    return r ? respaldo(r.clave) : null;
  }

  /** Plantilla automática y activa de la etapa (envío automático), o null. */
  async automatica(tenantId: string, etapa: string): Promise<PlantillaBd | null> {
    const [f] = await this.prisma
      .$queryRawUnsafe<PlantillaBd[]>(
        `SELECT ${COLS} FROM correo_plantilla WHERE tenant_id = $1::uuid AND etapa = $2 AND activa AND automatico ORDER BY created_at LIMIT 1`,
        tenantId,
        etapa,
      )
      .catch(() => [] as PlantillaBd[]);
    return f ?? null;
  }

  private validar(etapa: string, asunto: string, cuerpo: string) {
    if (!etapaCorreo(etapa)) throw new BadRequestException(`Etapa desconocida: ${etapa}.`);
    const malas = variablesNoAdmitidas(`${asunto} ${cuerpo}`, etapa);
    if (malas.length)
      throw new BadRequestException(
        `Marcadores que la etapa «${etapaCorreo(etapa)!.nombre}» no conoce: ${malas.map((m) => `{{${m}}}`).join(", ")}. Disponibles: ${etapaCorreo(etapa)!.variables.map((v) => `{{${v}}}`).join(", ")}.`,
      );
    if (/<script|javascript:|\son\w+\s*=/i.test(cuerpo)) throw new BadRequestException("El cuerpo no puede llevar scripts ni atributos de eventos.");
  }

  async actualizar(req: any, id: string, body: z.infer<typeof PlantillaBody>) {
    const tenantId = req.user.tenantId;
    const [actual] = await this.prisma.$queryRawUnsafe<PlantillaBd[]>(`SELECT ${COLS} FROM correo_plantilla WHERE id = $1::uuid AND tenant_id = $2::uuid`, id, tenantId);
    if (!actual) throw new NotFoundException("Plantilla no encontrada.");
    const asunto = body.asunto ?? actual.asunto;
    const cuerpo = body.cuerpo ?? actual.cuerpo;
    this.validar(actual.etapa, asunto, cuerpo);
    const automatico = body.automatico ?? actual.automatico;
    if (automatico && !etapaCorreo(actual.etapa)?.disparador)
      throw new BadRequestException(`La etapa «${etapaCorreo(actual.etapa)?.nombre}» se envía a mano: no tiene envío automático.`);
    await this.prisma.$transaction(async (tx) => {
      // Una sola automática por etapa: encender esta apaga las demás.
      if (automatico && !actual.automatico)
        await tx.$executeRawUnsafe(`UPDATE correo_plantilla SET automatico = FALSE WHERE tenant_id = $1::uuid AND etapa = $2 AND id <> $3::uuid`, tenantId, actual.etapa, id);
      await tx.$executeRawUnsafe(
        `UPDATE correo_plantilla SET nombre = $3, asunto = $4, cuerpo = $5, automatico = $6, activa = $7,
                actualizado_por = $8::uuid, actualizado_en = now()
          WHERE id = $1::uuid AND tenant_id = $2::uuid`,
        id,
        tenantId,
        body.nombre ?? actual.nombre,
        asunto,
        cuerpo,
        automatico,
        body.activa ?? actual.activa,
        req.user.sub ?? null,
      );
    });
    return this.porId(tenantId, id);
  }

  async crear(req: any, body: z.infer<typeof NuevaPlantillaBody>) {
    const tenantId = req.user.tenantId;
    this.validar(body.etapa, body.asunto, body.cuerpo);
    const base = `${body.etapa}_${body.nombre}`
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 50);
    const [{ n }] = await this.prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM correo_plantilla WHERE tenant_id = $1::uuid AND clave LIKE $2`,
      tenantId,
      `${base}%`,
    );
    const clave = n ? `${base}_${n + 1}` : base;
    const [f] = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO correo_plantilla (tenant_id, clave, etapa, nombre, asunto, cuerpo, destino, automatico, activa, actualizado_por, actualizado_en)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, FALSE, TRUE, $8::uuid, now()) RETURNING id`,
      tenantId,
      clave,
      body.etapa,
      body.nombre,
      body.asunto,
      body.cuerpo,
      etapaCorreo(body.etapa)!.destino,
      req.user.sub ?? null,
    );
    return this.porId(tenantId, f.id);
  }

  private async porId(tenantId: string, id: string) {
    const [f] = await this.prisma.$queryRawUnsafe<any[]>(`SELECT ${COLS} FROM correo_plantilla WHERE id = $1::uuid AND tenant_id = $2::uuid`, id, tenantId);
    return f;
  }
}
