"use client";

/**
 * Diseñador de flujos (no-code) · LIMS IDIC
 * Lista los flujos del motor, permite ver/editar sus pasos y transiciones,
 * guardar una nueva versión (borrador), publicarla y simular una instancia.
 * Los flujos viven como DATOS: este editor solo escribe filas vía la API.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "/api";

/**
 * fetch autenticado. TODA llamada del diseñador debe pasar por aquí: el API
 * exige el JWT (flujo.ver/editar/publicar, ot.crear/ver) y sin la cabecera
 * Authorization respondía 401 y el diseñador quedaba inservible. El token se
 * guarda en localStorage tras el login (ver lib/api.ts). Si expiró (401),
 * limpiamos y mandamos a /login como hace el cliente central.
 */
async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = typeof window !== "undefined" ? localStorage.getItem("lims_token") : null;
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401 && typeof window !== "undefined") {
    localStorage.removeItem("lims_token");
    window.location.href = "/login";
  }
  return res;
}

type Paso = {
  tmpId: string; numero: number; tipo: string; actividad: string;
  slaMinutos?: number | null;
};
type Trans = { origenTmp: string; destinoTmp: string; etiqueta?: string | null; condicion?: string | null; orden?: number };

const TIPOS = ["INICIO", "ACTIVIDAD", "AUTO", "DECISION", "ESPERA", "FIN"] as const;
const COLOR: Record<string, string> = {
  INICIO: "#16a34a", ACTIVIDAD: "#2563eb", AUTO: "#0d9488",
  DECISION: "#d97706", ESPERA: "#7c3aed", FIN: "#dc2626", SUBPROCESO: "#7c3aed",
};

