"use client";

/**
 * Pestaña «Terreno» de la OT · sesión R10 (Vehículos Militares; también
 * Armamento y Telecomunicaciones): trabajo en terreno sin recepción ni toma de
 * muestras. Pasos: 1) apertura; 2) asignación de analistas; 3) pruebas según el
 * protocolo de recepción cualitativa; 4) lista de chequeo con la hoja de control
 * adjunta; 5) IVC con grado de cumplimiento; 6) cierre con el resultado por
 * sistema. Las unidades controladas llevan chasis, motor y año (vehículo) o
 * serie (arma o equipo). API: /terreno/ot/:otId.
 */
import { useCallback, useEffect, useState } from "react";
import { llamar } from "@/lib/laboratorio";
import { enviarInforme } from "@/lib/informes";
import { abrirDocumento } from "@/lib/bpchProcesos";
import { fechaHora } from "@/lib/format";
import { toast } from "@/components/ui/feedback";

type Paso = { clave: string; titulo: string; boton: string; leToca: string; estado: "hecho" | "en_curso" | "pendiente"; detalle: string };
type Unidad = { descripcion: string; chasis: string; motor: string; anioFabricacion: string; serie: string; seleccionada: boolean; observacion: string };
type Prueba = { id: string; unidadId: string | null; sistema: string; prueba: string; requisito: string | null; resultado: string | null; observacion: string | null };
interface Ficha {
  ot: { id: string; codigo: string; estado: string; laboratorio: string | null };
  aplica: boolean;
  terreno: null | {
    lugar: string | null; fechaInicio: string | null; fechaTermino: string | null; modalidad: "total" | "muestreo"; normaMuestreo: string | null;
    letraCodigo: string | null; tamanoLote: number | null; nMuestras: number | null; protocolo: string | null; observaciones: string | null;
    analistas: string[]; ivc: { numero: string | null; grado: string; conclusion: string | null; fecha: string } | null; cerradaAt: string | null;
  };
  unidades?: (Omit<Unidad, "anioFabricacion"> & { id: string; anioFabricacion: number | null })[];
  pruebas?: Prueba[];
  adjuntos?: { id: string; tipo: string; tipoNombre: string; nombre: string; bytes: number; url: string; createdAt: string; subidoPor: string | null }[];
  porSistema?: { sistema: string; resultado: string; pruebas: number }[];
  gradoPropuesto?: string | null;
  avance?: { pasos: Paso[]; actual: number; completo: boolean };
  protocolo: { sistema: string; prueba: string; requisito?: string }[];
  personal: { id: string; nombre: string }[];
  puede: { gestionar: boolean; registrar: boolean };
}

const RES: Record<string, { t: string; c: string }> = {
  cumple: { t: "Cumple", c: "green" },
  no_cumple: { t: "No cumple", c: "red" },
  no_aplica: { t: "No aplica", c: "gray" },
  pendiente: { t: "Pendiente", c: "amber" },
};

