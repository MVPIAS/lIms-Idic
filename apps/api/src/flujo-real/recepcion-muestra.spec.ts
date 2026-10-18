import { enlaceOrdenesInternas, erroresRecepcion, normalizarRecepcion, recepcionIncompleta, selloRecepcion } from "./recepcion-muestra";

const OPC = ["terreno_laboratorio", "entregada_cliente", "seccion_muestreo"];
const LQC = "11111111-1111-1111-1111-111111111111";
const LCC = "22222222-2222-2222-2222-222222222222";

describe("recepción de la muestra", () => {
  it("una recepción completa que cumple no tiene errores", () => {
    const r = normalizarRecepcion({ tomaMuestra: "entregada_cliente", condicionRecepcion: "cumple", selloNumero: " 15572 ", identificacionCliente: " Estanque Nº 3 " });
    expect(erroresRecepcion(r, OPC)).toEqual([]);
    expect(r.selloNumero).toBe("15572");
    expect(r.identificacionCliente).toBe("Estanque Nº 3");
  });
  it("exige toma de muestra de la lista y condición", () => {
    const e = erroresRecepcion(normalizarRecepcion({}), OPC);
    expect(e.join(" ")).toMatch(/toma de muestra/);
    expect(e.join(" ")).toMatch(/condición de recepción/);
    expect(erroresRecepcion(normalizarRecepcion({ tomaMuestra: "otra", condicionRecepcion: "cumple" }), OPC)[0]).toMatch(/no está en la lista/);
  });
  it("No cumple exige observación", () => {
    const sin = normalizarRecepcion({ tomaMuestra: "seccion_muestreo", condicionRecepcion: "no_cumple", condicionObservacion: "  " });
    expect(erroresRecepcion(sin, OPC)[0]).toMatch(/describa qué se encontró/);
    const con = normalizarRecepcion({ tomaMuestra: "seccion_muestreo", condicionRecepcion: "no_cumple", condicionObservacion: "Sello roto" });
    expect(erroresRecepcion(con, OPC)).toEqual([]);
  });
  it("otros laboratorios: si se marca hay que indicar cuáles; si no, se vacía la lista", () => {
    const sinLabs = normalizarRecepcion({ tomaMuestra: "entregada_cliente", condicionRecepcion: "cumple", requiereOtrosLabs: true });
    expect(erroresRecepcion(sinLabs, OPC)[0]).toMatch(/qué otro/);
    const no = normalizarRecepcion({ requiereOtrosLabs: false, otrosLabs: [LCC], otrosLabsDetalle: "x" });
    expect(no.otrosLabs).toEqual([]);
    expect(no.otrosLabsDetalle).toBeNull();
    expect(normalizarRecepcion({ requiereOtrosLabs: true, otrosLabs: [LCC, LCC] }).otrosLabs).toEqual([LCC]);
  });
  it("el laboratorio responsable no cuenta como «otro laboratorio»", () => {
    const r = normalizarRecepcion({ tomaMuestra: "entregada_cliente", condicionRecepcion: "cumple", requiereOtrosLabs: true, otrosLabs: [LQC] });
    expect(erroresRecepcion(r, OPC, LQC, "Muestra 1: ")[0]).toMatch(/^Muestra 1: el laboratorio responsable/);
  });
  it("avisa de la recepción incompleta y enlaza las órdenes internas por destino", () => {
    expect(recepcionIncompleta({ tomaMuestra: "entregada_cliente", condicionRecepcion: null })).toBe(true);
    expect(recepcionIncompleta({ tomaMuestra: "entregada_cliente", condicionRecepcion: "cumple" })).toBe(false);
    const enlaces = enlaceOrdenesInternas([LCC, LQC], [
      { id: "o1", numero: "OI-2026-0001", destinoLab: LCC, estado: "abierta" },
      { id: "o2", numero: "OI-2026-0002", destinoLab: null, estado: "abierta" },
    ]);
    expect(enlaces).toEqual([
      { unidadId: LCC, ordenes: [{ id: "o1", numero: "OI-2026-0001", estado: "abierta" }] },
      { unidadId: LQC, ordenes: [] },
    ]);
  });
});

describe("quién y cuándo de la recepción (revisión r3, hallazgo 13)", () => {
  const lunes = new Date("2026-10-12T10:00:00Z");
  const miercoles = new Date("2026-10-14T15:00:00Z");
  it("la primera recepción deja a quien la registra y la hora", () => {
    expect(selloRecepcion(null, "recepcion", lunes)).toEqual({ recepcionadaAt: lunes, recepcionadaPor: "recepcion", recepcionCorregidaAt: null, recepcionCorregidaPor: null });
  });
  it("corregir el sello el miércoles no cambia quién ni cuándo se recibió: anota la corrección aparte", () => {
    const previo = { recepcionadaAt: lunes, recepcionadaPor: "recepcion", recepcionCorregidaAt: null, recepcionCorregidaPor: null };
    const s = selloRecepcion(previo, "jefe", miercoles);
    expect(s.recepcionadaAt).toBe(lunes);
    expect(s.recepcionadaPor).toBe("recepcion");
    expect(s.recepcionCorregidaAt).toBe(miercoles);
    expect(s.recepcionCorregidaPor).toBe("jefe");
  });
  it("una muestra registrada sin recepción la completa como primera recepción", () => {
    const s = selloRecepcion({ recepcionadaAt: null, recepcionadaPor: null, recepcionCorregidaAt: null, recepcionCorregidaPor: null }, "jefe", miercoles);
    expect([s.recepcionadaPor, s.recepcionCorregidaPor]).toEqual(["jefe", null]);
  });
});
