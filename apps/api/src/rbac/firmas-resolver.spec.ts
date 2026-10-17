import { NodoUnidad, construirArbol } from "./alcance";
import {
  JefeUnidad,
  MOTIVO_OT_INTERNA,
  ReglaFirma,
  TenenciaRol,
  aplicarOtInterna,
  elegirReglas,
  esOtInterna,
  resolverFirmas,
  unidadParaNivel,
} from "./firmas-resolver";

const N = (id: string, padreId: string | null, tipo: string): NodoUnidad => ({
  id,
  padreId,
  codigo: id,
  nombre: `Unidad ${id}`,
  tipo,
});
const arbol = construirArbol([
  N("DIR", null, "DIRECCION"),
  N("DCO", "DIR", "DEPARTAMENTO"),
  N("DQO", "DIR", "DEPARTAMENTO"),
  N("SQU", "DQO", "SECCION"),
  N("LQC", "SQU", "LABORATORIO"),
  N("LME", "SQU", "LABORATORIO"),
  N("DSA", "DIR", "DEPARTAMENTO"),
  N("SAM", "DSA", "SECCION"),
  N("LMT", "SAM", "LABORATORIO"),
  N("LNF", "SAM", "LABORATORIO"),
  N("LRB", "DSA", "LABORATORIO"),
  N("BPCH", "DIR", "DEPARTAMENTO"),
  N("SCC", "BPCH", "SECCION"),
  N("SANTOF", "BPCH", "SUCURSAL"),
  N("DGC", "DIR", "APOYO"),
]);

const ROLES = {
  REVISOR: { id: "r-rev", codigo: "REVISOR", nombre: "Analista revisor", nivel: "OPERATIVO", alcance: "UNIDAD" },
  JEFE_LAB: { id: "r-jl", codigo: "JEFE_LAB", nombre: "Jefe de Laboratorio", nivel: "JEFATURA", alcance: "UNIDAD" },
  JEFE_SECCION: { id: "r-js", codigo: "JEFE_SECCION", nombre: "Jefe de Sección", nivel: "JEFATURA", alcance: "DESCENDENCIA" },
  JEFE_DEPTO: { id: "r-jd", codigo: "JEFE_DEPTO", nombre: "Jefe de Departamento", nivel: "JEFATURA", alcance: "DESCENDENCIA" },
  METROLOGO: { id: "r-met", codigo: "METROLOGO", nombre: "Metrólogo", nivel: "OPERATIVO", alcance: "UNIDAD" },
  CALIDAD: { id: "r-cal", codigo: "CALIDAD", nombre: "Gestión de Calidad", nivel: "SOPORTE", alcance: "GLOBAL" },
  DIRECTOR: { id: "r-dir", codigo: "DIRECTOR", nombre: "Director", nivel: "DIRECCION", alcance: "GLOBAL" },
};
type R = keyof typeof ROLES;

let seq = 0;
const regla = (
  tipoDocumento: string,
  unidadId: string | null,
  orden: number,
  accion: string,
  rol: R,
  nivelUnidad: string,
  extra: Partial<ReglaFirma> = {},
): ReglaFirma => ({
  id: `ff-${++seq}`,
  tipoDocumento,
  unidadId,
  orden,
  accion,
  rolId: ROLES[rol].id,
  nivelUnidad,
  unidadDestinoId: null,
  obligatorio: true,
  activo: true,
  descripcion: null,
  rol: ROLES[rol],
  ...extra,
});

