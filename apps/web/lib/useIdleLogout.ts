"use client";

// =============================================================================
// useIdleLogout · Cierre de sesión automático por inactividad (contrato §4.7.6).
// -----------------------------------------------------------------------------
// Tras N minutos sin actividad del usuario (mousemove/keydown/click/scroll/touch)
// se cierra la sesión: se limpia el token y el usuario de localStorage y se
// redirige a /login. Un minuto antes se muestra un aviso con opción "Seguir
// conectado" que reinicia el contador.
//
// Configurable con NEXT_PUBLIC_IDLE_MINUTES (minutos de inactividad hasta el
// cierre; por defecto 20). El aviso previo aparece AVISO_MINUTOS antes del
// cierre. Los eventos de actividad se escuchan con throttle para no reprogramar
// los temporizadores en cada píxel de movimiento del ratón.
// =============================================================================

import { useEffect, useRef, useState } from "react";

/** Minutos de inactividad hasta el cierre (default 20; configurable por env). */
const IDLE_MINUTES = (() => {
  const raw = Number(process.env.NEXT_PUBLIC_IDLE_MINUTES);
  return Number.isFinite(raw) && raw > 0 ? raw : 20;
})();

/** Minutos de antelación con los que se muestra el aviso previo al cierre. */
const AVISO_MINUTOS = 1;

/** Ventana de throttle para los eventos de actividad (ms). */
const THROTTLE_MS = 1000;

const EVENTOS = ["mousemove", "mousedown", "keydown", "click", "scroll", "touchstart"] as const;

export interface EstadoIdle {
  /** true cuando se está mostrando el aviso previo al cierre. */
  avisando: boolean;
  /** Segundos restantes hasta el cierre mientras se avisa. */
  segundosRestantes: number;
  /** Reinicia el contador (botón "Seguir conectado"). */
  seguirConectado: () => void;
}

function cerrarSesion() {
  if (typeof window === "undefined") return;
  localStorage.removeItem("lims_token");
  localStorage.removeItem("lims_user");
  window.location.href = "/login";
}

/**
 * Monta la vigilancia de inactividad. Devuelve el estado del aviso para que el
 * componente que lo use pinte el modal "Seguir conectado".
 */
export function useIdleLogout(): EstadoIdle {
  const [avisando, setAvisando] = useState(false);
  const [segundosRestantes, setSegundosRestantes] = useState(AVISO_MINUTOS * 60);

  // Refs para no recrear los listeners en cada render.
  const timerAviso = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerCierre = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cuentaAtras = useRef<ReturnType<typeof setInterval> | null>(null);
  const ultimaActividad = useRef(0);
  const reiniciarRef = useRef<() => void>(() => {});
  // Ref espejo de `avisando`, para leerla dentro del listener sin re-suscribir.
  const avisandoRef = useRef(false);
  useEffect(() => {
    avisandoRef.current = avisando;
  }, [avisando]);

  useEffect(() => {
    const idleMs = IDLE_MINUTES * 60_000;
    const avisoMs = Math.max(0, idleMs - AVISO_MINUTOS * 60_000);

    const limpiarTemporizadores = () => {
      if (timerAviso.current) clearTimeout(timerAviso.current);
      if (timerCierre.current) clearTimeout(timerCierre.current);
      if (cuentaAtras.current) clearInterval(cuentaAtras.current);
      timerAviso.current = null;
      timerCierre.current = null;
      cuentaAtras.current = null;
    };

    const programar = () => {
      limpiarTemporizadores();
      // Aviso previo.
      timerAviso.current = setTimeout(() => {
        setAvisando(true);
        setSegundosRestantes(AVISO_MINUTOS * 60);
        cuentaAtras.current = setInterval(() => {
          setSegundosRestantes((s) => (s > 0 ? s - 1 : 0));
        }, 1000);
      }, avisoMs);
      // Cierre efectivo.
      timerCierre.current = setTimeout(() => {
        limpiarTemporizadores();
        cerrarSesion();
      }, idleMs);
    };

    const reiniciar = () => {
      setAvisando(false);
      setSegundosRestantes(AVISO_MINUTOS * 60);
      programar();
    };
    reiniciarRef.current = reiniciar;

    // Actividad del usuario (con throttle). Mientras se avisa, NO se reinicia
    // solo con mover el ratón: el usuario debe pulsar "Seguir conectado" o
    // dejar que el contador siga; así el aviso es intencional, no accidental.
    const onActividad = () => {
      const ahora = Date.now();
      if (ahora - ultimaActividad.current < THROTTLE_MS) return;
      ultimaActividad.current = ahora;
      if (!timerCierre.current) return; // ya cerrado
      if (!avisandoRef.current) programar();
    };

    // Se lee el estado de "avisando" desde una ref para no re-suscribir listeners.
    for (const ev of EVENTOS) {
      window.addEventListener(ev, onActividad, { passive: true });
    }
    programar();

    return () => {
      for (const ev of EVENTOS) window.removeEventListener(ev, onActividad);
      limpiarTemporizadores();
    };
    // Solo se monta una vez: la config es estática y el reinicio va por ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    avisando,
    segundosRestantes,
    seguirConectado: () => reiniciarRef.current(),
  };
}
