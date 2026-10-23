import {
  decidirFirma,
  esOficial,
  esVigente,
  faltantesParaEmitir,
  numeroVersion,
  pasoFirmablePor,
  pasosActuales,
  pasosDesdeMatriz,
  puedeTransitarDocumento,
  quedaOficial,
  tipoDocumentoDePlantilla,
  tipoDocumentoPorDefecto,
  mensajePasoSinResponsables,
} from "./reglas-emision";
import type { ResolucionFirmas } from "../rbac/firmas-resolver";

describe("reglas-emision · tipo de documento por plantilla", () => {
  it("corresponde los tipos de plantilla con la matriz", () => {
    expect(tipoDocumentoDePlantilla("I.ENSAYO")).toBe("INFORME_ENSAYO");
    expect(tipoDocumentoDePlantilla("certificado")).toBe("INFORME_ENSAYO");
    expect(tipoDocumentoDePlantilla("IVC")).toBe("IVC");
    expect(tipoDocumentoDePlantilla("I.TECNICO")).toBe("INFORME_TECNICO");
    expect(tipoDocumentoDePlantilla(null)).toBe("INFORME_ENSAYO");
  });
});

describe("reglas-emision · resultados aprobados", () => {
  it("permite emitir si todos los resultados están aprobados", () => {
    expect(faltantesParaEmitir([{ estado: "aprobado" }, { estado: "aprobado" }], "I.ENSAYO")).toEqual([]);
  });

  it("bloquea y explica qué falta si hay resultados sin aprobar", () => {
    const f = faltantesParaEmitir(
      [
        { estado: "aprobado", muestra: "M-1", analito: "pH" },
        { estado: "capturado", muestra: "M-1", analito: "Cobre" },
        { estado: "revisado_n1", muestra: "M-2", analito: "Plomo" },
        { estado: "devuelto", muestra: "M-2", analito: "Zinc" },
      ],
      "I.ENSAYO",
    );
    expect(f).toHaveLength(2);
    expect(f[0]).toContain("3 de 4");
    expect(f[0]).toContain("1 capturado");
    expect(f[0]).toContain("1 revisado, sin aprobar");
    expect(f[1]).toContain("M-1 · Cobre");
    expect(f[1]).toContain("M-2 · Plomo");
  });

  it("acorta la lista de pendientes cuando son muchos", () => {
    const muchos = Array.from({ length: 12 }, (_, i) => ({ estado: "capturado", muestra: `M-${i}`, analito: "pH" }));
    expect(faltantesParaEmitir(muchos, "I.ENSAYO")[1]).toContain("y 4 más");
  });

  it("sin resultados bloquea, salvo en el informe técnico", () => {
    expect(faltantesParaEmitir([], "I.ENSAYO")[0]).toContain("no tiene resultados");
    expect(faltantesParaEmitir([], "I.TECNICO")).toEqual([]);
  });
});

const resolucion = (pasos: any[], origen: ResolucionFirmas["origen"] = "DEFECTO"): ResolucionFirmas => ({
  tipoDocumento: "INFORME_ENSAYO",
  unidad: { id: "u1", codigo: "LQC", nombre: "Lab", tipo: "LABORATORIO" },
  origen,
  unidadRegla: null,
  pasos,
});
const pasoMatriz = (orden: number, responsables: any[], obligatorio = true) => ({
  id: `r${orden}`,
  orden,
  accion: orden === 1 ? "REVISA" : "FIRMA",
  obligatorio,
  descripcion: null,
  nivelUnidad: "MISMA",
  rol: { id: `rol${orden}`, codigo: orden === 1 ? "REVISOR" : "JEFE_LAB", nombre: orden === 1 ? "Revisor" : "Jefe de Laboratorio" },
  unidad: { id: "u1", codigo: "LQC", nombre: "Lab", tipo: "LABORATORIO" },
  responsables,
  advertencia: responsables.length ? null : "Nadie tiene el rol en LQC",
});

describe("reglas-emision · pasos desde la matriz", () => {
  it("convierte los pasos resueltos con sus responsables", () => {
    const r = pasosDesdeMatriz(
      resolucion([
        pasoMatriz(1, [{ usuarioId: "a", nombre: "Ana", via: "asignacion" }]),
        pasoMatriz(2, [{ usuarioId: "j", nombre: "Juan", via: "titular" }]),
      ]),
    );
    expect(r.errores).toEqual([]);
    expect(r.pasos.map((p) => [p.orden, p.rolCodigo, p.responsables[0].usuarioId])).toEqual([
      [1, "REVISOR", "a"],
      [2, "JEFE_LAB", "j"],
    ]);
  });

  it("un paso obligatorio sin responsables impide emitir; uno opcional se omite", () => {
    const r = pasosDesdeMatriz(
      resolucion([pasoMatriz(1, []), pasoMatriz(2, [], false), pasoMatriz(3, [{ usuarioId: "j", nombre: "J", via: "titular" }])]),
    );
    expect(r.errores).toHaveLength(1);
    expect(r.errores[0]).toContain("Paso 1");
    expect(r.pasos.map((p) => p.orden)).toEqual([3]);
  });

  it("sin reglas para el tipo de documento no se puede emitir", () => {
    const r = pasosDesdeMatriz(resolucion([], "SIN_REGLAS"));
    expect(r.errores[0]).toContain("no tiene reglas");
  });
});

