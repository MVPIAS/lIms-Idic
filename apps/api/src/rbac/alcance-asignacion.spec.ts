/**
 * Alcance POR ASIGNACIÓN: cada permiso vale con el alcance del rol que lo
 * concede (docs/ADMIN_ROLES.md › «Alcance por asignación»).
 */
import {
  AsignacionAlcance,
  NodoUnidad,
  alcanceDePermiso,
  alcanceDePermisos,
  construirArbol,
  entraEnAmbito,
  intersecarAlcances,
  resolverAmbito,
} from "./alcance";
import { AlcanceService } from "./alcance.service";
import { AMBITOS } from "./rbac.constants";

const N = (id: string, padreId: string | null, tipo: string): NodoUnidad => ({
  id,
  padreId,
  codigo: id,
  nombre: `Unidad ${id}`,
  tipo,
  activa: true,
});
// DIR → DQO → SQU → {LPN, LQC} · DIR → DCO → SVT · DIR → BPCH → {SCC, SANTOF, D11} · DIR → DSA → SAM → LMT
const NODOS: NodoUnidad[] = [
  N("DIR", null, "DIRECCION"),
  N("DQO", "DIR", "DEPARTAMENTO"),
  N("SQU", "DQO", "SECCION"),
  N("LPN", "SQU", "LABORATORIO"),
  N("LQC", "SQU", "LABORATORIO"),
  N("DCO", "DIR", "DEPARTAMENTO"),
  N("SVT", "DCO", "SECCION"),
  N("BPCH", "DIR", "DEPARTAMENTO"),
  N("SCC", "BPCH", "SECCION"),
  N("SANTOF", "BPCH", "SUCURSAL"),
  N("D11", "BPCH", "DELEGACION"),
  N("DSA", "DIR", "DEPARTAMENTO"),
  N("SAM", "DSA", "SECCION"),
  N("LMT", "SAM", "LABORATORIO"),
];
const arbol = construirArbol(NODOS);
const AHORA = new Date("2026-10-20T12:00:00Z");
const ordenar = (l: string[]) => [...l].sort();

const ANALISTA_LPN: AsignacionAlcance = {
  rolCodigo: "ANALISTA",
  alcance: "UNIDAD",
  nivel: "OPERATIVO",
  unidadId: "LPN",
  permisos: ["ot.ver", "resultado.crear", "resultado.ver", "muestra.ver"],
};
const COMERCIAL: AsignacionAlcance = {
  rolCodigo: "COMERCIAL",
  alcance: "GLOBAL",
  nivel: "OPERATIVO",
  unidadId: "SVT",
  permisos: ["ot.ver", "cotizacion.ver", "cotizacion.anular"],
};

