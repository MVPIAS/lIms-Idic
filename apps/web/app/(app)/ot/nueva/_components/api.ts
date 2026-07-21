"use client";

// Base de la API y helpers compartidos por la pantalla de Registro de O/T.
export const API = process.env.NEXT_PUBLIC_API_URL || "/api";

// Formateo canónico compartido (miles ".", símbolo $): re-exportado del util central.
export { clp } from "@/lib/format";

const authHeaders = (): Record<string, string> => ({
  Authorization: `Bearer ${typeof window !== "undefined" ? localStorage.getItem("lims_token") : ""}`,
});

// GET genérico contra la API con auth Bearer. Devuelve [] ante error para no romper la cascada.
export async function apiGet<T = any>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Error ${res.status} en ${path}`);
  return res.json();
}

// Normaliza respuestas: soporta arrays planos o envueltos en {data:[...]}.
export function asArray<T = any>(data: any): T[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

// Desenvuelve una entidad: soporta {id,...} plano o envuelto en {data:{id,...}}.
export function unwrap<T = any>(data: any): T {
  return (data && typeof data === "object" && "data" in data ? data.data : data) as T;
}

// Error de API con mensaje + issues legibles (para pintar un .alert warn al usuario).
export class ApiError extends Error {
  issues: string[];
  status: number;
  constructor(message: string, status: number, issues: string[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.issues = issues;
  }
}

// POST genérico con auth Bearer. Ante 4xx/5xx lee {message, issues:[{path,message}]}
// y lanza un ApiError con los issues formateados ("clienteId: Required").
export async function apiPost<T = any>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (res.ok) return res.json();

  let payload: any = null;
  try { payload = await res.json(); } catch { /* respuesta sin cuerpo JSON */ }
  const issues: string[] = Array.isArray(payload?.issues)
    ? payload.issues.map((it: any) => {
        const campo = Array.isArray(it?.path) ? it.path.join(".") : it?.path;
        return campo ? `${campo}: ${it?.message ?? "inválido"}` : String(it?.message ?? "inválido");
      })
    : [];
  const msg = payload?.message || `Error ${res.status} en ${path}`;
  throw new ApiError(msg, res.status, issues);
}

export { authHeaders };
