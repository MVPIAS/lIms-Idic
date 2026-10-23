"use client";

/**
 * Documentos › Oficios conductores (EP-00 3.1–3.3, EP-05 7.2).
 *  · «Todos»: los de su ámbito (unidad emisora) y los que debe firmar.
 *  · «Por firmar»: los que esperan su V°B° o su firma según la matriz OFICIO.
 *  · «Por despachar»: firmados que la Oficina de partes debe despachar.
 * Se elaboran desde la cotización o desde el documento de la OT («Oficio conductor…»).
 */
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PageHeader, EmptyState, SkeletonRows } from "@/components/ui/PageHeader";
import { llamar } from "@/lib/laboratorio";
import { fechaDia } from "@/lib/format";
import { ESTADO_OFICIO } from "@/lib/oficios";

type Vista = "todos" | "por_firmar" | "por_despachar";

export default function OficiosPage() {
  return (
    <Suspense fallback={<p className="subtitle">Cargando…</p>}>
      <Oficios />
    </Suspense>
  );
}

function Oficios() {
  const params = useSearchParams();
  const inicial = (params.get("vista") as Vista) ?? "todos";
  const [vista, setVista] = useState<Vista>(["todos", "por_firmar", "por_despachar"].includes(inicial) ? inicial : "todos");
  const [estado, setEstado] = useState(params.get("estado") ?? "");
  const [filas, setFilas] = useState<any[] | null>(null);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    setFilas(null);
    setError("");
    try {
      const q = new URLSearchParams();
      if (vista !== "todos") q.set("vista", vista);
      if (estado && vista === "todos") q.set("estado", estado);
      const r = await llamar<{ data: any[] }>("GET", `/oficios?${q}`);
      setFilas(r.data);
    } catch (e: any) {
      setError(e.message);
      setFilas([]);
    }
  }, [vista, estado]);
  useEffect(() => {
    cargar();
  }, [cargar]);

  const tab = (v: Vista, t: string) => (
    <button type="button" className={`tab${vista === v ? " active" : ""}`} aria-pressed={vista === v} onClick={() => setVista(v)}>{t}</button>
  );

  return (
    <div>
      <PageHeader
        titulo="Oficios conductores"
        subtitulo="El IVC, el Informe Técnico, el Informe de Rechazo y las cotizaciones a Ejército y FF.AA. salen con oficio: V°B° del Jefe de Departamento, firma de la Dirección y despacho por la Oficina de partes."
        migas={[{ label: "Laboratorio" }, { label: "Oficios conductores" }]}
      />
      {error && <div className="alert warn" role="alert">{error}</div>}
      <div className="card" style={{ padding: 0 }}>
        <div className="tabs" style={{ padding: "0 8px", display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
          {tab("todos", "Todos")}
          {tab("por_firmar", "Por firmar")}
          {tab("por_despachar", "Por despachar")}
          <span style={{ flex: 1 }} />
          {vista === "todos" && (
            <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center", padding: 6 }}>
              Estado
              <select value={estado} onChange={(e) => setEstado(e.target.value)} aria-label="Filtrar por estado">
                <option value="">Todos</option>
                {Object.entries(ESTADO_OFICIO).map(([k, v]) => <option key={k} value={k}>{v.texto}</option>)}
              </select>
            </label>
          )}
        </div>
        <div style={{ padding: 12, overflowX: "auto" }}>
          {filas === null ? (
            <SkeletonRows cols={6} />
          ) : filas.length === 0 ? (
            <EmptyState
              compacto
              icono="✉"
              titulo={vista === "por_firmar" ? "Ningún oficio espera su firma" : vista === "por_despachar" ? "Ningún oficio por despachar" : "Sin oficios"}
              texto="Los oficios se elaboran desde la cotización o desde el documento de la OT («Oficio conductor…»)."
            />
          ) : (
            <table className="data">
              <thead><tr><th>Nº</th><th>Fecha</th><th>Materia</th><th>Destinatario</th><th>Conduce</th><th>Estado</th></tr></thead>
              <tbody>
                {filas.map((o) => {
                  const e = ESTADO_OFICIO[o.estado] ?? { texto: o.estado, pill: "gray" };
                  return (
                    <tr key={o.id}>
                      <td><Link href={`/oficios/${o.id}` as any} className="codigo">{o.numero ?? "(borrador)"}</Link></td>
                      <td>{fechaDia(o.fecha)}</td>
                      <td>{o.materia}</td>
                      <td>{o.destinatario}</td>
                      <td>{o.cotizacion ? `Cotización ${o.cotizacion}` : o.ot ? `OT ${o.ot}` : "—"} <small style={{ color: "var(--muted)" }}>· {o.unidad}</small></td>
                      <td>
                        <span className={`pill ${e.pill}`}>{e.texto}</span>
                        {o.meToca && o.estado === "en_firma" && <span className="pill amber" style={{ marginLeft: 4 }}>le toca</span>}
                        {o.despachoNumero && <small style={{ display: "block", color: "var(--muted)" }}>Despacho Nº {o.despachoNumero}</small>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
