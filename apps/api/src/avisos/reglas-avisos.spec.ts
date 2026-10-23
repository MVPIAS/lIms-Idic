import {
  alertaDeResultado,
  atrasoRecepcionDco,
  avisoDePlazo,
  configAvisos,
  correosValidos,
  destinoSugerido,
  errorFechaRecepcionDco,
  erroresDespacho,
  estadoCorreo,
  exigeOficio,
} from "./reglas-avisos";

describe("parámetros de los avisos", () => {
  it("por defecto: 3 días, revisión automática, correo, sin aviso al cliente, documento listo", () => {
    expect(configAvisos([])).toEqual({ diasPorVencer: 3, revisionAutomatica: true, enviarCorreo: true, noCumpleAlCliente: false, documentoListo: true });
  });
  it("lee los valores y descarta los fuera de rango", () => {
    const c = configAvisos([
      { codigo: "dias_por_vencer", valor: "4" },
      { codigo: "enviar_correo", valor: "no" },
      { codigo: "no_cumple_al_cliente", valor: "si" },
    ]);
    expect(c.diasPorVencer).toBe(4);
    expect(c.enviarCorreo).toBe(false);
    expect(c.noCumpleAlCliente).toBe(true);
    expect(configAvisos([{ codigo: "dias_por_vencer", valor: "99" }]).diasPorVencer).toBe(3);
    expect(configAvisos([{ codigo: "enviar_correo", valor: "no", activo: false }]).enviarCorreo).toBe(true);
  });
});

describe("plazos (EP-00 6.2)", () => {
  it("vencida si ya pasó, por vencer dentro de N días, nada si falta más o no hay fecha", () => {
    expect(avisoDePlazo("2026-10-21", "2026-10-22", 3)).toBe("vencida");
    expect(avisoDePlazo("2026-10-22", "2026-10-22", 3)).toBe("por_vencer");
    expect(avisoDePlazo("2026-10-25", "2026-10-22", 3)).toBe("por_vencer");
    expect(avisoDePlazo("2026-10-26", "2026-10-22", 3)).toBeNull();
    expect(avisoDePlazo(null, "2026-10-22", 3)).toBeNull();
  });
});

describe("recepción en DCO y días de atraso (EP-00 6.3, §5.5)", () => {
  it("d > 0 fuera de plazo con atraso; d ≤ 0 dentro de plazo a favor", () => {
    expect(atrasoRecepcionDco("2026-10-25", "2026-10-22")).toMatchObject({ dias: 3, estado: "Terminado fuera de plazo" });
    expect(atrasoRecepcionDco("2026-10-20", "2026-10-22")).toMatchObject({ dias: 0, estado: "Terminado dentro de plazo", texto: "2 días a favor" });
    expect(atrasoRecepcionDco("2026-10-22", "2026-10-22").texto).toBe("justo en el plazo");
    expect(atrasoRecepcionDco("2026-10-22", null).estado).toBe("Terminado sin plazo");
  });
  it("la fecha no es futura ni anterior a la OT", () => {
    expect(errorFechaRecepcionDco("2026-10-23", "2026-10-01", "2026-10-22")).toMatch(/futura/);
    expect(errorFechaRecepcionDco("2026-09-30", "2026-10-01", "2026-10-22")).toMatch(/anterior/);
    expect(errorFechaRecepcionDco("2026-10-10", "2026-10-01T12:00:00Z", "2026-10-22")).toBeNull();
    expect(errorFechaRecepcionDco("10-10-2026", null, "2026-10-22")).toMatch(/AAAA-MM-DD/);
  });
});

describe("alerta de resultado (contrato §4.2.6)", () => {
  it("No cumple avisa; Contaminado si el texto lo dice; Cumple no avisa", () => {
    expect(alertaDeResultado({ veredicto: "no_cumple" })).toBe("no_cumple");
    expect(alertaDeResultado({ veredicto: "no_cumple", valorTexto: "Presencia" })).toBe("contaminado");
    expect(alertaDeResultado({ veredicto: "no_cumple", observacion: "Muestra contaminada" })).toBe("contaminado");
    expect(alertaDeResultado({ veredicto: "cumple", valorTexto: "Contaminado" })).toBeNull();
    expect(alertaDeResultado({ veredicto: null })).toBeNull();
  });
});

describe("despacho (EP-01 6.3, EP-05 8.1)", () => {
  const base = { estado: "oficial", yaDespachado: false, destino: "DCO", ejemplares: 2, fecha: "2026-10-22", hoy: "2026-10-22" };
  it("destino sugerido: OT interna al solicitante; BPCH desde otro laboratorio; si no, DCO", () => {
    expect(destinoSugerido({ origen: "OT_INTERNA", ramaBpch: false, solicitaBpch: false })).toBe("LAB_SOLICITANTE");
    expect(destinoSugerido({ origen: "INTERNACION", ramaBpch: false, solicitaBpch: true })).toBe("BPCH");
    expect(destinoSugerido({ origen: "COTIZACION", ramaBpch: false, solicitaBpch: false })).toBe("DCO");
  });
  it("solo oficial, una vez, ejemplares 1–50, fecha no futura, solicitante si corresponde", () => {
    expect(erroresDespacho(base)).toEqual([]);
    expect(erroresDespacho({ ...base, estado: "en_firma" })[0]).toMatch(/oficial/);
    expect(erroresDespacho({ ...base, yaDespachado: true })[0]).toMatch(/ya fue despachado/);
    expect(erroresDespacho({ ...base, ejemplares: 0 })[0]).toMatch(/ejemplares/);
    expect(erroresDespacho({ ...base, fecha: "2026-10-23" })[0]).toMatch(/futura/);
    expect(erroresDespacho({ ...base, destino: "LAB_SOLICITANTE" })[0]).toMatch(/solicitante/);
    expect(erroresDespacho({ ...base, destino: "OTRO" })[0]).toMatch(/destino/);
  });
});

describe("oficio conductor exigido (EP-05 7.2)", () => {
  const cfg = { tipos: ["IVC", "INFORME_TECNICO", "INFORME_RECHAZO"], departamentos: ["DSA"] };
  it("IVC del DSA sí; IE del DSA no; IVC del DQO no", () => {
    expect(exigeOficio("IVC", "DSA", cfg)).toBe(true);
    expect(exigeOficio("INFORME_ENSAYO", "DSA", cfg)).toBe(false);
    expect(exigeOficio("IVC", "DQO", cfg)).toBe(false);
    expect(exigeOficio(null, "DSA", cfg)).toBe(false);
  });
});

describe("correo del aviso", () => {
  it("estado según lo ocurrido (sin configurar no es un error)", () => {
    expect(estadoCorreo({ quiere: false, destinatarios: 3, error: null })).toBe("no_aplica");
    expect(estadoCorreo({ quiere: true, destinatarios: 0, error: null })).toBe("sin_correo");
    expect(estadoCorreo({ quiere: true, destinatarios: 2, error: null })).toBe("enviado");
    expect(estadoCorreo({ quiere: true, destinatarios: 2, error: "No hay configuración de correo para este tenant." })).toBe("sin_configurar");
    expect(estadoCorreo({ quiere: true, destinatarios: 2, error: "ECONNREFUSED" })).toBe("error");
  });
  it("correos válidos sin repetir", () => {
    expect(correosValidos(["A@x.cl", "a@x.cl", null, "malo", " b@y.cl "])).toEqual(["a@x.cl", "b@y.cl"]);
  });
});
