"use client";

/**
 * Formulario de captura estándar de UN ensayo (todos los laboratorios).
 *
 *  1. Especificación: Mín / Nom / Máx, unidad, requisito, tipo de dato y
 *     fórmula. Lo que trae el catálogo viene precargado; lo que no, sale vacío
 *     y se completa aquí, SOLO para esta orden (queda marcado «de la orden»).
 *     Rellenar lo vacío lo hace quien captura; cambiar lo del catálogo, el
 *     tipo o la fórmula, la jefatura.
 *  2. Captura: numérico (valor, réplicas o lecturas con los campos del método
 *     si hay fórmula) o atributo (Cumple / No cumple con observación).
 *
 * El cálculo y el veredicto los hace el servidor
 * (apps/api/src/laboratorio/captura-estandar.ts).
 */
import { useMemo, useState } from "react";
import { fechaHora } from "@/lib/format";
import { toast } from "@/components/ui/feedback";
import { llamar, leerReplicas } from "@/lib/laboratorio";

export interface EnsayoEditable {
  id: string;
  estado: string;
  analito: string;
  metodo: string | null;
  tipoDato: "numerico" | "atributo";
  limiteInf: string | null;
  nominal: string | null;
  limiteSup: string | null;
  unidad: string | null;
  requisito: string | null;
  formula: string | null;
  formulaAplicable: string | null;
  nCampos: number;
  campos: { nombre: string; unidad: string | null }[];
  formulaMotivo: string | null;
  formulaLegado: string | null;
  especOrigen: string;
  especCatalogo: Record<string, any> | null;
  especEditadaPorNombre: string | null;
  especEditadaAt: string | null;
  valorTexto: string | null;
  valorNumerico: number | string | null;
  observacion: string | null;
  lecturas: Record<string, number>[] | null;
  veredicto: string | null;
}

const CAMPOS: { k: "limiteInf" | "nominal" | "limiteSup" | "unidad"; l: string }[] = [
  { k: "limiteInf", l: "Mín" },
  { k: "nominal", l: "Nominal" },
  { k: "limiteSup", l: "Máx" },
  { k: "unidad", l: "Unidad" },
];

const vacio = (v: any) => v == null || String(v).trim() === "";

