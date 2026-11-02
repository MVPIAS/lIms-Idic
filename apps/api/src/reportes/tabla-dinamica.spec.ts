import { claveGrupo, numero, tablaDinamica } from "./tabla-dinamica";

const filas = [
  { lab: "LQC", estado: "abierta", total: 100, fecha: new Date("2026-10-01T15:00:00Z") },
  { lab: "LQC", estado: "cerrada", total: "50.5" },
  { lab: "LMB", estado: "abierta", total: 30 },
  { lab: null, estado: "abierta", total: null },
];

describe("tabla dinámica del Excel (§4.6.7)", () => {
  it("conteo por un campo, en orden alfabético, con total y grupo «(vacío)»", () => {
    const t = tablaDinamica(filas, { filas: "lab" });
    expect(t.matriz).toEqual([["lab", "Cantidad"], ["(vacío)", 1], ["LMB", 1], ["LQC", 2], ["Total", 4]]);
    expect(t.grupos).toBe(3);
    expect(t.series).toBe(1);
  });
  it("cruce filas × columnas con suma (texto numérico incluido) y totales", () => {
    const t = tablaDinamica(filas, { filas: "lab", columnas: "estado", valor: "total", agregado: "suma" });
    expect(t.matriz[0]).toEqual(["lab \\ estado", "abierta", "cerrada", "Total"]);
    expect(t.matriz.find((f) => f[0] === "LQC")).toEqual(["LQC", 100, 50.5, 150.5]);
    expect(t.matriz.find((f) => f[0] === "LMB")).toEqual(["LMB", 30, null, 30]);
    expect(t.matriz.at(-1)).toEqual(["Total", 130, 50.5, 180.5]);
    expect(t.series).toBe(2);
  });
  it("promedio, mínimo y máximo ignoran los vacíos", () => {
    expect(tablaDinamica(filas, { filas: "estado", valor: "total", agregado: "promedio" }).matriz.at(-1)).toEqual(["Total", 60.166667]);
    expect(tablaDinamica(filas, { filas: "estado", valor: "total", agregado: "minimo" }).matriz[1]).toEqual(["abierta", 30]);
    expect(tablaDinamica(filas, { filas: "estado", valor: "total", agregado: "maximo" }).matriz[1]).toEqual(["abierta", 100]);
  });
  it("un agregado numérico sin campo de valor es un error", () => {
    expect(() => tablaDinamica(filas, { filas: "lab", agregado: "suma" })).toThrow();
  });
  it("las fechas se agrupan por día y los decimales se leen como número", () => {
    expect(claveGrupo(new Date("2026-10-01T15:00:00Z"))).toBe("2026-10-01");
    expect(claveGrupo("2026-10-02T03:00:00.000Z")).toBe("2026-10-02");
    expect(numero({ toString: () => "12.5" })).toBe(12.5);
    expect(numero("abc")).toBeNull();
    expect(numero(BigInt(7))).toBe(7);
  });
});
