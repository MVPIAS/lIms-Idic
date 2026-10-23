"use client";

/**
 * Pestaña «Preparación» de la OT (frente r2a):
 *   · DSA (EP-05 F2): 1 Asignar personal y equipos · 2 Preparar la documentación
 *     (formulario por laboratorio, con adjuntos) · 3 Aprobar la documentación
 *     (tarjeta «Pendiente de su aprobación», devolver con comentario, bitácora).
 *   · Todos los laboratorios (T29): preparación y acondicionamiento de cada
 *     muestra con los campos del laboratorio; un bloqueo detiene la captura.
 *
 * API: /formularios/ot/:otId/trabajo (+ /comision, /enviar, /validar, /aprobar,
 * /devolver, /adjuntos) · /formularios/ot/:otId/preparacion(/:muestraId).
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "@/components/ui/feedback";
import { fechaHora } from "@/lib/format";
import { llamar } from "@/lib/laboratorio";
import { abrirProtegido, Bitacora, borrar, Campo, Pasos, subirArchivo, type PasoFormulario } from "./comun";

const LABS_DSA = ["LRB", "LAM", "SEO", "SVM", "LEM"];

export default function PreparacionOt({ otId, laboratorio, onCambio }: { otId: string; laboratorio: string | null; onCambio?: () => void }) {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      {laboratorio && LABS_DSA.includes(laboratorio) && <TrabajoDsa otId={otId} onCambio={onCambio} />}
      <PreparacionMuestras otId={otId} />
    </div>
  );
}

/* ================================================== trabajo del DSA (T26) === */
function TrabajoDsa({ otId, onCambio }: { otId: string; onCambio?: () => void }) {
  const [t, setT] = useState<any>(null);
  const [error, setError] = useState("");
  const [doc, setDoc] = useState<Record<string, any>>({});
  const [comentario, setComentario] = useState("");
  const [paso, setPaso] = useState("documentacion");
  const [ocupado, setOcupado] = useState(false);
  // B-039: al subir o quitar un adjunto se recarga la ficha SIN pisar lo escrito y aún no guardado.
  const cargar = useCallback(async (conservarLoEscrito = false) => {
    try {
      const r = await llamar<any>("GET", `/formularios/ot/${otId}/trabajo`);
      setT(r);
      if (!conservarLoEscrito) setDoc(r.documentacion ?? {});
      setError("");
      return r;
    } catch (e: any) {
      setError(e.message);
      return null;
    }
  }, [otId]);
  useEffect(() => {
    cargar().then((r) => r && setPaso(["en_aprobacion", "validada", "aprobada"].includes(r.estado) ? "aprobacion" : r.comision.inspectores.length || r.comision.equipos.length || r.registro ? "documentacion" : "asignacion"));
  }, [cargar]);
  if (error) return <div className="alert warn">{error}</div>;
  if (!t) return <p className="subtitle">Cargando la preparación del trabajo…</p>;

  const f = t.formulario;
  const editableDoc = t.puedo.preparar;
  // LEM: la aprobación depende de «en terreno»; mientras se edita, manda lo marcado en pantalla.
  const exige: boolean = t.exigeSi && editableDoc ? doc[t.exigeSi] === true : t.exige;
  const destino = t.pasos?.[0]?.rol === "JEFE_SECCION" ? "Jefe de Sección" : "Jefe";
  const pasos: PasoFormulario[] = [
    { clave: "asignacion", titulo: "Asignar personal y equipos", estado: t.comision.equipos.length || t.comision.inspectores.length ? "hecho" : "actual", detalle: `${t.comision.inspectores.length} inspector(es) · ${t.comision.equipos.length} equipo(s)` },
    { clave: "documentacion", titulo: `Preparar · ${f.titulo}`, estado: ["en_aprobacion", "validada", "aprobada", "registrada"].includes(t.estado) ? "hecho" : "actual", detalle: t.textoEstado },
    { clave: "aprobacion", titulo: "Aprobar la documentación", estado: t.estado === "aprobada" ? "hecho" : exige ? "pendiente" : "hecho", detalle: exige ? t.pasos.map((p: any) => p.texto).join(" → ") : "No requiere aprobación" },
  ];
  async function accion(ruta: string, cuerpo: any, ok: string, siguiente?: string) {
    setOcupado(true);
    try {
      await llamar(ruta.endsWith("/trabajo") ? "PUT" : "POST", ruta, cuerpo);
      toast.ok(ok);
      setComentario("");
      await cargar();
      onCambio?.();
      if (siguiente) setPaso(siguiente);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }
  const visible = (c: any) => !c.si || doc[c.si] === true;

  return (
    <div className="card" style={{ margin: 0 }}>
      <h2>Preparación del trabajo · {t.ot.laboratorio} <span className="right">EP-05 2.1–2.3</span></h2>
      {t.exige && t.estado !== "aprobada" && t.bloqueaCaptura && (
        <div className="alert warn">La ejecución (registro de disparos, HCP, captura) espera la aprobación de: {f.titulo}.</div>
      )}
      <Pasos pasos={pasos} activo={paso} onElegir={setPaso} />

      {paso === "asignacion" && <ComisionEquipos otId={otId} t={t} onListo={async () => { await cargar(); setPaso("documentacion"); }} />}

      {paso === "documentacion" && (
        <form onSubmit={(e) => { e.preventDefault(); accion(`/formularios/ot/${otId}/trabajo/enviar`, { documentacion: doc }, exige ? "Enviada a aprobación." : "Documentación registrada.", "aprobacion"); }}>
          <p className="subtitle">Prepara: {f.prepara}. {exige ? `Requiere aprobación antes de ejecutar: ${t.pasos.map((p: any) => p.texto).join(" → ")}.` : t.exigeSi ? "Sin aprobación previa salvo que el trabajo sea en terreno." : "Este laboratorio no la aprueba antes de ejecutar (Parámetros de la operación)."}</p>
          <fieldset disabled={!editableDoc} style={{ border: 0, padding: 0, margin: 0 }}>
            <div className="form-grid">
              {f.campos.filter(visible).map((c: any) => {
                const id = `doc-${c.campo}`;
                const val = doc[c.campo];
                const set = (x: any) => setDoc({ ...doc, [c.campo]: x });
                if (c.tipo === "casilla")
                  return (
                    <div key={c.campo} className="field span-3" style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                      <input id={id} type="checkbox" style={{ width: "auto" }} checked={val === true} onChange={(e) => set(e.target.checked)} />
                      <label htmlFor={id} style={{ margin: 0, textTransform: "none", fontSize: 12.5, letterSpacing: 0 }}>{c.etiqueta}{c.ayuda ? <small style={{ color: "var(--muted)" }}> · {c.ayuda}</small> : null}</label>
                    </div>
                  );
                return (
                  <Campo key={c.campo} id={id} etiqueta={c.etiqueta} req={c.obligatorio} ayuda={c.ayuda} span={c.tipo === "texto_largo" || c.tipo === "amenazas" ? 3 : undefined}>
                    {c.tipo === "texto" && <input id={id} value={val ?? ""} onChange={(e) => set(e.target.value)} maxLength={300} />}
                    {c.tipo === "texto_largo" && <textarea id={id} rows={2} value={val ?? ""} onChange={(e) => set(e.target.value)} maxLength={2000} />}
                    {c.tipo === "fecha" && <input id={id} type="date" value={val ?? ""} onChange={(e) => set(e.target.value)} />}
                    {c.tipo === "entero" && <input id={id} inputMode="numeric" value={val ?? ""} onChange={(e) => set(e.target.value === "" ? null : Number(e.target.value))} />}
                    {c.tipo === "lista" && <select id={id} value={val ?? ""} onChange={(e) => set(e.target.value || null)}><option value="">—</option>{c.opciones.map((o: any) => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}</select>}
                    {c.tipo === "hcp" && <select id={id} value={val ?? ""} onChange={(e) => set(e.target.value || null)}><option value="">—</option>{t.opciones.hcp.map((o: any) => <option key={o.valor} value={o.valor}>{o.valor} · {o.etiqueta}</option>)}</select>}
                    {(c.tipo === "multiple" || c.tipo === "amenazas") && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px" }}>
                        {(c.tipo === "amenazas" ? t.opciones.amenazas : c.opciones).map((o: any) => (
                          <label key={o.valor} style={{ fontSize: 12, display: "flex", gap: 5, alignItems: "center", textTransform: "none", letterSpacing: 0, fontWeight: 400, color: "var(--ink)", margin: 0 }}>
                            <input type="checkbox" style={{ width: "auto" }} checked={(val ?? []).includes(o.valor)} onChange={(e) => set(e.target.checked ? [...(val ?? []), o.valor] : (val ?? []).filter((x: string) => x !== o.valor))} />
                            {o.etiqueta}
                          </label>
                        ))}
                      </div>
                    )}
                  </Campo>
                );
              })}
            </div>
          </fieldset>
          <h3 style={{ fontSize: 12.5, margin: "12px 0 4px" }}>Adjuntos (proyectos de párrafo, oficios, planillas)</h3>
          {t.adjuntos.length === 0 && <p className="subtitle" style={{ margin: 0 }}>Sin adjuntos.</p>}
          <ul style={{ margin: "0 0 6px 18px", fontSize: 12.5 }}>
            {t.adjuntos.map((a: any) => (
              <li key={a.id}>
                <button type="button" className="btn outline sm" onClick={() => abrirProtegido(`/formularios/adjuntos/${a.id}`, a.nombre).catch((e) => toast.error(e.message))}>{a.nombre}</button>{" "}
                <small style={{ color: "var(--muted)" }}>{Math.round(a.bytes / 1024)} KB · {a.subidoPor ?? ""} · {fechaHora(a.createdAt)}</small>
                {editableDoc && <button type="button" className="btn outline sm" style={{ marginLeft: 6 }} onClick={() => borrar(`/formularios/adjuntos/${a.id}`).then(() => cargar(true)).catch((e) => toast.error(e.message))}>Quitar</button>}
              </li>
            ))}
          </ul>
          {editableDoc && (
            <label className="btn outline sm" style={{ cursor: "pointer" }}>
              ＋ Adjuntar PDF o imagen
              <input type="file" accept="application/pdf,image/png,image/jpeg" style={{ display: "none" }} onChange={async (e) => {
                const a = e.target.files?.[0];
                e.target.value = "";
                if (!a) return;
                try { await subirArchivo(`/formularios/ot/${otId}/trabajo/adjuntos`, a); toast.ok("Adjunto guardado. Lo escrito sigue en el formulario: guárdelo o envíelo."); await cargar(true); } catch (err: any) { toast.error(err.message); }
              }} />
            </label>
          )}
          {editableDoc && (
            <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
              <button type="button" className="btn outline" disabled={ocupado} onClick={() => accion(`/formularios/ot/${otId}/trabajo`, { documentacion: doc }, "Borrador guardado.")}>Guardar borrador</button>
              <div className="spacer" />
              <button className="btn primary" disabled={ocupado}>{exige ? `Enviar a aprobación → ${destino}` : "Registrar → ejecutar"}</button>
            </div>
          )}
          {!editableDoc && ["en_aprobacion", "validada", "aprobada"].includes(t.estado) && <p className="subtitle" style={{ marginTop: 8 }}>{t.textoEstado}: la documentación no se modifica (si hay que cambiarla, que la devuelvan).</p>}
        </form>
      )}

      {paso === "aprobacion" && (
        <div>
          {!t.exige ? (
            <p className="subtitle">La documentación de este laboratorio no pasa por aprobación (Administración › Parámetros del sistema › DSA). Estado: {t.textoEstado}.</p>
          ) : (
            <>
              <div className={`rolebanner${t.estado === "aprobada" ? " ok" : ""}`}>
                {t.estado === "aprobada" ? "Documentación aprobada: el trabajo puede ejecutarse." : t.puedo.aprobar || t.puedo.validar ? "Pendiente de su decisión." : `Estado: ${t.textoEstado}.`}
                {" "}Circuito: {t.pasos.map((p: any) => p.texto).join(" → ")}.
              </div>
              <DocumentoRenderizado t={t} />
              {(t.puedo.aprobar || t.puedo.validar || t.puedo.devolver) && (
                <div className="toolbar" style={{ marginTop: 10, marginBottom: 0, alignItems: "flex-end" }}>
                  <div style={{ flex: 1, minWidth: 260 }}><Campo id="com" etiqueta="Comentario (obligatorio para devolver)"><input id="com" value={comentario} onChange={(e) => setComentario(e.target.value)} maxLength={1000} /></Campo></div>
                  {t.puedo.devolver && <button type="button" className="btn outline" disabled={ocupado || comentario.trim().length < 5} onClick={() => accion(`/formularios/ot/${otId}/trabajo/devolver`, { comentario }, "Documentación devuelta.", "documentacion")}>Devolver con comentario</button>}
                  {t.puedo.validar && <button type="button" className="btn primary" disabled={ocupado} onClick={() => accion(`/formularios/ot/${otId}/trabajo/validar`, { comentario }, "Validada: pasa al Jefe DSA.")}>Validar → Jefe DSA</button>}
                  {t.puedo.aprobar && <button type="button" className="btn success" disabled={ocupado} onClick={() => accion(`/formularios/ot/${otId}/trabajo/aprobar`, { comentario }, "Aprobada: el trabajo puede ejecutarse.")}>Aprobar → ejecutar</button>}
                </div>
              )}
            </>
          )}
        </div>
      )}
      <Bitacora eventos={t.eventos} />
    </div>
  );
}

/** La documentación tal como la ve quien aprueba. */
function DocumentoRenderizado({ t }: { t: any }) {
  const f = t.formulario;
  const texto = (c: any, v: any) => {
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) return "—";
    if (c.tipo === "casilla") return v ? "Sí" : "No";
    if (c.tipo === "amenazas") return v.map((x: string) => t.opciones.amenazas.find((a: any) => a.valor === x)?.etiqueta ?? x).join(" · ");
    if (Array.isArray(v)) return v.join(", ");
    if (c.tipo === "fecha") return String(v).split("-").reverse().join("-");
    return String(v);
  };
  const persona = (id: string) => t.personal.find((p: any) => p.id === id)?.nombre ?? "—";
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12, background: "#fafcfd" }}>
      <b style={{ fontSize: 13 }}>{f.titulo} · OT {t.ot.codigo}</b>
      <div style={{ overflowX: "auto", maxWidth: "100%" }}><table className="data" style={{ marginTop: 6 }}>
        <tbody>
          {f.campos.filter((c: any) => !c.si || t.documentacion[c.si] === true).map((c: any) => <tr key={c.campo}><th style={{ width: 260, textTransform: "none", fontSize: 11.5 }}>{c.etiqueta}</th><td>{texto(c, t.documentacion[c.campo])}</td></tr>)}
          <tr><th style={{ textTransform: "none", fontSize: 11.5 }}>Jefe de Comisión · inspectores</th><td>{t.comision.jefeComision ? persona(t.comision.jefeComision) : "—"} · {t.comision.inspectores.map(persona).join(", ") || "—"}</td></tr>
          <tr><th style={{ textTransform: "none", fontSize: 11.5 }}>Equipos reservados</th><td>{t.comision.equipos.map((e: any) => e.codigo).join(", ") || "—"}</td></tr>
          <tr><th style={{ textTransform: "none", fontSize: 11.5 }}>Adjuntos</th><td>{t.adjuntos.map((a: any) => a.nombre).join(", ") || "—"}</td></tr>
        </tbody>
      </table></div>
    </div>
  );
}

