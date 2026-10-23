import { columna, crc32, libroXlsx, nombreHoja } from "./xlsx-escritura";
import { leerXlsx } from "./tabla-archivo";

describe("escritura de Excel (.xlsx)", () => {
  it("se vuelve a leer igual: textos, números, vacíos y caracteres especiales", () => {
    const b = libroXlsx([
      { nombre: "OT por estado", filas: [["Laboratorio", "Estado", "OT"], ["LQC", "cerrada", 3], ["LPN", "en análisis <&> «ñ»", 1.5], ["LME", null, 0]] },
      { nombre: "Otra", filas: [["x"]] },
    ]);
    expect(b.subarray(0, 2).toString()).toBe("PK");
    expect(leerXlsx(b)).toEqual([["Laboratorio", "Estado", "OT"], ["LQC", "cerrada", "3"], ["LPN", "en análisis <&> «ñ»", "1.5"], ["LME", "", "0"]]);
  });
  it("columnas A…Z, AA; nombres de hoja válidos y únicos", () => {
    expect([0, 25, 26, 27, 701].map(columna)).toEqual(["A", "Z", "AA", "AB", "ZZ"]);
    const u = new Set<string>();
    const a = nombreHoja("Facturación / centro de costo [2026]", u);
    expect(a.length).toBeLessThanOrEqual(31);
    expect(a).not.toMatch(/[[\]:*?/\\]/);
    expect(nombreHoja(a, u)).toMatch(/ 2$/);
  });
  it("CRC-32 estándar", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });
});
