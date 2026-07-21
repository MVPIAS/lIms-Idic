"use client";

import { useEffect, useMemo, useState } from "react";
import { fechaHora, num, pct } from "@/lib/format";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const auth = () => ({
  Authorization: `Bearer ${localStorage.getItem("lims_token")}`,
  "Content-Type": "application/json",
});

// RF-C02 · Cadena de custodia de muestras (NCh-ISO/IEC 17025).
//   C02.1 trazabilidad de quién / cuándo / dónde
//   C02.2 registro de transferencias entre responsables
//   C02.3 retención y disposición final (eventos devolucion / destruccion)
//
// El registro es APPEND-ONLY y está encadenado por hash: no se edita ni se
// borra. Un traspaso mal registrado se corrige con otro traspaso, nunca
// alterando el historial.

const EVENTOS: { key: string; label: string; pill: string; icono: string }[] = [
  { key: "recepcion", label: "Recepción", pill: "blue", icono: "📥" },
  { key: "traslado", label: "Traslado", pill: "teal", icono: "🚚" },
  { key: "preparacion", label: "Preparación", pill: "teal", icono: "⚗️" },
  { key: "analisis", label: "Análisis", pill: "violet", icono: "🔬" },
  { key: "almacenamiento", label: "Almacenamiento", pill: "gray", icono: "📦" },
  { key: "transferencia", label: "Transferencia", pill: "amber", icono: "🔄" },
  { key: "devolucion", label: "Devolución", pill: "green", icono: "↩️" },
  { key: "destruccion", label: "Destrucción", pill: "red", icono: "🗑️" },
];
const EVENTO_META = Object.fromEntries(EVENTOS.map((e) => [e.key, e]));

const nombreUsuario = (u: any) =>
  u ? u.nombre_completo ?? u.nombreCompleto ?? u.username ?? "—" : "—";

const FORM_VACIO = {
  muestraId: "",
  evento: "transferencia",
  deUsuarioId: "",
  aUsuarioId: "",
  fecha: "",
  motivo: "",
  ubicacionOrigen: "",
  ubicacionDestino: "",
  tempCelsius: "",
  humedadPct: "",
  selloNumero: "",
  observaciones: "",
};

