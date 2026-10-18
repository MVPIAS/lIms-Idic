import {
  comprobarGeneracionOt,
  consumoOc,
  correlacionar,
  estadoLinea,
  faltantesInforme,
  fechaReferenciaLinea,
  rangoMes,
  resumenPrograma,
  sugerenciaConforme,
  validarLinea,
  type LineaPrograma,
} from "./reglas-pn";

const oc = { estado: "vigente", anio: 2026, vigenciaDesde: "2026-03-01", vigenciaHasta: "2026-12-31" };
const L = (o: Partial<LineaPrograma>): LineaPrograma => ({ anulada: false, otId: null, otEstado: null, mes: 5, ocProductoId: "p1", ...o });

describe("Producción Nacional · estado de cada inspección", () => {
  it("planificada, en curso, ejecutada (OT cerrada), OT anulada y anulada", () => {
    expect(estadoLinea(L({}))).toBe("planificada");
    expect(estadoLinea(L({ otId: "o", otEstado: "en_analisis" }))).toBe("en_curso");
    expect(estadoLinea(L({ otId: "o", otEstado: "cerrada" }))).toBe("ejecutada");
    expect(estadoLinea(L({ otId: "o", otEstado: "anulada" }))).toBe("ot_anulada");
    expect(estadoLinea(L({ anulada: true, otId: "o", otEstado: "cerrada" }))).toBe("anulada");
  });

  it("resumen del programa: planificadas, en curso, ejecutadas, pendientes y atrasadas", () => {
    const r = resumenPrograma(
      [
        L({ mes: 3 }), // planificada y atrasada
        L({ mes: 11 }), // planificada a futuro
        L({ mes: 4, otId: "a", otEstado: "en_analisis" }), // en curso (no cuenta como atrasada)
        L({ mes: 5, otId: "b", otEstado: "cerrada" }),
        L({ mes: 2, otId: "c", otEstado: "anulada" }), // OT anulada y atrasada
        L({ mes: 6, anulada: true }),
      ],
      2026,
      { anio: 2026, mes: 10 },
    );
    expect(r).toEqual({ total: 5, planificadas: 3, enCurso: 1, ejecutadas: 1, anuladas: 1, atrasadas: 2, pendientes: 4 });
  });
});

describe("Producción Nacional · consumo de la O/C", () => {
  it("comprometido (OT en curso), ejecutado (OT cerrada), planificado sin OT y saldo", () => {
    const [c] = consumoOc(
      [{ id: "p1", producto: "ANFO", unidadMedida: "t", cantidadAutorizada: 100 }],
      [
        L({ cantidad: 30, otId: "a", otEstado: "cerrada" }),
        L({ cantidad: 20, otId: "b", otEstado: "en_analisis" }),
        L({ cantidad: 15 }),
        L({ cantidad: null, otId: "c", otEstado: "recepcionada" }),
        L({ cantidad: 99, anulada: true }),
      ],
    );
    expect(c).toMatchObject({ autorizado: 100, ejecutado: 30, comprometido: 20, planificado: 15, saldo: 50, porcentajeEjecutado: 30, excedido: false, lineasSinCantidad: 1 });
  });
  it("avisa el exceso (no lo bloquea)", () => {
    const [c] = consumoOc([{ id: "p1", producto: "x", unidadMedida: "u", cantidadAutorizada: 10 }], [L({ cantidad: 12, otId: "a", otEstado: "cerrada" })]);
    expect(c).toMatchObject({ saldo: -2, excedido: true });
  });
});

