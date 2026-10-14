"use client";

/**
 * No conformidades (ISO/IEC 17025 §7.10 · §8.7).
 *   Abierta → En proceso (responsable y plazo) → En verificación (causa raíz y
 *   acción correctiva) → Cerrada (verificación de la eficacia) · Reabierta.
 * Cualquiera del laboratorio puede levantar una (nc.crear); Calidad y las
 * jefaturas la gestionan (nc.gestionar); el responsable asignado registra el
 * análisis. Cada una puede ligarse a una OT, un resultado o un equipo. Se ven las
 * de sus unidades y las transversales (lo impone el servidor).
 * Enlaces: /no-conformidades?nueva=1&otId=…&equipoId=…&resultadoId=… abre el alta
 * con el origen ya puesto. API: /no-conformidades.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { fechaDia, fechaHora } from "@/lib/format";
import { usePermisos } from "@/lib/permisos";
import { PageHeader, EmptyState, SkeletonRows } from "@/components/ui/PageHeader";
import RequierePermiso from "@/components/RequierePermiso";
import { toast } from "@/components/ui/feedback";
import { RECURSO_PERSONAS, etiquetaPersona, type Persona } from "@/lib/personas";

const ESTADO: Record<string, { l: string; c: string }> = {
  abierta: { l: "Abierta", c: "red" },
  en_proceso: { l: "En proceso", c: "amber" },
  verificacion: { l: "En verificación", c: "blue" },
  cerrada: { l: "Cerrada", c: "green" },
  reabierta: { l: "Reabierta", c: "red" },
};
const TIPOS: Record<string, string> = {
  ensayo: "Ensayo / resultado",
  equipo: "Equipo o calibración",
  muestra: "Muestra (recepción, custodia)",
  proceso: "Proceso / procedimiento",
  reclamo_cliente: "Reclamo de cliente",
  auditoria: "Hallazgo de auditoría",
  documental: "Documental",
  otro: "Otro",
};
const CRITICIDAD: Record<string, { l: string; c: string }> = {
  baja: { l: "Baja", c: "gray" },
  media: { l: "Media", c: "blue" },
  alta: { l: "Alta", c: "amber" },
  critica: { l: "Crítica", c: "red" },
};

type Filtro = "abiertas" | "vencidas" | "mias" | "cerrada" | "todas";
const filas = (r: any): any[] => (Array.isArray(r) ? r : r?.data ?? []);

export default function NoConformidadesPage() {
  return (
    <RequierePermiso perm="nc.ver" titulo="las no conformidades">
      <NoConformidades />
    </RequierePermiso>
  );
}

function NoConformidades() {
  const { puede } = usePermisos();
  const [filtro, setFiltro] = useState<Filtro>("abiertas");
  const [buscar, setBuscar] = useState("");
  const [lista, setLista] = useState<any[]>([]);
  const [resumen, setResumen] = useState<{ abiertas: number; vencidas: number; cerradas: number } | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [nueva, setNueva] = useState<null | { otId?: string; equipoId?: string; resultadoId?: string }>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [personas, setPersonas] = useState<Persona[]>([]);

  useEffect(() => {
    api.list<Persona>(RECURSO_PERSONAS, { limit: 500 }).then((r) => setPersonas(r.data ?? [])).catch(() => undefined);
    const qs = new URLSearchParams(window.location.search);
    if (qs.get("nueva")) {
      setNueva({ otId: qs.get("otId") ?? undefined, equipoId: qs.get("equipoId") ?? undefined, resultadoId: qs.get("resultadoId") ?? undefined });
    }
    if (qs.get("abrir")) setSelId(qs.get("abrir"));
  }, []);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const qs = new URLSearchParams();
      if (filtro === "abiertas") qs.set("estado", "abiertas");
      if (filtro === "cerrada") qs.set("estado", "cerrada");
      if (filtro === "vencidas") qs.set("vencidas", "1");
      if (filtro === "mias") qs.set("mias", "1");
      if (buscar.trim()) qs.set("q", buscar.trim());
      const r = await api.getRaw<any>(`no-conformidades?${qs}`);
      setLista(r?.data ?? []);
      setResumen(r?.meta?.resumen ?? null);
      setError("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, [filtro, buscar]);

  useEffect(() => {
    void cargar();
    // `buscar` se aplica con Enter o el botón, no en cada tecla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro]);

  const chips: { f: Filtro; l: string }[] = [
    { f: "abiertas", l: "Abiertas" },
    { f: "vencidas", l: "Plazo vencido" },
    { f: "mias", l: "Mías (responsable o levantadas por mí)" },
    { f: "cerrada", l: "Cerradas" },
    { f: "todas", l: "Todas" },
  ];

  return (
    <div>
      <PageHeader
        icono="⚠"
        titulo="No conformidades"
        subtitulo="Registro y tratamiento de no conformidades: causa raíz, acción correctiva, responsable, plazo, verificación de la eficacia y cierre."
        migas={[{ label: "Laboratorio" }, { label: "No conformidades" }]}
        acciones={puede(["nc.crear", "nc.gestionar"]) ? <button className="btn primary sm" onClick={() => { setNueva({}); setSelId(null); }}>＋ Nueva no conformidad</button> : undefined}
      />
      {error && <div className="alert warn">{error}</div>}

      <div className="toolbar" style={{ flexWrap: "wrap", gap: 6 }}>
        {chips.map(({ f, l }) => (
          <button key={f} className={`btn sm ${filtro === f ? "primary" : "outline"}`} onClick={() => setFiltro(f)}>{l}</button>
        ))}
        <form style={{ display: "flex", gap: 6, flex: 1, minWidth: 220 }} onSubmit={(e) => { e.preventDefault(); void cargar(); }}>
          <input placeholder="Buscar por código, título, descripción u OT…" style={{ flex: 1 }} value={buscar} onChange={(e) => setBuscar(e.target.value)} />
          <button className="btn outline sm" type="submit">Buscar</button>
        </form>
        {resumen && (
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {resumen.abiertas} abiertas · {resumen.vencidas} con plazo vencido
          </span>
        )}
      </div>

      {nueva && (
        <FormNueva
          inicial={nueva}
          personas={personas}
          gestiona={puede("nc.gestionar")}
          onCancelar={() => setNueva(null)}
          onCreada={async (nc) => { setNueva(null); toast.ok(`No conformidad ${nc.codigo} registrada.`); await cargar(); setSelId(nc.id); }}
        />
      )}

      <div className="card card--table">
        <table className="data">
          <thead>
            <tr>
              <th>Código</th><th>Título</th><th>Tipo</th><th>Criticidad</th><th>Unidad</th><th>Origen</th>
              <th>Responsable</th><th>Plazo</th><th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {cargando && lista.length === 0 && <tr><td colSpan={9}><SkeletonRows cols={8} rows={4} /></td></tr>}
            {lista.map((n) => (
              <tr key={n.id} style={{ cursor: "pointer" }} onClick={() => { setSelId(n.id); setNueva(null); }}>
                <td><span className="codigo">{n.codigo}</span></td>
                <td>{n.titulo ?? n.descripcion?.slice(0, 60)}</td>
                <td>{TIPOS[n.tipo] ?? n.tipo ?? "—"}</td>
                <td><span className={`pill ${CRITICIDAD[n.criticidad]?.c ?? "gray"}`}>{CRITICIDAD[n.criticidad]?.l ?? n.criticidad ?? "—"}</span></td>
                <td>{n.unidadCodigo ?? <span style={{ color: "var(--muted)" }}>Transversal</span>}</td>
                <td>{n.otCodigo ? <span className="codigo">{n.otCodigo}</span> : n.equipoCodigo ? <>Equipo {n.equipoCodigo}</> : "—"}</td>
                <td>{n.responsable ?? <span className="pill amber">sin asignar</span>}</td>
                <td>
                  {n.plazoCierre ? fechaDia(n.plazoCierre) : "—"}
                  {n.vencida && <span className="pill red" style={{ marginLeft: 6 }}>vencida</span>}
                </td>
                <td><span className={`pill ${ESTADO[n.estado]?.c ?? "gray"}`}>{ESTADO[n.estado]?.l ?? n.estado}</span></td>
              </tr>
            ))}
            {!cargando && lista.length === 0 && (
              <tr><td colSpan={9}><EmptyState compacto icono="✅" titulo="Sin no conformidades" texto="No hay registros para este filtro." /></td></tr>
            )}
          </tbody>
        </table>
      </div>

      {selId && <Detalle id={selId} personas={personas} onCerrar={() => setSelId(null)} onCambio={cargar} />}
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Alta
 * ------------------------------------------------------------------------ */
