"use client";

/**
 * Tasa 1,5 % mensual (EP-06 6.23, BL-164).
 * -----------------------------------------------------------------------------
 * Consolida, por mes (hora de Chile), las tasas de internación calculadas: OT,
 * resolución DGMN, monto de la tasa, estado de pago y centro de costo. «⬇ Excel»
 * descarga la planilla; el Jefe DCO la emite una vez por mes con «Emitir informe
 * mensual → difusión» (destinatarios en Parámetros de la operación).
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader, EmptyState, SkeletonRows } from "@/components/ui/PageHeader";
import { toast } from "@/components/ui/feedback";
import { clp, fechaHora } from "@/lib/format";
import { llamar } from "@/lib/laboratorio";
import { descargarAdjunto } from "@/lib/d11";

interface Fila {
  internacion: string | null;
  ot: string | null;
  otId: string | null;
  resolucion: string | null;
  cliente: string | null;
  centroCosto: string | null;
  calculadaAt: string;
  tasa: number;
  total: number;
  factura: string | null;
  pagado: number;
  estadoPago: "sin_facturar" | "por_cobrar" | "abonada" | "pagada";
}
interface Informe {
  mes: string;
  filas: Fila[];
  resumen: { nOt: number; tasa: number; total: number; pagado: number; porCentro: { centro: string; total: number }[] };
  emitido: { emitidoAt: string; emitidoPor: string | null; difusion: string; observaciones: string | null } | null;
  difusion: string[];
  puedeEmitir: boolean;
}

const PAGO: Record<Fila["estadoPago"], [string, string]> = {
  sin_facturar: ["Sin facturar", "gray"],
  por_cobrar: ["Por cobrar", "amber"],
  abonada: ["Abonada", "blue"],
  pagada: ["Pagada", "green"],
};

const mesActual = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit" }).format(new Date());
const nombreMes = (m: string) => {
  const [a, n] = m.split("-").map(Number);
  return new Date(Date.UTC(a, n - 1, 15)).toLocaleDateString("es-CL", { month: "long", year: "numeric", timeZone: "UTC" });
};

export default function TasaMensualPage() {
  const [mes, setMes] = useState(mesActual());
  const [inf, setInf] = useState<Informe | null>(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  const [obs, setObs] = useState("");
  const [emitiendo, setEmitiendo] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setInf(await llamar<Informe>("GET", `/internaciones/tasa-mensual?mes=${mes}`));
      setError("");
    } catch (e: any) {
      setError(e.message);
      setInf(null);
    } finally {
      setCargando(false);
    }
  }, [mes]);
  useEffect(() => void cargar(), [cargar]);

  async function emitir() {
    setEmitiendo(true);
    try {
      const r = await llamar<Informe & { mensaje: string }>("POST", "/internaciones/tasa-mensual/emitir", { mes, observaciones: obs.trim() || undefined });
      setInf(r);
      toast.ok(r.mensaje);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setEmitiendo(false);
    }
  }

  return (
    <div>
      <PageHeader
        titulo="Tasa 1,5 % mensual"
        icono="🧮"
        migas={[{ label: "Internaciones", href: "/bpch/internaciones" }, { label: "Tasa 1,5 % mensual" }]}
        subtitulo="Tasas de internación calculadas en el mes, con su OT, resolución, estado de pago y centro de costo. El Jefe DCO emite y difunde el informe una vez por mes."
        acciones={
          <>
            <label htmlFor="tm-mes" className="sr-only">Mes</label>
            <input id="tm-mes" type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} style={{ width: 160 }} />
            <button className="btn outline sm" disabled={!inf?.filas.length}
              onClick={() => descargarAdjunto(`/internaciones/tasa-mensual?mes=${mes}&formato=csv`, `tasa-1-5-${mes}.csv`).catch((e) => toast.error(e.message))}>
              ⬇ Excel
            </button>
          </>
        }
      />
      {error && <div className="alert warn" role="alert">{error}</div>}

      {inf && (
        <div className="kpis">
          <div className="kpi k-blue"><div className="lab">OT con tasa en {nombreMes(mes)}</div><div className="val">{inf.resumen.nOt}</div></div>
          <div className="kpi k-violet"><div className="lab">Tasa 1,5 %</div><div className="val">{clp(inf.resumen.tasa)}</div></div>
          <div className="kpi k-amber"><div className="lab">Total a cancelar</div><div className="val">{clp(inf.resumen.total)}</div></div>
          <div className="kpi k-green"><div className="lab">Pagado</div><div className="val">{clp(inf.resumen.pagado)}</div></div>
        </div>
      )}

      <div className="card card--table">
        {cargando ? (
          <table className="data"><tbody><SkeletonRows cols={9} rows={4} /></tbody></table>
        ) : !inf || inf.filas.length === 0 ? (
          <EmptyState titulo={`Sin tasas calculadas en ${nombreMes(mes)}`} texto="La tasa se calcula en el expediente de la internación (Internaciones › «Calcular y emitir C/B»)." />
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Calculada</th><th>Internación</th><th>OT</th><th>Resolución DGMN</th><th>Cliente</th><th>Centro de costo</th>
                <th className="num">Tasa</th><th className="num">Total a cancelar</th><th>Factura</th><th>Estado de pago</th><th className="num">Pagado</th>
              </tr>
            </thead>
            <tbody>
              {inf.filas.map((f, i) => (
                <tr key={`${f.otId ?? f.internacion}-${i}`}>
                  <td style={{ whiteSpace: "nowrap" }}>{fechaHora(f.calculadaAt)}</td>
                  <td className="codigo">{f.internacion ?? "—"}</td>
                  <td>{f.otId ? <Link href={`/ot/${f.otId}` as any} className="codigo">{f.ot}</Link> : "—"}</td>
                  <td>{f.resolucion ?? "—"}</td>
                  <td>{f.cliente ?? "—"}</td>
                  <td>{f.centroCosto ?? "—"}</td>
                  <td className="num">{clp(f.tasa)}</td>
                  <td className="num">{clp(f.total)}</td>
                  <td className="codigo">{f.factura ?? "—"}</td>
                  <td><span className={`pill ${PAGO[f.estadoPago][1]}`}>{PAGO[f.estadoPago][0]}</span></td>
                  <td className="num">{clp(f.pagado)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={6} className="num" style={{ fontWeight: 700 }}>Totales</td><td className="num" style={{ fontWeight: 700 }}>{clp(inf.resumen.tasa)}</td><td className="num" style={{ fontWeight: 800 }}>{clp(inf.resumen.total)}</td><td colSpan={2} /><td className="num" style={{ fontWeight: 700 }}>{clp(inf.resumen.pagado)}</td></tr>
            </tfoot>
          </table>
        )}
      </div>

      {inf && inf.resumen.porCentro.length > 0 && (
        <div className="card">
          <h2>Por centro de costo</h2>
          <table className="data" style={{ maxWidth: 520 }}>
            <thead><tr><th>Centro de costo</th><th className="num">Total a cancelar</th></tr></thead>
            <tbody>{inf.resumen.porCentro.map((c) => <tr key={c.centro}><td>{c.centro}</td><td className="num">{clp(c.total)}</td></tr>)}</tbody>
          </table>
        </div>
      )}

      {inf && (
        <div className="card">
          <h2>Informe mensual</h2>
          {inf.emitido ? (
            <div className="alert success" style={{ margin: 0 }}>
              Emitido el {fechaHora(inf.emitido.emitidoAt)}{inf.emitido.emitidoPor ? ` por ${inf.emitido.emitidoPor}` : ""} y difundido a: {inf.emitido.difusion}.
              {inf.emitido.observaciones ? <> Observaciones: {inf.emitido.observaciones}</> : null}
            </div>
          ) : inf.puedeEmitir ? (
            <div style={{ display: "grid", gap: 8 }}>
              <p style={{ margin: 0 }}>Se difundirá a: <b>{inf.difusion.join(", ")}</b> (Administración › Parámetros del sistema › «Informe mensual de la tasa 1,5 %»).</p>
              <div className="field">
                <label htmlFor="tm-obs">Observaciones</label>
                <textarea id="tm-obs" rows={2} maxLength={2000} value={obs} onChange={(e) => setObs(e.target.value)} />
              </div>
              <div className="toolbar" style={{ margin: 0 }}>
                <div className="spacer" />
                <button className="btn primary sm" disabled={emitiendo || !inf.filas.length} onClick={emitir}>
                  {emitiendo ? "Emitiendo…" : "Emitir informe mensual → difusión"}
                </button>
              </div>
            </div>
          ) : (
            <p className="subtitle" style={{ margin: 0 }}>El informe de {nombreMes(mes)} aún no se emite. Lo emite el Jefe DCO.</p>
          )}
        </div>
      )}
    </div>
  );
}
