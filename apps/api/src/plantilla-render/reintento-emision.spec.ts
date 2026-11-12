import { conReintento, esErrorTransitorio } from "./reintento-emision";

describe("F003 · emisión robusta: reintento controlado", () => {
  it("reconoce los errores transitorios de la transacción", () => {
    expect(esErrorTransitorio({ code: "P2028", message: "Transaction already closed" })).toBe(true);
    expect(esErrorTransitorio({ code: "P2034" })).toBe(true);
    expect(esErrorTransitorio({ message: "Transaction API error: Transaction already closed: A commit cannot be executed on an expired transaction." })).toBe(true);
    expect(esErrorTransitorio({ code: "P2002", meta: { target: ["tenant_id", "codigo"] } })).toBe(true);
  });
  it("no repite errores de negocio ni otros duplicados", () => {
    expect(esErrorTransitorio({ status: 409, message: "No se puede emitir el documento. Faltan resultados por aprobar." })).toBe(false);
    expect(esErrorTransitorio({ code: "P2002", meta: { target: ["certificado_id", "orden"] } })).toBe(false);
    expect(esErrorTransitorio(null)).toBe(false);
  });
  it("repite una vez ante un error transitorio y luego devuelve el resultado", async () => {
    let n = 0;
    const r = await conReintento(async () => {
      n++;
      if (n === 1) throw { code: "P2028", message: "Transaction already closed" };
      return "emitido";
    }, 1, 0);
    expect(r).toBe("emitido");
    expect(n).toBe(2);
  });
  it("no repite un error de negocio y no pasa del máximo", async () => {
    let n = 0;
    await expect(conReintento(async () => { n++; throw new Error("Faltan firmas"); }, 1, 0)).rejects.toThrow("Faltan firmas");
    expect(n).toBe(1);
    let m = 0;
    await expect(conReintento(async () => { m++; throw { code: "P2028" }; }, 1, 0)).rejects.toEqual({ code: "P2028" });
    expect(m).toBe(2);
  });
});
