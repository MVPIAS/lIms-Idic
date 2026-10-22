import {
  CONFIG_D11_DEFECTO,
  avanceD11,
  caminoDe,
  configD11,
  enmascararSerie,
  erroresAcunacion,
  erroresCapturaExplicita,
  erroresCertificado,
  erroresListado,
  etapaArma,
  faltantesCierreD11,
  grupoEnsayo,
  mapearPlanilla,
  normalizarSerie,
  rangoEmision,
  requiereAcunacion,
  resultadoActa,
  tipoDesdeTexto,
  tipoEntrada,
  verificarContraResolucion,
  vigenciaHasta,
  type EnsayoArma,
  type EstadoArma,
} from "./reglas-d11";

const cfg = CONFIG_D11_DEFECTO;
const arma = (p: Partial<EstadoArma> = {}): EstadoArma => ({
  clase: "arma",
  permisibilidad: "permitida",
  camino: "completa",
  ensayos: 10,
  pendientes: 0,
  aprobados: 10,
  veredicto: "cumple",
  acunada: false,
  certificado: null,
  entregada: false,
  ...p,
});

describe("serie del arma", () => {
  it("normaliza: mayúsculas, solo A–Z y 0–9", () => {
    expect(normalizarSerie(" prueba-0001 ")).toBe("PRUEBA0001");
    expect(normalizarSerie("Ñ 12/3")).toBe("N123");
    expect(normalizarSerie("--")).toBeNull();
    expect(normalizarSerie(null)).toBeNull();
  });
  it("oculta el final en vistas públicas", () => {
    expect(enmascararSerie("PRUEBA0001")).toBe("PRUEBA0··");
    expect(enmascararSerie("ELF3512")).toBe("ELF35··");
    expect(enmascararSerie("AB")).toBe("A··");
    expect(enmascararSerie("")).toBe("—");
  });
});

describe("11.1 / 11.8 · carga masiva", () => {
  it("reconoce las columnas por su nombre y el tipo por su texto", () => {
    const r = mapearPlanilla([
      ["Nº de serie", "Tipo de arma", "Marca", "Modelo", "Calibre", "País de origen", "Accesorios"],
      ["PRUEBA0001", "Pistola", "Marca Prueba", "Pistola Prueba", "9 × 19 mm", "País Prueba", "2 cargadores"],
      ["PRUEBA0002", "REVÓLVER 38", "Marca Prueba", "", ".38 Special", "", ""],
    ]);
    expect(r.errores).toEqual([]);
    expect(r.filas).toHaveLength(2);
    expect(r.filas[0]).toMatchObject({ fila: 2, tipo: "pistola", serie: "PRUEBA0001", pais: "País Prueba", cantidad: 1 });
    expect(r.filas[1].tipo).toBe("revolver");
  });
  it("informa por fila lo que no se puede leer (no lo descarta en silencio)", () => {
    const r = mapearPlanilla([
      ["tipo", "marca", "serie", "cantidad"],
      ["Cañón", "Marca Prueba", "", "1"],
      ["Pistola", "", "X1", "1"],
      ["Pistola", "M", "S1", "3"],
      ["Pistola", "M", "S-2", ""],
      ["Pistola", "M", "s2", ""],
    ]);
    expect(r.filas.map((f) => f.fila)).toEqual([5, 6]);
    expect(r.errores.join(" ")).toMatch(/Fila 2: tipo «Cañón» no reconocido/);
    expect(r.errores.join(" ")).toMatch(/Fila 3: falta la marca/);
    expect(r.errores.join(" ")).toMatch(/Fila 4: .*cantidad debe ser 1/);
    expect(r.errores.join(" ")).toMatch(/Fila 6: el nº de serie s2 se repite \(fila 5\)/);
  });
  it("exige la cabecera con tipo y marca", () => {
    expect(mapearPlanilla([["serie"], ["X"]]).errores[0]).toMatch(/«tipo» y «marca»/);
    expect(mapearPlanilla([]).errores[0]).toMatch(/vacía/);
  });
  it("tipoDesdeTexto no inventa tipos", () => {
    expect(tipoDesdeTexto("Escopeta 12")).toBe("escopeta");
    expect(tipoDesdeTexto("arma larga")).toBeNull();
  });
  it("valida el listado de la resolución", () => {
    expect(erroresListado([{ tipo: "pistola", marca: "M", serie: "A1", cantidad: 1 }])).toEqual([]);
    const e = erroresListado([
      { tipo: "cañon", marca: "", cantidad: 0 },
      { tipo: "pistola", marca: "M", serie: "a-1", cantidad: 2 },
      { tipo: "pistola", marca: "M", serie: "A1", cantidad: 1 },
    ]);
    expect(e.join(" ")).toMatch(/Arma 1: tipo no válido/);
    expect(e.join(" ")).toMatch(/Arma 1: indique la marca/);
    expect(e.join(" ")).toMatch(/Arma 2: con nº de serie la cantidad es 1/);
    expect(e.join(" ")).toMatch(/Arma 3: el nº de serie se repite \(arma 2\)/);
  });
});

