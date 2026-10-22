import { calcularAvance, puedeActuar, tipoRuta, type CalibracionAvance, type DocumentoAvance, type HechosOt, type InstrumentoAvance } from "./avance-ot";

/** OT de laboratorio recién nacida de una cotización aceptada (estado «recepcionada»). */
function base(p: Partial<HechosOt> = {}): HechosOt {
  return {
    id: "ot-1",
    codigo: "OT-2026-0001",
    estado: "recepcionada",
    origen: "COTIZACION",
    conCobro: true,
    unidad: { codigo: "LQC" },
    cotizacion: { codigo: "COT-2026-0001", estado: "aceptada" },
    muestras: { total: 0, recepcionIncompleta: 0 },
    analistas: [],
    resultados: { total: 0, pendientes: 0, capturados: 0, revisados: 0, aprobados: 0, devueltos: 0 },
    documentos: [],
    factura: null,
    ...p,
  };
}
const res = (r: Partial<HechosOt["resultados"]>) => ({ total: 3, pendientes: 0, capturados: 0, revisados: 0, aprobados: 0, devueltos: 0, ...r });
const conMuestra = { muestras: { total: 1, recepcionIncompleta: 0 }, analistas: ["J. P."] };
const doc = (p: Partial<DocumentoAvance> = {}): DocumentoAvance => ({ id: "d1", numero: "IE-0001", estado: "en_firma", entregadoAt: null, ...p });
const estados = (a: ReturnType<typeof calcularAvance>) => Object.fromEntries(a.etapas.map((e) => [e.clave, e.estado]));

