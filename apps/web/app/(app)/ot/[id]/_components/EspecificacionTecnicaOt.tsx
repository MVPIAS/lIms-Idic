"use client";

/**
 * Especificación técnica del cliente en la OT (EP-03 0.5, EP-05 0.3 y 5.1):
 * la E.T. vigente que rige la OT (y, si hace falta, la propia de una muestra),
 * «Aplicar requisitos de la E.T. → veredicto» y el desglose del producto en
 * componentes e inspecciones (EP-03 1.3). Va en la pestaña «Cabecera».
 * API: /especificaciones-tecnicas/ot/:otId, /muestra/:id y /muestra/:id/desglose.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "@/components/ui/feedback";
import { llamar } from "@/lib/laboratorio";
import { fechaHora } from "@/lib/format";
import { usePermisos } from "@/lib/permisos";
import { TIPO_PUNTO, textoRequisito } from "@/lib/especificaciones";

interface EtCorta { id: string; codigo: string; version: number; nombre: string; licitacion?: string | null; producto?: string | null; clienteNombre?: string | null }
interface DatosEtOt {
  ot: { id: string; codigo: string; estado: string };
  et: (EtCorta & { nPuntos: number; tienePdf: boolean; asignadaAt: string | null; asignadaPorNombre: string | null }) | null;
  muestras: { id: string; codigo: string; nombre: string | null; padreId: string | null; componente: string | null; etId: string | null; etCodigo: string | null; etVersion: number | null }[];
  elegibles: EtCorta[];
  ensayos: { total: number; deEt: number };
  puede: { elegir: boolean; aplicar: boolean; desglosar: boolean };
}
interface ResumenAplicacion { aplicados: number; sinPunto: number; omitidos: { ensayo: string; motivo: string }[] }

const nombreEt = (e: { codigo: string; version: number; nombre?: string }) => `${e.codigo} v${e.version}${e.nombre ? ` · ${e.nombre}` : ""}`;

export default function EspecificacionTecnicaOt({ otId, onCambio }: { otId: string; onCambio?: () => void }) {
  const { puede } = usePermisos();
  const [d, setD] = useState<DatosEtOt | null>(null);
  const [error, setError] = useState("");
  const [elegida, setElegida] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [resumen, setResumen] = useState<ResumenAplicacion | null>(null);
  const [desglose, setDesglose] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await llamar<DatosEtOt>("GET", `/especificaciones-tecnicas/ot/${otId}`);
      setD(r);
      setElegida(r.et?.id ?? "");
      setError("");
    } catch (e: any) { setError(e.message); }
  }, [otId]);
  useEffect(() => { cargar(); }, [cargar]);

  async function elegir() {
    setOcupado(true);
    try {
      const r = await llamar<DatosEtOt & { aplicado: ResumenAplicacion | null }>("PUT", `/especificaciones-tecnicas/ot/${otId}`, {
        etId: elegida || null, aplicar: !!elegida && (d?.ensayos.total ?? 0) > 0 && puede("resultado.crear"),
      });
      setD(r);
      setResumen(r.aplicado);
      toast.ok(elegida ? "E.T. elegida: los ensayos que se registren toman su requisito." : "La OT ya no tiene E.T.");
      onCambio?.();
    } catch (e: any) { toast.error(e.message); }
    finally { setOcupado(false); }
  }
  async function aplicar() {
    setOcupado(true);
    try {
      const r = await llamar<ResumenAplicacion>("POST", `/especificaciones-tecnicas/ot/${otId}/aplicar`);
      setResumen(r);
      toast.ok(`Requisitos aplicados a ${r.aplicados} ensayo(s).`);
      await cargar();
      onCambio?.();
    } catch (e: any) { toast.error(e.message); }
    finally { setOcupado(false); }
  }
  async function etDeMuestra(muestraId: string, etId: string) {
    try {
      const r = await llamar<DatosEtOt>("PUT", `/especificaciones-tecnicas/muestra/${muestraId}`, { etId: etId || null, aplicar: puede("resultado.crear") });
      setD(r);
      toast.ok("E.T. de la muestra guardada.");
    } catch (e: any) { toast.error(e.message); }
  }

  if (error) return <div className="alert warn" role="alert">{error}</div>;
  if (!d) return <p className="subtitle">Cargando la especificación técnica…</p>;
  const productos = d.muestras.filter((m) => !m.padreId);

  return (
    <div className="card" style={{ padding: 12, margin: 0 }} aria-labelledby="et-ot-titulo">
      <h3 id="et-ot-titulo" style={{ margin: "0 0 6px", fontSize: 14 }}>Especificación técnica del cliente (E.T.)</h3>
      {d.et ? (
        <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", fontSize: 12.5 }}>
          <Link href={`/especificaciones/${d.et.id}` as any} style={{ color: "var(--accent)", fontWeight: 700 }}>{nombreEt(d.et)}</Link>
          <span style={{ color: "var(--muted)" }}>
            {d.et.nPuntos} punto(s){d.et.tienePdf ? " · con PDF" : ""}{d.et.asignadaAt ? ` · elegida el ${fechaHora(d.et.asignadaAt)}${d.et.asignadaPorNombre ? ` por ${d.et.asignadaPorNombre}` : ""}` : ""}
          </span>
          {d.ensayos.total > 0 && (
            <span className={`pill ${d.ensayos.deEt === d.ensayos.total ? "green" : "amber"}`}>{d.ensayos.deEt} de {d.ensayos.total} ensayos con el requisito de la E.T.</span>
          )}
        </div>
      ) : (
        <p className="subtitle" style={{ margin: 0 }}>Sin E.T.: los ensayos usan el requisito del catálogo o el que se fije en la orden.</p>
      )}

      {d.puede.elegir && (
        <div className="toolbar" style={{ marginTop: 8, marginBottom: 0, flexWrap: "wrap", gap: 6 }}>
          <label className="sr-only" htmlFor="et-ot-elegir">E.T. vigente para la OT</label>
          <select id="et-ot-elegir" value={elegida} onChange={(e) => setElegida(e.target.value)} style={{ minWidth: 260, maxWidth: "100%" }}>
            <option value="">Sin E.T.</option>
            {d.elegibles.map((e) => <option key={e.id} value={e.id}>{nombreEt(e)}{e.clienteNombre ? ` · ${e.clienteNombre}` : ""}</option>)}
          </select>
          <button type="button" className="btn primary sm" disabled={ocupado || elegida === (d.et?.id ?? "")} onClick={elegir}>
            {elegida || !d.et ? "Elegir E.T. → requisitos de los ensayos" : "Quitar la E.T."}
          </button>
          {d.elegibles.length === 0 && <span style={{ fontSize: 11.5, color: "var(--muted)" }}>No hay E.T. vigentes para este cliente y laboratorio. <Link href={"/especificaciones" as any} style={{ color: "var(--accent)" }}>Ver la biblioteca</Link></span>}
        </div>
      )}
      {d.puede.aplicar && (d.et || d.muestras.some((m) => m.etId)) && d.ensayos.total > 0 && (
        <div className="toolbar" style={{ marginTop: 6, marginBottom: 0 }}>
          <button type="button" className="btn outline sm" disabled={ocupado} onClick={aplicar}>Aplicar requisitos de la E.T. → veredicto</button>
          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>A los ensayos sin revisar. Cambiar un requisito que vino del catálogo lo hace la jefatura.</span>
        </div>
      )}
      {resumen && (
        <div className={`alert ${resumen.omitidos.length ? "warn" : "success"}`} role="status" style={{ marginTop: 8 }}>
          {resumen.aplicados} ensayo(s) con el requisito de la E.T.{resumen.sinPunto ? ` · ${resumen.sinPunto} sin punto en la E.T.` : ""}
          {resumen.omitidos.length > 0 && (
            <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
              {resumen.omitidos.map((o, i) => <li key={i}>{o.ensayo}: {o.motivo}</li>)}
            </ul>
          )}
        </div>
      )}

      {productos.length > 0 && (d.et || d.muestras.some((m) => m.etId) || d.puede.elegir) && (
        <>
          <h4 style={{ margin: "12px 0 4px", fontSize: 12.5 }}>Muestras, su E.T. y sus componentes</h4>
          <table className="data">
            <thead><tr><th scope="col">Muestra</th><th scope="col">E.T. que rige</th><th scope="col">Componentes</th><th scope="col"><span className="sr-only">Acciones</span></th></tr></thead>
            <tbody>
              {productos.map((m) => {
                const hijas = d.muestras.filter((x) => x.padreId === m.id);
                return (
                  <tr key={m.id}>
                    <td><span className="codigo">{m.codigo}</span>{m.nombre ? <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{m.nombre}</div> : null}</td>
                    <td>
                      {puede("muestra.crear") && d.puede.desglosar ? (
                        <select aria-label={`E.T. de la muestra ${m.codigo}`} value={m.etId ?? ""} onChange={(e) => etDeMuestra(m.id, e.target.value)}>
                          <option value="">{d.et ? `La de la OT (${d.et.codigo} v${d.et.version})` : "Sin E.T."}</option>
                          {d.elegibles.map((e) => <option key={e.id} value={e.id}>{nombreEt(e)}</option>)}
                        </select>
                      ) : m.etCodigo ? `${m.etCodigo} v${m.etVersion}` : d.et ? `La de la OT (${d.et.codigo} v${d.et.version})` : "—"}
                    </td>
                    <td>{hijas.length ? hijas.map((h) => <div key={h.id} style={{ fontSize: 12 }}><span className="codigo">{h.codigo}</span> · {h.componente}</div>) : <span style={{ color: "var(--muted)" }}>—</span>}</td>
                    <td>
                      {(m.etId || d.et) && (
                        <button type="button" className="btn outline sm" onClick={() => setDesglose(desglose === m.id ? null : m.id)} aria-expanded={desglose === m.id}>
                          Componentes e inspecciones
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {desglose && <DesgloseMuestra muestraId={desglose} puedeConfirmar={d.puede.desglosar} onHecho={() => { cargar(); onCambio?.(); }} />}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- desglose --- */

