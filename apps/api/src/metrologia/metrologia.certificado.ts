/**
 * Certificado de Calibración del LMT · plantilla oficial de N hojas, según las hojas
 * «Certificado» de los libros de trabajo del laboratorio y su respuesta del
 * 21-10-2026 (observaciones 1 a 12 sobre la maqueta; NCh 2451:2014).
 *
 *  Hoja 1   · membrete con «Página 1 de N» y logo de acreditado (si corresponde),
 *             número, línea «Laboratorio de Calibración [Acreditado] en la magnitud …»,
 *             «ESTE CERTIFICADO REEMPLAZA AL CERTIFICADO N° …» si procede, OT y fechas,
 *             instrumento, cliente, condiciones (con las propias de la IT), método,
 *             hasta 3 patrones y síntesis. Al pie: firmas del Jefe de Departamento y del
 *             Jefe de Laboratorio y los 5 textos legales.
 *  Hojas 2..N · la misma cabecera con «Página k de N», datos del ítem, tablas de
 *             resultados propias de la IT (partidas por filas si no caben), esquema si lo
 *             hay; al pie, firmas del Jefe de Laboratorio y del metrólogo.
 *  Última   · OBSERVACIONES (editables; por defecto los textos automáticos) y «Fin del
 *             certificado de calibración».
 *
 * Sin «cumple / no cumple» (C1, observación 11: el LMT no evalúa conformidad); en
 * fuerza, la clase. Un solo identificador: el número del certificado. El PDF lo arma
 * plantilla-render (pdf.renderer.ts) respetando los saltos y anclando el pie de cada hoja.
 */
import { REGISTRO_MOTORES, type ResumenMotor } from "./motores";
import { decimales2cs, u2cs } from "./metrologia.reglas";
import { formatoDe, type FormatoIT } from "./certificado/formato-it";
import {
  acreditacionEfectiva, lineaAcreditacion, leerPresentacion, observacionesAutomaticas, observacionesImpresas, type Presentacion,
} from "./certificado/presentacion";
import { altoObservaciones, paginar, type Bloque, type BloqueTabla } from "./certificado/paginacion";
import { UNIDAD_SI, lineaEquivalenciasSI } from "./certificado/equivalencias";
import { armarCertificadoLnf } from "./certificado/lnf";

