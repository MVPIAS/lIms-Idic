import { CASOS_REFERENCIA, verificarParidad } from "./paridad";
import { MOTORES, calcularConMotor, motorDeProceso } from "./index";

/** Valores comparados por caso, iguales a la pestaña «Paridad Excel» de la maqueta. */
const ESPERADO: Record<string, number> = {
  "M-3889": 88, "M-3859": 33, "P-808": 66, "P-807": 229, "L-4359": 98, "L-4377": 64, "L-4352": 60, "L-4351": 236,
  "V-5878": 46, "V-5881": 22, "V-5885": 22, "T-2887": 49, "T-2890": 52, "F-1556": 195, "F-1563": 185, "PT-0090": 86,
};

describe("Motores de Metrología · paridad con los Excel del LMT", () => {
  const par = verificarParidad();

  it.each(Object.entries(ESPERADO))("%s: todos los valores idénticos al Excel", (caso, n) => {
    const c = par.casos.find((x) => x.caso === caso)!;
    expect(c.comparados).toBe(n);
    expect(c.identicos).toBe(n);
  });

  it("total 1531 de 1531", () => {
    expect(par.comparados).toBe(1531);
    expect(par.identicos).toBe(1531);
  });

  it("cubre las 14 instrucciones de trabajo con caso real", () => {
    expect(new Set(CASOS_REFERENCIA.map((c) => c.it)).size).toBe(14);
    expect(Object.keys(MOTORES)).toHaveLength(14);
  });
});

describe("Resumen normalizado y valores certificados", () => {
  const caso = (k: string) => CASOS_REFERENCIA.find((c) => c.caso === k)!;
  const res = (k: string, opt = {}) => calcularConMotor(caso(k).it, caso(k).datos, opt).resumen;

  it("M-3889: U certificada ± 0,0003 g (la del Excel, no 0,0002156)", () => {
    expect(res("M-3889").uCert).toBe(0.0003);
  });
  it("P-808: el certificado manda la CMC del patrón (0,05 bar)", () => {
    expect(res("P-808").uCert).toBe(0.05);
  });
  it("L-4359: síntesis del certificado ± 0,06 mm", () => {
    expect(res("L-4359").uCert).toBeCloseTo(caso("L-4359").datos.x_J85, 12);
  });
  it("M-3859: informa la U asignada por clase (hallazgo M5) y la calculada aparte", () => {
    const r = res("M-3859");
    expect(r.uCert).toBe(8);
    expect(r.uMax).toBeCloseTo(2.503, 3);
  });
  it("PT-0090: el LIMS evalúa la conformidad ISO 6789-1 y 10 lbf·ft no cumple (hallazgo PT1)", () => {
    const r = res("PT-0090");
    expect(r.conforme).toBe(false);
    expect(r.puntos.filter((p) => p.conforme === false)).toHaveLength(1);
  });
  it("L-4351: sumar los empalmes en cuadratura baja la U certificada de 3 a 2 mm (hallazgo L17)", () => {
    expect(res("L-4351").uCert).toBe(3);
    expect(res("L-4351", { sqrt: true }).uCert).toBe(2);
  });
  it("ITV02a/g/c usan el motor ITV02; procesos sin caso real no tienen motor", () => {
    expect(motorDeProceso("ITV02g")?.it).toBe("ITV02");
    expect(motorDeProceso("ITV05")).toBeUndefined();
    expect(motorDeProceso("ITM03")).toBeUndefined();
  });
});
