/**
 * Vista previa en pantalla de las condiciones ambientales corregidas (EP-04 P3.4):
 * la misma regla que aplica el servidor al guardar (apps/api/src/metrologia/ficha.reglas.ts):
 * promedio de las lecturas − error del certificado del equipo auxiliar (R15 T1: se resta),
 * redondeado a un decimal, con la U del certificado. El servidor recalcula y manda.
 */
export type Correccion = { error: number | null; U: number | null } | null | undefined;
export type Correcciones = { temp?: Correccion; hum?: Correccion; pres?: Correccion } | null | undefined;

export function corregida(lecturas: (number | null | undefined)[], c: Correccion): { corregido: number; U: number | null; sinCorreccion: boolean } | null {
  const v = lecturas.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  if (!v.length) return null;
  const m = v.reduce((s, x) => s + x, 0) / v.length;
  const error = c?.error ?? 0;
  return { corregido: Math.round((m - error) * 10) / 10, U: c?.U ?? null, sinCorreccion: c?.error == null };
}

/** Texto con coma decimal a número (vacío o inválido → null). */
export const numeroOVacio = (t: string): number | null => {
  const s = String(t ?? "").trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/* ---- condiciones ambientales → motor (B-027) · ESPEJO de apps/api/src/metrologia/ficha.reglas.ts ---- */
/** Condiciones de la hoja de control: lecturas y error/U del certificado de cada auxiliar. */
export interface CondicionesHoja {
  temp?: number[];
  hum?: number[];
  pres?: number[];
  errT?: number | null; uT?: number | null;
  errH?: number | null; uH?: number | null;
  errP?: number | null; uP?: number | null;
}

/**
 * B-027 · EP-04 P3.4: las condiciones ambientales se registran UNA vez, en la hoja de
 * control (termohigrómetro y barómetro del maestro), y alimentan al motor. Sustituye en
 * los datos del motor solo las claves que ese motor tiene: lecturas (temp/T, hum/H,
 * patm/P) y error del certificado (tcorr/et, hcorr/eh, ebar, corr[t,h,p], termohig y
 * barometro de ITM03). Lo que la hoja no trae se deja como está. Devuelve las claves cambiadas.
 */
export function condicionesAlMotor<T extends Record<string, any>>(datos: T, c: CondicionesHoja | null): { datos: T; campos: string[] } {
  if (!c || !datos || typeof datos !== "object") return { datos, campos: [] };
  const d: Record<string, any> = { ...datos };
  const campos: string[] = [];
  const poner = (k: string, v: unknown) => {
    if (!(k in d) || v === null || v === undefined || (Array.isArray(v) && !v.length)) return;
    if (JSON.stringify(d[k]) !== JSON.stringify(v)) campos.push(k);
    d[k] = v;
  };
  for (const k of ["temp", "T"]) if (Array.isArray(d[k])) poner(k, c.temp);
  for (const k of ["hum", "H"]) if (Array.isArray(d[k])) poner(k, c.hum);
  for (const k of ["patm", "P"]) if (Array.isArray(d[k])) poner(k, c.pres);
  for (const k of ["tcorr", "et"]) poner(k, c.errT);
  for (const k of ["hcorr", "eh"]) poner(k, c.errH);
  poner("ebar", c.errP);
  if (Array.isArray(d.corr) && d.corr.length === 3 && [c.errT, c.errH, c.errP].some((x) => x != null))
    poner("corr", [c.errT ?? d.corr[0], c.errH ?? d.corr[1], c.errP ?? d.corr[2]]);
  if (d.termohig && typeof d.termohig === "object" && (c.errT != null || c.errH != null))
    poner("termohig", { ...d.termohig, ...(c.errT != null ? { corrT: c.errT } : {}), ...(c.uT != null ? { uT: c.uT } : {}),
      ...(c.errH != null ? { corrH: c.errH } : {}), ...(c.uH != null ? { uH: c.uH } : {}) });
  if (d.barometro && typeof d.barometro === "object" && c.errP != null)
    poner("barometro", { ...d.barometro, corr: c.errP, ...(c.uP != null ? { u: c.uP } : {}) });
  return { datos: d as T, campos };
}
