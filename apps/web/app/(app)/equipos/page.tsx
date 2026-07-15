"use client";

import { useEffect, useMemo, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const auth = () => ({
  Authorization: `Bearer ${localStorage.getItem("lims_token")}`,
  "Content-Type": "application/json",
});

// RF-D04 · Equipos y condiciones (NCh-ISO/IEC 17025).
// El requisito nuclear es D04.2: un equipo con la calibración VENCIDA no puede
// usarse para ensayar. Aquí eso se hace visible (badge rojo + KPI + aviso en el
// detalle); el bloqueo efectivo lo aplica la API en EquiposService.verificarApto().

const ESTADOS: { key: string; label: string; pill: string }[] = [
  { key: "operativo", label: "Operativo", pill: "green" },
  { key: "en_calibracion", label: "En calibración", pill: "amber" },
  { key: "fuera_servicio", label: "Fuera de servicio", pill: "red" },
];
const ESTADO_META = Object.fromEntries(ESTADOS.map((e) => [e.key, e]));

const RESULTADOS: { key: string; label: string; pill: string }[] = [
  { key: "conforme", label: "Conforme", pill: "green" },
  { key: "conforme_con_obs", label: "Conforme c/obs.", pill: "amber" },
  { key: "no_conforme", label: "No conforme", pill: "red" },
];
const RESULTADO_META = Object.fromEntries(RESULTADOS.map((r) => [r.key, r]));

const fecha = (d: any) => (d ? String(d).slice(0, 10) : "—");

const hoyISO = () => new Date().toISOString().slice(0, 10);

const FORM_VACIO = {
  codigo: "",
  nombre: "",
  descripcion: "",
  fabricante: "",
  modelo: "",
  serie: "",
  ubicacion: "",
  unidadId: "",
  estado: "operativo",
  fechaUltimaCalibracion: "",
  proximaCalibracion: "",
  responsableId: "",
};

const CAL_VACIA = {
  fecha: "",
  ejecutadaPor: "",
  normaCalibracion: "",
  certificadoRef: "",
  resultado: "conforme",
  proximaFecha: "",
  observaciones: "",
};

/** Días hasta el vencimiento de la calibración. Negativo => vencida. */
function diasParaVencer(e: any): number | null {
  if (e?.dias_para_vencer != null) return Number(e.dias_para_vencer);
  if (!e?.proxima_calibracion) return null;
  const ms = new Date(fecha(e.proxima_calibracion)).getTime() - new Date(hoyISO()).getTime();
  return Math.round(ms / 86400000);
}

/** Badge de vigencia de calibración: rojo si vencida, ámbar si vence pronto. */
function BadgeCalibracion({ e }: { e: any }) {
  const d = diasParaVencer(e);
  if (!e?.proxima_calibracion) return <span className="pill gray">Sin calibración</span>;
  if (d != null && d < 0)
    return <span className="pill red">⚠ Vencida hace {Math.abs(d)} d</span>;
  if (d != null && d < 30) return <span className="pill amber">Vence en {d} d</span>;
  return <span className="pill green">Vigente</span>;
}

export default function EquiposPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [kpis, setKpis] = useState<any>({});
  const [unidades, setUnidades] = useState<any[]>([]);
  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [filtroEstado, setFiltroEstado] = useState("");
  const [soloVencidos, setSoloVencidos] = useState(false);
  const [search, setSearch] = useState("");

  const [show, setShow] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [f, setF] = useState<any>({ ...FORM_VACIO });

  // Detalle + historial de calibraciones.
  const [detalle, setDetalle] = useState<any | null>(null);
  const [calibs, setCalibs] = useState<any[]>([]);
  const [showCal, setShowCal] = useState(false);
  const [cal, setCal] = useState<any>({ ...CAL_VACIA });

  async function cargar() {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ limit: "200" });
      if (filtroEstado) qs.set("estado", filtroEstado);
      if (soloVencidos) qs.set("vencidos", "1");
      if (search.trim()) qs.set("search", search.trim());

      const res = await fetch(`${API}/equipos?${qs}`, { headers: auth() });
      if (!res.ok) throw new Error(`Error ${res.status} al cargar equipos`);
      const j = await res.json();
      setRows(j.data ?? (Array.isArray(j) ? j : []));
      setKpis(j.meta?.kpis ?? {});
      setError("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // Catálogos auxiliares del formulario. Son opcionales: si el usuario no tiene
  // `admin.usuarios` la lista de responsables vendrá vacía y el campo queda
  // deshabilitado, pero el alta de equipos sigue funcionando.
  async function cargarAux() {
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
    const [u, us] = await Promise.all([safe(`${API}/equipos/catalogo/unidades`), safe(`${API}/usuarios`)]);
    setUnidades(u);
    setUsuarios(us);
  }

  useEffect(() => {
    cargar();
  }, [filtroEstado, soloVencidos]);
  useEffect(() => {
    cargarAux();
  }, []);

  async function abrirDetalle(r: any) {
    setDetalle(r);
    setShowCal(false);
    setCal({ ...CAL_VACIA });
    try {
      const res = await fetch(`${API}/equipos/${r.id}/calibraciones`, { headers: auth() });
      const j = await res.json();
      setCalibs(j.data ?? []);
    } catch {
      setCalibs([]);
    }
  }

  function abrirNuevo() {
    setEditId(null);
    setF({ ...FORM_VACIO });
    setShow(true);
    setError("");
  }

  function abrirEditar(r: any) {
    setEditId(r.id);
    setF({
      codigo: r.codigo ?? "",
      nombre: r.nombre ?? "",
      descripcion: r.descripcion ?? "",
      fabricante: r.fabricante ?? "",
      modelo: r.modelo ?? "",
      serie: r.serie ?? "",
      ubicacion: r.ubicacion ?? "",
      unidadId: r.unidad_id ?? "",
      estado: r.estado ?? "operativo",
      fechaUltimaCalibracion: fecha(r.fecha_ultima_calibracion).replace("—", ""),
      proximaCalibracion: fecha(r.proxima_calibracion).replace("—", ""),
      responsableId: r.responsable_id ?? "",
    });
    setShow(true);
    setError("");
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const payload = {
      codigo: f.codigo,
      nombre: f.nombre,
      descripcion: f.descripcion || null,
      fabricante: f.fabricante || null,
      modelo: f.modelo || null,
      serie: f.serie || null,
      ubicacion: f.ubicacion || null,
      unidadId: f.unidadId || null,
      estado: f.estado,
      fechaUltimaCalibracion: f.fechaUltimaCalibracion || null,
      proximaCalibracion: f.proximaCalibracion || null,
      responsableId: f.responsableId || null,
    };
    try {
      const url = editId ? `${API}/equipos/${editId}` : `${API}/equipos`;
      const res = await fetch(url, {
        method: editId ? "PATCH" : "POST",
        headers: auth(),
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `Error ${res.status}`);
      setShow(false);
      setEditId(null);
      setF({ ...FORM_VACIO });
      setDetalle(null);
      cargar();
    } catch (e: any) {
      setError(Array.isArray(e.message) ? e.message.join(", ") : e.message);
    }
  }

  async function eliminar(r: any) {
    if (!confirm(`¿Dar de baja el equipo ${r.codigo}?`)) return;
    try {
      const res = await fetch(`${API}/equipos/${r.id}`, { method: "DELETE", headers: auth() });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      setDetalle(null);
      cargar();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function guardarCalibracion(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const res = await fetch(`${API}/calibraciones`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({
          equipoId: detalle.id,
          fecha: cal.fecha,
          ejecutadaPor: cal.ejecutadaPor || null,
          normaCalibracion: cal.normaCalibracion || null,
          certificadoRef: cal.certificadoRef || null,
          resultado: cal.resultado,
          proximaFecha: cal.proximaFecha || null,
          observaciones: cal.observaciones || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `Error ${res.status}`);
      setShowCal(false);
      setCal({ ...CAL_VACIA });
      // Recarga el listado y refresca el detalle con la vigencia ya actualizada.
      const j = await fetch(`${API}/equipos/${detalle.id}`, { headers: auth() }).then((x) => x.json());
      setDetalle(j);
      const h = await fetch(`${API}/equipos/${detalle.id}/calibraciones`, { headers: auth() }).then((x) => x.json());
      setCalibs(h.data ?? []);
      cargar();
    } catch (e: any) {
      setError(Array.isArray(e.message) ? e.message.join(", ") : e.message);
    }
  }

  const visibles = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.codigo, r.nombre, r.serie, r.fabricante, r.modelo]
        .filter(Boolean)
        .some((v: string) => String(v).toLowerCase().includes(q)),
    );
  }, [rows, search]);

  return (
    <div>
      <h1 className="page">Equipos y calibración</h1>
      <p className="subtitle">
        Parque de equipos del laboratorio y su estado de calibración (RF-D04, NCh-ISO/IEC 17025). Un equipo con la
        calibración <strong>vencida</strong> o que no esté <strong>operativo</strong> no es apto: la API rechaza la
        captura de resultados asociada a él.
      </p>
      {error && <div className="alert warn">{error}</div>}

      <div className="kpis">
        <div className="kpi k-blue">
          <div className="lab">Equipos</div>
          <div className="val">{kpis.total ?? rows.length}</div>
        </div>
        <div className="kpi k-green">
          <div className="lab">Operativos</div>
          <div className="val">{kpis.operativos ?? "—"}</div>
        </div>
        <div className="kpi k-violet">
          <div className="lab">Aptos para ensayo</div>
          <div className="val">{kpis.aptos ?? "—"}</div>
          <div className="delta">operativos y con calibración vigente</div>
        </div>
        <div className="kpi k-amber">
          <div className="lab">Vencen en 30 días</div>
          <div className="val">{kpis.por_vencer ?? "—"}</div>
        </div>
        <div className="kpi k-red">
          <div className="lab">Calibración vencida</div>
          <div className="val">{kpis.vencidos ?? "—"}</div>
          <div className="delta">bloqueados para ensayo</div>
        </div>
      </div>

      {Number(kpis.vencidos ?? 0) > 0 && (
        <div className="alert warn">
          <strong>{kpis.vencidos}</strong> equipo(s) con la calibración vencida. No pueden utilizarse para registrar
          resultados hasta que se registre una calibración conforme.
        </div>
      )}

      <div className="toolbar" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          placeholder="Buscar por código, nombre o serie…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 240 }}
        />
        <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          {ESTADOS.map((e) => (
            <option key={e.key} value={e.key}>
              {e.label}
            </option>
          ))}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5 }}>
          <input type="checkbox" checked={soloVencidos} onChange={(e) => setSoloVencidos(e.target.checked)} />
          Solo calibración vencida
        </label>
        <div className="spacer" style={{ flex: 1 }}></div>
        <button className="btn primary sm" onClick={() => (show ? setShow(false) : abrirNuevo())}>
          {show ? "Cerrar" : "＋ Nuevo equipo"}
        </button>
      </div>

      {show && (
        <form onSubmit={guardar} className="card">
          <div className="form-grid">
            <div className="field">
              <label>
                Código <span className="req">*</span>
              </label>
              <input
                required
                placeholder="EQ-HPLC-001"
                value={f.codigo}
                onChange={(e) => setF({ ...f, codigo: e.target.value })}
              />
            </div>
            <div className="field" style={{ gridColumn: "span 2" }}>
              <label>
                Nombre <span className="req">*</span>
              </label>
              <input required value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} />
            </div>
            <div className="field">
              <label>Marca / fabricante</label>
              <input value={f.fabricante} onChange={(e) => setF({ ...f, fabricante: e.target.value })} />
            </div>
            <div className="field">
              <label>Modelo</label>
              <input value={f.modelo} onChange={(e) => setF({ ...f, modelo: e.target.value })} />
            </div>
            <div className="field">
              <label>N° de serie</label>
              <input value={f.serie} onChange={(e) => setF({ ...f, serie: e.target.value })} />
            </div>
            <div className="field">
              <label>Ubicación</label>
              <input
                placeholder="LQC · Sala instrumental"
                value={f.ubicacion}
                onChange={(e) => setF({ ...f, ubicacion: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Unidad</label>
              <select value={f.unidadId} onChange={(e) => setF({ ...f, unidadId: e.target.value })}>
                <option value="">— sin unidad —</option>
                {unidades.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.codigo} · {u.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Estado</label>
              <select value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value })}>
                {ESTADOS.map((e) => (
                  <option key={e.key} value={e.key}>
                    {e.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Responsable</label>
              <select
                value={f.responsableId}
                disabled={!usuarios.length}
                onChange={(e) => setF({ ...f, responsableId: e.target.value })}
              >
                <option value="">— sin responsable —</option>
                {usuarios.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombreCompleto ?? u.nombre_completo ?? u.username}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Última calibración</label>
              <input
                type="date"
                value={f.fechaUltimaCalibracion}
                onChange={(e) => setF({ ...f, fechaUltimaCalibracion: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Calibración vigente hasta</label>
              <input
                type="date"
                value={f.proximaCalibracion}
                onChange={(e) => setF({ ...f, proximaCalibracion: e.target.value })}
              />
            </div>
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label>Descripción</label>
              <textarea rows={2} value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} />
            </div>
          </div>
          <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
            <button className="btn primary sm">{editId ? "Guardar cambios" : "Crear equipo"}</button>
          </div>
        </form>
      )}

      {loading && (
        <div className="card" style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>
          Cargando…
        </div>
      )}

      {!loading && (
        <div className="card">
          <table className="data">
            <thead>
              <tr>
                <th>Código</th>
                <th>Equipo</th>
                <th>Marca / modelo</th>
                <th>Ubicación</th>
                <th>Estado</th>
                <th>Vigente hasta</th>
                <th>Calibración</th>
                <th>Apto</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((r) => (
                <tr key={r.id} className="row-action" onClick={() => abrirDetalle(r)}>
                  <td>
                    <span className="codigo">{r.codigo}</span>
                  </td>
                  <td>{r.nombre}</td>
                  <td style={{ color: "var(--muted)" }}>
                    {[r.fabricante, r.modelo].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td style={{ color: "var(--muted)" }}>{r.ubicacion ?? r.unidad?.codigo ?? "—"}</td>
                  <td>
                    <span className={`pill ${ESTADO_META[r.estado]?.pill ?? "gray"}`}>
                      {ESTADO_META[r.estado]?.label ?? r.estado}
                    </span>
                  </td>
                  <td>{fecha(r.proxima_calibracion)}</td>
                  <td>
                    <BadgeCalibracion e={r} />
                  </td>
                  <td>
                    {r.apto ? (
                      <span className="pill green">Sí</span>
                    ) : (
                      <span className="pill red">No</span>
                    )}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }} onClick={(ev) => ev.stopPropagation()}>
                    <button className="btn sm" onClick={() => abrirEditar(r)}>
                      Editar
                    </button>{" "}
                    <button className="btn sm" onClick={() => eliminar(r)}>
                      Baja
                    </button>
                  </td>
                </tr>
              ))}
              {!visibles.length && (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", color: "var(--muted)", padding: 18 }}>
                    No hay equipos que coincidan con el filtro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ---------------- Detalle + historial de calibraciones ---------------- */}
      {detalle && (
        <div className="card" style={{ marginTop: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div>
              <span className="codigo">{detalle.codigo}</span>{" "}
              <strong style={{ fontSize: 14 }}>{detalle.nombre}</strong>{" "}
              <span className={`pill ${ESTADO_META[detalle.estado]?.pill ?? "gray"}`}>
                {ESTADO_META[detalle.estado]?.label ?? detalle.estado}
              </span>{" "}
              <BadgeCalibracion e={detalle} />
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn primary sm" onClick={() => setShowCal((v) => !v)}>
                {showCal ? "Cerrar" : "＋ Registrar calibración"}
              </button>
              <button className="btn sm" onClick={() => setDetalle(null)}>
                Cerrar detalle
              </button>
            </div>
          </div>

          {!detalle.apto && (
            <div className="alert warn">
              <strong>Equipo no apto para ensayo.</strong>{" "}
              {detalle.calibracion_vencida
                ? `Su calibración venció el ${fecha(detalle.proxima_calibracion)}. Registra una calibración conforme para reactivarlo.`
                : `Su estado es "${ESTADO_META[detalle.estado]?.label ?? detalle.estado}". Solo los equipos operativos con calibración vigente pueden usarse.`}
            </div>
          )}

          <div className="form-grid" style={{ marginBottom: 12 }}>
            <div className="field">
              <label>Marca / modelo</label>
              <div>{[detalle.fabricante, detalle.modelo].filter(Boolean).join(" · ") || "—"}</div>
            </div>
            <div className="field">
              <label>N° de serie</label>
              <div>{detalle.serie ?? "—"}</div>
            </div>
            <div className="field">
              <label>Ubicación</label>
              <div>{detalle.ubicacion ?? "—"}</div>
            </div>
            <div className="field">
              <label>Unidad</label>
              <div>{detalle.unidad ? `${detalle.unidad.codigo} · ${detalle.unidad.nombre}` : "—"}</div>
            </div>
            <div className="field">
              <label>Responsable</label>
              <div>{detalle.responsable?.nombre_completo ?? "—"}</div>
            </div>
            <div className="field">
              <label>Última calibración</label>
              <div>{fecha(detalle.fecha_ultima_calibracion)}</div>
            </div>
            <div className="field">
              <label>Vigente hasta</label>
              <div>{fecha(detalle.proxima_calibracion)}</div>
            </div>
          </div>

          {showCal && (
            <form onSubmit={guardarCalibracion} className="card" style={{ background: "var(--panel, #f7f9fb)" }}>
              <div className="form-grid">
                <div className="field">
                  <label>
                    Fecha de calibración <span className="req">*</span>
                  </label>
                  <input
                    required
                    type="date"
                    value={cal.fecha}
                    onChange={(e) => setCal({ ...cal, fecha: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>
                    Resultado <span className="req">*</span>
                  </label>
                  <select value={cal.resultado} onChange={(e) => setCal({ ...cal, resultado: e.target.value })}>
                    {RESULTADOS.map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Vigencia hasta</label>
                  <input
                    type="date"
                    value={cal.proximaFecha}
                    onChange={(e) => setCal({ ...cal, proximaFecha: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>Proveedor / laboratorio</label>
                  <input value={cal.ejecutadaPor} onChange={(e) => setCal({ ...cal, ejecutadaPor: e.target.value })} />
                </div>
                <div className="field">
                  <label>Norma</label>
                  <input
                    placeholder="NCh-ISO/IEC 17025"
                    value={cal.normaCalibracion}
                    onChange={(e) => setCal({ ...cal, normaCalibracion: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>N° de certificado</label>
                  <input
                    value={cal.certificadoRef}
                    onChange={(e) => setCal({ ...cal, certificadoRef: e.target.value })}
                  />
                </div>
                <div className="field" style={{ gridColumn: "1 / -1" }}>
                  <label>Observaciones</label>
                  <textarea
                    rows={2}
                    value={cal.observaciones}
                    onChange={(e) => setCal({ ...cal, observaciones: e.target.value })}
                  />
                </div>
              </div>
              <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
                  Un resultado conforme actualiza la vigencia del equipo y lo reactiva para ensayo.
                </span>
                <button className="btn primary sm">Registrar calibración</button>
              </div>
            </form>
          )}

          <h3 style={{ fontSize: 12.5, margin: "12px 0 6px" }}>Historial de calibraciones</h3>
          <table className="data">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Resultado</th>
                <th>Vigencia hasta</th>
                <th>Proveedor / laboratorio</th>
                <th>Norma</th>
                <th>Certificado</th>
                <th>Observaciones</th>
              </tr>
            </thead>
            <tbody>
              {calibs.map((c) => (
                <tr key={c.id}>
                  <td>{fecha(c.fecha)}</td>
                  <td>
                    <span className={`pill ${RESULTADO_META[c.resultado]?.pill ?? "gray"}`}>
                      {RESULTADO_META[c.resultado]?.label ?? c.resultado ?? "—"}
                    </span>
                  </td>
                  <td>{fecha(c.proxima_fecha)}</td>
                  <td>{c.ejecutada_por ?? "—"}</td>
                  <td style={{ color: "var(--muted)" }}>{c.norma_calibracion ?? "—"}</td>
                  <td>
                    <span className="codigo">{c.certificado_ref ?? "—"}</span>
                  </td>
                  <td style={{ color: "var(--muted)" }}>{c.observaciones ?? "—"}</td>
                </tr>
              ))}
              {!calibs.length && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", color: "var(--muted)", padding: 14 }}>
                    Sin calibraciones registradas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
