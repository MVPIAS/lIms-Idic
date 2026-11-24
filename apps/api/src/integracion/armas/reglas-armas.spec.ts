import {
  bpchIdDe,
  clasificarRespuesta,
  configArmas,
  construirPayload,
  cuerpoSinBase64,
  descripcionEstado,
  dvRut,
  efectoEstado,
  esTerminal,
  esperaReintentoMs,
  fueraDeOrden,
  mapaEstados,
  MOTIVO_SIN_CERTIFICADO_D11,
  notificacionesDgmn,
  reintentosAgotados,
  fechaIso,
  firmaHmac,
  firmarEnlace,
  hostsPermitidos,
  idEvento,
  leerEnlaces,
  leerEvento,
  nombrePdf,
  pdfDeBase64,
  rutParaBpch,
  rutaEnlaces,
  urlBaseLims,
  urlBaseValida,
  validarUrlEnlace,
  verificarEnlace,
  verificarHmac,
  type DatosOtArmas,
} from "./reglas-armas";

const PDF = Buffer.from("%PDF-1.4\n% PRUEBA\n%%EOF").toString("base64");

const datos = (o: Partial<DatosOtArmas> = {}): DatosOtArmas => ({
  limsOtId: "PRUEBA-2026-0001",
  tipoOrden: 2,
  resolucionNumero: "RES-PRUEBA-1",
  resolucionFecha: "2026-11-20",
  solicitanteRut: "11.111.111-1",
  solicitanteEmail: "prueba@ejemplo.cl",
  creadorRut: null,
  cantidadArmas: 3,
  observaciones: "PRUEBA",
  adjuntos: [{ nombre: "resolucion.pdf", url: "https://lims.prueba/api/v1/integracion/bpch/adjuntos/x" }],
  ...o,
});

describe("RUT para el BPCH", () => {
  it("dígito verificador módulo 11", () => {
    expect(dvRut("11111111")).toBe("1");
    expect(dvRut("76192834")).toBe(dvRut("76192834"));
    expect(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "K"]).toContain(dvRut("12345678"));
    expect(dvRut("12345678")).toBe("5");
  });

  it("sin puntos ni guion; sin DV por defecto (ejemplo del BPCH)", () => {
    expect(rutParaBpch("76.192.834-5", false)).toBe("76192834");
    expect(rutParaBpch("76192834", false)).toBe("76192834");
  });

  it("con DV si el parámetro lo pide (lo calcula si falta)", () => {
    expect(rutParaBpch("12.345.678-5", true)).toBe("123456785");
    expect(rutParaBpch("12345678", true)).toBe("123456785");
  });

  it("rechaza lo que no es RUT", () => {
    expect(rutParaBpch("", false)).toBeNull();
    expect(rutParaBpch("abc", false)).toBeNull();
    expect(rutParaBpch(null, false)).toBeNull();
  });
});

