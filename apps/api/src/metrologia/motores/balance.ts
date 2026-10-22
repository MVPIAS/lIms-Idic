/**
 * Balance de incertidumbre POR PUNTO de cada motor (EP-04 P5.2, pestaña 4 de la
 * maqueta): componente, fórmula, distribución, divisor, uᵢ y aporte uᵢ²/uc².
 *
 * NO recalcula nada: lee los términos que el motor ya dejó en su resultado (las
 * mismas columnas de la planilla del laboratorio) y, donde la planilla no los
 * guarda por separado (ITL06, ITL07, ITV05), los rearma con las mismas fórmulas y
 * las mismas entradas. La prueba balance.spec.ts exige que √Σuᵢ² sea la uc del
 * motor en todos los casos reales (16 del LMT, M-3947, V-5920 y LCPNF-010.26): el
 * balance es una vista del cálculo validado, nunca otro cálculo.
 *
 * Los motores no cambian: este módulo solo se usa al mostrar la ficha.
 */
import type { Datos, Opciones } from "./util";
import { REGISTRO_MOTORES } from "./index";

export type Distribucion = "normal" | "rectangular" | "triangular" | "tipo A" | "combinada" | "fija";

export interface ComponenteBalance {
  /** Símbolo corto (u_p, u_rep…). */
  simbolo: string;
  nombre: string;
  /** Fórmula de la planilla, legible. */
  formula: string;
  distribucion: Distribucion;
  /** Divisor de la distribución, como texto («2», «√3», «2√3»…); «—» si el término ya viene combinado. */
  divisor: string;
  /** Incertidumbre estándar del componente, en la unidad de la incertidumbre del motor (siempre ≥ 0). */
  ui: number;
  /** Aporte uᵢ²/uc² en % (se completa al armar el punto). */
  aporte: number;
}

export interface BalancePunto {
  indice: number;
  nominal: number | null;
  componentes: ComponenteBalance[];
  /** √Σuᵢ² (lo que suma el balance). */
  uc: number;
  /** uc que informa el motor (debe coincidir con `uc`). */
  ucMotor: number;
  k: number;
  /** U = k·uc calculada (antes de la CMC y del redondeo del certificado). */
  U: number;
}

export interface BalanceCalibracion {
  motor: string;
  /** Unidad de uᵢ, uc y U («%» en fuerza, par y LNF). */
  unidad: string;
  /** Unidad del valor nominal de cada punto. */
  unidadNominal: string;
  puntos: BalancePunto[];
}

const R3 = "√3", R2R3 = "2√3";
const c = (simbolo: string, nombre: string, formula: string, distribucion: Distribucion, divisor: string, ui: number): ComponenteBalance =>
  ({ simbolo, nombre, formula, distribucion, divisor, ui: Math.abs(Number(ui)), aporte: 0 });

type Fila = { nominal: number | null; comps: ComponenteBalance[]; ucMotor: number; k?: number };

function armar(f: Fila, i: number, kDef = 2): BalancePunto {
  const comps = f.comps.filter((x) => Number.isFinite(x.ui));
  const uc = Math.sqrt(comps.reduce((s, x) => s + x.ui * x.ui, 0));
  const k = f.k ?? kDef;
  return {
    indice: i, nominal: f.nominal,
    componentes: comps.map((x) => ({ ...x, aporte: uc > 0 ? (x.ui * x.ui) / (uc * uc) * 100 : 0 })),
    uc, ucMotor: f.ucMotor, k, U: k * uc,
  };
}

