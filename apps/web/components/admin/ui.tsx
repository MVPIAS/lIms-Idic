"use client";

/**
 * Piezas visuales compartidas del área de Administración: toasts, confirmación,
 * modal, drawer lateral, skeletons, estados vacíos / sin acceso / no disponible,
 * guardia de permiso y cabecera con migas. Reutilizan las clases del sistema de
 * diseño (card, btn, pill, alert…) y Tailwind solo para el layout.
 */

import Link from "next/link";
import {
  createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode,
} from "react";
import {
  ES_DEV, MOCK_ENV, esNoDisponible, leerAcceso, mensajeError, metaTipo, mockActivo, puede, setMockLocal,
} from "@/lib/admin";

// ───────────────────────────── Toasts ─────────────────────────────

type ToastTipo = "ok" | "error" | "info";
interface ToastItem { id: number; tipo: ToastTipo; texto: string }
interface ToastApi { ok: (t: string) => void; error: (t: string | unknown) => void; info: (t: string) => void }

const ToastCtx = createContext<ToastApi | null>(null);
const ConfirmCtx = createContext<((o: ConfirmOpts) => Promise<boolean>) | null>(null);

export interface ConfirmOpts {
  titulo: string;
  mensaje?: ReactNode;
  confirmar?: string;
  cancelar?: string;
  peligro?: boolean;
}

/** Proveedor de toasts + diálogo de confirmación para todo el área admin. */
export function AdminProviders({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const push = useCallback((tipo: ToastTipo, texto: string) => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, tipo, texto }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tipo === "error" ? 7000 : 4000);
  }, []);
  const api = useRef<ToastApi>({
    ok: (t) => push("ok", t),
    error: (t) => push("error", typeof t === "string" ? t : mensajeError(t)),
    info: (t) => push("info", t),
  });

  const [confirm, setConfirm] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const pedirConfirmacion = useCallback(
    (o: ConfirmOpts) => new Promise<boolean>((resolve) => setConfirm({ ...o, resolve })),
    [],
  );
  const cerrar = (v: boolean) => { confirm?.resolve(v); setConfirm(null); };

  return (
    <ToastCtx.Provider value={api.current}>
      <ConfirmCtx.Provider value={pedirConfirmacion}>
        {children}
        <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-[calc(100vw-2rem)] w-[360px]" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} role="status"
              className={`rounded-lg shadow-lg px-4 py-3 text-[12.5px] border-l-4 bg-white flex gap-2 items-start ${
                t.tipo === "ok" ? "border-[#1f8a5b]" : t.tipo === "error" ? "border-[#c43d3d]" : "border-[#2b65d9]"}`}>
              <span aria-hidden>{t.tipo === "ok" ? "✅" : t.tipo === "error" ? "⚠️" : "ℹ️"}</span>
              <span className="flex-1">{t.texto}</span>
              <button className="text-slate-400 hover:text-slate-700" aria-label="Cerrar aviso"
                onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>×</button>
            </div>
          ))}
        </div>
        {confirm && (
          <Modal titulo={confirm.titulo} onClose={() => cerrar(false)} ancho={440}
            pie={
              <>
                <button className="btn outline sm" onClick={() => cerrar(false)}>{confirm.cancelar ?? "Cancelar"}</button>
                <button className="btn sm" autoFocus onClick={() => cerrar(true)}
                  style={{ background: confirm.peligro ? "var(--red)" : "var(--primary)", color: "#fff" }}>
                  {confirm.confirmar ?? "Confirmar"}
                </button>
              </>
            }>
            <div className="text-[13px] text-slate-700">{confirm.mensaje}</div>
          </Modal>
        )}
      </ConfirmCtx.Provider>
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastApi {
  const c = useContext(ToastCtx);
  return c ?? { ok: () => {}, error: () => {}, info: () => {} };
}
export function useConfirm() {
  const c = useContext(ConfirmCtx);
  return c ?? (async (o: ConfirmOpts) => window.confirm(o.titulo));
}

// ───────────────────────────── Modal / Drawer ─────────────────────────────

