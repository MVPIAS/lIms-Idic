import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { Logger } from "nestjs-pino";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { ZodExceptionFilter } from "./common/zod-exception.filter";
import { AllExceptionsFilter } from "./common/all-exceptions.filter";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const isProd = process.env.NODE_ENV === "production";

  // --- Cabeceras de seguridad (helmet) ---
  // Caddy termina el TLS por delante; helmet añade HSTS, X-Content-Type-Options,
  // X-Frame-Options, Referrer-Policy y elimina cabeceras que filtran tecnología.
  app.use(
    helmet({
      // La API es JSON puro (no sirve HTML). CSP restrictiva; el front Next.js lo
      // sirve Caddy en el mismo dominio, por lo que esta CSP de la API no afecta
      // al renderizado del front.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
        },
      },
      // HSTS solo tiene sentido tras HTTPS (Caddy). 180 días + subdominios.
      hsts: isProd ? { maxAge: 15_552_000, includeSubDomains: true } : false,
      crossOriginResourcePolicy: { policy: "same-site" },
      referrerPolicy: { policy: "no-referrer" },
    }),
  );

  // Eliminar la cabecera X-Powered-By: Express (fingerprinting).
  app.getHttpAdapter().getInstance().disable?.("x-powered-by");

  // --- CORS ---
  // En producción exige CORS_ORIGINS explícito (lista separada por comas).
  // Nunca se usa "*" cuando credentials=true.
  const originsEnv = process.env.CORS_ORIGINS?.trim();
  if (isProd && !originsEnv) {
    throw new Error(
      "CORS_ORIGINS no está definido. En producción configure el/los dominios permitidos (separados por comas).",
    );
  }
  const allowedOrigins = (originsEnv ?? "http://localhost:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  });

  // --- Pipes globales ---
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // --- Filtros de excepción globales ---
  // Nest aplica el filtro más específico que haga match: ZodError -> 400 limpio;
  // cualquier otro error no controlado -> AllExceptionsFilter (sin stack en prod).
  app.useGlobalFilters(new AllExceptionsFilter(), new ZodExceptionFilter());

  // Prefix API
  app.setGlobalPrefix("api");

  // Swagger SOLO en desarrollo (deshabilitado en producción).
  if (!isProd) {
    const config = new DocumentBuilder()
      .setTitle("LIMS IDIC API")
      .setDescription("API del módulo Comercial y LIMS técnico unificado")
      .setVersion("0.1.0")
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("api/docs", app, document);
  }

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
  if (!isProd) {
    console.log(`🚀 LIMS IDIC API · http://localhost:${port}/api`);
    console.log(`📘 Swagger docs · http://localhost:${port}/api/docs`);
  }
}

bootstrap();
