"use client";

/**
 * Avisos comerciales (reuniones 1 y 2 · 27 y 28-10-2026)
 * -----------------------------------------------------------------------------
 *  · OT listas para facturar: con cobro, cerradas o listas para cerrar, sin
 *    factura emitida.
 *  · OT por disposición con la OPI pendiente y su plazo de regularización
 *    (2 meses por defecto, parámetro ot_disposicion.meses_opi).
 *  · Cotizaciones aceptadas sin OT, sin las excepciones marcadas por Comercial.
 * Las tarjetas de Mi bandeja llevan aquí (?vista=facturar | opi | sinot).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { fechaDia } from "@/lib/format";
import { pedir, ACEPTACION_LABEL } from "../_components/comercial";

type Vista = "facturar" | "opi" | "sinot";
const PLAZO: Record<string, [string, string]> = { vencida: ["Vencida", "red"], por_vencer: ["Por vencer", "amber"], al_dia: ["En plazo", "green"] };

export default function AvisosComercialesPage() {
  const [d, setD] = useState<any | null>(null);
  const [error, setError] = useState("");
  const [vista, setVista] = useState<Vista>("facturar");

  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("vista");
    if (v === "facturar" || v === "opi" || v === "sinot") setVista(v);
    pedir<any>("GET", "/comercial/avisos").then(setD).catch((e) => setError(e.message));
  }, []);

  const n = d?.conteos ?? {};
  const pesta: [Vista, string, number | undefined][] = [
    ["facturar", "OT listas para facturar", n.otPorFacturar],
    ["opi", "OT con OPI pendiente", d?.otOpiPendiente?.length],
    ["sinot", "Aceptadas sin OT", n.aceptadasSinOt],
  ];

  return (
    <div>
      <Link href={"/cotizaciones" as any} className="subtitle" style={{ display: "inline-block", color: "var(--accent)", textDecoration: "none" }}>← Cotizaciones</Link>
      <h1 className="page">Avisos comerciales</h1>
      <p className="subtitle">Lo que Comercial debe atender: OT que ya se pueden facturar, OPI por regularizar y cotizaciones aceptadas que aún no tienen OT.</p>
      {error && <div className="alert warn" role="alert">{error}</div>}
      <div className="toolbar" style={{ gap: 6 }}>
        {pesta.map(([v, l, c]) => (
          <button key={v} className={`btn sm ${vista === v ? "primary" : "outline"}`} aria-pressed={vista === v} onClick={() => setVista(v)}>
            {l}{c !== undefined && <span style={{ opacity: 0.75, marginLeft: 4 }}>{c}</span>}
          </button>
        ))}
      </div>
      {!d && !error && <p className="hint">Cargando…</p>}

      {d && vista === "facturar" && (
        <div className="card card--table">
          <table className="data">
            <thead><tr><th>OT</th><th>Cliente</th><th>Laboratorio</th><th>Estado</th><th>Cotización</th><th>Factura</th></tr></thead>
            <tbody>
              {d.otPorFacturar.map((o: any) => (
                <tr key={o.id}>
                  <td><Link href={`/ot/${o.id}` as any} className="codigo" style={{ textDecoration: "underline" }}>{o.codigo}</Link></td>
                  <td>{o.cliente ?? "—"}</td>
                  <td>{o.laboratorio ?? "—"}</td>
                  <td>{o.estado === "cerrada" ? "Cerrada" : "Lista para cerrar"}</td>
                  <td>{o.cotizacion ?? "—"}</td>
                  <td>{o.borradorFactura ? <span className="pill amber">Borrador {o.borradorFactura}</span> : <span className="pill gray">Sin factura</span>}</td>
                </tr>
              ))}
              {!d.otPorFacturar.length && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: 18 }}>No hay OT listas para facturar.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {d && vista === "opi" && (
        <>
          <p className="hint">La OPI de una OT por disposición del Director se regulariza en {d.mesesOpi} {d.mesesOpi === 1 ? "mes" : "meses"} (Administración › Parámetros › OT por disposición). Si el cliente desiste, anule la OT desde su ficha.</p>
          <div className="card card--table">
            <table className="data">
              <thead><tr><th>OT</th><th>Cliente</th><th>Disposición</th><th>Desde</th><th>Plazo OPI</th><th>Estado</th></tr></thead>
              <tbody>
                {d.otOpiPendiente.map((o: any) => {
                  const [t, color] = PLAZO[o.plazo?.estado] ?? ["—", "gray"];
                  return (
                    <tr key={o.id}>
                      <td><Link href={`/ot/${o.id}` as any} className="codigo" style={{ textDecoration: "underline" }}>{o.codigo}</Link></td>
                      <td>{o.cliente ?? "—"}</td>
                      <td>{o.disposicionRef ?? "—"}</td>
                      <td>{fechaDia(o.desde)}</td>
                      <td>{o.plazo ? `${fechaDia(o.plazo.limite)} (${o.plazo.diasRestantes < 0 ? `vencida hace ${-o.plazo.diasRestantes} días` : `faltan ${o.plazo.diasRestantes} días`})` : "—"}</td>
                      <td><span className={`pill ${color}`}>{t}</span></td>
                    </tr>
                  );
                })}
                {!d.otOpiPendiente.length && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: 18 }}>No hay OT con la OPI pendiente.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {d && vista === "sinot" && (
        <>
          <p className="hint">Si una cotización aceptada no tendrá OT en el LIMS, márquela como excepción desde su ficha («No tendrá OT») y deja de aparecer aquí.</p>
          <div className="card card--table">
            <table className="data">
              <thead><tr><th>Cotización</th><th>Cliente</th><th>Aceptada</th><th>Documento</th></tr></thead>
              <tbody>
                {d.aceptadasSinOt.map((c: any) => (
                  <tr key={c.id}>
                    <td><Link href={`/cotizaciones/${c.id}` as any} className="codigo" style={{ textDecoration: "underline" }}>{c.codigo}</Link></td>
                    <td>{c.cliente ?? "—"}</td>
                    <td>{fechaDia(c.aceptadaAt)}</td>
                    <td>{ACEPTACION_LABEL[c.aceptacionTipo] ?? c.aceptacionTipo ?? "—"}</td>
                  </tr>
                ))}
                {!d.aceptadasSinOt.length && <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--muted)", padding: 18 }}>No hay cotizaciones aceptadas sin OT.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
