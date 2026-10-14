"use client";

/**
 * SelectorLaboratorio · «Laboratorio responsable» de una OT.
 *
 * Toda OT nace con su laboratorio: sin él nadie del laboratorio la ve. Si se
 * pasan pistas del catálogo (cotización, centro de costo, elementos, métodos),
 * se pide al servidor la sugerencia (GET /ot/laboratorio-sugerido) y se
 * preselecciona; la persona puede cambiarla. Si las pistas apuntan a varios
 * laboratorios o no hay ninguna, se avisa y hay que elegir.
 */
import { useEffect, useId, useState } from "react";
import { llamar, qs, type Unidad } from "@/lib/laboratorio";

export interface PistasLaboratorio {
  cotizacionId?: string;
  centroCostoId?: string;
  elementoIds?: string[];
  metodoIds?: string[];
}

interface Sugerencia {
  unidad: Unidad | null;
  motivo: "deducido" | "sin_pistas" | "ambiguo";
  candidatos: string[];
  fuentes: string[];
}

const FUENTE: Record<string, string> = {
  centro_costo: "el centro de costo",
  ensayo: "los ensayos",
  elemento: "los elementos",
  metodo: "los métodos",
};

export default function SelectorLaboratorio({
  valor,
  onCambio,
  pistas,
  requerido = true,
  etiqueta = "Laboratorio responsable",
  excluirId,
}: {
  valor: string;
  onCambio: (unidadId: string) => void;
  pistas?: PistasLaboratorio;
  requerido?: boolean;
  etiqueta?: string;
  /** laboratorio actual, para no ofrecerlo al cambiar */
  excluirId?: string | null;
}) {
  const id = useId();
  const [labs, setLabs] = useState<Unidad[]>([]);
  const [sug, setSug] = useState<Sugerencia | null>(null);
  const [tocado, setTocado] = useState(false);
  const clave = JSON.stringify(pistas ?? {});

  useEffect(() => {
    llamar<Unidad[]>("GET", "/ot/laboratorios").then(setLabs).catch(() => setLabs([]));
  }, []);

  useEffect(() => {
    if (!pistas) return;
    const p = {
      cotizacionId: pistas.cotizacionId,
      centroCostoId: pistas.centroCostoId,
      elementoIds: (pistas.elementoIds ?? []).filter(Boolean).join(","),
      metodoIds: (pistas.metodoIds ?? []).filter(Boolean).join(","),
    };
    if (!p.cotizacionId && !p.centroCostoId && !p.elementoIds && !p.metodoIds) {
      setSug(null);
      return;
    }
    let vivo = true;
    llamar<Sugerencia>("GET", `/ot/laboratorio-sugerido${qs(p)}`)
      .then((s) => {
        if (!vivo) return;
        setSug(s);
        // Se preselecciona la sugerencia mientras la persona no haya elegido otra.
        if (!tocado) {
          if (s.unidad) onCambio(s.unidad.id);
          else if (s.motivo === "ambiguo") onCambio("");
        }
      })
      .catch(() => vivo && setSug(null));
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  const nombre = (uid: string) => labs.find((l) => l.id === uid)?.codigo ?? "";

  return (
    <div className="field">
      <label htmlFor={id}>{etiqueta} {requerido && <span className="req">*</span>}</label>
      <select id={id} value={valor} onChange={(e) => { setTocado(true); onCambio(e.target.value); }}>
        <option value="">— Seleccione el laboratorio —</option>
        {labs.filter((l) => l.id !== excluirId).map((l) => (
          <option key={l.id} value={l.id}>{l.codigo} · {l.nombre}</option>
        ))}
      </select>
      {sug?.motivo === "deducido" && sug.unidad && (
        <span className="hint" style={{ marginTop: 4, fontSize: 11.5, color: "var(--muted)" }}>
          Sugerido por {sug.fuentes.map((f) => FUENTE[f] ?? f).join(" y ")}: <b>{sug.unidad.codigo}</b>
          {valor && valor !== sug.unidad.id ? " (usted eligió otro)" : ""}.
        </span>
      )}
      {sug?.motivo === "ambiguo" && (
        <span style={{ marginTop: 4, fontSize: 11.5, color: "var(--amber, #7a4b00)" }}>
          Los ensayos corresponden a varios laboratorios ({sug.candidatos.map(nombre).filter(Boolean).join(", ")}): elija el responsable.
        </span>
      )}
      {pistas && sug?.motivo === "sin_pistas" && (
        <span style={{ marginTop: 4, fontSize: 11.5, color: "var(--muted)" }}>
          El catálogo no indica el laboratorio: elíjalo.
        </span>
      )}
    </div>
  );
}