/** 2.1 «Asignar → preparar documentación»: Jefe de Comisión, inspectores y equipos reservados. */
export function ComisionEquipos({ otId, t, onListo }: { otId: string; t: any; onListo: () => Promise<void> }) {
  const [jefe, setJefe] = useState<string>(t.comision.jefeComision ?? "");
  const [ins, setIns] = useState<Set<string>>(new Set(t.comision.inspectores));
  const [eqs, setEqs] = useState<Set<string>>(new Set(t.comision.equipos.map((e: any) => e.id)));
  const [ocupado, setOcupado] = useState(false);
  const editable = t.puedo.asignar;
  async function guardar() {
    setOcupado(true);
    try {
      await llamar("PUT", `/formularios/ot/${otId}/trabajo/comision`, { jefeComision: jefe || null, inspectores: [...ins], equipos: [...eqs] });
      toast.ok("Comisión y equipos asignados.");
      await onListo();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }
  return (
    <div>
      <p className="subtitle">Los analistas de la OT se asignan en la pestaña «Asignación». Aquí: inspectores, Jefe de Comisión (SVM) y equipos reservados. Un equipo con la calibración vencida no se puede reservar.</p>
      <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="form-grid cols-2">
          <Campo id="jc" etiqueta="Jefe de Comisión">
            <select id="jc" value={jefe} onChange={(e) => setJefe(e.target.value)}><option value="">—</option>{t.personal.map((p: any) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select>
          </Campo>
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 2 }}>
            <legend style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", fontWeight: 600, marginBottom: 3 }}>Inspectores</legend>
            {t.personal.map((p: any) => (
              <label key={p.id} style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" aria-label={`Inspector: ${p.nombre}`} style={{ width: "auto" }} checked={ins.has(p.id)} onChange={(e) => setIns((s) => { const n = new Set(s); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n; })} /> {p.nombre}
              </label>
            ))}
          </fieldset>
        </div>
        <div style={{ overflowX: "auto", maxWidth: "100%" }}><table className="data" style={{ marginTop: 10 }}>
          <thead><tr><th style={{ width: 36 }} /><th>Equipo</th><th>Nº de serie</th><th>Próxima calibración</th><th>Estado</th></tr></thead>
          <tbody>
            {t.equipos.length === 0 && <tr><td colSpan={5} style={{ color: "var(--muted)" }}>El laboratorio no tiene equipos registrados.</td></tr>}
            {t.equipos.map((e: any) => (
              <tr key={e.id} style={!e.apto ? { color: "var(--muted)" } : undefined}>
                <td><input type="checkbox" aria-label={`Reservar ${e.codigo}`} style={{ width: "auto" }} disabled={!e.apto} checked={eqs.has(e.id)} onChange={(x) => setEqs((s) => { const n = new Set(s); if (x.target.checked) n.add(e.id); else n.delete(e.id); return n; })} /></td>
                <td><span className="codigo">{e.codigo}</span> {e.nombre}</td>
                <td>{e.serie ?? "—"}</td>
                <td>{e.proximaCalibracion ? e.proximaCalibracion.split("-").reverse().join("-") : "—"}</td>
                <td>{e.apto ? <span className="pill green">Apto</span> : <span className="pill red" title={e.motivo}>{e.motivo}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </fieldset>
      {editable && (
        <div className="toolbar" style={{ marginTop: 10, marginBottom: 0 }}>
          <div className="spacer" />
          <button type="button" className="btn primary" disabled={ocupado} onClick={guardar}>Asignar → preparar documentación</button>
        </div>
      )}
    </div>
  );
}

/* ============================================ preparación de muestras (T29) === */
function PreparacionMuestras({ otId }: { otId: string }) {
  const [v, setV] = useState<any>(null);
  const [error, setError] = useState("");
  const [abierta, setAbierta] = useState<string | null>(null);
  const cargar = useCallback(async () => {
    try {
      setV(await llamar<any>("GET", `/formularios/ot/${otId}/preparacion`));
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, [otId]);
  useEffect(() => { cargar(); }, [cargar]);
  if (error) return <div className="alert warn">{error}</div>;
  if (!v) return <p className="subtitle">Cargando la preparación de muestras…</p>;
  return (
    <div className="card" style={{ margin: 0 }}>
      <h2>Preparación y acondicionamiento de muestras <span className="right">EP-01/02/03 3.1 · EP-05 3.3</span></h2>
      <p className="subtitle">Lo que registra cada laboratorio al preparar la muestra (campos en Administración › Parámetros del sistema). Una casilla de control sin marcar, una solución vencida o un equipo no apto bloquean la captura de esa muestra.</p>
      {v.filas.length === 0 && <p className="subtitle" style={{ margin: 0 }}>La OT aún no tiene muestras con ensayos.</p>}
      <div style={{ overflowX: "auto", maxWidth: "100%" }}><table className="data">
        <thead><tr><th>Muestra</th><th>Laboratorio</th><th>Estado</th><th>Probetas</th><th>Registró</th><th /></tr></thead>
        <tbody>
          {v.filas.map((f: any) => {
            const k = `${f.muestra.id}:${f.laboratorio}`;
            const r = f.registro;
            return [
              <tr key={k}>
                <td><span className="codigo">{f.muestra.codigo}</span> {f.muestra.nombre ?? ""}</td>
                <td>{f.laboratorio}{f.obligatoria ? <span className="pill amber" style={{ marginLeft: 4 }}>obligatoria</span> : null}</td>
                <td>{!r ? <span className="pill gray">Sin registrar</span> : r.datos?.bloqueos?.length ? <span className="pill red" title={r.datos.bloqueos.join(" ")}>Bloquea la captura</span> : <span className="pill green">Registrada</span>}</td>
                <td>{r?.datos?.probetas?.length ? <span title={r.datos.probetas.join(", ")}>{r.datos.probetas.length} ({r.datos.probetas[0]}…)</span> : "—"}</td>
                <td style={{ fontSize: 11.5, color: "var(--muted)" }}>{r ? `${r.actualizadoPorNombre ?? ""} · ${fechaHora(r.updatedAt)}` : "—"}</td>
                <td><button type="button" className="btn outline sm" aria-expanded={abierta === k} onClick={() => setAbierta(abierta === k ? null : k)}>{abierta === k ? "Cerrar" : f.puedeEditar ? (r ? "Ver / corregir" : "Registrar") : "Ver"}</button></td>
              </tr>,
              abierta === k ? (
                <tr key={`${k}-f`}><td colSpan={6} style={{ background: "#f8fbfc" }}><FormPreparacion otId={otId} fila={f} equipos={v.equipos} onListo={async () => { await cargar(); }} /></td></tr>
              ) : null,
            ];
          })}
        </tbody>
      </table></div>
    </div>
  );
}

function FormPreparacion({ otId, fila, equipos, onListo }: { otId: string; fila: any; equipos: any[]; onListo: () => Promise<void> }) {
  const previo = fila.registro?.datos?.valores ?? {};
  const [d, setD] = useState<Record<string, any>>(() => ({ ...previo }));
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [eventos, setEventos] = useState<any[]>([]);
  useEffect(() => {
    if (fila.registro?.id) llamar<any[]>("GET", `/formularios/registro/${fila.registro.id}/eventos`).then(setEventos).catch(() => setEventos([]));
  }, [fila.registro?.id, fila.registro?.updatedAt]);
  const ed = fila.puedeEditar;
  const corrige = !!fila.registro;
  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true);
    try {
      const datos: Record<string, any> = {};
      for (const c of fila.campos) {
        const val = d[c.campo];
        if (val === undefined || val === "") continue;
        datos[c.campo] = val;
      }
      const r = await llamar<any>("PUT", `/formularios/ot/${otId}/preparacion/${fila.muestra.id}`, { laboratorio: fila.laboratorio, datos, motivo: motivo || undefined });
      if (r.bloqueos.length) toast.error(`Preparación registrada con bloqueo: ${r.bloqueos.join(" ")}`);
      else toast.ok("Preparación registrada: la muestra puede analizarse.");
      setMotivo("");
      await onListo();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setOcupado(false);
    }
  }
  const eqLab = equipos.filter((e: any) => !e.unidadCodigo || e.unidadCodigo === fila.laboratorio);
  return (
    <form onSubmit={guardar}>
      {fila.registro?.datos?.bloqueos?.length ? <div className="alert warn">Bloquea la captura: {fila.registro.datos.bloqueos.join(" ")}</div> : null}
      <fieldset disabled={!ed} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="form-grid">
          {fila.campos.map((c: any) => {
            const id = `pr-${fila.muestra.id}-${c.campo}`;
            const val = d[c.campo];
            const set = (x: any) => setD({ ...d, [c.campo]: x });
            const etq = <>{c.etiqueta}{c.unidad ? ` (${c.unidad})` : ""}{c.bloquea ? <span className="pill amber" style={{ marginLeft: 4, textTransform: "none" }}>bloquea</span> : null}</>;
            if (c.tipo === "casilla")
              return (
                <div key={c.campo} className="field" style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                  <input id={id} type="checkbox" style={{ width: "auto" }} checked={val === true} onChange={(e) => set(e.target.checked)} />
                  <label htmlFor={id} style={{ margin: 0, textTransform: "none", fontSize: 12.5, letterSpacing: 0 }}>{etq}{c.obligatorio ? <span className="req"> *</span> : null}</label>
                </div>
              );
            return (
              <Campo key={c.campo} id={id} etiqueta={etq} req={c.obligatorio} ayuda={c.ayuda || undefined}>
                {c.tipo === "texto" && <input id={id} value={val ?? ""} onChange={(e) => set(e.target.value)} maxLength={500} />}
                {(c.tipo === "numero" || c.tipo === "entero") && <input id={id} inputMode={c.tipo === "entero" ? "numeric" : "decimal"} value={val == null ? "" : String(val).replace(".", ",")} onChange={(e) => set(e.target.value)} />}
                {c.tipo === "fecha" && <input id={id} type="date" value={(val ?? "").slice(0, 10)} onChange={(e) => set(e.target.value)} />}
                {c.tipo === "fechahora" && <input id={id} type="datetime-local" value={(val ?? "").slice(0, 16)} onChange={(e) => set(e.target.value)} />}
                {c.tipo === "lista" && <select id={id} value={val ?? ""} onChange={(e) => set(e.target.value)}><option value="">—</option>{c.opciones.map((o: any) => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}</select>}
                {c.tipo === "equipo" && (
                  <select id={id} value={val ?? ""} onChange={(e) => set(e.target.value)}>
                    <option value="">—</option>
                    {eqLab.map((x: any) => <option key={x.id} value={x.id}>{x.codigo} · {x.nombre}{x.apto ? "" : ` (${x.motivo})`}</option>)}
                  </select>
                )}
              </Campo>
            );
          })}
        </div>
        {corrige && ed && <div style={{ maxWidth: 520, marginTop: 8 }}><Campo id={`mo-${fila.muestra.id}`} etiqueta="Motivo de la corrección (si cambia lo registrado)"><input id={`mo-${fila.muestra.id}`} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} /></Campo></div>}
      </fieldset>
      {ed && (
        <div className="toolbar" style={{ marginTop: 10, marginBottom: 0 }}>
          <div className="spacer" />
          <button className="btn primary" disabled={ocupado}>{ocupado ? "Guardando…" : "Registrar preparación → análisis"}</button>
        </div>
      )}
      <Bitacora eventos={eventos} />
    </form>
  );
}
