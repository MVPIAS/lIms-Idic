/**
 * Correcciones v4 (recorrido de manuales 12-11-2026), frente fx5-d · Metrología.
 */
import { coeficientesSmpEditados, normalizarLaboratorios } from "./metrologia.reglas";
import { motivoAutoRevision, motivoFechaFutura, motivoReemplazado, motivoRechazo, type ContextoCal } from "./metrologia.flujo";
import { conUnidadIndicador, laboratoriosDe, patronDelLaboratorio } from "../../../web/lib/metrologiaFicha";
import { textoReemision } from "../../../web/lib/metrologia";
import { coeficientesSmp, smpPorFuerza } from "./hoja-lnf.reglas";

describe("F051/F053 · laboratorios de patrones y auxiliares", () => {
  it("normaliza la lista: mayúsculas, sin repetidos ni códigos inválidos", () => {
    expect(normalizarLaboratorios(["lnf", "LMT", "LNF", "", null, "x"])).toEqual(["LNF", "LMT"]);
    expect(normalizarLaboratorios(null)).toEqual([]);
  });
  it("datos antiguos: el laboratorio único vale como lista", () => {
    expect(laboratoriosDe({ laboratorio: "LMT" })).toEqual(["LMT"]);
    expect(laboratoriosDe({ laboratorios: ["LMT", "LNF"], laboratorio: "LMT" })).toEqual(["LMT", "LNF"]);
    expect(laboratoriosDe({ laboratorios: [], laboratorio: null })).toEqual([]);
  });
  it("un termohigrómetro compartido aparece en LMT, LMTE y LNF; uno del LMT, solo en el LMT", () => {
    const compartido = { laboratorios: ["LMT", "LMTE", "LNF"] };
    for (const lab of ["LMT", "LMTE", "LNF"]) expect(patronDelLaboratorio(compartido, lab)).toBe(true);
    expect(patronDelLaboratorio({ laboratorio: "LMT" }, "LNF")).toBe(false);
    expect(patronDelLaboratorio({ laboratorios: ["LNF"] }, "lnf")).toBe(true);
    // Sin laboratorio: común a todos; sin laboratorio de la calibración: todo el maestro.
    expect(patronDelLaboratorio({}, "LNF")).toBe(true);
    expect(patronDelLaboratorio({ laboratorio: "LMT" }, "")).toBe(true);
  });
  it("coeficientes SMP editados: los tres o ninguno", () => {
    expect(coeficientesSmpEditados({ a: 7.72925e-4, b: -1.08e-9, c: -2.63e-14 })).toEqual({ a: 7.72925e-4, b: -1.08e-9, c: -2.63e-14 });
    expect(coeficientesSmpEditados({ a: null, b: null, c: null })).toBeNull();
    expect(coeficientesSmpEditados(null)).toBeNull();
    expect(coeficientesSmpEditados({ a: 1, b: null, c: 0 })).toEqual({ error: expect.stringContaining("tres coeficientes") });
    expect(coeficientesSmpEditados({ a: 0, b: 0, c: 0 })).toEqual({ error: expect.stringContaining("cero") });
  });
  it("los coeficientes cargados del HBM 3000 kN KD/3MN reproducen la columna SMP de LCPNF-010.26", () => {
    const k = coeficientesSmp({ a: 7.72925e-4, b: -1.08e-9, c: -2.63e-14 });
    // Valores de la pestaña TID (ascendente); la hoja los muestra con 10 cifras significativas.
    expect(smpPorFuerza(k, 250)).toBeCloseTo(0.1931633390625, 9);
    expect(smpPorFuerza(k, 1000)).toBeCloseTo(0.7718187, 9);
    expect(smpPorFuerza(k, 2500)).toBeCloseTo(1.9251515625, 8);
  });
});

