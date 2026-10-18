import {
  avisosFechas, cmcPara, codigoVerificacionValido, convertir, decimales2cs, estadoPatron, motivoHabilitacion, nuevoCodigoVerificacion,
  numeroCertificado, revisarPatrones, u2cs, uCertificada, type FilaCmc, type Firmante,
} from "./metrologia.reglas";
import { accionesDisponibles, motivoNoEnviable, motivoRechazo, ordenElabora, pasoPendiente, pasosSinResponsable, puedeFirmarPaso, type ContextoCal, type PasoFirmaCal } from "./metrologia.flujo";

describe("C3 · numeración del certificado por magnitud y sin año", () => {
  it("prefijo de la magnitud y correlativo; par torsional con 4 cifras", () => {
    expect(numeroCertificado("M", 3950)).toBe("M-3950");
    expect(numeroCertificado("PT", 91, 4)).toBe("PT-0091");
    expect(numeroCertificado("V", 5921)).not.toMatch(/20\d\d/);
  });
  it("código de verificación con el formato que acepta la verificación pública", () => {
    const c = nuevoCodigoVerificacion();
    expect(codigoVerificacionValido(c)).toBe(true);
    expect(codigoVerificacionValido("ABCDE-12345")).toBe(true);
    expect(codigoVerificacionValido("ABCDI-12345")).toBe(false); // I no existe en el alfabeto
    expect(codigoVerificacionValido("x'; drop")).toBe(false);
  });
});

describe("C12 · U con dos cifras significativas (hacia arriba)", () => {
  it.each([[0.120578, 0.13], [0.2352, 0.24], [0.000294, 0.0003], [3, 3], [2.21, 2.3], [0.0063, 0.0063], [1.30144, 1.4], [25, 25]])("%p → %p", (u, r) => {
    expect(u2cs(u)).toBeCloseTo(r, 12);
  });
  it("decimales para escribirla (0,00030 → 5; 3,0 → 1; 25 → 0)", () => {
    expect(decimales2cs(0.0003)).toBe(5);
    expect(decimales2cs(3)).toBe(1);
    expect(decimales2cs(25)).toBe(0);
  });
  it("U certificada = máx(U, CMC) con dos cifras", () => {
    expect(uCertificada(0.0063, 0.05)).toBe(0.05);
    expect(uCertificada(0.27, 0.25)).toBe(0.27);
    expect(uCertificada(null, 0.12)).toBe(0.12);
  });
});

describe("C11 · avisos de fechas", () => {
  it("OT posterior a la recepción (caso V-5920: OT 03-09, recepción 02-09)", () => {
    const a = avisosFechas({ fechaOt: "2026-09-03", fechaRecepcion: "2026-09-02", fechaCalibracion: "2026-09-03" });
    expect(a).toHaveLength(1);
    expect(a[0]).toMatch(/posterior a la de recepción/);
  });
  it("misma fecha o anterior: sin aviso; recepción posterior a la calibración: aviso", () => {
    expect(avisosFechas({ fechaOt: "2026-07-20", fechaRecepcion: "2026-07-20", fechaCalibracion: "2026-07-24" })).toEqual([]);
    expect(avisosFechas({ fechaRecepcion: "2026-08-01", fechaCalibracion: "2026-07-24" })[0]).toMatch(/revise las fechas/);
    expect(avisosFechas({})).toEqual([]);
  });
});

describe("C4 · habilitación del metrólogo por magnitud", () => {
  const reg: Firmante[] = [
    { funcion: "METROLOGO", magnitudes: ["par", "masa", "volumen"], laboratorios: ["LMT", "LMTE"], usuarioId: "u-mec", activo: true },
    { funcion: "METROLOGO", magnitudes: ["longitud"], laboratorios: ["LMT", "LMTE"], usuarioId: null, activo: true },
    { funcion: "JEFE_LAB", magnitudes: [], laboratorios: ["LMT", "LMTE"], usuarioId: "u-jefe", activo: true },
  ];
  it("habilitado en su magnitud", () => expect(motivoHabilitacion(reg, "u-mec", "LMT", "masa")).toBeNull());
  it("no habilitado en otra magnitud del registro", () => expect(motivoHabilitacion(reg, "u-mec", "LMT", "longitud")).toMatch(/registro de firmas/));
  it("la jefatura no habilita como metrólogo", () => expect(motivoHabilitacion(reg, "u-jefe", "LMT", "masa")).toMatch(/registro/));
  it("magnitud o laboratorio fuera del registro: no se controla (LNF, presión aquí)", () => {
    expect(motivoHabilitacion(reg, "u-x", "LNF", "fuerza")).toBeNull();
    expect(motivoHabilitacion(reg, "u-x", "LMT", "presion")).toBeNull();
  });
  it("una fila inactiva no habilita", () => {
    expect(motivoHabilitacion([{ ...reg[0], activo: false }, { ...reg[0], usuarioId: "otro" }], "u-mec", "LMT", "masa")).toMatch(/registro/);
  });
});

