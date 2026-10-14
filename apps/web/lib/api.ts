/**
 * Cliente HTTP del frontend. Adjunta el JWT (guardado en localStorage tras el login)
 * y normaliza errores. Base configurable con NEXT_PUBLIC_API_URL.
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? "/api";

function token(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("lims_token");
}

/**
 * Error de la API con el estado HTTP y el cuerpo, para los casos en que la
 * pantalla necesita más que el mensaje: `requiere2fa` en el ingreso, `codigo`
 * CAMBIO_CLAVE_REQUERIDO, `errores` de validación…
 */
export class ApiError extends Error {
  constructor(message: string | string[], public status: number, public body: any) {
    super(Array.isArray(message) ? message.join(", ") : message);
  }
}

export interface Sesion {
  accessToken: string;
  refreshToken?: string;
  user: any;
  /** Contraseña temporal: hay que cambiarla antes de entrar al sistema. */
  debeCambiarPassword?: boolean;
}

function guardarSesion(r: Sesion) {
  if (typeof window === "undefined") return;
  localStorage.setItem("lims_token", r.accessToken);
  localStorage.setItem("lims_user", JSON.stringify(r.user ?? {}));
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
  // Un 401 en el propio ingreso es «credenciales inválidas» (o «falta el código
  // 2FA»): se muestra en el formulario en vez de recargar la página y perderlo.
  if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth/login")) {
    localStorage.removeItem("lims_token");
    window.location.href = "/login";
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.message ?? `Error ${res.status}`, res.status, body);
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
  /** GET a un path arbitrario (con query ya incluido), p. ej. "parametros?categoria=tipo_cliente". */
  getRaw: <T = any>(path: string) => request<T>(`/${path}`),
  create: <T = any>(recurso: string, data: any) => request<T>(`/${recurso}`, { method: "POST", body: JSON.stringify(data) }),
  update: <T = any>(recurso: string, id: string, data: any) => request<T>(`/${recurso}/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (recurso: string, id: string) => request(`/${recurso}/${id}`, { method: "DELETE" }),
  post: <T = any>(path: string, data: any) => request<T>(path, { method: "POST", body: JSON.stringify(data) }),
  patch: <T = any>(path: string, data: any) => request<T>(path, { method: "PATCH", body: JSON.stringify(data) }),

  /**
   * Ingreso. Con 2FA activo, el primer intento responde 401 con
   * `requiere2fa: true` (en ApiError.body): la pantalla pide el código y repite
   * la llamada con `totp`. Con contraseña temporal llega `debeCambiarPassword`.
   */
  login: async (username: string, password: string, totp?: string) => {
    const r = await request<Sesion>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password, ...(totp ? { totp } : {}) }),
    });
    guardarSesion(r);
    return r;
  },
  /** Cambio de la propia contraseña; guarda la sesión nueva que devuelve el servidor. */
  cambiarPassword: async (actual: string, nueva: string) => {
    const r = await request<Sesion & { mensaje?: string }>("/auth/cambiar-password", {
      method: "POST",
      body: JSON.stringify({ actual, nueva }),
    });
    guardarSesion(r);
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