export default function FlujosPage() {
  const [defs, setDefs] = useState<any[]>([]);
  const [sel, setSel] = useState<any | null>(null);
  const [pasos, setPasos] = useState<Paso[]>([]);
  const [trans, setTrans] = useState<Trans[]>([]);
  const [meta, setMeta] = useState({ codigo: "", nombre: "", versionId: "", estado: "" });
  const [msg, setMsg] = useState("");
  const [simulacion, setSimulacion] = useState<any | null>(null);

  const cargarDefs = useCallback(async () => {
    const r = await authFetch(`/flujos`);
    if (r.ok) setDefs(await r.json());
  }, []);
  useEffect(() => { cargarDefs(); }, [cargarDefs]);

  async function abrir(codigo: string) {
    setMsg(""); setSimulacion(null);
    const r = await authFetch(`/flujos/codigo/${codigo}`);
    if (!r.ok) { setMsg("No se pudo cargar el flujo"); return; }
    const v = await r.json();
    setSel(v);
    setMeta({ codigo: v.def.codigo, nombre: v.def.nombre, versionId: v.id, estado: v.estado });
    const porId: Record<string, string> = {};
    setPasos(v.pasos.map((p: any) => { porId[p.id] = p.bpmnElementId; return {
      tmpId: p.bpmnElementId, numero: p.numero, tipo: p.tipo, actividad: p.actividad, slaMinutos: p.slaMinutos,
    };}));
    setTrans(v.transiciones.map((t: any) => ({
      origenTmp: porId[t.origenPasoId], destinoTmp: porId[t.destinoPasoId],
      etiqueta: t.etiqueta, condicion: t.condicion, orden: t.orden,
    })));
  }

  function nuevoFlujo() {
    setSel(null); setSimulacion(null); setMsg("");
    setMeta({ codigo: "FLU-NUEVO", nombre: "Nuevo flujo", versionId: "", estado: "borrador" });
    setPasos([
      { tmpId: "p1", numero: 1, tipo: "INICIO", actividad: "Recepción" },
      { tmpId: "p2", numero: 2, tipo: "ACTIVIDAD", actividad: "Ejecución del ensayo", slaMinutos: 1440 },
      { tmpId: "fin_ok", numero: 3, tipo: "FIN", actividad: "Informe emitido" },
    ]);
    setTrans([
      { origenTmp: "p1", destinoTmp: "p2" },
      { origenTmp: "p2", destinoTmp: "fin_ok" },
    ]);
  }

  function agregarPaso() {
    const n = pasos.length + 1;
    const tmpId = `p${Date.now() % 100000}`;
    setPasos([...pasos, { tmpId, numero: n, tipo: "ACTIVIDAD", actividad: "Nuevo paso" }]);
    const ultimoNoFin = [...pasos].reverse().find((p) => p.tipo !== "FIN");
    if (ultimoNoFin) setTrans([...trans, { origenTmp: ultimoNoFin.tmpId, destinoTmp: tmpId }]);
  }

  function actualizarPaso(i: number, campo: keyof Paso, valor: any) {
    const copia = [...pasos];
    (copia[i] as any)[campo] = campo === "slaMinutos" || campo === "numero" ? (valor ? Number(valor) : null) : valor;
    setPasos(copia);
  }

  function eliminarPaso(i: number) {
    const p = pasos[i];
    setPasos(pasos.filter((_, j) => j !== i));
    setTrans(trans.filter((t) => t.origenTmp !== p.tmpId && t.destinoTmp !== p.tmpId));
  }

  async function guardar() {
    setMsg("Guardando…");
    const r = await authFetch(`/flujos`, {
      method: "POST",
      body: JSON.stringify({ codigo: meta.codigo, nombre: meta.nombre, pasos, transiciones: trans }),
    });
    const data = await r.json();
    if (!r.ok) { setMsg(`Error: ${data.message ?? r.status}`); return; }
    setMeta({ ...meta, versionId: data.versionId, estado: data.estado });
    setMsg(`Guardado como ${data.version} (borrador)`);
    cargarDefs();
  }

  async function publicar() {
    if (!meta.versionId) { setMsg("Guarda primero un borrador"); return; }
    const r = await authFetch(`/flujos/version/${meta.versionId}/publicar`, { method: "POST" });
    if (r.ok) { setMeta({ ...meta, estado: "publicado" }); setMsg("Versión publicada ✔"); cargarDefs(); }
    else setMsg("Error al publicar");
  }

  async function simular() {
    if (!meta.versionId || meta.estado !== "publicado") { setMsg("Publica la versión antes de simular"); return; }
    const r = await authFetch(`/flujos/version/${meta.versionId}/instanciar`, {
      method: "POST",
      body: JSON.stringify({ metadata: { cumple: true } }),
    });
    const data = await r.json();
    if (!r.ok) { setMsg(`Error: ${data.message ?? r.status}`); return; }
    setSimulacion(data); setMsg("Instancia creada — completa las tareas para avanzar");
  }

  async function completar(peId: string) {
    const r = await authFetch(`/flujos/tareas/${peId}/completar`, {
      method: "POST",
      body: JSON.stringify({ resultado: { cumple: true } }),
    });
    if (r.ok) setSimulacion(await r.json());
  }

  const pendiente = useMemo(
    () => simulacion?.ejecuciones?.find((e: any) => e.estado === "pendiente"),
    [simulacion],
  );

  return (
    <div>
      <h1 className="page">Diseñador de Flujos</h1>
      <p className="subtitle">Motor de proceso no-code: se crea el flujo que gobierna las fases del expediente. Los flujos viven como datos.</p>
      {msg && <div className="alert info">{msg}</div>}
      <div className="card" style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 16 }}>
      {/* catálogo */}
      <aside style={{ borderRight: "1px solid var(--line)", paddingRight: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: 15, fontWeight: 700 }}>Flujos</h2>
          <button onClick={nuevoFlujo} className="btn outline sm">+ Nuevo</button>
        </div>
        <ul style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
          {defs.map((d) => (
            <li key={d.id}>
              <button onClick={() => abrir(d.codigo)}
                style={{ ...btn, width: "100%", textAlign: "left", fontWeight: meta.codigo === d.codigo ? 700 : 400 }}>
                <span style={{ fontFamily: "monospace", fontSize: 11, color: "#6b7280" }}>{d.codigo}</span><br />
                {d.nombre}
                {d.versiones?.[0] && (
                  <span style={{ marginLeft: 6, fontSize: 10, color: d.versiones[0].estado === "publicado" ? "#16a34a" : "#d97706" }}>
                    {d.versiones[0].version} · {d.versiones[0].estado}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* editor */}
      <main>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input value={meta.codigo} onChange={(e) => setMeta({ ...meta, codigo: e.target.value })}
            style={{ ...inp, width: 130, fontFamily: "monospace" }} placeholder="Código" />
          <input value={meta.nombre} onChange={(e) => setMeta({ ...meta, nombre: e.target.value })}
            style={{ ...inp, flex: 1, minWidth: 220 }} placeholder="Nombre del flujo" />
          <button onClick={agregarPaso} className="btn outline sm">+ Paso</button>
          <button onClick={guardar} className="btn primary sm">Guardar borrador</button>
          <button onClick={publicar} className="btn accent sm">Publicar</button>
          <button onClick={simular} className="btn outline sm">▶ Simular</button>
        </div>

        {/* lienzo: pasos en secuencia */}
        <div style={{ display: "flex", gap: 0, overflowX: "auto", padding: "18px 4px", alignItems: "flex-start" }}>
          {pasos.map((p, i) => (
            <div key={p.tmpId} style={{ display: "flex", alignItems: "center" }}>
              <div style={{
                border: `2px solid ${COLOR[p.tipo] ?? "#6b7280"}`, borderRadius: p.tipo === "DECISION" ? 24 : 10,
                padding: "8px 10px", minWidth: 170, background: "#fff",
              }}>
                <select value={p.tipo} onChange={(e) => actualizarPaso(i, "tipo", e.target.value)}
                  style={{ fontSize: 10, color: COLOR[p.tipo], fontWeight: 700, border: "none", background: "transparent" }}>
                  {TIPOS.map((t) => <option key={t}>{t}</option>)}
                </select>
                <textarea value={p.actividad} onChange={(e) => actualizarPaso(i, "actividad", e.target.value)}
                  rows={2} style={{ width: "100%", fontSize: 12, border: "none", resize: "none", outline: "none" }} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <input value={p.slaMinutos ?? ""} onChange={(e) => actualizarPaso(i, "slaMinutos", e.target.value)}
                    placeholder="SLA min" style={{ ...inp, width: 70, fontSize: 10, padding: "2px 6px" }} />
                  <button onClick={() => eliminarPaso(i)} style={{ ...btn, color: "#dc2626", fontSize: 11 }}>✕</button>
                </div>
              </div>
              {i < pasos.length - 1 && <span style={{ padding: "0 6px", color: "#9ca3af", fontSize: 18 }}>→</span>}
            </div>
          ))}
        </div>

        {/* transiciones (incluye ramas de decisión) */}
        <h3 style={{ fontSize: 13, fontWeight: 700, marginTop: 6 }}>Transiciones</h3>
        <table style={{ fontSize: 12, borderCollapse: "collapse", marginTop: 6 }}>
          <thead><tr>{["Origen", "Destino", "Etiqueta", "Condición (DSL)"].map((h) => (
            <th key={h} style={{ textAlign: "left", padding: "4px 10px", color: "#6b7280", borderBottom: "1px solid #e5e7eb" }}>{h}</th>
          ))}</tr></thead>
          <tbody>
            {trans.map((t, i) => (
              <tr key={i}>
                <td style={td}>{pasos.find((p) => p.tmpId === t.origenTmp)?.actividad ?? t.origenTmp}</td>
                <td style={td}>{pasos.find((p) => p.tmpId === t.destinoTmp)?.actividad ?? t.destinoTmp}</td>
                <td style={td}>
                  <input value={t.etiqueta ?? ""} onChange={(e) => {
                    const c = [...trans]; c[i].etiqueta = e.target.value; setTrans(c);
                  }} style={{ ...inp, width: 70, fontSize: 11 }} />
                </td>
                <td style={td}>
                  <input value={t.condicion ?? ""} placeholder="ej: cumple == true" onChange={(e) => {
                    const c = [...trans]; c[i].condicion = e.target.value || null; setTrans(c);
                  }} style={{ ...inp, width: 190, fontSize: 11, fontFamily: "monospace" }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* simulación */}
        {simulacion && (
          <div style={{ marginTop: 18, border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700 }}>
              Instancia {simulacion.id?.slice(0, 8)} · estado: <span style={{ color: simulacion.estado === "completado" ? "#16a34a" : "#d97706" }}>{simulacion.estado}</span>
            </h3>
            <ol style={{ marginTop: 8, fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
              {simulacion.ejecuciones?.map((e: any) => (
                <li key={e.id}>
                  <span style={{ color: COLOR[e.paso?.tipo] ?? "#374151", fontWeight: 600 }}>{e.paso?.tipo}</span>{" "}
                  {e.paso?.actividad} — <em>{e.estado}</em>
                  {e.estado === "pendiente" && (
                    <button onClick={() => completar(e.id)} style={{ ...btn, marginLeft: 8, fontSize: 11, background: "#2563eb", color: "#fff" }}>
                      Completar (cumple=true)
                    </button>
                  )}
                </li>
              ))}
            </ol>
            {!pendiente && simulacion.estado !== "completado" && (
              <p style={{ fontSize: 12, color: "#6b7280" }}>Sin tareas pendientes visibles — el flujo puede estar en un paso automático.</p>
            )}
          </div>
        )}
      </main>
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  border: "1px solid #d1d5db", borderRadius: 7, padding: "5px 10px",
  fontSize: 12, background: "#fff", cursor: "pointer",
};
const inp: React.CSSProperties = {
  border: "1px solid #d1d5db", borderRadius: 7, padding: "5px 8px", fontSize: 13,
};
const td: React.CSSProperties = { padding: "4px 10px", borderBottom: "1px solid #f3f4f6" };
