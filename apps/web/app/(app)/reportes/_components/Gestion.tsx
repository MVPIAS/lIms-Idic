"use client";

/**
 * Reportes › Gestión (EP-00 9.4, BL-174, frente r4c): OT por laboratorio y
 * estado, cumplimiento de plazo y tiempo de ciclo, facturación por centro de
 * costo, OT sin cobro valorizadas, encuestas por laboratorio y trazabilidad
 * cotización → OT → factura. «⬇ Excel» descarga un .xlsx con una hoja por sección.
 */
import { useEffect, useState } from "react";
import { clp, num } from "@/lib/format";
import { toast } from "@/components/ui/feedback";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("lims_token")}` });
const pctTxt = (v: number | null) => (v === null ? "—" : `${num(v, 1)} %`);
const ESTADO_OT: Record<string, string> = {
  recepcionada: "Recepcionada", recibida: "Recibida", en_analisis: "En análisis", validacion: "En validación",
  finalizada: "Finalizada", informada: "Informada", cerrada: "Cerrada", anulada: "Anulada",
};
const textoEstado = (e: string) => ESTADO_OT[e] ?? e.replace(/_/g, " ");
const n1 = (v: number | null) => (v === null ? "—" : num(v, 1));

export default function Gestion({ rango }: { rango: string }) {
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState("");
  const [bajando, setBajando] = useState(false);

  useEffect(() => {
    setD(null);
    setError("");
    fetch(`${API}/reportes/gestion${rango}`, { headers: auth() })
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => ({}))).message ?? `Error ${r.status}`))))
      .then(setD)
      .catch((e) => setError(e.message));
  }, [rango]);

  async function excel() {
    setBajando(true);
    try {
      const r = await fetch(`${API}/reportes/gestion.xlsx${rango}`, { headers: auth() });
      if (!r.ok) throw new Error(`Error ${r.status}`);
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = (r.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1]) ?? "reporte_gestion.xlsx";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBajando(false);
    }
  }

  if (error) return <div className="alert warn" role="alert">{error}</div>;
  if (!d) return <div className="card" style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>Cargando…</div>;
  const tabla = (titulo: string, cab: string[], filas: (string | number)[][], vacio: string, numericas: number[] = []) => (
    <div className="card" style={{ padding: 12 }}>
      <h2 style={{ padding: "0 4px" }}>{titulo}</h2>
      {filas.length === 0 ? (
        <p className="subtitle" style={{ margin: 0 }}>{vacio}</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="data">
            <thead><tr>{cab.map((c, i) => <th key={c} className={numericas.includes(i) ? "num" : undefined}>{c}</th>)}</tr></thead>
            <tbody>{filas.map((f, i) => <tr key={i}>{f.map((v, j) => <td key={j} className={numericas.includes(j) ? "num" : undefined}>{v}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
  const est = d.otPorEstado;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="toolbar" style={{ margin: 0 }}>
        <span className="subtitle" style={{ margin: 0 }}>Cifras de su alcance{d.rango.desde || d.rango.hasta ? ` · ${d.rango.desde ?? "inicio"} a ${d.rango.hasta ?? "hoy"}` : ""}.</span>
        <span className="spacer" />
        <button type="button" className="btn primary sm" disabled={bajando} onClick={excel}>{bajando ? "Generando…" : "⬇ Excel"}</button>
      </div>
      {tabla(
        "OT por laboratorio y estado",
        ["Laboratorio", ...est.estados.map(textoEstado), "Total"],
        est.filas.map((f: any) => [f.laboratorio, ...est.estados.map((e: string) => f.porEstado[e]), f.total]),
        "Sin OT en el período.",
        est.estados.map((_: string, i: number) => i + 1).concat(est.estados.length + 1),
      )}
      {tabla(
        "Plazos por laboratorio",
        ["Laboratorio", "Cerradas", "Con compromiso", "Dentro", "Fuera", "% dentro", "Ciclo prom. (días)", "Atraso prom. (días)", "Vencidas abiertas"],
        d.plazos.map((p: any) => [p.laboratorio, p.cerradas, p.conCompromiso, p.dentro, p.fuera, pctTxt(p.pctDentro), n1(p.cicloPromedio), n1(p.atrasoPromedio), p.vencidasAbiertas]),
        "Sin OT en el período.",
        [1, 2, 3, 4, 5, 6, 7, 8],
      )}
      {tabla(
        "Facturación por centro de costo",
        ["Centro de costo", "Nombre", "Facturas", "Neto", "Total", "Pagado", "Saldo"],
        d.facturacionCentroCosto.map((f: any) => [f.centroCosto, f.nombre ?? "—", f.facturas, clp(f.neto), clp(f.total), clp(f.pagado), clp(f.saldo)]),
        "Sin facturas emitidas en el período.",
        [2, 3, 4, 5, 6],
      )}
      {tabla("OT sin cobro valorizadas", ["Laboratorio", "OT sin cobro", "Costo estimado"], d.sinCobro.map((s: any) => [s.laboratorio, s.ot, clp(s.costoEstimado)]), "Sin OT sin cobro en el período.", [1, 2])}
      {tabla(
        "Encuestas de satisfacción por laboratorio",
        ["Laboratorio", "Registradas", "Pendientes", "Promedio (1 a 7)"],
        d.encuestas.map((e: any) => [e.laboratorio, e.registradas, e.pendientes, n1(e.promedio)]),
        "Sin encuestas en el período.",
        [1, 2, 3],
      )}
      {tabla(
        `Trazabilidad cotización → OT → factura${d.trazabilidad.length >= 1000 ? " (primeras 1000)" : ""}`,
        ["Cotización", "OT", "Laboratorio", "Estado OT", "Factura", "Estado factura", "Total"],
        d.trazabilidad.map((t: any) => [t.cotizacion ?? "—", t.ot, t.laboratorio ?? "—", textoEstado(t.estadoOt), t.factura ?? "—", t.estadoFactura ?? "—", t.total === null ? "—" : clp(t.total)]),
        "Sin OT en el período.",
        [6],
      )}
    </div>
  );
}
