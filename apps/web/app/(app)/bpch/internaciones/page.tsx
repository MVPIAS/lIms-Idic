"use client";

/**
 * BPCH · Internaciones (IDIC-PG 24 Anexo 03): expedientes que nacen con la
 * resolución DGMN. Lista con búsqueda y estado; «Registrar resolución» abre el
 * formulario vacío. API: GET /bpch/internaciones
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader, EmptyState, SkeletonRows } from "@/components/ui/PageHeader";
import RequierePermiso from "@/components/RequierePermiso";
import { usePermisos } from "@/lib/permisos";
import { fecha } from "@/lib/format";
import { DOC_ADM, ESTADO_INTERNACION, pedir } from "../_components/bpch";

export default function InternacionesBpchPage() {
  return (
    <RequierePermiso perm="bpch.internacion.ver" titulo="Internaciones BPCH">
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

  return (
    <div>
      <PageHeader
        icono="🛃"
        titulo="Internaciones · BPCH"
        subtitulo="Resolución DGMN → análisis técnico → OT automática → inspección → certificado o incumplimiento → tasa → cierre (IDIC-PG 24 Anexo 03)."
        migas={[{ label: "BPCH" }, { label: "Internaciones" }]}
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
            <tr><th>Nº</th><th>Resolución DGMN</th><th>Empresa importadora</th><th>Elementos</th><th>Inspecciona</th><th>Estado</th><th>OT</th><th>Tasa</th></tr>
          </thead>
          <tbody>
            {filas === null && <SkeletonRows cols={8} />}
            {filas?.map((f) => (
              <tr key={f.id} className="row-action" onClick={() => router.push(`/bpch/internaciones/${f.id}` as any)}>
                <td><Link href={`/bpch/internaciones/${f.id}` as any} className="codigo" onClick={(e) => e.stopPropagation()}>{f.numero}</Link></td>
                <td>{f.resolucionNumero}<small style={{ display: "block", color: "var(--muted)" }}>{fecha(f.resolucionFecha)}</small></td>
                <td>{f.empresa}<small style={{ display: "block", color: "var(--muted)" }}>{f.rut}</small></td>
                <td>{f.elementos ?? "—"}</td>
                <td title={f.unidadNombre}>{f.unidadCodigo}</td>
                <td><span className={`pill ${ESTADO_INTERNACION[f.estado]?.c ?? "gray"}`}>{ESTADO_INTERNACION[f.estado]?.l ?? f.estado}</span></td>
                <td>{f.otCodigo ? <>{f.otCodigo}<small style={{ display: "block", color: "var(--muted)" }}>{f.otEstado}</small></> : "—"}</td>
                <td>{f.sujetaTasa ? (f.remitidaAt ? <span className="pill green">Remitida</span> : <small>{DOC_ADM[f.docAdmEstado] ?? f.docAdmEstado}</small>) : <small style={{ color: "var(--muted)" }}>Sin tasa</small>}</td>
              </tr>
            ))}
            {filas?.length === 0 && (
              <tr><td colSpan={8}><EmptyState icono="🛃" titulo="No hay internaciones con estos filtros" texto="Registre la resolución DGMN para abrir el expediente: la OT se genera al completar el análisis técnico." /></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
