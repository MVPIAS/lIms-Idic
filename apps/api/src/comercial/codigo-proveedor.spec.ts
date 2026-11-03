import { numeroCodigoProveedor, siguienteCodigoProveedor } from "./codigo-proveedor";

describe("código correlativo del proveedor", () => {
  it("lee el número de los códigos con formato y descarta el resto", () => {
    expect(numeroCodigoProveedor("PROV-007")).toBe(7);
    expect(numeroCodigoProveedor("prov-1234")).toBe(1234);
    expect(numeroCodigoProveedor("ACME")).toBeNull();
    expect(numeroCodigoProveedor(null)).toBeNull();
  });

  it("asigna el siguiente al máximo, con tres dígitos", () => {
    expect(siguienteCodigoProveedor([])).toBe("PROV-001");
    expect(siguienteCodigoProveedor(["PROV-001", "PROV-005", "OTRO", null])).toBe("PROV-006");
    expect(siguienteCodigoProveedor(["PROV-999"])).toBe("PROV-1000");
  });
});
