import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { LoggerModule } from "nestjs-pino";
import { ThrottlerModule } from "@nestjs/throttler";

import { AuthModule } from "./auth/auth.module";
import { ClienteModule } from "./cliente/cliente.module";
import { CotizacionModule } from "./cotizacion/cotizacion.module";
import { OtModule } from "./ot/ot.module";
import { FlujoModule } from "./flujo/flujo.module";
import { HealthModule } from "./health/health.module";
import { PrismaModule } from "./common/prisma.module";

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
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    AuthModule,
    ClienteModule,
    CotizacionModule,
    OtModule,
    FlujoModule,
    HealthModule,
  ],
})
export class AppModule {}
