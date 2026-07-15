"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const auth = () => ({
  Authorization: `Bearer ${localStorage.getItem("lims_token")}`,
  "Content-Type": "application/json",
});

const TIPOS = ["pistola", "revolver", "fusil", "subfusil", "escopeta", "hechiza", "otro"];

// Estado registral ante la DGMN.
const REGISTRAL: { key: string; label: string; pill: string }[] = [
  { key: "inscrita", label: "Inscrita", pill: "green" },
  { key: "no_inscrita", label: "No inscrita", pill: "amber" },
  { key: "robada", label: "Robada", pill: "red" },
  { key: "encargo_vigente", label: "Encargo vigente", pill: "red" },
  { key: "decomisada", label: "Decomisada", pill: "blue" },
  { key: "destruida", label: "Destruida", pill: "gray" },
  { key: "en_tramite", label: "En trámite", pill: "teal" },
];
const REG_META = Object.fromEntries(REGISTRAL.map((r) => [r.key, r]));

const ESTADOS = ["en_custodia", "en_analisis", "prestada", "devuelta", "destruida"];
const fecha = (v: any) => (v ? new Date(v).toLocaleDateString("es-CL") : "—");

const FORM_VACIO = {
  serie: "",
  serieBorrada: false,
  marca: "",
  modelo: "",
  calibre: "",
  tipo: "pistola",
  estadoRegistral: "no_inscrita",
  inscripcionDgmn: "",
  fechaInscripcionDgmn: "",
  propietarioRegistrado: "",
  rutPropietario: "",
  estado: "en_custodia",
  ubicacion: "",
  evidenciaId: "",
  observaciones: "",
};

