"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fechaHora } from "@/lib/format";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const auth = () => ({
  Authorization: `Bearer ${localStorage.getItem("lims_token")}`,
  "Content-Type": "application/json",
});

const ESTADO_PILL: Record<string, string> = {
  procesado: "green",
  parcial: "amber",
  error: "red",
  duplicado: "gray",
};

export default function IbisImportacionPage() {
  const [xml, setXml] = useState("");
  const [nombreArchivo, setNombreArchivo] = useState("");
  const [forzar, setForzar] = useState(false);
  const [resumen, setResumen] = useState<any>(null);
  const [historial, setHistorial] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function cargarHistorial() {
    try {
      const r = await fetch(`${API}/ibis/importaciones?limit=25`, { headers: auth() }).then((x) => x.json());
      setHistorial(r.data ?? (Array.isArray(r) ? r : []));
    } catch {
      /* la bitácora es informativa: si falla no bloquea la importación */
    }
  }
  useEffect(() => { cargarHistorial(); }, []);

  function alSubirArchivo(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    if (!file) return;
    setNombreArchivo(file.name);
    const reader = new FileReader();
    reader.onload = () => setXml(String(reader.result ?? ""));
    reader.readAsText(file, "UTF-8");
  }

  async function importar(ev: React.FormEvent) {
    ev.preventDefault();
    setError("");
    setResumen(null);
    setEnviando(true);
    try {
      const res = await fetch(`${API}/ibis/importar`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ xml, nombreArchivo: nombreArchivo || null, forzar }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message ?? `Error ${res.status}`);
      setResumen(json.data ?? json);
      cargarHistorial();
    } catch (e: any) {
      setError(Array.isArray(e.message) ? e.message.join(", ") : e.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div>
      <h1 className="page">SAEC · Importación IBIS / Forensic</h1>
      <p className="subtitle">
        ETL del XML en formato ESI v3.2 que Forensic deposita periódicamente (Casos, Evidencias y Coincidencias). La
        integración es unidireccional: el SAEC solo importa, nunca exporta hacia Forensic. Un archivo ya procesado no se
        reprocesa (control por HASH SHA-256).
      </p>
      {error && <div className="alert warn">{error}</div>}

      <div className="toolbar" style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <Link className="btn sm" href="/saec">← Evidencias</Link>
      </div>

      <form onSubmit={importar} className="card" style={{ marginBottom: 12 }}>
        <div className="form-grid">
          <div className="field">
            <label>Archivo XML (ESI v3.2)</label>
            <input type="file" accept=".xml,text/xml,application/xml" onChange={alSubirArchivo} />
          </div>
          <div className="field">
            <label>Nombre del archivo</label>
            <input value={nombreArchivo} onChange={(e) => setNombreArchivo(e.target.value)} placeholder="export_20260401.xml" />
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label>Contenido XML <span className="req">*</span></label>
            <textarea
              required
              rows={14}
              value={xml}
              onChange={(e) => setXml(e.target.value)}
              placeholder={'<?xml version="1.0" encoding="UTF-8"?>\n<Export Version="3.2">\n  <Cases>…</Cases>\n  <Exhibits>…</Exhibits>\n  <Hits>…</Hits>\n</Export>'}
              style={{ fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 11.5 }}
            />
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 400 }}>
              <input type="checkbox" checked={forzar} onChange={(e) => setForzar(e.target.checked)} style={{ width: "auto" }} />
              Forzar reproceso aunque el archivo ya se haya importado
            </label>
          </div>
        </div>
        <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn sm" onClick={() => { setXml(""); setNombreArchivo(""); setResumen(null); }}>Limpiar</button>
          <button className="btn primary sm" disabled={enviando || !xml.trim()}>
            {enviando ? "Procesando…" : "Importar XML"}
          </button>
        </div>
      </form>

      {resumen && (
        <div className="card" style={{ marginBottom: 12 }}>
          <h3 style={{ marginTop: 0 }}>Resumen de la importación</h3>
          {resumen.duplicado ? (
            <div className="alert info">{resumen.mensaje}</div>
          ) : (
            <div className="alert success">
              Importación <strong>{resumen.estado}</strong> · {fechaHora(resumen.procesadoAt)} · ESI v{resumen.versionEsi}
            </div>
          )}

          <div className="kpis">
            <div className="kpi k-blue"><div className="lab">Casos creados</div><div className="val">{resumen.casosCreados ?? 0}</div></div>
            <div className="kpi k-blue"><div className="lab">Casos actualizados</div><div className="val">{resumen.casosActualizados ?? 0}</div></div>
            <div className="kpi k-green"><div className="lab">Evidencias creadas</div><div className="val">{resumen.evidenciasCreadas ?? 0}</div></div>
            <div className="kpi k-green"><div className="lab">Evidencias actualizadas</div><div className="val">{resumen.evidenciasActualizadas ?? 0}</div></div>
            <div className="kpi k-violet"><div className="lab">Coincidencias</div><div className="val">{resumen.hitsCreados ?? 0}</div></div>
            <div className="kpi k-amber"><div className="lab">Peritajes cargados</div><div className="val">{resumen.peritajesCreados ?? 0}</div></div>
          </div>

          {resumen.hash && (
            <p style={{ fontSize: 11, color: "var(--muted)", wordBreak: "break-all" }}>
              HASH SHA-256 del archivo: <span className="codigo">{resumen.hash}</span>
            </p>
          )}

          {Array.isArray(resumen.correlaciones) && resumen.correlaciones.length > 0 && (
            <>
              <h4>Correlaciones encontradas</h4>
              <table className="data">
                <thead><tr><th>Evidencia A</th><th>Evidencia B</th><th className="num">Score</th><th>Resueltas</th></tr></thead>
                <tbody>
                  {resumen.correlaciones.map((c: any, i: number) => (
                    <tr key={i}>
                      <td className="codigo">{c.evidenciaA ?? "—"}</td>
                      <td className="codigo">{c.evidenciaB ?? "—"}</td>
                      <td className="num">{c.score ?? "—"}</td>
                      <td>{c.resueltas ? <span className="pill green">sí</span> : <span className="pill amber">parcial</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {Array.isArray(resumen.errores) && resumen.errores.length > 0 && (
            <>
              <h4>Errores registrados</h4>
              <table className="data">
                <thead><tr><th>Tipo</th><th>Mensaje</th></tr></thead>
                <tbody>
                  {resumen.errores.map((e: any, i: number) => (
                    <tr key={i}><td>{e.tipo}</td><td>{e.mensaje}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      <div className="card card--table">
        <h3 style={{ marginTop: 0 }}>Bitácora de importaciones</h3>
        <table className="data">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Archivo</th>
              <th>Estado</th>
              <th className="num">Casos</th>
              <th className="num">Evidencias</th>
              <th className="num">Hits</th>
              <th className="num">Errores</th>
              <th>Usuario</th>
            </tr>
          </thead>
          <tbody>
            {historial.map((h) => (
              <tr key={h.id}>
                <td style={{ whiteSpace: "nowrap" }}>{fechaHora(h.created_at)}</td>
                <td title={h.hash_sha256}>{h.nombre_archivo ?? "—"}</td>
                <td><span className={`pill ${ESTADO_PILL[h.estado] ?? "gray"}`}>{h.estado}</span></td>
                <td className="num">{(h.casos_creados ?? 0) + (h.casos_actualizados ?? 0)}</td>
                <td className="num">{(h.evidencias_creadas ?? 0) + (h.evidencias_actualizadas ?? 0)}</td>
                <td className="num">{h.hits_creados ?? 0}</td>
                <td className="num">{Array.isArray(h.errores) ? h.errores.length : 0}</td>
                <td>{h.importado_por_nombre ?? "—"}</td>
              </tr>
            ))}
            {historial.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--muted)", padding: 16 }}>Sin importaciones registradas.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
