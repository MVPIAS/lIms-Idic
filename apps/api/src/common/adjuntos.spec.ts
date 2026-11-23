import { BadRequestException } from "@nestjs/common";
import { MAX_BYTES_ADJUNTO, MAX_BYTES_ADJUNTO_AMPLIADO, cabecerasAdjunto, mimeAmpliadoPorFirma, mimePorFirma, nombreSeguro, validarAdjunto } from "./adjuntos";

const PDF = Buffer.from("%PDF-1.7\n...");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);

describe("adjuntos de un registro", () => {
  it("decide el tipo por la firma del fichero", () => {
    expect(mimePorFirma(PDF)).toBe("application/pdf");
    expect(mimePorFirma(PNG)).toBe("image/png");
    expect(mimePorFirma(JPG)).toBe("image/jpeg");
    expect(mimePorFirma(Buffer.from("<html><script>"))).toBeNull();
    expect(mimePorFirma(Buffer.from("GIF89a"))).toBeNull();
  });

  it("rechaza vacío, demasiado grande o de otro tipo aunque la extensión diga pdf", () => {
    expect(() => validarAdjunto(undefined)).toThrow(BadRequestException);
    expect(() => validarAdjunto({ buffer: Buffer.alloc(0) })).toThrow(BadRequestException);
    expect(() => validarAdjunto({ buffer: Buffer.concat([PDF, Buffer.alloc(MAX_BYTES_ADJUNTO)]) })).toThrow(/5 MB/);
    expect(() => validarAdjunto({ buffer: Buffer.from("MZ\x90\x00"), originalname: "informe.pdf" })).toThrow(/PDF, PNG o JPEG/);
    expect(validarAdjunto({ buffer: PNG, originalname: "curva.png" })).toEqual({ mime: "image/png", nombre: "curva.png" });
  });

  it("limpia el nombre: sin rutas, comillas ni caracteres de control, con la extensión del tipo real", () => {
    expect(nombreSeguro("C:\\x\\..\\Ficha técnica \"v2\".pdf", "application/pdf")).toBe("Ficha técnica v2.pdf");
    expect(nombreSeguro("../../etc/passwd", "image/png")).toBe("passwd.png");
    expect(nombreSeguro("", "image/jpeg")).toBe("adjunto.jpg");
    expect(nombreSeguro("a\r\nb", "application/pdf")).toBe("ab.pdf");
  });

  describe("modo ampliado (cotización · quinto envío): correos y Office, tope propio", () => {
    const ZIP = (interno: string) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(`[Content_Types].xml ${interno}document.xml`, "latin1")]);
    const OLE = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(16)]);
    const EML = Buffer.from("Received: from PRUEBA\r\nFrom: cliente@prueba.cl\r\nSubject: Solicitud PRUEBA\r\n\r\nCuerpo", "latin1");

    it("acepta .docx/.xlsx (ZIP Office), .doc/.xls/.msg (OLE2) y .eml (cabeceras de correo)", () => {
      expect(mimeAmpliadoPorFirma(ZIP("word/"), "ET PRUEBA.docx")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      expect(mimeAmpliadoPorFirma(ZIP("xl/"), "costos.xlsx")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      expect(mimeAmpliadoPorFirma(OLE, "correo.msg")).toBe("application/vnd.ms-outlook");
      expect(mimeAmpliadoPorFirma(OLE, "antiguo.doc")).toBe("application/msword");
      expect(mimeAmpliadoPorFirma(OLE, "planilla.xls")).toBe("application/vnd.ms-excel");
      expect(mimeAmpliadoPorFirma(EML, "correo.eml")).toBe("message/rfc822");
      expect(mimeAmpliadoPorFirma(PDF, "x.bin")).toBe("application/pdf");
    });

    it("rechaza firmas que no cuadran con la extensión, ZIP cualquiera, binarios y ejecutables", () => {
      expect(mimeAmpliadoPorFirma(ZIP("word/"), "ET.xlsx")).toBeNull();
      expect(mimeAmpliadoPorFirma(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), "x.docx")).toBeNull();
      expect(mimeAmpliadoPorFirma(OLE, "x.exe")).toBeNull();
      expect(mimeAmpliadoPorFirma(Buffer.from("MZ\x90\x00", "latin1"), "correo.eml")).toBeNull();
      expect(mimeAmpliadoPorFirma(Buffer.from("<html><script>", "latin1"), "correo.eml")).toBeNull();
      expect(() => validarAdjunto({ buffer: ZIP("word/"), originalname: "ET.docx" })).toThrow(/PDF, PNG o JPEG/);
    });

    it("tope configurable (≤ 25 MB) y nombre con la extensión del tipo real", () => {
      expect(() => validarAdjunto({ buffer: Buffer.concat([PDF, Buffer.alloc(2 * 1024 * 1024)]) }, { ampliado: true, maxBytes: 1024 * 1024 })).toThrow(/1 MB/);
      expect(() => validarAdjunto({ buffer: Buffer.concat([PDF, Buffer.alloc(MAX_BYTES_ADJUNTO_AMPLIADO)]) }, { ampliado: true, maxBytes: 999 * 1024 * 1024 })).toThrow(/25 MB/);
      expect(validarAdjunto({ buffer: Buffer.concat([PDF, Buffer.alloc(MAX_BYTES_ADJUNTO)]), originalname: "et.pdf" }, { ampliado: true, maxBytes: 15 * 1024 * 1024 }).mime).toBe("application/pdf");
      expect(validarAdjunto({ buffer: EML, originalname: "Solicitud PRUEBA.eml" }, { ampliado: true })).toEqual({ mime: "message/rfc822", nombre: "Solicitud PRUEBA.eml" });
      expect(nombreSeguro("foto.jpeg", "image/jpeg")).toBe("foto.jpeg");
      expect(nombreSeguro("correo", "application/vnd.ms-outlook")).toBe("correo.msg");
    });
  });

  it("se sirve como descarga, sin sniffing ni caché compartida", () => {
    const h = cabecerasAdjunto({ nombre: "x.pdf", mime: "application/pdf", datos: PDF });
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Content-Disposition"]).toBe('attachment; filename="x.pdf"');
    expect(h["Cache-Control"]).toBe("private, no-store");
  });
});
