/**
 * Corrección de réplicas (POST /resultados/:id/recapturar) con la MISMA regla
 * de corrección que la captura por valor (traza.ts · exigeMotivoCorreccion):
 * corregir un valor ya capturado sin revisar exige motivo; tras una devolución
 * vale el motivo de la devolución. Se prueba antes de tocar la base: el
 * servicio se instancia con un prisma falso que solo responde findFirst.
 */
import { BadRequestException, ConflictException } from "@nestjs/common";
import { ResultadoService } from "./laboratorio.module";

function servicio(actual: Record<string, unknown> | null) {
  const prisma = { resultado: { findFirst: jest.fn(async () => actual) } };
  const s: any = new ResultadoService(prisma as any, {} as any);
  // Lo que viene después de la regla (cálculo y guardado) no se prueba aquí.
  s.calcular = jest.fn(async () => {
    throw new Error("SIGUE");
  });
  return s;
}

const base = { id: "r1", analitoId: "a1", motivoDevolucion: null, valorNumerico: null, valorTexto: null, resultadoFinal: null };

describe("corrección de réplicas · motivo", () => {
  it("capturado con valor: sin motivo → 400; con motivo sigue", async () => {
    const s = servicio({ ...base, estado: "capturado", promedio: 12.5 });
    await expect(s.recapturar("r1", { replicas: [12] }, "u")).rejects.toBeInstanceOf(BadRequestException);
    await expect(s.recapturar("r1", { replicas: [12], motivo: "ok" }, "u")).rejects.toBeInstanceOf(BadRequestException);
    await expect(s.recapturar("r1", { replicas: [12], motivo: "Error de digitación en RN2" }, "u")).rejects.toThrow("SIGUE");
  });

  it("devuelto: el motivo es el de la devolución, no se exige otro", async () => {
    const s = servicio({ ...base, estado: "devuelto", promedio: 12.5, motivoDevolucion: "Repetir RN3" });
    await expect(s.recapturar("r1", { replicas: [12] }, "u")).rejects.toThrow("SIGUE");
  });

  it("primera captura (sin valor): no exige motivo", async () => {
    const s = servicio({ ...base, estado: "pendiente", promedio: null });
    await expect(s.recapturar("r1", { replicas: [12] }, "u")).rejects.toThrow("SIGUE");
  });

  it("revisado o aprobado no se corrige (409); por valor no es por réplicas (400)", async () => {
    await expect(servicio({ ...base, estado: "aprobado", promedio: 1 }).recapturar("r1", { replicas: [1], motivo: "Motivo largo" }, "u")).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(servicio({ ...base, analitoId: null, estado: "capturado" }).recapturar("r1", { replicas: [1] }, "u")).rejects.toBeInstanceOf(BadRequestException);
  });
});
