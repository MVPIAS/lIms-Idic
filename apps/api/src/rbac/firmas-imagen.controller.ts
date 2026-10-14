import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { createHash } from "crypto";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { PermisoGuard } from "../auth/permiso.guard";
import { RequierePermiso } from "../auth/permisos.decorator";

/** Tamaño máximo de la imagen de firma (bytes ya decodificados). */
// 70 KB: el base64 (~95 KB) cabe en el límite de 100 KB del cuerpo JSON de la API.
export const MAX_IMAGEN_FIRMA = 70 * 1024;

/**
 * Valida una imagen de firma en forma de data URL (PNG o JPEG) y devuelve el
 * base64 limpio, el tipo y la huella SHA-256 de los bytes. Se comprueban los
 * BYTES MÁGICOS: no basta con lo que diga el prefijo.
 */
export function validarImagenFirma(dataUrl: string): { data: string; mime: string; hash: string } {
  const m = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=\s]+)$/.exec((dataUrl ?? "").trim());
  if (!m) throw new BadRequestException("La firma debe ser una imagen PNG o JPEG.");
  const data = m[2].replace(/\s+/g, "");
  const bytes = Buffer.from(data, "base64");
  if (!bytes.length) throw new BadRequestException("La imagen de firma está vacía.");
  if (bytes.length > MAX_IMAGEN_FIRMA)
    throw new BadRequestException(`La imagen de firma no puede superar ${Math.round(MAX_IMAGEN_FIRMA / 1024)} KB.`);
  const png = bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!(png || jpg)) throw new BadRequestException("El contenido no es una imagen PNG o JPEG válida.");
  const mime = png ? "image/png" : "image/jpeg";
  return { data: bytes.toString("base64"), mime, hash: createHash("sha256").update(bytes).digest("hex") };
}

const ImagenBody = z.object({ imagen: z.string().min(30).max(Math.ceil(MAX_IMAGEN_FIRMA * 1.4) + 100) });

/**
 * Imagen de firma del usuario, la que se estampa en los informes al firmarlos.
 * Se guarda en la BD (firma.imagen_data) para no depender de un almacén
 * externo. Cada usuario gestiona la SUYA; registrar la de otro usuario exige
 * `admin.usuarios`. Al firmar se CONGELA una copia en el paso de firma, así que
 * cambiarla después no altera documentos ya firmados.
 */
@ApiTags("firmas")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"), PermisoGuard)
@Controller("mi-firma")
export class FirmasImagenController {
  constructor(private readonly prisma: PrismaService) {}

  private yo(req: any): string {
    const id = req?.user?.sub ?? req?.user?.id;
    if (!id) throw new BadRequestException("Usuario no identificado");
    return id;
  }

  private async estado(usuarioId: string) {
    const f = await this.prisma.firma.findUnique({ where: { usuarioId } });
    return {
      usuarioId,
      tieneImagen: !!f?.imagenData,
      imagenMime: f?.imagenMime ?? null,
      imagen: f?.imagenData ? `data:${f.imagenMime ?? "image/png"};base64,${f.imagenData}` : null,
      hashSha256: f?.hashSha256 ?? null,
      registradaAt: f?.registradaAt ?? null,
    };
  }

  private async guardar(usuarioId: string, dataUrl: string) {
    const img = validarImagenFirma(dataUrl);
    await this.prisma.firma.upsert({
      where: { usuarioId },
      create: { usuarioId, imagenRef: "bd", imagenData: img.data, imagenMime: img.mime, hashSha256: img.hash },
      update: { imagenData: img.data, imagenMime: img.mime, hashSha256: img.hash, registradaAt: new Date() },
    });
    return this.estado(usuarioId);
  }

  @Get()
  mia(@Req() req: any) {
    return this.estado(this.yo(req));
  }

  @Put()
  registrarMia(@Body() body: unknown, @Req() req: any) {
    return this.guardar(this.yo(req), ImagenBody.parse(body ?? {}).imagen);
  }

  @Delete()
  async borrarMia(@Req() req: any) {
    const usuarioId = this.yo(req);
    await this.prisma.firma.updateMany({ where: { usuarioId }, data: { imagenData: null, imagenMime: null } });
    return this.estado(usuarioId);
  }

  @Get("usuario/:usuarioId")
  @RequierePermiso("firma.registrar")
  async deUsuario(@Param("usuarioId", ParseUUIDPipe) usuarioId: string, @Req() req: any) {
    await this.usuarioDelTenant(usuarioId, req);
    return this.estado(usuarioId);
  }

  @Put("usuario/:usuarioId")
  @RequierePermiso("admin.usuarios")
  async registrarDeUsuario(@Param("usuarioId", ParseUUIDPipe) usuarioId: string, @Body() body: unknown, @Req() req: any) {
    await this.usuarioDelTenant(usuarioId, req);
    return this.guardar(usuarioId, ImagenBody.parse(body ?? {}).imagen);
  }

  private async usuarioDelTenant(usuarioId: string, req: any) {
    const tenantId = req?.user?.tenantId;
    const u = await this.prisma.usuario.findFirst({
      where: { id: usuarioId, deletedAt: null, ...(tenantId ? { tenantId } : {}) },
      select: { id: true },
    });
    if (!u) throw new NotFoundException(`Usuario ${usuarioId} no encontrado`);
  }
}
