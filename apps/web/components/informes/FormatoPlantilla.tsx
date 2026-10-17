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

type Respuesta = { guardado: Partial<FormatoInforme> | null; efectivo: FormatoInforme; porTipo: FormatoInforme };

const ETIQUETAS: { clave: keyof FormatoInforme["etiquetas"]; texto: string }[] = [
  { clave: "ensayo", texto: "Columna del ensayo" },
  { clave: "metodo", texto: "Columna del método" },
  { clave: "unidad", texto: "Columna de la unidad" },
  { clave: "requisito", texto: "Columna del requisito" },
  { clave: "resultado", texto: "Columna del resultado" },
  { clave: "veredicto", texto: "Columna del veredicto" },
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
        setF(r.efectivo);
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
      setF(r.efectivo);
      toast.ok(formato ? "Formato de la plantilla guardado." : "La plantilla vuelve al formato de su tipo.");
      onGuardado?.();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="fmt-agrup">Agrupación de los resultados</label>
          <select id="fmt-agrup" value={f.agrupacion} onChange={(e) => poner("agrupacion", e.target.value as FormatoInforme["agrupacion"])}>
            <option value="muestra">Una tabla por muestra</option>
            <option value="seccion">Secciones y componentes numerados</option>
          </select>
        </div>
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
          {guardando ? "Guardando…" : "Guardar formato"}
        </button>
        {datos.guardado && (
          <button className="btn outline sm" disabled={guardando} onClick={() => guardar(null)}>Volver al formato del tipo</button>
        )}
        <small style={{ color: "var(--muted)" }}>Aplica a los documentos que se emitan desde ahora con esta plantilla; los emitidos no cambian.</small>
      </div>
    </div>
  );
}
