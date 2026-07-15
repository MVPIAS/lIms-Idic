"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const auth = () => ({
  Authorization: `Bearer ${localStorage.getItem("lims_token")}`,
  "Content-Type": "application/json",
});

// RF-K02.3 · tipificación del elemento.
const TIPOS: { key: string; label: string; pill: string }[] = [
  { key: "arma", label: "Arma", pill: "red" },
  { key: "vainilla", label: "Vainilla", pill: "amber" },
  { key: "proyectil", label: "Proyectil", pill: "blue" },
  { key: "explosivo", label: "Explosivo", pill: "teal" },
  { key: "otro", label: "Otro", pill: "gray" },
];
const TIPO_META = Object.fromEntries(TIPOS.map((t) => [t.key, t]));

const ESTADOS: { key: string; label: string; pill: string }[] = [
  { key: "ingresada", label: "Ingresada", pill: "gray" },
  { key: "en_analisis", label: "En análisis", pill: "amber" },
  { key: "analizada", label: "Analizada", pill: "blue" },
  { key: "almacenada", label: "Almacenada", pill: "teal" },
  { key: "prestada", label: "Prestada", pill: "red" },
  { key: "devuelta", label: "Devuelta", pill: "green" },
  { key: "destruida", label: "Destruida", pill: "gray" },
];
const ESTADO_META = Object.fromEntries(ESTADOS.map((e) => [e.key, e]));

const fecha = (v: any) => (v ? new Date(v).toLocaleDateString("es-CL") : "—");

const FORM_VACIO = {
  tipo: "vainilla",
  descripcion: "",
  casoId: "",
  exhibitNumber: "",
  categoriaTexto: "",
  calibreTexto: "",
  marca: "",
  composicion: "",
  estado: "ingresada",
  codigoBarras: "",
  ubicacion: "",
  soporte: "fisica",
  procedencia: "",
  organismoSolicitante: "",
  clienteId: "",
  crearOt: false,
};

