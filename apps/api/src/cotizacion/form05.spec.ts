import { calcularForm05, erroresForm05, erroresPrograma, montoViatico } from "./form05";

describe("Formulario de costeo FORM05 (EP-00 2.5)", () => {
  const p = { cfaPct: 12, margenParticularPct: 20 };

  it("viático = monto diario × % del grado × días (maqueta FORM-2026-14588: US$ 200 × 60 % × 5 = 600)", () => {
    expect(montoViatico({ ambito: "extranjero", zona: "Serbia", grado: "Oficial jefe", dias: 5, montoDiario: 200, porcentaje: 60 })).toBe(600);
  });

  it("suma las seis secciones en el CDT y calcula CFA, CT, precio Ejército y particular", () => {
    const r = calcularForm05(
      {
        viaticos: [{ ambito: "nacional", zona: "Santiago", grado: "Profesional civil", dias: 2, montoDiario: 50000, porcentaje: 40 }],
        horasHombre: [
          { tipo: "civil", categoria: "Analista", horas: 6, valorHora: 18500 },
          { tipo: "militar", categoria: "Oficial", horas: 1, valorHora: 25000 },
        ],
        servicios: [{ codigo: "EN1214", cantidad: 1, valorUnitario: 100000 }],
        horasMaquina: [{ equipo: "Cámara climática", horas: 4, valorHora: 24000 }],
        pasajes: [{ ambito: "nacional", tramo: "SCL-ANF", cantidad: 1, valorUnitario: 90000 }],
        otros: [{ descripcion: "Insumos", monto: 10, moneda: "USD" }],
        dolar: 950,
      },
      p,
    );
    expect(r.secciones).toEqual({ viaticos: 40000, horasHombre: 136000, servicios: 100000, horasMaquina: 96000, pasajes: 90000, otros: 9500, insumos: 0 });
    expect(r.cdt).toBe(471500);
    expect(r.cfa).toBe(56580);
    expect(r.ct).toBe(528080);
    expect(r.precioEjercito).toBe(528080);
    expect(r.precioParticular).toBe(633696);
    expect(r.horasHombreTotal).toBe(7);
  });

  it("política de precios (IT05): con «costo_directo» el precio Ejército es el CDT sin las horas hombre militares", () => {
    const f = {
      horasHombre: [
        { tipo: "civil" as const, categoria: "TEC-SUPERIOR", horas: 8, valorHora: 9051 },
        { tipo: "militar" as const, categoria: "TECNICO-MILITAR", horas: 2, valorHora: 8316 },
      ],
      horasMaquina: [{ equipo: "Balanza digital", horas: 0.25, valorHora: 184 }],
    };
    const r = calcularForm05(f, { ...p, precioEjercito: "costo_directo" });
    expect(r.cdt).toBe(72408 + 16632 + 46);
    expect(r.precioEjercito).toBe(72408 + 46);
    expect(calcularForm05(f, p).precioEjercito).toBe(calcularForm05(f, p).ct);
  });

  it("con la fórmula oficial 2026 (CI 20 %, recargo 30 %, IVA 19 %) reproduce la lista: EN1214 y EN1150", () => {
    const oficial = { cfaPct: 20, margenParticularPct: 30, ivaPct: 19 };
    const a = calcularForm05({ servicios: [{ codigo: "EN1214", cantidad: 1, valorUnitario: 329820 }] }, oficial);
    expect([a.cdt, a.cfa, a.ct, a.recargo, a.precioParticular, a.iva, a.precioParticularIvaIncluido]).toEqual([329820, 65964, 395784, 118735, 514519, 97759, 612278]);
    expect(a.precioEjercito).toBe(395784);
    // EN1150 (LCNF): CD 264.275 → CI 52.855 · CT 317.130 · recargo 95.139 · neto 412.269 · IVA 78.331 · 490.600
    const b = calcularForm05({ horasHombre: [{ tipo: "civil", categoria: "Metrólogo", horas: 1, valorHora: 264275 }] }, oficial);
    expect([b.cfa, b.ct, b.recargo, b.precioParticular, b.iva, b.precioParticularIvaIncluido]).toEqual([52855, 317130, 95139, 412269, 78331, 490600]);
    // EN412 (LEM): la lista se armó hacia atrás desde el precio particular; desde el CD entero 38.153 el CT y el neto salen 1 peso arriba.
    const c = calcularForm05({ servicios: [{ codigo: "EN412", cantidad: 1, valorUnitario: 38153 }] }, oficial);
    expect([c.ct, c.precioParticular, c.precioParticularIvaIncluido]).toEqual([45784, 59519, 70827]);
  });

  it("contrato 4.1.4 · la sección 7 (insumos y reactivos) suma cantidad × costo unitario al costo directo", () => {
    const oficial = { cfaPct: 20, margenParticularPct: 30, ivaPct: 19 };
    const r = calcularForm05(
      {
        horasHombre: [{ tipo: "civil", categoria: "Analista", horas: 2, valorHora: 10000 }],
        insumos: [
          { consumibleId: "c1", codigo: "RC-METOH", descripcion: "Metanol", unidad: "mL", cantidad: 250, costoUnitario: 12.5 },
          { descripcion: "Filtro PRUEBA escrito a mano", cantidad: 3, costoUnitario: 1500 },
        ],
      },
      oficial,
    );
    expect(r.secciones.insumos).toBe(7625);
    expect(r.cdt).toBe(27625);
    expect(r.ct).toBe(33150);
    // Una fila de insumos basta para que el formulario no esté vacío.
    expect(erroresForm05({ insumos: [{ descripcion: "Reactivo", cantidad: 1, costoUnitario: 100 }] })).toEqual([]);
  });

  it("un costeo guardado antes de la sección de insumos sigue calculando igual (insumos = 0)", () => {
    const r = calcularForm05({ servicios: [{ codigo: "EN1214", cantidad: 1, valorUnitario: 329820 }] }, { cfaPct: 20, margenParticularPct: 30, ivaPct: 19 });
    expect(r.secciones.insumos).toBe(0);
    expect(r.cdt).toBe(329820);
  });

  it("exige al menos una fila y el dólar si hay gastos en US$", () => {
    expect(erroresForm05({})).toHaveLength(1);
    expect(erroresForm05({ otros: [{ descripcion: "x", monto: 1, moneda: "USD" }] })[0]).toMatch(/dólar/);
    expect(erroresForm05({ otros: [{ descripcion: "x", monto: 1, moneda: "CLP" }] })).toEqual([]);
  });

  it("el programa de trabajo exige plazo entre 1 y 730 días y fechas en orden", () => {
    expect(erroresPrograma({ etapas: [], plazoEntregaDias: 0 })).toHaveLength(1);
    expect(erroresPrograma({ etapas: [], plazoEntregaDias: 15 })).toEqual([]);
    expect(erroresPrograma({ etapas: [], plazoEntregaDias: 15, fechaInicio: "2026-11-10", fechaTermino: "2026-11-01" })).toHaveLength(1);
    expect(erroresPrograma({ etapas: [{ actividad: "Ensayo", inicio: "2026-11-05", termino: "2026-11-04" }], plazoEntregaDias: 15 })[0]).toMatch(/Ensayo/);
  });
});

