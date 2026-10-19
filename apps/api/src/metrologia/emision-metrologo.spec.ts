import { NodoUnidad, construirArbol } from "../rbac/alcance";
import { ReglaFirma, resolverFirmas } from "../rbac/firmas-resolver";
import { motivoRechazo, pasoPendiente, puedeFirmarPaso, type PasoFirmaCal } from "./metrologia.flujo";
import { motivoNoEmiteMetrologo, type Firmante } from "./metrologia.reglas";

/**
 * Emisión del Certificado de Calibración por el metrólogo habilitado (decisión
 * provisional del 18-10-2026, pendiente de confirmar con el IDIC): responsable
 * ALTERNATIVO del paso de emisión en la matriz de firmas.
 */
const N = (id: string, padreId: string | null, tipo: string): NodoUnidad => ({ id, padreId, codigo: id, nombre: `Unidad ${id}`, tipo });
const arbol = construirArbol([
  N("DIR", null, "DIRECCION"),
  N("DSA", "DIR", "DEPARTAMENTO"),
  N("SAM", "DSA", "SECCION"),
  N("LMT", "SAM", "LABORATORIO"),
]);
const ROL = {
  METROLOGO: { id: "r-met", codigo: "METROLOGO", nombre: "Metrólogo", nivel: "OPERATIVO", alcance: "UNIDAD" },
  JEFE_LAB: { id: "r-jl", codigo: "JEFE_LAB", nombre: "Jefe de Laboratorio", nivel: "JEFATURA", alcance: "UNIDAD" },
  JEFE_DEPTO: { id: "r-jd", codigo: "JEFE_DEPTO", nombre: "Jefe de Departamento", nivel: "JEFATURA", alcance: "DESCENDENCIA" },
};
const regla = (orden: number, accion: string, rol: keyof typeof ROL, nivel: string, extra: Partial<ReglaFirma> = {}): ReglaFirma => ({
  id: `ff-${orden}`, tipoDocumento: "CERTIFICADO_CALIBRACION", unidadId: "SAM", orden, accion, rolId: ROL[rol].id, nivelUnidad: nivel,
  unidadDestinoId: null, obligatorio: true, activo: true, descripcion: null, rol: ROL[rol], ...extra,
});
const jefes = [
  { unidadId: "LMT", usuarioId: "jefe-lmt", nombre: "RMM", rol: "titular" },
  { unidadId: "DSA", usuarioId: "jefe-dsa", nombre: "PRE", rol: "titular" },
];
const tenencias = [
  { usuarioId: "met-1", nombre: "LSV", rolCodigo: "METROLOGO", unidadId: "LMT" },
  { usuarioId: "met-2", nombre: "ABG", rolCodigo: "METROLOGO", unidadId: "LMT" },
];

function resolver(conAlternativo: boolean) {
  const reglas = [
    regla(1, "ELABORA", "METROLOGO", "MISMA"),
    regla(2, "FIRMA", "JEFE_LAB", "MISMA"),
    regla(3, "FIRMA", "JEFE_DEPTO", "DEPARTAMENTO", conAlternativo ? { rolAlternativo: ROL.METROLOGO, nivelUnidadAlternativo: "MISMA" } : {}),
  ];
  return resolverFirmas({ tipoDocumento: "CERTIFICADO_CALIBRACION", unidadId: "LMT", reglas, arbol, jefes, tenencias });
}
const aPasos = (r: ReturnType<typeof resolver>): PasoFirmaCal[] =>
  r.pasos.map((p) => ({ ...p, alternativo: p.alternativo ? { rol: p.alternativo.rol } : null }));

const registro: Firmante[] = [
  { iniciales: "LSV", funcion: "METROLOGO", magnitudes: ["MASA"], laboratorios: ["LMT"], usuarioId: "met-1", activo: true } as any,
  { iniciales: "ABG", funcion: "METROLOGO", magnitudes: ["LONGITUD"], laboratorios: ["LMT"], usuarioId: "met-2", activo: true } as any,
];

