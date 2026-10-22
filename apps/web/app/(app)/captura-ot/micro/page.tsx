"use client";

/**
 * LMB · Siembra, incubación y lectura (EP-02 3.3–3.5) · variante que se activa
 * por método en Parámetros de la operación (inactiva hasta EP-02 P1).
 *
 *   1 Siembra: fecha y hora, medio y lote, diluciones, volumen, técnica.
 *   2 Incubación: incubadora (equipo apto), temperatura, inicio → lecturas
 *     programadas (24/48/72 h, configurable) con aviso de pendiente y vencida.
 *   3 Lecturas: colonias por placa y dilución, NMP o presencia/ausencia.
 *   4 Resultado: UFC/g (ISO 7218), plan n, c, m, M si está configurado.
 *     «Confirmar → evaluación» lleva el valor y el veredicto al ensayo.
 *
 * API: GET|PUT /formularios/resultado/:resultadoId/micro
 */
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { PageHeader, SkeletonCards } from "@/components/ui/PageHeader";
import { toast } from "@/components/ui/feedback";
import { llamar } from "@/lib/laboratorio";
import { fechaHora } from "@/lib/format";
import { Bitacora, Campo, Pasos, type PasoFormulario } from "@/components/formularios/comun";

const local = (iso: string | null | undefined) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
const iso = (l: string) => (l ? new Date(l).toISOString() : null);

