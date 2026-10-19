import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { ZodError } from "zod";
import { ProduccionNacionalService } from "./produccion-nacional.service";

/**
 * Producción Nacional · asociar o cambiar la clasificación de un producto de la
 * O/C después de crearla (pauta BPCH, caso P1, paso 4): solo una clasificación
 * aprobada, con motivo, y queda en el historial.
 */
describe("O/C · clasificación del producto después de crearla", () => {
  const OC = "11111111-1111-1111-1111-111111111111";
  const PROD = "22222222-2222-2222-2222-222222222222";
  const APROBADA = "33333333-3333-3333-3333-333333333333";
  const BORRADOR = "44444444-4444-4444-4444-444444444444";

  const crear = (opts: { estadoOc?: string; actual?: string | null; existe?: boolean } = {}) => {
    const ejecutadas: string[] = [];
    const tx = { $executeRawUnsafe: jest.fn(async (sql: string) => { ejecutadas.push(sql); return 1; }) };
    const prisma = {
      $queryRawUnsafe: jest.fn(async (sql: string) => {
        if (sql.includes("FROM bpch_oc_operativa o")) return [{ id: OC, numero: "OC-1", estado: opts.estadoOc ?? "vigente" }];
        if (sql.includes("SELECT clasificacion_id FROM bpch_oc_producto"))
          return opts.existe === false ? [] : [{ clasificacion_id: opts.actual ?? null }];
        return [];
      }),
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const clasificaciones = {
      exigirAprobada: jest.fn(async (_t: string, id: string) => {
        if (id !== APROBADA) throw new BadRequestException("La clasificación CLS-2026-0002 está borrador: solo se puede usar una clasificación aprobada.");
      }),
    };
    const svc = new ProduccionNacionalService(prisma as any, {} as any, {} as any, clasificaciones as any);
    jest.spyOn(svc, "ocDetalle").mockResolvedValue({ id: OC } as any);
    return { svc, ejecutadas };
  };

  it("asocia una aprobada con motivo y la deja en el historial", async () => {
    const { svc, ejecutadas } = crear();
    await svc.cambiarClasificacion("t", OC, PROD, "u", { clasificacionId: APROBADA, motivo: "Clasificación del caso C1" });
    expect(ejecutadas.some((q) => q.includes("UPDATE bpch_oc_producto SET clasificacion_id"))).toBe(true);
    expect(ejecutadas.some((q) => q.includes("INSERT INTO bpch_oc_producto_clasificacion_hist"))).toBe(true);
  });

  it("una clasificación en borrador se rechaza (400) y no cambia nada", async () => {
    const { svc, ejecutadas } = crear();
    await expect(svc.cambiarClasificacion("t", OC, PROD, "u", { clasificacionId: BORRADOR, motivo: "Probar con un borrador" })).rejects.toBeInstanceOf(BadRequestException);
    expect(ejecutadas).toHaveLength(0);
  });

  it("exige motivo", async () => {
    const { svc } = crear();
    await expect(svc.cambiarClasificacion("t", OC, PROD, "u", { clasificacionId: APROBADA, motivo: "x" })).rejects.toBeInstanceOf(ZodError);
  });

  it("la misma clasificación, una O/C no vigente o un producto ajeno: 409 / 404", async () => {
    await expect(crear({ actual: APROBADA }).svc.cambiarClasificacion("t", OC, PROD, "u", { clasificacionId: APROBADA, motivo: "Repetir la misma" })).rejects.toBeInstanceOf(ConflictException);
    await expect(crear({ estadoOc: "cerrada" }).svc.cambiarClasificacion("t", OC, PROD, "u", { clasificacionId: APROBADA, motivo: "O/C cerrada" })).rejects.toBeInstanceOf(ConflictException);
    await expect(crear({ existe: false }).svc.cambiarClasificacion("t", OC, PROD, "u", { clasificacionId: APROBADA, motivo: "Producto ajeno" })).rejects.toBeInstanceOf(NotFoundException);
  });

  it("se puede quitar con motivo", async () => {
    const { svc, ejecutadas } = crear({ actual: APROBADA });
    await svc.cambiarClasificacion("t", OC, PROD, "u", { clasificacionId: null, motivo: "Producto sin clasificar aún" });
    expect(ejecutadas.some((q) => q.includes("INSERT INTO bpch_oc_producto_clasificacion_hist"))).toBe(true);
  });
});