describe("Ruta de la OT · laboratorio (recorrido estándar)", () => {
  it("las 12 etapas, en orden", () => {
    expect(calcularAvance(base()).etapas.map((e) => e.clave)).toEqual([
      "apertura", "recepcion", "asignacion", "analisis", "revision", "aprobacion",
      "emision", "firmas", "entrega", "cierre", "factura", "pago",
    ]);
  });

  it("recién creada (recepcionada, sin muestras): la etapa actual es Recepción, no la primera por defecto", () => {
    const a = calcularAvance(base());
    expect(a.tipo).toBe("laboratorio");
    expect(a.etapaActual).toBe("recepcion");
    expect(estados(a).apertura).toBe("hecho");
    expect(estados(a).recepcion).toBe("en_curso");
    expect(estados(a).asignacion).toBe("pendiente");
    expect(a.etapas[0].detalle).toBe("Cotización COT-2026-0001 aceptada · LQC");
    expect(a.siguiente?.leToca).toEqual({ rol: "Recepción de muestras", unidad: "LQC", personas: [] });
    expect(a.siguiente?.accion).toMatchObject({ pestana: "muestras", permisos: ["muestra.crear"] });
    expect(a.cierre).toBeNull();
  });

  it("sin laboratorio responsable: Apertura (le toca a Planificación, en la Cabecera)", () => {
    const a = calcularAvance(base({ unidad: null }));
    expect(a.etapaActual).toBe("apertura");
    expect(a.siguiente?.accion).toMatchObject({ pestana: "cabecera", permisos: ["ot.cambiar_laboratorio"] });
  });

  it("con muestras y sin analista: Asignación (Jefe de Laboratorio)", () => {
    const a = calcularAvance(base({ muestras: { total: 2, recepcionIncompleta: 1 }, resultados: res({ pendientes: 3 }) }));
    expect(a.etapaActual).toBe("asignacion");
    expect(a.siguiente?.leToca?.rol).toBe("Jefe de Laboratorio");
    expect(a.siguiente?.accion?.pestana).toBe("asignacion");
    expect(a.etapas[1].detalle).toBe("2 muestras · 1 con recepción incompleta");
    expect(a.avisos.join(" ")).toContain("recepción incompleta");
  });

  it("asignada: Análisis, le toca al analista asignado (por nombre)", () => {
    const a = calcularAvance(base({ ...conMuestra, resultados: res({ pendientes: 3 }) }));
    expect(a.etapaActual).toBe("analisis");
    expect(a.siguiente?.texto).toBe("Capturar resultados de 3 ensayos");
    expect(a.siguiente?.leToca).toEqual({ rol: "Analista", unidad: "LQC", personas: ["J. P."] });
    expect(a.siguiente?.accion).toMatchObject({ ruta: "/captura-ot?otId=ot-1", permisos: ["resultado.crear"] });
  });

  it("con resultados a medias: sigue en Análisis y cuenta lo capturado y lo devuelto", () => {
    const a = calcularAvance(base({ ...conMuestra, resultados: res({ pendientes: 1, capturados: 1, devueltos: 1 }) }));
    expect(a.etapaActual).toBe("analisis");
    expect(a.etapas.find((e) => e.clave === "analisis")?.detalle).toBe("1 de 3 ensayos capturados · 1 devuelto(s)");
    expect(a.siguiente?.texto).toBe("Capturar resultados de 2 ensayos (1 devuelto(s) para corregir)");
  });

  it("sin asignación formal pero ya capturando: la asignación no bloquea", () => {
    const a = calcularAvance(base({ muestras: { total: 1, recepcionIncompleta: 0 }, resultados: res({ pendientes: 2, capturados: 1 }) }));
    expect(estados(a).asignacion).toBe("hecho");
    expect(a.etapas[2].detalle).toBe("Sin asignación formal");
    expect(a.etapaActual).toBe("analisis");
  });

  it("todo capturado: Revisión (Analista revisor)", () => {
    const a = calcularAvance(base({ ...conMuestra, resultados: res({ capturados: 2, revisados: 1 }) }));
    expect(a.etapaActual).toBe("revision");
    expect(a.siguiente?.texto).toBe("Revisar 2 resultados capturados");
    expect(a.siguiente?.leToca?.rol).toBe("Analista revisor");
    expect(a.siguiente?.accion?.permisos).toEqual(["resultado.revisar"]);
  });

  it("todo revisado: Aprobación (Jefe de Laboratorio)", () => {
    const a = calcularAvance(base({ ...conMuestra, resultados: res({ revisados: 2, aprobados: 1 }) }));
    expect(a.etapaActual).toBe("aprobacion");
    expect(a.siguiente?.texto).toBe("Aprobar 2 resultados revisados");
    expect(a.siguiente?.accion?.permisos).toEqual(["resultado.aprobar"]);
  });

  it("aprobada: Emisión del informe (pestaña Informe y cierre)", () => {
    const a = calcularAvance(base({ ...conMuestra, resultados: res({ aprobados: 3 }) }));
    expect(a.etapaActual).toBe("emision");
    expect(a.siguiente?.accion).toMatchObject({ pestana: "informe", permisos: ["certificado.emitir"] });
    for (const k of ["apertura", "recepcion", "asignacion", "analisis", "revision", "aprobacion"]) expect(estados(a)[k]).toBe("hecho");
  });

  it("en firma: Firmas, le toca al firmante del paso según la matriz (solo él tiene el botón)", () => {
    const d = doc({ pendientes: [{ rol: "Analista revisor", unidad: "LQC", personas: [{ id: "u-rev", nombre: "R. V." }] }] });
    const a = calcularAvance(base({ ...conMuestra, resultados: res({ aprobados: 3 }), documentos: [d] }));
    expect(a.etapaActual).toBe("firmas");
    expect(estados(a).emision).toBe("hecho");
    expect(a.siguiente?.texto).toBe("Firmar IE-0001 (paso de Analista revisor)");
    expect(a.siguiente?.leToca).toEqual({ rol: "Analista revisor", unidad: "LQC", personas: ["R. V."] });
    expect(a.siguiente?.accion?.usuarios).toEqual(["u-rev"]);
  });

  it("documento devuelto: vuelve a Emisión para reemitir", () => {
    const a = calcularAvance(base({ ...conMuestra, resultados: res({ aprobados: 3 }), documentos: [doc({ estado: "devuelto" })] }));
    expect(a.etapaActual).toBe("emision");
    expect(a.siguiente?.texto).toContain("devuelto");
  });

  it("un documento anulado no cuenta", () => {
    const a = calcularAvance(base({ ...conMuestra, resultados: res({ aprobados: 3 }), documentos: [doc({ estado: "anulado" })] }));
    expect(a.etapaActual).toBe("emision");
    expect(a.siguiente?.texto).toBe("Emitir el informe con los resultados aprobados");
  });

  it("oficial (emitida) sin entregar: Entrega", () => {
    const a = calcularAvance(base({ ...conMuestra, resultados: res({ aprobados: 3 }), documentos: [doc({ estado: "oficial" })] }));
    expect(a.etapaActual).toBe("entrega");
    expect(estados(a).firmas).toBe("hecho");
    expect(a.siguiente?.texto).toBe("Registrar la entrega de IE-0001 al cliente");
    expect(a.siguiente?.accion?.permisos).toEqual(["certificado.entregar"]);
  });

  it("entregada: Cierre, con la misma regla que el cierre del servidor", () => {
    const a = calcularAvance(base({ ...conMuestra, resultados: res({ aprobados: 3 }), documentos: [doc({ estado: "oficial", entregadoAt: "2026-10-20" })] }));
    expect(a.etapaActual).toBe("cierre");
    expect(a.siguiente?.texto).toBe("Cerrar la OT: todo está aprobado, oficial y entregado");
    expect(a.siguiente?.accion).toMatchObject({ pestana: "informe", permisos: ["ot.cerrar"] });
  });

  const entregada = { ...conMuestra, resultados: res({ aprobados: 3 }), documentos: [doc({ estado: "oficial", entregadoAt: "2026-10-20" })] };

  it("cerrada con factura pendiente: Factura (Finanzas) y línea de cierre", () => {
    const a = calcularAvance(base({ ...entregada, estado: "cerrada", fechaCierre: "2026-10-20T12:00:00Z", factura: { numero: "PEND-0001", estado: "pendiente" } }));
    expect(a.etapaActual).toBe("factura");
    expect(estados(a).cierre).toBe("hecho");
    expect(a.siguiente?.texto).toBe("Emitir la factura PEND-0001 con su folio");
    expect(a.siguiente?.accion).toMatchObject({ ruta: "/facturas", permisos: ["factura.emitir"] });
    expect(a.cierre).toEqual({ fecha: "2026-10-20T12:00:00.000Z", conCobro: true, factura: { numero: "PEND-0001", estado: "pendiente" } });
  });

  it("facturada (emitida): Pago", () => {
    const a = calcularAvance(base({ ...entregada, estado: "cerrada", factura: { numero: "F-1", estado: "emitida" } }));
    expect(a.etapaActual).toBe("pago");
    expect(a.siguiente?.accion?.permisos).toEqual(["factura.cobrar"]);
    expect(calcularAvance(base({ ...entregada, estado: "cerrada", factura: { numero: "F-1", estado: "parcial" } })).etapaActual).toBe("pago");
  });

  it("pagada: todas las etapas hechas, sin siguiente paso", () => {
    const a = calcularAvance(base({ ...entregada, estado: "cerrada", factura: { numero: "F-1", estado: "pagada" } }));
    expect(a.etapaActual).toBeNull();
    expect(a.siguiente).toBeNull();
    expect(a.etapas.every((e) => e.estado === "hecho")).toBe(true);
  });

  it("cerrada sin pasar por una etapa: queda «no aplica», no pendiente", () => {
    const a = calcularAvance(base({ ...entregada, analistas: [], resultados: res({ total: 0 }), estado: "cerrada", factura: { numero: "F-1", estado: "pagada" } }));
    expect(estados(a).asignacion).toBe("no_aplica");
    expect(a.etapaActual).toBeNull();
  });

  it("una sola etapa actual: lo que viene detrás queda pendiente", () => {
    const a = calcularAvance(base({ ...conMuestra, resultados: res({ pendientes: 3 }) }));
    expect(a.etapas.filter((e) => e.estado === "en_curso")).toHaveLength(1);
    expect(estados(a).revision).toBe("pendiente");
  });

  it("anulada: sin etapa actual y con aviso", () => {
    const a = calcularAvance(base({ estado: "anulada" }));
    expect(a.etapaActual).toBeNull();
    expect(a.avisos).toContain("La OT está anulada.");
  });

  it("OPI pendiente: aviso", () => {
    expect(calcularAvance(base({ opiPendiente: true, origen: "DISPOSICION", cotizacion: null })).avisos.join(" ")).toContain("OPI pendiente");
  });
});

