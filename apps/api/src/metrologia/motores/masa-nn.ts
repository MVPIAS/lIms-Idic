/**
 * Motor ITM03 · masas no normalizadas por comparación (ciclos p-m-m-p), OIML R111.
 * Reproduce la planilla LMT-PG01-P01-ITM03-FORM01 Rev. 00, caso real M-3947
 * (juego de 4 pesos muertos, 100 a 475 g): cada ítem es una «Tabla de
 * resultados» del libro; el certificado toma la masa convencional y la
 * incertidumbre ASIGNADA por clase (no la calculada, como en ITM01).
 *
 * Opciones (desactivadas = planilla):
 *   corr    (M6)  densidad del aire con T, HR y P corregidas por los certificados del termohigrómetro y barómetro
 *   avgRho  (M7)  corrección por empuje con la densidad del aire promedio (la planilla usa la inicial)
 *   ucMg    (M10) incertidumbre por empuje convertida a mg también en el primer ítem (la planilla no lo hace)
 *   uRegla  (C5)  nominal no normalizado: U asignada con el nominal OIML inmediatamente superior
 *                 (la planilla la deja «--» y el metrólogo la escribe a mano)
 */
import { mean, stdev, xr, type Datos, type Opciones } from "./util";

/** Columnas de la tabla de EMP de la planilla (N1:X1), en el mismo orden. */
export const CLASES_ITM03 = ["Sin Clase", "M3", "M2-3", "M2", "M1-2", "M1", "F2", "F1", "E2", "E1"] as const;
/** Tabla de errores máximos permitidos (mg) de la planilla, filas N2:X25 (vacío = la clase no existe para ese nominal). */
export const EMP_ITM03: Record<string, (number | null)[]> = {
  "1 mg": [0.3, null, null, null, null, 0.2, 0.06, 0.02, 0.006, 0.003],
  "2 mg": [0.3, null, null, null, null, 0.2, 0.06, 0.02, 0.006, 0.003],
  "5 mg": [0.3, null, null, null, null, 0.2, 0.06, 0.02, 0.006, 0.003],
  "10 mg": [0.3, null, null, null, null, 0.25, 0.08, 0.025, 0.008, 0.003],
  "20 mg": [0.4, null, null, null, null, 0.3, 0.1, 0.03, 0.01, 0.003],
  "50 mg": [0.5, null, null, null, null, 0.4, 0.12, 0.04, 0.012, 0.004],
  "100 mg": [3, null, null, 1.6, null, 0.5, 0.16, 0.05, 0.016, 0.005],
  "200 mg": [3, null, null, 2, null, 0.6, 0.2, 0.06, 0.02, 0.006],
  "500 mg": [3, null, null, 2.5, null, 0.8, 0.25, 0.08, 0.025, 0.008],
  "1 g": [20, 10, null, 3, null, 1, 0.3, 0.1, 0.03, 0.01],
  "2 g": [20, 12, null, 4, null, 1.2, 0.4, 0.12, 0.04, 0.012],
  "5 g": [20, 16, null, 5, null, 1.6, 0.5, 0.16, 0.05, 0.016],
  "10 g": [35, 20, null, 6, null, 2, 0.6, 0.2, 0.06, 0.02],
  "20 g": [35, 25, null, 8, null, 2.5, 0.8, 0.25, 0.08, 0.025],
  "50 g": [35, 30, null, 10, null, 3, 1, 0.3, 0.1, 0.03],
  "100 g": [300, 50, null, 16, null, 5, 1.6, 0.5, 0.16, 0.05],
  "200 g": [300, 100, null, 30, null, 10, 3, 1, 0.3, 0.1],
  "500 g": [300, 250, null, 80, null, 25, 8, 2.5, 0.8, 0.25],
  "1 kg": [3000, 500, null, 160, null, 50, 16, 5, 1.6, 0.5],
  "2 kg": [3000, 1000, null, 300, null, 100, 30, 10, 3, 1],
  "5 kg": [3000, 2500, null, 800, null, 250, 80, 25, 8, 2.5],
  "10 kg": [30000, 5000, null, 1600, null, 500, 160, 50, 16, 5],
  "20 kg": [30000, 10000, null, 3000, null, 1000, 300, 100, 30, 10],
  "50 kg": [30000, 25000, 16000, 8000, 5000, 2500, 800, 250, 80, 25],
};
/** Densidades OIML R111 Tabla B.7 (kg/m³) → incertidumbre k = 1 (kg/m³). Búsqueda exacta: la primera coincidencia (como BUSCARV). */
export const DENSIDADES_ITM03: [number, number][] = [
  [21400, 75], [8600, 85], [8400, 85], [7950, 70], [8000, 70], [7700, 100], [7800, 100], [7100, 300], [2700, 65],
];
/** Comparadores de la planilla (G19:L23): resolución y repetibilidad en mg, decimales de redondeo de la lectura en mg. */
export const COMPARADORES_ITM03: Record<string, { res: number; rep: number; red: number }> = {
  XP6U: { res: 0.0001, rep: 0, red: 4 }, AT21: { res: 0.001, rep: 4e-6, red: 3 }, AT1005: { res: 0.01, rep: 1e-5, red: 2 },
  PR5003: { res: 1, rep: 0.00048, red: 1 }, KA50: { res: 10, rep: 0, red: 0 },
};

