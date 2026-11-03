import { accionLegible, accionesDelGrupo, esGrupoAccion } from "./etiqueta-accion";

describe("acción de la bitácora en español", () => {
  it("traduce los verbos y las sub-acciones conocidas", () => {
    expect(accionLegible("modificar")).toEqual({ etiqueta: "Modificación", grupo: "modificar" });
    expect(accionLegible("firmar")).toEqual({ etiqueta: "Firma", grupo: "flujo" });
    expect(accionLegible("descontar")).toEqual({ etiqueta: "Descuento de stock", grupo: "flujo" });
    expect(accionLegible("anular").grupo).toBe("eliminar");
  });

  it("lo desconocido es el alta de un sub-registro, sin guiones", () => {
    expect(accionLegible("solicitudes-laboratorio")).toEqual({ etiqueta: "Registro de solicitudes laboratorio", grupo: "crear" });
    expect(accionLegible("ordenes-compra").etiqueta).toBe("Registro de órdenes de compra");
    expect(accionLegible("ot").etiqueta).toBe("Registro de OT");
    expect(accionLegible("lotes").grupo).toBe("crear");
  });

  it("expande una familia a sus códigos", () => {
    expect(accionesDelGrupo("crear", ["crear", "lotes", "firmar", "modificar"])).toEqual(["crear", "lotes"]);
    expect(esGrupoAccion("flujo")).toBe(true);
    expect(esGrupoAccion("lotes")).toBe(false);
  });
});