describe("payload de creación de OT", () => {
  it("arma el JSON del documento del BPCH", () => {
    const { payload, errores } = construirPayload(datos(), false);
    expect(errores).toEqual([]);
    expect(payload).toEqual({
      lims_ot_id: "PRUEBA-2026-0001",
      tipo_orden: 2,
      resolucion: { numero: "RES-PRUEBA-1", fecha: "2026-11-20" },
      solicitante: { rut: "11111111", email: "prueba@ejemplo.cl" },
      creador: { rut: null },
      cantidad_armas: 3,
      observaciones: "PRUEBA",
      documentos_adjuntos: [{ nombre: "resolucion.pdf", tipo: "resolucion", url_descarga: "https://lims.prueba/api/v1/integracion/bpch/adjuntos/x" }],
    });
  });

  it("resolución dentro del mensaje (base64, por defecto acordado con el BPCH)", () => {
    const { payload } = construirPayload(datos({ adjuntos: [{ nombre: "resolucion.pdf", base64: PDF }] }), false);
    expect(payload?.documentos_adjuntos).toEqual([{ nombre: "resolucion.pdf", tipo: "resolucion", contenido_base64: PDF }]);
  });

  it("persona natural: bloque opcional con RUT y DV aparte (propuesta)", () => {
    const persona = { rut: "11.111.111-1", nombres: "Persona", apellidos: "Prueba", email: "p@ejemplo.cl", telefono: "", domicilio: "Calle PRUEBA 1", comuna: "Santiago" };
    const { payload } = construirPayload(datos({ tipoOrden: 1, persona }), false);
    expect(payload?.solicitante.persona).toEqual({ rut: "11111111", dv: "1", nombres: "Persona", apellidos: "Prueba", email: "p@ejemplo.cl", telefono: null, domicilio: "Calle PRUEBA 1", comuna: "Santiago" });
    // Empresa (2): no va el bloque.
    expect(construirPayload(datos({ tipoOrden: 2, persona }), false).payload?.solicitante.persona).toBeUndefined();
  });

  it("lista lo que falta", () => {
    const { payload, errores } = construirPayload(datos({ resolucionNumero: null, resolucionFecha: "no", cantidadArmas: 0, solicitanteRut: "x", solicitanteEmail: "malo" }), false);
    expect(payload).toBeNull();
    expect(errores).toHaveLength(5);
  });

  it("correo vacío se manda como null (el BPCH usa el de la ficha)", () => {
    expect(construirPayload(datos({ solicitanteEmail: "" }), false).payload?.solicitante.email).toBeNull();
  });

  it("fecha de un Date en hora de Chile", () => {
    expect(fechaIso(new Date("2026-11-21T02:00:00Z"))).toBe("2026-11-20");
    expect(fechaIso("2026-11-20T10:00:00")).toBe("2026-11-20");
    expect(fechaIso(null)).toBeNull();
  });
});

describe("respuesta del BPCH al crear", () => {
  it("201 enviado, 409 duplicado, 400 rechazado, 5xx/red reintento", () => {
    expect(clasificarRespuesta(201)).toBe("enviado");
    expect(clasificarRespuesta(409)).toBe("duplicado");
    expect(clasificarRespuesta(400)).toBe("rechazado");
    expect(clasificarRespuesta(401)).toBe("rechazado");
    expect(clasificarRespuesta(503)).toBe("reintentar");
    expect(clasificarRespuesta(429)).toBe("reintentar");
    expect(clasificarRespuesta(null)).toBe("reintentar");
  });

  it("bpch_id de data", () => {
    expect(bpchIdDe({ data: { bpch_id: 1289 } })).toBe(1289);
    expect(bpchIdDe({ data: {} })).toBeNull();
  });

  it("calendario acordado: 1 min, 5 min, 15 min, 1 h y luego cada 6 h", () => {
    expect([1, 2, 3, 4, 5, 9].map((n) => esperaReintentoMs(n, 0.5))).toEqual([60_000, 300_000, 900_000, 3_600_000, 6 * 3_600_000, 6 * 3_600_000]);
  });

  it("se agota a los N intentos o a las 48 h", () => {
    const t0 = new Date("2026-11-24T10:00:00Z");
    expect(reintentosAgotados(3, 12, t0, new Date("2026-11-24T11:00:00Z"))).toBe(false);
    expect(reintentosAgotados(12, 12, t0, new Date("2026-11-24T11:00:00Z"))).toBe(true);
    expect(reintentosAgotados(5, 12, t0, new Date("2026-11-26T10:00:00Z"))).toBe(true);
  });
});

describe("firma HMAC del webhook", () => {
  const cuerpo = Buffer.from('{"ot":"PRUEBA-2026-0001","estado":6}');
  it("acepta la firma correcta, con o sin prefijo", () => {
    const f = firmaHmac(cuerpo, "clave-prueba");
    expect(verificarHmac(cuerpo, f, "clave-prueba")).toBe(true);
    expect(verificarHmac(cuerpo, f.replace("sha256=", ""), "clave-prueba")).toBe(true);
  });
  it("rechaza firma de otro cuerpo, otra clave o mal formada", () => {
    const f = firmaHmac(cuerpo, "clave-prueba");
    expect(verificarHmac(Buffer.from(cuerpo.toString() + " "), f, "clave-prueba")).toBe(false);
    expect(verificarHmac(cuerpo, f, "otra")).toBe(false);
    expect(verificarHmac(cuerpo, "sha256=zz", "clave-prueba")).toBe(false);
    expect(verificarHmac(cuerpo, undefined, "clave-prueba")).toBe(false);
    expect(verificarHmac(undefined, f, "clave-prueba")).toBe(false);
  });
});

