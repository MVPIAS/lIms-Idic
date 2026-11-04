import { condicionValida, erroresParaGuardar, erroresParaPublicar, type PasoDiseno, type TransicionDiseno } from "./validar-flujo";
import { elegirTransicion } from "./flujo.service";

const P = (tmpId: string, tipo: string, actividad = tmpId, slaMinutos?: number | null): PasoDiseno => ({ tmpId, tipo, actividad, slaMinutos });
const T = (origenTmp: string, destinoTmp: string, condicion?: string): TransicionDiseno => ({ origenTmp, destinoTmp, condicion });

// Como el FLU-QUI sembrado: lineal hasta una decisión con dos FIN.
const pasos = [P("p1", "INICIO"), P("p2", "ACTIVIDAD", "Análisis", 1440), P("dec", "DECISION", "¿Cumple?"), P("ok", "FIN"), P("nc", "FIN")];
const trans = [T("p1", "p2"), T("p2", "dec"), T("dec", "ok", "cumple == true"), T("dec", "nc")];

describe("validar-flujo (Diseñador de flujos)", () => {
  it("un flujo bien formado no tiene errores", () => {
    expect(erroresParaGuardar(pasos, trans)).toEqual([]);
    expect(erroresParaPublicar(pasos, trans)).toEqual([]);
  });

  it("guardar exige un INICIO, algún FIN y transiciones entre pasos existentes", () => {
    expect(erroresParaGuardar([], [])).toEqual(["El flujo no tiene pasos."]);
    expect(erroresParaGuardar([P("a", "ACTIVIDAD")], []).join(" ")).toMatch(/exactamente un paso INICIO.*al menos un paso FIN/);
    expect(erroresParaGuardar(pasos, [...trans, T("p2", "x")]).join(" ")).toContain("paso que no existe");
    expect(erroresParaGuardar([...pasos, P("p9", "RARO")], trans).join(" ")).toContain("Tipo de paso inválido");
    expect(erroresParaGuardar([P("p1", "INICIO", "x", -5), P("f", "FIN")], []).join(" ")).toContain("plazo");
  });

  it("se puede guardar a medio diseñar, pero no publicar", () => {
    const incompleto = [P("p1", "INICIO"), P("p2", "ACTIVIDAD"), P("f", "FIN")];
    expect(erroresParaGuardar(incompleto, [T("p1", "p2")])).toEqual([]);
    const e = erroresParaPublicar(incompleto, [T("p1", "p2")]).join(" ");
    expect(e).toContain("«p2» no tiene salida");
    expect(e).toContain("no se alcanza desde el INICIO");
  });

  it("decisión con un solo camino, FIN con salida y condiciones mal escritas", () => {
    const e = erroresParaPublicar(pasos, [T("p1", "p2"), T("p2", "dec"), T("dec", "ok", "cumple es verdad"), T("ok", "nc")]).join(" ");
    expect(e).toContain("necesita al menos dos caminos");
    expect(e).toContain("no puede tener transiciones de salida");
    expect(e).toContain("no se entiende");
  });

  it("condiciones", () => {
    expect(condicionValida("cumple == true")).toBe(true);
    expect(condicionValida("monto > 1000000 && moneda == 'CLP' || urgente == true")).toBe(true);
    expect(condicionValida("cumple")).toBe(false);
  });

  it("en una decisión gana la condición verdadera aunque el camino por defecto esté antes", () => {
    const sal = [
      { condicion: null, destino: "nc" },
      { condicion: "cumple == true", destino: "ok" },
    ];
    expect(elegirTransicion(sal, { cumple: true })?.destino).toBe("ok");
    expect(elegirTransicion(sal, { cumple: false })?.destino).toBe("nc");
    expect(elegirTransicion([], {})).toBeNull();
  });
});
