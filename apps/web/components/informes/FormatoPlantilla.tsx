"use client";

/**
 * Formato del informe de una plantilla (plantilla_informe.config_informe):
 * agrupación, numeración, columnas y títulos, referencias, anexo fotográfico,
 * conclusión fija y portada. Lo cambia quien tiene `plantilla.gestionar`; vale
 * para todos los documentos que se emitan después con esa plantilla.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/feedback";
import { enviarInforme, type FormatoInforme } from "@/lib/informes";

type Respuesta = {
  guardado: Partial<FormatoInforme> | null;
  efectivo: FormatoInforme;
  porTipo: FormatoInforme;
  /** Versión vigente y borrador pendiente de aprobación (repositorio de plantillas con versiones). */
  version?: { id: string; numero: number } | null;
  borrador?: { id: string; numero: number; guardado: Partial<FormatoInforme> | null; efectivo: FormatoInforme } | null;
};

const ETIQUETAS: { clave: keyof FormatoInforme["etiquetas"]; texto: string }[] = [
  { clave: "ensayo", texto: "Columna del ensayo" },
  { clave: "metodo", texto: "Columna del método" },
  { clave: "unidad", texto: "Columna de la unidad" },
  { clave: "requisito", texto: "Columna del requisito" },
  { clave: "resultado", texto: "Columna del resultado" },
  { clave: "veredicto", texto: "Columna del veredicto" },
  { clave: "minimo", texto: "Columna del mínimo" },
  { clave: "maximo", texto: "Columna del máximo" },
  { clave: "muestra", texto: "Columna de la muestra" },
  { clave: "otros", texto: "Columna «Otros» del requisito" },
];

