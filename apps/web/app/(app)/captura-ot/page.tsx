"use client";

/**
 * Captura y revisión por OT · LIMS IDIC · RF-D01/D02 + RF-E01
 *
 * Dos formas de entrar:
 *  · Por OT (?otId=…): se elige la orden de trabajo y se ven TODOS sus
 *    ensayos, agrupados por muestra. El analista captura el valor de cada uno
 *    (el servidor calcula el veredicto contra la especificación congelada del
 *    catálogo); el revisor revisa o devuelve; la jefatura aprueba. Se puede
 *    actuar resultado a resultado o sobre la OT completa.
 *  · Bandeja (?estado=capturado | revisado_n1 | devuelto,rechazado …): los
 *    resultados de todas las OT del alcance que esperan una acción. Es lo que
 *    abren las tarjetas de Mi bandeja «Resultados por revisar / por aprobar /
 *    devueltos».
 *
 * En cada resultado se ve quién lo capturó, revisó y aprobó, y cuándo, y el
 * motivo si fue devuelto. Reglas en el servidor (docs/FLUJO_LABORATORIO.md):
 * quien captura no revisa ni aprueba lo suyo; lo revisado o aprobado no se
 * sobrescribe; devolver exige motivo; solo se actúa sobre OT del propio
 * laboratorio (alcance).
 *
 * API: GET /flujo/ot/:id/resultados · POST /flujo/resultado/:id/valor ·
 *      GET /resultados/bandeja · POST /resultados/:id/{revisar,aprobar,devolver,veredicto} ·
 *      POST /resultados/ot/:otId/{revisar,aprobar}
 */
import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { num, fechaHora } from "@/lib/format";
import { usePermisos } from "@/lib/permisos";
import { toast } from "@/components/ui/feedback";
import BuscadorOt, { type OtCorta } from "@/components/BuscadorOt";
import { ESTADO_RESULTADO, llamar, qs, veredictoInfo, type Paginado } from "@/lib/laboratorio";
import EditorEnsayo, { type EnsayoEditable } from "./_components/EditorEnsayo";

/** Resultado en una forma común (viene de dos endpoints con forma distinta). */
interface Fila extends EnsayoEditable {
  id: string;
  estado: string;
  veredicto: string | null;
  unidad: string | null;
  limiteInf: string | null;
  nominal: string | null;
  limiteSup: string | null;
  valorNumerico: number | string | null;
  valorTexto: string | null;
  resultadoFinal: number | string | null;
  promedio: number | string | null;
  replicas: number[];
  /** resultado por réplicas (analito del catálogo antiguo): se corrige en «Captura de resultados» */
  porReplicas: boolean;
  fecha: string | null;
  analistaId: string | null;
  analistaNombre: string | null;
  revisadoPorNombre: string | null;
  revisadoAt: string | null;
  aprobadoPorNombre: string | null;
  aprobadoAt: string | null;
  motivoDevolucion: string | null;
  asignadoNombre: string | null;
  otId: string | null;
  otCodigo: string | null;
  muestraId: string | null;
  muestraCodigo: string | null;
  muestraNombre: string | null;
  analito: string;
  metodo: string | null;
}

