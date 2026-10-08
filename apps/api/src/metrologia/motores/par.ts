/**
 * Motor de PAR TORSIONAL · ISO 6789-2, validado contra el Excel real del LMT.
 *   ITPT01 · llave de torque (caso PT-0090) → 86/86 valores idénticos
 * Agrega la conformidad ISO 6789-1 que el Excel no evalúa (hallazgo PT1).
 */
import { mean, nums, stdev, xr, type Datos, type Opciones } from "./util";

/** Opción `derSet` (PT3/T4): usa la deriva del transductor usado en cada punto. */
export function calcularITPT01(d: Datos, opt: Opciones = {}) {
  const S3 = Math.sqrt(3), F = d.F21;
  const cor = (x: number, c: number[]) => (c[0] + c[1] * x + c[2] * x ** 2 + c[3] * x ** 3) * F;
  const avgF = (a: unknown[]) => xr(mean(nums(a)) * F, 3);
  const repC: number[] = d.rep.map(avgF), G61 = xr(Math.max(...repC) - Math.min(...repC), 3);
  const J60 = avgF(d.lp[0]), L60 = avgF(d.lp[1]), M61 = xr(J60 - L60, 3);
  const geoC: number[] = d.geo.map(avgF), itfC: number[] = d.itf.map(avgF);
  const rg = Math.max(...geoC) - Math.min(...geoC), ri = Math.max(...itfC) - Math.min(...itfC);
  const I83 = rg <= 0.000001 ? null : rg, O83 = ri <= 0.000001 ? null : ri;
  const derMax = Math.max(...d.der), cmcMax = Math.max(...d.cmc);
  const rows = d.pts.map((p: any) => {
    const c = p.curve === 1 ? d.c1 : d.c2, v = nums(p.s).map((x) => cor(x, c));
    const G = xr(mean(v), 3), H = xr(p.nom - G, 3), I = mean(v.map((x) => (p.nom - x) / G * 100)), J = xr(stdev(v), 3);
    const Dw = p.WP / 2, E = (opt.derSet ? d.der[p.curve - 1] : derMax) / S3, Fw = Dw;
    const Gr = xr(d.type === "Digital" ? ((p.res * 0.5) / S3 * (100 / G) * 2) : ((p.res * 0.5) / S3 * (100 / G)), 3);
    const Hr = (G61 * 0.5) / S3 * (100 / G), Io = I83 == null ? 0 : (I83 * 0.5) / S3 * (100 / G);
    const Ji = ((O83 as number) * 0.5) / S3 * (100 / G), Kl = (M61 * 0.5) / S3 * (100 / G), Lr = J / Math.sqrt(5) * (100 / G);
    const M = Math.sqrt(E * E + Fw * Fw + Gr * Gr + Hr * Hr + Io * Io + Ji * Ji + Kl * Kl + Lr * Lr), N = cmcMax <= M * 2 ? M * 2 : cmcMax;
    const as = Math.abs(I), Wp = as + N + 0;
    const tol = p.nom / F <= 10 ? 6 : 4; // ISO 6789-1 tipo II clase A: ±4 % (±6 % hasta 10 N·m)
    return { nom: p.nom, Nm: p.nom / F, curve: p.curve, v, G, H, I, J, D: Dw, E, F: Fw, Gr, Hr, Io, Ji, Kl, Lr, M, N, as, Wp, tol, ok: Wp <= tol, okErr: as <= tol };
  });
  const tn = nums(d.temp);
  return { rows, repC, G61, J60, L60, M61, geoC, itfC, I83, O83, M10: xr(mean(tn), 1), M11: xr(mean(nums(d.hum)), 1) };
}
