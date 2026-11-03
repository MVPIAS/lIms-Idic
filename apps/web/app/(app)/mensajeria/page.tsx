"use client";

/**
 * Módulo MENSAJERÍA · correo con el cliente + historial (contrato §4.5.4/§4.5.5/
 * §4.5.6, alertas §4.2.6).
 *
 * Historial de todos los correos (cotización con PDF, resultado, correos
 * automáticos por etapa, correos libres con adjuntos, copias de mensajes
 * internos) con búsqueda por remitente, destinatario, asunto, urgencia,
 * adjuntos, palabras clave y fechas. Formulario para enviar con plantilla o un
 * correo libre con adjuntos vinculado a una OT.
 *
 * Reutiliza el MailService/relay SMTP del tenant en el backend. Si no hay
 * servidor de correo configurado, el envío queda registrado como «sin servidor
 * de correo» sin afectar al resto de la aplicación.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import DataTable, { type DataColumn } from "@/components/DataTable";
import { fechaHora } from "@/lib/format";
import { errorMensaje } from "@/lib/apiError";
import { esEmail, propsInput } from "@/lib/validate";
import { usePermisos } from "@/lib/permisos";
import { subirFormulario, descargarAdjunto } from "@/lib/d11";
import { toast } from "@/components/ui/feedback";

const errStyle = { color: "#c0392b", fontSize: 11, marginTop: 2, display: "block" } as const;

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const auth = () => ({
  Authorization: `Bearer ${localStorage.getItem("lims_token")}`,
  "Content-Type": "application/json",
});

const TIPOS: { key: string; label: string; pill: string }[] = [
  { key: "cotizacion", label: "Cotización", pill: "blue" },
  { key: "resultado", label: "Resultado", pill: "teal" },
  { key: "etapa", label: "Automático por etapa", pill: "amber" },
  { key: "otro", label: "Correo libre", pill: "gray" },
  { key: "mensaje", label: "Copia de mensaje interno", pill: "gray" },
  { key: "aviso", label: "Aviso interno", pill: "gray" },
];
const TIPO_META = Object.fromEntries(TIPOS.map((t) => [t.key, t]));
const PRIORIDAD: Record<string, { label: string; pill: string }> = {
  normal: { label: "Normal", pill: "gray" },
  alta: { label: "Alta", pill: "amber" },
  urgente: { label: "Urgente", pill: "red" },
};

interface Plantilla {
  clave: string;
  tipo: string;
  nombre: string;
  asunto: string;
  activa: boolean;
}

interface Adjunto {
  id?: string;
  nombre: string;
  bytes: number;
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
  prioridad: string;
  n_adjuntos: number;
  adjuntos: Adjunto[] | null;
  cotizacion_codigo: string | null;
  ot_codigo: string | null;
  cliente_nombre: string | null;
  muestra_codigo: string | null;
  enviado_por_nombre: string | null;
  created_at: string;
}

const FILTROS_VACIOS = { remitente: "", destinatario: "", asunto: "", prioridad: "", adjuntos: "", q: "", desde: "", hasta: "" };

export default function MensajeriaPage() {
  const { puede } = usePermisos();
  const [rows, setRows] = useState<Correo[]>([]);
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [abierto, setAbierto] = useState<Correo | null>(null);

  // filtros (§4.5.6)
  const [fTipo, setFTipo] = useState("");
  const [fEstado, setFEstado] = useState("");
  const [f, setF] = useState(FILTROS_VACIOS);
  const [avanzada, setAvanzada] = useState(false);

  // formulario de envío
  const [show, setShow] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; estado: string; error?: string } | null>(null);
  const [envTipo, setEnvTipo] = useState<"libre" | "cotizacion" | "resultado">("libre");
  const [envId, setEnvId] = useState("");
  const [envPlantilla, setEnvPlantilla] = useState("");
  const [envDest, setEnvDest] = useState("");
  const [envVeredicto, setEnvVeredicto] = useState("");
  const [envAsunto, setEnvAsunto] = useState("");
  const [envCuerpo, setEnvCuerpo] = useState("");
  const [envOt, setEnvOt] = useState("");
  const [envPrioridad, setEnvPrioridad] = useState("normal");
  const [envArchivos, setEnvArchivos] = useState<File[]>([]);
  const [errDest, setErrDest] = useState("");

  async function cargar(filtros = f) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (fTipo) params.set("tipo", fTipo);
      if (fEstado) params.set("estado", fEstado);
      for (const [k, v] of Object.entries(filtros)) if (v.trim()) params.set(k, v.trim());
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
      if (res.ok) setPlantillas(((await res.json()).data ?? []).filter((p: Plantilla) => p.activa));
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
      errores: rows.filter((r) => r.estado !== "enviado").length,
      urgentes: rows.filter((r) => r.prioridad === "urgente").length,
    }),
    [rows],
  );

  const plantillasDelTipo = plantillas.filter((p) => p.tipo === envTipo);
  const set = (k: keyof typeof FILTROS_VACIOS) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setErrDest("");
    // Con plantilla el destinatario es opcional (vacío = email del cliente); el
    // correo libre lo exige. Cada dirección debe tener formato de email válido.
    const lista = envDest.split(/[,;]/).map((d) => d.trim()).filter(Boolean);
    const invalidos = lista.filter((d) => !esEmail(d));
    if (invalidos.length) return setErrDest(`Email(s) no válido(s): ${invalidos.join(", ")}`);
    if (envTipo === "libre" && !lista.length) return setErrDest("Indique al menos un destinatario.");
    setEnviando(true);
    setResultado(null);
    try {
      let data: any;
      if (envTipo === "libre") {
        const fd = new FormData();
        fd.append("destinatarios", lista.join(", "));
        fd.append("asunto", envAsunto);
        fd.append("cuerpo", envCuerpo);
        fd.append("prioridad", envPrioridad);
        if (envOt.trim()) fd.append("otCodigo", envOt.trim());
        envArchivos.forEach((a) => fd.append("adjuntos", a, a.name));
        data = await subirFormulario("/mensajeria/correo", fd);
      } else {
        const url = envTipo === "cotizacion" ? `${API}/mensajeria/cotizacion/${envId.trim()}` : `${API}/mensajeria/resultado/${envId.trim()}`;
        const body: any = { prioridad: envPrioridad };
        if (lista.length) body.destinatarios = lista.join(", ");
        if (envPlantilla) body.plantilla = envPlantilla;
        if (envTipo === "resultado" && envVeredicto.trim()) body.veredicto = envVeredicto.trim();
        const res = await fetch(url, { method: "POST", headers: auth(), body: JSON.stringify(body) });
        if (!res.ok) throw new Error(await errorMensaje(res));
        data = await res.json();
      }
      setResultado({ ok: data.ok, estado: data.estado, error: data.error });
      if (data.ok) {
        setEnvArchivos([]);
        setEnvCuerpo("");
        setEnvAsunto("");
      }
      cargar();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setEnviando(false);
    }
  }

  const estadoPill = (r: Correo) =>
    r.estado === "enviado" ? (
      <span className="pill green">Enviado</span>
    ) : r.estado === "sin_configurar" ? (
      <span className="pill amber" title={r.error ?? ""}>Sin servidor de correo</span>
    ) : (
      <span className="pill red" title={r.error ?? ""}>Error</span>
    );

  const columns: DataColumn[] = [
    {
      key: "created_at",
      label: "Fecha",
      value: (r: Correo) => r.created_at,
      render: (r: Correo) => <span style={{ whiteSpace: "nowrap" }}>{fechaHora(r.created_at)}</span>,
    },
    {
      key: "tipo",
      label: "Tipo",
      value: (r: Correo) => TIPO_META[r.tipo]?.label ?? r.tipo,
      render: (r: Correo) => <span className={`pill ${TIPO_META[r.tipo]?.pill ?? "gray"}`}>{TIPO_META[r.tipo]?.label ?? r.tipo}</span>,
    },
    {
      key: "asunto",
      label: "Asunto",
      value: (r: Correo) => r.asunto ?? "",
      render: (r: Correo) => (
        <button type="button" onClick={() => setAbierto(r)} style={{ maxWidth: 320, textAlign: "left", background: "none", border: 0, padding: 0, color: "var(--blue)", cursor: "pointer" }}>
          {r.prioridad !== "normal" && <span className={`pill ${PRIORIDAD[r.prioridad]?.pill}`} style={{ marginRight: 6 }}>{PRIORIDAD[r.prioridad]?.label}</span>}
          {r.asunto ?? "—"}
          {r.n_adjuntos > 0 && <span title={`${r.n_adjuntos} adjunto(s)`}> 📎{r.n_adjuntos}</span>}
        </button>
      ),
    },
    {
      key: "destinatarios",
      label: "Destinatarios",
      value: (r: Correo) => r.destinatarios,
      render: (r: Correo) => <span style={{ maxWidth: 240, display: "inline-block", wordBreak: "break-all" }}>{r.destinatarios}</span>,
    },
    {
      key: "referencia",
      label: "Vínculo",
      value: (r: Correo) => [r.cotizacion_codigo, r.ot_codigo, r.muestra_codigo, r.cliente_nombre].filter(Boolean).join(" · "),
      render: (r: Correo) => <>{[r.cotizacion_codigo, r.ot_codigo, r.muestra_codigo].filter(Boolean).join(" · ") || "—"}{r.cliente_nombre && <div style={{ fontSize: 11, color: "var(--muted)" }}>{r.cliente_nombre}</div>}</>,
    },
    { key: "estado", label: "Estado", value: (r: Correo) => r.estado ?? "", render: estadoPill },
    {
      key: "enviado_por_nombre",
      label: "Remitente",
      value: (r: Correo) => r.enviado_por_nombre ?? "",
      render: (r: Correo) => <>{r.enviado_por_nombre ?? "—"}</>,
    },
  ];

  const puedeLibre = puede("correo.enviar");

  return (
    <div>
      <h1 className="page">Mensajería · Correo</h1>
      <p className="subtitle">
        Correos con el cliente: cotizaciones con su PDF, resultados, avisos automáticos por etapa y correos libres con
        adjuntos vinculados a una OT. Todo queda en el historial, que se busca por remitente, destinatario, asunto,
        urgencia, adjuntos o palabras clave. Para escribir a otra persona del instituto use la{" "}
        <Link href="/mensajeria/bandeja">bandeja de mensajes internos</Link>; los textos se editan en{" "}
        <Link href="/mensajeria/plantillas">Plantillas de correo</Link>.
      </p>

      {error && <div className="alert warn">{error}</div>}

      <div className="kpis">
        <div className="kpi k-blue"><div className="lab">Correos</div><div className="val">{kpis.total}</div></div>
        <div className="kpi k-green"><div className="lab">Enviados</div><div className="val">{kpis.enviados}</div></div>
        <div className="kpi k-red"><div className="lab">No enviados</div><div className="val">{kpis.errores}</div></div>
        <div className="kpi k-amber"><div className="lab">Urgentes</div><div className="val">{kpis.urgentes}</div></div>
      </div>

      <form
        className="toolbar"
        style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}
        onSubmit={(e) => { e.preventDefault(); cargar(); }}
      >
        <input placeholder="Palabras clave (asunto, texto, destinatario)…" value={f.q} onChange={set("q")} style={{ minWidth: 260 }} aria-label="Palabras clave" />
        <select value={fTipo} onChange={(e) => setFTipo(e.target.value)} aria-label="Tipo">
          <option value="">Todos los tipos</option>
          {TIPOS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <select value={fEstado} onChange={(e) => setFEstado(e.target.value)} aria-label="Estado">
          <option value="">Todos los estados</option>
          <option value="enviado">Enviado</option>
          <option value="sin_configurar">Sin servidor de correo</option>
          <option value="error">Con error</option>
        </select>
        <button className="btn sm">Buscar</button>
        <button type="button" className="btn outline sm" onClick={() => setAvanzada(!avanzada)}>{avanzada ? "Menos filtros" : "Más filtros"}</button>
        {Object.values(f).some((v) => v) && (
          <button type="button" className="btn outline sm" onClick={() => { setF(FILTROS_VACIOS); cargar(FILTROS_VACIOS); }}>Limpiar</button>
        )}
        <div style={{ flex: 1 }} />
        <button type="button" className="btn primary sm" onClick={() => setShow(!show)}>{show ? "Cerrar" : "＋ Enviar correo"}</button>
        {avanzada && (
          <div className="form-grid" style={{ width: "100%", marginTop: 6 }}>
            <div className="field"><label htmlFor="f-rem">Remitente</label><input id="f-rem" value={f.remitente} onChange={set("remitente")} placeholder="Nombre o correo" /></div>
            <div className="field"><label htmlFor="f-dest">Destinatario</label><input id="f-dest" value={f.destinatario} onChange={set("destinatario")} placeholder="correo@cliente.cl" /></div>
            <div className="field"><label htmlFor="f-asunto">Asunto</label><input id="f-asunto" value={f.asunto} onChange={set("asunto")} /></div>
            <div className="field">
              <label htmlFor="f-prio">Urgencia</label>
              <select id="f-prio" value={f.prioridad} onChange={set("prioridad")}>
                <option value="">Cualquiera</option>
                <option value="normal">Normal</option>
                <option value="alta">Alta</option>
                <option value="urgente">Urgente</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="f-adj">Adjuntos</label>
              <select id="f-adj" value={f.adjuntos} onChange={set("adjuntos")}>
                <option value="">Con o sin adjuntos</option>
                <option value="si">Con adjuntos</option>
                <option value="no">Sin adjuntos</option>
              </select>
            </div>
            <div className="field"><label htmlFor="f-desde">Desde</label><input id="f-desde" type="date" value={f.desde} onChange={set("desde")} /></div>
            <div className="field"><label htmlFor="f-hasta">Hasta</label><input id="f-hasta" type="date" value={f.hasta} onChange={set("hasta")} /></div>
          </div>
        )}
      </form>

      {show && (
        <form onSubmit={enviar} className="card" style={{ marginBottom: 12 }}>
          <h2>Enviar correo</h2>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="e-tipo">Tipo <span className="req">*</span></label>
              <select id="e-tipo" value={envTipo} onChange={(e) => { setEnvTipo(e.target.value as any); setEnvPlantilla(""); setResultado(null); }}>
                {puedeLibre && <option value="libre">Correo libre con adjuntos</option>}
                <option value="cotizacion">Cotización (con PDF adjunto)</option>
                <option value="resultado">Resultado de OT</option>
              </select>
            </div>
            {envTipo !== "libre" ? (
              <>
                <div className="field">
                  <label htmlFor="e-id">{envTipo === "cotizacion" ? "ID de la cotización" : "ID de la orden de trabajo"} <span className="req">*</span></label>
                  <input id="e-id" required placeholder="UUID" value={envId} onChange={(e) => setEnvId(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="e-pl">Plantilla</label>
                  <select id="e-pl" value={envPlantilla} onChange={(e) => setEnvPlantilla(e.target.value)}>
                    <option value="">Predeterminada de la etapa</option>
                    {plantillasDelTipo.map((p) => <option key={p.clave} value={p.clave}>{p.nombre}</option>)}
                  </select>
                </div>
              </>
            ) : (
              <div className="field">
                <label htmlFor="e-ot">OT vinculada</label>
                <input id="e-ot" placeholder="OT-2026-0012 (opcional)" value={envOt} onChange={(e) => setEnvOt(e.target.value)} />
              </div>
            )}
            <div className="field">
              <label htmlFor="e-prio">Urgencia</label>
              <select id="e-prio" value={envPrioridad} onChange={(e) => setEnvPrioridad(e.target.value)}>
                <option value="normal">Normal</option>
                <option value="alta">Alta</option>
                <option value="urgente">Urgente</option>
              </select>
            </div>
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label htmlFor="e-dest">Destinatarios (separados por coma){envTipo === "libre" && <span className="req"> *</span>}</label>
              <input
                id="e-dest"
                {...propsInput("email")}
                type="text"
                placeholder={envTipo === "libre" ? "correo@cliente.cl, otro@cliente.cl" : "Vacío = email del cliente registrado"}
                value={envDest}
                onChange={(e) => { setEnvDest(e.target.value); if (errDest) setErrDest(""); }}
              />
              {errDest && <small style={errStyle}>{errDest}</small>}
            </div>
            {envTipo === "resultado" && (
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="e-ver">Veredicto / resultado</label>
                <input id="e-ver" placeholder="Vacío = estado actual de la OT" value={envVeredicto} onChange={(e) => setEnvVeredicto(e.target.value)} />
              </div>
            )}
            {envTipo === "libre" && (
              <>
                <div className="field" style={{ gridColumn: "1 / -1" }}>
                  <label htmlFor="e-asunto">Asunto <span className="req">*</span></label>
                  <input id="e-asunto" required minLength={3} maxLength={250} value={envAsunto} onChange={(e) => setEnvAsunto(e.target.value)} />
                </div>
                <div className="field" style={{ gridColumn: "1 / -1" }}>
                  <label htmlFor="e-cuerpo">Mensaje <span className="req">*</span></label>
                  <textarea id="e-cuerpo" required rows={6} value={envCuerpo} onChange={(e) => setEnvCuerpo(e.target.value)} />
                </div>
                <div className="field" style={{ gridColumn: "1 / -1" }}>
                  <label htmlFor="e-adj">Adjuntos (hasta 10; 10 MB cada uno · PDF, imágenes, Office, texto, CSV)</label>
                  <input id="e-adj" type="file" multiple onChange={(e) => setEnvArchivos(Array.from(e.target.files ?? []))} />
                  {envArchivos.length > 0 && <small style={{ color: "var(--muted)" }}>{envArchivos.map((a) => a.name).join(", ")}</small>}
                </div>
              </>
            )}
          </div>
          <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="btn primary sm" disabled={enviando || (envTipo !== "libre" && !envId.trim())}>{enviando ? "Enviando…" : "Enviar"}</button>
          </div>
          {resultado && (
            <div className={`alert ${resultado.ok ? "success" : "warn"}`} style={{ marginTop: 12, marginBottom: 0 }}>
              {resultado.ok
                ? "Correo enviado y registrado en el historial."
                : resultado.estado === "sin_configurar"
                  ? "No hay servidor de correo configurado: el correo quedó registrado en el historial como no enviado."
                  : `El correo NO se pudo enviar (registrado como error): ${resultado.error ?? "sin detalle"}`}
            </div>
          )}
        </form>
      )}

      {abierto && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h2 style={{ margin: 0, flex: 1 }}>{abierto.asunto ?? "(sin asunto)"}</h2>
            <button type="button" className="btn outline sm" onClick={() => setAbierto(null)}>Cerrar</button>
          </div>
          <p style={{ fontSize: 12, color: "var(--muted)" }}>
            {fechaHora(abierto.created_at)} · de {abierto.enviado_por_nombre ?? "—"} · a {abierto.destinatarios} · {estadoPill(abierto)}
          </p>
          {abierto.error && <div className="alert warn">{abierto.error}</div>}
          <p style={{ whiteSpace: "pre-wrap" }}>{abierto.cuerpo_resumen ?? ""}</p>
          {(abierto.adjuntos ?? []).length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(abierto.adjuntos ?? []).map((a, i) =>
                a.id ? (
                  <button key={a.id} type="button" className="btn outline sm"
                    onClick={() => descargarAdjunto(`/mensajeria/correos/${abierto.id}/adjuntos/${a.id}`, a.nombre).catch((e) => toast.error(e.message))}>
                    📎 {a.nombre}
                  </button>
                ) : (
                  <span key={i} className="tag">📎 {a.nombre}</span>
                ),
              )}
            </div>
          )}
        </div>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        searchKeys={["asunto", "destinatarios", "referencia"]}
        vacio={<>Sin correos registrados que coincidan con el filtro.</>}
      />
    </div>
  );
}
