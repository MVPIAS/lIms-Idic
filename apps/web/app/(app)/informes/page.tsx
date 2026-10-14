"use client";

/**
 * Emisión de informes / certificados · LIMS IDIC
 *
 * Elegir OT + plantilla → el sistema comprueba las condiciones (resultados
 * aprobados, control de calidad, laboratorio y matriz de firmas) y muestra
 * quién firmará → previsualizar → emitir. El documento queda «En firma» y cada
 * responsable lo firma desde «Documentos por firmar»; con la última firma pasa
 * a oficial. Reglas: docs/FLUJO_FIRMA_CIERRE.md.
 */
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { fecha } from "@/lib/format";
import DataTable, { type DataColumn } from "@/components/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { toast } from "@/components/ui/feedback";
import { ACCION_FIRMA, ESTADO_DOC, nombresResponsables } from "@/lib/documentos";
import PanelDocumento from "@/components/documentos/PanelDocumento";
import Modal from "@/components/documentos/Modal";
import BuscadorOt, { type OtCorta } from "@/components/BuscadorOt";

type Plantilla = { id: string; repid: string; nombre: string; tipo: string; version?: string; activo?: boolean };
type Condiciones = {
  puedeEmitir: boolean;
  faltantes: string[];
  tipoDocumento: string;
  tipoDocumentoOrigen?: "indicado" | "plantilla" | "unidad";
  tipoDocumentoUnidad?: string | null;
  resultados: { total: number; aprobados: number };
  pasos: { orden: number; accion: string; rolNombre: string; unidadCodigo: string | null; responsables: any[] }[];
};
type Preview = { plantilla: string; tipo: string; avisos: string[]; html: string };

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
];

const lista = <T,>(r: any): T[] => (Array.isArray(r) ? r : (r?.data ?? []));

function InformesContenido() {
  const params = useSearchParams();
  // OT elegida con búsqueda en el servidor (GET /ot es paginado: no se carga una lista fija).
  const [otSel, setOtSel] = useState<OtCorta | null>(null);
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  const [otId, setOtId] = useState(params.get("otId") ?? "");
  const [plantillaId, setPlantillaId] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");
  const [tipoDocumento, setTipoDocumento] = useState("");
  const [cond, setCond] = useState<Condiciones | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState<"" | "cond" | "preview" | "emitir">("");
  const [abierto, setAbierto] = useState<string | null>(null);

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
        const inicial = params.get("otId");
        const [o, p] = await Promise.all([
          inicial ? api.getRaw<OtCorta>(`ot/${inicial}`).catch(() => null) : Promise.resolve(null),
          api.getRaw("plantillas?limit=100"),
        ]);
        if (o) setOtSel(o);
        setPlantillas(lista<Plantilla>(p).filter((x) => x.activo !== false));
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
  const cuerpo = () => ({ otId, plantillaId, ...(tipoDocumento ? { tipoDocumento } : {}) });

  // Al elegir OT + plantilla, se comprueba qué falta y quién firmará.
  const comprobar = useCallback(async () => {
    if (!otId || !plantillaId) return setCond(null);
    setOcupado("cond");
    setError("");
    try {
      setCond(await api.post<Condiciones>("/informes/condiciones", { otId, plantillaId, ...(tipoDocumento ? { tipoDocumento } : {}) }));
    } catch (e: any) {
      setCond(null);
      setError(e.message);
    } finally {
      setOcupado("");
    }
  }, [otId, plantillaId, tipoDocumento]);

  useEffect(() => {
    setPreview(null);
    comprobar();
  }, [comprobar]);

  async function previsualizar() {
    setOcupado("preview");
    setError("");
    try {
      setPreview(await api.post<Preview>("/informes/previsualizar", { otId, plantillaId }));
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
      toast.ok(`Documento ${r.numero} emitido: queda en firma.`);
      setPreview(null);
      setAbierto(r.certificado.id);
      await Promise.all([cargarDocs(), comprobar()]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setOcupado("");
    }
  }

  const columnas: DataColumn[] = [
    { key: "numero", label: "Número", render: (c) => <span className="codigo">{c.numero}</span> },
    { key: "otcliente", label: "OT · Cliente", value: (c) => [c.ot?.codigo, c.ot?.cliente?.razonSocial].filter(Boolean).join(" · ") },
    { key: "plantilla", label: "Plantilla", value: (c) => (c.plantilla ? `${c.plantilla.repid} · ${c.plantilla.nombre}` : "") },
    { key: "fecha", label: "Emitido", value: (c) => c.fecha ?? "", render: (c) => fecha(c.fecha) },
    {
      key: "firmas", label: "Firmas", filter: false, value: (c) => c.firmasHechas,
      render: (c) => (c.firmasTotal ? `${c.firmasHechas} de ${c.firmasTotal}` : "—"),
    },
    {
      key: "estado", label: "Estado", value: (c) => ESTADO_DOC[c.estado]?.texto ?? c.estado,
      render: (c) => {
        const e = ESTADO_DOC[c.estado] ?? { texto: c.estado, pill: "gray" };
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
        subtitulo={<>Rellena la plantilla con el expediente, sella el documento con SHA-256 y le asigna el correlativo. El documento queda <b>en firma</b> hasta que firman todos los responsables de la matriz de firmas.</>}
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
