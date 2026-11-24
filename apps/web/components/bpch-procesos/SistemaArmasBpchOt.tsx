"use client";

/**
 * Panel «Sistema de armas BPCH» de la ficha de la OT: estado de la OT en el
 * software de certificación de armas del BPCH, su historial y los enlaces a la
 * OT, a los certificados por arma y al acta (abren en una pestaña nueva; los
 * documentos viven en el BPCH). Si la OT no se ha enviado, permite revisar lo
 * que se enviaría y encolar el envío. Guía: docs/INTEGRACION_ARMAS_BPCH.md.
 */
import { useCallback, useEffect, useState } from "react";
import { fechaHora } from "@/lib/format";
import { toast } from "@/components/ui/feedback";

const API = process.env.NEXT_PUBLIC_API_URL ?? "/api";

async function pedir(path: string, method = "GET", body?: unknown) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${localStorage.getItem("lims_token")}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e: any = new Error(j?.message ?? `Error ${r.status}`);
    e.status = r.status;
    e.errores = j?.errores;
    throw e;
  }
  return j;
}

const TIPO_ENLACE: Record<string, string> = { ot: "OT", acta: "Acta", certificado: "Certificado", otro: "Documento" };
const COLOR_ESTADO: Record<number, string> = { 1: "amber", 6: "blue", 7: "blue", 5: "teal", 2: "green", 8: "green", 3: "red" };

/** Solo http/https: el servidor ya filtró por servidores permitidos; esto es defensa en profundidad. */
const seguro = (u: string) => /^https?:\/\//i.test(u);

export default function SistemaArmasBpchOt({ otId }: { otId: string }) {
  const [d, setD] = useState<any>(null);
  const [oculto, setOculto] = useState(false);
  const [vista, setVista] = useState<any>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setD(await pedir(`/integracion/armas/ot/${otId}`));
    } catch (e: any) {
      if (e.status === 403 || e.status === 404) setOculto(true);
    }
  }, [otId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (oculto || !d) return null;

  const revisar = async () => {
    setOcupado(true);
    try {
      setVista(await pedir(`/integracion/armas/ot/${otId}/previsualizar`, "POST", {}));
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  };

  const enviar = async () => {
    setOcupado(true);
    try {
      await pedir(`/integracion/armas/ot/${otId}/enviar`, "POST", {});
      toast.ok("OT en cola para el software de armas del BPCH");
      setVista(null);
      await cargar();
    } catch (e: any) {
      toast.error(e.errores?.length ? e.errores.join(" ") : e.message);
    } finally {
      setOcupado(false);
    }
  };

  const actualizarEnlaces = async () => {
    setOcupado(true);
    try {
      const r = await pedir(`/integracion/armas/ot/${otId}/enlaces`, "POST");
      if (r.pedidos) toast.ok(`Enlaces actualizados (${r.guardados})`);
      else toast.info(r.motivo);
      await cargar();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  };

  const e = d.estado;
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, flex: 1 }}>Sistema de armas BPCH</h3>
        {d.enviada && (
          <button className="btn outline sm" disabled={ocupado} onClick={actualizarEnlaces}>
            Actualizar enlaces
          </button>
        )}
      </div>

      {!d.enviada ? (
        <div style={{ marginTop: 8 }}>
          <p className="muted" style={{ margin: "0 0 8px" }}>Esta OT no se ha enviado al software de certificación de armas del BPCH.</p>
          {!vista ? (
            <button className="btn outline sm" disabled={ocupado} onClick={revisar}>
              Revisar envío
            </button>
          ) : vista.errores?.length ? (
            <div className="alert warn">
              Falta para enviar: <ul style={{ margin: "4px 0 0 18px" }}>{vista.errores.map((x: string) => <li key={x}>{x}</li>)}</ul>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span>
                Resolución <b>{vista.payload.resolucion.numero}</b> · {vista.payload.cantidad_armas} armas · {vista.payload.tipo_orden === 2 ? "Empresa (internación)" : "Persona natural"}
              </span>
              {!vista.config.activa && <span className="pill amber">La integración está desactivada: quedará en cola</span>}
              <button className="btn sm" disabled={ocupado} onClick={enviar}>
                Enviar al software de armas
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 8 }}>
            <div>
              Estado: <span className={`pill ${COLOR_ESTADO[e.estado] ?? "gray"}`}>{e.descripcion ?? "Enviada, sin respuesta aún"}</span>
            </div>
            {e.bpchId && <div>N.º en el BPCH: <b>{e.bpchId}</b></div>}
            {e.fechaEstado && <div className="muted">Desde {fechaHora(e.fechaEstado)}</div>}
            {e.totalCertificados != null && <div>{e.totalCertificados} certificados</div>}
          </div>
          {e.motivo && <div className="alert warn" style={{ marginTop: 8 }}>Motivo: {e.motivo}</div>}
          {e.ultimoError && <div className="alert warn" style={{ marginTop: 8 }}>Último error de envío: {e.ultimoError}</div>}

          {d.enlaces?.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <b>Enlaces</b>
              <ul style={{ margin: "4px 0 0 18px" }}>
                {d.enlaces.filter((l: any) => seguro(l.url)).map((l: any) => (
                  <li key={l.id}>
                    {TIPO_ENLACE[l.tipo] ?? l.tipo}:{" "}
                    <a href={l.url} target="_blank" rel="noopener noreferrer">
                      {l.etiqueta}
                    </a>
                    {l.idExterno && <span className="muted"> · {l.idExterno}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {d.historial?.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary>Historial ({d.historial.length})</summary>
              <table className="table" style={{ marginTop: 6 }}>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Estado</th>
                    <th>Motivo</th>
                    <th>RUT operador</th>
                  </tr>
                </thead>
                <tbody>
                  {d.historial.map((h: any, i: number) => (
                    <tr key={i}>
                      <td>{fechaHora(h.fecha ?? h.recibido)}</td>
                      <td>{h.descripcion}</td>
                      <td>{h.motivo ?? "—"}</td>
                      <td>{h.operadorRut ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </>
      )}
    </section>
  );
}
