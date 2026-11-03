"use client";

// ===========================================================================
// Gestor documental (contrato §4.6.1, §4.6.2, §4.6.3): árbol de carpetas a la
// izquierda; a la derecha, los documentos de la carpeta y la ficha del elegido
// con su historial de versiones, publicación, renombrado, traslado, vínculos
// (OT, muestra, cliente) y permisos por usuario. Las reglas viven en el
// servidor (apps/api/src/documentos/gestor.service.ts).
// ===========================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { llamar, qs } from "@/lib/laboratorio";
import { subirFormulario, descargarAdjunto } from "@/lib/d11";
import { fechaHora } from "@/lib/format";
import { toast } from "@/components/ui/feedback";

interface Carpeta {
  id: string;
  padreId: string | null;
  nombre: string;
  ruta: string;
  nivel: number;
  unidadId: string | null;
  unidad: string | null;
  unidadHeredada: string | null;
  documentos: number;
}
interface DocFila {
  id: string;
  codigo: string;
  titulo: string;
  carpeta: string | null;
  restringido: boolean;
  versionPublicada: number | null;
  ultimaVersion: number | null;
  archivo: string | null;
  otCodigo: string | null;
  muestraCodigo: string | null;
  cliente: string | null;
  actualizadoEn: string | null;
  creadoEn: string;
}
interface Version {
  numero: number;
  archivo: string;
  bytes: number;
  hashSha256: string;
  estado: "BORRADOR" | "PUBLICADA" | "REEMPLAZADA";
  comentario: string | null;
  subidoEn: string;
  subidoPor: string | null;
  publicadoEn: string | null;
  publicadoPor: string | null;
}
interface Ficha {
  id: string;
  codigo: string;
  titulo: string;
  descripcion: string | null;
  carpetaId: string;
  carpeta: string | null;
  restringido: boolean;
  versionPublicada: number | null;
  otCodigo: string | null;
  muestraCodigo: string | null;
  cliente: string | null;
  creadoPor: string | null;
  creadoEn: string;
  puedeEditar: boolean;
  /** Mover de carpeta, permisos y eliminar: solo quien gestiona documentos. */
  puedeAdministrar: boolean;
  versiones: Version[];
  accesos: { usuarioId: string; nombre: string; username: string; nivel: "ver" | "editar" }[];
}

