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
import { fecha, fechaDia } from "@/lib/format";
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
      <Calendario filas={filas ?? []} />
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
                  <td>{f.actaFirmadaAt ? `Acta ${fecha(f.actaFirmadaAt)}` : f.programadaPara ? `Programada ${fechaDia(f.programadaPara)}` : <span className="pill amber">Por programar</span>}</td>
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

/**
 * EP-11 11.4 / 11.5 · calendario de recepción: las recepciones programadas
 * con el importador que aún no tienen acta, por día, con el aviso de llegada
 * (transportista, bultos, aviso previo) cuando ya se registró.
 */
function Calendario({ filas }: { filas: any[] }) {
  const porRecibir = filas.filter((f) => f.estado !== "cerrada" && !f.actaFirmadaAt);
  const programadas = porRecibir.filter((f) => f.programadaPara).sort((a, b) => String(a.programadaPara).localeCompare(String(b.programadaPara)));
  const sinProgramar = porRecibir.length - programadas.length;
  if (!porRecibir.length) return null;
  const dias = new Map<string, any[]>();
  for (const f of programadas) {
    const k = String(f.programadaPara).slice(0, 10);
    dias.set(k, [...(dias.get(k) ?? []), f]);
  }
  return (
    <section className="card" aria-label="Calendario de recepción">
      <h2>Calendario de recepción <span className="right">{programadas.length} programada(s){sinProgramar ? ` · ${sinProgramar} por programar` : ""}</span></h2>
      {programadas.length === 0 ? (
        <p className="subtitle">Ninguna recepción programada todavía: el Jefe de la Delegación la programa con el importador en el paso 1 de cada OT.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 }}>
          {[...dias.entries()].map(([dia, fs]) => (
            <div key={dia} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px" }}>
              <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 4 }}>{fecha(dia)}</div>
              {fs.map((f) => (
                <div key={f.id} style={{ fontSize: 12, padding: "4px 0", borderTop: "1px dashed var(--line)" }}>
                  <Link href={`/saec/ot/${f.id}` as any} className="codigo">{f.codigo}</Link> · {f.cliente ?? "—"}
                  <div style={{ color: "var(--muted)" }}>{f.lugar ?? "lugar por definir"}{f.responsable ? ` · ${f.responsable}` : ""}</div>
                  {f.llegadaFecha ? (
                    <div>
                      <span className={`pill ${f.avisoPrevio ? "green" : "amber"}`}>{f.avisoPrevio ? "Con aviso previo" : "Sin aviso previo"}</span>{" "}
                      {f.transportista ?? "—"} · {f.bultos ?? "—"} bulto(s)
                    </div>
                  ) : (
                    <div><span className="pill gray">Llegada sin registrar</span></div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