describe("Ruta de la OT · OT interna, interlaboratorio y sin cobro", () => {
  it("OT interna: factura y pago no aplican", () => {
    const h = base({ origen: "OT_INTERNA", conCobro: false, cotizacion: null });
    const a = calcularAvance(h);
    expect(tipoRuta(h)).toBe("interna");
    expect(estados(a).factura).toBe("no_aplica");
    expect(estados(a).pago).toBe("no_aplica");
    expect(a.etapas[0].detalle).toBe("OT interna · LQC");
  });

  it("interlaboratorio cerrada: termina en el cierre", () => {
    const a = calcularAvance(base({ ...entregadaInterna(), estado: "cerrada" }));
    expect(a.etapaActual).toBeNull();
    expect(a.cierre?.factura).toBeNull();
    expect(a.cierre?.conCobro).toBe(false);
  });

  it("cotización sin cobro: factura no aplica", () => {
    expect(estados(calcularAvance(base({ conCobro: false }))).factura).toBe("no_aplica");
  });

  function entregadaInterna(): Partial<HechosOt> {
    return { origen: "INTERLABORATORIO", conCobro: false, cotizacion: null, ...conMuestra, resultados: res({ aprobados: 3 }), documentos: [doc({ estado: "oficial", entregadoAt: "2026-10-20" })] };
  }
});

