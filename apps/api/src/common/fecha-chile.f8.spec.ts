/**
 * Frente f8 · zona horaria (America/Santiago) con el reloj FIJADO.
 *
 * Instantes de prueba (verano = UTC−3 desde el 06-09-2026; invierno = UTC−4):
 *   V2130  26-10-2026 21:30 Chile = 27-10 00:30 UTC   (D04-33 y orden interna)
 *   V2359  26-10-2026 23:59 Chile = 27-10 02:59 UTC
 *   I2030  15-07-2026 20:30 Chile = 16-07 00:30 UTC   (en invierno el corte es a las 20:00)
 *   I2130  15-07-2026 21:30 Chile = 16-07 01:30 UTC
 *   I2359  15-07-2026 23:59 Chile = 16-07 03:59 UTC
 *   AN     31-12-2026 23:59 Chile = 01-01-2027 02:59 UTC (fin de año)
 * Cada caso se repite con la zona del PROCESO en UTC, Asia/Tokyo y America/Santiago:
 * el resultado no puede depender de `TZ`.
 */
import {
  anioChile,
  diaChile,
  diaInstanteChile,
  fechaChile,
  fechaHoraChile,
  hoyChile,
  hoyFechaChile,
  inicioDiaChile,
  mesChile,
  sumarDiasCalendario,
  urlConZona,
  zonaHoraria,
  SQL_HOY,
  ZONA_CHILE,
} from "./fecha-chile";
import { erroresEmision } from "../flujo-real/orden-interna.reglas";
import { fechaCompromisoDesdePlazo, semaforoPlazo, diaDe } from "../ot/plazos";
import { estaVencida, hoyEnChile, soloFecha } from "../cotizacion/validez";
import { ncVencida } from "../auditoria/no-conformidad.reglas";
import { retenerHasta } from "../recepcion/reglas-recepcion";
import { fechaEntrega } from "../metrologia/metrologia-ot.controller";
import { motivoEntrega } from "../metrologia/metrologia-ot.reglas";
import { periodoDe } from "../plantilla-render/numeracion";
import { finDelDia, inicioDelDia } from "../auditoria/filtro-auditoria";
import { fmtFecha, fmtFechaHora } from "../plantilla-render/html.util";
// La regla equivalente de la web (lib/fecha-chile.ts y lib/format.ts).
import * as web from "../../../web/lib/fecha-chile";
import { fechaDia, fecha as fechaWeb, hoyISO } from "../../../web/lib/format";

const V2130 = new Date("2026-10-27T00:30:00Z");
const V2359 = new Date("2026-10-27T02:59:00Z");
const I2030 = new Date("2026-07-16T00:30:00Z");
const I2130 = new Date("2026-07-16T01:30:00Z");
const I2359 = new Date("2026-07-16T03:59:00Z");
const AN = new Date("2027-01-01T02:59:00Z");

const ZONAS_PROCESO = ["UTC", "Asia/Tokyo", "America/Santiago"];
const tzOriginal = process.env.TZ;
afterAll(() => {
  if (tzOriginal === undefined) delete process.env.TZ;
  else process.env.TZ = tzOriginal;
  jest.useRealTimers();
});

