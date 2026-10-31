"use client";

/**
 * Formulario de captura estándar de UN ensayo (todos los laboratorios).
 *
 *  1. Especificación: Mín / Nom / Máx, unidad, requisito, tipo de dato y
 *     fórmula. Lo que trae el catálogo viene precargado; lo que no, sale vacío
 *     y se completa aquí, SOLO para esta orden (queda marcado «de la orden»).
 *     Rellenar lo vacío lo hace quien captura; cambiar lo del catálogo, el
 *     tipo o la fórmula, la jefatura.
 *  2. Factor de la fórmula (multiplicar o dividir): viene del método y lo
 *     ajusta en la OT quien tiene «resultado.factor» (la jefatura por defecto),
 *     con motivo. Se aplica al valor calculado (lecturas o réplicas).
 *  3. Captura: numérico (valor, réplicas o lecturas con los campos del método
 *     si hay fórmula) o atributo (Cumple / No cumple con observación). En un
 *     método con lecturas (p. ej. LQA, ALI-D4) el analista puede igual
 *     ingresar solo el valor final. Las lecturas se precargan con su valor por
 *     defecto (factor de proteína 6,25) y, si el método pide duplicado, salen
 *     dos filas X y X′. Las reglas de aceptación del método (diferencia entre
 *     duplicados, peso constante) avisan antes de guardar: el servidor responde
 *     409 con los avisos y el analista confirma (o, con el parámetro
 *     captura_reglas.modo = impedir, no se guarda).
 *     Corregir un valor ya capturado exige motivo (queda en el historial).
 *  4. Equipo usado y condiciones del ensayo (contrato §4.4.2): equipo del
 *     laboratorio con su estado de calibración —uno vencido no se puede
 *     elegir—, fecha y hora del ensayo, T, HR e incertidumbre. Obligatorio en
 *     los métodos que lo exigen (Catálogo › Métodos) o según el parámetro
 *     captura_equipo.obligatorio.
 *
 * El cálculo y el veredicto los hace el servidor
 * (apps/api/src/laboratorio/captura-estandar.ts).
 */
import { useMemo, useState } from "react";
import { aInputHoraChile, deInputHoraChile, fechaHora } from "@/lib/format";
import { confirmar, toast } from "@/components/ui/feedback";
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
  campos: CampoLectura[];
  /** Reglas de aceptación del método (cat_metodo.reglas_captura; ALI-D4). */
  reglasAceptacion?: ReglaAceptacionVista[];
  /** Nota de la captura del método (fórmula y lo que está por confirmar). */
  notaCaptura?: string | null;
  /** Avisos de reglas no cumplidas que el analista confirmó al guardar. */
  avisosAceptacion?: { texto: string }[] | null;
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
  factorValor: number | string | null;
  factorOperacion: "multiplicar" | "dividir" | null;
  factorDescripcion: string | null;
  factorOrigen: string | null;
  factorEditadoAt: string | null;
  factorMotivo: string | null;
  valorSinFactor: number | string | null;
  /** Equipo usado y condiciones del ensayo (laboratorio/equipo-captura.ts). */
  equipoId?: string | null;
  equipo?: { codigo: string; nombre: string } | null;
  equipoRequerido?: boolean;
  fechaEnsayo?: string | null;
  temperatura?: number | string | null;
  humedad?: number | string | null;
  incertidumbre?: string | null;
  /** Requisito de la E.T. del cliente (especificacion-tecnica): «E.T. … v… · punto …». */
  especFuente?: string | null;
  /** Segunda condición de la fila («X kgf con Y mm») y su valor capturado. */
  condicion2?: { etiqueta: string; inf?: number | null; sup?: number | null; unidad?: string | null } | null;
  valorCondicion2?: number | string | null;
  /** Plan de 2/3 clases (n, c, m, M): cada réplica es una unidad. */
  planClases?: { n: number; c: number; m: number; M?: number | null } | null;
  /** Réplicas capturadas (en un plan de clases, el valor de cada unidad). */
  replicas?: (number | string)[] | null;
  /** Clase de la no conformidad (crítico, mayor, menor) para el veredicto del lote. */
  claseDefecto?: string | null;
}

/** Lectura (campo C1..Cn) del método: paso_metodo. */
export interface CampoLectura {
  nombre: string;
  unidad: string | null;
  valorDefecto?: number | null;
  simbolo?: string | null;
  porConfirmar?: boolean;
  instruccion?: string | null;
}

export interface ReglaAceptacionVista {
  tipo: "duplicados" | "diferencia_campos";
  texto: string;
  max: number;
  modo?: "absoluto" | "relativo";
  fuente?: string | null;
  porConfirmar?: boolean;
}