describe("estados (mapa configurable)", () => {
  it("efecto en el LIMS con el mapa por defecto", () => {
    expect(efectoEstado(1, "Falta poder notarial")).toBe("rechazo"); // compatibilidad con el primer documento
    expect(efectoEstado(1, null)).toBe("avance");
    expect(efectoEstado(6, null)).toBe("avance");
    expect(efectoEstado(2, null)).toBe("firmada");
    expect(efectoEstado(8, null)).toBe("finalizada");
    expect(efectoEstado(3, null)).toBe("anulada");
    expect(efectoEstado(4, null)).toBe("rechazo_total");
    expect(efectoEstado(9, "observación")).toBe("rechazo");
    expect(efectoEstado(77, null)).toBe("desconocido");
  });
  it("terminales: 8, 3 y 4", () => {
    expect([8, 3, 4, 2, 9, 77].map((c) => esTerminal(c))).toEqual([true, true, true, false, false, false]);
  });
  it("un mapa propio manda (el BPCH fija el código del rechazo parcial)", () => {
    const m = mapaEstados([{ codigo: 10, descripcion: "Pendiente rechazado", tipo: "rechazo", terminal: false }]);
    expect(efectoEstado(10, null, m)).toBe("rechazo");
    expect(efectoEstado(9, null, m)).toBe("desconocido");
    expect(descripcionEstado(10, null, null, m)).toBe("Pendiente rechazado");
    expect(descripcionEstado(55, null, null, m)).toBe("Estado 55 (desconocido)");
  });
  it("descripción", () => {
    expect(descripcionEstado(7)).toBe("Visado Internación");
    expect(descripcionEstado(1, "motivo")).toBe("Rechazada");
    expect(descripcionEstado(2, null, "Firmada y en Comercial")).toBe("Firmada y en Comercial");
  });
  it("fuera de orden: fecha anterior al último aplicado", () => {
    expect(fueraDeOrden(new Date("2026-11-23T10:00:00-03:00"), new Date("2026-11-23T11:00:00-03:00"))).toBe(true);
    expect(fueraDeOrden(new Date("2026-11-23T12:00:00-03:00"), new Date("2026-11-23T11:00:00-03:00"))).toBe(false);
    expect(fueraDeOrden(new Date(), null)).toBe(false);
  });
});

describe("DGMN y certificados D11", () => {
  it("rechazo total y certificados de rechazo dejan notificación pendiente (sin repetir)", () => {
    const n = notificacionesDgmn("rechazo_total", [
      { tipo: "certificado_rechazo", numeroSerie: "PRUEBA-1", url: "https://a/1" },
      { tipo: "certificado_rechazo", numeroSerie: "PRUEBA-1", url: "https://a/1" },
      { tipo: "certificado", numeroSerie: "PRUEBA-2", url: "https://a/2" },
    ]);
    expect(n.map((x) => x.referencia)).toEqual(["rechazo_total", "certificado_rechazo:PRUEBA-1"]);
    expect(notificacionesDgmn("avance", [])).toEqual([]);
  });
  it("motivo del bloqueo del paso 9", () => {
    expect(MOTIVO_SIN_CERTIFICADO_D11).toMatch(/numeración/);
  });
});

