"use client";

/**
 * LRB · Registro de disparos (EP-05 3.2, 4.1, 5.3 y 7.1) · formulario
 * especializado de los ensayos de resistencia balística.
 *
 *   1 Lote y muestreo: material, lote, nómina de series por talla, unidades
 *     muestreadas con su reposición y paneles (munición de la tabla de amenazas).
 *   2 Registro de disparos: «Guardar disparo → siguiente disparo», «Cerrar panel
 *     → siguiente panel». Penetración o trauma sobre el máximo detienen el panel.
 *   3 Requisitos por norma: la tabla de amenazas vigente (Parámetros).
 *   4 Conclusión y documento: «Concluir lote → documento» lleva el veredicto a los
 *     ensayos; Informe de Rechazo si no cumple, IE + CRB si cumple.
 *
 * API: /formularios/ot/:otId/disparos (+ /disparo, /cerrar-panel, /concluir, /reabrir).
 */
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, SkeletonCards } from "@/components/ui/PageHeader";
import { toast } from "@/components/ui/feedback";
import { llamar } from "@/lib/laboratorio";
import { fechaHora } from "@/lib/format";
import { aNum, Bitacora, Campo, conComa, Pasos, Veredicto, type PasoFormulario } from "@/components/formularios/comun";

interface Amenaza { clave: string; norma: string; nivel: string; elemento: string; municion: string; masa_g: number | null; v_min: number; v_max: number; disparos: number; trauma_max: number | null; disparos_trauma: number; testigo: boolean; criterio: string }
interface Disparo { n: number; zonaImpacto?: string | null; v1: number | null; v2?: number | null; trauma?: number | null; laminasPerforadas?: number | null; laminasTotal?: number | null; penetracion: boolean | null; danoTestigo?: boolean | null; observacion?: string | null; velocidad?: number | null; fueraVentana?: boolean; condicion?: string; motivos?: string[] }
interface Panel { id: string; zona: string; amenaza: string; disparos: Disparo[]; cerrado?: boolean }
interface Unidad { id: string; serie: string; talla?: string | null; muestraId?: string | null; reemplazo?: string | null; paneles: Panel[] }
interface PanelEv extends Panel { amenazaFila: Amenaza | null; detenido: boolean; completo: boolean; veredicto: string; avisos: string[] }
interface Vista {
  ot: { id: string; codigo: string; estado: string; laboratorio: string | null; cliente: string | null };
  registro: { id: string; estado: string; version: number; actualizadoPorNombre: string | null; updatedAt: string } | null;
  datos: { certificacionLote: boolean; material: string; tipoCertificacion: string; fechaEnsayo: string; lote: any; composicion: { talla: string; cantidad: number }[]; unidades: Unidad[] };
  evaluacion: { unidades: (Omit<Unidad, "paneles"> & { paneles: PanelEv[]; veredicto: string })[]; veredicto: string; penetracion: boolean; falla: string | null; documentos: string[]; disparos: number; avisos: string[] };
  amenazas: Amenaza[];
  velocidadManda: string;
  muestras: { id: string; codigo: string; nombre: string | null }[];
  ensayos: any[];
  eventos: any[];
  puedeEditar: boolean;
  bloqueo: string | null;
  faltantesCrb: string[];
  faltantesRechazo: string[];
}

const DOC: Record<string, string> = {
  INFORME_ENSAYO: "Informe de Ensayos",
  CERTIFICADO_RESISTENCIA_BALISTICA: "Certificado de Resistencia Balística (CRB)",
  INFORME_RECHAZO: "Informe de Ensayo de Rechazo",
};
const ZONAS = ["anterior", "posterior", "lateral", "casco", "probeta"];
let sec = 0;
const nuevoId = (p: string) => `${p}${Date.now().toString(36)}${++sec}`;

