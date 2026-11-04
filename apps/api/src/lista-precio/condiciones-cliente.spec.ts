import { estadoListaCliente, type ListaCliente } from "./condiciones-cliente";
import { aplicarDescuento, elegirPrecioCliente, erroresVigenciaLista, precioParaCotizacion, textoOrigenPrecio, type ItemListaVigente } from "./precio-lista";

const general: ItemListaVigente = {
  catEnsayoId: "e1",
  itemId: "i1",
  itemCodigo: "EN1214",
  precio: 514_519,
  costoTotal: 395_784,
  listaCodigo: "LP-2026",
  listaNombre: "Lista de precios 2026",
  moneda: "CLP",
};
const propio: ItemListaVigente = { ...general, itemId: "i2", itemCodigo: "PRB-01", precio: 450_000, costoTotal: null, listaCodigo: "PRB-LP", listaNombre: "Lista PRUEBA cliente" };

describe("Contrato 4.1.3 · lista de precios propia del cliente y condiciones especiales", () => {
  it("la lista propia del cliente manda sobre la lista general y la ficha", () => {
    const p = elegirPrecioCliente(propio, general, 612_278, "PARTICULAR", "ficha");
    expect(p).toMatchObject({ precio: 450_000, origen: "lista_cliente", lista: { codigo: "PRB-LP", itemCodigo: "PRB-01" } });
    expect(textoOrigenPrecio(p)).toBe("Lista propia del cliente «Lista PRUEBA cliente» · ítem PRB-01");
  });

  it("la lista propia se aplica también a un cliente Ejército (es un precio negociado para él)", () => {
    expect(elegirPrecioCliente(propio, general, 612_278, "EJERCITO", "ficha")?.precio).toBe(450_000);
  });

  it("sin el ensayo en la lista propia: regla general (lista vigente y luego ficha)", () => {
    expect(elegirPrecioCliente(null, general, 612_278, "PARTICULAR", "ficha")).toMatchObject({ precio: 514_519, origen: "lista" });
    expect(elegirPrecioCliente(undefined, null, 28_000, "PARTICULAR", "ficha")).toMatchObject({ precio: 28_000, origen: "ficha" });
    expect(textoOrigenPrecio(elegirPrecioCliente(null, general, null, "PARTICULAR", "ficha"))).toBe("Lista de precios vigente «Lista de precios 2026» · ítem EN1214");
  });

  it("el descuento especial del cliente se aplica sobre el precio elegido y queda en el origen", () => {
    const p = elegirPrecioCliente(null, general, null, "PARTICULAR", "ficha", 10);
    expect(p).toMatchObject({ precio: 463_067.1, precioSinDescuento: 514_519, descuentoPct: 10 });
    expect(precioParaCotizacion(p!, "CLP", null)).toEqual({ precio: 463_067 });
    expect(textoOrigenPrecio(p)).toBe("Lista de precios vigente «Lista de precios 2026» · ítem EN1214 · descuento especial del cliente 10 %");
    expect(textoOrigenPrecio(aplicarDescuento({ precio: 1000, moneda: "CLP", origen: "ficha" }, 12.5))).toBe("Ficha de costos del catálogo · descuento especial del cliente 12,5 %");
  });

  it("sin descuento, con 0 o fuera de rango: el precio no cambia", () => {
    const base = { precio: 1000, moneda: "CLP" as const, origen: "ficha" as const };
    expect(aplicarDescuento(base, 0)).toBe(base);
    expect(aplicarDescuento(base, null)).toBe(base);
    expect(aplicarDescuento(base, 100)).toBe(base);
    expect(aplicarDescuento(null, 10)).toBeNull();
  });

  it("vigencia de la lista propia: activa, en CLP/USD y dentro de sus fechas", () => {
    const l: ListaCliente = { id: "l1", codigo: "PRB-LP", nombre: "Lista PRUEBA", moneda: "CLP", vigenteDesde: "2026-11-01", vigenteHasta: "2026-12-31", activa: true, borrada: false };
    expect(estadoListaCliente(l, "2026-11-03")).toEqual({ vigente: true, motivo: null });
    expect(estadoListaCliente(l, "2026-10-31").motivo).toMatch(/rige desde el 01-11-2026/);
    expect(estadoListaCliente(l, "2027-01-01").motivo).toMatch(/venció el 31-12-2026/);
    expect(estadoListaCliente({ ...l, activa: false }, "2026-11-03").motivo).toMatch(/inactiva/);
    expect(estadoListaCliente({ ...l, moneda: "UF" }, "2026-11-03").motivo).toMatch(/moneda histórica/);
    expect(estadoListaCliente({ ...l, vigenteHasta: null }, "2030-01-01").vigente).toBe(true);
  });

  it("«Vigente hasta» no puede ser anterior a «Vigente desde»", () => {
    expect(erroresVigenciaLista("2026-11-01", "2026-10-31")).toMatch(/no puede ser anterior/);
    expect(erroresVigenciaLista(new Date("2026-11-01T00:00:00Z"), "2026-11-01")).toBeNull();
    expect(erroresVigenciaLista("2026-11-01", null)).toBeNull();
  });
});
