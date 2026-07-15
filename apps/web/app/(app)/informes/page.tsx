"use client";

/**
 * Emisión de informes / certificados · LIMS IDIC
 *
 * Elegir OT + plantilla -> previsualizar el documento renderizado -> emitir.
 * Al emitir, el sistema asigna el correlativo (CERT-AAAA-NNNN), sella el
 * documento con SHA-256 y devuelve el código de verificación; desde aquí se
 * descarga el PDF.
 *
 * NOTA DE INTEGRACIÓN: esta pantalla no está enlazada en `Sidebar.tsx` (fuera
 * del dominio de este cambio). Se llega por /informes; añada el enlace al integrar.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const auth = () => ({
  Authorization: `Bearer ${localStorage.getItem("lims_token")}`,
  "Content-Type": "application/json",
});

type Ot = { id: string; codigo: string; estado?: string; cliente?: { razonSocial?: string } };
type Plantilla = { id: string; repid: string; nombre: string; tipo: string; version?: string; activo?: boolean };
type Certificado = {
  id: string;
  numero?: string | null;
  codigo: string;
  tipo?: string | null;
  estado: string;
  fecha?: string;
  hashSha256?: string | null;
  codigoVerificacion?: string | null;
  ot?: { codigo?: string; cliente?: { razonSocial?: string } };
  plantilla?: { repid?: string; nombre?: string };
};
type Emision = {
  certificado: Certificado;
  numero: string;
  codigoVerificacion: string;
  hash: string;
  urlVerificacion: string;
  usaPlantillaPorDefecto: boolean;
  avisos: string[];
  html: string;
};
type Preview = {
  plantilla: string;
  plantillaNombre: string;
  tipo: string;
  usaPlantillaPorDefecto: boolean;
  avisos: string[];
  hash: string;
  html: string;
};

const PILL_ESTADO: Record<string, string> = { emitido: "green", anulado: "red" };

/** Lee `{data:[]}` o un array pelado, según el endpoint. */
const lista = <T,>(r: any): T[] => (Array.isArray(r) ? r : (r?.data ?? []));

const etiquetaOt = (o: Ot) => [o.codigo, o.cliente?.razonSocial].filter(Boolean).join(" · ");

