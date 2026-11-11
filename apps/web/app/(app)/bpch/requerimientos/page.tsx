"use client";

/**
 * BPCH · Requerimientos (OT sin cotización, Reunión 11 · 06-11-2026).
 * El Jefe de la SCC, un Jefe de Escalón o el Jefe de la Delegación 11 elabora
 * el requerimiento; otra jefatura lo valida y nace la OT derivada a la
 * sucursal. API: /bpch/requerimientos
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader, EmptyState, SkeletonRows } from "@/components/ui/PageHeader";
import RequierePermiso from "@/components/RequierePermiso";
import { usePermisos } from "@/lib/permisos";
import { fecha } from "@/lib/format";
import { pedir } from "../_components/bpch";
import { ESCALON, ESTADO_REQ } from "./requerimiento";

export default function RequerimientosPage() {
  return (
    <RequierePermiso perm="bpch.requerimiento.ver" titulo="Requerimientos BPCH">
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
  const [error, setError] = useState("");
  const buscar = useCallback(async () => {
    setFilas(null);
    try {
      const qs = new URLSearchParams({ limit: "100" });
      if (q.trim()) qs.set("q", q.trim());
      if (estado) qs.set("estado", estado);
      setFilas((await pedir<any>("GET", `/bpch/requerimientos?${qs}`)).data);
      setError("");
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
        icono="✎"
        titulo="Requerimientos · BPCH"
        subtitulo="OT sin cotización: requerimiento (oficio o RPI) → validación del Jefe de Escalón → OT derivada a la sucursal → inspección → informe y cierre."
        migas={[{ label: "BPCH" }, { label: "Requerimientos" }]}
        acciones={puede("bpch.requerimiento.crear") && <Link href={"/bpch/requerimientos/nuevo" as any} className="btn primary">＋ Nuevo requerimiento</Link>}
      />
      {error && <div className="alert warn" role="alert">{error}</div>}
      <form className="toolbar" onSubmit={(e) => { e.preventDefault(); buscar(); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nº, empresa, oficio / RPI u OT" style={{ flex: 1, minWidth: 240 }} aria-label="Buscar requerimientos" />
        <select value={estado} onChange={(e) => setEstado(e.target.value)} aria-label="Estado">
          <option value="">Todos los estados</option>
          {Object.entries(ESTADO_REQ).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}
        </select>
        <button className="btn primary sm" type="submit">Buscar</button>
      </form>
      <div className="card card--table">
        <table className="data">
          <thead><tr><th>Nº</th><th>Elabora</th><th>Empresa</th><th>Documento de origen</th><th>Cobro</th><th>Sucursal</th><th>Estado</th><th>OT</th></tr></thead>
          <tbody>
            {filas === null && <SkeletonRows cols={8} />}
            {filas?.map((f) => (
              <tr key={f.id} className="row-action" onClick={() => router.push(`/bpch/requerimientos/${f.id}` as any)}>
                <td><Link href={`/bpch/requerimientos/${f.id}` as any} className="codigo" onClick={(e) => e.stopPropagation()}>{f.numero}</Link></td>
                <td>{ESCALON[f.escalon] ?? f.escalon}</td>
                <td>{f.empresa}</td>
                <td>{f.docOrigenTipo === "rpi" ? "RPI" : "Oficio"} {f.docOrigenNumero}<small style={{ display: "block", color: "var(--muted)" }}>{fecha(f.docOrigenFecha)}</small></td>
                <td>{f.conCobro ? "Con cobro" : <span className="pill amber" title={f.sinCobroComunicacion ?? ""}>Sin cobro · {f.sinCobroNumero}</span>}</td>
                <td>{f.unidadCodigo}</td>
                <td><span className={`pill ${ESTADO_REQ[f.estado]?.c ?? "gray"}`}>{ESTADO_REQ[f.estado]?.l ?? f.estado}</span></td>
                <td>{f.otCodigo ? <Link href={`/ot/${f.otId}` as any} className="codigo" onClick={(e) => e.stopPropagation()}>{f.otCodigo}</Link> : "—"}</td>
              </tr>
            ))}
            {filas?.length === 0 && <tr><td colSpan={8}><EmptyState icono="✎" titulo="No hay requerimientos" texto="El requerimiento reemplaza a la cotización en BPCH: lo elabora la jefatura y, al validarlo, nace la OT de la sucursal." /></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
