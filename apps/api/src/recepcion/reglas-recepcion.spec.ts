import {
  camposDeLaboratorio,
  estadoRetencion,
  inicioNumeracion,
  leerCampo,
  motivoNoDisponer,
  origenBandeja,
  plazosRetencion,
  retenerHasta,
  semaforoPlazo,
  validarCamposLaboratorio,
  type FilaParametro,
} from "./reglas-recepcion";

const FILAS_LME: FilaParametro[] = [
  {
    codigo: "LME.clase_custodia",
    etiqueta: "Tipo de muestra",
    orden: 1,
    valor: JSON.stringify({
      tipo: "lista",
      obligatorio: true,
      opciones: [
        { valor: "analisis", etiqueta: "Análisis" },
        { valor: "testigo", etiqueta: "Testigo" },
        { valor: "custodia", etiqueta: "En custodia" },
      ],
    }),
  },
  { codigo: "LME.fabricante", etiqueta: "Fabricante", orden: 2, valor: '{"tipo":"texto"}' },
  { codigo: "LME.verif_ot", etiqueta: "Verificada contra la O/T", orden: 6, valor: '{"tipo":"casilla","obligatorio":true}' },
  { codigo: "LME.ubicacion", etiqueta: "Ubicación", orden: 8, valor: '{"tipo":"lista","opciones":["Sala de preparación","Bodega"]}' },
  { codigo: "LCC.unidades_recibidas", etiqueta: "Nº de pares / unidades", orden: 1, valor: '{"tipo":"entero","obligatorio":true}' },
  { codigo: "LME.roto", etiqueta: "JSON roto", orden: 9, valor: "{tipo:" },
  { codigo: "LME.inactivo", etiqueta: "Inactivo", orden: 10, valor: '{"tipo":"texto","obligatorio":true}', activo: false },
];

describe("Recepción · campos propios del laboratorio (Catálogo › Parámetros)", () => {
  const campos = camposDeLaboratorio(FILAS_LME, "LME");

  it("toma solo los del laboratorio, activos y con JSON válido, en orden", () => {
    expect(campos.map((c) => c.codigo)).toEqual(["clase_custodia", "fabricante", "verif_ot", "ubicacion"]);
    expect(camposDeLaboratorio(FILAS_LME, "LCC").map((c) => c.codigo)).toEqual(["unidades_recibidas"]);
    expect(camposDeLaboratorio(FILAS_LME, null)).toEqual([]);
  });

  it("una lista sin opciones o un destino con clases desconocidas no se pide", () => {
    expect(leerCampo({ codigo: "LME.x", etiqueta: "X", valor: '{"tipo":"lista"}' }, "LME")).toBeNull();
    expect(
      leerCampo({ codigo: "LME.clase_custodia", etiqueta: "X", valor: '{"tipo":"lista","opciones":["inventada"]}' }, "LME"),
    ).toBeNull();
  });

  it("LME: tipo de muestra y verificación contra la O/T obligatorios", () => {
    const r = validarCamposLaboratorio(campos, { datos: {} }, "LME");
    expect(r.errores.join(" ")).toContain("Tipo de muestra");
    expect(r.errores.join(" ")).toContain("Verificada contra la O/T");
  });

  it("LME completa: el destino y la ubicación van a columnas, el resto a datos", () => {
    const r = validarCamposLaboratorio(
      campos,
      { claseCustodia: "testigo", ubicacion: "Bodega", datos: { fabricante: " Fábrica Prueba ", verif_ot: true } },
      "LME",
    );
    expect(r.errores).toEqual([]);
    expect(r.valor).toEqual({ claseCustodia: "testigo", ubicacion: "Bodega", datos: { fabricante: "Fábrica Prueba", verif_ot: true } });
  });

  it("rechaza opciones fuera de la lista, campos no definidos y números mal escritos", () => {
    const r = validarCamposLaboratorio(
      campos,
      { claseCustodia: "contramuestra", ubicacion: "Pasillo", datos: { verif_ot: true, color: "rojo" } },
      "LME",
      "Muestra 2: ",
    );
    expect(r.errores).toHaveLength(3);
    expect(r.errores.every((e) => e.startsWith("Muestra 2: "))).toBe(true);
    const lcc = validarCamposLaboratorio(camposDeLaboratorio(FILAS_LME, "LCC"), { datos: { unidades_recibidas: "2,5" } }, "LCC");
    expect(lcc.errores[0]).toContain("entero");
    const ok = validarCamposLaboratorio(camposDeLaboratorio(FILAS_LME, "LCC"), { datos: { unidades_recibidas: "12" } }, "LCC");
    expect(ok.valor.datos.unidades_recibidas).toBe(12);
  });

  it("sin configuración, el destino de la muestra igual se valida contra el vocabulario", () => {
    expect(validarCamposLaboratorio([], { claseCustodia: "otra" }, "LQC").errores).toHaveLength(1);
    expect(validarCamposLaboratorio([], { claseCustodia: "contramuestra" }, "LQC").valor.claseCustodia).toBe("contramuestra");
  });
});

