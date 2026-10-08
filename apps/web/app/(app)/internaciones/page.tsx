"use client";

/**
 * Internaciones · búsqueda de OT de internación (IDIC-PG 24 Anexo 03) con la
 * tasa del 1,5 % y su estado de cobro (SVT8). Solo consulta: la tasa se calcula
 * en el costeo (POST /cotizaciones/tasa-internacion) y el cobro en Facturación.
 * API: GET /internaciones/ot?resolucion=&empresa=&estado=&cobro=
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { clp, fecha, rut as fmtRut } from "@/lib/format";
import { pedir } from "../cotizaciones/_components/comercial";

const COBRO_PILL: Record<string, { c: string; l: string }> = {
  pendiente: { c: "amber", l: "Pendiente" },
  facturada: { c: "blue", l: "Facturada" },
  pagada: { c: "green", l: "Pagada" },
  sin_cobro: { c: "gray", l: "Sin cobro" },
};

export default function InternacionesPage() {
  const [resolucion, setResolucion] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [estado, setEstado] = useState("");
  const [cobro, setCobro] = useState("");
  const [filas, setFilas] = useState<any[]>([]);
  const [fuentes, setFuentes] = useState<{ tasa: boolean; factura: boolean } | null>(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  const buscar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const qs = new URLSearchParams();
      if (resolucion.trim()) qs.set("resolucion", resolucion.trim());
      if (empresa.trim()) qs.set("empresa", empresa.trim());
      if (estado) qs.set("estado", estado);
      if (cobro) qs.set("cobro", cobro);
      const r = await pedir<any>("GET", `/internaciones/ot?${qs}`);
      setFilas(r?.data ?? []);
      setFuentes(r?.meta?.fuentes ?? null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, [resolucion, empresa, estado, cobro]);

  useEffect(() => {
    buscar();
    // Primera carga sin filtros; luego se busca con el botón / Enter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalTasa = filas.reduce((s, f) => s + (Number(f.tasa?.total) || 0), 0);

  return (
    <div>
      <h1 className="page">Internaciones <span className="tag">tasa 1,5 %</span></h1>
      <p className="subtitle">
        OT de internación (resolución DGMN) con la tasa del 1,5 % calculada y su estado de cobro. El cálculo de la tasa está en el costeo comercial.
      </p>
      {error && <div className="alert warn">{error}</div>}
      {fuentes && (!fuentes.tasa || !fuentes.factura) && (
        <div className="alert info">
          {!fuentes.tasa && "Esta base de datos no tiene registro de cálculos de tasa (calculo_tasa_internacion): la columna Tasa queda vacía. "}
          {!fuentes.factura && "Sin vínculo factura↔OT: el cobro se muestra como pendiente/sin cobro."}
        </div>
      )}

      <form
        className="toolbar"
        style={{ flexWrap: "wrap", gap: 6 }}
        onSubmit={(e) => { e.preventDefault(); buscar(); }}
      >
        <input placeholder="Nº resolución DGMN" value={resolucion} onChange={(e) => setResolucion(e.target.value)} style={{ minWidth: 170 }} />
        <input placeholder="Empresa / RUT" value={empresa} onChange={(e) => setEmpresa(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
        <select value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="">Estado OT: todos</option>
          {["recepcionada", "en_analisis", "validacion", "finalizada", "informada", "cerrada", "anulada"].map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <select value={cobro} onChange={(e) => setCobro(e.target.value)}>
          <option value="">Cobro: todos</option>
          {Object.entries(COBRO_PILL).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}
        </select>
        <button className="btn primary sm" type="submit" disabled={cargando}>{cargando ? "Buscando…" : "Buscar"}</button>
      </form>

      <div className="card card--table">
        <table className="data">
          <thead>
            <tr>
              <th>OT</th>
              <th>Resolución</th>
              <th>Empresa</th>
              <th>Ingreso</th>
              <th>Estado OT</th>
              <th className="num">CIF (US$)</th>
              <th className="num">Tasa + IVA</th>
              <th>Factura</th>
              <th>Cobro</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.id}>
                <td><Link href={`/ot/${f.id}` as any} className="codigo" style={{ textDecoration: "underline" }}>{f.codigo}</Link></td>
                <td>{f.resolucion ?? "—"}</td>
                <td>{f.cliente?.razonSocial ?? "—"}{f.cliente?.rut ? <small style={{ display: "block", color: "var(--muted)" }}>{fmtRut(f.cliente.rut)}</small> : null}</td>
                <td>{fecha(f.fechaRecepcion)}</td>
                <td><span className="pill gray">{f.estado}</span></td>
                <td className="num">{f.tasa?.cifUsd != null ? Number(f.tasa.cifUsd).toLocaleString("es-CL") : "—"}</td>
                <td className="num">{f.tasa ? clp(f.tasa.total) : "—"}</td>
                <td>{f.factura ? `${f.factura.numero} (${f.factura.estado})` : "—"}</td>
                <td><span className={`pill ${COBRO_PILL[f.cobro]?.c ?? "gray"}`}>{COBRO_PILL[f.cobro]?.l ?? f.cobro}</span></td>
              </tr>
            ))}
            {!cargando && filas.length === 0 && (
              <tr><td colSpan={9} style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>Sin OT de internación para estos filtros.</td></tr>
            )}
          </tbody>
          {filas.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={6} className="num" style={{ fontWeight: 700 }}>{filas.length} OT · total tasa registrada</td>
                <td className="num" style={{ fontWeight: 800 }}>{clp(totalTasa)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
