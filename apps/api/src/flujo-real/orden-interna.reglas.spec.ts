import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import {
  codigosSucdel,
  erroresContenido,
  motivoNoAnulable,
  motivoNoBorrable,
  motivoNoEditable,
  normalizarEnsayos,
} from "./orden-interna.reglas";
import { OrdenInternaController } from "./orden-interna";

describe("órdenes internas · reglas", () => {
  it("normaliza los ensayos: sin vacíos ni repetidos", () => {
    expect(normalizarEnsayos(["a", " a ", "", "b"])).toEqual(["a", "b"]);
    expect(normalizarEnsayos(undefined)).toEqual([]);
  });

  it("el destino no puede ser el laboratorio responsable de la OT", () => {
    expect(erroresContenido({ destinoLab: "f", destinoEsPrincipal: true })).toHaveLength(1);
    expect(erroresContenido({ destinoLab: "f", destinoEsPrincipal: false })).toHaveLength(0);
  });

  it("los ensayos deben ser del laboratorio de destino", () => {
    const del = new Set(["e1", "e2"]);
    expect(erroresContenido({ destinoLab: "f", ensayos: ["e1"], ensayosDelDestino: del })).toHaveLength(0);
    const e = erroresContenido({ destinoLab: "f", ensayos: ["e1", "x9"], ensayosDelDestino: del });
    expect(e).toHaveLength(1);
    expect(e[0]).toMatch(/1 ensayo\(s\) no son del laboratorio de destino/);
    expect(erroresContenido({ ensayos: ["e1"] })[0]).toMatch(/laboratorio de destino/);
  });

  it("el contenido solo se edita mientras está abierta; el estado avanza de uno en uno", () => {
    expect(motivoNoEditable("abierta", { detalle: "x", ensayos: ["e"] })).toBeNull();
    expect(motivoNoEditable("abierta", { estado: "recibida" })).toBeNull();
    expect(motivoNoEditable("recibida", { estado: "cerrada" })).toBeNull();
    expect(motivoNoEditable("recibida", { detalle: "x" })).toMatch(/ya fue recibida/);
    expect(motivoNoEditable("abierta", { estado: "cerrada" })).toMatch(/No se puede pasar/);
    expect(motivoNoEditable("recibida", { estado: "abierta" })).toMatch(/No se puede pasar/);
    expect(motivoNoEditable("cerrada", { estado: "recibida" })).toMatch(/cerrada/);
    expect(motivoNoEditable("anulada", { detalle: "x" })).toMatch(/anulada/);
    expect(motivoNoEditable("abierta", { estado: "anulada" })).toMatch(/Anular/);
    expect(motivoNoEditable("abierta", { otId: "otra" })).toMatch(/no se cambia/);
    // Estado sin cambio (mismo valor) no es una transición.
    expect(motivoNoEditable("abierta", { estado: "abierta", detalle: "y" })).toBeNull();
  });

  it("anular exige motivo y no aplica a una anulada o cerrada", () => {
    expect(motivoNoAnulable("abierta", "Laboratorio equivocado")).toBeNull();
    expect(motivoNoAnulable("recibida", "Cliente desistió")).toBeNull();
    expect(motivoNoAnulable("abierta", "no")).toMatch(/motivo/);
    expect(motivoNoAnulable("anulada", "Otra vez anular")).toMatch(/ya está anulada/);
    expect(motivoNoAnulable("cerrada", "Se cerró ya")).toMatch(/cerrada/);
  });

  it("solo se borra una orden abierta", () => {
    expect(motivoNoBorrable("abierta")).toBeNull();
    expect(motivoNoBorrable("recibida")).toMatch(/anúlela/);
  });

  it("CODSUCDEL con varios códigos", () => {
    expect(codigosSucdel("7003/7004")).toEqual(["7003", "7004"]);
    expect(codigosSucdel("7003, 7004 ;7005")).toEqual(["7003", "7004", "7005"]);
    expect(codigosSucdel(null)).toEqual([]);
  });
});

