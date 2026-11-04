/**
 * CLI · Exporta la especificación OpenAPI de la API (contrato §4.7.4) para
 * entregarla como documento:
 *   · openapi-lims-idic.json  especificación OpenAPI 3 (importable en Swagger UI,
 *                             Postman, Insomnia o un generador de clientes);
 *   · openapi-lims-idic.html  versión legible e imprimible, agrupada por módulo
 *                             con el permiso de cada operación.
 *
 * Uso (desde apps/api):
 *   pnpm openapi:exportar [--salida <carpeta>] [--version 1.0]
 *   node dist/cli/exportar-openapi.js --salida /tmp/api      (en el contenedor)
 *
 * No necesita base de datos: Nest arma el grafo de módulos en modo «preview»
 * (sin crear proveedores ni conectarse) y Swagger lee los decoradores.
 * Por defecto escribe en <repo>/docs/api.
 */
import "../common/zona-entorno";
import { mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";

function arg(nombre: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

async function main() {
  // AppModule lee JWT_SECRET al importarse (JwtModule.register). Para solo
  // leer los decoradores basta un valor provisional: nada se firma aquí.
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    process.env.JWT_SECRET = "exportacion-openapi-sin-firma-0000000000";
  }
  const { NestFactory } = await import("@nestjs/core");
  const { AppModule } = await import("../app.module");
  const { construirDocumentoApi } = await import("../integracion/openapi-doc");
  const { documentoHtml } = await import("../integracion/openapi-html");
  const { hoyCl } = await import("../ot/plazos");

  const app = await NestFactory.create(AppModule, { preview: true, logger: false, abortOnError: false });
  app.setGlobalPrefix("api");
  const doc = construirDocumentoApi(app, arg("version", "1.0"));

  const salida = resolve(arg("salida") ?? join(__dirname, "..", "..", "..", "..", "docs", "api"));
  mkdirSync(salida, { recursive: true });
  const json = join(salida, "openapi-lims-idic.json");
  const html = join(salida, "openapi-lims-idic.html");
  writeFileSync(json, JSON.stringify(doc, null, 2) + "\n", "utf8");
  writeFileSync(html, documentoHtml(doc, hoyCl()), "utf8");
  const operaciones = Object.values<any>(doc.paths ?? {}).reduce(
    (s, item) => s + ["get", "post", "put", "patch", "delete"].filter((v) => item?.[v]).length,
    0,
  );
  console.log(`Especificación OpenAPI exportada (${operaciones} operaciones, ${doc.tags?.length ?? 0} módulos):`);
  console.log(`  ${json}`);
  console.log(`  ${html}`);
  await app.close().catch(() => undefined);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