describe.each(ZONAS_PROCESO)("zona del proceso %s", (tz) => {
  beforeAll(() => {
    process.env.TZ = tz;
  });
  afterEach(() => jest.useRealTimers());

  it("la zona por defecto es America/Santiago", () => {
    expect(ZONA_CHILE).toBe("America/Santiago");
    expect(web.ZONA_CHILE).toBe("America/Santiago");
  });

  it("«hoy» es el día de Chile a las 21:30 y 23:59, en verano y en invierno", () => {
    for (const [ahora, dia] of [
      [V2130, "2026-10-26"],
      [V2359, "2026-10-26"],
      [I2030, "2026-07-15"],
      [I2130, "2026-07-15"],
      [I2359, "2026-07-15"],
      [AN, "2026-12-31"],
    ] as const) {
      expect(hoyChile(ahora)).toBe(dia);
      expect(web.hoyChile(ahora)).toBe(dia);
      expect(diaInstanteChile(ahora)).toBe(dia);
      expect(diaChile(ahora)).toBe(dia);
      expect(web.diaChile(ahora.toISOString())).toBe(dia);
    }
  });

  it("con el reloj del sistema fijado, las funciones sin argumento usan ese instante", () => {
    jest.useFakeTimers({ now: V2130 });
    expect(hoyChile()).toBe("2026-10-26");
    expect(web.hoyChile()).toBe("2026-10-26");
    expect(hoyISO()).toBe("2026-10-26");
    expect(web.ahoraInputChile()).toBe("2026-10-26T21:30");
    expect(web.horaChile()).toBe(21);
    jest.setSystemTime(AN);
    expect(anioChile()).toBe(2026);
    expect(web.anioChile()).toBe(2026);
    expect(mesChile()).toBe("2026-12");
    expect(web.mesChile()).toBe("2026-12");
  });

  it("fin de año: la numeración del 31-12 a las 23:59 sigue en el año que termina", () => {
    expect(anioChile(AN)).toBe(2026);
    expect(periodoDe({ reinicio: "anual" } as any, AN)).toBe(2026);
    expect(anioChile(new Date("2027-01-01T03:00:00Z"))).toBe(2027);
    expect(fechaHoraChile(AN)).toBe("31-12-2026 23:59");
  });

  it("D04-33 · una entrega a las 21:30 de Chile se ve el 26-10 en todas las pantallas", () => {
    const entregadoAt = fechaEntrega("2026-10-26", V2130); // hoy en Chile → el instante actual
    expect(entregadoAt).toBe(V2130);
    const iso = entregadoAt.toISOString(); // así lo devuelve la API: «2026-10-27T00:30:00.000Z»
    expect(fechaDia(iso)).toBe("26-10-2026"); // pestaña Instrumentos e «Informe y cierre»
    expect(fechaWeb(iso)).toBe("26-10-2026"); // tabla «Documentos de Metrología»
    expect(fmtFecha(iso)).toBe("26-10-2026"); // PDF y documentos
    expect(fmtFechaHora(iso)).toBe("26-10-2026 21:30");
    // Las fechas de calendario (DATE) siguen tal cual.
    expect(fechaDia("2026-10-26T00:00:00.000Z")).toBe("26-10-2026");
    expect(fechaDia("2026-10-26")).toBe("26-10-2026");
    // La regla de la entrega acepta la fecha de hoy en Chile y no la da por futura.
    const cal = { estado: "emitida", codigo: "CAL-1", numeroCertificado: "ME-001.26", emitidoAt: new Date("2026-10-27T00:10:00Z"), entregadoAt: null };
    expect(motivoEntrega(cal, entregadoAt, V2130)).toBeNull();
  });

  it("orden interna · creada después de las 21:00 con la fecha de hoy en Chile no se rechaza", () => {
    const base = { muestraId: "m", muestraDeLaOt: true, requisito: "Cr total ≤ 3 %" };
    for (const [ahora, aperturaOt] of [
      [V2130, new Date("2026-10-27T00:15:00Z")], // OT abierta a las 21:15 de Chile (verano)
      [V2359, new Date("2026-10-27T02:50:00Z")],
      [I2130, new Date("2026-07-16T01:00:00Z")], // invierno: 21:00 de Chile
      [I2030, new Date("2026-07-16T00:10:00Z")], // invierno: 20:10 de Chile (ya es mañana en UTC)
    ] as const) {
      const hoy = hoyChile(ahora);
      expect(erroresEmision({ ...base, fechaEnvio: hoy, fechaOt: aperturaOt, hoy: ahora })).toEqual([]);
      // El día anterior sí es anterior a la apertura.
      expect(erroresEmision({ ...base, fechaEnvio: sumarDiasCalendario(hoy, -1), fechaOt: aperturaOt, hoy: ahora }).join(" ")).toMatch(/anterior a la apertura/);
      // 60 días se cuentan desde hoy en Chile.
      expect(erroresEmision({ ...base, fechaEnvio: sumarDiasCalendario(hoy, 60), fechaOt: aperturaOt, hoy: ahora })).toEqual([]);
      expect(erroresEmision({ ...base, fechaEnvio: sumarDiasCalendario(hoy, 61), fechaOt: aperturaOt, hoy: ahora }).join(" ")).toMatch(/60 días/);
    }
  });

  it("plazos · «vence hoy» hasta las 23:59 de Chile y vencida a las 00:01", () => {
    expect(semaforoPlazo("2026-10-26", "en_proceso", V2359)).toEqual({ semaforo: "por_vencer", diasRestantes: 0 });
    expect(semaforoPlazo(new Date("2026-10-26T00:00:00Z"), "en_proceso", V2359)).toEqual({ semaforo: "por_vencer", diasRestantes: 0 });
    expect(semaforoPlazo("2026-10-26", "en_proceso", new Date("2026-10-27T03:01:00Z"))).toEqual({ semaforo: "vencida", diasRestantes: -1 });
    expect(semaforoPlazo("2026-07-15", "en_proceso", I2359).semaforo).toBe("por_vencer");
  });

  it("plazos · la fecha de compromiso cuenta desde el día de recepción en Chile", () => {
    // Recepción a las 21:30 de Chile (Date o ISO): +10 días corridos desde el 26-10.
    expect(fechaCompromisoDesdePlazo(V2130, 10)).toBe("2026-11-05");
    expect(fechaCompromisoDesdePlazo(V2130.toISOString(), 10)).toBe("2026-11-05");
    expect(fechaCompromisoDesdePlazo(null, 10, I2130)).toBe("2026-07-25");
    expect(diaDe(V2130)).toBe("2026-10-26");
    expect(diaDe(new Date("2026-10-26T00:00:00Z"))).toBe("2026-10-26");
  });

  it("cotización · validez y «hoy» comercial en Chile", () => {
    expect(hoyEnChile(V2359).toISOString().slice(0, 10)).toBe("2026-10-26");
    expect(estaVencida("2026-10-26", hoyEnChile(V2359))).toBe(false);
    expect(estaVencida("2026-10-25", hoyEnChile(V2359))).toBe(true);
    // Un instante de emisión toma su día en Chile; un DATE, su día.
    expect(soloFecha(V2130).toISOString().slice(0, 10)).toBe("2026-10-26");
    expect(soloFecha(new Date("2026-10-26T00:00:00Z")).toISOString().slice(0, 10)).toBe("2026-10-26");
  });

  it("no conformidad · el plazo de hoy no vence a las 23:59 de Chile", () => {
    expect(ncVencida({ estado: "abierta", plazoCierre: "2026-10-26" }, V2359)).toBe(false);
    expect(ncVencida({ estado: "abierta", plazoCierre: new Date("2026-10-26T00:00:00Z") }, V2359)).toBe(false);
    expect(ncVencida({ estado: "abierta", plazoCierre: "2026-10-25" }, V2359)).toBe(true);
  });

  it("custodia · la retención cuenta desde el día de recepción en Chile", () => {
    expect(retenerHasta("testigo", V2130, { testigo: 6 })).toBe("2027-04-26");
    expect(retenerHasta("testigo", I2130, { testigo: 1 })).toBe("2026-08-15");
  });

  it("factura · la fecha de emisión por defecto es hoy en Chile (columna DATE)", () => {
    expect(hoyFechaChile(V2130).toISOString()).toBe("2026-10-26T00:00:00.000Z");
    expect(hoyFechaChile(AN).toISOString()).toBe("2026-12-31T00:00:00.000Z");
  });

  it("bitácora · «desde» y «hasta» con fecha cubren el día de Chile", () => {
    expect(inicioDelDia("2026-10-26").toISOString()).toBe("2026-10-26T03:00:00.000Z");
    expect(finDelDia("2026-10-26").getTime()).toBeGreaterThan(V2359.getTime());
    expect(inicioDiaChile("2026-07-15")!.toISOString()).toBe("2026-07-15T04:00:00.000Z");
    expect(finDelDia("2026-07-15").getTime()).toBeGreaterThan(I2359.getTime());
  });

  it("documentos · fecha de emisión y fecha con hora en Chile", () => {
    expect(fechaChile(V2130)).toBe("26-10-2026");
    expect(fechaHoraChile(I2130)).toBe("15-07-2026 21:30");
    expect(fechaChile("2026-10-26")).toBe("26-10-2026");
  });
});

