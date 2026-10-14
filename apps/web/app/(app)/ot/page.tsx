"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fecha, fechaDia } from "@/lib/format";
import DataTable, { type DataColumn } from "@/components/DataTable";
import { ORIGEN_LABEL } from "../cotizaciones/_components/comercial";
import { llamar, qs, type Paginado, type Unidad } from "@/lib/laboratorio";

/**
 * Lista de OT con búsqueda, filtros y paginación EN EL SERVIDOR (antes: las 50
 * más recientes filtradas en el navegador). Los filtros viajan en la dirección
 * (?mias=1, ?unidad=LQC, ?vencidas=1…), así las tarjetas de Mi bandeja abren
 * la lista ya filtrada.
 */

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

/** Atajos de filtro. Cada uno equivale a parámetros de GET /ot. */
type Atajo = "todas" | "abiertas" | "mias" | "sinAsignar" | "vencidas" | "porVencer" | "sinLaboratorio";
const ATAJOS: { k: Atajo; l: string; titulo: string }[] = [
  { k: "todas", l: "Todas", titulo: "Todas las OT de su alcance" },
  { k: "abiertas", l: "Abiertas", titulo: "OT no cerradas, anuladas, finalizadas ni informadas" },
  { k: "mias", l: "Mis OT", titulo: "OT en las que usted figura como analista (de la OT o de un ensayo)" },
  { k: "sinAsignar", l: "Sin analista", titulo: "OT abiertas a las que aún no se asignó analista" },
  { k: "vencidas", l: "Vencidas", titulo: "OT abiertas con fecha de compromiso vencida" },
  { k: "porVencer", l: "Por vencer", titulo: "OT que vencen en los próximos 3 días" },
  { k: "sinLaboratorio", l: "Sin laboratorio", titulo: "OT sin laboratorio responsable (nadie del laboratorio las ve)" },
];

interface Filtros {
  atajo: Atajo;
  unidad: string;
  q: string;
  page: number;
}

/** Filtros desde la dirección (?mias=1&estado=abiertas&unidad=LQC…). */
function filtrosDesdeUrl(): Filtros {
  const p = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const atajo: Atajo =
    p.get("mias") === "1" ? "mias"
    : p.get("sinAsignar") === "1" ? "sinAsignar"
    : p.get("vencidas") === "1" ? "vencidas"
    : p.get("porVencer") === "1" ? "porVencer"
    : p.get("sinLaboratorio") === "1" ? "sinLaboratorio"
    : p.get("estado") === "abiertas" ? "abiertas"
    : "todas";
  return { atajo, unidad: p.get("unidad") ?? "", q: p.get("q") ?? "", page: Number(p.get("page")) || 1 };
}

function parametros(f: Filtros, limit: number) {
  return {
    q: f.q.trim(),
    unidad: f.unidad,
    page: f.page,
    limit,
    mias: f.atajo === "mias",
    sinAsignar: f.atajo === "sinAsignar",
    vencidas: f.atajo === "vencidas",
    porVencer: f.atajo === "porVencer",
    sinLaboratorio: f.atajo === "sinLaboratorio",
    // «Mis OT» y «Sin analista» se refieren a trabajo pendiente.
    estado: ["abiertas", "mias", "sinAsignar"].includes(f.atajo) ? "abiertas" : "",
  };
}

