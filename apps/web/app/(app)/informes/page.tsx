"use client";

/**
 * Emisión de informes / certificados · LIMS IDIC
 *
 * Elegir OT + plantilla → el sistema comprueba las condiciones (resultados
 * aprobados, control de calidad, laboratorio y matriz de firmas) y muestra
 * quién firmará → elegir el contenido (cumplimiento o solo resultados,
 * conclusión, portada del IVC, secciones y fotos) → previsualizar → emitir.
 * El documento queda «En firma» y cada responsable lo firma desde «Documentos
 * por firmar»; con la última firma pasa a oficial.
 * Reglas: docs/FLUJO_FIRMA_CIERRE.md y docs/FLUJO_INFORME_ENSAYO.md.
 */
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { otActiva } from "@/lib/ot-activa";
import { api } from "@/lib/api";
import { fecha } from "@/lib/format";
import DataTable, { type DataColumn } from "@/components/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { toast } from "@/components/ui/feedback";
import { ACCION_FIRMA, ESTADO_DOC, nombresResponsables } from "@/lib/documentos";
import PanelDocumento from "@/components/documentos/PanelDocumento";
import Modal from "@/components/documentos/Modal";
import BuscadorOt, { type OtCorta } from "@/components/BuscadorOt";
import { usePermisos } from "@/lib/permisos";
import { CAMPOS_PORTADA, MODALIDAD, textoModalidad, type Modalidad, type Portada, type Propuesta } from "@/lib/informes";
import FotosInforme, { type EnsayoOt } from "@/components/informes/FotosInforme";
import EstructuraInforme from "@/components/informes/EstructuraInforme";
import FormatoPlantilla from "@/components/informes/FormatoPlantilla";
import CoberturaDocumento, { type CoberturaElegida } from "@/components/informes/CoberturaDocumento";

type Plantilla = { id: string; repid: string; nombre: string; tipo: string; version?: string; activo?: boolean };
type Condiciones = {
  puedeEmitir: boolean;
  faltantes: string[];
  tipoDocumento: string;
  tipoDocumentoOrigen?: "indicado" | "plantilla" | "unidad";
  tipoDocumentoUnidad?: string | null;
  resultados: { total: number; aprobados: number };
  pasos: { orden: number; accion: string; rolNombre: string; unidadCodigo: string | null; responsables: any[] }[];
  otInterna?: boolean;
  pasosOmitidos?: { orden: number; accion: string; rolNombre: string; unidadCodigo: string | null; motivo: string }[];
  /** Número oficial que tendrá (numeración del laboratorio y tipo; orientativo hasta emitir). */
  numeracion?: { numero: string | null; formato: string | null; porConfirmar: boolean; general: boolean; aviso: string | null };
};
type Preview = { plantilla: string; tipo: string; modalidad?: Modalidad; avisos: string[]; html: string };

/** Tipos de documento de la matriz de firmas (rbac.constants.ts · TIPOS_DOCUMENTO) que se emiten desde aquí. */
const TIPOS_DOCUMENTO: { valor: string; texto: string }[] = [
  { valor: "", texto: "Automático (según la unidad de la OT y la plantilla)" },
  { valor: "INFORME_ENSAYO", texto: "Informe de ensayo" },
  { valor: "IVC", texto: "Informe de verificación (IVC)" },
  { valor: "INFORME_TECNICO", texto: "Informe técnico" },
  { valor: "CERTIFICADO_CALIBRACION", texto: "Certificado de calibración" },
  { valor: "INFORME_INSPECCION", texto: "Informe de inspección" },
  { valor: "CERTIFICADO_CONFORMIDAD", texto: "Certificado de conformidad" },
  { valor: "INFORME_INCUMPLIMIENTO", texto: "Informe de incumplimiento" },
  { valor: "CERTIFICADO_RESISTENCIA_BALISTICA", texto: "Certificado de Resistencia Balística (CRB)" },
  { valor: "INFORME_RECHAZO", texto: "Informe de Ensayo de Rechazo (LRB)" },
];

const lista = <T,>(r: any): T[] => (Array.isArray(r) ? r : (r?.data ?? []));