describe("Ruta de la OT · Metrología (EP-04: calibración ligada a la OT)", () => {
  const met = (p: Partial<HechosOt> = {}) => base({ unidad: { codigo: "LMT", esMetrologia: true }, origen: "OT_INTERNA", conCobro: false, cotizacion: null, ...p });
  const ins = (estado: string, p: Partial<InstrumentoAvance> = {}): InstrumentoAvance => ({ id: "i1", numero: 1, descripcion: "Balanza", estado, metrologo: "L. S.", metrologoId: "u-m", ...p });
  const cal = (estado: string, p: Partial<CalibracionAvance> = {}): CalibracionAvance =>
    ({ id: "c1", instrumentoId: "i1", codigo: "CAL-1", estado, numeroCertificado: estado === "emitida" ? "M-001" : null, ...p });

  it("sin instrumentos: etapas de Metrología y le toca registrar los instrumentos", () => {
    const h = met();
    const a = calcularAvance(h);
    expect(tipoRuta(h)).toBe("metrologia");
    expect(a.etapas.map((e) => e.clave)).toEqual(["apertura", "asignacion", "recepcion", "calibracion", "revision_tecnica", "firma_emision", "entrega", "cierre", "factura", "pago"]);
    expect(a.etapaActual).toBe("asignacion");
    expect(a.siguiente?.texto).toContain("Registrar los instrumentos de la OT");
    expect(a.siguiente?.accion).toMatchObject({ pestana: "instrumentos" });
  });

  it("instrumento sin metrólogo: Programación del Jefe de Laboratorio", () => {
    const a = calcularAvance(met({ instrumentos: [ins("por_recibir", { metrologo: null, metrologoId: null })] }));
    expect(a.etapaActual).toBe("asignacion");
    expect(a.siguiente?.accion?.permisos).toEqual(["ot.asignar"]);
  });

  it("asignado y por recibir: Recepción del instrumento (custodia)", () => {
    const a = calcularAvance(met({ instrumentos: [ins("por_recibir")] }));
    expect(a.etapaActual).toBe("recepcion");
    expect(a.siguiente?.texto).toBe("Registrar la recepción de ítem 1 (Balanza)");
  });

  it("recibido sin calibración: Calibrar el ítem (no hay calibración suelta)", () => {
    const a = calcularAvance(met({ instrumentos: [ins("recibido")] }));
    expect(a.etapaActual).toBe("calibracion");
    expect(a.siguiente?.texto).toBe("Calibrar ítem 1 (Balanza)");
    expect(a.siguiente?.leToca?.personas).toEqual(["L. S."]);
  });

  it("borrador (o «calculada» heredada): sigue en Toma de datos y lleva a la ficha", () => {
    const a = calcularAvance(met({ instrumentos: [ins("recibido")], calibraciones: [cal("calculada")] }));
    expect(a.siguiente?.texto).toBe("Completar y enviar a revisión CAL-1");
    expect(a.siguiente?.accion?.ruta).toBe("/metrologia/c1");
  });

  it("en revisión: Revisión técnica del Jefe de Laboratorio", () => {
    const a = calcularAvance(met({ instrumentos: [ins("recibido")], calibraciones: [cal("en_revision")] }));
    expect(a.etapaActual).toBe("revision_tecnica");
    expect(a.siguiente?.leToca?.rol).toBe("Jefe de Laboratorio de Metrología");
  });

  it("en firma: Firma y emisión", () => {
    expect(calcularAvance(met({ instrumentos: [ins("recibido")], calibraciones: [cal("en_firma")] })).etapaActual).toBe("firma_emision");
  });

  it("emitida: la Entrega ya NO está bloqueada; primero la entrega del certificado", () => {
    const a = calcularAvance(met({ instrumentos: [ins("recibido")], calibraciones: [cal("reemplazada", { id: "c0", codigo: "CAL-0" }), cal("emitida")] }));
    expect(a.etapaActual).toBe("entrega");
    expect(estados(a).entrega).toBe("en_curso");
    expect(a.siguiente?.texto).toBe("Registrar la entrega del certificado M-001");
    expect(a.siguiente?.accion).toMatchObject({ pestana: "instrumentos", permisos: ["certificado.entregar", "metrologia.crear"] });
  });

  it("entregado pero el instrumento sigue en custodia: devolución con acta", () => {
    const a = calcularAvance(met({ instrumentos: [ins("recibido")], calibraciones: [cal("emitida", { entregadoAt: "2026-10-20" })] }));
    expect(a.etapaActual).toBe("entrega");
    expect(a.siguiente?.texto).toBe("Registrar la devolución de ítem 1 (Balanza) (acta)");
  });

  it("sin exigir devolución (parámetro): con el certificado entregado pasa al cierre", () => {
    const a = calcularAvance(met({ exigeDevolucion: false, instrumentos: [ins("recibido")], calibraciones: [cal("emitida", { entregadoAt: "2026-10-20" })] }));
    expect(a.etapaActual).toBe("cierre");
    expect(a.siguiente?.texto).toBe("Cerrar la OT: todo está aprobado, oficial y entregado");
  });

  it("entregado y devuelto: Cierre de la OT, que cuenta el certificado de calibración como documento", () => {
    const a = calcularAvance(met({ instrumentos: [ins("devuelto")], calibraciones: [cal("emitida", { entregadoAt: "2026-10-20" })] }));
    expect(a.etapaActual).toBe("cierre");
    expect(a.siguiente?.texto).not.toContain("no tiene informes");
  });

  it("con cobro y cerrada: factura pendiente", () => {
    const a = calcularAvance(met({ conCobro: true, estado: "cerrada", instrumentos: [ins("devuelto")], calibraciones: [cal("emitida", { entregadoAt: "2026-10-20" })], factura: { numero: "PEND-1", estado: "pendiente" } }));
    expect(a.etapaActual).toBe("factura");
  });

  it("un laboratorio de Metrología que usa la captura estándar sigue la ruta de laboratorio", () => {
    expect(tipoRuta(met({ resultados: res({ pendientes: 3 }) }))).toBe("interna");
  });
});

