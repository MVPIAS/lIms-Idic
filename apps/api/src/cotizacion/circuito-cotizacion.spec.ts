import {
  calcularRutaCotizacion,
  estadoTrasRespuesta,
  estadoTrasVb,
  faltantesParaFirma,
  motivoNoAceptable,
  motivoNoEditable,
  motivoNoEnviable,
  nivelVbPendiente,
  nivelesVb,
  puedeResponder,
  siNo,
  type ConfigCircuito,
  type HechosCotizacion,
} from "./circuito-cotizacion";

const cfg: ConfigCircuito = { niveles: "lab_depto", exigirConsulta: false, exigirFirma: true };
const cot = { codigo: "2026-00001", estado: "abierta", circuito: "r1", firmaEstado: null, lineas: 2 } as const;
const sol = (estado: string, unidad = "LQC") => ({ id: `s-${unidad}`, estado, unidad, numero: null, unidadId: `u-${unidad}` });

describe("Circuito de la cotización · solicitud al laboratorio y V°B° (EP-00 2.4–2.6)", () => {
  it("el laboratorio responde una solicitud pendiente o devuelta, nunca dos veces", () => {
    expect(puedeResponder("solicitado")).toBe(true);
    expect(puedeResponder("devuelto")).toBe(true);
    expect(puedeResponder("respondido")).toBe(false);
    expect(puedeResponder("aprobado")).toBe(false);
  });

  it("tras responder espera el V°B°, salvo que el V°B° no se exija o el laboratorio rechace", () => {
    expect(estadoTrasRespuesta("aceptar", "lab_depto")).toBe("respondido");
    expect(estadoTrasRespuesta("aceptar_con_comentario", "lab")).toBe("respondido");
    expect(estadoTrasRespuesta("aceptar", "ninguno")).toBe("aprobado");
    expect(estadoTrasRespuesta("rechazar", "lab_depto")).toBe("rechazado");
  });

  it("V°B° del laboratorio y luego del departamento; con un solo nivel basta el del laboratorio", () => {
    expect(nivelVbPendiente("respondido", "lab_depto")).toBe("lab");
    expect(nivelVbPendiente("vb_lab", "lab_depto")).toBe("depto");
    expect(nivelVbPendiente("vb_lab", "lab")).toBeNull();
    expect(nivelVbPendiente("solicitado", "lab_depto")).toBeNull();
    expect(estadoTrasVb("lab", "lab_depto", "dar")).toBe("vb_lab");
    expect(estadoTrasVb("depto", "lab_depto", "dar")).toBe("aprobado");
    expect(estadoTrasVb("lab", "lab", "dar")).toBe("aprobado");
    expect(estadoTrasVb("depto", "lab_depto", "devolver")).toBe("devuelto");
  });

  it("los parámetros mal escritos caen a los valores de la EP", () => {
    expect(nivelesVb("LAB")).toBe("lab");
    expect(nivelesVb("cualquiera")).toBe("lab_depto");
    expect(siNo("Sí", false)).toBe(true);
    expect(siNo("no", true)).toBe(false);
    expect(siNo(undefined, true)).toBe(true);
  });
});

describe("Firma del Jefe DCO y aceptación (EP-00 2.6–2.8, 4.1)", () => {
  it("sin V°B° completo no se envía a firma ni se firma", () => {
    expect(faltantesParaFirma(cot, [sol("vb_lab")], cfg, "enviar").join(" ")).toMatch(/Falta la respuesta o el V°B°/);
    expect(faltantesParaFirma(cot, [sol("aprobado")], cfg, "enviar")).toEqual([]);
    expect(faltantesParaFirma(cot, [sol("rechazado")], cfg, "enviar").join(" ")).toMatch(/no realiza el servicio/);
    // Las estimaciones heredadas del costeo D2 (sin laboratorio) no bloquean.
    expect(faltantesParaFirma(cot, [{ id: "x", estado: "estimado", unidad: null }], cfg, "enviar")).toEqual([]);
  });

  it("la consulta al laboratorio solo es obligatoria si así se configura", () => {
    expect(faltantesParaFirma(cot, [], cfg, "enviar")).toEqual([]);
    expect(faltantesParaFirma(cot, [], { ...cfg, exigirConsulta: true }, "enviar").join(" ")).toMatch(/consultar al laboratorio/);
  });

  it("solo se firma lo que el ejecutivo envió a firma, y no se reenvía lo ya enviado", () => {
    expect(faltantesParaFirma(cot, [], cfg, "firmar").join(" ")).toMatch(/no está enviada a firma/);
    expect(faltantesParaFirma({ ...cot, firmaEstado: "pendiente" }, [], cfg, "firmar")).toEqual([]);
    expect(faltantesParaFirma({ ...cot, firmaEstado: "pendiente" }, [], cfg, "enviar").join(" ")).toMatch(/Ya está enviada/);
    expect(faltantesParaFirma({ ...cot, firmaEstado: "devuelta" }, [], cfg, "enviar")).toEqual([]);
  });

  it("en firma o firmada no se edita el contenido", () => {
    expect(motivoNoEditable(null)).toBeNull();
    expect(motivoNoEditable("devuelta")).toBeNull();
    expect(motivoNoEditable("pendiente")).toMatch(/en firma/);
    expect(motivoNoEditable("firmada")).toMatch(/anúlela/);
  });

  it("la aceptación exige la firma en el circuito nuevo; las históricas y la configuración «no» no", () => {
    expect(motivoNoAceptable(cot, cfg)).toMatch(/no está firmada/);
    expect(motivoNoAceptable({ ...cot, firmaEstado: "firmada" }, cfg)).toBeNull();
    expect(motivoNoAceptable({ ...cot, circuito: "historico" }, cfg)).toBeNull();
    expect(motivoNoAceptable(cot, { ...cfg, exigirFirma: false })).toBeNull();
  });

  it("al cliente solo sale la cotización firmada", () => {
    expect(motivoNoEnviable(cot)).toMatch(/no está firmada/);
    expect(motivoNoEnviable({ ...cot, firmaEstado: "firmada" })).toBeNull();
    expect(motivoNoEnviable({ ...cot, estado: "anulada", firmaEstado: "firmada" })).toMatch(/anulada/);
    expect(motivoNoEnviable({ ...cot, circuito: "historico" })).toBeNull();
  });
});

