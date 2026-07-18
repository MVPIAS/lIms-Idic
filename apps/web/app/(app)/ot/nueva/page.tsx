"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { API, clp, authHeaders } from "./_components/api";
import LineaBuilder, { LineaOT } from "./_components/LineaBuilder";

const hoy = () => new Date().toISOString().slice(0, 10);

export default function NuevaOtPage() {
  const router = useRouter();

  // Cabecera de la OT.
  const [cliente, setCliente] = useState("");
  const [fechaIngreso, setFechaIngreso] = useState(hoy());
  const [prioridad, setPrioridad] = useState("normal");
  const [observaciones, setObservaciones] = useState("");

  // Líneas / elementos agregados.
  const [lineas, setLineas] = useState<LineaOT[]>([]);

  // Estado de submit.
  const [enviando, setEnviando] = useState(false);
  const [okMsg, setOkMsg] = useState("");
  const [errMsg, setErrMsg] = useState("");
  const [payloadPreview, setPayloadPreview] = useState<any>(null);

  const totalEstimado = useMemo(() => lineas.reduce((s, l) => s + Number(l.subtotal ?? 0), 0), [lineas]);

  const addLinea = (l: LineaOT) => setLineas((ls) => [...ls, l]);
  const delLinea = (i: number) => setLineas((ls) => ls.filter((_, j) => j !== i));

  const buildPayload = () => ({
    cliente,
    fechaIngreso,
    prioridad,
    observaciones,
    lineas: lineas.map((l) => ({
      elementoId: l.elementoId,
      elementoCodigo: l.elementoCodigo,
      elementoNombre: l.elementoNombre,
      familia: l.familia,
      analista: l.analista,
      tipoInspeccion: l.tipoInspeccion,
      prioridad: l.prioridad,
      cantidad: l.cantidad,
      numMuestras: l.numMuestras,
      numPlanilla: l.numPlanilla,
      metodos: l.metodos.map((m) => ({ metodoId: m.metodoId, ensayoId: m.ensayoId, precio: m.precio })),
    })),
    totalEstimado,
  });

  async function registrar() {
    setOkMsg(""); setErrMsg(""); setPayloadPreview(null);
    if (!cliente.trim()) { setErrMsg("Indica el cliente de la OT."); return; }
    if (lineas.length === 0) { setErrMsg("Agrega al menos un elemento a la OT."); return; }

    const payload = buildPayload();
    setEnviando(true);
    try {
      const res = await fetch(`${API}/ot`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        router.push("/ot");
        return;
      }
      // El backend de OT aún no acepta este shape: mostramos el payload armado (esperado en v1).
      setOkMsg("OT armada correctamente (pendiente de persistir en backend v2).");
      setPayloadPreview(payload);
    } catch {
      setOkMsg("OT armada correctamente (pendiente de persistir en backend v2).");
      setPayloadPreview(payload);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div>
      <h1 className="page">Registro Definitivo de O/T</h1>
      <p className="subtitle">
        Recepción y clasificación en cascada del elemento (Gran Grupo → Grupo → SubGrupo → Elemento), datos de inspección y panel de métodos aplicables.
      </p>

      <div className="wizard">
        <div className="st cur"><div className="n">1</div>Cabecera</div>
        <div className="st"><div className="n">2</div>Elementos</div>
        <div className="st"><div className="n">3</div>Registro</div>
      </div>

      {okMsg && <div className="alert success">{okMsg}</div>}
      {errMsg && <div className="alert warn">{errMsg}</div>}

      {/* Cabecera de OT */}
      <div className="card">
        <h2>Cabecera de la Orden de Trabajo</h2>
        <div className="form-grid cols-4">
          <div className="field span-2">
            <label>Cliente <span className="req">*</span></label>
            <input value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="Razón social / unidad solicitante" />
          </div>
          <div className="field">
            <label>Fecha de ingreso</label>
            <input type="date" value={fechaIngreso} onChange={(e) => setFechaIngreso(e.target.value)} />
          </div>
          <div className="field">
            <label>Prioridad</label>
            <select value={prioridad} onChange={(e) => setPrioridad(e.target.value)}>
              <option value="normal">Normal</option>
              <option value="urgente">Urgente</option>
            </select>
          </div>
          <div className="field span-3">
            <label>Observaciones</label>
            <textarea rows={2} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Constructor de línea/elemento en cascada */}
      <LineaBuilder onAdd={addLinea} />

      {/* Resumen de líneas */}
      <div className="card">
        <h2>Líneas / Elementos de la OT <span className="right">{lineas.length} elemento(s)</span></h2>
        <div className="card card--table">
          <table className="data">
            <thead>
              <tr>
                <th>Elemento</th>
                <th>Familia</th>
                <th className="num">Nº muestras</th>
                <th className="num"># métodos</th>
                <th className="num">Subtotal</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lineas.map((l, i) => (
                <tr key={i}>
                  <td><span className="codigo">{l.elementoCodigo}</span> {l.elementoNombre}</td>
                  <td>{l.familia || "—"}</td>
                  <td className="num">{l.numMuestras}</td>
                  <td className="num">{l.metodos.length}</td>
                  <td className="num">{clp(l.subtotal)}</td>
                  <td className="num"><span style={{ cursor: "pointer", color: "var(--muted)" }} onClick={() => delLinea(i)}>✕</span></td>
                </tr>
              ))}
              {lineas.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>Aún no has agregado elementos. Arma uno arriba y pulsa “Agregar elemento a la OT”.</td></tr>
              )}
            </tbody>
            {lineas.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={4} className="num" style={{ fontWeight: 700 }}>Total estimado OT</td>
                  <td className="num" style={{ fontWeight: 800 }}>{clp(totalEstimado)}</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
          <button className="btn success" onClick={registrar} disabled={enviando}>
            {enviando ? "Registrando…" : "Registrar OT"}
          </button>
        </div>
      </div>

      {/* Preview del payload cuando el backend aún no persiste */}
      {payloadPreview && (
        <div className="card">
          <h2>Payload armado <span className="right">para revisión / integración backend</span></h2>
          <pre style={{ margin: 0, fontSize: 11.5, overflow: "auto", background: "#0f1720", color: "#d7e2ea", padding: 12, borderRadius: 8 }}>
            {JSON.stringify(payloadPreview, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
