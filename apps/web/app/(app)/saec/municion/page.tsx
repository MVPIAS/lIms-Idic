"use client";

/**
 * D11 · Munición de prueba (EP-11 11.40 y 11.17): inventario por lote de
 * origen, órdenes internas de los laboratorios (LRB, LAM) con entrega por lote
 * y acta de entregados / usados / devueltos que cuadra al cerrar. El uso en la
 * prueba de fuego de las armas se descuenta desde la ficha del arma.
 * API: /d11/municion
 */
import { useCallback, useEffect, useState } from "react";
import { PageHeader, EmptyState, SkeletonRows } from "@/components/ui/PageHeader";
import RequierePermiso from "@/components/RequierePermiso";
import Modal from "@/components/documentos/Modal";
import { toast } from "@/components/ui/feedback";
import { usePermisos } from "@/lib/permisos";
import { fechaHora } from "@/lib/format";
import { abrirDocumento } from "@/lib/bpchProcesos";
import { pedir } from "@/lib/d11";

const ESTADO: Record<string, { texto: string; pill: string }> = {
  solicitada: { texto: "Solicitada", pill: "amber" },
  entregada: { texto: "Entregada · por cerrar", pill: "blue" },
  cerrada: { texto: "Cerrada", pill: "green" },
  anulada: { texto: "Anulada", pill: "gray" },
};
const coma = (n: number | null | undefined) => (n == null ? "—" : String(n).replace(".", ","));
const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
const LOTE_VACIO = { lote: "", calibre: "", descripcion: "", norma: "", nivel: "", masaBalaG: "", velocidadMs: "", cantidad: "" };

export default function MunicionD11Page() {
  return (
    <RequierePermiso perm="arma.ver" titulo="Munición de prueba">
      <Municion />
    </RequierePermiso>
  );
}