describe("Ruta de la OT · BPCH Internación", () => {
  const int = (p: Partial<NonNullable<HechosOt["internacion"]>> = {}) => ({
    id: "int-1", numero: "INT-2026-0001", unidad: "SCC", lotes: 2, lotesRegistrados: 2, codificacionCertificados: [null, null],
    sujetaTasa: true, tasaRemitida: false, tasaEnCurso: false, documentacion: "pendiente", ...p,
  });
  const bp = (p: Partial<HechosOt> = {}) =>
    base({ origen: "INTERNACION", cotizacion: null, unidad: { codigo: "SCC" }, internacion: int(), muestras: { total: 2, recepcionIncompleta: 0, veredictos: ["cumple", "cumple"] }, ...p });
  const informe = (p: Partial<DocumentoAvance> = {}) => doc({ id: "inf", numero: "3000/1", tipoDocumento: "INFORME_INSPECCION", estado: "oficial", ...p });
  const certificado = (p: Partial<DocumentoAvance> = {}) => doc({ id: "cer", numero: "CC-1", tipoDocumento: "CERTIFICADO_CONFORMIDAD", estado: "oficial", ...p });

  it("las fases del expediente BPCH, con la resolución hecha", () => {
    const a = calcularAvance(bp({ internacion: int({ lotesRegistrados: 1 }) }));
    expect(a.tipo).toBe("internacion");
    expect(a.etapas.map((e) => e.clave)).toEqual(["registro", "lotes", "resultados", "informe", "documento_final", "codificacion", "tasa", "cierre"]);
    expect(a.etapaActual).toBe("lotes");
    expect(a.siguiente?.accion?.ruta).toBe("/bpch/internaciones/int-1");
  });

  it("lotes registrados: Resultados de la inspección (captura)", () => {
    const a = calcularAvance(bp({ resultados: res({ pendientes: 2, aprobados: 1 }) }));
    expect(a.etapaActual).toBe("resultados");
    expect(a.siguiente?.texto).toBe("Capturar resultados de 2 ensayos");
  });

  it("resultados capturados: la misma fase pide revisar y luego aprobar", () => {
    expect(calcularAvance(bp({ resultados: res({ capturados: 3 }) })).siguiente?.texto).toBe("Revisar 3 resultados capturados");
    expect(calcularAvance(bp({ resultados: res({ revisados: 3 }) })).siguiente?.texto).toBe("Aprobar 3 resultados revisados");
  });

  it("Informe de Inspección en firma", () => {
    const a = calcularAvance(bp({ resultados: res({ aprobados: 3 }), documentos: [informe({ estado: "en_firma", pendientes: [{ rol: "Jefe SCC", unidad: "SCC", personas: [{ id: "j", nombre: "J. S." }] }] })] }));
    expect(a.etapaActual).toBe("informe");
    expect(a.siguiente?.leToca?.personas).toEqual(["J. S."]);
  });

  it("CUMPLE con certificado oficial: Codificación Única; luego Tasa; luego Cierre", () => {
    const docs = [informe(), certificado()];
    let a = calcularAvance(bp({ resultados: res({ aprobados: 3 }), documentos: docs }));
    expect(a.etapaActual).toBe("codificacion");
    a = calcularAvance(bp({ resultados: res({ aprobados: 3 }), documentos: docs, internacion: int({ codificacionCertificados: ["cer", "cer"] }) }));
    expect(a.etapaActual).toBe("tasa");
    expect(a.siguiente?.accion?.permisos).toEqual(["bpch.tasa.gestionar"]);
    a = calcularAvance(bp({ resultados: res({ aprobados: 3 }), documentos: docs, internacion: int({ codificacionCertificados: ["cer", "cer"], tasaRemitida: true }) }));
    expect(a.etapaActual).toBe("cierre");
    expect(a.siguiente?.texto).toContain("falta registrar su entrega");
  });

  it("NO CUMPLE: Informe de Incumplimiento y sin Codificación", () => {
    const a = calcularAvance(bp({ muestras: { total: 2, recepcionIncompleta: 0, veredictos: ["cumple", "no_cumple"] }, resultados: res({ aprobados: 3 }), documentos: [informe()] }));
    expect(a.etapas.find((e) => e.clave === "documento_final")?.titulo).toBe("Informe de Incumplimiento → DGMN");
    expect(estados(a).codificacion).toBe("no_aplica");
    expect(a.etapaActual).toBe("documento_final");
    expect(a.siguiente?.texto).toBe("Emitir el Informe de Incumplimiento");
  });

  it("no sujeta a tasa: la tasa no aplica", () => {
    expect(estados(calcularAvance(bp({ internacion: int({ sujetaTasa: false }) }))).tasa).toBe("no_aplica");
  });
});

