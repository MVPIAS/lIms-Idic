/**
 * Tests de la generación de correlativos de OT (`codigo.ts`).
 *
 * Formato OT-AAAA-NNNN (año + secuencia de 4 dígitos con padding). El número
 * lo entrega el contador atómico `ot_correlativo` (INSERT ... ON CONFLICT DO
 * UPDATE ... RETURNING); aquí se mockea `db.$queryRaw` (Prisma/tx) y el AÑO se
 * fija con fake timers para que el test sea determinista.
 */
import { generarCodigoOt } from "./codigo";

/** Mock mínimo del cliente Prisma: `$queryRaw` devuelve el `ultimo` ya incrementado. */
function dbConContador(ultimo: number | bigint | null) {
  return {
    $queryRaw: jest.fn().mockResolvedValue(ultimo === null ? [] : [{ ultimo }]),
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

  it("arranca en NNNN=0001 cuando el contador del año se crea en la misma sentencia", async () => {
    const db = dbConContador(1);
    await expect(generarCodigoOt(db, "tenant-1")).resolves.toBe("OT-2026-0001");
  });

  it("usa el valor que devuelve el contador (ya incrementado por la base)", async () => {
    const db = dbConContador(42);
    await expect(generarCodigoOt(db, "tenant-1")).resolves.toBe("OT-2026-0042");
  });

  it("mantiene el padding a 4 dígitos", async () => {
    const db = dbConContador(10);
    await expect(generarCodigoOt(db, "tenant-1")).resolves.toBe("OT-2026-0010");
  });

  it("no se rompe al pasar de 9999: la secuencia es numérica, no lexicográfica", async () => {
    const db = dbConContador(10000);
    await expect(generarCodigoOt(db, "tenant-1")).resolves.toBe("OT-2026-10000");
  });

  it("acepta el bigint que PostgreSQL puede devolver para la columna", async () => {
    const db = dbConContador(BigInt(7));
    await expect(generarCodigoOt(db, "tenant-1")).resolves.toBe("OT-2026-0007");
  });

  it("hace UNA sola sentencia, parametrizada por tenant y por el año en curso", async () => {
    const db = dbConContador(100);
    await generarCodigoOt(db, "tenant-XYZ");
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    // Tagged template: [strings, ...valores]. Los valores viajan como
    // parámetros (nunca interpolados en el SQL).
    const [strings, ...valores] = db.$queryRaw.mock.calls[0];
    expect(valores).toEqual(["tenant-XYZ", 2026]);
    const sql = (strings as string[]).join("?");
    expect(sql).toContain("INSERT INTO ot_correlativo");
    expect(sql).toContain("ON CONFLICT (tenant_id, anio)");
    expect(sql).toContain("RETURNING ultimo");
  });

  it("si la base no devuelve fila, cae a 0001 en vez de lanzar", async () => {
    const db = dbConContador(null);
    await expect(generarCodigoOt(db, "t")).resolves.toBe("OT-2026-0001");
  });
});
