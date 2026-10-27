import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { ZONA_CHILE } from "./fecha-chile";

/**
 * Cliente Prisma compartido (inyectable por DI). Un único pool de conexiones
 * para toda la app. Registrado como @Global en PrismaModule.
 *
 * Frente f8 · zona horaria: cada sesión de la API trabaja en la zona del IDIC
 * (`ZONA_HORARIA`, por defecto America/Santiago) mediante `options=-c TimeZone=…`
 * en la URL de conexión (common/zona-entorno.ts, primer import de main.ts). Así `current_date`, `now()::date`, `x::date` y
 * `date_trunc` sobre `timestamptz` cortan el día en Chile, sea cual sea la zona
 * configurada en el servidor de base de datos.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("PrismaService");

  async onModuleInit() {
    await this.$connect();
    try {
      const [r] = await this.$queryRawUnsafe<{ tz: string }[]>(`SELECT current_setting('TimeZone') AS tz`);
      if (r?.tz !== ZONA_CHILE) this.log.warn(`La sesión de base de datos está en ${r?.tz}, no en ${ZONA_CHILE}: revise DATABASE_URL (options).`);
    } catch {
      /* la comprobación no impide arrancar */
    }
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