describe("11.6 / 11.9 · acta y verificación contra la resolución", () => {
  const listado = [
    { tipo: "pistola", marca: "Marca Prueba", modelo: "Pistola Prueba", calibre: "9 × 19 mm", serie: "PRUEBA0001", accesorios: "2 cargadores", cantidad: 1 },
    { tipo: "escopeta", marca: "Marca Prueba", modelo: "E1", calibre: "12/70", cantidad: 2 },
  ];
  it("acta: concuerda o diferencia", () => {
    expect(resultadoActa(3, 3)).toBe("concuerda");
    expect(resultadoActa(3, 2)).toBe("diferencia");
  });
  it("concuerda cuando cantidad, características y accesorios coinciden (sin tildes ni mayúsculas)", () => {
    const v = verificarContraResolucion(listado, [
      { tipo: "pistola", marca: "MARCA PRUEBA", modelo: "pistola prueba", calibre: "9 × 19 mm", serie: "prueba-0001", accesorios: "2 Cargadores" },
      { tipo: "escopeta", marca: "Marca Prueba", modelo: "E1", calibre: "12/70" },
      { tipo: "escopeta", marca: "Marca Prueba", modelo: "E1", calibre: "12/70" },
    ]);
    expect(v).toMatchObject({ segunResolucion: 3, registradas: 3, concuerda: true, diferencias: [] });
  });
  it("detecta cantidad, faltante, sobrante, características y accesorios", () => {
    const v = verificarContraResolucion(listado, [
      { tipo: "pistola", marca: "Marca Prueba", modelo: "Otro", calibre: "9 × 19 mm", serie: "PRUEBA0001", accesorios: "" },
      { tipo: "escopeta", marca: "Marca Prueba", modelo: "E1", calibre: "12/70" },
      { tipo: "fusil", marca: "X", serie: "Z9" },
    ]);
    const tipos = v.diferencias.map((d) => d.tipo).sort();
    expect(v.concuerda).toBe(false);
    expect(tipos).toEqual(["accesorios", "caracteristicas", "falta", "sobra"]);
  });
  it("una diferencia solo de cantidad también es diferencia", () => {
    const v = verificarContraResolucion([{ tipo: "pistola", marca: "M", cantidad: 2 }], [{ tipo: "pistola", marca: "M" }]);
    expect(v.diferencias.map((d) => d.tipo)).toEqual(["cantidad", "falta"]);
  });
});

describe("parámetros d11", () => {
  it("lee los valores y cae al defecto si faltan o no se entienden", () => {
    const c = configD11([
      { codigo: "metodos_cip", valor: "1291, 3500 ,9999" },
      { codigo: "acunacion_cip", valor: "si" },
      { codigo: "vigencia_anios", valor: "99" },
      { codigo: "metodos_completa", valor: "", activo: true },
      { codigo: "metodos_accesorio", valor: "1", activo: false },
    ]);
    expect(c.metodosCip).toEqual(["1291", "3500", "9999"]);
    expect(c.acunacionCip).toBe(true);
    expect(c.vigenciaAnios).toBe(4);
    expect(c.metodosCompleta).toEqual(CONFIG_D11_DEFECTO.metodosCompleta);
    expect(c.metodosAccesorio).toEqual(CONFIG_D11_DEFECTO.metodosAccesorio);
    expect(configD11([]).acunacionCip).toBe(false);
  });
});

