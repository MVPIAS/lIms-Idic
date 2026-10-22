import {
  codigoSubmuestra,
  erroresAsignacion,
  erroresPublicar,
  erroresPunto,
  especDePunto,
  fuenteDe,
  motivoNoPermitido,
  planDesglose,
  puedeGestionar,
  puedeVer,
  puntoDeEnsayo,
  siguienteVersion,
  type PuntoEt,
} from "./reglas-et";
import { entradaGuardada } from "./aplicar-et";

const M1 = "11111111-1111-1111-1111-111111111111";
const M2 = "22222222-2222-2222-2222-222222222222";
const A1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const A2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const L1 = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const L2 = "dddddddd-dddd-dddd-dddd-dddddddddddd";

const p = (x: Partial<PuntoEt>): PuntoEt => ({ punto: "7.1", caracteristica: "Tracción", tipo: "numerico", limiteInf: "550", ...x });

describe("E.T. · puntos", () => {
  it("un punto numérico necesita cotas numéricas y Mín ≤ Máx", () => {
    expect(erroresPunto(p({}), "Fila 1")).toEqual([]);
    expect(erroresPunto(p({ limiteInf: "abc" }), "F").join(" ")).toMatch(/debe ser un número/);
    expect(erroresPunto(p({ limiteInf: "10", limiteSup: "5" }), "F").join(" ")).toMatch(/Mín no puede superar/);
    expect(erroresPunto(p({ limiteInf: null }), "F").join(" ")).toMatch(/indique el requisito/);
  });
  it("atributo e inspección piden el requisito en texto; la inspección no lleva componente", () => {
    expect(erroresPunto(p({ tipo: "atributo", limiteInf: null }), "F").join(" ")).toMatch(/requisito en texto/);
    expect(erroresPunto(p({ tipo: "inspeccion", limiteInf: null, requisito: "Sin costuras abiertas", componente: "Planta" }), "F").join(" ")).toMatch(/no de un componente/);
  });
  it("plan de clases y segunda condición se validan", () => {
    expect(erroresPunto(p({ tipo: "clases", limiteInf: null, planN: 5, planC: 2, planM: 100, planMM: 1000 }), "F")).toEqual([]);
    expect(erroresPunto(p({ tipo: "clases", limiteInf: null, planN: 5, planC: 9, planM: 100 }), "F").join(" ")).toMatch(/no puede superar n/);
    expect(erroresPunto(p({ cond2Etiqueta: "Alargamiento", cond2Inf: 12 }), "F")).toEqual([]);
    expect(erroresPunto(p({ cond2Etiqueta: "Alargamiento" }), "F").join(" ")).toMatch(/mínimo, el máximo/);
    expect(erroresPunto(p({ tipo: "atributo", requisito: "x", limiteInf: null, cond2Etiqueta: "Y", cond2Inf: 1 }), "F").join(" ")).toMatch(/solo vale en un punto numérico/);
  });
  it("publicar: al menos un punto y un ensayo con un solo requisito por componente", () => {
    expect(erroresPublicar([])[0]).toMatch(/no tiene puntos/);
    const dup = [p({ catMetodoId: M1, catAnalitoId: A1 }), p({ punto: "7.2", catMetodoId: M1, catAnalitoId: A1 })];
    expect(erroresPublicar(dup).join(" ")).toMatch(/un ensayo tiene un solo requisito/);
    const otroComp = [p({ catMetodoId: M1, catAnalitoId: A1, componente: "Planta" }), p({ punto: "7.2", catMetodoId: M1, catAnalitoId: A1, componente: "Capellada" })];
    expect(erroresPublicar(otroComp)).toEqual([]);
  });
});

describe("E.T. · estados y versiones", () => {
  it("solo el borrador se edita y publica", () => {
    expect(motivoNoPermitido("borrador", "editar")).toBeNull();
    expect(motivoNoPermitido("vigente", "editar")).toMatch(/nueva versión/);
    expect(motivoNoPermitido("vigente", "publicar")).not.toBeNull();
  });
  it("nueva versión desde la última publicada", () => {
    expect(motivoNoPermitido("vigente", "nueva_version", { esUltima: true })).toBeNull();
    expect(motivoNoPermitido("reemplazada", "nueva_version", { esUltima: false })).toMatch(/versión posterior/);
    expect(motivoNoPermitido("borrador", "nueva_version")).toMatch(/aún se puede editar/);
    expect(siguienteVersion([1, 3, 2])).toBe(4);
  });
  it("el PDF de una vigente solo se agrega si falta", () => {
    expect(motivoNoPermitido("vigente", "subir_pdf", { tienePdf: false })).toBeNull();
    expect(motivoNoPermitido("vigente", "subir_pdf", { tienePdf: true })).toMatch(/no se cambia/);
  });
});

