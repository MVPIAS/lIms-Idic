"use client";

/**
 * «Cotización · respuesta del laboratorio» (EP-00 2.5): el Jefe de Laboratorio
 * responde la solicitud de Comercial con el Programa de trabajo (FORM06) y, si
 * el servicio no es estandarizado, el Formulario de costeo (FORM05, siete
 * secciones). Botones «Aceptar», «Aceptar con comentario» y «Rechazar con
 * comentario» → vuelve a Comercial. Los montos que se ven aquí son una vista
 * previa: el servidor los recalcula al enviar (form05.ts).
 */
import { useMemo, useState } from "react";
import Panel from "./Panel";
import { pedir } from "./comercial";
import { money } from "@/lib/format";
import type { Solicitud } from "./circuito";

type Col = { k: string; l: string; tipo: "texto" | "numero" | "opcion"; ops?: [string, string][]; ancho?: number };
type Fila = Record<string, string>;

const SECCIONES: { k: string; titulo: string; ayuda?: string; cols: Col[]; nueva: Fila }[] = [
  {
    k: "viaticos",
    titulo: "1 · Viáticos",
    ayuda: "Viático = monto diario del país o zona × % del grado × días (tabla anual DFZ).",
    cols: [
      { k: "ambito", l: "Ámbito", tipo: "opcion", ops: [["nacional", "Nacional"], ["extranjero", "Extranjero"]], ancho: 110 },
      { k: "zona", l: "País o zona", tipo: "texto" },
      { k: "grado", l: "Grado", tipo: "texto" },
      { k: "dias", l: "Días", tipo: "numero", ancho: 70 },
      { k: "montoDiario", l: "Monto diario", tipo: "numero", ancho: 110 },
      { k: "porcentaje", l: "% del grado", tipo: "numero", ancho: 90 },
    ],
    nueva: { ambito: "nacional", zona: "", grado: "", dias: "", montoDiario: "", porcentaje: "" },
  },
  {
    k: "horasHombre",
    titulo: "2 · Horas hombre",
    cols: [
      { k: "tipo", l: "Personal", tipo: "opcion", ops: [["civil", "Civil"], ["militar", "Militar"]], ancho: 100 },
      { k: "categoria", l: "Categoría", tipo: "texto" },
      { k: "horas", l: "Horas", tipo: "numero", ancho: 80 },
      { k: "valorHora", l: "Valor hora", tipo: "numero", ancho: 110 },
    ],
    nueva: { tipo: "civil", categoria: "", horas: "", valorHora: "" },
  },
  {
    k: "servicios",
    titulo: "3 · Servicios estándar",
    ayuda: "Ensayos de la lista de precios (código EN) que forman parte del servicio.",
    cols: [
      { k: "codigo", l: "Código EN", tipo: "texto", ancho: 110 },
      { k: "descripcion", l: "Descripción", tipo: "texto" },
      { k: "cantidad", l: "Cantidad", tipo: "numero", ancho: 80 },
      { k: "valorUnitario", l: "Valor unitario", tipo: "numero", ancho: 110 },
    ],
    nueva: { codigo: "", descripcion: "", cantidad: "1", valorUnitario: "" },
  },
  {
    k: "horasMaquina",
    titulo: "4 · Horas máquina",
    cols: [
      { k: "equipo", l: "Equipo", tipo: "texto" },
      { k: "horas", l: "Horas", tipo: "numero", ancho: 80 },
      { k: "valorHora", l: "Valor hora", tipo: "numero", ancho: 110 },
    ],
    nueva: { equipo: "", horas: "", valorHora: "" },
  },
  {
    k: "pasajes",
    titulo: "5 · Pasajes",
    cols: [
      { k: "ambito", l: "Ámbito", tipo: "opcion", ops: [["nacional", "Nacional"], ["extranjero", "Extranjero"]], ancho: 110 },
      { k: "tramo", l: "Tramo", tipo: "texto" },
      { k: "cantidad", l: "Cantidad", tipo: "numero", ancho: 80 },
      { k: "valorUnitario", l: "Valor unitario", tipo: "numero", ancho: 110 },
    ],
    nueva: { ambito: "nacional", tramo: "", cantidad: "1", valorUnitario: "" },
  },
  {
    k: "otros",
    titulo: "6 · Otros gastos",
    cols: [
      { k: "descripcion", l: "Descripción", tipo: "texto" },
      { k: "monto", l: "Monto", tipo: "numero", ancho: 110 },
      { k: "moneda", l: "Moneda", tipo: "opcion", ops: [["CLP", "CLP"], ["USD", "US$"]], ancho: 90 },
    ],
    nueva: { descripcion: "", monto: "", moneda: "CLP" },
  },
];

