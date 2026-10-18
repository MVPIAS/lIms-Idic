"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";

/**
 * Verificación de un Certificado de Calibración por su código (C7). Consulta un
 * endpoint PÚBLICO (sin token): quien recibe el certificado en papel puede
 * comprobarlo sin cuenta. Esta página vive en el área con sesión, como la del
 * SAEC; para exponerla a terceros hay que publicarla en una ruta pública.
 */
export default function VerificarCalibracionPage() {
  const [codigo, setCodigo] = useState("");
  const [res, setRes] = useState<any>(null);
  const [error, setError] = useState("");
  const [buscando, setBuscando] = useState(false);

  async function verificar(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setRes(null); setBuscando(true);
    try {
      const r = await fetch(`${API}/metrologia/verificar/${encodeURIComponent(codigo.trim())}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message ?? `Error ${r.status}`);
      setRes(j);
    } catch (err: any) { setError(err.message); }
    finally { setBuscando(false); }
  }

  return (
    <div>
      <PageHeader
        titulo="Verificar un certificado de calibración"
        migas={[{ label: "Calibraciones", href: "/metrologia" }, { label: "Verificar" }]}
        subtitulo="Escriba el código de verificación impreso al pie del certificado (por ejemplo, K7M2Q-9XTR4). Se comprueba que el certificado existe, que está vigente y que su contenido no fue alterado."
      />
      {error && <div className="alert warn" role="alert">{error}</div>}
      <form onSubmit={verificar} className="card" style={{ padding: 14, marginBottom: 12, maxWidth: 560 }}>
        <div className="field">
          <label htmlFor="codigo">Código de verificación</label>
          <input id="codigo" required value={codigo} autoComplete="off" onChange={(e) => setCodigo(e.target.value.toUpperCase())}
            style={{ fontFamily: "var(--mono, ui-monospace)", letterSpacing: 1 }} />
        </div>
        <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
          <button className="btn primary sm" disabled={buscando || !codigo.trim()}>{buscando ? "Verificando…" : "Verificar"}</button>
        </div>
      </form>
      {res && (
        <div className="card" style={{ padding: 14, maxWidth: 560 }} aria-live="polite">
          {res.valido
            ? <div className="alert success">Certificado válido: N° <b>{res.numero}</b>, emitido el {res.fecha}.</div>
            : <div className="alert warn">No válido: {res.motivo ?? "el certificado no existe o no está emitido"}.</div>}
          {(res.numero || res.proceso) && (
            <table className="data" style={{ marginTop: 8 }}>
              <tbody>
                <tr><th style={{ width: 170 }}>Número</th><td>{res.numero ?? "—"}</td></tr>
                <tr><th>Proceso</th><td>{res.proceso ?? "—"}</td></tr>
                <tr><th>Fecha de emisión</th><td>{res.fecha ?? "—"}</td></tr>
                <tr><th>Sello SHA-256</th><td style={{ fontFamily: "var(--mono, ui-monospace)", wordBreak: "break-all", fontSize: 12 }}>{res.hash ?? "—"}</td></tr>
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