describe("Ruta de la cotización (barra de 6 etapas y siguiente paso)", () => {
  const base: HechosCotizacion = { ...cot, solicitudes: [], firmantes: [{ id: "j", nombre: "J. D." }] };

  it("recién creada y sin consulta: el siguiente paso es enviar a firma, lo hace el ejecutivo", () => {
    const r = calcularRutaCotizacion(base, cfg);
    expect(r.etapas.map((e) => e.clave)).toEqual(["elaboracion", "costeo", "vb", "firma", "envio", "aceptacion"]);
    expect(r.etapas.map((e) => e.estado)).toEqual(["hecho", "no_aplica", "no_aplica", "pendiente", "pendiente", "pendiente"]);
    expect(r.etapaActual).toBe("firma");
    expect(r.siguiente?.leToca?.rol).toBe("Ejecutivo de Ventas");
    expect(r.siguiente?.accion?.permisos).toEqual(["cotizacion.crear"]);
  });

  it("con una solicitud pendiente le toca al Jefe de Laboratorio, con el permiso de costear", () => {
    const r = calcularRutaCotizacion({ ...base, solicitudes: [sol("solicitado")] }, cfg);
    expect(r.etapaActual).toBe("costeo");
    expect(r.siguiente?.leToca).toEqual({ rol: "Jefe de Laboratorio", unidad: "LQC", personas: [] });
    expect(r.siguiente?.accion?.permisos).toEqual(["cotizacion.costear"]);
    expect(r.siguiente?.accion?.unidadId).toBe("u-LQC");
  });

  it("respondida: le toca el V°B° a las personas que resuelve la jefatura", () => {
    const s = { ...sol("vb_lab"), vb: { nivel: "depto" as const, rol: "Jefe de Departamento", unidad: "DQO", personas: [{ id: "d", nombre: "D. Q." }] } };
    const r = calcularRutaCotizacion({ ...base, solicitudes: [s] }, cfg);
    expect(r.etapaActual).toBe("vb");
    expect(r.siguiente?.texto).toMatch(/del departamento/);
    expect(r.siguiente?.leToca?.personas).toEqual(["D. Q."]);
    expect(r.siguiente?.accion?.usuarios).toEqual(["d"]);
  });

  it("un laboratorio que no realiza el servicio bloquea el V°B° y avisa", () => {
    const r = calcularRutaCotizacion({ ...base, solicitudes: [sol("rechazado")] }, cfg);
    expect(r.etapas.find((e) => e.clave === "vb")?.estado).toBe("bloqueado");
    expect(r.siguiente?.leToca?.rol).toBe("Ejecutivo de Ventas");
    expect(r.avisos.join(" ")).toMatch(/no realiza el servicio/);
  });

  it("en firma le toca al Jefe DCO de la matriz; firmada pasa al envío; enviada a la aceptación", () => {
    const enFirma = calcularRutaCotizacion({ ...base, firmaEstado: "pendiente" }, cfg);
    expect(enFirma.siguiente?.leToca).toEqual({ rol: "Jefe del Departamento Comercial", unidad: "DCO", personas: ["J. D."] });
    expect(enFirma.siguiente?.accion?.usuarios).toEqual(["j"]);
    expect(calcularRutaCotizacion({ ...base, firmaEstado: "firmada" }, cfg).etapaActual).toBe("envio");
    const enviada = calcularRutaCotizacion({ ...base, firmaEstado: "firmada", enviadaAt: "2026-10-20", enviadaMedio: "correo" }, cfg);
    expect(enviada.etapaActual).toBe("aceptacion");
    expect(enviada.etapas.find((e) => e.clave === "envio")?.detalle).toBe("Por correo electrónico");
  });

  it("devuelta por el Jefe DCO: etapa bloqueada con el motivo y vuelve al ejecutivo", () => {
    const r = calcularRutaCotizacion({ ...base, firmaEstado: "devuelta", firmaDevueltaMotivo: "Falta plazo" }, cfg);
    expect(r.etapas.find((e) => e.clave === "firma")).toMatchObject({ estado: "bloqueado", detalle: "Devuelta: Falta plazo" });
    expect(r.siguiente?.texto).toMatch(/volver a enviar a firma/);
  });

  it("aceptada: todo hecho o no aplica, sin siguiente paso; anulada avisa", () => {
    const r = calcularRutaCotizacion({ ...base, estado: "aceptada", firmaEstado: "firmada", ot: { codigo: "OT-2026-0001" } }, cfg);
    expect(r.etapaActual).toBeNull();
    expect(r.etapas.find((e) => e.clave === "aceptacion")?.detalle).toBe("OT OT-2026-0001");
    const a = calcularRutaCotizacion({ ...base, estado: "anulada" }, cfg);
    expect(a.siguiente).toBeNull();
    expect(a.avisos).toContain("La cotización está anulada.");
  });

  it("una cotización histórica no pasa por la firma", () => {
    const r = calcularRutaCotizacion({ ...base, circuito: "historico" }, cfg);
    expect(r.etapas.find((e) => e.clave === "firma")?.estado).toBe("no_aplica");
    expect(r.etapaActual).toBe("envio");
  });
});