export default function SaecArmasPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [evidencias, setEvidencias] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [f, setF] = useState<any>({ ...FORM_VACIO });
  const [fReg, setFReg] = useState("");
  const [q, setQ] = useState("");

  async function cargar() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (fReg) params.set("estadoRegistral", fReg);
      if (q) params.set("q", q);
      const [a, e] = await Promise.all([
        fetch(`${API}/armas?${params}`, { headers: auth() }).then((x) => x.json()),
        fetch(`${API}/evidencias?tipo=arma&limit=200`, { headers: auth() }).then((x) => x.json()),
      ]);
      setRows(a.data ?? (Array.isArray(a) ? a : []));
      setEvidencias(e.data ?? (Array.isArray(e) ? e : []));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [fReg]);

  const kpis = useMemo(() => ({
    total: rows.length,
    inscritas: rows.filter((r) => r.estado_registral === "inscrita").length,
    encargo: rows.filter((r) => ["robada", "encargo_vigente"].includes(r.estado_registral)).length,
    sinSerie: rows.filter((r) => r.serie_borrada).length,
  }), [rows]);

  function abrirNueva() {
    setEditId(null);
    setF({ ...FORM_VACIO });
    setShow(true);
    setError("");
  }

  function abrirEditar(r: any) {
    setEditId(r.id);
    setF({
      serie: r.serie ?? "",
      serieBorrada: Boolean(r.serie_borrada),
      marca: r.marca ?? "",
      modelo: r.modelo ?? "",
      calibre: r.calibre ?? "",
      tipo: r.tipo ?? "pistola",
      estadoRegistral: r.estado_registral ?? "no_inscrita",
      inscripcionDgmn: r.inscripcion_dgmn ?? "",
      fechaInscripcionDgmn: r.fecha_inscripcion_dgmn ? String(r.fecha_inscripcion_dgmn).slice(0, 10) : "",
      propietarioRegistrado: r.propietario_registrado ?? "",
      rutPropietario: r.rut_propietario ?? "",
      estado: r.estado ?? "en_custodia",
      ubicacion: r.ubicacion ?? "",
      evidenciaId: r.evidencia_id ?? "",
      observaciones: r.observaciones ?? "",
    });
    setShow(true);
    setError("");
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const payload = {
      serie: f.serie || null,
      serieBorrada: Boolean(f.serieBorrada),
      marca: f.marca || null,
      modelo: f.modelo || null,
      calibre: f.calibre || null,
      tipo: f.tipo,
      estadoRegistral: f.estadoRegistral,
      inscripcionDgmn: f.inscripcionDgmn || null,
      fechaInscripcionDgmn: f.fechaInscripcionDgmn || null,
      propietarioRegistrado: f.propietarioRegistrado || null,
      rutPropietario: f.rutPropietario || null,
      estado: f.estado,
      ubicacion: f.ubicacion || null,
      evidenciaId: f.evidenciaId || null,
      observaciones: f.observaciones || null,
    };
    try {
      const url = editId ? `${API}/armas/${editId}` : `${API}/armas`;
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

  return (
    <div>
      <h1 className="page">SAEC · Registro de armas</h1>
      <p className="subtitle">
        Ficha registral de cada arma: identificación, estado ante la DGMN e inscripción. Un arma puede reingresar como
        evidencia en varios casos, por eso su ficha vive aparte del elemento que la originó.
      </p>
      {error && <div className="alert warn">{error}</div>}

      <div className="kpis">
        <div className="kpi k-blue"><div className="lab">Armas registradas</div><div className="val">{kpis.total}</div></div>
        <div className="kpi k-green"><div className="lab">Inscritas DGMN</div><div className="val">{kpis.inscritas}</div></div>
        <div className="kpi k-red"><div className="lab">Robadas / encargo</div><div className="val">{kpis.encargo}</div></div>
        <div className="kpi k-amber"><div className="lab">Serie limada</div><div className="val">{kpis.sinSerie}</div></div>
      </div>

      <div className="toolbar" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <input
          placeholder="Buscar serie, marca, modelo, inscripción…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") cargar(); }}
          style={{ minWidth: 250 }}
        />
        <select value={fReg} onChange={(e) => setFReg(e.target.value)}>
          <option value="">Todo estado registral</option>
          {REGISTRAL.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
        <button className="btn sm" onClick={() => cargar()}>Buscar</button>
        <div className="spacer" style={{ flex: 1 }}></div>
        <Link className="btn sm" href="/saec">Evidencias</Link>
        <button className="btn primary sm" onClick={() => (show ? setShow(false) : abrirNueva())}>
          {show ? "Cerrar" : "＋ Nueva arma"}
        </button>
      </div>

      {show && (
        <form onSubmit={guardar} className="card" style={{ marginBottom: 12 }}>
          <div className="form-grid">
            <div className="field">
              <label>Nº de serie</label>
              <input
                value={f.serie}
                disabled={f.serieBorrada}
                placeholder={f.serieBorrada ? "(serie limada)" : ""}
                onChange={(e) => setF({ ...f, serie: e.target.value })}
              />
            </div>
            <div className="field">
              <label>&nbsp;</label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 400 }}>
                <input
                  type="checkbox"
                  checked={f.serieBorrada}
                  onChange={(e) => setF({ ...f, serieBorrada: e.target.checked, serie: e.target.checked ? "" : f.serie })}
                  style={{ width: "auto" }}
                />
                Serie borrada / limada
              </label>
            </div>
            <div className="field">
              <label>Tipo <span className="req">*</span></label>
              <select required value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
                {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="field"><label>Marca</label><input value={f.marca} onChange={(e) => setF({ ...f, marca: e.target.value })} /></div>
            <div className="field"><label>Modelo</label><input value={f.modelo} onChange={(e) => setF({ ...f, modelo: e.target.value })} /></div>
            <div className="field"><label>Calibre</label><input placeholder="9 mm Parabellum" value={f.calibre} onChange={(e) => setF({ ...f, calibre: e.target.value })} /></div>
            <div className="field">
              <label>Estado registral</label>
              <select value={f.estadoRegistral} onChange={(e) => setF({ ...f, estadoRegistral: e.target.value })}>
                {REGISTRAL.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
            </div>
            <div className="field"><label>Nº inscripción DGMN</label><input value={f.inscripcionDgmn} onChange={(e) => setF({ ...f, inscripcionDgmn: e.target.value })} /></div>
            <div className="field"><label>Fecha inscripción DGMN</label><input type="date" value={f.fechaInscripcionDgmn} onChange={(e) => setF({ ...f, fechaInscripcionDgmn: e.target.value })} /></div>
            <div className="field"><label>Propietario registrado</label><input value={f.propietarioRegistrado} onChange={(e) => setF({ ...f, propietarioRegistrado: e.target.value })} /></div>
            <div className="field"><label>RUT propietario</label><input placeholder="12.345.678-9" value={f.rutPropietario} onChange={(e) => setF({ ...f, rutPropietario: e.target.value })} /></div>
            <div className="field">
              <label>Estado operativo</label>
              <select value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value })}>
                {ESTADOS.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Ubicación física</label>
              <input placeholder="Bodega A · Estante 3" value={f.ubicacion} onChange={(e) => setF({ ...f, ubicacion: e.target.value })} />
            </div>
            <div className="field">
              <label>Evidencia de ingreso</label>
              <select value={f.evidenciaId} onChange={(e) => setF({ ...f, evidenciaId: e.target.value })}>
                <option value="">— sin evidencia asociada —</option>
                {evidencias.map((e) => <option key={e.id} value={e.id}>{e.codigo} · {e.descripcion?.slice(0, 40)}</option>)}
              </select>
            </div>
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label>Observaciones</label>
              <textarea rows={2} value={f.observaciones} onChange={(e) => setF({ ...f, observaciones: e.target.value })} />
            </div>
          </div>
          <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
            <button className="btn primary sm">{editId ? "Guardar cambios" : "Registrar arma"}</button>
          </div>
        </form>
      )}

      {loading && <div className="card" style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>Cargando…</div>}

      {!loading && (
        <div className="card card--table">
          <table className="data">
            <thead>
              <tr>
                <th>Serie</th>
                <th>Tipo</th>
                <th>Marca / modelo</th>
                <th>Calibre</th>
                <th>Estado registral</th>
                <th>Inscripción DGMN</th>
                <th>Evidencia</th>
                <th>Alta</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.serie_borrada
                      ? <span className="pill amber">serie limada</span>
                      : <span className="codigo">{r.serie ?? "—"}</span>}
                  </td>
                  <td>{r.tipo}</td>
                  <td>{[r.marca, r.modelo].filter(Boolean).join(" ") || "—"}</td>
                  <td>{r.calibre ?? "—"}</td>
                  <td><span className={`pill ${REG_META[r.estado_registral]?.pill ?? "gray"}`}>{REG_META[r.estado_registral]?.label ?? r.estado_registral}</span></td>
                  <td>{r.inscripcion_dgmn ?? "—"}{r.fecha_inscripcion_dgmn ? ` · ${fecha(r.fecha_inscripcion_dgmn)}` : ""}</td>
                  <td>{r.evidencia_codigo ? <Link className="codigo" href={`/saec/evidencias/${r.evidencia_id}`}>{r.evidencia_codigo}</Link> : "—"}</td>
                  <td>{fecha(r.created_at)}</td>
                  <td><button className="btn sm" onClick={() => abrirEditar(r)}>Editar</button></td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--muted)", padding: 18 }}>Sin armas registradas.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
