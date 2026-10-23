import { siguienteCodigoPlanta } from "./cliente.service";

describe("Plantas del cliente · código automático (EP-00 0.1)", () => {
  it("la primera planta es P01", () => expect(siguienteCodigoPlanta([])).toBe("P01"));
  it("sigue el mayor P-número y no rellena huecos", () => expect(siguienteCodigoPlanta(["P01", "P03"])).toBe("P04"));
  it("ignora códigos que no son P-número", () => expect(siguienteCodigoPlanta(["CASA", "p2"])).toBe("P03"));
});