describe("matriz de firmas · responsable alternativo del paso", () => {
  it("con alternativo, el paso de emisión suma a los metrólogos del laboratorio con vía «alternativo»", () => {
    const p3 = resolver(true).pasos.find((p) => p.orden === 3)!;
    expect(p3.responsables.map((r) => `${r.usuarioId}:${r.via}`)).toEqual(["jefe-dsa:titular", "met-1:alternativo", "met-2:alternativo"]);
    expect(p3.alternativo?.rol.codigo).toBe("METROLOGO");
    expect(p3.alternativo?.unidad?.codigo).toBe("LMT");
  });
  it("sin alternativo (quitado en la matriz) solo firma el Jefe de Departamento", () => {
    const p3 = resolver(false).pasos.find((p) => p.orden === 3)!;
    expect(p3.responsables.map((r) => r.usuarioId)).toEqual(["jefe-dsa"]);
    expect(p3.alternativo).toBeNull();
  });
  it("el paso del Jefe LMT no cambia: los metrólogos no lo firman", () => {
    const p2 = resolver(true).pasos.find((p) => p.orden === 2)!;
    expect(p2.responsables.map((r) => r.usuarioId)).toEqual(["jefe-lmt"]);
  });
});

describe("metrología · el metrólogo habilitado emite", () => {
  const pasos = aPasos(resolver(true));
  const elabora = [{ orden: 1, usuarioId: "met-1", accion: "ELABORA" }];
  const revisada = [...elabora, { orden: 2, usuarioId: "jefe-lmt", accion: "FIRMA" }];

  it("nadie emite sin la revisión previa del Jefe LMT: el paso pendiente es el del jefe", () => {
    const p = pasoPendiente(pasos, elabora);
    expect(p.actual?.orden).toBe(2);
    expect(puedeFirmarPaso(p.actual, "met-1", elabora, null)).toBe(false);
    expect(puedeFirmarPaso(p.actual, "met-2", elabora, null)).toBe(false);
  });

  it("revisada por el Jefe LMT: el metrólogo habilitado para la magnitud emite; el no habilitado no", () => {
    const p = pasoPendiente(pasos, revisada);
    expect(p.actual?.orden).toBe(3);
    expect(p.ultimo).toBe(true);
    const habMasa1 = motivoNoEmiteMetrologo(registro, "met-1", "LMT", "MASA");
    const habMasa2 = motivoNoEmiteMetrologo(registro, "met-2", "LMT", "MASA");
    expect(habMasa1).toBeNull();
    expect(habMasa2).toMatch(/registro de firmas autorizadas para la magnitud «MASA»/);
    expect(puedeFirmarPaso(p.actual, "met-1", revisada, habMasa1)).toBe(true);
    expect(puedeFirmarPaso(p.actual, "met-2", revisada, habMasa2)).toBe(false);
    // El Jefe de Departamento sigue pudiendo.
    expect(puedeFirmarPaso(p.actual, "jefe-dsa", revisada, null)).toBe(true);
  });

  it("una magnitud que el registro no declara no habilita a nadie para emitir", () => {
    expect(motivoNoEmiteMetrologo(registro, "met-1", "LNF", "FUERZA")).not.toBeNull();
    expect(motivoNoEmiteMetrologo([{ ...registro[0], activo: false } as any], "met-1", "LMT", "MASA")).not.toBeNull();
  });

  it("el rechazo explica la falta de habilitación", () => {
    const m = motivoRechazo("EMITIR", {
      estado: "en_firma", esAutor: false, puedeCrear: true, puedeEmitir: false, calculada: true,
      responsablePaso: false, ultimoPaso: true, motivoPaso: "Para emitir como metrólogo debe figurar en el registro…",
    });
    expect(m).toMatch(/Para emitir como metrólogo/);
  });
});