function InformesContenido() {
  const params = useSearchParams();
  // OT elegida con búsqueda en el servidor (GET /ot es paginado: no se carga una lista fija).
  const [otSel, setOtSel] = useState<OtCorta | null>(null);
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  // Sin ?otId (abierto desde el menú) se propone la OT de la captura en curso (B-023).
  const [otInicial] = useState(() => params.get("otId") ?? (typeof window === "undefined" ? null : otActiva()));
  const [otId, setOtId] = useState(otInicial ?? "");
  const [plantillaId, setPlantillaId] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");
  const [tipoDocumento, setTipoDocumento] = useState("");
  const [cond, setCond] = useState<Condiciones | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState<"" | "cond" | "preview" | "emitir">("");
  const [abierto, setAbierto] = useState<string | null>(null);
  const { puede } = usePermisos();
  // Contenido del documento (lo elige quien emite).
  const [propuesta, setPropuesta] = useState<Propuesta | null>(null);
  const [modalidad, setModalidad] = useState<Modalidad>("cumplimiento");
  const [conclusion, setConclusion] = useState("");
  const [portada, setPortada] = useState<Portada>({});
  // IVC (EP-03 3.4): ítems defectuosos del producto terminado.
  const [defectos, setDefectos] = useState<{ items: string; descripcion: string; numeracion: string }[]>([]);
  const [ensayos, setEnsayos] = useState<EnsayoOt[]>([]);
  const [verFormato, setVerFormato] = useState(false);
  // Qué cubre el documento: toda la OT, una muestra, un producto o un laboratorio.
  const [cobertura, setCobertura] = useState<CoberturaElegida>({ cobertura: "ot" });
  const [versionCob, setVersionCob] = useState(0);
  const cobJson = JSON.stringify(cobertura);

  const cargarDocs = useCallback(async () => {
    try {
      setDocs(lista(await api.getRaw(`informes/documentos?limit=50${otId ? `&otId=${otId}` : ""}`)));
    } catch (e: any) {
      setError(e.message);
    }
  }, [otId]);

  useEffect(() => {
    (async () => {
      setCargando(true);
      try {
        const inicial = otInicial;
        const [o, p] = await Promise.all([
          inicial ? api.getRaw<OtCorta>(`ot/${inicial}`).catch(() => null) : Promise.resolve(null),
          // Todas las páginas (la API entrega de a 100; hay más plantillas heredadas que eso).
          (async () => {
            const todas: any[] = [];
            for (let pag = 1; pag <= 10; pag++) {
              const r: any = await api.getRaw(`plantillas?limit=100&page=${pag}`);
              todas.push(...lista<any>(r));
              if (!r?.meta || pag >= (r.meta.totalPages ?? 1)) break;
            }
            return todas;
          })(),
        ]);
        if (o) setOtSel(o);
        // Lista depurada (recorrido MP-02, D02-05): fuera las plantillas de prueba heredadas
        // («test», «NULL», «-») y todas las activas, no solo las 100 primeras.
        const deVerdad = (x: Plantilla) =>
          x.activo !== false && !/^\s*test\s*$/i.test(x.nombre ?? "") && !["-", "NULL", ""].includes(String(x.repid ?? "").trim().toUpperCase());
        setPlantillas(lista<Plantilla>(p).filter(deVerdad).sort((a, b) => `${a.repid} ${a.nombre}`.localeCompare(`${b.repid} ${b.nombre}`, "es")));
      } catch (e: any) {
        setError(e?.message ?? "No se pudieron cargar los datos");
      } finally {
        setCargando(false);
      }
    })();
  }, []);

  useEffect(() => {
    cargarDocs();
  }, [cargarDocs]);

  const tipos = useMemo(() => [...new Set(plantillas.map((p) => p.tipo))].sort(), [plantillas]);
  const plantillasVisibles = useMemo(() => plantillas.filter((p) => !filtroTipo || p.tipo === filtroTipo), [plantillas, filtroTipo]);

  useEffect(() => {
    if (plantillaId && !plantillasVisibles.some((p) => p.id === plantillaId)) setPlantillaId("");
  }, [plantillasVisibles, plantillaId]);

  const listo = !!otId && !!plantillaId;
  const datosInforme = () => ({
    conclusion: conclusion.trim() || null,
    ...(propuesta?.formato.portada === "ivc" ? { portada } : {}),
    ...(propuesta?.formato.productoTerminado
      ? { productoTerminado: defectos.filter((d) => d.items.trim() || d.descripcion.trim() || d.numeracion.trim()).map((d) => ({ items: d.items.trim() || null, descripcion: d.descripcion.trim() || null, numeracion: d.numeracion.trim() || null })) }
      : {}),
  });
  const conCobertura = () => (cobertura.cobertura === "ot" ? {} : { cobertura });
  const cuerpo = () => ({ otId, plantillaId, modalidad, datosInforme: datosInforme(), ...(tipoDocumento ? { tipoDocumento } : {}), ...conCobertura() });

  // Propuesta del servidor para esta OT y plantilla: formato, modalidad sugerida y portada.
  const cargarPropuesta = useCallback(async () => {
    if (!otId || !plantillaId) return setPropuesta(null);
    try {
      const p = await api.post<Propuesta>("/informes/propuesta", { otId, plantillaId });
      setPropuesta(p);
      setModalidad(p.modalidad);
      setPortada(p.portada ?? {});
      // D02-44: si la propuesta trae el laboratorio (jefatura de un laboratorio participante), se elige ya.
      setCobertura({
        cobertura: ((p.cobertura?.cobertura as CoberturaElegida["cobertura"]) ?? "ot"),
        ...(p.cobertura?.unidadId ? { unidadId: p.cobertura.unidadId } : {}),
      });
    } catch (e: any) {
      setPropuesta(null);
      setError(e.message);
    }
  }, [otId, plantillaId]);

  useEffect(() => {
    setConclusion("");
    cargarPropuesta();
  }, [cargarPropuesta]);

  // Ensayos de la OT (para ligar las fotos a un punto del informe).
  useEffect(() => {
    setEnsayos([]);
    if (!otId) return;
    api.getRaw<{ filas: EnsayoOt[] }>(`informes/ot/${otId}/estructura`).then((r) => setEnsayos(r.filas)).catch(() => setEnsayos([]));
  }, [otId]);

  // Al elegir OT + plantilla, se comprueba qué falta y quién firmará.
  const comprobar = useCallback(async () => {
    if (!otId || !plantillaId) return setCond(null);
    // D02-44: se comprueba con la cobertura de la propuesta, no antes (evita el aviso de alcance de «toda la OT»).
    if (!propuesta) return setCond(null);
    setOcupado("cond");
    setError("");
    try {
      setCond(await api.post<Condiciones>("/informes/condiciones", {
        otId, plantillaId, ...(tipoDocumento ? { tipoDocumento } : {}), ...(cobertura.cobertura === "ot" ? {} : { cobertura }),
      }));
    } catch (e: any) {
      setCond(null);
      setError(e.message);
    } finally {
      setOcupado("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otId, plantillaId, tipoDocumento, cobJson, propuesta]);

  useEffect(() => {
    setPreview(null);
    comprobar();
  }, [comprobar]);

  async function previsualizar() {
    setOcupado("preview");
    setError("");
    try {
      setPreview(await api.post<Preview>("/informes/previsualizar", { otId, plantillaId, modalidad, datosInforme: datosInforme(), ...(tipoDocumento ? { tipoDocumento } : {}), ...conCobertura() }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setOcupado("");
    }
  }

  async function emitir() {
    setOcupado("emitir");
    setError("");
    try {
      const r: any = await api.post("/informes/emitir", cuerpo());
      toast.ok(`Documento ${r.numero} (${MODALIDAD[r.modalidad as Modalidad]?.corto ?? "informe"}) emitido: queda en firma.`);
      setPreview(null);
      setAbierto(r.certificado.id);
      setVersionCob((v) => v + 1);
      await Promise.all([cargarDocs(), comprobar()]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setOcupado("");
    }
  }

  const columnas: DataColumn[] = [
    { key: "numero", label: "Número", render: (c) => <span className="codigo">{c.numero}</span> },
    { key: "cobertura", label: "Cubre", value: (c) => c.cobertura ?? "Toda la OT", render: (c) => c.cobertura ?? <span style={{ color: "var(--muted)" }}>Toda la OT</span> },
    { key: "otcliente", label: "OT · Cliente", value: (c) => [c.ot?.codigo, c.ot?.cliente?.razonSocial].filter(Boolean).join(" · ") },
    { key: "plantilla", label: "Plantilla", value: (c) => (c.plantilla ? `${c.plantilla.repid} · ${c.plantilla.nombre}` : "") },
    { key: "modalidad", label: "Informe", value: (c) => textoModalidad(c.modalidad, c.tipoDocumento) ?? "", render: (c) => textoModalidad(c.modalidad, c.tipoDocumento) ?? "—" },
    { key: "fecha", label: "Emitido", value: (c) => c.fecha ?? "", render: (c) => fecha(c.fecha) },
    {
      key: "firmas", label: "Firmas", filter: false, value: (c) => c.firmasHechas,
      render: (c) => (c.firmasTotal ? `${c.firmasHechas} de ${c.firmasTotal}` : "—"),
    },
    {
      key: "estado", label: "Estado", value: (c) => (c.noEmitido ? "No emitido" : ESTADO_DOC[c.estado]?.texto ?? c.estado),
      render: (c) => {
        const e = c.noEmitido ? { texto: "No emitido", pill: "gray" } : ESTADO_DOC[c.estado] ?? { texto: c.estado, pill: "gray" };
        const pend = c.pendienteDe?.[0];
        return (
          <span>
            <span className={`pill ${e.pill}`}>{e.texto}</span>
            {pend && <small style={{ display: "block", color: "var(--muted)" }}>Le toca: {pend.rol} {pend.responsables?.join(" / ")}</small>}
          </span>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        titulo="Emitir informe o certificado"
        subtitulo={<>Rellena la plantilla con el expediente, sella el documento con SHA-256 y le asigna el número oficial de su laboratorio. El documento queda <b>en firma</b> hasta que firman todos los responsables de la matriz de firmas.</>}
        migas={[{ label: "Laboratorio" }, { label: "Emitir informe" }]}
        acciones={<Link href={"/informes/por-firmar" as any} className="btn outline">Documentos por firmar</Link>}
      />

      {error && <div className="alert warn">{error}</div>}

      <div className="card">
        <h2>1 · Documento a emitir</h2>
        <div className="form-grid">
          <div style={{ gridColumn: "span 2" }}>
            <BuscadorOt
              valor={otSel}
              onCambio={(o) => { setOtSel(o); setOtId(o?.id ?? ""); }}
              etiqueta="Orden de trabajo *"
            />
          </div>
          <div className="field">
            <label>Tipo de plantilla</label>
            <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} disabled={cargando}>
              <option value="">Todos los tipos</option>
              {tipos.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="field span-2">
            <label>Plantilla <span className="req">*</span></label>
            <select value={plantillaId} onChange={(e) => setPlantillaId(e.target.value)} disabled={cargando}>
              <option value="">{cargando ? "Cargando…" : `— Seleccione una plantilla (${plantillasVisibles.length}) —`}</option>
              {plantillasVisibles.map((p) => (
                <option key={p.id} value={p.id}>{p.repid} · {p.nombre} ({p.tipo}{p.version ? ` · ${p.version}` : ""})</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Tipo de documento (matriz de firmas)</label>
            <select value={tipoDocumento} onChange={(e) => setTipoDocumento(e.target.value)}>
              {TIPOS_DOCUMENTO.map((t) => <option key={t.valor} value={t.valor}>{t.texto}</option>)}
            </select>
          </div>
        </div>
        {listo && (
          <CoberturaDocumento otId={otId} plantillaId={plantillaId} sugerida={propuesta?.cobertura ?? null}
            valor={cobertura} onCambio={(c) => { setCobertura(c); setPreview(null); }} version={versionCob} />
        )}
      </div>

      {listo && (
        <div className="card" style={{ borderLeft: `3px solid ${cond?.puedeEmitir ? "var(--green)" : "var(--amber, #d97706)"}` }}>
          <h2>
            2 · Condiciones de emisión
            <span className="right">{ocupado === "cond" ? "Comprobando…" : cond ? `${cond.resultados.aprobados} de ${cond.resultados.total} resultados aprobados` : ""}</span>
          </h2>
          {cond && (
            <p style={{ margin: "0 0 8px", fontSize: 12.5 }}>
              Tipo de documento: <b>{TIPOS_DOCUMENTO.find((t) => t.valor === cond.tipoDocumento)?.texto ?? cond.tipoDocumento}</b>
              <span style={{ color: "var(--muted)" }}>
                {cond.tipoDocumentoOrigen === "unidad"
                  ? ` · propio de ${cond.tipoDocumentoUnidad ?? "la unidad de la OT"}`
                  : cond.tipoDocumentoOrigen === "indicado" ? " · elegido por usted" : " · según la plantilla"}
              </span>
            </p>
          )}
          {cond?.numeracion && (
            <p style={{ margin: "0 0 8px", fontSize: 12.5 }}>
              Número oficial que tendrá:{" "}
              {cond.numeracion.numero
                ? <b className="codigo">{cond.numeracion.numero}</b>
                : <b>CERT-AAAA-NNNN</b>}
              <span style={{ color: "var(--muted)" }}>
                {cond.numeracion.formato ? ` · formato ${cond.numeracion.formato}` : " · numeración general (el laboratorio no tiene formato propio)"}
                {cond.numeracion.porConfirmar ? " · formato por confirmar con el IDIC" : ""}
                {" · se asigna al emitir"}
              </span>
              {cond.numeracion.aviso && <small style={{ display: "block", color: "var(--amber, #b45309)" }}>{cond.numeracion.aviso}</small>}
            </p>
          )}
          {cond && !cond.puedeEmitir && (
            <>
              <p style={{ margin: "0 0 6px", fontWeight: 600 }}>Todavía no se puede emitir. Falta:</p>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.6 }}>
                {cond.faltantes.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
              {otId && <p className="subtitle" style={{ marginBottom: 0 }}>Revise y apruebe los resultados en <Link href={"/captura-ot" as any} style={{ color: "var(--accent)" }}>Captura y revisión por OT</Link>.</p>}
            </>
          )}
          {cond?.puedeEmitir && <p style={{ margin: "0 0 6px" }}>Todo en orden: resultados aprobados y firmantes definidos.</p>}
          {cond && cond.pasos.length > 0 && (
            <>
              <p style={{ margin: "10px 0 6px", fontWeight: 600 }}>Firmarán, en este orden:</p>
              <table className="data">
                <thead><tr><th>#</th><th>Acción</th><th>Rol · unidad</th><th>Responsables</th></tr></thead>
                <tbody>
                  {cond.pasos.map((p) => (
                    <tr key={`${p.orden}-${p.rolNombre}`}>
                      <td>{p.orden}</td>
                      <td>{ACCION_FIRMA[p.accion] ?? p.accion}</td>
                      <td>{p.rolNombre}{p.unidadCodigo ? ` · ${p.unidadCodigo}` : ""}</td>
                      <td>{nombresResponsables(p.responsables)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {cond?.pasosOmitidos && cond.pasosOmitidos.length > 0 && (
            <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "var(--muted)" }}>
              No firma:{" "}
              {cond.pasosOmitidos.map((p) => `${p.rolNombre}${p.unidadCodigo ? ` · ${p.unidadCodigo}` : ""} (${(ACCION_FIRMA[p.accion] ?? p.accion).toLowerCase()})`).join(", ")}.{" "}
              {cond.pasosOmitidos[0].motivo}
            </p>
          )}
        </div>
      )}

      {listo && propuesta && (
        <div className="card">
          <h2>
            3 · Contenido del documento
            <span className="right">
              {propuesta.conRequisito} de {propuesta.totalEnsayos} ensayo(s) con requisito
            </span>
          </h2>
          <fieldset style={{ border: 0, padding: 0, margin: "0 0 12px" }}>
            <legend style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Tipo de informe</legend>
            <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
              {(Object.keys(MODALIDAD) as Modalidad[]).map((m) => (
                <label key={m} style={{
                  display: "flex", gap: 8, alignItems: "flex-start", padding: "8px 10px", borderRadius: 7, cursor: "pointer",
                  border: `1px solid ${modalidad === m ? "var(--accent)" : "var(--line)"}`, background: modalidad === m ? "#f0fafb" : "#fff",
                }}>
                  <input type="radio" name="modalidad" value={m} checked={modalidad === m} onChange={() => { setModalidad(m); setPreview(null); }} style={{ marginTop: 3 }} />
                  <span>
                    <b style={{ fontSize: 13 }}>{MODALIDAD[m].texto}</b>
                    {propuesta.modalidad === m && <span className="pill teal" style={{ marginLeft: 6 }}>Sugerido</span>}
                    <small style={{ display: "block", color: "var(--muted)", marginTop: 2 }}>{MODALIDAD[m].ayuda}</small>
                  </span>
                </label>
              ))}
            </div>
            {modalidad === "cumplimiento" && propuesta.conRequisito < propuesta.totalEnsayos && (
              <p className="subtitle" style={{ margin: "6px 0 0" }}>
                {propuesta.totalEnsayos - propuesta.conRequisito} ensayo(s) sin requisito saldrán como «No especificado» (informativo).
                Puede fijar el requisito en <Link href={"/captura-ot" as any} style={{ color: "var(--accent)" }}>Captura y revisión por OT</Link> antes de aprobar.
              </p>
            )}
          </fieldset>

          {propuesta.formato.portada === "ivc" && (
            <fieldset style={{ border: 0, padding: 0, margin: "0 0 12px" }}>
              <legend style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Portada del IVC</legend>
              <div className="form-grid">
                {CAMPOS_PORTADA.map((c) => (
                  <div className={`field${c.ancho === 2 ? " span-2" : ""}`} key={c.clave}>
                    <label htmlFor={`portada-${c.clave}`}>{c.etiqueta}</label>
                    <input id={`portada-${c.clave}`} maxLength={c.max} value={portada[c.clave] ?? ""}
                      onChange={(e) => { setPortada({ ...portada, [c.clave]: e.target.value }); setPreview(null); }} />
                  </div>
                ))}
              </div>
              <small style={{ color: "var(--muted)" }}>Lo vacío se imprime «N/A». El N.º de O/T, su fecha, la fecha de elaboración y el N.º de páginas los pone el sistema.</small>
            </fieldset>
          )}

          {propuesta.formato.productoTerminado && (
            <fieldset style={{ border: 0, padding: 0, margin: "0 0 12px" }}>
              <legend style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Verificación del producto terminado</legend>
              {defectos.length > 0 && (
                <table className="data" style={{ marginBottom: 6 }}>
                  <thead><tr><th style={{ width: 120 }}>N.º de ítems defectuosos</th><th>Descripción de los defectos por ítem (con N.º de registro)</th><th style={{ width: 160 }}>Numeración de los defectos</th><th aria-label="Quitar" /></tr></thead>
                  <tbody>
                    {defectos.map((d, i) => (
                      <tr key={i}>
                        <td><input className="celda" aria-label={`Ítems defectuosos ${i + 1}`} value={d.items} maxLength={20} onChange={(e) => { setDefectos(defectos.map((x, j) => (j === i ? { ...x, items: e.target.value } : x))); setPreview(null); }} /></td>
                        <td><input className="celda" aria-label={`Descripción ${i + 1}`} value={d.descripcion} maxLength={600} onChange={(e) => { setDefectos(defectos.map((x, j) => (j === i ? { ...x, descripcion: e.target.value } : x))); setPreview(null); }} /></td>
                        <td><input className="celda" aria-label={`Numeración ${i + 1}`} value={d.numeracion} maxLength={60} onChange={(e) => { setDefectos(defectos.map((x, j) => (j === i ? { ...x, numeracion: e.target.value } : x))); setPreview(null); }} /></td>
                        <td><button type="button" className="btn outline sm" aria-label={`Quitar la fila ${i + 1}`} onClick={() => { setDefectos(defectos.filter((_, j) => j !== i)); setPreview(null); }}>✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <button type="button" className="btn outline sm" onClick={() => setDefectos([...defectos, { items: "", descripcion: "", numeracion: "" }])}>＋ Ítem defectuoso</button>
              <small style={{ display: "block", color: "var(--muted)", marginTop: 4 }}>Sin filas, la tabla no se imprime.</small>
            </fieldset>
          )}

          <div className="field" style={{ marginBottom: 12 }}>
            <label htmlFor="conclusion-libre">Conclusión (texto libre)</label>
            {propuesta.formato.conclusionFija && (
              <small style={{ color: "var(--muted)", marginBottom: 4 }}>Texto fijo de la plantilla: «{propuesta.formato.conclusionFija}»</small>
            )}
            <textarea id="conclusion-libre" rows={3} maxLength={4000} value={conclusion}
              onChange={(e) => { setConclusion(e.target.value); setPreview(null); }} />
          </div>

          {propuesta.formato.agrupacion === "seccion" && (
            <details style={{ marginBottom: 10 }}>
              <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 13 }}>Secciones del informe (punto, sección y componente de cada ensayo)</summary>
              <div style={{ marginTop: 8 }}>
                <EstructuraInforme otId={otId} puedeEditar={puede(["certificado.emitir", "resultado.aprobar"])}
                  onCargada={setEnsayos} onGuardada={() => setPreview(null)} />
              </div>
            </details>
          )}

          {propuesta.formato.anexoFotografico && (
            <details style={{ marginBottom: 10 }}>
              <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 13 }}>Fotos para el anexo fotográfico</summary>
              <div style={{ marginTop: 8 }}>
                <FotosInforme otId={otId} ensayos={ensayos} puedeEditar={puede(["resultado.crear", "certificado.emitir"])} onCambio={() => setPreview(null)} />
              </div>
            </details>
          )}

          {puede("plantilla.gestionar") && (
            <details open={verFormato} onToggle={(e) => setVerFormato((e.target as HTMLDetailsElement).open)}>
              <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 13 }}>Formato de la plantilla (Administración)</summary>
              {verFormato && (
                <div style={{ marginTop: 8 }}>
                  <FormatoPlantilla plantillaId={plantillaId} onGuardado={() => { setPreview(null); cargarPropuesta(); }} />
                </div>
              )}
            </details>
          )}

          <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
            <button className="btn outline" onClick={previsualizar} disabled={!!ocupado}>
              {ocupado === "preview" ? "Generando…" : "Previsualizar"}
            </button>
            <button className="btn primary" onClick={emitir} disabled={!!ocupado || !cond?.puedeEmitir}>
              {ocupado === "emitir" ? "Emitiendo…" : "Emitir y enviar a firma"}
            </button>
          </div>
        </div>
      )}

      {preview && (
        <div className="card">
          <h2>Previsualización (sin emitir) <span className="right">{preview.plantilla} · {preview.tipo}</span></h2>
          {preview.avisos.length > 0 && (
            <ul style={{ margin: "0 0 10px", paddingLeft: 18, fontSize: 12, lineHeight: 1.6 }}>
              {preview.avisos.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          )}
          <iframe title="Previsualización del informe" srcDoc={preview.html} sandbox=""
            style={{ width: "100%", height: 620, border: "1px solid var(--line)", borderRadius: 6, background: "#fff" }} />
        </div>
      )}

      <div style={{ padding: "13px 15px 0" }}>
        <h2>{otId ? "Documentos de la OT" : "Últimos documentos emitidos"} <span className="right">{docs.length}</span></h2>
      </div>
      <DataTable
        columns={columnas}
        rows={docs}
        loading={cargando}
        searchKeys={["numero", "otcliente", "plantilla"]}
        onRowClick={(c) => setAbierto(c.id)}
        acciones={(c) => <button className="btn outline sm" onClick={(e) => { e.stopPropagation(); setAbierto(c.id); }}>Ver</button>}
        vacio={<>Todavía no se ha emitido ningún documento.</>}
      />

      {abierto && (
        <Modal titulo="Documento" ancho={980} onCerrar={() => setAbierto(null)}>
          <PanelDocumento documentoId={abierto} onCambio={cargarDocs} />
        </Modal>
      )}
    </>
  );
}

export default function InformesPage() {
  return (
    <Suspense fallback={<p className="subtitle">Cargando…</p>}>
      <InformesContenido />
    </Suspense>
  );
}
