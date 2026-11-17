"use client";

/**
 * /zona-informes/encuestas-trimestral · Informe trimestral de encuestas de
 * satisfacción (DCO-PG01-P04-IT05, Anexos 01 a 06), igual al que emite hoy el
 * Departamento Comercial: por formulario, encuestas contestadas, índice de
 * satisfacción sobre el 85 %, evaluación por ítem y por laboratorio o sucursal,
 * observaciones y control de aplicación. En pantalla, PDF (formato del anexo) y
 * Excel (planilla de análisis).
 * API: GET /encuestas/informe-trimestral[/pdf|/excel]?anio=&trimestre=&tipo=
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import RequierePermiso from "@/components/RequierePermiso";
import { llamar } from "@/lib/laboratorio";
import { hoyChile } from "@/lib/fecha-chile";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";

interface Tipo {
  codigo: string;
  nombre: string;
  formulario: string;
  formularioRevision: string | null;
  instruccion: string;
  anexoNumero: string | null;
  anexoRevision: string | null;
  tituloInforme: string;
  agruparPor: "laboratorio" | "sucursal";
  umbralPct: number;
}
interface Resumen {
  contestadas: number;
  sobreUmbral: number;
  porcentajeSobreUmbral: number | null;
  promedio: number | null;
  indice: number | null;
}
interface Seccion {
  tipo: Tipo;
  resumen: Resumen;
  aplicacion: { total: number; contestadas: number; pendientes: number; sinRespuesta: number; tasaRespuesta: number | null; gruposSinContestar: string[] };
  items: { codigo: string; texto: string; respuestas: number; promedio: number | null; indice: number | null }[];
  grupos: { grupo: string; contestadas: number; promedio: number | null; indice: number | null }[];
  detalle: { id: string; referencia: string; grupo: string; valores: Record<string, number | null>; suma: number; promedio: number | null; indice: number | null; sobreUmbral: boolean }[];
  observaciones: { referencia: string; grupo: string; texto: string }[];
  anterior: Resumen | null;
}
interface Informe {
  anio: number;
  trimestre: number;
  etiqueta: string;
  texto: string;
  secciones: Seccion[];
  sinTipo: number;
}

const nota = (v: number | null | undefined) => (v === null || v === undefined ? "—" : (Math.round(v * 10) / 10).toFixed(1).replace(".", ","));
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${Math.round(v)} %`);
const TRIMESTRES: [number, string][] = [
  [1, "1er trimestre (enero a marzo)"],
  [2, "2do trimestre (abril a junio)"],
  [3, "3er trimestre (julio a septiembre)"],
  [4, "4to trimestre (octubre a diciembre)"],
];

/** Trimestre recién cerrado (el informe se hace al inicio del trimestre siguiente). */
function porDefecto(): { anio: number; trimestre: number } {
  const [a, m] = hoyChile().split("-").map(Number);
  const t = Math.floor((m - 1) / 3) + 1;
  return t === 1 ? { anio: a - 1, trimestre: 4 } : { anio: a, trimestre: t - 1 };
}

export default function InformeEncuestasPage() {
  return (
    <RequierePermiso perm="encuesta.ver" titulo="Informe trimestral de encuestas">
      <InformeEncuestas />
    </RequierePermiso>
  );
}

