import { configNumeracionProyecto, formatearCodigoProyecto, NUMERACION_PROYECTO_DEF, serieProyecto, textoProyecto } from "./numeracion-proyecto";

describe("código de proyecto (quinto envío IDIC, lote 3)", () => {
  it("por defecto PROY/001/2026: 3 dígitos y reinicio anual (valores provisionales)", () => {
    const cfg = configNumeracionProyecto({});
    expect(cfg).toEqual(NUMERACION_PROYECTO_DEF);
    expect(formatearCodigoProyecto(cfg, 2026, 1)).toBe("PROY/001/2026");
    expect(formatearCodigoProyecto(cfg, 2026, 1234)).toBe("PROY/1234/2026");
    expect(serieProyecto(cfg, 2026)).toBe("2026");
  });

  it("toma los parámetros guardados y descarta los que no se entienden", () => {
    const cfg = configNumeracionProyecto({ formato: "P-{AAAA}-{N}", digitos: "4", reinicio: "global" });
    expect(formatearCodigoProyecto(cfg, 2027, 7)).toBe("P-2027-0007");
    expect(serieProyecto(cfg, 2027)).toBe("global");
    expect(configNumeracionProyecto({ formato: "SIN-MARCA", digitos: "0", reinicio: "x" })).toEqual(NUMERACION_PROYECTO_DEF);
  });

  it("texto del proyecto en la OT y el IVC: «código · nombre», máximo 200", () => {
    expect(textoProyecto("PROY/001/2026", "PRUEBA Proyecto")).toBe("PROY/001/2026 · PRUEBA Proyecto");
    expect(textoProyecto(null, null)).toBeNull();
    expect(textoProyecto("PROY/001/2026", "x".repeat(300))!.length).toBe(200);
  });
});