describe("11.11 / 11.12 · clasificación y camino", () => {
  it("arma permitida: el camino carga su panel", () => {
    expect(caminoDe({ clase: "arma", permisibilidad: "permitida", camino: "cip" }, cfg)).toEqual({ camino: "cip", metodos: cfg.metodosCip, errores: [] });
    expect(caminoDe({ clase: "arma", permisibilidad: "permitida", camino: "completa" }, cfg).metodos).toEqual(cfg.metodosCompleta);
  });
  it("arma permitida sin camino: error", () => {
    expect(caminoDe({ clase: "arma", permisibilidad: "permitida" }, cfg).errores[0]).toMatch(/Elija el camino/);
  });
  it("accesorio y máquina recargadora van directo; la prohibida no sigue", () => {
    expect(caminoDe({ clase: "accesorio", permisibilidad: "permitida" }, cfg)).toMatchObject({ camino: "directo", metodos: cfg.metodosAccesorio });
    expect(caminoDe({ clase: "maquina_recargadora", permisibilidad: "permitida" }, cfg)).toMatchObject({ camino: "directo", metodos: cfg.metodosMaquina });
    expect(caminoDe({ clase: "arma", permisibilidad: "prohibida", camino: "cip" }, cfg)).toEqual({ camino: null, metodos: [], errores: [] });
  });
  it("clase o permisibilidad no válidas", () => {
    expect(caminoDe({ clase: "x" as any, permisibilidad: "permitida" }, cfg).errores).toHaveLength(1);
    expect(caminoDe({ clase: "arma", permisibilidad: "x" as any }, cfg).errores).toHaveLength(1);
  });
});

describe("BL-038 · captura sin valores por defecto", () => {
  const e = (id: string, analito: string, p: Partial<EnsayoArma> = {}): EnsayoArma => ({
    resultadoId: id,
    estado: "pendiente",
    analito,
    metodoCodigo: "1213",
    tipoDato: "numerico",
    limiteInf: "0",
    limiteSup: "0",
    ...p,
  });
  const ensayos = [
    e("a1", "AD-Aus.deformación de cañón"),
    e("a2", "AD-Aus.fisuras"),
    e("d1", "DD-Aus.fisuras"),
    e("t1", "Prueba de tensión de disparado", { metodoCodigo: "1202" }),
    e("i1", "Evidencia balística", { metodoCodigo: "3500", limiteInf: null, limiteSup: null }),
  ];
  it("tipo de entrada por ensayo", () => {
    expect(tipoEntrada(ensayos[0])).toBe("defecto");
    expect(tipoEntrada(ensayos[3])).toBe("valor");
    expect(tipoEntrada(ensayos[4])).toBe("texto");
    expect(tipoEntrada({ ...ensayos[0], tipoDato: "atributo" })).toBe("atributo");
    expect(tipoEntrada({ ...ensayos[0], limiteSup: "5" })).toBe("valor");
  });
  it("agrupa antes y después del disparo", () => {
    expect(grupoEnsayo(ensayos[0])).toBe("1213:AD");
    expect(grupoEnsayo(ensayos[2])).toBe("1213:DD");
    expect(grupoEnsayo(ensayos[3])).toBe("1202");
  });
  it("un grupo completo y explícito se acepta (antes del disparo, sin tocar el de después)", () => {
    expect(erroresCapturaExplicita(ensayos, [{ resultadoId: "a1", valor: 0 }, { resultadoId: "a2", valor: "1" }])).toEqual([]);
  });
  it("falta una fila del grupo: no se rellena sola", () => {
    expect(erroresCapturaExplicita(ensayos, [{ resultadoId: "a1", valor: 0 }])).toEqual([
      "Falta marcar «AD-Aus.fisuras»: cada fila se captura explícitamente (sin valor por defecto).",
    ]);
  });
  it("un defecto solo admite 0 o 1; el valor medido es un número; el texto no va en blanco", () => {
    const err = erroresCapturaExplicita(ensayos, [
      { resultadoId: "a1", valor: "" },
      { resultadoId: "a2", valor: 2 },
      { resultadoId: "t1", valor: "dos" },
      { resultadoId: "i1", valor: " " },
    ]);
    expect(err).toHaveLength(4);
    expect(erroresCapturaExplicita(ensayos, [{ resultadoId: "t1", valor: "2,35" }, { resultadoId: "i1", valor: "EXH-PRUEBA-01" }])).toEqual([]);
  });
  it("rechaza ensayos ajenos, repetidos, ya revisados y el envío vacío", () => {
    expect(erroresCapturaExplicita(ensayos, [{ resultadoId: "zz", valor: 0 }])[0]).toMatch(/no es de esta arma/);
    expect(erroresCapturaExplicita(ensayos, [{ resultadoId: "t1", valor: 1 }, { resultadoId: "t1", valor: 1 }])[0]).toMatch(/dos veces/);
    expect(erroresCapturaExplicita([{ ...ensayos[3], estado: "aprobado" }], [{ resultadoId: "t1", valor: 1 }])[0]).toMatch(/ya está aprobado/);
    expect(erroresCapturaExplicita(ensayos, [])).toEqual(["No hay valores que registrar."]);
  });
});

