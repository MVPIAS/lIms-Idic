"use client";

/**
 * BPCH · Reinspecciones: nueva inspección de un producto o lote ya
 * inspeccionado (traspaso, vencimiento, rechazo…), ligada a su OT, certificado
 * o código original. API: GET /bpch/reinspecciones
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader, EmptyState, SkeletonRows } from "@/components/ui/PageHeader";
import RequierePermiso from "@/components/RequierePermiso";
import { usePermisos } from "@/lib/permisos";
import { fecha } from "@/lib/format";
import { pedir } from "../_components/bpch";

export default function ReinspeccionesPage() {
  return (
    <RequierePermiso perm="bpch.reinspeccion.ver" titulo="Reinspecciones BPCH">
      <Lista />
    </RequierePermiso>
  );
}

function Lista() {
  const router = useRouter();
  const { puede } = usePermisos();
  const [q, setQ] = useState("");
  const [filas, setFilas] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  const buscar = useCallback(async () => {
    setFilas(null);
    try {
      const qs = new URLSearchParams({ limit: "100" });
      if (q.trim()) qs.set("q", q.trim());
      setFilas((await pedir<any>("GET", `/bpch/reinspecciones?${qs}`)).data);
      setError("");
    } catch (e: any) {
      setError(e.message);
      setFilas([]);
    }
  }, [q]);
  useEffect(() => {
    buscar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div>
      <PageHeader
        icono="↻"
        titulo="Reinspecciones · BPCH"
        subtitulo="Solicitud → OT y lote → resultados → Informe de Inspección → trazabilidad en la Codificación Única → cierre."
        migas={[{ label: "BPCH" }, { label: "Reinspecciones" }]}
        acciones={puede("bpch.reinspeccion.gestionar") && <Link href={"/bpch/reinspecciones/nueva" as any} className="btn primary">＋ Solicitar reinspección</Link>}
      />
      {error && <div className="alert warn" role="alert">{error}</div>}
      <form className="toolbar" onSubmit={(e) => { e.preventDefault(); buscar(); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nº, producto, CNC, empresa u OT (nueva u original)" style={{ flex: 1, minWidth: 240 }} aria-label="Buscar reinspecciones" />
        <button className="btn primary sm" type="submit">Buscar</button>
      </form>
      <div className="card card--table">
        <table className="data">
          <thead><tr><th>Nº</th><th>Solicitud</th><th>Motivo</th><th>Producto · CNC</th><th>Titular</th><th>OT original</th><th>OT</th><th>Trazabilidad</th></tr></thead>
          <tbody>
            {filas === null && <SkeletonRows cols={8} />}
            {filas?.map((f) => (
              <tr key={f.id} className="row-action" onClick={() => router.push(`/bpch/reinspecciones/${f.id}` as any)}>
                <td><Link href={`/bpch/reinspecciones/${f.id}` as any} className="codigo" onClick={(e) => e.stopPropagation()}>{f.numero}</Link></td>
                <td>{fecha(f.fechaSolicitud)}</td>
                <td>{f.motivo}</td>
                <td>{f.elementoEspecifico}<small className="codigo" style={{ display: "block" }}>{f.cnc ?? ""}</small></td>
                <td>{f.empresa}</td>
                <td>{f.origenOtCodigo ?? "—"}</td>
                <td>{f.otCodigo}<small style={{ display: "block", color: "var(--muted)" }}>{f.otEstado} · {f.unidadCodigo}</small></td>
                <td>{f.trazabilidadAt ? <span className="pill green">Registrada</span> : "—"}</td>
              </tr>
            ))}
            {filas?.length === 0 && <tr><td colSpan={8}><EmptyState icono="↻" titulo="No hay reinspecciones" texto="La reinspección se solicita desde un producto codificado o desde la OT / certificado original." /></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