export default function InformesPage() {
  const [ots, setOts] = useState<Ot[]>([]);
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [certs, setCerts] = useState<Certificado[]>([]);

  const [otId, setOtId] = useState("");
  const [plantillaId, setPlantillaId] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");

  const [preview, setPreview] = useState<Preview | null>(null);
  const [emision, setEmision] = useState<Emision | null>(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState<"" | "preview" | "emitir" | "pdf">("");

  /** Certificados emitidos: se recarga tras emitir. */
  const cargarCertificados = useCallback(async () => {
    const r = await fetch(`${API}/certificados?limit=50`, { headers: auth() }).then((x) => x.json());
    setCerts(lista<Certificado>(r));
  }, []);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [o, p] = await Promise.all([
        fetch(`${API}/ot?limit=200`, { headers: auth() }).then((x) => x.json()),
        fetch(`${API}/plantillas?limit=200`, { headers: auth() }).then((x) => x.json()),
      ]);
      setOts(lista<Ot>(o));
      setPlantillas(lista<Plantilla>(p).filter((x) => x.activo !== false));
      await cargarCertificados();
    } catch (e: any) {
      setError(e?.message ?? "No se pudieron cargar los datos");
    } finally {
      setCargando(false);
    }
  }, [cargarCertificados]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const tipos = useMemo(
    () => [...new Set(plantillas.map((p) => p.tipo))].sort(),
    [plantillas],
  );
  const plantillasVisibles = useMemo(
    () => plantillas.filter((p) => !filtroTipo || p.tipo === filtroTipo),
    [plantillas, filtroTipo],
  );

  /** Al cambiar el filtro, la plantilla elegida puede dejar de ser visible. */
  useEffect(() => {
    if (plantillaId && !plantillasVisibles.some((p) => p.id === plantillaId)) setPlantillaId("");
  }, [plantillasVisibles, plantillaId]);

  /** Cambiar OT/plantilla invalida lo que hubiera en pantalla. */
  function elegirOt(v: string) {
    setOtId(v);
    setPreview(null);
    setEmision(null);
  }
  function elegirPlantilla(v: string) {
    setPlantillaId(v);
    setPreview(null);
    setEmision(null);
  }

  async function llamar<T>(ruta: string): Promise<T> {
    const r = await fetch(`${API}/informes/${ruta}`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ otId, plantillaId }),
    });
    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      throw new Error(b?.message ?? `Error ${r.status}`);
    }
    return r.json();
  }

  async function previsualizar() {
    setError("");
    setOcupado("preview");
    try {
      setEmision(null);
      setPreview(await llamar<Preview>("previsualizar"));
    } catch (e: any) {
      setError(e?.message ?? "No se pudo previsualizar");
    } finally {
      setOcupado("");
    }
  }

  async function emitir() {
    setError("");
    setOcupado("emitir");
    try {
      const r = await llamar<Emision>("emitir");
      setEmision(r);
      setPreview(null);
      await cargarCertificados();
    } catch (e: any) {
      setError(e?.message ?? "No se pudo emitir");
    } finally {
      setOcupado("");
    }
  }

  /**
   * El PDF va tras el guard JWT, así que un <a href> plano daría 401: hay que
   * pedirlo con la cabecera y abrir el blob. Se revoca la URL al momento para
   * no retener el documento en memoria.
   */
  async function descargarPdf(certificadoId: string, numero: string) {
    setError("");
    setOcupado("pdf");
    try {
      const r = await fetch(`${API}/informes/${certificadoId}/pdf`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("lims_token")}` },
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        throw new Error(b?.message ?? `Error ${r.status} al generar el PDF`);
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${numero || "informe"}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo descargar el PDF");
    } finally {
      setOcupado("");
    }
  }

  const listo = !!otId && !!plantillaId;
  const doc = preview ?? emision;
  const avisos = doc?.avisos ?? [];

  return (
    <>
      <h1 className="page">Emisión de informes y certificados</h1>
      <p className="subtitle">
        Rellena la plantilla con los datos del expediente (OT, cliente, muestras y resultados), sella el
        documento con SHA-256 y le asigna el correlativo <span className="tag">CERT-AAAA-NNNN</span>.
      </p>

      {error && (
        <div className="card" style={{ borderLeft: "3px solid var(--red)" }}>
          <b style={{ color: "var(--red)" }}>Error:</b> {error}
        </div>
      )}

      {/* ------------------------------ Selección ------------------------------ */}
      <div className="card">
        <h2>
          1 · Documento a emitir
          <span className="right">{plantillas.length} plantillas · {ots.length} OT</span>
        </h2>
        <div className="form-grid">
          <div className="field span-2">
            <label>Orden de trabajo <span className="req">*</span></label>
            <select value={otId} onChange={(e) => elegirOt(e.target.value)} disabled={cargando}>
              <option value="">{cargando ? "Cargando…" : "— Seleccione una OT —"}</option>
              {ots.map((o) => (
                <option key={o.id} value={o.id}>{etiquetaOt(o)}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Tipo de plantilla</label>
            <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} disabled={cargando}>
              <option value="">Todos los tipos</option>
              {tipos.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="field span-3">
            <label>Plantilla <span className="req">*</span></label>
            <select value={plantillaId} onChange={(e) => elegirPlantilla(e.target.value)} disabled={cargando}>
              <option value="">
                {cargando ? "Cargando…" : `— Seleccione una plantilla (${plantillasVisibles.length}) —`}
              </option>
              {plantillasVisibles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.repid} · {p.nombre} ({p.tipo}{p.version ? ` · ${p.version}` : ""})
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
          <button className="btn outline" onClick={previsualizar} disabled={!listo || !!ocupado}>
            {ocupado === "preview" ? "Generando…" : "Previsualizar"}
          </button>
          <button className="btn primary" onClick={emitir} disabled={!listo || !!ocupado}>
            {ocupado === "emitir" ? "Emitiendo…" : "Emitir certificado"}
          </button>
          <span className="spacer" />
          {!listo && <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Elija OT y plantilla para continuar.</span>}
        </div>
      </div>

      {/* ------------------------------- Avisos -------------------------------- */}
      {avisos.length > 0 && (
        <div className="card" style={{ borderLeft: "3px solid var(--amber, #d97706)" }}>
          <h2>Avisos del motor de plantillas</h2>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.6 }}>
            {avisos.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ------------------------- Resultado de la emisión ---------------------- */}
      {emision && (
        <div className="card" style={{ borderLeft: "3px solid var(--green)" }}>
          <h2>
            Certificado emitido <span className="right"><span className="pill green">emitido</span></span>
          </h2>
          <div className="form-grid cols-4">
            <div className="field readonly">
              <label>Número correlativo</label>
              <input value={emision.numero} readOnly />
            </div>
            <div className="field readonly">
              <label>Código de verificación</label>
              <input value={emision.codigoVerificacion} readOnly style={{ letterSpacing: 1 }} />
            </div>
            <div className="field readonly span-2">
              <label>Sello de integridad (SHA-256)</label>
              <input
                value={emision.hash}
                readOnly
                style={{ fontFamily: "'JetBrains Mono', Consolas, monospace", fontSize: 10.5 }}
              />
            </div>
          </div>
          <div className="toolbar" style={{ marginTop: 11, marginBottom: 0 }}>
            <button
              className="btn success"
              onClick={() => descargarPdf(emision.certificado.id, emision.numero)}
              disabled={!!ocupado}
            >
              {ocupado === "pdf" ? "Generando PDF…" : "Descargar PDF"}
            </button>
            <span className="spacer" />
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              Verificable en {emision.urlVerificacion}
            </span>
          </div>
        </div>
      )}

      {/* ----------------------------- Documento ------------------------------- */}
      {doc && (
        <div className="card">
          <h2>
            {preview ? "2 · Previsualización (sin emitir)" : "Documento emitido"}
            <span className="right">
              {preview ? `${preview.plantilla} · ${preview.tipo}` : emision?.numero}
            </span>
          </h2>
          {/*
            sandbox="" : sin allow-scripts ni allow-same-origin. El documento se
            pinta pero no puede ejecutar JS ni tocar la sesión, aunque una
            plantilla llevara <script>. Los DATOS ya van escapados en el servidor;
            esto es la segunda barrera.
          */}
          <iframe
            title="Previsualización del informe"
            srcDoc={doc.html}
            sandbox=""
            style={{ width: "100%", height: 620, border: "1px solid var(--line)", borderRadius: 6, background: "#fff" }}
          />
        </div>
      )}

      {/* -------------------------- Certificados emitidos ---------------------- */}
      <div className="card card--table">
        <div style={{ padding: "13px 15px 0" }}>
          <h2>
            Certificados emitidos <span className="right">{certs.length} últimos</span>
          </h2>
        </div>
        <table className="data">
          <thead>
            <tr>
              <th>Número</th>
              <th>Tipo</th>
              <th>OT · Cliente</th>
              <th>Plantilla</th>
              <th>Fecha</th>
              <th>Estado</th>
              <th style={{ width: 110 }}></th>
            </tr>
          </thead>
          <tbody>
            {certs.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", color: "var(--muted)", padding: 18 }}>
                  {cargando ? "Cargando…" : "Todavía no se ha emitido ningún certificado."}
                </td>
              </tr>
            )}
            {certs.map((c) => (
              <tr key={c.id}>
                <td><span className="codigo">{c.numero ?? c.codigo}</span></td>
                <td>{c.tipo ? <span className="tag">{c.tipo}</span> : "—"}</td>
                <td>
                  {[c.ot?.codigo, c.ot?.cliente?.razonSocial].filter(Boolean).join(" · ") || "—"}
                </td>
                <td>{c.plantilla?.repid ? `${c.plantilla.repid} · ${c.plantilla.nombre}` : "—"}</td>
                <td>{c.fecha ? new Date(c.fecha).toLocaleDateString("es-CL") : "—"}</td>
                <td>
                  <span className={`pill ${PILL_ESTADO[c.estado] ?? "gray"}`}>{c.estado}</span>
                </td>
                <td>
                  <button
                    className="btn outline sm"
                    onClick={() => descargarPdf(c.id, c.numero ?? c.codigo)}
                    disabled={!!ocupado}
                  >
                    PDF
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
