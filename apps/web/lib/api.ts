/**
 * Cliente HTTP del frontend. Adjunta el JWT (guardado en localStorage tras el login)
 * y normaliza errores. Base configurable con NEXT_PUBLIC_API_URL.
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? "/api";

function token(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("lims_token");
}

async function request<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401 && typeof window !== "undefined") {
    localStorage.removeItem("lims_token");
    window.location.href = "/login";
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `Error ${res.status}`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export interface Paginado<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export const api = {
  list: <T = any>(recurso: string, q: { page?: number; limit?: number; search?: string } = {}) => {
    const p = new URLSearchParams();
    if (q.page) p.set("page", String(q.page));
    if (q.limit) p.set("limit", String(q.limit));
    if (q.search) p.set("search", q.search);
    return request<Paginado<T>>(`/${recurso}?${p.toString()}`);
  },
  get: <T = any>(recurso: string, id: string) => request<T>(`/${recurso}/${id}`),
  create: <T = any>(recurso: string, data: any) => request<T>(`/${recurso}`, { method: "POST", body: JSON.stringify(data) }),
  update: <T = any>(recurso: string, id: string, data: any) => request<T>(`/${recurso}/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (recurso: string, id: string) => request(`/${recurso}/${id}`, { method: "DELETE" }),
  post: <T = any>(path: string, data: any) => request<T>(path, { method: "POST", body: JSON.stringify(data) }),

  login: async (username: string, password: string) => {
    const r = await request<{ accessToken: string; user: any }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    if (typeof window !== "undefined") {
      localStorage.setItem("lims_token", r.accessToken);
      localStorage.setItem("lims_user", JSON.stringify(r.user ?? {}));
    }
    return r;
  },
  logout: () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("lims_token");
      localStorage.removeItem("lims_user");
      window.location.href = "/login";
    }
  },
  getUser: (): any | null => {
    if (typeof window === "undefined") return null;
    try { return JSON.parse(localStorage.getItem("lims_user") ?? "null"); } catch { return null; }
  },
  isAuth: () => typeof window !== "undefined" && !!localStorage.getItem("lims_token"),
};
