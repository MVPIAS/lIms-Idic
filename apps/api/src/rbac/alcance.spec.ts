import {
  NodoUnidad,
  calcularAlcance,
  cadenaAncestros,
  construirArbol,
  descendientes,
  esDescendiente,
  esVigente,
  perfilDe,
} from "./alcance";
import { AlcanceService } from "./alcance.service";

/** Árbol IDIC reducido: DIR → DQO → SQU → {LQC, LME}; DQO → SAL → LQA; DIR → DSA → SAM → LMT; DIR → DGC. */
const N = (id: string, padreId: string | null, tipo: string): NodoUnidad => ({
  id,
  padreId,
  codigo: id,
  nombre: `Unidad ${id}`,
  tipo,
  activa: true,
});
const NODOS: NodoUnidad[] = [
  N("DIR", null, "DIRECCION"),
  N("DQO", "DIR", "DEPARTAMENTO"),
  N("SQU", "DQO", "SECCION"),
  N("LQC", "SQU", "LABORATORIO"),
  N("LME", "SQU", "LABORATORIO"),
  N("SAL", "DQO", "SECCION"),
  N("LQA", "SAL", "LABORATORIO"),
  N("DSA", "DIR", "DEPARTAMENTO"),
  N("SAM", "DSA", "SECCION"),
  N("LMT", "SAM", "LABORATORIO"),
  N("DGC", "DIR", "APOYO"),
];
const arbol = construirArbol(NODOS);
const AHORA = new Date("2026-10-08T12:00:00Z");
const ordenar = (l: string[]) => [...l].sort();

describe("alcance · árbol", () => {
  it("descendientes incluye la propia unidad y toda la descendencia", () => {
    expect(ordenar(descendientes(arbol, "DQO"))).toEqual(ordenar(["DQO", "SQU", "LQC", "LME", "SAL", "LQA"]));
    expect(ordenar(descendientes(arbol, "SQU", false))).toEqual(["LME", "LQC"]);
    expect(descendientes(arbol, "LQC")).toEqual(["LQC"]);
    expect(descendientes(arbol, "NOEXISTE")).toEqual([]);
  });

  it("cadenaAncestros sube hasta la raíz", () => {
    expect(cadenaAncestros(arbol, "LMT").map((n) => n.id)).toEqual(["LMT", "SAM", "DSA", "DIR"]);
  });

  it("tolera ciclos en los datos sin colgarse", () => {
    const conCiclo = construirArbol([N("A", "B", "SECCION"), N("B", "A", "SECCION")]);
    expect(ordenar(descendientes(conCiclo, "A"))).toEqual(["A", "B"]);
    expect(cadenaAncestros(conCiclo, "A").map((n) => n.id)).toEqual(["A", "B"]);
  });

  it("esDescendiente detecta ciclos potenciales al mover unidades", () => {
    expect(esDescendiente(arbol, "DQO", "LQA")).toBe(true);
    expect(esDescendiente(arbol, "LQA", "DQO")).toBe(false);
  });
});

describe("alcance · vigencia", () => {
  it("sin fechas = vigente", () => {
    expect(esVigente({}, AHORA)).toBe(true);
  });
  it("desde en el futuro = no vigente", () => {
    expect(esVigente({ vigenteDesde: "2026-11-01" }, AHORA)).toBe(false);
  });
  it("hasta en el pasado = no vigente; hasta futuro = vigente", () => {
    expect(esVigente({ vigenteHasta: "2026-10-01" }, AHORA)).toBe(false);
    expect(esVigente({ vigenteDesde: "2026-01-01", vigenteHasta: "2026-12-31" }, AHORA)).toBe(true);
  });
});

