"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { clp, apiGet, apiPost, unwrap, ApiError } from "./_components/api";
import ClienteSelector, { Cliente } from "./_components/ClienteSelector";
import LineaBuilder, { LineaOT } from "./_components/LineaBuilder";

/**
 * Origen de la OT en el alta directa (Comercial R2):
 *  · ""                → alta directa sin origen comercial (comportamiento previo).
 *  · DISPOSICION       → OT por disposición del Director (IDIC-PG03 6.4 g). Con
 *                        cobro y sin OPI queda «OPI pendiente».
 *  · INTERLABORATORIO  → la pide un laboratorio a otro sin OT padre (p. ej.
 *                        calibración de un equipo): SIN cobro, costo por horas.
 *  · INTERNACION       → resolución DGMN (tasa 1,5 % en /internaciones).
 *  · OT_INTERNA        → OT interna.
 */
const ORIGENES = [
  { v: "", l: "Alta directa" },
  { v: "DISPOSICION", l: "Disposición del Director (sin OPI previa)" },
  { v: "INTERLABORATORIO", l: "Interlaboratorio (sin cobro)" },
  { v: "INTERNACION", l: "Internación (resolución DGMN)" },
  { v: "OT_INTERNA", l: "OT interna" },
];
type CC = { id: string; codigo: string; nombre: string; tipo?: string | null };

const hoy = () => new Date().toISOString().slice(0, 10);

