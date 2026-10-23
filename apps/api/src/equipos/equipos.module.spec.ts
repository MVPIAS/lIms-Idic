import { disponeDeLaMuestra, erroresDevolucion } from "./equipos.module";

describe("custodia · devolución del excedente del lote (B-034)", () => {
  it("el excedente no dispone de la muestra ni de la contramuestra", () => {
    expect(disponeDeLaMuestra({ evento: "devolucion", porcion: "excedente" })).toBe(false);
    expect(disponeDeLaMuestra({ evento: "devolucion", porcion: "muestra" })).toBe(true);
    expect(disponeDeLaMuestra({ evento: "devolucion" })).toBe(true);
    expect(disponeDeLaMuestra({ evento: "destruccion" })).toBe(true);
    expect(disponeDeLaMuestra({ evento: "transferencia" })).toBe(false);
  });
  it("la devolución sigue pidiendo cantidad y guía", () => {
    expect(erroresDevolucion({ evento: "devolucion", cantidadDevuelta: null, guiaDespacho: "" })).toHaveLength(2);
  });
});
