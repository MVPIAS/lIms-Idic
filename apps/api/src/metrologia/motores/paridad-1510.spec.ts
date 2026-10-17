import { CASOS_1510, verificarCaso1510, verificarParidad1510 } from "./paridad-1510";
import { calcularITM03, nominalSuperior } from "./masa-nn";
import { calcularITV05 } from "./micropipeta";
import { calcularConMotor, motorDeProceso, motivoOpciones, opcionesPorDefecto, MOTORES, REGISTRO_MOTORES } from "./index";

const caso = (k: string) => CASOS_1510.find((c) => c.caso === k)!;

describe("Motores 15-10 · paridad con las planillas reales del LMT", () => {
  it.each([["M-3947", "ITM03"], ["V-5920", "ITV05"]])("%s (%s): todos los valores idénticos a la planilla", (k) => {
    const c = verificarCaso1510(caso(k));
    expect(c.fallos).toEqual([]);
    expect(c.ok).toBe(c.n);
  });

  it("recuento total: 167 + 72 valores", () => {
    const p = verificarParidad1510();
    expect(p.casos.find((c) => c.caso === "M-3947")!.comparados).toBe(167);
    expect(p.casos.find((c) => c.caso === "V-5920")!.comparados).toBe(72);
    expect(p.identicos).toBe(p.comparados);
  });

  it("no altera las 14 instrucciones originales", () => {
    expect(Object.keys(MOTORES)).toHaveLength(14);
    expect(motorDeProceso("ITM03")?.it).toBe("ITM03");
    expect(motorDeProceso("ITV05")?.it).toBe("ITV05");
  });
});

describe("ITM03 · masas no normalizadas", () => {
  const d = caso("M-3947").datos;

  it("masa convencional con 3 decimales en g y U asignada por clase en mg (certificado)", () => {
    const r = calcularITM03(d);
    expect(r.rows.map((x: any) => x.L77)).toEqual([99.845, 200.217, 300.15, 474.99]);
    expect(r.rows.map((x: any) => x.certU)).toEqual(["5 mg", "10 mg", "25 mg", "25 mg"]);
  });

  it("nominal no normalizado sin U escrita: error claro; con la regla (opción) toma el nominal OIML superior", () => {
    const sin = structuredClone(d);
    sin.items[2].uAsignadaManual = null;
    expect(() => calcularITM03(sin)).toThrow(/no normalizado/);
    const r = calcularITM03(sin, { uRegla: true });
    expect(r.rows[2].uAsig).toBe(25);
    expect(r.rows[2].origenU).toBe("regla (500 g)");
    expect(nominalSuperior(475000)).toBe("500 g");
  });

  it("M10 (opción): la u por empuje del primer ítem pasa a mg como en los demás", () => {
    const a = calcularITM03(d), b = calcularITM03(d, { ucMg: true });
    expect(b.rows[0].K90 / a.rows[0].K90).toBeCloseTo(1000, 9);
    expect(b.rows[1].K90).toBe(a.rows[1].K90);
  });

  it("M6: con las condiciones corregidas cambia la densidad del aire", () => {
    const a = calcularITM03(d), b = calcularITM03(d, { corr: true });
    expect(b.rows[0].H24).not.toBe(a.rows[0].H24);
  });

  it("sin conformidad en el resumen (C1)", () => {
    const { resumen } = calcularConMotor("ITM03", d);
    expect(resumen.conforme).toBeNull();
    expect(resumen.puntos.every((p) => p.conforme === null)).toBe(true);
  });
});

describe("ITV05 · micropipetas", () => {
  const d = caso("V-5920").datos;

  it("certificado en µL con 2 decimales, como la planilla", () => {
    const r = calcularITV05(d);
    expect(r.rows.map((x: any) => [x.cC, x.cD, x.cF, x.cH])).toEqual([[19.84, 20, 0.13, 0.21], [99.53, 100, 0.24, 0.14], [200.16, 200, 0.49, 0.14]]);
  });

  it("V8 (opción): la evaporación sumada sube el volumen; desactivada = planilla", () => {
    const a = calcularITV05(d), b = calcularITV05(d, { evap: true });
    expect(b.rows[0].I).toBeGreaterThan(a.rows[0].I);
  });

  it("k = 2,15 solo en el balance del primer punto; la opción lo deja en 2", () => {
    const a = calcularITV05(d), b = calcularITV05(d, { kBal: true });
    expect(a.rows[0].Ubal / a.rows[0].L).toBeCloseTo(2.15, 12);
    expect(b.rows[0].Ubal / b.rows[0].L).toBeCloseTo(2, 12);
    expect(a.rows[0].M).toBe(b.rows[0].M);
  });
});

describe("Correcciones según la respuesta del laboratorio (C6)", () => {
  it("las pedidas por el laboratorio vienen activadas; las rechazadas no se aceptan", () => {
    expect(opcionesPorDefecto(REGISTRO_MOTORES.ITM02)).toEqual({ fix: true });
    expect(opcionesPorDefecto(REGISTRO_MOTORES.ITL07)).toEqual({ full: true });
    expect(motivoOpciones(REGISTRO_MOTORES.ITL07, { sqrt: true })).toMatch(/rechazada/);
    expect(motivoOpciones(REGISTRO_MOTORES.ITL07, { full: true })).toBeNull();
    expect(motivoOpciones(REGISTRO_MOTORES.ITM02, { inventada: true })).toMatch(/desconocida/);
  });
  it("toda corrección tiene una decisión registrada", () => {
    Object.values(REGISTRO_MOTORES).forEach((m) => m.opciones.forEach((o) => expect(["aplicar", "rechazada", "pendiente"]).toContain(o.decision)));
  });
});
