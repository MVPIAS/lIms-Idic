"use client";

// =============================================================================
// IdleLogout · Aviso y cierre de sesión por inactividad (contrato §4.7.6).
// Monta la vigilancia (useIdleLogout) y pinta el modal "Seguir conectado" un
// minuto antes del cierre. Se coloca en el layout autenticado para que aplique
// a toda la aplicación. No renderiza nada mientras no haya que avisar.
// =============================================================================

import { useIdleLogout } from "@/lib/useIdleLogout";

function mmss(seg: number): string {
  const m = Math.floor(seg / 60);
  const s = seg % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function IdleLogout() {
  const { avisando, segundosRestantes, seguirConectado } = useIdleLogout();

  if (!avisando) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="idle-titulo"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(18,33,47,.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: 12,
          boxShadow: "0 16px 48px rgba(0,0,0,.25)",
          padding: "22px 24px",
          width: 380,
          maxWidth: "92vw",
          textAlign: "center",
        }}
      >
        <h2 id="idle-titulo" style={{ margin: "0 0 8px", fontSize: 16, color: "var(--ink)" }}>
          Tu sesión se cerrará por inactividad
        </h2>
        <p style={{ margin: "0 0 6px", color: "var(--muted)", fontSize: 13 }}>
          Por seguridad, cerraremos tu sesión automáticamente si no hay actividad.
        </p>
        <div
          style={{
            fontSize: 30,
            fontWeight: 700,
            color: "var(--accent)",
            margin: "8px 0 16px",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {mmss(segundosRestantes)}
        </div>
        <button className="btn" style={{ width: "100%" }} onClick={seguirConectado} autoFocus>
          Seguir conectado
        </button>
      </div>
    </div>
  );
}