describe("alcance por asignación · un permiso", () => {
  it("analista LPN + Comercial: los permisos de analista valen solo en LPN", () => {
    const r = alcanceDePermiso([ANALISTA_LPN, COMERCIAL], [], arbol, "resultado.crear", AHORA);
    expect(r.esGlobal).toBe(false);
    expect(r.unidadIds).toEqual(["LPN"]);
  });

  it("analista LPN + Comercial: los permisos comerciales valen con alcance global", () => {
    const r = alcanceDePermiso([ANALISTA_LPN, COMERCIAL], [], arbol, "cotizacion.anular", AHORA);
    expect(r.esGlobal).toBe(true);
    expect(r.rolesGlobales).toEqual(["COMERCIAL"]);
  });

  it("un permiso que conceden los dos roles: la unión (global)", () => {
    const r = alcanceDePermiso([ANALISTA_LPN, COMERCIAL], [], arbol, "ot.ver", AHORA);
    expect(r.esGlobal).toBe(true);
    // las unidades propias se conservan para los ámbitos estrictos
    expect(r.unidadesPropias).toEqual(["LPN"]);
  });

  it("un permiso que no concede ningún rol: sin unidades", () => {
    const r = alcanceDePermiso([ANALISTA_LPN, COMERCIAL], [], arbol, "factura.ver", AHORA);
    expect(r).toEqual({ esGlobal: false, unidadIds: [], rolesGlobales: [], unidadesPropias: [] });
  });

  it("dos roles acotados: la unión de las unidades que conceden el permiso", () => {
    const revisorLqc: AsignacionAlcance = { rolCodigo: "REVISOR", alcance: "UNIDAD", unidadId: "LQC", permisos: ["resultado.revisar", "ot.ver"] };
    expect(alcanceDePermiso([ANALISTA_LPN, revisorLqc], [], arbol, "resultado.revisar", AHORA).unidadIds).toEqual(["LQC"]);
    expect(ordenar(alcanceDePermiso([ANALISTA_LPN, revisorLqc], [], arbol, "ot.ver", AHORA).unidadIds)).toEqual(["LPN", "LQC"]);
  });

  it("compatibilidad: con un solo rol el alcance de sus permisos es el de siempre", () => {
    const jefe: AsignacionAlcance = { rolCodigo: "JEFE_SECCION", alcance: "DESCENDENCIA", nivel: "JEFATURA", unidadId: "SQU", permisos: ["ot.ver"] };
    expect(ordenar(alcanceDePermiso([jefe], [], arbol, "ot.ver", AHORA).unidadIds)).toEqual(["LPN", "LQC", "SQU"]);
  });

  it("las asignaciones vencidas no cuentan", () => {
    const vencida = { ...COMERCIAL, vigenteHasta: new Date("2026-01-01") };
    expect(alcanceDePermiso([ANALISTA_LPN, vencida], [], arbol, "ot.ver", AHORA).esGlobal).toBe(false);
  });

  it("asignación legada de rol acotado sin unidad: global para SUS permisos", () => {
    const legado: AsignacionAlcance = { rolCodigo: "ANALISTA", alcance: "UNIDAD", unidadId: null, permisos: ["resultado.ver"] };
    expect(alcanceDePermiso([legado, ANALISTA_LPN], [], arbol, "resultado.ver", AHORA).esGlobal).toBe(true);
    expect(alcanceDePermiso([legado, ANALISTA_LPN], [], arbol, "resultado.crear", AHORA).unidadIds).toEqual(["LPN"]);
  });

  it("SUPERADMIN en el token vuelve global cualquier permiso", () => {
    const r = alcanceDePermiso([ANALISTA_LPN], [], arbol, "resultado.crear", AHORA, true);
    expect(r.esGlobal).toBe(true);
    expect(r.rolesGlobales).toContain("SUPERADMIN");
  });

  it("jefatura (unidad_jefe): amplía los permisos del rol de jefatura, no los del rol operativo", () => {
    const jefeLab: AsignacionAlcance = { rolCodigo: "JEFE_LAB", alcance: "UNIDAD", nivel: "JEFATURA", unidadId: "LQC", permisos: ["resultado.aprobar"] };
    const analista: AsignacionAlcance = { rolCodigo: "ANALISTA", alcance: "UNIDAD", nivel: "OPERATIVO", unidadId: "LQC", permisos: ["resultado.crear"] };
    const subrogante = [{ unidadId: "LMT", rol: "subrogante" }];
    expect(ordenar(alcanceDePermiso([jefeLab, analista], subrogante, arbol, "resultado.aprobar", AHORA).unidadIds)).toEqual(["LMT", "LQC"]);
    expect(alcanceDePermiso([jefeLab, analista], subrogante, arbol, "resultado.crear", AHORA).unidadIds).toEqual(["LQC"]);
    // sin rol de jefatura, la jefatura amplía los roles acotados (compatibilidad)
    expect(ordenar(alcanceDePermiso([analista], subrogante, arbol, "resultado.crear", AHORA).unidadIds)).toEqual(["LMT", "LQC"]);
  });
});