/** Número escrito a la chilena: «1.234.567,5» o «45000» o «1,5» (y «1.5» como decimal). */
const n = (v: string | undefined) => {
  let s = String(v ?? "").trim().replace(/\s/g, "");
  if (s.includes(",") || /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  const x = Number(s);
  return Number.isFinite(x) ? x : 0;
};
const numerica = (v: string) => String(v ?? "").trim() !== "";

/** Convierte las filas de una sección al formato de la API (números y vacíos fuera). */
function aApi(sec: (typeof SECCIONES)[number], filas: Fila[]) {
  return filas
    .filter((f) => sec.cols.some((c) => c.tipo !== "opcion" && String(f[c.k] ?? "").trim()))
    .map((f) => Object.fromEntries(sec.cols.map((c) => [c.k, c.tipo === "numero" ? n(f[c.k]) : String(f[c.k] ?? "").trim()])));
}

function TablaSeccion({ sec, filas, onCambio }: { sec: (typeof SECCIONES)[number]; filas: Fila[]; onCambio: (f: Fila[]) => void }) {
  const set = (i: number, k: string, v: string) => onCambio(filas.map((f, j) => (j === i ? { ...f, [k]: v } : f)));
  return (
    <fieldset style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px", margin: "0 0 10px" }}>
      <legend style={{ fontSize: 12.5, fontWeight: 700, padding: "0 4px" }}>{sec.titulo}</legend>
      {sec.ayuda && <p className="subtitle" style={{ margin: "0 0 6px", fontSize: 11.5 }}>{sec.ayuda}</p>}
      {filas.length > 0 && (
        <table className="data" style={{ marginBottom: 6 }}>
          <thead>
            <tr>
              {sec.cols.map((c) => <th key={c.k} style={c.ancho ? { width: c.ancho } : undefined}>{c.l}</th>)}
              <th style={{ width: 40 }}><span className="sr-only">Quitar</span></th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={i}>
                {sec.cols.map((c) => (
                  <td key={c.k}>
                    {c.tipo === "opcion" ? (
                      <select aria-label={`${c.l} · fila ${i + 1}`} value={f[c.k]} onChange={(e) => set(i, c.k, e.target.value)}>
                        {c.ops!.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    ) : (
                      <input
                        aria-label={`${c.l} · fila ${i + 1}`}
                        inputMode={c.tipo === "numero" ? "decimal" : undefined}
                        value={f[c.k]}
                        onChange={(e) => set(i, c.k, e.target.value)}
                        maxLength={c.tipo === "numero" ? 16 : 200}
                      />
                    )}
                  </td>
                ))}
                <td><button type="button" className="btn outline sm" aria-label={`Quitar fila ${i + 1}`} onClick={() => onCambio(filas.filter((_, j) => j !== i))}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button type="button" className="btn outline sm" onClick={() => onCambio([...filas, { ...sec.nueva }])}>＋ Agregar fila</button>
    </fieldset>
  );
}

export default function RespuestaLaboratorio({
  sol,
  cotCodigo,
  cfg,
  onCerrar,
  onHecho,
}: {
  sol: Solicitud;
  cotCodigo: string;
  cfg: { cfaPct: number; margenParticularPct: number };
  onCerrar: () => void;
  onHecho: (msg: string) => void;
}) {
  const noEstandar = sol.tipoServicio === "no_estandar";
  const previo = sol.estado === "devuelto" ? sol : null;
  const [respuesta, setRespuesta] = useState<"aceptar" | "aceptar_con_comentario" | "rechazar">("aceptar");
  const [comentario, setComentario] = useState(previo?.comentarioLab ?? "");
  const [plazo, setPlazo] = useState(previo?.programa?.plazoEntregaDias ? String(previo.programa.plazoEntregaDias) : "");
  const [fIni, setFIni] = useState(previo?.programa?.fechaInicio ?? "");
  const [fFin, setFFin] = useState(previo?.programa?.fechaTermino ?? "");
  const [etapas, setEtapas] = useState<Fila[]>(
    (previo?.programa?.etapas ?? []).map((e) => ({ actividad: e.actividad, inicio: e.inicio ?? "", termino: e.termino ?? "", recursos: e.recursos ?? "" })),
  );
  const [secciones, setSecciones] = useState<Record<string, Fila[]>>(() => {
    const c = previo?.costeo ?? {};
    return Object.fromEntries(SECCIONES.map((s) => [s.k, (c[s.k] ?? []).map((f: any) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, String(v ?? "")])))]));
  });
  const [condiciones, setCondiciones] = useState<string>(previo?.costeo?.condiciones ?? "");
  const [dolar, setDolar] = useState<string>(previo?.costeo?.dolar ? String(previo.costeo.dolar) : "");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const rechaza = respuesta === "rechazar";

  // Vista previa de los montos (mismo cálculo que form05.ts; manda el servidor).
  const prev = useMemo(() => {
    const d = n(dolar);
    const s = secciones;
    const sum = (k: string, f: (x: Fila) => number) => Math.round((s[k] ?? []).reduce((a, x) => a + f(x), 0));
    const sec = {
      viaticos: sum("viaticos", (x) => n(x.montoDiario) * (n(x.porcentaje) / 100) * n(x.dias)),
      horasHombre: sum("horasHombre", (x) => n(x.horas) * n(x.valorHora)),
      servicios: sum("servicios", (x) => n(x.cantidad) * n(x.valorUnitario)),
      horasMaquina: sum("horasMaquina", (x) => n(x.horas) * n(x.valorHora)),
      pasajes: sum("pasajes", (x) => n(x.cantidad) * n(x.valorUnitario)),
      otros: sum("otros", (x) => (x.moneda === "USD" ? n(x.monto) * d : n(x.monto))),
    };
    const cdt = Object.values(sec).reduce((a, b) => a + b, 0);
    const cfa = Math.round(cdt * (cfg.cfaPct / 100));
    return { cdt, cfa, ct: cdt + cfa, particular: Math.round((cdt + cfa) * (1 + cfg.margenParticularPct / 100)) };
  }, [secciones, dolar, cfg]);

  const conCosteo = noEstandar || SECCIONES.some((s) => aApi(s, secciones[s.k] ?? []).length > 0);

  async function enviar() {
    setError("");
    if (rechaza || respuesta === "aceptar_con_comentario") {
      if (!comentario.trim()) return setError(rechaza ? "Indique por qué el laboratorio no realiza el servicio." : "Escriba el comentario para Comercial.");
    }
    if (!rechaza && !numerica(plazo)) return setError("Indique el plazo de entrega propuesto (días corridos).");
    setEnviando(true);
    try {
      const costeo = conCosteo && !rechaza
        ? {
            ...Object.fromEntries(SECCIONES.map((s) => [s.k, aApi(s, secciones[s.k] ?? [])])),
            condiciones: condiciones.trim() || null,
            dolar: n(dolar) > 0 ? n(dolar) : null,
          }
        : null;
      const r = await pedir<any>("POST", `/cotizaciones/solicitudes-laboratorio/${sol.id}/responder`, {
        respuesta,
        comentario: comentario.trim() || null,
        programa: rechaza
          ? null
          : {
              plazoEntregaDias: Math.round(n(plazo)),
              fechaInicio: fIni || null,
              fechaTermino: fFin || null,
              etapas: etapas.filter((e) => e.actividad.trim()).map((e) => ({ actividad: e.actividad.trim(), inicio: e.inicio || null, termino: e.termino || null, recursos: e.recursos.trim() || null })),
            },
        costeo,
      });
      onHecho(r?.mensaje ?? "Respuesta enviada a Comercial.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Panel
      modo="drawer"
      ancho={1040}
      onCerrar={onCerrar}
      titulo={<>Respuesta del laboratorio · <span className="codigo">{sol.numero ?? `Solicitud de fechas ${sol.unidadCodigo}`}</span> · cotización <span className="codigo">{cotCodigo}</span></>}
    >
      {sol.devueltaMotivo && sol.estado === "devuelto" && (
        <div className="alert warn" role="status">Devuelta en el V°B°: {sol.devueltaMotivo}. Corrija y vuelva a enviar.</div>
      )}
      {sol.comentarioEjecutivo && <div className="alert info">Comercial pide: «{sol.comentarioEjecutivo}»</div>}
      {error && <div className="alert warn" role="alert">{error}</div>}

      <fieldset style={{ border: 0, padding: 0, margin: "0 0 12px" }}>
        <legend style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>¿El laboratorio realiza el servicio?</legend>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {([
            ["aceptar", "Sí, lo realiza"],
            ["aceptar_con_comentario", "Sí, con comentario"],
            ["rechazar", "No lo realiza"],
          ] as const).map(([v, l]) => (
            <label key={v} style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 400 }}>
              <input type="radio" name="respuesta" style={{ width: "auto" }} checked={respuesta === v} onChange={() => setRespuesta(v)} />
              {l}
            </label>
          ))}
        </div>
        {(rechaza || respuesta === "aceptar_con_comentario") && (
          <div className="field" style={{ marginTop: 8 }}>
            <label htmlFor="r-comentario">{rechaza ? "Motivo" : "Comentario para Comercial"} <span className="req">*</span></label>
            <textarea id="r-comentario" rows={2} maxLength={2000} value={comentario} onChange={(e) => setComentario(e.target.value)} />
          </div>
        )}
      </fieldset>

      {!rechaza && (
        <>
          <h3 style={{ fontSize: 14, margin: "6px 0" }}>Programa de trabajo <span className="tag">FORM06</span></h3>
          <div className="form-grid cols-3">
            <div className="field">
              <label htmlFor="r-plazo">Plazo de entrega propuesto (días corridos) <span className="req">*</span></label>
              <input id="r-plazo" inputMode="numeric" value={plazo} onChange={(e) => setPlazo(e.target.value.replace(/\D/g, ""))} maxLength={3} />
            </div>
            <div className="field">
              <label htmlFor="r-ini">Fecha de inicio</label>
              <input id="r-ini" type="date" value={fIni} onChange={(e) => setFIni(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="r-fin">Fecha de término</label>
              <input id="r-fin" type="date" value={fFin} onChange={(e) => setFFin(e.target.value)} />
            </div>
          </div>
          <table className="data" style={{ margin: "8px 0" }}>
            <thead><tr><th>Etapa o actividad</th><th style={{ width: 150 }}>Inicio</th><th style={{ width: 150 }}>Término</th><th>Recursos</th><th style={{ width: 40 }}><span className="sr-only">Quitar</span></th></tr></thead>
            <tbody>
              {etapas.map((e, i) => (
                <tr key={i}>
                  <td><input aria-label={`Actividad ${i + 1}`} value={e.actividad} maxLength={300} onChange={(x) => setEtapas(etapas.map((y, j) => (j === i ? { ...y, actividad: x.target.value } : y)))} /></td>
                  <td><input aria-label={`Inicio ${i + 1}`} type="date" value={e.inicio} onChange={(x) => setEtapas(etapas.map((y, j) => (j === i ? { ...y, inicio: x.target.value } : y)))} /></td>
                  <td><input aria-label={`Término ${i + 1}`} type="date" value={e.termino} onChange={(x) => setEtapas(etapas.map((y, j) => (j === i ? { ...y, termino: x.target.value } : y)))} /></td>
                  <td><input aria-label={`Recursos ${i + 1}`} value={e.recursos} maxLength={500} onChange={(x) => setEtapas(etapas.map((y, j) => (j === i ? { ...y, recursos: x.target.value } : y)))} /></td>
                  <td><button type="button" className="btn outline sm" aria-label={`Quitar etapa ${i + 1}`} onClick={() => setEtapas(etapas.filter((_, j) => j !== i))}>✕</button></td>
                </tr>
              ))}
              {!etapas.length && <tr><td colSpan={5} style={{ color: "var(--muted)" }}>Sin etapas: basta el plazo de entrega si el trabajo es simple.</td></tr>}
            </tbody>
          </table>
          <button type="button" className="btn outline sm" onClick={() => setEtapas([...etapas, { actividad: "", inicio: "", termino: "", recursos: "" }])}>＋ Agregar etapa</button>

          <h3 style={{ fontSize: 14, margin: "16px 0 6px" }}>
            Formulario de costeo <span className="tag">FORM05</span>{" "}
            {noEstandar ? <span className="req" style={{ fontSize: 12 }}>obligatorio · servicio no estandarizado</span> : <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 400 }}>opcional · servicio estandarizado</span>}
          </h3>
          {SECCIONES.map((s) => (
            <TablaSeccion key={s.k} sec={s} filas={secciones[s.k] ?? []} onCambio={(f) => setSecciones({ ...secciones, [s.k]: f })} />
          ))}
          <div className="form-grid cols-2">
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label htmlFor="r-cond">7 · Condiciones técnicas y restricciones</label>
              <textarea id="r-cond" rows={2} maxLength={4000} value={condiciones} onChange={(e) => setCondiciones(e.target.value)} />
            </div>
            {(secciones.otros ?? []).some((o) => o.moneda === "USD") && (
              <div className="field">
                <label htmlFor="r-dolar">Valor del dólar (para otros gastos en US$) <span className="req">*</span></label>
                <input id="r-dolar" inputMode="decimal" value={dolar} onChange={(e) => setDolar(e.target.value)} maxLength={10} />
              </div>
            )}
          </div>
          {conCosteo && (
            <div className="totals-box" style={{ maxWidth: 420, marginLeft: "auto" }} aria-live="polite">
              <div className="row"><span>Costo directo total (CDT)</span><b>{money(prev.cdt)}</b></div>
              <div className="row"><span>Costo fijo asociado (CFA {cfg.cfaPct} %)</span><b>{money(prev.cfa)}</b></div>
              <div className="row"><span>Costo total (CT) · precio Ejército</span><b>{money(prev.ct)}</b></div>
              <div className="row total"><span>Precio particular (+{cfg.margenParticularPct} %)</span><span>{money(prev.particular)}</span></div>
              <p style={{ fontSize: 11, color: "var(--muted)", margin: "4px 0 0" }}>Vista previa: el sistema recalcula al enviar. Porcentajes en Administración › Parámetros (por confirmar con el IDIC).</p>
            </div>
          )}
        </>
      )}

      <div className="toolbar" style={{ marginTop: 14 }}>
        <button className="btn outline sm" onClick={onCerrar}>Cancelar</button>
        <div className="spacer" />
        <button className={`btn sm ${rechaza ? "" : "primary"}`} style={rechaza ? { background: "var(--red)", color: "#fff" } : undefined} disabled={enviando} onClick={enviar}>
          {enviando ? "Enviando…" : rechaza ? "Rechazar con comentario → Comercial" : respuesta === "aceptar" ? "Aceptar → Comercial" : "Aceptar con comentario → Comercial"}
        </button>
      </div>
    </Panel>
  );
}
