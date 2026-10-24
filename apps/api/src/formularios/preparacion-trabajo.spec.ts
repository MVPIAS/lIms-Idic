import { camposDefecto, evaluarPreparacion, leerCampoPrep, motivoBloqueoPreparacion, normalizarCampoPrep, probetasDe, jsonCampoPrep } from "./preparacion";
import {
  erroresComision, erroresDocumentacion, erroresReserva, exigeAprobacion, FORMULARIOS_TRABAJO, leerConfigTrabajo, motivoBloqueoTrabajo, pasosAprobacion, transicion,
} from "./trabajo";
import { mapaActivacion, motivoCapturaEnVariante, varianteDe } from "./variantes";

const ctx = (equipos: [string, boolean][] = []) => ({
  hoy: "2026-10-22",
  muestraCodigo: "M-2026-0007",
  equipos: new Map(equipos.map(([id, apto]) => [id, { id, codigo: id.toUpperCase(), apto, motivo: apto ? null : "Calibración vencida el 01-09-2026" }])),
});

describe("variantes · activación por método o laboratorio", () => {
  const porMetodo = mapaActivacion([
    { codigo: "3376", valor: "lrb_disparos", activo: true },
    { codigo: "999", valor: "aql", activo: false },
    { codigo: "888", valor: "inventada", activo: true },
  ]);
  const porLab = mapaActivacion([{ codigo: "LMB", valor: "lmb_micro", activo: true }]);
  it("manda el método; si no, el laboratorio; si no, estándar", () => {
    expect(varianteDe({ metodoCodigo: "3376", laboratorio: "LRB" }, porMetodo, porLab)).toBe("lrb_disparos");
    expect(varianteDe({ metodoCodigo: "999", laboratorio: "LCC" }, porMetodo, porLab)).toBe("estandar");
    expect(varianteDe({ metodoCodigo: "888", laboratorio: "LMB" }, porMetodo, porLab)).toBe("lmb_micro");
    expect(varianteDe({ metodoCodigo: null, laboratorio: null }, porMetodo, porLab)).toBe("estandar");
  });
  it("la captura estándar no admite un ensayo de una variante", () => {
    expect(motivoCapturaEnVariante("lrb_disparos", null)).toMatch(/Registro de disparos/);
    expect(motivoCapturaEnVariante("lrb_disparos", "lrb_disparos")).toBeNull();
    expect(motivoCapturaEnVariante("estandar", null)).toBeNull();
  });
});

describe("preparación de muestras (T29)", () => {
  it("LME: solución vencida y balanza no verificada bloquean", () => {
    const r = evaluarPreparacion(camposDefecto("LME"), { t_sala: "21,5", hr_sala: 45, verificacion_balanza: false, vigencia_soluciones: "2026-10-01" }, ctx());
    expect(r.errores).toEqual([]);
    expect(r.bloqueos.join(" ")).toMatch(/balanza/);
    expect(r.bloqueos.join(" ")).toMatch(/vencida el 01-10-2026/);
    expect(r.datos.t_sala).toBe(21.5);
  });
  it("LME vigente y verificada: sin bloqueos", () => {
    const r = evaluarPreparacion(camposDefecto("LME"), { t_sala: 21, hr_sala: 45, verificacion_balanza: true, vigencia_soluciones: "2027-03-01", control_horno: true }, ctx());
    expect(r.bloqueos).toEqual([]);
  });
  it("obligatorios y campos ajenos", () => {
    const r = evaluarPreparacion(camposDefecto("LQC"), { otro: 1 }, ctx());
    expect(r.errores.join(" ")).toMatch(/Peso de muestra: es obligatorio/);
    expect(r.errores.join(" ")).toMatch(/«otro»/);
  });
  it("LPN y LCC: probetas trazables a la muestra", () => {
    const r = evaluarPreparacion(camposDefecto("LPN"), { sustrato: "Acero", metodo_aplicacion: "pistola", n_probetas: 3, curado_inicio: "2026-10-20" }, ctx());
    expect(r.errores).toEqual([]);
    expect(r.probetas).toEqual(["M-2026-0007-P01", "M-2026-0007-P02", "M-2026-0007-P03"]);
    expect(probetasDe("M", 0)).toEqual([]);
  });
  it("DSA: QC no conforme y equipo vencido bloquean", () => {
    const r = evaluarPreparacion(camposDefecto("LRB"), { condicion: "inmersion", qc_conforme: false, equipo: "e1" }, ctx([["e1", false]]));
    expect(r.bloqueos.join(" ")).toMatch(/QC/);
    expect(r.bloqueos.join(" ")).toMatch(/E1 no está apto/);
    expect(evaluarPreparacion(camposDefecto("LRB"), { condicion: "normal", qc_conforme: true, equipo: "x" }, ctx()).errores.join(" ")).toMatch(/elija un equipo/);
  });
  it("motivo del bloqueo de captura", () => {
    expect(motivoBloqueoPreparacion({ registrada: true, bloqueos: ["QC: no está conforme."], obligatoria: false, muestra: "M-1", lab: "LRB" })).toMatch(/bloquea el ensayo/);
    expect(motivoBloqueoPreparacion({ registrada: false, bloqueos: [], obligatoria: true, muestra: "M-1", lab: "LME" })).toMatch(/Registre la preparación/);
    expect(motivoBloqueoPreparacion({ registrada: false, bloqueos: [], obligatoria: false, muestra: "M-1", lab: "LME" })).toBeNull();
  });
  it("configuración: ida y vuelta del JSON y validación", () => {
    const c = camposDefecto("LME").find((x) => x.campo === "vigencia_soluciones")!;
    const leido = leerCampoPrep({ codigo: "LME.vigencia_soluciones", etiqueta: c.etiqueta, valor: jsonCampoPrep(c), activo: true });
    expect(leido).toMatchObject({ tipo: "fecha", bloquea: true, obligatorio: true });
    expect(leerCampoPrep({ codigo: "LME.x", etiqueta: "x", valor: "{", activo: true })).toBeNull();
    expect(normalizarCampoPrep({ tipo: "texto", bloquea: true }).errores.join(" ")).toMatch(/Solo una casilla/);
    expect(normalizarCampoPrep({ tipo: "lista", opciones: [] }).errores.join(" ")).toMatch(/al menos una opción/);
    expect(normalizarCampoPrep({ tipo: "equipo", bloquea: true, obligatorio: true }).errores).toEqual([]);
  });
});