describe("Patrones: vigencia a la fecha de calibración", () => {
  const P = [
    { id: "a", codigo: "PM-05", nombre: "Juego de masas F1", vence: "2029-05-14" },
    { id: "b", codigo: "PL-10", nombre: "Micrómetro exterior", vence: "2026-11-24" },
    { id: "c", codigo: "PF-13", nombre: "Transductor 3 MN", vence: "2026-11-26", activo: false },
  ];
  it("estado", () => {
    expect(estadoPatron("2029-05-14", "2026-10-17")).toBe("vigente");
    expect(estadoPatron("2026-11-10", "2026-10-17")).toBe("por_vencer");
    expect(estadoPatron("2026-10-16", "2026-10-17")).toBe("vencido");
    expect(estadoPatron(null, "2026-10-17")).toBe("sin_fecha");
  });
  it("bloqueo si vencido, aviso si vence pronto, máximo 3, sin bajas", () => {
    expect(revisarPatrones(P, ["a"], "2026-10-17")).toEqual({ errores: [], avisos: [] });
    expect(revisarPatrones(P, ["b"], "2026-11-01").avisos[0]).toMatch(/vence el 24-11-2026/);
    expect(revisarPatrones(P, ["b"], "2026-12-01").errores[0]).toMatch(/venció el 24-11-2026/);
    expect(revisarPatrones(P, ["c"], "2026-10-17").errores[0]).toMatch(/dado de baja/);
    expect(revisarPatrones(P, ["a", "a"], "2026-10-17").errores[0]).toMatch(/repetidos/);
    expect(revisarPatrones(P, ["a", "b", "c", "d"], "2026-10-17").errores[0]).toMatch(/máximo 3/);
  });
});

describe("C5 · CMC del maestro versionado", () => {
  const base = { acreditacion: "LC 001", version: "LC 001 Mod. 2", vigente_desde: "2023-01-27", vigente_hasta: "2028-01-27", incluye_min: false, resolucion: null, b: null };
  const F: FilaCmc[] = [
    { ...base, proceso_codigo: "ITM02", rango_min: 100, rango_max: 200, unidad_rango: "g", tipo: "valor", a: 0.12, unidad_cmc: "mg" },
    { ...base, proceso_codigo: "ITL02", acreditacion: "LC 004", rango_min: 0, rango_max: 1000, unidad_rango: "mm", resolucion: 0.001, tipo: "lineal", a: 0.01, b: 0.3, unidad_cmc: "µm" },
    { ...base, proceso_codigo: "ITL01", acreditacion: "LC 004", rango_min: 0, rango_max: 1000, unidad_rango: "mm", resolucion: 0.01, tipo: "valor", a: 10, unidad_cmc: "µm" },
    { ...base, proceso_codigo: "ITF01", acreditacion: "LC 005", rango_min: 5, rango_max: 50, unidad_rango: "kN", tipo: "valor", a: 0.2, unidad_cmc: "%" },
    { ...base, proceso_codigo: "ITF01", acreditacion: "LC 005", rango_min: 5, rango_max: 50, unidad_rango: "kN", tipo: "valor", a: 0.21, unidad_cmc: "%" },
  ];
  it("balanza 200 g: 0,12 mg de LC 001 Mod. 2 (la planilla tenía 0,15) en g", () => {
    expect(cmcPara(F, { proceso: "ITM02", fecha: "2026-10-17", nominal: 200, unidad: "g", unidadU: "g" })!.cmc).toBeCloseTo(0.00012, 15);
  });
  it("micrómetro: 0,01·L + 0,3 µm con L en mm, solo con la resolución que corresponde", () => {
    expect(cmcPara(F, { proceso: "ITL02", fecha: "2026-10-17", nominal: 25, unidad: "mm", unidadU: "mm", resolucion: 0.001 })!.cmc).toBeCloseTo(0.00055, 12);
    expect(cmcPara(F, { proceso: "ITL02", fecha: "2026-10-17", nominal: 25, unidad: "mm", unidadU: "mm", resolucion: 0.01 })).toBeNull();
  });
  it("fuerza: kgf → kN; con dos patrones en el rango se toma la menor CMC", () => {
    expect(convertir(1000, "kgf", "kN")).toBeCloseTo(9.80665, 12);
    expect(cmcPara(F, { proceso: "ITF01", fecha: "2026-10-17", nominal: 1000, unidad: "kgf", unidadU: "%" })!.cmc).toBe(0.2);
  });
  it("fuera de rango o de vigencia: sin CMC (el punto se marca «*»)", () => {
    expect(cmcPara(F, { proceso: "ITM02", fecha: "2026-10-17", nominal: 300, unidad: "g", unidadU: "g" })).toBeNull();
    expect(cmcPara(F, { proceso: "ITM02", fecha: "2028-02-01", nominal: 150, unidad: "g", unidadU: "g" })).toBeNull();
  });
});

