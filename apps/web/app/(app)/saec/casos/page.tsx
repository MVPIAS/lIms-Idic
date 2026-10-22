"use client";

/**
 * SAEC · Casos (EP-11 11.35): número, descripción, evidencias asociadas,
 * comentarios y estado con transiciones controladas por el servidor
 * (abierto → en proceso → cerrado → archivado; reabrir con motivo; no se cierra
 * con evidencias prestadas). Compartimento D11. API: /saec/casos
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader, EmptyState, SkeletonRows } from "@/components/ui/PageHeader";
import RequierePermiso from "@/components/RequierePermiso";
import { toast } from "@/components/ui/feedback";
import { usePermisos } from "@/lib/permisos";
import { fecha, fechaHora } from "@/lib/format";
import { pedir } from "@/lib/d11";

const ESTADO: Record<string, { texto: string; pill: string }> = {
  abierto: { texto: "Abierto", pill: "blue" },
  en_proceso: { texto: "En proceso", pill: "amber" },
  cerrado: { texto: "Cerrado", pill: "green" },
  archivado: { texto: "Archivado", pill: "gray" },
};
/** Espejo de las transiciones del servidor (reglas-saec.ts): solo para pintar los botones. */
const SIGUIENTES: Record<string, { hacia: string; boton: string; motivo?: boolean }[]> = {
  abierto: [{ hacia: "en_proceso", boton: "Iniciar → en proceso" }, { hacia: "cerrado", boton: "Cerrar caso" }],
  en_proceso: [{ hacia: "cerrado", boton: "Cerrar caso → archivo" }],
  cerrado: [{ hacia: "archivado", boton: "Archivar" }, { hacia: "en_proceso", boton: "Reabrir", motivo: true }],
  archivado: [],
};
const VACIO = { descripcion: "", agenciaOrigenNombre: "", tipoEventoTexto: "", fechaOcurrencia: "", restringido: false, altoPerfil: false };

export default function CasosPage() {
  return (
    <RequierePermiso perm="caso.ver" titulo="Casos SAEC">
      <Casos />
    </RequierePermiso>
  );
}