describe("configuración de la zona", () => {
  it("ZONA_HORARIA válida se usa; una no válida cae en America/Santiago", () => {
    expect(zonaHoraria({ ZONA_HORARIA: "America/Punta_Arenas" })).toBe("America/Punta_Arenas");
    expect(zonaHoraria({ ZONA_HORARIA: "Marte/Olimpo" })).toBe("America/Santiago");
    expect(zonaHoraria({ ZONA_HORARIA: "America/Santiago'; DROP TABLE x;--" })).toBe("America/Santiago");
    expect(zonaHoraria({})).toBe("America/Santiago");
  });

  it("la sesión de base de datos de la API se abre en la zona del IDIC", () => {
    expect(urlConZona("postgresql://u:p@h:5432/db")).toBe("postgresql://u:p@h:5432/db?options=-c%20TimeZone%3DAmerica%2FSantiago");
    expect(urlConZona("postgresql://u:p@h:5432/db?schema=public")).toBe("postgresql://u:p@h:5432/db?schema=public&options=-c%20TimeZone%3DAmerica%2FSantiago");
    // Si ya trae `options`, se respeta.
    expect(urlConZona("postgresql://h/db?options=-c%20TimeZone%3DUTC")).toBe("postgresql://h/db?options=-c%20TimeZone%3DUTC");
    expect(urlConZona(undefined)).toBeUndefined();
  });

  it("el «hoy» de SQL es el de la zona del IDIC", () => {
    expect(SQL_HOY).toBe("(now() AT TIME ZONE 'America/Santiago')::date");
  });

  it("aritmética de calendario sin zona", () => {
    expect(sumarDiasCalendario("2026-12-31", 1)).toBe("2027-01-01");
    expect(web.sumarDiasCalendario("2026-03-01", -1)).toBe("2026-02-28");
  });
});
