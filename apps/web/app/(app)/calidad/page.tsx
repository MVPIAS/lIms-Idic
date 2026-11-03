"use client";

// ===========================================================================
// Calidad del laboratorio (bloque A del contrato). Cuatro pestañas:
//   · Re-análisis (§4.2.6 / §4.3.9): los ensayos que hay que repetir por un No
//     cumple, una advertencia o a pedido del revisor; la jefatura los descarta;
//   · Acreditación ISO/IEC 17025 (§4.3.5): acreditaciones del IDIC y su alcance
//     por método, con vigencia;
//   · POE y advertencia (§4.3.1): procedimiento de cada método (del gestor
//     documental) y su margen de advertencia;
//   · Alícuotas (§4.2.1): porciones de una muestra, su consumo y estado.
// Las reglas viven en el servidor: apps/api/src/calidad/.
// ===========================================================================

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { llamar, qs } from "@/lib/laboratorio";
import { fechaHora } from "@/lib/format";
import { descargarAdjunto } from "@/lib/d11";
import { hoyChile } from "@/lib/fecha-chile";
import { usePermisos } from "@/lib/permisos";
import { toast } from "@/components/ui/feedback";

type Pestana = "reanalisis" | "acreditacion" | "poe" | "alicuotas";

const fechaCl = (f: string | null | undefined) => (f ? f.slice(0, 10).split("-").reverse().join("-") : "—");
const num = (v: unknown) => (v == null || v === "" ? "" : String(v).replace(".", ","));

export default function CalidadPage() {
  const [pestana, setPestana] = useState<Pestana>("reanalisis");
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "acreditacion" || t === "poe" || t === "alicuotas") setPestana(t);
  }, []);
  const tab = (id: Pestana, t: string) => (
    <button type="button" role="tab" aria-selected={pestana === id} className={`tab${pestana === id ? " active" : ""}`} onClick={() => setPestana(id)}>{t}</button>
  );
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page">Calidad del laboratorio</h1>
          <p className="subtitle">
            Re-análisis de resultados, alcance acreditado ISO/IEC 17025, procedimientos (POE) de cada método y alícuotas de las muestras.
          </p>
        </div>
      </div>
      <div className="tabs" role="tablist" style={{ marginBottom: 12 }}>
        {tab("reanalisis", "Re-análisis")}
        {tab("acreditacion", "Acreditación ISO/IEC 17025")}
        {tab("poe", "POE y advertencia por método")}
        {tab("alicuotas", "Alícuotas")}
      </div>
      {pestana === "reanalisis" && <Reanalisis />}
      {pestana === "acreditacion" && <Acreditaciones />}
      {pestana === "poe" && <Poe />}
      {pestana === "alicuotas" && <Alicuotas />}
    </div>
  );
}

/* ============================================================ re-análisis === */

const ESTADO_RE: Record<string, { texto: string; pill: string }> = {
  solicitado: { texto: "Pendiente", pill: "red" },
  realizado: { texto: "Repetido", pill: "green" },
  descartado: { texto: "Descartado", pill: "gray" },
};

function valorDe(v: any) {
  if (!v) return "—";
  const t = v.texto ?? (v.numerico != null ? num(v.numerico) : null);
  const ver = v.veredicto === "no_cumple" ? "No cumple" : v.veredicto === "cumple" ? (v.advertencia ? "Cumple · advertencia" : "Cumple") : v.veredicto ?? "";
  return `${t ?? "—"}${ver ? ` (${ver})` : ""}`;
}

