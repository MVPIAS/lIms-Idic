import { configDesdeValores, reglaPrecioDe, tiposPrecioInstitucionalDe, TIPOS_PRECIO_INSTITUCIONAL_DEF } from "./circuito-config";
import { elegirPrecio } from "../lista-precio/precio-lista";

/**
 * Checklist Comercial SVT 30 (IDIC 24-11-2026): a Ejército, Carabineros, Fuerza
 * Aérea, Armada, PDI y Gendarmería se les cobra el costo directo; el resto de los
 * tipos de cliente sigue con el neto particular.
 */
describe("precio institucional por tipo de cliente", () => {
  const tipos = TIPOS_PRECIO_INSTITUCIONAL_DEF;

  it("las seis instituciones toman la regla Ejército aunque su tipo tenga regla Particular", () => {
    for (const t of ["ejercito", "carabineros", "fuerza_aerea", "armada", "pdi", "gendarmeria"]) expect(reglaPrecioDe(t, "PARTICULAR", tipos)).toBe("EJERCITO");
  });

  it("particulares, proveedores, DGMN y Ley 17.798 siguen con el precio particular", () => {
    for (const t of ["particulares", "prov_ejercito", "prov_armada", "dgmn", "ley_17798", "interlaboratorio", "interno"]) expect(reglaPrecioDe(t, "PARTICULAR", tipos)).toBe("PARTICULAR");
  });

  it("sin tipo de cliente manda la regla del tipo; el código legado «institucional» es Ejército", () => {
    expect(reglaPrecioDe(null, "PARTICULAR", tipos)).toBe("PARTICULAR");
    expect(reglaPrecioDe("institucional", "PARTICULAR", tipos)).toBe("EJERCITO");
  });

  it("un tipo con regla Ejército la conserva aunque no esté marcado", () => {
    expect(reglaPrecioDe("ejercito", "EJERCITO", ["carabineros"])).toBe("EJERCITO");
  });

  it("el parámetro vacío o ausente usa la lista por defecto; se normaliza", () => {
    expect(tiposPrecioInstitucionalDe(undefined)).toEqual(tipos);
    expect(tiposPrecioInstitucionalDe("  ")).toEqual(tipos);
    expect(tiposPrecioInstitucionalDe(" Armada, pdi ,pdi")).toEqual(["armada", "pdi"]);
    expect(configDesdeValores({}).tiposPrecioInstitucional).toEqual(tipos);
  });

  it("con la lista vigente, Carabineros toma el costo directo y un particular el neto", () => {
    const item = { precio: 130, costoDirecto: 83.33, costoTotal: 100, moneda: "CLP", listaCodigo: "LP26", listaNombre: "Lista 2026", itemCodigo: "EN 1" } as any;
    expect(elegirPrecio(item, null, reglaPrecioDe("carabineros", "PARTICULAR", tipos), "costo_directo")).toMatchObject({ precio: 83.33, columna: "costo_directo" });
    expect(elegirPrecio(item, null, reglaPrecioDe("particulares", "PARTICULAR", tipos), "costo_directo")).toMatchObject({ precio: 130, columna: "neto" });
  });
});