function Contenido() {
  const otId = useSearchParams().get("otId") ?? "";
  const [v, setV] = useState<Vista | null>(null);
  const [error, setError] = useState("");
  const [paso, setPaso] = useState("lote");
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const r = await llamar<Vista>("GET", `/formularios/ot/${otId}/disparos`);
      setV(r);
      setError("");
      return r;
    } catch (e: any) {
      setError(e.message);
      return null;
    }
  }, [otId]);
  useEffect(() => {
    if (!otId) return;
    cargar().then((r) => {
      if (!r) return;
      setPaso(r.registro?.estado === "cerrado" ? "conclusion" : r.datos.unidades.length ? "disparos" : "lote");
    });
  }, [otId, cargar]);

  if (!otId) return <div className="alert warn">Abra el registro de disparos desde la OT o desde «Captura y revisión por OT».</div>;
  if (error) return <div className="alert warn">{error}</div>;
  if (!v) return <SkeletonCards n={3} />;

  const cerrado = v.registro?.estado === "cerrado";
  const editable = v.puedeEditar && !cerrado && !v.bloqueo;
  const paneles = v.evaluacion.unidades.flatMap((u) => u.paneles);
  const pasos: PasoFormulario[] = [
    { clave: "lote", titulo: "Lote y muestreo", estado: v.datos.unidades.length ? "hecho" : "actual", detalle: v.datos.unidades.length ? `${v.datos.unidades.length} unidad(es) · lote ${v.datos.lote?.tamano ?? "—"}` : "Pendiente" },
    { clave: "disparos", titulo: "Registro de disparos", estado: paneles.length && paneles.every((p) => p.completo) ? "hecho" : v.datos.unidades.length ? "actual" : "pendiente", detalle: `${v.evaluacion.disparos} disparo(s) · ${paneles.filter((p) => p.completo).length}/${paneles.length} paneles` },
    { clave: "requisitos", titulo: "Requisitos por norma", estado: "hecho", detalle: `${v.amenazas.length} amenazas · manda ${v.velocidadManda.toUpperCase()}` },
    { clave: "conclusion", titulo: "Conclusión y documento", estado: cerrado ? "hecho" : "pendiente", detalle: cerrado ? "Lote concluido" : "Por concluir" },
  ];

  return (
    <div>
      <PageHeader
        titulo={`Registro de disparos · OT ${v.ot.codigo}`}
        subtitulo={`${v.ot.cliente ?? ""} · Laboratorio de Resistencia Balística (EP-05 4.1). El dato primario reemplaza a la tabla del Word; el veredicto del lote pasa a los ensayos.`}
        migas={[{ label: "Captura y revisión por OT", href: `/captura-ot?otId=${otId}` }, { label: v.ot.codigo, href: `/ot/${otId}` }, { label: "Registro de disparos" }]}
        acciones={
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <Veredicto v={v.evaluacion.veredicto} prefijo="Lote" />
            <span className={`pill ${cerrado ? "green" : "gray"}`}>{cerrado ? "Concluido" : v.registro ? "En registro" : "Sin registro"}</span>
          </div>
        }
      />
      {v.bloqueo && (
        <div className="alert warn">
          {v.bloqueo} <Link href={`/ot/${otId}?tab=preparacion` as any} style={{ color: "inherit", fontWeight: 600 }}>Ir a Preparación</Link>
        </div>
      )}
      {!v.puedeEditar && !v.bloqueo && <div className="alert info">Usted ve el registro en modo consulta: lo capturan los analistas del laboratorio.</div>}
      {v.evaluacion.penetracion && <div className="alert warn"><b>Penetración completa:</b> el lote no cumple ({v.evaluacion.falla}). Corresponde el Informe de Ensayo de Rechazo.</div>}

      <Pasos pasos={pasos} activo={paso} onElegir={setPaso} />

      {paso === "lote" && <PasoLote v={v} editable={editable && !cerrado} ocupado={ocupado} setOcupado={setOcupado} onListo={async () => { await cargar(); setPaso("disparos"); }} />}
      {paso === "disparos" && <PasoDisparos v={v} editable={editable} onCambio={cargar} onFin={() => setPaso("conclusion")} />}
      {paso === "requisitos" && <PasoRequisitos v={v} />}
      {paso === "conclusion" && <PasoConclusion v={v} otId={otId} puede={v.puedeEditar} onCambio={cargar} />}

      <Bitacora eventos={v.eventos} />
      {v.registro && <p className="subtitle" style={{ margin: 0 }}>Última modificación: {fechaHora(v.registro.updatedAt)}{v.registro.actualizadoPorNombre ? ` por ${v.registro.actualizadoPorNombre}` : ""} · versión {v.registro.version}</p>}
    </div>
  );
}