const REGLAS: ReglaFirma[] = [
  // defecto informe de ensayo
  regla("INFORME_ENSAYO", null, 1, "REVISA", "REVISOR", "MISMA"),
  regla("INFORME_ENSAYO", null, 2, "FIRMA", "JEFE_LAB", "MISMA"),
  regla("INFORME_ENSAYO", null, 3, "OFICIALIZA", "JEFE_DEPTO", "DEPARTAMENTO"),
  // override LME
  regla("INFORME_ENSAYO", "LME", 2, "OFICIALIZA", "JEFE_DEPTO", "DEPARTAMENTO"),
  regla("INFORME_ENSAYO", "LME", 1, "FIRMA", "JEFE_LAB", "MISMA"),
  regla("INFORME_ENSAYO", "LME", 3, "FIRMA", "CALIDAD", "CALIDAD"),
  // calibración: override en la SECCIÓN SAM (aplica a LMT, LNF por herencia)
  regla("CERTIFICADO_CALIBRACION", "SAM", 1, "ELABORA", "METROLOGO", "MISMA"),
  regla("CERTIFICADO_CALIBRACION", "SAM", 2, "FIRMA", "JEFE_LAB", "MISMA"),
  regla("CERTIFICADO_CALIBRACION", "SAM", 3, "FIRMA", "JEFE_DEPTO", "DEPARTAMENTO"),
  // conformidad: jefe SCC fijo
  regla("CERTIFICADO_CONFORMIDAD", null, 1, "FIRMA", "JEFE_SECCION", "FIJA", { unidadDestinoId: "SCC" }),
  // incumplimiento con VB opcional del director
  regla("INFORME_INCUMPLIMIENTO", null, 1, "FIRMA", "JEFE_SECCION", "FIJA", { unidadDestinoId: "SCC" }),
  regla("INFORME_INCUMPLIMIENTO", null, 2, "VB", "DIRECTOR", "DIRECCION", { obligatorio: false }),
  // regla inactiva: no debe aplicarse
  regla("OFICIO", null, 1, "FIRMA", "DIRECTOR", "DIRECCION", { activo: false }),
];

const JEFES: JefeUnidad[] = [
  { unidadId: "LQC", usuarioId: "u-jlqc", nombre: "Jefe LQC", rol: "titular" },
  { unidadId: "LQC", usuarioId: "u-jlqc2", nombre: "Subrogante LQC", rol: "subrogante" },
  { unidadId: "DQO", usuarioId: "u-jdqo", nombre: "Jefe DQO", rol: "titular" },
  { unidadId: "LMT", usuarioId: "u-jlmt", nombre: "Jefe LMT", rol: "titular" },
  { unidadId: "DSA", usuarioId: "u-jdsa", nombre: "Jefe DSA", rol: "titular" },
  { unidadId: "SCC", usuarioId: "u-jscc", nombre: "Jefe SCC", rol: "titular" },
  { unidadId: "DIR", usuarioId: "u-dir", nombre: "Director", rol: "titular" },
];
const TENENCIAS: TenenciaRol[] = [
  { usuarioId: "u-rev", nombre: "Revisor LQC", rolCodigo: "REVISOR", unidadId: "LQC" },
  { usuarioId: "u-rev-old", nombre: "Revisor vencido", rolCodigo: "ANALISTA_SR", unidadId: "LQC", vigenteHasta: "2026-01-01" },
  { usuarioId: "u-rev-alias", nombre: "Revisor (alias legado)", rolCodigo: "ANALISTA_SR", unidadId: "LQC" },
  { usuarioId: "u-met", nombre: "Metrólogo LMT", rolCodigo: "METROLOGO", unidadId: "LMT" },
  { usuarioId: "u-cal", nombre: "Calidad", rolCodigo: "CALIDAD", unidadId: null },
  // el jefe de LQC también está como JEFE_LAB en usuario_rol: no se duplica
  { usuarioId: "u-jlqc", nombre: "Jefe LQC", rolCodigo: "JEFELAB", unidadId: "LQC" },
];

const AHORA = new Date("2026-10-08T12:00:00Z");
const resolver = (tipoDocumento: string, unidadId: string | null) =>
  resolverFirmas({ tipoDocumento, unidadId, reglas: REGLAS, arbol, jefes: JEFES, tenencias: TENENCIAS, ahora: AHORA });

