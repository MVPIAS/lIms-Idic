import {
  DIAS_CIERRE_DEFECTO,
  configCierreOt,
  esEtapaCierre,
  faltantesCierreIncumplimiento,
  faltantesEtapaCierre,
  faltantesPlanillaCostos,
  faltantesTresCierres,
  laboratorioEn,
  listaLaboratorios,
  plazoCierre,
} from "./reglas-cierre-q4";
import { cuentasResultados } from "./cierre-q4.datos";
import { diasHabilesEntre, sumarDiasHabiles } from "../common/dias-habiles";
import { faltantesParaEmitir } from "../plantilla-render/reglas-emision";
import { faltantesParaCerrar } from "./plazos";
import { armarInforme, filaInspeccion, type ResultadoParaInforme } from "../plantilla-render/filas-informe";
import { configPorTipo } from "../plantilla-render/config-informe";
import { tablaInspeccion } from "../plantilla-render/template.engine";
import { lineasNoEjecutados } from "../facturacion/reglas-factura";
import { motivoEdicionManual, motivoNoCapturable, motivoNoQuitable } from "../laboratorio/flujo-resultado";
import { validarTransicion } from "../common/estados";

describe("cierre de la OT · lote 4 · parámetros", () => {
  it("sin filas: valores provisionales por defecto (BPCH, LQC, sin exigir los tres cierres, 10 días)", () => {
    const c = configCierreOt([]);
    expect(laboratorioEn(c.incumplimientoLabs, "SSTGO")).toBe(true);
    expect(laboratorioEn(c.incumplimientoLabs, "BPCH")).toBe(true);
    expect(laboratorioEn(c.incumplimientoLabs, "D11")).toBe(false);
    expect(laboratorioEn(c.incumplimientoLabs, "LQC")).toBe(false);
    expect(laboratorioEn(c.planillaCostosLabs, "LQC")).toBe(true);
    expect(c.exigeTresCierres).toBe(false);
    expect(c.diasCierre).toBe(DIAS_CIERRE_DEFECTO);
  });

  it("lee la lista del parámetro y admite TODOS", () => {
    const c = configCierreOt([
      { codigo: "incumplimiento_labs", valor: "todos" },
      { codigo: "planilla_costos_labs", valor: "lqc, lme" },
      { codigo: "exige_tres_cierres", valor: "si" },
      { codigo: "dias_cierre", valor: "5" },
    ]);
    expect(c.incumplimientoLabs).toBe("todos");
    expect(laboratorioEn(c.incumplimientoLabs, "LQA")).toBe(true);
    expect(c.planillaCostosLabs).toEqual(["LQC", "LME"]);
    expect(c.exigeTresCierres).toBe(true);
    expect(c.diasCierre).toBe(5);
  });

  it("lista vacía = ningún laboratorio; fila inactiva o valor fuera de rango = por defecto", () => {
    expect(listaLaboratorios("", "LQC")).toEqual([]);
    const c = configCierreOt([
      { codigo: "planilla_costos_labs", valor: "LME", activo: false },
      { codigo: "dias_cierre", valor: "999" },
    ]);
    expect(c.planillaCostosLabs).toEqual(["LQC"]);
    expect(c.diasCierre).toBe(DIAS_CIERRE_DEFECTO);
    expect(laboratorioEn([], null)).toBe(false);
  });
});

