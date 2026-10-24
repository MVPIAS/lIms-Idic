/**
 * OT con la que se está trabajando en la captura (B-023). «Emitir informe»
 * abierto desde el menú, sin ?otId, propone esa OT en vez de una pantalla vacía.
 * Se guarda solo en la pestaña (sessionStorage) y caduca a las 2 horas.
 */
const CLAVE = "lims_ot_activa";
const VIGENCIA_MS = 2 * 60 * 60 * 1000;

export function recordarOtActiva(id: string | null | undefined) {
  try {
    if (id) sessionStorage.setItem(CLAVE, JSON.stringify({ id, en: Date.now() }));
  } catch {
    /* sin almacenamiento: no se recuerda */
  }
}

export function otActiva(): string | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(CLAVE) ?? "null");
    if (v && typeof v.id === "string" && /^[0-9a-f-]{36}$/i.test(v.id) && Date.now() - Number(v.en) < VIGENCIA_MS) return v.id;
  } catch {
    /* valor ilegible */
  }
  return null;
}
