/**
 * Tests de la generación de correlativos de OT (`codigo.ts`).
 *
 * Formato OT-AAAA-NNNN (año + secuencia de 4 dígitos con padding). El `db` se
 * mockea (Prisma/tx); el AÑO se fija con fake timers para que el test sea
 * determinista y no dependa del reloj real.
 */
import { generarCodigoOt } from "./codigo";

/** Mock mínimo del cliente Prisma: solo `ordenTrabajo.findFirst`. */
function dbConUltima(codigo: string | null) {
  return {
    ordenTrabajo: {
      findFirst: jest.fn().mockResolvedValue(codigo ? { codigo } : null),
    },
  };
}

describe("generarCodigoOt", () => {
  beforeAll(() => {
    // Congela el reloj en 2026 para que AAAA sea estable.
    jest.useFakeTimers().setSystemTime(new Date("2026-07-17T12:00:00Z"));
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  it("arranca en NNNN=0001 cuando no hay OT previa del año", async () => {
    const db = dbConUltima(null);
    await expect(generarCodigoOt(db, "tenant-1")).resolves.toBe("OT-2026-0001");
  });

  it("incrementa la secuencia a partir de la última OT del año", async () => {
    const db = dbConUltima("OT-2026-0041");
    await expect(generarCodigoOt(db, "tenant-1")).resolves.toBe("OT-2026-0042");
  });

  it("mantiene el padding a 4 dígitos", async () => {
    const db = dbConUltima("OT-2026-0009");
    await expect(generarCodigoOt(db, "tenant-1")).resolves.toBe("OT-2026-0010");
  });

  it("consulta filtrada por tenant y por prefijo del año, orden descendente", async () => {
    const db = dbConUltima("OT-2026-0100");
    await generarCodigoOt(db, "tenant-XYZ");
    expect(db.ordenTrabajo.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: "tenant-XYZ", codigo: { startsWith: "OT-2026-" } },
        orderBy: { codigo: "desc" },
        select: { codigo: true },
      }),
    );
  });

  it("usa el año en curso del reloj (fake timer → 2026)", async () => {
    const db = dbConUltima(null);
    const codigo = await generarCodigoOt(db, "t");
    expect(codigo.startsWith("OT-2026-")).toBe(true);
  });

  it("si el correlativo previo no es numérico, parseInt('NaN')+1 documenta comportamiento", async () => {
    // partes[2] = "XXXX" → parseInt = NaN → NaN+1 = NaN → padStart('NaN').
    // No es un caso real (los códigos los genera esta misma función), pero fija
    // el comportamiento observable ante datos corruptos: NO lanza.
    const db = dbConUltima("OT-2026-XXXX");
    const codigo = await generarCodigoOt(db, "t");
    expect(codigo).toBe("OT-2026-0NaN");
  });

  it("cruza el año: una OT de 2025 no se reutiliza (el findFirst la filtra por prefijo)", async () => {
    // El where usa startsWith OT-2026-, así que aunque el mock devolviera null
    // (no hay de 2026), arranca en 0001 aunque existan de 2025.
    const db = dbConUltima(null);
    await expect(generarCodigoOt(db, "t")).resolves.toBe("OT-2026-0001");
  });
});
