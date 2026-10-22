"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fechaHora } from "@/lib/format";
import { fmtG } from "@/lib/metrologia";
import DataTable, { type DataColumn } from "@/components/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { confirmar, toast } from "@/components/ui/feedback";
import { usePermisos } from "@/lib/permisos";
import { ORIGEN_OT } from "@/lib/metrologiaOt";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("lims_token")}`, "Content-Type": "application/json" });

const ESTADO: Record<string, { label: string; pill: string }> = {
  borrador: { label: "Borrador", pill: "gray" },
  en_revision: { label: "Con el jefe del laboratorio", pill: "blue" },
  en_firma: { label: "Con el jefe del departamento", pill: "blue" },
  emitida: { label: "Emitida", pill: "green" },
  reemplazada: { label: "Reemplazada", pill: "amber" },
};
const MAGNITUD: Record<string, string> = {
  masa: "Masa", presion: "Presión", longitud: "Longitud", volumen: "Volumen", fuerza: "Fuerza", par: "Par torsional",
  temperatura: "Temperatura", electrica: "Eléctrica", tiempo: "Tiempo y frecuencia", general: "Otra",
};
const FILTROS: [string, string][] = [["", "Todas"], ["borrador", "Borradores"], ["en_revision", "En firma"], ["emitida", "Emitidas"], ["reemplazada", "Reemplazadas"]];
/** Filtros que abren las tarjetas de «Mi bandeja» de Metrología (?pendiente=…). */
const PENDIENTE: Record<string, { texto: string; f: (c: any) => boolean }> = {
  enviar: { texto: "Por enviar (borradores suyos)", f: (c) => (c.acciones ?? []).includes("ENVIAR") && !c.devuelto_motivo },
  devueltas: { texto: "Devueltas al metrólogo", f: (c) => c.es_mio && c.estado === "borrador" && !!c.devuelto_motivo },
  revisar: { texto: "Por revisar (le toca a usted)", f: (c) => (c.acciones ?? []).includes("FIRMAR") },
  emitir: { texto: "Por firmar y emitir (le toca a usted)", f: (c) => (c.acciones ?? []).includes("EMITIR") },
  entregar: { texto: "Emitidos sin entrega registrada", f: (c) => c.estado === "emitida" && !c.entregado_at && !!c.ot_id },
};
const fecha = (x?: string | null) => (x ? new Date(x).toLocaleDateString("es-CL", { timeZone: "UTC" }) : "—");

export default function MetrologiaCalibracionesPage() {
  const { puede } = usePermisos();
  const [rows, setRows] = useState<any[]>([]);
  const [estado, setEstado] = useState("");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [devolver, setDevolver] = useState<{ row: any; motivo: string; que: "devolver" | "reemitir" } | null>(null);
  const [ocupado, setOcupado] = useState("");
  const [pendiente, setPendiente] = useState("");
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("pendiente") ?? "";
    if (PENDIENTE[p]) setPendiente(p);
  }, []);
  const filas = useMemo(() => (pendiente && PENDIENTE[pendiente] ? rows.filter(PENDIENTE[pendiente].f) : rows), [rows, pendiente]);

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

  async function accion(row: any, que: "enviar" | "firmar" | "devolver" | "reemitir", body?: any) {
    setOcupado(row.id + que);
    try {
      const r = await fetch(`${API}/metrologia/calibraciones/${row.id}/${que}`, { method: "POST", headers: auth(), body: body ? JSON.stringify(body) : undefined });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(Array.isArray(j.message) ? j.message.join(", ") : j.message ?? `Error ${r.status}`);
      toast.ok(que === "enviar" ? `${row.codigo} firmada y enviada al jefe del laboratorio`
        : que === "firmar" ? (j.data?.numero ? `Certificado ${j.data.numero} emitido` : `${row.codigo} firmada; pasa al jefe del departamento`)
        : que === "reemitir" ? `Borrador ${j.data?.codigo} creado: al emitirse reemplazará al ${row.numero_certificado}`
        : `${row.codigo} devuelta al metrólogo`);
      setDevolver(null);
      await cargar();
    } catch (e: any) { toast.error(e.message); }
    finally { setOcupado(""); }
  }

  async function firmar(row: any, emite: boolean) {
    const ok = await confirmar({
      titulo: emite ? `¿Firmar y emitir el certificado de ${row.codigo}?` : `¿Revisar y firmar ${row.codigo}?`,
      mensaje: emite
        ? "Revise antes el certificado en borrador. Al emitirlo recibe su número, queda sellado con su código de verificación y ya no se puede modificar (solo reemitir)."
        : "Con su firma la calibración pasa al jefe del departamento, que la firma y emite el certificado.",
      confirmarTexto: emite ? "Firmar y emitir" : "Firmar",
    });
    if (ok) accion(row, "firmar");
  }
  async function enviar(row: any) {
    const ok = await confirmar({
      titulo: `¿Firmar y enviar ${row.codigo}?`,
      mensaje: "Con el envío firma lo elaborado como metrólogo. El jefe del laboratorio (o su subrogante) la revisará y la firmará o se la devolverá con observaciones.",
      confirmarTexto: "Firmar y enviar",
    });
    if (ok) accion(row, "enviar");
  }

  const pendientes = useMemo(() => rows.filter((r) => (r.acciones ?? []).some((a: string) => a === "EMITIR" || a === "FIRMAR")).length, [rows]);

  const columns: DataColumn[] = [
    {
      key: "numero_certificado", label: "Certificado", value: (c) => `${c.numero_certificado ?? ""} ${c.codigo ?? ""}`,
      render: (c) => (
        <Link href={`/metrologia/${c.id}` as any} style={{ color: "inherit", textDecoration: "none" }}>
          {c.numero_certificado ? <b className="codigo">{c.numero_certificado}</b> : <span style={{ color: "var(--muted)" }}>Sin emitir</span>}
          <span className="codigo" style={{ display: "block", fontSize: 11, color: "var(--accent)", whiteSpace: "nowrap" }}>{c.codigo}</span>
        </Link>
      ),
    },
    {
      key: "ot_codigo", label: "OT · ítem", value: (c) => c.ot_codigo ?? "",
      render: (c) => (c.ot_id
        ? <><Link href={`/ot/${c.ot_id}` as any} className="codigo" style={{ color: "var(--accent)", whiteSpace: "nowrap" }}>{c.ot_codigo}</Link>{c.instrumento_numero ? ` · ${c.instrumento_numero}` : ""}
            {c.origen && <span style={{ display: "block", fontSize: 11, color: "var(--muted)" }}>{ORIGEN_OT[c.origen] ?? c.origen}</span>}</>
        : <span style={{ color: "var(--muted)" }} title="Calibración anterior a la OT ligada (OT en texto)">Sin OT ligada</span>),
    },
    {
      key: "instrumento", label: "Instrumento · proceso", value: (c) => `${c.instrumento ?? ""} ${c.proceso ?? ""} ${c.proceso_nombre ?? ""} ${c.laboratorio ?? ""}`,
      render: (c) => <>{c.instrumento ?? "—"}<span style={{ display: "block", fontSize: 11, color: "var(--muted)" }} title={c.proceso_nombre}>{c.laboratorio ? `${c.laboratorio} · ` : ""}{c.proceso}</span></>,
    },
    { key: "magnitud", label: "Magnitud", value: (c) => MAGNITUD[c.magnitud] ?? c.magnitud ?? "", render: (c) => MAGNITUD[c.magnitud] ?? c.magnitud ?? "—" },
    { key: "cliente", label: "Cliente", value: (c) => c.cliente ?? "", render: (c) => c.cliente ?? "—" },
    { key: "u_max", label: "U certificada (k=2)", num: true, value: (c) => c.u_cert ?? c.u_max, render: (c) => (c.u_cert ?? c.u_max) == null ? "—" : <>± {fmtG(c.u_cert ?? c.u_max)} {c.unidad_u}</> },
    {
      key: "estado", label: "Estado", value: (c) => ESTADO[c.estado]?.label ?? c.estado,
      render: (c) => (
        <span title={c.devuelto_motivo ? `Devuelta: ${c.devuelto_motivo}` : undefined}>
          <span className={`pill ${ESTADO[c.estado]?.pill ?? "gray"}`}>{ESTADO[c.estado]?.label ?? c.estado}</span>
          {c.estado === "borrador" && c.devuelto_motivo && <span className="pill amber" style={{ marginLeft: 4 }}>Devuelta</span>}
          {c.reemplaza_numero && <span className="pill amber" style={{ marginLeft: 4 }} title={`Reemplaza al ${c.reemplaza_numero}`}>Reemisión</span>}
          {c.paso_pendiente && <span style={{ display: "block", fontSize: 11, color: "var(--muted)" }}>Firma: {c.paso_pendiente.responsables.join(" / ") || "sin responsable"}</span>}
        </span>
      ),
    },
    { key: "fecha_calibracion", label: "Calibración", value: (c) => c.fecha_calibracion ?? "", render: (c) => <span style={{ whiteSpace: "nowrap" }}>{fecha(c.fecha_calibracion)}</span> },
    { key: "autor_nombre", label: "Metrólogo", value: (c) => c.metrologo_nombre ?? c.autor_nombre ?? "", render: (c) => c.metrologo_nombre ?? c.autor_nombre ?? "—" },
    { key: "termino_previsto", label: "Término previsto", value: (c) => c.termino_previsto ?? "", render: (c) => (c.termino_previsto ? <span style={{ whiteSpace: "nowrap" }}>{fecha(c.termino_previsto)}</span> : "—") },
    {
      key: "emitido_at", label: "Emitida · entrega", value: (c) => c.emitido_at ?? "",
      render: (c) => (c.emitido_at
        ? <span style={{ whiteSpace: "nowrap" }}>{fechaHora(c.emitido_at)}{c.estado === "emitida" && (c.entregado_at
            ? <span style={{ display: "block", fontSize: 11, color: "var(--muted)" }}>Entregado {fecha(c.entregado_at)}</span>
            : <span className="pill amber" style={{ display: "block", width: "fit-content" }}>Sin entregar</span>)}</span>
        : "—"),
    },
  ];

  return (
    <div>
      <PageHeader
        titulo="Metrología · Calibraciones"
        subtitulo={<>Calibraciones de la Sección Metrología (LMT, área eléctrica y Laboratorio Nacional de Fuerza). Cada una nace del instrumento
          recibido de una OT («Instrumentos por calibrar»). El metrólogo habilitado
          para la magnitud firma y envía; el jefe del laboratorio (o su subrogante) revisa y firma; el jefe del departamento firma y emite el
          Certificado de Calibración, que recibe su número por magnitud y queda sellado con su código de verificación. Cualquiera de ellos puede
          devolverla con observaciones.</>}
        acciones={
          <div style={{ display: "flex", gap: 8 }}>
            {puede("metrologia.crear") && <Link className="btn primary sm" href={"/metrologia/nueva" as any}>Instrumentos por calibrar</Link>}
            <Link className="btn sm" href={"/metrologia/verificar" as any}>Verificar un certificado</Link>
            {puede("metrologia.ver") && <Link className="btn sm" href={"/metrologia/config" as any}>Maestros y configuración</Link>}
          </div>
        }
      />
      {error && <div className="alert warn">{error}</div>}
      {pendientes > 0 && (
        <div className="alert info" style={{ marginBottom: 10 }}>
          Tiene <b>{pendientes}</b> calibración(es) esperando su firma.
        </div>
      )}

      <div className="toolbar" style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
        {FILTROS.map(([v, l]) => (
          <button key={v} className={`btn sm${estado === v ? " primary" : ""}`} onClick={() => setEstado(v)}>{l}</button>
        ))}
        {pendiente && PENDIENTE[pendiente] && (
          <span className="pill teal" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            Desde Mi bandeja: {PENDIENTE[pendiente].texto} ({filas.length})
            <button type="button" className="btn sm" style={{ padding: "0 6px", minHeight: 0 }} aria-label="Quitar el filtro de Mi bandeja"
              onClick={() => { setPendiente(""); window.history.replaceState(null, "", "/metrologia"); }}>✕</button>
          </span>
        )}
      </div>

      <DataTable
        columns={columns}
        rows={filas}
        loading={cargando}
        searchKeys={["codigo", "numero_certificado", "instrumento", "cliente", "proceso", "ot_codigo", "magnitud"]}
        acciones={(c) => {
          const a: string[] = c.acciones ?? [];
          return (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              <Link className="btn sm primary" href={`/metrologia/${c.id}` as any}>Ficha</Link>
              <button className="btn sm" onClick={() => verCertificado(c.id)}>{c.estado === "emitida" ? "Certificado" : "Ver borrador"}</button>
              {a.includes("EDITAR") && <Link className="btn sm" href={`/metrologia/nueva?id=${c.id}` as any}>Editar</Link>}
              {a.includes("ENVIAR") && <button className="btn sm primary" disabled={!!ocupado} onClick={() => enviar(c)}>Firmar y enviar</button>}
              {a.includes("DEVOLVER") && <button className="btn sm" disabled={!!ocupado} onClick={() => setDevolver({ row: c, motivo: "", que: "devolver" })}>Devolver</button>}
              {a.includes("FIRMAR") && <button className="btn sm primary" disabled={!!ocupado} onClick={() => firmar(c, false)}>Revisar y firmar</button>}
              {a.includes("EMITIR") && <button className="btn sm primary" disabled={!!ocupado} onClick={() => firmar(c, true)}>Firmar y emitir</button>}
              {a.includes("REEMITIR") && <button className="btn sm" disabled={!!ocupado} onClick={() => setDevolver({ row: c, motivo: "", que: "reemitir" })}>Reemitir</button>}
            </div>
          );
        }}
        vacio={<>No hay calibraciones{estado ? " en este estado" : ""}.</>}
      />

      {devolver && (
        <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "grid", placeItems: "center", zIndex: 50 }}>
          <div className="card" style={{ width: "min(520px, 92vw)", padding: 18 }} onKeyDown={(e) => { if (e.key === "Escape") setDevolver(null); }}>
            <h3 style={{ marginTop: 0 }}>{devolver.que === "devolver" ? `Devolver ${devolver.row.codigo} al metrólogo` : `Reemitir el certificado ${devolver.row.numero_certificado}`}</h3>
            <p style={{ fontSize: 13, color: "var(--muted)" }}>{devolver.que === "devolver"
              ? "Indique qué debe corregir. El motivo queda registrado y la calibración vuelve a borrador; las firmas hechas se anulan."
              : "Se crea un borrador con los mismos datos para corregirlo. Cuando se emita, el nuevo certificado dirá que reemplaza a este, que quedará «reemplazado»."}</p>
            <textarea
              autoFocus rows={4} style={{ width: "100%" }} value={devolver.motivo}
              onChange={(e) => setDevolver({ ...devolver, motivo: e.target.value })}
              placeholder={devolver.que === "devolver" ? "Motivo de la devolución" : "Motivo de la reemisión"} aria-label="Motivo"
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
              <button className="btn sm" onClick={() => setDevolver(null)}>Cancelar</button>
              <button className="btn sm primary" disabled={devolver.motivo.trim().length < 5 || !!ocupado}
                onClick={() => accion(devolver.row, devolver.que, { motivo: devolver.motivo.trim() })}>{devolver.que === "devolver" ? "Devolver" : "Crear reemisión"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