const factorMg = (u: string) => (u === "kg" ? 1e6 : u === "mg" ? 1 : 1000);
/** Etiqueta de nominal de la tabla de EMP («100 g», «1 kg»…). */
export const etiquetaNominal = (nom: number, unidad: string) => `${String(nom).replace(".", ",")} ${unidad}`;
/** Nominal OIML normalizado igual o inmediatamente superior (en mg), o null si excede la tabla. */
export function nominalSuperior(nomMg: number): string | null {
  const filas = Object.keys(EMP_ITM03).map((k) => {
    const [n, u] = k.split(" ");
    return { k, mg: Number(n) * factorMg(u) };
  });
  return filas.find((f) => f.mg >= nomMg - 1e-9)?.k ?? null;
}
/** EMP de la tabla para un nominal y una columna (null si no existe o vacía). */
function emp(nominal: string, col: number): number | null {
  const fila = EMP_ITM03[nominal];
  return fila && col >= 0 && col < fila.length ? fila[col] : null;
}

/** Densidad del aire CIPM simplificada de la planilla (kg/m³). */
const rhoAire = (t: number, h: number, p: number) => ((0.34848 * p) - ((0.009 * h) * Math.exp(0.061 * t))) / (273.15 + t);
const uDensidad = (rho: number) => DENSIDADES_ITM03.find(([r]) => r === rho)?.[1];

