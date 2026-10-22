import { motivoExterno, motivoInforme, noAptoResuelto, revisarPdf } from "./metrologia-documentos.reglas";
import { motivoCierreTecnico } from "./metrologia-ot.reglas";

const noApto = { numero: 2, estado: "no_apto", otEstado: "en_analisis", calibrable: false };

describe("Informe técnico del instrumento no calibrable (EP-04 P2.3)", () => {
  const datos = { hallazgos: "Mecanismo de ajuste trabado", motivo: "No se puede calibrar sin reparación" };
  it("solo para el ítem recibido como no calibrable, con hallazgos y motivo", () => {
    expect(motivoInforme("GUARDAR", noApto, null, datos)).toBeNull();
    expect(motivoInforme("GUARDAR", { ...noApto, estado: "recibido" }, null, datos)).toMatch(/no calibrable/);
    expect(motivoInforme("GUARDAR", noApto, null, { hallazgos: "x", motivo: datos.motivo })).toMatch(/hallazgos/);
    expect(motivoInforme("GUARDAR", noApto, null, { hallazgos: datos.hallazgos, motivo: "" })).toMatch(/por qué no se calibra/);
  });
  it("circuito: borrador → en firma → emitido; devolver solo en firma; entregar una vez, emitido", () => {
    expect(motivoInforme("ENVIAR", noApto, null)).toMatch(/Primero guarde/);
    expect(motivoInforme("ENVIAR", noApto, { estado: "borrador" })).toBeNull();
    expect(motivoInforme("EMITIR", noApto, { estado: "borrador" })).toMatch(/no está en firma/);
    expect(motivoInforme("EMITIR", noApto, { estado: "en_firma" })).toBeNull();
    expect(motivoInforme("DEVOLVER", noApto, { estado: "en_firma" })).toBeNull();
    expect(motivoInforme("GUARDAR", noApto, { estado: "en_firma" }, datos)).toMatch(/ya se envió a firma/);
    expect(motivoInforme("ENTREGAR", noApto, { estado: "en_firma" })).toMatch(/emitido/);
    expect(motivoInforme("ENTREGAR", noApto, { estado: "emitido" })).toBeNull();
    expect(motivoInforme("ENTREGAR", noApto, { estado: "emitido", entregadoAt: "2026-10-22" })).toMatch(/ya está registrada/);
  });
  it("con la OT cerrada solo se puede registrar la entrega; un no calibrable ya devuelto conserva su informe", () => {
    expect(motivoInforme("ENVIAR", { ...noApto, otEstado: "cerrada" }, { estado: "borrador" })).toMatch(/cerrada/);
    expect(motivoInforme("ENTREGAR", { ...noApto, otEstado: "cerrada" }, { estado: "emitido" })).toBeNull();
    expect(motivoInforme("EMITIR", { ...noApto, estado: "devuelto" }, { estado: "en_firma" })).toBeNull();
    expect(motivoInforme("GUARDAR", { ...noApto, estado: "devuelto" }, null, datos)).toMatch(/no calibrable/);
  });
});

