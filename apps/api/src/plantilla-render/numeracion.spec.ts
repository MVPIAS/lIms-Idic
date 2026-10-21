import {
  conSufijo,
  elegirRegla,
  erroresFormato,
  formatearNumero,
  numeroGeneral,
  parteNumerica,
  periodoDe,
  primerCodsucdel,
  tokensDe,
  usaCorrelativo,
  type Regla,
} from "./numeracion";

const fecha = new Date(2026, 9, 20);
const regla = (p: Partial<Regla>): Regla => ({
  id: p.id ?? "r",
  unidadId: p.unidadId ?? null,
  tipoDocumento: p.tipoDocumento ?? null,
  formato: p.formato ?? "{N}",
  reinicio: p.reinicio ?? "anual",
  correlativoPorUnidad: p.correlativoPorUnidad ?? false,
  activo: p.activo,
});

describe("numeración oficial · formato", () => {
  it("IE de LPN: correlativo por laboratorio y año con ceros", () => {
    expect(formatearNumero("IE {LAB} N° {N:3}/{AAAA}", { fecha, n: 4, lab: "LPN" }).numero).toBe("IE LPN N° 004/2026");
  });

  it("IVC del LCC con el Nº de la OT (sin prefijo ni ceros)", () => {
    expect(formatearNumero("IVC.DQO.{LAB} Nº {OT_N}/{AAAA}", { fecha, ot: "OT-2026-0012", lab: "LCC" }).numero).toBe("IVC.DQO.LCC Nº 12/2026");
  });

  it("BPCH: CODSUCDEL/código/OT/muestra con anchos fijos", () => {
    const r = formatearNumero("{CODSUCDEL}/{N:4}/{OT_N:5}/{MUESTRA_N:6}", {
      fecha,
      n: 1,
      ot: "OT-2026-0012",
      codsucdel: "3000",
      muestra: "M-2026-0003",
    });
    expect(r.numero).toBe("3000/0001/00012/000003");
  });

  it("DSA LRB, respuesta a orden interna y año con dos cifras", () => {
    expect(formatearNumero("IDIC DSA SAM LRB Nº J.{OT_N}/{AAAA}", { fecha, ot: "OT-2026-0031" }).numero).toBe("IDIC DSA SAM LRB Nº J.31/2026");
    expect(formatearNumero("I.E. N° {NI_N}/{AAAA}", { fecha, ni: "OI-2026-0004" }).numero).toBe("I.E. N° 4/2026");
    expect(formatearNumero("{OT_N}/{NI_N}/{N}-{AA}", { fecha, ot: "OT-2026-0031", ni: "OI-2026-0004", n: 2 }).numero).toBe("31/4/2-26");
  });

  it("si falta un dato del formato no inventa el número: dice cuál falta", () => {
    const r = formatearNumero("{NUM_INFORME}/CC", { fecha });
    expect(r.numero).toBeNull();
    expect(r.faltan).toEqual(["{NUM_INFORME}"]);
    expect(formatearNumero("{NUM_INFORME}/CC", { fecha, numInforme: "3000/0001/00012/000003" }).numero).toBe("3000/0001/00012/000003/CC");
  });

  it("valida el formato: tokens desconocidos, llaves sueltas y sin dato variable", () => {
    expect(erroresFormato("IE {LAB} N° {N:3}/{AAAA}")).toEqual([]);
    expect(erroresFormato("")).toEqual(["Indique el formato del número."]);
    expect(erroresFormato("IE {FOO}/{N}").join(" ")).toMatch(/desconocidos: \{FOO\}/);
    expect(erroresFormato("IE {N").join(" ")).toMatch(/llave/);
    expect(erroresFormato("IE {LAB}/{AAAA}").join(" ")).toMatch(/cambie por documento/);
    expect(erroresFormato("x".repeat(121) + "{N}").join(" ")).toMatch(/120/);
  });

  it("tokens, correlativo y partes numéricas", () => {
    expect(tokensDe("{N:3}-{N}-{AAAA}")).toEqual(["N", "AAAA"]);
    expect(usaCorrelativo("IVC Nº {OT_N}/{AAAA}")).toBe(false);
    expect(usaCorrelativo("IE {N:3}")).toBe(true);
    expect(parteNumerica("OT-2026-0012")).toBe(12);
    expect(parteNumerica("80339")).toBe(80339);
    expect(parteNumerica("SIN-NUMERO")).toBeNull();
    expect(primerCodsucdel("3009/3008")).toBe("3009");
    expect(primerCodsucdel(null)).toBeNull();
  });

  it("sufijo de colisión (-2, -3) distinto del de versión, y numeración general", () => {
    expect(conSufijo("IVC.DQO.LCC Nº 12/2026", 1)).toBe("IVC.DQO.LCC Nº 12/2026");
    expect(conSufijo("IVC.DQO.LCC Nº 12/2026", 2)).toBe("IVC.DQO.LCC Nº 12/2026-2");
    expect(numeroGeneral(2026, 7)).toBe("CERT-2026-0007");
  });

  it("período del correlativo: el año o 0 si es continuo", () => {
    expect(periodoDe({ reinicio: "anual" }, fecha)).toBe(2026);
    expect(periodoDe({ reinicio: "continuo" }, fecha)).toBe(0);
  });
});

describe("numeración oficial · qué regla se aplica", () => {
  const reglas = [
    regla({ id: "general-oi", tipoDocumento: "RESPUESTA_OI" }),
    regla({ id: "bpch-ii", unidadId: "BPCH", tipoDocumento: "INFORME_INSPECCION" }),
    regla({ id: "lrb-todos", unidadId: "LRB" }),
    regla({ id: "lrb-ivc", unidadId: "LRB", tipoDocumento: "IVC" }),
    regla({ id: "lpn-ie-vieja", unidadId: "LPN", tipoDocumento: "INFORME_ENSAYO", activo: false }),
  ];

  it("la sucursal hereda la regla del BPCH (ancestro más cercano)", () => {
    expect(elegirRegla(reglas, ["SSTGO", "BPCH", "DIR"], "INFORME_INSPECCION")?.id).toBe("bpch-ii");
  });

  it("en la misma unidad, el tipo exacto gana a «todos los tipos»", () => {
    expect(elegirRegla(reglas, ["LRB", "DSA"], "IVC")?.id).toBe("lrb-ivc");
    expect(elegirRegla(reglas, ["LRB", "DSA"], "INFORME_ENSAYO")?.id).toBe("lrb-todos");
  });

  it("sin regla de la unidad cae a la general; sin general, null (CERT-AAAA-NNNN)", () => {
    expect(elegirRegla(reglas, ["LEM", "SEM", "DSA"], "RESPUESTA_OI")?.id).toBe("general-oi");
    expect(elegirRegla(reglas, ["LQC", "SQU"], "INFORME_ENSAYO")).toBeNull();
  });

  it("una regla desactivada no se aplica", () => {
    expect(elegirRegla(reglas, ["LPN", "SQU"], "INFORME_ENSAYO")).toBeNull();
  });
});
