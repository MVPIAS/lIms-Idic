"use client";

import { useEffect, useMemo, useState } from "react";

// Contrato §4.4.4 / §4.4.5 · CONSUMIBLES con lotes/stock/caducidad + KARDEX.
// Un consumible se recibe en LOTES (stock, nº de lote, caducidad); cada ensayo
// consume una cantidad que se descuenta del stock; el kardex registra entradas
// (compra), consumos (por ensayo/muestra/método) y ajustes de inventario.

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const auth = () => ({
  Authorization: `Bearer ${localStorage.getItem("lims_token")}`,
  "Content-Type": "application/json",
});

const fecha = (d: any) => (d ? String(d).slice(0, 10) : "—");
const num = (v: any) => (v == null ? 0 : Number(v));
const fmt = (v: any) => num(v).toLocaleString("es-CL", { maximumFractionDigits: 4 });

const TIPO_MOV: Record<string, { label: string; pill: string }> = {
  entrada: { label: "Entrada", pill: "green" },
  consumo: { label: "Consumo", pill: "amber" },
  ajuste: { label: "Ajuste", pill: "blue" },
};

const CONS_VACIO = {
  codigo: "",
  nombre: "",
  tipo: "",
  unidadMedida: "",
  stockMinimo: "",
};
const LOTE_VACIO = {
  numeroLote: "",
  fechaRecepcion: "",
  fechaVencimiento: "",
  cantidadInicial: "",
};
const MOV_VACIO = {
  tipo: "consumo",
  loteId: "",
  cantidad: "",
  motivo: "",
};

function BadgeLote({ l }: { l: any }) {
  if (l.caducado) return <span className="pill red">⚠ Caducado</span>;
  if (l.por_vencer) return <span className="pill amber">Por vencer</span>;
  if (num(l.cantidad_actual) <= 0) return <span className="pill gray">Agotado</span>;
  return <span className="pill green">Disponible</span>;
}