describe("Servicio externo (EP-04 P2.4)", () => {
  const sol = { proveedorId: "p1", justificacion: "El laboratorio no tiene el alcance" };
  it("solicitar: no calibrable, proveedor y justificación; uno vigente a la vez (un rechazado se vuelve a pedir)", () => {
    expect(motivoExterno("SOLICITAR", noApto, null, sol)).toBeNull();
    expect(motivoExterno("SOLICITAR", { ...noApto, estado: "recibido" }, null, sol)).toMatch(/no puede calibrar/);
    expect(motivoExterno("SOLICITAR", noApto, null, { ...sol, proveedorId: null })).toMatch(/proveedor/);
    expect(motivoExterno("SOLICITAR", noApto, { estado: "aprobado" }, sol)).toMatch(/ya tiene/);
    expect(motivoExterno("SOLICITAR", noApto, { estado: "rechazado" }, sol)).toBeNull();
  });
  it("aprobar o rechazar (con motivo) la solicitud; envío solo aprobada; certificado solo enviada", () => {
    expect(motivoExterno("APROBAR", noApto, { estado: "solicitado" })).toBeNull();
    expect(motivoExterno("RECHAZAR", noApto, { estado: "solicitado" }, { motivo: "x" })).toMatch(/motivo/);
    expect(motivoExterno("ENVIO", noApto, { estado: "solicitado" }, { fechaEnvio: "2026-10-20" })).toMatch(/aún no está aprobada/);
    expect(motivoExterno("ENVIO", noApto, { estado: "aprobado" }, { fechaEnvio: "2026-10-20" })).toBeNull();
    expect(motivoExterno("CERTIFICADO", noApto, { estado: "aprobado" }, { certificadoNumero: "C-1" })).toMatch(/no se ha enviado/);
    expect(motivoExterno("CERTIFICADO", noApto, { estado: "enviado", fechaEnvio: "2026-10-20" }, { certificadoNumero: "C-1", fechaRetorno: "2026-10-19" })).toMatch(/anterior a la de envío/);
    expect(motivoExterno("CERTIFICADO", noApto, { estado: "enviado", fechaEnvio: "2026-10-20" }, { certificadoNumero: "C-1", fechaRetorno: "2026-10-21" })).toBeNull();
  });
  it("validar exige el certificado externo adjunto y la aptitud", () => {
    expect(motivoExterno("VALIDAR", noApto, { estado: "enviado" }, { aptitud: "apto" })).toMatch(/Adjunte/);
    expect(motivoExterno("VALIDAR", noApto, { estado: "enviado", tieneCertificado: true, certificadoNumero: "C-1" }, {})).toMatch(/apto o no apto/);
    expect(motivoExterno("VALIDAR", noApto, { estado: "enviado", tieneCertificado: true, certificadoNumero: "C-1" }, { aptitud: "no_apto" })).toBeNull();
  });
  it("el certificado externo se valida por sus bytes (PDF, máx. 10 MB)", () => {
    expect(revisarPdf(Buffer.from("%PDF-1.7 ..."))).toEqual({ ok: true });
    expect(revisarPdf(Buffer.from("\x89PNG...."))).toEqual({ error: "El archivo no es un PDF." });
    expect(revisarPdf(null)).toEqual({ error: expect.stringMatching(/Adjunte/) });
  });
});

describe("Cierre técnico con el parámetro «el no calibrable exige su documento»", () => {
  const items = [{ id: "a", numero: 1, descripcion: "x", estado: "recibido" }, { id: "b", numero: 2, descripcion: "y", estado: "no_apto" }];
  const cals = [{ id: "c", instrumentoId: "a", codigo: "CAL-1", estado: "emitida" }];
  it("sin el parámetro (por defecto), el no apto no bloquea, como en R1", () => {
    expect(motivoCierreTecnico("en_analisis", items, cals)).toBeNull();
    expect(motivoCierreTecnico("en_analisis", items, cals, { exige: false, resueltos: new Set() })).toBeNull();
  });
  it("con el parámetro, falta el informe técnico emitido o el servicio externo validado", () => {
    expect(motivoCierreTecnico("en_analisis", items, cals, { exige: true, resueltos: new Set() })).toMatch(/informe técnico emitido o el servicio externo validado.*ítem 2/);
    expect(motivoCierreTecnico("en_analisis", items, cals, { exige: true, resueltos: new Set(["b"]) })).toBeNull();
  });
  it("resuelto = informe emitido o externo validado", () => {
    expect(noAptoResuelto({ estado: "emitido" }, null)).toBe(true);
    expect(noAptoResuelto({ estado: "en_firma" }, { estado: "validado" })).toBe(true);
    expect(noAptoResuelto({ estado: "en_firma" }, { estado: "enviado" })).toBe(false);
  });
});
