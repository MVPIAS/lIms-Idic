import { generarPdf } from "../plantilla-render/pdf.renderer";
import type { Sello } from "../plantilla-render/plantilla-defecto";
import {
  analizarSubida,
  bytesLiteral,
  correspondePrefijo,
  detectarFirmas,
  errorMotivoExcepcion,
  esPdf,
  exigeFea,
  fechaPdf,
  leyendaFea,
  messageDigestCms,
  mensajeFaltaFea,
  nombreArchivoFea,
  textoPdf,
  valorTexto,
} from "./fea.reglas";
import { cmsMinimoPrueba, firmarPdfPrueba } from "./pdf-firma-prueba";

const SELLO: Sello = {
  numero: "IE-PRUEBA-0001",
  codigoVerificacion: "PRUEB-A0001",
  hash: "a".repeat(64),
  fecha: "14-11-2026",
  urlVerificacion: "https://lims.local/verificar/PRUEB-A0001",
};

let original: Buffer;
let otroOriginal: Buffer;

beforeAll(async () => {
  original = await generarPdf("<h1>Informe de ensayo PRUEBA</h1><p>Resultado PRUEBA.</p>", SELLO, "Informe PRUEBA");
  otroOriginal = await generarPdf("<h1>Otro documento PRUEBA</h1>", { ...SELLO, numero: "IE-PRUEBA-0002" }, "Otro PRUEBA");
});

const firmar = (pdf: Buffer, extra: Partial<Parameters<typeof firmarPdfPrueba>[1]> = {}) =>
  firmarPdfPrueba(pdf, {
    nombre: "JUAN PRUEBA PÉREZ",
    fecha: "D:20261114103000-03'00'",
    motivo: "Firma PRUEBA",
    firmarCms: (d) => cmsMinimoPrueba(d),
    ...extra,
  });

describe("detección de firma", () => {
  it("un PDF del LIMS no trae firma", () => {
    expect(esPdf(original)).toBe(true);
    expect(detectarFirmas(original)).toEqual([]);
  });

  it("detecta la firma agregada como actualización incremental, con su nombre y fecha", () => {
    const f = detectarFirmas(firmar(original));
    expect(f).toHaveLength(1);
    expect(f[0].nombre).toBe("JUAN PRUEBA PÉREZ"); // UTF-16BE con BOM
    expect(f[0].fecha).toBe("2026-11-14T13:30:00.000Z");
    expect(f[0].motivo).toBe("Firma PRUEBA");
    expect(f[0].subFilter).toBe("ETSI.CAdES.detached");
    expect(f[0].estructuraValida).toBe(true);
    expect(f[0].cubreHastaElFinal).toBe(true);
    expect(f[0].integra).toBe(true);
  });

  it("sin /Name ni /M: firma detectada, sin nombre ni fecha", () => {
    const f = detectarFirmas(firmar(original, { nombre: null, fecha: null }));
    expect(f).toHaveLength(1);
    expect(f[0].nombre).toBeNull();
    expect(f[0].fecha).toBeNull();
  });

  it("un /ByteRange suelto que no es diccionario de firma no cuenta", () => {
    const falso = Buffer.concat([original, Buffer.from("\n99 0 obj\n<< /ByteRange [0 10 20 30] /Contents <00> >>\nendobj\n", "latin1")]);
    expect(detectarFirmas(falso)).toEqual([]);
  });

  it("si el PDF se modifica después de firmar, la integridad no cuadra", () => {
    const f = firmar(original);
    const alterado = Buffer.from(f);
    const i = alterado.indexOf("PRUEBA", 200, "latin1");
    alterado.write("PRUEBO", i, "latin1");
    expect(detectarFirmas(alterado)[0].integra).toBe(false);
  });

  it("acepta CMS con SHA-1 y SHA-512", () => {
    expect(detectarFirmas(firmar(original, { firmarCms: (d) => cmsMinimoPrueba(d, "sha1") }))[0].integra).toBe(true);
    expect(detectarFirmas(firmar(original, { firmarCms: (d) => cmsMinimoPrueba(d, "sha512") }))[0].integra).toBe(true);
  });

  it("sin messageDigest en el CMS la integridad queda sin comprobar (null)", () => {
    const f = detectarFirmas(firmar(original, { firmarCms: () => Buffer.from([0x30, 0x03, 0x02, 0x01, 0x01]) }));
    expect(f[0].integra).toBeNull();
    expect(messageDigestCms(Buffer.from([0x30, 0x00]))).toBeNull();
  });

  it("dos firmas sucesivas: las dos se detectan y la segunda cubre todo", () => {
    const dos = firmar(firmar(original), { nombre: "SEGUNDO PRUEBA" });
    const f = detectarFirmas(dos);
    expect(f.map((x) => x.nombre)).toEqual(["JUAN PRUEBA PÉREZ", "SEGUNDO PRUEBA"]);
    expect(f[0].cubreHastaElFinal).toBe(false);
    expect(f[1].cubreHastaElFinal).toBe(true);
    expect(f.every((x) => x.integra)).toBe(true);
  });
});