/** Componentes de cada motor a partir de su resultado y sus entradas. */
function filas(motor: string, R: any, D: Datos, opt: Opciones): Fila[] | null {
  const rows: any[] = R?.rows ?? [];
  switch (motor) {
    case "ITM02":
      return rows.map((r) => ({
        nominal: r.nom, ucMotor: r.M,
        comps: [
          c("u_p", "Masa patrón (certificado)", "U_patrón / 2", "normal", "2", r.F),
          c("u_rep", "Repetibilidad de la indicación", "s / √5", "tipo A", "√5", r.G),
          c("u_d", "Resolución de la balanza", "d / (2√3)", "rectangular", R2R3, r.H),
          c("u_exc", "Excentricidad", "Δ excentricidad máx. / (2√3)", "rectangular", R2R3, r.I),
          c("u_0", "Retorno a cero", "Δ cero / (2√3)", "rectangular", R2R3, r.J),
          c("u_der", "Deriva del patrón", "deriva / (2√3)", "rectangular", R2R3, r.K),
        ],
      }));
    case "ITM01":
      return [{
        nominal: Number(D.nomT) * 1000, ucMotor: R.uc,
        comps: [
          c("u_p", "Masa patrón (certificado)", "U_patrón / 2", "normal", "2", R.uP),
          c("u_ΔI", "Diferencia de indicación (ciclos p-m-m-p)", "s(ΔI) / √n", "tipo A", "√n", R.uI),
          c("u_d", "Resolución del comparador", "d / (2√3)", "rectangular", R2R3, R.ud),
          c("u_b", "Corrección por empuje del aire", "√(u²(ρa) + u²(ρt) + u²(ρr))", "combinada", "—", R.uC),
          c("u_der", "Deriva del patrón", "deriva / √3", "rectangular", R3, R.uD),
        ],
      }];
    case "ITM03":
      return rows.map((r) => ({
        nominal: r.nom, ucMotor: r.K93,
        comps: [
          c("u_p", "Masa patrón (certificado)", "U_patrón / 2", "normal", "2", r.K87),
          c("u_ΔI", "Diferencia de indicación (ciclos p-m-m-p)", "s(ΔI) / √n", "tipo A", "√n", r.K88),
          c("u_d", "Resolución del comparador", "d / (2√3) · √2", "rectangular", R2R3, r.K89),
          c("u_b", "Corrección por empuje del aire", "√(B97 + C97 + D97) en mg", "combinada", "—", r.K90),
          c("u_der", "Deriva del patrón", "deriva / √3", "rectangular", R3, r.K91),
        ],
      }));
    case "ITP02":
      return rows.map((r) => ({
        nominal: r.C ?? r.nom, ucMotor: r.K,
        comps: [
          c("u_p", "Manómetro patrón (certificado)", "U_patrón / 2", "normal", "2", r.J / 2),
          c("u_res", "Resolución del instrumento", "√(⅓·d²)", "rectangular", R3, r.G),
          c("u_0", "Error de cero", "f₀ / (2√3)", "rectangular", R2R3, r.H),
          c("u_h", "Histéresis", "h / (2√3)", "rectangular", R2R3, r.I),
          c("u_Δh", "Diferencia de altura", "(ρ − ρa)·g·Δh", "rectangular", opt.dh ? R3 : "1", R.uDh),
          c("u_der", "Deriva del patrón", "deriva / √3", "rectangular", R3, R.uder),
          c("u_resP", "Resolución del patrón", "res_patrón / √3 (análogo) · √12 (digital)", "rectangular", "√3 · √12", R.uresP),
        ],
      }));
    case "ITP01":
      return rows.map((r) => ({
        nominal: r.nom, ucMotor: r.Gc,
        comps: [
          c("u_p", "Balanza de pesos muertos (presión generada)", "máx(U_rel·p, U_mín) / 2", "normal", "2", r.Fp / 2),
          c("u_Δh", "Diferencia de altura", "(ρ − ρa)·g·u_h", "rectangular", "2", r.uA),
          c("u_rep", "Reproducibilidad entre series", "b / (2√3)", "rectangular", R2R3, r.uB),
          c("u_h", "Histéresis", "h / (2√3)", "rectangular", R2R3, r.uC),
          c("u_0", "Error de cero", "f₀ / (2√3)", "rectangular", R2R3, r.uD),
          c("u_res", "Resolución del instrumento", "d / √3", "rectangular", R3, r.uE),
          c("u_der", "Deriva del patrón", "deriva / (2√3)", "rectangular", R2R3, R.uder),
        ],
      }));
    case "ITL01":
      return rows.map((r) => ({
        nominal: r.nom, ucMotor: r.I,
        comps: [
          c("u_p", "Bloques patrón (certificado)", "U_patrón / 2", "normal", "2", R.Up / 2),
          c("u_rep", "Repetibilidad", "s / √3", "tipo A", R3, r.G),
          c("u_t", "Diferencia de temperatura", "L·α·ΔT / √3", "rectangular", R3, r.uDt),
          c("u_res", "Resolución", "d / (2√3) o d / √3", "rectangular", "2√3 · √3", R.ures),
          c("u_par", "Paralelismo de las caras", "Δ / (2√3)", "rectangular", R2R3, R.uep),
          c("u_plx", "Error de paralaje", "e / √3", "rectangular", R3, R.upar),
          c("u_der", "Deriva del patrón", "deriva / √3", "rectangular", R3, R.uder),
        ],
      }));
    case "ITL02":
      return rows.map((r) => ({
        nominal: r.nom, ucMotor: r.K,
        comps: [
          c("u_p", "Bloques patrón (certificado)", "U_patrón / 2", "normal", "2", R.Up / 2),
          c("u_t", "Diferencia de temperatura", "L·α·ΔT / √3", "rectangular", R3, r.uDt),
          c("u_rep", "Repetibilidad", "s / √3", "tipo A", R3, r.J),
          c("u_res", "Resolución", "d / (2√3)", "rectangular", R2R3, R.ures),
          c("u_par", "Paralelismo de las caras", "Δ / (2√3)", "rectangular", R2R3, R.uep),
          c("u_pla", "Planitud de las caras", "Δ / (2√3)", "rectangular", R2R3, R.upla),
          c("u_plx", "Error de paralaje", "e / √3", "rectangular", R3, R.upar),
          ...(opt.der ? [c("u_der", "Deriva del patrón", "deriva / √3", "rectangular", R3, R.uder)] : []),
        ],
      }));
    case "ITL06":
      return rows.map((r) => ({
        nominal: r.nom, ucMotor: r.K,
        comps: [
          c("u_p", "Patrón (certificado)", "U_patrón / 2", "normal", "2", Number(D.pU) / 2),
          c("u_t", "Diferencia de temperatura", "L·α·ΔT / √3", "rectangular", R3, r.uDt),
          c("u_rep", "Repetibilidad (una medición por punto)", "valor fijo de la planilla", "fija", "—", r.J),
          c("u_res", "Resolución", "d / (2√3)", "rectangular", R2R3, R.ures),
          c("u_al", "Alineación", "(a / 2) / √3", "rectangular", R3, R.ualin),
          c("u_der", "Deriva del patrón", "deriva / √3", "rectangular", R3, R.uder),
        ],
      }));
    case "ITL07":
      return rows.map((r) => ({
        nominal: r.nom, ucMotor: r.I,
        comps: [
          c("u_p", "Patrón (certificado)", "U_patrón / 2", "normal", "2", r.D / 2),
          c("u_t", "Diferencia de temperatura", "L·α·ΔT / √3", "rectangular", R3, r.uDt),
          ...(r.emp == null ? [] : [c("u_emp", "Empalmes de tramos de 3 m", opt.sqrt ? "(a/2)·√k / √3" : "(a/2)·k / √3", "rectangular", R3, r.emp)]),
          c("u_p2", "Segundo patrón (certificado)", "U_patrón2 / 2", "normal", "2", R.up2),
          c("u_rep", "Repetibilidad (una medición por punto)", "valor fijo de la planilla", "fija", "—", 0.00000000000000001 / 2),
          c("u_res", "Resolución", "d / (2√3)", "rectangular", R2R3, R.ures),
          ...(opt.full ? [
            c("u_al", "Alineación (primer tramo)", "(a / 2) / √3", "rectangular", R3, R.ualin * (r.sg === 0 ? 1 : 0)),
            c("u_der", "Deriva del patrón", "deriva / √3", "rectangular", R3, R.uder),
          ] : []),
        ],
      }));
    case "ITV02":
      return rows.map((r) => ({
        nominal: r.nom, ucMotor: r.L,
        comps: [
          c("u_m", "Masa medida (balanza: vacío, dispersión, calibración, resolución, deriva)", "√Σ(uᵢ·Z)²", "combinada", "—", r.AD47),
          c("u_ρw", "Densidad del agua", "√(u_T² + u_eq²) · ∂V/∂ρw", "combinada", "—", R.uW),
          c("u_ρa", "Densidad del aire", "u(ρa) · ∂V/∂ρa", "combinada", "—", R.uA),
          c("u_γ", "Coeficiente de dilatación del material", "u(γ) · ∂V/∂γ", "combinada", "—", R.AG61),
          c("u_tw", "Temperatura del agua", "u(tw) · ∂V/∂tw", "combinada", "—", R.AG63),
          c("u_men", R.grad ? "Resolución de la escala" : "Menisco (posición del aforo)", R.grad ? "d / (2√3)" : "π·(D/2)²·0,1 mm / √3", "rectangular", R.grad ? R2R3 : R3, R.AD65),
          c("u_ρB", "Densidad de las pesas", "u(ρB) · ∂V/∂ρB", "combinada", "—", R.AG67),
          c("u_rep", "Repetibilidad", "s / √n · Z", "tipo A", "√n", r.H * R.Z),
          c("u_ev", "Evaporación", "evaporación / √3 · Z", "rectangular", R3, (R.evap / Math.sqrt(3)) * R.Z),
          ...(opt.dRho ? [c("u_dρ", "Variación de la densidad del agua con la temperatura", "u(tw) · ∂V/∂ρw · dρw/dt", "combinada", "—", R.uTw_dens)] : []),
        ],
      }));
    case "ITV05": {
      const rB = D.rhoB ?? 8, urB = D.urhoB ?? 0.023, g = R.gamma, S3 = Math.sqrt(3);
      return rows.map((r) => {
        const m = r.G - R.F29, base = m * (1 / (R.rW - R.rA));
        return {
          nominal: r.nom, ucMotor: r.L,
          comps: [
            c("u_m", "Masa medida (balanza: vacío, dispersión, calibración, resolución, deriva)", "√Σ(uᵢ·Z)²", "combinada", "—", r.AD47),
            c("u_ρw", "Densidad del agua", "√(u_T² + u_eq²) · ∂V/∂ρw", "combinada", "—", r.uW),
            c("u_ρa", "Densidad del aire", "u(ρa) · ∂V/∂ρa", "combinada", "—", r.uA),
            c("u_γ", "Coeficiente de dilatación del material", "u(γ) · ∂V/∂γ", "combinada", "—", R.ugamma * (base * (1 - R.rA / rB) * (-(R.tW - 20)))),
            c("u_tw", "Temperatura del agua", "u(tw) · ∂V/∂tw", "combinada", "—", R.AD8 * (base * (1 - R.rA / rB) * (-g))),
            c("u_res", "Resolución del instrumento", "d / (2√3)", "rectangular", R2R3, Number(D.res) / 2 / S3),
            c("u_ρB", "Densidad de las pesas", "u(ρB) · ∂V/∂ρB", "combinada", "—", urB * (base * (1 - g * (R.tW - 20)) * (R.rA / (rB ** 2)))),
            c("u_rep", "Repetibilidad", "s / √n · Z", "tipo A", "√n", r.H * R.Z),
            c("u_ev", "Evaporación", "evaporación / √3 · Z", "rectangular", R3, (R.K55 / S3) * R.Z),
          ],
        };
      });
    }
    case "ITT01":
      return rows.map((r) => ({
        nominal: r.nom, ucMotor: r.M,
        comps: [
          c("u_p", "Termómetro patrón (certificado)", "U_patrón / 2", "normal", "2", r.K),
          c("u_rc", "Repetibilidad del calibrando", "s / √n", "tipo A", "√n", r.C),
          c("u_rp", "Repetibilidad del patrón", "s / √n", "tipo A", "√n", r.D),
          c("u_der", "Deriva del patrón", "deriva / (2√3)", "rectangular", R2R3, r.E),
          c("u_rad", "Uniformidad radial del medio", "Δ radial / √12", "rectangular", "√12", r.F),
          c("u_ax", "Uniformidad axial del medio", "Δ axial / √12", "rectangular", "√12", r.Gg),
          c("u_est", "Estabilidad del medio", "Δ estabilidad / √12", "rectangular", "√12", r.Hs),
          c("u_res", "Resolución del calibrando", "d / (2√3)", "rectangular", R2R3, r.Ir),
          c("u_if", "Diferencia entre lecturas inicial y final", "Δ / (2√3)", "rectangular", R2R3, r.L),
        ],
      }));
    case "ITT02":
      return rows.map((r) => ({
        nominal: r.nom, ucMotor: r.L,
        comps: [
          c("u_p", "Sistema patrón (certificado)", "U_patrón / 2", "normal", "2", r.G),
          c("u_rep", "Repetibilidad del calibrando", "s / √n", "tipo A", "√n", r.E),
          c("u_res", "Resolución del calibrando", "d / (2√3)", "rectangular", R2R3, r.F),
          c("u_der", "Deriva del patrón", "deriva / (2√3)", "rectangular", R2R3, r.H),
          c("u_grad", "Gradiente del medio", "gradiente / √3", "rectangular", R3, r.I),
          c("u_est", "Estabilidad del medio", "estabilidad / √3", "rectangular", R3, r.J),
        ],
      }));
    case "ITF01":
      return rows.map((r) => ({
        nominal: r.nom, ucMotor: r.Lc,
        comps: [
          c("u_p", "Transductor patrón (certificado)", "U_patrón / 2", "normal", "2", r.up),
          c("u_der", "Deriva del patrón", "deriva / √3", "rectangular", R3, r.uder),
          c("u_rep", "Repetibilidad", "s / √3 (relativa)", "tipo A", R3, r.G),
          c("u_res", "Resolución relativa", "a / (2√3)", "rectangular", R2R3, r.Ha),
          c("u_0", "Error de cero", "f₀ / (2√3)", "rectangular", R2R3, r.J),
        ],
      }));
    case "ITF03":
      return rows.map((r) => ({
        nominal: r.nom, ucMotor: r.P,
        comps: [
          c("u_p", "Pesas patrón (certificado)", "U_pesas / 2 (relativa)", "normal", "2", r.F),
          c("u_der", "Deriva de las pesas", "deriva relativa", "rectangular", "1", r.G),
          c("u_rep", "Repetibilidad", "s / √3 (relativa)", "tipo A", R3, r.Jb),
          c("u_res", "Resolución relativa", "a / (2√3)", "rectangular", R2R3, r.Ka),
          c("u_0", "Error de cero", "f₀ / (2√3)", "rectangular", R2R3, r.Mf),
        ],
      }));
    case "ITPT01":
      return rows.map((r) => ({
        nominal: r.nom, ucMotor: r.M,
        comps: [
          c("u_p", "Transductor patrón (certificado)", "W_patrón / 2", "normal", "2", r.F),
          c("u_der", "Deriva del transductor", "deriva / √3", "rectangular", R3, r.E),
          c("u_res", "Resolución de la llave", "r / (2√3) · 100 / X̄", "rectangular", R2R3, r.Gr),
          c("u_rep", "Repetibilidad", "s / √5 · 100 / X̄", "tipo A", "√5", r.Lr),
          c("u_rpr", "Reproducibilidad", "b_rep / (2√3) · 100 / X̄", "rectangular", R2R3, r.Hr),
          c("u_od", "Variación por la salida de la llave", "b_od / (2√3) · 100 / X̄", "rectangular", R2R3, r.Io),
          c("u_int", "Variación por la interfaz", "b_int / (2√3) · 100 / X̄", "rectangular", R2R3, r.Ji),
          c("u_l", "Variación por el punto de aplicación de la fuerza", "b_l / (2√3) · 100 / X̄", "rectangular", R2R3, r.Kl),
        ],
      }));
    case "LCPNF-IT01":
      return rows.map((r) => ({
        nominal: r.F, ucMotor: r.uc, k: r.k,
        comps: [
          c("u_rot", "Reproducibilidad (posiciones 0°, 120°, 240°)", "s / X̄ / √3", "tipo A", R3, r.urot),
          c("u_rep", "Repetibilidad sin rotación", "b′ / √3", "rectangular", R3, r.urep),
          c("u_int", "Interpolación", "fc", "rectangular", "1", r.uinp),
          c("u_res", "Resolución", "r / √6 / F", "triangular", "√6", r.ures),
          c("u_0", "Error de cero", "f₀ máx.", "rectangular", "1", R.f0max),
          c("u_p", "Patrón nacional (CMC)", "CMC / 2", "normal", "2", R.cmc / 2),
          c("u_fl", "Fluencia estimada", "máx(v / (3√3))", "rectangular", "3√3", R.ucreep),
        ],
      }));
    case "PUNTOS":
      return rows.map((r) => ({
        nominal: r.nom, ucMotor: r.uc,
        comps: [
          c("u_A", "Repetibilidad de las series (tipo A)", "s(eⱼ) / √n", "tipo A", "√n", r.uA),
          c("u_p", "Patrón (certificado)", "U_patrón / k_patrón", "normal", "k", r.uP),
          c("u_r", "Resolución del instrumento", "d / (2√3)", "rectangular", R2R3, r.uR),
        ],
      }));
  }
  return null;
}

/** Balance por punto de una calibración calculada con su motor; null si el motor no lo tiene o faltan datos. */
export function balancePorPunto(motor: string | null | undefined, resultado: any, datos: Datos | null | undefined, opciones: Opciones | null | undefined): BalanceCalibracion | null {
  if (!motor || !resultado) return null;
  const m = REGISTRO_MOTORES[motor];
  if (!m) return null;
  let fs: Fila[] | null;
  try {
    fs = filas(motor, resultado, datos ?? {}, opciones ?? {});
  } catch {
    return null;
  }
  if (!fs || !fs.length) return null;
  const fila0 = resultado.rows?.[0] ?? {};
  const unidad = motor === "PUNTOS" ? String(fila0.unidad ?? "") : m.unidadU;
  const unidadNominal = motor === "PUNTOS" || motor === "ITM03" ? String(fila0.unidad ?? "") : m.unidad;
  return { motor, unidad, unidadNominal, puntos: fs.map((f, i) => armar(f, i)) };
}
