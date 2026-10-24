import { codigoPlazoOrigen, diasPorDefecto } from "./plazo-defecto";

describe("B-010 · plazo por defecto de toda OT", () => {
  const plazos = [
    { codigo: "internacion_dias", valor: "10" },
    { codigo: "produccion_nacional_dias", valor: "20" },
    { codigo: "defecto_dias", valor: "15" },
  ];
  const porLab = [{ codigo: "LME", valor: "30" }, { codigo: "LQC", valor: "" }];

  it("el código del origen", () => {
    expect(codigoPlazoOrigen("PRODUCCION_NACIONAL")).toBe("produccion_nacional_dias");
    expect(codigoPlazoOrigen(null)).toBe("");
  });

  it("manda el laboratorio, luego el origen, luego el defecto", () => {
    expect(diasPorDefecto(plazos, porLab, "PRODUCCION_NACIONAL", "LME")).toBe(30);
    expect(diasPorDefecto(plazos, porLab, "PRODUCCION_NACIONAL", "SCC")).toBe(20);
    expect(diasPorDefecto(plazos, porLab, "INTERNACION", null)).toBe(10);
    // OT directa del BPCH (sin origen) y laboratorio sin plazo propio válido.
    expect(diasPorDefecto(plazos, porLab, null, "LQC")).toBe(15);
  });

  it("valores inválidos o sin configurar: sin plazo", () => {
    expect(diasPorDefecto([{ codigo: "defecto_dias", valor: "0" }], [], null, null)).toBeNull();
    expect(diasPorDefecto([{ codigo: "defecto_dias", valor: "abc" }], [], null, null)).toBeNull();
    expect(diasPorDefecto([], [], "COTIZACION", "LQC")).toBeNull();
  });
});