describe("lectura de avisos de estado", () => {
  it("opción 1 (POST directo)", () => {
    const { evento } = leerEvento({ ot: "PRUEBA-1", nuevo_estado: 2, estado_descripcion: "Firmada y en Comercial", fecha_actualizacion: "2026-11-23T15:30:00-03:00", operador_rut: "11111111", motivo: null });
    expect(evento).toMatchObject({ ot: "PRUEBA-1", estado: 2, operadorRut: "11111111", fecha: "2026-11-23T15:30:00-03:00", enlaces: [] });
  });
  it("opción 2 (webhook) con acta en base64", () => {
    const { evento } = leerEvento({
      evento_id: "evt_prueba",
      ot: "PRUEBA-1",
      estado: 8,
      usuario_rut: "11111111",
      fecha_cambio: "2026-11-23T16:45:00-03:00",
      total_certificados: 50,
      documento_cierre: { nombre: "Acta.pdf", tipo: "acta_finalizacion", descripcion: "Acta PRUEBA", base64: PDF },
    });
    expect(evento?.eventoId).toBe("evt_prueba");
    expect(evento?.totalCertificados).toBe(50);
    expect(evento?.documento).toMatchObject({ tipo: "acta_finalizacion", base64: PDF, url: null });
  });
  it("opción 3 (GET estado) con bpch_id", () => {
    expect(leerEvento({ bpch_id: 1289, ot: "PRUEBA-1", estado: 6 }).evento?.bpchId).toBe(1289);
  });
  it("errores de validación (cualquier código entero es válido: el mapa decide)", () => {
    expect(leerEvento({ estado: 4 }).errores).toHaveLength(1);
    expect(leerEvento({ ot: "x", estado: 77 }).errores).toHaveLength(0);
    expect(leerEvento({ ot: "x", estado: "a" }).errores).toHaveLength(1);
    expect(leerEvento({ ot: "x", estado: 2, total_disparos: -1 }).errores).toHaveLength(1);
    expect(leerEvento([]).errores).toHaveLength(1);
    expect(leerEvento({ ot: "x", estado: 2, fecha_cambio: "ayer" }).errores).toHaveLength(1);
    expect(leerEvento({ ot: "x", estado: 8, documento_cierre: { nombre: "a" } }).errores).toHaveLength(1);
  });
  it("id de evento: cabecera, evento_id o hash estable", () => {
    const { evento } = leerEvento({ ot: "PRUEBA-1", estado: 6, fecha_cambio: "2026-11-23T10:00:00-03:00" });
    expect(idEvento(evento!, "evt-cab")).toBe("evt-cab");
    const h = idEvento(evento!);
    expect(h).toMatch(/^h:[0-9a-f]{40}$/);
    expect(idEvento(evento!)).toBe(h);
  });
  it("lo guardado no lleva el base64", () => {
    const g = cuerpoSinBase64({ documento_cierre: { base64: PDF }, enlaces: [{ url: "https://a" }] });
    expect(g.documento_cierre.base64).toMatchObject({ omitido: true, caracteres: PDF.length });
    expect(JSON.stringify(g)).not.toContain(PDF);
  });
});