describe("alcance · calcularAlcance", () => {
  it("UNIDAD → solo la unidad", () => {
    const r = calcularAlcance([{ rolCodigo: "ANALISTA", alcance: "UNIDAD", unidadId: "LQC" }], [], arbol, AHORA);
    expect(r).toEqual({ esGlobal: false, unidadIds: ["LQC"] });
  });

  it("DESCENDENCIA → unidad + descendientes (Jefe de Sección / Depto.)", () => {
    const r = calcularAlcance([{ rolCodigo: "JEFE_SECCION", alcance: "DESCENDENCIA", unidadId: "SQU" }], [], arbol, AHORA);
    expect(r.esGlobal).toBe(false);
    expect(ordenar(r.unidadIds)).toEqual(["LME", "LQC", "SQU"]);
  });

  it("unión de varias asignaciones", () => {
    const r = calcularAlcance(
      [
        { rolCodigo: "ANALISTA", alcance: "UNIDAD", unidadId: "LQA" },
        { rolCodigo: "JEFE_SECCION", alcance: "DESCENDENCIA", unidadId: "SAM" },
      ],
      [],
      arbol,
      AHORA,
    );
    expect(ordenar(r.unidadIds)).toEqual(["LMT", "LQA", "SAM"]);
  });

  it("GLOBAL → todas (esGlobal) aunque haya otras asignaciones", () => {
    const r = calcularAlcance(
      [
        { rolCodigo: "ANALISTA", alcance: "UNIDAD", unidadId: "LQA" },
        { rolCodigo: "CALIDAD", alcance: "GLOBAL", unidadId: null },
      ],
      [],
      arbol,
      AHORA,
    );
    expect(r).toEqual({ esGlobal: true, unidadIds: [] });
  });

  it("SUPERADMIN / ADMIN / DIRECTOR son globales aunque la BD diga otra cosa", () => {
    for (const rolCodigo of ["SUPERADMIN", "ADMIN", "DIRECTOR"]) {
      const r = calcularAlcance([{ rolCodigo, alcance: "UNIDAD", unidadId: "LQC" }], [], arbol, AHORA);
      expect(r.esGlobal).toBe(true);
    }
  });

  it("alias legado JEFELAB se comporta como JEFE_LAB (UNIDAD) si la BD no trae alcance", () => {
    const r = calcularAlcance([{ rolCodigo: "JEFELAB", unidadId: "LQC" }], [], arbol, AHORA);
    expect(r).toEqual({ esGlobal: false, unidadIds: ["LQC"] });
  });

  it("asignación legada de rol acotado SIN unidad = global (compatibilidad con el JWT antiguo)", () => {
    const r = calcularAlcance([{ rolCodigo: "ANALISTA", alcance: "UNIDAD", unidadId: null }], [], arbol, AHORA);
    expect(r.esGlobal).toBe(true);
  });

  it("ignora asignaciones vencidas o futuras", () => {
    const r = calcularAlcance(
      [
        { rolCodigo: "CALIDAD", alcance: "GLOBAL", unidadId: null, vigenteHasta: "2026-09-30" },
        { rolCodigo: "ANALISTA", alcance: "UNIDAD", unidadId: "LME", vigenteDesde: "2027-01-01" },
        { rolCodigo: "ANALISTA", alcance: "UNIDAD", unidadId: "LQC" },
      ],
      [],
      arbol,
      AHORA,
    );
    expect(r).toEqual({ esGlobal: false, unidadIds: ["LQC"] });
  });

  it("jefaturas (unidad_jefe) dan la unidad + su descendencia", () => {
    const r = calcularAlcance([], [{ unidadId: "SAL", rol: "subrogante" }], arbol, AHORA);
    expect(ordenar(r.unidadIds)).toEqual(["LQA", "SAL"]);
  });

  it("sin asignaciones → nada visible", () => {
    expect(calcularAlcance([], [], arbol, AHORA)).toEqual({ esGlobal: false, unidadIds: [] });
  });
});

