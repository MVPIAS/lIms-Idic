import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { OtController } from "./ot.controller";

/**
 * Registrar OT respeta el alcance por laboratorio de quien la registra: un perfil
 * con ot.crear acotado a su unidad (p. ej. demo.lqc.planificador) no crea una OT
 * para un laboratorio ajeno. Y el origen Internación ya no se registra a mano.
 */
describe("POST /ot · alcance del laboratorio responsable", () => {
  const LQC = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", codigo: "LQC", nombre: "LQC", tipo: "LABORATORIO" };
  const LPN = { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", codigo: "LPN", nombre: "LPN", tipo: "LABORATORIO" };
  const CLIENTE = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  const crear = () => {
    const labs = { resolverParaAlta: jest.fn(async (_t: string, id: string) => (id === LPN.id ? LPN : LQC)) };
    const alcance = {
      exigirUnidad: jest.fn(async (_req: any, unidad: string) => {
        if (unidad !== LQC.id) throw new ForbiddenException("Fuera de su alcance");
      }),
    };
    const prisma = { cliente: { findFirst: jest.fn(async () => ({ id: CLIENTE })) } };
    const ctl = new OtController(prisma as any, {} as any, alcance as any, labs as any, {} as any);
    return { ctl, alcance };
  };
  const req = { user: { sub: "u", tenantId: "t", permisos: ["ot.crear"] } };

  it("un laboratorio fuera de su alcance: 403 antes de crear nada", async () => {
    const { ctl, alcance } = crear();
    await expect(ctl.crear({ clienteId: CLIENTE, unidadPrincipalId: LPN.id }, req)).rejects.toBeInstanceOf(ForbiddenException);
    expect(alcance.exigirUnidad).toHaveBeenCalledWith(req, LPN.id, expect.stringContaining("LPN"));
  });

  it("origen Internación: 400 (nace al registrar la resolución DGMN)", async () => {
    const { ctl } = crear();
    await expect(ctl.crear({ clienteId: CLIENTE, origenTrabajo: "INTERNACION", resolucion: "17.798-2026-1" }, req)).rejects.toBeInstanceOf(BadRequestException);
  });
});
