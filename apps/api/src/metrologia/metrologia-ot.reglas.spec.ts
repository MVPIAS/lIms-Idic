import { faltantesParaCerrar } from "../ot/plazos";
import {
  calibracionVigente, correlativoDe, documentosDeCalibraciones, etiquetaInstrumento, faltantesInstrumentos, formatearNumero, formatoValido,
  instrumentoDesdeOt, motivoCalibrar, motivoCierreTecnico, motivoDevolucion, motivoEntrega, motivoRecepcion, pasosFicha, siguienteCorrelativo,
  instanteChile, type CalibracionOt, type DatosRecepcion, type InstrumentoOt,
} from "./metrologia-ot.reglas";

const ahora = new Date("2026-10-20T15:00:00Z");
const item = (p: Partial<InstrumentoOt> = {}): InstrumentoOt => ({ id: "i1", numero: 1, descripcion: "Balanza", estado: "por_recibir", ...p });
const cal = (p: Partial<CalibracionOt> = {}): CalibracionOt => ({ id: "c1", instrumentoId: "i1", codigo: "CAL-2026-0001", estado: "borrador", ...p });
const rec = (p: Partial<DatosRecepcion> = {}): DatosRecepcion => ({
  fechaHora: "2026-10-20T10:00", entregadoPor: "Cliente de prueba", estadoFisico: "bueno", ubicacion: "Estante A-1", calibrable: true, ...p,
});

describe("Numeración por laboratorio (EP-04 §6, configurable)", () => {
  it("formato por defecto y relleno: M-3950, PT-0091", () => {
    expect(formatearNumero("{P}-{N}", "M", 3950)).toBe("M-3950");
    expect(formatearNumero(null, "PT", 91, 4)).toBe("PT-0091");
  });
  it("LCPNF-NNN.AA con año de 2 cifras; HT-, ME-, TF- correlativo simple", () => {
    expect(formatearNumero("{P}-{N}.{AA}", "LCPNF", 11, 3, 2026)).toBe("LCPNF-011.26");
    expect(formatearNumero("{P}-{N}", "ME", 1)).toBe("ME-1");
  });
  it("el correlativo anual vuelve a 1 al cambiar de año; el continuo no", () => {
    expect(siguienteCorrelativo({ ultimo: 10, anual: true, anio: 2026 }, 2026)).toEqual({ n: 11, anio: 2026 });
    expect(siguienteCorrelativo({ ultimo: 10, anual: true, anio: 2026 }, 2027)).toEqual({ n: 1, anio: 2027 });
    expect(siguienteCorrelativo({ ultimo: 3949, anual: false, anio: null }, 2027)).toEqual({ n: 3950, anio: null });
  });
  it("lee el correlativo de un número emitido (del año, si el formato lo lleva)", () => {
    expect(correlativoDe("LCPNF-011.26", "{P}-{N}.{AA}", "LCPNF", 2026)).toBe(11);
    expect(correlativoDe("LCPNF-011.25", "{P}-{N}.{AA}", "LCPNF", 2026)).toBeNull();
    expect(correlativoDe("M-3950", "{P}-{N}", "M")).toBe(3950);
    expect(correlativoDe("MX-3950", "{P}-{N}", "M")).toBeNull();
  });
  it("formato válido: lleva {N} y solo comodines conocidos", () => {
    expect(formatoValido("{P}-{N}.{AA}")).toBe(true);
    expect(formatoValido("{P}-")).toBe(false);
    expect(formatoValido("{P}-{N}{X}")).toBe(false);
    expect(formatoValido("{P}-{N}';--")).toBe(false);
  });
});

describe("Recepción del instrumento con custodia (P2.1, P2.2)", () => {
  const ctx = { fechaOt: "2026-10-19", laboratorio: "LMT", ahora };
  it("con todos los datos se recibe", () => expect(motivoRecepcion(item(), rec(), ctx)).toBeNull());
  it("la recepción no puede ser anterior a la fecha de la OT (R15 L2) ni futura", () => {
    expect(motivoRecepcion(item(), rec({ fechaHora: "2026-10-18T10:00" }), ctx)).toMatch(/no puede ser anterior a la fecha de la OT/);
    expect(motivoRecepcion(item(), rec({ fechaHora: "2026-10-25T10:00" }), ctx)).toMatch(/futura/);
  });
  it("estado físico distinto de bueno exige observación; ubicación y quien entrega son obligatorios", () => {
    expect(motivoRecepcion(item(), rec({ estadoFisico: "danado" }), ctx)).toMatch(/Describa/);
    expect(motivoRecepcion(item(), rec({ ubicacion: " " }), ctx)).toMatch(/ubicación/);
    expect(motivoRecepcion(item(), rec({ entregadoPor: "" }), ctx)).toMatch(/quién entrega/);
  });
  it("«¿Se puede calibrar? No» exige el motivo", () => {
    expect(motivoRecepcion(item(), rec({ calibrable: false }), ctx)).toMatch(/por qué no se puede calibrar/);
    expect(motivoRecepcion(item(), rec({ calibrable: false, motivoNoCalibrable: "Display dañado, no enciende" }), ctx)).toBeNull();
  });
  it("LNF exige sentido, acondicionamiento y temperatura", () => {
    const lnf = { ...ctx, laboratorio: "LNF" };
    expect(motivoRecepcion(item(), rec(), lnf)).toMatch(/sentido/);
    expect(motivoRecepcion(item(), rec({ sentido: "T", acondicionamientoH: 24, tempAmbiente: 20.1 }), lnf)).toBeNull();
  });
  it("no se recibe dos veces", () => expect(motivoRecepcion(item({ estado: "recibido" }), rec(), ctx)).toMatch(/ya fue recibido/));
  it("etiqueta de custodia: OT e ítem", () => expect(etiquetaInstrumento("OT-2026-0007", 3)).toBe("OT-2026-0007-I03"));
});

