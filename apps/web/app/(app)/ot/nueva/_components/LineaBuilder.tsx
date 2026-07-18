"use client";

import { useEffect, useMemo, useState } from "react";
import { apiGet, asArray, clp } from "./api";

// ── Tipos de la cascada (shape devuelto por los endpoints cascada/*) ──────────
type GranGrupo = { id: string; codigo: string; nombre: string };
type Grupo = { id: string; cgrupo: string; nombre: string };
type SubGrupo = { id: string; cntlroom: string; nombre: string };
type Familia = { id: string; codigo?: string; nombre: string };
type Elemento = { id: string; codigo: string; nombre: string; familiaId?: string; familiaNombre?: string };
type PanelMetodo = {
  metodoId: string;
  metodoCodigo: string;
  metodoNombre: string;
  ensayoId: string;
  ensayoCodigo: string;
  ensayoNombre: string;
  precio: number;
};

// Línea ya armada que se emite al padre para la tabla resumen + payload.
export type LineaOT = {
  elementoId: string;
  elementoCodigo: string;
  elementoNombre: string;
  familia: string;
  analista: string;
  tipoInspeccion: string;
  prioridad: string;
  cantidad: number;
  numMuestras: number;
  numPlanilla: string;
  metodos: { metodoId: string; metodoCodigo: string; metodoNombre: string; ensayoId: string; precio: number }[];
  subtotal: number;
};

