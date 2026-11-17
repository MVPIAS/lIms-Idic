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
    expect(await svc.resolverInspectores("u", { modalidad: "TERRENO", inspectorIds: [A, B] })).toEqual({ errores: [], ids: [A, B], texto: "A. P. · B. P." });
    expect((await svc.resolverInspectores("u", { modalidad: "TERRENO", inspectorIds: [A] })).errores.join(" ")).toMatch(/dos inspectores/);
    expect((await svc.resolverInspectores("u", { modalidad: "ADMINISTRATIVO", inspectorIds: [A] })).errores).toEqual([]);
  });
  it("rechaza a quien no es inspector de la unidad, salvo que ya estuviera elegido", async () => {
    expect((await svc.resolverInspectores("u", { modalidad: "TERRENO", inspectorIds: [A, C] })).errores.join(" ")).toMatch(/rol Inspector/);
    expect((await svc.resolverInspectores("u", { modalidad: "TERRENO", inspectorIds: [A, C] }, [C])).errores).toEqual([]);
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