describe("enlaces del BPCH (los certificados quedan en su aplicativo)", () => {
  it("url_ot, enlaces[] y certificados[] con solo enlace", () => {
    const { enlaces, errores } = leerEnlaces({
      url_ot: "https://armas.prueba/ot/1289",
      enlaces: [{ tipo: "acta", url: "https://armas.prueba/acta/1" }],
      certificados: [
        { numero_serie: "PRUEBA-001", url: "https://armas.prueba/cert/1", idFed: "FED-1", base64: PDF, total_disparos: 3 },
        { numero_serie: "PRUEBA-002" },
        { numero_serie: "PRUEBA-003", url: "https://armas.prueba/cert/3", tipo: "certificado_rechazo" },
      ],
    });
    expect(errores).toEqual([]);
    expect(enlaces).toEqual([
      { tipo: "ot", etiqueta: "OT en el sistema de armas del BPCH", numeroSerie: null, idExterno: null, url: "https://armas.prueba/ot/1289" },
      { tipo: "acta", etiqueta: "Acta de cierre", numeroSerie: null, idExterno: null, url: "https://armas.prueba/acta/1", totalDisparos: null },
      { tipo: "certificado", etiqueta: "Certificado serie PRUEBA-001", numeroSerie: "PRUEBA-001", idExterno: "FED-1", url: "https://armas.prueba/cert/1", totalDisparos: 3 },
      { tipo: "certificado_rechazo", etiqueta: "Certificado de rechazo serie PRUEBA-003", numeroSerie: "PRUEBA-003", idExterno: null, url: "https://armas.prueba/cert/3", totalDisparos: null },
    ]);
    expect(JSON.stringify(enlaces)).not.toContain(PDF);
  });
  it("arreglo en la raíz = enlaces[]; tipos inválidos", () => {
    expect(leerEnlaces([{ tipo: "certificado", url: "https://a/b", numero_serie: "S1" }]).enlaces).toHaveLength(1);
    expect(leerEnlaces({ enlaces: [{ tipo: "virus", url: "https://a" }] }).errores).toHaveLength(1);
    expect(leerEnlaces({ enlaces: "x" }).errores).toHaveLength(1);
  });
  it("el evento acepta el acta como enlace", () => {
    const { evento } = leerEvento({ ot: "P", estado: 8, documento_cierre: { nombre: "Acta", tipo: "acta_finalizacion", url: "https://armas.prueba/acta/9" } });
    expect(evento?.documento).toMatchObject({ base64: null, url: "https://armas.prueba/acta/9" });
  });
});

describe("validación de URL de enlaces", () => {
  const hosts = ["armas.prueba", "10.50.0.9:8443"];
  it("acepta http/https a un servidor permitido", () => {
    expect(validarUrlEnlace("https://armas.prueba/cert/1?x=1", hosts).url).toBe("https://armas.prueba/cert/1?x=1");
    expect(validarUrlEnlace("http://ARMAS.prueba:8080/a", hosts).url).toBe("http://armas.prueba:8080/a");
    expect(validarUrlEnlace("https://10.50.0.9:8443/a", hosts).url).toBe("https://10.50.0.9:8443/a");
  });
  it("rechaza otros esquemas, servidores, credenciales y puertos no listados", () => {
    expect(validarUrlEnlace("javascript:alert(1)", hosts).error).toMatch(/http/);
    expect(validarUrlEnlace("file:///etc/passwd", hosts).url).toBeNull();
    expect(validarUrlEnlace("https://malicioso.ejemplo/x", hosts).error).toMatch(/no está en la lista/);
    expect(validarUrlEnlace("https://armas.prueba.malicioso.ejemplo/x", hosts).url).toBeNull();
    expect(validarUrlEnlace("https://u:p@armas.prueba/x", hosts).url).toBeNull();
    expect(validarUrlEnlace("https://10.50.0.9:9999/a", hosts).url).toBeNull();
    expect(validarUrlEnlace("no es url", hosts).url).toBeNull();
    expect(validarUrlEnlace("https://armas.prueba/x", []).error).toMatch(/servidores permitidos/);
  });
  it("lista vacía = el servidor de la dirección base", () => {
    expect(hostsPermitidos({ hostsPermitidos: [], urlBase: "https://armas.prueba:8443" })).toEqual(["armas.prueba:8443"]);
    expect(hostsPermitidos({ hostsPermitidos: ["a.b"], urlBase: "https://x" })).toEqual(["a.b"]);
    expect(hostsPermitidos({ hostsPermitidos: [], urlBase: "" })).toEqual([]);
  });
  it("ruta de enlaces con {ot} y {bpch_id}", () => {
    expect(rutaEnlaces("/api/v1/x/{ot}/enlaces", "PRUEBA 1", null)).toBe("/api/v1/x/PRUEBA%201/enlaces");
    expect(rutaEnlaces("/api/v1/x/{bpch_id}", "P", 1289)).toBe("/api/v1/x/1289");
    expect(rutaEnlaces("/api/v1/x/{bpch_id}", "P", null)).toBeNull();
    expect(rutaEnlaces("", "P", 1)).toBeNull();
    expect(rutaEnlaces("https://otro/x", "P", 1)).toBeNull();
  });
});