describe("Ruta de la OT · BPCH Reinspección", () => {
  const rei = (p: Partial<NonNullable<HechosOt["reinspeccion"]>> = {}) => ({ id: "rei-1", numero: "REI-1", unidad: "SSTGO", loteRegistrado: true, conCodificacion: true, trazabilidadHecha: false, ...p });
  const h = (p: Partial<HechosOt> = {}) => base({ origen: "REINSPECCION", cotizacion: null, reinspeccion: rei(), ...p });

  it("fases y lote pendiente", () => {
    const a = calcularAvance(h({ reinspeccion: rei({ loteRegistrado: false }) }));
    expect(a.tipo).toBe("reinspeccion");
    expect(a.etapas.map((e) => e.clave)).toEqual(["solicitud", "lote", "resultados", "informe", "trazabilidad", "cierre"]);
    expect(a.etapaActual).toBe("lote");
  });

  it("informe oficial sin entregar: sigue en el informe (entrega)", () => {
    const a = calcularAvance(h({ resultados: res({ aprobados: 3 }), documentos: [doc({ tipoDocumento: "INFORME_INSPECCION", estado: "oficial" })] }));
    expect(a.etapaActual).toBe("informe");
    expect(a.siguiente?.texto).toContain("Registrar la entrega");
  });

  it("entregado: Trazabilidad; sin codificación no aplica y pasa al cierre", () => {
    const docs = [doc({ tipoDocumento: "INFORME_INSPECCION", estado: "oficial", entregadoAt: "2026-10-20" })];
    expect(calcularAvance(h({ resultados: res({ aprobados: 3 }), documentos: docs })).etapaActual).toBe("trazabilidad");
    expect(calcularAvance(h({ resultados: res({ aprobados: 3 }), documentos: docs, reinspeccion: rei({ conCodificacion: false }) })).etapaActual).toBe("cierre");
  });
});

