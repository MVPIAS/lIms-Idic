"use client";

/**
 * Nueva Cotización · Módulo Comercial LIMS IDIC
 *
 * IMPORTANTE: una cotización NO es una OT. Aquí solo se cotiza; al aceptarse,
 * el sistema genera la Orden de Trabajo (el expediente) en otra pantalla.
 *
 * Incluye el SIMULADOR DE COSTEO EJÉRCITO: líneas de costo directo
 * (viáticos, HH civil/militar, horas-máquina, pasajes, insumos, otros) →
 * CDT → CFA → CT → tres precios de salida (Ejército / Institucional / Particular),
 * y la tasa de internación 1,5%. El cálculo lo hace la API (CosteoService),
 * de modo que la pantalla y el backend usan la MISMA fórmula.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "/api";

type Tipo =
  | "viatico"
  | "hora_hombre_civil"
  | "hora_hombre_militar"
  | "hora_maquina"
  | "pasaje"
  | "insumo"
  | "otros";

const TIPO_LABEL: Record<Tipo, string> = {
  viatico: "Viático",
  hora_hombre_civil: "HH Civil",
  hora_hombre_militar: "HH Militar",
  hora_maquina: "Hora-Máquina",
  pasaje: "Pasaje",
  insumo: "Insumo",
  otros: "Otros",
};

type Linea = {
  id: number;
  tipo: Tipo;
  descripcion: string;
  cantidad: number;
  valorUnitario: number;
};

type Desglose = {
  costoDirecto: Record<string, number>;
  cdt: number;
  cfa: number;
  ct: number;
  cfaPct: number;
  precios: { ejercito: number; institucional: number; particular: number; ejercitoSinCfa: number };
  margenParticularPct: number;
};

const clp = (n: number) =>
  new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(
    n || 0,
  );

let seq = 1;
const nuevaLinea = (tipo: Tipo = "hora_hombre_militar"): Linea => ({
  id: seq++,
  tipo,
  descripcion: "",
  cantidad: 1,
  valorUnitario: 0,
});

export default function NuevaCotizacionPage() {
  // Cabecera
  const [cliente, setCliente] = useState("");
  const [rut, setRut] = useState("");
  const [tipoCliente, setTipoCliente] = useState<"ejercito" | "institucional" | "particular">("ejercito");
  const [formato, setFormato] = useState<"F1" | "F2" | "F3" | "F4">("F1");
  const [validezDias, setValidezDias] = useState(30);

  // Parámetros de costeo (config vigente IDIC)
  const [cfaPct, setCfaPct] = useState(12);
  const [margenPct, setMargenPct] = useState(20);

  // Líneas
  const [lineas, setLineas] = useState<Linea[]>([
    { id: seq++, tipo: "viatico", descripcion: "Perito en terreno", cantidad: 3, valorUnitario: 45000 },
    { id: seq++, tipo: "hora_hombre_militar", descripcion: "Analista balística", cantidad: 16, valorUnitario: 12000 },
    { id: seq++, tipo: "hora_maquina", descripcion: "Ensayo instrumental", cantidad: 4, valorUnitario: 35000 },
  ]);

  // Tasa internación
  const [conTasa, setConTasa] = useState(false);
  const [cifDivisa, setCifDivisa] = useState(0);
  const [paridad, setParidad] = useState(970);

  const [desglose, setDesglose] = useState<Desglose | null>(null);
  const [tasa, setTasa] = useState<any | null>(null);
  const [msg, setMsg] = useState("");

  const setLinea = (id: number, patch: Partial<Linea>) =>
    setLineas((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const delLinea = (id: number) => setLineas((ls) => ls.filter((l) => l.id !== id));

  const recalcular = useCallback(async () => {
    try {
      const r = await fetch(`${API}/cotizaciones/costeo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineas: lineas.map(({ tipo, descripcion, cantidad, valorUnitario }) => ({
            tipo,
            descripcion,
            cantidad: Number(cantidad) || 0,
            valorUnitario: Number(valorUnitario) || 0,
          })),
          cfaPct,
          margenParticularPct: margenPct,
        }),
      });
      if (r.ok) {
        setDesglose(await r.json());
        setMsg("");
      } else {
        setMsg("La API respondió " + r.status + " (¿backend arriba?). Mostrando cálculo local.");
        setDesglose(calcularLocal(lineas, cfaPct, margenPct));
      }
    } catch {
      // Fallback local: misma fórmula, para que la pantalla funcione sin backend
      setDesglose(calcularLocal(lineas, cfaPct, margenPct));
      setMsg("Sin conexión a la API — cálculo local (misma fórmula).");
    }
  }, [lineas, cfaPct, margenPct]);

  const recalcularTasa = useCallback(async () => {
    if (!conTasa || cifDivisa <= 0) {
      setTasa(null);
      return;
    }
    try {
      const r = await fetch(`${API}/cotizaciones/tasa-internacion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cifDivisa: Number(cifDivisa), paridad: Number(paridad) }),
      });
      setTasa(r.ok ? await r.json() : tasaLocal(cifDivisa, paridad));
    } catch {
      setTasa(tasaLocal(cifDivisa, paridad));
    }
  }, [conTasa, cifDivisa, paridad]);

  useEffect(() => {
    recalcular();
  }, [recalcular]);
  useEffect(() => {
    recalcularTasa();
  }, [recalcularTasa]);

  const precioSeleccionado = useMemo(() => {
    if (!desglose) return 0;
    return desglose.precios[tipoCliente];
  }, [desglose, tipoCliente]);

  const totalConTasaIva = (precioSeleccionado + (tasa?.total ?? 0)) * 1.19;

  return (
    <div className="max-w-6xl">
      <div className="flex items-baseline justify-between mb-1">
        <h1 className="text-xl font-bold">Nueva Cotización</h1>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-semibold">
          Una cotización NO es una OT — al aceptarse se genera la OT
        </span>
      </div>
      <p className="text-sm text-slate-500 mb-5">
        Costeo Ejército: costo directo → CFA → costo total → precio según tipo de cliente.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5">
        {/* --- Columna izquierda: formulario --- */}
        <div className="space-y-5">
          {/* Cabecera cliente */}
          <section className="bg-white rounded-lg border p-4 shadow-sm">
            <h2 className="font-bold text-sm mb-3">Cliente y formato</h2>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Cliente">
                <input
                  className="input"
                  value={cliente}
                  onChange={(e) => setCliente(e.target.value)}
                  placeholder="p. ej. FAMAE"
                />
              </Field>
              <Field label="RUT">
                <input
                  className="input"
                  value={rut}
                  onChange={(e) => setRut(e.target.value)}
                  placeholder="61.104.000-8"
                />
              </Field>
              <Field label="Tipo de cliente (define el precio)">
                <select
                  className="input"
                  value={tipoCliente}
                  onChange={(e) => setTipoCliente(e.target.value as any)}
                >
                  <option value="ejercito">Ejército (Costo Total, s/ margen)</option>
                  <option value="institucional">Institucional FFAA (s/ margen)</option>
                  <option value="particular">Particular (con margen)</option>
                </select>
              </Field>
              <Field label="Formato">
                <select className="input" value={formato} onChange={(e) => setFormato(e.target.value as any)}>
                  <option value="F1">F1 · Ensayo estándar</option>
                  <option value="F2">F2 · Ensayo + terreno</option>
                  <option value="F3">F3 · Peritaje</option>
                  <option value="F4">F4 · Internación</option>
                </select>
              </Field>
              <Field label="Validez (días)">
                <input
                  type="number"
                  className="input"
                  value={validezDias}
                  onChange={(e) => setValidezDias(+e.target.value)}
                />
              </Field>
            </div>
          </section>

          {/* Líneas de costo directo */}
          <section className="bg-white rounded-lg border p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-sm">Costo directo</h2>
              <button className="btn-sm" onClick={() => setLineas((l) => [...l, nuevaLinea()])}>
                ＋ Añadir línea
              </button>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase text-slate-500 border-b">
                  <th className="py-1.5 w-36">Tipo</th>
                  <th className="py-1.5">Descripción</th>
                  <th className="py-1.5 w-20 text-right">Cant.</th>
                  <th className="py-1.5 w-32 text-right">Valor unit.</th>
                  <th className="py-1.5 w-32 text-right">Subtotal</th>
                  <th className="py-1.5 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {lineas.map((l) => (
                  <tr key={l.id} className="border-b border-slate-100">
                    <td className="py-1.5 pr-2">
                      <select
                        className="input py-1"
                        value={l.tipo}
                        onChange={(e) => setLinea(l.id, { tipo: e.target.value as Tipo })}
                      >
                        {Object.entries(TIPO_LABEL).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        className="input py-1"
                        value={l.descripcion}
                        onChange={(e) => setLinea(l.id, { descripcion: e.target.value })}
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        type="number"
                        className="input py-1 text-right"
                        value={l.cantidad}
                        onChange={(e) => setLinea(l.id, { cantidad: +e.target.value })}
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        type="number"
                        className="input py-1 text-right"
                        value={l.valorUnitario}
                        onChange={(e) => setLinea(l.id, { valorUnitario: +e.target.value })}
                      />
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {clp((l.cantidad || 0) * (l.valorUnitario || 0))}
                    </td>
                    <td className="py-1.5 text-right">
                      <button
                        className="text-slate-400 hover:text-danger"
                        onClick={() => delLinea(l.id)}
                        aria-label="eliminar"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Parámetros + tasa */}
          <section className="bg-white rounded-lg border p-4 shadow-sm">
            <h2 className="font-bold text-sm mb-3">Parámetros de costeo</h2>
            <div className="grid grid-cols-2 gap-3">
              <Field label="CFA % (Costo Fijo Asociado)">
                <input
                  type="number"
                  className="input"
                  value={cfaPct}
                  onChange={(e) => setCfaPct(+e.target.value)}
                />
              </Field>
              <Field label="Margen particular %">
                <input
                  type="number"
                  className="input"
                  value={margenPct}
                  onChange={(e) => setMargenPct(+e.target.value)}
                />
              </Field>
            </div>

            <label className="flex items-center gap-2 mt-4 text-sm">
              <input type="checkbox" checked={conTasa} onChange={(e) => setConTasa(e.target.checked)} />
              Aplica tasa de internación 1,5% (servicio ligado a importación)
            </label>
            {conTasa && (
              <div className="grid grid-cols-2 gap-3 mt-3">
                <Field label="CIF (divisa)">
                  <input
                    type="number"
                    className="input"
                    value={cifDivisa}
                    onChange={(e) => setCifDivisa(+e.target.value)}
                  />
                </Field>
                <Field label="Paridad (CLP por divisa)">
                  <input
                    type="number"
                    className="input"
                    value={paridad}
                    onChange={(e) => setParidad(+e.target.value)}
                  />
                </Field>
              </div>
            )}
          </section>
        </div>

        {/* --- Columna derecha: resumen de costeo (sticky) --- */}
        <aside className="lg:sticky lg:top-4 self-start space-y-4">
          <div className="bg-white rounded-lg border p-4 shadow-sm">
            <h2 className="font-bold text-sm mb-3">Costeo</h2>
            {desglose && (
              <dl className="text-sm space-y-1.5">
                <Row k="Costo Directo Total (CDT)" v={clp(desglose.cdt)} />
                <Row k={`CFA (${desglose.cfaPct}%)`} v={clp(desglose.cfa)} />
                <Row k="Costo Total (CT)" v={clp(desglose.ct)} bold />
              </dl>
            )}
            <div className="border-t my-3" />
            <div className="text-[11px] uppercase text-slate-500 font-semibold mb-1">Precios de salida</div>
            {desglose && (
              <div className="space-y-1.5 text-sm">
                <PriceRow label="Ejército" v={desglose.precios.ejercito} sel={tipoCliente === "ejercito"} />
                <PriceRow
                  label="Institucional FFAA"
                  v={desglose.precios.institucional}
                  sel={tipoCliente === "institucional"}
                />
                <PriceRow
                  label={`Particular (+${desglose.margenParticularPct}%)`}
                  v={desglose.precios.particular}
                  sel={tipoCliente === "particular"}
                />
              </div>
            )}
          </div>

          {tasa && (
            <div className="bg-white rounded-lg border p-4 shadow-sm">
              <h2 className="font-bold text-sm mb-2">Tasa de internación</h2>
              <dl className="text-sm space-y-1.5">
                <Row k={`CIF en CLP`} v={clp(tasa.cifClp)} />
                <Row k={`Tasa ${tasa.tasaPct}%`} v={clp(tasa.tasa)} />
                <Row k={`IVA ${tasa.ivaPct}%`} v={clp(tasa.iva)} />
                <Row k="Total tasa" v={clp(tasa.total)} bold />
              </dl>
            </div>
          )}

          <div className="bg-primary text-white rounded-lg p-4 shadow-sm">
            <div className="text-[11px] uppercase opacity-80 font-semibold">Precio a cotizar (c/ IVA)</div>
            <div className="text-2xl font-bold tabular-nums mt-1">{clp(totalConTasaIva)}</div>
            <div className="text-[11px] opacity-80 mt-1">
              {TIPO_LABEL_CLIENTE[tipoCliente]}
              {tasa ? " + tasa internación" : ""} · IVA 19%
            </div>
            <button className="w-full mt-3 bg-white text-primary font-semibold rounded-md py-2 text-sm hover:bg-slate-100">
              Guardar cotización (borrador)
            </button>
            <p className="text-[10px] opacity-70 mt-2 leading-snug">
              Al aceptarse la cotización se generará la OT/expediente. Esta pantalla no crea la OT.
            </p>
          </div>

          {msg && <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">{msg}</div>}
        </aside>
      </div>

      {/* estilos utilitarios locales */}
      <style jsx>{`
        :global(.input) {
          width: 100%;
          border: 1px solid #d5dae2;
          border-radius: 6px;
          padding: 6px 8px;
          font-size: 13px;
        }
        :global(.input:focus) {
          outline: 2px solid #12817333;
          border-color: #127d73;
        }
        :global(.btn-sm) {
          font-size: 12px;
          font-weight: 600;
          color: #127d73;
          border: 1px solid #127d73;
          border-radius: 6px;
          padding: 3px 10px;
        }
        :global(.btn-sm:hover) {
          background: #12817310;
        }
      `}</style>
    </div>
  );
}

