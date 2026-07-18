/**
 * Tests de la máquina de estados (`estados.ts`).
 *
 * Cubre los cuatro dominios (cotización, OT, resultado, certificado): transiciones
 * válidas, inválidas, no-ops, estados finales, estado actual desconocido y rechazo
 * de estados inventados. Es lógica pura y gobierna el ciclo de vida de todo el LIMS,
 * incluida la aprobación escalonada de resultados (RF-E01, exigida por 17025).
 */
import { BadRequestException } from "@nestjs/common";
import {
  DominioEstado,
  esEstadoValido,
  estadosValidos,
  validarTransicion,
} from "./estados";

const ok = (d: DominioEstado, a: string, n: string) =>
  expect(() => validarTransicion(d, a, n)).not.toThrow();
const ko = (d: DominioEstado, a: string, n: string) =>
  expect(() => validarTransicion(d, a, n)).toThrow(BadRequestException);

describe("estados · introspección", () => {
  it("estadosValidos lista el vocabulario de cada dominio", () => {
    expect(estadosValidos("cotizacion")).toEqual(
      expect.arrayContaining(["borrador", "enviada", "aceptada", "rechazada", "expirada", "anulada"]),
    );
    expect(estadosValidos("resultado")).toEqual(
      expect.arrayContaining(["capturado", "revisado_n1", "aprobado", "rechazado", "devuelto"]),
    );
    expect(estadosValidos("certificado")).toEqual(["emitido", "anulado"]);
  });

  it("esEstadoValido distingue estados del dominio de inventados", () => {
    expect(esEstadoValido("cotizacion", "borrador")).toBe(true);
    expect(esEstadoValido("cotizacion", "en_tramite")).toBe(false);
    // El vocabulario NO se mezcla entre dominios.
    expect(esEstadoValido("certificado", "borrador")).toBe(false);
    expect(esEstadoValido("resultado", "revisado")).toBe(false); // el real es revisado_n1
  });
});

describe("estados · cotización", () => {
  it("permite el flujo feliz borrador → enviada → aceptada", () => {
    ok("cotizacion", "borrador", "enviada");
    ok("cotizacion", "enviada", "aceptada");
  });
  it("permite anular desde casi cualquier estado", () => {
    ok("cotizacion", "borrador", "anulada");
    ok("cotizacion", "enviada", "anulada");
    ok("cotizacion", "aceptada", "anulada");
    ok("cotizacion", "rechazada", "anulada");
    ok("cotizacion", "expirada", "anulada");
  });
  it("rechaza saltar de borrador directo a aceptada", () => {
    ko("cotizacion", "borrador", "aceptada");
  });
  it("'anulada' es estado final: no sale de ahí", () => {
    ko("cotizacion", "anulada", "borrador");
    ko("cotizacion", "anulada", "enviada");
  });
  it("no se puede reabrir una aceptada a enviada", () => {
    ko("cotizacion", "aceptada", "enviada");
  });
});

describe("estados · orden de trabajo (OT)", () => {
  it("recorre recepcionada → en_analisis → validacion → finalizada → cerrada", () => {
    ok("ot", "recepcionada", "en_analisis");
    ok("ot", "en_analisis", "validacion");
    ok("ot", "validacion", "finalizada");
    ok("ot", "finalizada", "cerrada");
  });
  it("'recibida' es sinónimo de recepcionada (datos sembrados)", () => {
    ok("ot", "recibida", "en_analisis");
  });
  it("validacion puede devolver a en_analisis (rechazo de validación)", () => {
    ok("ot", "validacion", "en_analisis");
  });
  it("finalizada puede pasar por 'informada' antes de cerrada", () => {
    ok("ot", "finalizada", "informada");
    ok("ot", "informada", "cerrada");
  });
  it("no se salta análisis: recepcionada → finalizada es inválido", () => {
    ko("ot", "recepcionada", "finalizada");
  });
  it("'cerrada' y 'anulada' son finales", () => {
    ko("ot", "cerrada", "en_analisis");
    ko("ot", "anulada", "en_analisis");
  });
});

describe("estados · resultado (RF-E01, aprobación escalonada)", () => {
  it("capturado → revisado_n1 → aprobado es el circuito estándar", () => {
    ok("resultado", "capturado", "revisado_n1");
    ok("resultado", "revisado_n1", "aprobado");
  });
  it("una captura recién hecha se puede devolver o rechazar sin pasar por revisado_n1", () => {
    ok("resultado", "capturado", "devuelto");
    ok("resultado", "capturado", "rechazado");
  });
  it("devuelto y rechazado reabren la captura", () => {
    ok("resultado", "devuelto", "capturado");
    ok("resultado", "rechazado", "capturado");
  });
  it("'aprobado' es final: no se reabre un resultado aprobado", () => {
    ko("resultado", "aprobado", "capturado");
    ko("resultado", "aprobado", "revisado_n1");
  });
  it("no se aprueba lo que sigue en 'capturado' (hay que revisar antes)", () => {
    ko("resultado", "capturado", "aprobado");
  });
  it("rechaza el estado 'revisado' (el válido es revisado_n1)", () => {
    ko("resultado", "capturado", "revisado");
  });
});

describe("estados · certificado", () => {
  it("emitido → anulado es la única transición", () => {
    ok("certificado", "emitido", "anulado");
  });
  it("'anulado' es final", () => {
    ko("certificado", "anulado", "emitido");
  });
  it("rechaza vocabulario de schema.sql que la app no escribe (vigente/revocado)", () => {
    ko("certificado", "emitido", "revocado");
    ko("certificado", "vigente", "anulado");
  });
});

describe("estados · reglas transversales", () => {
  it("repetir el estado actual (no-op) se admite y no lanza", () => {
    ok("cotizacion", "enviada", "enviada");
    ok("resultado", "aprobado", "aprobado"); // no-op incluso sobre un final
  });
  it("rechaza un estado destino inventado con la lista de estados válidos", () => {
    expect(() => validarTransicion("cotizacion", "borrador", "fantasma")).toThrow(
      /no válido para cotizacion/,
    );
  });
  it("un estado ACTUAL desconocido no se puede transitar automáticamente (pide intervención)", () => {
    // El destino SÍ es válido, pero el estado de partida no está en el mapa.
    expect(() => validarTransicion("cotizacion", "estado_heredado", "enviada")).toThrow(
      /estado no reconocido/,
    );
  });
  it("el mensaje de transición inválida indica qué se permite desde el estado actual", () => {
    expect(() => validarTransicion("cotizacion", "borrador", "aceptada")).toThrow(
      /solo se permite/,
    );
  });
  it("el mensaje de un estado final avisa de que es final", () => {
    expect(() => validarTransicion("resultado", "aprobado", "revisado_n1")).toThrow(
      /estado final/,
    );
  });
});