describe("puedeActuar · el botón del siguiente paso", () => {
  const acc = { texto: "x", permisos: ["resultado.revisar"] };
  it("con el permiso de la acción, sí; sin él, no", () => {
    expect(puedeActuar(acc, { permisos: ["resultado.revisar"] })).toBe(true);
    expect(puedeActuar(acc, { permisos: ["resultado.crear"] })).toBe(false);
  });
  it("superadministrador, sí", () => {
    expect(puedeActuar(acc, { roles: ["SUPERADMIN"] })).toBe(true);
  });
  it("firma: solo los responsables del paso, aunque sea superadministrador", () => {
    const firma = { texto: "Firmar", permisos: [], usuarios: ["u1"] };
    expect(puedeActuar(firma, { id: "u1" })).toBe(true);
    expect(puedeActuar(firma, { id: "u2", roles: ["SUPERADMIN"] })).toBe(false);
  });
  it("sin acción, no", () => {
    expect(puedeActuar(null, { roles: ["SUPERADMIN"] })).toBe(false);
  });
});

describe("Ruta de la OT · órdenes internas (frente r1b · EP-01 3.7)", () => {
  const oi = (p: Partial<NonNullable<HechosOt["ordenesInternas"]>[number]> = {}) =>
    ({ id: "oi-1", numero: "OI-2026-0001", estado: "abierta", destino: "LCC", respondida: false, aceptada: false, ...p });

  it("con lo propio capturado, una orden abierta deja el Análisis en curso y le toca al destino recibirla", () => {
    const a = calcularAvance(base({ ...conMuestra, resultados: res({ capturados: 3 }), ordenesInternas: [oi()] }));
    expect(a.etapaActual).toBe("analisis");
    expect(a.etapas.find((e) => e.clave === "analisis")?.detalle).toContain("1 orden interna pendiente");
    expect(a.siguiente?.texto).toBe("Recibir la orden interna OI-2026-0001 en LCC");
    expect(a.siguiente?.leToca).toEqual({ rol: "Jefe de Laboratorio", unidad: "LCC", personas: [] });
    expect(a.siguiente?.accion).toMatchObject({ ruta: "/ordenes-internas/oi-1", permisos: ["orden_interna.responder"] });
  });

  it("recibida: responder; respondida: cerrar; cerrada sin integrar: le toca al solicitante darla por recibida", () => {
    const h = (o: ReturnType<typeof oi>) => calcularAvance(base({ ...conMuestra, resultados: res({ capturados: 3 }), ordenesInternas: [o] }));
    expect(h(oi({ estado: "recibida" })).siguiente?.texto).toMatch(/^Responder la orden interna/);
    expect(h(oi({ estado: "recibida", respondida: true })).siguiente?.texto).toMatch(/^Cerrar la orden interna/);
    const c = h(oi({ estado: "cerrada", respondida: true }));
    expect(c.siguiente?.texto).toMatch(/^Dar por recibido el informe/);
    expect(c.siguiente?.leToca?.unidad).toBe("LQC");
    expect(c.siguiente?.accion?.permisos).toEqual(["orden_interna.emitir"]);
  });

  it("integrada (o anulada) ya no frena: sigue la revisión", () => {
    const a = calcularAvance(base({ ...conMuestra, resultados: res({ capturados: 3 }), ordenesInternas: [oi({ estado: "cerrada", aceptada: true }), oi({ id: "x", estado: "anulada" })] }));
    expect(a.etapaActual).toBe("revision");
  });

  it("con ensayos propios por capturar, primero la captura", () => {
    const a = calcularAvance(base({ ...conMuestra, resultados: res({ pendientes: 1, capturados: 2 }), ordenesInternas: [oi()] }));
    expect(a.siguiente?.texto).toMatch(/^Capturar resultados/);
  });
});