export default function FormatoPlantilla({ plantillaId, onGuardado }: { plantillaId: string; onGuardado?: () => void }) {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [f, setF] = useState<FormatoInforme | null>(null);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    setDatos(null);
    setError("");
    api
      .getRaw<Respuesta>(`informes/plantillas/${plantillaId}/formato`)
      .then((r) => {
        setDatos(r);
        // Si hay un borrador, se sigue editando sobre él (la vigente no se toca).
        setF(r.borrador?.efectivo ?? r.efectivo);
      })
      .catch((e) => setError(e.message));
  }, [plantillaId]);

  if (error) return <div className="alert warn">{error}</div>;
  if (!datos || !f) return <p className="subtitle">Cargando formato…</p>;

  const poner = <K extends keyof FormatoInforme>(k: K, v: FormatoInforme[K]) => setF({ ...f, [k]: v });

  /** Solo se guarda lo que difiere del formato del tipo de plantilla. */
  function diferencia(): Partial<FormatoInforme> {
    const base = datos!.porTipo;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(f!) as (keyof FormatoInforme)[]) {
      if (k === "etiquetas") {
        const et: Record<string, string> = {};
        for (const { clave } of ETIQUETAS) if (f!.etiquetas[clave].trim() && f!.etiquetas[clave] !== base.etiquetas[clave]) et[clave] = f!.etiquetas[clave].trim();
        if (Object.keys(et).length) out.etiquetas = et;
      } else if (JSON.stringify(f![k]) !== JSON.stringify(base[k])) out[k] = f![k];
    }
    return out as Partial<FormatoInforme>;
  }

  async function guardar(formato: Partial<FormatoInforme> | null) {
    setGuardando(true);
    try {
      const r: Respuesta = await enviarInforme(`/informes/plantillas/${plantillaId}/formato`, "PUT", { formato });
      setDatos(r);
      setF(r.borrador?.efectivo ?? r.efectivo);
      toast.ok(
        `${formato ? "Formato guardado" : "Vuelta al formato del tipo guardada"} en el borrador v${r.borrador?.numero ?? "?"}: rige cuando otra persona lo apruebe (Plantillas › Versiones).`,
      );
      onGuardado?.();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <p className="subtitle" style={{ marginTop: 0 }}>
        Vigente: {datos.version ? <b>v{datos.version.numero}</b> : "sin versión"}
        {datos.borrador ? <> · editando el <b>borrador v{datos.borrador.numero}</b> (pendiente de aprobación)</> : " · al guardar se crea un borrador; la vigente no cambia hasta que se apruebe"}
      </p>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="fmt-agrup">Agrupación de los resultados</label>
          <select id="fmt-agrup" value={f.agrupacion} onChange={(e) => poner("agrupacion", e.target.value as FormatoInforme["agrupacion"])}>
            <option value="muestra">Una tabla por muestra</option>
            <option value="seccion">Secciones y componentes numerados</option>
            <option value="unica">Una sola tabla con todas las muestras</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="fmt-req">Requisito</label>
          <select id="fmt-req" value={f.columnasRequisito} onChange={(e) => poner("columnasRequisito", e.target.value as FormatoInforme["columnasRequisito"])}>
            <option value="texto">Una columna «Requisito» (6,5 – 8,5; Máx. 0,05…)</option>
            <option value="min_max">Dos columnas: Mínimo y Máximo</option>
            <option value="min_max_otros">Tres columnas: Mínimo, Máximo y Otros («Ausencia»)</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="fmt-modalidad">Modalidad propuesta al emitir</label>
          <select id="fmt-modalidad" value={f.modalidadPorDefecto ?? "sugerida"} onChange={(e) => poner("modalidadPorDefecto", e.target.value as NonNullable<FormatoInforme["modalidadPorDefecto"]>)}>
            <option value="sugerida">Según los ensayos (cumplimiento si alguno tiene requisito)</option>
            <option value="cumplimiento">Cumplimiento (requisito y veredicto)</option>
            <option value="solo_resultados">Solo resultados</option>
          </select>
        </div>
        {f.columnasRequisito !== "texto" && (
          <div className="field">
            <label htmlFor="fmt-sincota">Texto de una cota vacía</label>
            <input id="fmt-sincota" maxLength={10} value={f.textoSinCota} onChange={(e) => poner("textoSinCota", e.target.value)} />
          </div>
        )}
        <div className="field">
          <label htmlFor="fmt-num">Punto donde empiezan los resultados</label>
          <input id="fmt-num" value={f.numeracion ?? ""} maxLength={8} inputMode="decimal"
            onChange={(e) => poner("numeracion", e.target.value.trim() || null)} aria-describedby="fmt-num-ayuda" />
          <small id="fmt-num-ayuda" style={{ color: "var(--muted)" }}>Vacío = sin numerar. Con 4: 4.1, 4.1.1…</small>
        </div>
        <div className="field">
          <label htmlFor="fmt-portada">Portada</label>
          <select id="fmt-portada" value={f.portada} onChange={(e) => poner("portada", e.target.value as FormatoInforme["portada"])}>
            <option value="ninguna">Sin portada</option>
            <option value="ivc">Portada del IVC (propósito, OPI, contrato, proveedor…)</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="fmt-sello">Secciones con «Sello N.º»</label>
          <input id="fmt-sello" defaultValue={(f.seccionesConSello ?? []).join(", ")} maxLength={300} aria-describedby="fmt-secc-ayuda"
            onBlur={(e) => poner("seccionesConSello", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} />
        </div>
        <div className="field">
          <label htmlFor="fmt-sinmet">Secciones sin columna de método</label>
          <input id="fmt-sinmet" defaultValue={(f.seccionesSinMetodo ?? []).join(", ")} maxLength={300} aria-describedby="fmt-secc-ayuda"
            onBlur={(e) => poner("seccionesSinMetodo", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} />
          <small id="fmt-secc-ayuda" style={{ color: "var(--muted)" }}>Nombres separados por coma; basta que el título de la sección los contenga (p. ej. Dimensiones).</small>
        </div>
        <div className="field">
          <label htmlFor="fmt-est">Desviación estándar y CV</label>
          <select id="fmt-est" value={f.estadisticas} onChange={(e) => poner("estadisticas", e.target.value as FormatoInforme["estadisticas"])}>
            <option value="auto">Solo si hay réplicas</option>
            <option value="siempre">Siempre</option>
            <option value="nunca">Nunca</option>
          </select>
        </div>
        <fieldset className="field span-2" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", fontWeight: 600, marginBottom: 4 }}>Incluir</legend>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12.5 }}>
            {([
              ["columnaMetodo", "Columna del método"],
              ["columnaUnidad", "Columna de la unidad"],
              ["referencias", "Cuadro de referencias (No cumple)"],
              ["anexoFotografico", "Anexo fotográfico"],
              ["unidadEnResultado", "Unidad junto al resultado"],
              ["columnaMuestra", "Columna de la muestra siempre"],
              ["productoTerminado", "Verificación del producto terminado (IVC)"],
            ] as const).map(([k, t]) => (
              <label key={k} style={{ display: "flex", gap: 5, alignItems: "center" }}>
                <input type="checkbox" checked={f[k]} onChange={(e) => poner(k, e.target.checked)} /> {t}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="field span-3">
          <label htmlFor="fmt-concl">Texto fijo de la conclusión</label>
          <textarea id="fmt-concl" rows={2} maxLength={2000} value={f.conclusionFija ?? ""}
            onChange={(e) => poner("conclusionFija", e.target.value.trim() ? e.target.value : null)} />
        </div>
        {ETIQUETAS.map(({ clave, texto }) => (
          <div className="field" key={clave}>
            <label htmlFor={`fmt-et-${clave}`}>{texto}</label>
            <input id={`fmt-et-${clave}`} maxLength={40} value={f.etiquetas[clave]}
              onChange={(e) => setF({ ...f, etiquetas: { ...f.etiquetas, [clave]: e.target.value } })} />
          </div>
        ))}
      </div>
      <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
        <button className="btn primary sm" disabled={guardando} onClick={() => guardar(diferencia())}>
          {guardando ? "Guardando…" : "Guardar en el borrador"}
        </button>
        {datos.guardado && (
          <button className="btn outline sm" disabled={guardando} onClick={() => guardar(null)}>Volver al formato del tipo</button>
        )}
        <small style={{ color: "var(--muted)" }}>Una vez aprobado, aplica a los documentos que se emitan desde entonces; los emitidos no cambian.</small>
      </div>
    </div>
  );
}
