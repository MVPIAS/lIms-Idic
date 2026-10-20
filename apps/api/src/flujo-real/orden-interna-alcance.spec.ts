import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { OrdenInternaController } from "./flujo-real.module";

/**
 * Revisión de seguridad r3: una orden interna da acceso a la OT al laboratorio de
 * destino, así que solo la crea, cambia o borra quien tiene la OT de origen en su
 * alcance por laboratorio. (Los perfiles demo con ot.crear tienen alcance global,
 * por eso la regla se prueba aquí con el alcance simulado.)
 */
describe("órdenes internas · alcance sobre la OT de origen", () => {
  const OT = "11111111-1111-1111-1111-111111111111";
  const LQC = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const crearCtl = (alcanzaLqc: boolean) => {
    const svc = { crear: jest.fn(async (d: any) => ({ id: "oi", ...d })), actualizar: jest.fn(async () => ({ ok: true })), eliminar: jest.fn(async () => ({ ok: true })) };
    const prisma = {
      ordenTrabajo: { findFirst: jest.fn(async ({ where }: any) => (where.id === OT ? { codigo: "OT-1", unidadPrincipal: LQC } : null)) },
      ordenInterna: { findFirst: jest.fn(async () => ({ otId: OT })) },
      muestra: { findFirst: jest.fn(async () => ({ otId: OT })) },
    };
    const alcance = {
      exigirUnidad: jest.fn(async (_req: any, unidad: string) => {
        if (!(alcanzaLqc && unidad === LQC)) throw new ForbiddenException("Fuera de su alcance");
      }),
    };
    return { ctl: new OrdenInternaController(svc as any, prisma as any, alcance as any), svc };
  };
  const req = { user: { sub: "u", tenantId: "t" } };
  // Datos obligatorios de la emisión (EP-01 2.2): muestra de origen, requisito y fecha de envío.
  const emision = { muestraId: "44444444-4444-4444-4444-444444444444", requisito: "Cr ≤ 3 % (punto 4.2)", fechaEnvio: new Date().toISOString().slice(0, 10) };

  it("quien tiene la OT en su alcance crea, cambia y borra", async () => {
    const { ctl, svc } = crearCtl(true);
    await ctl.crear({ otId: OT, detalle: "Cromo en cuero", ...emision }, req);
    await ctl.actualizar("22222222-2222-2222-2222-222222222222", { detalle: "x" }, req);
    await ctl.eliminar("22222222-2222-2222-2222-222222222222", req);
    expect(svc.crear).toHaveBeenCalled();
    expect(svc.actualizar).toHaveBeenCalled();
    expect(svc.eliminar).toHaveBeenCalled();
  });
  it("con ot.crear pero sin la OT en su alcance: 403 y no se crea nada", async () => {
    const { ctl, svc } = crearCtl(false);
    await expect(ctl.crear({ otId: OT }, req)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctl.actualizar("22222222-2222-2222-2222-222222222222", { detalle: "x" }, req)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctl.eliminar("22222222-2222-2222-2222-222222222222", req)).rejects.toBeInstanceOf(ForbiddenException);
    expect(svc.crear).not.toHaveBeenCalled();
  });
  it("una OT de otro tenant o inexistente: 404", async () => {
    const { ctl } = crearCtl(true);
    await expect(ctl.crear({ otId: "33333333-3333-3333-3333-333333333333" }, req)).rejects.toBeInstanceOf(NotFoundException);
  });
});
