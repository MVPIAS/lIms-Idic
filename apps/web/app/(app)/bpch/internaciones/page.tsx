"use client";

/**
 * Internaciones (IDIC-PG 24 Anexo 03): UNA sola pantalla para BPCH y Comercial.
 * Se llega desde «Comercial › Internaciones» y desde «BPCH · Certificación ›
 * Internaciones» (la antigua /internaciones redirige aquí). Cada perfil ve y
 * hace lo que su permiso le deja:
 *  · Comercial registra la resolución DGMN (bpch.internacion.registrar) y, en el
 *    expediente, calcula la tasa y la remite a facturación (bpch.tasa.gestionar);
 *  · la Sección Certificación y las sucursales tramitan el expediente.
 * Con «ot.ver» se suman la tasa calculada y el estado de cobro de cada OT, y
 * las OT de internación anteriores que no tienen expediente BPCH.
 * API: GET /bpch/internaciones · GET /internaciones/ot (tasa y cobro).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader, EmptyState, SkeletonRows } from "@/components/ui/PageHeader";
import RequierePermiso from "@/components/RequierePermiso";
import PorcentajesTasa from "@/components/parametros/PorcentajesTasa";
import { usePermisos } from "@/lib/permisos";
import { clp, fecha } from "@/lib/format";
import { AVANCE_INTERNACION, DOC_ADM, ESTADO_INTERNACION, pedir } from "../_components/bpch";

const COBRO_PILL: Record<string, { c: string; l: string }> = {
  pendiente: { c: "amber", l: "Pendiente" },
  facturada: { c: "blue", l: "Facturada" },
  pagada: { c: "green", l: "Pagada" },
  sin_cobro: { c: "gray", l: "Sin cobro" },
};

export default function InternacionesBpchPage() {
  return (
    <RequierePermiso perm="bpch.internacion.ver" titulo="Internaciones">
      <Lista />
    </RequierePermiso>
  );
}

function Lista() {
  const router = useRouter();
  const { puede } = usePermisos();
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState("");
  const [filas, setFilas] = useState<any[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  /** Tasa y cobro por OT (búsqueda comercial de OT de internación). null = sin permiso o sin datos. */
  const [cobros, setCobros] = useState<any[] | null>(null);

  const buscar = useCallback(async () => {
    setFilas(null);
    setError("");
    try {
      const qs = new URLSearchParams({ limit: "100" });
      if (q.trim()) qs.set("q", q.trim());
      if (estado) qs.set("estado", estado);
      const r = await pedir<any>("GET", `/bpch/internaciones?${qs}`);
      setFilas(r.data);
      setTotal(r.meta.total);
    } catch (e: any) {
      setError(e.message);
      setFilas([]);
    }
  }, [q, estado]);

  useEffect(() => {
    buscar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  // Tasa y cobro: Comercial, Finanzas y quien gestiona la tasa (como la antigua pantalla comercial).
  const verCobro = puede("ot.ver") && puede(["cotizacion.ver", "factura.ver", "bpch.tasa.gestionar"]);
  useEffect(() => {
    if (!verCobro) return;
    pedir<any>("GET", "/internaciones/ot?limit=500").then((r) => setCobros(r?.data ?? [])).catch(() => setCobros(null));
  }, [verCobro]);

  const cobroPorOt = useMemo(() => new Map((cobros ?? []).map((c) => [c.id, c])), [cobros]);
  /** OT de internación sin expediente BPCH (anteriores a la puerta única o creadas a mano). */
  const sinExpediente = useMemo(() => {
    if (!cobros || filas === null || q.trim() || estado) return [];
    const conExpediente = new Set(filas.map((f) => f.otId).filter(Boolean));
    return cobros.filter((c) => !conExpediente.has(c.id));
  }, [cobros, filas, q, estado]);

  return (
    <div>
      <PageHeader
        icono="🛃"
        titulo="Internaciones"
        subtitulo={<>
          Resolución DGMN → análisis técnico → OT automática → inspección → certificado o incumplimiento → tasa → cierre (IDIC-PG 24 Anexo 03).
          La OT de internación nace sola al registrar la resolución: no se crea en «Registrar OT».{" "}
          <PorcentajesTasa compacto />
        </>}
        migas={[{ label: "BPCH · Comercial" }, { label: "Internaciones" }]}
        acciones={puede("bpch.internacion.registrar") && <Link href={"/bpch/internaciones/nueva" as any} className="btn primary">＋ Registrar resolución DGMN</Link>}
      />
      {error && <div className="alert warn" role="alert">{error}</div>}
      <form className="toolbar" onSubmit={(e) => { e.preventDefault(); buscar(); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nº internación, resolución, empresa, RUT, OT, producto o CNC" style={{ flex: 1, minWidth: 260 }} aria-label="Buscar internaciones" />
        <select value={estado} onChange={(e) => setEstado(e.target.value)} aria-label="Estado">
          <option value="">Todos los estados</option>
          {Object.entries(ESTADO_INTERNACION).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}
        </select>
        <button className="btn primary sm" type="submit">Buscar</button>
        <span className="spacer" />
        <small style={{ color: "var(--muted)" }}>{total} expediente(s)</small>
      </form>
      <div className="card card--table">
        <table className="data">
          <thead>
            <tr>
              <th>Nº</th><th>Resolución DGMN</th><th>Empresa importadora</th><th>Elementos</th><th>Inspecciona</th><th>Estado</th><th>OT</th><th>Tasa</th>
              {verCobro && <th className="num">Tasa + IVA</th>}
              {verCobro && <th>Cobro</th>}
            </tr>
          </thead>
          <tbody>
            {filas === null && <SkeletonRows cols={verCobro ? 10 : 8} />}
            {filas?.map((f) => {
              const c = f.otId ? cobroPorOt.get(f.otId) : null;
              return (
                <tr key={f.id} className="row-action" onClick={() => router.push(`/bpch/internaciones/${f.id}` as any)}>
                  <td><Link href={`/bpch/internaciones/${f.id}` as any} className="codigo" onClick={(e) => e.stopPropagation()}>{f.numero}</Link></td>
                  <td>{f.resolucionNumero}<small style={{ display: "block", color: "var(--muted)" }}>{fecha(f.resolucionFecha)}</small></td>
                  <td>{f.empresa}<small style={{ display: "block", color: "var(--muted)" }}>{f.rut}</small></td>
                  <td>{f.elementos ?? "—"}</td>
                  <td title={f.unidadNombre}>{f.unidadCodigo}</td>
                  <td><span className={`pill ${AVANCE_INTERNACION[f.avance ?? f.estado]?.c ?? "gray"}`}>{f.avanceTexto ?? AVANCE_INTERNACION[f.avance ?? f.estado]?.l ?? f.estado}</span></td>
                  <td>{f.otCodigo ? <>{f.otCodigo}<small style={{ display: "block", color: "var(--muted)" }}>{f.otEstado}</small></> : "—"}</td>
                  <td>{f.sujetaTasa ? (f.remitidaAt ? <span className="pill green">Remitida</span> : <small>{DOC_ADM[f.docAdmEstado] ?? f.docAdmEstado}</small>) : <small style={{ color: "var(--muted)" }}>Sin tasa</small>}</td>
                  {verCobro && <td className="num">{c?.tasa ? clp(c.tasa.total) : "—"}</td>}
                  {verCobro && <td>{c ? <span className={`pill ${COBRO_PILL[c.cobro]?.c ?? "gray"}`} title={c.factura ? `Factura ${c.factura.numero} (${c.factura.estado})` : undefined}>{COBRO_PILL[c.cobro]?.l ?? c.cobro}</span> : "—"}</td>}
                </tr>
              );
            })}
            {filas?.length === 0 && (
              <tr><td colSpan={verCobro ? 10 : 8}><EmptyState icono="🛃" titulo="No hay internaciones con estos filtros" texto="Registre la resolución DGMN para abrir el expediente: la OT se genera al completar el análisis técnico." /></td></tr>
            )}
          </tbody>
        </table>
      </div>

      {sinExpediente.length > 0 && (
        <section className="card card--table" aria-labelledby="int-sin-exp">
          <h2 id="int-sin-exp" style={{ fontSize: 14, margin: "12px 12px 4px" }}>OT de internación sin expediente BPCH ({sinExpediente.length})</h2>
          <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 12px 8px" }}>
            Órdenes con origen «Internación» creadas antes de la puerta única (o a mano). Se siguen consultando y cobrando; las nuevas nacen al registrar la resolución DGMN.
          </p>
          <table className="data">
            <thead><tr><th>OT</th><th>Resolución</th><th>Empresa</th><th>Ingreso</th><th>Estado OT</th><th className="num">CIF (US$)</th><th className="num">Tasa + IVA</th><th>Factura</th><th>Cobro</th></tr></thead>
            <tbody>
              {sinExpediente.map((f) => (
                <tr key={f.id}>
                  <td><Link href={`/ot/${f.id}` as any} className="codigo" style={{ textDecoration: "underline" }}>{f.codigo}</Link></td>
                  <td>{f.resolucion ?? "—"}</td>
                  <td>{f.cliente?.razonSocial ?? "—"}</td>
                  <td>{fecha(f.fechaRecepcion)}</td>
                  <td><span className="pill gray">{f.estado}</span></td>
                  <td className="num">{f.tasa?.cifUsd != null ? Number(f.tasa.cifUsd).toLocaleString("es-CL") : "—"}</td>
                  <td className="num">{f.tasa ? clp(f.tasa.total) : "—"}</td>
                  <td>{f.factura ? `${f.factura.numero} (${f.factura.estado})` : "—"}</td>
                  <td><span className={`pill ${COBRO_PILL[f.cobro]?.c ?? "gray"}`}>{COBRO_PILL[f.cobro]?.l ?? f.cobro}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
