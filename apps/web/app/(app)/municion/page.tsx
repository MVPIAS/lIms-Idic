"use client";

/**
 * Laboratorio · Munición de prueba (EP-05 2.5 y 3.4, EP-11 11.40): el LRB o el
 * LAM pide a la Delegación Nº 11 la munición para sus ensayos con los datos
 * estructurados (norma, nivel, calibre, masa, velocidad ± tolerancia,
 * cantidad, OT e ítem de HCP) y sigue la entrega y el acta.
 * API: /municion
 */
import { useCallback, useEffect, useState } from "react";
import { PageHeader, EmptyState, SkeletonRows } from "@/components/ui/PageHeader";
import RequierePermiso from "@/components/RequierePermiso";
import { toast } from "@/components/ui/feedback";
import { fechaHora } from "@/lib/format";
import { abrirDocumento } from "@/lib/bpchProcesos";
import { pedir } from "@/lib/d11";

const ESTADO: Record<string, { texto: string; pill: string }> = {
  solicitada: { texto: "Solicitada · espera a la D11", pill: "amber" },
  entregada: { texto: "Entregada · rinda usados y devueltos a la D11", pill: "blue" },
  cerrada: { texto: "Cerrada", pill: "green" },
  anulada: { texto: "Anulada", pill: "gray" },
};
const coma = (n: number | null | undefined) => (n == null ? "—" : String(n).replace(".", ","));
const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
const VACIO = { unidadId: "", otCodigo: "", itemHcp: "", norma: "", nivel: "", calibre: "", masaBalaG: "", velocidadMs: "", velocidadTolMs: "", cantidadPedida: "", observaciones: "" };

export default function MunicionLaboratorioPage() {
  return (
    <RequierePermiso perm="municion.solicitar" titulo="Munición de prueba">
      <Pedidos />
    </RequierePermiso>
  );
}

