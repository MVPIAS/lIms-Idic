"use client";

/**
 * Paso 5 de la D11 · clasificación del elemento (DTCG-PG03-IT05: clase y
 * permisibilidad) y «Camino del arma» (11.12): con cuño CIP (reconocimiento) o
 * sin cuño CIP (prueba completa). El camino carga los ensayos de su panel
 * (Parámetros de la operación, categoría d11). Accesorio y máquina recargadora
 * van directo al certificado; la prohibida no sigue (informe a DGMN, 11.24).
 */
import { useState } from "react";
import { CLASES, PILL_ETAPA, type Accion, type ExpedienteD11 } from "@/lib/d11";

type Sel = { clase: string; permisibilidad: string; camino: string };

export default function Clasificacion({ d, accion }: { d: ExpedienteD11; accion: Accion }) {
  const [sel, setSel] = useState<Record<string, Sel>>({});
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [lote, setLote] = useState<Sel>({ clase: "", permisibilidad: "", camino: "" });
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const puede = d.puedo.registrar && d.ot.abierta;
  if (!d.armas.length) return <div className="alert info">Primero registre las armas (paso 4).</div>;

  const pendientes = d.armas.filter((a) => !a.clase);
  const valor = (id: string): Sel => sel[id] ?? { clase: "", permisibilidad: "", camino: "" };
  const cambiar = (id: string, c: Partial<Sel>) =>
    setSel((s) => {
      const v = { ...valor(id), ...c };
      if (v.clase !== "arma" || v.permisibilidad !== "permitida") v.camino = "";
      return { ...s, [id]: v };
    });
  const completa = (v: Sel) => v.clase && v.permisibilidad && (v.clase !== "arma" || v.permisibilidad !== "permitida" || v.camino);
  const elegidas = Object.entries(sel).filter(([, v]) => v.clase || v.permisibilidad);
  const reclasifica = elegidas.some(([id]) => d.armas.find((a) => a.id === id)?.clase);
  const listo = elegidas.length > 0 && elegidas.every(([, v]) => completa(v)) && (!reclasifica || motivo.trim().length >= 5);

  function aplicarATodas() {
    setSel((s) => {
      const n = { ...s };
      for (const id of marcadas) n[id] = { ...lote, camino: lote.clase === "arma" && lote.permisibilidad === "permitida" ? lote.camino : "" };
      return n;
    });
  }

  async function enviar() {
    setOcupado(true);
    const r = await accion(
      "POST",
      `/d11/ot/${d.ot.id}/clasificacion`,
      {
        items: elegidas.map(([armaOtId, v]) => ({ armaOtId, clase: v.clase, permisibilidad: v.permisibilidad, camino: v.camino || null })),
        motivo: motivo.trim() || null,
      },
      `${elegidas.length} arma(s) clasificadas. Siguiente paso: ensayos por arma.`,
    );
    if (r) {
      setSel({});
      setMarcadas(new Set());
      setMotivo("");
    }
    setOcupado(false);
  }

  return (
    <div className="card">
      <h2>5 · Clasificación (IT05) y camino del arma <span className="right">Armero · EP-11 11.11 · 11.12</span></h2>
      <p className="subtitle">
        {pendientes.length ? `${pendientes.length} arma(s) por clasificar.` : "Todas las armas están clasificadas."} El camino carga los ensayos:
        <b> con cuño CIP</b> = reconocimiento del cuño y huella; <b>sin cuño CIP</b> = prueba completa con fuego real y acuñación BPCH.
        {d.config.acunacionCip ? " Por configuración, las armas con cuño CIP también se acuñan." : ""}
      </p>
      {puede && (
        <div className="toolbar" style={{ background: "#f6f9fb", border: "1px solid var(--line)", borderRadius: 7, padding: 8 }}>
          <b style={{ fontSize: 12 }}>A las marcadas ({marcadas.size}):</b>
          <select aria-label="Clase para las marcadas" value={lote.clase} onChange={(e) => setLote({ ...lote, clase: e.target.value })}>
            <option value="">Clase…</option>
            {CLASES.map((c) => <option key={c.valor} value={c.valor}>{c.texto}</option>)}
          </select>
          <select aria-label="Permisibilidad para las marcadas" value={lote.permisibilidad} onChange={(e) => setLote({ ...lote, permisibilidad: e.target.value })}>
            <option value="">Permisibilidad…</option>
            <option value="permitida">Permitida</option>
            <option value="prohibida">Prohibida</option>
          </select>
          <select aria-label="Camino para las marcadas" value={lote.camino} disabled={lote.clase !== "arma" || lote.permisibilidad !== "permitida"} onChange={(e) => setLote({ ...lote, camino: e.target.value })}>
            <option value="">Camino…</option>
            <option value="cip">Con cuño CIP · reconocimiento</option>
            <option value="completa">Sin cuño CIP · prueba completa</option>
          </select>
          <button type="button" className="btn outline sm" disabled={!marcadas.size || !lote.clase || !lote.permisibilidad} onClick={aplicarATodas}>Aplicar</button>
        </div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table className="data">
          <thead>
            <tr>
              {puede && <th><span className="sr-only">Marcar</span></th>}
              <th>Muestra</th><th>Arma</th><th>Serie</th><th>Clase</th><th>Permisibilidad</th><th>Camino</th><th>Ensayos</th><th>Etapa</th>
            </tr>
          </thead>
          <tbody>
            {d.armas.map((a) => {
              const v = valor(a.id);
              const editable = puede && (!a.clase || a.pendientes === a.ensayos - 1 || a.pendientes === a.ensayos);
              return (
                <tr key={a.id}>
                  {puede && (
                    <td>
                      <input type="checkbox" aria-label={`Marcar ${a.muestra}`} disabled={!editable} checked={marcadas.has(a.id)}
                        onChange={(e) => setMarcadas((m) => { const n = new Set(m); e.target.checked ? n.add(a.id) : n.delete(a.id); return n; })} />
                    </td>
                  )}
                  <td className="codigo" style={{ whiteSpace: "nowrap" }}>{a.muestra}</td>
                  <td>{a.tipoNombre} {a.marca} {a.modelo}</td>
                  <td>{a.serie ?? "sin serie"}</td>
                  <td>
                    {editable ? (
                      <select aria-label={`Clase de ${a.muestra}`} value={v.clase} onChange={(e) => cambiar(a.id, { clase: e.target.value })}>
                        <option value="">{a.claseNombre ?? "Elija…"}</option>
                        {CLASES.map((c) => <option key={c.valor} value={c.valor}>{c.texto}</option>)}
                      </select>
                    ) : a.claseNombre ?? "—"}
                  </td>
                  <td>
                    {editable ? (
                      <fieldset style={{ border: 0, margin: 0, padding: 0, whiteSpace: "nowrap" }} aria-label={`Permisibilidad de ${a.muestra}`}>
                        <label style={{ marginRight: 8 }}><input type="radio" name={`perm-${a.id}`} checked={v.permisibilidad === "permitida"} onChange={() => cambiar(a.id, { permisibilidad: "permitida" })} /> Permitida</label>
                        <label><input type="radio" name={`perm-${a.id}`} checked={v.permisibilidad === "prohibida"} onChange={() => cambiar(a.id, { permisibilidad: "prohibida" })} /> Prohibida</label>
                        {a.permisibilidad && !v.permisibilidad && <small style={{ display: "block", color: "var(--muted)" }}>Hoy: {a.permisibilidad}</small>}
                      </fieldset>
                    ) : a.permisibilidad === "prohibida" ? <span className="pill red">Prohibida</span> : a.permisibilidad ?? "—"}
                  </td>
                  <td>
                    {editable ? (
                      <select aria-label={`Camino de ${a.muestra}`} value={v.camino} disabled={v.clase !== "arma" || v.permisibilidad !== "permitida"} onChange={(e) => cambiar(a.id, { camino: e.target.value })}>
                        <option value="">{a.caminoNombre ?? (v.clase && v.clase !== "arma" ? "Directo al certificado" : "Elija…")}</option>
                        <option value="cip">Con cuño CIP · reconocimiento</option>
                        <option value="completa">Sin cuño CIP · prueba completa</option>
                      </select>
                    ) : a.caminoNombre ?? "—"}
                  </td>
                  <td className="num">{a.ensayos}</td>
                  <td><span className={`pill ${PILL_ETAPA[a.etapa] ?? "gray"}`}>{a.etapaNombre}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {puede && (
        <>
          {reclasifica && (
            <div className="field" style={{ maxWidth: 520, marginTop: 8 }}>
              <label htmlFor="cl-motivo">Motivo de la reclasificación <span className="req">*</span></label>
              <input id="cl-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} />
            </div>
          )}
          <div className="toolbar">
            <button type="button" className="btn primary" disabled={!listo || ocupado} onClick={enviar}>{ocupado ? "Clasificando…" : "Clasificar → camino"}</button>
            <small style={{ color: "var(--muted)" }}>Un arma prohibida no sigue: corresponde informe de incumplimiento a DGMN (EP-11 11.24).</small>
          </div>
        </>
      )}
    </div>
  );
}