describe("11.22 / 11.23 · acuñación y certificado", () => {
  it("se acuñan las armas que cumplen por prueba completa (las CIP según el parámetro)", () => {
    expect(requiereAcunacion(arma(), cfg)).toBe(true);
    expect(requiereAcunacion(arma({ camino: "cip" }), cfg)).toBe(false);
    expect(requiereAcunacion(arma({ camino: "cip" }), { acunacionCip: true })).toBe(true);
    expect(requiereAcunacion(arma({ clase: "accesorio", camino: "directo" }), cfg)).toBe(false);
  });
  it("no se acuña sin aprobar, si no cumple, si no corresponde o dos veces", () => {
    expect(erroresAcunacion(arma(), cfg)).toEqual([]);
    expect(erroresAcunacion(arma({ aprobados: 9 }), cfg)[0]).toMatch(/aprobar/);
    expect(erroresAcunacion(arma({ veredicto: "no_cumple" }), cfg)[0]).toMatch(/no cumple/);
    expect(erroresAcunacion(arma({ camino: "cip" }), cfg)[0]).toMatch(/no lleva acuñación/);
    expect(erroresAcunacion(arma({ acunada: true }), cfg)[0]).toMatch(/ya está/);
    expect(erroresAcunacion(arma({ permisibilidad: "prohibida" }), cfg)[0]).toMatch(/prohibida/);
  });
  it("certificado: exige aprobado, cumple y acuñada (si corresponde)", () => {
    expect(erroresCertificado(arma(), cfg)[0]).toMatch(/acuñación/);
    expect(erroresCertificado(arma({ acunada: true }), cfg)).toEqual([]);
    expect(erroresCertificado(arma({ camino: "cip" }), cfg)).toEqual([]);
    expect(erroresCertificado(arma({ clase: "accesorio", camino: "directo" }), cfg)).toEqual([]);
    expect(erroresCertificado(arma({ certificado: { estado: "en_firma" } }), cfg)[0]).toMatch(/en firma/);
    expect(erroresCertificado(arma({ permisibilidad: "prohibida" }), cfg)[0]).toMatch(/incumplimiento/);
    expect(erroresCertificado(arma({ clase: null, camino: null }), cfg)[0]).toMatch(/clasificarla/);
    expect(erroresCertificado(arma({ pendientes: 1, aprobados: 8 }), cfg)[0]).toMatch(/aprobar/);
  });
  it("vigencia de 4 años menos un día", () => {
    expect(vigenciaHasta("2026-05-25", 4)).toBe("2030-05-24");
    expect(vigenciaHasta("2026-01-01", 4)).toBe("2029-12-31");
    expect(vigenciaHasta("2028-02-29", 1)).toBe("2029-02-27");
  });
  it("rango de una emisión en bloque, en orden numérico", () => {
    expect(rangoEmision(["000010", "000009", "000011"])).toEqual({ desde: "000009", hasta: "000011", cantidad: 3 });
    expect(rangoEmision(["9", "10"])).toEqual({ desde: "9", hasta: "10", cantidad: 2 });
    expect(rangoEmision([])).toBeNull();
  });
});