export default function TerrenoOt({ otId, onCambio }: { otId: string; onCambio?: () => void }) {
  const [f, setF] = useState<Ficha | null>(null);
  const [error, setError] = useState("");
  const cargar = useCallback(async () => {
    try {
      setF(await llamar<Ficha>("GET", `/terreno/ot/${otId}`));
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, [otId]);
  useEffect(() => {
    cargar();
  }, [cargar]);

  const hacer = async (p: Promise<Ficha>, ok: string) => {
    try {
      setF(await p);
      toast.ok(ok);
      onCambio?.();
      return true;
    } catch (e: any) {
      toast.error(e.message);
      return false;
    }
  };

  if (error) return <div className="alert warn" role="alert">{error}</div>;
  if (!f) return <p className="subtitle">Cargando…</p>;
  if (!f.terreno) return <Apertura f={f} onAbrir={(d) => hacer(llamar("POST", `/terreno/ot/${otId}/abrir`, d), "Trabajo en terreno abierto.")} />;

  const t = f.terreno;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <nav className="stepper" aria-label="Pasos del trabajo en terreno" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {f.avance?.pasos.map((p, i) => (
          <span key={p.clave} className={`pill ${p.estado === "hecho" ? "green" : i + 1 === f.avance!.actual && !f.avance!.completo ? "blue" : "gray"}`}
            title={`${p.detalle} · le toca a ${p.leToca}`}>
            {p.estado === "hecho" ? "✓" : i + 1}. {p.titulo}
          </span>
        ))}
      </nav>
      <section className="card" style={{ margin: 0 }} aria-labelledby="ter-datos">
        <h3 id="ter-datos" style={{ marginTop: 0, fontSize: 13 }}>1 · Apertura</h3>
        <div style={{ fontSize: 12.5 }}>
          {t.lugar ?? "—"} · {t.fechaInicio ?? "—"}{t.fechaTermino ? ` a ${t.fechaTermino}` : ""} ·{" "}
          {t.modalidad === "total" ? "control al 100 %" : `muestreo ${t.normaMuestreo ?? ""} · letra ${t.letraCodigo ?? "—"} · ${t.nMuestras ?? "—"} muestra(s)`}
          {t.protocolo ? ` · protocolo ${t.protocolo}` : ""}
        </div>
      </section>
      <AsignacionTerreno f={f} onGuardar={(ids) => hacer(llamar("PUT", `/terreno/ot/${otId}/asignacion`, { analistas: ids }), "Analistas asignados.")} />
      <UnidadesTerreno f={f} onGuardar={(u) => hacer(llamar("PUT", `/terreno/ot/${otId}/unidades`, { unidades: u }), "Unidades guardadas.")} />
      <PruebasTerreno
        f={f}
        onAgregar={(p) => hacer(llamar("POST", `/terreno/ot/${otId}/pruebas`, { pruebas: p }), "Pruebas agregadas.")}
        onQuitar={(id) => hacer(llamar("DELETE", `/terreno/pruebas/${id}`), "Prueba quitada.")}
        onChequeo={(items) => hacer(llamar("PUT", `/terreno/ot/${otId}/chequeo`, { items }), "Lista de chequeo guardada.")}
      />
      <AdjuntosTerreno f={f} otId={otId} onCambio={(r) => { setF(r); onCambio?.(); }} />
      <IvcTerreno
        f={f}
        onEmitir={(d) => hacer(llamar("POST", `/terreno/ot/${otId}/ivc`, d), "IVC registrado.")}
        onCerrar={() => hacer(llamar("POST", `/terreno/ot/${otId}/cerrar`, {}), "Trabajo en terreno cerrado: emita el informe y cierre la OT.")}
      />
    </div>
  );
}

function Apertura({ f, onAbrir }: { f: Ficha; onAbrir: (d: any) => Promise<boolean> }) {
  const [d, setD] = useState({ lugar: "", fechaInicio: "", fechaTermino: "", modalidad: "total", letraCodigo: "", tamanoLote: "", nMuestras: "", protocolo: "", observaciones: "" });
  const set = (k: keyof typeof d) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setD((x) => ({ ...x, [k]: e.target.value }));
  if (!f.aplica)
    return <p className="subtitle">El laboratorio {f.ot.laboratorio ?? ""} no trabaja en terreno (Catálogo › Parámetros › Trabajo en terreno).</p>;
  if (!f.puede.gestionar) return <p className="subtitle">El trabajo en terreno aún no se abre. Lo abre la jefatura del laboratorio.</p>;
  const n = (v: string) => (v.trim() ? Number(v) : null);
  return (
    <section className="card" style={{ margin: 0 }} aria-labelledby="ter-abrir">
      <h3 id="ter-abrir" style={{ marginTop: 0, fontSize: 13 }}>1 · Abrir el trabajo en terreno</h3>
      <p className="subtitle" style={{ marginTop: 0 }}>Sin recepción ni toma de muestras: las pruebas se hacen donde está el material.</p>
      <div className="form-grid">
        <div className="field span-2"><label htmlFor="te-lugar">Lugar <span className="req">*</span></label><input id="te-lugar" value={d.lugar} maxLength={240} onChange={set("lugar")} /></div>
        <div className="field"><label htmlFor="te-ini">Fecha de inicio <span className="req">*</span></label><input id="te-ini" type="date" value={d.fechaInicio} onChange={set("fechaInicio")} /></div>
        <div className="field"><label htmlFor="te-fin">Fecha de término</label><input id="te-fin" type="date" value={d.fechaTermino} onChange={set("fechaTermino")} /></div>
        <div className="field">
          <label htmlFor="te-mod">Control <span className="req">*</span></label>
          <select id="te-mod" value={d.modalidad} onChange={set("modalidad")}>
            <option value="total">Al 100 %</option>
            <option value="muestreo">Por muestreo según norma</option>
          </select>
        </div>
        {d.modalidad === "muestreo" && (
          <>
            <div className="field"><label htmlFor="te-letra">Letra código <span className="req">*</span></label><input id="te-letra" value={d.letraCodigo} maxLength={1} onChange={set("letraCodigo")} /></div>
            <div className="field"><label htmlFor="te-lote">Tamaño del lote</label><input id="te-lote" inputMode="numeric" value={d.tamanoLote} onChange={set("tamanoLote")} /></div>
            <div className="field"><label htmlFor="te-n">Número de muestras <span className="req">*</span></label><input id="te-n" inputMode="numeric" value={d.nMuestras} onChange={set("nMuestras")} /></div>
          </>
        )}
        <div className="field"><label htmlFor="te-prot">Protocolo de recepción</label><input id="te-prot" value={d.protocolo} maxLength={200} onChange={set("protocolo")} /></div>
        <div className="field span-2"><label htmlFor="te-obs">Observaciones</label><textarea id="te-obs" rows={2} value={d.observaciones} maxLength={4000} onChange={set("observaciones")} /></div>
      </div>
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <button type="button" className="btn primary" onClick={() =>
          onAbrir({
            lugar: d.lugar || null, fechaInicio: d.fechaInicio || null, fechaTermino: d.fechaTermino || null, modalidad: d.modalidad,
            letraCodigo: d.letraCodigo || null, tamanoLote: n(d.tamanoLote), nMuestras: n(d.nMuestras), protocolo: d.protocolo || null, observaciones: d.observaciones || null,
          })}>
          Abrir → asignar analistas
        </button>
      </div>
    </section>
  );
}

function AsignacionTerreno({ f, onGuardar }: { f: Ficha; onGuardar: (ids: string[]) => Promise<boolean> }) {
  const [sel, setSel] = useState<string[]>(f.terreno?.analistas ?? []);
  useEffect(() => setSel(f.terreno?.analistas ?? []), [f.terreno?.analistas]);
  const nombres = f.personal.filter((p) => (f.terreno?.analistas ?? []).includes(p.id)).map((p) => p.nombre);
  return (
    <section className="card" style={{ margin: 0 }} aria-labelledby="ter-asig">
      <h3 id="ter-asig" style={{ marginTop: 0, fontSize: 13 }}>2 · Asignación de analistas</h3>
      {f.puede.gestionar ? (
        <>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {f.personal.map((p) => (
              <label key={p.id} style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 12.5 }}>
                <input type="checkbox" checked={sel.includes(p.id)} onChange={(e) => setSel((x) => (e.target.checked ? [...x, p.id] : x.filter((y) => y !== p.id)))} />
                {p.nombre}
              </label>
            ))}
          </div>
          <button type="button" className="btn outline sm" style={{ marginTop: 6 }} disabled={!sel.length} onClick={() => onGuardar(sel)}>Asignar → pruebas</button>
        </>
      ) : (
        <p style={{ fontSize: 12.5, margin: 0 }}>{nombres.length ? nombres.join(", ") : "Sin asignar."}</p>
      )}
    </section>
  );
}

