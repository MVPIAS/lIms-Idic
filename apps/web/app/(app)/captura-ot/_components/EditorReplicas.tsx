"use client";

/**
 * Corrección de réplicas de un resultado por analito (catálogo antiguo) dentro
 * de «Captura y revisión por OT». Antes se hacía en la pantalla suelta
 * /captura, que no pedía motivo; ahora rige la misma regla de corrección que la
 * captura por valor: si el ensayo ya tiene un valor capturado sin revisar, el
 * motivo es obligatorio (mínimo 5 caracteres) y queda en el historial del
 * resultado; tras una devolución vale el motivo de la devolución.
 *
 * API: POST /resultados/:id/recapturar { replicasTexto, equipoId?, motivo? }
 */
import { useMemo, useState } from "react";
import { num } from "@/lib/format";
import { leerReplicas, llamar } from "@/lib/laboratorio";
import { toast } from "@/components/ui/feedback";
import type { EquipoCaptura } from "./EditorEnsayo";

export interface ResultadoReplicas {
  id: string;
  estado: string;
  analito: string;
  unidad: string | null;
  replicas: number[];
  promedio: number | string | null;
  resultadoFinal: number | string | null;
  equipoId?: string | null;
  motivoDevolucion: string | null;
}

/** ¿Corregir este resultado exige motivo? (capturado con valor, sin revisar) */
export const exigeMotivoReplicas = (r: ResultadoReplicas) =>
  r.estado === "capturado" && ((r.promedio != null && r.promedio !== "") || (r.resultadoFinal != null && r.resultadoFinal !== ""));

function estadistica(xs: number[]) {
  const n = xs.length;
  if (!n) return null;
  const m = xs.reduce((a, b) => a + b, 0) / n;
  const s = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)) : 0;
  return { n, promedio: m, desviacion: s, cv: m ? (s / Math.abs(m)) * 100 : 0 };
}

export default function EditorReplicas({
  r,
  equipos,
  onGuardado,
  onCerrar,
}: {
  r: ResultadoReplicas;
  equipos: EquipoCaptura[];
  onGuardado: () => void;
  onCerrar: () => void;
}) {
  const [texto, setTexto] = useState(() => r.replicas.map((x) => String(x).replace(".", ",")).join(" "));
  const [equipoId, setEquipoId] = useState(r.equipoId ?? "");
  const [motivo, setMotivo] = useState("");
  const [err, setErr] = useState("");
  const [guardando, setGuardando] = useState(false);
  const lectura = useMemo(() => leerReplicas(texto), [texto]);
  const st = estadistica(lectura.valores);
  const pideMotivo = exigeMotivoReplicas(r);
  const equipo = equipos.find((e) => e.id === equipoId);
  const id = `rep-${r.id}`;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (lectura.invalidos.length) { setErr(`No se entiende como número: ${lectura.invalidos.map((t) => `«${t}»`).join(", ")}. Escriba 12,4 o 12.4 y separe las réplicas con espacio.`); return; }
    if (!lectura.valores.length) { setErr("Ingrese al menos una réplica."); return; }
    if (equipo && !equipo.apto) { setErr(`El equipo ${equipo.codigo} no se puede usar: ${equipo.motivo ?? "no está apto"}.`); return; }
    if (pideMotivo && motivo.trim().length < 5) { setErr("Este ensayo ya tiene un valor: indique el motivo de la corrección (mínimo 5 caracteres)."); return; }
    setGuardando(true);
    try {
      await llamar("POST", `/resultados/${r.id}/recapturar`, {
        replicasTexto: texto,
        ...(equipoId ? { equipoId } : {}),
        ...(motivo.trim() ? { motivo: motivo.trim() } : {}),
      });
      toast.ok("Réplicas corregidas: el resultado vuelve a revisión.");
      onGuardado();
    } catch (x: any) {
      setErr(x.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} aria-label={`Corregir las réplicas de ${r.analito}`} style={{ display: "grid", gap: 10, padding: "4px 2px" }}>
      <p style={{ margin: 0, fontSize: 12.5 }}>
        <b>Corregir réplicas · {r.analito}</b>. Se recalculan promedio, desviación, CV, fórmula y veredicto en el mismo resultado, que vuelve a
        «capturado» y pasa de nuevo por revisión y aprobación.
        {r.estado === "devuelto" && r.motivoDevolucion ? <> Motivo de la devolución: <b>{r.motivoDevolucion}</b>.</> : null}
      </p>
      <div className="form-grid cols-2" style={{ margin: 0 }}>
        <div className="field">
          <label htmlFor={`${id}-rep`}>Réplicas <span className="req">*</span></label>
          <input id={`${id}-rep`} value={texto} onChange={(e) => setTexto(e.target.value)} aria-describedby={`${id}-rep-ayuda`}
            style={{ fontFamily: "'JetBrains Mono', monospace" }} autoFocus />
          <small id={`${id}-rep-ayuda`} style={{ color: lectura.invalidos.length ? "var(--red)" : "var(--muted)" }}>
            {lectura.invalidos.length
              ? `No se entiende como número: ${lectura.invalidos.map((t) => `«${t}»`).join(", ")}.`
              : "Separadas por espacio o punto y coma; coma decimal (12,4)."}
            {st && !lectura.invalidos.length && <> n = {st.n} · promedio {num(st.promedio, 4)} · DE {num(st.desviacion, 4)} · CV {num(st.cv, 2)} %{r.unidad ? ` (${r.unidad})` : ""}</>}
          </small>
        </div>
        <div className="field">
          <label htmlFor={`${id}-eq`}>Equipo usado</label>
          <select id={`${id}-eq`} value={equipoId} onChange={(e) => setEquipoId(e.target.value)}>
            <option value="">Sin equipo</option>
            {equipos.map((x) => (
              <option key={x.id} value={x.id} disabled={!x.apto && x.id !== r.equipoId}>
                {x.codigo} · {x.nombre}{x.apto ? "" : ` — ${x.motivo}`}
              </option>
            ))}
          </select>
          {equipo && !equipo.apto && <small style={{ color: "var(--red)" }}>No apto: {equipo.motivo}. Elija otro.</small>}
        </div>
      </div>
      <div className="field" style={{ maxWidth: 620 }}>
        <label htmlFor={`${id}-motivo`}>Motivo de la corrección {pideMotivo && <span className="req">*</span>}</label>
        <input id={`${id}-motivo`} value={motivo} maxLength={1000} onChange={(e) => setMotivo(e.target.value)} aria-describedby={`${id}-motivo-ayuda`} />
        <small id={`${id}-motivo-ayuda`} style={{ color: "var(--muted)" }}>
          {pideMotivo ? "Obligatorio: el ensayo ya tiene un valor capturado. Queda en el historial del resultado." : "Opcional: si no lo indica, queda el de la devolución."}
        </small>
      </div>
      {err && <div className="alert warn" role="alert" style={{ margin: 0 }}>{err}</div>}
      <div className="toolbar" style={{ margin: 0 }}>
        <button type="button" className="btn outline sm" onClick={onCerrar}>Cancelar</button>
        <button type="submit" className="btn primary sm" disabled={guardando}>{guardando ? "Guardando…" : "Guardar corrección → revisión"}</button>
      </div>
    </form>
  );
}