describe("Producción Nacional · programa", () => {
  it("rango del mes", () => {
    expect(rangoMes(2026, 2)).toEqual({ desde: "2026-02-01", hasta: "2026-02-28" });
    expect(rangoMes(2028, 2).hasta).toBe("2028-02-29");
  });
  it("el mes y la fecha deben caer en la vigencia de la O/C vigente", () => {
    expect(validarLinea(oc, { mes: 5 })).toEqual([]);
    expect(validarLinea(oc, { mes: 1 }).join(" ")).toMatch(/fuera de la vigencia/);
    expect(validarLinea(oc, { mes: 5, fechaProgramada: "2026-06-03" }).join(" ")).toMatch(/no es del mes/);
    expect(validarLinea(oc, { mes: 13 }).join(" ")).toMatch(/entre 1 y 12/);
    expect(validarLinea({ ...oc, estado: "cerrada" }, { mes: 5 }).join(" ")).toMatch(/cerrada/);
  });
  it("generar OT: errores por estado y avisos de RAF vencida y línea móvil (IT10)", () => {
    const raf = { numero: "RAF 1", estado: "vigente", tipoLinea: "FIJA" as const, vigenciaHasta: "2027-01-01" };
    expect(comprobarGeneracionOt(L({}), oc, raf, "2026-10-17")).toEqual({ errores: [], avisos: [] });
    expect(comprobarGeneracionOt(L({ otId: "a", otEstado: "en_analisis" }), oc, raf, "2026-10-17").errores.join(" ")).toMatch(/ya tiene una OT/);
    expect(comprobarGeneracionOt(L({ otId: "a", otEstado: "anulada" }), oc, raf, "2026-10-17").errores).toEqual([]);
    const r = comprobarGeneracionOt(L({}), { ...oc, estado: "anulada" }, { ...raf, tipoLinea: "MOVIL", vigenciaHasta: "2026-01-01" }, "2026-10-17");
    expect(r.errores.join(" ")).toMatch(/O\/C está anulada/);
    expect(r.avisos.join(" ")).toMatch(/venció/);
    expect(r.avisos.join(" ")).toMatch(/IT10/);
  });
});

describe("Producción Nacional · correlación e informe técnico", () => {
  const productos = [
    { id: "p1", producto: "ANFO", unidadMedida: "t", cantidadAutorizada: 2000 },
    { id: "p2", producto: "Emulsión", unidadMedida: "u", cantidadAutorizada: 90000 },
    { id: "p3", producto: "Detonador", unidadMedida: "u", cantidadAutorizada: 1 },
  ];
  it("desviación = ventas − inspeccionado en OT cerradas", () => {
    const f = correlacionar(
      productos,
      new Map([["p1", 1240], ["p2", 85000]]),
      [
        { ocProductoId: "p1", cantidad: 1240 },
        { ocProductoId: "p2", cantidad: 83000 },
        { ocProductoId: "p2", cantidad: null },
      ],
    );
    expect(f.map((x) => [x.ventas, x.inspeccionado, x.desviacion])).toEqual([[1240, 1240, 0], [85000, 83000, 2000], [null, 0, null]]);
    expect(sugerenciaConforme(f)).toBe(false);
    expect(sugerenciaConforme(f.slice(0, 1))).toBe(true);
    expect(sugerenciaConforme(f.slice(2))).toBeNull();
  });
  it("fecha de referencia: la programada o el día 1 del mes", () => {
    expect(fechaReferenciaLinea(2026, { mes: 3, fechaProgramada: "2026-03-20" })).toBe("2026-03-20");
    expect(fechaReferenciaLinea(2026, { mes: 3 })).toBe("2026-03-01");
  });
  it("informe técnico: conforme basta; no conforme sigue el diagrama Sucursal → DGMN → propuesta", () => {
    expect(faltantesInforme({ conforme: true, lineasConVentas: 1 })).toEqual([]);
    expect(faltantesInforme({ conforme: true, lineasConVentas: 0 }).join(" ")).toMatch(/relación de ventas/);
    expect(faltantesInforme({ conforme: null, lineasConVentas: 1 }).join(" ")).toMatch(/Indique si la relación/);
    const base = { conforme: false, lineasConVentas: 2, requerimientoSucursal: "Pedir planilla", respuestaSucursal: "Envía planilla" };
    expect(faltantesInforme({ ...base, respondeRequerimiento: true }).join(" ")).toMatch(/propuesta técnica/);
    expect(faltantesInforme({ ...base, respondeRequerimiento: true, propuestaTecnica: "Fiscalizar" })).toEqual([]);
    const sinDgmn = faltantesInforme({ ...base, respondeRequerimiento: false, propuestaTecnica: "x" }).join(" ");
    expect(sinDgmn).toMatch(/DGMN/);
    expect(faltantesInforme({ ...base, respondeRequerimiento: false, propuestaTecnica: "x", solicitudDgmn: "Oficio", respuestaDgmn: "Resp." })).toEqual([]);
    expect(faltantesInforme({ conforme: false, lineasConVentas: 1 }).length).toBeGreaterThanOrEqual(4);
  });
});
