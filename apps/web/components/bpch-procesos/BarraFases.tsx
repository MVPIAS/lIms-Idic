"use client";

/**
 * Barra horizontal de fases con «Siguiente paso · Le toca a» (T14, frente r4c;
 * BL-216 O/C de Producción Nacional, BL-217 prototipos y clasificación). Las
 * fases se deducen del estado real que ya muestra la pantalla: la actual es la
 * primera que no está hecha (una sola, como en la Ruta de la OT); las que no
 * aplican se ven atenuadas.
 */
export interface FaseProceso {
  clave: string;
  titulo: string;
  hecho: boolean;
  /** false = no aplica a este expediente. */
  aplica?: boolean;
  detalle?: string | null;
  /** Rol que actúa en esta fase (para «Le toca a»). */
  leToca?: string;
  /** Qué hacer en esta fase (texto del siguiente paso). */
  accion?: string;
}

export function faseActual(fases: FaseProceso[]): FaseProceso | null {
  return fases.find((f) => f.aplica !== false && !f.hecho) ?? null;
}

export default function BarraFases({ fases, etiqueta = "Avance" }: { fases: FaseProceso[]; etiqueta?: string }) {
  const actual = faseActual(fases);
  return (
    <div style={{ marginBottom: 12 }}>
      <nav className="stepper" aria-label={etiqueta}>
        {fases.map((f, i) => {
          const noAplica = f.aplica === false;
          const ahora = actual?.clave === f.clave;
          return (
            <div
              key={f.clave}
              className={`step ${f.hecho ? "done" : ahora ? "now" : "locked"}`}
              style={{ cursor: "default", opacity: noAplica ? 0.45 : undefined }}
              aria-current={ahora ? "step" : undefined}
            >
              <div className="dot" aria-hidden>{f.hecho ? "✓" : noAplica ? "–" : i + 1}</div>
              <div className="txt">
                {f.titulo}
                <small>{noAplica ? "No aplica" : f.detalle ?? (f.hecho ? "Hecho" : ahora ? "En curso" : "Pendiente")}</small>
              </div>
            </div>
          );
        })}
      </nav>
      {actual ? (
        <div className="alert info" style={{ margin: "8px 0 0", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
          <b>Siguiente paso:</b> <span>{actual.accion ?? actual.titulo}</span>
          {actual.leToca && <span style={{ color: "var(--muted)" }}>· Le toca a: <b style={{ color: "var(--ink)" }}>{actual.leToca}</b></span>}
        </div>
      ) : (
        <div className="alert success" style={{ margin: "8px 0 0" }}>Todas las fases están hechas.</div>
      )}
    </div>
  );
}
