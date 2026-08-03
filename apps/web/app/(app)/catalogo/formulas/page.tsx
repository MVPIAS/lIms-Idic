"use client";

/**
 * DEFINICIÓN DE FÓRMULAS DE ANALITO · PEGAR-Y-VALIDAR (contrato §4.3.4, RF-A06)
 * ============================================================================
 * El usuario PEGA una fórmula estilo Excel (copiar/pegar de una celda, p. ej.
 * `=(MASA_FINAL - MASA_INICIAL) / VOLUMEN * 100`), se NORMALIZA a la sintaxis del
 * motor y se VALIDA con el evaluador que YA existe en el servidor
 * (`apps/api/src/common/formula.ts`) vía `POST /api/analitos/validar-formula`.
 *
 * NO se sube ningún .xlsx: sólo se pega el TEXTO de la fórmula. NO se reimplementa
 * el motor en el navegador: el que vale es el del servidor (una sola fuente de
 * verdad, como en la pantalla de captura). Aquí sólo se hace la traducción
 * Excel→motor y se muestra el veredicto.
 *
 * La fórmula se persiste en el analito del catálogo (`cat_analito.formula`) con
 * PATCH /api/cat/analitos/:id.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Paginado } from "@/lib/api";

/* ---------------------------------------------------------------------------
 * FUNCIONES QUE SOPORTA EL MOTOR (espejo de formula.ts · FUNCIONES).
 * Se pintan como ayuda. La lista canónica la devuelve además el endpoint en
 * `funcionesDisponibles`; cuando llega, se usa esa (fuente de verdad).
 * ------------------------------------------------------------------------- */
const FUNCIONES_MOTOR = [
  "PROMEDIO", "SUMA", "MIN", "MAX", "ABS", "RAIZ", "LOG", "LN", "POTENCIA", "REDONDEAR",
] as const;

/**
 * Mapa de nombres de función de Excel (inglés / variantes) → nombre del motor.
 * El Excel en español ya usa PROMEDIO/REDONDEAR/RAIZ y coincide con el motor,
 * así que no necesita traducción; esto cubre sobre todo el Excel en inglés y los
 * alias habituales. Sólo se traduce lo que el motor soporta.
 */
const MAPA_EXCEL: Record<string, string> = {
  AVERAGE: "PROMEDIO",
  AVG: "PROMEDIO",
  MEAN: "PROMEDIO",
  SUM: "SUMA",
  ROUND: "REDONDEAR",
  SQRT: "RAIZ",
  POWER: "POTENCIA",
  LOG10: "LOG",
  // Idénticas (se dejan tal cual, listadas para documentar que se reconocen):
  MIN: "MIN", MAX: "MAX", ABS: "ABS", LN: "LN", LOG: "LOG",
  PROMEDIO: "PROMEDIO", SUMA: "SUMA", RAIZ: "RAIZ", POTENCIA: "POTENCIA", REDONDEAR: "REDONDEAR",
};

/**
 * Normaliza una fórmula pegada de Excel a la sintaxis del motor:
 *   1. Quita el `=` inicial de la celda de Excel.
 *   2. Cambia el separador de argumentos `;` (Excel-es) por `,`.
 *   3. Traduce los nombres de función de Excel a los del motor (MAPA_EXCEL),
 *      sólo cuando el identificador va seguido de `(` (es una llamada).
 * NO toca los nombres de variable ni los números (el `.` decimal se conserva).
 */