describe("estado del arma y avance del expediente", () => {
  it("etapa de cada arma", () => {
    expect(etapaArma(arma({ clase: null, permisibilidad: null }), cfg)).toBe("registrada");
    expect(etapaArma(arma({ permisibilidad: "prohibida" }), cfg)).toBe("prohibida");
    expect(etapaArma(arma({ pendientes: 3, aprobados: 0 }), cfg)).toBe("en_ensayo");
    expect(etapaArma(arma({ aprobados: 5 }), cfg)).toBe("por_revisar");
    expect(etapaArma(arma({ veredicto: "no_cumple" }), cfg)).toBe("no_cumple");
    expect(etapaArma(arma(), cfg)).toBe("por_acunar");
    expect(etapaArma(arma({ acunada: true }), cfg)).toBe("por_certificar");
    expect(etapaArma(arma({ certificado: { estado: "en_firma" } }), cfg)).toBe("certificado_en_firma");
    expect(etapaArma(arma({ certificado: { estado: "oficial" } }), cfg)).toBe("certificada");
    expect(etapaArma(arma({ entregada: true }), cfg)).toBe("entregada");
  });
  it("expediente vacío: el paso actual es programar", () => {
    const a = avanceD11({ programada: false, llegada: false, actaFirmada: false, recibidas: null, armas: [] }, cfg);
    expect(a.actual).toBe(1);
    expect(a.pasos[0]).toMatchObject({ estado: "pendiente", leToca: "Jefe D11", boton: "Programar → esperar llegada" });
    expect(a.completo).toBe(false);
  });
  it("con acta firmada y armas en ensayo, el paso actual es ensayos", () => {
    const a = avanceD11(
      { programada: true, llegada: true, actaFirmada: true, recibidas: 2, armas: [arma({ pendientes: 2, aprobados: 0 }), arma({ aprobados: 0 })] },
      cfg,
    );
    expect(a.pasos.map((p) => p.estado).slice(0, 6)).toEqual(["hecho", "hecho", "hecho", "hecho", "hecho", "en_curso"]);
    expect(a.actual).toBe(6);
  });
  it("todo entregado: completo", () => {
    const a = avanceD11(
      { programada: true, llegada: true, actaFirmada: true, recibidas: 1, armas: [arma({ acunada: true, certificado: { estado: "oficial" }, entregada: true })] },
      cfg,
    );
    expect(a.completo).toBe(true);
    expect(a.pasos.every((p) => p.estado === "hecho")).toBe(true);
  });
  it("la prohibida no se entrega: la entrega está hecha con las demás entregadas (coherente con el cierre)", () => {
    const ok = arma({ acunada: true, certificado: { estado: "oficial" }, entregada: true });
    const prohibida = arma({ permisibilidad: "prohibida", veredicto: null, ensayos: 0, aprobados: 0 });
    const a = avanceD11({ programada: true, llegada: true, actaFirmada: true, recibidas: 3, armas: [ok, ok, prohibida] }, cfg);
    const entrega = a.pasos.find((p) => p.clave === "entrega")!;
    expect(entrega.estado).toBe("hecho");
    expect(entrega.detalle).toBe("2 de 2 entregadas · 1 prohibida: no se entrega");
    expect(a.completo).toBe(true);
  });
  it("un paso no se marca hecho si el anterior no lo está", () => {
    const a = avanceD11({ programada: false, llegada: true, actaFirmada: true, recibidas: 1, armas: [arma({ acunada: true })] }, cfg);
    expect(a.actual).toBe(1);
    expect(a.pasos[1].estado).toBe("en_curso");
  });
  it("cierre: faltan armas por entregar (las prohibidas no se cuentan)", () => {
    expect(faltantesCierreD11([{ muestra: "M1", entregada: true, prohibida: false }])).toEqual([]);
    expect(faltantesCierreD11([{ muestra: "M2", entregada: false, prohibida: true }])).toEqual([]);
    expect(faltantesCierreD11([{ muestra: "M3", entregada: false, prohibida: false }])[0]).toMatch(/1 arma\(s\).*M3/);
  });
});
