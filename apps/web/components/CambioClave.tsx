"use client";

/**
 * Formulario «Cambiar mi contraseña». Lo usan:
 *   · Mi perfil (cambio voluntario),
 *   · la pantalla de ingreso, cuando la contraseña es temporal (alta o
 *     restablecimiento): se pasa `actualConocida` y no se vuelve a pedir,
 *   · el layout de la aplicación, si la sesión aún tiene el cambio pendiente.
 * Las reglas las impone el servidor (POST /auth/cambiar-password); aquí se
 * repiten para avisar antes de enviar.
 */
import { useState } from "react";
import { api } from "@/lib/api";

export const CLAVE_MIN = 10;
export const REGLAS_CLAVE = `Mínimo ${CLAVE_MIN} caracteres, con al menos una letra y un número; distinta de la actual y sin su nombre de usuario.`;

export function erroresClave(nueva: string, actual?: string, username?: string): string[] {
  const e: string[] = [];
  if (nueva.length < CLAVE_MIN) e.push(`Al menos ${CLAVE_MIN} caracteres.`);
  if (!/\p{L}/u.test(nueva)) e.push("Al menos una letra.");
  if (!/\d/.test(nueva)) e.push("Al menos un número.");
  if (actual !== undefined && actual !== "" && nueva === actual) e.push("Debe ser distinta de la actual.");
  const u = (username ?? "").trim().toLowerCase();
  if (u.length >= 3 && nueva.toLowerCase().includes(u)) e.push("No puede contener su nombre de usuario.");
  return e;
}

export default function CambioClave({
  actualConocida,
  username,
  onCambiada,
  textoBoton = "Cambiar contraseña",
}: {
  /** Contraseña actual ya escrita (primer ingreso): no se vuelve a pedir. */
  actualConocida?: string;
  username?: string;
  onCambiada?: () => void;
  textoBoton?: string;
}) {
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repetir, setRepetir] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const claveActual = actualConocida ?? actual;
  const avisos = nueva ? erroresClave(nueva, claveActual, username) : [];

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    if (!claveActual) return setError("Indique su contraseña actual.");
    const errs = erroresClave(nueva, claveActual, username);
    if (errs.length) return setError(errs.join(" "));
    if (nueva !== repetir) return setError("La confirmación no coincide con la nueva contraseña.");
    setEnviando(true);
    try {
      await api.cambiarPassword(claveActual, nueva);
      setOk("Contraseña actualizada. Úsela desde ahora para ingresar.");
      setActual("");
      setNueva("");
      setRepetir("");
      onCambiada?.();
    } catch (err: any) {
      setError(err?.message ?? "No se pudo cambiar la contraseña.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar}>
      {error && <div className="alert warn">{error}</div>}
      {ok && <div className="alert">{ok}</div>}
      {actualConocida === undefined && (
        <div className="field" style={{ maxWidth: 360, marginBottom: 10 }}>
          <label htmlFor="clave-actual">Contraseña actual <span className="req">*</span></label>
          <input id="clave-actual" type="password" autoComplete="current-password" value={actual} onChange={(e) => setActual(e.target.value)} />
        </div>
      )}
      <div className="field" style={{ maxWidth: 360, marginBottom: 10 }}>
        <label htmlFor="clave-nueva">Nueva contraseña <span className="req">*</span></label>
        <input id="clave-nueva" type="password" autoComplete="new-password" value={nueva} onChange={(e) => setNueva(e.target.value)} />
      </div>
      <div className="field" style={{ maxWidth: 360, marginBottom: 6 }}>
        <label htmlFor="clave-repetir">Repita la nueva contraseña <span className="req">*</span></label>
        <input id="clave-repetir" type="password" autoComplete="new-password" value={repetir} onChange={(e) => setRepetir(e.target.value)} />
      </div>
      <p style={{ fontSize: 11.5, color: avisos.length ? "var(--amber)" : "var(--muted)", margin: "4px 0 10px" }}>
        {avisos.length ? `Falta: ${avisos.join(" ")}` : REGLAS_CLAVE}
      </p>
      <button className="btn primary sm" type="submit" disabled={enviando}>
        {enviando ? "Guardando…" : textoBoton}
      </button>
    </form>
  );
}

/** ¿La sesión guardada tiene el cambio de contraseña pendiente? (claim `cambioClave` del JWT) */
export function sesionConCambioPendiente(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const tok = localStorage.getItem("lims_token");
    if (!tok) return false;
    const b64 = tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const p = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
    return p?.cambioClave === true;
  } catch {
    return false;
  }
}
