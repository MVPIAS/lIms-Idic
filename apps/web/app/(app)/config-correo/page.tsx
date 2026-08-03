"use client";

/**
 * Zona de administrador · CONFIGURACIÓN DE CORREO (SMTP).
 *
 * Habilitador del futuro módulo de mensajería. Solo accesible con el permiso de
 * administración de sistema (`admin.usuarios` en el backend).
 *
 * ON-PREMISE: el `host` es el RELAY SMTP INTERNO del IDIC (LAN, sin internet),
 * no un SMTP público. La contraseña guardada nunca se re-descarga: si ya hay una
 * definida, el campo muestra un marcador y solo se sobrescribe si el admin teclea
 * una nueva.
 */

import { useEffect, useState } from "react";
import { errorMensaje } from "@/lib/apiError";
import { validarFormulario, validarCampo, propsInput, esEntero } from "@/lib/validate";

const errStyle = { color: "#c0392b", fontSize: 11, marginTop: 2, display: "block" } as const;

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const auth = () => ({
  Authorization: `Bearer ${localStorage.getItem("lims_token")}`,
  "Content-Type": "application/json",
});

interface ConfigCorreo {
  host: string;
  puerto: number;
  seguridad: "none" | "starttls" | "tls";
  usuario: string;
  passwordDefinida: boolean;
  password: string;
  remitenteNombre: string;
  remitenteEmail: string;
  activo: boolean;
}