describe("Custodia · retención de testigos y contramuestras", () => {
  const plazos = plazosRetencion([
    { codigo: "testigo", valor: "1" },
    { codigo: "contramuestra", valor: "12" },
    { codigo: "analisis", valor: "x" },
  ]);

  it("plazos en meses desde los parámetros", () => {
    expect(plazos).toEqual({ testigo: 1, contramuestra: 12 });
  });

  it("retener hasta = recepción + plazo; fin de mes ajustado; sin plazo, null", () => {
    expect(retenerHasta("testigo", new Date("2026-10-20T15:00:00Z"), plazos)).toBe("2026-11-20");
    expect(retenerHasta("testigo", new Date("2026-01-31T12:00:00Z"), plazos)).toBe("2026-02-28");
    expect(retenerHasta("contramuestra", new Date("2026-10-20T12:00:00Z"), plazos)).toBe("2027-10-20");
    expect(retenerHasta("analisis", new Date("2026-10-20T12:00:00Z"), plazos)).toBeNull();
    expect(retenerHasta(null, new Date(), plazos)).toBeNull();
  });

  it("un testigo no se destruye antes de su plazo; una muestra en custodia nunca se destruye", () => {
    const testigo = { codigo: "OT-1-M1", claseCustodia: "testigo", retenerHasta: "2026-11-20" };
    expect(motivoNoDisponer("destruccion", testigo, "2026-10-21")).toContain("20-11-2026");
    expect(motivoNoDisponer("destruccion", testigo, "2026-11-20")).toBeNull();
    expect(motivoNoDisponer("traslado", testigo, "2026-10-21")).toBeNull();
    expect(motivoNoDisponer("destruccion", { codigo: "M", claseCustodia: "custodia" }, "2030-01-01")).toContain("se devuelve");
    expect(motivoNoDisponer("devolucion", { codigo: "M", claseCustodia: "custodia" }, "2030-01-01")).toBeNull();
  });

  it("estado de la retención para el aviso", () => {
    expect(estadoRetencion({ retenerHasta: "2026-11-20" }, "2026-10-21")).toBe("vigente");
    expect(estadoRetencion({ retenerHasta: "2026-11-20" }, "2026-11-15")).toBe("por_cumplir");
    expect(estadoRetencion({ retenerHasta: "2026-11-20" }, "2026-11-20")).toBe("cumplida");
    expect(estadoRetencion({ retenerHasta: "2026-11-20", dispuesta: true }, "2026-12-01")).toBe("dispuesta");
    expect(estadoRetencion({ claseCustodia: "custodia" }, "2026-12-01")).toBe("sin_plazo");
  });
});

describe("Nº interno y bandeja de entrada", () => {
  it("primer número configurable; si no es válido, 1", () => {
    expect(inicioNumeracion("415831")).toBe(415831);
    expect(inicioNumeracion("abc")).toBe(1);
    expect(inicioNumeracion(null)).toBe(1);
    expect(inicioNumeracion("0")).toBe(1);
  });

  it("origen: DCO, OT interna o BPCH", () => {
    expect(origenBandeja({ origen: "COTIZACION" })).toBe("DCO");
    expect(origenBandeja({ origen: null })).toBe("DCO");
    expect(origenBandeja({ origen: "OT_INTERNA" })).toBe("OT interna");
    expect(origenBandeja({ origen: "INTERLABORATORIO" })).toBe("OT interna");
    expect(origenBandeja({ origen: "INTERNACION" })).toBe("BPCH");
    expect(origenBandeja({ origen: "COTIZACION", tipoTrabajo: "REINSPECCION" })).toBe("BPCH");
    expect(origenBandeja({ esOrdenInterna: true })).toBe("OT interna");
  });

  it("semáforo del plazo", () => {
    expect(semaforoPlazo("2026-10-19", "2026-10-20")).toBe("vencido");
    expect(semaforoPlazo("2026-10-22", "2026-10-20")).toBe("por_vencer");
    expect(semaforoPlazo("2026-11-30", "2026-10-20")).toBe("a_tiempo");
    expect(semaforoPlazo(null, "2026-10-20")).toBe("sin_plazo");
  });
});
