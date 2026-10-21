/**
 * Barra horizontal de pasos numerados del procedimiento, como en las maquetas
 * (hecho ✓ · actual resaltado · pendiente en gris). `actual` = paso en curso
 * (1-based); los anteriores se pintan hechos. `anulado` marca todo como anulado.
 */
import s from "./PasosProceso.module.css";

export interface PasoBarra {
  titulo: string;
  /** Quién lo hace o un detalle corto. */
  detalle?: string | null;
}

export default function PasosProceso({
  pasos,
  actual,
  completo,
  anulado,
  etiqueta,
}: {
  pasos: PasoBarra[];
  actual: number;
  /** Todos los pasos hechos (el último incluido). */
  completo?: boolean;
  anulado?: boolean;
  etiqueta: string;
}) {
  return (
    <ol className={s.barra} aria-label={etiqueta}>
      {pasos.map((p, i) => {
        const n = i + 1;
        const estado = anulado ? "anulado" : completo || n < actual ? "hecho" : n === actual ? "actual" : "pend";
        const leyenda = { hecho: "hecho", actual: "paso actual", pend: "pendiente", anulado: "anulado" }[estado];
        return (
          <li key={p.titulo} className={`${s.paso} ${s[estado]}`} aria-current={estado === "actual" ? "step" : undefined}>
            <span className={s.dot} aria-hidden>{estado === "hecho" ? "✓" : n}</span>
            <span className={s.txt}>
              {p.titulo}
              <span className="sr-only"> · {leyenda}</span>
              {p.detalle && <small>{p.detalle}</small>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
