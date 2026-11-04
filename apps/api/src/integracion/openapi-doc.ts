/**
 * Construcción de la especificación OpenAPI de la API (contrato §4.7.4).
 *
 * La usan:
 *   · main.ts al arrancar: la deja en memoria para GET /api/integracion/openapi.json
 *     (protegido) y, en desarrollo, para la interfaz Swagger de /api/docs;
 *   · el generador `src/cli/exportar-openapi.ts`, que la escribe a un archivo
 *     para entregarla como documento.
 */
import { INestApplication, RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { ModulesContainer } from "@nestjs/core";
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from "@nestjs/swagger";
import { PERMISOS_CRUD_KEY, PERMISOS_KEY } from "../auth/permisos.decorator";
import { PUBLIC_KEY } from "../auth/public.decorator";
import { enriquecerDocumento, permisosDeRuta } from "./openapi";

const DESCRIPCION = [
  "API REST del LIMS del Instituto de Investigaciones y Control del Ejército (IDIC).",
  "",
  "**Autenticación.** Todas las rutas, salvo las marcadas como públicas, exigen la cabecera",
  "`Authorization: Bearer <token>`. El token puede ser el de una sesión de usuario",
  "(POST /api/auth/login) o un **token de integración** creado en",
  "Administración › API e integración, que actúa con los permisos del rol que se le asignó.",
  "",
  "**Permisos.** Cada operación indica el permiso que exige; sin él la API responde 403.",
  "Las rutas por laboratorio filtran además por el alcance (unidades) del rol.",
  "",
  "**Formato.** JSON en UTF-8. Fechas en ISO 8601; la hora oficial es la de Chile continental.",
  "Los errores devuelven `{ statusCode, message }` con el mensaje en español.",
  "",
  "**Trazabilidad.** Toda escritura queda en la bitácora de auditoría con el usuario o la",
  "cuenta de servicio que la hizo.",
].join("\n");

/** Documento en memoria (lo fija main.ts al arrancar). */
let documentoActual: OpenAPIObject | null = null;

export function fijarDocumentoApi(doc: OpenAPIObject): void {
  documentoActual = doc;
}

export function documentoApi(): OpenAPIObject | null {
  return documentoActual;
}

const VERBO_POR_METODO: Partial<Record<number, string>> = {
  [RequestMethod.GET]: "get",
  [RequestMethod.POST]: "post",
  [RequestMethod.PUT]: "put",
  [RequestMethod.PATCH]: "patch",
  [RequestMethod.DELETE]: "delete",
};

/**
 * Permisos de cada operación, por operationId (`Controlador_metodo`, el que usa
 * @nestjs/swagger por defecto). Recorre los controladores registrados y lee los
 * mismos metadatos que PermisoGuard.
 */
export function permisosPorOperacion(app: INestApplication): Record<string, { publica: boolean; permisos: string[] }> {
  const salida: Record<string, { publica: boolean; permisos: string[] }> = {};
  const modulos = app.get(ModulesContainer);
  for (const mod of modulos.values()) {
    for (const wrapper of mod.controllers.values()) {
      const clase = wrapper.metatype as any;
      if (typeof clase !== "function") continue;
      const nombreClase = clase.name;
      const vistos = new Set<string>();
      // El prototipo y sus padres (BaseCrudController define rutas heredadas).
      for (let proto = clase.prototype; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
        for (const nombre of Object.getOwnPropertyNames(proto)) {
          if (nombre === "constructor" || vistos.has(nombre)) continue;
          const fn = Object.getOwnPropertyDescriptor(proto, nombre)?.value;
          if (typeof fn !== "function") continue;
          if (Reflect.getMetadata(PATH_METADATA, fn) === undefined) continue;
          vistos.add(nombre);
          const verbo = VERBO_POR_METODO[Reflect.getMetadata(METHOD_METADATA, fn)] ?? "get";
          salida[`${nombreClase}_${nombre}`] = permisosDeRuta(verbo, {
            publica: Reflect.getMetadata(PUBLIC_KEY, fn) === true || Reflect.getMetadata(PUBLIC_KEY, clase) === true,
            metodo: Reflect.getMetadata(PERMISOS_KEY, fn),
            clase: Reflect.getMetadata(PERMISOS_KEY, clase),
            crud: Reflect.getMetadata(PERMISOS_CRUD_KEY, fn) ?? Reflect.getMetadata(PERMISOS_CRUD_KEY, clase),
          });
        }
      }
    }
  }
  return salida;
}

/** Especificación OpenAPI completa y enriquecida (módulos en español, permisos). */
export function construirDocumentoApi(app: INestApplication, version = "1.0"): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle("LIMS IDIC · API REST")
    .setDescription(DESCRIPCION)
    .setVersion(version)
    .addBearerAuth({ type: "http", scheme: "bearer", bearerFormat: "JWT", description: "Token de sesión o de integración." })
    .build();
  const base = SwaggerModule.createDocument(app, config);
  return enriquecerDocumento(base, { permisos: permisosPorOperacion(app) });
}