function Municion() {
  const { puede } = usePermisos();
  const gestiona = puede("municion.gestionar");
  const [lotes, setLotes] = useState<any[] | null>(null);
  const [ordenes, setOrdenes] = useState<any[] | null>(null);
  const [nuevoLote, setNuevoLote] = useState(false);
  const [l, setL] = useState({ ...LOTE_VACIO });
  const [error, setError] = useState("");
  const [verLote, setVerLote] = useState<any | null>(null);
  const [entrada, setEntrada] = useState<Record<string, Record<string, string>>>({});
  const v = (id: string, k: string) => entrada[id]?.[k] ?? "";
  const poner = (id: string, k: string, x: string) => setEntrada((e) => ({ ...e, [id]: { ...(e[id] ?? {}), [k]: x } }));

  const cargar = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([pedir<any[]>("GET", "/d11/municion/lotes"), pedir<any[]>("GET", "/d11/municion/solicitudes")]);
      setLotes(a);
      setOrdenes(b);
    } catch (e: any) {
      setError(e.message);
      setLotes([]);
      setOrdenes([]);
    }
  }, []);
  useEffect(() => {
    cargar();
  }, [cargar]);

  async function accion(ruta: string, cuerpo: unknown, ok: string) {
    try {
      await pedir("POST", ruta, cuerpo);
      toast.ok(ok);
      cargar();
      return true;
    } catch (e: any) {
      toast.error(e.message);
      return false;
    }
  }

  async function crearLote(ev: React.FormEvent) {
    ev.preventDefault();
    setError("");
    const cantidad = Number(l.cantidad);
    if (!l.lote.trim() || !l.calibre.trim() || !Number.isInteger(cantidad) || cantidad < 1) return setError("Indique lote, calibre y la cantidad inicial (entero mayor que cero).");
    const ok = await accion(
      "/d11/municion/lotes",
      { lote: l.lote.trim(), calibre: l.calibre.trim(), descripcion: l.descripcion || null, norma: l.norma || null, nivel: l.nivel || null, masaBalaG: num(l.masaBalaG), velocidadMs: num(l.velocidadMs), cantidad },
      `Lote ${l.lote} dado de alta con ${cantidad} cartucho(s).`,
    );
    if (ok) {
      setL({ ...LOTE_VACIO });
      setNuevoLote(false);
    }
  }

  const pendientes = (ordenes ?? []).filter((o) => o.estado === "solicitada" || o.estado === "entregada").length;

  return (
    <div>
      <PageHeader
        icono="🧰"
        titulo="Munición de prueba"
        subtitulo="Inventario por lote de la Delegación Nº 11 y órdenes internas de los laboratorios (LRB, LAM)."
        migas={[{ label: "SAEC" }, { label: "Munición de prueba" }]}
        acciones={gestiona && <button type="button" className="btn primary" onClick={() => setNuevoLote((x) => !x)} aria-expanded={nuevoLote}>{nuevoLote ? "Cerrar" : "＋ Alta de lote"}</button>}
      />
      {error && <div className="alert warn" role="alert">{error}</div>}
      {nuevoLote && (
        <form className="card" onSubmit={crearLote} style={{ marginBottom: 12 }} aria-label="Alta de lote" noValidate>
          <div className="form-grid">
            <div className="field"><label htmlFor="ml-l">Lote de origen <span className="req">*</span></label><input id="ml-l" value={l.lote} onChange={(e) => setL({ ...l, lote: e.target.value })} maxLength={60} /></div>
            <div className="field"><label htmlFor="ml-c">Calibre <span className="req">*</span></label><input id="ml-c" placeholder="9x19 mm" value={l.calibre} onChange={(e) => setL({ ...l, calibre: e.target.value })} maxLength={80} /></div>
            <div className="field"><label htmlFor="ml-q">Cantidad inicial <span className="req">*</span></label><input id="ml-q" inputMode="numeric" value={l.cantidad} onChange={(e) => setL({ ...l, cantidad: e.target.value })} /></div>
            <div className="field"><label htmlFor="ml-n">Norma</label><input id="ml-n" value={l.norma} onChange={(e) => setL({ ...l, norma: e.target.value })} maxLength={80} /></div>
            <div className="field"><label htmlFor="ml-nv">Nivel</label><input id="ml-nv" value={l.nivel} onChange={(e) => setL({ ...l, nivel: e.target.value })} maxLength={40} /></div>
            <div className="field"><label htmlFor="ml-m">Masa de bala (g)</label><input id="ml-m" inputMode="decimal" value={l.masaBalaG} onChange={(e) => setL({ ...l, masaBalaG: e.target.value })} /></div>
            <div className="field"><label htmlFor="ml-v">Velocidad (m/s)</label><input id="ml-v" inputMode="decimal" value={l.velocidadMs} onChange={(e) => setL({ ...l, velocidadMs: e.target.value })} /></div>
            <div className="field span-2"><label htmlFor="ml-d">Descripción</label><input id="ml-d" value={l.descripcion} onChange={(e) => setL({ ...l, descripcion: e.target.value })} maxLength={200} /></div>
          </div>
          <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}><button className="btn primary sm">Dar de alta el lote → inventario</button></div>
        </form>
      )}

      <h2 style={{ fontSize: 14, margin: "8px 0" }}>Órdenes de los laboratorios {pendientes > 0 && <span className="pill amber">{pendientes} por atender</span>}</h2>
      <div className="card card--table" style={{ marginBottom: 14 }}>
        <table className="data">
          <thead><tr><th>Orden</th><th>Laboratorio · OT</th><th>Pedido</th><th className="num">Pedidos</th><th>Estado</th><th>Siguiente paso</th></tr></thead>
          <tbody>
            {ordenes === null && <SkeletonRows cols={6} />}
            {ordenes?.map((o) => (
              <tr key={o.id}>
                <td className="codigo">{o.codigo}<small style={{ display: "block" }}>{fechaHora(o.createdAt)}</small></td>
                <td>{o.unidadCodigo}<small style={{ display: "block" }}>{o.otCodigo ?? "sin OT"}{o.itemHcp ? ` · HCP ${o.itemHcp}` : ""}</small></td>
                <td>{o.calibre} · {o.norma}{o.nivel ? ` · ${o.nivel}` : ""}<small style={{ display: "block" }}>{coma(o.masaBalaG)} g · {coma(o.velocidadMs)}{o.velocidadTolMs != null ? ` ± ${coma(o.velocidadTolMs)}` : ""} m/s</small></td>
                <td className="num">{o.cantidadPedida}</td>
                <td>
                  <span className={`pill ${ESTADO[o.estado]?.pill ?? "gray"}`}>{ESTADO[o.estado]?.texto ?? o.estado}</span>
                  {o.entregados != null && <small style={{ display: "block" }}>Entregados {o.entregados}{o.lote ? ` (lote ${o.lote})` : ""}{o.usados != null ? ` · usados ${o.usados} · devueltos ${o.devueltos}` : ""}</small>}
                </td>
                <td style={{ minWidth: 280 }}>
                  {o.estado === "solicitada" && gestiona && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <select aria-label="Lote de origen" value={v(o.id, "lote")} onChange={(e) => poner(o.id, "lote", e.target.value)} style={{ flex: 1, minWidth: 140 }}>
                        <option value="">Lote…</option>
                        {(lotes ?? []).filter((x) => x.activo && x.saldo > 0).map((x) => <option key={x.id} value={x.id}>{x.lote} · {x.calibre} ({x.saldo})</option>)}
                      </select>
                      <input aria-label="Cartuchos a entregar" inputMode="numeric" placeholder={String(o.cantidadPedida)} value={v(o.id, "cant")} onChange={(e) => poner(o.id, "cant", e.target.value)} style={{ width: 80 }} />
                      <button type="button" className="btn sm primary" disabled={!v(o.id, "lote")}
                        onClick={() => accion(`/d11/municion/solicitudes/${o.id}/entregar`, { loteId: v(o.id, "lote"), cantidad: Number(v(o.id, "cant") || o.cantidadPedida) }, `Munición entregada a ${o.unidadCodigo}.`)}>
                        Entregar munición → laboratorio
                      </button>
                    </div>
                  )}
                  {o.estado === "entregada" && gestiona && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      <input aria-label="Cartuchos usados" inputMode="numeric" placeholder="Usados" value={v(o.id, "us")} onChange={(e) => poner(o.id, "us", e.target.value)} style={{ width: 80 }} />
                      <input aria-label="Cartuchos devueltos" inputMode="numeric" placeholder="Devueltos" value={v(o.id, "dev")} onChange={(e) => poner(o.id, "dev", e.target.value)} style={{ width: 90 }} />
                      <button type="button" className="btn sm success" disabled={v(o.id, "us") === "" || v(o.id, "dev") === ""}
                        onClick={() => accion(`/d11/municion/solicitudes/${o.id}/cerrar`, { usados: Number(v(o.id, "us")), devueltos: Number(v(o.id, "dev")) }, `Acta ${o.codigo} cerrada y cuadrada.`)}>
                        Cerrar acta
                      </button>
                      <small style={{ color: "var(--muted)" }}>usados + devueltos = {o.entregados}</small>
                    </div>
                  )}
                  {(o.estado === "entregada" || o.estado === "cerrada") && (
                    <button type="button" className="btn sm ghost" style={{ marginTop: 4 }} onClick={() => abrirDocumento(`/d11/municion/solicitudes/${o.id}/acta`).catch((e) => toast.error(e.message))}>Acta</button>
                  )}
                  {o.estado === "anulada" && "—"}
                </td>
              </tr>
            ))}
            {ordenes?.length === 0 && <tr><td colSpan={6}><EmptyState icono="🎯" titulo="Sin órdenes" texto="Los laboratorios (LRB, LAM) piden la munición desde Laboratorio › Munición de prueba." /></td></tr>}
          </tbody>
        </table>
      </div>

      <h2 style={{ fontSize: 14, margin: "8px 0" }}>Inventario por lote</h2>
      <div className="card card--table">
        <table className="data">
          <thead><tr><th>Lote</th><th>Calibre</th><th>Norma · nivel</th><th>Masa · velocidad</th><th className="num">Saldo</th><th></th></tr></thead>
          <tbody>
            {lotes === null && <SkeletonRows cols={6} />}
            {lotes?.map((x) => (
              <tr key={x.id}>
                <td className="codigo">{x.lote}{!x.activo && <span className="pill gray" style={{ marginLeft: 4 }}>De baja</span>}</td>
                <td>{x.calibre}</td>
                <td>{x.norma ?? "—"}{x.nivel ? ` · ${x.nivel}` : ""}</td>
                <td>{coma(x.masaBalaG)} g · {coma(x.velocidadMs)} m/s</td>
                <td className="num"><b>{x.saldo}</b></td>
                <td><button type="button" className="btn sm" onClick={() => setVerLote(x)}>Movimientos</button></td>
              </tr>
            ))}
            {lotes?.length === 0 && <tr><td colSpan={6}><EmptyState icono="🧰" titulo="Sin lotes" texto={gestiona ? "Dé de alta el primer lote de munición de prueba." : undefined} /></td></tr>}
          </tbody>
        </table>
      </div>
      {verLote && <MovimientosLote lote={verLote} gestiona={gestiona} onCerrar={() => setVerLote(null)} onCambio={cargar} />}
    </div>
  );
}

