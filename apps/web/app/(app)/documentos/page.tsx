"use client";

// ===========================================================================
// Documentos · Buscador global (contrato §4.6.1 / §4.6.2, versión acordada).
// En lugar de un árbol jerárquico de carpetas, una búsqueda global de los
// documentos emitidos (certificados/informes del núcleo + certificados SAEC)
// por título y filtros (tipo, fecha, cliente). Solo lectura: consume
// /api/documentos. El JWT se adjunta desde localStorage (mismo patrón que el
// resto de la app).
// ===========================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { fechaHora } from "@/lib/format";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const auth = () => ({
  Authorization: `Bearer ${localStorage.getItem("lims_token")}`,
  "Content-Type": "application/json",
});

interface Documento {
  origen: "informe" | "saec";
  tipo: string | null;
  codigo: string | null;
  otCodigo: string | null;
  cliente: string | null;
  fecha: string | null;
  estado: string | null;
  hashSha256: string | null;
  codigoVerificacion: string | null;
  urlVerificacion: string | null;
}

interface ClienteRef {
  id: string;
  razonSocial: string;
}

const origenPill = (o: string) =>
  o === "saec" ? <span className="pill teal">SAEC</span> : <span className="pill blue">Informe</span>;

async function getJson(path: string): Promise<any> {
  const res = await fetch(`${API}${path}`, { headers: auth() });
  if (res.status === 401) {
    localStorage.removeItem("lims_token");
    window.location.href = "/login";
    throw new Error("Sesión expirada");
  }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `Error ${res.status}`);
  return res.json();
}

export default function DocumentosPage() {
  const [q, setQ] = useState("");
  const [tipo, setTipo] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [clienteId, setClienteId] = useState("");

  const [clientes, setClientes] = useState<ClienteRef[]>([]);
  const [data, setData] = useState<Documento[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Clientes para el desplegable de filtro (best-effort: si falla, no bloquea).
  useEffect(() => {
    getJson("/clientes?limit=500")
      .then((r) => setClientes((r.data ?? []).map((c: any) => ({ id: c.id, razonSocial: c.razonSocial }))))
      .catch(() => setClientes([]));
  }, []);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (tipo) p.set("tipo", tipo);
    if (desde) p.set("desde", desde);
    if (hasta) p.set("hasta", hasta);
    if (clienteId) p.set("clienteId", clienteId);
    p.set("limit", "100");
    return p.toString();
  }, [q, tipo, desde, hasta, clienteId]);

  const buscar = useCallback(() => {
    setLoading(true);
    setError("");
    getJson(`/documentos?${query}`)
      .then((r) => {
        setData(r.data ?? []);
        setTotal(r.meta?.total ?? 0);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [query]);

  // Búsqueda reactiva con un pequeño debounce sobre el texto/filtros.
  useEffect(() => {
    const t = setTimeout(buscar, 300);
    return () => clearTimeout(t);
  }, [buscar]);

  const limpiar = () => {
    setQ("");
    setTipo("");
    setDesde("");
    setHasta("");
    setClienteId("");
  };

  const hayFiltros = q || tipo || desde || hasta || clienteId;

  return (
    <div>
      <h1 className="page">Buscador de documentos</h1>
      <p className="subtitle">
        Búsqueda global de los documentos emitidos por el sistema (certificados e informes de las OT y
        certificados del SAEC) por título y filtros (§4.6.1 / §4.6.2). Solo lectura.
      </p>

      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="field" style={{ margin: 0, flex: "1 1 240px", minWidth: 200 }}>
            <label>Buscar</label>
            <input
              type="text"
              placeholder="Código de documento, OT, cliente o código de verificación…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Tipo</label>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="">Todos</option>
              <option value="informe">Informe / Certificado</option>
              <option value="saec">SAEC (evidencia)</option>
            </select>
          </div>
          <div className="field" style={{ margin: 0, minWidth: 180 }}>
            <label>Cliente</label>
            <select value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
              <option value="">Todos</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.razonSocial}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Desde</label>
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Hasta</label>
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </div>
          {hayFiltros && (
            <button className="btn outline sm" onClick={limpiar}>
              Limpiar
            </button>
          )}
        </div>
      </div>

      {error && <div className="alert warn">{error}</div>}

      <div className="card card--table">
        <table className="data">
          <thead>
            <tr>
              <th>Origen</th>
              <th>Código</th>
              <th>Tipo</th>
              <th>OT</th>
              <th>Cliente</th>
              <th>Emisión</th>
              <th>Estado</th>
              <th>Verificación</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={`${d.origen}-${d.codigo}-${i}`}>
                <td>{origenPill(d.origen)}</td>
                <td>
                  <span className="codigo">{d.codigo ?? "—"}</span>
                </td>
                <td>{d.tipo ? <span className="tag">{d.tipo}</span> : "—"}</td>
                <td>{d.otCodigo ? <span className="codigo">{d.otCodigo}</span> : "—"}</td>
                <td>{d.cliente ?? "—"}</td>
                <td>{fechaHora(d.fecha)}</td>
                <td>
                  <span className={`pill ${d.estado === "anulado" ? "red" : "green"}`}>
                    {d.estado ?? "emitido"}
                  </span>
                </td>
                <td>
                  {d.urlVerificacion ? (
                    <a className="btn outline sm" href={d.urlVerificacion} target="_blank" rel="noreferrer">
                      Verificar
                    </a>
                  ) : d.codigoVerificacion ? (
                    <span className="tag" title="Código de verificación imprimible">
                      {d.codigoVerificacion}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
            {!loading && data.length === 0 && (
              <tr>
                <td colSpan={8} style={{ textAlign: "center", color: "var(--muted)", padding: 22 }}>
                  {hayFiltros ? "No hay documentos que coincidan con los filtros." : "No hay documentos emitidos."}
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan={8} style={{ textAlign: "center", color: "var(--muted)", padding: 22 }}>
                  Cargando…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {total > 0 && (
        <p className="subtitle" style={{ marginTop: 8 }}>
          {data.length} de {total} documento{total === 1 ? "" : "s"}
          {total > data.length ? " (refine los filtros para ver más)" : ""}.
        </p>
      )}
    </div>
  );
}