export default function OtPage() {
  const router = useRouter();
  const [filtros, setFiltros] = useState<Filtros | null>(null);
  const [buscar, setBuscar] = useState("");
  const [res, setRes] = useState<Paginado<any> | null>(null);
  const [labs, setLabs] = useState<Unidad[]>([]);
  const [limit, setLimit] = useState(20);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const f = filtrosDesdeUrl();
    setFiltros(f);
    setBuscar(f.q);
    llamar<Unidad[]>("GET", "/ot/laboratorios").then(setLabs).catch(() => setLabs([]));
  }, []);

  const cargar = useCallback(async (f: Filtros, lim: number) => {
    setLoading(true);
    try {
      const p = parametros(f, lim);
      const r = await llamar<Paginado<any>>("GET", `/ot${qs(p)}`);
      setRes(r);
      setError("");
      // La dirección refleja el filtro (se puede compartir o volver atrás).
      window.history.replaceState(null, "", `/ot${qs({ ...p, limit: undefined, page: f.page > 1 ? f.page : undefined })}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (filtros) cargar(filtros, limit);
  }, [filtros, limit, cargar]);

  // Búsqueda con espera breve para no consultar en cada tecla.
  useEffect(() => {
    if (!filtros || buscar === filtros.q) return;
    const t = setTimeout(() => setFiltros((f) => (f ? { ...f, q: buscar, page: 1 } : f)), 350);
    return () => clearTimeout(t);
  }, [buscar, filtros]);

  const columns: DataColumn[] = [
    {
      key: "codigo", label: "Código OT",
      value: (r) => codigoDe(r),
      render: (r) => (
        <Link href={`/ot/${r.id}` as any} className="codigo" style={{ textDecoration: "underline" }}
          onClick={(e) => e.stopPropagation()}>{codigoDe(r)}</Link>
      ),
    },
    {
      key: "laboratorio", label: "Laboratorio",
      value: (r) => r.unidad?.codigo ?? "",
      render: (r) => r.unidad
        ? <span className="pill teal" title={r.unidad.nombre}>{r.unidad.codigo}</span>
        : <span className="pill amber" title="Sin laboratorio responsable: ningún laboratorio la ve">Sin laboratorio</span>,
    },
    { key: "cliente", label: "Cliente", value: (r) => r.cliente?.razonSocial ?? "", render: (r) => r.cliente?.razonSocial ?? "—" },
    {
      key: "analistas", label: "Analistas", sortable: false,
      value: (r) => (r.analistas ?? []).map((a: any) => a.nombre).join(", "),
      render: (r) => (r.analistas?.length
        ? <span title={r.analistas.map((a: any) => a.nombre).join(", ")}>{r.analistas.map((a: any) => a.nombre.split(" ")[0]).join(", ")}</span>
        : <span style={{ color: "var(--muted)" }}>—</span>),
    },
    { key: "fechaIngreso", label: "Ingreso", value: (r) => r.fechaRecepcion ?? r.createdAt ?? "", render: (r) => fecha(r.fechaRecepcion ?? r.createdAt) },
    {
      key: "compromiso", label: "Compromiso", value: (r) => r.fechaCompromiso ?? "",
      render: (r) => {
        if (!r.fechaCompromiso) return <span style={{ color: "var(--muted)" }}>—</span>;
        const vencida = new Date(r.fechaCompromiso) < new Date(new Date().toISOString().slice(0, 10)) && !["cerrada", "anulada", "finalizada", "informada"].includes(r.estado);
        return <span className={vencida ? "pill red" : ""}>{fechaDia(r.fechaCompromiso)}</span>;
      },
    },
    { key: "prioridad", label: "Prioridad", value: (r) => r.prioridad ?? "normal", render: (r) => r.prioridad ?? "normal" },
    { key: "estado", label: "Estado", value: (r) => r.estado ?? "", render: (r) => estadoBadge(r.estado) },
    { key: "origen", label: "Origen", value: (r) => `${r.origenTrabajo ?? ""} ${r.opiPendiente ? "OPI pendiente" : ""} ${r.conCobro === false ? "Sin cobro" : ""}`, render: (r) => origenBadges(r) },
    { key: "flujo", label: "Flujo", sortable: false, filter: false, value: (r) => r.flujo?.estado ?? "", render: (r) => flujoBadge(r.flujo) },
  ];

  const meta = res?.meta;
  const cambiar = (parcial: Partial<Filtros>) => setFiltros((f) => (f ? { ...f, page: 1, ...parcial } : f));

  return (
    <div>
      <h1 className="page">Expedientes / Órdenes de Trabajo</h1>
      <p className="subtitle">
        Expediente por OT: recepción de muestras → asignación → análisis → revisión y aprobación → informe/certificado.
        La búsqueda recorre todas las OT de su alcance, no solo las recientes.
      </p>
      {error && <div className="alert warn">{error}</div>}

      <div className="toolbar" style={{ gap: 6 }}>
        {ATAJOS.map((a) => (
          <button key={a.k} title={a.titulo}
            className={`btn sm ${filtros?.atajo === a.k ? "primary" : "outline"}`}
            onClick={() => cambiar({ atajo: a.k })}>
            {a.l}
          </button>
        ))}
      </div>
      <div className="toolbar">
        <input
          placeholder="Buscar por código de OT, N° de cotización, resolución, OC, cliente o laboratorio…"
          style={{ flex: 1, minWidth: 240 }}
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
          aria-label="Buscar órdenes de trabajo"
        />
        <select value={filtros?.unidad ?? ""} onChange={(e) => cambiar({ unidad: e.target.value })} aria-label="Laboratorio">
          <option value="">Todos los laboratorios</option>
          {labs.map((u) => <option key={u.id} value={u.codigo}>{u.codigo} · {u.nombre}</option>)}
        </select>
      </div>

      <DataTable
        columns={columns}
        rows={res?.data ?? []}
        loading={loading}
        headerSearch={false}
        paginate={false}
        onRowClick={(r) => router.push(`/ot/${r.id}` as any)}
        vacio="No hay órdenes de trabajo para este filtro."
      />

      {meta && (
        <div className="toolbar" style={{ marginTop: 8 }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {meta.total === 0 ? "Sin resultados" : `${(meta.page - 1) * meta.limit + 1}–${Math.min(meta.page * meta.limit, meta.total)} de ${meta.total} OT`}
          </span>
          <div className="spacer" />
          <select value={limit} onChange={(e) => { setLimit(Number(e.target.value)); cambiar({}); }} aria-label="Filas por página">
            {[20, 50, 100].map((n) => <option key={n} value={n}>{n} por página</option>)}
          </select>
          <button className="btn outline sm" disabled={meta.page <= 1} onClick={() => setFiltros((f) => (f ? { ...f, page: f.page - 1 } : f))}>← Anterior</button>
          <span style={{ fontSize: 12 }}>Página {meta.page} de {meta.totalPages}</span>
          <button className="btn outline sm" disabled={meta.page >= meta.totalPages} onClick={() => setFiltros((f) => (f ? { ...f, page: f.page + 1 } : f))}>Siguiente →</button>
        </div>
      )}
    </div>
  );
}
