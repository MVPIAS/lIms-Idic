"use client";

/**
 * «Ruta de la OT»: barra de etapas del expediente y recuadro «Siguiente paso ·
 * Le toca a». Ambos pintan la MISMA respuesta de GET /ot/:id/avance, que el
 * servidor deduce del estado real de la OT (apps/api/src/ot/avance-ot.ts):
 * nada se calcula aquí, así que la barra y el siguiente paso no se contradicen.
 * Reglas: docs/FLUJO_LABORATORIO.md §«Ruta de la OT».
 */
import Link from "next/link";
import { fecha } from "@/lib/format";

export type EstadoEtapa = "hecho" | "en_curso" | "pendiente" | "no_aplica" | "bloqueado";
export type PestanaOt = "cabecera" | "asignacion" | "muestreo" | "muestras" | "preparacion" | "instrumentos" | "resultados" | "informe";

export interface AvanceOt {
  tipo: "laboratorio" | "interna" | "metrologia" | "internacion" | "reinspeccion";
  etapas: { clave: string; titulo: string; estado: EstadoEtapa; detalle: string | null }[];
  etapaActual: string | null;
  siguiente: {
    etapa: string;
    texto: string;
    leToca: { rol: string; unidad: string | null; personas: string[] } | null;
    accion: { texto: string; pestana?: PestanaOt; ruta?: string } | null;
    puedoActuar: boolean;
  } | null;
  cierre: { fecha: string | null; conCobro: boolean; factura: { numero: string; estado: string } | null } | null;
  avisos: string[];
}

const TIPO: Record<AvanceOt["tipo"], string> = {
  laboratorio: "Ruta de la OT",
  interna: "Ruta de la OT interna",
  metrologia: "Ruta de la calibración",
  internacion: "Ruta de la internación (BPCH)",
  reinspeccion: "Ruta de la reinspección (BPCH)",
};
const ICONO: Record<EstadoEtapa, string> = { hecho: "✓", en_curso: "", pendiente: "", no_aplica: "–", bloqueado: "!" };
const CLASE: Record<EstadoEtapa, string> = { hecho: "done", en_curso: "now", pendiente: "pend", no_aplica: "na", bloqueado: "bloq" };
const LEYENDA: Record<EstadoEtapa, string> = { hecho: "Hecho", en_curso: "Etapa actual", pendiente: "Pendiente", no_aplica: "No aplica", bloqueado: "Bloqueada" };

/** Barra vertical de etapas (columna izquierda del expediente). */
export function EtapasOt({ avance, error }: { avance: AvanceOt | null; error?: boolean }) {
  if (!avance) {
    return (
      <nav className="stepper ruta-ot" aria-label="Ruta de la OT" aria-busy={!error}>
        <div className="ruta-tit">Ruta de la OT</div>
        <p className="ruta-cargando" role={error ? "status" : undefined}>
          {error ? "No se pudo calcular el avance de la OT. Recargue la página para intentarlo de nuevo." : "Calculando el avance…"}
        </p>
      </nav>
    );
  }
  let n = 0;
  return (
    <nav className="stepper ruta-ot" aria-label={TIPO[avance.tipo]}>
      <div className="ruta-tit">{TIPO[avance.tipo]}</div>
      <ol>
        {avance.etapas.map((e) => {
          if (e.estado !== "no_aplica") n += 1;
          const actual = e.clave === avance.etapaActual;
          return (
            <li key={e.clave} className={`step ${CLASE[e.estado]}`} aria-current={actual ? "step" : undefined}>
              <div className="dot" aria-hidden>{ICONO[e.estado] || n}</div>
              <div className="txt">
                {e.titulo}
                <span className="sr-only"> · {LEYENDA[e.estado]}</span>
                <small>{e.estado === "no_aplica" ? (e.detalle ? `No aplica · ${e.detalle}` : "No aplica") : e.detalle ?? LEYENDA[e.estado]}</small>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

const TEXTO_FACTURA: Record<string, string> = {
  pendiente: "por emitir",
  emitida: "pago pendiente",
  parcial: "pago parcial",
  pagada: "pagada",
};

function quien(l: NonNullable<AvanceOt["siguiente"]>["leToca"]) {
  if (!l) return null;
  const rol = `${l.rol}${l.unidad ? ` ${l.unidad}` : ""}`;
  return l.personas.length ? `${rol} (${l.personas.join(", ")})` : rol;
}

/**
 * Recuadro «Siguiente paso · Le toca a» encima de las pestañas. El botón solo
 * aparece si el servidor dice que el usuario puede hacerlo; si no, «Esperando a…».
 */
export function SiguientePasoOt({ avance, otId, onPestana }: { avance: AvanceOt | null; otId: string; onPestana: (p: PestanaOt) => void }) {
  if (!avance) return null;
  const s = avance.siguiente;
  const c = avance.cierre;
  const quienEs = s ? quien(s.leToca) : null;
  const boton = s?.accion && s.puedoActuar
    ? s.accion.pestana
      ? <button type="button" className="btn primary sm" onClick={() => onPestana(s.accion!.pestana!)}>{s.accion.texto}</button>
      : s.accion.ruta
        ? <Link href={s.accion.ruta as any} className="btn primary sm">{s.accion.texto}</Link>
        : null
    : null;
  // La anulación ya se dice en el texto y la OPI pendiente tiene su propio bloque en el expediente.
  const avisos = avance.avisos.filter((a) => a !== "La OT está anulada." && !a.startsWith("OPI pendiente"));
  const bloqueado = avance.etapas.some((e) => e.clave === avance.etapaActual && e.estado === "bloqueado");

  return (
    <section className={`siguiente-paso${c ? " cerrada" : ""}${bloqueado ? " bloq" : ""}`} aria-label="Siguiente paso de la OT" data-ot={otId}>
      {c && (
        <div className="sp-cierre">
          <b>OT cerrada el {fecha(c.fecha)}</b>
          {c.factura
            ? <> · Factura {c.factura.numero} ({TEXTO_FACTURA[c.factura.estado] ?? c.factura.estado})</>
            : c.conCobro ? " · sin factura" : " · sin cobro"}
        </div>
      )}
      {s ? (
        <div className="sp-fila">
          <div className="sp-texto">
            <div><span className="sp-etq">Siguiente paso</span> {s.texto}</div>
            {quienEs && (
              <div className="sp-quien">
                <span className="sp-etq">Le toca a</span> {quienEs}
                {!boton && <span className="sp-espera"> · Esperando a que lo haga {s.leToca?.personas.length ? "la persona indicada" : "ese rol"}</span>}
              </div>
            )}
          </div>
          {boton}
        </div>
      ) : !c ? (
        <div className="sp-fila"><div className="sp-texto">{avance.avisos.includes("La OT está anulada.") ? "La OT está anulada: no tiene pasos pendientes." : "No quedan pasos pendientes."}</div></div>
      ) : null}
      {avisos.length > 0 && (
        <ul className="sp-avisos">
          {avisos.map((a) => <li key={a}>{a}</li>)}
        </ul>
      )}
    </section>
  );
}