const UNIDAD_VACIA: Unidad = { descripcion: "", chasis: "", motor: "", anioFabricacion: "", serie: "", seleccionada: true, observacion: "" };

function UnidadesTerreno({ f, onGuardar }: { f: Ficha; onGuardar: (u: any[]) => Promise<boolean> }) {
  const aFilas = () => (f.unidades ?? []).map((u) => ({ ...UNIDAD_VACIA, ...Object.fromEntries(Object.entries(u).map(([k, v]) => [k, v ?? ""])), anioFabricacion: u.anioFabricacion ? String(u.anioFabricacion) : "", seleccionada: u.seleccionada }) as Unidad);
  const [filas, setFilas] = useState<Unidad[]>(aFilas);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setFilas(aFilas()), [f.unidades]);
  const ed = f.puede.registrar;
  const set = (i: number, k: keyof Unidad, v: any) => setFilas((xs) => xs.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <section className="card" style={{ margin: 0 }} aria-labelledby="ter-uni">
      <h3 id="ter-uni" style={{ marginTop: 0, fontSize: 13 }}>Unidades controladas</h3>
      <p className="subtitle" style={{ marginTop: 0 }}>
        Por vehículo: chasis, motor y año de fabricación (aún sin placa). Por arma o equipo: serie.
        {f.terreno?.modalidad === "muestreo" ? ` Marque las ${f.terreno.nMuestras ?? ""} unidades de la muestra.` : " Con control al 100 % se controlan todas."}
      </p>
      {filas.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table className="data" aria-label="Unidades controladas">
            <thead><tr><th>Controlar</th><th>Descripción</th><th>Chasis</th><th>Motor</th><th>Año</th><th>Serie</th>{ed && <th />}</tr></thead>
            <tbody>
              {filas.map((u, i) => (
                <tr key={i}>
                  <td><input type="checkbox" aria-label={`Controlar la unidad ${i + 1}`} checked={u.seleccionada} disabled={!ed} onChange={(e) => set(i, "seleccionada", e.target.checked)} /></td>
                  {(["descripcion", "chasis", "motor", "anioFabricacion", "serie"] as const).map((k) => (
                    <td key={k}><input aria-label={`${k} de la unidad ${i + 1}`} value={u[k]} disabled={!ed} style={{ width: k === "anioFabricacion" ? 70 : "100%" }}
                      inputMode={k === "anioFabricacion" ? "numeric" : undefined} onChange={(e) => set(i, k, e.target.value)} /></td>
                  ))}
                  {ed && <td><button type="button" className="btn ghost-danger sm" onClick={() => setFilas((xs) => xs.filter((_, j) => j !== i))}>Quitar</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {ed && (
        <div className="toolbar" style={{ marginBottom: 0, gap: 6 }}>
          <button type="button" className="btn outline sm" onClick={() => setFilas((xs) => [...xs, { ...UNIDAD_VACIA }])}>Agregar unidad</button>
          <button type="button" className="btn primary sm" onClick={() =>
            onGuardar(filas.map((u) => ({
              descripcion: u.descripcion || null, chasis: u.chasis || null, motor: u.motor || null,
              anioFabricacion: u.anioFabricacion ? Number(u.anioFabricacion) : null, serie: u.serie || null, seleccionada: u.seleccionada, observacion: u.observacion || null,
            })))}>
            Guardar unidades
          </button>
        </div>
      )}
    </section>
  );
}

function PruebasTerreno({ f, onAgregar, onQuitar, onChequeo }: {
  f: Ficha; onAgregar: (p: any[]) => Promise<boolean>; onQuitar: (id: string) => Promise<boolean>; onChequeo: (items: any[]) => Promise<boolean>;
}) {
  const pruebas = f.pruebas ?? [];
  const [elegidas, setElegidas] = useState<number[]>([]);
  const [otra, setOtra] = useState({ sistema: "", prueba: "", requisito: "" });
  const [res, setRes] = useState<Record<string, { resultado: string; observacion: string }>>({});
  useEffect(() => {
    setRes(Object.fromEntries((f.pruebas ?? []).map((p) => [p.id, { resultado: p.resultado ?? "", observacion: p.observacion ?? "" }])));
  }, [f.pruebas]);
  const ed = f.puede.registrar && !f.terreno?.ivc;
  const unidad = (id: string | null) => {
    if (!id) return "General";
    const u = (f.unidades ?? []).find((x) => x.id === id);
    return u ? u.chasis || u.serie || u.descripcion || "Unidad" : "Unidad";
  };
  return (
    <section className="card" style={{ margin: 0 }} aria-labelledby="ter-pru">
      <h3 id="ter-pru" style={{ marginTop: 0, fontSize: 13 }}>3 · Pruebas del protocolo y 4 · lista de chequeo</h3>
      {ed && f.protocolo.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <p className="subtitle" style={{ margin: "0 0 4px" }}>Elija las pruebas del protocolo de recepción cualitativa (formato de control de prueba). Se crean por cada unidad marcada.</p>
          {f.protocolo.map((p, i) => (
            <label key={i} style={{ display: "flex", gap: 6, fontSize: 12.5 }}>
              <input type="checkbox" checked={elegidas.includes(i)} onChange={(e) => setElegidas((x) => (e.target.checked ? [...x, i] : x.filter((y) => y !== i)))} />
              <b>{p.sistema}</b> · {p.prueba}{p.requisito ? ` (${p.requisito})` : ""}
            </label>
          ))}
          <button type="button" className="btn outline sm" style={{ marginTop: 4 }} disabled={!elegidas.length}
            onClick={async () => { if (await onAgregar(elegidas.map((i) => f.protocolo[i]))) setElegidas([]); }}>
            Agregar pruebas elegidas
          </button>
        </div>
      )}
      {ed && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 8 }}>
          <div className="field" style={{ margin: 0 }}><label htmlFor="te-o-s">Sistema</label><input id="te-o-s" value={otra.sistema} maxLength={120} onChange={(e) => setOtra((x) => ({ ...x, sistema: e.target.value }))} /></div>
          <div className="field" style={{ margin: 0 }}><label htmlFor="te-o-p">Prueba</label><input id="te-o-p" value={otra.prueba} maxLength={300} onChange={(e) => setOtra((x) => ({ ...x, prueba: e.target.value }))} /></div>
          <div className="field" style={{ margin: 0 }}><label htmlFor="te-o-r">Requisito</label><input id="te-o-r" value={otra.requisito} maxLength={500} onChange={(e) => setOtra((x) => ({ ...x, requisito: e.target.value }))} /></div>
          <button type="button" className="btn outline sm" disabled={!otra.sistema.trim() || !otra.prueba.trim()}
            onClick={async () => { if (await onAgregar([{ ...otra, requisito: otra.requisito || null }])) setOtra({ sistema: "", prueba: "", requisito: "" }); }}>
            Agregar otra prueba
          </button>
        </div>
      )}
      {pruebas.length > 0 ? (
        <div style={{ overflowX: "auto" }}>
          <table className="data" aria-label="Lista de chequeo">
            <thead><tr><th>Unidad</th><th>Sistema</th><th>Prueba</th><th>Requisito</th><th>Resultado</th><th>Observación</th>{ed && <th />}</tr></thead>
            <tbody>
              {pruebas.map((p) => (
                <tr key={p.id}>
                  <td>{unidad(p.unidadId)}</td>
                  <td>{p.sistema}</td>
                  <td>{p.prueba}</td>
                  <td>{p.requisito ?? "—"}</td>
                  <td>
                    {ed ? (
                      <select aria-label={`Resultado de ${p.prueba}`} value={res[p.id]?.resultado ?? ""} onChange={(e) => setRes((x) => ({ ...x, [p.id]: { ...x[p.id], resultado: e.target.value } }))}>
                        <option value="">—</option><option value="cumple">Cumple</option><option value="no_cumple">No cumple</option><option value="no_aplica">No aplica</option>
                      </select>
                    ) : p.resultado ? <span className={`pill ${RES[p.resultado].c}`}>{RES[p.resultado].t}</span> : "—"}
                  </td>
                  <td>{ed ? <input aria-label={`Observación de ${p.prueba}`} value={res[p.id]?.observacion ?? ""} maxLength={1000} onChange={(e) => setRes((x) => ({ ...x, [p.id]: { ...x[p.id], observacion: e.target.value } }))} /> : p.observacion ?? ""}</td>
                  {ed && <td>{!p.resultado && <button type="button" className="btn ghost-danger sm" onClick={() => onQuitar(p.id)}>Quitar</button>}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          {ed && (
            <button type="button" className="btn primary sm" style={{ marginTop: 6 }}
              onClick={() => onChequeo(pruebas.map((p) => ({ id: p.id, resultado: res[p.id]?.resultado || null, observacion: res[p.id]?.observacion || null })))}>
              Guardar lista de chequeo → IVC
            </button>
          )}
        </div>
      ) : (
        <p className="subtitle">Aún no hay pruebas.</p>
      )}
    </section>
  );
}

function AdjuntosTerreno({ f, otId, onCambio }: { f: Ficha; otId: string; onCambio: (r: Ficha) => void }) {
  const [tipo, setTipo] = useState("hoja_control");
  const [subiendo, setSubiendo] = useState(false);
  const adj = f.adjuntos ?? [];
  const ed = f.puede.registrar;
  const subir = async (archivo: File) => {
    setSubiendo(true);
    try {
      const fd = new FormData();
      fd.append("tipo", tipo);
      fd.append("archivo", archivo);
      onCambio((await enviarInforme(`/terreno/ot/${otId}/adjuntos`, "POST", fd)) as Ficha);
      toast.ok("Documento adjuntado.");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSubiendo(false);
    }
  };
  return (
    <section className="card" style={{ margin: 0 }} aria-labelledby="ter-adj">
      <h3 id="ter-adj" style={{ marginTop: 0, fontSize: 13 }}>Protocolo, hojas de control e IVC</h3>
      <p className="subtitle" style={{ marginTop: 0 }}>Quedan trazables entre sí en la OT.</p>
      {adj.length > 0 && (
        <table className="data" aria-label="Documentos del trabajo en terreno">
          <thead><tr><th>Tipo</th><th>Archivo</th><th>Subido</th>{ed && <th />}</tr></thead>
          <tbody>
            {adj.map((a) => (
              <tr key={a.id}>
                <td>{a.tipoNombre}</td>
                <td><button type="button" className="btn outline sm" onClick={() => abrirDocumento(`/${a.url}`).catch((e) => toast.error(e.message))}>{a.nombre}</button></td>
                <td>{fechaHora(a.createdAt)}{a.subidoPor ? ` · ${a.subidoPor}` : ""}</td>
                {ed && (
                  <td><button type="button" className="btn ghost-danger sm"
                    onClick={async () => { try { onCambio(await llamar<Ficha>("DELETE", `/terreno/adjuntos/${a.id}`)); } catch (e: any) { toast.error(e.message); } }}>Quitar</button></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {ed && (
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end", flexWrap: "wrap", marginTop: 6 }}>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="te-adj-tipo">Tipo</label>
            <select id="te-adj-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="protocolo">Protocolo de recepción</option>
              <option value="hoja_control">Hoja de control de pruebas</option>
              <option value="ivc">IVC</option>
              <option value="otro">Otro</option>
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="te-adj-f">Archivo (PDF, imagen, Word o Excel · máx. 10 MB)</label>
            <input id="te-adj-f" type="file" disabled={subiendo} accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx"
              onChange={(e) => { const x = e.target.files?.[0]; if (x) subir(x); e.target.value = ""; }} />
          </div>
        </div>
      )}
    </section>
  );
}

function IvcTerreno({ f, onEmitir, onCerrar }: { f: Ficha; onEmitir: (d: any) => Promise<boolean>; onCerrar: () => Promise<boolean> }) {
  const t = f.terreno!;
  const [d, setD] = useState({ numero: "", grado: f.gradoPropuesto ?? "", conclusion: "" });
  useEffect(() => setD((x) => ({ ...x, grado: x.grado || f.gradoPropuesto || "" })), [f.gradoPropuesto]);
  return (
    <section className="card" style={{ margin: 0 }} aria-labelledby="ter-ivc">
      <h3 id="ter-ivc" style={{ marginTop: 0, fontSize: 13 }}>5 · IVC y 6 · cierre</h3>
      {(f.porSistema ?? []).length > 0 && (
        <table className="data" aria-label="Resultado por sistema controlado">
          <thead><tr><th>Sistema</th><th>Pruebas</th><th>Resultado</th></tr></thead>
          <tbody>
            {f.porSistema!.map((s) => (
              <tr key={s.sistema}><td>{s.sistema}</td><td>{s.pruebas}</td><td><span className={`pill ${RES[s.resultado]?.c ?? "gray"}`}>{RES[s.resultado]?.t ?? s.resultado}</span></td></tr>
            ))}
          </tbody>
        </table>
      )}
      {t.ivc ? (
        <p style={{ fontSize: 12.5 }}>
          IVC {t.ivc.numero ?? ""} · grado de cumplimiento <b>{t.ivc.grado === "cumple" ? "Cumple" : "No cumple"}</b> · {fechaHora(t.ivc.fecha)}
          {t.ivc.conclusion ? ` · ${t.ivc.conclusion}` : ""}
        </p>
      ) : f.puede.gestionar ? (
        <div className="form-grid" style={{ marginTop: 6 }}>
          <div className="field"><label htmlFor="te-ivc-n">Nº del IVC</label><input id="te-ivc-n" value={d.numero} maxLength={60} onChange={(e) => setD((x) => ({ ...x, numero: e.target.value }))} /></div>
          <div className="field">
            <label htmlFor="te-ivc-g">Grado de cumplimiento <span className="req">*</span></label>
            <select id="te-ivc-g" value={d.grado} onChange={(e) => setD((x) => ({ ...x, grado: e.target.value }))}>
              <option value="">—</option><option value="cumple">Cumple</option><option value="no_cumple">No cumple</option>
            </select>
            {f.gradoPropuesto && <small style={{ color: "var(--muted)" }}>Según la lista de chequeo: {f.gradoPropuesto === "cumple" ? "cumple" : "no cumple"}.</small>}
          </div>
          <div className="field span-2"><label htmlFor="te-ivc-c">Conclusión</label><textarea id="te-ivc-c" rows={2} maxLength={4000} value={d.conclusion} onChange={(e) => setD((x) => ({ ...x, conclusion: e.target.value }))} /></div>
          <div><button type="button" className="btn primary sm" onClick={() => onEmitir({ numero: d.numero || null, grado: d.grado, conclusion: d.conclusion || null })}>Emitir IVC → cierre</button></div>
        </div>
      ) : (
        <p className="subtitle">El IVC lo emite la jefatura del laboratorio.</p>
      )}
      {t.cerradaAt ? (
        <div className="alert success">Trabajo en terreno cerrado el {fechaHora(t.cerradaAt)}. Siga en «Informe y cierre» para emitir y entregar el informe y cerrar la OT.</div>
      ) : (
        t.ivc && f.puede.gestionar && <button type="button" className="btn primary sm" style={{ marginTop: 6 }} onClick={onCerrar}>Cerrar el trabajo en terreno → informe y cierre de la OT</button>
      )}
    </section>
  );
}
