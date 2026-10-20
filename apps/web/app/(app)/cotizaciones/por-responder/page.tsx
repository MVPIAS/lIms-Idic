"use client";

/**
 * Cotizaciones por responder · bandeja del laboratorio (EP-00 2.4–2.6).
 * Comercial pide al laboratorio fechas (servicio estándar) o el Formulario de
 * costeo FORM05 (no estándar). Aquí el Jefe de Laboratorio ve las solicitudes de
 * sus laboratorios y las que esperan su V°B° (o el del Jefe de Departamento), y
 * entra a la ficha de la cotización a responder.
 * GET /cotizaciones/solicitudes-laboratorio?estado=por_responder|vb|todas
 * (filtrado en el servidor por el alcance del permiso cotizacion.costear).
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fechaHora } from "@/lib/format";
import { pedir } from "../_components/comercial";
import { PILL_SOLICITUD } from "../_components/circuito";

type Filtro = "por_responder" | "vb" | "todas";
const FILTROS: [Filtro, string][] = [
  ["por_responder", "Por responder"],
  ["vb", "Por dar V°B°"],
  ["todas", "Todas"],
];

export default function CotizacionesPorResponderPage() {
  const [filtro, setFiltro] = useState<Filtro>("por_responder");
  const [filas, setFilas] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [listo, setListo] = useState(false);

  useEffect(() => {
    const e = new URLSearchParams(window.location.search).get("estado") as Filtro | null;
    if (e && FILTROS.some(([f]) => f === e)) setFiltro(e);
    setListo(true);
  }, []);

  const cargar = useCallback(async () => {
    if (!listo) return;
    setCargando(true);
    try {
      const r = await pedir<any>("GET", `/cotizaciones/solicitudes-laboratorio?estado=${filtro}`);
      setFilas(r?.data ?? []);
      setError("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, [filtro, listo]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  return (
    <div>
      <h1 className="page">Cotizaciones por responder</h1>
      <p className="subtitle">
        Comercial pide fechas y costo a su laboratorio. Responda con el programa de trabajo (FORM06) y, si el servicio no es estandarizado, el formulario de costeo (FORM05). Después la respuesta necesita el V°B° del Jefe de Laboratorio y del Jefe de Departamento.
      </p>
      {error && <div className="alert warn" role="alert">{error}</div>}
      <div className="toolbar" style={{ gap: 6 }}>
        {FILTROS.map(([f, l]) => (
          <button key={f} className={`btn sm ${filtro === f ? "primary" : "outline"}`} aria-pressed={filtro === f} onClick={() => setFiltro(f)}>{l}</button>
        ))}
      </div>
      <div className="card card--table">
        <table className="data">
          <thead>
            <tr>
              <th>Cotización</th>
              <th>Cliente</th>
              <th>Laboratorio</th>
              <th>Solicitud</th>
              <th>Estado</th>
              <th>Solicitada</th>
              <th>Le toca a</th>
              <th><span className="sr-only">Acción</span></th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.id}>
                <td><Link href={`/cotizaciones/${f.cotizacionId}?tab=laboratorio` as any} className="codigo" style={{ textDecoration: "underline" }}>{f.cotizacionCodigo}</Link></td>
                <td>{f.cliente ?? "—"}</td>
                <td title={f.unidadNombre}>{f.unidadCodigo}</td>
                <td>{f.numero ? <span className="codigo">{f.numero}</span> : "Solicitud de fechas"}{f.comentarioEjecutivo ? <div style={{ fontSize: 11.5, color: "var(--muted)" }}>«{f.comentarioEjecutivo}»</div> : null}</td>
                <td><span className={`pill ${PILL_SOLICITUD[f.estado] ?? "gray"}`}>{f.etiquetaEstado}</span></td>
                <td style={{ whiteSpace: "nowrap" }}>{fechaHora(f.solicitadaAt)}<div style={{ fontSize: 11.5, color: "var(--muted)" }}>{f.solicitadaPorNombre ?? ""}</div></td>
                <td>{f.nivelVb ? `V°B° ${f.nivelVb === "lab" ? "laboratorio" : "departamento"}: ${f.vbResponsables.join(", ") || "sin jefatura asignada"}` : ["solicitado", "devuelto"].includes(f.estado) ? `Jefe de Laboratorio ${f.unidadCodigo}` : "—"}</td>
                <td>
                  <Link href={`/cotizaciones/${f.cotizacionId}?tab=laboratorio` as any} className={`btn sm ${f.meToca ? "primary" : "outline"}`}>
                    {["solicitado", "devuelto"].includes(f.estado) ? "Responder →" : f.nivelVb ? "Revisar y dar V°B° →" : "Ver"}
                  </Link>
                </td>
              </tr>
            ))}
            {!cargando && filas.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>
                {filtro === "por_responder" ? "No hay solicitudes de Comercial pendientes para sus laboratorios." : filtro === "vb" ? "No hay respuestas esperando V°B°." : "Sin solicitudes."}
              </td></tr>
            )}
            {cargando && <tr><td colSpan={8} style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>Cargando…</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