describe("preparación del trabajo DSA (T26)", () => {
  const cfg = leerConfigTrabajo([]);
  it("por defecto exigen aprobación LRB y SVM; LEM solo en terreno", () => {
    expect(cfg).toEqual({ exigeAprobacion: ["LRB", "SVM"], bloqueaCaptura: true });
    expect(exigeAprobacion("LRB", {}, cfg)).toBe(true);
    expect(exigeAprobacion("LAM", {}, cfg)).toBe(false);
    expect(exigeAprobacion("LEM", { terreno: false }, cfg)).toBe(false);
    expect(exigeAprobacion("LEM", { terreno: true }, cfg)).toBe(true);
    expect(leerConfigTrabajo([{ codigo: "exige_aprobacion", valor: "LRB", activo: true }, { codigo: "bloquea_captura", valor: "no", activo: true }])).toEqual({ exigeAprobacion: ["LRB"], bloqueaCaptura: false });
  });
  it("2.1 · equipo vencido no se reserva; comisión del laboratorio", () => {
    const eq = [{ id: "a", codigo: "B214", apto: true, motivo: null }, { id: "b", codigo: "CRUSHER", apto: false, motivo: "Calibración vencida" }];
    expect(erroresReserva(eq, ["a"])).toEqual([]);
    expect(erroresReserva(eq, ["b"]).join(" ")).toMatch(/CRUSHER no se puede reservar/);
    expect(erroresReserva(eq, ["z"]).join(" ")).toMatch(/no es del laboratorio/);
    expect(erroresComision({ jefeComision: "x", inspectores: ["y", "y"] }, new Set(["y"]))).toHaveLength(2);
  });
  it("2.2 · formulario por laboratorio", () => {
    const ctxT = { amenazas: ["NIJ0101-IIIA-9MM"], plantillasHcp: ["VLCB"] };
    expect(erroresDocumentacion(FORMULARIOS_TRABAJO.LRB, { amenazas: ["NIJ0101-IIIA-9MM"], plan_disparos: "6 por panel", cartuchos: 35 }, ctxT)).toEqual([]);
    expect(erroresDocumentacion(FORMULARIOS_TRABAJO.LRB, { amenazas: ["OTRA"], cartuchos: -1 }, ctxT).length).toBe(3);
    expect(erroresDocumentacion(FORMULARIOS_TRABAJO.SVM, { resolucion: "R-1", hcp: "VLCB", eett: "RT v2" }, ctxT)).toEqual([]);
    expect(erroresDocumentacion(FORMULARIOS_TRABAJO.LEM, { terreno: false }, ctxT)).toEqual([]);
    expect(erroresDocumentacion(FORMULARIOS_TRABAJO.LEM, { terreno: true }, ctxT).join(" ")).toMatch(/Lugar: es obligatorio/);
    expect(erroresDocumentacion(FORMULARIOS_TRABAJO.LAM, { lugar: "Arica", fecha_inicio: "2026-11-10", fecha_termino: "2026-11-01", normas: ["NCh 44"] }, ctxT).join(" ")).toMatch(/término/);
  });
  it("2.3 · circuito del Jefe de Laboratorio (LRB)", () => {
    const base = { lab: "LRB", exige: true, documentacionCompleta: true, rolesUsuario: ["ANALISTA"] };
    expect(transicion("enviar", { ...base, estado: "borrador" })).toEqual({ estado: "en_aprobacion" });
    expect(transicion("aprobar", { ...base, estado: "en_aprobacion" })).toMatchObject({ error: expect.stringMatching(/Jefe de LRB/) });
    expect(transicion("aprobar", { ...base, estado: "en_aprobacion", rolesUsuario: ["JEFE_LAB"] })).toEqual({ estado: "aprobada" });
    expect(transicion("devolver", { ...base, estado: "en_aprobacion", rolesUsuario: ["JEFE_LAB"], comentario: "" })).toMatchObject({ error: expect.stringMatching(/comentario/) });
    expect(transicion("devolver", { ...base, estado: "en_aprobacion", rolesUsuario: ["JEFE_LAB"], comentario: "Falta el plan" })).toEqual({ estado: "devuelta" });
    expect(transicion("guardar", { ...base, estado: "en_aprobacion" })).toMatchObject({ error: expect.any(String) });
    expect(transicion("enviar", { ...base, estado: "devuelta", documentacionCompleta: false })).toMatchObject({ error: expect.stringMatching(/obligatorios/) });
  });
  it("2.3 · LEM en terreno: valida Sección, aprueba Jefe DSA", () => {
    expect(pasosAprobacion("LEM").map((p) => p.rol)).toEqual(["JEFE_SECCION", "JEFE_DEPTO"]);
    const base = { lab: "LEM", exige: true, documentacionCompleta: true };
    expect(transicion("aprobar", { ...base, estado: "en_aprobacion", rolesUsuario: ["JEFE_DEPTO"] })).toMatchObject({ error: expect.stringMatching(/Primero la valida/) });
    expect(transicion("validar", { ...base, estado: "en_aprobacion", rolesUsuario: ["JEFE_LAB"] })).toMatchObject({ error: expect.any(String) });
    expect(transicion("validar", { ...base, estado: "en_aprobacion", rolesUsuario: ["JEFE_SECCION"] })).toEqual({ estado: "validada" });
    expect(transicion("aprobar", { ...base, estado: "validada", rolesUsuario: ["JEFE_DEPTO"] })).toEqual({ estado: "aprobada" });
  });
  it("sin aprobación: «registrada» y la captura no espera", () => {
    expect(transicion("enviar", { lab: "LAM", exige: false, documentacionCompleta: true, rolesUsuario: ["JEFE_LAB"], estado: "borrador" })).toEqual({ estado: "registrada" });
    expect(motivoBloqueoTrabajo({ lab: "LAM", exige: false, estado: null, bloqueaCaptura: true })).toBeNull();
    expect(motivoBloqueoTrabajo({ lab: "LRB", exige: true, estado: "en_aprobacion", bloqueaCaptura: true })).toMatch(/pendiente de aprobación/);
    expect(motivoBloqueoTrabajo({ lab: "LRB", exige: true, estado: null, bloqueaCaptura: false })).toBeNull();
    expect(motivoBloqueoTrabajo({ lab: "LRB", exige: true, estado: "aprobada", bloqueaCaptura: true })).toBeNull();
  });
});

