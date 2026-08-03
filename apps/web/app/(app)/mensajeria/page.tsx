"use client";

/**
 * Módulo MENSAJERÍA · correo transaccional + historial (contrato §4.5.4/§4.5.5/
 * §4.5.6, alertas §4.2.6).
 *
 * Historial de correos enviados (cotización con PDF / notificación de resultado)
 * con filtros y búsqueda por asunto/destinatario. Incluye un formulario para
 * enviar un correo con plantilla seleccionable y ver el resultado del envío.
 *
 * Reutiliza el MailService/relay SMTP del tenant en el backend. En preprod, si no
 * hay SMTP configurado, el envío se registra con estado "error" sin tumbar nada.
 */

import { useEffect, useMemo, useState } from "react";
import { fecha } from "@/lib/format";
import { errorMensaje } from "@/lib/apiError";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const auth = () => ({
  Authorization: `Bearer ${localStorage.getItem("lims_token")}`,
  "Content-Type": "application/json",
});

const TIPOS: { key: string; label: string; pill: string }[] = [
  { key: "cotizacion", label: "Cotización", pill: "blue" },
  { key: "resultado", label: "Resultado", pill: "teal" },
  { key: "otro", label: "Otro", pill: "gray" },
];
const TIPO_META = Object.fromEntries(TIPOS.map((t) => [t.key, t]));

interface Plantilla {
  clave: string;
  tipo: string;
  nombre: string;
  asunto: string;
}

interface Correo {
  id: string;
  tipo: string;
  destinatarios: string;
  asunto: string | null;
  cuerpo_resumen: string | null;
  plantilla: string | null;
  estado: string;
  error: string | null;
  message_id: string | null;
  cotizacion_codigo: string | null;
  ot_codigo: string | null;
  enviado_por_nombre: string | null;
  created_at: string;
}

