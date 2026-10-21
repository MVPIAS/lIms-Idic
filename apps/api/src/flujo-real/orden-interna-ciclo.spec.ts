import { ForbiddenException } from "@nestjs/common";
import {
  erroresEmision,
  erroresRespuesta,
  faltantesCierreOi,
  motivoNoAceptable,
  motivoNoEditable,
  motivoNoRecibible,
  pasoOi,
} from "./orden-interna.reglas";
import { OrdenInternaController } from "./orden-interna";

/**
 * Ciclo de la orden interna (frente r1b · EP-01 2.2, 0.6, 3.7, 5.5; EP-03 3.5;
 * EP-05 4.10): emitir con muestra, requisito y fecha; el destino recibe,
 * responde y cierra; el solicitante da por recibido.
 */
describe("órdenes internas · emisión (EP-01 2.2)", () => {
  const hoy = new Date(2026, 9, 20);
  const ok = { muestraId: "m", muestraDeLaOt: true, requisito: "Cr total ≤ 3 % (punto 4.2)", fechaEnvio: "2026-10-20", fechaOt: new Date(2026, 9, 1), hoy };

  it("con muestra de la OT, requisito y fecha de envío es válida", () => {
    expect(erroresEmision(ok)).toEqual([]);
  });
  it("exige muestra de origen, requisito y fecha", () => {
    const e = erroresEmision({ hoy });
    expect(e.join(" ")).toMatch(/muestra de origen/);
    expect(e.join(" ")).toMatch(/requisito/);
    expect(e.join(" ")).toMatch(/fecha de envío/);
  });
  it("la muestra debe ser de la OT; la fecha no anterior a la OT ni a más de 60 días", () => {
    expect(erroresEmision({ ...ok, muestraDeLaOt: false })).toEqual(["La muestra de origen no es de esta OT."]);
    expect(erroresEmision({ ...ok, fechaEnvio: "2026-09-30" }).join(" ")).toMatch(/anterior a la apertura/);
    expect(erroresEmision({ ...ok, fechaEnvio: "2027-03-01" }).join(" ")).toMatch(/60 días/);
    expect(erroresEmision({ ...ok, fechaEnvio: "no-es-fecha" }).join(" ")).toMatch(/no es válida/);
  });
  it("los nuevos campos solo se editan mientras está abierta", () => {
    expect(motivoNoEditable("abierta", { requisito: "otro" })).toBeNull();
    expect(motivoNoEditable("recibida", { requisito: "otro" })).toMatch(/ya fue recibida/);
    expect(motivoNoEditable("recibida", { fechaEnvio: "2026-10-21" })).toMatch(/ya fue recibida/);
  });
});

