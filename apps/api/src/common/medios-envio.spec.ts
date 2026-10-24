/**
 * Frente f5 · medios de envío: una sola lista («Parámetros del sistema ›
 * medio_envio»); se ofrece y se acepta lo activo, lo inactivo se sigue leyendo.
 */
import { BadRequestException } from "@nestjs/common";
import { errorMedioEnvio, exigirMedioEnvio, exigirMedioEnvioActivo, textoEnFrase, zMedioEnvio, type MedioEnvio } from "./medios-envio";

const LISTA: MedioEnvio[] = [
  { codigo: "correo", etiqueta: "Correo electrónico", activo: true },
  { codigo: "mano", etiqueta: "Entrega en mano", activo: true },
  { codigo: "oficina_partes", etiqueta: "Oficina de partes", activo: true },
  { codigo: "libro", etiqueta: "Libro de entrega", activo: true },
  { codigo: "fax", etiqueta: "FAX (retirado)", activo: false },
];

describe("medios de envío", () => {
  it("acepta los activos de la lista (también los que antes solo estaban en el código)", () => {
    expect(errorMedioEnvio("correo", LISTA)).toBeNull();
    expect(errorMedioEnvio("oficina_partes", LISTA)).toBeNull();
    expect(errorMedioEnvio("libro", LISTA)).toBeNull();
  });

  it("rechaza uno inactivo con su texto y uno que no está en la lista", () => {
    expect(errorMedioEnvio("fax", LISTA)).toMatch(/«FAX \(retirado\)» ya no se usa/);
    expect(errorMedioEnvio("whatsapp", LISTA)).toMatch(/elija uno de la lista \(correo, mano, oficina_partes, libro\)/);
    expect(errorMedioEnvio("correo", [])).toMatch(/está vacía/);
  });

  it("el formato del código cabe en las columnas de entrega (minúsculas, hasta 30)", () => {
    expect(zMedioEnvio.parse(" mano ")).toBe("mano");
    expect(zMedioEnvio.safeParse("Mano").success).toBe(false);
    expect(zMedioEnvio.safeParse("a".repeat(31)).success).toBe(false);
    expect(() => exigirMedioEnvio("medio_envio", "Por Mano")).toThrow(BadRequestException);
    expect(() => exigirMedioEnvio("medio_envio", "whatsapp")).not.toThrow();
    expect(() => exigirMedioEnvio("forma_pago", "Contado 30")).not.toThrow();
  });

  it("lee la lista de la base y devuelve el texto del medio", async () => {
    const db = { $queryRawUnsafe: jest.fn().mockResolvedValue(LISTA) };
    await expect(exigirMedioEnvioActivo(db as any, "t", "mano")).resolves.toBe("Entrega en mano");
    await expect(exigirMedioEnvioActivo(db as any, "t", "fax")).rejects.toThrow(BadRequestException);
    expect(db.$queryRawUnsafe.mock.calls[0][2]).toBe("medio_envio");
  });

  it("texto para una frase: minúscula inicial salvo siglas", () => {
    expect(textoEnFrase("Entrega en mano")).toBe("entrega en mano");
    expect(textoEnFrase("FAX (retirado)")).toBe("FAX (retirado)");
  });
});