describe("C4 · circuito con la matriz de firmas (metrólogo → jefe LMT → jefe de departamento)", () => {
  const pasos: PasoFirmaCal[] = [
    { orden: 1, accion: "ELABORA", obligatorio: true, rol: { codigo: "METROLOGO", nombre: "Metrólogo" }, unidad: { codigo: "LMT" }, responsables: [] },
    { orden: 2, accion: "FIRMA", obligatorio: true, rol: { codigo: "JEFE_LAB", nombre: "Jefe de laboratorio" }, unidad: { codigo: "LMT" },
      responsables: [{ usuarioId: "jefe", nombre: "J", via: "titular" }, { usuarioId: "subr", nombre: "S", via: "subrogante" }] },
    { orden: 3, accion: "FIRMA", obligatorio: true, rol: { codigo: "JEFE_DEPTO", nombre: "Jefe de departamento" }, unidad: { codigo: "DSA" },
      responsables: [{ usuarioId: "depto", nombre: "D", via: "titular" }] },
  ];
  const ctx = (o: Partial<ContextoCal>): ContextoCal => ({ estado: "en_revision", esAutor: false, puedeCrear: true, puedeEmitir: true, calculada: true, ...o });

  it("tras el envío el pendiente es el jefe del laboratorio (titular o subrogante), que firma sin emitir", () => {
    const p = pasoPendiente(pasos, [{ orden: 1, usuarioId: "metro", accion: "ELABORA" }]);
    expect(p.actual?.orden).toBe(2);
    expect(p.ultimo).toBe(false);
    expect(puedeFirmarPaso(p.actual, "subr", [])).toBe(true);
    expect(puedeFirmarPaso(p.actual, "depto", [])).toBe(false);
    expect(accionesDisponibles(ctx({ responsablePaso: true, ultimoPaso: false }))).toEqual(["DEVOLVER", "FIRMAR"]);
  });
  it("después firma y emite el jefe de departamento; nadie se adelanta", () => {
    const firmas = [{ orden: 1, usuarioId: "metro", accion: "ELABORA" }, { orden: 2, usuarioId: "jefe", accion: "FIRMA" }];
    const p = pasoPendiente(pasos, firmas);
    expect(p.actual?.orden).toBe(3);
    expect(p.ultimo).toBe(true);
    expect(accionesDisponibles(ctx({ estado: "en_firma", responsablePaso: true, ultimoPaso: true }))).toEqual(["DEVOLVER", "EMITIR"]);
    expect(motivoRechazo("EMITIR", ctx({ estado: "en_firma", responsablePaso: false, ultimoPaso: true }))).toMatch(/no le corresponde/i);
  });
  it("quien ya firmó como jefe no firma otro paso si hay otros responsables", () => {
    const pasoDoble = { ...pasos[2], responsables: [{ usuarioId: "jefe", nombre: "J", via: "asignacion" }, { usuarioId: "depto", nombre: "D", via: "titular" }] };
    expect(puedeFirmarPaso(pasoDoble, "jefe", [{ orden: 2, usuarioId: "jefe", accion: "FIRMA" }])).toBe(false);
    expect(puedeFirmarPaso({ ...pasoDoble, responsables: [pasoDoble.responsables[0]] }, "jefe", [{ orden: 2, usuarioId: "jefe", accion: "FIRMA" }])).toBe(true);
  });
  it("metrólogo no habilitado para la magnitud: no envía", () => {
    expect(motivoRechazo("ENVIAR", { estado: "borrador", esAutor: true, puedeCrear: true, puedeEmitir: false, calculada: true, habilitacion: "No figura en el registro" }))
      .toMatch(/registro/);
  });
  it("paso obligatorio sin responsables: se avisa; uno opcional sin responsables se omite", () => {
    const sin = pasos.map((p) => (p.orden === 3 ? { ...p, responsables: [] } : p));
    expect(pasosSinResponsable(sin)[0]).toMatch(/Paso 3/);
    const opc = pasos.map((p) => (p.orden === 3 ? { ...p, responsables: [], obligatorio: false } : p));
    expect(pasoPendiente(opc, [{ orden: 1, usuarioId: "m", accion: "ELABORA" }]).ultimo).toBe(true);
  });
  it("reemisión: solo de un emitido, con permiso y si no hay otra en curso; el reemplazado no admite nada", () => {
    const e = ctx({ estado: "emitida" });
    expect(accionesDisponibles(e)).toEqual(["REEMITIR"]);
    expect(motivoRechazo("REEMITIR", { ...e, reemisionEnCurso: true })).toMatch(/en curso/);
    expect(motivoRechazo("REEMITIR", { ...e, puedeEmitir: false })).toMatch(/permiso/);
    expect(accionesDisponibles(ctx({ estado: "reemplazada" }))).toEqual([]);
  });
});

