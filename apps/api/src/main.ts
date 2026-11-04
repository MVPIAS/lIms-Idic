// Primero: la zona horaria de la sesión de base de datos (frente f8).
import "./common/zona-entorno";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { SwaggerModule } from "@nestjs/swagger";
import { Logger } from "nestjs-pino";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { ZodExceptionFilter } from "./common/zod-exception.filter";
import { AllExceptionsFilter } from "./common/all-exceptions.filter";
import { instalarSerializacionBigInt } from "./common/bigint-json";
import { construirDocumentoApi, fijarDocumentoApi } from "./integracion/openapi-doc";

// Las columnas bigint de Prisma (Nº interno de la muestra, correlativos, count(*))
// se responden como texto: sin esto, JSON.stringify lanza y la API da 500.
instalarSerializacionBigInt();

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

  // Confiar en el primer proxy (Caddy termina TLS por delante). Sin esto Express
  // reporta la IP del proxy en `req.ip`, con lo que el rate-limit de login y los
  // logs de auditoría verían a todos los clientes como una única IP. Con
  // `trust proxy = 1` resuelve la IP real desde X-Forwarded-For.
  app.getHttpAdapter().getInstance().set?.("trust proxy", 1);

  // Permissions-Policy: helmet ya no emite esta cabecera por defecto (retiró
  // Feature-Policy). La fijamos manualmente para desactivar APIs del navegador
  // que la API no necesita. Defensa en profundidad por si el API se expusiera
  // sin el proxy Caddy (que también la añade a nivel de sitio).
  app.use((_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    res.setHeader(
      "Permissions-Policy",
      "geolocation=(), camera=(), microphone=(), payment=(), usb=()",
    );
    next();
  });

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

  // Documentación de la API (contrato §4.7.4). La especificación OpenAPI se
  // construye SIEMPRE y se sirve protegida en GET /api/integracion/openapi.json
  // (permiso integracion.documentacion: administradores y tokens de
  // integración); la web la muestra en Administración › API e integración.
  // La interfaz Swagger pública de /api/docs sigue SOLO en desarrollo.
  // Un fallo al generarla no debe impedir que la API arranque.
  try {
    const document = construirDocumentoApi(app);
    fijarDocumentoApi(document);
    if (!isProd) {
      SwaggerModule.setup("api/docs", app, document);
    }
  } catch (e) {
    console.error(`No se pudo generar la documentación OpenAPI: ${e instanceof Error ? e.message : e}`);
  }

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
  if (!isProd) {
    console.log(`🚀 LIMS IDIC API · http://localhost:${port}/api`);
    console.log(`📘 Swagger docs · http://localhost:${port}/api/docs`);
  }
}

bootstrap();
