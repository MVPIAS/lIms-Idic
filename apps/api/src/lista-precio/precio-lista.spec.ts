import { elegirPrecio, type ItemListaVigente } from "./precio-lista";
import { filtroDetalle } from "./lista-precio-detalle.controller";

const item: ItemListaVigente = {
  catEnsayoId: "e1",
  itemId: "i1",
  itemCodigo: "EN1214",
  precio: 514_519,
  costoTotal: 395_784,
  listaCodigo: "LP-2026",
  listaNombre: "Lista de precios 2026",
};

describe("Precio del ensayo en la cotización (lista vigente o ficha)", () => {
  it("particular: el neto de la lista vigente aunque la ficha diga otra cosa", () => {
    expect(elegirPrecio(item, 612_278, "PARTICULAR", "ficha")).toEqual({
      precio: 514_519,
      origen: "lista",
      columna: "neto",
      lista: { codigo: "LP-2026", nombre: "Lista de precios 2026", itemCodigo: "EN1214" },
    });
  });

  it("particular sin ítem en la lista: la ficha de costos", () => {
    expect(elegirPrecio(null, 28_000, "PARTICULAR", "ficha")).toEqual({ precio: 28_000, origen: "ficha" });
  });

  it("Ejército: por defecto la ficha; con el parámetro, costo total o neto de la lista", () => {
    expect(elegirPrecio(item, 612_278, "EJERCITO", "ficha")).toEqual({ precio: 612_278, origen: "ficha" });
    expect(elegirPrecio(item, 612_278, "EJERCITO", "costo_total")?.precio).toBe(395_784);
    expect(elegirPrecio(item, 612_278, "EJERCITO", "neto")?.precio).toBe(514_519);
  });

  it("sin valor ni en la lista ni en la ficha: null (la cotización lo bloquea)", () => {
    expect(elegirPrecio(null, 0, "PARTICULAR", "ficha")).toBeNull();
    expect(elegirPrecio({ ...item, costoTotal: null }, null, "EJERCITO", "costo_total")).toBeNull();
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
