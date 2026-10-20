import { NUMERACION_DEF, configNumeracion, formatearNumeroCotizacion, generarNumeroCotizacion, numeroFormulario, serieDe } from "./numeracion-cotizacion";

describe("Numeración real de la cotización (EP-00 2.1)", () => {
  it("por defecto da el formato del Sistema Comercial: 2026-14324", () => {
    expect(formatearNumeroCotizacion(NUMERACION_DEF, 2026, 14324)).toBe("2026-14324");
    expect(formatearNumeroCotizacion(NUMERACION_DEF, 2026, 7)).toBe("2026-00007");
  });

  it("lee los parámetros y cae a los valores por defecto si son inválidos", () => {
    expect(configNumeracion({ formato: "COT-{AAAA}-{N}", digitos: "4", reinicio: "ANUAL", inicio: "14599" })).toEqual({
      formato: "COT-{AAAA}-{N}",
      digitos: 4,
      reinicio: "anual",
      inicio: 14599,
    });
    // Sin {N} no hay correlativo: se ignora el formato.
    expect(configNumeracion({ formato: "{AAAA}", digitos: "x", reinicio: "otro", inicio: "-3" })).toEqual(NUMERACION_DEF);
  });

  it("la serie es única (global) o una por año", () => {
    expect(serieDe(NUMERACION_DEF, 2026)).toBe("global");
    expect(serieDe({ ...NUMERACION_DEF, reinicio: "anual" }, 2027)).toBe("2027");
  });

  it("el Formulario de cotización lleva el número de la cotización y su correlativo", () => {
    expect(numeroFormulario("2026-14596", 1)).toBe("FORM-2026-14596/001");
    expect(numeroFormulario("2026-14596", 12)).toBe("FORM-2026-14596/012");
  });

  it("el correlativo sale del contador atómico y salta un número ya usado", async () => {
    const llamadas: string[] = [];
    let ultimo = 41;
    const db = {
      $queryRawUnsafe: async (sql: string, ...args: any[]) => {
        llamadas.push(sql.trim().split(/\s+/)[0]);
        if (sql.includes("FROM parametro_sistema")) return [{ codigo: "inicio", valor: "40" }];
        if (sql.includes("INSERT INTO cotizacion_correlativo")) {
          expect(args[1]).toBe("global");
          ultimo = Math.max(ultimo, Number(args[2])) + 1;
          return [{ ultimo }];
        }
        // El primer número (2026-00042) ya existe (dato migrado): se toma el siguiente.
        if (sql.includes("FROM cotizacion")) return args[1] === "2026-00042" ? [{ "?column?": 1 }] : [];
        return [];
      },
    };
    await expect(generarNumeroCotizacion(db, "t", new Date(2026, 9, 20))).resolves.toBe("2026-00043");
    expect(llamadas.filter((x) => x === "INSERT")).toHaveLength(2);
  });
});
