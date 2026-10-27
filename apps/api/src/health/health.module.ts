import { Controller, Get, Module } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { PrismaClient } from "@prisma/client";
import { Public } from "../auth/public.decorator";
import { ZONA_CHILE, hoyChile } from "../common/fecha-chile";

@ApiTags("health")
@Controller("health")
class HealthController {
  private prisma = new PrismaClient();

  // Sonda de vida: debe responder sin token (la usan Caddy/Docker).
  @Public()
  @Get()
  async check() {
    let db = "ok";
    let zonaSesion: string | null = null;
    try {
      const [r] = await this.prisma.$queryRaw<{ tz: string }[]>`SELECT current_setting('TimeZone') AS tz`;
      zonaSesion = r?.tz ?? null;
    } catch {
      db = "down";
    }
    return {
      status: db === "ok" ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      services: { database: db },
      // Frente f8: zona del IDIC, «hoy» que usa la API y zona de su sesión de base de datos.
      zonaHoraria: { zona: ZONA_CHILE, hoy: hoyChile(), sesionBd: zonaSesion },
      version: "0.1.0",
    };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
