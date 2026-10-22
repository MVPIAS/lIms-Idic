"use client";

/**
 * LES · Panel sensorial (EP-02 3.6–3.8) · variante que se activa por método en
 * Parámetros de la operación (inactiva hasta EP-02 P1).
 *
 *   1 Plan de sesión: jueces, muestras, códigos aleatorios de 3 dígitos y orden
 *     de presentación por juez. «Generar cartillas → sesión».
 *   2 Cartillas: una por juez (escala por atributo, triangular o cocción); un
 *     juez se excluye con motivo.
 *   3 Consolidación: media, mediana y DE por atributo (atípicos sugeridos) o el
 *     binomial de la prueba triangular. «Consolidar → evaluación».
 *
 * API: GET|PUT /formularios/resultado/:resultadoId/sensorial
 */
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { PageHeader, SkeletonCards } from "@/components/ui/PageHeader";
import { toast } from "@/components/ui/feedback";
import { llamar } from "@/lib/laboratorio";
import { Bitacora, Campo, conComa, Pasos, Veredicto, type PasoFormulario } from "@/components/formularios/comun";

function Contenido() {
  const sp = useSearchParams();
  const id = sp.get("resultadoId") ?? "";
  const [v, setV] = useState<any>(null);
  const [cart, setCart] = useState<any[]>([]);
  const [prueba, setPrueba] = useState("escala");
  const [jueces, setJueces] = useState("12");
  const [muestras, setMuestras] = useState("1");
  const [motivo, setMotivo] = useState("");
  const [paso, setPaso] = useState("plan");
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const r = await llamar<any>("GET", `/formularios/resultado/${id}/sensorial`);
      setV(r);
      setCart(r.cartillas);
      setPrueba(r.prueba);
      if (r.plan) { setJueces(String(r.plan.jueces)); setMuestras(String(r.plan.muestras)); }
      setError("");
      return r;
    } catch (e: any) {
      setError(e.message);
      return null;
    }
  }, [id]);
  useEffect(() => { if (id) cargar().then((r) => r && setPaso(r.registro?.estado === "consolidada" ? "consolidacion" : r.plan ? "cartillas" : "plan")); }, [id, cargar]);

  if (!id) return <div className="alert warn">Abra el panel desde el ensayo en «Captura y revisión por OT».</div>;
  if (error) return <div className="alert warn">{error}</div>;
  if (!v) return <SkeletonCards n={2} />;
  const ed = v.puedeEditar;
  const consolidada = v.registro?.estado === "consolidada";
  const pasos: PasoFormulario[] = [
    { clave: "plan", titulo: "Plan de sesión", estado: v.plan ? "hecho" : "actual", detalle: v.plan ? `${v.plan.jueces} jueces · códigos ${v.plan.codigos.join(", ")}` : "Pendiente" },
    { clave: "cartillas", titulo: "Cartillas del panel", estado: cart.length && v.registro ? "hecho" : "pendiente", detalle: `${cart.filter((c) => !c.excluido).length} jueces válidos` },
    { clave: "consolidacion", titulo: "Consolidación", estado: consolidada ? "hecho" : "pendiente", detalle: consolidada ? "Consolidado" : `α = ${String(v.config.alfa).replace(".", ",")} · mín. ${v.config.juecesMin} jueces` },
  ];

  async function enviar(accion: string, extra: any = {}) {
    setOcupado(true);
    try {
      const r = await llamar<any>("PUT", `/formularios/resultado/${id}/sensorial`, { accion, prueba, atributos: v.atributos, cartillas: cart, motivo: motivo || undefined, ...extra });
      if (accion === "consolidar") {
        if (r.llevado?.ok) toast.ok("Panel consolidado: el valor pasó al ensayo.");
        else toast.error(r.llevado?.motivo ?? "No se pudo llevar el valor al ensayo.");
      } else toast.ok(accion === "plan" ? "Plan de sesión generado." : "Cartillas guardadas.");
      setMotivo("");
      const nv = await cargar();
      if (accion === "plan" && nv) setPaso("cartillas");
      if (accion === "consolidar") setPaso("consolidacion");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }
  const setC = (i: number, p: any) => setCart((a) => a.map((c, k) => (k === i ? { ...c, ...p } : c)));

  return (
    <div>
      <PageHeader
        titulo={`${v.ensayo.nombre} · ${v.ensayo.muestra}`}
        subtitulo={`OT ${v.ot.codigo} · Evaluación Sensorial · prueba ${prueba === "escala" ? "de escala" : prueba}`}
        migas={[{ label: "Captura y revisión por OT", href: `/captura-ot?otId=${v.ot.id}` }, { label: v.ot.codigo, href: `/ot/${v.ot.id}` }, { label: "Panel sensorial" }]}
      />
      <Pasos pasos={pasos} activo={paso} onElegir={setPaso} />
      <fieldset disabled={!ed} className="card" style={{ margin: "0 0 13px" }}>
        {paso === "plan" && (
          <>
            <h2>1 · Plan de sesión</h2>
            <div className="form-grid">
              <Campo id="pr" etiqueta="Prueba" req><select id="pr" value={prueba} onChange={(e) => setPrueba(e.target.value)}><option value="escala">Escala (aceptabilidad, categoría)</option><option value="triangular">Diferencia triangular (ISO 4120)</option><option value="coccion">Cocción de leguminosas</option></select></Campo>
              <Campo id="ju" etiqueta="Nº de jueces convocados" req><input id="ju" inputMode="numeric" value={jueces} onChange={(e) => setJueces(e.target.value)} /></Campo>
              <Campo id="mu" etiqueta="Muestras en la sesión" ayuda="La triangular presenta 3 (dos iguales y una distinta)."><input id="mu" inputMode="numeric" value={muestras} onChange={(e) => setMuestras(e.target.value)} /></Campo>
            </div>
            {v.plan && (
              <table className="data" style={{ marginTop: 10, maxWidth: 520 }}>
                <thead><tr><th>Juez</th><th>Orden de presentación</th></tr></thead>
                <tbody>{v.plan.orden.map((o: string[], i: number) => <tr key={i}><td>J{String(i + 1).padStart(2, "0")}</td><td className="codigo">{o.join(" · ")}</td></tr>)}</tbody>
              </table>
            )}
            {ed && <div className="toolbar" style={{ marginTop: 10, marginBottom: 0 }}><div className="spacer" /><button type="button" className="btn primary" disabled={ocupado} onClick={() => enviar("plan", { jueces: Number(jueces), muestras: Number(muestras) })}>Generar cartillas → sesión</button></div>}
          </>
        )}
        {paso === "cartillas" && (
          <>
            <h2>2 · Cartillas del panel</h2>
            {!cart.length ? <p className="subtitle">Genere primero el plan de sesión.</p> : (
              <table className="data">
                <thead><tr><th>Juez</th>{prueba === "escala" && v.atributos.map((a: string) => <th key={a} className="num">{a}</th>)}{prueba === "triangular" && <th>¿Identificó la distinta?</th>}{prueba === "coccion" && <th>Granos</th>}<th>Excluir (motivo)</th></tr></thead>
                <tbody>
                  {cart.map((c, i) => (
                    <tr key={c.juez} style={c.excluido ? { opacity: 0.55 } : undefined}>
                      <td>{c.juez}</td>
                      {prueba === "escala" && v.atributos.map((a: string) => <td key={a} className="num"><input aria-label={`${a} · ${c.juez}`} inputMode="decimal" style={{ width: 54, textAlign: "right" }} value={c.puntajes?.[a] ?? ""} onChange={(e) => setC(i, { puntajes: { ...(c.puntajes ?? {}), [a]: e.target.value === "" ? null : Number(e.target.value.replace(",", ".")) } })} /></td>)}
                      {prueba === "triangular" && <td><select aria-label={`Respuesta de ${c.juez}`} value={c.correcta == null ? "" : c.correcta ? "si" : "no"} onChange={(e) => setC(i, { correcta: e.target.value === "" ? null : e.target.value === "si" })}><option value="">—</option><option value="si">Sí (correcta)</option><option value="no">No</option></select></td>}
                      {prueba === "coccion" && <td><select aria-label={`Cocción · ${c.juez}`} value={c.coccion ?? ""} onChange={(e) => setC(i, { coccion: e.target.value || null })}><option value="">—</option><option value="blandas">Blandas</option><option value="duras">Duras</option></select></td>}
                      <td style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input type="checkbox" aria-label={`Excluir a ${c.juez}`} checked={!!c.excluido} onChange={(e) => setC(i, { excluido: e.target.checked })} style={{ width: "auto" }} />
                        {c.excluido && <input aria-label={`Motivo de exclusión de ${c.juez}`} value={c.motivoExclusion ?? ""} onChange={(e) => setC(i, { motivoExclusion: e.target.value })} placeholder="Motivo" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {ed && cart.length > 0 && <div className="toolbar" style={{ marginTop: 10, marginBottom: 0 }}><button type="button" className="btn outline" disabled={ocupado} onClick={() => enviar("cartillas")}>Guardar cartillas</button><div className="spacer" /><button type="button" className="btn primary" disabled={ocupado} onClick={() => enviar("consolidar")}>Consolidar → evaluación</button></div>}
          </>
        )}
        {paso === "consolidacion" && (
          <>
            <h2>3 · Consolidación del panel</h2>
            {v.consolidacion.atributos && (
              <table className="data">
                <thead><tr><th>Atributo</th><th className="num">Jueces</th><th className="num">Media</th><th className="num">Mediana</th><th className="num">DE</th><th>Atípicos sugeridos</th><th>Rango</th><th>Veredicto</th></tr></thead>
                <tbody>{v.consolidacion.atributos.map((a: any) => {
                  const r = v.config.rangos.find((x: any) => x.atributo.toLowerCase() === a.atributo.toLowerCase());
                  const ver = a.media == null ? "pendiente" : !r ? "informativo" : a.media >= r.min && a.media <= r.max ? "cumple" : "no_cumple";
                  return <tr key={a.atributo}><td>{a.atributo}</td><td className="num">{a.n}</td><td className="num">{conComa(a.media)}</td><td className="num">{conComa(a.mediana)}</td><td className="num">{conComa(a.de)}</td><td>{a.atipicos.join(", ") || "—"}</td><td>{r ? `${conComa(r.min)}–${conComa(r.max)}` : "—"}</td><td><Veredicto v={ver} /></td></tr>;
                })}</tbody>
              </table>
            )}
            {v.consolidacion.triangular && <p style={{ fontSize: 13 }}>{v.consolidacion.triangular.conclusion || "Registre las respuestas de los jueces."}{v.consolidacion.triangular.p != null ? <small style={{ color: "var(--muted)" }}> · P(X ≥ {v.consolidacion.triangular.correctas}) = {conComa(v.consolidacion.triangular.p, 4)}</small> : null}</p>}
            {consolidada && ed && <div style={{ maxWidth: 520 }}><Campo id="mo" etiqueta="Motivo para corregir el panel consolidado"><input id="mo" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} /></Campo></div>}
            <p className="subtitle">Estado del ensayo: <b>{v.ensayo.estado}</b> · <Link href={`/captura-ot?otId=${v.ot.id}` as any}>ver en la captura</Link></p>
          </>
        )}
      </fieldset>
      <Bitacora eventos={v.eventos} />
    </div>
  );
}

export default function SensorialPage() {
  return (
    <Suspense fallback={<SkeletonCards n={2} />}>
      <Contenido />
    </Suspense>
  );
}
