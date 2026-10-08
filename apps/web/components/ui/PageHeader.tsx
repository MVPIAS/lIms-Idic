"use client";

/**
 * Piezas visuales compartidas: cabecera de página, estado vacío y esqueletos de
 * carga. Viven aquí para que todas las pantallas se vean igual sin repetir estilos.
 */

import Link from "next/link";
import type { ReactNode } from "react";

export interface Miga { label: string; href?: string }

export interface PageHeaderProps {
  titulo: ReactNode;
  subtitulo?: ReactNode;
  /** migas de pan (la última suele ser la página actual, sin href). */
  migas?: Miga[];
  /** botones o enlaces a la derecha del título. */
  acciones?: ReactNode;
  /** icono/emoji opcional delante del título. */
  icono?: ReactNode;
}

/** Cabecera estándar: migas · título (+icono) · subtítulo · acciones a la derecha. */
export function PageHeader({ titulo, subtitulo, migas, acciones, icono }: PageHeaderProps) {
  return (
    <div className="page-header">
      {migas && migas.length > 0 && (
        <nav className="migas" aria-label="Ruta">
          {migas.map((m, i) => (
            <span key={`${m.label}-${i}`}>
              {i > 0 && <span className="sep" aria-hidden>›</span>}
              {m.href ? <Link href={m.href as any}>{m.label}</Link> : <span>{m.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="page-header-fila">
        <div style={{ minWidth: 0 }}>
          <h1 className="page">
            {icono && <span className="page-ico" aria-hidden>{icono}</span>}
            {titulo}
          </h1>
          {subtitulo && <p className="subtitle" style={{ marginBottom: 0 }}>{subtitulo}</p>}
        </div>
        {acciones && <div className="page-header-acciones">{acciones}</div>}
      </div>
    </div>
  );
}

/** Estado vacío amable: icono, título, texto y una acción opcional. */
export function EmptyState({
  icono = "🗂",
  titulo = "No hay registros todavía",
  texto,
  accion,
  compacto,
}: {
  icono?: ReactNode;
  titulo?: ReactNode;
  texto?: ReactNode;
  accion?: ReactNode;
  compacto?: boolean;
}) {
  return (
    <div className={`empty${compacto ? " compacto" : ""}`}>
      <div className="empty-ico" aria-hidden>{icono}</div>
      <div className="empty-tit">{titulo}</div>
      {texto && <div className="empty-txt">{texto}</div>}
      {accion && <div style={{ marginTop: 10 }}>{accion}</div>}
    </div>
  );
}

/** Barra gris animada para indicar carga. */
export function Skeleton({ w = "100%", h = 12, style }: { w?: number | string; h?: number; style?: React.CSSProperties }) {
  return <span className="skel" style={{ width: w, height: h, ...style }} aria-hidden />;
}

/** Filas de tabla «fantasma» mientras carga (para dentro de <tbody>). */
export function SkeletonRows({ cols, rows = 6 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={`sk-${r}`} className="skel-row" aria-hidden>
          {Array.from({ length: cols }).map((__, c) => (
            <td key={c}><Skeleton w={`${55 + ((r * 7 + c * 13) % 40)}%`} /></td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Rejilla de tarjetas fantasma (KPIs / bandeja) mientras carga. */
export function SkeletonCards({ n = 4, alto = 74 }: { n?: number; alto?: number }) {
  return (
    <div className="kpis">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="kpi" style={{ height: alto, borderLeftColor: "var(--line)" }}>
          <Skeleton w="50%" h={9} />
          <Skeleton w="35%" h={20} style={{ marginTop: 10 }} />
        </div>
      ))}
    </div>
  );
}
