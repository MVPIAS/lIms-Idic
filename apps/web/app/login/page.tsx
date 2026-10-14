"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import AccesosDemo from "./AccesosDemo";
import CambioClave from "@/components/CambioClave";

/**
 * Ingreso en hasta tres pasos:
 *   1. Usuario y contraseña.
 *   2. Código de verificación (solo si la cuenta tiene 2FA: el servidor
 *      responde 401 con `requiere2fa`). Se reenvían usuario y contraseña + código.
 *   3. Cambio de contraseña (solo si la contraseña es temporal: alta o
 *      restablecimiento). Hasta hacerlo, el servidor no deja usar el sistema.
 */
type Paso = "credenciales" | "codigo" | "cambio";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [codigo, setCodigo] = useState("");
  const [paso, setPaso] = useState<Paso>("credenciales");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function entrar(usuario: string, clave: string, totp?: string) {
    setLoading(true);
    setError(null);
    try {
      const r = await api.login(usuario.trim(), clave, totp);
      if (r.debeCambiarPassword) {
        setPaso("cambio");
        return;
      }
      router.push("/inicio");
    } catch (err: any) {
      if (err instanceof ApiError && err.body?.requiere2fa) {
        // Contraseña correcta, falta (o falló) el segundo factor.
        if (paso === "codigo") setError("Código incorrecto o vencido. Escriba el código que muestra ahora su aplicación.");
        setCodigo("");
        setPaso("codigo");
        setTimeout(() => document.getElementById("codigo-2fa")?.focus(), 0);
      } else {
        setError(err?.message ?? "Error al iniciar sesión");
      }
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (paso === "codigo") {
      if (codigo.length < 6) return setError("Escriba el código de 6 dígitos.");
      void entrar(username, password, codigo);
    } else {
      void entrar(username, password);
    }
  }

  function volver() {
    setPaso("credenciales");
    setCodigo("");
    setError(null);
    localStorage.removeItem("lims_token");
  }

  // Acceso de prueba: el perfil elegido carga usuario y contraseña en el
  // formulario; se entra con «Entrar al sistema».
  function entrarDemo(usuario: string, clave: string) {
    setPaso("credenciales");
    setUsername(usuario);
    setPassword(clave);
    setError(null);
    setTimeout(() => document.getElementById("btn-entrar")?.focus(), 0);
  }

  return (
    <div className="login-bg">
      <div className="login-card">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <div style={{ width: 46, height: 46, background: "linear-gradient(135deg,#1d4856,#2c6878)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontFamily: "Georgia,serif", fontSize: 20 }}>
            I
          </div>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--primary)", margin: 0 }}>LIMS IDIC</h1>
            <p style={{ fontSize: 11, color: "var(--muted)", margin: 0 }}>Instituto de Investigaciones y Control · Ejército de Chile</p>
          </div>
        </div>

        {paso === "cambio" ? (
          <>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--primary)", margin: "0 0 4px" }}>Cambie su contraseña</h2>
            <p className="subtitle" style={{ marginBottom: 14 }}>
              Ingresó con una contraseña temporal. Elija una propia para continuar; la temporal dejará de funcionar.
            </p>
            <CambioClave actualConocida={password} username={username.trim()} textoBoton="Guardar y entrar" onCambiada={() => router.push("/inicio")} />
            <button type="button" className="btn outline sm" style={{ marginTop: 12 }} onClick={() => { api.logout(); }}>
              Cancelar y salir
            </button>
          </>
        ) : (
          <form onSubmit={onSubmit}>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--primary)", margin: "0 0 4px" }}>Ingreso al sistema</h2>
            <p className="subtitle" style={{ marginBottom: 14 }}>
              {paso === "codigo" ? "Su cuenta tiene verificación en dos pasos." : "Use sus credenciales institucionales."}
            </p>

            <div className="alert info" style={{ fontSize: 11.5 }}>
              🔐 <b>Autenticación</b> · cuentas locales y, en producción, LDAP/Active Directory · <span className="codigo">ad.ejercito.cl</span>
            </div>

            {paso === "credenciales" ? (
              <>
                <div className="field" style={{ marginBottom: 12 }}>
                  <label htmlFor="login-usuario">Usuario</label>
                  <input id="login-usuario" type="text" value={username} autoFocus autoComplete="username" onChange={(e) => setUsername(e.target.value)} />
                </div>
                <div className="field" style={{ marginBottom: 12 }}>
                  <label htmlFor="login-clave">Contraseña</label>
                  <input id="login-clave" type="password" value={password} autoComplete="current-password" onChange={(e) => setPassword(e.target.value)} />
                </div>
              </>
            ) : (
              <div className="field" style={{ marginBottom: 12 }}>
                <label htmlFor="codigo-2fa">Código de verificación de <span className="codigo">{username.trim()}</span></label>
                <input
                  id="codigo-2fa"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="6 dígitos"
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 8))}
                />
                <small style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                  Ábralo en su aplicación autenticadora (Google Authenticator, Aegis, Authy…). Cambia cada 30 segundos.
                </small>
              </div>
            )}

            {error && <div className="alert warn" style={{ borderLeftColor: "var(--red)", background: "#fdecec", color: "#7d1f1f" }}>{error}</div>}

            <button id="btn-entrar" type="submit" disabled={loading} className="btn primary" style={{ width: "100%", justifyContent: "center", padding: "11px", marginTop: 4 }}>
              {loading ? "Verificando…" : paso === "codigo" ? "Verificar y entrar" : "Entrar al sistema"}
            </button>
            {paso === "codigo" && (
              <button type="button" className="btn outline sm" style={{ marginTop: 8 }} onClick={volver}>← Volver</button>
            )}

            {paso === "credenciales" && <AccesosDemo claveEscrita={password} ocupado={loading} onEntrar={entrarDemo} />}
          </form>
        )}

        <p style={{ fontSize: 11, textAlign: "center", color: "var(--muted)", marginTop: 16 }}>
          Aiuken · LIMS IDIC
        </p>
      </div>
    </div>
  );
}