describe("concordancia del documento de trabajo (B-085)", () => {
  const { generoDocumentoTrabajo } = require("./trabajo");
  it("Paquete técnico y Plan de trabajo son masculinos; Planilla, femenina", () => {
    expect(generoDocumentoTrabajo("Paquete técnico").art).toBe("el");
    expect(generoDocumentoTrabajo("Plan de inspección").lo).toBe("lo");
    expect(generoDocumentoTrabajo("Planilla de trabajo")).toEqual({ art: "la", o: "a", lo: "la" });
  });
});

describe("LEM · trabajo en terreno según el lugar de ejecución (B-089)", () => {
  const { conTerrenoPropuesto, terrenoPorLugar } = require("./trabajo");
  it("fuera del IDIC se propone en terreno", () => {
    expect(terrenoPorLugar("UNIDAD_MILITAR")).toBe(true);
    expect(terrenoPorLugar("IDIC")).toBe(false);
    expect(terrenoPorLugar(null)).toBe(false);
    expect(conTerrenoPropuesto("LEM", {}, "UNIDAD_MILITAR")).toEqual({ terreno: true });
  });
  it("lo marcado por el usuario manda; otros laboratorios no cambian", () => {
    expect(conTerrenoPropuesto("LEM", { terreno: false }, "UNIDAD_MILITAR")).toEqual({ terreno: false });
    expect(conTerrenoPropuesto("LRB", {}, "UNIDAD_MILITAR")).toEqual({});
  });
});
