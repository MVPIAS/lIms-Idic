"use client";

/**
 * Porcentajes de la tasa de internación y del IVA aplicado a la tasa
 * (parámetros `bpch_tasa`, IDIC-PG 24 Anexo 03). Se ven con coma decimal; los
 * cambia quien tiene «catalogo.gestionar», con motivo, y cada cambio queda en el
 * historial (quién, cuándo, de qué valor a cuál y por qué). El resto, solo
 * lectura. API: GET /parametros/porcentajes · PUT /parametros/porcentajes/:categoria/:codigo
 */
import { useCallback, useEffect, useState } from "react";
import { llamar } from "@/lib/laboratorio";
import { usePermisos } from "@/lib/permisos";
import { fechaHora } from "@/lib/format";
import { toast } from "@/components/ui/feedback";

interface Valor { id: string; categoria: string; codigo: string; etiqueta: string; valor: string | null; numero: number | null; updatedAt: string | null }
interface Cambio { id: string; codigo: string; valorAnterior: string | null; valorNuevo: string | null; motivo: string; createdAt: string; usuarioNombre: string | null }

/** «1.5» → «1,5 %». */
export const porcentajeCl = (v: string | number | null | undefined) => {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? `${n.toLocaleString("es-CL", { maximumFractionDigits: 4 })} %` : String(v);
};

