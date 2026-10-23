"use client";

/**
 * «Recepción de ítems» en el DCO (DCO-PG01-P01-IT01 · EP-00 5.7, BL-211):
 * portador (RUT, nombre, dirección), fecha de recibo, cantidad de ítems y
 * condición. «Recepcionar → entregar al laboratorio»; luego «Entregado al
 * laboratorio» deja quién y cuándo.
 */
import { useCallback, useEffect, useState } from "react";
import { llamar } from "@/lib/laboratorio";
import { aInputHoraChile, deInputHoraChile, fechaHora } from "@/lib/format";
import { toast } from "@/components/ui/feedback";

interface Recepcion {
  id: string; portadorRut: string; portadorNombre: string; portadorDireccion: string | null; fechaRecibo: string; cantidadItems: number;
  condicion: "cumple" | "no_cumple"; observacion: string | null; recibidoPor: string | null; entregadoLabAt: string | null; entregadoLabPor: string | null;
}
const VACIO = { portadorRut: "", portadorNombre: "", portadorDireccion: "", fechaRecibo: "", cantidadItems: "", condicion: "cumple" as "cumple" | "no_cumple", observacion: "" };

export default function RecepcionDcoOt({ otId }: { otId: string }) {
  const [v, setV] = useState<{ recepciones: Recepcion[]; puedeRegistrar: boolean } | null>(null);
  const [f, setF] = useState(VACIO);
  const [abierto, setAbierto] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    try { setV(await llamar("GET", `/ot/${otId}/recepcion-dco`)); } catch (e: any) { setError(e.message); }
  }, [otId]);
  useEffect(() => void cargar(), [cargar]);
  if (!v) return error ? <div className="alert warn">{error}</div> : null;
  if (!v.recepciones.length && !v.puedeRegistrar) return null;

  async function registrar() {
    setError("");
    const n = Number(f.cantidadItems);
    if (!f.portadorRut.trim() || f.portadorNombre.trim().length < 3) return setError("Indique el RUT y el nombre del portador.");
    if (!(Number.isInteger(n) && n > 0)) return setError("La cantidad de ítems debe ser un entero mayor que 0.");
    if (f.condicion === "no_cumple" && f.observacion.trim().length < 5) return setError("Condición «No cumple»: describa lo observado.");
    setOcupado(true);
    try {
      setV(await llamar("POST", `/ot/${otId}/recepcion-dco`, {
        portadorRut: f.portadorRut.trim(), portadorNombre: f.portadorNombre.trim(), portadorDireccion: f.portadorDireccion.trim() || null,
        fechaRecibo: deInputHoraChile(f.fechaRecibo) ?? new Date().toISOString(), cantidadItems: n, condicion: f.condicion, observacion: f.observacion.trim() || null,
      }));
      setF(VACIO);
      setAbierto(false);
      toast.ok("Ítems recepcionados en el DCO.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setOcupado(false);
    }
  }
  async function entregar(r: Recepcion) {
    try {
      setV(await llamar("POST", `/ot/${otId}/recepcion-dco/${r.id}/entregar`, {}));
      toast.ok("Entrega al laboratorio registrada.");
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  return (
    <section className="card" style={{ padding: 12, margin: 0 }} aria-labelledby="dco-titulo">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <h3 id="dco-titulo" style={{ margin: 0, fontSize: 14, flex: 1 }}>Recepción de ítems en DCO</h3>
        {v.puedeRegistrar && !abierto && <button className="btn outline sm" onClick={() => { setF({ ...VACIO, fechaRecibo: aInputHoraChile(new Date()) }); setAbierto(true); }}>＋ Recepcionar ítems</button>}
      </div>
      {error && <div className="alert warn" role="alert">{error}</div>}
      {v.recepciones.length > 0 && (
        <table className="data" style={{ marginBottom: abierto ? 10 : 0 }}>
          <thead><tr><th>Recibido</th><th>Portador</th><th className="num">Ítems</th><th>Condición</th><th>Laboratorio</th></tr></thead>
          <tbody>
            {v.recepciones.map((r) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: "nowrap" }}>{fechaHora(r.fechaRecibo)}{r.recibidoPor ? <div style={{ fontSize: 11, color: "var(--muted)" }}>{r.recibidoPor}</div> : null}</td>
                <td>{r.portadorNombre} <span className="codigo">{r.portadorRut}</span>{r.portadorDireccion ? <div style={{ fontSize: 11, color: "var(--muted)" }}>{r.portadorDireccion}</div> : null}</td>
                <td className="num">{r.cantidadItems}</td>
                <td><span className={`pill ${r.condicion === "cumple" ? "green" : "red"}`}>{r.condicion === "cumple" ? "Cumple" : "No cumple"}</span>{r.observacion ? <div style={{ fontSize: 11 }}>{r.observacion}</div> : null}</td>
                <td>
                  {r.entregadoLabAt ? <span style={{ fontSize: 12 }}>Entregado {fechaHora(r.entregadoLabAt)}{r.entregadoLabPor ? ` · ${r.entregadoLabPor}` : ""}</span>
                    : v.puedeRegistrar ? <button className="btn outline sm" onClick={() => entregar(r)}>Entregado al laboratorio</button> : <span className="pill amber">en DCO</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {abierto && (
        <div>
          <div className="form-grid cols-4">
            <div className="field"><label htmlFor="dco-rut">RUT del portador <span className="req">*</span></label><input id="dco-rut" value={f.portadorRut} maxLength={12} placeholder="12.345.678-5" onChange={(e) => setF({ ...f, portadorRut: e.target.value })} /></div>
            <div className="field"><label htmlFor="dco-nom">Nombre del portador <span className="req">*</span></label><input id="dco-nom" value={f.portadorNombre} maxLength={160} onChange={(e) => setF({ ...f, portadorNombre: e.target.value })} /></div>
            <div className="field" style={{ gridColumn: "span 2" }}><label htmlFor="dco-dir">Dirección del portador</label><input id="dco-dir" value={f.portadorDireccion} maxLength={300} onChange={(e) => setF({ ...f, portadorDireccion: e.target.value })} /></div>
            <div className="field"><label htmlFor="dco-fec">Fecha y hora de recibo <span className="req">*</span></label><input id="dco-fec" type="datetime-local" value={f.fechaRecibo} onChange={(e) => setF({ ...f, fechaRecibo: e.target.value })} /></div>
            <div className="field"><label htmlFor="dco-can">Cantidad de ítems <span className="req">*</span></label><input id="dco-can" inputMode="numeric" value={f.cantidadItems} onChange={(e) => setF({ ...f, cantidadItems: e.target.value.replace(/\D/g, "") })} /></div>
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend style={{ fontSize: 12, fontWeight: 600 }}>Condición de recepción <span className="req">*</span></legend>
              <div style={{ display: "flex", gap: 12 }}>
                <label style={{ display: "flex", gap: 4, fontWeight: 400 }}><input type="radio" name="dco-cond" style={{ width: "auto" }} checked={f.condicion === "cumple"} onChange={() => setF({ ...f, condicion: "cumple" })} /> Cumple</label>
                <label style={{ display: "flex", gap: 4, fontWeight: 400 }}><input type="radio" name="dco-cond" style={{ width: "auto" }} checked={f.condicion === "no_cumple"} onChange={() => setF({ ...f, condicion: "no_cumple" })} /> No cumple</label>
              </div>
            </fieldset>
            <div className="field"><label htmlFor="dco-obs">Observación{f.condicion === "no_cumple" && <span className="req"> *</span>}</label><input id="dco-obs" value={f.observacion} maxLength={2000} onChange={(e) => setF({ ...f, observacion: e.target.value })} /></div>
          </div>
          <div className="toolbar" style={{ marginTop: 8 }}>
            <button className="btn outline sm" onClick={() => setAbierto(false)}>Cancelar</button>
            <div className="spacer" />
            <button className="btn primary sm" disabled={ocupado} onClick={registrar}>{ocupado ? "Guardando…" : "Recepcionar → entregar al laboratorio"}</button>
          </div>
        </div>
      )}
      {!v.recepciones.length && !abierto && <p className="subtitle" style={{ margin: 0 }}>Sin ítems recepcionados en el DCO.</p>}
    </section>
  );
}
