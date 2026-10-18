import { dimensionesImagen, errorDimensionesFoto } from "./reglas-fotos";

/** PNG mínimo con el ancho y alto que se quiera en el IHDR (el resto no importa para la regla). */
function png(ancho: number, alto: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(ancho, 16);
  b.writeUInt32BE(alto, 20);
  return b;
}
/** JPEG mínimo: SOI, APP0 de 16 bytes y SOF0 con alto y ancho. */
function jpeg(ancho: number, alto: number): Buffer {
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14)]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, alto >> 8, alto & 0xff, ancho >> 8, ancho & 0xff, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]);
}

describe("fotos · dimensiones (revisión de seguridad r3: bomba de descompresión)", () => {
  it("lee el ancho y alto de PNG y JPEG", () => {
    expect(dimensionesImagen(png(1600, 1200), "image/png")).toEqual({ ancho: 1600, alto: 1200 });
    expect(dimensionesImagen(jpeg(1600, 900), "image/jpeg")).toEqual({ ancho: 1600, alto: 900 });
  });
  it("acepta una foto normal y rechaza una que declara demasiados píxeles", () => {
    expect(errorDimensionesFoto(png(1600, 1200), "image/png")).toBeNull();
    expect(errorDimensionesFoto(png(60000, 60000), "image/png")).toMatch(/máximo/);
    expect(errorDimensionesFoto(jpeg(7000, 7000), "image/jpeg")).toMatch(/megapíxeles/);
    expect(errorDimensionesFoto(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]), "image/jpeg")).toMatch(/dimensiones/);
  });
});
