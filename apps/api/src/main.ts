import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  // CORS
  app.enableCors({
    origin: (process.env.CORS_ORIGINS ?? "http://localhost:3000").split(","),
    credentials: true,
  });

  // Pipes globales
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Prefix API
  app.setGlobalPrefix("api");

  // Swagger en desarrollo
  if (process.env.NODE_ENV !== "production") {
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
  console.log(`🚀 LIMS IDIC API · http://localhost:${port}/api`);
  console.log(`📘 Swagger docs · http://localhost:${port}/api/docs`);
}

bootstrap();
