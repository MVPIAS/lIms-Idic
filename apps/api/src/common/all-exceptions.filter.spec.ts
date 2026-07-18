/**
 * Tests del filtro global de último recurso (`all-exceptions.filter.ts`).
 *
 * Pentesting crítico: un error NO controlado (p. ej. de Prisma) jamás debe
 * filtrar stack trace ni detalle interno al cliente EN PRODUCCIÓN; debe ser un
 * 500 genérico. Las HttpException se devuelven tal cual.
 *
 * `isProd` se fija en el constructor a partir de NODE_ENV, así que cada bloque
 * ajusta la variable ANTES de instanciar el filtro y la restaura después.
 */
import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { AllExceptionsFilter } from "./all-exceptions.filter";

function resMock() {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}
function hostCon(res: any): ArgumentsHost {
  return { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
}

describe("AllExceptionsFilter · HttpException pasa tal cual", () => {
  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });
  afterEach(() => logSpy.mockRestore());

  it("respeta el status y el body de una NotFoundException (404)", () => {
    const res = resMock();
    new AllExceptionsFilter().catch(new NotFoundException("no existe"), hostCon(res));
    expect(res.status).toHaveBeenCalledWith(404);
    const body = res.json.mock.calls[0][0];
    expect(body.message).toBe("no existe");
    expect(body.statusCode).toBe(404);
  });

  it("respeta un 403 de ForbiddenException", () => {
    const res = resMock();
    new AllExceptionsFilter().catch(new ForbiddenException("prohibido"), hostCon(res));
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("una HttpException con body string se envuelve en {statusCode, message}", () => {
    const res = resMock();
    // getResponse() de una HttpException construida con string devuelve un objeto,
    // así que forzamos el camino string con una excepción mínima.
    const ex = new BadRequestException();
    (ex as any).getResponse = () => "texto plano";
    new AllExceptionsFilter().catch(ex, hostCon(res));
    const body = res.json.mock.calls[0][0];
    expect(body.message).toBe("texto plano");
    expect(body.statusCode).toBe(400);
  });

  it("no registra en el log las HttpException controladas", () => {
    const res = resMock();
    new AllExceptionsFilter().catch(new NotFoundException(), hostCon(res));
    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe("AllExceptionsFilter · error NO controlado", () => {
  const NODE_ENV_ORIG = process.env.NODE_ENV;
  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    logSpy.mockRestore();
    process.env.NODE_ENV = NODE_ENV_ORIG;
  });

  it("en PRODUCCIÓN responde 500 genérico SIN mensaje interno ni stack", () => {
    process.env.NODE_ENV = "production";
    const res = resMock();
    new AllExceptionsFilter().catch(new Error("detalle interno de Prisma"), hostCon(res));
    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body.message).toBe("Error interno del servidor");
    expect(JSON.stringify(body)).not.toContain("detalle interno de Prisma");
    expect(body).not.toHaveProperty("stack");
  });

  it("SIEMPRE loguea el error completo en el servidor (traza para el operador)", () => {
    process.env.NODE_ENV = "production";
    const res = resMock();
    new AllExceptionsFilter().catch(new Error("boom interno"), hostCon(res));
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it("fuera de producción SÍ incluye el mensaje del error (ayuda al desarrollo)", () => {
    process.env.NODE_ENV = "development";
    const res = resMock();
    new AllExceptionsFilter().catch(new Error("detalle dev"), hostCon(res));
    const body = res.json.mock.calls[0][0];
    expect(body.statusCode).toBe(500);
    expect(body.message).toBe("detalle dev");
  });

  it("un throw de algo que no es Error (string) no rompe el filtro → 'Error desconocido'", () => {
    process.env.NODE_ENV = "development";
    const res = resMock();
    new AllExceptionsFilter().catch("fallo suelto" as unknown, hostCon(res));
    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    // Un no-Error no tiene .message: el filtro cae al literal 'Error desconocido'
    // (ni siquiera en dev se serializa el throw crudo). Comportamiento correcto.
    expect(body.message).toBe("Error desconocido");
  });
});
