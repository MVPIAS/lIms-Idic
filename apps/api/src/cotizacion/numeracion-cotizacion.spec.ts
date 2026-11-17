import { NUMERACION_DEF, configNumeracion, formatearNumeroCotizacion, generarNumeroCotizacion, inicioDeSerie, numeroFormulario, serieDe } from "./numeracion-cotizacion";

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
      inicioAnio: null,
    });
    // Sin {N} no hay correlativo: se ignora el formato.
    expect(configNumeracion({ formato: "{AAAA}", digitos: "x", reinicio: "otro", inicio: "-3" })).toEqual(NUMERACION_DEF);
  });

  it("COM-11: por defecto el correlativo reinicia cada año", () => {
    expect(NUMERACION_DEF.reinicio).toBe("anual");
    expect(configNumeracion({}).reinicio).toBe("anual");
    expect(configNumeracion({ reinicio: "global" }).reinicio).toBe("global");
  });

  it("COM-11: con reinicio anual «inicio» rige solo en su año; los demás años parten en 1", () => {
    const cfg = configNumeracion({ reinicio: "anual", inicio: "14599", inicio_anio: "2026" });
    expect(cfg.inicioAnio).toBe(2026);
    expect(inicioDeSerie(cfg, 2026)).toBe(14599);
    expect(inicioDeSerie(cfg, 2027)).toBe(0);
    // Auditoría: sin año (o 0) rige en el año en curso (y se fija al emitir).
    expect(inicioDeSerie(configNumeracion({ reinicio: "anual", inicio: "14599", inicio_anio: "0" }), 2026)).toBe(14599);
    expect(inicioDeSerie(configNumeracion({ reinicio: "anual", inicio: "0", inicio_anio: "" }), 2026)).toBe(0);
    // Correlativo global: «inicio» de siempre.
    expect(inicioDeSerie(configNumeracion({ reinicio: "global", inicio: "14599" }), 2027)).toBe(14599);
  });

  it("la serie es única (global) o una por año", () => {
    expect(serieDe({ ...NUMERACION_DEF, reinicio: "global" }, 2026)).toBe("global");
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
        if (sql.includes("FROM parametro_sistema")) return [{ codigo: "inicio", valor: "40" }, { codigo: "reinicio", valor: "global" }];
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

  it("COM-11: con reinicio anual el contador del año siguiente parte en 1 aunque haya «inicio»", async () => {
    const vistos: any[] = [];
    const db = {
      $queryRawUnsafe: async (sql: string, ...args: any[]) => {
        if (sql.includes("FROM parametro_sistema"))
          return [
            { codigo: "reinicio", valor: "anual" },
            { codigo: "inicio", valor: "14599" },
            { codigo: "inicio_anio", valor: "2026" },
          ];
        if (sql.includes("INSERT INTO cotizacion_correlativo")) {
          vistos.push(args);
          return [{ ultimo: Number(args[2]) + 1 }];
        }
        return [];
      },
    };
    await expect(generarNumeroCotizacion(db, "t", new Date(2027, 1, 10))).resolves.toBe("2027-00001");
    expect(vistos[0][1]).toBe("2027");
    await expect(generarNumeroCotizacion(db, "t", new Date(2026, 10, 10))).resolves.toBe("2026-14600");
  });

  it("auditoría: «inicio» sin año se aplica al año en curso y deja fijado inicio_anio (2027 vuelve a 1)", async () => {
    const sqls: string[] = [];
    const params = { reinicio: "anual", inicio: "14599", inicio_anio: "0" } as Record<string, string>;
    const db = {
      $queryRawUnsafe: async (sql: string, ...args: any[]) => {
        sqls.push(sql);
        if (sql.includes("FROM parametro_sistema") && sql.trim().startsWith("SELECT"))
          return Object.entries(params).map(([codigo, valor]) => ({ codigo, valor }));
        if (sql.includes("UPDATE parametro_sistema SET valor")) params.inicio_anio = String(args[1]);
        if (sql.includes("INSERT INTO cotizacion_correlativo")) return [{ ultimo: Number(args[2]) + 1 }];
        return [];
      },
    };
    await expect(generarNumeroCotizacion(db, "t", new Date(2026, 10, 20))).resolves.toBe("2026-14600");
    expect(params.inicio_anio).toBe("2026");
    expect(sqls.some((x) => x.includes("parametro_sistema_historial"))).toBe(true);
    await expect(generarNumeroCotizacion(db, "t", new Date(2027, 0, 5))).resolves.toBe("2027-00001");
  });
});
