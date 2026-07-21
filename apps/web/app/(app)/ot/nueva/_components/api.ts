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

export { authHeaders };