function normalizar(r: any, ot?: { id: string; codigo: string } | null): Fila {
  return {
    id: r.id,
    estado: r.estado ?? "capturado",
    veredicto: r.veredicto ?? null,
    unidad: r.unidad ?? r.catAnalito?.unidad ?? null,
    limiteInf: r.limiteInf ?? null,
    nominal: r.nominal ?? null,
    limiteSup: r.limiteSup ?? null,
    valorNumerico: r.valorNumerico ?? null,
    valorTexto: r.valorTexto ?? null,
    resultadoFinal: r.resultadoFinal ?? null,
    promedio: r.promedio ?? null,
    replicas: Array.isArray(r.replicas) ? r.replicas : [],
    porReplicas: Boolean(r.analitoId ?? r.analito?.id),
    fecha: r.fecha ?? null,
    analistaId: r.analistaId ?? null,
    analistaNombre: r.analistaNombre ?? null,
    revisadoPorNombre: r.revisadoPorNombre ?? null,
    revisadoAt: r.revisadoAt ?? null,
    aprobadoPorNombre: r.aprobadoPorNombre ?? null,
    aprobadoAt: r.aprobadoAt ?? null,
    motivoDevolucion: r.motivoDevolucion ?? null,
    asignadoNombre: r.asignadoNombre ?? null,
    otId: r.otId ?? ot?.id ?? null,
    otCodigo: r.otCodigo ?? ot?.codigo ?? null,
    muestraId: r.muestraId ?? r.muestra?.id ?? null,
    muestraCodigo: r.muestraCodigo ?? r.muestra?.codigo ?? null,
    muestraNombre: r.muestraNombre ?? r.muestra?.nombre ?? null,
    analito: r.analitoNombre ?? r.catAnalito?.nombre ?? r.analito?.nombre ?? r.catAnalito?.codigo ?? r.analito?.codigo ?? "—",
    metodo: r.metodoNombre ?? r.catMetodo?.nombre ?? r.catMetodo?.codigo ?? null,
    tipoDato: r.tipoDato === "atributo" ? "atributo" : "numerico",
    requisito: r.requisito ?? null,
    formula: r.formula ?? null,
    formulaAplicable: r.formulaAplicable ?? null,
    // La bandeja no trae los campos del método: si la fórmula los pide, se captura desde la OT.
    nCampos: r.nCampos ?? (/\bC\d+\b/.test(String(r.formula ?? "")) ? 1 : 0),
    campos: r.campos ?? [],
    formulaMotivo: r.formulaMotivo ?? null,
    formulaLegado: r.formulaLegado ?? null,
    especOrigen: r.especOrigen ?? "catalogo",
    especCatalogo: r.especCatalogo ?? null,
    especEditadaPorNombre: r.especEditadaPorNombre ?? null,
    especEditadaAt: r.especEditadaAt ?? null,
    observacion: r.observacion ?? null,
    lecturas: Array.isArray(r.lecturas) ? r.lecturas : null,
  };
}

/** ¿Se captura con un solo campo en la tabla? (numérico, sin campos de fórmula, del puente) */
const capturaRapida = (f: Fila) => f.tipoDato === "numerico" && f.nCampos === 0 && !f.porReplicas;

const esNumero = (v: any) => typeof v === "number" || (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v.replace(",", "."))));

/** Texto legible del límite: "inf – sup", "≥ inf", "≤ sup", "= nominal" o "—". */
function limiteTexto(r: Fila): string {
  const fmt = (v: any) => (esNumero(v) ? num(Number(String(v).replace(",", ".")), 3) : String(v));
  const vacio = (v: any) => v == null || String(v).trim() === "";
  if (!vacio(r.limiteInf) && !vacio(r.limiteSup)) return `${fmt(r.limiteInf)} – ${fmt(r.limiteSup)}`;
  if (!vacio(r.limiteInf)) return `≥ ${fmt(r.limiteInf)}`;
  if (!vacio(r.limiteSup)) return `≤ ${fmt(r.limiteSup)}`;
  if (!vacio(r.nominal)) return `= ${fmt(r.nominal)}`;
  return "—";
}

/** Valor registrado, en formato chileno. */
function valorTexto(r: Fila): string {
  if (r.valorNumerico != null && r.valorNumerico !== "") return num(Number(r.valorNumerico), 4);
  if (r.valorTexto) return r.valorTexto;
  if (r.resultadoFinal != null) return num(Number(r.resultadoFinal), 4);
  if (r.promedio != null) return num(Number(r.promedio), 4);
  return "";
}

/** Borrador inicial del campo de valor (con coma decimal). */
function valorBorrador(r: Fila): string {
  if (r.valorNumerico != null && r.valorNumerico !== "") return String(r.valorNumerico).replace(".", ",");
  return r.valorTexto ?? "";
}

const CAPTURABLES = ["pendiente", "capturado", "devuelto", "rechazado"];

/** Vistas de la bandeja (sin OT elegida). */
const BANDEJAS: { k: string; l: string; estado: string; mios?: boolean; asignados?: boolean; perm: string[] }[] = [
  { k: "por_revisar", l: "Por revisar", estado: "capturado", perm: ["resultado.revisar"] },
  { k: "por_aprobar", l: "Por aprobar", estado: "revisado_n1", perm: ["resultado.aprobar"] },
  { k: "devueltos", l: "Mis devueltos", estado: "devuelto,rechazado", mios: true, perm: ["resultado.crear"] },
  { k: "por_capturar", l: "Por capturar (asignados a mí)", estado: "pendiente,devuelto", asignados: true, perm: ["resultado.crear"] },
];