export default function ConsumiblesPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [kpis, setKpis] = useState<any>({});
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [showCons, setShowCons] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [f, setF] = useState<any>({ ...CONS_VACIO });

  // Detalle: consumible seleccionado + sus lotes.
  const [detalle, setDetalle] = useState<any | null>(null);
  const [lotes, setLotes] = useState<any[]>([]);
  const [showLote, setShowLote] = useState(false);
  const [lf, setLf] = useState<any>({ ...LOTE_VACIO });

  // Movimiento.
  const [showMov, setShowMov] = useState(false);
  const [mf, setMf] = useState<any>({ ...MOV_VACIO });

  // Kardex.
  const [kardex, setKardex] = useState<any | null>(null);

  function flash(msg: string) {
    setOk(msg);
    setTimeout(() => setOk(""), 3500);
  }

  async function cargar() {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ limit: "300" });
      if (search.trim()) qs.set("search", search.trim());
      const res = await fetch(`${API}/consumibles?${qs}`, { headers: auth() });
      if (!res.ok) throw new Error(`Error ${res.status} al cargar consumibles`);
      const j = await res.json();
      setRows(j.data ?? []);
      setKpis(j.meta?.kpis ?? {});
      setError("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibles = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.codigo, r.nombre, r.tipo].filter(Boolean).some((v: string) => String(v).toLowerCase().includes(q)),
    );
  }, [rows, search]);

  /* --- consumibles ------------------------------------------------------ */

  function abrirNuevoCons() {
    setEditId(null);
    setF({ ...CONS_VACIO });
    setShowCons(true);
  }
  function abrirEditarCons(r: any) {
    setEditId(r.id);
    setF({
      codigo: r.codigo ?? "",
      nombre: r.nombre ?? "",
      tipo: r.tipo ?? "",
      unidadMedida: r.unidad_medida ?? "",
      stockMinimo: r.stock_minimo ?? "",
    });
    setShowCons(true);
  }

  async function guardarCons(e: React.FormEvent) {
    e.preventDefault();
    try {
      const payload = { ...f, stockMinimo: f.stockMinimo === "" ? null : Number(f.stockMinimo) };
      const url = editId ? `${API}/consumibles/${editId}` : `${API}/consumibles`;
      const res = await fetch(url, {
        method: editId ? "PATCH" : "POST",
        headers: auth(),
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `Error ${res.status}`);
      setShowCons(false);
      flash(editId ? "Consumible actualizado" : "Consumible creado");
      await cargar();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function abrirDetalle(r: any) {
    setDetalle(r);
    setKardex(null);
    setShowLote(false);
    setShowMov(false);
    await cargarLotes(r.id);
  }

  async function cargarLotes(consumibleId: string) {
    try {
      const res = await fetch(`${API}/consumibles/lotes?consumibleId=${consumibleId}&limit=200`, {
        headers: auth(),
      });
      const j = await res.json();
      setLotes(j.data ?? []);
    } catch {
      setLotes([]);
    }
  }

  /* --- lotes ------------------------------------------------------------ */

  async function guardarLote(e: React.FormEvent) {
    e.preventDefault();
    if (!detalle) return;
    try {
      const payload = {
        consumibleId: detalle.id,
        numeroLote: lf.numeroLote,
        fechaRecepcion: lf.fechaRecepcion || null,
        fechaVencimiento: lf.fechaVencimiento || null,
        cantidadInicial: Number(lf.cantidadInicial || 0),
      };
      const res = await fetch(`${API}/consumibles/lotes`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `Error ${res.status}`);
      setShowLote(false);
      setLf({ ...LOTE_VACIO });
      flash("Lote registrado");
      await cargarLotes(detalle.id);
      await cargar();
    } catch (e: any) {
      setError(e.message);
    }
  }

  /* --- movimiento ------------------------------------------------------- */

  function abrirMov(loteId = "") {
    setMf({ ...MOV_VACIO, loteId });
    setShowMov(true);
  }

  async function guardarMov(e: React.FormEvent) {
    e.preventDefault();
    if (!detalle) return;
    try {
      const payload: any = {
        tipo: mf.tipo,
        cantidad: Number(mf.cantidad),
        motivo: mf.motivo || null,
      };
      if (mf.loteId) payload.loteId = mf.loteId;
      else payload.consumibleId = detalle.id; // consumo FIFO por caducidad
      const res = await fetch(`${API}/consumibles/movimiento`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message ?? `Error ${res.status}`);
      setShowMov(false);
      flash(`Movimiento registrado · stock resultante ${fmt(body.stock_resultante)}`);
      await cargarLotes(detalle.id);
      await cargar();
      if (kardex) await verKardex(detalle);
    } catch (e: any) {
      setError(e.message);
    }
  }

  /* --- kardex ----------------------------------------------------------- */

  async function verKardex(r: any) {
    try {
      const res = await fetch(`${API}/consumibles/${r.id}/kardex`, { headers: auth() });
      if (!res.ok) throw new Error(`Error ${res.status} al cargar kardex`);
      setKardex(await res.json());
    } catch (e: any) {
      setError(e.message);
    }
  }

  /* --- render ----------------------------------------------------------- */

  return (
    <div>
      <h1 className="page">Consumibles e inventario</h1>
      <p className="subtitle">
        Inventario de reactivos y consumibles por <strong>lotes</strong> (stock, nº de lote y caducidad). Cada ensayo
        <strong> consume</strong> stock; el <strong>kardex</strong> registra entradas, consumos y ajustes (contrato
        §4.4.4 / §4.4.5).
      </p>
      {error && <div className="alert warn">{error}</div>}
      {ok && <div className="alert" style={{ background: "var(--green-bg, #e6f4ea)", color: "#137333" }}>{ok}</div>}

      <div className="kpis">
        <div className="kpi k-blue">
          <div className="lab">Consumibles</div>
          <div className="val">{kpis.total ?? rows.length}</div>
        </div>
        <div className="kpi k-amber">
          <div className="lab">Lotes por vencer (30 d)</div>
          <div className="val">{kpis.lotes_por_vencer ?? "—"}</div>
        </div>
        <div className="kpi k-red">
          <div className="lab">Lotes caducados con stock</div>
          <div className="val">{kpis.lotes_caducados ?? "—"}</div>
        </div>
        <div className="kpi k-violet">
          <div className="lab">Bajo stock mínimo</div>
          <div className="val">{kpis.bajo_stock ?? "—"}</div>
        </div>
      </div>

      <div className="toolbar" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          placeholder="Buscar por código, nombre o tipo…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 260 }}
        />
        <div className="spacer" style={{ flex: 1 }}></div>
        <button className="btn primary sm" onClick={() => (showCons ? setShowCons(false) : abrirNuevoCons())}>
          {showCons ? "Cerrar" : "＋ Nuevo consumible"}
        </button>
      </div>

      {showCons && (
        <form onSubmit={guardarCons} className="card">
          <div className="form-grid">
            <div className="field">
              <label>Código <span className="req">*</span></label>
              <input required placeholder="RC-METOH-01" value={f.codigo} onChange={(e) => setF({ ...f, codigo: e.target.value })} />
            </div>
            <div className="field" style={{ gridColumn: "span 2" }}>
              <label>Nombre <span className="req">*</span></label>
              <input required value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} />
            </div>
            <div className="field">
              <label>Tipo</label>
              <input placeholder="reactivo, columna, estándar…" value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })} />
            </div>
            <div className="field">
              <label>Unidad de medida</label>
              <input placeholder="mL, g, unidad" value={f.unidadMedida} onChange={(e) => setF({ ...f, unidadMedida: e.target.value })} />
            </div>
            <div className="field">
              <label>Stock mínimo</label>
              <input type="number" step="any" value={f.stockMinimo} onChange={(e) => setF({ ...f, stockMinimo: e.target.value })} />
            </div>
          </div>
          <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
            <button className="btn primary sm">{editId ? "Guardar cambios" : "Crear consumible"}</button>
          </div>
        </form>
      )}

      {loading && (
        <div className="card" style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>Cargando…</div>
      )}

      {!loading && (
        <div className="card">
          <table className="data">
            <thead>
              <tr>
                <th>Código</th>
                <th>Nombre</th>
                <th>Tipo</th>
                <th>Unidad</th>
                <th style={{ textAlign: "right" }}>Stock</th>
                <th style={{ textAlign: "right" }}>Mínimo</th>
                <th>Lotes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((r) => (
                <tr key={r.id} className="row-action" onClick={() => abrirDetalle(r)}>
                  <td><span className="codigo">{r.codigo}</span></td>
                  <td>{r.nombre}{r.activo === false && <span className="pill gray" style={{ marginLeft: 6 }}>inactivo</span>}</td>
                  <td style={{ color: "var(--muted)" }}>{r.tipo ?? "—"}</td>
                  <td style={{ color: "var(--muted)" }}>{r.unidad_medida ?? "—"}</td>
                  <td style={{ textAlign: "right" }}>
                    {r.bajo_stock ? <span className="pill red">{fmt(r.stock_total)}</span> : fmt(r.stock_total)}
                  </td>
                  <td style={{ textAlign: "right", color: "var(--muted)" }}>{r.stock_minimo != null ? fmt(r.stock_minimo) : "—"}</td>
                  <td>
                    {num(r.lotes)}
                    {num(r.lotes_caducados) > 0 && <span className="pill red" style={{ marginLeft: 6 }}>{num(r.lotes_caducados)} cad.</span>}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button className="btn sm" onClick={() => abrirEditarCons(r)}>Editar</button>
                  </td>
                </tr>
              ))}
              {!visibles.length && (
                <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>Sin consumibles.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- Detalle: lotes + movimientos + kardex ---- */}
      {detalle && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0 }}>
              {detalle.codigo} · {detalle.nombre}
            </h2>
            <span className="pill blue">Stock {fmt(detalle.stock_total)} {detalle.unidad_medida ?? ""}</span>
            <div className="spacer" style={{ flex: 1 }}></div>
            <button className="btn sm" onClick={() => abrirMov("")}>Registrar movimiento</button>
            <button className="btn sm" onClick={() => setShowLote((s) => !s)}>{showLote ? "Cerrar" : "＋ Nuevo lote"}</button>
            <button className="btn sm" onClick={() => verKardex(detalle)}>Ver kardex</button>
            <button className="btn sm" onClick={() => setDetalle(null)}>✕</button>
          </div>

          {showLote && (
            <form onSubmit={guardarLote} className="card" style={{ marginTop: 12 }}>
              <div className="form-grid">
                <div className="field">
                  <label>N° de lote <span className="req">*</span></label>
                  <input required value={lf.numeroLote} onChange={(e) => setLf({ ...lf, numeroLote: e.target.value })} />
                </div>
                <div className="field">
                  <label>Cantidad inicial (stock) <span className="req">*</span></label>
                  <input required type="number" step="any" min="0" value={lf.cantidadInicial} onChange={(e) => setLf({ ...lf, cantidadInicial: e.target.value })} />
                </div>
                <div className="field">
                  <label>Fecha recepción</label>
                  <input type="date" value={lf.fechaRecepcion} onChange={(e) => setLf({ ...lf, fechaRecepcion: e.target.value })} />
                </div>
                <div className="field">
                  <label>Caducidad</label>
                  <input type="date" value={lf.fechaVencimiento} onChange={(e) => setLf({ ...lf, fechaVencimiento: e.target.value })} />
                </div>
              </div>
              <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
                <button className="btn primary sm">Registrar lote (entrada)</button>
              </div>
            </form>
          )}

          <table className="data" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Lote</th>
                <th style={{ textAlign: "right" }}>Stock</th>
                <th>Recepción</th>
                <th>Caducidad</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lotes.map((l) => (
                <tr key={l.id} style={l.caducado ? { background: "rgba(217,48,37,0.06)" } : undefined}>
                  <td><span className="codigo">{l.numero_lote}</span></td>
                  <td style={{ textAlign: "right" }}>{fmt(l.cantidad_actual)}</td>
                  <td style={{ color: "var(--muted)" }}>{fecha(l.fecha_recepcion)}</td>
                  <td style={{ color: "var(--muted)" }}>{fecha(l.fecha_vencimiento)}</td>
                  <td><BadgeLote l={l} /></td>
                  <td><button className="btn sm" onClick={() => abrirMov(l.id)}>Movimiento</button></td>
                </tr>
              ))}
              {!lotes.length && (
                <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: 16 }}>Sin lotes. Registre uno para tener stock.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- Modal movimiento ---- */}
      {showMov && detalle && (
        <div className="modal-backdrop" style={backdrop} onClick={() => setShowMov(false)}>
          <form className="card" style={modal} onClick={(e) => e.stopPropagation()} onSubmit={guardarMov}>
            <h3 style={{ marginTop: 0 }}>Registrar movimiento · {detalle.codigo}</h3>
            <div className="form-grid">
              <div className="field">
                <label>Tipo</label>
                <select value={mf.tipo} onChange={(e) => setMf({ ...mf, tipo: e.target.value })}>
                  <option value="entrada">Entrada (compra/recepción)</option>
                  <option value="consumo">Consumo (ensayo)</option>
                  <option value="ajuste">Ajuste (con signo)</option>
                </select>
              </div>
              <div className="field">
                <label>Lote {mf.tipo === "consumo" && <span style={{ color: "var(--muted)" }}>(vacío = FIFO por caducidad)</span>}</label>
                <select value={mf.loteId} onChange={(e) => setMf({ ...mf, loteId: e.target.value })}>
                  <option value="">{mf.tipo === "consumo" ? "— FIFO por caducidad —" : "— seleccione lote —"}</option>
                  {lotes.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.numero_lote} · stock {fmt(l.cantidad_actual)}{l.caducado ? " (caducado)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Cantidad {mf.tipo === "ajuste" && <span style={{ color: "var(--muted)" }}>(+ suma / − resta)</span>}</label>
                <input required type="number" step="any" value={mf.cantidad} onChange={(e) => setMf({ ...mf, cantidad: e.target.value })} />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label>Motivo</label>
                <input value={mf.motivo} onChange={(e) => setMf({ ...mf, motivo: e.target.value })} placeholder="ensayo, corrección de inventario, compra OC-123…" />
              </div>
            </div>
            <div style={{ marginTop: 12, display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="btn sm" onClick={() => setShowMov(false)}>Cancelar</button>
              <button className="btn primary sm">Registrar</button>
            </div>
          </form>
        </div>
      )}

      {/* ---- Modal kardex ---- */}
      {kardex && (
        <div className="modal-backdrop" style={backdrop} onClick={() => setKardex(null)}>
          <div className="card" style={{ ...modal, maxWidth: 900 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h3 style={{ margin: 0 }}>Kardex · {kardex.meta?.consumible?.codigo} {kardex.meta?.consumible?.nombre}</h3>
              <div className="spacer" style={{ flex: 1 }}></div>
              <button className="btn sm" onClick={() => setKardex(null)}>✕</button>
            </div>
            <div className="kpis" style={{ marginTop: 10 }}>
              <div className="kpi k-green"><div className="lab">Σ Entradas</div><div className="val">{fmt(kardex.meta?.resumen?.total_entradas)}</div></div>
              <div className="kpi k-amber"><div className="lab">Σ Consumos</div><div className="val">{fmt(kardex.meta?.resumen?.total_consumos)}</div></div>
              <div className="kpi k-blue"><div className="lab">Σ Ajustes</div><div className="val">{fmt(kardex.meta?.resumen?.total_ajustes)}</div></div>
              <div className="kpi k-violet"><div className="lab">Stock actual</div><div className="val">{fmt(kardex.meta?.resumen?.stock_actual)}</div></div>
            </div>
            <table className="data" style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Lote</th>
                  <th style={{ textAlign: "right" }}>Cantidad</th>
                  <th style={{ textAlign: "right" }}>Saldo</th>
                  <th>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {(kardex.data ?? []).map((m: any) => (
                  <tr key={m.id}>
                    <td style={{ color: "var(--muted)" }}>{String(m.created_at).slice(0, 16).replace("T", " ")}</td>
                    <td><span className={`pill ${TIPO_MOV[m.tipo]?.pill ?? "gray"}`}>{TIPO_MOV[m.tipo]?.label ?? m.tipo}</span></td>
                    <td>{m.numero_lote}</td>
                    <td style={{ textAlign: "right" }}>{m.delta > 0 ? "+" : ""}{fmt(m.delta)}</td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{fmt(m.saldo)}</td>
                    <td style={{ color: "var(--muted)" }}>
                      {[m.motivo, m.muestra_codigo && `muestra ${m.muestra_codigo}`, m.metodo_nombre].filter(Boolean).join(" · ") || "—"}
                    </td>
                  </tr>
                ))}
                {!(kardex.data ?? []).length && (
                  <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: 16 }}>Sin movimientos.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const backdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.4)",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  padding: "6vh 16px",
  zIndex: 50,
  overflowY: "auto",
};
const modal: React.CSSProperties = { maxWidth: 640, width: "100%" };