function FormNueva({ inicial, personas, gestiona, onCancelar, onCreada }: {
  inicial: { otId?: string; equipoId?: string; resultadoId?: string };
  personas: Persona[];
  gestiona: boolean;
  onCancelar: () => void;
  onCreada: (nc: any) => void;
}) {
  const [f, setF] = useState({
    titulo: "", descripcion: "", tipo: inicial.equipoId ? "equipo" : "ensayo", criticidad: "media",
    otId: inicial.otId ?? "", equipoId: inicial.equipoId ?? "", resultadoId: inicial.resultadoId ?? "",
    responsableId: "", plazoCierre: "",
  });
  const [ots, setOts] = useState<any[]>([]);
  const [equipos, setEquipos] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    // Opcionales: si el perfil no ve OT o equipos, el campo queda vacío.
    api.getRaw<any>("ot?limit=200").then((r) => setOts(filas(r))).catch(() => undefined);
    api.getRaw<any>("equipos?limit=500").then((r) => setEquipos(filas(r))).catch(() => undefined);
  }, []);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (f.titulo.trim().length < 3) return setError("Indique un título breve.");
    if (f.descripcion.trim().length < 5) return setError("Describa la no conformidad.");
    setEnviando(true);
    try {
      const nc = await api.post<any>("/no-conformidades", {
        titulo: f.titulo.trim(),
        descripcion: f.descripcion.trim(),
        tipo: f.tipo,
        criticidad: f.criticidad,
        otId: f.otId || null,
        equipoId: f.equipoId || null,
        resultadoId: f.resultadoId || null,
        ...(gestiona ? { responsableId: f.responsableId || null, plazoCierre: f.plazoCierre || null } : {}),
      });
      onCreada(nc);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form className="card" style={{ borderTop: "3px solid var(--accent)" }} onSubmit={guardar}>
      <h2>Nueva no conformidad</h2>
      {error && <div className="alert warn">{error}</div>}
      <div className="form-grid cols-3">
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="nc-titulo">Título <span className="req">*</span></label>
          <input id="nc-titulo" value={f.titulo} maxLength={200} onChange={(e) => setF({ ...f, titulo: e.target.value })} />
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="nc-desc">Descripción: qué se detectó, dónde y cuándo <span className="req">*</span></label>
          <textarea id="nc-desc" rows={3} value={f.descripcion} maxLength={5000} onChange={(e) => setF({ ...f, descripcion: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="nc-tipo">Tipo</label>
          <select id="nc-tipo" value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
            {Object.entries(TIPOS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="nc-crit">Criticidad</label>
          <select id="nc-crit" value={f.criticidad} onChange={(e) => setF({ ...f, criticidad: e.target.value })}>
            {Object.entries(CRITICIDAD).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="nc-ot">Orden de trabajo (si aplica)</label>
          <select id="nc-ot" value={f.otId} onChange={(e) => setF({ ...f, otId: e.target.value })}>
            <option value="">— ninguna —</option>
            {f.otId && !ots.some((o) => o.id === f.otId) && <option value={f.otId}>OT indicada</option>}
            {ots.map((o) => <option key={o.id} value={o.id}>{o.codigo}{o.cliente?.razonSocial ? ` · ${o.cliente.razonSocial}` : ""}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="nc-eq">Equipo (si aplica)</label>
          <select id="nc-eq" value={f.equipoId} onChange={(e) => setF({ ...f, equipoId: e.target.value })}>
            <option value="">— ninguno —</option>
            {f.equipoId && !equipos.some((x) => x.id === f.equipoId) && <option value={f.equipoId}>Equipo indicado</option>}
            {equipos.map((x) => <option key={x.id} value={x.id}>{x.codigo} · {x.nombre}</option>)}
          </select>
        </div>
        {f.resultadoId && (
          <div className="field">
            <label>Resultado afectado</label>
            <div className="codigo" style={{ padding: "6px 0" }}>{f.resultadoId.slice(0, 8)}…</div>
          </div>
        )}
        {gestiona && (
          <>
            <div className="field">
              <label htmlFor="nc-resp">Responsable del tratamiento</label>
              <select id="nc-resp" value={f.responsableId} onChange={(e) => setF({ ...f, responsableId: e.target.value })}>
                <option value="">— asignar después —</option>
                {personas.map((p) => <option key={p.id} value={p.id}>{etiquetaPersona(p)}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="nc-plazo">Plazo de cierre</label>
              <input id="nc-plazo" type="date" value={f.plazoCierre} onChange={(e) => setF({ ...f, plazoCierre: e.target.value })} />
            </div>
          </>
        )}
      </div>
      <p className="subtitle" style={{ margin: "8px 0 0" }}>
        La unidad se toma de la OT o del equipo; sin ninguno de los dos queda como no conformidad transversal.
        {!gestiona && " Calidad o la jefatura asignarán responsable y plazo."}
      </p>
      <div className="toolbar" style={{ marginTop: 10 }}>
        <button type="button" className="btn outline sm" onClick={onCancelar}>Cancelar</button>
        <div className="spacer" />
        <button type="submit" className="btn primary sm" disabled={enviando}>{enviando ? "Registrando…" : "Registrar no conformidad"}</button>
      </div>
    </form>
  );
}

/* --------------------------------------------------------------------------
 * Detalle: análisis, responsable, plazo y estado
 * ------------------------------------------------------------------------ */
function Detalle({ id, personas, onCerrar, onCambio }: { id: string; personas: Persona[]; onCerrar: () => void; onCambio: () => Promise<void> }) {
  const [nc, setNc] = useState<any | null>(null);
  const [f, setF] = useState<any>({});
  const [comentario, setComentario] = useState("");
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const d = await api.getRaw<any>(`no-conformidades/${id}`);
      setNc(d);
      setF({
        responsableId: d.responsableId ?? "", plazoCierre: d.plazoCierre ?? "",
        causaRaiz: d.causaRaiz ?? "", accionCorrectiva: d.accionCorrectiva ?? "",
        accionPreventiva: d.accionPreventiva ?? "", verificacion: d.verificacion ?? "",
      });
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, [id]);
  useEffect(() => { void cargar(); }, [cargar]);

  if (!nc) return <div className="card">{error ? <div className="alert warn">{error}</div> : "Cargando…"}</div>;
  const cerrada = nc.estado === "cerrada";
  const editable = nc.puede?.editarAnalisis && !cerrada;
  const gestiona = !!nc.puede?.gestionar;

  async function guardar() {
    setOcupado(true);
    setError("");
    try {
      const cuerpo: any = {
        causaRaiz: f.causaRaiz, accionCorrectiva: f.accionCorrectiva,
        accionPreventiva: f.accionPreventiva, verificacion: f.verificacion,
      };
      if (gestiona) {
        cuerpo.responsableId = f.responsableId || null;
        cuerpo.plazoCierre = f.plazoCierre || null;
      }
      await api.patch(`/no-conformidades/${id}`, cuerpo);
      toast.ok("Cambios guardados.");
      await cargar();
      await onCambio();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setOcupado(false);
    }
  }

  async function pasarA(estado: string) {
    setOcupado(true);
    setError("");
    try {
      await api.post(`/no-conformidades/${id}/estado`, { estado, ...(comentario.trim() ? { comentario: comentario.trim() } : {}) });
      toast.ok(`No conformidad ${ESTADO[estado]?.l.toLowerCase() ?? estado}.`);
      setComentario("");
      await cargar();
      await onCambio();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setOcupado(false);
    }
  }

  const siguientes: { estado: string; l: string; clase: string }[] =
    nc.estado === "abierta" || nc.estado === "reabierta"
      ? [{ estado: "en_proceso", l: "Iniciar tratamiento", clase: "primary" }, { estado: "verificacion", l: "Pasar a verificación", clase: "outline" }]
      : nc.estado === "en_proceso"
        ? [{ estado: "verificacion", l: "Pasar a verificación", clase: "primary" }]
        : nc.estado === "verificacion"
          ? [{ estado: "cerrada", l: "Cerrar (acción eficaz)", clase: "success" }, { estado: "en_proceso", l: "Devolver a tratamiento", clase: "outline" }]
          : [{ estado: "reabierta", l: "Reabrir", clase: "outline" }];
  if (nc.estado !== "cerrada" && nc.estado !== "verificacion") siguientes.push({ estado: "cerrada", l: "Cerrar", clase: "success" });

  // Función (no componente): un componente definido aquí se re-montaría en cada
  // tecla y el cuadro de texto perdería el foco.
  const texto = (k: string, l: string, ayuda?: string) => (
    <div className="field" style={{ gridColumn: "1 / -1" }}>
      <label htmlFor={`nc-${k}`}>{l}</label>
      {editable
        ? <textarea id={`nc-${k}`} rows={2} value={f[k]} maxLength={5000} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder={ayuda} />
        : <div style={{ whiteSpace: "pre-wrap", padding: "4px 0" }}>{nc[k] || "—"}</div>}
    </div>
  );

  return (
    <div className="card" style={{ borderTop: "3px solid var(--accent)" }}>
      <div className="toolbar" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>
          <span className="codigo">{nc.codigo}</span> · {nc.titulo ?? "No conformidad"}{" "}
          <span className={`pill ${ESTADO[nc.estado]?.c ?? "gray"}`}>{ESTADO[nc.estado]?.l ?? nc.estado}</span>
          {nc.vencida && <span className="pill red" style={{ marginLeft: 6 }}>plazo vencido</span>}
        </h2>
        <div className="spacer" />
        <button className="btn outline sm" onClick={onCerrar}>Cerrar panel</button>
      </div>
      {error && <div className="alert warn">{error}</div>}

      <p style={{ fontSize: 12.5, margin: "0 0 8px" }}>
        {TIPOS[nc.tipo] ?? nc.tipo} · criticidad {CRITICIDAD[nc.criticidad]?.l.toLowerCase() ?? nc.criticidad} ·{" "}
        {nc.unidadCodigo ? `${nc.unidadCodigo} · ${nc.unidadNombre}` : "transversal"} · levantada por {nc.detectadoPor ?? "—"} el {fechaHora(nc.detectadoAt)}
        {nc.otId && <> · OT <Link href={`/ot/${nc.otId}` as any} className="codigo" style={{ textDecoration: "underline" }}>{nc.otCodigo}</Link></>}
        {nc.equipoId && <> · Equipo {nc.equipoCodigo} {nc.equipoNombre}</>}
        {nc.resultadoId && <> · Resultado <span className="codigo">{String(nc.resultadoId).slice(0, 8)}…</span></>}
      </p>
      <div style={{ whiteSpace: "pre-wrap", marginBottom: 10 }}>{nc.descripcion}</div>

      <div className="form-grid cols-2">
        <div className="field">
          <label htmlFor="nc-d-resp">Responsable</label>
          {gestiona && !cerrada ? (
            <select id="nc-d-resp" value={f.responsableId} onChange={(e) => setF({ ...f, responsableId: e.target.value })}>
              <option value="">— sin asignar —</option>
              {f.responsableId && !personas.some((p) => p.id === f.responsableId) && <option value={f.responsableId}>{nc.responsable ?? "Responsable actual"}</option>}
              {personas.map((p) => <option key={p.id} value={p.id}>{etiquetaPersona(p)}</option>)}
            </select>
          ) : <div style={{ padding: "4px 0" }}>{nc.responsable ?? "—"}</div>}
        </div>
        <div className="field">
          <label htmlFor="nc-d-plazo">Plazo de cierre</label>
          {gestiona && !cerrada
            ? <input id="nc-d-plazo" type="date" value={f.plazoCierre} onChange={(e) => setF({ ...f, plazoCierre: e.target.value })} />
            : <div style={{ padding: "4px 0" }}>{nc.plazoCierre ? fechaDia(nc.plazoCierre) : "—"}</div>}
        </div>
        {texto("causaRaiz", "Causa raíz", "¿Por qué ocurrió? (p. ej. análisis de los 5 porqués)")}
        {texto("accionCorrectiva", "Acción correctiva", "Qué se hace para eliminar la causa")}
        {texto("accionPreventiva", "Acción preventiva (opcional)")}
        {texto("verificacion", "Verificación de la eficacia", "Cómo se comprobó que la acción funcionó")}
      </div>
      {cerrada && (
        <p style={{ fontSize: 12.5 }}>Cerrada por {nc.cerradoPor ?? "—"} el {fechaHora(nc.cerradoAt)}{nc.cierreComentario ? ` · ${nc.cierreComentario}` : ""}</p>
      )}

      <div className="toolbar" style={{ marginTop: 10, flexWrap: "wrap", gap: 6 }}>
        {editable && <button className="btn primary sm" disabled={ocupado} onClick={guardar}>Guardar cambios</button>}
        {gestiona && (
          <>
            <div className="spacer" />
            <input placeholder={cerrada ? "Motivo de la reapertura (obligatorio)" : "Comentario (opcional)"} value={comentario} maxLength={2000}
              onChange={(e) => setComentario(e.target.value)} style={{ minWidth: 220 }} />
            {siguientes.map((s) => (
              <button key={s.estado} className={`btn ${s.clase} sm`} disabled={ocupado} onClick={() => pasarA(s.estado)}>{s.l}</button>
            ))}
          </>
        )}
      </div>
      {gestiona && !cerrada && (
        <p style={{ fontSize: 11, color: "var(--muted)", margin: "6px 0 0" }}>
          Guarde antes de cambiar de estado. Iniciar el tratamiento exige responsable y plazo; pasar a verificación, causa raíz y acción correctiva; cerrar, además, la verificación de la eficacia.
        </p>
      )}
    </div>
  );
}
