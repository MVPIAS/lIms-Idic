import { BandejaService, filtrarPorPermiso, registrarFuenteBandeja, type ItemBandeja } from "./bandeja.service";

const item = (clave: string, ruta: string, cantidad = 1): ItemBandeja => ({ clave, titulo: clave, descripcion: "", cantidad, ruta, severidad: "warn" });

describe("Mi bandeja · tarjetas que aportan otros módulos (Metrología, EP-04 PX.3)", () => {
  // Las consultas propias valen 0 (Prisma simulado que falla): solo interesan las fuentes.
  const prisma: any = { $queryRawUnsafe: () => Promise.reject(new Error("sin base")) };
  const svc = new BandejaService(prisma);
  const ctx: any = { esGlobal: false, unidadIds: [], usuarioId: "u1", asignacionesVigentes: [] };

  it("las tarjetas de /metrologia exigen metrologia.ver", () => {
    expect(filtrarPorPermiso([item("met", "/metrologia?pendiente=revisar")], ["ot.ver"])).toEqual([]);
    expect(filtrarPorPermiso([item("met", "/metrologia?pendiente=revisar")], ["metrologia.ver"])).toHaveLength(1);
  });

  it("se suman las tarjetas de una fuente registrada (con el req) y una fuente que falla no tumba la bandeja", async () => {
    const vistas: any[] = [];
    registrarFuenteBandeja(async (req) => { vistas.push(req); return [item("met_por_revisar", "/metrologia?pendiente=revisar", 2)]; });
    registrarFuenteBandeja(async () => { throw new Error("falla"); });
    const req = { user: { sub: "u1" } };
    const r = await svc.construir(ctx, "LECTOR", "t1", ["metrologia.ver", "ot.ver"], [], req);
    expect(r.map((x) => x.clave)).toContain("met_por_revisar");
    expect(vistas).toContain(req);
    // Sin el permiso de la pantalla, la tarjeta no aparece.
    const sin = await svc.construir(ctx, "LECTOR", "t1", ["ot.ver"], [], req);
    expect(sin.map((x) => x.clave)).not.toContain("met_por_revisar");
    // Sin req (otros usos de construir) no se consultan las fuentes.
    const sinReq = await svc.construir(ctx, "LECTOR", "t1", ["metrologia.ver"], []);
    expect(sinReq.map((x) => x.clave)).not.toContain("met_por_revisar");
  });
});
