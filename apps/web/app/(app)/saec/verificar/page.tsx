"use client";

import { useState } from "react";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";

const fechaHora = (v: any) =>
  v ? new Date(v).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" }) : "—";

/**
 * RF-K07.3 · pantalla de verificación de la autenticidad de un certificado.
 *
 * El endpoint que consulta es PÚBLICO (no envía Authorization): un fiscal o un
 * tribunal debe poder validar el documento sin cuenta en el LIMS. La página vive
 * bajo /saec por el dominio de este módulo; para exponerla a terceros hay que
 * sacarla del grupo (app) —que exige sesión— a una ruta pública.
 */
export default function VerificarCertificadoPage() {
  const [codigo, setCodigo] = useState("");
  const [res, setRes] = useState<any>(null);
  const [error, setError] = useState("");
  const [buscando, setBuscando] = useState(false);

  async function verificar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setRes(null);
    setBuscando(true);
    try {
      const r = await fetch(`${API}/saec/certificados/verificar/${encodeURIComponent(codigo.trim())}`, {
        headers: { "Content-Type": "application/json" },
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json.message ?? `Error ${r.status}`);
      setRes(json.data ?? json);
    } catch (err: any) {
      setError(Array.isArray(err.message) ? err.message.join(", ") : err.message);
    } finally {
      setBuscando(false);
    }
  }

  return (
    <div>
      <h1 className="page">Verificación de certificados SAEC</h1>
      <p className="subtitle">
        Introduzca el código de verificación impreso en el certificado para comprobar su autenticidad y contrastar el HASH
        de integridad con el del documento en su poder.
      </p>
      {error && <div className="alert warn">{error}</div>}

      <div className="toolbar" style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <Link className="btn sm" href="/saec">← Evidencias</Link>
      </div>

      <form onSubmit={verificar} className="card" style={{ marginBottom: 12 }}>
        <div className="form-grid">
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label>Código de verificación <span className="req">*</span></label>
            <input
              required
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.toUpperCase())}
              placeholder="Ej. K7M2Q-9XTR4"
              style={{ fontFamily: "ui-monospace, Menlo, Consolas, monospace", letterSpacing: 1 }}
            />
          </div>
        </div>
        <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
          <button className="btn primary sm" disabled={buscando || !codigo.trim()}>
            {buscando ? "Verificando…" : "Verificar"}
          </button>
        </div>
      </form>

      {res && (
        <div className="card">
          {res.valido ? (
            <div className="alert success">✔ {res.mensaje}</div>
          ) : (
            <div className="alert warn">✘ {res.mensaje}</div>
          )}

          {res.certificado && (
            <div className="form-grid">
              <div className="field"><label>Certificado</label><div className="codigo">{res.certificado}</div></div>
              <div className="field"><label>Evidencia</label><div className="codigo">{res.evidencia}</div></div>
              <div className="field"><label>Emisor</label><div>{res.emisor}</div></div>
              <div className="field"><label>Estado</label>
                <div><span className={`pill ${res.estado === "emitido" ? "green" : "red"}`}>{res.estado}</span></div>
              </div>
              <div className="field"><label>Emitido</label><div>{fechaHora(res.emitidoAt)}</div></div>
              {res.anuladoAt && <div className="field"><label>Anulado</label><div>{fechaHora(res.anuladoAt)}</div></div>}
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label>HASH de integridad (SHA-256)</label>
                <div style={{ fontSize: 11, wordBreak: "break-all" }} className="codigo">{res.hashDocumento}</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
