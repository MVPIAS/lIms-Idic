"use client";

import { useEffect, useMemo, useState } from "react";
import { monto as clp, pct } from "@/lib/format";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const auth = () => ({
  Authorization: `Bearer ${localStorage.getItem("lims_token")}`,
  "Content-Type": "application/json",
});

// Etapas del pipeline (columnas del tablero) + estilo del pill.
const ETAPAS: { key: string; label: string; pill: string }[] = [
  { key: "prospecto", label: "Prospecto", pill: "gray" },
  { key: "calificada", label: "Calificada", pill: "blue" },
  { key: "propuesta", label: "Propuesta", pill: "teal" },
  { key: "negociacion", label: "Negociación", pill: "amber" },
  { key: "ganada", label: "Ganada", pill: "green" },
  { key: "perdida", label: "Perdida", pill: "red" },
];
const ETAPA_META = Object.fromEntries(ETAPAS.map((e) => [e.key, e]));

const FORM_VACIO = {
  titulo: "",
  clienteId: "",
  contacto: "",
  montoEstimado: "",
  etapa: "prospecto",
  probabilidad: "50",
  origen: "",
  fechaCierreEstimada: "",
  notas: "",
};

export default function CrmPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [clientes, setClientes] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [f, setF] = useState<any>({ ...FORM_VACIO });

  async function cargar() {
    setLoading(true);
    try {
      const [o, c] = await Promise.all([
        fetch(`${API}/oportunidades?limit=200`, { headers: auth() }).then((x) => x.json()),
        fetch(`${API}/clientes?limit=200`, { headers: auth() }).then((x) => x.json()),
      ]);
      setRows(o.data ?? (Array.isArray(o) ? o : []));
      setClientes(c.data ?? (Array.isArray(c) ? c : []));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { cargar(); }, []);

  // KPIs sobre el estado.
  const kpis = useMemo(() => {
    const vivas = rows.filter((r) => r.estado === "viva");
    const pipeline = vivas.reduce((s, r) => s + Number(r.monto_estimado ?? 0), 0);
    return {
      vivas: vivas.length,
      pipeline,
      ganadas: rows.filter((r) => r.estado === "ganada").length,
      perdidas: rows.filter((r) => r.estado === "perdida").length,
    };
  }, [rows]);

  const porEtapa = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const e of ETAPAS) map[e.key] = [];
    for (const r of rows) (map[r.etapa] ?? (map[r.etapa] = [])).push(r);
    return map;
  }, [rows]);

  function abrirNueva() {
    setEditId(null);
    setF({ ...FORM_VACIO });
    setShow(true);
    setError("");
  }

  function abrirEditar(r: any) {
    setEditId(r.id);
    setF({
      titulo: r.titulo ?? "",
      clienteId: r.cliente_id ?? "",
      contacto: r.contacto ?? "",
      montoEstimado: r.monto_estimado != null ? String(Number(r.monto_estimado)) : "",
      etapa: r.etapa ?? "prospecto",
      probabilidad: r.probabilidad != null ? String(r.probabilidad) : "50",
      origen: r.origen ?? "",
      fechaCierreEstimada: r.fecha_cierre_estimada ? String(r.fecha_cierre_estimada).slice(0, 10) : "",
      notas: r.notas ?? "",
    });
    setShow(true);
    setError("");
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const payload = {
      titulo: f.titulo,
      clienteId: f.clienteId || null,
      contacto: f.contacto || null,
      montoEstimado: f.montoEstimado === "" ? 0 : Number(f.montoEstimado),
      etapa: f.etapa,
      probabilidad: f.probabilidad === "" ? 50 : Number(f.probabilidad),
      origen: f.origen || null,
      fechaCierreEstimada: f.fechaCierreEstimada || null,
      notas: f.notas || null,
    };
    try {
      const url = editId ? `${API}/oportunidades/${editId}` : `${API}/oportunidades`;
      const res = await fetch(url, { method: editId ? "PATCH" : "POST", headers: auth(), body: JSON.stringify(payload) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `Error ${res.status}`);
      setShow(false);
      setEditId(null);
      setF({ ...FORM_VACIO });
      cargar();
    } catch (e: any) {
      setError(Array.isArray(e.message) ? e.message.join(", ") : e.message);
    }
  }

  async function accion(id: string, verbo: "ganar" | "perder") {
    setError("");
    try {
      const res = await fetch(`${API}/oportunidades/${id}/${verbo}`, { method: "POST", headers: auth() });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      cargar();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div>
      <h1 className="page">CRM · Oportunidades</h1>
      <p className="subtitle">
        Registra ofertas y oportunidades comerciales sin necesidad de crear una cotización formal. Gestiona el pipeline por
        etapas y conviértelas a cotización u OT cuando se ganen.
      </p>
      {error && <div className="alert warn">{error}</div>}

      <div className="kpis">
        <div className="kpi k-blue"><div className="lab">Oportunidades vivas</div><div className="val">{kpis.vivas}</div></div>
        <div className="kpi k-violet"><div className="lab">Pipeline estimado</div><div className="val">{clp(kpis.pipeline)}</div></div>
        <div className="kpi k-green"><div className="lab">Ganadas</div><div className="val">{kpis.ganadas}</div></div>
        <div className="kpi k-red"><div className="lab">Perdidas</div><div className="val">{kpis.perdidas}</div></div>
      </div>

      <div className="toolbar">
        <div className="spacer"></div>
        <button className="btn primary sm" onClick={() => (show ? setShow(false) : abrirNueva())}>
          {show ? "Cerrar" : "＋ Nueva oportunidad"}
        </button>
      </div>

      {show && (
        <form onSubmit={guardar} className="card">
          <div className="form-grid">
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label>Título <span className="req">*</span></label>
              <input required value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} />
            </div>
            <div className="field">
              <label>Cliente</label>
              <select value={f.clienteId} onChange={(e) => setF({ ...f, clienteId: e.target.value })}>
                <option value="">— sin cliente —</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>{c.razonSocial ?? c.razon_social ?? c.rut}</option>
                ))}
              </select>
            </div>
            <div className="field"><label>Contacto</label><input value={f.contacto} onChange={(e) => setF({ ...f, contacto: e.target.value })} /></div>
            <div className="field"><label>Monto estimado (CLP)</label><input type="number" min={0} value={f.montoEstimado} onChange={(e) => setF({ ...f, montoEstimado: e.target.value })} /></div>
            <div className="field">
              <label>Etapa</label>
              <select value={f.etapa} onChange={(e) => setF({ ...f, etapa: e.target.value })}>
                {ETAPAS.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
              </select>
            </div>
            <div className="field"><label>Probabilidad (%)</label><input type="number" min={0} max={100} value={f.probabilidad} onChange={(e) => setF({ ...f, probabilidad: e.target.value })} /></div>
            <div className="field"><label>Origen</label><input placeholder="referido, licitación, web…" value={f.origen} onChange={(e) => setF({ ...f, origen: e.target.value })} /></div>
            <div className="field"><label>Fecha cierre estimada</label><input type="date" value={f.fechaCierreEstimada} onChange={(e) => setF({ ...f, fechaCierreEstimada: e.target.value })} /></div>
            <div className="field" style={{ gridColumn: "1 / -1" }}><label>Notas</label><textarea rows={2} value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} /></div>
          </div>
          <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
            <button className="btn primary sm">{editId ? "Guardar cambios" : "Crear oportunidad"}</button>
          </div>
        </form>
      )}

      {loading && <div className="card" style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>Cargando…</div>}

      {!loading && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12, alignItems: "start" }}>
          {ETAPAS.map((et) => {
            const cards = porEtapa[et.key] ?? [];
            const suma = cards.reduce((s, r) => s + Number(r.monto_estimado ?? 0), 0);
            return (
              <div key={et.key} className="card" style={{ background: "var(--panel, #f7f9fb)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <span className={`pill ${et.pill}`}>{et.label}</span>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>{cards.length} · {clp(suma)}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {cards.map((r) => (
                    <div key={r.id} className="card" style={{ padding: 10, boxShadow: "none", border: "1px solid var(--line)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                        <span className="codigo" style={{ fontSize: 10.5 }}>{r.codigo}</span>
                        {r.estado !== "viva" && <span className={`pill ${r.estado === "ganada" ? "green" : "red"}`}>{r.estado}</span>}
                      </div>
                      <div style={{ fontWeight: 600, fontSize: 13, margin: "4px 0" }}>{r.titulo}</div>
                      <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{r.cliente?.razon_social ?? "— sin cliente —"}</div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                        <strong style={{ fontSize: 12.5 }}>{clp(r.monto_estimado, r.moneda)}</strong>
                        <span style={{ fontSize: 11, color: "var(--muted)" }}>{pct(r.probabilidad)}</span>
                      </div>
                      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                        <button className="btn sm" onClick={() => abrirEditar(r)}>Editar</button>
                        {r.estado === "viva" && (
                          <>
                            <button className="btn sm" onClick={() => accion(r.id, "ganar")}>Ganar</button>
                            <button className="btn sm" onClick={() => accion(r.id, "perder")}>Perder</button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                  {cards.length === 0 && (
                    <div style={{ fontSize: 11.5, color: "var(--muted)", textAlign: "center", padding: "10px 0" }}>—</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