describe("firmas · elegirReglas", () => {
  it("sin override usa las reglas por defecto, ordenadas", () => {
    const r = elegirReglas(REGLAS, arbol, "INFORME_ENSAYO", "LQC");
    expect(r.origen).toBe("DEFECTO");
    expect(r.reglas.map((x) => x.orden)).toEqual([1, 2, 3]);
  });

  it("el override de la propia unidad gana a la regla por defecto", () => {
    const r = elegirReglas(REGLAS, arbol, "INFORME_ENSAYO", "LME");
    expect(r.origen).toBe("UNIDAD");
    expect(r.unidadRegla?.codigo).toBe("LME");
    expect(r.reglas.map((x) => x.rol.codigo)).toEqual(["JEFE_LAB", "JEFE_DEPTO", "CALIDAD"]);
  });

  it("hereda el override de la sección más cercana subiendo por padre_id", () => {
    const r = elegirReglas(REGLAS, arbol, "CERTIFICADO_CALIBRACION", "LNF");
    expect(r.origen).toBe("UNIDAD");
    expect(r.unidadRegla?.codigo).toBe("SAM");
  });

  it("sin reglas para el tipo → SIN_REGLAS; las inactivas no cuentan", () => {
    expect(elegirReglas(REGLAS, arbol, "CERTIFICADO_CALIBRACION", "LQC").origen).toBe("SIN_REGLAS");
    expect(elegirReglas(REGLAS, arbol, "OFICIO", "LQC").origen).toBe("SIN_REGLAS");
  });
});

describe("firmas · unidadParaNivel", () => {
  it("resuelve MISMA / SECCION / DEPARTAMENTO / DIRECCION / CALIDAD / COMERCIAL / FIJA", () => {
    expect(unidadParaNivel(arbol, "LQC", "MISMA", null)?.codigo).toBe("LQC");
    expect(unidadParaNivel(arbol, "LQC", "SECCION", null)?.codigo).toBe("SQU");
    expect(unidadParaNivel(arbol, "LQC", "DEPARTAMENTO", null)?.codigo).toBe("DQO");
    expect(unidadParaNivel(arbol, "LQC", "DIRECCION", null)?.codigo).toBe("DIR");
    expect(unidadParaNivel(arbol, "LQC", "CALIDAD", null)?.codigo).toBe("DGC");
    expect(unidadParaNivel(arbol, "LQC", "COMERCIAL", null)?.codigo).toBe("DCO");
    expect(unidadParaNivel(arbol, "SANTOF", "FIJA", "SCC")?.codigo).toBe("SCC");
    // LRB cuelga directo del depto: no tiene sección
    expect(unidadParaNivel(arbol, "LRB", "SECCION", null)).toBeNull();
  });
});

describe("firmas · resolverFirmas", () => {
  it("informe de ensayo de LQC: revisor → jefe LQC (titular, subrogante) → jefe DQO", () => {
    const r = resolver("INFORME_ENSAYO", "LQC");
    expect(r.origen).toBe("DEFECTO");
    expect(r.unidad?.codigo).toBe("LQC");
    const [p1, p2, p3] = r.pasos;
    expect(p1.accion).toBe("REVISA");
    expect(p1.unidad?.codigo).toBe("LQC");
    // incluye al alias ANALISTA_SR vigente, excluye el vencido
    expect(p1.responsables.map((x) => x.usuarioId)).toEqual(["u-rev", "u-rev-alias"]);
    expect(p2.responsables).toEqual([
      { usuarioId: "u-jlqc", nombre: "Jefe LQC", via: "titular" },
      { usuarioId: "u-jlqc2", nombre: "Subrogante LQC", via: "subrogante" },
    ]);
    expect(p3.accion).toBe("OFICIALIZA");
    expect(p3.unidad?.codigo).toBe("DQO");
    expect(p3.responsables.map((x) => x.usuarioId)).toEqual(["u-jdqo"]);
    expect(r.pasos.every((p) => p.advertencia === null)).toBe(true);
  });

  it("LME: override con firma final de Gestión de Calidad (rol GLOBAL sin unidad)", () => {
    const r = resolver("INFORME_ENSAYO", "LME");
    expect(r.origen).toBe("UNIDAD");
    expect(r.pasos.map((p) => p.unidad?.codigo)).toEqual(["LME", "DQO", "DGC"]);
    expect(r.pasos[2].responsables.map((x) => x.usuarioId)).toEqual(["u-cal"]);
    // LME no tiene jefe cargado: advertencia en el paso 1
    expect(r.pasos[0].responsables).toEqual([]);
    expect(r.pasos[0].advertencia).toMatch(/JEFE_LAB/);
  });

  it("certificado de calibración de LMT (override heredado de SAM): metrólogo → jefe LMT → jefe DSA", () => {
    const r = resolver("CERTIFICADO_CALIBRACION", "LMT");
    expect(r.unidadRegla?.codigo).toBe("SAM");
    expect(r.pasos.map((p) => p.responsables.map((x) => x.usuarioId))).toEqual([["u-met"], ["u-jlmt"], ["u-jdsa"]]);
  });

  it("certificado de conformidad desde una sucursal: firma el jefe de SCC (FIJA)", () => {
    const r = resolver("CERTIFICADO_CONFORMIDAD", "SANTOF");
    expect(r.pasos).toHaveLength(1);
    expect(r.pasos[0].unidad?.codigo).toBe("SCC");
    expect(r.pasos[0].responsables[0]).toEqual({ usuarioId: "u-jscc", nombre: "Jefe SCC", via: "titular" });
  });

  it("incumplimiento: VB del Director opcional, resuelto vía unidad_jefe de DIR", () => {
    const r = resolver("INFORME_INCUMPLIMIENTO", "SANTOF");
    expect(r.pasos[1]).toMatchObject({ accion: "VB", obligatorio: false });
    expect(r.pasos[1].unidad?.codigo).toBe("DIR");
    expect(r.pasos[1].responsables.map((x) => x.usuarioId)).toEqual(["u-dir"]);
  });

  it("sin reglas → pasos vacíos y origen SIN_REGLAS", () => {
    const r = resolver("CERTIFICADO_CALIBRACION", "LQC");
    expect(r).toMatchObject({ origen: "SIN_REGLAS", pasos: [] });
  });

  it("nivel sin unidad resoluble → advertencia (LRB no tiene sección)", () => {
    const reglas = [regla("INFORME_TECNICO", null, 1, "FIRMA", "JEFE_SECCION", "SECCION")];
    const r = resolverFirmas({ tipoDocumento: "INFORME_TECNICO", unidadId: "LRB", reglas, arbol, jefes: JEFES, tenencias: [], ahora: AHORA });
    expect(r.pasos[0].unidad).toBeNull();
    expect(r.pasos[0].advertencia).toMatch(/SECCION/);
  });
});

