"use client";

/**
 * Bodegas de consumibles (frente S4 · reuniones R1 y R5; contrato 4.4.4 y 4.4.5).
 * Bodega central y sub-bodegas por laboratorio, inventario valorizado por lote
 * y traspasos entre bodegas (quedan en el kardex). Los lotes sin costo quedan
 * «Pendiente del IDIC» (el IDIC aún no entrega el costo de los insumos).
 *
 * API: GET|POST /consumibles/bodegas · PATCH /consumibles/bodegas/:id ·
 *      GET /consumibles/bodegas/:id/inventario · POST /consumibles/bodegas/traspaso
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PageHeader, SkeletonCards } from "@/components/ui/PageHeader";
import { toast } from "@/components/ui/feedback";
import { clp, num } from "@/lib/format";
import { llamar } from "@/lib/laboratorio";

interface Resumen { lotes: number; valorizado: number; sinCosto: number }
interface Bodega {
  id: string; codigo: string; nombre: string; tipo: "central" | "laboratorio"; unidadId: string | null; ubicacion: string | null;
  activa: boolean; unidadCodigo: string | null; unidadNombre: string | null; inventario: Resumen;
}
interface Listado { data: Bodega[]; sinBodega: Resumen; total: Resumen; laboratorios: { id: string; codigo: string; nombre: string }[]; pendienteIdic: string | null }
interface LoteInv {
  id: string; numeroLote: string; fechaVencimiento: string | null; cantidad: number; consumibleCodigo: string; consumibleNombre: string; unidad: string | null;
  vencido: boolean; costoUnitario: number | null; fuente: "lote" | "consumible" | "pendiente"; valor: number | null;
}
interface Inventario { bodega: { id: string; codigo: string; nombre: string; tipo: string }; lotes: LoteInv[]; resumen: Resumen }

const FUENTE: Record<string, string> = { lote: "Precio del lote", consumible: "Costo de referencia", pendiente: "Pendiente del IDIC" };

export default function BodegasPage() {
  const [l, setL] = useState<Listado | null>(null);
  const [error, setError] = useState("");
  const [sel, setSel] = useState<string>("");
  const [inv, setInv] = useState<Inventario | null>(null);
  const [nueva, setNueva] = useState<{ codigo: string; nombre: string; unidadId: string; ubicacion: string } | null>(null);
  const [tras, setTras] = useState<{ lote: LoteInv; destino: string; cantidad: string; motivo: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setL(await llamar<Listado>("GET", "/consumibles/bodegas"));
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const verInventario = useCallback(async (id: string) => {
    setSel(id);
    setInv(null);
    try {
      setInv(await llamar<Inventario>("GET", `/consumibles/bodegas/${id}/inventario`));
    } catch (e: any) {
      toast.error(e.message);
    }
  }, []);

  async function crear() {
    if (!nueva) return;
    setOcupado(true);
    try {
      await llamar("POST", "/consumibles/bodegas", { ...nueva, tipo: "laboratorio" });
      toast.ok("Sub-bodega creada");
      setNueva(null);
      await cargar();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }

  async function activar(b: Bodega, activa: boolean) {
    try {
      await llamar("PATCH", `/consumibles/bodegas/${b.id}`, { activa });
      toast.ok(activa ? "Bodega activada" : "Bodega desactivada");
      await cargar();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function traspasar() {
    if (!tras) return;
    const cantidad = Number(tras.cantidad.replace(",", "."));
    if (!tras.destino) return toast.error("Elija la bodega de destino.");
    if (!(cantidad > 0)) return toast.error("Indique una cantidad mayor que cero.");
    setOcupado(true);
    try {
      const r = await llamar<{ destino: string }>("POST", "/consumibles/bodegas/traspaso", { loteId: tras.lote.id, bodegaDestinoId: tras.destino, cantidad, motivo: tras.motivo });
      toast.ok(`Traspasado a ${r.destino}`);
      setTras(null);
      await Promise.all([cargar(), verInventario(sel)]);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }

  const activas = (l?.data ?? []).filter((b) => b.activa);
  return (
    <div>
      <PageHeader
        icono="🏬"
        titulo="Bodegas e inventario valorizado"
        subtitulo={<>Bodega central y sub-bodegas por laboratorio. Cada lote está en una bodega; el consumo de un ensayo sale primero de la sub-bodega de su laboratorio (Parámetros › Consumibles). Los traspasos quedan en el kardex.</>}
        migas={[{ label: "Consumibles", href: "/consumibles" }, { label: "Bodegas" }]}
      />
      {error && <div className="alert warn" role="alert">{error}</div>}
      {!l && !error && <SkeletonCards n={3} />}
      {l && (
        <>
          <div className="kpis">
            <div className="kpi k-blue"><div className="lab">Inventario valorizado</div><div className="val">{clp(l.total.valorizado)}</div></div>
            <div className="kpi"><div className="lab">Lotes con stock</div><div className="val">{l.total.lotes}</div></div>
            <div className={`kpi ${l.total.sinCosto ? "k-amber" : ""}`}><div className="lab">Lotes sin costo</div><div className="val">{l.total.sinCosto}</div></div>
            <div className="kpi k-violet"><div className="lab">Bodegas activas</div><div className="val">{activas.length}</div></div>
          </div>
          {l.pendienteIdic && <div className="alert info">{l.pendienteIdic}</div>}
          {l.sinBodega.lotes > 0 && <div className="alert warn">{l.sinBodega.lotes} lote(s) con stock no tienen bodega: asígnelos con un traspaso.</div>}

          <div className="card">
            <h2>
              Bodegas
              <span className="right">
                <button className="btn outline sm" onClick={() => setNueva(nueva ? null : { codigo: "", nombre: "", unidadId: "", ubicacion: "" })}>{nueva ? "Cerrar" : "＋ Nueva sub-bodega"}</button>
              </span>
            </h2>
            {nueva && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 10 }}>
                <div className="field"><label htmlFor="b-lab">Laboratorio</label>
                  <select id="b-lab" value={nueva.unidadId} onChange={(e) => {
                    const u = l.laboratorios.find((x) => x.id === e.target.value);
                    setNueva({ ...nueva, unidadId: e.target.value, codigo: nueva.codigo || (u ? `SB-${u.codigo}` : ""), nombre: nueva.nombre || (u ? `Sub-bodega ${u.nombre}` : "") });
                  }}>
                    <option value="">Elija…</option>
                    {l.laboratorios.map((u) => <option key={u.id} value={u.id}>{u.codigo} · {u.nombre}</option>)}
                  </select></div>
                <div className="field"><label htmlFor="b-cod">Código</label><input id="b-cod" maxLength={30} value={nueva.codigo} onChange={(e) => setNueva({ ...nueva, codigo: e.target.value })} /></div>
                <div className="field" style={{ minWidth: 240 }}><label htmlFor="b-nom">Nombre</label><input id="b-nom" maxLength={160} value={nueva.nombre} onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })} /></div>
                <div className="field" style={{ minWidth: 200 }}><label htmlFor="b-ubi">Ubicación (opcional)</label><input id="b-ubi" maxLength={200} value={nueva.ubicacion} onChange={(e) => setNueva({ ...nueva, ubicacion: e.target.value })} /></div>
                <button className="btn primary sm" disabled={ocupado} onClick={crear}>Crear</button>
              </div>
            )}
            <div style={{ overflowX: "auto" }}>
              <table className="data">
                <thead><tr><th>Código</th><th>Bodega</th><th>Tipo</th><th>Laboratorio</th><th className="num">Lotes</th><th className="num">Valorizado</th><th className="num">Sin costo</th><th>Estado</th><th></th></tr></thead>
                <tbody>
                  {l.data.map((b) => (
                    <tr key={b.id} style={sel === b.id ? { background: "var(--sel, rgba(37,99,235,0.06))" } : undefined}>
                      <td><span className="codigo">{b.codigo}</span></td>
                      <td>{b.nombre}{b.ubicacion ? <div style={{ fontSize: 11, color: "var(--muted)" }}>{b.ubicacion}</div> : null}</td>
                      <td>{b.tipo === "central" ? "Central" : "Sub-bodega"}</td>
                      <td>{b.unidadCodigo ?? "—"}</td>
                      <td className="num">{b.inventario.lotes}</td>
                      <td className="num">{clp(b.inventario.valorizado)}</td>
                      <td className="num">{b.inventario.sinCosto || "—"}</td>
                      <td><span className={`pill ${b.activa ? "green" : "gray"}`}>{b.activa ? "Activa" : "Inactiva"}</span></td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <button className="btn outline sm" onClick={() => verInventario(b.id)}>Inventario</button>{" "}
                        {b.tipo !== "central" && <button className="btn outline sm" onClick={() => activar(b, !b.activa)}>{b.activa ? "Desactivar" : "Activar"}</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--muted)" }}>
              Lista inicial: bodega central y una sub-bodega por laboratorio (por confirmar con Abastecimiento). En Excel: <Link href="/zona-informes/inventario-bodega">Zona de informes › Inventario valorizado por bodega y lote</Link>.
            </p>
          </div>

          {sel && (
            <div className="card">
              <h2>Inventario · {inv ? `${inv.bodega.codigo} · ${inv.bodega.nombre}` : "…"}
                {inv && <span className="right" style={{ fontSize: 13 }}>Valorizado <b>{clp(inv.resumen.valorizado)}</b></span>}</h2>
              {!inv ? <SkeletonCards n={1} /> : inv.lotes.length === 0 ? (
                <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)" }}>Sin lotes con stock en esta bodega.</p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className="data">
                    <thead><tr><th>Insumo</th><th>Lote</th><th>Vence</th><th className="num">Stock</th><th className="num">Costo unitario</th><th>Costo tomado de</th><th className="num">Valor</th><th></th></tr></thead>
                    <tbody>
                      {inv.lotes.map((x) => (
                        <tr key={x.id} style={x.vencido ? { background: "rgba(217,48,37,0.06)" } : undefined}>
                          <td><span className="codigo">{x.consumibleCodigo}</span> {x.consumibleNombre}</td>
                          <td>{x.numeroLote}</td>
                          <td>{x.fechaVencimiento ? String(x.fechaVencimiento).slice(0, 10) : "—"}{x.vencido ? " (vencido)" : ""}</td>
                          <td className="num">{num(x.cantidad, 2)} {x.unidad ?? ""}</td>
                          <td className="num">{x.costoUnitario != null ? clp(x.costoUnitario) : "—"}</td>
                          <td>{x.fuente === "pendiente" ? <span className="pill amber">{FUENTE[x.fuente]}</span> : FUENTE[x.fuente]}</td>
                          <td className="num">{x.valor != null ? clp(x.valor) : "—"}</td>
                          <td>{!x.vencido && <button className="btn outline sm" onClick={() => setTras({ lote: x, destino: "", cantidad: "", motivo: "" })}>Traspasar</button>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {tras && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginTop: 10 }}>
                  <div style={{ fontSize: 12.5 }}>Traspasar del lote <b>{tras.lote.numeroLote}</b> ({num(tras.lote.cantidad, 2)} {tras.lote.unidad ?? ""} disponibles)</div>
                  <div className="field"><label htmlFor="t-dest">A la bodega</label>
                    <select id="t-dest" value={tras.destino} onChange={(e) => setTras({ ...tras, destino: e.target.value })}>
                      <option value="">Elija…</option>
                      {activas.filter((b) => b.id !== sel).map((b) => <option key={b.id} value={b.id}>{b.codigo} · {b.nombre}</option>)}
                    </select></div>
                  <div className="field"><label htmlFor="t-cant">Cantidad</label><input id="t-cant" inputMode="decimal" style={{ width: 100 }} value={tras.cantidad} onChange={(e) => setTras({ ...tras, cantidad: e.target.value })} /></div>
                  <div className="field" style={{ minWidth: 220 }}><label htmlFor="t-mot">Motivo (opcional)</label><input id="t-mot" maxLength={500} value={tras.motivo} onChange={(e) => setTras({ ...tras, motivo: e.target.value })} /></div>
                  <button className="btn outline sm" onClick={() => setTras(null)}>Cancelar</button>
                  <button className="btn primary sm" disabled={ocupado} onClick={traspasar}>Traspasar</button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
