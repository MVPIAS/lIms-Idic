"use client";

/**
 * Paso 6 de la D11 · ensayos por arma (EP-11 11.13–11.20) SIN VALORES POR
 * DEFECTO (BL-038): cada fila de la inspección antes y después del disparo se
 * marca 0 (sin defecto) o 1 (defecto); nada viene marcado y el botón no se
 * habilita hasta que el grupo está completo. La tensión del disparador es un
 * valor medido y la evidencia balística, el identificador IBIS. Al lado, la
 * cadena de custodia del arma (11.7) con el cambio de ubicación.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "@/components/ui/feedback";
import { fechaHora } from "@/lib/format";
import { EVENTO_CUSTODIA, PILL_ETAPA, pedir, type EnsayoFicha, type ExpedienteD11, type FichaArma } from "@/lib/d11";

type Valor = { valor?: string; atributo?: "cumple" | "no_cumple" };

export default function EnsayosArma({ d, onCambio }: { d: ExpedienteD11; onCambio: () => void }) {
  const conEnsayos = d.armas.filter((a) => a.clase && a.ensayos > 0);
  const [armaId, setArmaId] = useState<string>(() => (conEnsayos.find((a) => a.pendientes > 0) ?? conEnsayos[0])?.id ?? "");
  const [f, setF] = useState<FichaArma | null>(null);
  const [vals, setVals] = useState<Record<string, Valor>>({});
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [mov, setMov] = useState({ ubicacion: "", motivo: "" });
  const [lotes, setLotes] = useState<{ id: string; lote: string; calibre: string; saldo: number; activo: boolean }[]>([]);
  const [mun, setMun] = useState({ loteId: "", cartuchos: "" });
  const puede = d.puedo.registrar && d.ot.abierta;

  const cargar = useCallback(async () => {
    if (!armaId) return;
    try {
      setF(await pedir<FichaArma>("GET", `/d11/armas/${armaId}`));
      setVals({});
    } catch (e: any) {
      toast.error(e.message);
    }
  }, [armaId]);
  useEffect(() => {
    cargar();
  }, [cargar]);
  useEffect(() => {
    if (f?.fuego?.requiere) pedir<any[]>("GET", "/d11/municion/lotes").then((l) => setLotes(l.filter((x) => x.activo && x.saldo > 0))).catch(() => setLotes([]));
  }, [f?.fuego?.requiere]);

  const grupos = useMemo(() => {
    const m = new Map<string, EnsayoFicha[]>();
    for (const e of f?.ensayos ?? []) m.set(e.grupo, [...(m.get(e.grupo) ?? []), e]);
    return [...m.entries()];
  }, [f]);

  if (!conEnsayos.length) return <div className="alert info">Primero clasifique las armas y elija su camino (paso 5): ahí se cargan sus ensayos.</div>;

  const tocado = (e: EnsayoFicha) => {
    const v = vals[e.resultadoId];
    return v && ((e.entrada === "atributo" && v.atributo) || (v.valor ?? "").trim() !== "");
  };
  // Un grupo tocado debe completarse entero (mismo criterio que el servidor).
  const gruposTocados = grupos.filter(([, es]) => es.some(tocado));
  const incompletos = gruposTocados.filter(([, es]) => es.some((e) => e.estado === "pendiente" && !tocado(e)));
  const corrige = gruposTocados.some(([, es]) => es.some((e) => tocado(e) && e.estado !== "pendiente"));
  const enviables = gruposTocados.flatMap(([, es]) => es.filter(tocado));
  // 11.17 · la primera captura de la prueba de fuego exige lote y cartuchos usados (se descuentan del inventario).
  const fuegoNuevo = enviables.some((e) => e.estado === "pendiente" && (f?.fuego?.metodos ?? []).includes(e.metodoCodigo ?? ""));
  const municionLista = !fuegoNuevo || (!!mun.loteId && Number.isInteger(Number(mun.cartuchos)) && Number(mun.cartuchos) > 0);
  const listo = enviables.length > 0 && incompletos.length === 0 && (!corrige || motivo.trim().length >= 5) && municionLista;

  async function registrar() {
    setOcupado(true);
    try {
      const r = await pedir<any>("POST", `/d11/armas/${armaId}/ensayos`, {
        valores: enviables.map((e) => ({ resultadoId: e.resultadoId, valor: vals[e.resultadoId].valor ?? null, atributo: vals[e.resultadoId].atributo ?? null })),
        motivo: motivo.trim() || null,
        municion: fuegoNuevo ? { loteId: mun.loteId, cartuchos: Number(mun.cartuchos) } : null,
      });
      setMun({ loteId: "", cartuchos: "" });
      setF(r.ficha);
      setVals({});
      setMotivo("");
      toast.ok(`${r.capturados} ensayo(s) registrados. Cuando termine el arma, pasa a revisión y aprobación.`);
      onCambio();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }

  async function moverArma() {
    try {
      const r = await pedir<FichaArma>("POST", `/d11/armas/${armaId}/movimientos`, { evento: "cambio_ubicacion", ...mov });
      setF(r);
      setMov({ ubicacion: "", motivo: "" });
      toast.ok("Cambio de ubicación registrado en la cadena de custodia.");
      onCambio();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  const control = (e: EnsayoFicha) => {
    const v = vals[e.resultadoId] ?? {};
    const yaTiene = e.estado !== "pendiente";
    const bloqueado = !puede || ["revisado_n1", "aprobado"].includes(e.estado);
    if (bloqueado || (yaTiene && !vals[e.resultadoId]))
      return (
        <span>
          {e.valor ?? "—"}{e.unidad && e.entrada === "valor" ? ` ${e.unidad}` : ""}
          {yaTiene && !bloqueado && (
            <button type="button" className="btn ghost sm" style={{ marginLeft: 6 }} onClick={() => setVals((s) => ({ ...s, [e.resultadoId]: {} }))}>Corregir</button>
          )}
        </span>
      );
    if (e.entrada === "defecto")
      return (
        <fieldset style={{ border: 0, margin: 0, padding: 0, whiteSpace: "nowrap" }} aria-label={e.analito}>
          <label style={{ marginRight: 10 }}><input type="radio" name={`r-${e.resultadoId}`} checked={v.valor === "0"} onChange={() => setVals((s) => ({ ...s, [e.resultadoId]: { valor: "0" } }))} /> 0 · sin defecto</label>
          <label><input type="radio" name={`r-${e.resultadoId}`} checked={v.valor === "1"} onChange={() => setVals((s) => ({ ...s, [e.resultadoId]: { valor: "1" } }))} /> 1 · defecto</label>
        </fieldset>
      );
    if (e.entrada === "atributo")
      return (
        <fieldset style={{ border: 0, margin: 0, padding: 0, whiteSpace: "nowrap" }} aria-label={e.analito}>
          <label style={{ marginRight: 10 }}><input type="radio" name={`r-${e.resultadoId}`} checked={v.atributo === "cumple"} onChange={() => setVals((s) => ({ ...s, [e.resultadoId]: { atributo: "cumple" } }))} /> Cumple</label>
          <label><input type="radio" name={`r-${e.resultadoId}`} checked={v.atributo === "no_cumple"} onChange={() => setVals((s) => ({ ...s, [e.resultadoId]: { atributo: "no_cumple" } }))} /> No cumple</label>
        </fieldset>
      );
    return (
      <input
        aria-label={e.analito}
        inputMode={e.entrada === "valor" ? "decimal" : undefined}
        placeholder={e.entrada === "valor" ? `Valor medido${e.unidad ? ` (${e.unidad})` : ""}` : "Identificador IBIS (ExhibitNumber)"}
        value={v.valor ?? ""}
        onChange={(x) => setVals((s) => ({ ...s, [e.resultadoId]: { valor: x.target.value } }))}
        style={{ width: 220 }}
      />
    );
  };

  return (
    <>
      <div className="card">
        <h2>6 · Ensayos por arma <span className="right">Armero · sin valores por defecto (BL-038)</span></h2>
        <div className="toolbar" style={{ marginTop: 0 }}>
          <label htmlFor="en-arma" style={{ fontSize: 12, fontWeight: 600 }}>Arma</label>
          <select id="en-arma" value={armaId} onChange={(e) => setArmaId(e.target.value)} style={{ minWidth: 340 }}>
            {conEnsayos.map((a) => (
              <option key={a.id} value={a.id}>
                {a.muestra} · {a.tipoNombre} {a.marca} {a.modelo} · {a.serie ?? "sin serie"} · {a.pendientes ? `${a.pendientes} por capturar` : "capturada"}
              </option>
            ))}
          </select>
          {f && <span className={`pill ${PILL_ETAPA[f.etapa] ?? "gray"}`}>{f.etapaNombre}</span>}
          {f?.caminoNombre && <span className="pill blue">{f.caminoNombre}</span>}
        </div>
        <p className="subtitle">
          Marque cada fila: <b>0 = sin defecto</b>, <b>1 = defecto</b>. Ninguna viene marcada. La tensión del disparador se anota como valor medido
          (su rango lo fija la jefatura en la especificación de la orden mientras el IDIC no lo confirme) y la evidencia balística, con el identificador IBIS.
        </p>
        {!f ? (
          <p className="subtitle">Cargando…</p>
        ) : (
          grupos.map(([g, es]) => (
            <fieldset key={g} style={{ border: "1px solid var(--line)", borderRadius: 7, padding: "6px 10px 10px", marginBottom: 10 }}>
              <legend style={{ fontSize: 12, fontWeight: 700, padding: "0 4px" }}>
                {es[0].grupoNombre ?? es[0].metodoNombre} {es[0].norma ? <small style={{ color: "var(--muted)", fontWeight: 400 }}>· {es[0].norma}</small> : null}
                {incompletos.some(([x]) => x === g) && <span className="pill amber" style={{ marginLeft: 6 }}>faltan filas</span>}
              </legend>
              <table className="data">
                <thead><tr><th style={{ width: "40%" }}>Ensayo</th><th>Registro</th><th>Estado</th><th>Veredicto</th></tr></thead>
                <tbody>
                  {es.map((e) => (
                    <tr key={e.resultadoId}>
                      <td>{e.analito.replace(/^(AD|DD)\s*-\s*/i, "")}</td>
                      <td>{control(e)}</td>
                      <td>{e.estado}</td>
                      <td>{e.veredicto ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </fieldset>
          ))
        )}
        {puede && f && (
          <>
            {fuegoNuevo && (
              <fieldset className="card" style={{ border: "1px solid var(--line)", padding: "8px 12px", marginBottom: 10 }}>
                <legend style={{ fontSize: 12, fontWeight: 700 }}>Prueba de fuego (IT04) · munición de prueba usada</legend>
                <div className="form-grid">
                  <div className="field">
                    <label htmlFor="en-lote">Lote de munición <span className="req">*</span></label>
                    <select id="en-lote" value={mun.loteId} onChange={(e) => setMun({ ...mun, loteId: e.target.value })}>
                      <option value="">Elija…</option>
                      {lotes.map((l) => <option key={l.id} value={l.id}>{l.lote} · {l.calibre} ({l.saldo} disponibles)</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="en-cart">Cartuchos usados <span className="req">*</span></label>
                    <input id="en-cart" inputMode="numeric" value={mun.cartuchos} onChange={(e) => setMun({ ...mun, cartuchos: e.target.value })} />
                  </div>
                </div>
                {!lotes.length && <small style={{ color: "var(--red)" }}>No hay lotes con saldo: dé de alta la munición en SAEC › Munición de prueba.</small>}
              </fieldset>
            )}
            {(f.fuego?.usos ?? []).length > 0 && (
              <p className="subtitle">Munición ya descontada: {f.fuego.usos.map((u) => `${u.cantidad} cartucho(s) del lote ${u.lote}`).join("; ")}.</p>
            )}
            {corrige && (
              <div className="field" style={{ maxWidth: 520 }}>
                <label htmlFor="en-motivo">Motivo de la corrección <span className="req">*</span></label>
                <input id="en-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={1000} />
              </div>
            )}
            <div className="toolbar">
              <button type="button" className="btn primary" disabled={!listo || ocupado} onClick={registrar}>{ocupado ? "Registrando…" : "Registrar ensayos → revisión"}</button>
              {incompletos.length > 0 && <small style={{ color: "var(--red)" }}>Complete todas las filas de {incompletos.map(([, es]) => es[0].grupoNombre ?? es[0].metodoNombre).join(", ")}.</small>}
              <span className="spacer" />
              <Link href={`/captura-ot?otId=${d.ot.id}` as any} className="btn outline sm">Captura y revisión por OT</Link>
            </div>
          </>
        )}
      </div>

      {f && (
        <div className="card">
          <h2>Cadena de custodia · {f.muestra} <span className="right">EP-11 11.7 · movimientos inmutables</span></h2>
          <table className="data">
            <thead><tr><th>Fecha</th><th>Movimiento</th><th>Ubicación</th><th>Responsable</th><th>Motivo</th></tr></thead>
            <tbody>
              {f.movimientos.map((m) => (
                <tr key={m.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{fechaHora(m.fecha)}</td>
                  <td>{EVENTO_CUSTODIA[m.evento] ?? m.evento}{m.entrega ? ` · ${m.entrega}` : ""}</td>
                  <td>{m.ubicacion ?? (m.receptor ? `Entregada a ${m.receptor}` : "—")}</td>
                  <td>{m.responsable ?? "—"}</td>
                  <td>{m.motivo}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {puede && f.etapa !== "entregada" && (
            <div className="toolbar">
              <label className="sr-only" htmlFor="mv-ub">Nueva ubicación</label>
              <input id="mv-ub" placeholder="Nueva ubicación" value={mov.ubicacion} onChange={(e) => setMov({ ...mov, ubicacion: e.target.value })} maxLength={160} />
              <label className="sr-only" htmlFor="mv-mo">Motivo</label>
              <input id="mv-mo" placeholder="Motivo del cambio" value={mov.motivo} onChange={(e) => setMov({ ...mov, motivo: e.target.value })} maxLength={300} style={{ minWidth: 240 }} />
              <button type="button" className="btn outline sm" disabled={mov.ubicacion.trim().length < 2 || mov.motivo.trim().length < 5} onClick={moverArma}>Registrar movimiento</button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