describe("comprobación de prefijo (mismo documento)", () => {
  it("el firmado empieza con los bytes del emitido", () => {
    expect(correspondePrefijo(original, firmar(original))).toBe(true);
  });
  it("otro documento firmado no corresponde", () => {
    expect(correspondePrefijo(original, firmar(otroOriginal))).toBe(false);
  });
  it("el mismo PDF sin agregar nada no cuenta como firmado", () => {
    expect(correspondePrefijo(original, original)).toBe(false);
  });
});

describe("analizarSubida", () => {
  it("PDF firmado del documento emitido → corresponde, con la firma elegida", () => {
    const a = analizarSubida(firmar(original), [otroOriginal, original]);
    expect(a.errores).toEqual([]);
    expect(a.corresponde).toBe(true);
    expect(a.originalIndice).toBe(1);
    expect(a.firma?.nombre).toBe("JUAN PRUEBA PÉREZ");
  });
  it("no es PDF → error", () => {
    expect(analizarSubida(Buffer.from("hola PRUEBA"), [original]).errores[0]).toMatch(/no es un PDF/);
  });
  it("PDF sin firma → error que explica qué subir", () => {
    expect(analizarSubida(original, [original]).errores[0]).toMatch(/no trae ninguna firma digital/);
  });
  it("PDF alterado después de firmar → error", () => {
    const f = firmar(original);
    const i = f.indexOf("PRUEBA", 200, "latin1");
    f.write("PRUEBO", i, "latin1");
    expect(analizarSubida(f, [original]).errores.join(" ")).toMatch(/se modificó después de firmarlo/);
  });
  it("firmado de otro documento → no corresponde (se salva solo con excepción)", () => {
    const a = analizarSubida(firmar(otroOriginal), [original]);
    expect(a.errores).toEqual([]);
    expect(a.corresponde).toBe(false);
    expect(a.noCorresponde).toMatch(/no corresponde al documento emitido/);
    expect(a.firma?.nombre).toBe("JUAN PRUEBA PÉREZ");
  });
  it("sin PDF emitido guardado → no corresponde, con la indicación de descargarlo", () => {
    expect(analizarSubida(firmar(original), []).noCorresponde).toMatch(/Descargue el PDF para firmar/);
  });
});

describe("cadenas y fechas PDF", () => {
  it("escapes de cadenas literales", () => {
    expect(bytesLiteral("a\\(b\\)c\\\\d\\101\\n").toString("latin1")).toBe("a(b)c\\dA\n");
    expect(valorTexto("<< /Name (Ana \\(PRUEBA\\)) >>", "Name")).toBe("Ana (PRUEBA)");
    expect(valorTexto("<< /Name <FEFF00D100F1> >>", "Name")).toBe("Ññ");
    expect(valorTexto("<< /Name (Mar\\355a) >>", "Name")).toBe("María"); // PDFDocEncoding
    expect(valorTexto("<< /Reason (x) >>", "Name")).toBeNull();
    expect(textoPdf(Buffer.from([0xef, 0xbb, 0xbf, 0x41]))).toBe("A");
  });
  it("fechas con zona, en UTC y formas cortas", () => {
    expect(fechaPdf("D:20261114103000-03'00'")).toBe("2026-11-14T13:30:00.000Z");
    expect(fechaPdf("D:20261114103000Z")).toBe("2026-11-14T10:30:00.000Z");
    expect(fechaPdf("D:20261114103000+01'00")).toBe("2026-11-14T09:30:00.000Z");
    expect(fechaPdf("D:2026")).toBe("2026-01-01T00:00:00.000Z");
    expect(fechaPdf("D:20261340")).toBeNull();
    expect(fechaPdf("ayer")).toBeNull();
    expect(fechaPdf(null)).toBeNull();
  });
});

describe("parámetro y textos", () => {
  const filas = [
    { codigo: "informe_ensayo", valor: "si", activo: true },
    { codigo: "certificado_arma", valor: "no", activo: true },
    { codigo: "certificado_calibracion", valor: "si", activo: false },
  ];
  it("exige FEA solo con «sí» y fila activa; por defecto no", () => {
    expect(exigeFea(filas, "INFORME_ENSAYO")).toBe(true);
    expect(exigeFea(filas, "CERTIFICADO_ARMA")).toBe(false);
    expect(exigeFea(filas, "CERTIFICADO_CALIBRACION")).toBe(false);
    expect(exigeFea(filas, "IVC")).toBe(false);
    expect(exigeFea(filas, null)).toBe(false);
  });
  it("leyenda con nombre y fecha de Chile", () => {
    expect(leyendaFea("JUAN PRUEBA", "2026-11-14T13:30:00.000Z")).toBe("Firmado con firma electrónica avanzada por JUAN PRUEBA el 14-11-2026 10:30");
    expect(leyendaFea(null, null)).toBe("Firmado con firma electrónica avanzada por el firmante");
  });
  it("mensajes", () => {
    expect(mensajeFaltaFea("IE-1", "Informe de ensayo")).toMatch(/Subir versión firmada con FEA/);
    expect(errorMotivoExcepcion("corto")).toMatch(/al menos 10/);
    expect(errorMotivoExcepcion("FirmaGob reordenó el PDF PRUEBA")).toBeNull();
    expect(nombreArchivoFea("IE 2026/1", true)).toBe("IE_2026_1_FEA.pdf");
  });
});