describe("órdenes internas · controlador (reglas y alcance)", () => {
  const OT = "11111111-1111-1111-1111-111111111111";
  const OI = "22222222-2222-2222-2222-222222222222";
  const FAM = "44444444-4444-4444-4444-444444444444";
  const E1 = "55555555-5555-5555-5555-555555555555";
  const E2 = "66666666-6666-6666-6666-666666666666";
  const LQC = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const req = { user: { sub: "u", tenantId: "t" } };

  const crear = (opts: { alcanza?: boolean; estado?: string; principal?: boolean; delDestino?: string[] } = {}) => {
    const svc = {
      crear: jest.fn(async (d: any) => ({ id: OI, ...d })),
      actualizar: jest.fn(async () => ({ ok: true })),
      eliminar: jest.fn(async () => ({ ok: true })),
      anular: jest.fn(async () => ({ ok: true })),
      familias: jest.fn(async () => ({ destino_existe: true, destino_es_principal: !!opts.principal, origen: "fam-lqc" })),
      idsEnsayosDe: jest.fn(async (_t: string, _f: string, ids: string[]) => new Set(ids.filter((i) => (opts.delDestino ?? [E1, E2]).includes(i)))),
    };
    const prisma = {
      ordenTrabajo: { findFirst: jest.fn(async () => ({ codigo: "OT-1", unidadPrincipal: LQC })) },
      ordenInterna: { findFirst: jest.fn(async () => ({ otId: OT, estado: opts.estado ?? "abierta", destinoLab: FAM, ensayos: [E1] })) },
    };
    const alcance = {
      exigirUnidad: jest.fn(async () => {
        if (opts.alcanza === false) throw new ForbiddenException("Fuera de su alcance");
      }),
    };
    return { ctl: new OrdenInternaController(svc as any, prisma as any, alcance as any), svc };
  };

  it("crea con destino y ensayos del destino; propone la familia de origen", async () => {
    const { ctl, svc } = crear();
    await ctl.crear({ otId: OT, destinoLab: FAM, ensayos: [E1, E1, E2] }, req);
    expect(svc.crear).toHaveBeenCalledWith(expect.objectContaining({ ensayos: [E1, E2], origenLab: "fam-lqc" }), "t", "u");
  });

  it("rechaza ensayos de otro laboratorio y el destino igual al responsable (400)", async () => {
    const { ctl, svc } = crear({ delDestino: [E1] });
    await expect(ctl.crear({ otId: OT, destinoLab: FAM, ensayos: [E1, E2] }, req)).rejects.toBeInstanceOf(BadRequestException);
    const p = crear({ principal: true });
    await expect(p.ctl.crear({ otId: OT, destinoLab: FAM }, req)).rejects.toBeInstanceOf(BadRequestException);
    expect(svc.crear).not.toHaveBeenCalled();
  });

  it("una orden recibida no cambia de contenido (409) pero sí avanza de estado", async () => {
    const { ctl, svc } = crear({ estado: "recibida" });
    await expect(ctl.actualizar(OI, { detalle: "x" }, req)).rejects.toBeInstanceOf(ConflictException);
    await ctl.actualizar(OI, { estado: "cerrada" }, req);
    expect(svc.actualizar).toHaveBeenCalledTimes(1);
  });

  it("cambiar el destino sin indicar ensayos los vacía", async () => {
    const { ctl, svc } = crear();
    await ctl.actualizar(OI, { destinoLab: "77777777-7777-7777-7777-777777777777" }, req);
    expect(svc.actualizar).toHaveBeenCalledWith(OI, expect.objectContaining({ ensayos: [] }), "t", "u");
  });

  it("anular: exige motivo (400), la OT en el alcance (403) y no repite (409)", async () => {
    const { ctl, svc } = crear();
    await expect(ctl.anular(OI, { motivo: "" }, req)).rejects.toBeInstanceOf(BadRequestException);
    await ctl.anular(OI, { motivo: "Laboratorio equivocado" }, req);
    expect(svc.anular).toHaveBeenCalledWith(OI, "Laboratorio equivocado", "t", "u");
    await expect(crear({ alcanza: false }).ctl.anular(OI, { motivo: "Laboratorio equivocado" }, req)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(crear({ estado: "anulada" }).ctl.anular(OI, { motivo: "Laboratorio equivocado" }, req)).rejects.toBeInstanceOf(ConflictException);
  });

  it("solo se borra una abierta (409 si ya fue recibida)", async () => {
    await expect(crear({ estado: "recibida" }).ctl.eliminar(OI, req)).rejects.toBeInstanceOf(ConflictException);
  });
});