/* --------------------------------------------------------- 1 · lote --- */
function PasoLote({ v, editable, ocupado, setOcupado, onListo }: { v: Vista; editable: boolean; ocupado: boolean; setOcupado: (b: boolean) => void; onListo: () => Promise<void> }) {
  const d = v.datos;
  const [f, setF] = useState(() => ({
    material: d.material ?? "", tipoCertificacion: d.tipoCertificacion ?? "", certificacionLote: d.certificacionLote ?? false, fechaEnsayo: d.fechaEnsayo ?? "",
    tamano: d.lote?.tamano != null ? String(d.lote.tamano) : "", modelo: d.lote?.modelo ?? "", reposicion: d.lote?.reposicion != null ? String(d.lote.reposicion) : "",
    fabricacion: d.lote?.fabricacion ?? "", garantiaAnios: d.lote?.garantiaAnios != null ? String(d.lote.garantiaAnios) : "",
  }));
  const [comp, setComp] = useState(() => (d.composicion?.length ? d.composicion.map((c) => ({ talla: c.talla, cantidad: String(c.cantidad) })) : [{ talla: "", cantidad: "" }]));
  const [uds, setUds] = useState<Unidad[]>(() => (d.unidades?.length ? d.unidades : []));
  const [motivo, setMotivo] = useState("");
  const total = comp.reduce((s, c) => s + (Number(c.cantidad) || 0), 0);
  const amenazaDefecto = v.amenazas[0]?.clave ?? "";
  const setU = (i: number, p: Partial<Unidad>) => setUds((a) => a.map((u, k) => (k === i ? { ...u, ...p } : u)));

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true);
    try {
      await llamar("PUT", `/formularios/ot/${v.ot.id}/disparos`, {
        material: f.material, tipoCertificacion: f.tipoCertificacion, certificacionLote: f.certificacionLote, fechaEnsayo: f.fechaEnsayo || null,
        lote: { tamano: f.tamano, modelo: f.modelo, reposicion: f.reposicion, fabricacion: f.fabricacion || null, garantiaAnios: f.garantiaAnios },
        composicion: comp.filter((c) => c.talla || c.cantidad).map((c) => ({ talla: c.talla, cantidad: c.cantidad })),
        unidades: uds.map((u) => ({ ...u, paneles: u.paneles.map((p) => ({ id: p.id, zona: p.zona, amenaza: p.amenaza })) })),
        motivo: motivo || undefined,
      });
      toast.ok("Lote y unidades guardados.");
      await onListo();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form className="card" onSubmit={guardar}>
      <h2>1 · Lote y muestreo</h2>
      <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="form-grid">
          <Campo id="mat" etiqueta="Material" req span={2}><input id="mat" value={f.material} onChange={(e) => setF({ ...f, material: e.target.value })} maxLength={200} placeholder="p. ej. Chaleco antibalas nivel IIIA" /></Campo>
          <Campo id="tc" etiqueta="Tipo de certificación"><input id="tc" value={f.tipoCertificacion} onChange={(e) => setF({ ...f, tipoCertificacion: e.target.value })} maxLength={120} /></Campo>
          <Campo id="tam" etiqueta="Tamaño del lote" req><input id="tam" inputMode="numeric" value={f.tamano} onChange={(e) => setF({ ...f, tamano: e.target.value })} /></Campo>
          <Campo id="mod" etiqueta="Lote / modelo"><input id="mod" value={f.modelo} onChange={(e) => setF({ ...f, modelo: e.target.value })} maxLength={120} /></Campo>
          <Campo id="rep" etiqueta="Unidades de reposición"><input id="rep" inputMode="numeric" value={f.reposicion} onChange={(e) => setF({ ...f, reposicion: e.target.value })} /></Campo>
          <Campo id="fab" etiqueta="Fecha de fabricación"><input id="fab" type="date" value={f.fabricacion} onChange={(e) => setF({ ...f, fabricacion: e.target.value })} /></Campo>
          <Campo id="gar" etiqueta="Garantía (años)"><input id="gar" inputMode="numeric" value={f.garantiaAnios} onChange={(e) => setF({ ...f, garantiaAnios: e.target.value })} /></Campo>
          <Campo id="fe" etiqueta="Fecha de ensayo"><input id="fe" type="date" value={f.fechaEnsayo} onChange={(e) => setF({ ...f, fechaEnsayo: e.target.value })} /></Campo>
          <div className="field span-3" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <input id="cert" type="checkbox" style={{ width: "auto" }} checked={f.certificacionLote} onChange={(e) => setF({ ...f, certificacionLote: e.target.checked })} />
            <label htmlFor="cert" style={{ margin: 0, textTransform: "none", fontSize: 12.5, letterSpacing: 0 }}>Certificación de lote: si el lote cumple, corresponde el CRB además del Informe de Ensayos</label>
          </div>
        </div>

        <h3 style={{ fontSize: 13, margin: "14px 0 6px" }}>Nómina de series del lote por talla <small style={{ color: "var(--muted)", fontWeight: 400 }}>· total {total}{f.tamano && Number(f.tamano) !== total ? ` (el lote es de ${f.tamano})` : ""}</small></h3>
        <table className="data" style={{ maxWidth: 520 }}>
          <thead><tr><th>Talla</th><th className="num">Cantidad</th><th /></tr></thead>
          <tbody>
            {comp.map((c, i) => (
              <tr key={i}>
                <td><input aria-label={`Talla ${i + 1}`} value={c.talla} onChange={(e) => setComp((a) => a.map((x, k) => (k === i ? { ...x, talla: e.target.value } : x)))} maxLength={10} style={{ width: 90 }} /></td>
                <td className="num"><input aria-label={`Cantidad ${i + 1}`} inputMode="numeric" value={c.cantidad} onChange={(e) => setComp((a) => a.map((x, k) => (k === i ? { ...x, cantidad: e.target.value } : x)))} style={{ width: 90, textAlign: "right" }} /></td>
                <td>{editable && <button type="button" className="btn outline sm" onClick={() => setComp((a) => a.filter((_, k) => k !== i))} aria-label={`Quitar talla ${i + 1}`}>Quitar</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {editable && <button type="button" className="btn outline sm" style={{ marginTop: 6 }} onClick={() => setComp((a) => [...a, { talla: "", cantidad: "" }])}>＋ Talla</button>}

        <h3 style={{ fontSize: 13, margin: "16px 0 6px" }}>Unidades muestreadas y sus paneles</h3>
        {!uds.length && <p className="subtitle" style={{ margin: "0 0 6px" }}>Agregue cada chaleco, casco o probeta que se ensaya, con la serie que lo reemplaza en el lote.</p>}
        {uds.map((u, i) => (
          <div key={u.id} className="card" style={{ padding: 10, margin: "0 0 8px" }}>
            <div className="form-grid cols-4">
              <Campo id={`s${i}`} etiqueta="Serie" req><input id={`s${i}`} value={u.serie} onChange={(e) => setU(i, { serie: e.target.value })} maxLength={60} /></Campo>
              <Campo id={`t${i}`} etiqueta="Talla"><input id={`t${i}`} value={u.talla ?? ""} onChange={(e) => setU(i, { talla: e.target.value })} maxLength={10} /></Campo>
              <Campo id={`m${i}`} etiqueta="Muestra de la OT">
                <select id={`m${i}`} value={u.muestraId ?? ""} onChange={(e) => setU(i, { muestraId: e.target.value || null })}>
                  <option value="">Todo el lote</option>
                  {v.muestras.map((m) => <option key={m.id} value={m.id}>{m.codigo}{m.nombre ? ` · ${m.nombre}` : ""}</option>)}
                </select>
              </Campo>
              <Campo id={`r${i}`} etiqueta="Serie de reposición"><input id={`r${i}`} value={u.reemplazo ?? ""} onChange={(e) => setU(i, { reemplazo: e.target.value })} maxLength={60} /></Campo>
            </div>
            <table className="data" style={{ marginTop: 8 }}>
              <thead><tr><th>Panel / zona</th><th>Munición (tabla de amenazas)</th><th className="num">Disparos</th><th /></tr></thead>
              <tbody>
                {u.paneles.map((p, j) => (
                  <tr key={p.id}>
                    <td>
                      <select aria-label={`Zona del panel ${j + 1} de ${u.serie}`} value={p.zona} onChange={(e) => setU(i, { paneles: u.paneles.map((x, k) => (k === j ? { ...x, zona: e.target.value } : x)) })}>
                        {ZONAS.map((z) => <option key={z} value={z}>{z}</option>)}
                      </select>
                    </td>
                    <td>
                      <select aria-label={`Munición del panel ${j + 1} de ${u.serie}`} value={p.amenaza} onChange={(e) => setU(i, { paneles: u.paneles.map((x, k) => (k === j ? { ...x, amenaza: e.target.value } : x)) })}>
                        {v.amenazas.map((a) => <option key={a.clave} value={a.clave}>{a.norma} {a.nivel} · {a.municion} ({conComa(a.v_min, 1)}–{conComa(a.v_max, 1)} m/s)</option>)}
                      </select>
                    </td>
                    <td className="num">{p.disparos?.length ?? 0}</td>
                    <td>{editable && <button type="button" className="btn outline sm" onClick={() => setU(i, { paneles: u.paneles.filter((_, k) => k !== j) })}>Quitar panel</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {editable && (
              <div className="toolbar" style={{ margin: "6px 0 0" }}>
                <button type="button" className="btn outline sm" onClick={() => setU(i, { paneles: [...u.paneles, { id: nuevoId("p"), zona: u.paneles.length ? "posterior" : "anterior", amenaza: amenazaDefecto, disparos: [] }] })}>＋ Panel</button>
                <div className="spacer" />
                <button type="button" className="btn outline sm" onClick={() => setUds((a) => a.filter((_, k) => k !== i))}>Quitar unidad</button>
              </div>
            )}
          </div>
        ))}
        {editable && <button type="button" className="btn outline sm" onClick={() => setUds((a) => [...a, { id: nuevoId("u"), serie: "", talla: "", muestraId: v.muestras.length === 1 ? v.muestras[0].id : null, reemplazo: "", paneles: [{ id: nuevoId("p"), zona: "anterior", amenaza: amenazaDefecto, disparos: [] }] }])}>＋ Unidad muestreada</button>}
        {editable && v.datos.unidades.some((u) => u.paneles.some((p) => p.disparos.length)) && (
          <div style={{ marginTop: 10, maxWidth: 520 }}>
            <Campo id="mot" etiqueta="Motivo (si quita paneles con disparos o cambia su munición)"><input id="mot" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} /></Campo>
          </div>
        )}
      </fieldset>
      {editable && (
        <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
          <div className="spacer" />
          <button className="btn primary" disabled={ocupado || !uds.length}>{ocupado ? "Guardando…" : "Guardar lote → registro de disparos"}</button>
        </div>
      )}
    </form>
  );
}

/* --------------------------------------------------------- 2 · disparos --- */
const vacio = { n: "", zonaImpacto: "", v1: "", v2: "", trauma: "", laminasPerforadas: "", laminasTotal: "", penetracion: "", danoTestigo: "", observacion: "" };

function PasoDisparos({ v, editable, onCambio, onFin }: { v: Vista; editable: boolean; onCambio: () => Promise<any>; onFin: () => void }) {
  const lista = useMemo(() => v.evaluacion.unidades.flatMap((u) => u.paneles.map((p) => ({ u, p }))), [v]);
  const [sel, setSel] = useState(() => (lista.find((x) => !x.p.completo) ?? lista[0])?.p.id ?? "");
  const actual = lista.find((x) => x.p.id === sel) ?? lista[0];
  const [f, setF] = useState<typeof vacio>(vacio);
  const [corrigiendo, setCorrigiendo] = useState<number | null>(null);
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);

  if (!lista.length) return <div className="card"><p className="subtitle" style={{ margin: 0 }}>Primero registre las unidades y sus paneles en «Lote y muestreo».</p></div>;
  const { u, p } = actual;
  const a = p.amenazaFila;
  const plan = a?.disparos ?? 0;
  const siguiente = p.disparos.length + 1;
  const n = corrigiendo ?? siguiente;
  const pideTrauma = a?.trauma_max != null && n <= (a?.disparos_trauma ?? 0);
  const puedeDisparar = editable && !p.cerrado && (corrigiendo != null || (!p.detenido && siguiente <= plan));

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true);
    try {
      const r = await llamar<any>("POST", `/formularios/ot/${v.ot.id}/disparos/disparo`, {
        unidadId: u.id, panelId: p.id, motivo: corrigiendo != null ? motivo : undefined,
        disparo: {
          n, zonaImpacto: f.zonaImpacto || null, v1: aNum(f.v1), v2: aNum(f.v2), trauma: aNum(f.trauma),
          laminasPerforadas: aNum(f.laminasPerforadas), laminasTotal: aNum(f.laminasTotal),
          penetracion: f.penetracion === "si" ? true : f.penetracion === "no" ? false : null,
          danoTestigo: f.danoTestigo === "si" ? true : f.danoTestigo === "no" ? false : null, observacion: f.observacion || null,
        },
      });
      const pe = r.panel;
      if (pe.detenido) toast.error(`Panel detenido: ${pe.disparos.find((d: any) => d.condicion === "no_cumple")?.motivos?.join(", ")}. El lote no cumple.`);
      else toast.ok(corrigiendo != null ? `Disparo ${n} corregido.` : `Disparo ${n} guardado.`);
      for (const av of pe.avisos ?? []) toast.error(av);
      setF({ ...vacio, zonaImpacto: f.zonaImpacto, laminasTotal: f.laminasTotal });
      setCorrigiendo(null);
      setMotivo("");
      await onCambio();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setOcupado(false);
    }
  }

  async function cerrarPanel() {
    setOcupado(true);
    try {
      await llamar("POST", `/formularios/ot/${v.ot.id}/disparos/cerrar-panel`, { unidadId: u.id, panelId: p.id });
      toast.ok(`Panel ${p.zona} de ${u.serie} cerrado.`);
      const r = await onCambio();
      const sig = r?.evaluacion?.unidades.flatMap((x: any) => x.paneles).find((x: any) => !x.cerrado);
      if (sig) setSel(sig.id);
      else onFin();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setOcupado(false);
    }
  }

  const filas = Array.from({ length: Math.max(plan, p.disparos.length) }, (_, i) => p.disparos.find((d) => d.n === i + 1) ?? null);
  return (
    <div className="card">
      <h2>2 · Registro de disparos</h2>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }} role="tablist" aria-label="Paneles">
        {lista.map(({ u: uu, p: pp }) => (
          <button key={pp.id} role="tab" aria-selected={pp.id === p.id} type="button" className={`btn sm ${pp.id === p.id ? "primary" : "outline"}`} onClick={() => { setSel(pp.id); setCorrigiendo(null); setF(vacio); }}>
            {uu.serie} · {pp.zona} <Veredicto v={pp.veredicto} />{pp.cerrado ? " 🔒" : ""}
          </button>
        ))}
      </div>
      <p className="subtitle" style={{ margin: "0 0 8px" }}>
        <b>{u.serie}{u.talla ? ` (${u.talla})` : ""} · panel {p.zona}</b> · {a ? `${a.norma} ${a.nivel} · ${a.municion}${a.masa_g ? ` ${conComa(a.masa_g)} g` : ""} · ventana ${conComa(a.v_min, 1)}–${conComa(a.v_max, 1)} m/s · ${plan} disparos` : "munición fuera de la tabla"} ·{" "}
        {a?.criterio}{a?.trauma_max != null ? ` (trauma en los disparos 1 a ${a.disparos_trauma})` : ""}.
      </p>
      <table className="data">
        <thead><tr><th className="num">Nº</th><th>Zona de impacto</th><th className="num">V1 (m/s)</th><th className="num">V2 (m/s)</th><th className="num">Trauma (mm)</th><th className="num">Láminas</th><th>Penetración</th>{a?.testigo && <th>Testigo</th>}<th>Condición</th><th /></tr></thead>
        <tbody>
          {filas.map((d, i) =>
            d ? (
              <tr key={i} style={d.fueraVentana ? { background: "#fff6e8" } : undefined}>
                <td className="num">{d.n}</td>
                <td>{d.zonaImpacto ?? "—"}</td>
                <td className="num">{conComa(d.v1, 1)}{d.fueraVentana ? <span className="pill amber" style={{ marginLeft: 4 }} title="Velocidad fuera de la ventana de la norma">fuera de ventana</span> : null}</td>
                <td className="num">{conComa(d.v2 ?? null, 1) || "—"}</td>
                <td className="num">{conComa(d.trauma ?? null, 1) || "—"}</td>
                <td className="num">{d.laminasPerforadas != null ? `${d.laminasPerforadas}${d.laminasTotal != null ? `/${d.laminasTotal}` : ""}` : "—"}</td>
                <td>{d.penetracion ? <b style={{ color: "var(--red)" }}>Sí</b> : "No"}</td>
                {a?.testigo && <td>{d.danoTestigo ? "Con daño" : "Sin daño"}</td>}
                <td><Veredicto v={d.condicion} />{d.motivos?.length ? <small style={{ display: "block", color: "var(--muted)" }}>{d.motivos.join(", ")}</small> : null}</td>
                <td>{editable && !p.cerrado && <button type="button" className="btn outline sm" onClick={() => { setCorrigiendo(d.n); setF({ n: String(d.n), zonaImpacto: d.zonaImpacto ?? "", v1: conComa(d.v1, 2), v2: conComa(d.v2 ?? null, 2), trauma: conComa(d.trauma ?? null, 2), laminasPerforadas: d.laminasPerforadas != null ? String(d.laminasPerforadas) : "", laminasTotal: d.laminasTotal != null ? String(d.laminasTotal) : "", penetracion: d.penetracion ? "si" : "no", danoTestigo: d.danoTestigo ? "si" : d.danoTestigo === false ? "no" : "", observacion: d.observacion ?? "" }); }}>Corregir</button>}</td>
              </tr>
            ) : (
              <tr key={i} style={{ color: "var(--muted)" }}>
                <td className="num">{i + 1}</td>
                <td colSpan={a?.testigo ? 9 : 8}>{p.detenido ? "-.- (panel detenido)" : "Por disparar"}</td>
              </tr>
            ),
          )}
        </tbody>
      </table>
      {p.avisos.length > 0 && <div className="alert warn" style={{ marginTop: 8 }}>{p.avisos.join(" ")} Regla por confirmar con el IDIC (EP-05 P4).</div>}

      {puedeDisparar && (
        <form onSubmit={guardar} style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
          <h3 style={{ fontSize: 13, margin: "0 0 8px" }}>{corrigiendo != null ? `Corregir el disparo Nº ${corrigiendo}` : `Disparo Nº ${siguiente} de ${plan}`}</h3>
          <div className="form-grid cols-4">
            <Campo id="zi" etiqueta="Zona de impacto"><input id="zi" value={f.zonaImpacto} onChange={(e) => setF({ ...f, zonaImpacto: e.target.value })} maxLength={40} /></Campo>
            <Campo id="v1" etiqueta="V1 (m/s)" req><input id="v1" inputMode="decimal" value={f.v1} onChange={(e) => setF({ ...f, v1: e.target.value })} autoFocus /></Campo>
            <Campo id="v2" etiqueta="V2 (m/s)"><input id="v2" inputMode="decimal" value={f.v2} onChange={(e) => setF({ ...f, v2: e.target.value })} /></Campo>
            <Campo id="tr" etiqueta="Trauma (mm)" req={pideTrauma}><input id="tr" inputMode="decimal" value={f.trauma} onChange={(e) => setF({ ...f, trauma: e.target.value })} /></Campo>
            <Campo id="lp" etiqueta="Láminas perforadas"><input id="lp" inputMode="numeric" value={f.laminasPerforadas} onChange={(e) => setF({ ...f, laminasPerforadas: e.target.value })} /></Campo>
            <Campo id="lt" etiqueta="Láminas del panel"><input id="lt" inputMode="numeric" value={f.laminasTotal} onChange={(e) => setF({ ...f, laminasTotal: e.target.value })} /></Campo>
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>Penetración completa <span className="req">*</span></legend>
              <div style={{ display: "flex", gap: 12, paddingTop: 6 }}>
                <label style={{ fontSize: 12.5, textTransform: "none", letterSpacing: 0, color: "var(--ink)" }}><input type="radio" name="pen" checked={f.penetracion === "no"} onChange={() => setF({ ...f, penetracion: "no" })} style={{ width: "auto" }} /> No</label>
                <label style={{ fontSize: 12.5, textTransform: "none", letterSpacing: 0, color: "var(--ink)" }}><input type="radio" name="pen" checked={f.penetracion === "si"} onChange={() => setF({ ...f, penetracion: "si" })} style={{ width: "auto" }} /> Sí</label>
              </div>
            </fieldset>
            {a?.testigo && (
              <Campo id="dt" etiqueta="Daño en el testigo" req>
                <select id="dt" value={f.danoTestigo} onChange={(e) => setF({ ...f, danoTestigo: e.target.value })}><option value="">—</option><option value="no">Sin daño</option><option value="si">Con daño</option></select>
              </Campo>
            )}
            <Campo id="ob" etiqueta="Observación" span={2}><input id="ob" value={f.observacion} onChange={(e) => setF({ ...f, observacion: e.target.value })} maxLength={300} /></Campo>
            {corrigiendo != null && <Campo id="mc" etiqueta="Motivo de la corrección" req span={2}><input id="mc" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} /></Campo>}
          </div>
          <div className="toolbar" style={{ marginTop: 10, marginBottom: 0 }}>
            {corrigiendo != null && <button type="button" className="btn outline sm" onClick={() => { setCorrigiendo(null); setF(vacio); }}>Cancelar corrección</button>}
            <div className="spacer" />
            <button className="btn primary" disabled={ocupado || !f.v1 || !f.penetracion}>{ocupado ? "Guardando…" : corrigiendo != null ? "Guardar corrección" : "Guardar disparo → siguiente disparo"}</button>
          </div>
        </form>
      )}
      {editable && !p.cerrado && p.completo && corrigiendo == null && (
        <div className="toolbar" style={{ marginTop: 10, marginBottom: 0 }}>
          <span className="subtitle" style={{ margin: 0 }}>{p.detenido ? "El panel se detuvo: los disparos restantes no se hacen." : "Plan de disparos completo."}</span>
          <div className="spacer" />
          <button type="button" className="btn primary" disabled={ocupado} onClick={cerrarPanel}>Cerrar panel → siguiente panel</button>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------- 3 · requisitos --- */
function PasoRequisitos({ v }: { v: Vista }) {
  return (
    <div className="card">
      <h2>3 · Requisitos por norma <span className="right">Administración › Parámetros del sistema › LRB</span></h2>
      <p className="subtitle">Tabla de amenazas vigente. Son los valores de los informes reales del LRB, a la espera de la tabla oficial del IDIC (EP-05 P3). Se compara la velocidad {v.velocidadManda === "promedio" ? "promedio de V1 y V2" : v.velocidadManda.toUpperCase()} (P4).</p>
      <table className="data">
        <thead><tr><th>Norma · nivel</th><th>Elemento</th><th>Munición</th><th className="num">Masa (g)</th><th>Ventana (m/s)</th><th className="num">Disparos</th><th>Trauma</th><th>Criterio</th></tr></thead>
        <tbody>
          {v.amenazas.map((a) => (
            <tr key={a.clave}>
              <td>{a.norma} · {a.nivel}</td><td>{a.elemento}</td><td>{a.municion}</td><td className="num">{conComa(a.masa_g)}</td>
              <td>{conComa(a.v_min, 1)}–{conComa(a.v_max, 1)}</td><td className="num">{a.disparos}</td>
              <td>{a.trauma_max != null ? `≤ ${conComa(a.trauma_max, 1)} mm (disparos 1 a ${a.disparos_trauma})` : "—"}</td><td>{a.criterio}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* --------------------------------------------------------- 4 · conclusión --- */
function PasoConclusion({ v, otId, puede, onCambio }: { v: Vista; otId: string; puede: boolean; onCambio: () => Promise<any> }) {
  const [ocupado, setOcupado] = useState(false);
  const [motivo, setMotivo] = useState("");
  const cerrado = v.registro?.estado === "cerrado";
  const incompletos = v.evaluacion.unidades.flatMap((u) => u.paneles.filter((p) => !p.completo).map((p) => `${u.serie} · ${p.zona}`));
  const ev = v.evaluacion;

  async function concluir() {
    setOcupado(true);
    try {
      const r = await llamar<any>("POST", `/formularios/ot/${otId}/disparos/concluir`, {});
      const malos = (r.llevados ?? []).filter((x: any) => !x.ok);
      if (malos.length) toast.error(`No se actualizaron ${malos.length} ensayo(s): ${malos.map((x: any) => x.motivo).join(" ")}`);
      else toast.ok("Lote concluido: el veredicto pasó a los ensayos de la OT.");
      await onCambio();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }
  async function reabrir() {
    setOcupado(true);
    try {
      await llamar("POST", `/formularios/ot/${otId}/disparos/reabrir`, { motivo });
      toast.ok("Registro reabierto.");
      setMotivo("");
      await onCambio();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="card">
      <h2>4 · Conclusión del lote y documento</h2>
      <div className="form-grid cols-4" style={{ marginBottom: 10 }}>
        <div className="kpi"><div className="lab">Veredicto del lote</div><div className="val" style={{ fontSize: 16 }}><Veredicto v={ev.veredicto} /></div></div>
        <div className="kpi"><div className="lab">Unidades</div><div className="val">{ev.unidades.length}</div></div>
        <div className="kpi"><div className="lab">Disparos</div><div className="val">{ev.disparos}</div></div>
        <div className="kpi"><div className="lab">Penetración completa</div><div className="val" style={{ fontSize: 16 }}>{ev.penetracion ? "Sí" : "No"}</div></div>
      </div>
      <p style={{ fontSize: 12.5 }}><b>Regla:</b> sin penetración completa y trauma dentro del máximo; una penetración completa rechaza el lote (EP-05 5.2).{ev.falla ? <> <b>Falla:</b> {ev.falla}.</> : null}</p>
      <table className="data" style={{ maxWidth: 640, marginBottom: 10 }}>
        <thead><tr><th>Unidad</th><th>Paneles</th><th>Veredicto</th></tr></thead>
        <tbody>{ev.unidades.map((u) => <tr key={u.id}><td>{u.serie}{u.talla ? ` (${u.talla})` : ""}</td><td>{u.paneles.map((p) => p.zona).join(", ")}</td><td><Veredicto v={u.veredicto} /></td></tr>)}</tbody>
      </table>
      <h3 style={{ fontSize: 13, margin: "8px 0 4px" }}>Documento que corresponde</h3>
      {ev.documentos.length ? (
        <ul style={{ margin: "0 0 8px 18px", fontSize: 12.5 }}>{ev.documentos.map((d) => <li key={d}>{DOC[d] ?? d}</li>)}</ul>
      ) : <p className="subtitle">Se define al completar los paneles.</p>}
      {cerrado && (
        <div className="alert info">
          Se emite en <Link href={`/ot/${otId}?tab=informe` as any} style={{ fontWeight: 600 }}>OT › Informe y cierre</Link> con la plantilla «LRB · {ev.veredicto === "no_cumple" ? "Informe de Ensayo de Rechazo" : "Certificado de Resistencia Balística (CRB)"}», tras revisar y aprobar los ensayos.
          {ev.veredicto === "cumple" && v.faltantesCrb.length > 0 && <> Para el CRB falta: {v.faltantesCrb.join(" ")}</>}
        </div>
      )}
      {puede && !cerrado && (
        <div className="toolbar" style={{ marginBottom: 0 }}>
          {incompletos.length > 0 && <span className="subtitle" style={{ margin: 0 }}>Paneles sin completar: {incompletos.join(", ")}.</span>}
          <div className="spacer" />
          <button type="button" className="btn primary" disabled={ocupado || incompletos.length > 0 || !ev.unidades.length} onClick={concluir}>Concluir lote → documento</button>
        </div>
      )}
      {puede && cerrado && (
        <div className="toolbar" style={{ marginBottom: 0, alignItems: "flex-end" }}>
          <div style={{ flex: 1, maxWidth: 520 }}><Campo id="mre" etiqueta="Motivo para reabrir (queda en la bitácora)"><input id="mre" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} /></Campo></div>
          <button type="button" className="btn outline" disabled={ocupado || motivo.trim().length < 5} onClick={reabrir}>Reabrir el registro</button>
        </div>
      )}
    </div>
  );
}

export default function DisparosPage() {
  return (
    <Suspense fallback={<SkeletonCards n={3} />}>
      <Contenido />
    </Suspense>
  );
}
