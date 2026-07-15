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
import { RbacModule } from "./rbac/rbac.module";
import { PlantillaRenderModule } from "./plantilla-render/plantilla-render.module";
import { CrmModule } from "./crm/crm.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? "info",
        transport:
          process.env.NODE_ENV !== "production"
            ? { target: "pino-pretty", options: { singleLine: true } }
            : undefined,
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
    RbacModule,
    PlantillaRenderModule,
    CrmModule,
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
