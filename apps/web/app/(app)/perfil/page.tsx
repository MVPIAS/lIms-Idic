"use client";

import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const auth = () => ({
  Authorization: `Bearer ${localStorage.getItem("lims_token")}`,
  "Content-Type": "application/json",
});

export default function PerfilPage() {
  const [me, setMe] = useState<any>(null);
  const [activo, setActivo] = useState<boolean>(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [loading, setLoading] = useState(false);

  // Enrolamiento en curso: QR + código a confirmar.
  const [qr, setQr] = useState<string>("");
  const [codigo, setCodigo] = useState("");
  const [enrolando, setEnrolando] = useState(false);

  // Desactivación: pide un código para confirmar.
  const [desactivando, setDesactivando] = useState(false);
  const [codigoOff, setCodigoOff] = useState("");

  async function cargar() {
    setError("");
    try {
      const res = await fetch(`${API}/auth/me`, { headers: auth() });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data = await res.json();
      setMe(data);
      setActivo(!!data.totpActivo);
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => {
    cargar();
  }, []);

  function msgDe(e: any): string {
    const m = e?.message ?? e;
    return Array.isArray(m) ? m.join(", ") : String(m);
  }

  async function iniciarSetup() {
    setError("");
    setOk("");
    setLoading(true);
    try {
      const res = await fetch(`${API}/auth/2fa/setup`, { method: "POST", headers: auth() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message ?? `Error ${res.status}`);
      setQr(data.qrDataUrl);
      setEnrolando(true);
      setCodigo("");
    } catch (e: any) {
      setError(msgDe(e));
    } finally {
      setLoading(false);
    }
  }

  async function confirmarActivacion(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setOk("");
    setLoading(true);
    try {
      const res = await fetch(`${API}/auth/2fa/activar`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ codigo }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message ?? `Error ${res.status}`);
      setEnrolando(false);
      setQr("");
      setCodigo("");
      setActivo(true);
      setOk("Verificación en dos pasos activada correctamente.");
      cargar();
    } catch (e: any) {
      setError(msgDe(e));
    } finally {
      setLoading(false);
    }
  }

  function cancelarSetup() {
    setEnrolando(false);
    setQr("");
    setCodigo("");
    setError("");
  }

  async function confirmarDesactivacion(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setOk("");
    setLoading(true);
    try {
      const res = await fetch(`${API}/auth/2fa/desactivar`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ codigo: codigoOff }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message ?? `Error ${res.status}`);
      setDesactivando(false);
      setCodigoOff("");
      setActivo(false);
      setOk("Verificación en dos pasos desactivada.");
      cargar();
    } catch (e: any) {
      setError(msgDe(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="page">Mi perfil · Seguridad</h1>
      <p className="subtitle">
        Gestione la verificación en dos pasos (2FA) de su cuenta. Un segundo factor TOTP añade una capa de protección
        adicional al ingreso con usuario y contraseña.
      </p>

      {error && <div className="alert warn">{error}</div>}
      {ok && <div className="alert">{ok}</div>}

      {me && (
        <div className="card">
          <div className="field">
            <label>Usuario</label>
            <div>
              <span className="codigo">{me.username}</span>
              {me.nombreCompleto ? ` · ${me.nombreCompleto}` : ""}
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Verificación en dos pasos (TOTP)</h2>
          <span className={`pill ${activo ? "green" : "gray"}`}>{activo ? "Activa" : "Inactiva"}</span>
        </div>

        {/* 2FA INACTIVA · ofrecer activación */}
        {!activo && !enrolando && (
          <div>
            <p className="subtitle" style={{ marginTop: 0 }}>
              Escanee un código QR con su aplicación autenticadora (Google Authenticator, Aegis, Authy…) y confirme con
              el código de 6 dígitos.
            </p>
            <button className="btn primary sm" onClick={iniciarSetup} disabled={loading}>
              {loading ? "Generando…" : "Activar 2FA"}
            </button>
          </div>
        )}

        {/* 2FA INACTIVA · enrolamiento en curso */}
        {!activo && enrolando && (
          <form onSubmit={confirmarActivacion}>
            <p className="subtitle" style={{ marginTop: 0 }}>
              1. Escanee este código con su aplicación autenticadora. 2. Escriba el código de 6 dígitos que muestra la
              app para confirmar.
            </p>
            {qr && (
              <div style={{ margin: "12px 0" }}>
                <img
                  src={qr}
                  alt="Código QR para 2FA"
                  width={200}
                  height={200}
                  style={{ border: "1px solid var(--border, #ddd)", borderRadius: 8, background: "#fff", padding: 8 }}
                />
              </div>
            )}
            <div className="field" style={{ maxWidth: 240 }}>
              <label>Código de verificación <span className="req">*</span></label>
              <input
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 8))}
              />
            </div>
            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              <button className="btn primary sm" type="submit" disabled={loading || codigo.length < 6}>
                {loading ? "Verificando…" : "Confirmar y activar"}
              </button>
              <button className="btn sm" type="button" onClick={cancelarSetup} disabled={loading}>
                Cancelar
              </button>
            </div>
          </form>
        )}

        {/* 2FA ACTIVA · ofrecer desactivación */}
        {activo && !desactivando && (
          <div>
            <p className="subtitle" style={{ marginTop: 0 }}>
              Su cuenta pide un código de un solo uso al iniciar sesión. Para desactivarla necesitará un código válido de
              su aplicación.
            </p>
            <button className="btn sm" onClick={() => setDesactivando(true)} disabled={loading}>
              Desactivar 2FA
            </button>
          </div>
        )}

        {/* 2FA ACTIVA · confirmar desactivación */}
        {activo && desactivando && (
          <form onSubmit={confirmarDesactivacion}>
            <p className="subtitle" style={{ marginTop: 0 }}>
              Introduzca un código actual de su aplicación autenticadora para confirmar la desactivación.
            </p>
            <div className="field" style={{ maxWidth: 240 }}>
              <label>Código de verificación <span className="req">*</span></label>
              <input
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                value={codigoOff}
                onChange={(e) => setCodigoOff(e.target.value.replace(/\D/g, "").slice(0, 8))}
              />
            </div>
            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              <button className="btn outline sm" type="submit" disabled={loading || codigoOff.length < 6}>
                {loading ? "Verificando…" : "Confirmar desactivación"}
              </button>
              <button
                className="btn sm"
                type="button"
                onClick={() => {
                  setDesactivando(false);
                  setCodigoOff("");
                  setError("");
                }}
                disabled={loading}
              >
                Cancelar
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
