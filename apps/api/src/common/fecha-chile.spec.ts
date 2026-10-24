import { anioChile, esFechaCalendario, fechaChile, fechaHoraChile, hoyChile } from "./fecha-chile";

describe("Fechas y horas de Chile en documentos (D02-27)", () => {
  it("la hora de una firma es la de Chile, no la del servidor (UTC)", () => {
    // 22-10-2026 08:09 UTC = 05:09 en Chile (UTC−3, horario de verano).
    expect(fechaHoraChile(new Date("2026-10-22T08:09:00Z"))).toBe("22-10-2026 05:09");
    expect(fechaHoraChile("2026-10-22T08:09:00.000Z")).toBe("22-10-2026 05:09");
    // Invierno (UTC−4): 15-07-2026 12:30 UTC = 08:30.
    expect(fechaHoraChile(new Date("2026-07-15T12:30:00Z"))).toBe("15-07-2026 08:30");
  });

  it("cerca de la medianoche la fecha es la de Chile", () => {
    // 23-10-2026 01:30 UTC = 22-10-2026 22:30 en Chile.
    expect(fechaChile(new Date("2026-10-23T01:30:00Z"))).toBe("22-10-2026");
    expect(fechaHoraChile(new Date("2026-10-23T01:30:00Z"))).toBe("22-10-2026 22:30");
    expect(hoyChile(new Date("2026-10-23T01:30:00Z"))).toBe("2026-10-22");
  });

  it("las fechas de calendario (DATE) se muestran tal cual, sin correrlas un día", () => {
    expect(esFechaCalendario(new Date("2026-10-20T00:00:00.000Z"))).toBe(true);
    expect(esFechaCalendario("2026-10-20")).toBe(true);
    expect(esFechaCalendario(new Date("2026-10-20T08:00:00Z"))).toBe(false);
    expect(fechaChile(new Date("2026-10-20T00:00:00.000Z"))).toBe("20-10-2026");
    expect(fechaChile("2026-10-20")).toBe("20-10-2026");
    expect(fechaHoraChile("2026-10-20")).toBe("20-10-2026");
  });

  it("el año de la numeración es el de Chile en Año Nuevo", () => {
    // 01-01-2027 01:00 UTC = 31-12-2026 22:00 en Chile.
    expect(anioChile(new Date("2027-01-01T01:00:00Z"))).toBe(2026);
    expect(anioChile(new Date("2027-01-01T04:00:00Z"))).toBe(2027);
  });

  it("vacío sin valor; un texto que no es fecha se devuelve tal cual", () => {
    expect(fechaChile(null)).toBe("");
    expect(fechaHoraChile(undefined)).toBe("");
    expect(fechaChile("sin fecha")).toBe("sin fecha");
  });
});

describe("instanteFechaIngreso (B-030 · fecha de la OT en el certificado)", () => {
  const { instanteFechaIngreso, fechaChile } = require("./fecha-chile");
  const ahora = new Date("2026-10-23T22:30:00Z"); // 23-10 19:30 en Chile
  it("medianoche UTC de HOY en Chile → el instante actual", () => {
    expect(instanteFechaIngreso("2026-10-23T00:00:00.000Z", ahora)).toBe(ahora);
  });
  it("otro día → 12:00 de Chile de ese día; impreso sigue siendo ese día", () => {
    const d = instanteFechaIngreso("2026-10-20", ahora);
    expect(d.toISOString()).toBe("2026-10-20T15:00:00.000Z");
    expect(fechaChile(d)).toBe("20-10-2026");
  });
  it("un instante con hora se respeta", () => {
    expect(instanteFechaIngreso("2026-10-23T14:05:00Z", ahora).toISOString()).toBe("2026-10-23T14:05:00.000Z");
  });
  it("sin valor → null", () => {
    expect(instanteFechaIngreso(undefined, ahora)).toBeNull();
  });
});
