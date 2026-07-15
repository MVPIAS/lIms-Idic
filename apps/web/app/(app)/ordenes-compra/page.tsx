"use client";

import { useCallback, useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const IVA_PCT = 19;

const clp = (n: any) => "$ " + Math.round(Number(n ?? 0)).toLocaleString("es-CL");
const fmtFecha = (v: any) => (v ? new Date(v).toLocaleDateString("es-CL") : "—");

const auth = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${typeof window === "undefined" ? "" : localStorage.getItem("lims_token")}`,
});

const ESTADOS = ["emitida", "en_curso", "recibida", "anulada"] as const;
type Estado = (typeof ESTADOS)[number];

const estadoBadge = (v: string) => (
  <span
    className={`pill ${v === "anulada" ? "red" : v === "recibida" ? "green" : v === "en_curso" ? "blue" : "amber"}`}
  >
    {v ?? "—"}
  </span>
);

type Linea = { descripcion: string; cantidad: number | string; precioUnitario: number | string };
type Proveedor = { id: string; razonSocial: string; rut?: string };

const LINEA_VACIA: Linea = { descripcion: "", cantidad: 1, precioUnitario: 0 };
const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Mensaje legible desde una respuesta Nest/Zod (`message` puede ser un array). */
async function errorDe(r: Response) {
  const b = await r.json().catch(() => ({}) as any);
  const m = b?.message ?? `Error ${r.status}`;
  return Array.isArray(m) ? m.map((x: any) => x?.message ?? x).join(", ") : String(m);
}

export default function OrdenesCompraPage() {
  const [ocs, setOcs] = useState<any[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [cargando, setCargando] = useState(true);
  const [alta, setAlta] = useState(false);

  const [proveedorId, setProveedorId] = useState("");
  const [fecha, setFecha] = useState("");
  const [estado, setEstado] = useState<Estado>("emitida");
  const [notas, setNotas] = useState("");
  const [lineas, setLineas] = useState<Linea[]>([{ ...LINEA_VACIA }]);

  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setError("");
    try {
      const [rOc, rProv] = await Promise.all([
        fetch(`${API}/ordenes-compra?limit=50`, { headers: auth() }),
        fetch(`${API}/proveedores?limit=100`, { headers: auth() }),
      ]);
      if (!rOc.ok) throw new Error(await errorDe(rOc));
      if (!rProv.ok) throw new Error(await errorDe(rProv));
      const oc = await rOc.json();
      const prov = await rProv.json();
      setOcs(oc?.data ?? []);
      setProveedores(prov?.data ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const set = (i: number, k: keyof Linea, v: any) =>
    setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const add = () => setLineas((ls) => [...ls, { ...LINEA_VACIA }]);
  const del = (i: number) => setLineas((ls) => (ls.length === 1 ? ls : ls.filter((_, j) => j !== i)));

  // Espejo de lo que calcula el servidor (neto = Σ subtotales). IVA/total son de referencia.
  const neto = lineas.reduce((a, l) => a + num(l.cantidad) * num(l.precioUnitario), 0);
  const iva = neto * (IVA_PCT / 100);
  const total = neto + iva;

  const limpiar = () => {
    setProveedorId("");
    setFecha("");
    setEstado("emitida");
    setNotas("");
    setLineas([{ ...LINEA_VACIA }]);
  };

  async function guardar() {
    setError("");
    setOk("");
    if (!proveedorId) return setError("Seleccione un proveedor.");
    const validas = lineas.filter((l) => l.descripcion.trim() !== "");
    if (!validas.length) return setError("La OC debe tener al menos una línea con descripción.");

    setGuardando(true);
    try {
      const body = {
        proveedorId,
        ...(fecha ? { fecha } : {}),
        ...(notas.trim() ? { notas: notas.trim() } : {}),
        estado,
        lineas: validas.map((l) => ({
          descripcion: l.descripcion.trim(),
          cantidad: num(l.cantidad),
          precioUnitario: num(l.precioUnitario),
        })),
      };
      const r = await fetch(`${API}/ordenes-compra`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await errorDe(r));
      const creada = await r.json();
      setOk(`OC ${creada?.numero ?? ""} creada · ${validas.length} línea(s) · ${clp(creada?.monto)} neto.`);
      limpiar();
      setAlta(false);
      await cargar();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  const cellInput: React.CSSProperties = {
    width: "100%",
    border: "1px solid var(--line)",
    borderRadius: 4,
    padding: "3px 6px",
    font: "inherit",
    fontSize: 12.5,
  };

  return (
    <div>
      <h1 className="page">Órdenes de Compra</h1>
      <p className="subtitle">
        OC a proveedores con sus líneas de detalle. El neto lo calcula el servidor a partir de las líneas; el IVA (
        {IVA_PCT}%) y el total se muestran como referencia.
      </p>

      {error && <div className="alert warn">{error}</div>}
      {ok && <div className="alert success">{ok}</div>}

      <div style={{ marginBottom: 11 }}>
        <button className={`btn ${alta ? "outline" : "primary"} sm`} onClick={() => setAlta((v) => !v)}>
          {alta ? "Cancelar" : "＋ Nueva orden de compra"}
        </button>
      </div>

      {alta && (
        <div className="split-3-1" style={{ marginBottom: 13 }}>
          <div className="card">
            <h2>Nueva OC</h2>

            <div className="form-grid">
              <div className="field">
                <label>Proveedor *</label>
                <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
                  <option value="">— Seleccione —</option>
                  {proveedores.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.razonSocial}
                      {p.rut ? ` · ${p.rut}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Fecha</label>
                <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
              </div>
              <div className="field">
                <label>Estado</label>
                <select value={estado} onChange={(e) => setEstado(e.target.value as Estado)}>
                  {ESTADOS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="field" style={{ marginTop: 12 }}>
              <label>Notas</label>
              <input
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                placeholder="Detalle / referencia de la OC"
              />
            </div>

            <h2 style={{ marginTop: 14 }}>
              Líneas <span className="right">{lineas.length} ítem(s)</span>
            </h2>
            <table className="data">
              <thead>
                <tr>
                  <th>Descripción</th>
                  <th className="num">Cant.</th>
                  <th className="num">Precio u.</th>
                  <th className="num">Subtotal</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lineas.map((l, i) => (
                  <tr key={i}>
                    <td>
                      <input
                        style={cellInput}
                        value={l.descripcion}
                        placeholder="Descripción del ítem"
                        onChange={(e) => set(i, "descripcion", e.target.value)}
                      />
                    </td>
                    <td className="num">
                      <input
                        type="number"
                        min={0}
                        style={{ ...cellInput, width: 64, textAlign: "right" }}
                        value={l.cantidad}
                        onChange={(e) => set(i, "cantidad", e.target.value)}
                      />
                    </td>
                    <td className="num">
                      <input
                        type="number"
                        min={0}
                        style={{ ...cellInput, width: 92, textAlign: "right" }}
                        value={l.precioUnitario}
                        onChange={(e) => set(i, "precioUnitario", e.target.value)}
                      />
                    </td>
                    <td className="num">{clp(num(l.cantidad) * num(l.precioUnitario))}</td>
                    <td className="num">
                      <span
                        title={lineas.length === 1 ? "La OC requiere al menos una línea" : "Quitar línea"}
                        style={{
                          cursor: lineas.length === 1 ? "not-allowed" : "pointer",
                          color: "var(--muted)",
                          opacity: lineas.length === 1 ? 0.4 : 1,
                        }}
                        onClick={() => del(i)}
                      >
                        ✕
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 9 }}>
              <button onClick={add} className="btn outline sm">
                ＋ Añadir línea
              </button>
            </div>
          </div>

          <div>
            <div className="card">
              <h2>Totales</h2>
              <div className="totals-box">
                <div className="row">
                  <span>Neto</span>
                  <b>{clp(neto)}</b>
                </div>
                <div className="row">
                  <span>IVA ({IVA_PCT}%)</span>
                  <b>{clp(iva)}</b>
                </div>
                <div className="row total">
                  <span>Total</span>
                  <b>{clp(total)}</b>
                </div>
              </div>
              <button
                className="btn primary sm"
                style={{ width: "100%", marginTop: 10, justifyContent: "center" }}
                disabled={guardando}
                onClick={guardar}
              >
                {guardando ? "Guardando…" : "Crear orden de compra"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="card card--table">
        <table className="data">
          <thead>
            <tr>
              <th>Número</th>
              <th>Proveedor</th>
              <th>Fecha</th>
              <th>Detalle</th>
              <th className="num">Líneas</th>
              <th className="num">Neto</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {cargando ? (
              <tr>
                <td colSpan={7}>Cargando…</td>
              </tr>
            ) : ocs.length === 0 ? (
              <tr>
                <td colSpan={7}>Sin órdenes de compra.</td>
              </tr>
            ) : (
              ocs.map((o) => (
                <tr key={o.id}>
                  <td>
                    <span className="codigo">{o.numero}</span>
                  </td>
                  <td>{o.proveedor?.razonSocial ?? "—"}</td>
                  <td>{fmtFecha(o.fecha)}</td>
                  <td>{o.detalle ?? "—"}</td>
                  <td className="num">{o.lineas?.length ?? 0}</td>
                  <td className="num">{clp(o.monto)}</td>
                  <td>{estadoBadge(o.estado)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
