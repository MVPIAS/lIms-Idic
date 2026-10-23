"use client";

/**
 * EP-08 8.11 · Parametrización del elemento nuevo (Librería de pruebas →
 * elementos): panel con método, ensayo, Mín / Nom / Máx, unidad y fórmula
 * (general o específica). Lo prepara quien gestiona el prototipo, lo valida
 * la jefatura (no quien lo preparó) y, con la OT, la jefatura de la unidad lo
 * aplica como especificación de los resultados. Sin valores por defecto.
 */
import { useState } from "react";
import { toast } from "@/components/ui/feedback";
import { usePermisos } from "@/lib/permisos";
import { llamar } from "@/lib/laboratorio";
import { fechaHora } from "@/lib/format";

type Fila = { metodoId: string; metodoCodigo?: string; metodoNombre?: string; ensayo: string; minimo: string; nominal: string; maximo: string; unidad: string; formula: string; tipoFormula: string };
const PILL: Record<string, string> = { sin_parametros: "gray", borrador: "amber", en_validacion: "blue", validada: "green", devuelta: "red" };

const aTexto = (n: unknown) => (typeof n === "number" ? String(n).replace(".", ",") : "");
const aNumero = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));

export default function ParametrizacionPrototipo({ p, onCambio }: { p: any; onCambio: (nuevo: any) => void }) {
  const { puede } = usePermisos();
  const par = p.parametrizacion;
  const conOt = Boolean(p.ot && p.ot.estado !== "anulada");
  const editable = puede("bpch.prototipo.gestionar") && !conOt && ["sin_parametros", "borrador", "devuelta"].includes(par.estado) && !["anulado", "dictaminado"].includes(p.estado);
  const [filas, setFilas] = useState<Fila[]>(() =>
    (par.filas ?? []).map((f: any) => ({ ...f, minimo: aTexto(f.minimo), nominal: aTexto(f.nominal), maximo: aTexto(f.maximo), unidad: f.unidad ?? "", formula: f.formula ?? "", tipoFormula: f.tipoFormula ?? "" })),
  );
  const [buscar, setBuscar] = useState<Record<number, string>>({});
  const [opciones, setOpciones] = useState<Record<number, { id: string; codigo: string; nombre: string; detalle: string }[]>>({});
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const poner = (i: number, x: Partial<Fila>) => setFilas((l) => l.map((f, j) => (j === i ? { ...f, ...x } : f)));

  async function buscarMetodo(i: number) {
    const q = (buscar[i] ?? "").trim();
    if (q.length < 2) return;
    try {
      const r = await llamar<any>("GET", `/cat/metodos?search=${encodeURIComponent(q)}&limit=20`);
      // B-091: código, laboratorio, ensayo y norma para distinguir métodos con el mismo nombre.
      setOpciones((o) => ({
        ...o,
        [i]: (r.data ?? r ?? []).map((m: any) => ({
          id: m.id,
          codigo: m.codigo,
          nombre: m.nombre,
          detalle: [m.ensayo?.familia?.laboratorio || m.ensayo?.familia?.nombre, m.ensayo?.codigo ? `ensayo ${m.ensayo.codigo}` : null, m.norma]
            .filter((x: any) => x && String(x).trim())
            .join(" · "),
        })),
      }));
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function accion(fn: () => Promise<any>, ok: string) {
    setError("");
    setBusy(true);
    try {
      const r = await fn();
      toast.ok(ok);
      onCambio(r.prototipo ?? r);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const guardar = () =>
    accion(
      () =>
        llamar("PUT", `/bpch/prototipos/${p.id}/parametros`, {
          filas: filas.map((f) => ({
            metodoId: f.metodoId,
            ensayo: f.ensayo,
            minimo: aNumero(f.minimo),
            nominal: aNumero(f.nominal),
            maximo: aNumero(f.maximo),
            unidad: f.unidad || null,
            formula: f.formula || null,
            tipoFormula: f.formula ? f.tipoFormula || null : null,
          })),
        }),
      "Panel del elemento guardado.",
    );

  return (
    <div>
      <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--muted)" }}>
        Panel del elemento nuevo: ensayos con su especificación (Mín / Nom / Máx) y fórmula. Lo valida la jefatura antes de ensayar
        {par.exigeParaOt ? "; la OT de evaluación lo exige." : " (que la OT lo exija está por confirmar: «Parámetros de la operación»)."}
      </p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
        <span className={`pill ${PILL[par.estado] ?? "gray"}`}>{par.estadoNombre}</span>
        {par.enviada && <small>Enviada por {par.enviada.por} · {fechaHora(par.enviada.at)}</small>}
        {par.validada && <small>· validada por {par.validada.por} · {fechaHora(par.validada.at)}</small>}
      </div>
      {par.estado === "devuelta" && par.devueltaMotivo && <div className="alert warn">Devuelta: {par.devueltaMotivo}</div>}
      {error && <div className="alert warn" role="alert">{error}</div>}
      <div style={{ overflowX: "auto" }}>
        <table className="data">
          <thead><tr><th>Método</th><th>Ensayo</th><th>Mín</th><th>Nom</th><th>Máx</th><th>Unidad</th><th>Fórmula</th>{editable && <th />}</tr></thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={i}>
                <td style={{ minWidth: 200 }}>
                  {f.metodoId ? (
                    <span><span className="codigo">{f.metodoCodigo}</span> · {f.metodoNombre}</span>
                  ) : (
                    <div style={{ display: "grid", gap: 4 }}>
                      <div style={{ display: "flex", gap: 4 }}>
                        <input aria-label={`Buscar método de la fila ${i + 1}`} placeholder="Código o nombre" value={buscar[i] ?? ""} onChange={(e) => setBuscar((b) => ({ ...b, [i]: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), buscarMetodo(i))} />
                        <button type="button" className="btn outline sm" onClick={() => buscarMetodo(i)}>Buscar</button>
                      </div>
                      {(opciones[i] ?? []).length > 0 && (
                        <select aria-label={`Método de la fila ${i + 1}`} defaultValue="" onChange={(e) => { const m = opciones[i].find((x) => x.id === e.target.value); if (m) poner(i, { metodoId: m.id, metodoCodigo: m.codigo, metodoNombre: m.nombre }); }}>
                          <option value="">Elija el método…</option>
                          {opciones[i].map((m) => <option key={m.id} value={m.id}>{m.codigo} · {m.nombre}{m.detalle ? ` — ${m.detalle}` : ""}</option>)}
                        </select>
                      )}
                    </div>
                  )}
                </td>
                {editable ? (
                  <>
                  <td><input aria-label={`Ensayo de la fila ${i + 1}`} value={f.ensayo} disabled={!editable} onChange={(e) => poner(i, { ensayo: e.target.value })} maxLength={200} /></td>
                  <td><input aria-label={`Mínimo de la fila ${i + 1}`} inputMode="decimal" value={f.minimo} disabled={!editable} onChange={(e) => poner(i, { minimo: e.target.value })} style={{ width: 80 }} /></td>
                  <td><input aria-label={`Nominal de la fila ${i + 1}`} inputMode="decimal" value={f.nominal} disabled={!editable} onChange={(e) => poner(i, { nominal: e.target.value })} style={{ width: 80 }} /></td>
                  <td><input aria-label={`Máximo de la fila ${i + 1}`} inputMode="decimal" value={f.maximo} disabled={!editable} onChange={(e) => poner(i, { maximo: e.target.value })} style={{ width: 80 }} /></td>
                  <td><input aria-label={`Unidad de la fila ${i + 1}`} value={f.unidad} disabled={!editable} onChange={(e) => poner(i, { unidad: e.target.value })} maxLength={30} style={{ width: 70 }} /></td>
                  <td style={{ minWidth: 180 }}>
                    <input aria-label={`Fórmula de la fila ${i + 1}`} placeholder="(C1 - C2) / C3 * 100" value={f.formula} disabled={!editable} onChange={(e) => poner(i, { formula: e.target.value })} maxLength={500} />
                    {f.formula && (
                      <select aria-label={`Tipo de fórmula de la fila ${i + 1}`} value={f.tipoFormula} disabled={!editable} onChange={(e) => poner(i, { tipoFormula: e.target.value })} style={{ marginTop: 4 }}>
                        <option value="">¿General o específica?</option>
                        <option value="general">General</option>
                        <option value="especifica">Específica</option>
                      </select>
                    )}
                  </td>
                  </>
                ) : (
                  // B-037: quien valida (o consulta) lee el panel como texto, no en casillas desactivadas y recortadas.
                  <>
                    <td style={{ whiteSpace: "normal" }}>{f.ensayo || "—"}</td>
                    <td className="num">{f.minimo || "—"}</td>
                    <td className="num">{f.nominal || "—"}</td>
                    <td className="num">{f.maximo || "—"}</td>
                    <td>{f.unidad || "—"}</td>
                    <td style={{ whiteSpace: "normal" }}>{f.formula ? <><code>{f.formula}</code>{f.tipoFormula ? <small style={{ color: "var(--muted)" }}> · {f.tipoFormula === "general" ? "general" : "específica"}</small> : null}</> : "—"}</td>
                  </>
                )}
                {editable && <td><button type="button" className="btn ghost sm" aria-label={`Quitar la fila ${i + 1}`} onClick={() => setFilas((l) => l.filter((_, j) => j !== i))}>Quitar</button></td>}
              </tr>
            ))}
            {!filas.length && <tr><td colSpan={8} style={{ color: "var(--muted)" }}>Sin ensayos en el panel.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="toolbar" style={{ marginTop: 8, flexWrap: "wrap" }}>
        {editable && (
          <>
            <button type="button" className="btn outline sm" onClick={() => setFilas((l) => [...l, { metodoId: "", ensayo: "", minimo: "", nominal: "", maximo: "", unidad: "", formula: "", tipoFormula: "" }])}>＋ Ensayo</button>
            <button type="button" className="btn outline sm" disabled={busy || filas.some((f) => !f.metodoId)} onClick={guardar}>Guardar panel</button>
            <button type="button" className="btn primary sm" disabled={busy || !(par.filas ?? []).length} onClick={() => accion(() => llamar("POST", `/bpch/prototipos/${p.id}/parametros/enviar`, {}), "Parametrización enviada a validación.")}>Enviar a validación</button>
          </>
        )}
        {par.estado === "en_validacion" && puede("bpch.prototipo.dictaminar") && (
          <>
            <button type="button" className="btn success sm" disabled={busy} onClick={() => accion(() => llamar("POST", `/bpch/prototipos/${p.id}/parametros/validar`, {}), "Parametrización validada.")}>Validar → ensayar</button>
            <input aria-label="Motivo de la devolución" placeholder="Motivo de la devolución" value={motivo} onChange={(e) => setMotivo(e.target.value)} style={{ minWidth: 220 }} />
            <button type="button" className="btn ghost-danger sm" disabled={busy || motivo.trim().length < 5} onClick={() => accion(() => llamar("POST", `/bpch/prototipos/${p.id}/parametros/devolver`, { motivo }), "Parametrización devuelta.")}>Devolver con motivo</button>
          </>
        )}
        {par.estado === "validada" && conOt && puede("resultado.aprobar") && (
          <button type="button" className="btn primary sm" disabled={busy}
            onClick={() => accion(async () => { const r = await llamar<any>("POST", `/bpch/prototipos/${p.id}/parametros/aplicar`, {}); toast.info(`${r.aplicados} resultado(s) con la especificación del panel.`); return r; }, "Panel aplicado a la OT.")}>
            Aplicar el panel a la OT
          </button>
        )}
      </div>
    </div>
  );
}
