import { elegirPrecio, precioPanel, precioParaCotizacion, type ItemListaVigente } from "./precio-lista";
import { filtroDetalle } from "./lista-precio-detalle.controller";

const item: ItemListaVigente = {
  catEnsayoId: "e1",
  itemId: "i1",
  itemCodigo: "EN1214",
  precio: 514_519,
  costoTotal: 395_784,
  listaCodigo: "LP-2026",
  listaNombre: "Lista de precios 2026",
  moneda: "CLP",
};
const itemUsd: ItemListaVigente = { ...item, itemCodigo: "EN1074", precio: 150, costoTotal: 115.38, listaCodigo: "DEMO-USD-2026", listaNombre: "Lista de ejemplo en USD", moneda: "USD" };

describe("Precio del ensayo en la cotización (lista vigente o ficha)", () => {
  it("particular: el neto de la lista vigente aunque la ficha diga otra cosa", () => {
    expect(elegirPrecio(item, 612_278, "PARTICULAR", "ficha")).toEqual({
      precio: 514_519,
      moneda: "CLP",
      origen: "lista",
      columna: "neto",
      lista: { codigo: "LP-2026", nombre: "Lista de precios 2026", itemCodigo: "EN1214" },
    });
  });

  it("particular sin ítem en la lista: la ficha de costos", () => {
    expect(elegirPrecio(null, 28_000, "PARTICULAR", "ficha")).toEqual({ precio: 28_000, moneda: "CLP", origen: "ficha" });
  });

  it("Ejército: por defecto la ficha; con el parámetro, costo total o neto de la lista", () => {
    expect(elegirPrecio(item, 612_278, "EJERCITO", "ficha")).toEqual({ precio: 612_278, moneda: "CLP", origen: "ficha" });
    expect(elegirPrecio(item, 612_278, "EJERCITO", "costo_total")?.precio).toBe(395_784);
    expect(elegirPrecio(item, 612_278, "EJERCITO", "neto")?.precio).toBe(514_519);
  });

  it("sin valor ni en la lista ni en la ficha: null (la cotización lo bloquea)", () => {
    expect(elegirPrecio(null, 0, "PARTICULAR", "ficha")).toBeNull();
    expect(elegirPrecio({ ...item, costoTotal: null }, null, "EJERCITO", "costo_total")).toBeNull();
  });
});

describe("Frente f6 · el precio conserva la moneda de su lista", () => {
  it("una lista en USD da el precio en USD (no en pesos)", () => {
    const p = elegirPrecio(itemUsd, 146_831, "PARTICULAR", "ficha");
    expect(p).toMatchObject({ precio: 150, moneda: "USD", origen: "lista" });
    // La ficha de costos está en CLP.
    expect(elegirPrecio(null, 146_831, "PARTICULAR", "ficha")?.moneda).toBe("CLP");
  });

  it("misma moneda: tal cual, redondeado (CLP sin decimales, USD a 2)", () => {
    expect(precioParaCotizacion({ precio: 150, moneda: "USD", origen: "lista" }, "USD", 950)).toEqual({ precio: 150 });
    expect(precioParaCotizacion({ precio: 150.456, moneda: "USD", origen: "lista" }, "USD", null)).toEqual({ precio: 150.46 });
    expect(precioParaCotizacion({ precio: 123_387.4, moneda: "CLP", origen: "lista" }, "CLP", null)).toEqual({ precio: 123_387 });
    // Una lista en USD en una cotización en USD NO se divide por el dólar del día.
    expect(precioParaCotizacion({ precio: 150, moneda: "USD", origen: "lista" }, "usd", 950).precio).toBe(150);
  });

  it("CLP → USD con el dólar del día de la cotización; sin dólar, error", () => {
    expect(precioParaCotizacion({ precio: 123_387, moneda: "CLP", origen: "lista" }, "USD", 950)).toEqual({ precio: 129.88 });
    expect(precioParaCotizacion({ precio: 123_387, moneda: "CLP", origen: "ficha" }, "USD", null).error).toMatch(/dólar del día/);
  });

  it("USD → CLP se bloquea con mensaje claro (sin tipo de cambio inventado)", () => {
    const r = precioParaCotizacion({ precio: 150, moneda: "USD", origen: "lista", lista: { codigo: "DEMO-USD-2026", nombre: "Lista de ejemplo en USD", itemCodigo: "EN1074" } }, "CLP", 950, "EN1074");
    expect(r.precio).toBeUndefined();
    expect(r.error).toMatch(/del ensayo EN1074 está en USD .*Lista de ejemplo en USD.*cotización está en CLP.*Emita la cotización en USD/);
  });
});

describe("D01-23 · precio del panel de Registrar OT", () => {
  it("frente f6: el total estimado va en CLP: un ítem de una lista en USD no se toma como pesos", () => {
    expect(precioPanel("0", itemUsd)).toBe(0);
    expect(precioPanel(null, itemUsd)).toBeNull();
  });

  it("la ficha con valor manda; en 0 usa el neto de la lista vigente; sin ninguno queda la ficha", () => {
    expect(precioPanel("12000", item)).toBe(12000);
    expect(precioPanel("0.00", item)).toBe(item.precio);
    expect(precioPanel(null, item)).toBe(item.precio);
    expect(precioPanel("0", undefined)).toBe(0);
    expect(precioPanel(null, undefined)).toBeNull();
  });
});

describe("Filtro del detalle de la lista", () => {
  it("búsqueda, centro y enlace con parámetros numerados (sin interpolar texto)", () => {
    const f = filtroDetalle({ q: "50%_x", centro: "LPN", enlace: "nombre_base" }, 2);
    expect(f.where).toHaveLength(3);
    expect(f.where[0]).toContain("$2");
    expect(f.params).toEqual(["%50\\%\\_x%", "LPN", "nombre_base"]);
    expect(filtroDetalle({ enlace: "no" }).where).toEqual(["i.cat_ensayo_id IS NULL"]);
    expect(() => filtroDetalle({ enlace: "x'; drop" })).toThrow();
  });
});