export default function LineaBuilder({ onAdd }: { onAdd: (l: LineaOT) => void }) {
  // Catálogos de cada nivel de la cascada.
  const [granGrupos, setGranGrupos] = useState<GranGrupo[]>([]);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [subgrupos, setSubgrupos] = useState<SubGrupo[]>([]);
  const [familias, setFamilias] = useState<Familia[]>([]);
  const [elementos, setElementos] = useState<Elemento[]>([]);
  const [panel, setPanel] = useState<PanelMetodo[]>([]);

  // Selecciones de la cascada.
  const [granGrupoId, setGranGrupoId] = useState("");
  const [grupoId, setGrupoId] = useState("");
  const [subgrupoId, setSubgrupoId] = useState("");
  const [familiaId, setFamiliaId] = useState("");
  const [q, setQ] = useState("");
  const [elemento, setElemento] = useState<Elemento | null>(null);

  // Datos del elemento (editables, como el diálogo StarLIMS).
  const [analista, setAnalista] = useState("");
  const [prioridad, setPrioridad] = useState("normal");
  const [tipoInspeccion, setTipoInspeccion] = useState("");
  const [cantidad, setCantidad] = useState(1);
  const [numMuestras, setNumMuestras] = useState(1);
  const [numPlanilla, setNumPlanilla] = useState("");

  // Selección de métodos del panel (metodoId marcados).
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const [error, setError] = useState("");
  const [loadingPanel, setLoadingPanel] = useState(false);

  // 1 · Gran Grupos al montar.
  useEffect(() => {
    apiGet("/cascada/gran-grupos").then((d) => setGranGrupos(asArray(d))).catch((e) => setError(e.message));
    apiGet("/cascada/familias").then((d) => setFamilias(asArray(d))).catch(() => {});
  }, []);

  // 2 · Grupos al elegir Gran Grupo.
  useEffect(() => {
    setGrupoId(""); setGrupos([]); setSubgrupoId(""); setSubgrupos([]);
    if (!granGrupoId) return;
    apiGet(`/cascada/grupos?granGrupoId=${encodeURIComponent(granGrupoId)}`)
      .then((d) => setGrupos(asArray(d)))
      .catch((e) => setError(e.message));
  }, [granGrupoId]);

  // 3 · SubGrupos al elegir Grupo.
  useEffect(() => {
    setSubgrupoId(""); setSubgrupos([]);
    if (!grupoId) return;
    apiGet(`/cascada/subgrupos?grupoId=${encodeURIComponent(grupoId)}`)
      .then((d) => setSubgrupos(asArray(d)))
      .catch((e) => setError(e.message));
  }, [grupoId]);

  // 4 · Elementos al elegir SubGrupo o cambiar filtros (familia / búsqueda).
  useEffect(() => {
    setElemento(null);
    if (!subgrupoId) { setElementos([]); return; }
    const params = new URLSearchParams({ subgrupoId });
    if (q.trim()) params.set("q", q.trim());
    if (familiaId) params.set("familiaId", familiaId);
    apiGet(`/cascada/elementos?${params.toString()}`)
      .then((d) => setElementos(asArray(d)))
      .catch((e) => setError(e.message));
  }, [subgrupoId, q, familiaId]);

  // 6 · Panel de métodos al elegir Elemento.
  useEffect(() => {
    setPanel([]); setChecked({});
    if (!elemento) return;
    setLoadingPanel(true);
    apiGet(`/cascada/elementos/${encodeURIComponent(elemento.id)}/panel`)
      .then((d) => {
        const list = asArray<PanelMetodo>(d);
        setPanel(list);
        // Todos marcados por defecto.
        setChecked(Object.fromEntries(list.map((m) => [m.metodoId, true])));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingPanel(false));
  }, [elemento]);

  const metodosMarcados = useMemo(() => panel.filter((m) => checked[m.metodoId]), [panel, checked]);
  const subtotal = useMemo(() => metodosMarcados.reduce((s, m) => s + Number(m.precio ?? 0), 0), [metodosMarcados]);

  const resetElemento = () => {
    setGranGrupoId(""); setGrupoId(""); setSubgrupoId(""); setFamiliaId(""); setQ("");
    setElemento(null); setPanel([]); setChecked({});
    setAnalista(""); setPrioridad("normal"); setTipoInspeccion(""); setCantidad(1); setNumMuestras(1); setNumPlanilla("");
  };

  const puedeAgregar = !!elemento && metodosMarcados.length > 0;

  const agregar = () => {
    if (!elemento) return;
    onAdd({
      elementoId: elemento.id,
      elementoCodigo: elemento.codigo,
      elementoNombre: elemento.nombre,
      familia: elemento.familiaNombre ?? "",
      analista,
      tipoInspeccion,
      prioridad,
      cantidad: Number(cantidad) || 0,
      numMuestras: Number(numMuestras) || 0,
      numPlanilla,
      metodos: metodosMarcados.map((m) => ({
        metodoId: m.metodoId,
        metodoCodigo: m.metodoCodigo,
        metodoNombre: m.metodoNombre,
        ensayoId: m.ensayoId,
        precio: Number(m.precio ?? 0),
      })),
      subtotal,
    });
    resetElemento();
  };

  return (
    <div className="card">
      <h2>Datos del Elemento <span className="right">Registro Definitivo de O/T · clasificación en cascada</span></h2>

      {error && <div className="alert warn">{error}</div>}

      {/* Cascada de clasificación */}
      <div className="form-grid cols-4">
        <div className="field">
          <label>Gran Grupo</label>
          <select value={granGrupoId} onChange={(e) => setGranGrupoId(e.target.value)}>
            <option value="">— Seleccionar —</option>
            {granGrupos.map((g) => <option key={g.id} value={g.id}>{g.codigo} · {g.nombre}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Grupo</label>
          <select value={grupoId} onChange={(e) => setGrupoId(e.target.value)} disabled={!granGrupoId}>
            <option value="">— Seleccionar —</option>
            {grupos.map((g) => <option key={g.id} value={g.id}>{g.cgrupo} · {g.nombre}</option>)}
          </select>
        </div>
        <div className="field">
          <label>SubGrupo</label>
          <select value={subgrupoId} onChange={(e) => setSubgrupoId(e.target.value)} disabled={!grupoId}>
            <option value="">— Seleccionar —</option>
            {subgrupos.map((s) => <option key={s.id} value={s.id}>{s.cntlroom} · {s.nombre}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Familia / Laboratorio</label>
          <select value={familiaId} onChange={(e) => setFamiliaId(e.target.value)} disabled={!subgrupoId}>
            <option value="">— Todas —</option>
            {familias.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
          </select>
        </div>
      </div>

      {/* Buscador + lista de elementos */}
      <div className="field span-3" style={{ marginTop: 12 }}>
        <label>Buscar Elemento</label>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          disabled={!subgrupoId}
          placeholder={subgrupoId ? "Código o nombre del elemento…" : "Selecciona SubGrupo primero"}
        />
      </div>

      {subgrupoId && (
        <div className="card card--table" style={{ marginTop: 10, maxHeight: 240, overflow: "auto" }}>
          <table className="data">
            <thead>
              <tr><th>Código</th><th>Elemento</th><th>Familia</th><th></th></tr>
            </thead>
            <tbody>
              {elementos.map((el) => {
                const sel = elemento?.id === el.id;
                return (
                  <tr key={el.id} className="row-action" onClick={() => setElemento(el)} style={sel ? { background: "#eff5ff" } : undefined}>
                    <td><span className="codigo">{el.codigo}</span></td>
                    <td>{el.nombre}</td>
                    <td>{el.familiaNombre ?? "—"}</td>
                    <td className="num">{sel ? <span className="pill blue">elegido</span> : <span className="btn outline sm">Elegir</span>}</td>
                  </tr>
                );
              })}
              {elementos.length === 0 && (
                <tr><td colSpan={4} style={{ textAlign: "center", padding: 20, color: "var(--muted)" }}>Sin elementos para este subgrupo/filtro.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Datos derivados (readonly) + datos del elemento (editables) */}
      {elemento && (
        <>
          <div className="form-grid cols-4" style={{ marginTop: 14 }}>
            <div className="field readonly">
              <label>Código del elemento</label>
              <input value={elemento.codigo} readOnly />
            </div>
            <div className="field readonly span-3">
              <label>Familia / Laboratorio</label>
              <input value={elemento.familiaNombre ?? "—"} readOnly />
            </div>
          </div>

          <div className="form-grid cols-4" style={{ marginTop: 12 }}>
            <div className="field">
              <label>Analista</label>
              <input value={analista} onChange={(e) => setAnalista(e.target.value)} placeholder="Nombre analista" />
            </div>
            <div className="field">
              <label>Prioridad</label>
              <select value={prioridad} onChange={(e) => setPrioridad(e.target.value)}>
                <option value="normal">Normal</option>
                <option value="urgente">Urgente</option>
              </select>
            </div>
            <div className="field">
              <label>Tipo de Inspección</label>
              <input value={tipoInspeccion} onChange={(e) => setTipoInspeccion(e.target.value)} placeholder="Ej. Recepción" />
            </div>
            <div className="field">
              <label>Nº de Planilla</label>
              <input value={numPlanilla} onChange={(e) => setNumPlanilla(e.target.value)} />
            </div>
            <div className="field">
              <label>Cantidad</label>
              <input type="number" min={0} value={cantidad} onChange={(e) => setCantidad(+e.target.value)} />
            </div>
            <div className="field">
              <label>Nº de Muestras</label>
              <input type="number" min={0} value={numMuestras} onChange={(e) => setNumMuestras(+e.target.value)} />
            </div>
          </div>

          {/* Panel de métodos */}
          <h2 style={{ marginTop: 16 }}>Panel de métodos <span className="right">{metodosMarcados.length} de {panel.length} seleccionados</span></h2>
          <div className="card card--table">
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: 34 }}></th>
                  <th>Método</th>
                  <th>Ensayo</th>
                  <th className="num">Precio</th>
                </tr>
              </thead>
              <tbody>
                {panel.map((m) => (
                  <tr key={m.metodoId}>
                    <td>
                      <input
                        type="checkbox"
                        checked={!!checked[m.metodoId]}
                        onChange={(e) => setChecked((c) => ({ ...c, [m.metodoId]: e.target.checked }))}
                      />
                    </td>
                    <td><span className="codigo">{m.metodoCodigo}</span> {m.metodoNombre}</td>
                    <td><span className="codigo">{m.ensayoCodigo}</span> {m.ensayoNombre}</td>
                    <td className="num">{clp(m.precio)}</td>
                  </tr>
                ))}
                {loadingPanel && <tr><td colSpan={4} style={{ textAlign: "center", padding: 18, color: "var(--muted)" }}>Cargando panel…</td></tr>}
                {!loadingPanel && panel.length === 0 && (
                  <tr><td colSpan={4} style={{ textAlign: "center", padding: 18, color: "var(--muted)" }}>Este elemento no tiene métodos configurados.</td></tr>
                )}
              </tbody>
              {panel.length > 0 && (
                <tfoot>
                  <tr>
                    <td colSpan={3} className="num" style={{ fontWeight: 700 }}>Subtotal métodos marcados</td>
                    <td className="num" style={{ fontWeight: 700 }}>{clp(subtotal)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="btn primary" onClick={agregar} disabled={!puedeAgregar}>＋ Agregar elemento a la OT</button>
            <button className="btn outline" onClick={resetElemento}>Limpiar</button>
          </div>
        </>
      )}
    </div>
  );
}