describe("Calibración ligada a la OT (P3.1)", () => {
  it("solo desde un ítem recibido y calibrable, sin otra calibración vigente", () => {
    expect(motivoCalibrar(item(), [])).toMatch(/Primero registre la recepción/);
    expect(motivoCalibrar(item({ estado: "no_apto" }), [])).toMatch(/no calibrable/);
    expect(motivoCalibrar(item({ estado: "recibido" }), [])).toBeNull();
    expect(motivoCalibrar(item({ estado: "recibido" }), [cal()])).toMatch(/ya tiene la calibración/);
    expect(motivoCalibrar(item({ estado: "recibido" }), [cal({ estado: "reemplazada" })])).toBeNull();
    expect(motivoCalibrar({ ...item({ estado: "recibido" }), otEstado: "cerrada" }, [])).toMatch(/cerrada/);
  });
  it("la vigente es la última no reemplazada (la reemisión)", () => {
    expect(calibracionVigente([cal({ id: "a", estado: "emitida" }), cal({ id: "b", estado: "borrador" })], "i1")?.id).toBe("b");
  });
  it("la OT y la recepción mandan sobre lo escrito en la hoja de control", () => {
    const r = instrumentoDesdeOt(
      { item: "otro", ot: "OT-FALSA", cliente: "x", clase: "F1", lugar: "instalaciones" },
      { descripcion: "Balanza", marca: "Sartorius", serie: "S-1", recibidoAt: new Date("2026-10-20T13:00:00Z") },
      { codigo: "OT-2026-0007", fechaOt: "2026-10-19", cliente: "Cliente de prueba" },
    );
    expect(r).toMatchObject({ item: "Balanza", marca: "Sartorius", serie: "S-1", ot: "OT-2026-0007", fechaOt: "2026-10-19", fechaRecepcion: "2026-10-20", cliente: "Cliente de prueba", clase: "F1" });
  });
});

describe("Entrega del certificado y devolución del instrumento (P8.1, P8.2)", () => {
  const emitida = cal({ estado: "emitida", numeroCertificado: "M-3950", emitidoAt: "2026-10-19T12:00:00Z" });
  it("solo un certificado emitido, una vez y con fecha no anterior a la emisión", () => {
    expect(motivoEntrega(cal(), ahora, ahora)).toMatch(/Solo se entrega un certificado emitido/);
    expect(motivoEntrega(emitida, ahora, ahora)).toBeNull();
    expect(motivoEntrega({ ...emitida, entregadoAt: "2026-10-20" }, ahora, ahora)).toMatch(/ya está registrada/);
    expect(motivoEntrega(emitida, new Date("2026-10-10T12:00:00Z"), ahora)).toMatch(/anterior a la emisión/);
    expect(motivoEntrega(emitida, new Date("2026-10-30T12:00:00Z"), ahora)).toMatch(/futura/);
  });
  const dev = { fechaHora: "2026-10-20T11:00", recibidoPor: "Cliente de prueba", estadoFisico: "bueno" };
  it("el instrumento calibrado se devuelve con su certificado emitido", () => {
    const i = item({ estado: "recibido", recibidoAt: "2026-10-19T12:00:00Z" });
    expect(motivoDevolucion(i, [cal({ estado: "en_firma" })], dev, ahora)).toMatch(/certificado emitido/);
    expect(motivoDevolucion(i, [], dev, ahora)).toMatch(/aún no tiene calibración/);
    expect(motivoDevolucion(i, [emitida], dev, ahora)).toBeNull();
  });
  it("el no calibrable se devuelve sin certificado; nunca antes de recibirlo ni dos veces", () => {
    expect(motivoDevolucion(item({ estado: "no_apto" }), [], dev, ahora)).toBeNull();
    expect(motivoDevolucion(item(), [], dev, ahora)).toMatch(/no está en custodia/);
    expect(motivoDevolucion(item({ estado: "devuelto" }), [], dev, ahora)).toMatch(/ya fue devuelto/);
    expect(motivoDevolucion(item({ estado: "no_apto" }), [], { ...dev, recibidoPor: "" }, ahora)).toMatch(/quién recibe/);
  });
});