export default function EditorEnsayo({
  e,
  puedeCapturar,
  esJefatura,
  onGuardado,
}: {
  e: EnsayoEditable;
  puedeCapturar: boolean;
  /** resultado.aprobar: puede cambiar lo que vino del catálogo y la fórmula */
  esJefatura: boolean;
  onGuardado: (r: any) => void;
}) {
  const cat = e.especCatalogo ?? {};
  const [esp, setEsp] = useState({
    tipoDato: e.tipoDato,
    limiteInf: e.limiteInf ?? "",
    nominal: e.nominal ?? "",
    limiteSup: e.limiteSup ?? "",
    unidad: e.unidad ?? "",
    requisito: e.requisito ?? "",
    formula: e.formula ?? "",
  });
  const [guardando, setGuardando] = useState(false);

  // Captura
  const nCampos = e.nCampos;
  const [lecturas, setLecturas] = useState<string[][]>(() =>
    e.lecturas?.length
      ? e.lecturas.map((l) => Array.from({ length: nCampos }, (_, i) => String(l[`C${i + 1}`] ?? "").replace(".", ",")))
      : [Array.from({ length: nCampos }, () => "")],
  );
  const [valor, setValor] = useState(() => (e.valorNumerico != null && e.valorNumerico !== "" ? String(e.valorNumerico).replace(".", ",") : e.valorTexto ?? ""));
  const [atributo, setAtributo] = useState<"" | "cumple" | "no_cumple">(
    e.tipoDato === "atributo" && (e.veredicto === "cumple" || e.veredicto === "no_cumple") ? e.veredicto : "",
  );
  const [observacion, setObservacion] = useState(e.observacion ?? "");

  const editable = (k: string) =>
    puedeCapturar && (esJefatura || vacio(cat[k]) || (k === "tipoDato" && ["limiteInf", "nominal", "limiteSup", "requisito"].every((c) => vacio(cat[c]))));
  const cambiosEsp = useMemo(() => {
    const out: Record<string, string | null> = {};
    const actual: Record<string, any> = { ...e, tipoDato: e.tipoDato };
    for (const k of ["tipoDato", "limiteInf", "nominal", "limiteSup", "unidad", "requisito", "formula"] as const) {
      const a = vacio(actual[k]) ? "" : String(actual[k]).trim();
      const n = String((esp as any)[k] ?? "").trim();
      if (a !== n) out[k] = n === "" ? null : n;
    }
    return out;
  }, [esp, e]);
  const hayCambiosEsp = Object.keys(cambiosEsp).length > 0;

  async function guardarEspecificacion() {
    setGuardando(true);
    try {
      const r = await llamar("PATCH", `/flujo/resultado/${e.id}/especificacion`, cambiosEsp);
      toast.ok("Especificación de la orden guardada.");
      onGuardado(r);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setGuardando(false);
    }
  }

  async function guardarCaptura() {
    let cuerpo: any;
    if (e.tipoDato === "atributo") {
      if (!atributo) { toast.error("Elija Cumple o No cumple."); return; }
      if (atributo === "no_cumple" && !observacion.trim()) { toast.error("Indique la observación: qué no cumple y por qué."); return; }
      cuerpo = { atributo, valor: valor.trim() || undefined, observacion: observacion.trim() || undefined };
    } else if (nCampos > 0 && e.formulaAplicable) {
      const filas = lecturas.filter((l) => l.some((c) => c.trim() !== ""));
      if (!filas.length) { toast.error("Ingrese al menos una lectura."); return; }
      cuerpo = {
        lecturas: filas.map((l) => Object.fromEntries(l.map((c, i) => [`C${i + 1}`, c.trim()]))),
        observacion: observacion.trim() || undefined,
      };
    } else {
      const t = valor.trim();
      if (!t) { toast.error("Ingrese el valor o las réplicas."); return; }
      const r = leerReplicas(t);
      const varias = r.invalidos.length === 0 && r.valores.length > 1;
      cuerpo = varias ? { replicasTexto: t } : { valor: t };
      if (observacion.trim()) cuerpo.observacion = observacion.trim();
    }
    setGuardando(true);
    try {
      const r = await llamar("POST", `/flujo/resultado/${e.id}/valor`, cuerpo);
      toast.ok("Resultado guardado.");
      onGuardado(r);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setGuardando(false);
    }
  }

  const etiquetaCampo = (i: number) => {
    const c = e.campos[i];
    return c ? `${c.nombre}${c.unidad ? ` (${c.unidad})` : ""}` : `Campo ${i + 1}`;
  };

  return (
    <div style={{ display: "grid", gap: 12, padding: "6px 2px" }}>
      {/* ---------------- Especificación ---------------- */}
      <div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
          <b style={{ fontSize: 12.5 }}>Especificación</b>
          {e.especOrigen === "orden" ? (
            <span className="pill amber" title="Completada o cambiada para esta orden; el catálogo no se modificó">
              De la orden{e.especEditadaPorNombre ? ` · ${e.especEditadaPorNombre}` : ""}{e.especEditadaAt ? ` · ${fechaHora(e.especEditadaAt)}` : ""}
            </span>
          ) : (
            <span className="pill gray">Del catálogo</span>
          )}
          {!esJefatura && <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Puede completar lo que el catálogo dejó vacío; cambiar lo demás lo hace la jefatura.</span>}
        </div>
        <div className="form-grid cols-4">
          <div className="field">
            <label>Tipo de dato</label>
            <select value={esp.tipoDato} disabled={!editable("tipoDato")} onChange={(x) => setEsp({ ...esp, tipoDato: x.target.value as any })}>
              <option value="numerico">Numérico (veredicto por Mín / Máx)</option>
              <option value="atributo">Atributo (Cumple / No cumple)</option>
            </select>
          </div>
          {CAMPOS.map((c) => (
            <div key={c.k} className={`field${editable(c.k) ? "" : " readonly"}`}>
              <label>{c.l}{!vacio(cat[c.k]) && String(cat[c.k]) !== String((esp as any)[c.k]) ? ` · catálogo: ${cat[c.k]}` : ""}</label>
              <input value={(esp as any)[c.k]} readOnly={!editable(c.k)} onChange={(x) => setEsp({ ...esp, [c.k]: x.target.value })}
                placeholder={editable(c.k) ? "vacío" : ""} />
            </div>
          ))}
          <div className={`field span-3${editable("requisito") ? "" : " readonly"}`}>
            <label>Requisito (texto){!vacio(cat.requisito) && cat.requisito !== esp.requisito ? ` · catálogo: ${cat.requisito}` : ""}</label>
            <input value={esp.requisito} readOnly={!editable("requisito")} onChange={(x) => setEsp({ ...esp, requisito: x.target.value })} />
          </div>
          <div className={`field span-2${esJefatura && puedeCapturar ? "" : " readonly"}`}>
            <label>Fórmula {nCampos > 0 ? `(campos C1..C${nCampos})` : ""}</label>
            <input value={esp.formula} readOnly={!(esJefatura && puedeCapturar)} style={{ fontFamily: "'JetBrains Mono', monospace" }}
              placeholder={esJefatura ? "p. ej. (C1 - C2) / C3 * 100" : "sin fórmula: el valor se ingresa directo"}
              onChange={(x) => setEsp({ ...esp, formula: x.target.value })} />
          </div>
        </div>
        {e.formulaMotivo && (
          <p style={{ fontSize: 11.5, color: "#7a4b00", margin: "6px 0 0" }} title={e.formulaLegado ?? undefined}>
            {e.formulaMotivo} Ingrese el valor final{esJefatura ? " o defina la fórmula para esta orden" : ""}.
          </p>
        )}
        {puedeCapturar && hayCambiosEsp && (
          <div className="toolbar" style={{ marginTop: 6 }}>
            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Se guarda solo para esta orden.</span>
            <div className="spacer" />
            <button className="btn outline sm" disabled={guardando} onClick={guardarEspecificacion}>Guardar especificación de la orden</button>
          </div>
        )}
      </div>

      {/* ---------------- Captura ---------------- */}
      {puedeCapturar && (
        <div>
          <b style={{ fontSize: 12.5 }}>Resultado</b>
          {e.tipoDato === "atributo" ? (
            <div className="form-grid cols-3" style={{ marginTop: 6 }}>
              <div className="field">
                <label>Veredicto del analista <span className="req">*</span></label>
                <div style={{ display: "flex", gap: 14, paddingTop: 4 }}>
                  {(["cumple", "no_cumple"] as const).map((v) => (
                    <label key={v} style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 400, textTransform: "none", fontSize: 12.5 }}>
                      <input type="radio" style={{ width: "auto" }} checked={atributo === v} onChange={() => setAtributo(v)} name={`atr-${e.id}`} />
                      {v === "cumple" ? "Cumple" : "No cumple"}
                    </label>
                  ))}
                </div>
              </div>
              <div className="field">
                <label>Lo observado (opcional)</label>
                <input value={valor} onChange={(x) => setValor(x.target.value)} placeholder={e.requisito ? `Requisito: ${e.requisito}` : ""} />
              </div>
              <div className="field">
                <label>Observación {atributo === "no_cumple" && <span className="req">*</span>}</label>
                <input value={observacion} onChange={(x) => setObservacion(x.target.value)} />
              </div>
            </div>
          ) : nCampos > 0 && e.formulaAplicable ? (
            <div style={{ marginTop: 6 }}>
              <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "0 0 6px" }}>
                Fórmula por lectura: <code style={{ fontFamily: "'JetBrains Mono', monospace" }}>{e.formulaAplicable}</code>. El valor del ensayo es el promedio de las lecturas. Se admite coma decimal.
              </p>
              <table className="data">
                <thead>
                  <tr>
                    <th>Lectura</th>
                    {Array.from({ length: nCampos }, (_, i) => <th key={i}>C{i + 1} · {etiquetaCampo(i)}</th>)}
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {lecturas.map((l, li) => (
                    <tr key={li}>
                      <td>{li + 1}</td>
                      {l.map((c, ci) => (
                        <td key={ci}>
                          <input value={c} aria-label={`Lectura ${li + 1}, ${etiquetaCampo(ci)}`} style={{ width: "100%", fontFamily: "'JetBrains Mono', monospace" }}
                            onChange={(x) => setLecturas((ls) => ls.map((row, r) => (r === li ? row.map((v, k) => (k === ci ? x.target.value : v)) : row)))} />
                        </td>
                      ))}
                      <td>
                        {lecturas.length > 1 && (
                          <button className="btn outline sm" onClick={() => setLecturas((ls) => ls.filter((_, r) => r !== li))} title="Quitar lectura">✕</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className="btn outline sm" style={{ marginTop: 6 }} onClick={() => setLecturas((ls) => [...ls, Array.from({ length: nCampos }, () => "")])}>＋ Agregar lectura</button>
            </div>
          ) : (
            <div className="form-grid cols-2" style={{ marginTop: 6 }}>
              <div className="field">
                <label>Valor o réplicas{esp.unidad ? ` (${esp.unidad})` : ""}</label>
                <input value={valor} onChange={(x) => setValor(x.target.value)} style={{ fontFamily: "'JetBrains Mono', monospace" }}
                  placeholder="12,4   ·   o réplicas: 12,4 12,6 12,5" />
                <span style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
                  Varias réplicas: sepárelas con espacio o punto y coma; se promedian
                  {e.formulaAplicable && nCampos === 0 ? ` y se aplica la fórmula ${e.formulaAplicable}` : ""}.
                </span>
              </div>
              <div className="field">
                <label>Observación (opcional)</label>
                <input value={observacion} onChange={(x) => setObservacion(x.target.value)} />
              </div>
            </div>
          )}
          <div className="toolbar" style={{ marginTop: 8 }}>
            {hayCambiosEsp && <span style={{ fontSize: 11.5, color: "#7a4b00" }}>Guarde primero la especificación: el veredicto se calcula con la guardada.</span>}
            <div className="spacer" />
            <button className="btn primary sm" disabled={guardando || hayCambiosEsp} onClick={guardarCaptura}>{guardando ? "Guardando…" : "Guardar resultado"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