describe("alcance por asignación · varios permisos", () => {
  it("una ruta que exige dos permisos: la intersección", () => {
    const inspector: AsignacionAlcance = { rolCodigo: "INSPECTOR", alcance: "UNIDAD", unidadId: "SANTOF", permisos: ["bpch.reinspeccion.ver", "resultado.crear"] };
    const r = alcanceDePermisos([inspector, ANALISTA_LPN], [], arbol, ["bpch.reinspeccion.ver", "resultado.crear"], AHORA);
    expect(r.unidadIds).toEqual(["SANTOF"]);
  });

  it("global ∩ acotado = acotado; global ∩ global = global", () => {
    const g = { esGlobal: true, unidadIds: [], rolesGlobales: ["COMERCIAL"], unidadesPropias: [] };
    const a = { esGlobal: false, unidadIds: ["LPN"], rolesGlobales: [], unidadesPropias: ["LPN"] };
    expect(intersecarAlcances(g, a).unidadIds).toEqual(["LPN"]);
    expect(intersecarAlcances(a, g).esGlobal).toBe(false);
    expect(intersecarAlcances(g, { ...g, rolesGlobales: ["COMERCIAL", "LECTOR"] }).rolesGlobales).toEqual(["COMERCIAL"]);
  });

  it("sin permisos (ruta solo autenticada): la unión de todas las asignaciones", () => {
    expect(alcanceDePermisos([ANALISTA_LPN, COMERCIAL], [], arbol, [], AHORA).esGlobal).toBe(true);
    expect(alcanceDePermisos([ANALISTA_LPN], [], arbol, [], AHORA).unidadIds).toEqual(["LPN"]);
  });
});

describe("ámbitos de módulo", () => {
  const d11 = resolverAmbito(arbol, AMBITOS.D11)!;
  const bpchCert = resolverAmbito(arbol, AMBITOS.BPCH_CERT)!;

  it("D11 es estricto: el global de un rol transversal no basta", () => {
    const evidencias = { ...COMERCIAL, rolCodigo: "RECEPCION", permisos: ["evidencia.ver"] };
    expect(entraEnAmbito(alcanceDePermiso([evidencias], [], arbol, "evidencia.ver", AHORA), d11)).toBe(false);
  });

  it("D11 admite el global de Dirección, Subdirección, Superadministración y Lector", () => {
    for (const rol of ["DIRECTOR", "SUBDIRECTOR", "LECTOR"]) {
      const a: AsignacionAlcance = { rolCodigo: rol, alcance: "GLOBAL", unidadId: null, permisos: ["evidencia.ver"] };
      expect(entraEnAmbito(alcanceDePermiso([a], [], arbol, "evidencia.ver", AHORA), d11)).toBe(true);
    }
    expect(entraEnAmbito(alcanceDePermiso([], [], arbol, "evidencia.ver", AHORA, true), d11)).toBe(true);
  });

  it("D11: entra quien tiene una unidad de la Delegación con el permiso, aunque otro rol sea global", () => {
    const perito: AsignacionAlcance = { rolCodigo: "PERITO_SAEC", alcance: "UNIDAD", unidadId: "D11", permisos: ["evidencia.ver"] };
    const recepcion: AsignacionAlcance = { rolCodigo: "RECEPCION", alcance: "GLOBAL", unidadId: null, permisos: ["evidencia.ver"] };
    expect(entraEnAmbito(alcanceDePermiso([perito, recepcion], [], arbol, "evidencia.ver", AHORA), d11)).toBe(true);
  });

  it("D11: el permiso del analista de otro laboratorio no entra aunque tenga un rol global", () => {
    const a: AsignacionAlcance = { ...ANALISTA_LPN, permisos: ["evidencia.ver"] };
    expect(entraEnAmbito(alcanceDePermiso([a, COMERCIAL], [], arbol, "evidencia.ver", AHORA), d11)).toBe(false);
  });

  it("BPCH_CERT es la rama BPCH sin la Delegación Nº 11", () => {
    expect(ordenar([...bpchCert.unidades])).toEqual(["BPCH", "SANTOF", "SCC"]);
    const inspD11: AsignacionAlcance = { rolCodigo: "INSPECTOR", alcance: "UNIDAD", unidadId: "D11", permisos: ["bpch.pn.ver"] };
    const inspSuc: AsignacionAlcance = { ...inspD11, unidadId: "SANTOF" };
    expect(entraEnAmbito(alcanceDePermiso([inspD11], [], arbol, "bpch.pn.ver", AHORA), bpchCert)).toBe(false);
    expect(entraEnAmbito(alcanceDePermiso([inspSuc], [], arbol, "bpch.pn.ver", AHORA), bpchCert)).toBe(true);
    // con trabajo asignado (extra), la D11 entra
    const conTrabajo = resolverAmbito(arbol, AMBITOS.BPCH_CERT, ["D11"])!;
    expect(entraEnAmbito(alcanceDePermiso([inspD11], [], arbol, "bpch.pn.ver", AHORA), conTrabajo)).toBe(true);
  });

  it("ámbito no estricto: el global pasa; raíz inexistente: no se puede evaluar", () => {
    const sam = resolverAmbito(arbol, AMBITOS.SAM)!;
    const calidad: AsignacionAlcance = { rolCodigo: "CALIDAD", alcance: "GLOBAL", unidadId: null, permisos: ["metrologia.ver"] };
    expect(entraEnAmbito(alcanceDePermiso([calidad], [], arbol, "metrologia.ver", AHORA), sam)).toBe(true);
    expect(resolverAmbito(arbol, { raiz: "NOEXISTE" })).toBeNull();
  });
});

