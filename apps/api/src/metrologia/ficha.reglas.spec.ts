import {
  CONFIG_FICHA_DEFECTO, condicionesCorregidas, configFicha, convertirRango, errorNormalizado, puntosFueraDeRango, uInformada, type Auxiliar, type PatronRango,
} from "./ficha.reglas";
import { defConfigurable, normalizarValor } from "../catalogo/parametro-configurable";

describe("Parámetros de la ficha (metrologia_ficha)", () => {
  it("sin filas rigen los valores por defecto (por confirmar con el IDIC)", () => {
    expect(configFicha([])).toEqual(CONFIG_FICHA_DEFECTO);
    expect(CONFIG_FICHA_DEFECTO).toEqual({ criterioEn: "<=1", fueraRango: "bloquear", notificarEmision: true, actualizarEquipo: "emitir", noAptoExigeDocumento: false });
  });

  it("cada lector entiende lo que guarda la pantalla «Parámetros de la operación»", () => {
    const fila = (codigo: string, v: unknown) => {
      const r = normalizarValor(defConfigurable("metrologia_ficha", codigo)!, { codigo, etiqueta: codigo }, v);
      expect(r.errores).toEqual([]);
      return { codigo, valor: (r.valor as any).valor as string, activo: (r.valor as any).activo as boolean };
    };
    const c = configFicha([fila("criterio_en", "<1"), fila("patron_fuera_rango", "avisar"), fila("notificar_emision", false), fila("actualizar_equipo", "entregar"), fila("no_apto_exige_documento", true)]);
    expect(c).toEqual({ criterioEn: "<1", fueraRango: "avisar", notificarEmision: false, actualizarEquipo: "entregar", noAptoExigeDocumento: true });
    expect(configFicha([fila("actualizar_equipo", "no")]).actualizarEquipo).toBe("no");
  });

  it("una fila inactiva o con un valor que no se entiende deja el valor por defecto", () => {
    expect(configFicha([{ codigo: "criterio_en", valor: "<1", activo: false }]).criterioEn).toBe("<=1");
    expect(configFicha([{ codigo: "patron_fuera_rango", valor: "quizá", activo: true }]).fueraRango).toBe("bloquear");
    expect(configFicha([{ codigo: "criterio_en", valor: "≤ 1", activo: true }]).criterioEn).toBe("<=1");
  });

  it("la pantalla rechaza opciones que no existen", () => {
    const r = normalizarValor(defConfigurable("metrologia_ficha", "criterio_en")!, { codigo: "criterio_en", etiqueta: "x" }, "<2");
    expect(r.errores.length).toBeGreaterThan(0);
  });
});

describe("Error normalizado frente a la calibración anterior (P5.3)", () => {
  const act = [{ nominal: 10, error: 0.02, uCertificado: 0.03 }, { nominal: 20, error: 0.05, U: 0.04 }, { nominal: 30, error: 0.1, U: 0.05 }];
  const ant = [{ nominal: 10, error: 0.01, uCertificado: 0.04 }, { nominal: 20, error: -0.01, Ucert: 0.03 }];

  it("Eₙ = |E − E_ant| / √(U² + U_ant²) con la U informada en el certificado", () => {
    const f = errorNormalizado(act, ant, "<=1");
    expect(f[0].en).toBeCloseTo(0.01 / 0.05, 12);
    expect(f[0].criterio).toBe("compatible");
    expect(f[1].en).toBeCloseTo(0.06 / 0.05, 12);
    expect(f[1].criterio).toBe("revisar");
    expect(f[2]).toMatchObject({ en: null, criterio: "sin_punto_anterior" });
  });

  it("el criterio es el del parámetro: Eₙ = 1 es compatible con ≤ 1 y no con < 1", () => {
    const a = [{ nominal: 5, error: 0.05, U: 0.03 }], b = [{ nominal: 5, error: 0, U: 0.04 }];
    expect(errorNormalizado(a, b, "<=1")[0].criterio).toBe("compatible");
    expect(errorNormalizado(a, b, "<1")[0].criterio).toBe("revisar");
  });

  it("sin error o sin U no se calcula; los puntos se emparejan por nominal y unidad", () => {
    expect(errorNormalizado([{ nominal: 1, error: null, U: 1 }], [{ nominal: 1, error: 0, U: 1 }], "<=1")[0].criterio).toBe("sin_datos");
    expect(errorNormalizado([{ nominal: 1, error: 0.1, U: 1, unidad: "V" }], [{ nominal: 1, error: 0, U: 1, unidad: "A" }], "<=1")[0].criterio).toBe("sin_punto_anterior");
    expect(uInformada({ nominal: 1, error: 0, U: 0.2, Ucert: 0.3, uCertificado: 0.4 })).toBe(0.4);
  });
});