describe("Ruta de la OT · cabecera de inspección BPCH (frente r1b · EP-10 10.11)", () => {
  it("con todo aprobado y la cabecera incompleta, el siguiente paso es completar la cabecera", () => {
    const a = calcularAvance(base({ ...conMuestra, unidad: { codigo: "SSTGO" }, resultados: res({ aprobados: 3 }), cabeceraBpch: ["La cabecera de inspección no tiene el lugar de inspección."] }));
    expect(a.etapaActual).toBe("emision");
    expect(a.siguiente?.texto).toMatch(/^Completar la cabecera de inspección/);
    expect(a.siguiente?.accion).toMatchObject({ pestana: "cabecera", permisos: ["bpch.cabecera.gestionar"] });
  });
  it("con la cabecera completa, emitir", () => {
    const a = calcularAvance(base({ ...conMuestra, resultados: res({ aprobados: 3 }), cabeceraBpch: [] }));
    expect(a.siguiente?.texto).toBe("Emitir el informe con los resultados aprobados");
  });
});

describe("Ruta de la OT · recepción R1 (frente r1d)", () => {
  it("el siguiente paso de la recepción nombra lo que se registra al recibir (producto, condición, Nº interno)", () => {
    const a = calcularAvance(base());
    expect(a.siguiente?.texto).toBe("Recepcionar las muestras: producto, condición de recepción, Nº interno y sus ensayos");
    expect(a.siguiente?.accion).toMatchObject({ pestana: "muestras", permisos: ["muestra.crear"] });
  });
  it("una muestra sin el producto que exige el laboratorio cuenta como recepción incompleta (aviso, no bloquea)", () => {
    const a = calcularAvance(base({ muestras: { total: 1, recepcionIncompleta: 1 }, resultados: res({ pendientes: 3 }) }));
    expect(a.etapas.find((e) => e.clave === "recepcion")?.estado).toBe("hecho");
    expect(a.avisos.join(" ")).toContain("recepción incompleta");
  });
});
