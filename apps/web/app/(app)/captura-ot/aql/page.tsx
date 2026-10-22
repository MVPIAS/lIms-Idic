"use client";

/**
 * Inspección por atributos del lote · AQL (EP-03 3.7, LCC y LTX) · NCh 44.
 *
 *   1 Lote: tamaño del lote.
 *   2 Inspecciones: por cada una (numeración, terminación, embalaje…) AQL, nivel,
 *     letra código, n, Ac, Re (de la tabla, o fijados con motivo), defectuosos y
 *     cumplimiento. Una fila por ensayo de inspección por atributos de la OT.
 *   3 Sección V del IVC: el bloque que imprime el informe.
 *   «Evaluar AQL → informe» lleva Acepta / Rechaza a cada ensayo.
 *
 * API: GET|PUT /formularios/ot/:otId/aql
 */
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { PageHeader, SkeletonCards } from "@/components/ui/PageHeader";
import { toast } from "@/components/ui/feedback";
import { llamar } from "@/lib/laboratorio";
import { Bitacora, Campo, Pasos, Veredicto, type PasoFormulario } from "@/components/formularios/comun";

const NIVELES = ["S-1", "S-2", "S-3", "S-4", "I", "II", "III"];
const AQLS = ["0,010", "0,015", "0,025", "0,040", "0,065", "0,10", "0,15", "0,25", "0,40", "0,65", "1,0", "1,5", "2,5", "4,0", "6,5", "10", "15", "25", "40", "65", "100", "150", "250", "400", "650", "1000"];

interface Fila { inspeccion: string; aql: string; nivel: string; defectuosos: number | null | string; acManual?: number | null | string; reManual?: number | null | string; motivoManual?: string | null; resultadoId?: string | null }
interface Vista {
  ot: { id: string; codigo: string; estado: string; cliente: string | null; laboratorio: string | null };
  registro: { estado: string; version: number } | null;
  tamanoLote: number | null;
  filas: Fila[];
  evaluacion: { filas: any[]; errores: string[]; cumple: boolean | null } | null;
  config: { nivel: string; aql: string };
  ensayos: any[];
  eventos: any[];
  puedeEditar: boolean;
}

