/**
 * Tests de la lógica pura de laboratorio de `ResultadoService`:
 *   · estadistica()     → promedio, desviación estándar muestral (n−1), CV%
 *   · veredicto()       → Cumple / No cumple / Informativo contra límites
 *   · contextoFormula() → variables reservadas del ensayo (RN1..RNn, PROMEDIO…)
 *
 * Son métodos privados de cálculo (RF-D02.1/A06), la base numérica del resultado
 * que va al certificado. Se acceden por casting sin tocar producción; el servicio
 * se instancia con dependencias falsas porque estos métodos no usan Prisma.
 */
import { BadRequestException } from "@nestjs/common";
import { ResultadoService } from "./laboratorio.module";

/** Instancia con prisma/equipos falsos: la estadística no los toca. */
function svc(): any {
  return new ResultadoService({} as any, {} as any);
}

describe("ResultadoService.estadistica", () => {
  it("una sola réplica: promedio = valor, desviación 0, CV 0 (evita /(n-1) con n=1)", () => {
    const r = svc().estadistica([10]);
    expect(r.promedio).toBe(10);
    expect(r.desviacion).toBe(0);
    expect(r.cv).toBe(0);
  });

  it("calcula el promedio aritmético", () => {
    expect(svc().estadistica([2, 4, 6]).promedio).toBe(4);
  });

  it("usa desviación estándar MUESTRAL (n−1), no poblacional", () => {
    // [2,4,6]: media 4, sumatorio (4+0+4)=8, /(3-1)=4, sqrt=2.
    const r = svc().estadistica([2, 4, 6]);
    expect(r.desviacion).toBeCloseTo(2, 10);
  });

  it("réplicas idénticas → desviación 0 y CV 0", () => {
    const r = svc().estadistica([5, 5, 5, 5]);
    expect(r.desviacion).toBe(0);
    expect(r.cv).toBe(0);
  });

  it("CV = (desviación / |promedio|) × 100", () => {
    const r = svc().estadistica([2, 4, 6]);
    expect(r.cv).toBeCloseTo((2 / 4) * 100, 10); // 50%
  });

  it("promedio 0 → CV 0 sin división por cero (NaN prohibido)", () => {
    const r = svc().estadistica([-1, 0, 1]);
    expect(r.promedio).toBe(0);
    expect(r.cv).toBe(0);
    expect(Number.isNaN(r.cv)).toBe(false);
  });

  it("promedio negativo: CV usa el valor absoluto (siempre ≥ 0)", () => {
    const r = svc().estadistica([-2, -4, -6]);
    expect(r.promedio).toBe(-4);
    expect(r.cv).toBeGreaterThanOrEqual(0);
    expect(r.cv).toBeCloseTo(50, 10);
  });
});

describe("ResultadoService.veredicto", () => {
  const v = (m: number, inf?: number | null, sup?: number | null) => svc().veredicto(m, inf, sup);

  it("dentro de [inf, sup] → Cumple", () => {
    expect(v(5, 0, 10)).toBe("Cumple");
  });
  it("por debajo del límite inferior → No cumple", () => {
    expect(v(-1, 0, 10)).toBe("No cumple");
  });
  it("por encima del límite superior → No cumple", () => {
    expect(v(11, 0, 10)).toBe("No cumple");
  });
  it("sin ningún límite definido → Informativo", () => {
    expect(v(5, null, null)).toBe("Informativo");
    expect(v(5)).toBe("Informativo");
  });
  it("solo límite inferior: cumple si m ≥ inf", () => {
    expect(v(5, 3, null)).toBe("Cumple");
    expect(v(2, 3, null)).toBe("No cumple");
  });
  it("solo límite superior: cumple si m ≤ sup", () => {
    expect(v(5, null, 8)).toBe("Cumple");
    expect(v(9, null, 8)).toBe("No cumple");
  });
  it("en el borde exacto del límite → Cumple (no es 'fuera')", () => {
    expect(v(0, 0, 10)).toBe("Cumple");
    expect(v(10, 0, 10)).toBe("Cumple");
  });
});

describe("ResultadoService.contextoFormula", () => {
  const st = { promedio: 4, desviacion: 2, cv: 50 };

  it("expone RN1..RNn, REPLICAS, PROMEDIO, DE, CV y N", () => {
    const ctx = svc().contextoFormula([2, 4, 6], st);
    expect(ctx.REPLICAS).toEqual([2, 4, 6]);
    expect(ctx.PROMEDIO).toBe(4);
    expect(ctx.DE).toBe(2);
    expect(ctx.CV).toBe(50);
    expect(ctx.N).toBe(3);
    expect(ctx.RN1).toBe(2);
    expect(ctx.RN2).toBe(4);
    expect(ctx.RN3).toBe(6);
  });

  it("admite variables extra del ensayo (masa, volumen…)", () => {
    const ctx = svc().contextoFormula([1, 2], st, { masa: 10, volumen: 5 });
    expect(ctx.masa).toBe(10);
    expect(ctx.volumen).toBe(5);
  });

  it("RECHAZA una variable extra que pisa una reservada (PROMEDIO)", () => {
    expect(() => svc().contextoFormula([1, 2], st, { PROMEDIO: 99 })).toThrow(BadRequestException);
  });

  it("el rechazo de reservadas es case-insensitive (promedio, rn1…)", () => {
    expect(() => svc().contextoFormula([1, 2], st, { promedio: 1 })).toThrow(BadRequestException);
    expect(() => svc().contextoFormula([1, 2], st, { rn1: 1 })).toThrow(BadRequestException);
    expect(() => svc().contextoFormula([1, 2], st, { n: 1 })).toThrow(BadRequestException);
  });

  it("sin extras no lanza y devuelve solo las reservadas", () => {
    expect(() => svc().contextoFormula([1], { promedio: 1, desviacion: 0, cv: 0 })).not.toThrow();
  });
});