/** Equipo que se puede elegir en la captura (GET /flujo/ot/:id/equipos). */
export interface EquipoCaptura {
  id: string;
  codigo: string;
  nombre: string;
  /** Laboratorio del equipo; null = equipo común del instituto. */
  unidadId?: string | null;
  unidadCodigo: string | null;
  estado: string;
  proximaCalibracion: string | null;
  apto: boolean;
  motivo: string | null;
}

/** Fecha ISO → valor de <input type="datetime-local"> en hora de Chile. */
/** La fecha y hora del ensayo se escriben y se leen en hora de Chile, no en la del equipo. */
const aLocal = (iso?: string | null) => aInputHoraChile(iso);
const numTexto = (v: number | string | null | undefined) => (v === null || v === undefined || v === "" ? "" : String(Number(v)).replace(".", ","));
const leerNum = (s: string) => (s.trim() === "" ? null : Number(s.trim().replace(",", ".")));

/** Texto del factor: «× 10», «÷ 2,5». */
export const textoFactor = (op: string | null, v: number | string | null) =>
  v == null || v === "" || !op ? "" : `${op === "dividir" ? "÷" : "×"} ${String(Number(v)).replace(".", ",")}`;

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
  puedeFactor = false,
  equipos = [],
  onGuardado,
}: {
  e: EnsayoEditable;
  /** Equipos del laboratorio para la captura (con su aptitud). */
  equipos?: EquipoCaptura[];
  puedeCapturar: boolean;
  /** resultado.aprobar: puede cambiar lo que vino del catálogo y la fórmula */
  esJefatura: boolean;
  /** resultado.factor: puede ajustar el factor de la fórmula en esta OT */
  puedeFactor?: boolean;
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
  const pideDuplicado = (e.reglasAceptacion ?? []).some((r) => r.tipo === "duplicados");
  // Fila nueva de lecturas, con el valor por defecto de cada campo (p. ej. factor 6,25).
  const filaNueva = () =>
    Array.from({ length: nCampos }, (_, i) => {
      const d = e.campos[i]?.valorDefecto;
      return d != null && Number.isFinite(Number(d)) ? String(Number(d)).replace(".", ",") : "";
    });
  const [lecturas, setLecturas] = useState<string[][]>(() =>
    e.lecturas?.length
      ? e.lecturas.map((l) => Array.from({ length: nCampos }, (_, i) => String(l[`C${i + 1}`] ?? "").replace(".", ",")))
      : pideDuplicado ? [filaNueva(), filaNueva()] : [filaNueva()],
  );
  const conLecturas = nCampos > 0 && !!e.formulaAplicable;
  // Con lecturas, el analista puede igual ingresar solo el valor final (lo que ya capturaba).
  const [modoCaptura, setModoCaptura] = useState<"lecturas" | "valor">(() =>
    conLecturas && !e.lecturas?.length && e.valorNumerico != null && e.valorNumerico !== "" ? "valor" : "lecturas",
  );
  const usaLecturas = conLecturas && modoCaptura === "lecturas";
  const [valor, setValor] = useState(() =>
    // En un plan de clases se corrigen las unidades, no su promedio.
    e.planClases && e.replicas?.length
      ? e.replicas.map((x) => String(x).replace(".", ",")).join(" ")
      : e.valorNumerico != null && e.valorNumerico !== "" ? String(e.valorNumerico).replace(".", ",") : e.valorTexto ?? "",
  );
  const [atributo, setAtributo] = useState<"" | "cumple" | "no_cumple">(
    e.tipoDato === "atributo" && (e.veredicto === "cumple" || e.veredicto === "no_cumple") ? e.veredicto : "",
  );
  const [observacion, setObservacion] = useState(e.observacion ?? "");
  const [valorCond2, setValorCond2] = useState(e.valorCondicion2 != null && e.valorCondicion2 !== "" ? String(Number(e.valorCondicion2)).replace(".", ",") : "");
  const [clase, setClase] = useState(e.claseDefecto ?? "");
  const [motivoClase, setMotivoClase] = useState("");
  const [motivoCaptura, setMotivoCaptura] = useState("");
  const [motivoEsp, setMotivoEsp] = useState("");
  // Factor
  const [factorOp, setFactorOp] = useState<"" | "multiplicar" | "dividir">(e.factorOperacion ?? "");
  const [factorValor, setFactorValor] = useState(e.factorValor != null && e.factorValor !== "" ? String(Number(e.factorValor)).replace(".", ",") : "");
  const [factorDesc, setFactorDesc] = useState(e.factorDescripcion ?? "");
  const [factorMotivo, setFactorMotivo] = useState("");
  const [factorTodos, setFactorTodos] = useState(false);
  // Equipo y condiciones del ensayo
  const [equipoId, setEquipoId] = useState(e.equipoId ?? "");
  const [fechaEnsayo, setFechaEnsayo] = useState(aLocal(e.fechaEnsayo));
  const [temperatura, setTemperatura] = useState(numTexto(e.temperatura));
  const [humedad, setHumedad] = useState(numTexto(e.humedad));
  const [incertidumbre, setIncertidumbre] = useState(e.incertidumbre ?? "");
  const equipoSel = equipos.find((x) => x.id === equipoId);
  // Corregir un valor ya capturado (aún sin revisar) exige motivo.
  const tieneValor = (e.valorNumerico != null && e.valorNumerico !== "") || !!e.valorTexto;
  const esCorreccion = e.estado === "capturado" && tieneValor;

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
  // Cambiar lo que trajo el catálogo, el tipo (con especificación) o la fórmula lo hace la jefatura con motivo.
  const catalogoTraeEspec = ["limiteInf", "nominal", "limiteSup", "requisito"].some((k) => !vacio(cat[k]));
  const espRequiereMotivo = Object.keys(cambiosEsp).some((k) =>
    k === "formula" ? true : k === "tipoDato" ? catalogoTraeEspec : !vacio(cat[k]),
  );

  async function guardarEspecificacion() {
    setGuardando(true);
    try {
      if (espRequiereMotivo && motivoEsp.trim().length < 5) {
        toast.error("Indique el motivo del cambio (mínimo 5 caracteres): queda en el historial del ensayo.");
        return;
      }
      const r = await llamar("PATCH", `/flujo/resultado/${e.id}/especificacion`, { ...cambiosEsp, ...(espRequiereMotivo ? { motivo: motivoEsp.trim() } : {}) });
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
    } else if (usaLecturas) {
      const filas = lecturas.filter((l) => l.some((c, i) => c.trim() !== "" && c.trim() !== filaNueva()[i]));
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
    if (e.condicion2 && e.tipoDato !== "atributo") {
      if (!valorCond2.trim()) { toast.error(`Indique ${e.condicion2.etiqueta}: el requisito tiene dos condiciones.`); return; }
      cuerpo.valorCondicion2 = valorCond2.trim();
    }
    if (esCorreccion) {
      if (motivoCaptura.trim().length < 5) { toast.error("Este ensayo ya tiene un valor: indique el motivo de la corrección (mínimo 5 caracteres)."); return; }
      cuerpo.motivo = motivoCaptura.trim();
    }
    // Equipo usado y condiciones del ensayo (el servidor bloquea un equipo no apto).
    if (e.equipoRequerido && !equipoId) { toast.error("Indique el equipo con que se ejecutó el ensayo: este método lo exige."); return; }
    if (equipoSel && !equipoSel.apto) { toast.error(`El equipo ${equipoSel.codigo} no se puede usar: ${equipoSel.motivo ?? "no está apto"}.`); return; }
    const t = leerNum(temperatura);
    const h = leerNum(humedad);
    if ((t !== null && !Number.isFinite(t)) || (h !== null && !Number.isFinite(h))) { toast.error("La temperatura y la humedad deben ser números (coma decimal)."); return; }
    if (equipoId !== (e.equipoId ?? "")) cuerpo.equipoId = equipoId || null;
    if (fechaEnsayo) cuerpo.fechaEnsayo = deInputHoraChile(fechaEnsayo);
    if (t !== null) cuerpo.temperatura = t;
    if (h !== null) cuerpo.humedad = h;
    if (incertidumbre.trim()) cuerpo.incertidumbre = incertidumbre.trim();
    setGuardando(true);
    try {
      let r: any;
      try {
        r = await llamar("POST", `/flujo/resultado/${e.id}/valor`, cuerpo);
      } catch (err: any) {
        // Reglas de aceptación del método no cumplidas: se avisa ANTES de guardar.
        if (err?.status !== 409 || err?.datos?.codigo !== "AVISOS_ACEPTACION") throw err;
        const avisos: { texto: string }[] = err.datos.avisos ?? [];
        const seguir = await confirmar({
          titulo: "No se cumplen las reglas de aceptación del método",
          mensaje: `${avisos.map((a) => `• ${a.texto}`).join("\n")}\n\n¿Guardar de todos modos? Los avisos quedan registrados en el resultado.`,
          confirmarTexto: "Guardar con avisos",
          peligro: true,
        });
        if (!seguir) return;
        r = await llamar("POST", `/flujo/resultado/${e.id}/valor`, { ...cuerpo, confirmarAvisos: true });
      }
      toast.ok(r?.avisosAceptacion?.length ? "Resultado guardado con avisos de aceptación." : "Resultado guardado.");
      onGuardado(r);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setGuardando(false);
    }
  }

  async function guardarFactor() {
    const quitar = !factorValor.trim();
    const valorNum = quitar ? null : Number(factorValor.trim().replace(",", "."));
    if (!quitar && (!Number.isFinite(valorNum) || (valorNum as number) <= 0)) { toast.error("El factor debe ser un número mayor que 0 (coma decimal)."); return; }
    if (!quitar && !factorOp) { toast.error("Indique si el factor multiplica o divide el resultado."); return; }
    if (factorMotivo.trim().length < 5) { toast.error("Indique el motivo del ajuste del factor (mínimo 5 caracteres)."); return; }
    setGuardando(true);
    try {
      const r: any = await llamar("PATCH", `/flujo/resultado/${e.id}/factor`, {
        valor: valorNum,
        operacion: quitar ? null : factorOp,
        descripcion: factorDesc.trim() || null,
        motivo: factorMotivo.trim(),
        todoElMetodo: factorTodos,
      });
      toast.ok(`Factor guardado${r.actualizados > 1 ? ` en ${r.actualizados} ensayos` : ""}${r.omitidos?.length ? ` (${r.omitidos.length} ya revisado(s) o aprobado(s) no se cambiaron)` : ""}.`);
      onGuardado(r);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setGuardando(false);
    }
  }

  const factorActual = textoFactor(e.factorOperacion, e.factorValor);
  const factorCambiado =
    (factorOp || null) !== (e.factorOperacion ?? null) ||
    (factorValor.trim() ? Number(factorValor.trim().replace(",", ".")) : null) !== (e.factorValor != null && e.factorValor !== "" ? Number(e.factorValor) : null) ||
    factorDesc.trim() !== (e.factorDescripcion ?? "");

  const etiquetaCampo = (i: number) => {
    const c = e.campos[i];
    return c ? `${c.simbolo ? `${c.simbolo} · ` : ""}${c.nombre}${c.unidad ? ` (${c.unidad})` : ""}` : `Campo ${i + 1}`;
  };
  const etiquetaLectura = (i: number) => (pideDuplicado && lecturas.length <= 2 ? (i === 0 ? "X" : "X′") : String(i + 1));

  return (
    <div style={{ display: "grid", gap: 12, padding: "6px 2px" }}>
      {/* ---------------- Especificación ---------------- */}
      <div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
          <b style={{ fontSize: 12.5 }}>Especificación</b>
          {e.especOrigen === "et" ? (
            <span className="pill teal" title={`Requisito de la especificación técnica del cliente${e.especEditadaAt ? ` · aplicado el ${fechaHora(e.especEditadaAt)}` : ""}`}>
              {e.especFuente ?? "E.T. del cliente"}
            </span>
          ) : e.especOrigen === "orden" ? (
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
            <label htmlFor={`td-${e.id}`}>Tipo de dato</label>
            <select id={`td-${e.id}`} value={esp.tipoDato} disabled={!editable("tipoDato")} onChange={(x) => setEsp({ ...esp, tipoDato: x.target.value as any })}>
              <option value="numerico">Numérico (veredicto por Mín / Máx)</option>
              <option value="atributo">Atributo (Cumple / No cumple)</option>
            </select>
          </div>
          {CAMPOS.map((c) => (
            <div key={c.k} className={`field${editable(c.k) ? "" : " readonly"}`}>
              <label htmlFor={`es-${c.k}-${e.id}`}>{c.l}{!vacio(cat[c.k]) && String(cat[c.k]) !== String((esp as any)[c.k]) ? ` · catálogo: ${cat[c.k]}` : ""}</label>
              <input id={`es-${c.k}-${e.id}`} value={(esp as any)[c.k]} readOnly={!editable(c.k)} onChange={(x) => setEsp({ ...esp, [c.k]: x.target.value })}
                placeholder={editable(c.k) ? "vacío" : ""} />
            </div>
          ))}
          <div className={`field span-3${editable("requisito") ? "" : " readonly"}`}>
            <label htmlFor={`rq-${e.id}`}>Requisito (texto){!vacio(cat.requisito) && cat.requisito !== esp.requisito ? ` · catálogo: ${cat.requisito}` : ""}</label>
            <input id={`rq-${e.id}`} value={esp.requisito} readOnly={!editable("requisito")} onChange={(x) => setEsp({ ...esp, requisito: x.target.value })} />
          </div>
          <div className={`field span-2${esJefatura && puedeCapturar ? "" : " readonly"}`}>
            <label htmlFor={`fx-${e.id}`}>Fórmula {nCampos > 0 ? `(campos C1..C${nCampos})` : ""}</label>
            <input id={`fx-${e.id}`} value={esp.formula} readOnly={!(esJefatura && puedeCapturar)} style={{ fontFamily: "'JetBrains Mono', monospace" }}
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
          <div className="toolbar" style={{ marginTop: 6, alignItems: "flex-end" }}>
            {espRequiereMotivo && (
              <div className="field" style={{ flex: 1, minWidth: 240, margin: 0 }}>
                <label htmlFor={`me-${e.id}`}>Motivo del cambio <span className="req">*</span></label>
                <input id={`me-${e.id}`} value={motivoEsp} maxLength={1000} onChange={(x) => setMotivoEsp(x.target.value)} placeholder="Por qué se cambia lo que vino del catálogo" />
              </div>
            )}
            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Se guarda solo para esta orden.</span>
            <div className="spacer" />
            <button className="btn outline sm" disabled={guardando} onClick={guardarEspecificacion}>Guardar especificación de la orden</button>
          </div>
        )}
      </div>

      {/* ---------------- Clase de la no conformidad (EP-05 5.2) ---------------- */}
      {(e.claseDefecto || e.veredicto === "no_cumple") && (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor={`cl-${e.id}`}>Clase de la no conformidad</label>
            <select id={`cl-${e.id}`} value={clase} disabled={!esJefatura} onChange={(x) => setClase(x.target.value)}>
              <option value="">Sin clase (cuenta como mayor)</option>
              <option value="critico">Crítico</option>
              <option value="mayor">Mayor</option>
              <option value="menor">Menor</option>
            </select>
          </div>
          {esJefatura && clase !== (e.claseDefecto ?? "") && (
            <>
              <div className="field" style={{ margin: 0, flex: 1, minWidth: 180 }}>
                <label htmlFor={`clm-${e.id}`}>Motivo <span className="req">*</span></label>
                <input id={`clm-${e.id}`} value={motivoClase} maxLength={1000} onChange={(x) => setMotivoClase(x.target.value)} />
              </div>
              <button type="button" className="btn outline sm" disabled={guardando || motivoClase.trim().length < 5}
                onClick={async () => {
                  setGuardando(true);
                  try {
                    await llamar("PUT", `/especificaciones-tecnicas/resultado/${e.id}/clase`, { clase: clase || null, motivo: motivoClase.trim() });
                    toast.ok("Clase de la no conformidad guardada.");
                    onGuardado({ ...e, claseDefecto: clase || null });
                  } catch (err: any) { toast.error(err.message); }
                  finally { setGuardando(false); }
                }}>Clasificar → veredicto de lote</button>
            </>
          )}
          {!esJefatura && <span style={{ fontSize: 11.5, color: "var(--muted)" }}>La clasifica la jefatura del laboratorio.</span>}
        </div>
      )}

      {/* ---------------- Factor de la fórmula ---------------- */}
      {e.tipoDato === "numerico" && (factorActual || (puedeFactor && puedeCapturar)) && (
        <div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
            <b style={{ fontSize: 12.5 }}>Factor de la fórmula</b>
            {factorActual ? (
              <span className={`pill ${e.factorOrigen === "orden" ? "amber" : "gray"}`}
                title={e.factorOrigen === "orden" ? `Ajustado en esta OT${e.factorEditadoAt ? ` · ${fechaHora(e.factorEditadoAt)}` : ""}${e.factorMotivo ? ` · ${e.factorMotivo}` : ""}` : "Del método"}>
                {factorActual}{e.factorDescripcion ? ` · ${e.factorDescripcion}` : ""} · {e.factorOrigen === "orden" ? "de la orden" : "del método"}
              </span>
            ) : <span className="pill gray">sin factor</span>}
            {e.valorSinFactor != null && e.valorSinFactor !== "" && factorActual && (
              <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Valor sin factor: {String(Number(e.valorSinFactor)).replace(".", ",")}</span>
            )}
          </div>
          <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "0 0 6px" }}>
            Se aplica al valor calculado (lecturas o réplicas). Un valor final ingresado directamente no se modifica.
          </p>
          {puedeFactor && puedeCapturar && (
            <>
              <div className="form-grid cols-4">
                <div className="field">
                  <label htmlFor={`fo-${e.id}`}>Operación</label>
                  <select id={`fo-${e.id}`} value={factorOp} onChange={(x) => setFactorOp(x.target.value as any)}>
                    <option value="">Sin factor</option>
                    <option value="multiplicar">Multiplicar (×)</option>
                    <option value="dividir">Dividir (÷)</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={`fv-${e.id}`}>Factor</label>
                  <input id={`fv-${e.id}`} inputMode="decimal" value={factorValor} onChange={(x) => setFactorValor(x.target.value)} placeholder="p. ej. 10" style={{ fontFamily: "'JetBrains Mono', monospace" }} />
                </div>
                <div className="field span-2">
                  <label htmlFor={`fd-${e.id}`}>Qué representa (opcional)</label>
                  <input id={`fd-${e.id}`} value={factorDesc} maxLength={120} onChange={(x) => setFactorDesc(x.target.value)} placeholder="p. ej. dilución 1:10" />
                </div>
              </div>
              {factorCambiado && (
                <div className="toolbar" style={{ marginTop: 6, alignItems: "flex-end" }}>
                  <div className="field" style={{ flex: 1, minWidth: 240, margin: 0 }}>
                    <label htmlFor={`fm-${e.id}`}>Motivo del ajuste <span className="req">*</span></label>
                    <input id={`fm-${e.id}`} value={factorMotivo} maxLength={1000} onChange={(x) => setFactorMotivo(x.target.value)} />
                  </div>
                  <label style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 400, textTransform: "none", fontSize: 12 }}>
                    <input type="checkbox" style={{ width: "auto" }} checked={factorTodos} onChange={(x) => setFactorTodos(x.target.checked)} />
                    Aplicar a todos los ensayos de este método en la OT
                  </label>
                  <button className="btn outline sm" disabled={guardando} onClick={guardarFactor}>Guardar factor</button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ---------------- Captura ---------------- */}
      {puedeCapturar && (
        <div>
          <b style={{ fontSize: 12.5 }}>Resultado</b>
          {conLecturas && e.tipoDato !== "atributo" && (
            <div role="radiogroup" aria-label="Forma de captura" style={{ display: "inline-flex", gap: 14, marginLeft: 12 }}>
              {([["lecturas", "Con lecturas y fórmula"], ["valor", "Solo el valor final"]] as const).map(([v, t]) => (
                <label key={v} style={{ display: "inline-flex", gap: 6, alignItems: "center", fontWeight: 400, textTransform: "none", fontSize: 12 }}>
                  <input type="radio" style={{ width: "auto" }} name={`modo-${e.id}`} checked={modoCaptura === v} onChange={() => setModoCaptura(v)} />
                  {t}
                </label>
              ))}
            </div>
          )}
          {e.tipoDato !== "atributo" && e.notaCaptura && (
            <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "6px 0 0" }}>{e.notaCaptura}</p>
          )}
          {e.tipoDato !== "atributo" && !!e.reglasAceptacion?.length && (
            <ul style={{ fontSize: 11.5, margin: "6px 0 0", paddingLeft: 18 }} aria-label="Reglas de aceptación del método">
              {e.reglasAceptacion.map((r, i) => (
                <li key={i}>
                  Regla de aceptación: {r.texto}
                  {r.tipo === "duplicados" && r.modo ? ` (${r.modo === "relativo" ? "relativa" : "absoluta"})` : ""}
                  {r.fuente ? ` · ${r.fuente}` : ""}
                  {r.porConfirmar && <span className="pill amber" style={{ marginLeft: 6 }}>por confirmar</span>}
                </li>
              ))}
            </ul>
          )}
          {!!e.avisosAceptacion?.length && (
            <p role="status" style={{ fontSize: 11.5, color: "#7a4b00", margin: "6px 0 0" }}>
              Guardado con avisos de aceptación: {e.avisosAceptacion.map((a) => a.texto).join(" ")}
            </p>
          )}
          {e.tipoDato === "atributo" ? (
            <div className="form-grid cols-3" style={{ marginTop: 6 }}>
              <div className="field">
                <label id={`va-${e.id}`}>Veredicto del analista <span className="req">*</span></label>
                <div role="radiogroup" aria-labelledby={`va-${e.id}`} style={{ display: "flex", gap: 14, paddingTop: 4 }}>
                  {(["cumple", "no_cumple"] as const).map((v) => (
                    <label key={v} style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 400, textTransform: "none", fontSize: 12.5 }}>
                      <input type="radio" style={{ width: "auto" }} checked={atributo === v} onChange={() => setAtributo(v)} name={`atr-${e.id}`} />
                      {v === "cumple" ? "Cumple" : "No cumple"}
                    </label>
                  ))}
                </div>
              </div>
              <div className="field">
                <label htmlFor={`ob-${e.id}`}>Lo observado (opcional)</label>
                <input id={`ob-${e.id}`} value={valor} onChange={(x) => setValor(x.target.value)} placeholder={e.requisito ? `Requisito: ${e.requisito}` : ""} />
              </div>
              <div className="field">
                <label htmlFor={`oa-${e.id}`}>Observación {atributo === "no_cumple" && <span className="req">*</span>}</label>
                <input id={`oa-${e.id}`} value={observacion} onChange={(x) => setObservacion(x.target.value)} />
              </div>
            </div>
          ) : usaLecturas ? (
            <div style={{ marginTop: 6 }}>
              <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "0 0 6px" }}>
                Fórmula por lectura: <code style={{ fontFamily: "'JetBrains Mono', monospace" }}>{e.formulaAplicable}</code>. El valor del ensayo es el promedio de las lecturas{pideDuplicado ? " (duplicado X y X′)" : ""}. Se admite coma decimal.
              </p>
              <table className="data">
                <thead>
                  <tr>
                    <th>Lectura</th>
                    {Array.from({ length: nCampos }, (_, i) => (
                      <th key={i} title={e.campos[i]?.instruccion ?? undefined}>
                        C{i + 1} · {etiquetaCampo(i)}
                        {e.campos[i]?.porConfirmar && <span className="pill amber" style={{ marginLeft: 4 }}>por confirmar</span>}
                      </th>
                    ))}
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {lecturas.map((l, li) => (
                    <tr key={li}>
                      <td>{etiquetaLectura(li)}</td>
                      {l.map((c, ci) => (
                        <td key={ci}>
                          <input value={c} aria-label={`Lectura ${etiquetaLectura(li)}, ${etiquetaCampo(ci)}`} style={{ width: "100%", fontFamily: "'JetBrains Mono', monospace" }}
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
              <button className="btn outline sm" style={{ marginTop: 6 }} onClick={() => setLecturas((ls) => [...ls, filaNueva()])}>＋ Agregar lectura</button>
            </div>
          ) : (
            <div className="form-grid cols-2" style={{ marginTop: 6 }}>
              {e.planClases && (
                <p style={{ gridColumn: "1 / -1", fontSize: 11.5, color: "var(--muted)", margin: 0 }}>
                  Plan de {e.planClases.M != null ? "3" : "2"} clases: ingrese el valor de cada una de las {e.planClases.n} unidades como réplicas.
                  No cumple si {e.planClases.M != null ? `alguna supera M = ${String(e.planClases.M).replace(".", ",")} o ` : ""}más de {e.planClases.c} superan m = {String(e.planClases.m).replace(".", ",")}.
                </p>
              )}
              <div className="field">
                <label htmlFor={`vr-${e.id}`}>{e.planClases ? `Valores de las ${e.planClases.n} unidades` : "Valor o réplicas"}{esp.unidad ? ` (${esp.unidad})` : ""}</label>
                <input id={`vr-${e.id}`} value={valor} onChange={(x) => setValor(x.target.value)} style={{ fontFamily: "'JetBrains Mono', monospace" }}
                  placeholder="12,4   ·   o réplicas: 12,4 12,6 12,5" />
                <span style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
                  {e.planClases ? "Sepárelas con espacio o punto y coma; cada valor es una unidad" : "Varias réplicas: sepárelas con espacio o punto y coma; se promedian"}
                  {e.formulaAplicable && nCampos === 0 ? ` y se aplica la fórmula ${e.formulaAplicable}` : ""}
                  {conLecturas ? ". Valor final ya calculado: no se aplica la fórmula ni se evalúan las reglas de aceptación" : ""}.
                </span>
              </div>
              <div className="field">
                <label htmlFor={`on-${e.id}`}>Observación (opcional)</label>
                <input id={`on-${e.id}`} value={observacion} onChange={(x) => setObservacion(x.target.value)} />
              </div>
            </div>
          )}
          {e.condicion2 && e.tipoDato !== "atributo" && (
            <div className="form-grid cols-2" style={{ marginTop: 6 }}>
                <div className="field">
                  <label htmlFor={`c2-${e.id}`}>
                    {e.condicion2.etiqueta}{e.condicion2.unidad ? ` (${e.condicion2.unidad})` : ""} <span className="req">*</span>
                  </label>
                  <input id={`c2-${e.id}`} value={valorCond2} inputMode="decimal" onChange={(x) => setValorCond2(x.target.value)} style={{ fontFamily: "'JetBrains Mono', monospace" }} />
                  <span style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
                    Segunda condición del requisito: {e.condicion2.inf != null ? `≥ ${String(e.condicion2.inf).replace(".", ",")}` : ""}{e.condicion2.inf != null && e.condicion2.sup != null ? " y " : ""}{e.condicion2.sup != null ? `≤ ${String(e.condicion2.sup).replace(".", ",")}` : ""}. Cumple solo si cumplen las dos.
                  </span>
                </div>
            </div>
          )}
          <fieldset style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "6px 10px 8px", margin: "10px 0 0" }}>
            <legend style={{ fontSize: 12, fontWeight: 600, padding: "0 4px" }}>
              Equipo y condiciones del ensayo{e.equipoRequerido ? " · el método exige informar el equipo" : ""}
            </legend>
            <div className="form-grid cols-4">
              <div className="field span-2">
                <label htmlFor={`eq-${e.id}`}>Equipo usado {e.equipoRequerido && <span className="req">*</span>}</label>
                <select id={`eq-${e.id}`} value={equipoId} onChange={(x) => setEquipoId(x.target.value)}>
                  <option value="">{e.equipoRequerido ? "Elija el equipo…" : "Sin equipo"}</option>
                  {e.equipoId && !equipos.some((x) => x.id === e.equipoId) && (
                    <option value={e.equipoId}>{e.equipo ? `${e.equipo.codigo} · ${e.equipo.nombre}` : "Equipo registrado"}</option>
                  )}
                  {equipos.map((x) => (
                    <option key={x.id} value={x.id} disabled={!x.apto && x.id !== e.equipoId}>
                      {x.codigo} · {x.nombre}{x.unidadCodigo ? ` (${x.unidadCodigo})` : " (común)"}{x.apto ? "" : ` — ${x.motivo}`}
                    </option>
                  ))}
                </select>
                {equipoSel ? (
                  equipoSel.apto ? (
                    <span style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>Calibración vigente hasta {String(equipoSel.proximaCalibracion ?? "").split("-").reverse().join("-")}.</span>
                  ) : (
                    <span role="alert" style={{ fontSize: 11.5, color: "var(--red)", marginTop: 3 }}>Bloqueado: {equipoSel.motivo}. Recalíbrelo o elija otro equipo.</span>
                  )
                ) : (
                  <span style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
                    {equipos.length ? "Los equipos con la calibración vencida o fuera de servicio no se pueden elegir." : "El laboratorio no tiene equipos registrados en «Equipos y calibración»."}
                  </span>
                )}
              </div>
              <div className="field span-2">
                <label htmlFor={`fe-${e.id}`}>Fecha y hora del ensayo</label>
                <input id={`fe-${e.id}`} type="datetime-local" value={fechaEnsayo} onChange={(x) => setFechaEnsayo(x.target.value)} />
                <span style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>Hora de Chile. Vacía = ahora.</span>
              </div>
              <div className="field">
                <label htmlFor={`te-${e.id}`}>T (°C)</label>
                <input id={`te-${e.id}`} inputMode="decimal" value={temperatura} onChange={(x) => setTemperatura(x.target.value)} />
              </div>
              <div className="field">
                <label htmlFor={`hr-${e.id}`}>HR (%)</label>
                <input id={`hr-${e.id}`} inputMode="decimal" value={humedad} onChange={(x) => setHumedad(x.target.value)} />
              </div>
              <div className="field span-2">
                <label htmlFor={`in-${e.id}`}>Incertidumbre</label>
                <input id={`in-${e.id}`} value={incertidumbre} maxLength={60} onChange={(x) => setIncertidumbre(x.target.value)} placeholder="p. ej. ± 0,02 %" />
              </div>
            </div>
          </fieldset>
          {esCorreccion && (
            <div className="field" style={{ marginTop: 8, maxWidth: 520 }}>
              <label htmlFor={`mc-${e.id}`}>Motivo de la corrección <span className="req">*</span></label>
              <input id={`mc-${e.id}`} value={motivoCaptura} maxLength={1000} onChange={(x) => setMotivoCaptura(x.target.value)} placeholder="Este ensayo ya tiene un valor: indique por qué lo cambia" />
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

/**
 * Equipos que se ofrecen en un ensayo: los de su laboratorio dueño (el destino,
 * si se derivó por orden interna) y los comunes sin unidad (D02-28). Misma
 * regla que valida la API al capturar.
 */
export function equiposDelEnsayo(equipos: EquipoCaptura[], laboratorioId: string | null | undefined): EquipoCaptura[] {
  if (!laboratorioId) return equipos;
  return equipos.filter((x) => !x.unidadId || x.unidadId === laboratorioId);
}