describe("AlcanceService · alcance por asignación (Prisma simulado)", () => {
  const prisma: any = {
    unidad: { findMany: jest.fn().mockResolvedValue(NODOS.map((n) => ({ ...n }))) },
    usuarioRol: { findMany: jest.fn() },
    unidadJefe: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const svc = new AlcanceService(prisma);
  const fila = (codigo: string, alcance: string, unidadId: string | null, permisos: string[]) => ({
    id: `${codigo}-${unidadId}`,
    rolId: `rol-${codigo}`,
    unidadId,
    vigenteDesde: new Date("2026-01-01"),
    vigenteHasta: null,
    rol: {
      id: `rol-${codigo}`,
      codigo,
      nombre: codigo,
      nivel: "OPERATIVO",
      alcance,
      aliasDe: null,
      rolPermisos: permisos.map((codigo) => ({ permiso: { codigo } })),
    },
    unidad: unidadId ? { id: unidadId, codigo: unidadId, nombre: unidadId, tipo: "LABORATORIO" } : null,
  });

  beforeEach(() => {
    prisma.usuarioRol.findMany.mockReset();
    prisma.usuarioRol.findMany.mockResolvedValue([
      fila("ANALISTA", "UNIDAD", "LPN", ["ot.ver", "resultado.crear"]),
      fila("COMERCIAL", "GLOBAL", "SVT", ["ot.ver", "cotizacion.anular"]),
    ]);
    svc.invalidarArbol();
  });

  const req = (permisosRuta: string[]) => ({
    user: { sub: "u1", tenantId: "t1", roles: ["ANALISTA", "COMERCIAL"] },
    __permisosRuta: permisosRuta,
  });

  it("filtroUnidades usa el permiso de la ruta", async () => {
    expect(await svc.filtroUnidades(req(["resultado.crear"]))).toEqual(["LPN"]);
    expect(await svc.filtroUnidades(req(["cotizacion.anular"]))).toBeNull();
    expect(await svc.filtroUnidades(req(["ot.ver"]))).toBeNull();
  });

  it("exigirUnidad: captura en otro laboratorio → 403 aunque tenga un rol global", async () => {
    const r = req(["resultado.crear"]);
    await expect(svc.exigirUnidad(r, "LPN")).resolves.toBeUndefined();
    await expect(svc.exigirUnidad(r, "LQC")).rejects.toThrow(/Fuera de su alcance/);
  });

  it("un permiso explícito manda sobre el de la ruta", async () => {
    const r = req(["ot.ver"]);
    expect(await svc.puedeVerUnidad(r, "LQC")).toBe(true);
    expect(await svc.puedeVerUnidad(r, "LQC", "resultado.crear")).toBe(false);
  });

  it("paraRequest refleja el alcance de la ruta y conserva la unión del usuario", async () => {
    const ctx = await svc.paraRequest(req(["resultado.crear"]));
    expect(ctx.esGlobal).toBe(false);
    expect(ctx.unidadIds).toEqual(["LPN"]);
    expect(ctx.usuario.esGlobal).toBe(true);
    expect(ctx.permisosRuta).toEqual(["resultado.crear"]);
  });

  it("ruta sin permiso: alcance por usuario (unión), como antes", async () => {
    expect(await svc.filtroUnidades(req([]))).toBeNull();
  });

  it("entraEnAmbito: D11 cerrado para el analista con rol comercial", async () => {
    const r = await svc.entraEnAmbito(req(["ot.ver"]), "D11");
    expect(r).toEqual({ entra: false, nombre: "Unidad D11" });
  });
});