describe("FORM05 · cuarto envío del IDIC (US$ al extranjero, tipo de cambio con fecha, dos precios Ejército)", () => {
  const oficial = { cfaPct: 20, margenParticularPct: 30, ivaPct: 19 };
  // Comisión PRUEBA al extranjero con la estructura del formulario real FORM-…/003 (montos inventados).
  const comision = {
    viaticos: [
      { ambito: "extranjero" as const, zona: "País PRUEBA", grado: "14 al 16", dias: 10, montoDiario: 200, porcentaje: 100, moneda: "USD" as const },
      { ambito: "extranjero" as const, zona: "País PRUEBA", grado: "14 al 16", dias: 1, montoDiario: 200, porcentaje: 40, moneda: "USD" as const },
    ],
    pasajes: [{ ambito: "extranjero" as const, tramo: "Santiago - PRUEBA - Santiago", cantidad: 2, valorUnitario: 1500, moneda: "USD" as const }],
    otros: [
      { descripcion: "Gasto en pesos PRUEBA", monto: 100000, moneda: "CLP" as const },
      { descripcion: "Fondo global PRUEBA", monto: 500, moneda: "USD" as const },
    ],
    dolar: 900,
    dolarFecha: "2026-11-02",
  };

  it("convierte viáticos y pasajes en US$ con el dólar del formulario y separa nacionales / extranjero / pesos / dólar", () => {
    const r = calcularForm05(comision, oficial);
    // Viáticos: US$ 2.000 + US$ 80 = US$ 2.080 × 900; pasajes: US$ 3.000 × 900; otros: 100.000 + US$ 500 × 900.
    expect(r.secciones).toMatchObject({ viaticos: 1872000, pasajes: 2700000, otros: 550000 });
    expect(r.detalle).toMatchObject({ viaticosNacionales: 0, viaticosExtranjero: 1872000, pasajesNacionales: 0, pasajesExtranjero: 2700000, otrosPesos: 100000, otrosDolar: 450000 });
    expect(r.cdt).toBe(5122000);
    expect(r.dolar).toBe(900);
    expect(r.dolarFecha).toBe("2026-11-02");
  });

  it("montos finales en US$ = $ / dólar (3 decimales)", () => {
    const r = calcularForm05(comision, oficial);
    expect(r.usd!.detalle.viaticosExtranjero).toBe(2080);
    expect(r.usd!.detalle.pasajesExtranjero).toBe(3000);
    expect(r.usd!.detalle.otrosPesos).toBe(111.111);
    expect(r.usd!.cdt).toBe(5691.111);
    expect(r.usd!.ct).toBe(Math.round((r.ct / 900) * 1000) / 1000);
    expect(r.usd!.precioParticular).toBe(Math.round((r.precioParticular / 900) * 1000) / 1000);
    // Sin dólar no hay columna en US$.
    expect(calcularForm05({ servicios: [{ codigo: "EN1", cantidad: 1, valorUnitario: 1000 }] }, oficial).usd).toBeNull();
  });

  it("sin moneda la fila es en pesos (costeos guardados antes): mismo resultado que antes", () => {
    const antes = calcularForm05({ viaticos: [{ ambito: "nacional", zona: "Arica", grado: "X", dias: 2, montoDiario: 50000, porcentaje: 40 }], pasajes: [{ ambito: "nacional", tramo: "SCL-ARI", cantidad: 1, valorUnitario: 90000 }] }, oficial);
    expect(antes.secciones).toMatchObject({ viaticos: 40000, pasajes: 90000 });
    expect(antes.detalle).toMatchObject({ viaticosNacionales: 40000, pasajesNacionales: 90000 });
  });

  it("los dos precios Ejército del formulario real (notas 3 y 4); el parámetro decide cuál se aplica, sin cambiar el precio de hoy", () => {
    const f = {
      horasHombre: [
        { tipo: "civil" as const, categoria: "Civil PRUEBA", horas: 10, valorHora: 10000 },
        { tipo: "militar" as const, categoria: "Militar PRUEBA", horas: 5, valorHora: 8000 },
      ],
    };
    const cd = calcularForm05(f, { ...oficial, precioEjercito: "costo_directo" });
    expect(cd.cdt).toBe(140000);
    expect(cd.ct).toBe(168000);
    expect(cd.horasHombreMilitar).toBe(40000);
    // Nota 3: CT sin la H.H. militar, con su CFA: 168.000 − 40.000.
    expect(cd.precioEjercitoCt).toBe(128000);
    // Nota 4: costo directo sin CFA ni H.H. militar: 140.000 − 40.000 (el «costo_directo» de siempre).
    expect(cd.precioEjercitoCostoDirecto).toBe(100000);
    expect(cd.precioEjercitoAplicado).toBe("costo_directo");
    expect(cd.precioEjercito).toBe(100000);
    const ct = calcularForm05(f, { ...oficial, precioEjercito: "costo_total" });
    expect(ct.precioEjercitoAplicado).toBe("costo_total");
    expect(ct.precioEjercito).toBe(168000);
    expect([ct.precioEjercitoCt, ct.precioEjercitoCostoDirecto]).toEqual([128000, 100000]);
  });

  it("exige dólar y fecha si hay montos en US$; los nacionales no van en US$", () => {
    expect(erroresForm05(comision)).toEqual([]);
    expect(erroresForm05({ ...comision, dolar: null })[0]).toMatch(/dólar/);
    expect(erroresForm05({ ...comision, dolarFecha: null })).toEqual(["Indique la fecha del tipo de cambio del dólar."]);
    expect(erroresForm05({ pasajes: [{ ambito: "nacional", tramo: "SCL-ARI", cantidad: 1, valorUnitario: 100, moneda: "USD" }], dolar: 900, dolarFecha: "2026-11-02" })[0]).toMatch(/nacionales van en pesos/);
    expect(erroresForm05({ pasajes: [{ ambito: "nacional", tramo: "SCL-ARI", cantidad: 1, valorUnitario: 100 }] })).toEqual([]);
  });
});

describe("Cotización del DSA · comisión, Programa de Trabajo LEM y reposición LRB (EP-05 0.2, BL-151)", () => {
  const { exigeCosteo, cantidadConReposicion, erroresPrograma } = require("./form05") as typeof import("./form05");
  it("la comisión, como el servicio no estandarizado, exige el formulario de costeo", () => {
    expect(exigeCosteo("comision")).toBe(true);
    expect(exigeCosteo("no_estandar")).toBe(true);
    expect(exigeCosteo("estandar")).toBe(false);
  });
  it("el lote del LRB se cotiza con las unidades de reposición", () => {
    expect(cantidadConReposicion(30, 4)).toBe(34);
    expect(cantidadConReposicion(30, 0)).toBe(30);
  });
  it("el Programa de Trabajo valida el número de ítems", () => {
    expect(erroresPrograma({ etapas: [], plazoEntregaDias: 10, numItems: 0 })).toContain("Programa de trabajo: el número de ítems debe ser un entero de 1 o más.");
    expect(erroresPrograma({ etapas: [], plazoEntregaDias: 10, numItems: 12, puntosEt: "4.1.1" })).toEqual([]);
  });
});