function InformeEncuestas() {
  const def = useMemo(porDefecto, []);
  const [anio, setAnio] = useState(def.anio);
  const [trimestre, setTrimestre] = useState(def.trimestre);
  const [tipo, setTipo] = useState("");
  const [tipos, setTipos] = useState<{ codigo: string; nombre: string; formulario: string; activo: boolean }[]>([]);
  const [inf, setInf] = useState<Informe | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [descargando, setDescargando] = useState<"" | "pdf" | "excel">("");

  const anioActual = Number(hoyChile().slice(0, 4));
  const anios = Array.from({ length: 6 }, (_, i) => anioActual - i);

  const query = useCallback(() => {
    const p = new URLSearchParams({ anio: String(anio), trimestre: String(trimestre) });
    if (tipo) p.set("tipo", tipo);
    return p.toString();
  }, [anio, trimestre, tipo]);

  useEffect(() => {
    llamar<any[]>("GET", "/encuestas/tipos")
      .then((t) => setTipos((t ?? []).filter((x) => x.activo)))
      .catch(() => setTipos([]));
  }, []);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setInf(await llamar<Informe>("GET", `/encuestas/informe-trimestral?${query()}`));
    } catch (e: any) {
      setInf(null);
      setError(e?.message ?? "No se pudo calcular el informe. Revise el año y el trimestre e intente de nuevo.");
    } finally {
      setCargando(false);
    }
  }, [query]);
  useEffect(() => {
    cargar();
  }, [cargar]);

  async function descargar(formato: "pdf" | "excel") {
    setError(null);
    setDescargando(formato);
    try {
      const t = localStorage.getItem("lims_token");
      const r = await fetch(`${API}/encuestas/informe-trimestral/${formato}?${query()}`, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.message ?? `Error ${r.status}`);
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `informe_encuestas_${anio}_T${trimestre}${tipo ? `_${tipo}` : ""}.${formato === "pdf" ? "pdf" : "xlsx"}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message ?? `No se pudo descargar el ${formato === "pdf" ? "PDF" : "Excel"}. Intente de nuevo.`);
    } finally {
      setDescargando("");
    }
  }

  return (
    <div style={{ maxWidth: 1100 }}>
      <p style={{ fontSize: 12.5, margin: "0 0 6px" }}>
        <Link href="/zona-informes">← Zona de informes</Link>
      </p>
      <h1 className="page">Informe trimestral de encuestas de satisfacción</h1>
      <p className="subtitle">
        Mismo informe que emite el Departamento Comercial según la instrucción DCO-PG01-P04-IT05 (Anexos 01 a 06): un anexo por formulario de
        encuesta. El trimestre se toma de la fecha del servicio evaluado (cierre de la OT o vencimiento de la cotización). Índice de satisfacción =
        promedio de las notas ÷ 7.
      </p>

      <div className="toolbar" style={{ gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="inf-anio">Año</label>
          <select id="inf-anio" value={anio} onChange={(e) => setAnio(Number(e.target.value))}>
            {anios.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="inf-trim">Trimestre</label>
          <select id="inf-trim" value={trimestre} onChange={(e) => setTrimestre(Number(e.target.value))}>
            {TRIMESTRES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ margin: 0, minWidth: 260 }}>
          <label htmlFor="inf-tipo">Formulario (tipo de cliente)</label>
          <select id="inf-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Todos los formularios (Anexos 01 a 06)</option>
            {tipos.map((t) => (
              <option key={t.codigo} value={t.codigo}>
                {t.formulario} · {t.nombre}
              </option>
            ))}
          </select>
        </div>
        <div className="spacer" />
        <button className="btn sm outline" type="button" onClick={() => descargar("pdf")} disabled={!inf || !!descargando}>
          {descargando === "pdf" ? "Preparando PDF…" : "Descargar PDF"}
        </button>
        <button className="btn sm outline" type="button" onClick={() => descargar("excel")} disabled={!inf || !!descargando}>
          {descargando === "excel" ? "Preparando Excel…" : "Descargar Excel"}
        </button>
      </div>

      {error ? (
        <div className="alert warn" role="alert">
          {error}
        </div>
      ) : null}
      {cargando && !inf ? <div className="card">Calculando el informe…</div> : null}
      {inf && inf.sinTipo > 0 ? (
        <div className="alert info">
          {inf.sinTipo} encuesta(s) del trimestre no tienen formulario asignado y no entran en ningún anexo. Asígnelo al registrarlas en{" "}
          <Link href="/encuestas">Encuestas de satisfacción</Link>.
        </div>
      ) : null}
      {inf?.secciones.map((s) => <SeccionAnexo key={s.tipo.codigo} s={s} inf={inf} />)}
    </div>
  );
}

function SeccionAnexo({ s, inf }: { s: Seccion; inf: Informe }) {
  const g = s.tipo.agruparPor === "sucursal" ? "Sucursal" : "Laboratorio";
  const umbral = Math.round(s.tipo.umbralPct);
  const [verDetalle, setVerDetalle] = useState(false);
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
        <h2 style={{ fontSize: 15, margin: 0 }}>{s.tipo.tituloInforme}</h2>
        <span className="codigo" style={{ fontSize: 12 }}>
          {s.tipo.instruccion}-Anexo{s.tipo.anexoNumero} · Rev. {s.tipo.anexoRevision ?? "—"} · Formulario {s.tipo.formulario}
        </span>
      </div>
      <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "4px 0 10px" }}>Correspondiente al {inf.texto}.</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 8, marginBottom: 10 }}>
        <Kpi titulo="Encuestas contestadas" valor={String(s.resumen.contestadas).padStart(2, "0")} />
        <Kpi titulo={`Con índice sobre el ${umbral} %`} valor={String(s.resumen.sobreUmbral).padStart(2, "0")} />
        <Kpi titulo={`% con índice sobre el ${umbral} %`} valor={s.resumen.contestadas ? pct(s.resumen.porcentajeSobreUmbral) : "0 %"} />
        <Kpi titulo="Evaluación promedio" valor={`${nota(s.resumen.promedio)} · ${pct(s.resumen.indice)}`} />
      </div>

      <div className="card--table" style={{ marginBottom: 10 }}>
        <table className="data">
          <caption className="sr-only">Evaluación promedio e índice de satisfacción por ítem</caption>
          <thead>
            <tr>
              <th>Ítemes</th>
              <th className="num">Evaluación promedio</th>
              <th className="num">Índice satisfacción al cliente promedio</th>
            </tr>
          </thead>
          <tbody>
            {s.items.map((i) => (
              <tr key={i.codigo}>
                <td>{i.texto}</td>
                <td className="num">{nota(i.promedio)}</td>
                <td className="num">{pct(i.indice)}</td>
              </tr>
            ))}
            {!s.items.length && (
              <tr>
                <td colSpan={3} style={{ textAlign: "center", color: "var(--muted)", padding: 14 }}>
                  Sin encuestas contestadas en el trimestre.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card--table" style={{ marginBottom: 10 }}>
        <table className="data">
          <caption className="sr-only">Evaluación promedio por {g.toLowerCase()}</caption>
          <thead>
            <tr>
              <th>{g}</th>
              <th className="num">Contestadas</th>
              <th className="num">Evaluación promedio</th>
              <th className="num">Índice satisfacción al cliente promedio</th>
            </tr>
          </thead>
          <tbody>
            {s.grupos.map((x) => (
              <tr key={x.grupo}>
                <td>{x.grupo}</td>
                <td className="num">{x.contestadas}</td>
                <td className="num">{nota(x.promedio)}</td>
                <td className="num">{pct(x.indice)}</td>
              </tr>
            ))}
            {!s.grupos.length && (
              <tr>
                <td colSpan={4} style={{ textAlign: "center", color: "var(--muted)", padding: 14 }}>
                  Sin encuestas contestadas en el trimestre.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {s.observaciones.length ? (
        <div style={{ marginBottom: 10 }}>
          <h3 style={{ fontSize: 13.5, margin: "6px 0" }}>Observaciones señaladas por los encuestados</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {s.observaciones.map((o, i) => (
              <li key={i}>
                <b>{o.referencia}</b> ({o.grupo}): {o.texto}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <h3 style={{ fontSize: 13.5, margin: "6px 0" }}>Control de aplicación</h3>
      <p style={{ fontSize: 13, margin: "0 0 4px" }}>
        {s.aplicacion.total} encuesta(s) del trimestre: {s.aplicacion.contestadas} contestada(s), {s.aplicacion.pendientes} pendiente(s) y{" "}
        {s.aplicacion.sinRespuesta} sin respuesta · tasa de respuesta {pct(s.aplicacion.tasaRespuesta)}.
        {s.anterior ? (
          <>
            {" "}
            Trimestre anterior (referencia): {s.anterior.contestadas} contestada(s), evaluación {nota(s.anterior.promedio)} ({pct(s.anterior.indice)}).
          </>
        ) : null}
      </p>
      {s.aplicacion.gruposSinContestar.length ? (
        <p style={{ fontSize: 12.5, color: "var(--warn, #9a6700)", margin: "0 0 4px" }}>
          Sin ninguna encuesta contestada (la instrucción pide al menos una por laboratorio): {s.aplicacion.gruposSinContestar.join(", ")}.
        </p>
      ) : null}

      {s.detalle.length ? (
        <>
          <button className="btn sm outline" type="button" onClick={() => setVerDetalle(!verDetalle)} aria-expanded={verDetalle} style={{ marginTop: 6 }}>
            {verDetalle ? "Ocultar planilla de análisis" : `Ver planilla de análisis (${s.detalle.length} encuestas)`}
          </button>
          {verDetalle ? (
            <div className="card--table" style={{ marginTop: 8, overflowX: "auto" }}>
              <table className="data">
                <caption className="sr-only">Notas de cada encuesta contestada, con suma, promedio e índice</caption>
                <thead>
                  <tr>
                    <th>Ítem</th>
                    {s.detalle.map((d) => (
                      <th key={d.id} className="num" style={{ whiteSpace: "nowrap" }} title={d.grupo}>
                        {d.referencia}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {s.items.map((i) => (
                    <tr key={i.codigo}>
                      <td title={i.texto} style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {i.texto}
                      </td>
                      {s.detalle.map((d) => (
                        <td key={d.id} className="num">
                          {d.valores[i.codigo] ?? "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr style={{ fontWeight: 600 }}>
                    <td>Suma</td>
                    {s.detalle.map((d) => (
                      <td key={d.id} className="num">
                        {d.suma}
                      </td>
                    ))}
                  </tr>
                  <tr style={{ fontWeight: 600 }}>
                    <td>Promedio</td>
                    {s.detalle.map((d) => (
                      <td key={d.id} className="num">
                        {nota(d.promedio)}
                      </td>
                    ))}
                  </tr>
                  <tr style={{ fontWeight: 600 }}>
                    <td>Índice satisfacción del cliente</td>
                    {s.detalle.map((d) => (
                      <td key={d.id} className="num" style={{ color: d.sobreUmbral ? undefined : "var(--danger, #b42318)" }}>
                        {pct(d.indice)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function Kpi({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px" }}>
      <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{titulo}</div>
      <div style={{ fontSize: 18, fontWeight: 700 }}>{valor}</div>
    </div>
  );
}