function Pedidos() {
  const [unidades, setUnidades] = useState<{ id: string; codigo: string; nombre: string }[]>([]);
  const [filas, setFilas] = useState<any[] | null>(null);
  const [f, setF] = useState({ ...VACIO });
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState("");

  const cargar = useCallback(() => {
    pedir<any[]>("GET", "/municion/solicitudes").then(setFilas).catch((e) => { setError(e.message); setFilas([]); });
  }, []);
  useEffect(() => {
    cargar();
    pedir<any[]>("GET", "/municion/unidades")
      .then((u) => {
        setUnidades(u);
        if (u.length === 1) setF((x) => ({ ...x, unidadId: u[0].id }));
      })
      .catch(() => setUnidades([]));
  }, [cargar]);

  async function pedirMunicion(ev: React.FormEvent) {
    ev.preventDefault();
    setError("");
    const cantidad = Number(f.cantidadPedida);
    const faltan = [!f.unidadId && "el laboratorio", !f.norma.trim() && "la norma", !f.calibre.trim() && "el calibre", !(Number.isInteger(cantidad) && cantidad > 0) && "los cartuchos pedidos"].filter(Boolean);
    if (faltan.length) return setError(`Indique ${faltan.join(", ")}.`);
    try {
      let otId: string | null = null;
      if (f.otCodigo.trim()) {
        const r = await pedir<any>("GET", `/ot?q=${encodeURIComponent(f.otCodigo.trim())}&limit=5`);
        const ot = (r.data ?? r ?? []).find((o: any) => String(o.codigo).toUpperCase() === f.otCodigo.trim().toUpperCase());
        if (!ot) return setError(`No se encontró la OT ${f.otCodigo}.`);
        otId = ot.id;
      }
      const r = await pedir<any>("POST", "/municion/solicitudes", {
        unidadId: f.unidadId,
        otId,
        itemHcp: f.itemHcp || null,
        norma: f.norma.trim(),
        nivel: f.nivel || null,
        calibre: f.calibre.trim(),
        masaBalaG: num(f.masaBalaG),
        velocidadMs: num(f.velocidadMs),
        velocidadTolMs: num(f.velocidadTolMs),
        cantidadPedida: cantidad,
        observaciones: f.observaciones || null,
      });
      toast.ok(`Orden ${r.codigo} enviada a la D11.`);
      setF({ ...VACIO, unidadId: unidades.length === 1 ? unidades[0].id : "" });
      setAbierto(false);
      cargar();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function anular(id: string) {
    try {
      await pedir("POST", `/municion/solicitudes/${id}/anular`, {});
      toast.ok("Orden anulada.");
      cargar();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  return (
    <div>
      <PageHeader
        icono="🎯"
        titulo="Munición de prueba"
        subtitulo="Pida a la Delegación Nº 11 la munición para sus ensayos y siga la entrega y el acta."
        migas={[{ label: "Laboratorio" }, { label: "Munición de prueba" }]}
        acciones={<button type="button" className="btn primary" onClick={() => setAbierto((x) => !x)} aria-expanded={abierto}>{abierto ? "Cerrar" : "＋ Pedir munición"}</button>}
      />
      {error && <div className="alert warn" role="alert">{error}</div>}
      {abierto && (
        <form className="card" onSubmit={pedirMunicion} style={{ marginBottom: 12 }} aria-label="Pedir munición" noValidate>
          <div className="form-grid">
            <div className="field"><label htmlFor="mu-u">Laboratorio <span className="req">*</span></label>
              <select id="mu-u" value={f.unidadId} onChange={(e) => setF({ ...f, unidadId: e.target.value })}>
                <option value="">Elija…</option>
                {unidades.map((u) => <option key={u.id} value={u.id}>{u.codigo} · {u.nombre}</option>)}
              </select></div>
            <div className="field"><label htmlFor="mu-ot">OT del ensayo</label><input id="mu-ot" placeholder="OT-2026-0000" value={f.otCodigo} onChange={(e) => setF({ ...f, otCodigo: e.target.value })} /></div>
            <div className="field"><label htmlFor="mu-h">Ítem de HCP</label><input id="mu-h" value={f.itemHcp} onChange={(e) => setF({ ...f, itemHcp: e.target.value })} maxLength={80} /></div>
            <div className="field"><label htmlFor="mu-n">Norma <span className="req">*</span></label><input id="mu-n" placeholder="NIJ 0101.06" value={f.norma} onChange={(e) => setF({ ...f, norma: e.target.value })} maxLength={80} /></div>
            <div className="field"><label htmlFor="mu-nv">Nivel</label><input id="mu-nv" placeholder="IIIA" value={f.nivel} onChange={(e) => setF({ ...f, nivel: e.target.value })} maxLength={40} /></div>
            <div className="field"><label htmlFor="mu-c">Calibre <span className="req">*</span></label><input id="mu-c" placeholder="9x19 mm" value={f.calibre} onChange={(e) => setF({ ...f, calibre: e.target.value })} maxLength={80} /></div>
            <div className="field"><label htmlFor="mu-m">Masa de bala (g)</label><input id="mu-m" inputMode="decimal" value={f.masaBalaG} onChange={(e) => setF({ ...f, masaBalaG: e.target.value })} /></div>
            <div className="field"><label htmlFor="mu-v">Velocidad (m/s)</label><input id="mu-v" inputMode="decimal" value={f.velocidadMs} onChange={(e) => setF({ ...f, velocidadMs: e.target.value })} /></div>
            <div className="field"><label htmlFor="mu-t">Tolerancia ± (m/s)</label><input id="mu-t" inputMode="decimal" value={f.velocidadTolMs} onChange={(e) => setF({ ...f, velocidadTolMs: e.target.value })} /></div>
            <div className="field"><label htmlFor="mu-q">Cartuchos pedidos <span className="req">*</span></label><input id="mu-q" inputMode="numeric" value={f.cantidadPedida} onChange={(e) => setF({ ...f, cantidadPedida: e.target.value })} /></div>
            <div className="field span-2"><label htmlFor="mu-o">Observaciones</label><input id="mu-o" value={f.observaciones} onChange={(e) => setF({ ...f, observaciones: e.target.value })} maxLength={1000} /></div>
          </div>
          <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}><button className="btn primary sm">Enviar orden → D11</button></div>
        </form>
      )}
      <div className="card card--table">
        <table className="data">
          <thead><tr><th>Orden</th><th>Laboratorio · OT</th><th>Pedido</th><th className="num">Pedidos</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {filas === null && <SkeletonRows cols={6} />}
            {filas?.map((o) => (
              <tr key={o.id}>
                <td className="codigo">{o.codigo}<small style={{ display: "block" }}>{fechaHora(o.createdAt)}</small></td>
                <td>{o.unidadCodigo}<small style={{ display: "block" }}>{o.otCodigo ?? "sin OT"}{o.itemHcp ? ` · HCP ${o.itemHcp}` : ""}</small></td>
                <td>{o.calibre} · {o.norma}{o.nivel ? ` · ${o.nivel}` : ""}<small style={{ display: "block" }}>{coma(o.masaBalaG)} g · {coma(o.velocidadMs)}{o.velocidadTolMs != null ? ` ± ${coma(o.velocidadTolMs)}` : ""} m/s</small></td>
                <td className="num">{o.cantidadPedida}</td>
                <td>
                  <span className={`pill ${ESTADO[o.estado]?.pill ?? "gray"}`}>{ESTADO[o.estado]?.texto ?? o.estado}</span>
                  {o.entregados != null && <small style={{ display: "block" }}>Entregados {o.entregados}{o.usados != null ? ` · usados ${o.usados} · devueltos ${o.devueltos}` : ""}</small>}
                </td>
                <td>
                  {o.estado === "solicitada" && <button type="button" className="btn sm ghost-danger" onClick={() => anular(o.id)}>Anular</button>}
                  {(o.estado === "entregada" || o.estado === "cerrada") && (
                    <button type="button" className="btn sm ghost" onClick={() => abrirDocumento(`/municion/solicitudes/${o.id}/acta`).catch((e) => toast.error(e.message))}>Acta</button>
                  )}
                </td>
              </tr>
            ))}
            {filas?.length === 0 && <tr><td colSpan={6}><EmptyState icono="🎯" titulo="Sin órdenes de munición" texto="Pida la munición de prueba para sus ensayos a la D11." /></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