function Reanalisis() {
  const { puede } = usePermisos();
  const [estado, setEstado] = useState("solicitado");
  const [filas, setFilas] = useState<any[] | null>(null);
  const [descartando, setDescartando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const cargar = useCallback(async () => {
    try {
      setFilas(await llamar<any[]>("GET", `/calidad/reanalisis${qs({ estado })}`));
    } catch (e: any) {
      toast.error(e.message);
    }
  }, [estado]);
  useEffect(() => {
    cargar();
  }, [cargar]);
  const descartar = async (id: string) => {
    try {
      await llamar("POST", `/calidad/reanalisis/${id}/descartar`, { motivo: motivo.trim() });
      toast.ok("Re-análisis descartado. El ensayo ya se puede revisar.");
      setDescartando(null);
      setMotivo("");
      cargar();
    } catch (e: any) {
      toast.error(e.message);
    }
  };
  return (
    <section className="card">
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <label htmlFor="re-estado" style={{ fontSize: 13 }}>Ver</label>
        <select id="re-estado" value={estado} onChange={(e) => setEstado(e.target.value)} style={{ width: "auto" }}>
          <option value="solicitado">Pendientes</option>
          <option value="realizado">Repetidos</option>
          <option value="descartado">Descartados</option>
          <option value="todos">Todos</option>
        </select>
        <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
          Un re-análisis pendiente impide revisar y aprobar el ensayo: se repite la determinación (nueva captura) o la jefatura lo descarta con su motivo. Los parámetros están en Catálogo › Parámetros › «Captura · advertencia y re-análisis».
        </span>
      </div>
      {!filas ? (
        <p>Cargando…</p>
      ) : !filas.length ? (
        <p style={{ margin: 0, color: "var(--muted)" }}>No hay re-análisis {estado === "solicitado" ? "pendientes" : "en esta vista"}.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr><th>OT · muestra</th><th>Ensayo</th><th>Motivo</th><th>Valor anterior</th><th>Valor repetido</th><th>Estado</th><th></th></tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id}>
                  <td>
                    {f.otId ? <Link href={`/captura-ot?otId=${f.otId}` as any}>{f.otCodigo}</Link> : "—"}
                    <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{f.muestra}{f.laboratorio ? ` · ${f.laboratorio}` : ""}</div>
                  </td>
                  <td>{f.ensayo}</td>
                  <td style={{ maxWidth: 320 }}>
                    <span className={`pill ${f.origen === "automatico" ? "amber" : "teal"}`}>{f.origen === "automatico" ? "automático" : "pedido por el revisor"}</span>
                    <div style={{ fontSize: 12.5 }}>{f.motivo}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{fechaHora(f.solicitadoAt)}{f.solicitadoPor ? ` · ${f.solicitadoPor}` : ""}</div>
                  </td>
                  <td style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5 }}>{valorDe(f.valorAnterior)}</td>
                  <td style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5 }}>
                    {valorDe(f.valorNuevo)}
                    {f.cierreMotivo && f.estado === "descartado" && <div style={{ fontFamily: "inherit", fontSize: 11.5, color: "var(--muted)" }}>{f.cierreMotivo}</div>}
                  </td>
                  <td><span className={`pill ${ESTADO_RE[f.estado]?.pill ?? "gray"}`}>{ESTADO_RE[f.estado]?.texto ?? f.estado}</span></td>
                  <td>
                    {f.estado === "solicitado" && puede("resultado.aprobar") && (
                      descartando === f.id ? (
                        <div style={{ display: "grid", gap: 4, minWidth: 220 }}>
                          <input aria-label="Motivo del descarte" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (mín. 5 caracteres)" maxLength={500} />
                          <div style={{ display: "flex", gap: 4 }}>
                            <button className="btn sm" disabled={motivo.trim().length < 5} onClick={() => descartar(f.id)}>Descartar</button>
                            <button className="btn outline sm" onClick={() => setDescartando(null)}>Cancelar</button>
                          </div>
                        </div>
                      ) : (
                        <button className="btn outline sm" onClick={() => { setDescartando(f.id); setMotivo(""); }}>Descartar…</button>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ========================================================== acreditación === */

function estadoVigencia(a: { vigenteDesde: string | null; vigenteHasta: string | null }) {
  const hoy = hoyChile();
  if (a.vigenteDesde && a.vigenteDesde > hoy) return { texto: "Aún no vigente", pill: "gray" };
  if (a.vigenteHasta && a.vigenteHasta < hoy) return { texto: "Vencida", pill: "red" };
  if (a.vigenteHasta && (Date.parse(a.vigenteHasta) - Date.parse(hoy)) / 86_400_000 <= 60) return { texto: "Por vencer", pill: "amber" };
  return { texto: "Vigente", pill: "green" };
}

const VACIA = { id: "", organismo: "INN", numero: "", norma: "NCh-ISO/IEC 17025", unidadId: "", vigenteDesde: "", vigenteHasta: "", observacion: "" };

function Acreditaciones() {
  const { puede } = usePermisos();
  const gestiona = puede("acreditacion.gestionar");
  const [lista, setLista] = useState<any[] | null>(null);
  const [unidades, setUnidades] = useState<{ id: string; codigo: string; nombre: string }[]>([]);
  const [form, setForm] = useState<typeof VACIA | null>(null);
  const [alcanceDe, setAlcanceDe] = useState<string | null>(null);
  const cargar = useCallback(async () => {
    try {
      setLista(await llamar<any[]>("GET", "/calidad/acreditaciones"));
    } catch (e: any) {
      toast.error(e.message);
    }
  }, []);
  useEffect(() => {
    cargar();
    llamar<any>("GET", "/unidades")
      .then((r) => setUnidades((Array.isArray(r) ? r : r?.data ?? []).filter((u: any) => u.activo !== false)))
      .catch(() => setUnidades([]));
  }, [cargar]);

  const guardar = async () => {
    if (!form) return;
    try {
      const datos = { ...form, unidadId: form.unidadId || null, vigenteDesde: form.vigenteDesde || null, vigenteHasta: form.vigenteHasta || null };
      if (form.id) await llamar("PATCH", `/calidad/acreditaciones/${form.id}`, datos);
      else await llamar("POST", "/calidad/acreditaciones", datos);
      toast.ok("Acreditación guardada.");
      setForm(null);
      cargar();
    } catch (e: any) {
      toast.error(e.message);
    }
  };
  const borrar = async (a: any) => {
    if (!window.confirm(`¿Dar de baja la acreditación ${a.organismo} ${a.numero}? Sus métodos dejan de figurar como acreditados.`)) return;
    try {
      await llamar("DELETE", `/calidad/acreditaciones/${a.id}`);
      cargar();
    } catch (e: any) {
      toast.error(e.message);
    }
  };
  const quitar = async (a: any, metodoId: string) => {
    try {
      await llamar("DELETE", `/calidad/acreditaciones/${a.id}/alcance/${metodoId}`);
      cargar();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <>
      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", maxWidth: 720 }}>
            Cada acreditación (organismo, número y vigencia) y los métodos de su alcance. En la captura por OT, el ensayo de un método con alcance vigente se marca «Acreditado»; los demás, «No acreditado».
          </p>
          {gestiona && !form && <button className="btn primary sm" onClick={() => setForm({ ...VACIA })}>Nueva acreditación</button>}
        </div>
        {form && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10, marginTop: 12, alignItems: "end" }}>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="ac-org">Organismo</label>
              <input id="ac-org" value={form.organismo} onChange={(e) => setForm({ ...form, organismo: e.target.value })} maxLength={80} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="ac-num">Número</label>
              <input id="ac-num" value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} placeholder="Ej.: LE 123" maxLength={40} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="ac-norma">Norma</label>
              <input id="ac-norma" value={form.norma} onChange={(e) => setForm({ ...form, norma: e.target.value })} maxLength={80} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="ac-uni">Laboratorio</label>
              <select id="ac-uni" value={form.unidadId} onChange={(e) => setForm({ ...form, unidadId: e.target.value })}>
                <option value="">Todo el IDIC</option>
                {unidades.map((u) => <option key={u.id} value={u.id}>{u.codigo} · {u.nombre}</option>)}
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="ac-desde">Vigente desde</label>
              <input id="ac-desde" type="date" value={form.vigenteDesde} onChange={(e) => setForm({ ...form, vigenteDesde: e.target.value })} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="ac-hasta">Vigente hasta</label>
              <input id="ac-hasta" type="date" value={form.vigenteHasta} onChange={(e) => setForm({ ...form, vigenteHasta: e.target.value })} />
            </div>
            <div className="field" style={{ margin: 0, gridColumn: "1 / -1" }}>
              <label htmlFor="ac-obs">Observación</label>
              <input id="ac-obs" value={form.observacion} onChange={(e) => setForm({ ...form, observacion: e.target.value })} maxLength={1000} />
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn primary sm" disabled={!form.numero.trim()} onClick={guardar}>Guardar</button>
              <button className="btn outline sm" onClick={() => setForm(null)}>Cancelar</button>
            </div>
          </div>
        )}
      </section>
      {!lista ? (
        <p>Cargando…</p>
      ) : !lista.length ? (
        <div className="card"><p style={{ margin: 0, color: "var(--muted)" }}>No hay acreditaciones registradas.</p></div>
      ) : (
        lista.map((a) => {
          const v = estadoVigencia(a);
          return (
            <section key={a.id} className="card">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <div>
                  <h2 style={{ margin: "0 0 2px" }}>{a.organismo} {a.numero} <span className={`pill ${v.pill}`} style={{ verticalAlign: "middle" }}>{v.texto}</span></h2>
                  <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
                    {a.norma} · {a.unidad ? `${a.unidad} · ${a.unidadNombre}` : "Todo el IDIC"} · vigente {fechaCl(a.vigenteDesde)} a {fechaCl(a.vigenteHasta)}
                  </div>
                  {a.observacion && <div style={{ fontSize: 12.5, marginTop: 2 }}>{a.observacion}</div>}
                </div>
                {gestiona && (
                  <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                    <button className="btn outline sm" onClick={() => setForm({ ...VACIA, ...a, unidadId: a.unidadId ?? "", vigenteDesde: a.vigenteDesde ?? "", vigenteHasta: a.vigenteHasta ?? "", observacion: a.observacion ?? "" })}>Editar</button>
                    <button className="btn outline sm" onClick={() => setAlcanceDe(alcanceDe === a.id ? null : a.id)}>{alcanceDe === a.id ? "Cerrar" : "Agregar métodos…"}</button>
                    <button className="btn outline sm" onClick={() => borrar(a)}>Dar de baja</button>
                  </div>
                )}
              </div>
              {alcanceDe === a.id && <AgregarAlcance acreditacionId={a.id} onListo={() => { setAlcanceDe(null); cargar(); }} />}
              <div style={{ overflowX: "auto", marginTop: 8 }}>
                <table className="table">
                  <thead><tr><th>Método</th><th>Ensayo</th><th>Matriz</th><th>Rango</th>{gestiona && <th></th>}</tr></thead>
                  <tbody>
                    {a.alcance.length ? (
                      a.alcance.map((m: any) => (
                        <tr key={m.metodoId}>
                          <td><b>{m.codigo}</b> <span style={{ color: "var(--muted)" }}>{m.nombre}</span></td>
                          <td>{m.ensayo ?? "—"}</td>
                          <td>{m.matriz ?? "—"}</td>
                          <td>{m.rango ?? "—"}</td>
                          {gestiona && <td><button className="btn outline sm" onClick={() => quitar(a, m.metodoId)}>Quitar</button></td>}
                        </tr>
                      ))
                    ) : (
                      <tr><td colSpan={gestiona ? 5 : 4} style={{ color: "var(--muted)" }}>Sin métodos en el alcance.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })
      )}
    </>
  );
}

function BuscarMetodo({ onElegir, etiqueta = "Buscar método" }: { onElegir: (m: any) => void; etiqueta?: string }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<any[]>([]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (q.trim().length < 2) return setRes([]);
      llamar<any[]>("GET", `/calidad/metodos${qs({ q: q.trim() })}`).then(setRes).catch(() => setRes([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="field" style={{ margin: 0, position: "relative" }}>
      <label htmlFor="bm-q">{etiqueta}</label>
      <input id="bm-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Código, nombre, ensayo o norma" maxLength={80} autoComplete="off" />
      {!!res.length && (
        <ul role="listbox" style={{ listStyle: "none", margin: "4px 0 0", padding: 0, border: "1px solid var(--line)", borderRadius: 6, maxHeight: 240, overflowY: "auto", background: "var(--card, #fff)" }}>
          {res.map((m) => (
            <li key={m.id}>
              <button type="button" style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 8px", border: 0, background: "none", cursor: "pointer" }}
                onClick={() => { onElegir(m); setQ(""); setRes([]); }}>
                <b>{m.codigo}</b> {m.nombre}<span style={{ color: "var(--muted)", fontSize: 12 }}>{m.ensayo ? ` · ${m.ensayo}` : ""}{m.norma ? ` · ${m.norma}` : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AgregarAlcance({ acreditacionId, onListo }: { acreditacionId: string; onListo: () => void }) {
  const [elegidos, setElegidos] = useState<any[]>([]);
  const [matriz, setMatriz] = useState("");
  const [rango, setRango] = useState("");
  const agregar = async () => {
    try {
      const r = await llamar<any>("POST", `/calidad/acreditaciones/${acreditacionId}/alcance`, { metodoIds: elegidos.map((m) => m.id), matriz: matriz || null, rango: rango || null });
      toast.ok(`${r.agregados} método(s) en el alcance.`);
      onListo();
    } catch (e: any) {
      toast.error(e.message);
    }
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginTop: 10, alignItems: "end", padding: 10, border: "1px dashed var(--line)", borderRadius: 8 }}>
      <BuscarMetodo onElegir={(m) => setElegidos((l) => (l.some((x) => x.id === m.id) ? l : [...l, m]))} />
      <div className="field" style={{ margin: 0 }}>
        <label htmlFor="al-matriz">Matriz (opcional)</label>
        <input id="al-matriz" value={matriz} onChange={(e) => setMatriz(e.target.value)} maxLength={160} placeholder="Ej.: agua potable" />
      </div>
      <div className="field" style={{ margin: 0 }}>
        <label htmlFor="al-rango">Rango (opcional)</label>
        <input id="al-rango" value={rango} onChange={(e) => setRango(e.target.value)} maxLength={120} placeholder="Ej.: 0,05 a 10 mg/L" />
      </div>
      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {elegidos.map((m) => (
          <span key={m.id} className="pill teal">{m.codigo} <button type="button" aria-label={`Quitar ${m.codigo}`} style={{ border: 0, background: "none", cursor: "pointer" }} onClick={() => setElegidos((l) => l.filter((x) => x.id !== m.id))}>×</button></span>
        ))}
        <button className="btn primary sm" disabled={!elegidos.length} onClick={agregar}>Agregar al alcance</button>
      </div>
    </div>
  );
}

/* ================================================================== POE === */

function Poe() {
  const { puede } = usePermisos();
  const gestiona = puede("catalogo.gestionar");
  const [metodo, setMetodo] = useState<any | null>(null);
  const [ficha, setFicha] = useState<any | null>(null);
  const [qDoc, setQDoc] = useState("");
  const [docs, setDocs] = useState<any[]>([]);
  const [margen, setMargen] = useState("");
  const cargar = useCallback(async (id: string) => {
    try {
      const f = await llamar<any>("GET", `/calidad/metodos/${id}`);
      setFicha(f);
      setMargen(f.metodo.margenAdvertenciaPct == null ? "" : num(f.metodo.margenAdvertenciaPct));
    } catch (e: any) {
      toast.error(e.message);
    }
  }, []);
  useEffect(() => {
    if (metodo) cargar(metodo.id);
  }, [metodo, cargar]);
  useEffect(() => {
    if (!gestiona) return;
    const t = setTimeout(() => {
      llamar<any[]>("GET", `/calidad/documentos${qs({ q: qDoc.trim() || undefined })}`).then(setDocs).catch(() => setDocs([]));
    }, 250);
    return () => clearTimeout(t);
  }, [qDoc, gestiona]);

  const vincular = async (documentoId: string) => {
    try {
      setFicha(await llamar<any>("POST", `/calidad/metodos/${metodo.id}/poe`, { documentoId, principal: !ficha?.poe?.length }));
      toast.ok("POE vinculado al método.");
    } catch (e: any) {
      toast.error(e.message);
    }
  };
  const desvincular = async (documentoId: string) => {
    try {
      setFicha(await llamar<any>("DELETE", `/calidad/metodos/${metodo.id}/poe/${documentoId}`));
    } catch (e: any) {
      toast.error(e.message);
    }
  };
  const guardarMargen = async () => {
    try {
      await llamar("PATCH", `/calidad/metodos/${metodo.id}/margen`, { margenPct: margen.trim() === "" ? null : margen.trim() });
      toast.ok(margen.trim() === "" ? "El método usa el margen general." : "Margen de advertencia guardado.");
      cargar(metodo.id);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <>
      <section className="card" style={{ display: "grid", gridTemplateColumns: "minmax(260px, 420px) 1fr", gap: 12, alignItems: "start" }}>
        <BuscarMetodo onElegir={setMetodo} etiqueta="Método del catálogo" />
        <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
          El POE (procedimiento operativo estándar) se sube al Gestor documental y aquí se vincula al método: el analista lo abre desde la captura por OT. El margen de advertencia del método reemplaza al general (vacío = general; 0 = sin advertencias).
        </p>
      </section>
      {metodo && ficha && (
        <section className="card">
          <h2 style={{ margin: "0 0 6px" }}>{ficha.metodo.codigo} · {ficha.metodo.nombre}</h2>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {ficha.acreditaciones.length ? (
              ficha.acreditaciones.map((a: any) => {
                const v = estadoVigencia(a);
                return <span key={a.id} className={`pill ${v.pill === "green" ? "green" : v.pill}`}>Acreditado {a.organismo} {a.numero} · {v.texto}</span>;
              })
            ) : (
              <span className="pill gray">Sin alcance acreditado</span>
            )}
          </div>
          <h3 style={{ margin: "8px 0 4px", fontSize: 14 }}>Procedimientos (POE)</h3>
          {ficha.poe.length ? (
            <ul style={{ margin: "0 0 10px", paddingLeft: 18 }}>
              {ficha.poe.map((p: any) => (
                <li key={p.documentoId} style={{ marginBottom: 4 }}>
                  <button type="button" className="linklike" style={{ border: 0, background: "none", padding: 0, color: "var(--accent, #1d4ed8)", cursor: "pointer", textDecoration: "underline" }}
                    onClick={() => descargarAdjunto(`/documentos/archivos/${p.documentoId}/descargar`, `${p.codigo}.pdf`).catch((e) => toast.error(e.message))}>
                    {p.codigo} · {p.titulo}
                  </button>
                  {p.version != null && <span style={{ color: "var(--muted)", fontSize: 12 }}> · versión {p.version}</span>}
                  {p.principal && <span className="pill teal" style={{ marginLeft: 6 }}>principal</span>}
                  {gestiona && <button className="btn outline sm" style={{ marginLeft: 8 }} onClick={() => desvincular(p.documentoId)}>Quitar</button>}
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ color: "var(--muted)", margin: "0 0 10px" }}>Sin POE vinculado.</p>
          )}
          {gestiona && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
              <div>
                <div className="field" style={{ margin: 0 }}>
                  <label htmlFor="poe-q">Vincular documento del gestor documental</label>
                  <input id="poe-q" value={qDoc} onChange={(e) => setQDoc(e.target.value)} placeholder="Código o título" maxLength={80} />
                </div>
                <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0", maxHeight: 220, overflowY: "auto" }}>
                  {docs.filter((d) => !ficha.poe.some((p: any) => p.documentoId === d.id)).map((d) => (
                    <li key={d.id} style={{ display: "flex", justifyContent: "space-between", gap: 6, padding: "3px 0", borderBottom: "1px solid var(--line)" }}>
                      <span style={{ fontSize: 13 }}><b>{d.codigo}</b> {d.titulo} <span style={{ color: "var(--muted)" }}>· {d.carpeta}</span></span>
                      <button className="btn outline sm" onClick={() => vincular(d.id)}>Vincular</button>
                    </li>
                  ))}
                  {!docs.length && <li style={{ color: "var(--muted)", fontSize: 13 }}>Sin documentos. Súbalos en <Link href={"/documentos" as any}>Gestor documental</Link>.</li>}
                </ul>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
                <div className="field" style={{ margin: 0 }}>
                  <label htmlFor="poe-margen">Margen de advertencia del método (%)</label>
                  <input id="poe-margen" inputMode="decimal" value={margen} onChange={(e) => setMargen(e.target.value)} placeholder="General" style={{ width: 120 }} />
                </div>
                <button className="btn sm" onClick={guardarMargen}>Guardar margen</button>
              </div>
            </div>
          )}
        </section>
      )}
    </>
  );
}

/* ============================================================= alícuotas === */

const ESTADO_AL: Record<string, { texto: string; pill: string }> = {
  disponible: { texto: "Disponible", pill: "green" },
  en_uso: { texto: "En uso", pill: "teal" },
  consumida: { texto: "Consumida", pill: "gray" },
  descartada: { texto: "Descartada", pill: "red" },
};

function Alicuotas() {
  const { puede } = usePermisos();
  const gestiona = puede("alicuota.gestionar");
  const [q, setQ] = useState("");
  const [muestras, setMuestras] = useState<any[]>([]);
  const [muestraId, setMuestraId] = useState<string | null>(null);
  const [datos, setDatos] = useState<any | null>(null);
  const [nueva, setNueva] = useState({ n: "1", cantidad: "", unidad: "g", proposito: "" });
  const [mov, setMov] = useState<{ id: string; tipo: string; cantidad: string; estado: string; detalle: string } | null>(null);

  useEffect(() => {
    const m = new URLSearchParams(window.location.search).get("muestra");
    if (m) setMuestraId(m);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      if (q.trim().length < 2) return setMuestras([]);
      llamar<any[]>("GET", `/calidad/muestras${qs({ q: q.trim() })}`).then(setMuestras).catch(() => setMuestras([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const cargar = useCallback(async () => {
    if (!muestraId) return;
    try {
      setDatos(await llamar<any>("GET", `/calidad/muestras/${muestraId}/alicuotas`));
    } catch (e: any) {
      toast.error(e.message);
    }
  }, [muestraId]);
  useEffect(() => {
    cargar();
  }, [cargar]);

  const preparar = async () => {
    try {
      const r = await llamar<any>("POST", `/calidad/muestras/${muestraId}/alicuotas`, {
        n: Number(nueva.n),
        cantidad: nueva.cantidad.trim() || null,
        unidad: nueva.cantidad.trim() ? nueva.unidad.trim() : null,
        proposito: nueva.proposito.trim() || null,
      });
      toast.ok(`Alícuotas preparadas: ${r.creadas.join(", ")}.`);
      setNueva({ ...nueva, proposito: "" });
      cargar();
    } catch (e: any) {
      toast.error(e.message);
    }
  };
  const mover = async () => {
    if (!mov) return;
    try {
      await llamar("POST", `/calidad/alicuotas/${mov.id}/movimiento`, {
        tipo: mov.tipo,
        cantidad: mov.tipo === "consumo" ? mov.cantidad : null,
        estado: mov.tipo === "estado" ? mov.estado : null,
        detalle: mov.detalle.trim() || null,
      });
      setMov(null);
      cargar();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <>
      <section className="card" style={{ display: "grid", gridTemplateColumns: "minmax(260px, 420px) 1fr", gap: 12, alignItems: "start" }}>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="al-q">Muestra</label>
          <input id="al-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Código de muestra u OT" maxLength={60} autoComplete="off" />
          {!!muestras.length && (
            <ul style={{ listStyle: "none", padding: 0, margin: "4px 0 0", border: "1px solid var(--line)", borderRadius: 6, maxHeight: 220, overflowY: "auto" }}>
              {muestras.map((m) => (
                <li key={m.id}>
                  <button type="button" style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 8px", border: 0, background: "none", cursor: "pointer" }}
                    onClick={() => { setMuestraId(m.id); setQ(""); setMuestras([]); }}>
                    <b>{m.codigo}</b> {m.nombre ?? ""} <span style={{ color: "var(--muted)", fontSize: 12 }}>· {m.otCodigo ?? "sin OT"} · {m.alicuotas} alícuota(s)</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
          Una alícuota es una porción de la muestra preparada para un ensayo o para guardar. Lleva su código, cantidad, ubicación y estado; cada consumo o cambio queda en su historial.
        </p>
      </section>
      {datos && (
        <section className="card">
          <h2 style={{ margin: "0 0 6px" }}>
            {datos.muestra.codigo} {datos.muestra.nombre ? `· ${datos.muestra.nombre}` : ""}
            {datos.muestra.otId && <Link href={`/ot/${datos.muestra.otId}` as any} style={{ fontSize: 13, marginLeft: 8 }}>{datos.muestra.otCodigo}</Link>}
          </h2>
          {gestiona && (
            <div style={{ display: "grid", gridTemplateColumns: "90px 140px 90px 1fr auto", gap: 8, alignItems: "end", marginBottom: 10 }}>
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor="al-n">Cuántas</label>
                <input id="al-n" inputMode="numeric" value={nueva.n} onChange={(e) => setNueva({ ...nueva, n: e.target.value })} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor="al-c">Cantidad c/u</label>
                <input id="al-c" inputMode="decimal" value={nueva.cantidad} onChange={(e) => setNueva({ ...nueva, cantidad: e.target.value })} placeholder="Opcional" />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor="al-u">Unidad</label>
                <input id="al-u" value={nueva.unidad} onChange={(e) => setNueva({ ...nueva, unidad: e.target.value })} maxLength={20} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor="al-p">Propósito</label>
                <input id="al-p" value={nueva.proposito} onChange={(e) => setNueva({ ...nueva, proposito: e.target.value })} placeholder="Ej.: humedad, contramuestra" maxLength={160} />
              </div>
              <button className="btn primary sm" onClick={preparar}>Preparar</button>
            </div>
          )}
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead><tr><th>Código</th><th>Cantidad</th><th>Queda</th><th>Propósito</th><th>Estado</th><th>Historial</th>{gestiona && <th></th>}</tr></thead>
              <tbody>
                {datos.alicuotas.length ? (
                  datos.alicuotas.map((a: any) => (
                    <tr key={a.id}>
                      <td style={{ fontFamily: "'JetBrains Mono', monospace" }}>{a.codigo}</td>
                      <td>{a.cantidad != null ? `${num(a.cantidad)} ${a.unidad ?? ""}` : "—"}</td>
                      <td>{a.cantidadRestante != null ? `${num(a.cantidadRestante)} ${a.unidad ?? ""}` : "—"}</td>
                      <td>{a.proposito ?? "—"}</td>
                      <td><span className={`pill ${ESTADO_AL[a.estado]?.pill ?? "gray"}`}>{ESTADO_AL[a.estado]?.texto ?? a.estado}</span></td>
                      <td style={{ fontSize: 11.5, color: "var(--muted)" }}>
                        {a.movimientos.map((m: any, i: number) => (
                          <div key={i}>{fechaHora(m.creadoEn)} · {m.tipo}{m.cantidad != null ? ` ${num(m.cantidad)}` : ""}{m.estadoHasta && m.estadoHasta !== m.estadoDesde ? ` → ${ESTADO_AL[m.estadoHasta]?.texto ?? m.estadoHasta}` : ""}{m.detalle ? ` · ${m.detalle}` : ""}{m.usuario ? ` · ${m.usuario}` : ""}</div>
                        ))}
                      </td>
                      {gestiona && (
                        <td>
                          {!["consumida", "descartada"].includes(a.estado) && (mov?.id === a.id ? (
                            <div style={{ display: "grid", gap: 4, minWidth: 220 }}>
                              <select aria-label="Movimiento" value={mov!.tipo} onChange={(e) => setMov((v) => v && { ...v, tipo: e.target.value })}>
                                <option value="consumo">Consumo</option>
                                <option value="estado">Cambio de estado</option>
                              </select>
                              {mov!.tipo === "consumo" ? (
                                <input aria-label="Cantidad consumida" inputMode="decimal" value={mov!.cantidad} onChange={(e) => setMov((v) => v && { ...v, cantidad: e.target.value })} placeholder={`Cantidad (${a.unidad ?? ""})`} />
                              ) : (
                                <select aria-label="Nuevo estado" value={mov!.estado} onChange={(e) => setMov((v) => v && { ...v, estado: e.target.value })}>
                                  <option value="">Elija…</option>
                                  {Object.entries(ESTADO_AL).filter(([k]) => k !== a.estado).map(([k, v]) => <option key={k} value={k}>{v.texto}</option>)}
                                </select>
                              )}
                              <input aria-label="Detalle" value={mov!.detalle} onChange={(e) => setMov((v) => v && { ...v, detalle: e.target.value })} placeholder="Detalle (obligatorio al descartar)" maxLength={500} />
                              <div style={{ display: "flex", gap: 4 }}>
                                <button className="btn sm" onClick={mover}>Registrar</button>
                                <button className="btn outline sm" onClick={() => setMov(null)}>Cancelar</button>
                              </div>
                            </div>
                          ) : (
                            <button className="btn outline sm" onClick={() => setMov({ id: a.id, tipo: "consumo", cantidad: "", estado: "", detalle: "" })}>Movimiento…</button>
                          ))}
                        </td>
                      )}
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan={gestiona ? 7 : 6} style={{ color: "var(--muted)" }}>La muestra no tiene alícuotas.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
