"use client";

/**
 * Wizard de Nueva Cotización · Módulo Comercial LIMS IDIC
 * -----------------------------------------------------------------------------
 * 4 pasos funcionales de verdad:
 *   1 · Cliente      → busca contra /api/clientes?search= y fija clienteId + formato.
 *   2 · Costeo       → líneas de costo directo (Ejército) con preview de precios en vivo.
 *   3 · Condiciones  → forma de pago, validez (días), descuento %.
 *   4 · Revisión     → resumen + "Guardar cotización" → POST /api/cotizaciones.
 *
 * La cotización comercial es IVA EXENTO (ADM/imprimir.php:337): total = suma − descuento.
 * Al guardar con éxito → router.push("/cotizaciones").
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { clp, pct, rut as fmtRut } from "@/lib/format";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";

function auth(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("lims_token") : null;
  return { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) };
}

// Conceptos de la grilla de costeo (UI) → tipo válido del contrato POST.
// Contrato: "producto"|"viatico"|"pasaje"|"hora_hombre"|"hora_maquina"|"otros"|"extension".
const TIPOS = [
  { v: "viatico", l: "Viático" },
  { v: "hora_hombre_civil", l: "Hora-Hombre Civil" },
  { v: "hora_hombre_militar", l: "Hora-Hombre Militar" },
  { v: "hora_maquina", l: "Hora-Máquina" },
  { v: "pasaje", l: "Pasaje" },
  { v: "insumo", l: "Insumo" },
  { v: "otros", l: "Otros" },
];
const TIPO_POST: Record<string, string> = {
  viatico: "viatico",
  hora_hombre_civil: "hora_hombre",
  hora_hombre_militar: "hora_hombre",
  hora_maquina: "hora_maquina",
  pasaje: "pasaje",
  insumo: "otros",
  otros: "otros",
};

const FORMATOS = [
  { v: "F1", l: "F1 · Formato 1" },
  { v: "F2", l: "F2 · Formato 2" },
  { v: "F3", l: "F3 · Formato 3" },
  { v: "F4", l: "F4 · Formato 4" },
];

const FORMAS_PAGO = [
  { v: "", l: "— sin especificar —" },
  { v: "transferencia", l: "Transferencia" },
  { v: "cheque", l: "Cheque" },
  { v: "efectivo", l: "Efectivo" },
  { v: "credito_30", l: "Crédito 30 días" },
  { v: "credito_60", l: "Crédito 60 días" },
];

type Linea = { tipo: string; descripcion: string; cantidad: number; valorUnitario: number };
type Cliente = { id: string; razonSocial?: string; razon_social?: string; rut?: string };
type Issue = { path?: string | string[]; message: string };

const PASOS = ["Cliente", "Costeo", "Condiciones", "Revisión"];

export default function NuevaCotizacionPage() {
  const router = useRouter();
  const [step, setStep] = useState(1); // 1..4

  // Paso 1 · Cliente + formato
  const [q, setQ] = useState("");
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [clienteId, setClienteId] = useState("");
  const [clienteSel, setClienteSel] = useState<Cliente | null>(null);
  const [formato, setFormato] = useState("");

  // Paso 2 · Costeo
  const [lineas, setLineas] = useState<Linea[]>([
    { tipo: "hora_hombre_civil", descripcion: "Analista LQC", cantidad: 8, valorUnitario: 12000 },
    { tipo: "hora_maquina", descripcion: "Absorción atómica", cantidad: 3, valorUnitario: 35000 },
    { tipo: "insumo", descripcion: "Estándares y reactivos", cantidad: 1, valorUnitario: 45000 },
  ]);
  const [cfaPct, setCfaPct] = useState(12);
  const [margenParticularPct, setMargen] = useState(20);
  const [ivaPct, setIva] = useState(19);
  const [res, setRes] = useState<any>(null);

  // Paso 3 · Condiciones
  const [formaPago, setFormaPago] = useState("");
  const [validezDias, setValidezDias] = useState(30);
  const [descuentoPct, setDescuentoPct] = useState(0);
  const [notas, setNotas] = useState("");

  // Feedback
  const [error, setError] = useState("");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [saving, setSaving] = useState(false);

  // --- Búsqueda de clientes (debounce) ---------------------------------------
  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const r = await fetch(`${API}/clientes?search=${encodeURIComponent(q)}&limit=50`, {
          headers: auth(),
          signal: ctrl.signal,
        });
        if (!r.ok) throw new Error();
        const j = await r.json().catch(() => ({}));
        setClientes(j.data ?? (Array.isArray(j) ? j : []));
      } catch {
        if (!ctrl.signal.aborted) setClientes([]);
      } finally {
        if (!ctrl.signal.aborted) setBuscando(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const nombre = (c: Cliente) => c.razonSocial ?? c.razon_social ?? c.rut ?? c.id;

  // --- Costeo grid -----------------------------------------------------------
  const set = (i: number, k: keyof Linea, v: any) => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const add = () => setLineas((ls) => [...ls, { tipo: "otros", descripcion: "", cantidad: 1, valorUnitario: 0 }]);
  const del = (i: number) => setLineas((ls) => ls.filter((_, j) => j !== i));

  const lineasValidas = useMemo(
    () => lineas.filter((l) => Number(l.cantidad) > 0 && Number(l.valorUnitario) > 0),
    [lineas],
  );

  const subtotal = useMemo(
    () => lineasValidas.reduce((s, l) => s + Number(l.cantidad) * Number(l.valorUnitario), 0),
    [lineasValidas],
  );
  const montoDescuento = useMemo(() => (subtotal * (Number(descuentoPct) || 0)) / 100, [subtotal, descuentoPct]);
  const total = subtotal - montoDescuento; // IVA EXENTO

  // --- Preview de precios (opcional, endpoint de costeo) ----------------------
  async function calcular() {
    setError("");
    try {
      const body = {
        lineas: lineas.map((l) => ({ tipo: l.tipo, descripcion: l.descripcion, cantidad: Number(l.cantidad), valorUnitario: Number(l.valorUnitario) })),
        cfaPct: Number(cfaPct),
        margenParticularPct: Number(margenParticularPct),
        ivaPct: Number(ivaPct),
      };
      const r = await fetch(`${API}/cotizaciones/costeo`, { method: "POST", headers: auth(), body: JSON.stringify(body) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? `Error ${r.status}`);
      setRes(await r.json());
    } catch (e: any) {
      setError(Array.isArray(e.message) ? e.message.join(", ") : e.message);
    }
  }

  // --- Navegación de pasos ---------------------------------------------------
  const paso1Ok = !!clienteId && !!formato;
  const paso2Ok = lineasValidas.length >= 1;

  function puedeIr(target: number): boolean {
    if (target <= step) return true; // atrás siempre
    if (target >= 2 && !paso1Ok) return false;
    if (target >= 3 && !paso2Ok) return false;
    return true;
  }
  function irA(target: number) {
    setError("");
    setIssues([]);
    if (target < 1 || target > 4) return;
    if (!puedeIr(target)) {
      if (target >= 2 && !paso1Ok) setError("Selecciona un cliente y un formato para continuar.");
      else if (target >= 3 && !paso2Ok) setError("Añade al menos una línea con cantidad y valor unitario mayores que 0.");
      return;
    }
    setStep(target);
  }

  // --- Guardar cotización (POST /api/cotizaciones) ---------------------------
  async function guardar() {
    setError("");
    setIssues([]);
    if (!paso1Ok) return irA(1);
    if (!paso2Ok) return irA(2);
    setSaving(true);
    try {
      const body: any = {
        clienteId,
        formato,
        descuentoPct: Number(descuentoPct) || 0,
        validezDias: Number(validezDias) || undefined,
        formaPago: formaPago || undefined,
        notas: notas || undefined,
        lineas: lineasValidas.map((l) => ({
          tipo: TIPO_POST[l.tipo] ?? "otros",
          descripcion: l.descripcion || undefined,
          cantidad: Number(l.cantidad),
          precioUnitario: Number(l.valorUnitario),
        })),
      };
      const r = await fetch(`${API}/cotizaciones`, { method: "POST", headers: auth(), body: JSON.stringify(body) });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setIssues(Array.isArray(j.issues) ? j.issues : []);
        throw new Error(j.message ?? `Error ${r.status} al guardar la cotización`);
      }
      router.push("/cotizaciones");
    } catch (e: any) {
      setError(Array.isArray(e.message) ? e.message.join(", ") : e.message);
    } finally {
      setSaving(false);
    }
  }

  const cellInput: React.CSSProperties = { width: "100%", border: "1px solid var(--line)", borderRadius: 4, padding: "3px 6px", font: "inherit", fontSize: 12.5 };
  const pathStr = (p?: string | string[]) => (Array.isArray(p) ? p.join(".") : p ?? "");

  return (
    <div>
      <h1 className="page">Nueva Cotización</h1>
      <p className="subtitle">Wizard · costeo Ejército en vivo. Costos directos → CFA → Costo Total → precio a cotizar (IVA exento). Al aceptarse genera la OT/expediente.</p>

      <div className="wizard">
        {PASOS.map((label, idx) => {
          const n = idx + 1;
          const cls = n === step ? "st cur" : n < step ? "st done" : "st";
          return (
            <div
              key={label}
              className={cls}
              style={{ cursor: puedeIr(n) ? "pointer" : "not-allowed", opacity: puedeIr(n) ? 1 : 0.55 }}
              onClick={() => irA(n)}
            >
              <div className="n">{n}</div>
              {label}
            </div>
          );
        })}
      </div>

      {error && (
        <div className="alert warn">
          {error}
          {issues.length > 0 && (
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {issues.map((it, i) => (
                <li key={i}>
                  {pathStr(it.path) && <b>{pathStr(it.path)}: </b>}
                  {it.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ===================== PASO 1 · CLIENTE ===================== */}
      {step === 1 && (
        <div className="card">
          <h2>1 · Cliente</h2>
          <div className="form-grid cols-2">
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label>Buscar cliente (razón social / RUT)</label>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Escribe para buscar…" />
            </div>
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label>Cliente <span className="req">*</span> {buscando && <span style={{ color: "var(--muted)" }}>· buscando…</span>}</label>
              <select
                value={clienteId}
                onChange={(e) => {
                  setClienteId(e.target.value);
                  setClienteSel(clientes.find((c) => c.id === e.target.value) ?? null);
                }}
              >
                <option value="">— selecciona un cliente —</option>
                {clienteSel && !clientes.some((c) => c.id === clienteSel.id) && (
                  <option value={clienteSel.id}>{nombre(clienteSel)}</option>
                )}
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {nombre(c)}
                    {c.rut ? ` · ${fmtRut(c.rut)}` : ""}
                  </option>
                ))}
              </select>
              {!buscando && clientes.length === 0 && <small style={{ color: "var(--muted)" }}>Sin resultados para “{q}”.</small>}
            </div>
            <div className="field">
              <label>Formato de cotización <span className="req">*</span></label>
              <select value={formato} onChange={(e) => setFormato(e.target.value)}>
                <option value="">— selecciona formato —</option>
                {FORMATOS.map((f) => (
                  <option key={f.v} value={f.v}>{f.l}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="toolbar" style={{ marginTop: 12 }}>
            <div className="spacer" />
            <button className="btn primary sm" disabled={!paso1Ok} onClick={() => irA(2)}>Siguiente →</button>
          </div>
        </div>
      )}

      {/* ===================== PASO 2 · COSTEO ===================== */}
      {step === 2 && (
        <div className="split-3-1">
          <div className="card">
            <h2>2 · Costo directo <span className="right">Costeo Ejército</span></h2>
            <table className="data">
              <thead>
                <tr>
                  <th>Concepto</th><th>Detalle</th><th className="num">Cant.</th><th className="num">Valor u.</th><th className="num">Subtotal</th><th></th>
                </tr>
              </thead>
              <tbody>
                {lineas.map((l, i) => (
                  <tr key={i}>
                    <td>
                      <select style={cellInput} value={l.tipo} onChange={(e) => set(i, "tipo", e.target.value)}>
                        {TIPOS.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
                      </select>
                    </td>
                    <td><input style={cellInput} value={l.descripcion} onChange={(e) => set(i, "descripcion", e.target.value)} /></td>
                    <td className="num"><input type="number" style={{ ...cellInput, width: 56, textAlign: "right" }} value={l.cantidad} onChange={(e) => set(i, "cantidad", e.target.value)} /></td>
                    <td className="num"><input type="number" style={{ ...cellInput, width: 84, textAlign: "right" }} value={l.valorUnitario} onChange={(e) => set(i, "valorUnitario", e.target.value)} /></td>
                    <td className="num">{clp((Number(l.cantidad) || 0) * (Number(l.valorUnitario) || 0))}</td>
                    <td className="num"><span style={{ cursor: "pointer", color: "var(--muted)" }} onClick={() => del(i)}>✕</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 9 }}>
              <button onClick={add} className="btn outline sm">＋ Añadir línea</button>
            </div>

            <div className="form-grid cols-4" style={{ marginTop: 12 }}>
              <div className="field"><label>CFA %</label><input type="number" value={cfaPct} onChange={(e) => setCfaPct(+e.target.value)} /></div>
              <div className="field"><label>Margen particular %</label><input type="number" value={margenParticularPct} onChange={(e) => setMargen(+e.target.value)} /></div>
              <div className="field"><label>IVA %</label><input type="number" value={ivaPct} onChange={(e) => setIva(+e.target.value)} /></div>
              <div className="field" style={{ justifyContent: "flex-end" }}><button onClick={calcular} className="btn primary sm" style={{ justifyContent: "center" }}>Calcular costeo</button></div>
            </div>

            <div className="toolbar" style={{ marginTop: 12 }}>
              <button className="btn outline sm" onClick={() => irA(1)}>← Atrás</button>
              <div className="spacer" />
              <button className="btn primary sm" disabled={!paso2Ok} onClick={() => irA(3)}>Siguiente →</button>
            </div>
          </div>

          <div>
            <div className="card">
              <h2>Resumen</h2>
              <div className="totals-box">
                <div className="row"><span>CDT</span><b>{res ? clp(res.cdt) : "—"}</b></div>
                <div className="row"><span>CFA {res ? `(${pct(res.cfaPct)})` : ""}</span><b>{res ? clp(res.cfa) : "—"}</b></div>
                <div className="row total"><span>CT</span><b>{res ? clp(res.ct) : "—"}</b></div>
              </div>
              <div className="totals-box" style={{ marginTop: 6 }}>
                <div className="row"><span>Ejército</span><b>{res ? clp(res.precios?.ejercito) : "—"}</b></div>
                <div className="row"><span>Institucional</span><b>{res ? clp(res.precios?.institucional) : "—"}</b></div>
                <div className="row"><span>Particular {res ? `(+${pct(res.margenParticularPct)})` : ""}</span><b>{res ? clp(res.precios?.particular) : "—"}</b></div>
              </div>
            </div>
            <div className="card" style={{ background: "var(--primary)", color: "#fff" }}>
              {/* La cotización comercial es IVA EXENTO (ADM/imprimir.php:337). El precio a cotizar no lleva IVA. */}
              <div style={{ fontSize: 10, textTransform: "uppercase", opacity: 0.8 }}>Precio a cotizar (IVA exento · Ejército)</div>
              <div style={{ fontSize: 24, fontWeight: 800 }}>{res ? clp(Number(res.precios?.ejercito ?? res.ct)) : clp(total)}</div>
            </div>
          </div>
        </div>
      )}

      {/* ===================== PASO 3 · CONDICIONES ===================== */}
      {step === 3 && (
        <div className="card">
          <h2>3 · Condiciones comerciales</h2>
          <div className="form-grid cols-3">
            <div className="field">
              <label>Forma de pago</label>
              <select value={formaPago} onChange={(e) => setFormaPago(e.target.value)}>
                {FORMAS_PAGO.map((f) => <option key={f.v} value={f.v}>{f.l}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Validez (días)</label>
              <input type="number" min={1} value={validezDias} onChange={(e) => setValidezDias(+e.target.value)} />
            </div>
            <div className="field">
              <label>Descuento %</label>
              <input type="number" min={0} max={100} value={descuentoPct} onChange={(e) => setDescuentoPct(+e.target.value)} />
            </div>
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label>Notas</label>
              <textarea rows={3} value={notas} onChange={(e) => setNotas(e.target.value)} />
            </div>
          </div>
          <div className="totals-box" style={{ marginTop: 12 }}>
            <div className="row"><span>Subtotal</span><b>{clp(subtotal)}</b></div>
            <div className="row"><span>Descuento ({pct(descuentoPct)})</span><b>− {clp(montoDescuento)}</b></div>
            <div className="row total"><span>Total (IVA exento)</span><b>{clp(total)}</b></div>
          </div>
          <div className="toolbar" style={{ marginTop: 12 }}>
            <button className="btn outline sm" onClick={() => irA(2)}>← Atrás</button>
            <div className="spacer" />
            <button className="btn primary sm" onClick={() => irA(4)}>Siguiente →</button>
          </div>
        </div>
      )}

      {/* ===================== PASO 4 · REVISIÓN ===================== */}
      {step === 4 && (
        <div className="split-3-1">
          <div className="card">
            <h2>4 · Revisión</h2>
            <div className="form-grid cols-2" style={{ marginBottom: 12 }}>
              <div className="field"><label>Cliente</label><div>{clienteSel ? nombre(clienteSel) : "—"}</div></div>
              <div className="field"><label>Formato</label><div>{formato || "—"}</div></div>
              <div className="field"><label>Forma de pago</label><div>{FORMAS_PAGO.find((f) => f.v === formaPago)?.l ?? "—"}</div></div>
              <div className="field"><label>Validez</label><div>{validezDias} días</div></div>
            </div>
            <table className="data">
              <thead>
                <tr><th>Concepto</th><th>Detalle</th><th className="num">Cant.</th><th className="num">Precio u.</th><th className="num">Subtotal</th></tr>
              </thead>
              <tbody>
                {lineasValidas.map((l, i) => (
                  <tr key={i}>
                    <td>{TIPOS.find((t) => t.v === l.tipo)?.l ?? l.tipo}</td>
                    <td>{l.descripcion || "—"}</td>
                    <td className="num">{l.cantidad}</td>
                    <td className="num">{clp(l.valorUnitario)}</td>
                    <td className="num">{clp(Number(l.cantidad) * Number(l.valorUnitario))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {notas && <p style={{ marginTop: 10 }}><b>Notas:</b> {notas}</p>}
            <div className="toolbar" style={{ marginTop: 12 }}>
              <button className="btn outline sm" onClick={() => irA(3)}>← Atrás</button>
              <div className="spacer" />
              <button className="btn success sm" disabled={saving} onClick={guardar}>
                {saving ? "Guardando…" : "Guardar cotización"}
              </button>
            </div>
          </div>

          <div>
            <div className="card">
              <h2>Totales</h2>
              <div className="totals-box">
                <div className="row"><span>Subtotal</span><b>{clp(subtotal)}</b></div>
                <div className="row"><span>Descuento ({pct(descuentoPct)})</span><b>− {clp(montoDescuento)}</b></div>
                <div className="row total"><span>Total (IVA exento)</span><b>{clp(total)}</b></div>
              </div>
            </div>
            <div className="card" style={{ background: "var(--primary)", color: "#fff" }}>
              <div style={{ fontSize: 10, textTransform: "uppercase", opacity: 0.8 }}>Precio a cotizar (IVA exento)</div>
              <div style={{ fontSize: 24, fontWeight: 800 }}>{clp(total)}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
