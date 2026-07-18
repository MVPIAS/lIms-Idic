/**
 * Tests del filtro de ZodError (`zod-exception.filter.ts`).
 *
 * Un ZodError de un controlador debe salir como 400 limpio con la lista de
 * issues, nunca como 500 con fuga de stack. Pentesting: la validación fallida es
 * información del cliente, no un error del servidor.
 */
import { ArgumentsHost } from "@nestjs/common";
import { z, ZodError } from "zod";
import { ZodExceptionFilter } from "./zod-exception.filter";

/** Response falso encadenable (status().json()). */
function resMock() {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

function hostCon(res: any): ArgumentsHost {
  return {
    switchToHttp: () => ({ getResponse: () => res }),
  } as unknown as ArgumentsHost;
}

/** Provoca un ZodError real parseando datos inválidos. */
function zodErrorDe(): ZodError {
  const schema = z.object({ nombre: z.string(), edad: z.number().min(0) });
  try {
    schema.parse({ nombre: 123, edad: -5 });
  } catch (e) {
    return e as ZodError;
  }
  throw new Error("se esperaba ZodError");
}

describe("ZodExceptionFilter", () => {
  it("responde 400 con estructura estándar", () => {
    const res = resMock();
    new ZodExceptionFilter().catch(zodErrorDe(), hostCon(res));
    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.statusCode).toBe(400);
    expect(body.error).toBe("Bad Request");
    expect(body.message).toBe("Validación fallida");
  });

  it("incluye los issues con path punteado, message y code", () => {
    const res = resMock();
    new ZodExceptionFilter().catch(zodErrorDe(), hostCon(res));
    const body = res.json.mock.calls[0][0];
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.issues.length).toBeGreaterThanOrEqual(2);
    for (const issue of body.issues) {
      expect(issue).toHaveProperty("path");
      expect(issue).toHaveProperty("message");
      expect(issue).toHaveProperty("code");
    }
    const paths = body.issues.map((i: any) => i.path);
    expect(paths).toContain("nombre");
    expect(paths).toContain("edad");
  });

  it("aplana rutas anidadas con puntos (path.join('.'))", () => {
    const res = resMock();
    const schema = z.object({ a: z.object({ b: z.string() }) });
    let err: ZodError;
    try {
      schema.parse({ a: { b: 1 } });
      throw new Error("no lanzó");
    } catch (e) {
      err = e as ZodError;
    }
    new ZodExceptionFilter().catch(err, hostCon(res));
    const body = res.json.mock.calls[0][0];
    expect(body.issues[0].path).toBe("a.b");
  });

  it("NO expone stack trace en la respuesta", () => {
    const res = resMock();
    new ZodExceptionFilter().catch(zodErrorDe(), hostCon(res));
    const body = res.json.mock.calls[0][0];
    expect(JSON.stringify(body)).not.toMatch(/at .*\.ts:\d+/);
    expect(body).not.toHaveProperty("stack");
  });
});
