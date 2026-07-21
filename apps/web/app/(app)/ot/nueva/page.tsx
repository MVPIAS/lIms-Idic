"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { clp, apiPost, unwrap, ApiError } from "./_components/api";
import ClienteSelector, { Cliente } from "./_components/ClienteSelector";
import LineaBuilder, { LineaOT } from "./_components/LineaBuilder";

const hoy = () => new Date().toISOString().slice(0, 10);

export default function NuevaOtPage() {
  const router = useRouter();

  // Cabecera de la OT.
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [fechaIngreso, setFechaIngreso] = useState(hoy());
  const [prioridad, setPrioridad] = useState("normal");
  const [observaciones, setObservaciones] = useState("");

  // Líneas / elementos agregados.
  const [lineas, setLineas] = useState<LineaOT[]>([]);

  // Estado de submit.
  const [enviando, setEnviando] = useState(false);
  const [okMsg, setOkMsg] = useState("");
  const [errMsg, setErrMsg] = useState("");
  const [errIssues, setErrIssues] = useState<string[]>([]);

  const totalEstimado = useMemo(() => lineas.reduce((s, l) => s + Number(l.subtotal ?? 0), 0), [lineas]);

  const addLinea = (l: LineaOT) => setLineas((ls) => [...ls, l]);
  const delLinea = (i: number) => setLineas((ls) => ls.filter((_, j) => j !== i));

  async function registrar() {
    setOkMsg(""); setErrMsg(""); setErrIssues([]);
    // a. Validaciones locales.
    if (!cliente?.id) { setErrMsg("Selecciona un cliente real de la lista."); return; }
    if (lineas.length === 0) { setErrMsg("Agrega al menos un elemento a la OT."); return; }

    setEnviando(true);
    try {
      // b. Crear la OT. La respuesta puede venir plana {id,codigo} o envuelta {data:{...}}.
      const otResp = unwrap<{ id: string; codigo?: string }>(
        await apiPost("/ot", {
          clienteId: cliente.id,
          prioridad,
          fechaIngreso: new Date(fechaIngreso).toISOString(),
          notas: observaciones || undefined,
        }),
      );
      const otId = otResp?.id;
      const otCodigo = otResp?.codigo || otId?.slice(0, 8) || "OT";
      if (!otId) throw new ApiError("La API de OT no devolvió un id.", 500);

      // c. Una muestra por cada elemento/línea agregado. codigo único y <=30 chars.
      //    NOTA (limitación conocida): los métodos seleccionados del panel (catálogo v2)
      //    NO se persisten aún como analitos/resultados —falta el puente catálogo v2 ↔
      //    analitos/resultados—. Como paliativo, dejamos su referencia dentro de `nombre`
      //    (único campo textual libre del contrato actual de POST /api/muestras).
      for (let i = 0; i < lineas.length; i++) {
        const l = lineas[i];
        const codigo = `${otCodigo}-M${i + 1}`.slice(0, 30);
        const refMetodos = l.metodos.map((m) => m.metodoCodigo).join(",");
        const nombre = `${l.elementoNombre}${refMetodos ? ` [${refMetodos}]` : ""}`.slice(0, 200);
        await apiPost("/muestras", {
          codigo,
          otId,
          clienteId: cliente.id,
          nombre,
          estado: "recibida",
        });
      }

      // d. Todo OK → ficha de la OT recién creada.
      router.push(`/ot/${otId}`);
    } catch (e) {
      if (e instanceof ApiError) {
        setErrMsg(e.message);
        setErrIssues(e.issues);
      } else {
        setErrMsg(e instanceof Error ? e.message : "No se pudo registrar la OT.");
      }
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
      {errMsg && (
        <div className="alert warn">
          <div>{errMsg}</div>
          {errIssues.length > 0 && (
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {errIssues.map((it, i) => <li key={i}>{it}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* Cabecera de OT */}
      <div className="card">
        <h2>Cabecera de la Orden de Trabajo</h2>
        <div className="form-grid cols-4">
          <ClienteSelector value={cliente} onChange={setCliente} />
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
    </div>
  );
}
