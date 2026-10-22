"use client";

/**
 * BPCH · SAEC › Certificación de armas (Delegación Nº 11, EP-11 camino A).
 * OT de armas internadas de la D11: cada una nace de la internación (resolución
 * DGMN) con la D11 como unidad que inspecciona. API: GET /d11/ot.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EmptyState, PageHeader, SkeletonRows } from "@/components/ui/PageHeader";
import RequierePermiso from "@/components/RequierePermiso";
import { fecha } from "@/lib/format";
import { pedir } from "@/lib/d11";

export default function CertificacionArmasPage() {
  return (
    <RequierePermiso perm="arma.ver" titulo="Certificación de armas">
      <Lista />
    </RequierePermiso>
  );
}

function Lista() {
  const router = useRouter();
  const [filas, setFilas] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    pedir<{ data: any[] }>("GET", "/d11/ot")
      .then((r) => setFilas(r.data))
      .catch((e) => {
        setError(e.message);
        setFilas([]);
      });
  }, []);

  const t = q.trim().toLowerCase();
  const visibles = (filas ?? []).filter(
    (f) => !t || [f.codigo, f.cliente, f.resolucion, f.internacion].some((x) => String(x ?? "").toLowerCase().includes(t)),
  );

  return (
    <div>
      <PageHeader
        icono="🎯"
        titulo="Certificación de armas"
        subtitulo="Delegación Nº 11 · armas internadas con resolución DGMN: recepción, registro por arma, ensayos, acuñación, certificado por arma y entrega."
        migas={[{ label: "BPCH · SAEC" }, { label: "Certificación de armas" }]}
        acciones={<Link href={"/saec/catalogos" as any} className="btn outline sm">Catálogo de armas</Link>}
      />
      <div className="card">
        <div className="toolbar" style={{ marginTop: 0 }}>
          <label className="sr-only" htmlFor="q-ot">Buscar</label>
          <input id="q-ot" placeholder="Buscar por OT, importador o resolución" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 280 }} />
          <span className="spacer" />
          <small style={{ color: "var(--muted)" }}>La OT nace de la internación (BPCH › Internaciones) al completar el análisis técnico.</small>
        </div>
        {error && <div className="alert warn" role="alert">{error}</div>}
        {filas === null ? (
          <table className="data"><tbody><SkeletonRows cols={8} rows={4} /></tbody></table>
        ) : visibles.length === 0 ? (
          <EmptyState icono="🎯" titulo="No hay OT de armas" texto="Cuando la Sección Certificación complete el análisis técnico de una internación de la D11, su OT aparece aquí." />
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>OT</th><th>Importador</th><th>Resolución DGMN</th><th className="num">Según resolución</th><th className="num">Registradas</th>
                <th className="num">Certificados oficiales</th><th>Recepción</th><th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => (
                <tr key={f.id} style={{ cursor: "pointer" }} onClick={() => router.push(`/saec/ot/${f.id}` as any)}>
                  <td style={{ whiteSpace: "nowrap" }}><Link href={`/saec/ot/${f.id}` as any} className="codigo" onClick={(e) => e.stopPropagation()}>{f.codigo}</Link></td>
                  <td>{f.cliente ?? "—"}</td>
                  <td>{f.resolucion ?? "—"}{f.internacion ? <small style={{ display: "block", color: "var(--muted)" }}>{f.internacion}</small> : null}</td>
                  <td className="num">{f.segunResolucion || "—"}</td>
                  <td className="num">{f.armas}</td>
                  <td className="num">{f.certificados}</td>
                  <td>{f.actaFirmadaAt ? `Acta ${fecha(f.actaFirmadaAt)}` : f.programadaPara ? `Programada ${fecha(f.programadaPara)}` : <span className="pill amber">Por programar</span>}</td>
                  <td><span className={`pill ${f.estado === "cerrada" ? "gray" : "teal"}`}>{f.estado}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
