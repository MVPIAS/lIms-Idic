"use client";

/**
 * feedback.tsx · avisos (toasts) y diálogo de confirmación compartidos.
 *
 * Se usan de forma imperativa desde cualquier componente cliente, sin contexto:
 *
 *   import { toast, confirmar } from "@/components/ui/feedback";
 *   toast.ok("Registro guardado");
 *   toast.error("No se pudo guardar: …");
 *   if (await confirmar({ titulo: "¿Eliminar?", mensaje: "…", peligro: true })) { … }
 *
 * <FeedbackHost/> (montado una vez en app/(app)/layout.tsx) pinta ambos.
 * Si el host no está montado (p. ej. en /login), `confirmar` cae a
 * window.confirm y `toast` no hace nada, para no romper nunca.
 */

import { useEffect, useRef, useState } from "react";

type TipoToast = "ok" | "error" | "info";
interface Toast { id: number; tipo: TipoToast; texto: string }

export interface OpcionesConfirmar {
  titulo: string;
  mensaje?: React.ReactNode;
  /** texto del botón de confirmar (por defecto «Confirmar» o «Eliminar» si peligro). */
  confirmarTexto?: string;
  cancelarTexto?: string;
  /** acción destructiva: botón rojo. */
  peligro?: boolean;
}

interface PeticionConfirmar extends OpcionesConfirmar { resolver: (ok: boolean) => void }

type Oyentes = {
  toast?: (t: Toast) => void;
  confirmar?: (p: PeticionConfirmar) => void;
};
const oyentes: Oyentes = {};
let seq = 0;

function emitirToast(tipo: TipoToast, texto: string) {
  oyentes.toast?.({ id: ++seq, tipo, texto });
}

export const toast = {
  ok: (texto: string) => emitirToast("ok", texto),
  error: (texto: string) => emitirToast("error", texto),
  info: (texto: string) => emitirToast("info", texto),
};

/** Abre el diálogo de confirmación y resuelve true/false. */
export function confirmar(op: OpcionesConfirmar): Promise<boolean> {
  if (!oyentes.confirmar) {
    const texto = [op.titulo, typeof op.mensaje === "string" ? op.mensaje : ""].filter(Boolean).join("\n\n");
    return Promise.resolve(typeof window !== "undefined" && window.confirm(texto));
  }
  return new Promise((resolver) => oyentes.confirmar!({ ...op, resolver }));
}

const COLOR: Record<TipoToast, { borde: string; fondo: string; texto: string; icono: string }> = {
  ok: { borde: "var(--green)", fondo: "#e9f6ee", texto: "#155e3d", icono: "✓" },
  error: { borde: "var(--red)", fondo: "#fdecec", texto: "#7d1f1f", icono: "!" },
  info: { borde: "var(--blue)", fondo: "#eff5ff", texto: "#1c4ba6", icono: "i" },
};

export function FeedbackHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pet, setPet] = useState<PeticionConfirmar | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    oyentes.toast = (t) => {
      setToasts((ts) => [...ts.slice(-3), t]);
      const ms = t.tipo === "error" ? 7000 : 3500;
      setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== t.id)), ms);
    };
    oyentes.confirmar = (p) => setPet(p);
    return () => {
      oyentes.toast = undefined;
      oyentes.confirmar = undefined;
    };
  }, []);

  // Foco en el botón principal y Escape para cancelar.
  useEffect(() => {
    if (!pet) return;
    btnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cerrar(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pet]);

  function cerrar(ok: boolean) {
    pet?.resolver(ok);
    setPet(null);
  }

  return (
    <>
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => {
          const c = COLOR[t.tipo];
          return (
            <div key={t.id} className="toast" style={{ borderLeftColor: c.borde, background: c.fondo, color: c.texto }}>
              <span className="toast-ico" style={{ background: c.borde }}>{c.icono}</span>
              <span style={{ flex: 1 }}>{t.texto}</span>
              <button type="button" aria-label="Cerrar aviso" className="toast-x"
                onClick={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))}>✕</button>
            </div>
          );
        })}
      </div>

      {pet && (
        <div className="modal-fondo" onMouseDown={(e) => { if (e.target === e.currentTarget) cerrar(false); }}>
          <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="confirmar-titulo">
            <h3 id="confirmar-titulo">{pet.titulo}</h3>
            {pet.mensaje && <div className="modal-cuerpo">{pet.mensaje}</div>}
            <div className="modal-acciones">
              <button type="button" className="btn outline sm" onClick={() => cerrar(false)}>
                {pet.cancelarTexto ?? "Cancelar"}
              </button>
              <button type="button" ref={btnRef} className={`btn sm ${pet.peligro ? "danger" : "primary"}`} onClick={() => cerrar(true)}>
                {pet.confirmarTexto ?? (pet.peligro ? "Eliminar" : "Confirmar")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