function normalizar(raw: string): string {
  let f = raw.trim();
  if (f.startsWith("=")) f = f.slice(1).trim();
  // Separador de argumentos de Excel-es. El `.` decimal se mantiene: el motor
  // usa `.` para decimales y `,` para separar argumentos.
  f = f.replace(/;/g, ",");
  // Traducción de funciones: identificador + "(".
  f = f.replace(/([A-Za-z_][A-Za-z0-9_]*)(\s*)\(/g, (m, nombre: string, sp: string) => {
    const dest = MAPA_EXCEL[nombre.toUpperCase()];
    return dest ? `${dest}${sp}(` : m;
  });
  return f;
}

/** Parte un texto libre de variables ("a, b  c;d") en tokens válidos y en mayúsculas. */
function parseVars(texto: string): string[] {
  return texto
    .split(/[\s,;]+/)
    .map((v) => v.trim())
    .filter((v) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(v));
}

type Analito = {
  id: string;
  codigo: string;
  nombre: string;
  unidad?: string | null;
  formula?: string | null;
  metodoId?: string | null;
  metodo?: { id: string; codigo?: string; nombre?: string } | null;
};

type Validacion = {
  ok: boolean;
  error?: string;
  variables?: string[];
  funciones?: string[];
  funcionesDisponibles?: string[];
};

// Variables del contexto de captura que el motor inyecta siempre (ver
// ResultadoService.contextoFormula). Se ofrecen como referencia porque una
// fórmula de analito puede usarlas (PROMEDIO, DE, CV, N, RN1..RNn, REPLICAS).
const VARS_CAPTURA = ["PROMEDIO", "DE", "CV", "N", "REPLICAS", "RN1", "RN2", "RN3"];

export default function FormulasPage() {
  const [analitos, setAnalitos] = useState<Analito[]>([]);
  const [analitoId, setAnalitoId] = useState("");
  const [hermanos, setHermanos] = useState<Analito[]>([]);
  const [formula, setFormula] = useState("");
  const [varsExtra, setVarsExtra] = useState("");
  const [comprobarVars, setComprobarVars] = useState(true);
  const [val, setVal] = useState<Validacion | null>(null);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);
  const [error, setError] = useState("");
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const analito = useMemo(() => analitos.find((a) => a.id === analitoId) ?? null, [analitos, analitoId]);

  // Carga inicial del catálogo de analitos.
  useEffect(() => {
    (async () => {
      try {
        const r = await api.list<Analito>("cat/analitos", { limit: 500 });
        setAnalitos((r as Paginado<Analito>).data ?? []);
      } catch (e: any) {
        setError(e.message ?? "No se pudieron cargar los analitos.");
      }
    })();
  }, []);

  // Al elegir analito: precarga su fórmula y trae los analitos hermanos del
  // mismo método (sirven como variables disponibles para la fórmula).
  useEffect(() => {
    setVal(null);
    setGuardado(false);
    setError("");
    if (!analito) {
      setFormula("");
      setHermanos([]);
      return;
    }
    setFormula((analito.formula ?? "").trim());
    const metodoId = analito.metodoId ?? analito.metodo?.id ?? "";
    if (!metodoId) {
      setHermanos([]);
      return;
    }
    (async () => {
      try {
        const rows = await api.getRaw<Analito[]>(`cascada/metodos/${metodoId}/analitos`);
        setHermanos((rows ?? []).filter((h) => h.id !== analito.id));
      } catch {
        setHermanos([]);
      }
    })();
  }, [analito]);

  const normalizada = useMemo(() => normalizar(formula), [formula]);

  // Variables ofrecidas para "comprobar nombres": hermanos + captura + extra.
  const variablesDisponibles = useMemo(() => {
    const set = new Set<string>();
    for (const h of hermanos) if (h.codigo) set.add(h.codigo);
    for (const v of VARS_CAPTURA) set.add(v);
    for (const v of parseVars(varsExtra)) set.add(v);
    return [...set];
  }, [hermanos, varsExtra]);

  const funcionesAyuda = val?.funcionesDisponibles ?? [...FUNCIONES_MOTOR];

  function insertar(texto: string) {
    const el = areaRef.current;
    if (!el) {
      setFormula((f) => f + texto);
      return;
    }
    const s = el.selectionStart ?? formula.length;
    const e = el.selectionEnd ?? formula.length;
    const nueva = formula.slice(0, s) + texto + formula.slice(e);
    setFormula(nueva);
    setVal(null);
    setGuardado(false);
    // Recoloca el cursor tras el texto insertado.
    requestAnimationFrame(() => {
      el.focus();
      const pos = s + texto.length;
      el.setSelectionRange(pos, pos);
    });
  }

  async function validar(): Promise<Validacion | null> {
    setError("");
    setGuardado(false);
    if (!normalizada.trim()) {
      setVal({ ok: false, error: "Escriba o pegue una fórmula antes de validar." });
      return null;
    }
    setCargando(true);
    try {
      const body: { formula: string; variables?: string[] } = { formula: normalizada };
      if (comprobarVars && variablesDisponibles.length) body.variables = variablesDisponibles;
      const r = await api.post<Validacion>("/analitos/validar-formula", body);
      setVal(r);
      return r;
    } catch (e: any) {
      const msg = Array.isArray(e.message) ? e.message.join(", ") : e.message;
      setVal({ ok: false, error: msg ?? "Error al validar la fórmula." });
      return null;
    } finally {
      setCargando(false);
    }
  }

  async function guardar() {
    if (!analito) return;
    // No se guarda sin validar OK: validamos ahora si hace falta.
    const r = val && val.ok ? val : await validar();
    if (!r || !r.ok) return;
    setGuardando(true);
    setError("");
    try {
      await api.update("cat/analitos", analito.id, { formula: normalizada });
      setGuardado(true);
      // Refleja la fórmula guardada en la copia local del catálogo.
      setAnalitos((prev) => prev.map((a) => (a.id === analito.id ? { ...a, formula: normalizada } : a)));
    } catch (e: any) {
      const msg = Array.isArray(e.message) ? e.message.join(", ") : e.message;
      setError(msg ?? "No se pudo guardar la fórmula.");
    } finally {
      setGuardando(false);
    }
  }

  const cambioNormalizacion = normalizada !== formula.trim().replace(/^=/, "").trim();

  return (
    <div>
      <h1 className="page">Fórmulas de analito</h1>
      <p className="subtitle">
        Defina la fórmula de cálculo de un analito <b>pegando</b> una fórmula estilo Excel
        (p. ej. <code style={{ fontFamily: "'JetBrains Mono', monospace" }}>=(MASA_FINAL - MASA_INICIAL) / VOLUMEN * 100</code>).
        Se traduce a la sintaxis del motor y se valida en el servidor con el mismo evaluador que aplica la captura
        (sin <code>eval</code>, en sandbox). No se sube el archivo .xlsx: sólo se pega el texto de la fórmula.
      </p>

      {error && <div className="alert warn">{error}</div>}

      <div className="card">
        <h2>1 · Analito</h2>
        <div className="field">
          <label>Analito del catálogo</label>
          <select value={analitoId} onChange={(e) => setAnalitoId(e.target.value)}>
            <option value="">— seleccionar —</option>
            {analitos.map((a) => (
              <option key={a.id} value={a.id}>
                {a.codigo} · {a.nombre} {a.unidad ? `(${a.unidad})` : ""} {a.metodo?.nombre ? `— ${a.metodo.nombre}` : ""}
              </option>
            ))}
          </select>
          {analito && (
            <span style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4, display: "block" }}>
              {analito.formula?.trim()
                ? "Este analito ya tiene una fórmula guardada (cargada abajo). Puede reemplazarla."
                : "Este analito no tiene fórmula: el valor del ensayo es el promedio de las réplicas hasta que defina una."}
            </span>
          )}
        </div>
      </div>

      {analito && (
        <>
          <div className="card">
            <h2>2 · Fórmula (pegar de Excel)</h2>
            <div className="field">
              <label>Fórmula del analito</label>
              <textarea
                ref={areaRef}
                value={formula}
                onChange={(e) => { setFormula(e.target.value); setVal(null); setGuardado(false); }}
                placeholder="=(MASA_FINAL - MASA_INICIAL) / VOLUMEN * 100"
                rows={3}
                style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, width: "100%", resize: "vertical" }}
              />
            </div>

            {cambioNormalizacion && (
              <div className="field">
                <label>Se enviará al motor (normalizada)</label>
                <div
                  style={{
                    fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5, background: "#f6f9fc",
                    border: "1px solid var(--line)", borderRadius: 7, padding: "8px 10px", wordBreak: "break-word",
                  }}
                >
                  {normalizada || "—"}
                </div>
                <span style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, display: "block" }}>
                  Se quitó el <code>=</code> inicial, se pasó <code>;</code> a <code>,</code> y se tradujeron las
                  funciones de Excel a las del motor.
                </span>
              </div>
            )}

            <div className="field">
              <label>Variables disponibles <span style={{ textTransform: "none", color: "var(--muted)", fontStyle: "italic" }}>(clic para insertar)</span></label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {hermanos.map((h) => (
                  <button key={h.id} type="button" className="tag" title={`${h.nombre}${h.unidad ? ` (${h.unidad})` : ""}`}
                    onClick={() => insertar(h.codigo)} style={{ cursor: "pointer", border: "1px solid var(--line)" }}>
                    {h.codigo}
                  </button>
                ))}
                {VARS_CAPTURA.map((v) => (
                  <button key={v} type="button" className="tag" title="Variable del contexto de captura"
                    onClick={() => insertar(v)} style={{ cursor: "pointer", border: "1px dashed var(--line)", opacity: 0.85 }}>
                    {v}
                  </button>
                ))}
                {hermanos.length === 0 && (
                  <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
                    El método no tiene otros analitos. Añada las variables del ensayo (masa, volumen…) abajo.
                  </span>
                )}
              </div>
              <span style={{ fontSize: 11, color: "var(--muted)", marginTop: 6, display: "block" }}>
                En trazo continuo, los otros analitos del método (se usan por su código). En trazo discontinuo, las
                variables que el motor inyecta en la captura (réplicas RN1..RNn, PROMEDIO, DE, CV, N, REPLICAS).
              </span>
            </div>

            <div className="field">
              <label>Otras variables del ensayo <span style={{ textTransform: "none", color: "var(--muted)", fontStyle: "italic" }}>(masa, volumen, factor… separadas por coma o espacio)</span></label>
              <input
                value={varsExtra}
                onChange={(e) => { setVarsExtra(e.target.value); setVal(null); }}
                placeholder="MASA_FINAL, MASA_INICIAL, VOLUMEN, FACTOR"
                style={{ fontFamily: "'JetBrains Mono', monospace" }}
              />
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8, textTransform: "none", fontWeight: 400 }}>
                <input type="checkbox" checked={comprobarVars} onChange={(e) => setComprobarVars(e.target.checked)} style={{ width: "auto" }} />
                Comprobar que toda variable usada exista en la lista de arriba
              </label>
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
              <button type="button" className="btn outline sm" disabled={cargando} onClick={validar}>
                {cargando ? "Validando…" : "Validar"}
              </button>
              <button type="button" className="btn primary sm" disabled={guardando || cargando} onClick={guardar}>
                {guardando ? "Guardando…" : "Guardar en el analito"}
              </button>
            </div>
          </div>

          {(val || guardado) && (
            <div className="card">
              <h2>3 · Resultado</h2>
              {guardado && <div className="alert success">Fórmula guardada en el analito {analito.codigo}.</div>}
              {val && val.ok && (
                <div className="alert success">
                  Fórmula válida.
                  {val.variables && val.variables.length > 0 && (
                    <> Variables usadas: <b>{val.variables.join(", ")}</b>.</>
                  )}
                  {val.funciones && val.funciones.length > 0 && (
                    <> Funciones: <b>{val.funciones.join(", ")}</b>.</>
                  )}
                </div>
              )}
              {val && !val.ok && <div className="alert warn">{val.error ?? "Fórmula no válida."}</div>}
            </div>
          )}
        </>
      )}

      <div className="card">
        <h2>Funciones permitidas</h2>
        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 0 }}>
          El motor sólo admite expresiones aritméticas ( <code>+ - * / ^ ( )</code> ) y estas funciones. Cualquier otra
          (o cualquier intento de código) se rechaza con «función no permitida». Los nombres son insensibles a mayúsculas.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {funcionesAyuda.map((f) => (
            <span key={f} className="tag" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{f}()</span>
          ))}
        </div>
        <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 10, marginBottom: 0 }}>
          Equivalencias de Excel reconocidas al pegar: AVERAGE/AVG→PROMEDIO, SUM→SUMA, ROUND→REDONDEAR, SQRT→RAIZ,
          POWER→POTENCIA, LOG10→LOG. El Excel en español (PROMEDIO, REDONDEAR, RAIZ…) ya coincide con el motor.
        </p>
      </div>
    </div>
  );
}