describe("Cierre de una OT de calibración (P9.1, P9.2)", () => {
  const entregada = cal({ estado: "emitida", numeroCertificado: "M-3950", entregadoAt: "2026-10-20" });
  it("el certificado emitido y entregado cuenta como documento: no pide «informes»", () => {
    expect(faltantesParaCerrar({ estado: "en_analisis", documentos: documentosDeCalibraciones([entregada]), resultadosNoAprobados: 0 })).toEqual([]);
  });
  it("un borrador o un certificado sin entregar impiden cerrar", () => {
    expect(faltantesParaCerrar({ estado: "en_analisis", documentos: documentosDeCalibraciones([cal()]), resultadosNoAprobados: 0 }).join(" ")).toMatch(/borrador/);
    expect(faltantesParaCerrar({ estado: "en_analisis", documentos: documentosDeCalibraciones([{ ...entregada, entregadoAt: null }]), resultadosNoAprobados: 0 }).join(" ")).toMatch(/falta registrar su entrega/);
  });
  it("las reemplazadas no cuentan", () => expect(documentosDeCalibraciones([cal({ estado: "reemplazada" })])).toEqual([]));
  it("instrumentos: recibidos, calibrados y (si el parámetro lo exige) devueltos", () => {
    expect(faltantesInstrumentos([item()], [], true)).toEqual(["El ítem 1 (Balanza) no se ha recibido."]);
    expect(faltantesInstrumentos([item({ estado: "recibido" })], [], false)).toEqual(["El ítem 1 (Balanza) no tiene calibración."]);
    expect(faltantesInstrumentos([item({ estado: "recibido" })], [entregada], true).join(" ")).toMatch(/sigue en custodia/);
    expect(faltantesInstrumentos([item({ estado: "recibido" })], [entregada], false)).toEqual([]);
    expect(faltantesInstrumentos([item({ estado: "devuelto" }), item({ id: "i2", estado: "anulado" })], [entregada], true)).toEqual([]);
  });
  it("cierre técnico: todos los ítems con certificado emitido o no aptos", () => {
    expect(motivoCierreTecnico("en_analisis", [], [])).toMatch(/no tiene instrumentos/);
    expect(motivoCierreTecnico("en_analisis", [item({ estado: "recibido" })], [cal({ estado: "en_firma" })])).toMatch(/ítem 1/);
    expect(motivoCierreTecnico("en_analisis", [item({ estado: "recibido" }), item({ id: "i2", numero: 2, estado: "no_apto" })], [entregada])).toBeNull();
    expect(motivoCierreTecnico("finalizada", [item({ estado: "recibido" })], [entregada])).toMatch(/ya está finalizada/);
  });
});

describe("Barra de 6 pasos de la ficha (maqueta de Metrología)", () => {
  const actual = (b: ReturnType<typeof pasosFicha>) => b.find((p) => p.estado === "actual")?.paso ?? null;
  it("borrador calculado: falta la revisión", () =>
    expect(actual(pasosFicha({ estado: "borrador", calculada: true, recibido: true, entregado: false }))).toBe("Revisión Jefe Lab."));
  it("devuelta al metrólogo: vuelve a Toma de datos", () =>
    expect(actual(pasosFicha({ estado: "borrador", calculada: true, recibido: true, entregado: false, devuelta: true }))).toBe("Toma de datos"));
  it("en firma: Firma y emisión; emitida sin entregar: Entrega; entregada: todo hecho", () => {
    expect(actual(pasosFicha({ estado: "en_firma", calculada: true, recibido: true, entregado: false }))).toBe("Firma y emisión");
    expect(actual(pasosFicha({ estado: "emitida", calculada: true, recibido: true, entregado: false }))).toBe("Entrega");
    expect(pasosFicha({ estado: "emitida", calculada: true, recibido: true, entregado: true }).every((p) => p.estado === "hecho")).toBe(true);
  });
});

describe("Fecha-hora de pantalla en hora de Chile (servidor en cualquier zona)", () => {
  it("«AAAA-MM-DDTHH:mm» se lee en America/Santiago (verano: UTC-3; invierno: UTC-4)", () => {
    expect(new Date(instanteChile("2026-10-20T10:00")).toISOString()).toBe("2026-10-20T13:00:00.000Z");
    expect(new Date(instanteChile("2026-07-20T10:00")).toISOString()).toBe("2026-07-20T14:00:00.000Z");
  });
  it("con zona explícita se respeta; texto no válido → NaN", () => {
    expect(new Date(instanteChile("2026-10-20T10:00:00Z")).toISOString()).toBe("2026-10-20T10:00:00.000Z");
    expect(Number.isNaN(instanteChile("ayer"))).toBe(true);
  });
});