export default function PorcentajesTasa({ compacto = false }: { compacto?: boolean }) {
  const { puede } = usePermisos();
  const [datos, setDatos] = useState<{ valores: Valor[]; historial: Cambio[]; puedeEditar?: boolean } | null>(null);
  // Los cambia catalogo.gestionar con alcance global (Calidad, Administración); lo dice el servidor.
  const editable = datos?.puedeEditar ?? puede("catalogo.gestionar");
  const [error, setError] = useState("");
  const [editando, setEditando] = useState<Valor | null>(null);
  const [nuevo, setNuevo] = useState("");
  const [motivo, setMotivo] = useState("");
  const [errorForm, setErrorForm] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [verHistorial, setVerHistorial] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setDatos(await llamar("GET", "/parametros/porcentajes"));
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    cargar();
  }, [cargar]);

  function abrir(v: Valor) {
    setEditando(v);
    setNuevo(v.numero === null ? "" : v.numero.toLocaleString("es-CL", { maximumFractionDigits: 4, useGrouping: false }));
    setMotivo("");
    setErrorForm("");
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!editando) return;
    const t = nuevo.trim().replace(/\s*%$/, "");
    if (!/^\d{1,3}(,\d{1,4})?$/.test(t)) { setErrorForm("Escriba el porcentaje con coma decimal, p. ej. 1,5 (entre 0 y 100, hasta 4 decimales)."); return; }
    const n = Number(t.replace(",", "."));
    if (n < 0 || n > 100) { setErrorForm("El porcentaje debe estar entre 0 y 100."); return; }
    if (motivo.trim().length < 5) { setErrorForm("Indique el motivo del cambio (mínimo 5 caracteres)."); return; }
    setGuardando(true);
    setErrorForm("");
    try {
      await llamar("PUT", `/parametros/porcentajes/${editando.categoria}/${editando.codigo}`, { valor: t, motivo: motivo.trim() });
      toast.ok(`${editando.etiqueta}: ${porcentajeCl(n)}.`);
      setEditando(null);
      await cargar();
    } catch (err: any) {
      setErrorForm(err.message);
    } finally {
      setGuardando(false);
    }
  }

  if (error) return compacto ? null : <div className="alert warn" role="alert">Porcentajes de la tasa de internación: {error}</div>;
  if (!datos) return compacto ? null : <div className="card" style={{ padding: 14 }}><p className="subtitle" style={{ margin: 0 }}>Cargando porcentajes…</p></div>;

  if (compacto) {
    return (
      <span style={{ fontSize: 12, color: "var(--muted)" }}>
        Vigentes: {datos.valores.map((v) => `${v.codigo === "tasa_pct" ? "tasa" : "IVA"} ${porcentajeCl(v.valor)}`).join(" · ")}
      </span>
    );
  }

  const etiquetaDe = (codigo: string) => datos.valores.find((v) => v.codigo === codigo)?.etiqueta ?? codigo;
  return (
    <section className="card" style={{ padding: 14 }} aria-labelledby="pct-titulo">
      <h2 id="pct-titulo" style={{ fontSize: 14, margin: "0 0 4px" }}>Porcentajes de la tasa de internación</h2>
      <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 10px" }}>
        Se aplican al calcular la tasa de cada internación (IDIC-PG 24 Anexo 03). Un cambio vale para los cálculos que se hagan desde
        ese momento; los ya registrados no cambian.{editable ? " Cada cambio pide motivo y queda en el historial." : " Solo los cambia quien administra los parámetros."}
      </p>
      {datos.valores.length === 0 ? (
        <p className="alert warn" style={{ margin: 0 }}>Esta instalación no tiene los parámetros de la tasa (bpch_tasa). Aplique los SQL de BPCH.</p>
      ) : (
        <table className="data">
          <thead><tr><th>Parámetro</th><th className="num">Valor vigente</th><th>Último cambio</th>{editable && <th />}</tr></thead>
          <tbody>
            {datos.valores.map((v) => (
              <tr key={v.id}>
                <td>{v.etiqueta}</td>
                <td className="num" style={{ fontWeight: 700 }}>{porcentajeCl(v.valor)}</td>
                <td>{v.updatedAt ? fechaHora(v.updatedAt) : "—"}</td>
                {editable && <td style={{ textAlign: "right" }}><button type="button" className="btn outline sm" onClick={() => abrir(v)}>Cambiar</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editando && (
        <form onSubmit={guardar} className="form-grid cols-2" style={{ marginTop: 12, border: "1px dashed var(--line)", borderRadius: 8, padding: 10 }}>
          <div className="field">
            <label htmlFor="pct-valor">{editando.etiqueta} <span className="req">*</span></label>
            <input id="pct-valor" inputMode="decimal" value={nuevo} onChange={(e) => setNuevo(e.target.value)} aria-describedby="pct-ayuda" autoFocus />
            <small id="pct-ayuda" style={{ color: "var(--muted)" }}>Entre 0 y 100, con coma decimal (vigente: {porcentajeCl(editando.valor)}).</small>
          </div>
          <div className="field">
            <label htmlFor="pct-motivo">Motivo del cambio <span className="req">*</span></label>
            <input id="pct-motivo" value={motivo} maxLength={500} onChange={(e) => setMotivo(e.target.value)} />
          </div>
          {errorForm && <div className="alert warn" role="alert" style={{ gridColumn: "1 / -1", margin: 0 }}>{errorForm}</div>}
          <div className="toolbar" style={{ gridColumn: "1 / -1", margin: 0 }}>
            <button type="button" className="btn outline sm" onClick={() => setEditando(null)}>Cancelar</button>
            <button type="submit" className="btn primary sm" disabled={guardando}>{guardando ? "Guardando…" : "Guardar"}</button>
          </div>
        </form>
      )}

      <div style={{ marginTop: 10 }}>
        <button type="button" className="btn outline sm" aria-expanded={verHistorial} onClick={() => setVerHistorial((x) => !x)}>
          {verHistorial ? "Ocultar historial" : `Historial de cambios (${datos.historial.length})`}
        </button>
        {verHistorial && (
          datos.historial.length === 0 ? (
            <p className="subtitle" style={{ margin: "8px 0 0" }}>Sin cambios registrados: siguen los valores de la instalación.</p>
          ) : (
            <table className="data" style={{ marginTop: 8 }}>
              <thead><tr><th>Fecha</th><th>Quién</th><th>Parámetro</th><th className="num">Antes</th><th className="num">Después</th><th>Motivo</th></tr></thead>
              <tbody>
                {datos.historial.map((h) => (
                  <tr key={h.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{fechaHora(h.createdAt)}</td>
                    <td>{h.usuarioNombre ?? "—"}</td>
                    <td>{etiquetaDe(h.codigo)}</td>
                    <td className="num">{porcentajeCl(h.valorAnterior)}</td>
                    <td className="num">{porcentajeCl(h.valorNuevo)}</td>
                    <td>{h.motivo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>
    </section>
  );
}
