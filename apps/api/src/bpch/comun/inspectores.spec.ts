import { BpchComunService } from "./bpch-comun.service";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";

/** Prisma falso: inspectores de la unidad = A y B; nombres de todos. */
const prisma: any = {
  $queryRawUnsafe: async (sql: string, arg: any) => {
    if (sql.includes("usuario_rol")) return [{ id: A, nombre: "Ana Prueba" }, { id: B, nombre: "Bruno Prueba" }];
    const nombres: Record<string, string> = { [A]: "Ana Prueba", [B]: "Bruno Prueba", [C]: "Carla Prueba" };
    return (arg as string[]).map((id) => ({ id, nombre: nombres[id] }));
  },
};
const svc = new BpchComunService(prisma, {} as any, {} as any);

describe("BPCH-48 · inspectores de Internación y Reinspección", () => {
  it("en terreno exige dos inspectores de la unidad y arma sus iniciales", async () => {
    expect(await svc.resolverInspectores("u", { modalidad: "TERRENO", inspectorIds: [A, B] })).toEqual({ errores: [], modalidad: "TERRENO", ids: [A, B], texto: "A. P. · B. P." });
    expect((await svc.resolverInspectores("u", { modalidad: "TERRENO", inspectorIds: [A] })).errores.join(" ")).toMatch(/dos inspectores/);
    expect((await svc.resolverInspectores("u", { modalidad: "ADMINISTRATIVO", inspectorIds: [A] })).errores).toEqual([]);
  });
  it("rechaza a quien no es inspector de la unidad, salvo que ya estuviera elegido", async () => {
    expect((await svc.resolverInspectores("u", { modalidad: "TERRENO", inspectorIds: [A, C] })).errores.join(" ")).toMatch(/rol Inspector/);
    expect((await svc.resolverInspectores("u", { modalidad: "TERRENO", inspectorIds: [A, C] }, { registrada: true, modalidad: "TERRENO", inspectorIds: [C] })).errores).toEqual([]);
  });
  it("auditoría: un registro anterior a BPCH-48 se guarda sin tocar modalidad ni inspectores y conserva su texto", async () => {
    const antiguo = { registrada: true, modalidad: null, inspectorIds: null, inspectores: "R. R. · M. S." };
    // Actualizar lotes: la pantalla no toca la inspección (o la manda vacía, igual que estaba).
    expect(await svc.resolverInspectores("u", {}, antiguo)).toEqual({ errores: [], modalidad: null, ids: null, texto: "R. R. · M. S." });
    expect(await svc.resolverInspectores("u", { modalidad: null, inspectorIds: [] }, antiguo)).toEqual({ errores: [], modalidad: null, ids: null, texto: "R. R. · M. S." });
    // Si los cambia, se exigen completos.
    expect((await svc.resolverInspectores("u", { modalidad: "TERRENO" }, antiguo)).errores.join(" ")).toMatch(/dos inspectores/);
    // Un registro nuevo (sin inspección registrada) los exige siempre.
    expect((await svc.resolverInspectores("u", {}, { registrada: false })).errores.join(" ")).toMatch(/en terreno/);
    // Uno que ya los tenía: se conservan si la petición no los trae.
    expect(await svc.resolverInspectores("u", {}, { registrada: true, modalidad: "ADMINISTRATIVO", inspectorIds: [A], inspectores: "A. P." })).toEqual({
      errores: [], modalidad: "ADMINISTRATIVO", ids: [A], texto: "A. P.",
    });
  });
  it("la lista de inspectores incluye las unidades ancestras y los roles alias", async () => {
    let sqlVisto = "";
    const p: any = { $queryRawUnsafe: async (sql: string) => { sqlVisto = sql; return []; } };
    await new BpchComunService(p, {} as any, {} as any).inspectoresDeUnidad("u");
    expect(sqlVisto).toMatch(/WITH RECURSIVE linaje/);
    expect(sqlVisto).toMatch(/COALESCE\(r\.alias_de, r\.codigo\) = 'INSPECTOR'/);
  });
  it("la ficha muestra el texto libre antiguo solo si no hay personas elegidas", async () => {
    const f = await svc.fichaInspectores("u", { modalidad: null, inspector_ids: null, inspectores: "R. R. · M. S." });
    expect(f.inspectoresTextoAnterior).toBe("R. R. · M. S.");
    expect(f.inspectoresDisponibles.map((x) => x.id)).toEqual([A, B]);
    const g = await svc.fichaInspectores("u", { modalidad: "TERRENO", inspector_ids: [A, C], inspectores: "A. P. · C. P." });
    expect(g.inspectoresTextoAnterior).toBeNull();
    expect(g.inspectoresDisponibles.find((x) => x.id === C)).toMatchObject({ sinRol: true, nombre: "Carla Prueba" });
  });
});
