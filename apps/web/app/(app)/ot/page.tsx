"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fecha } from "@/lib/format";
import DataTable, { type DataColumn } from "@/components/DataTable";
import { ORIGEN_LABEL } from "../cotizaciones/_components/comercial";
import SemaforoPlazo from "@/components/documentos/SemaforoPlazo";
import { SEMAFORO, semaforoDe } from "@/lib/documentos";

/**
 * Origen de la OT (Comercial R2) + marcas «OPI pendiente» y «Sin cobro».
 * `origenTrabajo` guarda un código (COTIZACION, INTERNACION, DISPOSICION,
 * INTERLABORATORIO, OT_INTERNA); las OT heredadas pueden traer texto libre.
 */
const origenBadges = (r: any) => (
  <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
    {r.origenTrabajo ? (
      <span className={ORIGEN_LABEL[r.origenTrabajo] ? "pill teal" : ""} title={r.origenTrabajo}>
        {ORIGEN_LABEL[r.origenTrabajo] ?? r.origenTrabajo}
      </span>
    ) : (
      <span style={{ color: "var(--muted)" }}>—</span>
    )}
    {r.opiPendiente && <span className="pill amber" title="Disposición del Director con cobro: falta registrar la OPI">OPI pendiente</span>}
    {r.conCobro === false && <span className="pill gray" title="OT sin cobro: registra horas y costo">Sin cobro</span>}
  </span>
);

const API = process.env.NEXT_PUBLIC_API_URL || "/api";

const estadoBadge = (e: string) => {
  const map: Record<string, string> = {
    borrador: "gray",
    en_proceso: "blue",
    en_analisis: "amber",
    finalizada: "green",
    cerrada: "green",
    anulada: "red",
  };
  return <span className={`pill ${map[e] ?? "gray"}`}>{e ?? "—"}</span>;
};

// Indicador de flujo (BPM) activo: estado de la instancia + paso actual.
const flujoBadge = (f: any) => {
  if (!f) return <span className="pill gray">sin flujo</span>;
  const color = f.estado === "completado" ? "green" : f.estado === "cancelado" ? "red" : "blue";
  const paso = f.pasoActual;
  return (
    <span title={paso ? `${paso.tipo} · ${paso.actividad}` : f.estado}>
      <span className={`pill ${color}`}>{f.estado}</span>
      {paso ? <small style={{ marginLeft: 6, color: "var(--muted)" }}>#{paso.numero} {paso.actividad}</small> : null}
    </span>
  );
};

const codigoDe = (r: any) => r.codigo ?? r.numero ?? r.id?.slice(0, 8) ?? "";

export default function OtPage() {
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  // Frente B · filtros de plazo que llegan desde Mi bandeja (?semaforo=vencida|por_vencer,
  // ?listasCierre=1, &unidad=COD): se sirven desde GET /ot/plazos (mismos cortes que la bandeja).
  const [filtroPlazo, setFiltroPlazo] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const q = new URLSearchParams(window.location.search);
        const fp = new URLSearchParams();
        for (const k of ["semaforo", "listasCierre", "unidad"]) if (q.get(k)) fp.set(k, q.get(k)!);
        const filtro = fp.toString();
        setFiltroPlazo(filtro);
        const res = await fetch(filtro ? `${API}/ot/plazos?${filtro}` : `${API}/ot`, {
          headers: { Authorization: `Bearer ${localStorage.getItem("lims_token")}` },
        });
        if (!res.ok) throw new Error(`Error ${res.status}`);
        const data = await res.json();
        setRows(Array.isArray(data) ? data : data.data ?? []);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const columns: DataColumn[] = [
    {
      key: "codigo", label: "Código OT",
      value: (r) => codigoDe(r),
      render: (r) => (
        <Link href={`/ot/${r.id}` as any} className="codigo" style={{ textDecoration: "underline" }}
          onClick={(e) => e.stopPropagation()}>{codigoDe(r)}</Link>
      ),
    },
    { key: "cliente", label: "Cliente", value: (r) => r.cliente?.razonSocial ?? "", render: (r) => r.cliente?.razonSocial ?? "—" },
    { key: "fechaIngreso", label: "Ingreso", value: (r) => r.fechaIngreso ?? r.createdAt ?? "", render: (r) => fecha(r.fechaIngreso ?? r.createdAt) },
    { key: "prioridad", label: "Prioridad", value: (r) => r.prioridad ?? "normal", render: (r) => r.prioridad ?? "normal" },
    { key: "estado", label: "Estado", value: (r) => r.estado ?? "", render: (r) => estadoBadge(r.estado) },
    { key: "origen", label: "Origen", value: (r) => `${r.origenTrabajo ?? ""} ${r.opiPendiente ? "OPI pendiente" : ""} ${r.conCobro === false ? "Sin cobro" : ""}`, render: (r) => origenBadges(r) },
    { key: "flujo", label: "Flujo", sortable: false, filter: false, value: (r) => r.flujo?.estado ?? "", render: (r) => flujoBadge(r.flujo) },
    {
      key: "plazo", label: "Plazo",
      value: (r) => SEMAFORO[semaforoDe(r.fechaCompromiso, r.estado).semaforo]?.texto ?? "",
      render: (r) => <SemaforoPlazo fechaCompromiso={r.fechaCompromiso} estado={r.estado} />,
    },
  ];
  const textoFiltro = (() => {
    const q = new URLSearchParams(filtroPlazo);
    const partes = [
      q.get("semaforo") ? ({ vencida: "OT vencidas", por_vencer: "OT por vencer", en_plazo: "OT en plazo", sin_fecha: "OT sin fecha de compromiso" } as Record<string, string>)[q.get("semaforo")!] ?? "" : "",
      q.get("listasCierre") ? "OT listas para cerrar" : "",
      q.get("unidad") ? `laboratorio ${q.get("unidad")}` : "",
    ].filter(Boolean);
    return partes.join(" · ");
  })();

  return (
    <div>
      <h1 className="page">Expedientes / Órdenes de Trabajo</h1>
      <p className="subtitle">
        Expediente por OT: recepción de muestras → análisis → resultados → informe/certificado. Núcleo del LIMS.
      </p>
      {error && <div className="alert warn">{error}</div>}
      {filtroPlazo && (
        <div className="alert info">
          Mostrando: <b>{textoFiltro}</b> ({rows.length}) · <a href="/ot" style={{ color: "var(--accent)" }}>Quitar filtro</a>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        searchKeys={["codigo", "cliente", "estado"]}
        onRowClick={(r) => router.push(`/ot/${r.id}` as any)}
        vacio="Sin órdenes de trabajo todavía. Se generan al aceptar una cotización."
      />
    </div>
  );
}
