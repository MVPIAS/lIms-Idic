import { erroresDistribucion, erroresRecepcionDco } from "./recepcion-dco";
import { erroresDevolucion } from "../../equipos/equipos.module";

describe("Recepción de ítems en DCO (EP-00 5.7, BL-211)", () => {
  const ahora = new Date("2026-10-23T15:00:00Z");
  it("«No cumple» exige describir lo observado; la fecha no puede ser futura", () => {
    expect(erroresRecepcionDco({ condicion: "no_cumple", fechaRecibo: "2026-10-23T14:00:00Z" }, ahora)).toHaveLength(1);
    expect(erroresRecepcionDco({ condicion: "no_cumple", observacion: "Caja abierta", fechaRecibo: "2026-10-23T14:00:00Z" }, ahora)).toEqual([]);
    expect(erroresRecepcionDco({ condicion: "cumple", fechaRecibo: "2026-10-24T14:00:00Z" }, ahora)).toEqual(["La fecha de recibo no puede ser futura."]);
  });
});

describe("Distribución a los laboratorios (EP-02 1.3, BL-212)", () => {
  it("solo laboratorios con ensayos de la muestra y sin repetir", () => {
    expect(erroresDistribucion([{ unidadId: "lqa" }, { unidadId: "lmb" }], ["lqa", "lmb"])).toEqual([]);
    expect(erroresDistribucion([{ unidadId: "lqc" }], ["lqa"])).toEqual(["Fila 1: el laboratorio no tiene ensayos en esta muestra."]);
    expect(erroresDistribucion([{ unidadId: "lqa" }, { unidadId: "lqa" }], ["lqa"])).toEqual(["Fila 2: el laboratorio está repetido."]);
  });
});

describe("Devolución de excedente (EP-03 7.2, BL-213)", () => {
  it("la devolución exige cantidad y guía de despacho; otros eventos no", () => {
    expect(erroresDevolucion({ evento: "devolucion" })).toHaveLength(2);
    expect(erroresDevolucion({ evento: "devolucion", cantidadDevuelta: 12, guiaDespacho: "GD-4471" })).toEqual([]);
    expect(erroresDevolucion({ evento: "transferencia" })).toEqual([]);
  });
});