function MovimientosLote({ lote, gestiona, onCerrar, onCambio }: { lote: any; gestiona: boolean; onCerrar: () => void; onCambio: () => void }) {
  const [movs, setMovs] = useState<any[] | null>(null);
  const [tipo, setTipo] = useState("entrada");
  const [cantidad, setCantidad] = useState("");
  const [obs, setObs] = useState("");
  const cargar = useCallback(() => {
    pedir<any[]>("GET", `/d11/municion/lotes/${lote.id}/movimientos`).then(setMovs).catch((e) => toast.error(e.message));
  }, [lote.id]);
  useEffect(() => cargar(), [cargar]);

  async function registrar() {
    try {
      await pedir("POST", `/d11/municion/lotes/${lote.id}/movimientos`, { tipo, cantidad: Number(cantidad), observaciones: obs || null });
      toast.ok(tipo === "entrada" ? "Entrada registrada." : "Baja registrada.");
      setCantidad("");
      setObs("");
      cargar();
      onCambio();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  return (
    <Modal titulo={<>Lote <span className="codigo">{lote.lote}</span> · {lote.calibre}</>} onCerrar={onCerrar} ancho={760}
      acciones={<button type="button" className="btn outline" onClick={onCerrar}>Cerrar</button>}>
      {gestiona && (
        <div className="toolbar" style={{ marginBottom: 10, flexWrap: "wrap" }}>
          <select aria-label="Tipo de movimiento" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="entrada">Entrada</option>
            <option value="ajuste_baja">Baja por ajuste</option>
          </select>
          <input aria-label="Cantidad" inputMode="numeric" placeholder="Cantidad" value={cantidad} onChange={(e) => setCantidad(e.target.value)} style={{ width: 100 }} />
          <input aria-label="Observaciones o motivo" placeholder={tipo === "ajuste_baja" ? "Motivo de la baja (obligatorio)" : "Observaciones"} value={obs} onChange={(e) => setObs(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
          <button type="button" className="btn sm primary" disabled={!cantidad || (tipo === "ajuste_baja" && !obs.trim())} onClick={registrar}>Registrar movimiento</button>
        </div>
      )}
      <table className="data">
        <thead><tr><th>Fecha</th><th>Movimiento</th><th className="num">Cartuchos</th><th>Referencia</th><th>Usuario</th></tr></thead>
        <tbody>
          {movs?.map((m) => (
            <tr key={m.id}>
              <td>{fechaHora(m.createdAt)}</td>
              <td>{m.tipoNombre}</td>
              <td className="num">{m.tipo === "entrada" || m.tipo === "devolucion" ? "+" : "−"}{m.cantidad}</td>
              <td>{[m.solicitud, m.ot, m.arma, m.observaciones].filter(Boolean).join(" · ") || "—"}</td>
              <td>{m.usuario ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: 12, color: "var(--muted)" }}>Los movimientos no se modifican ni se borran: un error se corrige con un movimiento nuevo.</p>
    </Modal>
  );
}