const FILTROS_OT: { k: string; l: string; estados: string[] | null }[] = [
  { k: "todos", l: "Todos", estados: null },
  { k: "pendiente", l: "Por capturar", estados: ["pendiente"] },
  { k: "capturado", l: "Por revisar", estados: ["capturado"] },
  { k: "revisado_n1", l: "Por aprobar", estados: ["revisado_n1"] },
  { k: "devuelto", l: "Devueltos", estados: ["devuelto", "rechazado"] },
  { k: "aprobado", l: "Aprobados", estados: ["aprobado"] },
];

export default function CapturaOtPage() {
  const acceso = usePermisos();
  const yo = acceso.usuario.id;
  const tiene = (p: string) => acceso.roles.includes("SUPERADMIN") || acceso.permisos.has(p);

  const [ot, setOt] = useState<OtCorta | null>(null);
  const [vistaBandeja, setVistaBandeja] = useState<{ estado: string; mios: boolean; asignados: boolean } | null>(null);
  const [filas, setFilas] = useState<Fila[]>([]);
  const [meta, setMeta] = useState<{ total: number; page: number; totalPages: number } | null>(null);
  const [page, setPage] = useState(1);
  const [filtroOt, setFiltroOt] = useState("todos");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [devolviendo, setDevolviendo] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [omitidos, setOmitidos] = useState<{ id: string; motivo: string }[]>([]);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [veredictosMuestra, setVeredictosMuestra] = useState<Record<string, string>>({});
  const [veredictoOt, setVeredictoOt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [inicial, setInicial] = useState(false);

  // Estado inicial desde la dirección (?otId=… o ?estado=…&mios=1).
  useEffect(() => {
    const u = new URLSearchParams(window.location.search);
    const otId = u.get("otId");
    const estado = u.get("estado");
    if (otId) setOt({ id: otId, codigo: "" });
    else if (estado) setVistaBandeja({ estado, mios: u.get("mios") === "1", asignados: u.get("asignados") === "1" });
    setInicial(true);
  }, []);

  const cargar = useCallback(async () => {
    setError("");
    if (!ot && !vistaBandeja) { setFilas([]); setMeta(null); return; }
    setLoading(true);
    try {
      if (ot) {
        const j = await llamar<any>("GET", `/flujo/ot/${ot.id}/resultados`);
        const info = j.ot ?? { id: ot.id, codigo: ot.codigo };
        if (!ot.codigo && info.codigo) setOt((o) => (o ? { ...o, codigo: info.codigo } : o));
        const fs: Fila[] = (j.resultados ?? []).map((r: any) => normalizar(r, info));
        setFilas(fs);
        setVeredictosMuestra(Object.fromEntries((j.veredictosMuestra ?? []).map((m: any) => [m.id, m.veredicto])));
        setVeredictoOt(j.veredictoOt ?? null);
        setMeta(null);
        setDrafts(Object.fromEntries(fs.map((f) => [f.id, valorBorrador(f)])));
        window.history.replaceState(null, "", `/captura-ot?otId=${ot.id}`);
      } else if (vistaBandeja) {
        const r = await llamar<Paginado<any>>(
          "GET",
          `/resultados/bandeja${qs({ estado: vistaBandeja.estado, mios: vistaBandeja.mios, asignados: vistaBandeja.asignados, page, limit: 50 })}`,
        );
        const fs = r.data.map((x) => normalizar(x));
        setFilas(fs);
        setMeta(r.meta);
        setDrafts(Object.fromEntries(fs.map((f) => [f.id, valorBorrador(f)])));
        window.history.replaceState(null, "", `/captura-ot${qs({ estado: vistaBandeja.estado, mios: vistaBandeja.mios, asignados: vistaBandeja.asignados })}`);
      }
    } catch (e: any) {
      setError(e.message);
      setFilas([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ot?.id, vistaBandeja, page]);

  useEffect(() => {
    if (inicial) cargar();
  }, [inicial, cargar]);

  /** Reemplaza una fila con la respuesta del servidor conservando lo que esta no trae. */
  const actualizarFila = (id: string, r: any) =>
    setFilas((prev) => prev.map((f) => (f.id === id ? { ...f, ...normalizarParcial(r) } : f)));

  async function guardarValor(f: Fila) {
    const raw = (drafts[f.id] ?? "").trim();
    if (!raw) { toast.error("Escriba un valor antes de guardar."); return; }
    setOcupado(f.id);
    try {
      // El servidor decide si es número (admite «12,4») o texto («Ausente»).
      const r = await llamar("POST", `/flujo/resultado/${f.id}/valor`, { valor: raw });
      actualizarFila(f.id, { ...r, analistaNombre: acceso.usuario.nombre });
      if (r.veredictoMuestra && f.muestraId) setVeredictosMuestra((m) => ({ ...m, [f.muestraId!]: r.veredictoMuestra }));
      setDrafts((d) => ({ ...d, [f.id]: valorBorrador(normalizar(r)) }));
      toast.ok("Valor guardado.");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(null);
    }
  }

  async function accion(f: Fila, que: "revisar" | "aprobar") {
    setOcupado(f.id);
    try {
      const r = await llamar("POST", `/resultados/${f.id}/${que}`);
      actualizarFila(f.id, {
        ...r,
        ...(que === "revisar" ? { revisadoPorNombre: acceso.usuario.nombre } : { aprobadoPorNombre: acceso.usuario.nombre }),
      });
      toast.ok(que === "revisar" ? "Resultado revisado." : "Resultado aprobado.");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(null);
    }
  }

  async function devolver(f: Fila) {
    if (motivo.trim().length < 5) { toast.error("Indique el motivo de la devolución (mínimo 5 caracteres)."); return; }
    setOcupado(f.id);
    try {
      const r = await llamar("POST", `/resultados/${f.id}/devolver`, { motivo: motivo.trim() });
      actualizarFila(f.id, { ...r, revisadoPorNombre: acceso.usuario.nombre });
      setDevolviendo(null);
      setMotivo("");
      toast.ok("Resultado devuelto al analista con el motivo.");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(null);
    }
  }

  async function fijarVeredicto(f: Fila, v: string) {
    setOcupado(f.id);
    try {
      const r = await llamar("POST", `/resultados/${f.id}/veredicto`, { veredicto: v });
      actualizarFila(f.id, r);
      toast.ok("Veredicto registrado.");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(null);
    }
  }

  async function accionOt(que: "revisar" | "aprobar") {
    if (!ot) return;
    setOcupado("__ot");
    setOmitidos([]);
    try {
      const r = await llamar<{ hechos: number; omitidos: { id: string; motivo: string }[] }>("POST", `/resultados/ot/${ot.id}/${que}`);
      setOmitidos(r.omitidos ?? []);
      toast.ok(`${r.hechos} resultado${r.hechos === 1 ? "" : "s"} ${que === "revisar" ? "revisado" : "aprobado"}${r.hechos === 1 ? "" : "s"}.${r.omitidos?.length ? ` ${r.omitidos.length} omitido(s).` : ""}`);
      await cargar();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(null);
    }
  }

  const conteo = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of filas) c[f.estado] = (c[f.estado] ?? 0) + 1;
    return c;
  }, [filas]);
  const veredictos = useMemo(() => {
    const c = { cumple: 0, no_cumple: 0, informativo: 0, pendiente: 0 };
    for (const f of filas) {
      const v = String(f.veredicto ?? "pendiente").toLowerCase().replace(/\s+/g, "_");
      if (v in c) (c as any)[v]++; else c.pendiente++;
    }
    return c;
  }, [filas]);

  const visibles = useMemo(() => {
    const def = FILTROS_OT.find((x) => x.k === filtroOt);
    return ot && def?.estados ? filas.filter((f) => def.estados!.includes(f.estado)) : filas;
  }, [filas, filtroOt, ot]);

  const todoAprobado = ot != null && filas.length > 0 && filas.every((f) => f.estado === "aprobado");
  const porRevisarAjenos = filas.filter((f) => f.estado === "capturado" && f.analistaId !== yo).length;
  const porAprobarAjenos = filas.filter((f) => f.estado === "revisado_n1" && f.analistaId !== yo).length;

  // Agrupación por muestra (vista por OT) o por OT + muestra (bandeja).
  const grupos = useMemo(() => {
    const g = new Map<string, { titulo: React.ReactNode; filas: Fila[] }>();
    for (const f of visibles) {
      const k = `${f.otId}|${f.muestraId}`;
      if (!g.has(k))
        g.set(k, {
          titulo: (
            <>
              {!ot && f.otId && (
                <button type="button" className="codigo" style={{ background: "none", border: 0, padding: 0, cursor: "pointer", textDecoration: "underline", marginRight: 8 }}
                  onClick={() => { setVistaBandeja(null); setOt({ id: f.otId!, codigo: f.otCodigo ?? "" }); }}>
                  {f.otCodigo}
                </button>
              )}
              <span className="codigo">{f.muestraCodigo}</span> {f.muestraNombre ?? ""}
              {ot && f.muestraId && veredictosMuestra[f.muestraId] && (
                <span className={`pill ${veredictoInfo(veredictosMuestra[f.muestraId]).pill}`} style={{ marginLeft: 8 }} title="Veredicto de la muestra: No cumple si algún ensayo no cumple; Pendiente si falta alguno">
                  Muestra: {veredictoInfo(veredictosMuestra[f.muestraId]).texto}
                </span>
              )}
            </>
          ),
          filas: [],
        });
      g.get(k)!.filas.push(f);
    }
    return [...g.values()];
  }, [visibles, ot, veredictosMuestra]);

  const bandejasVisibles = BANDEJAS.filter((b) => b.perm.some(tiene));

  return (
    <div>
      <h1 className="page">Captura y revisión por OT</h1>
      <p className="subtitle">
        Elija una orden de trabajo para capturar sus ensayos, o abra una bandeja para ver lo que espera su revisión,
        su aprobación o su corrección. Se admite coma decimal (12,4). Quien captura un resultado no puede revisarlo ni aprobarlo.
      </p>
      {error && <div className="alert warn">{error}</div>}

      <div className="card">
        <div className="form-grid cols-2">
          <BuscadorOt valor={ot} onCambio={(o) => { setOt(o); setVistaBandeja(o ? null : vistaBandeja); setFiltroOt("todos"); setOmitidos([]); }} />
          <div className="field">
            <label>Bandejas</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {bandejasVisibles.map((b) => {
                const activa = !ot && vistaBandeja?.estado === b.estado && !!vistaBandeja?.mios === !!b.mios && !!vistaBandeja?.asignados === !!b.asignados;
                return (
                  <button key={b.k} className={`btn sm ${activa ? "primary" : "outline"}`}
                    onClick={() => { setOt(null); setPage(1); setVistaBandeja({ estado: b.estado, mios: !!b.mios, asignados: !!b.asignados }); }}>
                    {b.l}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {ot && filas.length > 0 && (
        <>
          <div className="kpis">
            <div className="kpi k-blue"><div className="lab">Ensayos</div><div className="val">{filas.length}</div></div>
            <div className="kpi"><div className="lab">Por capturar</div><div className="val">{conteo.pendiente ?? 0}</div></div>
            <div className="kpi k-amber"><div className="lab">Por revisar / devueltos</div><div className="val">{(conteo.capturado ?? 0)} / {(conteo.devuelto ?? 0) + (conteo.rechazado ?? 0)}</div></div>
            <div className="kpi k-violet"><div className="lab">Por aprobar</div><div className="val">{conteo.revisado_n1 ?? 0}</div></div>
            <div className="kpi k-green"><div className="lab">Aprobados</div><div className="val">{conteo.aprobado ?? 0}</div></div>
            <div className="kpi k-red"><div className="lab">No cumple</div><div className="val">{veredictos.no_cumple}</div></div>
            {veredictoOt && (
              <div className={`kpi ${veredictoOt === "cumple" ? "k-green" : veredictoOt === "no_cumple" ? "k-red" : "k-amber"}`}>
                <div className="lab">Veredicto de la OT</div><div className="val" style={{ fontSize: 17 }}>{veredictoInfo(veredictoOt).texto}</div>
              </div>
            )}
          </div>

          <div className="card">
            <div className="toolbar" style={{ margin: 0 }}>
              {FILTROS_OT.map((x) => (
                <button key={x.k} className={`btn sm ${filtroOt === x.k ? "primary" : "outline"}`} onClick={() => setFiltroOt(x.k)}>{x.l}</button>
              ))}
              <div className="spacer" />
              {tiene("resultado.revisar") && (
                <button className="btn sm" disabled={!porRevisarAjenos || ocupado === "__ot"} onClick={() => accionOt("revisar")}
                  title="Revisa todos los resultados capturados de la OT, salvo los que capturó usted">
                  Revisar todo lo capturado ({porRevisarAjenos})
                </button>
              )}
              {tiene("resultado.aprobar") && (
                <button className="btn success sm" disabled={!porAprobarAjenos || ocupado === "__ot"} onClick={() => accionOt("aprobar")}
                  title="Aprueba todos los resultados revisados de la OT, salvo los que capturó usted">
                  Aprobar todo lo revisado ({porAprobarAjenos})
                </button>
              )}
              <Link href={"/informes" as any} className={`btn sm ${todoAprobado ? "primary" : "outline"}`}
                title={todoAprobado ? "Todos los resultados están aprobados" : "Aún hay resultados sin aprobar"}>
                Emitir informe
              </Link>
            </div>
            {omitidos.length > 0 && (
              <div className="alert info" style={{ marginTop: 8 }}>
                {omitidos.length} resultado(s) no se procesaron: {[...new Set(omitidos.map((o) => o.motivo))].join(" ")}
              </div>
            )}
            {todoAprobado && <div className="alert success" style={{ marginTop: 8 }}>Todos los resultados de la OT {ot.codigo} están aprobados.</div>}
          </div>
        </>
      )}

      {(ot || vistaBandeja) && (
        <div className="card">
          <h2>
            {ot ? "Ensayos de la OT" : `Bandeja · ${BANDEJAS.find((b) => b.estado === vistaBandeja?.estado)?.l ?? vistaBandeja?.estado}`}
            {meta && <span className="right">{meta.total} resultado(s)</span>}
          </h2>
          {loading ? (
            <p className="subtitle">Cargando resultados…</p>
          ) : visibles.length === 0 ? (
            <p className="subtitle">
              {ot
                ? filas.length === 0
                  ? "Esta OT no tiene ensayos generados. Se generan al registrar sus muestras con los métodos del panel (Registro de OT)."
                  : "No hay resultados con este filtro."
                : "No hay resultados en esta bandeja."}
            </p>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Ensayo</th>
                  <th>Límite</th>
                  <th style={{ width: 210 }}>Valor</th>
                  <th>Veredicto</th>
                  <th>Estado</th>
                  <th>Trazabilidad</th>
                  <th style={{ width: 200 }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {grupos.map((g, gi) => (
                  <Fragment key={gi}>
                    <tr><td colSpan={7} style={{ background: "#f6f9fc", fontWeight: 600 }}>{g.titulo}</td></tr>
                    {g.filas.map((f) => {
                      const vd = veredictoInfo(f.veredicto);
                      const est = ESTADO_RESULTADO[f.estado] ?? { texto: f.estado, pill: "gray" };
                      const propio = !!yo && f.analistaId === yo;
                      const capturable = CAPTURABLES.includes(f.estado) && tiene("resultado.crear");
                      const busy = ocupado === f.id;
                      return (
                        <Fragment key={f.id}>
                          <tr>
                            <td>
                              {f.analito}
                              {f.metodo && <div style={{ fontSize: 11, color: "var(--muted)" }}>{f.metodo}</div>}
                              {f.asignadoNombre && <div style={{ fontSize: 11, color: "var(--muted)" }}>Asignado a {f.asignadoNombre}</div>}
                            </td>
                            <td>
                              <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{limiteTexto(f)}{f.unidad ? ` ${f.unidad}` : ""}</span>
                              {f.requisito && <div style={{ fontSize: 11, color: "var(--muted)" }}>{f.requisito}</div>}
                              {f.tipoDato === "atributo" && <div><span className="pill gray">atributo</span></div>}
                              {f.especOrigen === "orden" && (
                                <div><span className="pill amber" title={`Especificación de la orden${f.especEditadaPorNombre ? ` · ${f.especEditadaPorNombre}` : ""}${f.especEditadaAt ? ` · ${fechaHora(f.especEditadaAt)}` : ""}. Catálogo: ${limiteTexto({ ...f, limiteInf: f.especCatalogo?.limiteInf ?? null, nominal: f.especCatalogo?.nominal ?? null, limiteSup: f.especCatalogo?.limiteSup ?? null } as Fila)}`}>de la orden</span></div>
                              )}
                              {ot && !f.porReplicas && (
                                <button type="button" className="btn outline sm" style={{ marginTop: 4, padding: "1px 6px", fontSize: 11 }}
                                  onClick={() => setAbierto(abierto === f.id ? null : f.id)}>
                                  {abierto === f.id ? "Cerrar" : "Especificación…"}
                                </button>
                              )}
                            </td>
                            <td>
                              {capturable && !capturaRapida(f) && !f.porReplicas ? (
                                <div>
                                  {valorTexto(f) && <div style={{ fontFamily: "'JetBrains Mono', monospace" }}>{valorTexto(f)}</div>}
                                  {ot ? (
                                    <button className="btn sm" onClick={() => setAbierto(abierto === f.id ? null : f.id)}>
                                      {abierto === f.id ? "Cerrar" : f.tipoDato === "atributo" ? "Cumple / No cumple…" : "Capturar lecturas…"}
                                    </button>
                                  ) : (
                                    <button className="btn sm" onClick={() => { setVistaBandeja(null); setOt({ id: f.otId!, codigo: f.otCodigo ?? "" }); }}>Abrir en la OT</button>
                                  )}
                                </div>
                              ) : capturable && !f.porReplicas ? (
                                <div style={{ display: "flex", gap: 6 }}>
                                  <input
                                    value={drafts[f.id] ?? ""}
                                    onChange={(e) => setDrafts((d) => ({ ...d, [f.id]: e.target.value }))}
                                    onKeyDown={(e) => { if (e.key === "Enter") guardarValor(f); }}
                                    placeholder="valor"
                                    aria-label={`Valor de ${f.analito}`}
                                    style={{ fontFamily: "'JetBrains Mono', monospace", width: "100%" }}
                                    disabled={busy}
                                  />
                                  <button className="btn sm" onClick={() => guardarValor(f)} disabled={busy}>{busy ? "…" : "Guardar"}</button>
                                </div>
                              ) : (
                                <span style={{ fontFamily: "'JetBrains Mono', monospace" }} title={f.replicas.length ? `Réplicas: ${f.replicas.map((x) => num(x, 4)).join("; ")}` : undefined}>
                                  {valorTexto(f) || "—"}
                                  {f.porReplicas && f.replicas.length > 0 && <small style={{ color: "var(--muted)" }}> ({f.replicas.length} réplicas)</small>}
                                </span>
                              )}
                              {capturable && f.porReplicas && (
                                <div><Link href={`/captura?corregir=${f.id}` as any} style={{ fontSize: 11.5, color: "var(--accent)" }}>Corregir réplicas</Link></div>
                              )}
                            </td>
                            <td>
                              <span className={`pill ${vd.pill}`}>{vd.texto}</span>
                              {tiene("resultado.revisar") && f.estado === "capturado" && String(f.veredicto ?? "").toLowerCase() === "pendiente" && (valorTexto(f) !== "") && (
                                <select aria-label="Veredicto del revisor" defaultValue="" style={{ marginTop: 4, display: "block" }} disabled={busy}
                                  onChange={(e) => { if (e.target.value) fijarVeredicto(f, e.target.value); }}>
                                  <option value="">Decidir…</option>
                                  <option value="cumple">Cumple</option>
                                  <option value="no_cumple">No cumple</option>
                                  <option value="informativo">Informativo</option>
                                </select>
                              )}
                            </td>
                            <td><span className={`pill ${est.pill}`}>{est.texto}</span></td>
                            <td style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.45 }}>
                              {f.analistaNombre ? <div>Capturó <b style={{ color: "var(--ink)" }}>{f.analistaNombre}</b>{f.fecha && f.estado !== "pendiente" ? ` · ${fechaHora(f.fecha)}` : ""}</div> : null}
                              {f.revisadoPorNombre && f.revisadoAt ? (
                                <div>{f.estado === "devuelto" ? "Devolvió" : "Revisó"} <b style={{ color: "var(--ink)" }}>{f.revisadoPorNombre}</b> · {fechaHora(f.revisadoAt)}</div>
                              ) : null}
                              {f.aprobadoPorNombre && f.aprobadoAt ? <div>Aprobó <b style={{ color: "var(--ink)" }}>{f.aprobadoPorNombre}</b> · {fechaHora(f.aprobadoAt)}</div> : null}
                              {f.observacion && <div>Observación: {f.observacion}</div>}
                              {f.motivoDevolucion && ["devuelto", "rechazado"].includes(f.estado) && (
                                <div style={{ color: "#7a4b00" }}>Motivo: {f.motivoDevolucion}</div>
                              )}
                              {!f.analistaNombre && f.estado === "pendiente" ? "—" : null}
                            </td>
                            <td>
                              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                                {tiene("resultado.revisar") && f.estado === "capturado" && (
                                  <button className="btn sm" disabled={busy || propio} onClick={() => accion(f, "revisar")}
                                    title={propio ? "Lo capturó usted: debe revisarlo otra persona" : "Marcar como revisado"}>Revisar</button>
                                )}
                                {tiene("resultado.aprobar") && f.estado === "revisado_n1" && (
                                  <button className="btn success sm" disabled={busy || propio} onClick={() => accion(f, "aprobar")}
                                    title={propio ? "Lo capturó usted: debe aprobarlo otra persona" : "Aprobar el resultado"}>Aprobar</button>
                                )}
                                {tiene("resultado.revisar") && ["capturado", "revisado_n1"].includes(f.estado) && (
                                  <button className="btn outline sm" disabled={busy} onClick={() => { setDevolviendo(devolviendo === f.id ? null : f.id); setMotivo(""); }}>Devolver</button>
                                )}
                              </div>
                            </td>
                          </tr>
                          {abierto === f.id && ot && (
                            <tr>
                              <td colSpan={7} style={{ background: "#f8fbfc" }}>
                                <EditorEnsayo
                                  key={`${f.id}-${f.especEditadaAt ?? ""}-${f.fecha ?? ""}-${f.estado}`}
                                  e={f}
                                  puedeCapturar={tiene("resultado.crear") && CAPTURABLES.includes(f.estado)}
                                  esJefatura={tiene("resultado.aprobar")}
                                  onGuardado={() => cargar()}
                                />
                              </td>
                            </tr>
                          )}
                          {devolviendo === f.id && (
                            <tr>
                              <td colSpan={7} style={{ background: "#fffaf0" }}>
                                <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                                  <div className="field" style={{ flex: 1, minWidth: 260 }}>
                                    <label>Motivo de la devolución <span className="req">*</span></label>
                                    <input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={1000} autoFocus
                                      placeholder="Qué debe corregir el analista" />
                                  </div>
                                  <button className="btn outline sm" onClick={() => setDevolviendo(null)}>Cancelar</button>
                                  <button className="btn sm" style={{ background: "var(--amber, #c98a00)", color: "#fff" }} disabled={busy} onClick={() => devolver(f)}>Devolver al analista</button>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
          {meta && meta.totalPages > 1 && (
            <div className="toolbar" style={{ marginTop: 8 }}>
              <div className="spacer" />
              <button className="btn outline sm" disabled={meta.page <= 1} onClick={() => setPage((n) => n - 1)}>← Anterior</button>
              <span style={{ fontSize: 12 }}>Página {meta.page} de {meta.totalPages}</span>
              <button className="btn outline sm" disabled={meta.page >= meta.totalPages} onClick={() => setPage((n) => n + 1)}>Siguiente →</button>
            </div>
          )}
        </div>
      )}

      {!ot && !vistaBandeja && (
        <div className="card">
          <p className="subtitle" style={{ margin: 0 }}>
            Busque una orden de trabajo arriba o abra una bandeja. Para ver solo las OT asignadas a usted use{" "}
            <Link href={"/ot?mias=1&estado=abiertas" as any} style={{ color: "var(--accent)" }}>Mis OT</Link>.
          </p>
        </div>
      )}
    </div>
  );
}

/** Solo los campos que devuelve el servidor tras una acción (sin pisar muestra/analito). */
function normalizarParcial(r: any): Partial<Fila> {
  const out: Partial<Fila> = {};
  const campos: (keyof Fila)[] = [
    "estado", "veredicto", "valorNumerico", "valorTexto", "resultadoFinal", "promedio", "fecha",
    "analistaId", "revisadoAt", "aprobadoAt", "motivoDevolucion",
  ];
  for (const c of campos) if (r[c] !== undefined) (out as any)[c] = r[c];
  for (const c of ["analistaNombre", "revisadoPorNombre", "aprobadoPorNombre"] as (keyof Fila)[]) if (r[c] !== undefined) (out as any)[c] = r[c];
  return out;
}