describe("cierre de la OT · lote 4 · cerrar por incumplimiento", () => {
  const ok = { estadoOt: "en_analisis", laboratorio: "SSTGO", habilitado: true, noCumpleAprobados: 1, pendientes: 3, motivo: "Lote 1 PRUEBA no cumple la dimensión" };

  it("procede con un No cumple aprobado, ensayos pendientes y motivo", () => {
    expect(faltantesCierreIncumplimiento(ok)).toEqual([]);
  });

  it("exige laboratorio habilitado, un negativo aprobado, pendientes y motivo", () => {
    const f = faltantesCierreIncumplimiento({ ...ok, habilitado: false, noCumpleAprobados: 0, pendientes: 0, motivo: "corto" });
    expect(f).toHaveLength(4);
    expect(f[0]).toContain("no está habilitado para SSTGO");
    expect(f[1]).toContain("No cumple");
    expect(f[2]).toContain("No quedan ensayos pendientes");
    expect(f[3]).toContain("motivo");
  });

  it("sin motivo indicado (consulta de la pantalla) no pide motivo", () => {
    const { motivo, ...sinMotivo } = ok;
    void motivo;
    expect(faltantesCierreIncumplimiento(sinMotivo)).toEqual([]);
  });

  it("OT cerrada o anulada: no", () => {
    expect(faltantesCierreIncumplimiento({ ...ok, estadoOt: "cerrada" })).toEqual(["La OT está cerrada."]);
    expect(faltantesCierreIncumplimiento({ ...ok, estadoOt: "anulada" })).toEqual(["La OT está anulada."]);
  });

  it("el resultado pasa a no_ejecutado desde cualquier estado no aprobado y es final", () => {
    for (const e of ["pendiente", "capturado", "revisado_n1", "devuelto", "rechazado"])
      expect(() => validarTransicion("resultado", e, "no_ejecutado")).not.toThrow();
    expect(() => validarTransicion("resultado", "aprobado", "no_ejecutado")).toThrow();
    expect(() => validarTransicion("resultado", "no_ejecutado", "capturado")).toThrow();
  });

  it("un ensayo no ejecutado no se captura, no se edita y no se quita", () => {
    expect(motivoNoCapturable("no_ejecutado")).toContain("No ejecutado");
    expect(motivoNoQuitable("no_ejecutado")).toContain("traza");
    expect(motivoEdicionManual({ estado: "no_ejecutado", analistaId: null }, "u1", { veredicto: "cumple" })?.status).toBe(409);
  });

  it("cuentas: los no ejecutados no quedan sin terminar", () => {
    const n = cuentasResultados({ aprobado: 2, no_ejecutado: 3, pendiente: 1, devuelto: 1, revisado_n1: 1 });
    expect(n).toEqual({ total: 8, aprobados: 2, noEjecutados: 3, sinCapturar: 2, sinTerminar: 3 });
  });
});

describe("cierre de la OT · lote 4 · emisión y cierre con ensayos «No ejecutado»", () => {
  it("emite con aprobados y no ejecutados (antes: «faltan resultados por aprobar»)", () => {
    const rs = [
      { estado: "aprobado", veredicto: "no_cumple", muestra: "M1", analito: "Dimensión" },
      { estado: "no_ejecutado", veredicto: null, muestra: "M1", analito: "Presión" },
      { estado: "no_ejecutado", veredicto: null, muestra: "M2", analito: "Presión" },
    ];
    expect(faltantesParaEmitir(rs)).toEqual([]);
  });

  it("los no ejecutados no cuentan como «sin veredicto»", () => {
    const rs = [
      { estado: "aprobado", veredicto: "no_cumple" },
      { estado: "no_ejecutado", veredicto: "pendiente" },
    ];
    expect(faltantesParaEmitir(rs)).toEqual([]);
  });

  it("un documento solo con ensayos no ejecutados no se emite", () => {
    const f = faltantesParaEmitir([{ estado: "no_ejecutado", veredicto: null }]);
    expect(f).toHaveLength(1);
    expect(f[0]).toContain("No ejecutado");
  });

  it("sigue exigiendo aprobar lo que no quedó no ejecutado", () => {
    const f = faltantesParaEmitir([
      { estado: "aprobado", veredicto: "no_cumple" },
      { estado: "capturado", veredicto: null },
      { estado: "no_ejecutado", veredicto: null },
    ]);
    expect(f[0]).toContain("1 de 2");
  });

  it("el cierre de la OT (regla pura) recibe ya descontados los no ejecutados", () => {
    expect(
      faltantesParaCerrar({ estado: "finalizada", documentos: [{ numero: "INC-1", estado: "oficial", entregadoAt: "2026-11-20" }], resultadosNoAprobados: 0 }),
    ).toEqual([]);
  });
});