describe("Condiciones ambientales corregidas con el certificado del auxiliar (P3.4, R15 T1)", () => {
  const th: Auxiliar = { id: "1", codigo: "PM-48", correcciones: { temp: { error: -0.2, U: 0.6 }, hum: { error: 1.3, U: 2.5 } } };
  const ba: Auxiliar = { id: "2", codigo: "PM-49", correcciones: { pres: { error: -1.2, U: 0.2 } } };

  it("la corrección SIEMPRE se resta: corregido = promedio − error del certificado", () => {
    const c = condicionesCorregidas({ temp: [18.9, 19.1], hum: [59.4, 59.0], pres: [953.5, 953.3] }, th, ba);
    expect(c.temp).toMatchObject({ promedio: 19, corregido: 19.2, U: 0.6 });
    expect(c.hum).toMatchObject({ corregido: 57.9, U: 2.5 });
    expect(c.pres).toMatchObject({ corregido: 954.6, U: 0.2 });
    expect(c.avisos).toEqual([]);
  });

  it("sin auxiliar o sin el error en el maestro se informa la lectura sin corregir, con aviso", () => {
    const c = condicionesCorregidas({ temp: [20, 21], pres: [950] }, { id: "x", codigo: "PM-99", correcciones: null }, null);
    expect(c.temp?.corregido).toBe(20.5);
    expect(c.pres?.corregido).toBe(950);
    expect(c.hum).toBeNull();
    expect(c.avisos.join(" ")).toMatch(/PM-99.*sin corregir/);
    expect(c.avisos.join(" ")).toMatch(/Presión: sin equipo auxiliar/);
  });
});

describe("Patrón fuera de su rango calibrado (P4.2, R15 P6)", () => {
  const pat = (codigo: string, min: number | null, max: number | null, unidad: string | null, magnitud = "presion"): PatronRango =>
    ({ id: codigo, codigo, magnitud, tipo: "patron", rangoMin: min, rangoMax: max, unidadRango: unidad });

  it("un punto está cubierto si cae en el rango de al menos un patrón de la magnitud (con conversión de unidades)", () => {
    const r = puntosFueraDeRango([{ nominal: 0.5 }, { nominal: 4 }, { nominal: 12 }], "bar", "presion", [pat("PT-01", 0, 0.7, "MPa")]);
    expect(r.controlado).toBe(true);
    expect(r.fuera.map((f) => f.nominal)).toEqual([12]);
    expect(r.fuera[0].motivo).toMatch(/12 bar está fuera del rango calibrado de PT-01 \(0 a 0,7 MPa\)/);
    expect(puntosFueraDeRango([{ nominal: 12 }], "bar", "presion", [pat("A", 0, 0.7, "MPa"), pat("B", 0.5, 2, "MPa")]).fuera).toEqual([]);
  });

  it("sin rango numérico en el maestro (o de otra magnitud, o auxiliar) no se controla", () => {
    expect(puntosFueraDeRango([{ nominal: 99 }], "bar", "presion", [pat("A", null, null, null)])).toEqual({ fuera: [], controlado: false });
    expect(puntosFueraDeRango([{ nominal: 99 }], "bar", "presion", [pat("A", 0, 1, "MPa", "masa")]).controlado).toBe(false);
    expect(puntosFueraDeRango([{ nominal: 99 }], "bar", "presion", [{ ...pat("A", 0, 1, "MPa"), tipo: "auxiliar" }]).controlado).toBe(false);
  });

  it("unidades que no se pueden comparar no bloquean ese punto", () => {
    expect(puntosFueraDeRango([{ nominal: 5, unidad: "V" }], "", "general", [pat("A", 0, 1, "MPa", "general")]).fuera).toEqual([]);
  });

  it("conversión para rangos: presión, par y la de la CMC", () => {
    expect(convertirRango(10, "bar", "MPa")).toBeCloseTo(1, 12);
    expect(convertirRango(100, "lbf·ft", "N·m")).toBeCloseTo(135.58179483314, 9);
    expect(convertirRango(2, "kN", "N")).toBeCloseTo(2000, 9);
    expect(convertirRango(1, "V", "MPa")).toBeNull();
  });
});
