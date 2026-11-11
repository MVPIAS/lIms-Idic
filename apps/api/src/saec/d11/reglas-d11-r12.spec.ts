import { avanceD11, erroresCertificado, erroresDevolucion, erroresLiberar, erroresPendiente, etapaArma, faltantesCierreD11, type EstadoArma } from "./reglas-d11";

const cfg = { acunacionCip: false };
const arma = (p: Partial<EstadoArma> = {}): EstadoArma => ({
  clase: "arma",
  permisibilidad: "permitida",
  camino: "directo",
  ensayos: 2,
  pendientes: 0,
  aprobados: 2,
  veredicto: "cumple",
  acunada: false,
  certificado: null,
  entregada: false,
  ...p,
});

describe("D11 · armas pendientes de nueva resolución (R12)", () => {
  it("el arma pendiente no se certifica y su etapa lo dice", () => {
    const a = arma({ pendiente: true });
    expect(etapaArma(a, cfg)).toBe("pendiente_resolucion");
    expect(erroresCertificado(a, cfg)[0]).toMatch(/nueva resolución/);
  });
  it("no bloquea la entrega ni el cierre de las demás", () => {
    const av = avanceD11({ programada: true, llegada: true, actaFirmada: true, recibidas: 2, armas: [arma({ entregada: true, certificado: { estado: "oficial" } }), arma({ pendiente: true })] }, cfg);
    const entrega = av.pasos.find((p) => p.clave === "entrega")!;
    expect(entrega.estado).toBe("hecho");
    expect(entrega.detalle).toMatch(/1 pendiente de nueva resolución/);
    expect(faltantesCierreD11([{ muestra: "M1", entregada: false, prohibida: false, pendiente: true }])).toEqual([]);
    expect(faltantesCierreD11([{ muestra: "M1", entregada: false, prohibida: false }])).toHaveLength(1);
  });
  it("dejar pendiente exige motivo; «otro» exige detalle; no si ya se entregó", () => {
    const h = { entregada: false, pendiente: false, certificadoEntregado: false };
    expect(erroresPendiente(h, "falla", null)).toEqual([]);
    expect(erroresPendiente(h, "xx", null)).toHaveLength(1);
    expect(erroresPendiente(h, "otro", "ab")).toHaveLength(1);
    expect(erroresPendiente({ ...h, entregada: true }, "falla", null)).toHaveLength(1);
    expect(erroresPendiente({ ...h, pendiente: true }, "falla", null)).toHaveLength(1);
  });
  it("liberar exige la nueva resolución y la OT abierta", () => {
    expect(erroresLiberar({ pendiente: true }, "PRUEBA 123", true)).toEqual([]);
    expect(erroresLiberar({ pendiente: true }, " ", true)).toHaveLength(1);
    expect(erroresLiberar({ pendiente: true }, "R-1", false)).toHaveLength(1);
    expect(erroresLiberar({ pendiente: false }, "R-1", true)).toHaveLength(1);
  });
});

describe("D11 · devolución técnica en cualquier paso (R12)", () => {
  it("exige motivo y que el arma no se haya entregado", () => {
    expect(erroresDevolucion({ entregada: false, certificadoEntregado: false }, "Rehacer la prueba de funcionamiento")).toEqual([]);
    expect(erroresDevolucion({ entregada: false, certificadoEntregado: false }, "x")).toHaveLength(1);
    expect(erroresDevolucion({ entregada: true, certificadoEntregado: false }, "motivo largo")).toHaveLength(1);
    expect(erroresDevolucion({ entregada: false, certificadoEntregado: true }, "motivo largo")).toHaveLength(1);
  });
});