describe("cierre de la OT · lote 4 · el informe muestra «No ejecutado»", () => {
  const r = (x: Partial<ResultadoParaInforme>): ResultadoParaInforme => ({
    id: Math.random().toString(36).slice(2),
    muestraId: "m1",
    muestraCodigo: "OT-PRUEBA-M1",
    ensayo: "Presión",
    ...x,
  });

  it("fila del informe de ensayo: resultado y condición «No ejecutado», con el motivo en la observación", () => {
    const est = armarInforme(
      [
        r({ ensayo: "Dimensión", limiteInf: "1", limiteSup: "2", valorNumerico: 3, veredicto: "no_cumple", estado: "aprobado" }),
        r({ limiteInf: "1", limiteSup: "2", valorNumerico: 1.5, veredicto: "cumple", estado: "no_ejecutado", noEjecutadoMotivo: "PRUEBA lote rechazado" }),
      ],
      configPorTipo("I.ENSAYO"),
      "cumplimiento",
    );
    const filas = est.secciones.flatMap((s) => s.componentes.flatMap((c) => c.filas));
    const ne = filas.find((f) => f.ensayo === "Presión")!;
    expect(ne.resultado).toBe("No ejecutado");
    expect(ne.veredictoTexto).toBe("No ejecutado");
    expect(ne.veredicto).toBeNull();
    expect(ne.observacion).toBe("No ejecutado: PRUEBA lote rechazado");
    // El no ejecutado no se cuenta entre los «no cumple» de las referencias.
    expect(est.referencias.flatMap((x) => x.ensayos)).toEqual(["Dimensión"]);
  });

  it("tabla de inspección BPCH (Informe de Incumplimiento): «No ejecutado», sin el rojo del incumplimiento", () => {
    const f = filaInspeccion({ catAnalito: { nombre: "Presión" }, muestra: { codigo: "M1" }, limiteInf: "1", limiteSup: "2", veredicto: null, estado: "no_ejecutado" });
    expect(f.resultado).toBe("No ejecutado");
    expect(f.condicion).toBe("No ejecutado");
    const html = tablaInspeccion([f]);
    expect(html).toContain('<td class="">No ejecutado</td>');
  });
});

describe("cierre de la OT · lote 4 · cobro de los no ejecutados", () => {
  const cot = {
    codigo: "COT-PRUEBA-1",
    moneda: "CLP",
    neto: 30000,
    ivaPct: 19,
    lineas: [
      { ensayoCodigo: "E1", descripcion: "Dimensión", cantidad: 2, precioUnitario: 5000, subtotal: 10000 },
      { ensayoCodigo: "E2", descripcion: "Presión", cantidad: 2, precioUnitario: 10000, subtotal: 20000 },
    ],
  };

  it("descuenta el ensayo no ejecutado con el precio de su línea, por las muestras en que no se hizo", () => {
    const l = lineasNoEjecutados(cot, [{ codigo: "E2", nombre: "Presión", muestras: 1 }]);
    expect(l).toEqual([{ descripcion: "No ejecutado (cierre por incumplimiento): E2 · Presión", cantidad: 1, precioUnitario: -10000, subtotal: -10000 }]);
  });

  it("no descuenta más de lo cotizado ni ensayos sin línea propia", () => {
    expect(lineasNoEjecutados(cot, [{ codigo: "e2", nombre: "Presión", muestras: 5 }])[0].subtotal).toBe(-20000);
    expect(lineasNoEjecutados(cot, [{ codigo: "E9", nombre: "Otro", muestras: 1 }])).toEqual([]);
    expect(lineasNoEjecutados(cot, [])).toEqual([]);
  });
});

