"use client";

/**
 * «Distribución · muestra {Nº}» (EP-02 1.3, BL-212): porción entregada a cada
 * laboratorio que tiene ensayos en la muestra, con fecha y hora (hora de Chile)
 * y quién la recibe. «Distribuir → laboratorios». La porción de microbiología
 * se separa primero y en condiciones asépticas (por confirmar con el IDIC).
 */
import { useEffect, useState } from "react";
import Modal from "@/components/documentos/Modal";
import { llamar } from "@/lib/laboratorio";
import { aInputHoraChile, deInputHoraChile, fechaHora } from "@/lib/format";
import { toast } from "@/components/ui/feedback";

interface Vista {
  muestra: { id: string; codigo: string };
  laboratorios: { unidadId: string; codigo: string; nombre: string; ensayos: string }[];
  distribucion: { unidadId: string; codigo: string; porcion: string; fechaHora: string; recibidoPor: string; registradoPor: string | null }[];
  puedeDistribuir: boolean;
}
type Fila = { incluir: boolean; porcion: string; fecha: string; recibidoPor: string };

export default function DistribucionMuestra({ muestraId, onCerrar }: { muestraId: string; onCerrar: () => void }) {
  const [v, setV] = useState<Vista | null>(null);
  const [filas, setFilas] = useState<Record<string, Fila>>({});
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const aplicar = (x: Vista) => {
    setV(x);
    const ahora = aInputHoraChile(new Date());
    setFilas(Object.fromEntries(x.laboratorios.map((l) => {
      const d = x.distribucion.find((y) => y.unidadId === l.unidadId);
      return [l.unidadId, { incluir: true, porcion: d?.porcion ?? "", fecha: d ? aInputHoraChile(d.fechaHora) : ahora, recibidoPor: d?.recibidoPor ?? "" }];
    })));
  };
  useEffect(() => {
    llamar<Vista>("GET", `/muestras/${muestraId}/distribucion`).then(aplicar).catch((e) => setError(e.message));
  }, [muestraId]);

  async function distribuir() {
    if (!v) return;
    const sel = v.laboratorios.filter((l) => filas[l.unidadId]?.incluir);
    if (!sel.length) return setError("Marque al menos un laboratorio.");
    const falta = sel.find((l) => !filas[l.unidadId].porcion.trim() || !filas[l.unidadId].recibidoPor.trim() || !filas[l.unidadId].fecha);
    if (falta) return setError(`Complete porción, fecha y hora y quién recibe para ${falta.codigo}.`);
    setOcupado(true);
    setError("");
    try {
      aplicar(await llamar<Vista>("PUT", `/muestras/${muestraId}/distribucion`, {
        filas: sel.map((l) => ({ unidadId: l.unidadId, porcion: filas[l.unidadId].porcion.trim(), fechaHora: deInputHoraChile(filas[l.unidadId].fecha), recibidoPor: filas[l.unidadId].recibidoPor.trim() })),
      }));
      toast.ok("Distribución registrada.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setOcupado(false);
    }
  }

  const set = (u: string, p: Partial<Fila>) => setFilas((f) => ({ ...f, [u]: { ...f[u], ...p } }));
  return (
    <Modal titulo={`Distribución · muestra ${v?.muestra.codigo ?? ""}`} onCerrar={onCerrar} ancho={860}
      acciones={<>
        <button className="btn outline sm" onClick={onCerrar}>Cerrar</button>
        {v?.puedeDistribuir && v.laboratorios.length > 0 && <button className="btn primary sm" disabled={ocupado} onClick={distribuir}>{ocupado ? "Guardando…" : "Distribuir → laboratorios"}</button>}
      </>}>
      {error && <div className="alert warn" role="alert">{error}</div>}
      {!v ? <p>Cargando…</p> : v.laboratorios.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>La muestra aún no tiene ensayos: regístrelos para saber a qué laboratorios va.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="data">
            <thead><tr><th>Entregar</th><th>Laboratorio</th><th>Ensayos de ese laboratorio</th><th>Porción</th><th>Fecha y hora (Chile)</th><th>Recibido por</th></tr></thead>
            <tbody>
              {v.laboratorios.map((l) => {
                const f = filas[l.unidadId];
                const ya = v.distribucion.find((d) => d.unidadId === l.unidadId);
                return (
                  <tr key={l.unidadId}>
                    <td><input type="checkbox" style={{ width: "auto" }} aria-label={`Entregar a ${l.codigo}`} disabled={!v.puedeDistribuir} checked={!!f?.incluir} onChange={(e) => set(l.unidadId, { incluir: e.target.checked })} /></td>
                    <td><b title={l.nombre}>{l.codigo}</b>{ya && <div style={{ fontSize: 11, color: "var(--muted)" }}>Entregada {fechaHora(ya.fechaHora)}</div>}</td>
                    <td style={{ fontSize: 12, maxWidth: 260 }}>{l.ensayos}</td>
                    <td><input aria-label={`Porción para ${l.codigo}`} value={f?.porcion ?? ""} maxLength={80} placeholder="p. ej. 250 g" disabled={!v.puedeDistribuir} onChange={(e) => set(l.unidadId, { porcion: e.target.value })} style={{ width: 120 }} /></td>
                    <td><input aria-label={`Fecha y hora para ${l.codigo}`} type="datetime-local" value={f?.fecha ?? ""} disabled={!v.puedeDistribuir} onChange={(e) => set(l.unidadId, { fecha: e.target.value })} /></td>
                    <td><input aria-label={`Quién recibe en ${l.codigo}`} value={f?.recibidoPor ?? ""} maxLength={160} disabled={!v.puedeDistribuir} onChange={(e) => set(l.unidadId, { recibidoPor: e.target.value })} style={{ width: 150 }} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "6px 0 0" }}>Cada laboratorio ve la muestra en su bandeja con solo sus ensayos. Corregir una fila la reemplaza.</p>
        </div>
      )}
    </Modal>
  );
}