export default function ConfigCorreoPage() {
  const [cfg, setCfg] = useState<ConfigCorreo | null>(null);
  // Contraseña que teclea el admin. Vacía => conservar la existente.
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);

  // Envío de prueba.
  const [destinatario, setDestinatario] = useState("");
  const [probando, setProbando] = useState(false);
  const [resultadoPrueba, setResultadoPrueba] = useState<
    { ok: boolean; error?: string; messageId?: string } | null
  >(null);

  async function cargar() {
    setError("");
    try {
      const res = await fetch(`${API}/config/correo`, { headers: auth() });
      if (!res.ok) throw new Error(await errorMensaje(res));
      const data = (await res.json()) as ConfigCorreo;
      setCfg(data);
      setPassword("");
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => {
    cargar();
  }, []);

  function set<K extends keyof ConfigCorreo>(key: K, val: ConfigCorreo[K]) {
    setCfg((c) => (c ? { ...c, [key]: val } : c));
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!cfg) return;
    setError("");
    setOk("");
    // Validación de negocio: host y email del remitente con sus reglas + puerto entero 1-65535.
    const errs = validarFormulario(
      [
        { campo: "host", requerido: true },
        { campo: "remitenteEmail", tipo: "email" },
      ],
      cfg,
    );
    const puertoStr = String(cfg.puerto ?? "").trim();
    if (!puertoStr) errs.puerto = "Campo obligatorio";
    else if (!esEntero(puertoStr) || Number(puertoStr) < 1 || Number(puertoStr) > 65535)
      errs.puerto = "Puerto no válido (entero entre 1 y 65535)";
    setErrores(errs);
    if (Object.keys(errs).length) return;
    setGuardando(true);
    try {
      const body: any = {
        host: cfg.host,
        puerto: cfg.puerto,
        seguridad: cfg.seguridad,
        usuario: cfg.usuario,
        remitenteNombre: cfg.remitenteNombre,
        remitenteEmail: cfg.remitenteEmail,
        activo: cfg.activo,
      };
      // Solo se envía la clave si el admin tecleó una nueva; en otro caso se
      // conserva la existente en el backend.
      if (password.trim()) body.password = password;

      const res = await fetch(`${API}/config/correo`, {
        method: "PUT",
        headers: auth(),
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await errorMensaje(res));
      const data = (await res.json()) as ConfigCorreo;
      setCfg(data);
      setPassword("");
      setOk("Configuración de correo guardada correctamente.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  async function probar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setResultadoPrueba(null);
    const eDest = validarCampo("email", destinatario, true);
    if (eDest) {
      setResultadoPrueba({ ok: false, error: `Destinatario: ${eDest}` });
      return;
    }
    setProbando(true);
    try {
      const res = await fetch(`${API}/config/correo/probar`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ destinatario }),
      });
      if (!res.ok) throw new Error(await errorMensaje(res));
      const data = await res.json();
      setResultadoPrueba(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setProbando(false);
    }
  }

  return (
    <div>
      <h1 className="page">Configuración de Correo</h1>
      <p className="subtitle">
        Parámetros del servidor SMTP con el que el sistema enviará avisos (habilitador del módulo de
        mensajería). En la instalación on-premise del IDIC el <b>host</b> es el relay SMTP interno de
        la institución, alcanzable dentro de la LAN (el servidor no tiene salida a internet).
      </p>

      {error && <div className="alert warn">{error}</div>}
      {ok && <div className="alert success">{ok}</div>}

      {cfg && (
        <form className="card" onSubmit={guardar}>
          <h2>Servidor SMTP</h2>
          <div className="form-grid">
            <div className="field span-2">
              <label>
                Host <span className="req">*</span>
              </label>
              <input
                required
                value={cfg.host}
                onChange={(e) => set("host", e.target.value)}
                placeholder="smtp.idic.local"
              />
              {errores.host && <small style={errStyle}>{errores.host}</small>}
            </div>
            <div className="field">
              <label>
                Puerto <span className="req">*</span>
              </label>
              <input
                {...propsInput("entero")}
                required
                min={1}
                max={65535}
                value={cfg.puerto}
                onChange={(e) => set("puerto", Number(e.target.value))}
                placeholder="587"
              />
              {errores.puerto && <small style={errStyle}>{errores.puerto}</small>}
            </div>
            <div className="field">
              <label>Seguridad</label>
              <select
                value={cfg.seguridad}
                onChange={(e) => set("seguridad", e.target.value as ConfigCorreo["seguridad"])}
              >
                <option value="none">Ninguna (sin cifrado)</option>
                <option value="starttls">STARTTLS</option>
                <option value="tls">TLS / SSL</option>
              </select>
            </div>
            <div className="field">
              <label>Usuario</label>
              <input
                value={cfg.usuario}
                onChange={(e) => set("usuario", e.target.value)}
                placeholder="cuenta@idic.local"
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label>Contraseña</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={cfg.passwordDefinida ? "•••• (sin cambios)" : "Contraseña del relay"}
                autoComplete="new-password"
              />
            </div>
          </div>

          <h2 style={{ marginTop: 16 }}>Remitente</h2>
          <div className="form-grid cols-2">
            <div className="field">
              <label>Nombre del remitente</label>
              <input
                value={cfg.remitenteNombre}
                onChange={(e) => set("remitenteNombre", e.target.value)}
                placeholder="LIMS IDIC"
              />
            </div>
            <div className="field">
              <label>Correo del remitente</label>
              <input
                {...propsInput("email")}
                value={cfg.remitenteEmail}
                onChange={(e) => set("remitenteEmail", e.target.value)}
                placeholder="no-reply@idic.local"
              />
              {errores.remitenteEmail && <small style={errStyle}>{errores.remitenteEmail}</small>}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
            <label
              style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, cursor: "pointer" }}
            >
              <input
                type="checkbox"
                checked={cfg.activo}
                onChange={(e) => set("activo", e.target.checked)}
              />
              Configuración activa (habilita el envío de correos)
            </label>
          </div>

          <div style={{ marginTop: 14 }}>
            <button className="btn primary" type="submit" disabled={guardando}>
              {guardando ? "Guardando…" : "Guardar configuración"}
            </button>
          </div>
        </form>
      )}

      {cfg && (
        <form className="card" onSubmit={probar}>
          <h2>Enviar correo de prueba</h2>
          <p className="subtitle" style={{ marginTop: 0 }}>
            Envía un mensaje de prueba con la configuración <b>guardada</b> para verificar la conexión
            con el relay SMTP. Guarde antes de probar si acaba de cambiar algún parámetro.
          </p>
          <div className="form-grid cols-2">
            <div className="field">
              <label>Destinatario</label>
              <input
                type="email"
                value={destinatario}
                onChange={(e) => setDestinatario(e.target.value)}
                placeholder="destinatario@idic.local"
                required
              />
            </div>
            <div className="field" style={{ justifyContent: "flex-end" }}>
              <button className="btn outline" type="submit" disabled={probando || !destinatario}>
                {probando ? "Enviando…" : "Enviar prueba"}
              </button>
            </div>
          </div>

          {resultadoPrueba && (
            <div
              className={`alert ${resultadoPrueba.ok ? "success" : "warn"}`}
              style={{ marginTop: 12, marginBottom: 0 }}
            >
              {resultadoPrueba.ok
                ? `Correo de prueba enviado correctamente${
                    resultadoPrueba.messageId ? ` (id: ${resultadoPrueba.messageId})` : ""
                  }.`
                : `No se pudo enviar: ${resultadoPrueba.error ?? "error desconocido"}`}
            </div>
          )}
        </form>
      )}
    </div>
  );
}