describe("cierre de la OT · lote 4 · planilla de costos y tres cierres", () => {
  it("planilla de costos: solo en los laboratorios que la exigen, con mensaje claro", () => {
    expect(faltantesPlanillaCostos({ exige: false, laboratorio: "LQA", estadoPlanilla: null })).toEqual([]);
    expect(faltantesPlanillaCostos({ exige: true, laboratorio: "LQC", estadoPlanilla: "cerrada" })).toEqual([]);
    expect(faltantesPlanillaCostos({ exige: true, laboratorio: "LQC", estadoPlanilla: "borrador" })[0]).toContain("está en borrador");
    expect(faltantesPlanillaCostos({ exige: true, laboratorio: "LQC", estadoPlanilla: null })[0]).toContain("Falta la planilla de costos reales de LQC");
  });

  it("etapas en orden: analista → jefe de laboratorio → jefe de departamento", () => {
    const base = { estadoOt: "en_analisis", hechas: {}, sinCapturar: 0, sinTerminar: 0 };
    expect(faltantesEtapaCierre("analista", base)).toEqual([]);
    expect(faltantesEtapaCierre("analista", { ...base, sinCapturar: 2 })).toEqual(["Hay 2 ensayo(s) sin capturar."]);
    expect(faltantesEtapaCierre("jefe_lab", { ...base, sinTerminar: 1 })).toEqual(["Falta el cierre del analista.", "Hay 1 resultado(s) sin aprobar."]);
    expect(faltantesEtapaCierre("jefe_lab", { ...base, hechas: { analista: true } })).toEqual([]);
    expect(faltantesEtapaCierre("jefe_depto", base)).toEqual(["Falta el cierre del jefe de laboratorio."]);
    expect(faltantesEtapaCierre("jefe_depto", { ...base, hechas: { analista: true, jefe_lab: true } })).toEqual([]);
    expect(faltantesEtapaCierre("analista", { ...base, hechas: { analista: true } })[0]).toContain("ya está registrado");
    expect(faltantesEtapaCierre("analista", { ...base, estadoOt: "anulada" })).toEqual(["La OT está anulada."]);
  });

  it("el cierre final pide los tres cierres solo si el parámetro lo exige", () => {
    expect(faltantesTresCierres(false, {})).toEqual([]);
    expect(faltantesTresCierres(true, { analista: true })[0]).toContain("jefe de laboratorio, jefe de departamento");
    expect(faltantesTresCierres(true, { analista: true, jefe_lab: true, jefe_depto: true })).toEqual([]);
  });

  it("etapas válidas", () => {
    expect(esEtapaCierre("jefe_lab")).toBe(true);
    expect(esEtapaCierre("director")).toBe(false);
  });
});

describe("cierre de la OT · lote 4 · plazo de cierre en días hábiles (IDIC-PG03)", () => {
  it("días hábiles: lunes a viernes", () => {
    // 2026-11-20 es viernes.
    expect(sumarDiasHabiles("2026-11-20", 1)).toBe("2026-11-23");
    expect(sumarDiasHabiles("2026-11-20", 10)).toBe("2026-12-04");
    expect(diasHabilesEntre("2026-11-20", "2026-11-23")).toBe(1);
    expect(diasHabilesEntre("2026-11-20", "2026-11-22")).toBe(0);
    expect(diasHabilesEntre("2026-11-23", "2026-11-20")).toBe(0);
    expect(diasHabilesEntre("2026-11-20", sumarDiasHabiles("2026-11-20", 7))).toBe(7);
  });

  it("dentro de plazo y atrasada", () => {
    expect(plazoCierre(null, "2026-11-23", 10)).toBeNull();
    const enPlazo = plazoCierre("2026-11-20", "2026-11-23", 10)!;
    expect(enPlazo).toEqual({ terminadaEl: "2026-11-20", limite: "2026-12-04", diasHabiles: 1, diasRestantes: 9, atrasada: false });
    const justo = plazoCierre("2026-11-20", "2026-12-04", 10)!;
    expect(justo.atrasada).toBe(false);
    expect(justo.diasRestantes).toBe(0);
    const atrasada = plazoCierre("2026-11-20", "2026-12-08", 10)!;
    expect(atrasada.atrasada).toBe(true);
    expect(atrasada.diasRestantes).toBe(-2);
    expect(atrasada.diasHabiles).toBe(12);
  });
});