export default function MensajeriaPage() {
  const [rows, setRows] = useState<Correo[]>([]);
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // filtros
  const [fTipo, setFTipo] = useState("");
  const [fEstado, setFEstado] = useState("");
  const [q, setQ] = useState("");

  // formulario de envío
  const [show, setShow] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; estado: string; error?: string } | null>(null);
  const [envTipo, setEnvTipo] = useState<"cotizacion" | "resultado">("cotizacion");
  const [envId, setEnvId] = useState("");
  const [envPlantilla, setEnvPlantilla] = useState("");
  const [envDest, setEnvDest] = useState("");
  const [envVeredicto, setEnvVeredicto] = useState("");

  async function cargar() {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (fTipo) params.set("tipo", fTipo);
      if (fEstado) params.set("estado", fEstado);
      if (q) params.set("q", q);
      const res = await fetch(`${API}/mensajeria?${params}`, { headers: auth() });
      if (!res.ok) throw new Error(await errorMensaje(res));
      const data = await res.json();
      setRows(data.data ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function cargarPlantillas() {
    try {
      const res = await fetch(`${API}/mensajeria/plantillas`, { headers: auth() });
      if (res.ok) setPlantillas(await res.json());
    } catch {
      /* silencioso: el selector de plantillas es opcional */
    }
  }

  useEffect(() => {
    cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [fTipo, fEstado]);
  useEffect(() => {
    cargarPlantillas();
  }, []);

  const kpis = useMemo(
    () => ({
      total: rows.length,
      enviados: rows.filter((r) => r.estado === "enviado").length,
      errores: rows.filter((r) => r.estado === "error").length,
    }),
    [rows],
  );

  const plantillasDelTipo = plantillas.filter((p) => p.tipo === envTipo);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setResultado(null);
    setError("");
    try {
      const url =
        envTipo === "cotizacion"
          ? `${API}/mensajeria/cotizacion/${envId.trim()}`
          : `${API}/mensajeria/resultado/${envId.trim()}`;
      const body: any = {};
      if (envDest.trim()) body.destinatarios = envDest.trim();
      if (envPlantilla) body.plantilla = envPlantilla;
      if (envTipo === "resultado" && envVeredicto.trim()) body.veredicto = envVeredicto.trim();

      const res = await fetch(url, { method: "POST", headers: auth(), body: JSON.stringify(body) });
      if (!res.ok) throw new Error(await errorMensaje(res));
      const data = await res.json();
      setResultado({ ok: data.ok, estado: data.estado, error: data.error });
      cargar();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div>
      <h1 className="page">Mensajería · Correo transaccional</h1>
      <p className="subtitle">
        Envío de cotizaciones (con PDF adjunto) y notificaciones de resultado al cliente, con plantilla
        seleccionable, y registro de todos los correos enviados con búsqueda. Usa el relay SMTP configurado
        del sistema; si no hay servidor de correo configurado, el envío se registra como error sin afectar
        al resto de la aplicación.
      </p>

      {error && <div className="alert warn">{error}</div>}

      <div className="kpis">
        <div className="kpi k-blue"><div className="lab">Correos</div><div className="val">{kpis.total}</div></div>
        <div className="kpi k-green"><div className="lab">Enviados</div><div className="val">{kpis.enviados}</div></div>
        <div className="kpi k-red"><div className="lab">Con error</div><div className="val">{kpis.errores}</div></div>
      </div>

      <div className="toolbar" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <input
          placeholder="Buscar por asunto o destinatario…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") cargar(); }}
          style={{ minWidth: 260 }}
        />
        <select value={fTipo} onChange={(e) => setFTipo(e.target.value)}>
          <option value="">Todos los tipos</option>
          {TIPOS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <select value={fEstado} onChange={(e) => setFEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          <option value="enviado">Enviado</option>
          <option value="error">Con error</option>
        </select>
        <button className="btn sm" onClick={() => cargar()}>Buscar</button>
        <div style={{ flex: 1 }} />
        <button className="btn primary sm" onClick={() => (show ? setShow(false) : setShow(true))}>
          {show ? "Cerrar" : "＋ Enviar correo"}
        </button>
      </div>

      {show && (
        <form onSubmit={enviar} className="card" style={{ marginBottom: 12 }}>
          <h2>Enviar correo</h2>
          <div className="form-grid">
            <div className="field">
              <label>Tipo <span className="req">*</span></label>
              <select
                value={envTipo}
                onChange={(e) => { setEnvTipo(e.target.value as any); setEnvPlantilla(""); }}
              >
                <option value="cotizacion">Cotización (con PDF adjunto)</option>
                <option value="resultado">Resultado de OT</option>
              </select>
            </div>
            <div className="field">
              <label>{envTipo === "cotizacion" ? "ID de la cotización" : "ID de la orden de trabajo"} <span className="req">*</span></label>
              <input
                required
                placeholder="UUID"
                value={envId}
                onChange={(e) => setEnvId(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Plantilla</label>
              <select value={envPlantilla} onChange={(e) => setEnvPlantilla(e.target.value)}>
                <option value="">Predeterminada del tipo</option>
                {plantillasDelTipo.map((p) => <option key={p.clave} value={p.clave}>{p.nombre}</option>)}
              </select>
            </div>
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label>Destinatarios (separados por coma)</label>
              <input
                placeholder="Vacío = email del cliente registrado"
                value={envDest}
                onChange={(e) => setEnvDest(e.target.value)}
              />
            </div>
            {envTipo === "resultado" && (
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label>Veredicto / resultado</label>
                <input
                  placeholder="Vacío = estado actual de la OT"
                  value={envVeredicto}
                  onChange={(e) => setEnvVeredicto(e.target.value)}
                />
              </div>
            )}
          </div>
          <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="btn primary sm" disabled={enviando || !envId.trim()}>
              {enviando ? "Enviando…" : "Enviar"}
            </button>
          </div>
          {resultado && (
            <div className={`alert ${resultado.ok ? "success" : "warn"}`} style={{ marginTop: 12, marginBottom: 0 }}>
              {resultado.ok
                ? "Correo enviado correctamente y registrado en el historial."
                : `El correo NO se pudo enviar (registrado como error): ${resultado.error ?? "sin detalle"}`}
            </div>
          )}
        </form>
      )}

      {loading && <div className="card" style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>Cargando…</div>}

      {!loading && (
        <div className="card card--table">
          <table className="data">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>Asunto</th>
                <th>Destinatarios</th>
                <th>Referencia</th>
                <th>Estado</th>
                <th>Enviado por</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{fecha(r.created_at)}</td>
                  <td><span className={`pill ${TIPO_META[r.tipo]?.pill ?? "gray"}`}>{TIPO_META[r.tipo]?.label ?? r.tipo}</span></td>
                  <td style={{ maxWidth: 320 }}>{r.asunto ?? "—"}</td>
                  <td style={{ maxWidth: 260, wordBreak: "break-all" }}>{r.destinatarios}</td>
                  <td>{r.cotizacion_codigo ?? r.ot_codigo ?? "—"}</td>
                  <td>
                    {r.estado === "enviado" ? (
                      <span className="pill green">Enviado</span>
                    ) : (
                      <span className="pill red" title={r.error ?? ""}>Error</span>
                    )}
                  </td>
                  <td>{r.enviado_por_nombre ?? "—"}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--muted)", padding: 18 }}>Sin correos registrados que coincidan con el filtro.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
