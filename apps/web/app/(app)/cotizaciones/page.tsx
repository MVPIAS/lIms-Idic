"use client";

/**
 * Listado de Cotizaciones · Módulo Comercial LIMS IDIC
 * Lista las cotizaciones con su estado. Una cotización aceptada da origen a una OT
 * (columna "OT" enlaza al expediente cuando existe). Cotización ≠ OT.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { clp, fecha } from "@/lib/format";
import DataTable, { type DataColumn } from "@/components/DataTable";

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

  const columns: DataColumn[] = [
    {
      key: "numero",
      label: "N° Cotización",
      value: (c: Cot) => c.numero,
      render: (c: Cot) => <span className="codigo">{c.numero}</span>,
    },
    { key: "cliente", label: "Cliente", value: (c: Cot) => c.cliente },
    { key: "formato", label: "Formato", value: (c: Cot) => c.formato },
    {
      key: "estado",
      label: "Estado",
      value: (c: Cot) => c.estado,
      render: (c: Cot) => <span className={`pill ${ESTADO_PILL[c.estado]}`}>{c.estado}</span>,
    },
    {
      key: "total",
      label: "Total (IVA exento)",
      num: true,
      value: (c: Cot) => c.total,
      render: (c: Cot) => clp(c.total),
    },
    {
      key: "otNumero",
      label: "OT generada",
      value: (c: Cot) => c.otNumero ?? "",
      render: (c: Cot) =>
        c.otNumero ? (
          <Link href={"/ot" as any} className="codigo" style={{ textDecoration: "underline" }}>
            {c.otNumero}
          </Link>
        ) : (
          <span style={{ color: "var(--muted)" }}>—</span>
        ),
    },
    {
      key: "fecha",
      label: "Fecha",
      value: (c: Cot) => c.fecha,
      render: (c: Cot) => <span style={{ color: "var(--muted)" }}>{fecha(c.fecha)}</span>,
    },
  ];

  return (
    <div>
      <h1 className="page">Cotizaciones <span className="tag">≠ OT</span></h1>
      <p className="subtitle">
        Etapa comercial. Una cotización aceptada genera la OT (expediente). En contratos internos no hay cotización.{" "}
        {origen === "demo" && <span style={{ color: "var(--amber)" }}>· Datos de muestra (backend no conectado)</span>}
      </p>

      {msg && <div className="alert info" style={{ marginBottom: 10 }}>{msg}</div>}

      <div className="toolbar" style={{ justifyContent: "flex-end" }}>
        <Link href="/cotizaciones/nueva" className="btn primary sm">＋ Nueva Cotización</Link>
      </div>

      <DataTable
        columns={columns}
        rows={cots}
        searchKeys={["numero", "cliente", "estado"]}
        acciones={(c: Cot) =>
          origen === "api" ? (
            <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
              {c.estado === "borrador" && (
                <button className="btn sm" onClick={() => accion(c.id, "enviar")}>Enviar</button>
              )}
              {c.estado === "enviada" && (
                <button className="btn primary sm" onClick={() => accion(c.id, "aceptar")}>Aceptar → OT</button>
              )}
              {(c.estado === "borrador" || c.estado === "enviada") && (
                <button className="btn sm" onClick={() => accion(c.id, "rechazar")}>Rechazar</button>
              )}
              {["aceptada", "rechazada", "anulada", "expirada", "vencida"].includes(c.estado) && (
                <span style={{ color: "var(--muted)" }}>—</span>
              )}
            </div>
          ) : (
            <span style={{ color: "var(--muted)" }}>—</span>
          )
        }
        vacio={<>Sin resultados</>}
      />
    </div>
  );
}