export function calcularITM03(d: Datos, opt: Opciones = {}) {
  const items: any[] = (d.items ?? []).filter((it: any) => it && it.nom != null && Array.isArray(it.L) && it.L.some((x: any) => typeof x === "number"));
  if (!items.length) throw new Error("Registre al menos un ítem con sus lecturas p-m-m-p");
  const th = d.termohig ?? {}, br = d.barometro ?? {};
  const rho0 = d.rho0 ?? 1.2, rhoAl = d.rhoAl ?? 1.2, dec = d.dec ?? 3;
  const comps = { ...COMPARADORES_ITM03, ...(d.comparadores ?? {}) };
  const R34 = (th.uT ?? 0) / 2, R35 = (th.uH ?? 0) / 2, R36 = (br.u ?? 0) / 2;

  const rows = items.map((it: any, idx: number) => {
    const comp = comps[it.comparador];
    if (!comp) throw new Error(`Comparador desconocido: ${it.comparador ?? "(vacío)"}`);
    const unidad = it.unidad || "g";
    const pat = it.patron ?? {};
    const rhoT = it.rhoItem, rhoR = pat.rho;
    if (!rhoT || !rhoR) throw new Error(`Ítem ${it.id ?? ""}: indique la densidad del ítem y la del patrón`);
    const T = opt.corr ? it.T.map((x: number) => x - (th.corrT ?? 0)) : it.T;
    const H = opt.corr ? it.H.map((x: number) => x - (th.corrH ?? 0)) : it.H;
    const P = opt.corr ? it.P.map((x: number) => x - (br.corr ?? 0)) : it.P;
    const H24 = rhoAire(T[0], H[0], P[0]), I24 = rhoAire(T[1], H[1], P[1]), J24 = mean([H24, I24]);
    const raC = opt.avgRho ? J24 : H24;
    const H25 = (raC - rho0) * ((1 / rhoT) - (1 / rhoR));
    const L27 = Math.sqrt((0.004 ** 2) * R34 ** 2 + (0.001 ** 2) * R36 ** 2 + (0.009 ** 2) * (R35 / 100) ** 2 + 0.00024 ** 2) * J24;
    // Lecturas en g → mg redondeadas a los decimales del comparador (C34:C57).
    const L: number[] = it.L.map((x: any) => (typeof x === "number" ? x : 0));
    const C = L.map((x) => xr(x * 1000, comp.red));
    const ciclos: { m: number; p: number; dI: number }[] = [];
    for (let k = 0; k + 3 < C.length; k += 4) {
      const m = mean([C[k + 1], C[k + 2]]), p = mean([C[k + 3], C[k]]);
      ciclos.push({ m, p, dI: m - p });
    }
    if (!ciclos.length) throw new Error(`Ítem ${it.id ?? ""}: se necesita al menos un ciclo p-m-m-p completo`);
    const F58 = mean(ciclos.map((c) => c.dI));
    const F59 = ciclos.length > 1 ? stdev(ciclos.map((c) => c.dI)) : 0;
    const K26 = Number(pat.dmp ?? 0) + (pat.extra ?? []).reduce((s: number, x: any) => s + Number(x.dmp ?? 0), 0);
    const K27 = Math.sqrt([pat.Up ?? 0, ...(pat.extra ?? []).map((x: any) => x.Up ?? 0)].reduce((s: number, x: number) => s + x * x, 0));
    const nomRmg = pat.nom * factorMg(unidad), nomTmg = it.nom * factorMg(unidad);
    const H34 = (nomRmg + K26) * (1 + H25) + F58; // masa convencional (mg)
    const J58 = H34 - nomTmg; // desviación del nominal (mg)
    const H28 = it.urt ?? uDensidad(rhoT), J28 = it.urr ?? uDensidad(rhoR);
    if (H28 == null || J28 == null) throw new Error(`Ítem ${it.id ?? ""}: densidad sin incertidumbre en la tabla OIML R111 B.7 (indíquela)`);
    const E19 = pat.nom; // la planilla usa el nominal del patrón en su unidad (g)
    const B97 = (E19 * ((rhoR - rhoT) / (rhoR * rhoT)) * L27) ** 2;
    const C97 = (E19 * (raC - rho0)) ** 2 * ((H28 ** 2) / (rhoT ** 4));
    const D97 = E19 ** 2 * (raC - rhoAl) * ((raC - rhoAl) - 2 * (rhoAl - rhoAl)) * ((J28 ** 2) / (rhoR ** 4));
    const F97 = Math.sqrt(B97 + C97 + D97);
    const K87 = K27 / 2;
    const I88 = Math.sqrt(ciclos.length);
    const K88 = F59 / I88;
    const K89 = (comp.res / 2 / Math.sqrt(3)) * Math.SQRT2;
    // u(C) a mg: la primera «Tabla de resultados» de la planilla multiplica por L79 (= 1 con la masa
    // informada en g) y las demás por F98 (= 1000 para g). Opción `ucMg`: F98 en todos los ítems.
    const F98 = factorMg(unidad);
    const K90 = F97 * (idx === 0 && !opt.ucMg ? 1 : F98);
    const der = Number(pat.deriva ?? 0);
    const K91 = der / Math.sqrt(3);
    const K93 = Math.sqrt(K87 ** 2 + K88 ** 2 + K89 ** 2 + K90 ** 2 + K91 ** 2), K94 = 2 * K93;
    // Masa convencional informada (L77), en la unidad del ítem.
    const L77 = unidad === "kg" ? xr(it.nom * 1000 + J58 / 1000, dec) : unidad === "mg" ? xr((it.nom + J58) / 1000, dec) : xr(it.nom + J58 / 1000, dec);
    // Clase y U asignada: J79 = EMP de la clase declarada; J80 = dos columnas más a la derecha (planilla).
    const nominal = etiquetaNominal(it.nom, unidad);
    const col = CLASES_ITM03.indexOf(it.clase);
    const J79 = col >= 0 ? emp(nominal, col) : null;
    const J80 = col >= 0 ? emp(nominal, col + 2) : null;
    let uAsig: number | null = J80;
    let origenU = "tabla";
    if (uAsig == null) {
      const sup = opt.uRegla ? nominalSuperior(nomTmg) : null;
      if (sup && col >= 0 && emp(sup, col + 2) != null) { uAsig = emp(sup, col + 2); origenU = `regla (${sup})`; }
      else if (it.uAsignadaManual != null && it.uAsignadaManual !== "") { uAsig = Number(it.uAsignadaManual); origenU = "manual"; }
      else throw new Error(`Ítem ${it.id ?? it.nom}: nominal no normalizado (${nominal}); indique la U asignada (en la planilla se escribe a mano)`);
    }
    if (uAsig == null) throw new Error(`Ítem ${it.id ?? it.nom}: sin U asignada`);
    const certU = uAsig >= 100 ? `${(uAsig / 1000).toFixed(2).replace(".", ",")} g` : `${Math.round(uAsig)} mg`;
    // Clase OIML a la que llega la desviación (informativa; el LMT no evalúa conformidad).
    let claseObtenida = "--";
    for (let c = 0; c < CLASES_ITM03.length; c++) { const e = emp(nominal, c); if (e != null && e >= Math.abs(J58)) claseObtenida = CLASES_ITM03[c]; }
    return {
      id: it.id, nom: it.nom, unidad, nominal, C, ciclos, F58, F59, H24, I24, J24, H25, L27, H28, J28, K26, K27, H34, J58,
      B97, C97, D97, F97, K87, K88, K89, K90, K91, I88, K93, K94, L77, J79, J80, uAsig, origenU, certU, claseObtenida, fecha: it.fecha ?? null,
    };
  });

  // Condiciones del certificado: promedio de todas las lecturas (> 0) menos el error del instrumento (Y5:Y7).
  const pos = (a: number[]) => a.filter((x) => typeof x === "number" && x > 0);
  const tW = mean(pos(items.flatMap((i: any) => i.T))), hW = mean(pos(items.flatMap((i: any) => i.H))), pW = mean(pos(items.flatMap((i: any) => i.P)));
  const Y5 = tW + ((th.corrT ?? 0) * -1), Y6 = hW + ((th.corrH ?? 0) * -1), Y7 = xr(pW + ((br.corr ?? 0) * -1), 1);
  const fechas = rows.map((r) => r.fecha).filter(Boolean).sort();
  return {
    rows, Y5, Y6, Y7, tU: th.uT ?? null, hU: th.uH ?? null, pU: br.u ?? null,
    fechaCalibracion: fechas.at(-1) ?? null,
  };
}
