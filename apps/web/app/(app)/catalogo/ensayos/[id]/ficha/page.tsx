"use client";

/**
 * Ficha de ensayo (Comercial, reunión 2 · 28-10-2026)
 * -----------------------------------------------------------------------------
 * Recursos de un ensayo del catálogo en cinco bloques —personal, equipos,
 * vehículos, insumos y otros gastos— con cantidad, horas y valor unitario
 * (modelo «Diseño de ficha de ensayo», EN202 Pinturas). Los valores pueden
 * quedar en blanco hasta el estudio de costos: el costo directo se muestra
 * entonces como incompleto. PDF de formato estándar.
 * Ver: lista_precio.ver · Editar: catalogo.gestionar (en el alcance de su laboratorio).
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { clp } from "@/lib/format";
import { usePermisos } from "@/lib/permisos";
import { descargarAdjunto } from "@/lib/d11";
import { pedir } from "../../../../cotizaciones/_components/comercial";

const BLOQUES: [string, string][] = [
  ["personal", "Personal (horas hombre)"],
  ["equipos", "Equipos (horas máquina)"],
  ["vehiculos", "Vehículos"],
  ["insumos", "Insumos"],
  ["otros", "Otros gastos"],
];
type Item = { bloque: string; descripcion: string; categoria: string; cantidad: string; unidad: string; horas: string; valorUnitario: string };
const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
const importe = (it: Item) => {
  const v = num(it.valorUnitario);
  if (v === null || Number.isNaN(v)) return null;
  const h = num(it.horas);
  return Math.round((num(it.cantidad) ?? 1) * (h === null ? 1 : h) * v * 100) / 100;
};

export default function FichaEnsayoPage() {
  const { id } = useParams<{ id: string }>();
  const { puede } = usePermisos();
  const editar = puede("catalogo.gestionar");
  const [d, setD] = useState<any | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [obs, setObs] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [guardando, setGuardando] = useState(false);

  const aplicar = (r: any) => {
    setD(r);
    setObs(r.ficha?.observaciones ?? "");
    setItems((r.items ?? []).map((it: any) => ({ bloque: it.bloque, descripcion: it.descripcion, categoria: txt(it.categoria), cantidad: txt(it.cantidad), unidad: txt(it.unidad), horas: txt(it.horas), valorUnitario: txt(it.valorUnitario) })));
  };
  const cargar = useCallback(() => pedir<any>("GET", `/cat/ensayos/${id}/ficha`).then(aplicar).catch((e) => setError(e.message)), [id]);
  useEffect(() => { cargar(); }, [cargar]);

  const setItem = (i: number, x: Partial<Item>) => setItems((its) => its.map((it, j) => (j === i ? { ...it, ...x } : it)));
  const agregar = (bloque: string) => setItems((its) => [...its, { bloque, descripcion: "", categoria: "", cantidad: "1", unidad: "", horas: "", valorUnitario: "" }]);

  async function guardar() {
    setError(""); setMsg(""); setGuardando(true);
    try {
      const r = await pedir<any>("PUT", `/cat/ensayos/${id}/ficha`, {
        observaciones: obs.trim() || null,
        items: items.map((it) => ({
          bloque: it.bloque,
          descripcion: it.descripcion.trim(),
          categoria: it.categoria.trim() || null,
          cantidad: num(it.cantidad),
          unidad: it.unidad.trim() || null,
          horas: num(it.horas),
          valorUnitario: num(it.valorUnitario),
        })),
      });
      aplicar(r);
      setMsg("Ficha guardada.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  const total = items.reduce((s, it) => s + (importe(it) ?? 0), 0);
  const incompleto = items.some((it) => importe(it) === null);
  const est = d?.totales?.estructura;

  return (
    <div>
      <Link href={"/catalogo/ensayos" as any} className="subtitle" style={{ display: "inline-block", color: "var(--accent)", textDecoration: "none" }}>← Ensayos</Link>
      <h1 className="page">Ficha de ensayo {d ? <span className="codigo">{d.ensayo.codigo}</span> : null}</h1>
      {d && <p className="subtitle">{d.ensayo.nombre}{d.ensayo.familia?.nombre ? ` · ${d.ensayo.familia.nombre}` : ""} · versión {d.ficha.version || "sin registrar"}{d.ficha.actualizadaPor ? ` · ${d.ficha.actualizadaPor}` : ""}</p>}
      {error && <div className="alert warn" role="alert">{error}</div>}
      {msg && <div className="alert info" role="status">{msg}</div>}
      {d && (
        <div className="toolbar" style={{ gap: 6 }}>
          <span>Precio de la ficha: <b>{clp(d.ensayo.precio)}</b></span>
          <span>· Lista de precios vigente: <b>{d.precioLista ? `${clp(d.precioLista.precio)} (${d.precioLista.lista})` : "—"}</b></span>
          <div className="spacer" />
          <button className="btn outline sm" onClick={() => descargarAdjunto(`/cat/ensayos/${id}/ficha/pdf`, `Ficha-ensayo-${d.ensayo.codigo}.pdf`).catch((e) => setError(e.message))}>Descargar PDF</button>
          {editar && <button className="btn success sm" disabled={guardando} onClick={guardar}>{guardando ? "Guardando…" : "Guardar ficha"}</button>}
        </div>
      )}
      {d && BLOQUES.map(([b, titulo]) => {
        const del = items.map((it, i) => [it, i] as const).filter(([it]) => it.bloque === b);
        return (
          <div className="card" key={b}>
            <h2>{titulo} <span className="right">{clp(del.reduce((s, [it]) => s + (importe(it) ?? 0), 0))}</span></h2>
            <table className="data">
              <thead><tr><th>Recurso</th><th>Categoría / código</th><th className="num">Cantidad</th><th>Unidad</th><th className="num">Horas</th><th className="num">Valor unitario</th><th className="num">Importe</th>{editar && <th />}</tr></thead>
              <tbody>
                {del.map(([it, i]) => (
                  <tr key={i}>
                    {editar ? (
                      <>
                        <td><input aria-label="Recurso" value={it.descripcion} maxLength={300} onChange={(e) => setItem(i, { descripcion: e.target.value })} /></td>
                        <td><input aria-label="Categoría" value={it.categoria} maxLength={120} onChange={(e) => setItem(i, { categoria: e.target.value })} /></td>
                        <td className="num"><input aria-label="Cantidad" inputMode="decimal" style={{ width: 80, textAlign: "right" }} value={it.cantidad} onChange={(e) => setItem(i, { cantidad: e.target.value })} /></td>
                        <td><input aria-label="Unidad" style={{ width: 80 }} maxLength={30} value={it.unidad} onChange={(e) => setItem(i, { unidad: e.target.value })} /></td>
                        <td className="num"><input aria-label="Horas" inputMode="decimal" style={{ width: 80, textAlign: "right" }} value={it.horas} onChange={(e) => setItem(i, { horas: e.target.value })} /></td>
                        <td className="num"><input aria-label="Valor unitario" inputMode="decimal" style={{ width: 110, textAlign: "right" }} value={it.valorUnitario} placeholder="en blanco" onChange={(e) => setItem(i, { valorUnitario: e.target.value })} /></td>
                      </>
                    ) : (
                      <>
                        <td>{it.descripcion}</td><td>{it.categoria || "—"}</td><td className="num">{it.cantidad || "—"}</td><td>{it.unidad || "—"}</td>
                        <td className="num">{it.horas || "—"}</td><td className="num">{it.valorUnitario ? clp(Number(it.valorUnitario)) : "—"}</td>
                      </>
                    )}
                    <td className="num">{importe(it) === null ? <span style={{ color: "var(--muted)" }}>sin valor</span> : clp(importe(it))}</td>
                    {editar && <td><button className="btn outline sm" aria-label="Quitar" onClick={() => setItems((its) => its.filter((_, j) => j !== i))}>✕</button></td>}
                  </tr>
                ))}
                {!del.length && <tr><td colSpan={editar ? 8 : 7} style={{ textAlign: "center", color: "var(--muted)", padding: 12 }}>Sin recursos registrados.</td></tr>}
              </tbody>
            </table>
            {editar && <button className="btn outline sm" style={{ marginTop: 6 }} onClick={() => agregar(b)}>＋ Agregar</button>}
          </div>
        );
      })}
      {d && (
        <div className="card">
          <h2>Costo directo y estructura del precio</h2>
          <p>
            Costo directo: <b>{clp(total)}</b>
            {incompleto ? " · incompleto: hay recursos sin valor unitario (se completan con el estudio de costos)." : ""}
          </p>
          {est && (
            <table className="data">
              <tbody>
                <tr><td>Costo indirecto ({d.pct.ciPct} %)</td><td className="num">{clp(est.costoIndirecto)}</td><td>Costo total (Ejército)</td><td className="num">{clp(est.costoTotal)}</td></tr>
                <tr><td>Recargo ({d.pct.recargoPct} %)</td><td className="num">{clp(est.recargo)}</td><td>Neto particular</td><td className="num">{clp(est.neto)}</td></tr>
              </tbody>
            </table>
          )}
          <p className="hint">La estructura se calcula con la ficha guardada. El precio que se cotiza sigue saliendo de la lista de precios vigente o del precio de la ficha.</p>
          <div className="field">
            <label htmlFor="ficha-obs">Observaciones</label>
            <textarea id="ficha-obs" rows={3} readOnly={!editar} value={obs} onChange={(e) => setObs(e.target.value)} />
          </div>
        </div>
      )}
    </div>
  );
}
