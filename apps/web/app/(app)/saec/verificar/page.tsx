"use client";

import { useState } from "react";
import Link from "next/link";
import { consultar, Ficha, type Resultado } from "../../../verificar/Verificacion";

/**
 * RF-K07.3 · pantalla de verificación de la autenticidad de un certificado.
 *
 * Reconoce los certificados de evidencia del SAEC (CERT-SAEC) y los documentos
 * oficiales del flujo general, entre ellos el certificado por arma de la
 * Delegación Nº 11: usa la misma consulta y la misma ficha que la página
 * pública /verificar/<código>. Los endpoints son PÚBLICOS (no envían
 * Authorization): un fiscal o un tribunal valida el documento sin cuenta.
 */
export default function VerificarCertificadoPage() {
  const [codigo, setCodigo] = useState("");
  const [res, setRes] = useState<Resultado | null>(null);
  const [buscando, setBuscando] = useState(false);

  async function verificar(e: React.FormEvent) {
    e.preventDefault();
    setRes(null);
    setBuscando(true);
    try {
      setRes(await consultar(codigo));
    } finally {
      setBuscando(false);
    }
  }

  return (
    <div>
      <h1 className="page">Verificación de certificados SAEC</h1>
      <p className="subtitle">
        Introduzca el código de verificación impreso en el certificado (de evidencia o por arma) para comprobar su
        autenticidad y contrastar el HASH de integridad con el del documento en su poder.
      </p>

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
          <button className="btn primary sm" disabled={buscando || codigo.trim().length < 5}>
            {buscando ? "Verificando…" : "Verificar"}
          </button>
        </div>
      </form>

      {res && <Ficha r={res} />}
    </div>
  );
}