export default function NuevaOtPage() {
  const router = useRouter();

  // Cabecera de la OT.
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [fechaIngreso, setFechaIngreso] = useState(hoy());
  const [prioridad, setPrioridad] = useState("normal");
  const [observaciones, setObservaciones] = useState("");

  // Registro Definitivo: continuar una OT ya creada por Comercial (estado
  // recepcionada) en vez de crear una nueva — como el flujo real del LIMS.
  const [modo, setModo] = useState<"nueva" | "existente">("nueva");
  const [otsPendientes, setOtsPendientes] = useState<any[]>([]);
  const [otExistenteId, setOtExistenteId] = useState("");

  useEffect(() => {
    apiGet("/ot").then((d) => {
      const arr = Array.isArray(d) ? d : (d as any)?.data ?? [];
      setOtsPendientes(arr.filter((o: any) => o.estado === "recepcionada"));
    }).catch(() => {});
  }, []);

  function elegirOt(id: string) {
    setOtExistenteId(id);
    const ot = otsPendientes.find((o) => o.id === id);
    if (ot) {
      setCliente({ id: ot.clienteId ?? ot.cliente?.id, razonSocial: ot.cliente?.razonSocial ?? ot.cliente?.nombre ?? "" } as Cliente);
      if (ot.prioridad) setPrioridad(ot.prioridad);
    } else {
      setCliente(null);
    }
  }

  // Origen comercial de la OT (solo en alta directa).
  const [origen, setOrigen] = useState("");
  const [disposicionRef, setDisposicionRef] = useState("");
  const [disposicionFecha, setDisposicionFecha] = useState(hoy());
  const [conCobro, setConCobro] = useState(true);
  const [opiNumero, setOpiNumero] = useState("");
  const [resolucion, setResolucion] = useState("");
  const [labSolicitante, setLabSolicitante] = useState("");
  const [labEjecutor, setLabEjecutor] = useState("");
  const [horas, setHoras] = useState("");
  const [costo, setCosto] = useState("");
  const [centros, setCentros] = useState<CC[]>([]);
  const interlab = modo === "nueva" && origen === "INTERLABORATORIO";

  useEffect(() => {
    // Centros de costo: maestro (/centros-costo) o, si el rol no lo puede leer,
    // la configuración comercial (/cotizaciones/config).
    apiGet("/centros-costo?limit=200")
      .then((d) => setCentros(((d as any)?.data ?? []) as CC[]))
      .catch(() =>
        apiGet("/cotizaciones/config")
          .then((c: any) => setCentros(c?.centrosCosto ?? []))
          .catch(() => setCentros([])),
      );
  }, []);

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
    if (modo === "existente" && !otExistenteId) { setErrMsg("Selecciona la OT comercial a completar."); return; }
    if (!cliente?.id && !interlab) { setErrMsg("Selecciona un cliente real de la lista."); return; }
    if (modo === "nueva" && origen === "DISPOSICION" && !disposicionRef.trim()) { setErrMsg("Indica la referencia de la disposición del Director."); return; }
    if (interlab && (!labSolicitante || !labEjecutor)) { setErrMsg("Indica el laboratorio solicitante y el ejecutor."); return; }
    if (interlab && labSolicitante === labEjecutor) { setErrMsg("El laboratorio solicitante y el ejecutor deben ser distintos."); return; }
    if (modo === "nueva" && origen === "INTERNACION" && !resolucion.trim()) { setErrMsg("Indica el Nº de resolución DGMN."); return; }
    if (!fechaIngreso || Number.isNaN(new Date(fechaIngreso).getTime())) { setErrMsg("Indica una fecha de ingreso válida."); return; }
    if (lineas.length === 0 && !interlab) { setErrMsg("Agrega al menos un elemento a la OT."); return; }

    setEnviando(true);
    try {
      // b. La OT: o se REUTILIZA la comercial existente (Registro Definitivo),
      //    o se crea una nueva. La respuesta puede venir plana o envuelta {data}.
      let otId: string | undefined;
      let otCodigo: string;
      let otClienteId: string | undefined = cliente?.id;
      if (modo === "existente" && otExistenteId) {
        const ot = otsPendientes.find((o) => o.id === otExistenteId);
        otId = otExistenteId;
        otCodigo = ot?.codigo || otId.slice(0, 8);
      } else {
        const otResp = unwrap<{ id: string; codigo?: string; clienteId?: string }>(
          await apiPost("/ot", {
            clienteId: cliente?.id || undefined,
            prioridad,
            fechaIngreso: new Date(fechaIngreso).toISOString(),
            notas: observaciones || undefined,
            ...(origen
              ? {
                  origenTrabajo: origen,
                  conCobro: interlab ? false : conCobro,
                  ...(origen === "DISPOSICION"
                    ? { disposicionRef: disposicionRef.trim(), disposicionFecha, opiNumero: opiNumero.trim() || undefined }
                    : {}),
                  ...(origen === "INTERNACION" ? { resolucion: resolucion.trim() } : {}),
                  ...(interlab ? { labSolicitanteCcId: labSolicitante, centroCostoId: labEjecutor } : {}),
                  ...(horas ? { horasHombre: Number(horas) } : {}),
                  ...(costo ? { costoEstimado: Number(costo) } : {}),
                }
              : {}),
          }),
        );
        otId = otResp?.id;
        otCodigo = otResp?.codigo || otId?.slice(0, 8) || "OT";
        otClienteId = otResp?.clienteId ?? otClienteId;
      }
      if (!otId) throw new ApiError("La API de OT no devolvió un id.", 500);

      // c. Una muestra por cada elemento/línea, y por cada muestra materializamos
      //    los métodos elegidos del panel como resultados por analizar (con su
      //    especificación Mín/Nom/Máx y fórmula) vía el puente catálogo v2 ↔ operativo
      //    (POST /flujo/ot/:id/generar-analisis). Así el expediente llega listo para
      //    captura → veredicto → informe.
      for (let i = 0; i < lineas.length; i++) {
        const l = lineas[i];
        const codigo = `${otCodigo}-M${i + 1}`.slice(0, 30);
        const refMetodos = l.metodos.map((m) => m.metodoCodigo).join(",");
        const nombre = `${l.elementoNombre}${refMetodos ? ` [${refMetodos}]` : ""}`.slice(0, 200);
        const muestraResp = unwrap(
          await apiPost("/muestras", {
            codigo,
            otId,
            clienteId: otClienteId,
            nombre,
            estado: "recibida",
          }),
        );
        const muestraId = muestraResp?.id;
        const metodoIds = l.metodos.map((m) => m.metodoId).filter(Boolean);
        if (muestraId && metodoIds.length) {
          // Materializa resultados por analito de cada método seleccionado.
          await apiPost(`/flujo/ot/${otId}/generar-analisis`, { muestraId, metodoIds });
        }
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
        <div className="field" style={{ marginBottom: 10 }}>
          <label>Modo de registro</label>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 400 }}>
              <input type="radio" name="modo" style={{ width: "auto" }} checked={modo === "nueva"} onChange={() => { setModo("nueva"); setOtExistenteId(""); setCliente(null); }} />
              Nueva OT (alta directa)
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 400 }}>
              <input type="radio" name="modo" style={{ width: "auto" }} checked={modo === "existente"} onChange={() => setModo("existente")} />
              Registro Definitivo sobre una OT comercial existente
            </label>
          </div>
        </div>
        {modo === "nueva" && (
          <div className="form-grid cols-4" style={{ marginBottom: 10 }}>
            <div className="field span-2">
              <label>Origen de la OT</label>
              <select value={origen} onChange={(e) => setOrigen(e.target.value)}>
                {ORIGENES.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
            </div>
            {origen === "DISPOSICION" && (
              <>
                <div className="field"><label>Ref. disposición del Director <span className="req">*</span></label><input value={disposicionRef} maxLength={120} onChange={(e) => setDisposicionRef(e.target.value)} /></div>
                <div className="field"><label>Fecha disposición</label><input type="date" value={disposicionFecha} onChange={(e) => setDisposicionFecha(e.target.value)} /></div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 400 }}>
                  <input type="checkbox" style={{ width: "auto" }} checked={conCobro} onChange={(e) => setConCobro(e.target.checked)} /> Con cobro
                </label>
                <div className="field"><label>Nº OPI (si ya existe)</label><input value={opiNumero} maxLength={60} onChange={(e) => setOpiNumero(e.target.value)} /></div>
                <p className="hint" style={{ margin: 0, gridColumn: "span 2", alignSelf: "center" }}>
                  {conCobro && !opiNumero.trim()
                    ? "Con cobro y sin OPI: la OT quedará «OPI pendiente» hasta registrar la OPI."
                    : "Sin OPI pendiente. La OT sin cobro igual registra horas y costo."}
                </p>
              </>
            )}
            {origen === "INTERNACION" && (
              <div className="field span-2"><label>Nº resolución DGMN <span className="req">*</span></label><input value={resolucion} maxLength={40} onChange={(e) => setResolucion(e.target.value)} /></div>
            )}
            {interlab && (
              <>
                <div className="field">
                  <label>Laboratorio solicitante <span className="req">*</span></label>
                  <select value={labSolicitante} onChange={(e) => setLabSolicitante(e.target.value)}>
                    <option value="">—</option>
                    {centros.map((c) => <option key={c.id} value={c.id}>{c.nombre} ({c.codigo})</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Laboratorio ejecutor <span className="req">*</span></label>
                  <select value={labEjecutor} onChange={(e) => setLabEjecutor(e.target.value)}>
                    <option value="">—</option>
                    {centros.map((c) => <option key={c.id} value={c.id}>{c.nombre} ({c.codigo})</option>)}
                  </select>
                </div>
                <p className="hint" style={{ margin: 0, gridColumn: "span 2", alignSelf: "center" }}>Sin cobro y sin OT padre: el costo se registra por horas. El cliente es opcional (se usa el cliente de tipo «Interlaboratorio»).</p>
              </>
            )}
            {origen && (
              <>
                <div className="field"><label>Horas hombre (estimadas)</label><input type="number" min={0} step="0.5" value={horas} onChange={(e) => setHoras(e.target.value)} /></div>
                <div className="field"><label>Costo estimado (CLP)</label><input type="number" min={0} step={1} value={costo} onChange={(e) => setCosto(e.target.value)} /></div>
              </>
            )}
          </div>
        )}
        <div className="form-grid cols-4">
          {modo === "existente" ? (
            <div className="field span-2">
              <label>OT recepcionada (de Comercial) <span className="req">*</span></label>
              <select value={otExistenteId} onChange={(e) => elegirOt(e.target.value)}>
                <option value="">— Seleccione una OT —</option>
                {otsPendientes.map((o) => (
                  <option key={o.id} value={o.id}>{o.codigo} · {o.cliente?.razonSocial ?? o.cliente?.nombre ?? ""}</option>
                ))}
              </select>
              {cliente?.id && <p className="hint" style={{ marginTop: 4 }}>Cliente precargado: <b>{cliente.razonSocial}</b></p>}
              {otsPendientes.length === 0 && <p className="hint" style={{ marginTop: 4 }}>No hay OT en estado «recepcionada». Acepte una cotización o use el alta directa.</p>}
            </div>
          ) : (
            <ClienteSelector value={cliente} onChange={setCliente} />
          )}
          <div className="field">
            <label>Fecha de ingreso <span className="req">*</span></label>
            <input type="date" required value={fechaIngreso} onChange={(e) => setFechaIngreso(e.target.value)} />
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
