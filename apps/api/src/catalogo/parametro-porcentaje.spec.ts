import { ConflictException, ForbiddenException } from "@nestjs/common";
import { defPorcentaje, erroresPorcentaje, leerPorcentaje, valorGuardado } from "./parametro-porcentaje";
import { ParametroPorcentajeController, ParametroSistemaController } from "./parametro.module";

describe("porcentajes de la tasa de internación (bpch_tasa)", () => {
  const tasa = defPorcentaje("bpch_tasa", "tasa_pct")!;
  const iva = defPorcentaje("bpch_tasa", "iva_pct")!;

  it("lee coma o punto decimal y el signo %", () => {
    expect(leerPorcentaje("1,5")).toBe(1.5);
    expect(leerPorcentaje("1.5")).toBe(1.5);
    expect(leerPorcentaje("19 %")).toBe(19);
    expect(leerPorcentaje(2.25)).toBe(2.25);
    expect(leerPorcentaje("1.000,5")).toBeNaN();
    expect(leerPorcentaje("abc")).toBeNaN();
    expect(leerPorcentaje("")).toBeNaN();
  });

  it("valida 0–100, la tasa distinta de 0, hasta 4 decimales y el motivo", () => {
    expect(erroresPorcentaje(tasa, 1.5, "Resolución del Director 2026")).toEqual([]);
    expect(erroresPorcentaje(iva, 0, "Exención de IVA")).toEqual([]);
    expect(erroresPorcentaje(tasa, 0, "Prueba de cero")[0]).toMatch(/no puede ser 0/);
    expect(erroresPorcentaje(tasa, 101, "Fuera de rango")[0]).toMatch(/entre 0 y 100/);
    expect(erroresPorcentaje(tasa, -1, "Fuera de rango")[0]).toMatch(/entre 0 y 100/);
    expect(erroresPorcentaje(tasa, 1.23456, "Demasiados decimales")[0]).toMatch(/4 decimales/);
    expect(erroresPorcentaje(tasa, 0.1234, "Cuatro decimales")).toEqual([]);
    expect(erroresPorcentaje(tasa, NaN, "x x x x x")[0]).toMatch(/número/);
    expect(erroresPorcentaje(tasa, 1.5, "ok")[0]).toMatch(/motivo/);
  });

  it("se guarda con punto decimal y sin ceros sobrantes", () => {
    expect(valorGuardado(1.5)).toBe("1.5");
    expect(valorGuardado(19)).toBe("19");
    expect(valorGuardado(0.12340)).toBe("0.1234");
  });

  it("los demás parámetros no son porcentajes con historial", () => {
    expect(defPorcentaje("tipo_cliente", "EJERCITO")).toBeNull();
  });
});

describe("parámetros · el porcentaje solo cambia con motivo", () => {
  const fila = { id: "p1", categoria: "bpch_tasa", codigo: "tasa_pct", valor: "1.5", activo: true };
  const svc = {
    detalle: jest.fn(async () => fila),
    actualizar: jest.fn(async () => ({ ok: true })),
    eliminar: jest.fn(async () => ({ ok: true })),
    porcentajes: jest.fn(async () => ({ valores: [], historial: [] })),
  };
  const ctl = new ParametroSistemaController(svc as any);
  const req = { user: { sub: "u", tenantId: "t", permisos: ["catalogo.gestionar"] } };

  it("PATCH genérico: cambiar el valor, la clave o desactivarlo → 409; la etiqueta sí", async () => {
    await expect(ctl.actualizar("11111111-1111-1111-1111-111111111111", { valor: "2" }, req)).rejects.toBeInstanceOf(ConflictException);
    await expect(ctl.actualizar("11111111-1111-1111-1111-111111111111", { codigo: "otro" }, req)).rejects.toBeInstanceOf(ConflictException);
    await expect(ctl.actualizar("11111111-1111-1111-1111-111111111111", { activo: false }, req)).rejects.toBeInstanceOf(ConflictException);
    await ctl.actualizar("11111111-1111-1111-1111-111111111111", { etiqueta: "Tasa de internación (%)" }, req);
    expect(svc.actualizar).toHaveBeenCalledTimes(1);
  });

  it("no se borra", async () => {
    await expect(ctl.eliminar("11111111-1111-1111-1111-111111111111", req)).rejects.toBeInstanceOf(ConflictException);
  });

  it("leer los porcentajes: configuración o internaciones; los demás 403", async () => {
    const p = new ParametroPorcentajeController(svc as any, { alcancePermisos: async () => ({ esGlobal: true, unidadIds: [] }) } as any);
    expect((await p.porcentajes(req)).puedeEditar).toBe(true);
    // Comercial lo ve (internaciones), pero no lo cambia.
    expect((await p.porcentajes({ user: { tenantId: "t", permisos: ["bpch.internacion.ver"] } })).puedeEditar).toBe(false);
    await expect(p.porcentajes({ user: { tenantId: "t", permisos: ["resultado.crear"] } })).rejects.toBeInstanceOf(ForbiddenException);
  });
});