/** Texto de un párrafo: no hace falta escapar las comillas (así se lee «"--" = No aplica» tal cual). */
const escTexto = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const NA = "--";
const v = (x: unknown) => (x == null || String(x).trim() === "" ? NA : esc(x));
const fx = (x: any, d: number) => (x == null || x === "" || isNaN(Number(x)) ? NA : Number(x).toLocaleString("es-CL", { minimumFractionDigits: d, maximumFractionDigits: d }));
const fg = (x: any, d = 6) => (x == null || x === "" || isNaN(Number(x)) ? NA : Number(x).toLocaleString("es-CL", { maximumFractionDigits: d }));
/** Fecha DATE (sin hora) o AAAA-MM-DD → dd-mm-aaaa. */
const dia = (x: any) => {
  if (!x) return NA;
  const s = x instanceof Date ? x.toISOString().slice(0, 10) : String(x).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}` : esc(s);
};
const fechaHora = (x: any) => (x ? new Date(x).toLocaleString("es-CL", { timeZone: "America/Santiago", dateStyle: "short", timeStyle: "short" }) : "");
/** U con dos cifras significativas (C12), escrita con sus decimales. */
const u2 = (U: number | null | undefined) => {
  const r = u2cs(U ?? null);
  return r == null ? NA : fx(r, decimales2cs(r));
};
/** Decimales de la resolución (0,05 → 2); por defecto `def`. */
function decDe(res: any, def = 4): number {
  const n = Number(String(res ?? "").replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return def;
  const s = String(n);
  if (s.includes("e-")) return Number(s.split("e-")[1]);
  return s.includes(".") ? s.split(".")[1].length : 0;
}

export const TEXTOS_LEGALES = [
  "Los patrones utilizados en la calibración cuentan con trazabilidad a patrones nacionales y/o internacionales, los que a su vez están referidos a patrones primarios de acuerdo al Sistema Internacional de Unidades (SI).",
  "El laboratorio de Calibración posee la competencia técnica y cumple con las exigencias de la norma NCh-ISO 17025 «Requisitos generales para la competencia de los Laboratorios de Ensayos y Calibración».",
  "Los resultados de la calibración están referidos solo al ítem calibrado, al momento y condiciones en las cuales fueron efectuadas las mediciones.",
  "Este Certificado de Calibración no puede ser reproducido total o parcialmente, excepto con el permiso del laboratorio emisor.",
  "El laboratorio no asume responsabilidades por los daños posteriores a la calibración, ocasionados por el mal empleo del instrumento.",
];
const LUGAR: Record<string, string> = {
  instalaciones: "La calibración se efectuó en nuestras instalaciones ubicadas en Av. Pedro Montt N° 2136, Santiago, Santiago.",
  cliente: "La calibración se llevó a cabo en las instalaciones del cliente.",
};

/** Firma de un paso del circuito, tal como se imprime (nombre, grado y cargo). */
export interface FirmaCert {
  accion: string; rol: string; nombre: string | null; grado?: string | null; cargo?: string | null;
  fecha?: string | Date | null; pendiente: boolean; via?: string | null;
}
/** Imagen que se imprime (data URL PNG/JPEG) con sus dimensiones en píxeles. */
export interface ImagenCert { src: string; ancho: number; alto: number }
export interface ContextoCertificado {
  /** Nombre del departamento (parámetro `certificado_calibracion.nombre_departamento`). */
  departamento: string;
  /** Firmas por papel: metrólogo (ELABORA), jefe del laboratorio y jefe del departamento. */
  metrologo: FirmaCert | null;
  jefeLab: FirmaCert | null;
  jefeDepto: FirmaCert | null;
  /** Número del certificado que este reemplaza (reemisión del LIMS). */
  reemplazaNumero?: string | null;
  /** Logo de acreditación configurado (Metrología › Configuración); sin él, solo el texto. */
  logo?: ImagenCert | null;
  /** Esquema o imagen de la calibración (el del proceso o uno propio), con su título. */
  esquema?: (ImagenCert & { titulo: string }) | null;
}

/** Cargo impreso: el del papel en el certificado (el del departamento sale del parámetro), con (S) si firma el subrogante. */
function firmaCelda(f: FirmaCert | null, cargoDefecto: string): string {
  if (!f) return `<td>${esc(cargoDefecto)}<br>Sin firmante en la matriz de firmas</td>`;
  const sub = f.via === "subrogante" ? " (S)" : "";
  const estado = f.pendiente ? "Pendiente de firma" : `Firmado electrónicamente el ${esc(fechaHora(f.fecha))}`;
  // Emisión por el metrólogo habilitado (responsable alternativo del paso en la matriz de firmas).
  const cargo = f.via === "alternativo" && !f.pendiente ? `${f.rol || "Metrólogo"} habilitado para la magnitud (emite)` : cargoDefecto + sub;
  return `<td><b>${esc(f.nombre ?? "")}</b><br>${f.grado ? ` · ${esc(f.grado)}<br>` : ""} · ${esc(cargo)}<br> · ${estado}</td>`;
}
const tablaFirmas = (izq: string, der: string) => `<table class="firmas-cert compacta"><tbody><tr>${izq}${der}</tr></tbody></table>`;

/* ------------------------------------------------------- tablas de la IT --- */
const tabla = (cabecera: string[], filas: string[][], titulo?: string): BloqueTabla => ({ tipo: "tabla", titulo, cabecera, filas });
const at = (a: any, i: number) => (Array.isArray(a) ? a[i] : undefined);

export interface ResultadosCert {
  bloques: Bloque[];
  /** Hay puntos fuera del alcance acreditado (se marcan «*» solo si el certificado sale acreditado). */
  fueraAlcance: boolean;
  sintesis: string;
}

/**
 * Tablas de resultados propias de cada instrucción de trabajo, con las columnas de la
 * hoja «Certificado» de su libro (observación 4). `acreditado` decide la marca «*».
 */
export function tablasResultados(cal: any, acreditado: boolean, fmt: FormatoIT = formatoDe(cal.proceso)): ResultadosCert {
  const r: ResumenMotor | null = cal.resumen ?? null;
  const R = cal.resultado ?? {};
  const D = cal.datos ?? {};
  const pr = r?.puntos ?? [];
  const rows: any[] = R.rows ?? [];
  const marca = (i: number) => (acreditado && (pr[i] as any)?.fueraAlcance ? " *" : "");
  const fuera = pr.some((p: any) => p.fueraAlcance);
  const uc = (i: number, U: number | null | undefined) => `${u2((pr[i] as any)?.uCertificado ?? U)}${marca(i)}`;
  const m = cal.motor ? REGISTRO_MOTORES[cal.motor] : null;
  const unidad = cal.unidad ?? m?.unidad ?? "";
  const mayor = (us: (number | null | undefined)[]) => u2(Math.max(...us.filter((x): x is number => x != null && Number.isFinite(x))));
  const sintesisU = (U: string, u: string) =>
    `La mayor incertidumbre encontrada para ${fmt.sujeto}, considerando que se efectúe la corrección respectiva, es de ± ${U} ${u}, para un nivel de confianza del 95 %.`;
  const mayorU = () => mayor(pr.map((p: any) => p.uCertificado ?? p.Ucert ?? p.U));
  const dec = decDe(D.res ?? D.div ?? cal.instrumento?.res);

  switch (cal.motor) {
    case "ITM03":
      return {
        bloques: [tabla(["Ítem número", "Valor de masa convencional / g", "Incertidumbre expandida / mg", "Identificación del ítem"],
          rows.map((x, i) => [String(i + 1), fx(x.L77, 3), `${esc(String(x.certU).replace(/\s*mg$/, ""))}${marca(i)}`, v(x.id)]))],
        fueraAlcance: fuera,
        sintesis: "La incertidumbre asignada para cada masa del sistema de medición calibrado se presenta en la tabla de resultados.",
      };
    case "ITV05": {
      const U = rows.map((x, i) => u2cs(((pr[i] as any)?.uCertificado ?? x.M) * 1000));
      return {
        bloques: [tabla(["Volumen entregado / µL", "Volumen nominal / µL", "Error / µL", "Incertidumbre expandida / µL", "Inexactitud Et %", "Imprecisión CVt %"],
          rows.map((x, i) => [fx(x.cC, 2), fx(x.cD, 2), fx(x.cE, 2), `${fx(U[i], 2)}${marca(i)}`, fx(x.cG, 2), fx(x.cH, 2)]))],
        fueraAlcance: fuera,
        sintesis: sintesisU(fx(Math.max(...U.map((x) => x ?? 0)), 2), "µL"),
      };
    }
    case "ITM01": {
      const nomMg = Number(pr[0]?.nominal);
      const nom = !Number.isFinite(nomMg) ? NA : nomMg >= 1000 ? `${fg(nomMg / 1000, 3)} g` : `${fg(nomMg, 3)} mg`;
      const dev = Number(R.dev);
      const mc = Number.isFinite(dev) ? `${nom} ${dev < 0 ? "−" : "+"} ${fg(Math.abs(dev), 4)} mg` : nom;
      return {
        bloques: [tabla(["Ítem número", "Valor de masa convencional", "Incertidumbre expandida / mg", `Error máximo permisible para la clase ${D.cls ?? ""} / mg`.replace("  ", " "), "Identificación del ítem"],
          [["1", esc(mc), `${fg(R.asig, 3)}${marca(0)}`, fg(R.mpe, 3), v(cal.instrumento?.idEspecial)]])],
        fueraAlcance: fuera,
        sintesis: "La incertidumbre asignada para cada masa del sistema de medición calibrado se presenta en la tabla de resultados.",
      };
    }
    case "ITM02": {
      const bloques: Bloque[] = [tabla(["Valor nominal / g", "Indicación patrón / g", "Indicación instrumento / g", "Error / g", "Incertidumbre expandida / g", "Valor de repetibilidad / g"],
        rows.map((x, i) => [fg(x.nom, 4), fg(x.C, 6), fg(x.B, 5), fg(x.E, 6), uc(i, x.Uc), fg(x.sd, 6)]))];
      const ecc: number[] = Array.isArray(D.ecc) ? D.ecc : [];
      if (ecc.length) {
        const pos = ["A", "B", "C", "D", "E"].slice(0, ecc.length);
        bloques.push(tabla(["Posición", ...pos.map((p) => `Letra ${p}`)], [["Indicación / g", ...ecc.map((x) => fg(x, 5))]], "Valores de excentricidad"));
        bloques.push({ tipo: "fijo", alto: 20, html: `<p>Diferencia máxima de excentricidad: ${fg(R.eccmax, 5)} g</p>` });
      }
      return { bloques, fueraAlcance: fuera, sintesis: sintesisU(mayorU(), "g") };
    }
    case "ITV02": {
      const d = Number.isFinite(Number(D.dec)) ? Number(D.dec) : 2;
      return {
        bloques: [tabla([`Valor nominal / ${unidad}`, `Indicación patrón / ${unidad}`, `Indicación instrumento / ${unidad}`, `Error / ${unidad}`, `Incertidumbre expandida / ${unidad}`],
          rows.map((x, i) => [fg(x.nom, 4), fx(x.Dcert ?? x.I, d), fg(x.nom, 4), fx((x.Dcert ?? x.I) - x.nom, d), uc(i, x.Ucert ?? x.M)]))],
        fueraAlcance: fuera, sintesis: sintesisU(mayorU(), unidad),
      };
    }
    case "ITL01":
    case "ITL02": {
      const ins = cal.motor === "ITL01" ? "D" : "H", err = cal.motor === "ITL01" ? "E" : "I";
      return {
        bloques: [tabla(["Valor nominal / mm", "Indicación patrón / mm", "Indicación instrumento / mm", "Error / mm", "Incertidumbre expandida / mm"],
          rows.map((x, i) => [fg(x.nom, 4), fg(x.nom, 4), fx(x[ins], dec + 1), fx(x[err], dec + 1), uc(i, x.Uc ?? x.J ?? x.L)]))],
        fueraAlcance: fuera, sintesis: sintesisU(mayorU(), "mm"),
      };
    }
    case "ITL06":
      return {
        bloques: [tabla(["Valor nominal / mm", "Indicación patrón / mm", "Indicación instrumento / mm", "Error / mm", "Incertidumbre expandida / mm"],
          rows.map((x, i) => [fg(x.nom, 4), fx(x.H, dec + 2), fg(x.nom, 4), fx(x.I, dec + 2), uc(i, x.L)]))],
        fueraAlcance: fuera, sintesis: sintesisU(mayorU(), "mm"),
      };
    case "ITL07":
      return {
        bloques: [tabla(["Valor nominal / mm", "Indicación patrón / mm", "Indicación instrumento / mm", "Error / mm", "Incertidumbre expandida / mm"],
          rows.map((x, i) => [fg(x.nom, 1), fg(x.F, 2), fg(x.nom, 1), fg(x.Ecert, 2), uc(i, x.Ucert ?? x.J)]))],
        fueraAlcance: fuera, sintesis: sintesisU(mayorU(), "mm"),
      };
    case "ITT01":
      // Termómetros de fabricación ASTM: hoja «Certificado ASTM» del libro T-2887 (sin la columna emergente).
      if (leerPresentacion(cal.presentacion).formato === "astm")
        return {
          bloques: [tabla(["Indicación del calibrando / °C", "Indicación del patrón / °C", "Error / °C", "Incertidumbre expandida / °C"],
            rows.map((x, i) => [fx(x.Gc ?? x.G, dec), fx(x.Hc ?? x.H, dec), fx((x.Gc ?? x.G) - (x.Hc ?? x.H), dec), uc(i, x.Ucert ?? x.N)]))],
          fueraAlcance: fuera, sintesis: sintesisU(mayorU(), "°C"),
        };
      return {
        bloques: [tabla(["Indicación del calibrando / °C", "Indicación del patrón / °C", "Error / °C", "Temperatura promedio columna emergente / °C", "Incertidumbre expandida / °C"],
          rows.map((x, i) => [fx(x.Gc ?? x.G, dec), fx(x.Hc ?? x.H, dec), fx((x.Gc ?? x.G) - (x.Hc ?? x.H), dec), NA, uc(i, x.Ucert ?? x.N)]))],
        fueraAlcance: fuera, sintesis: sintesisU(mayorU(), "°C"),
      };
    case "ITT02":
      return {
        bloques: [tabla(["Indicación del calibrando / °C", "Indicación del patrón / °C", "Error / °C", "Incertidumbre expandida / °C"],
          rows.map((x, i) => [fx(x.B, 2), fx(x.C, 2), fx(x.D, 2), uc(i, x.M)]), "Valores obtenidos")],
        fueraAlcance: fuera, sintesis: sintesisU(mayorU(), "°C"),
      };
    case "ITP02": {
      const pts: any[] = D.pts ?? [];
      const si = UNIDAD_SI[unidad];
      const res = rows.map((x, i) => [fg(x.C ?? x.nom, dec + 1), fx(x.B, dec + 1), fx(x.D, dec + 1), fx(x.E, dec + 1), uc(i, x.Uc)]);
      const bloques: Bloque[] = [
        tabla([`Indicación del instrumento / ${unidad}`, `Patrón · ascendente / ${unidad}`, `Patrón · descendente / ${unidad}`],
          pts.map((p) => [fg(p.nom, dec + 1), fg(p.asc, dec + 2), fg(p.desc, dec + 2)]), "Tabla de resultados de calibración"),
        tabla([`Indicación del instrumento / ${unidad}`, `Indicación promedio del patrón / ${unidad}`, `Error / ${unidad}`, `Histéresis / ${unidad}`, `Incertidumbre expandida / ${unidad}`], res, "Resultados de la calibración"),
      ];
      if (si) {
        const k = si.factor, d2 = dec + 2;
        bloques.push(tabla([`Indicación del instrumento / ${si.unidad}`, `Indicación promedio del patrón / ${si.unidad}`, `Error / ${si.unidad}`, `Histéresis / ${si.unidad}`, `Incertidumbre expandida / ${si.unidad}`],
          rows.map((x, i) => [fg((x.C ?? x.nom) * k, d2), fx(x.B * k, d2), fx(x.D * k, d2), fx(x.E * k, d2), `${u2(((pr[i] as any)?.uCertificado ?? x.Uc) * k)}${marca(i)}`]), `Resultados en SI (${si.unidad})`));
      }
      return { bloques, fueraAlcance: fuera, sintesis: sintesisU(mayorU(), unidad) };
    }
    case "ITP01": {
      const pts: any[] = D.pts ?? [];
      const d6 = Math.max(dec + 1, 4);
      return {
        bloques: [
          tabla([`Indicación del patrón / ${unidad}`, "1.ª serie ascendente", "1.ª serie descendente", "2.ª serie ascendente", "2.ª serie descendente", `Promedio / ${unidad}`],
            rows.map((x, i) => [fx(x.B, 6), ...[0, 1, 2, 3].map((k) => fg(at(pts[i]?.r, k), d6)), fg(x.C, d6)]), "Indicaciones del instrumento bajo calibración"),
          tabla([`Promedio / ${unidad}`, `Error / ${unidad}`, `Repetibilidad b′ / ${unidad}`, `Error de cero f₀ / ${unidad}`, `Histéresis h / ${unidad}`, `Incertidumbre expandida / ${unidad}`],
            rows.map((x, i) => [fg(x.C, d6), fx(x.D, 6), fg(x.G, 6), i === 0 ? fg(x.H, 6) : "-.-", fg(x.F, 6), uc(i, x.Uc ?? x.Hc)]), "Resultados de la calibración"),
        ],
        fueraAlcance: fuera, sintesis: sintesisU(mayorU(), unidad),
      };
    }
    case "ITF01": {
      const si = UNIDAD_SI[unidad];
      const serie = (x: any, k: number) => (x.kgf?.[k] == null ? "-.-" : fx(x.kgf[k], 6));
      const bloques: Bloque[] = [
        tabla([`Indicación del instrumento / ${unidad}`, "Patrón 1.ª serie", "Patrón 2.ª serie", "Patrón 3.ª serie", "Patrón 4.ª serie", `Promedio / ${unidad}`, `Error / ${unidad}`, "Incertidumbre expandida (%)"],
          rows.map((x, i) => [fg(x.nom, 4), serie(x, 0), serie(x, 1), serie(x, 2), serie(x, 3), fx(x.H, 6), fx(x.I, 6), uc(i, x.P)])),
        tabla([`Valor nominal / ${unidad}`, "q (%)", "b (%)", "v (%)", "a (%)", "Clase de exactitud"],
          rows.map((x) => [fg(x.nom, 4), fx(x.L, 6), fx(x.M, 6), "-.-", fx(x.O, 6), typeof x.cls === "number" ? fg(x.cls, 1) : v(x.cls)]), "Parámetros según NCh 2598/1 · errores relativos"),
      ];
      if (si) {
        const k = si.factor;
        bloques.push(tabla([`Indicación del instrumento / ${si.unidad}`, "Patrón 1.ª serie", "Patrón 2.ª serie", "Patrón 3.ª serie", "Patrón 4.ª serie", `Promedio / ${si.unidad}`, `Error / ${si.unidad}`, `Incertidumbre expandida / ${si.unidad}`],
          rows.map((x, i) => [fg(x.nom * k, 3), ...[0, 1, 2, 3].map((j) => (x.kgf?.[j] == null ? "-.-" : fx(x.kgf[j] * k, 6))), fx(x.H * k, 6), fx(x.I * k, 6),
            `${u2((((pr[i] as any)?.uCertificado ?? x.P) / 100) * x.nom * k)}${marca(i)}`]), `Resultados en SI (${si.unidad})`));
      }
      return { bloques, fueraAlcance: fuera, sintesis: sintesisU(mayorU(), "%") };
    }
    case "ITF03": {
      const pts: any[] = D.pts ?? [];
      return {
        bloques: [
          tabla(["Indicación del patrón / N", "Instrumento 1.ª serie / N", "Instrumento 2.ª serie / N", "Instrumento 3.ª serie / N", "Instrumento 4.ª serie / N", "Promedio / N", "Error / N", "Incertidumbre expandida (%)"],
            rows.map((x, i) => [fx(x.E, 6), ...[0, 1, 2, 3].map((k) => (at(pts[i]?.s, k) == null ? "-.-" : fg(at(pts[i]?.s, k), 4))), fg(x.J, 4), fx(x.J - x.E, 6), uc(i, x.Q)])),
          tabla(["Valor nominal / N", "q (%)", "b (%)", "v (%)", "a (%)", "Clase de exactitud"],
            rows.map((x) => [fx(x.E, 6), fx(x.L, 6), fx(x.M, 6), "-.-", fx(x.N, 6), typeof x.cls === "number" ? fg(x.cls, 1) : v(x.cls)]), "Parámetros según NCh 2598/1 · errores relativos"),
        ],
        fueraAlcance: fuera, sintesis: sintesisU(mayorU(), "%"),
      };
    }
    case "ITPT01": {
      const si = UNIDAD_SI[unidad];
      const med = (x: any, k: number, f = 1) => (x.v?.[k] == null ? NA : fx(x.v[k] * f, 3));
      const bloques: Bloque[] = [
        tabla([`Indicación del instrumento / ${unidad}`, "Medición 1", "Medición 2", "Medición 3", "Medición 4", "Medición 5", `Promedio / ${unidad}`],
          rows.map((x) => [fg(x.nom, 3), med(x, 0), med(x, 1), med(x, 2), med(x, 3), med(x, 4), fx(x.G, 3)]), "Sentido horario · indicación del patrón"),
        tabla([`Valor de calibración Xa / ${unidad}`, "Valor medio de error de medición (%)", "Incertidumbre de medición expandida relativa W (%)", "Valor máximo del error del dispositivo de calibración (%)", "Intervalo de incertidumbre W′ (%)"],
          rows.map((x, i) => [fg(x.nom, 3), fx(x.I, 3), uc(i, x.N), fx(x.D * 2, 3), fx(x.Wp, 3)])),
      ];
      if (si)
        bloques.push(tabla([`Indicación del instrumento / ${si.unidad}`, "Medición 1", "Medición 2", "Medición 3", "Medición 4", "Medición 5", `Promedio / ${si.unidad}`],
          rows.map((x) => [fx(x.nom * si.factor, 2), med(x, 0, si.factor), med(x, 1, si.factor), med(x, 2, si.factor), med(x, 3, si.factor), med(x, 4, si.factor), fx(x.G * si.factor, 3)]), `Resultados en SI (${si.unidad})`));
      return { bloques, fueraAlcance: fuera, sintesis: sintesisU(mayorU(), "%") };
    }
    case "LCPNF-IT01":
      return {
        bloques: [tabla(["F kN", "Xr", "b %", "b' %", "fc %", "v %", "U caso C %", "U caso D %", "Clase"],
          rows.map((x) => [fg(x.F, 3), fx(x.Xr, 6), fx(x.b, 3), fx(x.bp, 3), fx(x.fc, 3), x.v == null ? NA : fx(x.v, 3), fx(x.U, 3), fx(x.UD, 3), esc(x.etiqueta)]))],
        fueraAlcance: fuera, sintesis: "",
      };
    case "PUNTOS":
      return {
        bloques: [tabla(["Función / rango", "Valor nominal", "Indicación patrón", "Indicación instrumento", "Error", "Incertidumbre expandida"],
          rows.map((x, i) => [v(x.funcion), `${fg(x.nom, 6)} ${esc(x.unidad)}`, fg(x.mPat, 8), fg(x.mInst, 8), fg(x.err, 8), uc(i, x.U)]))],
        fueraAlcance: fuera, sintesis: "",
      };
  }
  if (r && m) {
    const conClase = pr.some((p) => p.clase);
    const uu = m.unidadU, un = m.unidad;
    return {
      bloques: [tabla([`Valor nominal / ${un}`, `Error / ${uu === "%" ? "%" : un}`, `Incertidumbre expandida / ${uu}`, ...(conClase ? ["Clase"] : [])],
        pr.map((p, i) => [fg(p.nominal, 4), fg(p.error, 6), uc(i, (p as any).Ucert ?? p.U), ...(conClase ? [v(p.clase)] : [])]))],
      fueraAlcance: fuera, sintesis: sintesisU(mayorU(), esc(uu)),
    };
  }
  // Motor GUM parametrizado (calibraciones antiguas, sin motor)
  const ptos: any[] = cal.puntos ?? [];
  return {
    bloques: [tabla([`Valor nominal / ${unidad}`, "Indicación patrón", "Indicación instrumento", "Error", `Incertidumbre expandida / ${unidad}`],
      ptos.map((p) => [fg(p.nominal, 4), fg(p.referencia, 6), fg(p.media, 6), fg(p.error, 6), u2(p.u_exp ?? p.uExp)]))],
    fueraAlcance: false,
    sintesis: `La mayor incertidumbre encontrada para ${fmt.sujeto}, considerando que se efectúe la corrección respectiva, es de ± ${u2(cal.u_max)} ${esc(unidad)}, para un nivel de confianza del 95 %.`,
  };
}

/* ------------------------------------------------------------ hoja 1 ----- */
/** Condiciones ambientales: las corregidas del motor (ITM03, ITV05) o las declaradas en el formulario. */
function condiciones(cal: any): { t: string; h: string; p: string } {
  const R = cal.resultado ?? {}, a = cal.ambiente ?? {};
  const par = (x: any, u: any, unidad: string) => (x == null || x === "" ? NA : `(${fg(x, 1)} ± ${u == null || u === "" ? NA : fg(u, 2)}) ${unidad}`);
  if (cal.motor === "ITM03" && R.Y5 != null) return { t: par(Math.round(R.Y5 * 10) / 10, R.tU, "°C"), h: par(Math.round(R.Y6 * 10) / 10, R.hU, "%"), p: par(R.Y7, R.pU, "hPa") };
  if (cal.motor === "ITV05" && R.amb) return { t: par(R.amb.t, R.amb.tU, "°C"), h: par(R.amb.h, R.amb.hU, "%"), p: par(R.amb.p, R.amb.pU, "hPa") };
  const num = (s: any) => (s == null || s === "" ? null : Number(String(s).replace(",", ".")));
  return { t: par(num(a.temp), num(a.tempU), "°C"), h: par(num(a.hum), num(a.humU), "%"), p: par(num(a.pres), num(a.presU), "hPa") };
}

/** Hasta 3 patrones (snapshot guardado en la calibración), una fila por dato como en sus libros. */
function patronesHtml(cal: any): string {
  const ps: any[] = (Array.isArray(cal.patrones) && cal.patrones.length ? cal.patrones : cal.patron_snap?.nombre ? [{
    nombre: cal.patron_snap.nombre, clase: cal.patron_snap.clase, n_certificado: cal.patron_snap.cert, trazabilidad: cal.patron_snap.trazab,
  }] : []).slice(0, 3);
  if (!ps.length) return `<p>${NA}</p>`;
  const filas: [string, (p: any) => string][] = [
    ["Patrón utilizado", (p) => v(p.nombre)], ["Marca", (p) => v(p.marca)], ["Modelo", (p) => v(p.modelo)], ["Número de serie", (p) => v(p.serie)],
    ...(ps.some((p) => p.clase) ? [["Clase", (p: any) => v(p.clase)] as [string, (p: any) => string]] : []),
    ["Número del certificado de calibración", (p) => v(p.n_certificado)], ["Próxima calibración", (p) => dia(p.vence)],
    ["Emitido por", (p) => v(p.emisor)], ["Trazabilidad inmediata", (p) => v(p.trazabilidad)],
  ];
  return `<table class="meta compacta"><tbody>${filas.map(([l, f]) => `<tr><th>${esc(l)}</th>${ps.map((p) => `<td>${f(p)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

/** Filas de pares rótulo / valor (3 por fila, como el resto de la hoja 1). */
function pares(lista: [string, string][], porFila = 3): string {
  const out: string[] = [];
  for (let i = 0; i < lista.length; i += porFila) {
    const f = lista.slice(i, i + porFila);
    out.push(`<tr>${f.map(([l, x]) => `<th>${esc(l)}</th><td>${x}</td>`).join("")}</tr>`);
  }
  return `<table class="meta compacta"><tbody>${out.join("")}</tbody></table>`;
}

function membrete(numero: string, acred: { acreditado: boolean; codigo: string | null }, logo: ImagenCert | null | undefined): string {
  const img = acred.acreditado && logo ? `<img class="logo-acred" src="${esc(logo.src)}" alt="Logo de acreditación">` : "";
  return `
<div class="membrete">
  <div class="escudo">IDIC</div>
  <div class="org"><b>INSTITUTO DE INVESTIGACIONES Y CONTROL, IDIC</b><span>Ejército de Chile · Laboratorio de Metrología</span></div>
  <div class="doc">${img}<b>${esc(numero)}</b><span>${acred.acreditado ? `Acreditación ${esc(acred.codigo)}` : ""}</span></div>
</div>`;
}

/** Datos que el certificado necesita para armarse (también los usa la ficha). */
export function datosCertificado(cal: any) {
  const p: Presentacion = leerPresentacion(cal.presentacion);
  const acred = acreditacionEfectiva(cal.acreditacion, p.acreditado);
  const res = tablasResultados(cal, acred.acreditado);
  const k = cal.motor === "LCPNF-IT01" && cal.resultado?.k ? fg(cal.resultado.k, 2) : "2";
  const automaticas = observacionesAutomaticas({ intervaloMeses: cal.intervalo_meses, k, fueraAlcance: res.fueraAlcance, acreditado: acred.acreditado });
  return { presentacion: p, acred, res, automaticas, observaciones: observacionesImpresas(p, automaticas) };
}

export interface CertificadoArmado { html: string; hojas: number }

/** Arma el certificado de N hojas. */
export function armarCertificado(cal: any, ctx: ContextoCertificado): CertificadoArmado {
  // LNF: certificado bilingüe propio (LCPNF-010.26: 6 hojas + anexo de unidades).
  if (cal.motor === "LCPNF-IT01" && cal.resultado?.rows?.length) return armarCertificadoLnf(cal, ctx);
  const ins = cal.instrumento ?? {};
  const fmt = formatoDe(cal.proceso);
  const { presentacion: p, acred, res, observaciones } = datosCertificado(cal);
  const numero = cal.numero_certificado ?? `BORRADOR ${cal.codigo}`;
  const mag = cal.magnitud_nombre ?? cal.magnitud ?? "";
  const titulo = `CERTIFICADO DE CALIBRACIÓN N° ${numero}`;
  const linea = lineaAcreditacion(acred.acreditado, mag);
  const reemplaza = ctx.reemplazaNumero ?? p.reemplaza;
  const c = condiciones(cal);
  const cargoDepto = `Jefe ${ctx.departamento}`;
  const cargoLab = "Jefe Laboratorio de Metrología";
  const metodo = [cal.metodo, cal.revision].filter(Boolean).join(" · ");
  const campo = (k: string) => v(p.campos[k]);
  // Equivalencia en el SI de la capacidad, la resolución y el rango (libros de presión, fuerza y par).
  const unidadInstr = cal.motor ? REGISTRO_MOTORES[cal.motor]?.unidad : null;

  // Resultados repartidos en hojas (pregunta 12: N hojas).
  const bloques: Bloque[] = [...res.bloques];
  if (ctx.esquema) {
    const maxW = 511, maxH = 220;
    const kk = Math.min(maxW / ctx.esquema.ancho, maxH / ctx.esquema.alto, 1);
    bloques.push({
      tipo: "fijo", alto: ctx.esquema.alto * kk + 40,
      html: `<h2>${esc(ctx.esquema.titulo)}</h2><div class="foto esquema"><img src="${esc(ctx.esquema.src)}" alt="${esc(ctx.esquema.titulo)}">${p.esquemaPie ? `<p>${esc(p.esquemaPie)}</p>` : ""}</div>`,
    });
  }
  const hojasRes = paginar(bloques, altoObservaciones(observaciones));
  const N = 1 + hojasRes.length;

  const cabecera = (k: number) => `
${membrete(numero, acred, ctx.logo)}
<h1 class="compacta">${esc(titulo)}</h1>
<p class="paginacion">Página ${k} de ${N}</p>
<p class="linea-acred"><b>${esc(linea)}</b></p>`;

  const instrumento: [string, string][] = [
    ["Descripción del ítem", v(ins.item)],
    fmt.clase === "Clase" && !fmt.rango ? ["Marca", v(ins.marca)] : ["Marca y modelo", [ins.marca, ins.modelo].filter((x) => x && String(x).trim()).map(esc).join(" · ") || NA],
    ["Número de serie", v(ins.serie)], ["Identificación especial", v(ins.idEspecial)],
    ...(fmt.capacidad ? [[fmt.capacidad, v(ins.cap)] as [string, string]] : []),
    ...(fmt.capacidad === "Valor nominal" ? [] : [["Resolución", v(ins.res)] as [string, string]]),
    ...(fmt.rango ? [[fmt.rango, v(ins.rango)] as [string, string]] : []),
    ...(fmt.clase ? [[fmt.clase, v(ins.clase)] as [string, string]] : []),
    ...fmt.campos.filter((f) => f.seccion === "instrumento").map((f) => [f.etiqueta, campo(f.clave)] as [string, string]),
  ];
  const equivalencias = lineaEquivalenciasSI([
    ...(fmt.capacidad ? [[fmt.capacidad, ins.cap] as [string, any]] : []),
    ...(fmt.capacidad === "Valor nominal" ? [] : [["Resolución", ins.res] as [string, any]]),
    ...(fmt.rango ? [[fmt.rango, ins.rango] as [string, any]] : []),
  ], unidadInstr);
  const condicionesIt = fmt.campos.filter((f) => f.seccion !== "instrumento").map((f) => [f.etiqueta, campo(f.clave)] as [string, string]);

  const hoja1 = `
${cabecera(1)}
${reemplaza ? `<p class="reemplaza"><b>ESTE CERTIFICADO REEMPLAZA AL CERTIFICADO N° ${esc(reemplaza)}.</b></p>` : ""}
<table class="meta compacta"><tbody>
  <tr><th>Orden de trabajo número</th><td>${v(ins.ot)}</td><th>Fecha</th><td>${dia(ins.fechaOt)}</td><th>Fecha de emisión del certificado</th><td>${cal.emitido_at ? dia(new Date(cal.emitido_at).toLocaleDateString("sv-SE", { timeZone: "America/Santiago" })) : "Pendiente"}</td></tr>
</tbody></table>
<h2 class="compacta">Identificación del instrumento calibrado</h2>
${pares(instrumento)}
<h2 class="compacta">Identificación del cliente</h2>
${pares([["Cliente", v(ins.cliente)], ["Solicitante", v(ins.solicitante)], ["Contacto", v(ins.contacto)], ["Dirección", v(ins.direccion)]], 2)}
<h2 class="compacta">Condiciones de calibración</h2>
<table class="meta compacta"><tbody>
  <tr><th>Lugar de la calibración</th><td>${esc(LUGAR[ins.lugar] ?? LUGAR.instalaciones)}</td></tr>
</tbody></table>
${pares([
    ["Fecha de recepción", dia(ins.fechaRecepcion)], ["Fecha de calibración", dia(cal.fecha_calibracion)], ["Temperatura promedio", c.t], ["Humedad relativa promedio", c.h],
    ...(fmt.presion ? [["Presión atmosférica promedio", c.p] as [string, string]] : []),
    ...condicionesIt,
  ])}
<p class="nota legal">Los valores indicados corresponden a la temperatura y humedad relativa durante la calibración. Además, se indica los valores de incertidumbre del instrumento con que fue medido.${equivalencias ? ` ${esc(equivalencias)}` : ""}</p>
${pares([["Método de calibración", v(metodo)], ["Desviaciones del método", v(ins.desviacion || "No")], ["Documento o norma base del método", v(cal.norma)]])}
<h2 class="compacta">Identificación del patrón</h2>
${patronesHtml(cal)}
<h2 class="compacta">Resultados de la calibración</h2>
<p><b>Síntesis de la calibración:</b> ${res.sintesis ? esc(res.sintesis) : "los resultados se presentan en la tabla de resultados."}</p>
<div class="pie-hoja">
${tablaFirmas(firmaCelda(ctx.jefeDepto, cargoDepto), firmaCelda(ctx.jefeLab, cargoLab))}
${TEXTOS_LEGALES.map((t) => `<p class="nota legal">${esc(t)}</p>`).join("\n")}
</div>`;

  const datosItem = pares(fmt.hojaResultados.map(([k, l]) => [l, v(ins[k])] as [string, string]), 3);
  const htmlBloque = (b: Bloque) => b.tipo === "fijo" ? b.html : `${b.titulo ? `<h3>${esc(b.titulo)}</h3>` : ""}<table class="rep"><thead><tr>${b.cabecera.map((x) => `<th>${esc(x)}</th>`).join("")}</tr></thead><tbody>${
    b.filas.map((f) => `<tr>${f.map((x, i) => `<td${i ? ' class="num"' : ""}>${x}</td>`).join("")}</tr>`).join("")}</tbody></table>`;

  const hojas = hojasRes.map((bs, i) => {
    const ultima = i === hojasRes.length - 1;
    return `
<div class="salto-pagina"></div>
${cabecera(i + 2)}
${datosItem}
<h2>Resultados de la calibración${i ? " (continuación)" : " · valores obtenidos"}</h2>
${bs.map(htmlBloque).join("\n")}
${ultima ? `<h2>Observaciones</h2>\n${observaciones.map((o) => `<p>${escTexto(o)}</p>`).join("\n")}` : ""}
<div class="pie-hoja">
${tablaFirmas(firmaCelda(ctx.jefeLab, cargoLab), firmaCelda(ctx.metrologo, "Metrólogo"))}
${ultima ? "<p class=\"fin\"><b>Fin del certificado de calibración</b></p>" : ""}
</div>`;
  });

  return { html: hoja1 + hojas.join(""), hojas: N };
}

export function certificadoHtml(cal: any, ctx: ContextoCertificado): string {
  return armarCertificado(cal, ctx).html;
}
