"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fechaHora } from "@/lib/format";
import DataTable, { type DataColumn } from "@/components/DataTable";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const auth = () => ({
  Authorization: `Bearer ${localStorage.getItem("lims_token")}`,
  "Content-Type": "application/json",
});

const ESTADO_PILL: Record<string, string> = {
  procesado: "green", parcial: "amber", error: "red", duplicado: "gray",
};
const POOL_PILL: Record<string, string> = {
  pool: "blue", asignado: "green", descartado: "gray",
};

/**
 * SAEC · Consola ETL de IBIS (armas importadas).
 *
 * La carga NO es visual: IBIS deja un XML diario en una CARPETA y el ETL la
 * barre. Esta pantalla es de administración: configura la carpeta, dispara el
 * barrido, muestra el REGISTRO de qué XML se cargaron (bitácora) y el POOL de
 * resultados. El perito adjunta a una OT sólo las armas de esa OT (match por
 * número de serie).
 */
export default function IbisEtlPage() {
  const [cfg, setCfg] = useState<any>(null);
  const [historial, setHistorial] = useState<any[]>([]);
  const [pool, setPool] = useState<any[]>([]);
  const [ots, setOts] = useState<any[]>([]);
  const [otId, setOtId] = useState("");
  const [candidatos, setCandidatos] = useState<any[]>([]);
  const [msg, setMsg] = useState<{ tipo: string; texto: string } | null>(null);
  const [barriendo, setBarriendo] = useState(false);
  const [asignando, setAsignando] = useState(false);

  async function cargar() {
    try {
      const [c, h, p, o] = await Promise.all([
        fetch(`${API}/ibis/config`, { headers: auth() }).then((x) => x.json()).catch(() => null),
        fetch(`${API}/ibis/importaciones?limit=25`, { headers: auth() }).then((x) => x.json()).catch(() => ({})),
        fetch(`${API}/ibis/pool?limit=50`, { headers: auth() }).then((x) => x.json()).catch(() => ({})),
        fetch(`${API}/ot`, { headers: auth() }).then((x) => x.json()).catch(() => []),
      ]);
      if (c) setCfg(c);
      setHistorial(h.data ?? (Array.isArray(h) ? h : []));
      setPool(p.data ?? (Array.isArray(p) ? p : []));
      setOts(Array.isArray(o) ? o : o.data ?? []);
    } catch { /* informativo */ }
  }
  useEffect(() => { cargar(); }, []);

  async function barrer() {
    setBarriendo(true); setMsg(null);
    try {
      const res = await fetch(`${API}/ibis/barrer`, { method: "POST", headers: auth() });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.message ?? `Error ${res.status}`);
      const d = j.data ?? j;
      setMsg({ tipo: "success", texto: `Barrido: ${d.archivos ?? 0} archivo(s) · ${d.procesados ?? 0} procesado(s) · ${d.conError ?? 0} con error.` });
      cargar();
    } catch (e: any) {
      setMsg({ tipo: "warn", texto: Array.isArray(e.message) ? e.message.join(", ") : e.message });
    } finally { setBarriendo(false); }
  }

  async function guardarCfg(ev: React.FormEvent) {
    ev.preventDefault(); setMsg(null);
    try {
      const res = await fetch(`${API}/ibis/config`, {
        method: "PUT", headers: auth(),
        body: JSON.stringify({
          carpetaEntrada: cfg.carpeta_entrada, carpetaProcesados: cfg.carpeta_procesados,
          carpetaErrores: cfg.carpeta_errores, activo: cfg.activo ?? true,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.message ?? `Error ${res.status}`);
      setCfg(j); setMsg({ tipo: "success", texto: "Configuración de carpetas guardada." });
    } catch (e: any) {
      setMsg({ tipo: "warn", texto: Array.isArray(e.message) ? e.message.join(", ") : e.message });
    }
  }

  async function verCandidatos(id: string) {
    setOtId(id); setCandidatos([]); setMsg(null);
    if (!id) return;
    try {
      const j = await fetch(`${API}/ibis/ot/${id}/candidatos`, { headers: auth() }).then((x) => x.json());
      setCandidatos(j.data ?? []);
    } catch { /* */ }
  }

  async function asignar() {
    if (!otId) return;
    setAsignando(true); setMsg(null);
    try {
      const res = await fetch(`${API}/ibis/ot/${otId}/asignar`, { method: "POST", headers: auth(), body: "{}" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.message ?? `Error ${res.status}`);
      setMsg({ tipo: "success", texto: `${j.data?.asignados ?? 0} arma(s) adjuntada(s) a la OT.` });
      verCandidatos(otId); cargar();
    } catch (e: any) {
      setMsg({ tipo: "warn", texto: Array.isArray(e.message) ? e.message.join(", ") : e.message });
    } finally { setAsignando(false); }
  }

  const historialCols: DataColumn[] = [
    { key: "fecha", label: "Fecha", value: (h) => h.created_at ?? "",
      render: (h) => <span style={{ whiteSpace: "nowrap" }}>{fechaHora(h.created_at)}</span> },
    { key: "archivo", label: "Archivo", value: (h) => h.nombre_archivo ?? "",
      render: (h) => <span title={h.hash_sha256}>{h.nombre_archivo ?? "—"}</span> },
    { key: "origen", label: "Origen", value: (h) => h.origen_barrido ?? "" },
    { key: "estado", label: "Estado", value: (h) => h.estado ?? "",
      render: (h) => <span className={`pill ${ESTADO_PILL[h.estado] ?? "gray"}`}>{h.estado}</span> },
    { key: "armas", label: "Armas", num: true, value: (h) => h.resultados_creados ?? 0,
      render: (h) => h.resultados_creados ?? 0 },
    { key: "bajas", label: "Bajas", num: true, value: (h) => h.eliminados ?? 0,
      render: (h) => h.eliminados ?? 0 },
    { key: "errores", label: "Errores", num: true,
      value: (h) => (Array.isArray(h.errores) ? h.errores.length : 0),
      render: (h) => (Array.isArray(h.errores) ? h.errores.length : 0) },
    { key: "usuario", label: "Usuario", value: (h) => h.importado_por_nombre ?? "",
      render: (h) => h.importado_por_nombre ?? "—" },
  ];

  return (
    <div>
      <h1 className="page">SAEC · IBIS · Armas importadas (ETL por carpeta)</h1>
      <p className="subtitle">
        IBIS deposita un XML diario en una carpeta; el ETL la barre e incorpora al <strong>pool</strong> las armas
        (por nº de serie). No hay carga visual. Al hacer la prueba de una OT se adjuntan a la OT <strong>solo las
        armas de esa OT</strong>. Un archivo ya procesado no se reprocesa (HASH SHA-256).
      </p>
      {msg && <div className={`alert ${msg.tipo === "success" ? "success" : "warn"}`}>{msg.texto}</div>}

      <div className="toolbar" style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <Link className="btn sm" href="/saec">← Evidencias</Link>
        <Link className="btn sm" href="/saec/armas">Armas</Link>
      </div>

      {/* Configuración de la carpeta ETL */}
      {cfg && (
        <form onSubmit={guardarCfg} className="card" style={{ marginBottom: 12 }}>
          <h3 style={{ marginTop: 0 }}>Carpeta ETL de IBIS</h3>
          <div className="form-grid">
            <div className="field">
              <label>Carpeta de entrada</label>
              <input value={cfg.carpeta_entrada ?? ""} onChange={(e) => setCfg({ ...cfg, carpeta_entrada: e.target.value })} placeholder="/data/ibis/entrada" />
            </div>
            <div className="field">
              <label>Carpeta de procesados</label>
              <input value={cfg.carpeta_procesados ?? ""} onChange={(e) => setCfg({ ...cfg, carpeta_procesados: e.target.value })} placeholder="/data/ibis/procesados" />
            </div>
            <div className="field">
              <label>Carpeta de errores</label>
              <input value={cfg.carpeta_errores ?? ""} onChange={(e) => setCfg({ ...cfg, carpeta_errores: e.target.value })} placeholder="/data/ibis/errores" />
            </div>
          </div>
          <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {cfg.ultimo_barrido_at ? `Último barrido: ${fechaHora(cfg.ultimo_barrido_at)}` : "Sin barridos previos."}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn sm" type="submit">Guardar carpeta</button>
              <button className="btn primary sm" type="button" onClick={barrer} disabled={barriendo}>
                {barriendo ? "Barriendo…" : "▶ Barrer carpeta ahora"}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Adjuntar a una OT (solo las armas de esa OT) */}
      <div className="card" style={{ marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>Adjuntar resultados IBIS a una OT</h3>
        <div className="field" style={{ maxWidth: 480 }}>
          <label>Orden de Trabajo</label>
          <select value={otId} onChange={(e) => verCandidatos(e.target.value)}>
            <option value="">— Seleccione una OT —</option>
            {ots.map((o) => (
              <option key={o.id} value={o.id}>{o.codigo} · {o.cliente?.razonSocial ?? o.cliente?.nombre ?? ""}</option>
            ))}
          </select>
        </div>
        {otId && (
          <>
            <table className="data" style={{ marginTop: 8 }}>
              <thead><tr><th>Nº serie (arma OT)</th><th>Serie IBIS</th><th>Marca</th><th>Modelo</th><th>Calibre</th><th className="num">Hits</th><th>Resultado</th></tr></thead>
              <tbody>
                {candidatos.map((c) => (
                  <tr key={c.resultado_id}>
                    <td className="codigo">{c.arma_serie ?? "—"}</td>
                    <td className="codigo">{c.serie ?? "—"}</td>
                    <td>{c.marca ?? "—"}</td>
                    <td>{c.modelo ?? "—"}</td>
                    <td>{c.calibre ?? "—"}</td>
                    <td className="num">{c.hit_count ?? 0}</td>
                    <td>{c.resultado ?? "—"}</td>
                  </tr>
                ))}
                {candidatos.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--muted)", padding: 12 }}>
                    Sin coincidencias en el pool para las armas de esta OT.
                  </td></tr>
                )}
              </tbody>
            </table>
            <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
              <button className="btn primary sm" onClick={asignar} disabled={asignando || candidatos.length === 0}>
                {asignando ? "Adjuntando…" : `Adjuntar ${candidatos.length} arma(s) a la OT`}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Registro (bitácora) de XML cargados */}
      <div style={{ marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>Registro de XML cargados</h3>
        <DataTable
          columns={historialCols}
          rows={historial}
          searchKeys={["archivo", "estado", "usuario"]}
          vacio={<>Sin importaciones registradas.</>}
        />
      </div>

      {/* Pool de resultados */}
      <div className="card card--table">
        <h3 style={{ marginTop: 0 }}>Pool de resultados balísticos importados</h3>
        <table className="data">
          <thead>
            <tr><th>Nº serie</th><th>Marca</th><th>Modelo</th><th>Calibre</th><th>Tipo</th><th className="num">Hits</th><th>Estado</th><th>OT</th></tr>
          </thead>
          <tbody>
            {pool.map((r) => (
              <tr key={r.id}>
                <td className="codigo">{r.serie ?? "—"}</td>
                <td>{r.marca ?? "—"}</td>
                <td>{r.modelo ?? "—"}</td>
                <td>{r.calibre ?? "—"}</td>
                <td>{r.tipo ?? "—"}</td>
                <td className="num">{r.hit_count ?? 0}</td>
                <td><span className={`pill ${POOL_PILL[r.estado] ?? "gray"}`}>{r.estado}</span></td>
                <td className="codigo">{r.ot_codigo ?? "—"}</td>
              </tr>
            ))}
            {pool.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--muted)", padding: 16 }}>Pool vacío. Barra la carpeta para importar.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