describe("Revisión r3 · la firma ELABORA no cuenta como otro paso y sin matriz no se envía", () => {
  const jefeLab: PasoFirmaCal = { orden: 1, accion: "FIRMA", obligatorio: true, rol: { codigo: "JEFE_LAB", nombre: "Jefe de laboratorio" }, unidad: { codigo: "LMT" },
    responsables: [{ usuarioId: "jefe", nombre: "J", via: "titular" }] };
  const jefeDepto: PasoFirmaCal = { orden: 2, accion: "FIRMA", obligatorio: true, rol: { codigo: "JEFE_DEPTO", nombre: "Jefe de departamento" }, unidad: { codigo: "DSA" },
    responsables: [{ usuarioId: "depto", nombre: "D", via: "titular" }] };

  it("matriz sin ELABORA cuyo primer paso es el jefe (orden 1): tras enviar sigue pendiente el jefe, no el departamento", () => {
    const pasos = [jefeLab, jefeDepto];
    const elabora = pasoPendiente(pasos, []).elabora;
    expect(ordenElabora(elabora)).toBe(0);
    // Aunque una firma ELABORA antigua hubiera quedado con orden 1, no da por firmado el paso del jefe.
    for (const orden of [ordenElabora(elabora), 1]) {
      const p = pasoPendiente(pasos, [{ orden, usuarioId: "metro", accion: "ELABORA" }]);
      expect(p.actual?.rol.codigo).toBe("JEFE_LAB");
      expect(p.ultimo).toBe(false);
    }
  });
  it("dos pasos con el mismo orden y distinta acción se firman por separado", () => {
    const p = pasoPendiente([jefeLab, { ...jefeDepto, orden: 1, accion: "APRUEBA" }], [{ orden: 1, usuarioId: "jefe", accion: "FIRMA" }]);
    expect(p.actual?.accion).toBe("APRUEBA");
    expect(p.ultimo).toBe(true);
  });
  it("con ELABORA en la matriz se registra en su orden", () => {
    const elab: PasoFirmaCal = { ...jefeLab, orden: 1, accion: "ELABORA", rol: { codigo: "METROLOGO", nombre: "Metrólogo" }, responsables: [] };
    expect(ordenElabora(pasoPendiente([elab, { ...jefeLab, orden: 2 }], []).elabora)).toBe(1);
  });
  it("no se envía si la matriz falla, no existe o no tiene pasos de firma después del ELABORA", () => {
    expect(motivoNoEnviable([], "tabla inexistente")).toMatch(/no se pudo resolver/);
    expect(motivoNoEnviable(null)).toMatch(/no hay matriz/);
    expect(motivoNoEnviable([{ ...jefeLab, accion: "ELABORA", responsables: [] }])).toMatch(/ningún paso de firma/);
    expect(motivoNoEnviable([jefeLab, { ...jefeDepto, responsables: [] }])).toMatch(/Paso 2/);
    expect(motivoNoEnviable([jefeLab, jefeDepto])).toBeNull();
  });
});