describe("F052 · unidad de la resolución en la hoja del LNF", () => {
  it("se agrega a los datos de un ejemplo o borrador que no la traen", () => {
    expect(conUnidadIndicador({ resInd: 1e-5 }, true)).toEqual({ resInd: 1e-5, uRes: "mV/V" });
    expect(conUnidadIndicador({ uRes: "V/V" }, true)).toEqual({ uRes: "V/V" });
    expect(conUnidadIndicador({ uRes: null }, true)).toEqual({ uRes: "mV/V" });
  });
  it("no toca otras hojas ni datos vacíos", () => {
    expect(conUnidadIndicador({ resInd: 1 }, false)).toEqual({ resInd: 1 });
    expect(conUnidadIndicador(null, true)).toBeNull();
  });
});

describe("F054 · verificación de un certificado reemplazado", () => {
  it("nombra el que lo reemplazó y el vigente si hubo una segunda reemisión", () => {
    expect(motivoReemplazado([{ numero: "M-3951-V2", estado: "reemplazada" }, { numero: "M-3952", estado: "emitida" }]))
      .toBe("El certificado fue reemplazado por el N° M-3951-V2, que a su vez fue reemplazado; el certificado vigente es el N° M-3952.");
  });
  it("un solo reemplazo: su número", () => {
    expect(motivoReemplazado([{ numero: "M-3952", estado: "emitida" }])).toBe("El certificado fue reemplazado por el N° M-3952.");
  });
  it("nunca «(en emisión)»", () => {
    expect(motivoReemplazado([])).not.toMatch(/en emisión/);
  });
});

describe("F055 · separación de funciones en la reemisión", () => {
  const firmas = [{ orden: 0, usuarioId: "jefe", accion: "ELABORA" }];
  it("quien elaboró la modificación o el reemplazo no aprueba su revisión", () => {
    expect(motivoAutoRevision({ esReemision: true, usuarioId: "jefe", firmas })).toMatch(/separación de funciones/);
    expect(motivoAutoRevision({ esReemision: true, usuarioId: "subrogante", firmas })).toBeNull();
  });
  it("no aplica a una calibración normal", () => {
    expect(motivoAutoRevision({ esReemision: false, usuarioId: "jefe", firmas })).toBeNull();
  });
  it("bloquea Firmar y Emitir pero deja Devolver", () => {
    const c: ContextoCal = {
      estado: "en_revision", esAutor: true, puedeCrear: true, puedeEmitir: true, calculada: true, responsablePaso: true, ultimoPaso: false,
      autoRevision: motivoAutoRevision({ esReemision: true, usuarioId: "jefe", firmas }),
    };
    expect(motivoRechazo("FIRMAR", c)).toMatch(/separación de funciones/);
    expect(motivoRechazo("EMITIR", { ...c, ultimoPaso: true })).toMatch(/separación de funciones/);
    expect(motivoRechazo("DEVOLVER", c)).toBeNull();
  });
});

describe("F056 · fecha de calibración futura (hora de Chile)", () => {
  // 12-11-2026 01:30 UTC = 11-11-2026 22:30 en Chile (UTC−3).
  const hoy = new Date("2026-11-12T01:30:00Z");
  it("rechaza mañana en Chile aunque en UTC ya sea ese día", () => {
    expect(motivoFechaFutura("2026-11-12", hoy)).toBe("La fecha de calibración (12-11-2026) no puede ser posterior a hoy (11-11-2026, hora de Chile).");
  });
  it("acepta hoy y fechas pasadas", () => {
    expect(motivoFechaFutura("2026-11-11", hoy)).toBeNull();
    expect(motivoFechaFutura("2026-10-01", hoy)).toBeNull();
    expect(motivoFechaFutura(null, hoy)).toBeNull();
  });
});

describe("F058 · textos del borrador de reemisión", () => {
  it("la modificación dice que modifica; el reemplazo, que reemplaza", () => {
    expect(textoReemision("M-3951", "modificacion").aviso).toMatch(/^Modificación: .*modifica el certificado N° M-3951/);
    expect(textoReemision("M-3951", "modificacion").presentacion).toBe("Modifica el certificado N° M-3951 (modificación en el LIMS).");
    expect(textoReemision("M-3951", "reemplazo").aviso).toMatch(/^Reemplazo: este certificado reemplazará al N° M-3951/);
    expect(textoReemision("M-3951", null).presentacion).toMatch(/^Reemplaza al certificado N° M-3951/);
  });
});
