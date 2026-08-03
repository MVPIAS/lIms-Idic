"use client";

/**
 * Listado de Cotizaciones · Módulo Comercial LIMS IDIC
 * Lista las cotizaciones con su estado. Una cotización aceptada da origen a una OT
 * (columna "OT" enlaza al expediente cuando existe). Cotización ≠ OT.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { clp, fecha } from "@/lib/format";

const API = process.env.NEXT_PUBLIC_API_URL ?? "/api";

type Cot = {
  id: string;
  numero: string;
  cliente: string;
  formato: string;
  estado: "borrador" | "enviada" | "aceptada" | "rechazada" | "expirada" | "vencida" | "anulada";
  total: number;
  otNumero?: string | null;
  fecha: string;
};

const DEMO: Cot[] = [
  { id: "1", numero: "COT-2026-14397", cliente: "FAMAE", formato: "F3", estado: "aceptada", total: 934080, otNumero: "OT-2026-00142", fecha: "2026-06-28" },
  { id: "2", numero: "COT-2026-14402", cliente: "DGMN", formato: "F1", estado: "enviada", total: 412300, otNumero: null, fecha: "2026-07-01" },
  { id: "3", numero: "COT-2026-14410", cliente: "PDI · Lab. Criminalística", formato: "F4", estado: "borrador", total: 1207774, otNumero: null, fecha: "2026-07-03" },
  { id: "4", numero: "COT-2026-14388", cliente: "Aduanas Valparaíso", formato: "F2", estado: "rechazada", total: 288000, otNumero: null, fecha: "2026-06-20" },
];

const ESTADO_PILL: Record<Cot["estado"], string> = {
  borrador: "gray",
  enviada: "blue",
  aceptada: "green",
  rechazada: "red",
  // La API expone "expirada" (common/estados.ts); el legacy la llama "Vencida".
  // Se mapean ambas para no dejar sin color el estado que llega del backend.
  expirada: "amber",
  vencida: "amber",
  anulada: "gray",
};

export default function CotizacionesPage() {
  const [cots, setCots] = useState<Cot[]>(DEMO);
  const [origen, setOrigen] = useState<"api" | "demo">("demo");
  const [filtro, setFiltro] = useState("");
  const [msg, setMsg] = useState<string>("");

  const authHeaders = (): Record<string, string> => {
    const token = typeof window !== "undefined" ? localStorage.getItem("lims_token") : null;
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  };

  function cargar() {
    fetch(`${API}/cotizaciones`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        const arr = Array.isArray(data) ? data : data?.data ?? [];
        if (Array.isArray(arr) && arr.length) {
          setCots(arr.map((c: any): Cot => ({
            id: c.id,
            numero: c.codigo ?? c.numero ?? "—",
            cliente: c.cliente?.razonSocial ?? c.cliente?.nombre ?? (typeof c.cliente === "string" ? c.cliente : "—"),
            formato: c.formato ?? "—",
            estado: c.estado,
            total: Number(c.total ?? 0),
            otNumero: c.ot?.codigo ?? c.otCodigo ?? null,
            fecha: c.fecha ?? c.createdAt ?? c.created_at ?? "",
          })));
          setOrigen("api");
        }
      })
      .catch(() => setOrigen("demo"));
  }
  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function accion(id: string, verbo: "enviar" | "aceptar" | "rechazar") {
    setMsg("");
    try {
      const body = verbo === "rechazar" ? JSON.stringify({ motivo: "Rechazada desde la lista" }) : undefined;
      const r = await fetch(`${API}/cotizaciones/${id}/${verbo}`, { method: "POST", headers: authHeaders(), body });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message ?? `Error ${r.status}`);
      setMsg(verbo === "aceptar" ? `Cotización aceptada · OT generada: ${j.ot?.codigo ?? j.otCodigo ?? "OK"}` : `Cotización ${verbo === "enviar" ? "enviada" : "rechazada"}.`);
      cargar();
    } catch (e: any) {
      setMsg(Array.isArray(e.message) ? e.message.join(", ") : e.message);
    }
  }

  const vis = cots.filter(
    (c) =>
      !filtro ||
      c.cliente.toLowerCase().includes(filtro.toLowerCase()) ||
      c.numero.toLowerCase().includes(filtro.toLowerCase()),
  );

  return (
    <div>
      <h1 className="page">Cotizaciones <span className="tag">≠ OT</span></h1>
      <p className="subtitle">
        Etapa comercial. Una cotización aceptada genera la OT (expediente). En contratos internos no hay cotización.{" "}
        {origen === "demo" && <span style={{ color: "var(--amber)" }}>· Datos de muestra (backend no conectado)</span>}
      </p>

      {msg && <div className="alert info" style={{ marginBottom: 10 }}>{msg}</div>}

      <div className="toolbar">
        <input
          placeholder="Buscar por cliente o N°…"
          style={{ flex: 1 }}
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
        />
        <Link href="/cotizaciones/nueva" className="btn primary sm">＋ Nueva Cotización</Link>
      </div>

      <div className="card card--table">
        <table className="data">
          <thead>
            <tr>
              <th>N° Cotización</th>
              <th>Cliente</th>
              <th>Formato</th>
              <th>Estado</th>
              <th className="num">Total (IVA exento)</th>
              <th>OT generada</th>
              <th>Fecha</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {vis.map((c) => (
              <tr key={c.id}>
                <td><span className="codigo">{c.numero}</span></td>
                <td>{c.cliente}</td>
                <td>{c.formato}</td>
                <td><span className={`pill ${ESTADO_PILL[c.estado]}`}>{c.estado}</span></td>
                <td className="num">{clp(c.total)}</td>
                <td>
                  {c.otNumero ? (
                    <Link href={"/ot" as any} className="codigo" style={{ textDecoration: "underline" }}>
                      {c.otNumero}
                    </Link>
                  ) : (
                    <span style={{ color: "var(--muted)" }}>—</span>
                  )}
                </td>
                <td style={{ color: "var(--muted)" }}>{fecha(c.fecha)}</td>
                <td>
                  {origen === "api" ? (
                    <div style={{ display: "flex", gap: 6 }}>
                      {c.estado === "borrador" && (
                        <button className="btn sm" onClick={() => accion(c.id, "enviar")}>Enviar</button>
                      )}
                      {(c.estado === "borrador" || c.estado === "enviada") && (
                        <>
                          <button className="btn primary sm" onClick={() => accion(c.id, "aceptar")}>Aceptar → OT</button>
                          <button className="btn sm" onClick={() => accion(c.id, "rechazar")}>Rechazar</button>
                        </>
                      )}
                      {["aceptada", "rechazada", "anulada"].includes(c.estado) && (
                        <span style={{ color: "var(--muted)" }}>—</span>
                      )}
                    </div>
                  ) : (
                    <span style={{ color: "var(--muted)" }}>—</span>
                  )}
                </td>
              </tr>
            ))}
            {vis.length === 0 && (
              <tr>
                <td colSpan={8} style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>
                  Sin resultados
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