function Casos() {
  const { puede } = usePermisos();
  const [filas, setFilas] = useState<any[] | null>(null);
  const [estado, setEstado] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [f, setF] = useState({ ...VACIO });
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    try {
      const r = await pedir<any>("GET", `/saec/casos?limit=200${estado ? `&estado=${estado}` : ""}`);
      setFilas(r.data ?? []);
    } catch (e: any) {
      setError(e.message);
      setFilas([]);
    }
  }, [estado]);
  useEffect(() => {
    cargar();
  }, [cargar]);

  async function crear(ev: React.FormEvent) {
    ev.preventDefault();
    setError("");
    if (!f.descripcion.trim()) return setError("Indique la descripción del caso.");
    try {
      const c = await pedir<any>("POST", "/saec/casos", {
        descripcion: f.descripcion.trim(),
        agenciaOrigenNombre: f.agenciaOrigenNombre || null,
        tipoEventoTexto: f.tipoEventoTexto || null,
        fechaOcurrencia: f.fechaOcurrencia || null,
        restringido: f.restringido,
        altoPerfil: f.altoPerfil,
      });
      toast.ok(`Caso ${c.numero_caso} abierto.`);
      setF({ ...VACIO });
      setNuevo(false);
      setSel(c.id);
      cargar();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div>
      <PageHeader
        icono="🗂"
        titulo="Casos SAEC"
        subtitulo="Causas que agrupan evidencias: estado controlado, comentarios y evidencias asociadas."
        migas={[{ label: "SAEC", href: "/saec" }, { label: "Casos" }]}
        acciones={puede("caso.crear") && <button type="button" className="btn primary" onClick={() => setNuevo((x) => !x)} aria-expanded={nuevo}>{nuevo ? "Cerrar" : "＋ Nuevo caso"}</button>}
      />
      {error && <div className="alert warn" role="alert">{error}</div>}
      {nuevo && (
        <form className="card" onSubmit={crear} style={{ marginBottom: 12 }} aria-label="Nuevo caso" noValidate>
          <div className="form-grid">
            <div className="field span-3"><label htmlFor="ca-d">Descripción <span className="req">*</span></label>
              <textarea id="ca-d" rows={2} value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} /></div>
            <div className="field"><label htmlFor="ca-a">Organismo de origen</label>
              <input id="ca-a" placeholder="Fiscalía, PDI, tribunal" value={f.agenciaOrigenNombre} onChange={(e) => setF({ ...f, agenciaOrigenNombre: e.target.value })} /></div>
            <div className="field"><label htmlFor="ca-t">Tipo de evento</label>
              <input id="ca-t" value={f.tipoEventoTexto} onChange={(e) => setF({ ...f, tipoEventoTexto: e.target.value })} /></div>
            <div className="field"><label htmlFor="ca-f">Fecha de ocurrencia</label>
              <input id="ca-f" type="date" value={f.fechaOcurrencia} onChange={(e) => setF({ ...f, fechaOcurrencia: e.target.value })} /></div>
            <div className="field"><label><input type="checkbox" checked={f.restringido} onChange={(e) => setF({ ...f, restringido: e.target.checked })} style={{ width: "auto" }} /> Acceso restringido</label></div>
            <div className="field"><label><input type="checkbox" checked={f.altoPerfil} onChange={(e) => setF({ ...f, altoPerfil: e.target.checked })} style={{ width: "auto" }} /> Alto perfil</label></div>
          </div>
          <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
            <button className="btn primary sm">Abrir caso → evidencias</button>
          </div>
        </form>
      )}
      <div className="toolbar" style={{ marginBottom: 10 }}>
        <label htmlFor="ca-fe" className="sr-only">Filtrar por estado</label>
        <select id="ca-fe" value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          {Object.entries(ESTADO).map(([k, v]) => <option key={k} value={k}>{v.texto}</option>)}
        </select>
      </div>
      <div className="card card--table">
        <table className="data">
          <thead><tr><th>Caso</th><th>Descripción</th><th>Organismo</th><th className="num">Evidencias</th><th>Estado</th><th>Apertura</th></tr></thead>
          <tbody>
            {filas === null && <SkeletonRows cols={6} />}
            {filas?.map((c) => (
              <tr key={c.id} className={`row-action ${sel === c.id ? "selected" : ""}`} onClick={() => setSel(c.id)}>
                <td>
                  <button type="button" className="codigo" onClick={(e) => { e.stopPropagation(); setSel(c.id); }} style={{ background: "none", border: 0, padding: 0, color: "var(--primary)", textDecoration: "underline", cursor: "pointer", font: "inherit" }}>{c.numero_caso}</button>
                  {c.alto_perfil && <span className="pill red" style={{ marginLeft: 4 }}>Alto perfil</span>}
                </td>
                <td style={{ maxWidth: 340 }}>{c.descripcion ?? c.comentario ?? "—"}</td>
                <td>{c.agencia_origen_nombre ?? "—"}</td>
                <td className="num">{c.total_evidencias}</td>
                <td><span className={`pill ${ESTADO[c.estado]?.pill ?? "gray"}`}>{ESTADO[c.estado]?.texto ?? c.estado}</span></td>
                <td>{fecha(c.created_at)}</td>
              </tr>
            ))}
            {filas?.length === 0 && <tr><td colSpan={6}><EmptyState icono="🗂" titulo="Sin casos" texto="Abra un caso para agrupar las evidencias de una causa." /></td></tr>}
          </tbody>
        </table>
      </div>
      {sel && <DetalleCaso id={sel} onCambio={cargar} />}
    </div>
  );
}

