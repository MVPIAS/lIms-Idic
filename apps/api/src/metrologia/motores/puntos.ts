/**
 * Formulario ESTÁNDAR de calibración por puntos (comparación directa con un patrón).
 *
 * Para las magnitudes sin planilla ni instrucción entregada por el IDIC
 * (eléctrica ITME01, tiempo y frecuencia ITE03) y como reserva para cualquier
 * magnitud sin motor propio. La lista de precios describe el servicio como
 * «3 series, puntos según corresponda, comparación con calibrador
 * multipropósito / multímetro patrón / contador de tiempo patrón». No hay
 * caso real que validar: es un cálculo GUM estándar, declarado como tal.
 *
 * Por punto, con n series (por defecto 3):
 *   eⱼ   = lectura del instrumento − lectura del patrón
 *   ē    = promedio de eⱼ                              (error del punto)
 *   u_A  = s(eⱼ) / √n                                  (tipo A, repetibilidad de las series)
 *   u_p  = U_patrón / k_patrón                         (tipo B, certificado del patrón)
 *   u_r  = d / (2·√3)                                  (tipo B, resolución; solo si se informa)
 *   u_c  = √(u_A² + u_p² + u_r²)
 *   U    = k · u_c, con k = 2                          (≈ 95 %)
 *   Veredicto (solo si hay tolerancia/EMP):
 *     regla «con_u»  (por defecto): CUMPLE si |ē| + U ≤ EMP
 *     regla «simple»:                CUMPLE si |ē| ≤ EMP
 */
import { mean, stdev, type Datos, type Opciones } from "./util";

export const K_PUNTOS = 2;
export const FORMULA_PUNTOS = [
  "eⱼ = lectura del instrumento − lectura del patrón",
  "ē = promedio de las n diferencias (error del punto)",
  "u_A = s(eⱼ) / √n  (tipo A)",
  "u_p = U_patrón / k_patrón  (tipo B, certificado del patrón)",
  "u_r = d / (2·√3)  (tipo B, resolución; solo si se informa)",
  "u_c = √(u_A² + u_p² + u_r²)",
  "U = k · u_c, con k = 2",
  "Veredicto (solo con tolerancia): |ē| + U ≤ EMP (o |ē| ≤ EMP con la regla simple)",
];

const esNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const vacia = (p: any) => !esNum(p?.nominal) && ![...(p?.inst ?? []), ...(p?.pat ?? [])].some(esNum);

export function calcularPuntos(d: Datos, _opt: Opciones = {}) {
  const n: number = esNum(d.series) && d.series >= 2 ? Math.floor(d.series) : 3;
  const kPat: number = esNum(d.kPatron) && d.kPatron > 0 ? d.kPatron : 2;
  const regla: "con_u" | "simple" = d.regla === "simple" ? "simple" : "con_u";
  const pts: any[] = (d.pts ?? []).filter((p: any) => !vacia(p));
  if (!pts.length) throw new Error("Registre al menos un punto de calibración");

  const rows = pts.map((p: any, i: number) => {
    const etiqueta = `punto ${i + 1}${esNum(p.nominal) ? ` (${p.nominal}${p.unidad ? " " + p.unidad : ""})` : ""}`;
    if (!esNum(p.nominal)) throw new Error(`Falta el valor nominal del ${etiqueta}`);
    const inst = (p.inst ?? []).slice(0, n), pat = (p.pat ?? []).slice(0, n);
    if (inst.length < n || pat.length < n || ![...inst, ...pat].every(esNum))
      throw new Error(`Faltan lecturas en el ${etiqueta}: se requieren ${n} series del instrumento y del patrón`);
    if (!esNum(p.Upat) || p.Upat < 0) throw new Error(`Falta la incertidumbre del patrón (U, k=${kPat}) en el ${etiqueta}`);
    const e = inst.map((x: number, j: number) => x - pat[j]);
    const err = mean(e), s = stdev(e);
    const uA = s / Math.sqrt(n), uP = p.Upat / kPat, uR = esNum(p.res) && p.res > 0 ? p.res / (2 * Math.sqrt(3)) : 0;
    const uc = Math.sqrt(uA * uA + uP * uP + uR * uR), U = K_PUNTOS * uc;
    const emp = esNum(p.emp) && p.emp > 0 ? p.emp : null;
    const conforme = emp == null ? null : regla === "simple" ? Math.abs(err) <= emp : Math.abs(err) + U <= emp;
    return {
      nom: p.nominal, unidad: p.unidad || d.unidad || "", funcion: p.funcion ?? "",
      mInst: mean(inst), mPat: mean(pat), e, err, s, uA, uP, uR, uc, U, emp, conforme,
    };
  });
  return { rows, n, k: K_PUNTOS, kPatron: kPat, regla, formula: FORMULA_PUNTOS };
}