export function Modal({ titulo, children, pie, onClose, ancho = 520 }: {
  titulo: ReactNode; children: ReactNode; pie?: ReactNode; onClose: () => void; ancho?: number;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" className="bg-white rounded-xl shadow-2xl w-full max-h-[90vh] flex flex-col"
        style={{ maxWidth: ancho }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="px-5 pt-4 pb-2 font-bold text-[15px]">{titulo}</div>
        <div className="px-5 pb-4 overflow-y-auto">{children}</div>
        {pie && <div className="px-5 py-3 border-t border-[var(--line)] flex justify-end gap-2">{pie}</div>}
      </div>
    </div>
  );
}

export function Drawer({ abierto, onClose, titulo, subtitulo, children, ancho = 560 }: {
  abierto: boolean; onClose: () => void; titulo: ReactNode; subtitulo?: ReactNode; children: ReactNode; ancho?: number;
}) {
  useEffect(() => {
    if (!abierto) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [abierto, onClose]);
  if (!abierto) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30" onMouseDown={onClose}>
      <aside role="dialog" aria-modal="true" className="bg-[var(--bg)] h-full w-full shadow-2xl flex flex-col"
        style={{ maxWidth: ancho }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="bg-white border-b border-[var(--line)] px-5 py-3 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="font-bold text-[16px] truncate">{titulo}</div>
            {subtitulo && <div className="text-[12px] text-[var(--muted)]">{subtitulo}</div>}
          </div>
          <button className="btn outline sm" onClick={onClose} aria-label="Cerrar panel">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </aside>
    </div>
  );
}

// ───────────────────────────── Estados ─────────────────────────────

export function Skeleton({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`animate-pulse rounded bg-slate-200/80 ${className}`} style={style} />;
}
export function SkeletonLineas({ n = 6 }: { n?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Cargando">
      {Array.from({ length: n }).map((_, i) => (
        <Skeleton key={i} className="h-7" style={{ width: `${70 + ((i * 37) % 30)}%` }} />
      ))}
    </div>
  );
}

export function EstadoVacio({ icono = "🗂", titulo, texto, accion }: {
  icono?: string; titulo: string; texto?: ReactNode; accion?: ReactNode;
}) {
  return (
    <div className="text-center py-10 px-4">
      <div className="text-4xl mb-2" aria-hidden>{icono}</div>
      <div className="font-bold text-[14.5px]">{titulo}</div>
      {texto && <div className="text-[12.5px] text-[var(--muted)] mt-1 max-w-md mx-auto">{texto}</div>}
      {accion && <div className="mt-4">{accion}</div>}
    </div>
  );
}

/** Tarjeta para cuando el backend aún no expone el servicio (404) o falla la carga. */
export function EstadoError({ error, onReintentar, recurso }: { error: unknown; onReintentar?: () => void; recurso?: string }) {
  if (esNoDisponible(error)) {
    return (
      <div className="card" style={{ borderLeft: "4px solid var(--amber)" }}>
        <EstadoVacio icono="🚧" titulo="Servicio no disponible aún"
          texto={<>La pantalla está lista, pero el servidor todavía no ofrece {recurso ? <b>{recurso}</b> : "este servicio"}.
            Cuando se despliegue el módulo de Administración en el backend, los datos aparecerán aquí automáticamente.</>}
          accion={
            <div className="flex gap-2 justify-center flex-wrap">
              {onReintentar && <button className="btn outline sm" onClick={onReintentar}>↻ Reintentar</button>}
              {ES_DEV && !MOCK_ENV && (
                <button className="btn accent sm" onClick={() => setMockLocal(true)} title="Solo en desarrollo">
                  Ver con datos de ejemplo
                </button>
              )}
            </div>
          } />
      </div>
    );
  }
  return (
    <div className="alert warn flex items-center gap-3 flex-wrap">
      <span className="flex-1">No se pudo cargar{recurso ? ` ${recurso}` : ""}: {mensajeError(error)}</span>
      {onReintentar && <button className="btn outline sm" onClick={onReintentar}>↻ Reintentar</button>}
    </div>
  );
}

export function SinAcceso({ permiso }: { permiso: string }) {
  return (
    <div className="card max-w-xl mx-auto mt-6">
      <EstadoVacio icono="🔒" titulo="Sin acceso a esta sección"
        texto={<>Tu perfil no incluye el permiso <span className="codigo">{permiso}</span>. Si necesitas administrar
          esta parte del sistema, pídeselo al administrador del LIMS.</>}
        accion={<Link href="/dashboard" className="btn outline sm">Volver al panel</Link>} />
    </div>
  );
}

/** Guardia de UI por permiso (la seguridad real la impone el backend). */
export function AdminGuard({ permiso, children }: { permiso: string; children: ReactNode }) {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => { setOk(puede(leerAcceso(), permiso)); }, [permiso]);
  if (ok === null) return <SkeletonLineas n={4} />;
  if (!ok) return <SinAcceso permiso={permiso} />;
  return <>{children}</>;
}

export function BannerEjemplo() {
  const [on, setOn] = useState(false);
  useEffect(() => setOn(mockActivo()), []);
  if (!on) return null;
  return (
    <div className="rolebanner flex items-center gap-3 flex-wrap">
      <span className="flex-1">
        🧪 <b>Modo datos de ejemplo.</b> Estás viendo datos ficticios en memoria (no se guarda nada en el servidor).
      </span>
      {!MOCK_ENV && <button className="btn outline sm" onClick={() => setMockLocal(false)}>Salir del modo ejemplo</button>}
    </div>
  );
}

// ───────────────────────────── Cabecera ─────────────────────────────

export function CabeceraAdmin({ titulo, subtitulo, acciones, icono }: {
  titulo: string; subtitulo?: ReactNode; acciones?: ReactNode; icono?: string;
}) {
  return (
    <div className="mb-3">
      <div className="text-[11.5px] text-[var(--muted)] mb-1">
        <Link href="/admin" className="hover:underline">Administración</Link> <span aria-hidden>›</span> {titulo}
      </div>
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <h1 className="page">{icono && <span className="mr-2" aria-hidden>{icono}</span>}{titulo}</h1>
          {subtitulo && <p className="subtitle" style={{ marginBottom: 0 }}>{subtitulo}</p>}
        </div>
        {acciones && <div className="flex gap-2 flex-wrap items-center">{acciones}</div>}
      </div>
      <div className="mt-3"><BannerEjemplo /></div>
    </div>
  );
}

// ───────────────────────────── Piezas ─────────────────────────────

/** Icono de unidad en círculo con el color de su tipo (o el propio de la unidad). */
export function IconoUnidad({ tipo, icono, color, size = 26 }: { tipo: string; icono?: string | null; color?: string | null; size?: number }) {
  const m = metaTipo(tipo);
  const c = color || m.color;
  return (
    <span className="inline-flex items-center justify-center rounded-full shrink-0"
      style={{ width: size, height: size, background: `${c}1f`, border: `1.5px solid ${c}`, fontSize: size * 0.5 }}
      title={m.label} aria-hidden>
      {icono || m.icono}
    </span>
  );
}

export function Campo({ label, req, children, ayuda, className = "" }: {
  label: string; req?: boolean; children: ReactNode; ayuda?: ReactNode; className?: string;
}) {
  return (
    <div className={`field ${className}`}>
      <label>{label}{req && <span className="req"> *</span>}</label>
      {children}
      {ayuda && <small className="text-[11px] text-[var(--muted)] mt-1">{ayuda}</small>}
    </div>
  );
}

/** Hook de carga con estados (loading / error / recarga). */
export function useCarga<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [cargando, setCargando] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const recargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargando(true);
    setError(null);
    try { setData(await fnRef.current()); } catch (e) { setError(e); } finally { setCargando(false); }
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { recargar(); }, deps);
  return { data, setData, error, cargando, recargar };
}

/** Copia al portapapeles con respaldo. */
export async function copiar(texto: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(texto); return true; } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = texto; document.body.appendChild(ta); ta.select();
      const ok = document.execCommand("copy"); ta.remove(); return ok;
    } catch { return false; }
  }
}