function DetalleCaso({ id, onCambio }: { id: string; onCambio: () => void }) {
  const { puede } = usePermisos();
  const edita = puede("caso.editar");
  const [c, setC] = useState<any | null>(null);
  const [motivo, setMotivo] = useState("");
  const [comentario, setComentario] = useState("");

  const cargar = useCallback(() => {
    pedir<any>("GET", `/saec/casos/${id}`).then(setC).catch((e) => toast.error(e.message));
  }, [id]);
  useEffect(() => {
    setC(null);
    cargar();
  }, [cargar]);

  async function cambiar(hacia: string) {
    try {
      await pedir("POST", `/saec/casos/${id}/estado`, { estado: hacia, motivo: motivo.trim() || null });
      toast.ok(`Caso ${ESTADO[hacia]?.texto.toLowerCase() ?? hacia}.`);
      setMotivo("");
      cargar();
      onCambio();
    } catch (e: any) {
      toast.error(e.message);
    }
  }
  async function comentar() {
    try {
      await pedir("POST", `/saec/casos/${id}/comentarios`, { texto: comentario.trim() });
      setComentario("");
      cargar();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  if (!c) return <div className="card" style={{ marginTop: 12, color: "var(--muted)" }}>Cargando el caso…</div>;
  const siguientes = SIGUIENTES[c.estado] ?? [];
  return (
    <section className="card" style={{ marginTop: 12 }} aria-label={`Caso ${c.numero_caso}`}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 16, flex: 1 }}>Caso <span className="codigo">{c.numero_caso}</span></h2>
        <span className={`pill ${ESTADO[c.estado]?.pill ?? "gray"}`}>{ESTADO[c.estado]?.texto ?? c.estado}</span>
      </div>
      <p style={{ margin: "6px 0 10px" }}>{c.descripcion ?? c.comentario ?? "Sin descripción."}</p>
      {edita && siguientes.length > 0 && (
        <div className="toolbar" style={{ marginBottom: 10 }}>
          {siguientes.some((s) => s.motivo) && (
            <input aria-label="Motivo (obligatorio para reabrir)" placeholder="Motivo (obligatorio para reabrir)" value={motivo} onChange={(e) => setMotivo(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
          )}
          {siguientes.map((s) => (
            <button key={s.hacia} type="button" className={`btn sm ${s.hacia === "cerrado" ? "primary" : "outline"}`} disabled={s.motivo && !motivo.trim()} onClick={() => cambiar(s.hacia)}>{s.boton}</button>
          ))}
        </div>
      )}
      {c.estado === "archivado" && <p style={{ color: "var(--muted)", fontSize: 12 }}>Caso archivado: es el estado final.</p>}

      <h3 style={{ fontSize: 13, margin: "12px 0 6px" }}>Evidencias asociadas ({c.evidencias?.length ?? 0})</h3>
      <table className="data">
        <thead><tr><th>Código · NUE</th><th>Tipo</th><th>Descripción</th><th>Estado</th></tr></thead>
        <tbody>
          {(c.evidencias ?? []).map((e: any) => (
            <tr key={e.id}>
              <td><Link className="codigo" href={`/saec/evidencias/${e.id}` as any}>{e.codigo}</Link>{e.nue && <small style={{ display: "block" }}>NUE {e.nue}</small>}</td>
              <td>{e.tipo}</td>
              <td>{e.descripcion ?? "—"}</td>
              <td>{e.estado}</td>
            </tr>
          ))}
          {!(c.evidencias ?? []).length && <tr><td colSpan={4} style={{ color: "var(--muted)" }}>Sin evidencias. Se asocian al registrarlas desde el oficio (SAEC › Nueva evidencia).</td></tr>}
        </tbody>
      </table>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginTop: 12 }}>
        <div>
          <h3 style={{ fontSize: 13, margin: "0 0 6px" }}>Comentarios</h3>
          {edita && (
            <div className="toolbar" style={{ marginBottom: 6 }}>
              <input aria-label="Nuevo comentario" placeholder="Nuevo comentario" value={comentario} onChange={(e) => setComentario(e.target.value)} style={{ flex: 1 }} />
              <button type="button" className="btn sm" disabled={!comentario.trim()} onClick={comentar}>Agregar</button>
            </div>
          )}
          {(c.comentarios ?? []).map((m: any) => (
            <div key={m.id} style={{ borderBottom: "1px solid var(--border)", padding: "6px 0", fontSize: 12.5 }}>
              <small style={{ color: "var(--muted)" }}>{fechaHora(m.created_at)} · {m.autor_nombre ?? "—"}</small>
              <div>{m.texto}</div>
            </div>
          ))}
          {!(c.comentarios ?? []).length && <p style={{ color: "var(--muted)", fontSize: 12 }}>Sin comentarios.</p>}
        </div>
        <div>
          <h3 style={{ fontSize: 13, margin: "0 0 6px" }}>Historial de estados</h3>
          {(c.transiciones ?? []).map((t: any, i: number) => (
            <div key={i} style={{ borderBottom: "1px solid var(--border)", padding: "6px 0", fontSize: 12.5 }}>
              <small style={{ color: "var(--muted)" }}>{fechaHora(t.created_at)} · {t.usuario_nombre ?? "—"}</small>
              <div>{ESTADO[t.desde]?.texto ?? t.desde} → <b>{ESTADO[t.hacia]?.texto ?? t.hacia}</b>{t.motivo ? ` · ${t.motivo}` : ""}</div>
            </div>
          ))}
          {!(c.transiciones ?? []).length && <p style={{ color: "var(--muted)", fontSize: 12 }}>Abierto el {fecha(c.created_at)}; sin cambios de estado.</p>}
        </div>
      </div>
    </section>
  );
}