const TIPO_LABEL_CLIENTE: Record<string, string> = {
  ejercito: "Precio Ejército",
  institucional: "Precio Institucional FFAA",
  particular: "Precio Particular",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase text-slate-500 font-semibold mb-1">{label}</span>
      {children}
    </label>
  );
}

function Row({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "font-bold" : ""}`}>
      <dt className="text-slate-600">{k}</dt>
      <dd className="tabular-nums">{v}</dd>
    </div>
  );
}

function PriceRow({ label, v, sel }: { label: string; v: number; sel: boolean }) {
  return (
    <div
      className={`flex justify-between items-center px-2 py-1 rounded ${
        sel ? "bg-teal-50 ring-1 ring-teal-400 font-semibold" : ""
      }`}
    >
      <span className="text-slate-700">{label}</span>
      <span className="tabular-nums">{clp(v)}</span>
    </div>
  );
}

// --- Fallback local: MISMA fórmula que CosteoService, para que la UI funcione sin backend ---
function calcularLocal(lineas: Linea[], cfaPct: number, margenPct: number): Desglose {
  const costoDirecto: Record<string, number> = {};
  for (const l of lineas)
    costoDirecto[l.tipo] = (costoDirecto[l.tipo] ?? 0) + (l.cantidad || 0) * (l.valorUnitario || 0);
  const cdt = Object.values(costoDirecto).reduce((a, b) => a + b, 0);
  const cfa = cdt * (cfaPct / 100);
  const ct = cdt + cfa;
  return {
    costoDirecto,
    cdt: Math.round(cdt),
    cfa: Math.round(cfa),
    ct: Math.round(ct),
    cfaPct,
    precios: {
      ejercito: Math.round(ct),
      institucional: Math.round(ct),
      particular: Math.round(ct * (1 + margenPct / 100)),
      ejercitoSinCfa: Math.round(cdt),
    },
    margenParticularPct: margenPct,
  };
}

function tasaLocal(cif: number, paridad: number) {
  const cifClp = cif * paridad;
  const t = cifClp * 0.015;
  const iva = t * 0.19;
  return {
    cifClp: Math.round(cifClp),
    tasaPct: 1.5,
    tasa: Math.round(t),
    ivaPct: 19,
    iva: Math.round(iva),
    total: Math.round(t + iva),
  };
}
