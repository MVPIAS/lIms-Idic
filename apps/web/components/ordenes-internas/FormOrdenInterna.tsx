"use client";

/**
 * Formulario de una orden interna (crear o editar mientras está abierta):
 * laboratorio de destino, ensayos del catálogo de ese laboratorio y detalle.
 * Los ensayos que ya figuran en la OT (resultados o cotización) aparecen
 * primero y marcados «en la OT».
 */
import { useEffect, useMemo, useState } from "react";
import Modal from "@/components/documentos/Modal";
import { llamar } from "@/lib/laboratorio";
import { toast } from "@/components/ui/feedback";
import type { DestinoOi, EnsayoRef, OrdenInterna } from "./ordenesInternas";

type EnsayoDestino = EnsayoRef & { enOt: boolean };

export default function FormOrdenInterna({
  otId,
  otCodigo,
  orden,
  destinoUnidadSugerida,
  onGuardada,
  onCerrar,
}: {
  otId: string;
  otCodigo?: string | null;
  /** Orden a editar (solo si está abierta); sin ella, se crea una nueva. */
  orden?: OrdenInterna | null;
  /** Unidad (laboratorio) que se propone como destino, p. ej. desde la recepción de la muestra. */
  destinoUnidadSugerida?: string | null;
  onGuardada: (o: OrdenInterna) => void;
  onCerrar: () => void;
}) {
  const [destinos, setDestinos] = useState<DestinoOi[] | null>(null);
  const [destino, setDestino] = useState<string>(orden?.destinoLab ?? "");
  const [ensayos, setEnsayos] = useState<EnsayoDestino[] | null>(null);
  const [elegidos, setElegidos] = useState<Set<string>>(new Set(orden?.ensayos ?? []));
  const [filtro, setFiltro] = useState("");
  const [detalle, setDetalle] = useState(orden?.detalle ?? "");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    llamar<DestinoOi[]>("GET", `/ordenes-internas/destinos?otId=${otId}`)
      .then((d) => {
        setDestinos(d);
        if (!orden && destinoUnidadSugerida) {
          const s = d.find((x) => x.unidadId === destinoUnidadSugerida);
          if (s) setDestino(s.id);
        }
      })
      .catch((e) => { setDestinos([]); setError(e.message); });
  }, [otId, orden, destinoUnidadSugerida]);

  useEffect(() => {
    if (!destino) { setEnsayos(null); return; }
    let vivo = true;
    setEnsayos(null);
    llamar<EnsayoDestino[]>("GET", `/ordenes-internas/destinos/${destino}/ensayos?otId=${otId}`)
      .then((e) => vivo && setEnsayos(e))
      .catch((e) => { if (vivo) { setEnsayos([]); setError(e.message); } });
    return () => { vivo = false; };
  }, [destino, otId]);

  const visibles = useMemo(() => {
    const t = filtro.trim().toLowerCase();
    return (ensayos ?? []).filter((e) => !t || e.nombre.toLowerCase().includes(t) || e.codigo.toLowerCase().includes(t));
  }, [ensayos, filtro]);

  const cambiarDestino = (id: string) => {
    setDestino(id);
    setElegidos(new Set());
    setFiltro("");
  };
  const alternar = (id: string) =>
    setElegidos((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });

  async function guardar() {
    setError("");
    if (!destino) { setError("Elija el laboratorio de destino."); return; }
    if (!elegidos.size) { setError("Marque al menos un ensayo que debe hacer el laboratorio de destino."); return; }
    setGuardando(true);
    try {
      const cuerpo = { destinoLab: destino, ensayos: [...elegidos], detalle: detalle.trim() || (orden ? null : undefined) };
      const r = orden
        ? await llamar<OrdenInterna>("PATCH", `/ordenes-internas/${orden.id}`, cuerpo)
        : await llamar<OrdenInterna>("POST", "/ordenes-internas", { otId, tipo: "interna", ...cuerpo });
      toast.ok(orden ? `Orden interna ${orden.numero} actualizada.` : `Orden interna ${r.numero} emitida.`);
      onGuardada(r);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  const destinoSel = destinos?.find((d) => d.id === destino);
  return (
    <Modal
      titulo={orden ? `Editar la orden interna ${orden.numero}` : `Nueva orden interna${otCodigo ? ` · ${otCodigo}` : ""}`}
      onCerrar={onCerrar}
      ancho={720}
      acciones={
        <>
          <button type="button" className="btn outline sm" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="btn primary sm" disabled={guardando} onClick={guardar}>
            {guardando ? "Guardando…" : orden ? "Guardar cambios" : "Emitir orden interna"}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0, color: "var(--muted)" }}>
        Deriva parte de la OT a otro laboratorio. Ese laboratorio verá la OT y solo los ensayos que le correspondan.
        Se puede editar mientras siga <b>abierta</b> (antes de que el laboratorio de destino la reciba).
      </p>
      {error && <div className="alert warn" role="alert">{error}</div>}
      <div className="form-grid cols-2">
        <div className="field">
          <label htmlFor="oi-destino">Laboratorio de destino <span className="req">*</span></label>
          <select id="oi-destino" value={destino} onChange={(e) => cambiarDestino(e.target.value)} disabled={destinos === null}>
            <option value="">{destinos === null ? "Cargando laboratorios…" : "— Seleccione —"}</option>
            {(destinos ?? []).map((d) => (
              <option key={d.id} value={d.id}>{d.unidadCodigo} · {d.nombre} ({d.ensayos} ensayos)</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="oi-filtro">Buscar ensayo</label>
          <input id="oi-filtro" value={filtro} onChange={(e) => setFiltro(e.target.value)} disabled={!destino} placeholder="Nombre o código" />
        </div>
      </div>

      <fieldset style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 8, margin: "10px 0" }}>
        <legend style={{ fontSize: 12.5, fontWeight: 700, padding: "0 4px" }}>
          Ensayos que hará {destinoSel ? destinoSel.unidadCodigo : "el laboratorio de destino"} <span className="req">*</span>
          {elegidos.size ? <span style={{ fontWeight: 400, color: "var(--muted)" }}> · {elegidos.size} marcado(s)</span> : null}
        </legend>
        {!destino ? (
          <p style={{ margin: 4, color: "var(--muted)" }}>Elija primero el laboratorio de destino.</p>
        ) : ensayos === null ? (
          <p style={{ margin: 4, color: "var(--muted)" }}>Cargando ensayos…</p>
        ) : visibles.length === 0 ? (
          <p style={{ margin: 4, color: "var(--muted)" }}>{ensayos.length ? "Ningún ensayo coincide con la búsqueda." : "Este laboratorio no tiene ensayos vigentes en el catálogo."}</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: 260, overflowY: "auto", display: "grid", gap: 2 }}>
            {visibles.map((e) => (
              <li key={e.id}>
                <label style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "3px 4px", cursor: "pointer", borderRadius: 4, background: elegidos.has(e.id) ? "#eef6fb" : undefined }}>
                  <input type="checkbox" checked={elegidos.has(e.id)} onChange={() => alternar(e.id)} style={{ marginTop: 2 }} />
                  <span>
                    <span className="codigo">{e.codigo}</span> {e.nombre}
                    {e.enOt && <span className="pill blue" style={{ marginLeft: 6 }}>en la OT</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <div className="field">
        <label htmlFor="oi-detalle">Detalle para el laboratorio de destino</label>
        <textarea id="oi-detalle" rows={3} maxLength={4000} value={detalle} onChange={(e) => setDetalle(e.target.value)}
          placeholder="Qué muestra, condiciones o plazos (opcional)" />
      </div>
    </Modal>
  );
}