interface PuntoPlan { id: string; punto: string; componente: string | null; caracteristica: string; tipo: keyof typeof TIPO_PUNTO; metodoCodigo: string | null; metodoNombre: string | null; laboratorioCodigo: string | null; limiteInf: string | null; limiteSup: string | null; nominal: string | null; unidad: string | null; requisito: string | null }
interface Desglose {
  muestra: { id: string; codigo: string; nombre: string | null };
  et: { codigo: string; version: number } | null;
  plan: {
    componentes: { nombre: string; puntos: PuntoPlan[]; metodoIds: string[]; yaDesglosado: boolean }[];
    producto: { puntos: PuntoPlan[] };
    inspecciones: { puntos: PuntoPlan[] };
    sinEnsayo: PuntoPlan[];
  } | null;
  submuestras: { id: string; codigo: string; componente: string; ensayos: number }[];
}

/** Árbol producto → componentes e inspecciones (EP-03 1.3) y «Confirmar plan de ensayos → asignar». */
function DesgloseMuestra({ muestraId, puedeConfirmar, onHecho }: { muestraId: string; puedeConfirmar: boolean; onHecho: () => void }) {
  const [d, setD] = useState<Desglose | null>(null);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const cargar = useCallback(() => {
    llamar<Desglose>("GET", `/especificaciones-tecnicas/muestra/${muestraId}/desglose`).then((r) => { setD(r); setError(""); }).catch((e) => setError(e.message));
  }, [muestraId]);
  useEffect(() => { cargar(); }, [cargar]);

  async function confirmar() {
    setOcupado(true);
    try {
      const r = await llamar<Desglose & { creadas: { submuestras: { codigo: string }[]; ensayosProducto: number } }>("POST", `/especificaciones-tecnicas/muestra/${muestraId}/desglose`, {});
      setD(r);
      toast.ok(r.creadas.submuestras.length ? `Submuestras: ${r.creadas.submuestras.map((s) => s.codigo).join(", ")}.` : "El plan ya estaba confirmado: no hay componentes nuevos.");
      onHecho();
    } catch (e: any) { toast.error(e.message); }
    finally { setOcupado(false); }
  }

  if (error) return <div className="alert warn" role="alert" style={{ marginTop: 8 }}>{error}</div>;
  if (!d) return <p className="subtitle">Cargando el plan de ensayos…</p>;
  if (!d.plan) return <div className="alert info" style={{ marginTop: 8 }}>La muestra no tiene una E.T. con puntos.</div>;
  const pendientes = d.plan.componentes.filter((c) => !c.yaDesglosado).length;
  const fila = (p: PuntoPlan) => (
    <li key={p.id} style={{ fontSize: 12, padding: "2px 0" }}>
      <span className="codigo">{p.punto}</span> · {p.caracteristica} — {textoRequisito(p)}
      {p.metodoCodigo ? <span style={{ color: "var(--muted)" }}> · {p.metodoCodigo}</span> : null}
    </li>
  );
  return (
    <div className="card" style={{ marginTop: 8, background: "#fbfeff", borderColor: "var(--accent)" }} role="region" aria-label={`Componentes e inspecciones de ${d.muestra.codigo}`}>
      <h4 style={{ margin: "0 0 6px", fontSize: 13 }}>
        {d.muestra.codigo} · plan de ensayos de la {d.et ? `E.T. ${d.et.codigo} v${d.et.version}` : "E.T."}
      </h4>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
        <div>
          <b style={{ fontSize: 12 }}>Producto ({d.plan.producto.puntos.length})</b>
          <ul style={{ listStyle: "none", padding: 0, margin: "4px 0 0" }}>{d.plan.producto.puntos.map(fila)}</ul>
        </div>
        {d.plan.componentes.map((c) => (
          <div key={c.nombre}>
            <b style={{ fontSize: 12 }}>Componente · {c.nombre}</b>{" "}
            {c.yaDesglosado ? <span className="pill green">Submuestra creada</span> : <span className="pill gray">Por desglosar</span>}
            <ul style={{ listStyle: "none", padding: 0, margin: "4px 0 0" }}>{c.puntos.map(fila)}</ul>
          </div>
        ))}
        <div>
          <b style={{ fontSize: 12 }}>Checklist de inspecciones ({d.plan.inspecciones.puntos.length})</b>
          <ul style={{ listStyle: "none", padding: 0, margin: "4px 0 0" }}>{d.plan.inspecciones.puntos.map(fila)}</ul>
        </div>
      </div>
      {d.plan.sinEnsayo.length > 0 && (
        <div className="alert warn" style={{ marginTop: 8 }}>
          {d.plan.sinEnsayo.length} punto(s) sin ensayo del catálogo no se pueden capturar: {d.plan.sinEnsayo.map((p) => `${p.punto} ${p.caracteristica}`).join(" · ")}. Vincúlelos en la E.T.
        </div>
      )}
      {puedeConfirmar && (
        <div className="toolbar" style={{ marginTop: 8, marginBottom: 0, justifyContent: "flex-end" }}>
          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
            {pendientes ? `Se crearán ${pendientes} submuestra(s) trazables (${d.muestra.codigo}-C1…) con sus ensayos.` : "Agrega al producto los ensayos y las inspecciones que falten."}
          </span>
          <button type="button" className="btn primary sm" disabled={ocupado} onClick={confirmar}>Confirmar plan de ensayos → asignar</button>
        </div>
      )}
    </div>
  );
}
