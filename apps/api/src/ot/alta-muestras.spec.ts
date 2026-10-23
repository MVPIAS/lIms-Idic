import { BadRequestException } from "@nestjs/common";
import { esElementoGenerico, muestrasDeAlta, type ElementoAlta } from "./alta-muestras";
import { OtController } from "./ot.controller";

describe("Registrar OT con sus muestras (B-001, B-011)", () => {
  const PRODUCTO: ElementoAlta = { id: "11111111-1111-1111-1111-111111111111", nombre: "Nitrato de Amonio", generico: false };
  const LAB: ElementoAlta = { id: "22222222-2222-2222-2222-222222222222", nombre: "Lab. Materiales Energéticos", generico: true };
  const elementos = new Map([PRODUCTO, LAB].map((e) => [e.id, e]));

  it("el subgrupo «Sub Grupo IDIC» marca el elemento genérico del laboratorio", () => {
    expect(esElementoGenerico("Sub Grupo IDIC")).toBe(true);
    expect(esElementoGenerico(" sub grupo idic ")).toBe(true);
    expect(esElementoGenerico("Explosivos")).toBe(false);
    expect(esElementoGenerico(null)).toBe(false);
  });

  it("producto: la descripción es el nombre del producto, sin códigos de método", () => {
    const r = muestrasDeAlta([{ catElementoId: PRODUCTO.id, metodoIds: ["a", "b", "a"] }], elementos);
    expect(r.errores).toEqual([]);
    expect(r.muestras[0]).toEqual({ nombre: "Nitrato de Amonio", catElementoId: PRODUCTO.id, metodoIds: ["a", "b"] });
  });

  it("elemento del laboratorio: nunca «Lab. X [códigos]»; sin descripción escrita no se registra", () => {
    const sin = muestrasDeAlta([{ catElementoId: LAB.id, metodoIds: ["175", "177"] }], elementos);
    expect(sin.errores[0]).toMatch(/escriba la descripción/);
    const con = muestrasDeAlta([{ catElementoId: LAB.id, nombre: "Testigo nitrocelulosa lote 4", metodoIds: ["175"] }], elementos);
    expect(con.errores).toEqual([]);
    // El elemento genérico no se guarda como producto de la muestra.
    expect(con.muestras[0]).toEqual({ nombre: "Testigo nitrocelulosa lote 4", metodoIds: ["175"] });
  });

  it("sin elemento (métodos del laboratorio o de la E.T.): la descripción es obligatoria", () => {
    expect(muestrasDeAlta([{ metodoIds: ["x"] }], elementos).errores).toHaveLength(1);
    expect(muestrasDeAlta([{ nombre: "Bota de cuero", metodoIds: ["x"] }], elementos).errores).toEqual([]);
  });

  it("elemento inexistente: error", () => {
    expect(muestrasDeAlta([{ catElementoId: "33333333-3333-3333-3333-333333333333", nombre: "x", metodoIds: [] }], elementos).errores[0]).toMatch(/no existe/);
  });

  describe("POST /ot", () => {
    const LQC = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", codigo: "LQC", nombre: "LQC", tipo: "LABORATORIO" };
    const CLIENTE = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const req = { user: { sub: "u", tenantId: "t", permisos: ["ot.crear"] } };
    const montar = (registrar: jest.Mock) => {
      const tx = { ordenTrabajo: { create: jest.fn(async () => ({ id: "ot-1", codigo: "OT-2026-0001" })) }, $executeRawUnsafe: jest.fn() };
      const prisma = {
        cliente: { findFirst: jest.fn(async () => ({ id: CLIENTE })) },
        $queryRawUnsafe: jest.fn(async (sql: string) =>
          sql.includes("FROM cat_elemento") ? [{ id: PRODUCTO.id, nombre: PRODUCTO.nombre, subgrupo: "Explosivos" }] : [],
        ),
        $transaction: jest.fn(async (fn: (t: any) => any) => fn(tx)),
        ordenTrabajo: { findUnique: jest.fn(async () => ({ id: "ot-1" })) },
        $executeRawUnsafe: jest.fn(),
      };
      const labs = { resolverParaAlta: jest.fn(async () => LQC), fijar: jest.fn() };
      const alcance = { exigirUnidad: jest.fn() };
      const ctl = new OtController(prisma as any, {} as any, alcance as any, labs as any, {} as any, {} as any, { registrar } as any);
      (ctl as any).generarCodigo = async () => "OT-2026-0001";
      return { ctl, tx, prisma };
    };

    it("crea las muestras dentro de la MISMA transacción que la OT (si fallan, no queda la OT)", async () => {
      const registrar = jest.fn(async () => ({ muestras: [] }));
      const { ctl, tx } = montar(registrar);
      await ctl.crear({ clienteId: CLIENTE, unidadPrincipalId: LQC.id, muestras: [{ catElementoId: PRODUCTO.id, metodoIds: [] }] }, req);
      expect(registrar).toHaveBeenCalledWith("ot-1", { muestras: [{ nombre: PRODUCTO.nombre, catElementoId: PRODUCTO.id, metodoIds: [] }] }, "t", req, tx);
    });

    it("un error al registrar las muestras se propaga (la transacción se deshace)", async () => {
      const registrar = jest.fn(async () => { throw new BadRequestException("Muestra 1: elija al menos un método."); });
      const { ctl } = montar(registrar);
      await expect(
        ctl.crear({ clienteId: CLIENTE, unidadPrincipalId: LQC.id, muestras: [{ catElementoId: PRODUCTO.id, metodoIds: [] }] }, req),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("descripción que falta: 400 antes de crear la OT", async () => {
      const registrar = jest.fn();
      const { ctl, prisma } = montar(registrar);
      await expect(ctl.crear({ clienteId: CLIENTE, unidadPrincipalId: LQC.id, muestras: [{ metodoIds: ["dddddddd-dddd-dddd-dddd-dddddddddddd"] }] }, req)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
