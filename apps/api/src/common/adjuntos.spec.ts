import { BadRequestException } from "@nestjs/common";
import { MAX_BYTES_ADJUNTO, cabecerasAdjunto, mimePorFirma, nombreSeguro, validarAdjunto } from "./adjuntos";

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

  it("se sirve como descarga, sin sniffing ni caché compartida", () => {
    const h = cabecerasAdjunto({ nombre: "x.pdf", mime: "application/pdf", datos: PDF });
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Content-Disposition"]).toBe('attachment; filename="x.pdf"');
    expect(h["Cache-Control"]).toBe("private, no-store");
  });
});