describe("órdenes internas · recepción, respuesta y cierre por el destino", () => {
  it("solo se recibe una abierta", () => {
    expect(motivoNoRecibible("abierta")).toBeNull();
    expect(motivoNoRecibible("recibida")).toMatch(/ya fue recibida/);
    expect(motivoNoRecibible("anulada")).toMatch(/anulada/);
  });

  it("la respuesta exige estar recibida, horas y costo directo no negativos", () => {
    expect(erroresRespuesta("recibida", { horas: 2.5, costoDirecto: 45000 })).toEqual([]);
    expect(erroresRespuesta("abierta", { horas: 1, costoDirecto: 1 })).toEqual(["Reciba primero la orden interna."]);
    const e = erroresRespuesta("recibida", { horas: null, costoDirecto: -1 });
    expect(e).toContain("Indique las horas dedicadas.");
    expect(e).toContain("El costo directo no puede ser negativo.");
    expect(erroresRespuesta("recibida", { horas: 10000, costoDirecto: 0 })).toEqual(["Las horas deben estar entre 0 y 9999."]);
  });

  const ensayos = [{ id: "e1", nombre: "Cromo total" }, { id: "e2", nombre: "pH" }];
  const res = (ensayoId: string, estado: string, valor: number | null, observacion: string | null = null) =>
    ({ ensayoId, ensayo: ensayoId, estado, valor, texto: null, observacion });

  it("cierra con respuesta guardada y todos los ensayos capturados", () => {
    expect(
      faltantesCierreOi({ estado: "recibida", respondida: true, ensayos, resultados: [res("e1", "aprobado", 2.1), res("e2", "capturado", 6.8)] }),
    ).toEqual([]);
  });

  it("no cierra sin respuesta, con ensayos sin resultado o sin capturar", () => {
    const f = faltantesCierreOi({ estado: "recibida", respondida: false, ensayos, resultados: [res("e1", "pendiente", null)] });
    expect(f.join(" ")).toMatch(/Guarde la respuesta/);
    expect(f.join(" ")).toMatch(/Cromo total tiene 1 resultado\(s\) sin capturar/);
    expect(f.join(" ")).toMatch(/pH no tiene resultado/);
  });

  it("rechaza un resultado interno en 0,00 sin observación (marcador del LIMS antiguo)", () => {
    const f = faltantesCierreOi({ estado: "recibida", respondida: true, ensayos: [ensayos[0]], resultados: [res("e1", "capturado", 0)] });
    expect(f.join(" ")).toMatch(/0,00 sin observación/);
    expect(
      faltantesCierreOi({ estado: "recibida", respondida: true, ensayos: [ensayos[0]], resultados: [res("e1", "capturado", 0, "< LD (0,05 %)")] }),
    ).toEqual([]);
    // El valor escrito «0,00» no es una explicación.
    const conTexto = { ...res("e1", "capturado", 0), texto: "0,00" };
    expect(faltantesCierreOi({ estado: "recibida", respondida: true, ensayos: [ensayos[0]], resultados: [conTexto] }).join(" ")).toMatch(/0,00 sin observación/);
    const ausente = { ...res("e1", "capturado", 0), texto: "No detectado" };
    expect(faltantesCierreOi({ estado: "recibida", respondida: true, ensayos: [ensayos[0]], resultados: [ausente] })).toEqual([]);
  });

  it("no cierra una orden abierta o ya cerrada", () => {
    expect(faltantesCierreOi({ estado: "abierta", respondida: false, ensayos, resultados: [] })).toEqual(["La orden interna aún no se ha recibido."]);
    expect(faltantesCierreOi({ estado: "cerrada", respondida: true, ensayos, resultados: [] })).toEqual(["La orden interna está cerrada."]);
  });

  it("el solicitante da por recibida solo una cerrada, una vez", () => {
    expect(motivoNoAceptable("cerrada", null)).toBeNull();
    expect(motivoNoAceptable("recibida", null)).toMatch(/aún no ha cerrado/);
    expect(motivoNoAceptable("cerrada", "2026-10-20")).toMatch(/ya se dio por recibida/);
  });

  it("paso del ciclo para la barra de la ficha (1 emitida … 5 dada por recibida)", () => {
    expect(pasoOi({ estado: "abierta" })).toBe(1);
    expect(pasoOi({ estado: "recibida" })).toBe(2);
    expect(pasoOi({ estado: "recibida", respondidaAt: "x" })).toBe(3);
    expect(pasoOi({ estado: "cerrada", respondidaAt: "x" })).toBe(4);
    expect(pasoOi({ estado: "cerrada", aceptadaAt: "x" })).toBe(5);
    expect(pasoOi({ estado: "anulada" })).toBe(0);
  });
});

describe("órdenes internas · alcance del laboratorio de DESTINO", () => {
  const LCC = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const OI = "22222222-2222-2222-2222-222222222222";
  const req = { user: { sub: "u", tenantId: "t" } };
  const crear = (alcanzaDestino: boolean) => {
    const svc = {
      unidadDestino: jest.fn(async () => ({ unidadId: LCC, numero: "OI-2026-0001" })),
      recibir: jest.fn(async () => ({ ok: true })),
      responder: jest.fn(async () => ({ ok: true })),
      cerrar: jest.fn(async () => ({ ok: true })),
    };
    const alcance = {
      exigirUnidad: jest.fn(async (_r: any, unidad: string) => {
        if (!(alcanzaDestino && unidad === LCC)) throw new ForbiddenException("Fuera de su alcance");
      }),
    };
    return { ctl: new OrdenInternaController(svc as any, {} as any, alcance as any, {} as any), svc };
  };

  it("el jefe del laboratorio de destino recibe, responde y cierra", async () => {
    const { ctl, svc } = crear(true);
    await ctl.recibir(OI, req);
    await ctl.responder(OI, { horas: 2, costoDirecto: 30000 }, req);
    await ctl.cerrar(OI, req);
    expect(svc.recibir).toHaveBeenCalled();
    expect(svc.responder).toHaveBeenCalledWith(OI, "t", "u", { horas: 2, costoDirecto: 30000 });
    expect(svc.cerrar).toHaveBeenCalled();
  });

  it("quien no tiene el destino en su alcance: 403 y no cambia nada", async () => {
    const { ctl, svc } = crear(false);
    await expect(ctl.recibir(OI, req)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctl.responder(OI, { horas: 2, costoDirecto: 1 }, req)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctl.cerrar(OI, req)).rejects.toBeInstanceOf(ForbiddenException);
    expect(svc.recibir).not.toHaveBeenCalled();
    expect(svc.cerrar).not.toHaveBeenCalled();
  });

  it("la respuesta valida su forma (horas numéricas, sin campos extra)", async () => {
    const { ctl } = crear(true);
    await expect(ctl.responder(OI, { horas: "dos", costoDirecto: 1 }, req)).rejects.toThrow();
    await expect(ctl.responder(OI, { horas: 1, costoDirecto: 1, estado: "cerrada" }, req)).rejects.toThrow();
  });
});
