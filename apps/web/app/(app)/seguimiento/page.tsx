"use client";

/**
 * Comercial › Seguimiento y envío (T20, frente r4c): lo que falta para que el
 * informe llegue al cliente, en el orden del proceso (EP-01 6.3, EP-00 4.3,
 * 6.3 y 6.4). Cada pestaña es una de las tarjetas de Mi bandeja y cuenta lo
 * mismo. Cada fila lleva a «Informe y cierre» de su OT, donde se actúa.
 */
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PageHeader, EmptyState, SkeletonRows } from "@/components/ui/PageHeader";
import { llamar } from "@/lib/laboratorio";
import { fechaDia } from "@/lib/format";
import { usePermisos } from "@/lib/permisos";

const VISTAS: { clave: string; titulo: string; ayuda: string; perm: string; fecha: string; boton: string }[] = [
  { clave: "por_despachar", titulo: "Por despachar", ayuda: "Documentos oficiales que el laboratorio aún no despacha al DCO, al solicitante o al BPCH.", perm: "certificado.despachar", fecha: "Oficial", boton: "Despachar →" },
  { clave: "por_recibir", titulo: "Despachos por recibir", ayuda: "Documentos despachados a su unidad que aún no se dan por recibidos.", perm: "certificado.entregar", fecha: "Despacho", boton: "Dar por recibido →" },
  { clave: "plazo_por_informar", titulo: "Plazo por informar", ayuda: "OT con fecha de compromiso que aún no se informa al cliente.", perm: "ot.seguimiento", fecha: "Compromiso", boton: "Notificar plazo →" },
  { clave: "recepcion_dco", titulo: "Recepción en DCO", ayuda: "OT con documento oficial sin la recepción del informe en DCO (días de atraso).", perm: "ot.seguimiento", fecha: "Compromiso", boton: "Registrar recepción →" },
  { clave: "por_enviar", titulo: "Por enviar al cliente", ayuda: "OT recibidas en DCO que aún no se envían al cliente.", perm: "ot.seguimiento", fecha: "Recepción DCO", boton: "Registrar envío →" },
];

export default function SeguimientoPage() {
  return (
    <Suspense fallback={<p className="subtitle">Cargando…</p>}>
      <Seguimiento />
    </Suspense>
  );
}

function Seguimiento() {
  const params = useSearchParams();
  const { puede, listo } = usePermisos();
  const visibles = VISTAS.filter((v) => puede(v.perm));
  const pedida = params.get("vista");
  const [vista, setVista] = useState<string>(pedida ?? "");
  const [filas, setFilas] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  const actual = VISTAS.find((v) => v.clave === vista) ?? visibles[0];

  useEffect(() => {
    if (listo && !vista && visibles[0]) setVista(visibles[0].clave);
  }, [listo, vista, visibles]);

  const cargar = useCallback(async () => {
    if (!actual) return;
    setFilas(null);
    setError("");
    try {
      const r = await llamar<{ data: any[] }>("GET", `/seguimiento/pendientes?vista=${actual.clave}`);
      setFilas(r.data);
    } catch (e: any) {
      setError(e.message);
      setFilas([]);
    }
  }, [actual]);
  useEffect(() => {
    cargar();
  }, [cargar]);

  return (
    <div>
      <PageHeader
        titulo="Seguimiento y envío"
        subtitulo="Del documento oficial al cliente: despacho, recepción en DCO, plazo informado y envío."
        migas={[{ label: "Comercial" }, { label: "Seguimiento y envío" }]}
      />
      {error && <div className="alert warn" role="alert">{error}</div>}
      {listo && !visibles.length ? (
        <EmptyState icono="🔒" titulo="Sin acceso" texto="Su perfil no despacha, recibe ni envía documentos." />
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="tabs" role="tablist" style={{ padding: "0 8px" }}>
            {visibles.map((v) => (
              <button key={v.clave} type="button" role="tab" aria-selected={actual?.clave === v.clave} className={`tab${actual?.clave === v.clave ? " active" : ""}`} onClick={() => setVista(v.clave)}>
                {v.titulo}
              </button>
            ))}
          </div>
          <div style={{ padding: 12, overflowX: "auto" }}>
            {actual && <p className="subtitle" style={{ marginTop: 0 }}>{actual.ayuda}</p>}
            {filas === null ? (
              <SkeletonRows cols={5} />
            ) : filas.length === 0 ? (
              <EmptyState compacto icono="✓" titulo="Nada pendiente" texto="No hay documentos ni OT en esta etapa." />
            ) : (
              <table className="data">
                <thead><tr><th>Documento / OT</th><th>Cliente</th><th>Detalle</th><th>{actual?.fecha}</th><th /></tr></thead>
                <tbody>
                  {filas.map((f) => (
                    <tr key={f.id}>
                      <td><span className="codigo">{f.numero}</span>{f.numero !== f.ot && <small style={{ display: "block", color: "var(--muted)" }}>OT {f.ot}</small>}</td>
                      <td>{f.cliente ?? "—"}</td>
                      <td>{f.detalle ?? "—"}</td>
                      <td>{f.fecha ? fechaDia(f.fecha) : "—"}</td>
                      <td style={{ textAlign: "right" }}><Link href={`/ot/${f.otId}?tab=informe` as any} className="btn outline sm">{actual?.boton}</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