describe("E.T. · asignación y alcance", () => {
  const et = { estado: "vigente" as const, reutilizable: true, clienteId: null, laboratorios: [L1], codigo: "ET-1", version: 2 };
  it("solo vigentes, del laboratorio de la OT, y las no reutilizables solo para su cliente", () => {
    expect(erroresAsignacion(et, { clienteId: "c1", unidadId: L1 })).toEqual([]);
    expect(erroresAsignacion({ ...et, estado: "borrador" }, { clienteId: "c1", unidadId: L1 })[0]).toMatch(/solo se elige una versión vigente/);
    expect(erroresAsignacion(et, { clienteId: "c1", unidadId: L2 })[0]).toMatch(/no es de un laboratorio de esta OT/);
    expect(erroresAsignacion({ ...et, reutilizable: false, clienteId: "c2" }, { clienteId: "c1", unidadId: L1 })[0]).toMatch(/otro cliente/);
  });
  it("gestiona quien tiene todos sus laboratorios; las generales solo el alcance global", () => {
    expect(puedeGestionar([L1], null)).toBe(true);
    expect(puedeGestionar([L1], [L1, L2])).toBe(true);
    expect(puedeGestionar([L1, L2], [L1])).toBe(false);
    expect(puedeGestionar([], [L1])).toBe(false);
    expect(puedeVer([], [L1])).toBe(true);
    expect(puedeVer([L2], [L1])).toBe(false);
  });
});

describe("E.T. · requisito de cada ensayo", () => {
  it("especificación del punto: numérico, atributo, clases y segunda condición", () => {
    expect(especDePunto(p({ unidad: "kgf", cond2Etiqueta: "Alargamiento", cond2Inf: 12, cond2Unidad: "mm" }))).toMatchObject({
      limiteInf: "550", tipoDato: "numerico", unidad: "kgf", condicion2: { etiqueta: "Alargamiento", inf: 12, sup: null, unidad: "mm" },
    });
    expect(especDePunto(p({ tipo: "inspeccion", limiteInf: null, requisito: "Etiquetado legible" }))).toMatchObject({ tipoDato: "atributo", requisito: "Etiquetado legible" });
    expect(especDePunto(p({ tipo: "clases", limiteInf: "9", planN: 5, planC: 2, planM: 10, planMM: 100 }))).toMatchObject({
      limiteInf: null, tipoDato: "numerico", planClases: { n: 5, c: 2, m: 10, M: 100 },
    });
    expect(fuenteDe("ET-1", 2, "7.1")).toBe("E.T. ET-1 v2 · punto 7.1");
  });
  it("punto del ensayo: por analito y componente; por método solo si tiene un analito", () => {
    const puntos = [
      p({ id: "pa", catMetodoId: M1, catAnalitoId: A1 }),
      p({ id: "pm", punto: "7.2", catMetodoId: M2 }),
      p({ id: "pc", punto: "8.1", catMetodoId: M1, catAnalitoId: A1, componente: "Planta" }),
    ];
    expect(puntoDeEnsayo(puntos, { catAnalitoId: A1, catMetodoId: M1 }, null, 2)?.id).toBe("pa");
    expect(puntoDeEnsayo(puntos, { catAnalitoId: A1, catMetodoId: M1 }, "planta", 2)?.id).toBe("pc");
    expect(puntoDeEnsayo(puntos, { catAnalitoId: A2, catMetodoId: M2 }, null, 1)?.id).toBe("pm");
    expect(puntoDeEnsayo(puntos, { catAnalitoId: A2, catMetodoId: M2 }, null, 3)).toBeNull();
    expect(puntoDeEnsayo(puntos, { catAnalitoId: A2, catMetodoId: M1 }, null, 1)).toBeNull();
  });
  it("reconstruye la captura guardada para recalcular el veredicto", () => {
    expect(entradaGuardada({ replicas: [1, 2], valorNumerico: 1.5 })).toEqual({ replicas: [1, 2], variables: undefined, valorCondicion2: null });
    expect(entradaGuardada({ replicas: [], valorTexto: "< 10", valorNumerico: null })).toEqual({ valor: "< 10", valorCondicion2: null });
    expect(entradaGuardada({ replicas: [], valorNumerico: "12.5", valorCondicion2: "3" })).toEqual({ valor: 12.5, valorCondicion2: 3 });
    expect(entradaGuardada({ replicas: [] })).toBeNull();
  });
});

describe("E.T. · desglose producto → componentes e inspecciones (EP-03 1.3)", () => {
  const puntos = [
    p({ punto: "1", catMetodoId: M1, componente: "Planta" }),
    p({ punto: "2", catMetodoId: M2, componente: "planta " }),
    p({ punto: "3", catMetodoId: M1, componente: "Capellada" }),
    p({ punto: "4", catMetodoId: M2 }),
    p({ punto: "5", tipo: "inspeccion", limiteInf: null, requisito: "Etiquetado", catMetodoId: M1 }),
    p({ punto: "6", tipo: "inspeccion", limiteInf: null, requisito: "Empaque" }),
  ];
  it("agrupa por componente, separa inspecciones y puntos sin ensayo", () => {
    const d = planDesglose(puntos);
    expect(d.componentes.map((c) => [c.nombre, c.metodoIds.length])).toEqual([["Planta", 2], ["Capellada", 1]]);
    expect(d.producto.metodoIds).toEqual([M2]);
    expect(d.inspecciones.metodoIds).toEqual([M1]);
    expect(d.sinEnsayo.map((x) => x.punto)).toEqual(["6"]);
  });
  it("códigos de submuestra correlativos", () => {
    expect(codigoSubmuestra("OT-1-M1", [])).toBe("OT-1-M1-C1");
    expect(codigoSubmuestra("OT-1-M1", ["OT-1-M1", "OT-1-M1-C1", "OT-1-M1-C3", "OT-1-M10-C9"])).toBe("OT-1-M1-C4");
  });
});