const ESTADO_VERSION: Record<string, { texto: string; pill: string }> = {
  BORRADOR: { texto: "Borrador", pill: "amber" },
  PUBLICADA: { texto: "Publicada", pill: "green" },
  REEMPLAZADA: { texto: "Reemplazada", pill: "gray" },
};
const ACEPTA = ".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.pptx,.doc,.xls,.txt,.csv";
const tamano = (b: number) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`);

export default function GestorDocumentalPage() {
  const [carpetas, setCarpetas] = useState<Carpeta[]>([]);
  const [gestiona, setGestiona] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [docs, setDocs] = useState<DocFila[]>([]);
  const [texto, setTexto] = useState("");
  const [subcarpetas, setSubcarpetas] = useState(true);
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [panel, setPanel] = useState<"" | "carpeta" | "subir" | "editarCarpeta">("");
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  const cargarArbol = useCallback(async () => {
    try {
      const r = await llamar<{ puedeGestionar: boolean; carpetas: Carpeta[] }>("GET", "/documentos/carpetas");
      setCarpetas(r.carpetas);
      setGestiona(r.puedeGestionar);
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, []);
  const cargarDocs = useCallback(async () => {
    setCargando(true);
    try {
      setDocs(await llamar("GET", `/documentos/archivos${qs({ carpetaId: sel, q: texto.trim() || null, subcarpetas: sel && subcarpetas ? "true" : null })}`));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, [sel, texto, subcarpetas]);
  const abrir = useCallback(async (id: string) => {
    try {
      setFicha(await llamar("GET", `/documentos/archivos/${id}`));
    } catch (e: any) {
      toast.error(e.message);
    }
  }, []);

  useEffect(() => {
    cargarArbol();
  }, [cargarArbol]);
  useEffect(() => {
    const t = setTimeout(cargarDocs, 250);
    return () => clearTimeout(t);
  }, [cargarDocs]);

  const actual = carpetas.find((c) => c.id === sel) ?? null;
  const refrescar = async (id?: string) => {
    await Promise.all([cargarArbol(), cargarDocs()]);
    if (id) await abrir(id);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page">Gestor documental</h1>
          <p className="subtitle">
            Documentos del sistema de gestión, de los laboratorios y de clientes, en carpetas, con versiones y permisos. Los informes y certificados emitidos por el LIMS se buscan en el{" "}
            <Link href={"/documentos" as any} style={{ color: "var(--accent)" }}>buscador de documentos emitidos</Link>.
          </p>
        </div>
      </div>
      {error && <div className="alert warn" role="alert">{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(200px, 260px) minmax(0, 1fr)", gap: 12, alignItems: "start" }}>
        <nav className="card" aria-label="Carpetas" style={{ padding: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <strong style={{ fontSize: 13 }}>Carpetas</strong>
            {gestiona && (
              <button type="button" className="btn ghost sm" onClick={() => setPanel("carpeta")} title={actual ? `Nueva subcarpeta en ${actual.nombre}` : "Nueva carpeta raíz"}>
                + Carpeta
              </button>
            )}
          </div>
          <button type="button" onClick={() => { setSel(null); setFicha(null); }} style={estiloItem(0, sel === null)}>
            Todas las carpetas
          </button>
          {carpetas.map((c) => (
            <button key={c.id} type="button" onClick={() => { setSel(c.id); setFicha(null); }} style={estiloItem(c.nivel + 1, sel === c.id)} title={c.ruta}>
              <span aria-hidden>📁</span> {c.nombre}
              {c.documentos > 0 && <span style={{ color: "var(--muted)", fontSize: 11 }}> ({c.documentos})</span>}
              {(c.unidad || c.unidadHeredada) && <span className="pill gray" style={{ marginLeft: 4, fontSize: 10 }}>{(c.unidad ?? c.unidadHeredada)!.split(" · ")[0]}</span>}
            </button>
          ))}
          {!carpetas.length && <p className="subtitle" style={{ margin: 0 }}>Sin carpetas.</p>}
        </nav>

        <div>
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="toolbar" style={{ margin: 0, alignItems: "flex-end", flexWrap: "wrap", gap: 8 }}>
              <div className="field" style={{ margin: 0, flex: "1 1 240px" }}>
                <label htmlFor="g-buscar">Buscar por título, código o descripción</label>
                <input id="g-buscar" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Ej.: procedimiento de muestreo, DOC-2026-00012" />
              </div>
              {sel && (
                <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
                  <input type="checkbox" checked={subcarpetas} onChange={(e) => setSubcarpetas(e.target.checked)} style={{ width: "auto" }} />
                  Incluir subcarpetas
                </label>
              )}
              {gestiona && sel && (
                <>
                  <button type="button" className="btn sm" onClick={() => setPanel("editarCarpeta")}>Renombrar / mover carpeta</button>
                  <button type="button" className="btn primary sm" onClick={() => setPanel("subir")}>Subir documento</button>
                </>
              )}
            </div>
            {actual && <p className="subtitle" style={{ margin: "8px 0 0" }}>Carpeta: {actual.ruta}{actual.unidad ? ` · restringida a ${actual.unidad}` : actual.unidadHeredada ? ` · restringida a ${actual.unidadHeredada} (heredado)` : ""}</p>}
            {gestiona && !sel && <p className="subtitle" style={{ margin: "8px 0 0" }}>Elija una carpeta para subir documentos.</p>}
          </div>

          {panel === "carpeta" && <NuevaCarpeta padre={actual} onListo={async () => { setPanel(""); await cargarArbol(); }} onCancelar={() => setPanel("")} />}
          {panel === "editarCarpeta" && actual && (
            <EditarCarpeta carpeta={actual} carpetas={carpetas} onListo={async (borrada) => { setPanel(""); if (borrada) setSel(null); await refrescar(); }} onCancelar={() => setPanel("")} />
          )}
          {panel === "subir" && actual && <SubirDocumento carpeta={actual} onListo={async (id) => { setPanel(""); await refrescar(id); }} onCancelar={() => setPanel("")} />}

          <div className="card card--table" style={{ marginBottom: 12, overflowX: "auto" }}>
            <table className="data">
              <thead>
                <tr><th>Código</th><th>Título</th>{(!sel || subcarpetas) && <th>Carpeta</th>}<th>Versión</th><th>Vínculos</th><th>Actualizado</th></tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id} onClick={() => abrir(d.id)} style={{ cursor: "pointer", background: ficha?.id === d.id ? "rgba(37,99,235,.06)" : undefined }}>
                    <td className="codigo">{d.codigo}</td>
                    <td>
                      <button type="button" className="linklike" onClick={(e) => { e.stopPropagation(); abrir(d.id); }} style={{ background: "none", border: 0, padding: 0, color: "var(--accent)", cursor: "pointer", textAlign: "left" }}>
                        {d.titulo}
                      </button>
                      {d.restringido && <span className="pill red" style={{ marginLeft: 6 }} title="Solo usuarios autorizados">Restringido</span>}
                      {d.archivo && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{d.archivo}</div>}
                    </td>
                    {(!sel || subcarpetas) && <td style={{ fontSize: 12 }}>{d.carpeta}</td>}
                    <td>
                      {d.versionPublicada ? <span className="pill green">v{d.versionPublicada} publicada</span> : <span className="pill amber">Sin publicar</span>}
                      {d.ultimaVersion && d.ultimaVersion !== d.versionPublicada ? <span className="pill amber" style={{ marginLeft: 4 }}>v{d.ultimaVersion} borrador</span> : null}
                    </td>
                    <td style={{ fontSize: 12 }}>{[d.otCodigo && `OT ${d.otCodigo}`, d.muestraCodigo && `Muestra ${d.muestraCodigo}`, d.cliente].filter(Boolean).join(" · ") || "—"}</td>
                    <td style={{ fontSize: 12 }}>{fechaHora(d.actualizadoEn ?? d.creadoEn)}</td>
                  </tr>
                ))}
                {!docs.length && (
                  <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: 18 }}>{cargando ? "Cargando…" : "No hay documentos aquí."}</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {ficha && <FichaDocumento ficha={ficha} carpetas={carpetas} onCambio={(f) => { setFicha(f); cargarDocs(); cargarArbol(); }} onBorrado={() => { setFicha(null); refrescar(); }} />}
        </div>
      </div>
    </div>
  );
}

function estiloItem(nivel: number, activo: boolean): React.CSSProperties {
  return {
    display: "block",
    width: "100%",
    textAlign: "left",
    border: 0,
    borderRadius: 6,
    padding: "4px 6px",
    paddingLeft: 6 + nivel * 14,
    fontSize: 12.5,
    cursor: "pointer",
    background: activo ? "rgba(37,99,235,.08)" : "transparent",
    fontWeight: activo ? 600 : 400,
    color: "inherit",
  };
}

/* ---------------------------------------------------------- carpetas --- */

function useUnidades() {
  const [u, setU] = useState<{ id: string; codigo: string; nombre: string }[]>([]);
  useEffect(() => {
    llamar<any>("GET", "/ot/laboratorios")
      .then((r) => setU((Array.isArray(r) ? r : r?.data ?? []).map((x: any) => ({ id: x.id, codigo: x.codigo, nombre: x.nombre }))))
      .catch(() => setU([]));
  }, []);
  return u;
}

function NuevaCarpeta({ padre, onListo, onCancelar }: { padre: Carpeta | null; onListo: () => void; onCancelar: () => void }) {
  const unidades = useUnidades();
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [unidadId, setUnidadId] = useState("");
  const [ocupado, setOcupado] = useState(false);
  return (
    <form
      className="card"
      style={{ marginBottom: 12 }}
      onSubmit={async (e) => {
        e.preventDefault();
        setOcupado(true);
        try {
          await llamar("POST", "/documentos/carpetas", { nombre, descripcion: descripcion || undefined, padreId: padre?.id, unidadId: unidadId || undefined });
          toast.ok("Carpeta creada.");
          onListo();
        } catch (x: any) {
          toast.error(x.message);
        } finally {
          setOcupado(false);
        }
      }}
    >
      <h2 style={{ marginTop: 0 }}>{padre ? `Nueva subcarpeta en «${padre.ruta}»` : "Nueva carpeta raíz"}</h2>
      <div className="form-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        <div className="field"><label htmlFor="nc-nombre">Nombre</label><input id="nc-nombre" required maxLength={120} value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
        <div className="field">
          <label htmlFor="nc-unidad">Restringir a un laboratorio (opcional)</label>
          <select id="nc-unidad" value={unidadId} onChange={(e) => setUnidadId(e.target.value)}>
            <option value="">{padre?.unidad || padre?.unidadHeredada ? `Hereda: ${padre.unidad ?? padre.unidadHeredada}` : "Visible para todos"}</option>
            {unidades.map((u) => <option key={u.id} value={u.id}>{u.codigo} · {u.nombre}</option>)}
          </select>
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="nc-desc">Descripción</label><input id="nc-desc" maxLength={500} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} /></div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn primary sm" disabled={ocupado}>Crear carpeta</button>
        <button type="button" className="btn sm" onClick={onCancelar}>Cancelar</button>
      </div>
    </form>
  );
}

function EditarCarpeta({ carpeta, carpetas, onListo, onCancelar }: { carpeta: Carpeta; carpetas: Carpeta[]; onListo: (borrada?: boolean) => void; onCancelar: () => void }) {
  const unidades = useUnidades();
  const [nombre, setNombre] = useState(carpeta.nombre);
  const [padreId, setPadreId] = useState(carpeta.padreId ?? "");
  const [unidadId, setUnidadId] = useState(carpeta.unidadId ?? "");
  const destinos = useMemo(() => carpetas.filter((c) => c.id !== carpeta.id && !c.ruta.startsWith(`${carpeta.ruta} / `)), [carpetas, carpeta]);
  return (
    <form
      className="card"
      style={{ marginBottom: 12 }}
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await llamar("PATCH", `/documentos/carpetas/${carpeta.id}`, { nombre, padreId: padreId || null, unidadId: unidadId || null });
          toast.ok("Carpeta actualizada.");
          onListo();
        } catch (x: any) {
          toast.error(x.message);
        }
      }}
    >
      <h2 style={{ marginTop: 0 }}>Carpeta «{carpeta.ruta}»</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        <div className="field"><label htmlFor="ec-nombre">Nombre</label><input id="ec-nombre" required maxLength={120} value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
        <div className="field">
          <label htmlFor="ec-padre">Ubicación</label>
          <select id="ec-padre" value={padreId} onChange={(e) => setPadreId(e.target.value)}>
            <option value="">(raíz)</option>
            {destinos.map((c) => <option key={c.id} value={c.id}>{c.ruta}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ec-unidad">Restringida a</label>
          <select id="ec-unidad" value={unidadId} onChange={(e) => setUnidadId(e.target.value)}>
            <option value="">{carpeta.unidadHeredada ? `Hereda: ${carpeta.unidadHeredada}` : "Visible para todos"}</option>
            {unidades.map((u) => <option key={u.id} value={u.id}>{u.codigo} · {u.nombre}</option>)}
          </select>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn primary sm">Guardar</button>
        <button type="button" className="btn sm" onClick={onCancelar}>Cancelar</button>
        <button
          type="button"
          className="btn danger sm"
          style={{ marginLeft: "auto" }}
          onClick={async () => {
            if (!confirm(`¿Eliminar la carpeta «${carpeta.nombre}»? Solo se puede si está vacía.`)) return;
            try {
              await llamar("DELETE", `/documentos/carpetas/${carpeta.id}`);
              toast.ok("Carpeta eliminada.");
              onListo(true);
            } catch (x: any) {
              toast.error(x.message);
            }
          }}
        >
          Eliminar carpeta
        </button>
      </div>
    </form>
  );
}

/* -------------------------------------------------------- documentos --- */

function SubirDocumento({ carpeta, onListo, onCancelar }: { carpeta: Carpeta; onListo: (id: string) => void; onCancelar: () => void }) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [otCodigo, setOtCodigo] = useState("");
  const [muestraCodigo, setMuestraCodigo] = useState("");
  const [publicar, setPublicar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  return (
    <form
      className="card"
      style={{ marginBottom: 12 }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!archivo) return toast.error("Elija el archivo.");
        setOcupado(true);
        try {
          const f = new FormData();
          f.append("carpetaId", carpeta.id);
          if (titulo.trim()) f.append("titulo", titulo.trim());
          if (descripcion.trim()) f.append("descripcion", descripcion.trim());
          if (otCodigo.trim()) f.append("otCodigo", otCodigo.trim());
          if (muestraCodigo.trim()) f.append("muestraCodigo", muestraCodigo.trim());
          f.append("publicar", String(publicar));
          f.append("archivo", archivo, archivo.name);
          const d = await subirFormulario<{ id: string; codigo: string }>("/documentos/archivos", f);
          toast.ok(`Documento ${d.codigo} creado${publicar ? " y publicado" : " como borrador"}.`);
          onListo(d.id);
        } catch (x: any) {
          toast.error(x.message);
        } finally {
          setOcupado(false);
        }
      }}
    >
      <h2 style={{ marginTop: 0 }}>Subir documento a «{carpeta.ruta}»</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="sd-archivo">Archivo (PDF, Word, Excel, PowerPoint, imagen o texto; máx. 20 MB)</label>
          <input id="sd-archivo" type="file" accept={ACEPTA} required onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
        </div>
        <div className="field"><label htmlFor="sd-titulo">Título (si se deja vacío, el nombre del archivo)</label><input id="sd-titulo" maxLength={200} value={titulo} onChange={(e) => setTitulo(e.target.value)} /></div>
        <div className="field"><label htmlFor="sd-ot">OT vinculada (código, opcional)</label><input id="sd-ot" value={otCodigo} onChange={(e) => setOtCodigo(e.target.value)} placeholder="OT-2026-0001" /></div>
        <div className="field"><label htmlFor="sd-muestra">Muestra vinculada (código, opcional)</label><input id="sd-muestra" value={muestraCodigo} onChange={(e) => setMuestraCodigo(e.target.value)} /></div>
        <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="sd-desc">Descripción</label><input id="sd-desc" maxLength={2000} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} /></div>
      </div>
      <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, marginBottom: 10 }}>
        <input type="checkbox" checked={publicar} onChange={(e) => setPublicar(e.target.checked)} style={{ width: "auto" }} />
        Publicar ahora (si no, queda como borrador y solo lo ven quienes pueden editarlo; quienes solo consultan no lo ven hasta que se publique)
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn primary sm" disabled={ocupado}>{ocupado ? "Subiendo…" : "Subir"}</button>
        <button type="button" className="btn sm" onClick={onCancelar}>Cancelar</button>
      </div>
    </form>
  );
}

function FichaDocumento({ ficha, carpetas, onCambio, onBorrado }: { ficha: Ficha; carpetas: Carpeta[]; onCambio: (f: Ficha) => void; onBorrado: () => void }) {
  const [modo, setModo] = useState<"" | "editar" | "version" | "permisos">("");
  useEffect(() => setModo(""), [ficha.id]);
  const accion = async (fn: () => Promise<Ficha>, ok: string) => {
    try {
      onCambio(await fn());
      toast.ok(ok);
      setModo("");
    } catch (x: any) {
      toast.error(x.message);
    }
  };
  return (
    <section className="card" aria-label={`Documento ${ficha.codigo}`} style={{ overflowX: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div className="codigo" style={{ fontSize: 12 }}>{ficha.codigo}</div>
          <h2 style={{ margin: "2px 0 4px" }}>{ficha.titulo}</h2>
          <p className="subtitle" style={{ margin: 0 }}>
            {ficha.carpeta} · creado por {ficha.creadoPor ?? "—"} el {fechaHora(ficha.creadoEn)}
            {ficha.restringido && <> · <span className="pill red">Restringido</span></>}
          </p>
          {ficha.descripcion && <p style={{ margin: "6px 0 0", fontSize: 13 }}>{ficha.descripcion}</p>}
          <p style={{ margin: "6px 0 0", fontSize: 12.5 }}>
            Vínculos: {[ficha.otCodigo && `OT ${ficha.otCodigo}`, ficha.muestraCodigo && `muestra ${ficha.muestraCodigo}`, ficha.cliente && `cliente ${ficha.cliente}`].filter(Boolean).join(" · ") || "ninguno"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "flex-start", flexWrap: "wrap" }}>
          {ficha.versionPublicada && (
            <button type="button" className="btn primary sm" onClick={() => descargarAdjunto(`/documentos/archivos/${ficha.id}/descargar`, ficha.versiones.find((v) => v.numero === ficha.versionPublicada)?.archivo ?? ficha.codigo).catch((x) => toast.error(x.message))}>
              Descargar v{ficha.versionPublicada}
            </button>
          )}
          {ficha.puedeEditar && (
            <>
              <button type="button" className="btn sm" onClick={() => setModo(modo === "version" ? "" : "version")}>Nueva versión</button>
              <button type="button" className="btn sm" onClick={() => setModo(modo === "editar" ? "" : "editar")}>{ficha.puedeAdministrar ? "Renombrar / mover" : "Renombrar"}</button>
            </>
          )}
          {ficha.puedeAdministrar && (
            <>
              <button type="button" className="btn sm" onClick={() => setModo(modo === "permisos" ? "" : "permisos")}>Permisos</button>
              <button
                type="button"
                className="btn danger sm"
                onClick={async () => {
                  if (!confirm(`¿Eliminar el documento ${ficha.codigo}? Queda registrado en la bitácora.`)) return;
                  try {
                    await llamar("DELETE", `/documentos/archivos/${ficha.id}`);
                    toast.ok("Documento eliminado.");
                    onBorrado();
                  } catch (x: any) {
                    toast.error(x.message);
                  }
                }}
              >
                Eliminar
              </button>
            </>
          )}
        </div>
      </div>

      {modo === "version" && <NuevaVersion ficha={ficha} onListo={(f) => { onCambio(f); setModo(""); }} />}
      {modo === "editar" && <EditarDocumento ficha={ficha} carpetas={carpetas} onGuardar={(b) => accion(() => llamar("PATCH", `/documentos/archivos/${ficha.id}`, b), "Documento actualizado.")} />}
      {modo === "permisos" && <Permisos ficha={ficha} onGuardar={(b) => accion(() => llamar("PUT", `/documentos/archivos/${ficha.id}/accesos`, b), "Permisos guardados.")} />}

      <h3 style={{ fontSize: 13, margin: "14px 0 6px" }}>Historial de versiones</h3>
      <table className="data">
        <thead><tr><th>Versión</th><th>Archivo</th><th>Estado</th><th>Subida</th><th>Publicada</th><th>Comentario</th><th /></tr></thead>
        <tbody>
          {ficha.versiones.map((v) => {
            const e = ESTADO_VERSION[v.estado];
            return (
              <tr key={v.numero}>
                <td>v{v.numero}</td>
                <td style={{ fontSize: 12 }}>{v.archivo}<div style={{ color: "var(--muted)", fontSize: 11 }} title={`SHA-256 ${v.hashSha256}`}>{tamano(v.bytes)} · SHA-256 {v.hashSha256.slice(0, 12)}…</div></td>
                <td><span className={`pill ${e.pill}`}>{e.texto}</span></td>
                <td style={{ fontSize: 12 }}>{fechaHora(v.subidoEn)}<div style={{ color: "var(--muted)" }}>{v.subidoPor ?? ""}</div></td>
                <td style={{ fontSize: 12 }}>{v.publicadoEn ? <>{fechaHora(v.publicadoEn)}<div style={{ color: "var(--muted)" }}>{v.publicadoPor ?? ""}</div></> : "—"}</td>
                <td style={{ fontSize: 12 }}>{v.comentario ?? "—"}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <button type="button" className="btn ghost sm" onClick={() => descargarAdjunto(`/documentos/archivos/${ficha.id}/descargar?numero=${v.numero}`, v.archivo).catch((x) => toast.error(x.message))}>Descargar</button>
                  {ficha.puedeEditar && v.estado !== "PUBLICADA" && (
                    <button type="button" className="btn sm" onClick={() => accion(() => llamar("POST", `/documentos/archivos/${ficha.id}/versiones/${v.numero}/publicar`), `Versión ${v.numero} publicada.`)}>
                      Publicar
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
          {!ficha.versiones.length && <tr><td colSpan={7} style={{ color: "var(--muted)", textAlign: "center" }}>Aún no hay versión publicada.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}

function NuevaVersion({ ficha, onListo }: { ficha: Ficha; onListo: (f: Ficha) => void }) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [comentario, setComentario] = useState("");
  const [publicar, setPublicar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  return (
    <form
      style={{ borderTop: "1px solid var(--line)", marginTop: 12, paddingTop: 10 }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!archivo) return toast.error("Elija el archivo.");
        setOcupado(true);
        try {
          const f = new FormData();
          if (comentario.trim()) f.append("comentario", comentario.trim());
          f.append("publicar", String(publicar));
          f.append("archivo", archivo, archivo.name);
          onListo(await subirFormulario<Ficha>(`/documentos/archivos/${ficha.id}/versiones`, f));
          toast.ok(publicar ? "Versión subida y publicada." : "Versión subida como borrador.");
        } catch (x: any) {
          toast.error(x.message);
        } finally {
          setOcupado(false);
        }
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        <div className="field"><label htmlFor="nv-archivo">Archivo de la nueva versión</label><input id="nv-archivo" type="file" accept={ACEPTA} required onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} /></div>
        <div className="field"><label htmlFor="nv-coment">Qué cambia</label><input id="nv-coment" maxLength={500} value={comentario} onChange={(e) => setComentario(e.target.value)} /></div>
      </div>
      <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, marginBottom: 8 }}>
        <input type="checkbox" checked={publicar} onChange={(e) => setPublicar(e.target.checked)} style={{ width: "auto" }} />
        Publicar al subir (la versión publicada anterior pasa a «Reemplazada»)
      </label>
      <button className="btn primary sm" disabled={ocupado}>{ocupado ? "Subiendo…" : "Subir versión"}</button>
    </form>
  );
}

function EditarDocumento({ ficha, carpetas, onGuardar }: { ficha: Ficha; carpetas: Carpeta[]; onGuardar: (b: any) => void }) {
  const [titulo, setTitulo] = useState(ficha.titulo);
  const [descripcion, setDescripcion] = useState(ficha.descripcion ?? "");
  const [carpetaId, setCarpetaId] = useState(ficha.carpetaId);
  const [otCodigo, setOtCodigo] = useState(ficha.otCodigo ?? "");
  const [muestraCodigo, setMuestraCodigo] = useState(ficha.muestraCodigo ?? "");
  return (
    <form
      style={{ borderTop: "1px solid var(--line)", marginTop: 12, paddingTop: 10 }}
      onSubmit={(e) => {
        e.preventDefault();
        onGuardar({ titulo, descripcion, carpetaId, otCodigo, muestraCodigo });
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        <div className="field"><label htmlFor="ed-titulo">Título</label><input id="ed-titulo" required maxLength={200} value={titulo} onChange={(e) => setTitulo(e.target.value)} /></div>
        {ficha.puedeAdministrar ? (
          <div className="field">
            <label htmlFor="ed-carpeta">Carpeta</label>
            <select id="ed-carpeta" value={carpetaId} onChange={(e) => setCarpetaId(e.target.value)}>
              {carpetas.map((c) => <option key={c.id} value={c.id}>{c.ruta}</option>)}
            </select>
          </div>
        ) : (
          <div className="field">
            <label>Carpeta</label>
            <div style={{ fontSize: 12.5, padding: "6px 0" }}>{ficha.carpeta} <span style={{ color: "var(--muted)" }}>(moverlo de carpeta lo hace quien gestiona documentos)</span></div>
          </div>
        )}
        <div className="field"><label htmlFor="ed-ot">OT (código; vacío = sin OT)</label><input id="ed-ot" value={otCodigo} onChange={(e) => setOtCodigo(e.target.value)} /></div>
        <div className="field"><label htmlFor="ed-muestra">Muestra (código)</label><input id="ed-muestra" value={muestraCodigo} onChange={(e) => setMuestraCodigo(e.target.value)} /></div>
        <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="ed-desc">Descripción</label><input id="ed-desc" maxLength={2000} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} /></div>
      </div>
      <button className="btn primary sm">Guardar cambios</button>
    </form>
  );
}

function Permisos({ ficha, onGuardar }: { ficha: Ficha; onGuardar: (b: any) => void }) {
  const [restringido, setRestringido] = useState(ficha.restringido);
  const [lista, setLista] = useState(ficha.accesos);
  const [buscar, setBuscar] = useState("");
  const [opciones, setOpciones] = useState<{ id: string; nombre: string; username: string }[]>([]);
  useEffect(() => {
    if (buscar.trim().length < 2) return setOpciones([]);
    const t = setTimeout(() => llamar<any[]>("GET", `/documentos/usuarios${qs({ q: buscar.trim() })}`).then(setOpciones).catch(() => setOpciones([])), 250);
    return () => clearTimeout(t);
  }, [buscar]);
  return (
    <form
      style={{ borderTop: "1px solid var(--line)", marginTop: 12, paddingTop: 10 }}
      onSubmit={(e) => {
        e.preventDefault();
        onGuardar({ restringido, accesos: lista.map((a) => ({ usuarioId: a.usuarioId, nivel: a.nivel })) });
      }}
    >
      <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, marginBottom: 8 }}>
        <input type="checkbox" checked={restringido} onChange={(e) => setRestringido(e.target.checked)} style={{ width: "auto" }} />
        Restringido: solo lo ven las personas de esta lista, quien lo creó y los perfiles globales
      </label>
      <div className="field" style={{ maxWidth: 360 }}>
        <label htmlFor="pe-buscar">Agregar persona (nombre o usuario)</label>
        <input id="pe-buscar" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
      </div>
      {opciones.length > 0 && (
        <ul style={{ margin: "0 0 8px", paddingLeft: 18, fontSize: 12.5 }}>
          {opciones.filter((o) => !lista.some((a) => a.usuarioId === o.id)).map((o) => (
            <li key={o.id}>
              {o.nombre} ({o.username}){" "}
              <button type="button" className="btn ghost sm" onClick={() => { setLista([...lista, { usuarioId: o.id, nombre: o.nombre, username: o.username, nivel: "ver" }]); setBuscar(""); }}>Agregar</button>
            </li>
          ))}
        </ul>
      )}
      <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--muted)" }}>
        «Ver»: consulta y descarga la versión publicada. «Ver y editar»: además sube versiones nuevas, las publica y cambia título,
        descripción y vínculos de este documento, aunque no gestione documentos. Mover de carpeta, cambiar permisos y eliminar
        quedan para quienes gestionan documentos.
      </p>
      <table className="data" style={{ marginBottom: 8 }}>
        <thead><tr><th>Persona</th><th>Permiso</th><th /></tr></thead>
        <tbody>
          {lista.map((a) => (
            <tr key={a.usuarioId}>
              <td>{a.nombre} <span style={{ color: "var(--muted)" }}>({a.username})</span></td>
              <td>
                <select aria-label={`Permiso de ${a.nombre}`} value={a.nivel} onChange={(e) => setLista(lista.map((x) => (x.usuarioId === a.usuarioId ? { ...x, nivel: e.target.value as "ver" | "editar" } : x)))}>
                  <option value="ver">Ver</option>
                  <option value="editar">Ver y editar</option>
                </select>
              </td>
              <td style={{ textAlign: "right" }}><button type="button" className="btn ghost sm" onClick={() => setLista(lista.filter((x) => x.usuarioId !== a.usuarioId))}>Quitar</button></td>
            </tr>
          ))}
          {!lista.length && <tr><td colSpan={3} style={{ color: "var(--muted)", textAlign: "center" }}>Nadie en la lista.</td></tr>}
        </tbody>
      </table>
      <button className="btn primary sm">Guardar permisos</button>
    </form>
  );
}