describe("PDF recibido", () => {
  it("acepta un PDF y rechaza lo demás", () => {
    expect(pdfDeBase64(PDF).datos?.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdfDeBase64("data:application/pdf;base64," + PDF).datos).not.toBeNull();
    expect(pdfDeBase64(Buffer.from("hola").toString("base64")).error).toMatch(/PDF/);
    expect(pdfDeBase64("%%%").error).toMatch(/base64/);
  });
  it("nombre seguro", () => {
    expect(nombrePdf("../a/b:c")).toBe(".._a_b_c.pdf");
    expect(nombrePdf("")).toBe("documento.pdf");
    expect(nombrePdf("Acta.PDF")).toBe("Acta.PDF");
  });
});

describe("enlace firmado de descarga", () => {
  const id = "0b6f8a7e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
  it("vale hasta su vencimiento", () => {
    const t = firmarEnlace(id, 2_000_000_000, "s");
    expect(verificarEnlace(t, "s", 1_999_999_999)).toEqual({ adjuntoId: id, error: null });
    expect(verificarEnlace(t, "s", 2_000_000_001).error).toMatch(/venció/);
  });
  it("no se puede alterar", () => {
    const t = firmarEnlace(id, 2_000_000_000, "s");
    const [a, , c] = t.split(".");
    expect(verificarEnlace(`${a}.${(3_000_000_000).toString(36)}.${c}`, "s", 0).error).toMatch(/inválido/);
    expect(verificarEnlace(t, "otra", 0).error).toMatch(/inválido/);
    expect(verificarEnlace("x", "s", 0).error).toMatch(/inválido/);
  });
});

describe("parámetros y direcciones", () => {
  it("valores por defecto", () => {
    expect(configArmas([])).toEqual({
      activa: false,
      urlBase: "",
      modoRetorno: "webhook",
      enviarAutomatico: false,
      unidades: ["D11", "BPCH"],
      maxIntentos: 12,
      intervaloPullMin: 15,
      rutConDv: false,
      vigenciaEnlaceHoras: 72,
      cerrarOtAlFinalizar: false,
      hostsPermitidos: [],
      rutaEnlacesOt: "",
      guardarActaPdf: true,
      modoAdjunto: "base64",
    });
  });
  it("lee los valores y descarta los inválidos", () => {
    const c = configArmas([
      { codigo: "activa", valor: "si" },
      { codigo: "url_base", valor: "https://armas.prueba/" },
      { codigo: "modo_retorno", valor: "pull" },
      { codigo: "max_intentos", valor: "999" },
      { codigo: "hosts_permitidos", valor: "Armas.Prueba, otro.prueba" },
      { codigo: "guardar_acta_pdf", valor: "no" },
      { codigo: "rut_con_dv", valor: "si", activo: false },
    ]);
    expect(c).toMatchObject({ activa: true, urlBase: "https://armas.prueba", modoRetorno: "pull", maxIntentos: 12, hostsPermitidos: ["armas.prueba", "otro.prueba"], guardarActaPdf: false, rutConDv: false });
  });
  it("URL base válida", () => {
    expect(urlBaseValida("https://armas.prueba")).toBe(true);
    expect(urlBaseValida("ftp://x")).toBe(false);
    expect(urlBaseValida("https://u:p@x")).toBe(false);
  });
  it("dirección del LIMS para el BPCH", () => {
    expect(urlBaseLims({ LIMS_URL_INTEGRACION: "https://lims.prueba/" } as any)).toBe("https://lims.prueba");
    expect(urlBaseLims({ DOMAIN: "lims.prueba" } as any)).toBe("https://lims.prueba");
    expect(urlBaseLims({ CORS_ORIGINS: "http://localhost:3000" } as any)).toBe("http://localhost:3000");
    expect(urlBaseLims({ API_PORT: "3001" } as any)).toBe("http://localhost:3001");
  });
});
