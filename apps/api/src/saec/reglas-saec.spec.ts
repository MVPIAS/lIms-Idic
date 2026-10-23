import { erroresIngresoEvidencia, erroresSolicitudPrestamo, erroresTransicionCaso, prestamoVencido } from "./reglas-saec";

describe("EP-11 11.35 · transiciones del caso SAEC", () => {
  const ok = { evidenciasPrestadas: 0 };
  it("abierto → en proceso → cerrado → archivado", () => {
    expect(erroresTransicionCaso("abierto", "en_proceso", ok)).toEqual([]);
    expect(erroresTransicionCaso("en_proceso", "cerrado", ok)).toEqual([]);
    expect(erroresTransicionCaso("cerrado", "archivado", ok)).toEqual([]);
    expect(erroresTransicionCaso("abierto", "cerrado", ok)).toEqual([]);
  });
  it("no salta ni retrocede sin regla; archivado es final", () => {
    expect(erroresTransicionCaso("abierto", "archivado", ok)[0]).toMatch(/no puede pasar a archivado/);
    expect(erroresTransicionCaso("en_proceso", "abierto", ok)[0]).toMatch(/no puede pasar/);
    expect(erroresTransicionCaso("archivado", "en_proceso", ok)[0]).toMatch(/no puede pasar/);
    expect(erroresTransicionCaso("abierto", "abierto", ok)[0]).toMatch(/ya está abierto/);
    expect(erroresTransicionCaso("abierto", "borrado", ok)[0]).toMatch(/desconocido/);
  });
  it("reabrir exige motivo; cerrar exige que no haya evidencias prestadas", () => {
    expect(erroresTransicionCaso("cerrado", "en_proceso", ok)[0]).toMatch(/motivo/);
    expect(erroresTransicionCaso("cerrado", "en_proceso", { ...ok, motivo: "Nueva pericia" })).toEqual([]);
    expect(erroresTransicionCaso("en_proceso", "cerrado", { evidenciasPrestadas: 2 })[0]).toMatch(/2 evidencia/);
  });
});

describe("EP-11 11.31 · oficio, NUE y RUC", () => {
  const hoy = "2026-10-22";
  it("exige Nº de oficio, unidad solicitante y NUE", () => {
    expect(erroresIngresoEvidencia({}, hoy)).toEqual(["Indique el Nº del oficio.", "Indique la unidad solicitante del oficio.", "Indique el NUE de la evidencia."]);
    expect(erroresIngresoEvidencia({ oficioNumero: "12", oficioUnidad: "Fiscalía Local", nue: "NUE-1" }, hoy)).toEqual([]);
  });
  it("RUC con forma NNNNNNNNNN-D y fecha del oficio no futura", () => {
    const base = { oficioNumero: "12", oficioUnidad: "Fiscalía", nue: "1" };
    expect(erroresIngresoEvidencia({ ...base, rucCausa: "2600123456-K" }, hoy)).toEqual([]);
    expect(erroresIngresoEvidencia({ ...base, rucCausa: "26-00123456" }, hoy)[0]).toMatch(/RUC/);
    expect(erroresIngresoEvidencia({ ...base, oficioFecha: "2026-10-23" }, hoy)[0]).toMatch(/futura/);
  });
});

describe("EP-11 11.33 · préstamos", () => {
  const hoy = "2026-10-22";
  it("la entrega exige plazo de devolución desde hoy; la devolución no", () => {
    expect(erroresSolicitudPrestamo({ tipo: "entrega" }, hoy)).toEqual(["Indique el plazo de devolución."]);
    expect(erroresSolicitudPrestamo({ fechaDevolucionPrevista: "2026-10-21" }, hoy)[0]).toMatch(/anterior/);
    expect(erroresSolicitudPrestamo({ fechaDevolucionPrevista: "2026-10-22" }, hoy)).toEqual([]);
    expect(erroresSolicitudPrestamo({ tipo: "devolucion" }, hoy)).toEqual([]);
  });
  it("vencido solo si está entregado y pasó el plazo", () => {
    expect(prestamoVencido({ estado: "entregado", fechaDevolucionPrevista: "2026-10-21" }, hoy)).toBe(true);
    expect(prestamoVencido({ estado: "entregado", fechaDevolucionPrevista: "2026-10-22" }, hoy)).toBe(false);
    expect(prestamoVencido({ estado: "devuelto", fechaDevolucionPrevista: "2026-10-01" }, hoy)).toBe(false);
  });
});

describe("B-044 · confirmar o descartar una coincidencia IBIS", () => {
  const { erroresEstadoHit } = require("./reglas-saec");
  it("desde sin confirmar, con motivo", () => {
    expect(erroresEstadoHit("sin_confirmar", "confirmado", "Cotejo positivo del perito")).toEqual([]);
    expect(erroresEstadoHit("sin_confirmar", "descartado", "x").join(" ")).toMatch(/motivo/);
    expect(erroresEstadoHit("confirmado", "descartado", "Error de cotejo").join(" ")).toMatch(/sin confirmar/);
    expect(erroresEstadoHit("confirmado", "sin_confirmar", "Se revisa de nuevo")).toEqual([]);
    expect(erroresEstadoHit("descartado", "descartado", "Repetido").join(" ")).toMatch(/ya está/);
  });
});