describe("firmas · OT interna (sin oficialización del Jefe de Departamento)", () => {
  it("reconoce la OT interna por su origen (código o texto heredado), no la interlaboratorio", () => {
    expect(esOtInterna("OT_INTERNA")).toBe(true);
    expect(esOtInterna("ot interna")).toBe(true);
    expect(esOtInterna(" OT-Interna ")).toBe(true);
    expect(esOtInterna("INTERLABORATORIO")).toBe(false);
    expect(esOtInterna("COTIZACION")).toBe(false);
    expect(esOtInterna(null)).toBe(false);
  });

  it("en una OT interna de LQC firman revisor y jefe LQC; el Jefe DQO queda omitido con el motivo", () => {
    const r = resolverFirmas({
      tipoDocumento: "INFORME_ENSAYO", unidadId: "LQC", reglas: REGLAS, arbol, jefes: JEFES, tenencias: TENENCIAS, ahora: AHORA,
      otInterna: true,
    });
    expect(r.pasos.map((p) => p.accion)).toEqual(["REVISA", "FIRMA"]);
    expect(r.pasos.some((p) => p.rol.codigo === "JEFE_DEPTO")).toBe(false);
    expect(r.omitidos?.map((p) => [p.accion, p.unidad?.codigo, p.motivo])).toEqual([["OFICIALIZA", "DQO", MOTIVO_OT_INTERNA]]);
  });

  it("una OT que no es interna conserva la oficialización y no omite nada", () => {
    const r = resolver("INFORME_ENSAYO", "LQC");
    expect(r.pasos.map((p) => p.accion)).toEqual(["REVISA", "FIRMA", "OFICIALIZA"]);
    expect(r.omitidos).toBeUndefined();
  });

  it("solo quita OFICIALIZA: las firmas de otros tipos y unidades no cambian", () => {
    const base = resolver("CERTIFICADO_CALIBRACION", "LMT");
    const interna = aplicarOtInterna(base);
    expect(interna.pasos).toEqual(base.pasos);
    expect(interna.omitidos).toEqual([]);
    const lme = aplicarOtInterna(resolver("INFORME_ENSAYO", "LME"));
    expect(lme.pasos.map((p) => `${p.accion}:${p.rol.codigo}`)).toEqual(["FIRMA:JEFE_LAB", "FIRMA:CALIDAD"]);
  });
});
