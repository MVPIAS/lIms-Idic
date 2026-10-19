"use client";

/**
 * Asociar, cambiar o quitar la clasificación de sustancia de un producto de la
 * O/C después de crearla (pauta BPCH, caso P1, paso 4). Solo se asocia una
 * clasificación APROBADA; las que están en borrador, registradas o devueltas
 * se muestran, pero no se pueden elegir. Pide motivo y muestra el historial.
 * API: POST /bpch/pn/oc/:id/productos/:productoId/clasificacion
 */
import { useEffect, useMemo, useState } from "react";
import Modal from "@/components/documentos/Modal";
import { llamar } from "@/lib/laboratorio";
import { fechaHora } from "@/lib/format";
import { toast } from "@/components/ui/feedback";

type Clas = { id: string; codigo: string; version: number; sustancia: string; estado: string; resumen?: string | null };

const ESTADO_CLAS: Record<string, string> = {
  borrador: "en borrador",
  registrada: "registrada, sin aprobar",
  devuelta: "devuelta",
  aprobada: "aprobada",
  reemplazada: "reemplazada",
  anulada: "anulada",
};

export default function ClasificacionProducto({
  ocId,
  producto,
  onCerrar,
  onGuardada,
}: {
  ocId: string;
  producto: any;
  onCerrar: () => void;
  onGuardada: (oc: any) => void;
}) {
  const [clases, setClases] = useState<Clas[] | null>(null);
  const [sel, setSel] = useState<string>(producto.clasificacion?.id ?? "");
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    llamar<{ data: Clas[] }>("GET", "/bpch/clasificaciones?limit=500")
      .then((r) => setClases(r.data))
      .catch((e) => { setClases([]); setError(e.message); });
  }, []);

  const codigo = (c: Clas) => (c.version > 1 ? `${c.codigo}-V${c.version}` : c.codigo);
  const aprobadas = useMemo(() => (clases ?? []).filter((c) => c.estado === "aprobada"), [clases]);
  const otras = useMemo(() => (clases ?? []).filter((c) => c.estado !== "aprobada" && c.estado !== "anulada" && c.estado !== "reemplazada"), [clases]);
  const actual = producto.clasificacion?.id ?? "";
  const cambia = sel !== actual;

  async function guardar() {
    setError("");
    if (!cambia) { setError("Elija una clasificación distinta de la actual."); return; }
    if (motivo.trim().length < 5) { setError("Indique el motivo (mínimo 5 caracteres)."); return; }
    setBusy(true);
    try {
      const oc = await llamar("POST", `/bpch/pn/oc/${ocId}/productos/${producto.id}/clasificacion`, { clasificacionId: sel || null, motivo: motivo.trim() });
      toast.ok(sel ? "Clasificación asociada al producto." : "Clasificación quitada del producto.");
      onGuardada(oc);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const historial: any[] = producto.historialClasificacion ?? [];
  return (
    <Modal
      titulo={`Clasificación de ${producto.producto}`}
      onCerrar={onCerrar}
      ancho={640}
      acciones={
        <>
          <button type="button" className="btn outline sm" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="btn primary sm" disabled={busy} onClick={guardar}>
            {busy ? "Guardando…" : sel ? (actual ? "Cambiar clasificación" : "Asociar clasificación") : "Quitar clasificación"}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0, color: "var(--muted)" }}>
        Solo se asocia una clasificación <b>aprobada</b> (Clasificación de sustancias). El cambio queda en el historial con su motivo y la
        clasificación muestra en qué O/C se usa.
      </p>
      {error && <div className="alert warn" role="alert">{error}</div>}
      <div className="field">
        <label htmlFor="clas-sel">Clasificación</label>
        <select id="clas-sel" value={sel} onChange={(e) => setSel(e.target.value)} disabled={clases === null}>
          <option value="">{clases === null ? "Cargando clasificaciones…" : "— Sin clasificación —"}</option>
          {aprobadas.length > 0 && (
            <optgroup label="Aprobadas">
              {aprobadas.map((c) => <option key={c.id} value={c.id}>{codigo(c)} · {c.sustancia}{c.resumen ? ` · ${c.resumen}` : ""}</option>)}
            </optgroup>
          )}
          {otras.length > 0 && (
            <optgroup label="Sin aprobar (no se pueden asociar)">
              {otras.map((c) => <option key={c.id} value={c.id} disabled>{codigo(c)} · {c.sustancia} — {ESTADO_CLAS[c.estado] ?? c.estado}</option>)}
            </optgroup>
          )}
        </select>
        {clases && !aprobadas.length && <small style={{ color: "var(--muted)" }}>No hay clasificaciones aprobadas. Apruebe una en BPCH · Certificación › Clasificación de sustancias.</small>}
      </div>
      <div className="field" style={{ marginTop: 8 }}>
        <label htmlFor="clas-motivo">Motivo <span className="req">*</span></label>
        <textarea id="clas-motivo" rows={2} maxLength={2000} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </div>
      {historial.length > 0 && (
        <>
          <h4 style={{ margin: "12px 0 4px", fontSize: 13 }}>Historial de la clasificación</h4>
          <table className="data">
            <thead><tr><th>Fecha</th><th>Quién</th><th>Antes</th><th>Después</th><th>Motivo</th></tr></thead>
            <tbody>
              {historial.map((h) => (
                <tr key={h.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{fechaHora(h.at)}</td>
                  <td>{h.usuario ?? "—"}</td>
                  <td>{h.anterior ?? "—"}</td>
                  <td>{h.nueva ?? "—"}</td>
                  <td>{h.motivo ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Modal>
  );
}
