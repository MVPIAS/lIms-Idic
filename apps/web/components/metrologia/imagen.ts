/**
 * Imagen protegida de Metrología (esquema, logo) pedida con la sesión y devuelta como
 * data URL: la política de seguridad del sitio admite `data:` en img-src, no `blob:`.
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? "/api";

export async function imagenComoDato(ruta: string): Promise<string> {
  const token = typeof window === "undefined" ? null : localStorage.getItem("lims_token");
  const r = await fetch(`${API}/${ruta.replace(/^\/+/, "")}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!r.ok) throw new Error(`Error ${r.status}`);
  const blob = await r.blob();
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result));
    lector.onerror = () => reject(new Error("No se pudo leer la imagen"));
    lector.readAsDataURL(blob);
  });
}
