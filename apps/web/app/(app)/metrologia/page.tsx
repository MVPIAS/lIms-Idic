"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fechaHora } from "@/lib/format";
import { fmtG } from "@/lib/metrologia";
import DataTable, { type DataColumn } from "@/components/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { confirmar, toast } from "@/components/ui/feedback";
import { usePermisos } from "@/lib/permisos";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("lims_token")}`, "Content-Type": "application/json" });

const ESTADO: Record<string, { label: string; pill: string }> = {
  borrador: { label: "Borrador", pill: "gray" },
  en_revision: { label: "En revisión", pill: "blue" },
  emitida: { label: "Emitida", pill: "green" },
};
const FILTROS: [string, string][] = [["", "Todas"], ["borrador", "Borradores"], ["en_revision", "En revisión"], ["emitida", "Emitidas"]];
const fecha = (x?: string | null) => (x ? new Date(x).toLocaleDateString("es-CL", { timeZone: "UTC" }) : "—");

export default function MetrologiaCalibracionesPage() {
  const { puede } = usePermisos();
  const [rows, setRows] = useState<any[]>([]);
  const [estado, setEstado] = useState("");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [devolver, setDevolver] = useState<{ row: any; motivo: string } | null>(null);
  const [ocupado, setOcupado] = useState("");

  async function cargar() {
    setCargando(true);
    try {
      const r = await fetch(`${API}/metrologia/calibraciones?limit=300${estado ? `&estado=${estado}` : ""}`, { headers: auth() });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message ?? `Error ${r.status}`);
      setRows(j.data ?? []); setError("");
    } catch (e: any) { setError(e.message); }
    finally { setCargando(false); }
  }
  useEffect(() => { cargar(); }, [estado]); // eslint-disable-line react-hooks/exhaustive-deps

  // El PDF va protegido con JWT: se descarga con el token y se abre como blob.
  async function verCertificado(id: string) {
    setError("");
    try {
      const res = await fetch(`${API}/metrologia/calibraciones/${id}/pdf`, { headers: { Authorization: `Bearer ${localStorage.getItem("lims_token")}` } });
      if (!res.ok) throw new Error(`No se pudo generar el certificado (${res.status})`);
      window.open(URL.createObjectURL(await res.blob()), "_blank");
    } catch (e: any) { setError(e.message); }
  }

  async function accion(row: any, que: "enviar" | "emitir" | "devolver", body?: any) {
    setOcupado(row.id + que);
    try {
      const r = await fetch(`${API}/metrologia/calibraciones/${row.id}/${que}`, { method: "POST", headers: auth(), body: body ? JSON.stringify(body) : undefined });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(Array.isArray(j.message) ? j.message.join(", ") : j.message ?? `Error ${r.status}`);
      toast.ok(que === "enviar" ? `${row.codigo} enviada a revisión` : que === "emitir" ? `Certificado ${row.codigo} emitido` : `${row.codigo} devuelta al metrólogo`);
      setDevolver(null);
      await cargar();
    } catch (e: any) { toast.error(e.message); }
    finally { setOcupado(""); }
  }

  async function emitir(row: any) {
    const ok = await confirmar({
      titulo: `¿Emitir el certificado ${row.codigo}?`,
      mensaje: "Revise antes el certificado en borrador. Al emitirlo queda sellado con su código de verificación y ya no se puede modificar.",
      confirmarTexto: "Emitir certificado",
    });
    if (ok) accion(row, "emitir");
  }
  async function enviar(row: any) {
    const ok = await confirmar({
      titulo: `¿Enviar ${row.codigo} a revisión?`,
      mensaje: "Con el envío firma lo elaborado. El jefe del laboratorio la revisará y la emitirá o se la devolverá con observaciones.",
      confirmarTexto: "Enviar a revisión",
    });
    if (ok) accion(row, "enviar");
  }

  const pendientes = useMemo(() => rows.filter((r) => (r.acciones ?? []).includes("EMITIR")).length, [rows]);

  const columns: DataColumn[] = [
    { key: "codigo", label: "Código", value: (c) => c.codigo ?? "", render: (c) => <span className="codigo">{c.codigo}</span> },
    { key: "laboratorio", label: "Lab.", value: (c) => c.laboratorio ?? "", render: (c) => c.laboratorio ?? "—" },
    { key: "proceso", label: "Proceso", value: (c) => `${c.proceso ?? ""} ${c.proceso_nombre ?? ""}`.trim(), render: (c) => <>{c.proceso} · {c.proceso_nombre}</> },
    { key: "instrumento", label: "Instrumento", value: (c) => c.instrumento ?? "", render: (c) => c.instrumento ?? "—" },
    { key: "cliente", label: "Cliente", value: (c) => c.cliente ?? "", render: (c) => c.cliente ?? "—" },
    { key: "u_max", label: "U informada (k=2)", num: true, value: (c) => c.u_cert ?? c.u_max, render: (c) => (c.u_cert ?? c.u_max) == null ? "—" : <>± {fmtG(c.u_cert ?? c.u_max)} {c.unidad_u}</> },
    { key: "conforme", label: "Conforme", value: (c) => (c.conforme == null ? "" : c.conforme ? "Sí" : "No"), render: (c) => (c.conforme == null ? "—" : c.conforme ? <span className="pill green">Sí</span> : <span className="pill red">No</span>) },
    {
      key: "estado", label: "Estado", value: (c) => ESTADO[c.estado]?.label ?? c.estado,
      render: (c) => (
        <span title={c.devuelto_motivo ? `Devuelta: ${c.devuelto_motivo}` : undefined}>
          <span className={`pill ${ESTADO[c.estado]?.pill ?? "gray"}`}>{ESTADO[c.estado]?.label ?? c.estado}</span>
          {c.estado === "borrador" && c.devuelto_motivo && <span className="pill amber" style={{ marginLeft: 4 }}>Devuelta</span>}
        </span>
      ),
    },
    { key: "fecha_calibracion", label: "Fecha calibración", value: (c) => c.fecha_calibracion ?? "", render: (c) => <span style={{ whiteSpace: "nowrap" }}>{fecha(c.fecha_calibracion)}</span> },
    { key: "autor_nombre", label: "Elaborada por", value: (c) => c.autor_nombre ?? "", render: (c) => c.autor_nombre ?? "—" },
    { key: "emitido_at", label: "Emitida", value: (c) => c.emitido_at ?? "", render: (c) => (c.emitido_at ? <span style={{ whiteSpace: "nowrap" }}>{fechaHora(c.emitido_at)}</span> : "—") },
  ];

  return (
    <div>
      <PageHeader
        titulo="Metrología · Calibraciones"
        subtitulo={<>Calibraciones de la Sección Metrología (LMT, área eléctrica y Laboratorio Nacional de Fuerza). El metrólogo guarda la
          calibración como borrador y la envía a revisión; el jefe del laboratorio la revisa y emite el Certificado de Calibración,
          que queda sellado con HASH SHA-256, o la devuelve con sus observaciones.</>}
        acciones={
          <div style={{ display: "flex", gap: 8 }}>
            {puede("metrologia.crear") && <Link className="btn primary sm" href={"/metrologia/nueva" as any}>＋ Nueva calibración</Link>}
            {puede("metrologia.config") && <Link className="btn sm" href={"/metrologia/config" as any}>Configuración</Link>}
          </div>
        }
      />
      {error && <div className="alert warn">{error}</div>}
      {pendientes > 0 && (
        <div className="alert info" style={{ marginBottom: 10 }}>
          Tiene <b>{pendientes}</b> calibración(es) enviada(s) a revisión que puede emitir o devolver.
        </div>
      )}

      <div className="toolbar" style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        {FILTROS.map(([v, l]) => (
          <button key={v} className={`btn sm${estado === v ? " primary" : ""}`} onClick={() => setEstado(v)}>{l}</button>
        ))}
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        loading={cargando}
        searchKeys={["codigo", "instrumento", "cliente", "proceso"]}
        acciones={(c) => {
          const a: string[] = c.acciones ?? [];
          return (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              <button className="btn sm" onClick={() => verCertificado(c.id)}>{c.estado === "emitida" ? "Certificado" : "Ver borrador"}</button>
              {a.includes("EDITAR") && <Link className="btn sm" href={`/metrologia/nueva?id=${c.id}` as any}>Editar</Link>}
              {a.includes("ENVIAR") && <button className="btn sm primary" disabled={!!ocupado} onClick={() => enviar(c)}>Enviar a revisión</button>}
              {a.includes("DEVOLVER") && <button className="btn sm" disabled={!!ocupado} onClick={() => setDevolver({ row: c, motivo: "" })}>Devolver</button>}
              {a.includes("EMITIR") && <button className="btn sm primary" disabled={!!ocupado} onClick={() => emitir(c)}>Emitir</button>}
            </div>
          );
        }}
        vacio={<>No hay calibraciones{estado ? " en este estado" : ""}.</>}
      />

      {devolver && (
        <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "grid", placeItems: "center", zIndex: 50 }}>
          <div className="card" style={{ width: "min(520px, 92vw)", padding: 18 }}>
            <h3 style={{ marginTop: 0 }}>Devolver {devolver.row.codigo} al metrólogo</h3>
            <p style={{ fontSize: 13, color: "var(--muted)" }}>Indique qué debe corregir. El motivo queda registrado y la calibración vuelve a borrador.</p>
            <textarea
              autoFocus rows={4} style={{ width: "100%" }} value={devolver.motivo}
              onChange={(e) => setDevolver({ ...devolver, motivo: e.target.value })}
              placeholder="Motivo de la devolución"
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
              <button className="btn sm" onClick={() => setDevolver(null)}>Cancelar</button>
              <button className="btn sm primary" disabled={devolver.motivo.trim().length < 5 || !!ocupado}
                onClick={() => accion(devolver.row, "devolver", { motivo: devolver.motivo.trim() })}>Devolver</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