export default function CustodiaPage() {
  const [muestras, setMuestras] = useState<any[]>([]);
  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [recientes, setRecientes] = useState<any[]>([]);

  const [sel, setSel] = useState(""); // muestra seleccionada para la trazabilidad
  const [cadena, setCadena] = useState<any[]>([]);
  const [muestraSel, setMuestraSel] = useState<any | null>(null);

  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);
  const [f, setF] = useState<any>({ ...FORM_VACIO });

  const safe = async (url: string) => {
    try {
      const r = await fetch(url, { headers: auth() });
      if (!r.ok) return [];
      const j = await r.json();
      return j.data ?? (Array.isArray(j) ? j : []);
    } catch {
      return [];
    }
  };

  async function cargar() {
    setLoading(true);
    try {
      const [m, u, c] = await Promise.all([
        safe(`${API}/muestras?limit=200`),
        safe(`${API}/usuarios`),
        safe(`${API}/custodia?limit=50`),
      ]);
      setMuestras(m);
      setUsuarios(u);
      setRecientes(c);
      setError("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    cargar();
  }, []);

  // Trazabilidad de la muestra seleccionada.
  async function cargarCadena(muestraId: string) {
    if (!muestraId) {
      setCadena([]);
      setMuestraSel(null);
      return;
    }
    try {
      const res = await fetch(`${API}/custodia?muestraId=${muestraId}`, { headers: auth() });
      if (!res.ok) throw new Error(`Error ${res.status} al cargar la cadena de custodia`);
      const j = await res.json();
      setCadena(j.data ?? []);
      setMuestraSel(j.meta?.muestra ?? null);
    } catch (e: any) {
      setError(e.message);
      setCadena([]);
    }
  }
  useEffect(() => {
    cargarCadena(sel);
  }, [sel]);

  function abrirNuevo() {
    setF({ ...FORM_VACIO, muestraId: sel || "" });
    setShow(true);
    setError("");
    setOk("");
  }

  // Al elegir muestra en el formulario, precarga el origen con su ubicación
  // actual y el "de usuario" con el receptor del último traspaso: la cadena debe
  // continuar donde la dejó el eslabón anterior.
  async function onElegirMuestraForm(muestraId: string) {
    const m = muestras.find((x) => x.id === muestraId);
    let deUsuarioId = "";
    let ubicacionOrigen = m?.ubicacion ?? "";
    if (muestraId) {
      const previos = await safe(`${API}/custodia?muestraId=${muestraId}`);
      const ultimo = previos[previos.length - 1];
      if (ultimo) {
        deUsuarioId = ultimo.a_usuario_id ?? "";
        ubicacionOrigen = ultimo.ubicacion_destino ?? ubicacionOrigen;
      }
    }
    setF((prev: any) => ({ ...prev, muestraId, deUsuarioId, ubicacionOrigen }));
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setOk("");
    const payload = {
      muestraId: f.muestraId,
      evento: f.evento,
      deUsuarioId: f.deUsuarioId || null,
      aUsuarioId: f.aUsuarioId || null,
      fecha: f.fecha ? new Date(f.fecha).toISOString() : null,
      motivo: f.motivo || null,
      ubicacionOrigen: f.ubicacionOrigen || null,
      ubicacionDestino: f.ubicacionDestino || null,
      tempCelsius: f.tempCelsius === "" ? null : Number(f.tempCelsius),
      humedadPct: f.humedadPct === "" ? null : Number(f.humedadPct),
      selloNumero: f.selloNumero || null,
      observaciones: f.observaciones || null,
    };
    try {
      const res = await fetch(`${API}/custodia`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `Error ${res.status}`);
      setShow(false);
      setOk("Traspaso registrado en la cadena de custodia.");
      const nuevaSel = f.muestraId;
      setF({ ...FORM_VACIO });
      setSel(nuevaSel);
      await cargarCadena(nuevaSel);
      setRecientes(await safe(`${API}/custodia?limit=50`));
    } catch (e: any) {
      setError(Array.isArray(e.message) ? e.message.join(", ") : e.message);
    }
  }

  const kpis = useMemo(
    () => ({
      muestras: muestras.length,
      movimientos: recientes.length,
      enCadena: cadena.length,
    }),
    [muestras, recientes, cadena],
  );

  return (
    <div>
      <h1 className="page">Cadena de custodia</h1>
      <p className="subtitle">
        Trazabilidad de quién, cuándo y dónde sobre cada muestra (RF-C02, NCh-ISO/IEC 17025). El registro es{" "}
        <strong>append-only y encadenado por hash</strong>: no se edita ni se borra. Para corregir un traspaso, registra
        un traspaso compensatorio.
      </p>
      {error && <div className="alert warn">{error}</div>}
      {ok && <div className="alert success">{ok}</div>}

      <div className="kpis">
        <div className="kpi k-blue">
          <div className="lab">Muestras</div>
          <div className="val">{kpis.muestras}</div>
        </div>
        <div className="kpi k-violet">
          <div className="lab">Movimientos recientes</div>
          <div className="val">{kpis.movimientos}</div>
        </div>
        <div className="kpi k-green">
          <div className="lab">Eslabones de la muestra</div>
          <div className="val">{sel ? kpis.enCadena : "—"}</div>
        </div>
      </div>

      {!loading && !muestras.length && (
        <div className="alert info">
          No hay muestras registradas todavía. Registra una muestra en <strong>Muestras</strong> para poder abrir su
          cadena de custodia.
        </div>
      )}

      <div className="toolbar" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ fontSize: 12.5, color: "var(--muted)" }}>Muestra:</label>
        <select value={sel} onChange={(e) => setSel(e.target.value)} style={{ minWidth: 280 }}>
          <option value="">— selecciona una muestra para ver su cadena —</option>
          {muestras.map((m) => (
            <option key={m.id} value={m.id}>
              {m.codigo} {m.nombre ? `· ${m.nombre}` : ""}
            </option>
          ))}
        </select>
        <div className="spacer" style={{ flex: 1 }}></div>
        <button className="btn primary sm" disabled={!muestras.length} onClick={() => (show ? setShow(false) : abrirNuevo())}>
          {show ? "Cerrar" : "＋ Registrar traspaso"}
        </button>
      </div>

      {show && (
        <form onSubmit={guardar} className="card">
          <div className="form-grid">
            <div className="field" style={{ gridColumn: "span 2" }}>
              <label>
                Muestra <span className="req">*</span>
              </label>
              <select required value={f.muestraId} onChange={(e) => onElegirMuestraForm(e.target.value)}>
                <option value="">— selecciona —</option>
                {muestras.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.codigo} {m.nombre ? `· ${m.nombre}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>
                Evento <span className="req">*</span>
              </label>
              <select value={f.evento} onChange={(e) => setF({ ...f, evento: e.target.value })}>
                {EVENTOS.map((e) => (
                  <option key={e.key} value={e.key}>
                    {e.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Entrega (de)</label>
              <select
                value={f.deUsuarioId}
                disabled={!usuarios.length}
                onChange={(e) => setF({ ...f, deUsuarioId: e.target.value })}
              >
                <option value="">— sin responsable previo —</option>
                {usuarios.map((u) => (
                  <option key={u.id} value={u.id}>
                    {nombreUsuario(u)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Recibe (a)</label>
              <select
                value={f.aUsuarioId}
                disabled={!usuarios.length}
                onChange={(e) => setF({ ...f, aUsuarioId: e.target.value })}
              >
                <option value="">— sin receptor —</option>
                {usuarios.map((u) => (
                  <option key={u.id} value={u.id}>
                    {nombreUsuario(u)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Fecha y hora</label>
              <input type="datetime-local" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} />
            </div>
            <div className="field">
              <label>Ubicación origen</label>
              <input value={f.ubicacionOrigen} onChange={(e) => setF({ ...f, ubicacionOrigen: e.target.value })} />
            </div>
            <div className="field">
              <label>Ubicación destino</label>
              <input
                placeholder="LQC · Cámara de custodia"
                value={f.ubicacionDestino}
                onChange={(e) => setF({ ...f, ubicacionDestino: e.target.value })}
              />
            </div>
            <div className="field">
              <label>N° de sello</label>
              <input value={f.selloNumero} onChange={(e) => setF({ ...f, selloNumero: e.target.value })} />
            </div>
            <div className="field">
              <label>Temperatura (°C)</label>
              <input
                type="number"
                step="0.1"
                value={f.tempCelsius}
                onChange={(e) => setF({ ...f, tempCelsius: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Humedad (%)</label>
              <input
                type="number"
                step="0.1"
                min={0}
                max={100}
                value={f.humedadPct}
                onChange={(e) => setF({ ...f, humedadPct: e.target.value })}
              />
            </div>
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label>
                Motivo <span className="req">*</span>
              </label>
              <input
                required
                placeholder="Traslado a sala instrumental para ensayo cromatográfico"
                value={f.motivo}
                onChange={(e) => setF({ ...f, motivo: e.target.value })}
              />
            </div>
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label>Observaciones</label>
              <textarea rows={2} value={f.observaciones} onChange={(e) => setF({ ...f, observaciones: e.target.value })} />
            </div>
          </div>
          <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
              El traspaso queda sellado con un hash encadenado al eslabón anterior y no podrá modificarse.
            </span>
            <button className="btn primary sm">Registrar traspaso</button>
          </div>
        </form>
      )}

      {/* ---------------------- Timeline de la cadena ---------------------- */}
      {sel && (
        <div className="card" style={{ marginTop: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div>
              <span className="codigo">{muestraSel?.codigo}</span>{" "}
              <strong style={{ fontSize: 14 }}>{muestraSel?.nombre ?? ""}</strong>
              {muestraSel?.ubicacion && (
                <span style={{ fontSize: 11.5, color: "var(--muted)" }}> · ubicación actual: {muestraSel.ubicacion}</span>
              )}
            </div>
            <span className="pill gray">{cadena.length} eslabón(es)</span>
          </div>

          {!cadena.length && (
            <div style={{ textAlign: "center", color: "var(--muted)", padding: 18, fontSize: 12.5 }}>
              Esta muestra todavía no tiene movimientos de custodia registrados.
            </div>
          )}

          {cadena.map((c, i) => {
            const meta = EVENTO_META[c.evento] ?? { label: c.evento, pill: "gray", icono: "•" };
            const ultimo = i === cadena.length - 1;
            return (
              <div key={c.id} style={{ display: "flex", gap: 10 }}>
                {/* Riel del timeline */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 22 }}>
                  <div
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      border: "1px solid var(--line)",
                      background: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 11,
                      flexShrink: 0,
                    }}
                  >
                    {meta.icono}
                  </div>
                  {!ultimo && <div style={{ flex: 1, width: 2, background: "var(--line)", minHeight: 26 }} />}
                </div>

                <div style={{ flex: 1, paddingBottom: ultimo ? 0 : 14 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span className={`pill ${meta.pill}`}>{meta.label}</span>
                    <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{fechaHora(c.fecha)}</span>
                    {i === 0 && <span className="pill gray">origen de la cadena</span>}
                  </div>

                  <div style={{ fontSize: 12.5, margin: "4px 0" }}>
                    <strong>{nombreUsuario(c.de_usuario)}</strong> → <strong>{nombreUsuario(c.a_usuario)}</strong>
                    {(c.ubicacion_origen || c.ubicacion_destino) && (
                      <span style={{ color: "var(--muted)" }}>
                        {" "}
                        · {c.ubicacion_origen ?? "—"} → {c.ubicacion_destino ?? "—"}
                      </span>
                    )}
                  </div>

                  {c.motivo && <div style={{ fontSize: 12 }}>{c.motivo}</div>}

                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {c.sello_numero && <span>Sello {c.sello_numero}</span>}
                    {c.temp_celsius != null && <span>{num(c.temp_celsius, 1)} °C</span>}
                    {c.humedad_pct != null && <span>{pct(c.humedad_pct)} HR</span>}
                    {c.registrado_por_usuario && <span>Registró: {nombreUsuario(c.registrado_por_usuario)}</span>}
                    {c.hash_registro && (
                      <span title={`hash: ${c.hash_registro}\nanterior: ${c.hash_prev ?? "— (génesis)"}`}>
                        🔒 <span className="codigo">{String(c.hash_registro).slice(0, 12)}…</span>
                      </span>
                    )}
                  </div>

                  {c.observaciones && (
                    <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3 }}>{c.observaciones}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* -------------------- Movimientos recientes (global) -------------------- */}
      <div className="card" style={{ marginTop: 14 }}>
        <h3 style={{ fontSize: 12.5, margin: "0 0 8px" }}>Movimientos recientes</h3>
        <table className="data">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Muestra</th>
              <th>Evento</th>
              <th>Entrega</th>
              <th>Recibe</th>
              <th>Destino</th>
              <th>Motivo</th>
            </tr>
          </thead>
          <tbody>
            {recientes.map((c) => {
              const meta = EVENTO_META[c.evento] ?? { label: c.evento, pill: "gray" };
              return (
                <tr key={c.id} className="row-action" onClick={() => setSel(c.muestra_id)}>
                  <td style={{ whiteSpace: "nowrap" }}>{fechaHora(c.fecha)}</td>
                  <td>
                    <span className="codigo">{c.muestra?.codigo ?? "—"}</span>
                  </td>
                  <td>
                    <span className={`pill ${meta.pill}`}>{meta.label}</span>
                  </td>
                  <td>{nombreUsuario(c.de_usuario)}</td>
                  <td>{nombreUsuario(c.a_usuario)}</td>
                  <td style={{ color: "var(--muted)" }}>{c.ubicacion_destino ?? "—"}</td>
                  <td style={{ color: "var(--muted)" }}>{c.motivo ?? "—"}</td>
                </tr>
              );
            })}
            {!recientes.length && (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", color: "var(--muted)", padding: 18 }}>
                  Sin movimientos de custodia registrados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