describe("alcance · perfil", () => {
  it("elige el perfil de mayor jerarquía", () => {
    expect(
      perfilDe(
        [
          { rolCodigo: "ANALISTA", unidadId: "LQC" },
          { rolCodigo: "JEFE_LAB", unidadId: "LQA" },
        ],
        [],
        arbol,
        AHORA,
      ),
    ).toBe("JEFE_LAB");
    expect(perfilDe([{ rolCodigo: "SUPERADMIN", unidadId: null }], [], arbol, AHORA)).toBe("ADMIN");
    expect(perfilDe([{ rolCodigo: "COBRANZA", unidadId: null }], [], arbol, AHORA)).toBe("FINANZAS");
    expect(perfilDe([{ rolCodigo: "ANALISTA_SR", unidadId: "LQC" }], [], arbol, AHORA)).toBe("REVISOR");
  });

  it("la jefatura de un departamento implica perfil JEFE_DEPTO", () => {
    expect(perfilDe([{ rolCodigo: "ANALISTA", unidadId: "LQC" }], [{ unidadId: "DQO" }], arbol, AHORA)).toBe("JEFE_DEPTO");
  });

  it("rol personalizado usa su nivel; sin roles → LECTOR", () => {
    expect(perfilDe([{ rolCodigo: "AUDITOR_EXT", nivel: "SOPORTE", unidadId: null }], [], arbol, AHORA)).toBe("LECTOR");
    expect(perfilDe([{ rolCodigo: "COORD_X", nivel: "JEFATURA", unidadId: "LQC" }], [], arbol, AHORA)).toBe("JEFE_LAB");
    expect(perfilDe([], [], arbol, AHORA)).toBe("LECTOR");
  });
});

describe("AlcanceService (Prisma simulado)", () => {
  const unidades = NODOS.map((n) => ({ ...n }));
  const prisma: any = {
    unidad: { findMany: jest.fn().mockResolvedValue(unidades) },
    usuarioRol: { findMany: jest.fn() },
    unidadJefe: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const svc = new AlcanceService(prisma);

  beforeEach(() => {
    prisma.usuarioRol.findMany.mockReset();
    svc.invalidarArbol();
  });

  const fila = (codigo: string, alcance: string, unidadId: string | null, extra: any = {}) => ({
    id: `${codigo}-${unidadId}`,
    rolId: `rol-${codigo}`,
    unidadId,
    vigenteDesde: new Date("2026-01-01"),
    vigenteHasta: null,
    rol: { id: `rol-${codigo}`, codigo, nombre: codigo, nivel: "OPERATIVO", alcance, aliasDe: null },
    unidad: unidadId ? { id: unidadId, codigo: unidadId, nombre: unidadId, tipo: "LABORATORIO" } : null,
    ...extra,
  });

  it("filtroUnidades: Jefe de Depto. ve su departamento completo", async () => {
    prisma.usuarioRol.findMany.mockResolvedValue([fila("JEFE_DEPTO", "DESCENDENCIA", "DSA")]);
    const req: any = { user: { sub: "u1", tenantId: "t1", roles: ["JEFE_DEPTO"] } };
    expect(ordenar((await svc.filtroUnidades(req))!)).toEqual(["DSA", "LMT", "SAM"]);
    expect((await svc.paraRequest(req)).perfil).toBe("JEFE_DEPTO");
    // memoizado por request: una sola carga de asignaciones
    await svc.filtroUnidades(req);
    expect(prisma.usuarioRol.findMany).toHaveBeenCalledTimes(1);
  });

  it("filtroUnidades: global → null (sin filtro)", async () => {
    prisma.usuarioRol.findMany.mockResolvedValue([fila("DIRECTOR", "GLOBAL", null)]);
    const req: any = { user: { sub: "u2", tenantId: "t1", roles: ["DIRECTOR"] } };
    expect(await svc.filtroUnidades(req)).toBeNull();
    expect(await svc.puedeVerUnidad(req, "LQC")).toBe(true);
  });

  it("SUPERADMIN en el token es global aunque no tenga filas en BD", async () => {
    prisma.usuarioRol.findMany.mockResolvedValue([]);
    const req: any = { user: { sub: "u3", tenantId: "t1", roles: ["SUPERADMIN"] } };
    expect(await svc.filtroUnidades(req)).toBeNull();
  });

  it("exigirUnidad lanza 403 fuera de alcance", async () => {
    prisma.usuarioRol.findMany.mockResolvedValue([fila("ANALISTA", "UNIDAD", "LQC")]);
    const req: any = { user: { sub: "u4", tenantId: "t1", roles: ["ANALISTA"] } };
    await expect(svc.exigirUnidad(req, "LQC")).resolves.toBeUndefined();
    await expect(svc.exigirUnidad(req, "LMT")).rejects.toThrow(/Fuera de su alcance/);
    await expect(svc.exigirUnidad(req, null)).rejects.toThrow(/Fuera de su alcance/);
  });
});