const p = (id: string, orden: number, estado: string, resp: string[], firmadoPor: string | null = null) => ({
  id,
  orden,
  estado,
  firmadoPor,
  accion: "FIRMA",
  rolNombre: "Rol",
  responsables: resp.map((u) => ({ usuarioId: u, nombre: u.toUpperCase() })),
});

describe("reglas-emision · avance del circuito", () => {
  const pasos = [p("1", 1, "firmado", ["rev"], "rev"), p("2", 2, "pendiente", ["jefe", "sub"]), p("3", 3, "pendiente", ["depto"])];

  it("el paso actual es el pendiente de menor orden", () => {
    expect(pasosActuales(pasos).map((x) => x.id)).toEqual(["2"]);
  });

  it("los pasos con el mismo orden se firman en paralelo", () => {
    const par = [p("a", 1, "pendiente", ["x"]), p("b", 1, "pendiente", ["y"]), p("c", 2, "pendiente", ["z"])];
    expect(pasosActuales(par).map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("titular o subrogante pueden firmar el paso actual; nadie se adelanta", () => {
    expect(pasoFirmablePor(pasos, "jefe")?.id).toBe("2");
    expect(pasoFirmablePor(pasos, "sub")?.id).toBe("2");
    expect(pasoFirmablePor(pasos, "depto")).toBeNull();
    expect(decidirFirma(pasos, "depto").motivo).toContain("No le corresponde");
    expect(decidirFirma(pasos, "depto").motivo).toContain("JEFE o SUB");
  });

  it("separación de funciones: quien ya firmó no firma otro paso si hay otro responsable", () => {
    const x = [p("1", 1, "firmado", ["jefe"], "jefe"), p("2", 2, "pendiente", ["jefe", "otro"])];
    expect(decidirFirma(x, "jefe").paso).toBeNull();
    expect(decidirFirma(x, "jefe").motivo).toContain("ya firmó");
    expect(decidirFirma(x, "otro").paso?.id).toBe("2");
    // único responsable posible: puede firmar (si no, el documento quedaría bloqueado)
    const y = [p("1", 1, "firmado", ["jefe"], "jefe"), p("2", 2, "pendiente", ["jefe"])];
    expect(decidirFirma(y, "jefe").paso?.id).toBe("2");
  });

  it("el documento queda oficial cuando firma el último paso", () => {
    expect(quedaOficial(pasos, "2")).toBe(false);
    const casi = [p("1", 1, "firmado", ["a"]), p("2", 2, "pendiente", ["b"])];
    expect(quedaOficial(casi, "2")).toBe(true);
  });
});

describe("reglas-emision · estados del documento", () => {
  it("oficial y emitido (previo al circuito) valen; en firma cuenta como vigente", () => {
    expect(esOficial("oficial")).toBe(true);
    expect(esOficial("emitido")).toBe(true);
    expect(esOficial("en_firma")).toBe(false);
    expect(esVigente("en_firma")).toBe(true);
    expect(esVigente("anulado")).toBe(false);
    expect(esVigente("devuelto")).toBe(false);
  });

  it("un documento oficial no vuelve atrás: solo se anula", () => {
    expect(puedeTransitarDocumento("en_firma", "oficial")).toBe(true);
    expect(puedeTransitarDocumento("en_firma", "devuelto")).toBe(true);
    expect(puedeTransitarDocumento("oficial", "anulado")).toBe(true);
    expect(puedeTransitarDocumento("oficial", "en_firma")).toBe(false);
    expect(puedeTransitarDocumento("oficial", "devuelto")).toBe(false);
    expect(puedeTransitarDocumento("anulado", "oficial")).toBe(false);
  });

  it("la reemisión conserva el número con sufijo de versión", () => {
    expect(numeroVersion("CERT-2026-0007", 2)).toBe("CERT-2026-0007-V2");
    expect(numeroVersion("CERT-2026-0007-V2", 3)).toBe("CERT-2026-0007-V3");
    expect(numeroVersion("CERT-2026-0007", 1)).toBe("CERT-2026-0007");
  });
});

describe("tipo de documento por defecto según la unidad de la OT", () => {
  it("lo indicado por quien emite manda", () => {
    expect(tipoDocumentoPorDefecto({ indicado: "INFORME_TECNICO", tipoPlantilla: "BOLETIN", tipoUnidad: "INFORME_INSPECCION" }))
      .toEqual({ tipo: "INFORME_TECNICO", origen: "indicado" });
  });
  it("en BPCH, sucursales y D11 una plantilla genérica emite informe de inspección", () => {
    expect(tipoDocumentoPorDefecto({ tipoPlantilla: "BOLETIN", tipoUnidad: "INFORME_INSPECCION" }))
      .toEqual({ tipo: "INFORME_INSPECCION", origen: "unidad" });
    expect(tipoDocumentoPorDefecto({ tipoPlantilla: "I.ENSAYO", tipoUnidad: "INFORME_INSPECCION" }).tipo).toBe("INFORME_INSPECCION");
  });
  it("las plantillas de tipo propio (IVC, informe técnico) no cambian con la unidad", () => {
    expect(tipoDocumentoPorDefecto({ tipoPlantilla: "IVC", tipoUnidad: "INFORME_INSPECCION" })).toEqual({ tipo: "IVC", origen: "plantilla" });
    expect(tipoDocumentoPorDefecto({ tipoPlantilla: "i.tecnico", tipoUnidad: "INFORME_INSPECCION" }).tipo).toBe("INFORME_TECNICO");
  });
  it("B-022: «Automático» toma el tipo guardado en la plantilla (SCCII, SCCCC, CERTARMA)", () => {
    expect(tipoDocumentoPorDefecto({ tipoPlantilla: "I.TECNICO", repid: "SCCII", tipoDePlantilla: "INFORME_INSPECCION", tipoUnidad: "INFORME_INSPECCION" }))
      .toEqual({ tipo: "INFORME_INSPECCION", origen: "plantilla" });
    expect(tipoDocumentoPorDefecto({ tipoPlantilla: "CERTIFICADO", repid: "SCCCC", tipoDePlantilla: "CERTIFICADO_CONFORMIDAD", tipoUnidad: "INFORME_INSPECCION" }).tipo)
      .toBe("CERTIFICADO_CONFORMIDAD");
    expect(tipoDocumentoPorDefecto({ tipoPlantilla: "CERTIFICADO", repid: "CERTARMA", tipoDePlantilla: "CERTIFICADO_ARMA", tipoUnidad: "INFORME_INSPECCION" }).tipo)
      .toBe("CERTIFICADO_ARMA");
    // Lo indicado por quien emite sigue mandando.
    expect(tipoDocumentoPorDefecto({ indicado: "INFORME_TECNICO", tipoDePlantilla: "INFORME_INSPECCION" }).origen).toBe("indicado");
  });
  it("sin tipo en la unidad sale de la plantilla (laboratorios)", () => {
    expect(tipoDocumentoPorDefecto({ tipoPlantilla: "BOLETIN", tipoUnidad: null })).toEqual({ tipo: "INFORME_ENSAYO", origen: "plantilla" });
  });
  it("el mensaje de un paso sin firmantes dice cuál, dónde y cómo resolverlo", () => {
    const m = mensajePasoSinResponsables(
      { orden: 1, accion: "REVISA", rol: { nombre: "Revisor" }, unidad: { codigo: "SSTGO" }, advertencia: "Nadie tiene el rol REVISOR en SSTGO" },
      "INFORME_ENSAYO",
    );
    expect(m).toContain("Paso 1 de la matriz de «Informe de ensayo»");
    expect(m).toContain("nadie tiene el rol «Revisor» en SSTGO");
    expect(m).toContain("Administración › Usuarios");
    expect(m).toContain("Matriz de firmas");
    expect(m).toContain("otro tipo de documento");
    const sinUnidad = mensajePasoSinResponsables(
      { orden: 3, accion: "OFICIALIZA", rol: { nombre: "Jefe de departamento" }, unidad: null, advertencia: "No se encontró una unidad de nivel DEPARTAMENTO para X" },
      "INFORME_INSPECCION",
    );
    expect(sinUnidad).toContain("Informe de inspección");
    expect(sinUnidad).toContain("Administración › Estructura");
  });
});

describe("no se emite con resultados sin veredicto (D02-03)", () => {
  it("aprobado pero «Pendiente» bloquea la emisión con el detalle", () => {
    const f = faltantesParaEmitir(
      [{ estado: "aprobado", veredicto: "cumple" }, { estado: "aprobado", veredicto: "pendiente", muestra: "OT-1-M1", analito: "Recuento E. coli" }],
      "I.ENSAYO",
    );
    expect(f.join(" ")).toMatch(/1 resultado\(s\) sin veredicto.*OT-1-M1 · Recuento E. coli/);
    expect(faltantesParaEmitir([{ estado: "aprobado", veredicto: "informativo" }], "I.ENSAYO")).toEqual([]);
  });
});
