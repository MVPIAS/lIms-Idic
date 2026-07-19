import { Module } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { LoggerModule } from "nestjs-pino";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";

import { JwtAuthGuard } from "./auth/jwt-auth.guard";
import { PermisoGuard } from "./auth/permiso.guard";
import { AuditInterceptor } from "./common/audit.interceptor";
import { AuditoriaModule } from "./auditoria/auditoria.module";
import { AuthModule } from "./auth/auth.module";
import { ClienteModule } from "./cliente/cliente.module";
import { CotizacionModule } from "./cotizacion/cotizacion.module";
import { OtModule } from "./ot/ot.module";
import { FlujoModule } from "./flujo/flujo.module";
import { HealthModule } from "./health/health.module";
import { PrismaModule } from "./common/prisma.module";
import { ComercialModule } from "./comercial/comercial.module";
import { FacturacionModule } from "./facturacion/facturacion.module";
import { AdquisicionesModule } from "./adquisiciones/adquisiciones.module";
import { LaboratorioModule } from "./laboratorio/laboratorio.module";
import { CatalogoModule } from "./catalogo/catalogo.module";
import { CatalogoV2Module } from "./catalogo/catalogo-v2.module";
import { FlujoRealModule } from "./flujo-real/flujo-real.module";
import { RbacModule } from "./rbac/rbac.module";
import { PlantillaRenderModule } from "./plantilla-render/plantilla-render.module";
import { CrmModule } from "./crm/crm.module";
import { SaecModule } from "./saec/saec.module";
import { EquiposModule } from "./equipos/equipos.module";

/**
 * En desarrollo embellecemos los logs con `pino-pretty`, pero es una
 * devDependency OPCIONAL: si no está instalada (install --prod con NODE_ENV sin
 * fijar, un worktree recién creado, CI, etc.) pino exige el transport y Nest
 * aborta en el InstanceLoader con
 *   "unable to determine transport target for pino-pretty".
 * Por eso comprobamos que el módulo se pueda resolver y, si falta, degradamos a
 * logs JSON en vez de tumbar el arranque. `require.resolve` está disponible
 * porque este paquete compila a CommonJS (tsconfig `module: "commonjs"`).
 */
function prettyTransport() {
  if (process.env.NODE_ENV === "production") return undefined;
  try {
    require.resolve("pino-pretty");
    return { target: "pino-pretty", options: { singleLine: true } };
  } catch {
    return undefined;
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? "info",
        transport: prettyTransport(),
      },
    }),
    // Rate limiting global. El límite "default" aplica a toda la API; el
    // limitador "login" (más estricto) se referencia con @Throttle en el login.
    ThrottlerModule.forRoot([
      { name: "default", ttl: 60_000, limit: 100 },
      { name: "login", ttl: 60_000, limit: 5 },
    ]),
    PrismaModule,
    AuthModule,
    ClienteModule,
    CotizacionModule,
    OtModule,
    FlujoModule,
    ComercialModule,
    FacturacionModule,
    AdquisicionesModule,
    LaboratorioModule,
    CatalogoModule,
    CatalogoV2Module,
    FlujoRealModule,
    RbacModule,
    PlantillaRenderModule,
    CrmModule,
    SaecModule,
    EquiposModule,
    AuditoriaModule,
    HealthModule,
  ],
  providers: [
    // --- Guards globales · EL ORDEN IMPORTA -------------------------------
    // Nest ejecuta los guards globales en el orden en que se declaran aquí, y
    // siempre ANTES de los guards de controlador/ruta.
    //   1. ThrottlerGuard · rate limiting.
    //   2. JwtAuthGuard   · autentica y puebla req.user (salvo rutas @Public()).
    //   3. PermisoGuard   · RBAC; NECESITA req.user, por eso va después del JWT.
    // Invertir 2 y 3 haría que PermisoGuard viese req.user vacío y respondiese
    // 403 a todo el mundo, incluido el SUPERADMIN.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermisoGuard },

    // Bitácora (RF-H04): escribe en audit_log toda mutación exitosa.
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