export default function SaecEvidenciasPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [casos, setCasos] = useState<any[]>([]);
  const [clientes, setClientes] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [f, setF] = useState<any>({ ...FORM_VACIO });
  const [fTipo, setFTipo] = useState("");
  const [fEstado, setFEstado] = useState("");
  const [q, setQ] = useState("");

  async function cargar() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (fTipo) params.set("tipo", fTipo);
      if (fEstado) params.set("estado", fEstado);
      if (q) params.set("q", q);

      const [e, c, cl] = await Promise.all([
        fetch(`${API}/evidencias?${params}`, { headers: auth() }).then((x) => x.json()),
        fetch(`${API}/saec/casos?limit=200`, { headers: auth() }).then((x) => x.json()),
        fetch(`${API}/clientes?limit=200`, { headers: auth() }).then((x) => x.json()).catch(() => ({ data: [] })),
      ]);
      setRows(e.data ?? (Array.isArray(e) ? e : []));
      setCasos(c.data ?? (Array.isArray(c) ? c : []));
      setClientes(cl.data ?? (Array.isArray(cl) ? cl : []));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [fTipo, fEstado]);

  const kpis = useMemo(() => ({
    total: rows.length,
    armas: rows.filter((r) => r.tipo === "arma").length,
    prestadas: rows.filter((r) => r.estado === "prestada").length,
    conHits: rows.filter((r) => Number(r.hit_count ?? 0) > 0).length,
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
      tipo: r.tipo ?? "otro",
      descripcion: r.descripcion ?? "",
      casoId: r.caso_id ?? "",
      exhibitNumber: r.exhibit_number ?? "",
      categoriaTexto: r.categoria_texto ?? "",
      calibreTexto: r.calibre_texto ?? "",
      marca: r.marca ?? "",
      composicion: r.composicion ?? "",
      estado: r.estado ?? "ingresada",
      codigoBarras: r.codigo_barras ?? "",
      ubicacion: r.ubicacion ?? "",
      soporte: r.soporte ?? "fisica",
      procedencia: r.procedencia ?? "",
      organismoSolicitante: r.organismo_solicitante ?? "",
      clienteId: r.cliente_id ?? "",
      crearOt: false,
    });
    setShow(true);
    setError("");
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const payload: any = {
      tipo: f.tipo,
      descripcion: f.descripcion || null,
      casoId: f.casoId || null,
      exhibitNumber: f.exhibitNumber || null,
      categoriaTexto: f.categoriaTexto || null,
      calibreTexto: f.calibreTexto || null,
      marca: f.marca || null,
      composicion: f.composicion || null,
      estado: f.estado,
      codigoBarras: f.codigoBarras || null,
      ubicacion: f.ubicacion || null,
      soporte: f.soporte,
      procedencia: f.procedencia || null,
      organismoSolicitante: f.organismoSolicitante || null,
      clienteId: f.clienteId || null,
    };
    if (!editId) payload.crearOt = Boolean(f.crearOt);

    try {
      const url = editId ? `${API}/evidencias/${editId}` : `${API}/evidencias`;
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

  async function eliminar(id: string, codigo: string) {
    if (!confirm(`¿Dar de baja la evidencia ${codigo}? La cadena de custodia se conserva.`)) return;
    setError("");
    try {
      const res = await fetch(`${API}/evidencias/${id}`, { method: "DELETE", headers: auth() });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `Error ${res.status}`);
      cargar();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div>
      <h1 className="page">SAEC · Evidencias y elementos</h1>
      <p className="subtitle">
        Banco de evidencias forenses: casos, elementos (armas, vainillas, proyectiles, explosivos), cadena de custodia,
        préstamos e importación de resultados balísticos desde IBIS/Forensic.
      </p>
      {error && <div className="alert warn">{error}</div>}

      <div className="kpis">
        <div className="kpi k-blue"><div className="lab">Evidencias</div><div className="val">{kpis.total}</div></div>
        <div className="kpi k-red"><div className="lab">Armas</div><div className="val">{kpis.armas}</div></div>
        <div className="kpi k-amber"><div className="lab">Prestadas</div><div className="val">{kpis.prestadas}</div></div>
        <div className="kpi k-violet"><div className="lab">Con coincidencias IBIS</div><div className="val">{kpis.conHits}</div></div>
      </div>

      <div className="toolbar" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <input
          placeholder="Buscar NUE, descripción, código de barras…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") cargar(); }}
          style={{ minWidth: 260 }}
        />
        <select value={fTipo} onChange={(e) => setFTipo(e.target.value)}>
          <option value="">Todos los tipos</option>
          {TIPOS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <select value={fEstado} onChange={(e) => setFEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          {ESTADOS.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
        </select>
        <button className="btn sm" onClick={() => cargar()}>Buscar</button>
        <div className="spacer" style={{ flex: 1 }}></div>
        <Link className="btn sm" href="/saec/armas">Armas</Link>
        <Link className="btn sm" href="/saec/ibis">Importar IBIS</Link>
        <Link className="btn sm" href="/saec/verificar">Verificar certificado</Link>
        <button className="btn primary sm" onClick={() => (show ? setShow(false) : abrirNueva())}>
          {show ? "Cerrar" : "＋ Nueva evidencia"}
        </button>
      </div>

      {show && (
        <form onSubmit={guardar} className="card" style={{ marginBottom: 12 }}>
          <div className="form-grid">
            <div className="field">
              <label>Tipo de elemento <span className="req">*</span></label>
              <select required value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
                {TIPOS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Caso</label>
              <select value={f.casoId} onChange={(e) => setF({ ...f, casoId: e.target.value })}>
                <option value="">— sin caso —</option>
                {casos.map((c) => <option key={c.id} value={c.id}>{c.numero_caso}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Estado</label>
              <select value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value })}>
                {ESTADOS.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
              </select>
            </div>
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label>Descripción</label>
              <textarea rows={2} value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} />
            </div>
            <div className="field"><label>Nº de evidencia (ESI)</label><input placeholder="CC1000, TF1003…" value={f.exhibitNumber} onChange={(e) => setF({ ...f, exhibitNumber: e.target.value })} /></div>
            <div className="field"><label>Categoría</label><input placeholder="Crime Evidence, Test Fire…" value={f.categoriaTexto} onChange={(e) => setF({ ...f, categoriaTexto: e.target.value })} /></div>
            <div className="field"><label>Calibre</label><input placeholder="9 mm Parabellum" value={f.calibreTexto} onChange={(e) => setF({ ...f, calibreTexto: e.target.value })} /></div>
            <div className="field"><label>Marca</label><input value={f.marca} onChange={(e) => setF({ ...f, marca: e.target.value })} /></div>
            <div className="field"><label>Composición</label><input value={f.composicion} onChange={(e) => setF({ ...f, composicion: e.target.value })} /></div>
            <div className="field">
              <label>Código de barras</label>
              <input placeholder="(por defecto, el NUE)" value={f.codigoBarras} onChange={(e) => setF({ ...f, codigoBarras: e.target.value })} />
            </div>
            <div className="field">
              <label>Ubicación física</label>
              <input placeholder="Bodega A · Estante 3" value={f.ubicacion} onChange={(e) => setF({ ...f, ubicacion: e.target.value })} />
            </div>
            <div className="field">
              <label>Soporte</label>
              <select value={f.soporte} onChange={(e) => setF({ ...f, soporte: e.target.value })}>
                <option value="fisica">Física</option>
                <option value="digital">Digitalizada</option>
                <option value="mixta">Mixta</option>
              </select>
            </div>
            <div className="field"><label>Procedencia</label><input placeholder="Incautación, hallazgo…" value={f.procedencia} onChange={(e) => setF({ ...f, procedencia: e.target.value })} /></div>
            <div className="field"><label>Organismo solicitante</label><input placeholder="Fiscalía, PDI, DGMN…" value={f.organismoSolicitante} onChange={(e) => setF({ ...f, organismoSolicitante: e.target.value })} /></div>
            <div className="field">
              <label>Cliente</label>
              <select value={f.clienteId} onChange={(e) => setF({ ...f, clienteId: e.target.value })}>
                <option value="">— sin cliente —</option>
                {clientes.map((c) => <option key={c.id} value={c.id}>{c.razonSocial ?? c.razon_social ?? c.rut}</option>)}
              </select>
            </div>
            {!editId && (
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={f.crearOt}
                    onChange={(e) => setF({ ...f, crearOt: e.target.checked })}
                    style={{ width: "auto" }}
                  />
                  Crear la orden de trabajo automáticamente (RF-K02.4) · requiere cliente
                </label>
              </div>
            )}
          </div>
          <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
            <button className="btn primary sm">{editId ? "Guardar cambios" : "Registrar evidencia"}</button>
          </div>
        </form>
      )}

      {loading && <div className="card" style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>Cargando…</div>}

      {!loading && (
        <div className="card card--table">
          <table className="data">
            <thead>
              <tr>
                <th>NUE</th>
                <th>Tipo</th>
                <th>Descripción</th>
                <th>Caso</th>
                <th>Calibre</th>
                <th>Ubicación</th>
                <th className="num">Hits</th>
                <th>Estado</th>
                <th>Ingreso</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><Link className="codigo" href={`/saec/evidencias/${r.id}`}>{r.codigo}</Link></td>
                  <td><span className={`pill ${TIPO_META[r.tipo]?.pill ?? "gray"}`}>{TIPO_META[r.tipo]?.label ?? r.tipo}</span></td>
                  <td style={{ maxWidth: 320 }}>{r.descripcion ?? "—"}</td>
                  <td>{r.caso?.numero_caso ?? "—"}</td>
                  <td>{r.calibre_texto ?? "—"}</td>
                  <td>{r.ubicacion ?? "—"}</td>
                  <td className="num">{Number(r.hit_count ?? 0) > 0 ? <strong>{r.hit_count}</strong> : "0"}</td>
                  <td><span className={`pill ${ESTADO_META[r.estado]?.pill ?? "gray"}`}>{ESTADO_META[r.estado]?.label ?? r.estado}</span></td>
                  <td>{fecha(r.created_at)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <Link className="btn sm" href={`/saec/evidencias/${r.id}`}>Ficha</Link>{" "}
                    <button className="btn sm" onClick={() => abrirEditar(r)}>Editar</button>{" "}
                    <button className="btn sm" onClick={() => eliminar(r.id, r.codigo)}>Baja</button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={10} style={{ textAlign: "center", color: "var(--muted)", padding: 18 }}>Sin evidencias que coincidan con el filtro.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