function Contenido() {
  const sp = useSearchParams();
  const otId = sp.get("otId") ?? "";
  const id = sp.get("resultadoId") ?? "";
  const [v, setV] = useState<any>(null);
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState("");
  const [paso, setPaso] = useState("siembra");
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const r = await llamar<any>("GET", `/formularios/resultado/${id}/micro`);
      setV(r);
      setD(JSON.parse(JSON.stringify(r.datos)));
      setError("");
      return r;
    } catch (e: any) {
      setError(e.message);
      return null;
    }
  }, [id]);
  useEffect(() => {
    if (!id) return;
    cargar().then((r) => r && setPaso(r.registro?.estado === "confirmada" ? "resultado" : r.datos.lecturas?.length ? "lecturas" : r.datos.incubacion?.inicio ? "lecturas" : r.datos.siembra?.fecha ? "incubacion" : "siembra"));
  }, [id, cargar]);

  if (!id) return <div className="alert warn">Abra el formulario desde el ensayo en «Captura y revisión por OT».</div>;
  if (error) return <div className="alert warn">{error}</div>;
  if (!v || !d) return <SkeletonCards n={2} />;
  const ed = v.puedeEditar;
  const confirmada = v.registro?.estado === "confirmada";
  const pasos: PasoFormulario[] = [
    { clave: "siembra", titulo: "Siembra", estado: d.siembra?.fecha ? "hecho" : "actual", detalle: d.siembra?.fecha ? fechaHora(d.siembra.fecha) : "Pendiente" },
    { clave: "incubacion", titulo: "Incubación", estado: d.incubacion?.inicio ? "hecho" : "pendiente", detalle: d.incubacion?.inicio ? `desde ${fechaHora(d.incubacion.inicio)}` : "Pendiente" },
    { clave: "lecturas", titulo: "Lecturas", estado: v.programadas.length && v.programadas.every((p: any) => p.estado === "registrada") ? "hecho" : "pendiente", detalle: `${v.programadas.filter((p: any) => p.estado === "registrada").length}/${v.programadas.length || v.horas.length} lecturas` },
    { clave: "resultado", titulo: "Resultado", estado: confirmada ? "hecho" : "pendiente", detalle: v.calculo.texto || "Por calcular" },
  ];

  async function guardar(confirmar: boolean) {
    setOcupado(true);
    try {
      const r = await llamar<any>("PUT", `/formularios/resultado/${id}/micro`, { ...d, confirmar, motivo: motivo || undefined });
      if (confirmar) {
        if (r.llevado?.ok) toast.ok(`Resultado ${r.calculo.texto} llevado al ensayo.`);
        else toast.error(r.llevado?.motivo ?? "No se pudo llevar el resultado al ensayo.");
      } else toast.ok("Determinación guardada.");
      setMotivo("");
      await cargar();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }
  const lect = (h: number) => d.lecturas.find((l: any) => l.horas === h) ?? null;
  const setLect = (h: number, p: any) =>
    setD((x: any) => ({ ...x, lecturas: [...x.lecturas.filter((l: any) => l.horas !== h), { horas: h, colonias: {}, ...(x.lecturas.find((l: any) => l.horas === h) ?? {}), ...p }].sort((a: any, b: any) => a.horas - b.horas) }));

  return (
    <div>
      <PageHeader
        titulo={`${v.ensayo.nombre} · ${v.ensayo.muestra}`}
        subtitulo={`OT ${v.ot.codigo} · Microbiología de Alimentos · ${d.tipo === "recuento" ? "recuento en placa (ISO 7218)" : d.tipo === "nmp" ? "NMP por tabla" : "presencia / ausencia"}${v.plan ? ` · plan RSA n=${v.plan.n}, c=${v.plan.c}, m=${v.plan.m}${v.plan.M != null ? `, M=${v.plan.M}` : ""}` : v.ensayo.maximo ? ` · Máx ${v.ensayo.maximo}` : ""}`}
        migas={[{ label: "Captura y revisión por OT", href: `/captura-ot?otId=${otId || v.ot.id}` }, { label: v.ot.codigo, href: `/ot/${v.ot.id}` }, { label: "Microbiología" }]}
        acciones={<span className={`pill ${confirmada ? "green" : "gray"}`}>{v.registro?.estado ?? "Sin registro"}</span>}
      />
      <Pasos pasos={pasos} activo={paso} onElegir={setPaso} />
      <fieldset disabled={!ed} className="card" style={{ margin: "0 0 13px" }}>
        {paso === "siembra" && (
          <>
            <h2>1 · Siembra o enriquecimiento</h2>
            <div className="form-grid">
              <Campo id="tp" etiqueta="Tipo de determinación" req>
                <select id="tp" value={d.tipo} onChange={(e) => setD({ ...d, tipo: e.target.value })}><option value="recuento">Recuento en placa</option><option value="nmp">NMP (tubos)</option><option value="presencia">Presencia / ausencia</option></select>
              </Campo>
              <Campo id="fs" etiqueta="Fecha y hora de siembra" req><input id="fs" type="datetime-local" value={local(d.siembra.fecha)} onChange={(e) => setD({ ...d, siembra: { ...d.siembra, fecha: iso(e.target.value) } })} /></Campo>
              <Campo id="md" etiqueta="Medio de cultivo"><input id="md" value={d.siembra.medio ?? ""} onChange={(e) => setD({ ...d, siembra: { ...d.siembra, medio: e.target.value } })} /></Campo>
              <Campo id="lm" etiqueta="Lote del medio"><input id="lm" value={d.siembra.loteMedio ?? ""} onChange={(e) => setD({ ...d, siembra: { ...d.siembra, loteMedio: e.target.value } })} /></Campo>
              <Campo id="dl" etiqueta="Diluciones (10⁻ⁿ)" ayuda="Exponentes separados por coma: 1, 2, 3"><input id="dl" value={(d.siembra.diluciones ?? []).join(", ")} onChange={(e) => setD({ ...d, siembra: { ...d.siembra, diluciones: e.target.value.split(",").map((x) => Number(x.trim())).filter((x) => Number.isInteger(x)) } })} /></Campo>
              <Campo id="vs" etiqueta="Volumen sembrado (mL)"><input id="vs" inputMode="decimal" value={d.siembra.volumenMl ?? ""} onChange={(e) => setD({ ...d, siembra: { ...d.siembra, volumenMl: e.target.value } })} /></Campo>
              {d.tipo === "presencia" && <Campo id="ca" etiqueta="Cantidad analizada"><input id="ca" value={d.cantidadAnalizada ?? "25 g"} onChange={(e) => setD({ ...d, cantidadAnalizada: e.target.value })} /></Campo>}
            </div>
            {ed && <div className="toolbar" style={{ marginTop: 10, marginBottom: 0 }}><div className="spacer" /><button type="button" className="btn primary" disabled={ocupado} onClick={async () => { await guardar(false); setPaso("incubacion"); }}>Registrar siembra → incubación</button></div>}
          </>
        )}
        {paso === "incubacion" && (
          <>
            <h2>2 · Incubación y lecturas programadas</h2>
            <div className="form-grid">
              <Campo id="eq" etiqueta="Incubadora">
                <select id="eq" value={d.incubacion.equipoId ?? ""} onChange={(e) => setD({ ...d, incubacion: { ...d.incubacion, equipoId: e.target.value || null } })}>
                  <option value="">—</option>
                  {v.equipos.map((e: any) => <option key={e.id} value={e.id} disabled={!e.apto}>{e.codigo} · {e.nombre}{e.apto ? "" : ` (${e.motivo})`}</option>)}
                </select>
              </Campo>
              <Campo id="ti" etiqueta="Temperatura (°C)"><input id="ti" inputMode="decimal" value={d.incubacion.temperatura ?? ""} onChange={(e) => setD({ ...d, incubacion: { ...d.incubacion, temperatura: e.target.value } })} /></Campo>
              <Campo id="ii" etiqueta="Inicio de la incubación" req><input id="ii" type="datetime-local" value={local(d.incubacion.inicio)} onChange={(e) => setD({ ...d, incubacion: { ...d.incubacion, inicio: iso(e.target.value) } })} /></Campo>
            </div>
            {v.programadas.length > 0 && (
              <div style={{ overflowX: "auto", maxWidth: "100%" }}><table className="data" style={{ marginTop: 10, maxWidth: 560 }}>
                <thead><tr><th>Lectura</th><th>Programada</th><th>Estado</th></tr></thead>
                <tbody>{v.programadas.map((p: any) => <tr key={p.horas}><td>{p.horas} h</td><td>{fechaHora(p.programada)}</td><td><span className={`pill ${p.estado === "registrada" ? "green" : p.estado === "vencida" ? "red" : "amber"}`}>{p.estado === "registrada" ? "Registrada" : p.estado === "vencida" ? "Vencida" : "Pendiente"}</span></td></tr>)}</tbody>
              </table></div>
            )}
            {ed && <div className="toolbar" style={{ marginTop: 10, marginBottom: 0 }}><div className="spacer" /><button type="button" className="btn primary" disabled={ocupado || !d.incubacion.inicio} onClick={async () => { await guardar(false); setPaso("lecturas"); }}>Iniciar incubación → lecturas</button></div>}
          </>
        )}
        {paso === "lecturas" && (
          <>
            <h2>3 · Lecturas</h2>
            {v.horas.map((h: number) => {
              const l = lect(h);
              const prog = v.programadas.find((p: any) => p.horas === h);
              return (
                <div key={h} style={{ borderTop: "1px solid var(--line)", padding: "8px 0" }}>
                  <b style={{ fontSize: 12.5 }}>Lectura {h} h</b>{prog && <span className={`pill ${prog.estado === "registrada" ? "green" : prog.estado === "vencida" ? "red" : "amber"}`} style={{ marginLeft: 6 }}>{prog.estado}</span>}
                  <div className="form-grid cols-4" style={{ marginTop: 6 }}>
                    <Campo id={`r${h}`} etiqueta="Fecha y hora de la lectura"><input id={`r${h}`} type="datetime-local" value={local(l?.realizada)} onChange={(e) => setLect(h, { realizada: iso(e.target.value) })} /></Campo>
                    {d.tipo === "recuento" && (d.siembra.diluciones ?? []).map((dl: number) => (
                      <Campo key={dl} id={`c${h}-${dl}`} etiqueta={`Colonias 10⁻${dl} (placas)`} ayuda="Separadas por coma"><input id={`c${h}-${dl}`} value={(l?.colonias?.[dl] ?? []).join(", ")} onChange={(e) => setLect(h, { colonias: { ...(l?.colonias ?? {}), [dl]: e.target.value.split(",").map((x) => x.trim()).filter(Boolean).map(Number) } })} /></Campo>
                    ))}
                    {d.tipo === "nmp" && <>
                      <Campo id={`cb${h}`} etiqueta="Tubos positivos (combinación)"><input id={`cb${h}`} value={l?.combinacion ?? ""} onChange={(e) => setLect(h, { combinacion: e.target.value })} placeholder="3-1-0" /></Campo>
                      <Campo id={`nm${h}`} etiqueta="NMP de la tabla"><input id={`nm${h}`} inputMode="decimal" value={l?.nmp ?? ""} onChange={(e) => setLect(h, { nmp: e.target.value === "" ? null : Number(e.target.value.replace(",", ".")) })} /></Campo>
                    </>}
                    {d.tipo === "presencia" && (
                      <Campo id={`pa${h}`} etiqueta="Resultado"><select id={`pa${h}`} value={l?.presencia ?? ""} onChange={(e) => setLect(h, { presencia: e.target.value || null })}><option value="">—</option><option value="ausencia">Ausencia</option><option value="presencia">Presencia</option></select></Campo>
                    )}
                  </div>
                </div>
              );
            })}
            {ed && <div className="toolbar" style={{ marginTop: 10, marginBottom: 0 }}><div className="spacer" /><button type="button" className="btn primary" disabled={ocupado} onClick={async () => { await guardar(false); setPaso("resultado"); }}>Registrar lectura → resultado</button></div>}
          </>
        )}
        {paso === "resultado" && (
          <>
            <h2>4 · Resultado y evaluación</h2>
            <p style={{ fontSize: 14 }}><span className="res">{v.calculo.texto || "—"}</span> {v.calculo.formula ? <small style={{ color: "var(--muted)" }}>{v.calculo.formula}</small> : null}</p>
            {v.calculo.errores?.length ? <div className="alert warn">{v.calculo.errores.join(" ")}</div> : null}
            {v.plan ? (
              <Campo id="un" etiqueta={`Resultados de las n = ${v.plan.n} unidades (separados por coma)`} ayuda={`Plan ${v.plan.M != null ? "de 3 clases" : "de 2 clases"}: no cumple si alguna supera M o más de c = ${v.plan.c} quedan entre m y M.`}>
                <input id="un" value={(d.unidades ?? []).join(", ")} onChange={(e) => setD({ ...d, unidades: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
              </Campo>
            ) : <p className="subtitle">Sin plan n, c, m, M configurado para este ensayo: se compara con el Máx del ensayo ({v.ensayo.maximo ?? "sin Máx"}), como «según RSA vigente».</p>}
            {confirmada && ed && <div style={{ maxWidth: 520 }}><Campo id="mo" etiqueta="Motivo de la corrección" req><input id="mo" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} /></Campo></div>}
            <p style={{ fontSize: 12.5 }}>Estado del ensayo: <b>{v.ensayo.estado}</b> · <Link href={`/captura-ot?otId=${v.ot.id}` as any}>ver en la captura</Link></p>
            {ed && <div className="toolbar" style={{ marginBottom: 0 }}><div className="spacer" /><button type="button" className="btn primary" disabled={ocupado} onClick={() => guardar(true)}>Confirmar → evaluación</button></div>}
          </>
        )}
      </fieldset>
      <Bitacora eventos={v.eventos} />
    </div>
  );
}

export default function MicroPage() {
  return (
    <Suspense fallback={<SkeletonCards n={2} />}>
      <Contenido />
    </Suspense>
  );
}
