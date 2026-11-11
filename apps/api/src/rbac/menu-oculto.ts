/**
 * Módulos heredados fuera del menú (Comercial R1 y Vehículos R10: «revisar módulos
 * heredados que no corresponden al IDIC»). El parámetro del sistema «menu · ocultos»
 * lista las rutas del menú que no se muestran a nadie (una por línea o separadas por
 * coma, p. ej. «/crm, /encuestas»). El administrador lo cambia en Parámetros del sistema
 * sin tocar código; la seguridad sigue en los permisos (esto solo ordena el menú).
 * Función PURA: menu-oculto.spec.ts.
 */
export function rutasMenuOculto(valor: string | null | undefined): string[] {
  const vistos = new Set<string>();
  for (const parte of String(valor ?? "").split(/[\n,;]+/)) {
    let r = parte.trim();
    if (!r) continue;
    if (!r.startsWith("/")) r = `/${r}`;
    r = r.replace(/\/+$/, "");
    // Solo rutas internas simples (sin protocolo, consulta ni espacios).
    if (!/^\/[a-z0-9\-_/]+$/i.test(r) || r === "/inicio") continue;
    vistos.add(r.toLowerCase());
  }
  return [...vistos];
}