function Contenido() {
  const otId = useSearchParams().get("otId") ?? "";
  const [v, setV] = useState<Vista | null>(null);
  const [error, setError] = useState("");
  const [tamano, setTamano] = useState("");
  const [filas, setFilas] = useState<Fila[]>([]);
  const [motivo, setMotivo] = useState("");
  const [paso, setPaso] = useState("inspecciones");
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const r = await llamar<Vista>("GET", `/formularios/ot/${otId}/aql`);
      setV(r);
      setTamano(r.tamanoLote ? String(r.tamanoLote) : "");
      setFilas(r.filas.map((f) => ({ ...f, defectuosos: f.defectuosos ?? "", acManual: f.acManual ?? "", reManual: f.reManual ?? "" })));
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, [otId]);
  useEffect(() => { if (otId) cargar(); }, [otId, cargar]);

  if (!otId) return <div className="alert warn">Abra la inspección por atributos desde la OT o desde «Captura y revisión por OT».</div>;
  if (error) return <div className="alert warn">{error}</div>;
  if (!v) return <SkeletonCards n={2} />;
  const editable = v.puedeEditar;
  const evaluado = v.registro?.estado === "evaluado";
  const ev = v.evaluacion;
  const pasos: PasoFormulario[] = [
    { clave: "inspecciones", titulo: "Lote e inspecciones", estado: evaluado ? "hecho" : "actual", detalle: v.tamanoLote ? `Lote ${v.tamanoLote.toLocaleString("es-CL")} · ${v.filas.length} inspecciones` : "Indique el lote" },
    { clave: "ivc", titulo: "Sección V del IVC", estado: evaluado ? "hecho" : "pendiente", detalle: ev?.cumple == null ? "Pendiente" : ev.cumple ? "Acepta" : "Rechaza alguna" },
  ];
  const setF = (i: number, p: Partial<Fila>) => setFilas((a) => a.map((f, k) => (k === i ? { ...f, ...p } : f)));
  const ent = (x: any) => (x === "" || x == null ? null : Number(x));

  async function evaluar(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true);
    try {
      const r = await llamar<any>("PUT", `/formularios/ot/${otId}/aql`, {
        tamanoLote: Number(tamano),
        filas: filas.map((f) => ({ ...f, defectuosos: ent(f.defectuosos), acManual: ent(f.acManual), reManual: ent(f.reManual) })),
        motivo: motivo || undefined,
      });
      const malos = (r.llevados ?? []).filter((x: any) => !x.ok);
      if (malos.length) toast.error(`Ensayos sin actualizar: ${malos.map((x: any) => x.motivo).join(" ")}`);
      else toast.ok("Inspección evaluada: el cumplimiento pasó a sus ensayos.");
      setMotivo("");
      await cargar();
      setPaso("ivc");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div>
      <PageHeader
        titulo={`Inspección por atributos (AQL) · OT ${v.ot.codigo}`}
        subtitulo={`${v.ot.cliente ?? ""} · ${v.ot.laboratorio ?? ""} · NCh 44, muestreo simple, inspección normal. Acepta si los defectuosos son ≤ Ac; rechaza si son ≥ Re.`}
        migas={[{ label: "Captura y revisión por OT", href: `/captura-ot?otId=${otId}` }, { label: v.ot.codigo, href: `/ot/${otId}` }, { label: "Inspección por atributos" }]}
        acciones={ev ? <Veredicto v={ev.cumple == null ? "pendiente" : ev.cumple ? "cumple" : "no_cumple"} prefijo="Lote" /> : null}
      />
      {!editable && <div className="alert info">Usted ve la inspección en modo consulta.</div>}
      <Pasos pasos={pasos} activo={paso} onElegir={setPaso} />
      {paso === "inspecciones" && (
        <form className="card" onSubmit={evaluar}>
          <h2>Lote e inspecciones <span className="right">Nivel y AQL por defecto: Parámetros › Inspección por atributos</span></h2>
          <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0 }}>
            <div className="form-grid" style={{ maxWidth: 520 }}>
              <Campo id="tl" etiqueta="Tamaño del lote (unidades)" req><input id="tl" inputMode="numeric" value={tamano} onChange={(e) => setTamano(e.target.value)} /></Campo>
            </div>
            <table className="data" style={{ marginTop: 10 }}>
              <thead><tr><th>Inspección</th><th>AQL</th><th>Nivel</th><th>Letra</th><th className="num">n</th><th className="num">Ac</th><th className="num">Re</th><th className="num">Defectuosos</th><th>Cumplimiento</th><th /></tr></thead>
              <tbody>
                {filas.map((f, i) => {
                  const e = ev?.filas?.[i];
                  return (
                    <tr key={i}>
                      <td>
                        <input className="celda" aria-label={`Inspección ${i + 1}`} value={f.inspeccion} onChange={(x) => setF(i, { inspeccion: x.target.value })} maxLength={160} style={{ width: "100%" }} />
                        {f.resultadoId ? <small style={{ color: "var(--muted)" }}>Ensayo de la OT</small> : <small style={{ color: "var(--muted)" }}>Solo para el informe</small>}
                      </td>
                      <td><select className="celda" aria-label={`AQL de la inspección ${i + 1}`} value={f.aql} onChange={(x) => setF(i, { aql: x.target.value })}>{AQLS.map((a) => <option key={a}>{a}</option>)}</select></td>
                      <td><select className="celda" aria-label={`Nivel de la inspección ${i + 1}`} value={f.nivel} onChange={(x) => setF(i, { nivel: x.target.value })}>{NIVELES.map((a) => <option key={a}>{a}</option>)}</select></td>
                      <td>{e?.plan?.letra ?? "—"}{e?.plan && e.plan.letraPlan !== e.plan.letra ? <small style={{ display: "block", color: "var(--muted)" }}>→ {e.plan.letraPlan}</small> : null}</td>
                      <td className="num">{e?.plan?.n ?? "—"}</td>
                      <td className="num"><input className="celda" aria-label={`Ac manual ${i + 1}`} inputMode="numeric" placeholder={e ? String(e.plan.ac) : "tabla"} value={f.acManual ?? ""} onChange={(x) => setF(i, { acManual: x.target.value })} style={{ width: 52, textAlign: "right" }} /></td>
                      <td className="num"><input className="celda" aria-label={`Re manual ${i + 1}`} inputMode="numeric" placeholder={e ? String(e.plan.re) : "tabla"} value={f.reManual ?? ""} onChange={(x) => setF(i, { reManual: x.target.value })} style={{ width: 52, textAlign: "right" }} /></td>
                      <td className="num"><input className="celda" aria-label={`Defectuosos de la inspección ${i + 1}`} inputMode="numeric" value={f.defectuosos ?? ""} onChange={(x) => setF(i, { defectuosos: x.target.value })} style={{ width: 70, textAlign: "right" }} /></td>
                      <td>{e ? <Veredicto v={e.cumplimiento} /> : "—"}</td>
                      <td>{editable && !f.resultadoId && <button type="button" className="btn outline sm" onClick={() => setFilas((a) => a.filter((_, k) => k !== i))}>Quitar</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filas.some((f) => f.acManual !== "" && f.acManual != null) && (
              <div className="form-grid cols-2" style={{ marginTop: 8 }}>
                {filas.map((f, i) => (f.acManual !== "" && f.acManual != null ? (
                  <Campo key={i} id={`mm${i}`} etiqueta={`Motivo de Ac/Re fijados · ${f.inspeccion || `inspección ${i + 1}`}`} req><input id={`mm${i}`} value={f.motivoManual ?? ""} onChange={(x) => setF(i, { motivoManual: x.target.value })} maxLength={300} placeholder="p. ej. plan del contrato" /></Campo>
                ) : null))}
              </div>
            )}
            {editable && <button type="button" className="btn outline sm" style={{ marginTop: 8 }} onClick={() => setFilas((a) => [...a, { inspeccion: "", aql: v.config.aql, nivel: v.config.nivel, defectuosos: "" }])}>＋ Inspección (solo informe)</button>}
            {evaluado && editable && <div style={{ maxWidth: 520, marginTop: 10 }}><Campo id="mo" etiqueta="Motivo de la corrección (ya evaluada)"><input id="mo" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} /></Campo></div>}
          </fieldset>
          {ev?.errores?.length ? <div className="alert warn" style={{ marginTop: 8 }}>{ev.errores.join(" ")}</div> : null}
          {editable && (
            <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
              <div className="spacer" />
              <button className="btn primary" disabled={ocupado || !tamano || !filas.length}>{ocupado ? "Evaluando…" : "Evaluar AQL → informe"}</button>
            </div>
          )}
        </form>
      )}
      {paso === "ivc" && (
        <div className="card">
          <h2>Sección V del IVC · Inspección por atributos (AQL)</h2>
          {ev && v.tamanoLote ? (
            <>
              <p className="subtitle">Tamaño del lote: {v.tamanoLote.toLocaleString("es-CL")} unidades. Así se imprime en el Informe de Verificación de Calidad.</p>
              <table className="data">
                <thead><tr><th>Inspección</th><th className="num">AQL</th><th>Nivel</th><th>Letra</th><th className="num">n</th><th className="num">Ac</th><th className="num">Re</th><th className="num">Defectuosos</th><th>Cumplimiento</th></tr></thead>
                <tbody>{ev.filas.map((f: any, i: number) => <tr key={i}><td>{f.inspeccion}</td><td className="num">{f.aql}</td><td>{f.nivel}</td><td>{f.plan.letra}</td><td className="num">{f.plan.n}</td><td className="num">{f.ac}</td><td className="num">{f.re}</td><td className="num">{f.defectuosos ?? "—"}</td><td><Veredicto v={f.cumplimiento} /></td></tr>)}</tbody>
              </table>
              <p className="subtitle" style={{ marginTop: 8 }}>Se emite en <Link href={`/ot/${otId}?tab=informe` as any}>OT › Informe y cierre</Link> con una plantilla IVC, tras revisar y aprobar los ensayos.</p>
            </>
          ) : <p className="subtitle" style={{ margin: 0 }}>Indique el lote y evalúe las inspecciones.</p>}
        </div>
      )}
      <Bitacora eventos={v.eventos} />
    </div>
  );
}

export default function AqlPage() {
  return (
    <Suspense fallback={<SkeletonCards n={2} />}>
      <Contenido />
    </Suspense>
  );
}
