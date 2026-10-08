import { calcularValidez, reglaDeTipoCliente, sumarMeses, soloFecha } from "./validez";

describe("Validez de cotización · IT DCO-PG01-P01-IT02", () => {
  describe("Particulares", () => {
    it("45 días por defecto", () => {
      const r = calcularValidez({ fechaEmision: "2026-03-10", regla: "PARTICULAR" });
      expect(r.validaHasta).toBe("2026-04-24");
      expect(r.dias).toBe(45);
      expect(r.regla).toBe("PARTICULAR");
    });

    it("cruza de año sin problemas", () => {
      expect(calcularValidez({ fechaEmision: "2026-12-20", regla: "PARTICULAR" }).validaHasta).toBe("2027-02-03");
    });

    it("usa el parámetro general si se configura", () => {
      expect(calcularValidez({ fechaEmision: "2026-03-10", regla: "PARTICULAR", diasParticular: 30 }).dias).toBe(30);
    });

    it("la validez propia del laboratorio (LRB/LMT) tiene prioridad", () => {
      const r = calcularValidez({ fechaEmision: "2026-03-10", regla: "PARTICULAR", diasParticular: 45, diasParticularLab: 90 });
      expect(r.dias).toBe(90);
      expect(r.validaHasta).toBe("2026-06-08");
      expect(r.explicacion).toMatch(/laboratorio/);
    });

    it("ignora valores no positivos del laboratorio", () => {
      expect(calcularValidez({ fechaEmision: "2026-03-10", regla: "PARTICULAR", diasParticularLab: 0 }).dias).toBe(45);
    });
  });

  describe("Ejército", () => {
    it("enero–septiembre → 31 de diciembre del mismo año", () => {
      expect(calcularValidez({ fechaEmision: "2026-01-02", regla: "EJERCITO" }).validaHasta).toBe("2026-12-31");
      expect(calcularValidez({ fechaEmision: "2026-09-30", regla: "EJERCITO" }).validaHasta).toBe("2026-12-31");
    });

    it("emitida en octubre → 6 meses", () => {
      const r = calcularValidez({ fechaEmision: "2026-10-01", regla: "EJERCITO" });
      expect(r.validaHasta).toBe("2027-04-01");
      expect(r.explicacion).toMatch(/oct–dic/);
    });

    it("emitida en noviembre y diciembre → 6 meses", () => {
      expect(calcularValidez({ fechaEmision: "2026-11-15", regla: "EJERCITO" }).validaHasta).toBe("2027-05-15");
      expect(calcularValidez({ fechaEmision: "2026-12-31", regla: "EJERCITO" }).validaHasta).toBe("2027-06-30");
    });

    it("31-oct + 6 meses → último día de abril", () => {
      expect(calcularValidez({ fechaEmision: "2026-10-31", regla: "EJERCITO" }).validaHasta).toBe("2027-04-30");
    });

    it("meses oct–dic parametrizables", () => {
      expect(calcularValidez({ fechaEmision: "2026-10-01", regla: "EJERCITO", mesesEjercitoOctDic: 3 }).validaHasta).toBe("2027-01-01");
    });

    it("la validez del laboratorio NO afecta al Ejército", () => {
      expect(calcularValidez({ fechaEmision: "2026-05-01", regla: "EJERCITO", diasParticularLab: 90 }).validaHasta).toBe("2026-12-31");
    });
  });

  describe("regla por tipo de cliente", () => {
    it("lee el valor del parámetro", () => {
      expect(reglaDeTipoCliente("carabineros", "EJERCITO")).toBe("EJERCITO");
      expect(reglaDeTipoCliente("ejercito", "particular")).toBe("PARTICULAR");
    });
    it("sin parámetro: solo ejercito/institucional siguen la regla Ejército", () => {
      expect(reglaDeTipoCliente("ejercito")).toBe("EJERCITO");
      expect(reglaDeTipoCliente("institucional", null)).toBe("EJERCITO");
      expect(reglaDeTipoCliente("prov_ejercito")).toBe("PARTICULAR");
      expect(reglaDeTipoCliente(null)).toBe("PARTICULAR");
    });
  });

  describe("utilidades de fecha", () => {
    it("soloFecha descarta la hora sin corrimiento de zona", () => {
      expect(soloFecha("2026-10-08T23:59:00-03:00").toISOString().slice(0, 10)).toBe("2026-10-08");
    });
    it("sumarMeses ajusta fin de mes", () => {
      expect(sumarMeses(soloFecha("2026-08-31"), 6).toISOString().slice(0, 10)).toBe("2027-02-28");
    });
    it("rechaza fechas inválidas", () => {
      expect(() => calcularValidez({ fechaEmision: "no-es-fecha", regla: "PARTICULAR" })).toThrow();
    });
  });
});
