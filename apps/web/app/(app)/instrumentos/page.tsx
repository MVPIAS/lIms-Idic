"use client";

// ===========================================================================
// Datos de instrumentos (contrato §4.4.6, §4.4.7). Tres pestañas:
//   · Cargar archivo: se elige el perfil del instrumento, se sube el archivo
//     (CSV, TXT o XML) y se revisa la vista previa fila a fila antes de capturar;
//   · Historial: archivos leídos, a mano o desde la carpeta automática, con el
//     original descargable;
//   · Perfiles: cómo exporta cada instrumento (quien configura).
// Las reglas viven en el servidor: apps/api/src/instrumentos/instrumentos.service.ts.
// ===========================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { llamar, qs } from "@/lib/laboratorio";
import { subirFormulario, descargarAdjunto } from "@/lib/d11";
import { fechaHora } from "@/lib/format";
import { toast } from "@/components/ui/feedback";

type Pestana = "cargar" | "historial" | "perfiles";

interface Perfil {
  id: string;
  nombre: string;
  descripcion: string | null;
  equipoId: string | null;
  equipo: string | null;
  unidadId: string | null;
  unidad: string | null;
  formato: "CSV" | "TXT" | "XML";
  separador: string;
  decimal: "," | ".";
  filaCabecera: number;
  elementoRegistro: string | null;
  colMuestra: string;
  colEnsayo: string | null;
  colValor: string;
  colUnidad: string | null;
  colFecha: string | null;
  ensayoFijo: string | null;
  equivalencias: Record<string, string>;
  carpeta: string | null;
  responsableId: string | null;
  responsable: string | null;
  activo: boolean;
}
interface Meta {
  puedeConfigurar: boolean;
  lecturaAutomatica: boolean;
  perfiles: Perfil[];
}
interface Fila {
  fila: number;
  muestra: string;
  ensayo: string;
  ensayoArchivo?: string;
  valor: string;
  unidad: string | null;
  estado: string;
  detalle: string | null;
  resultadoId: string | null;
  otCodigo: string | null;
  ensayoLims: string | null;
  valorAnterior: string | null;
}
interface Vista {
  id: string;
  perfil?: string;
  archivo: string;
  hashSha256: string;
  estado?: string;
  yaImportado?: { creadoEn: string }[];
  puedeAplicar?: boolean;
  resumen: Record<string, number>;
  filas: Fila[];
}

const ESTADO: Record<string, { texto: string; pill: string }> = {
  listo: { texto: "Se captura", pill: "green" },
  corrige: { texto: "Corrige (con motivo)", pill: "amber" },
  capturado: { texto: "Capturado", pill: "green" },
  bloqueado: { texto: "No se toca", pill: "gray" },
  duplicado: { texto: "Repetida", pill: "gray" },
  sin_muestra: { texto: "Sin muestra", pill: "red" },
  sin_ensayo: { texto: "Sin ensayo", pill: "red" },
  ambiguo: { texto: "Ambiguo", pill: "red" },
  otra_ot: { texto: "Otra OT", pill: "red" },
  fuera_alcance: { texto: "Fuera de alcance", pill: "red" },
  invalido: { texto: "Fila incompleta", pill: "red" },
  aviso: { texto: "Aviso de regla", pill: "amber" },
  error: { texto: "Error", pill: "red" },
};
const SEPARADORES: Record<string, string> = { auto: "Detectar", ";": "Punto y coma (;)", ",": "Coma (,)", "\t": "Tabulador", "|": "Barra (|)", espacios: "Espacios (columnas alineadas)" };

export default function InstrumentosPage() {
  const [pestana, setPestana] = useState<Pestana>("cargar");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState("");
  const cargar = useCallback(async () => {
    try {
      setMeta(await llamar<Meta>("GET", "/instrumentos/perfiles"));
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    cargar();
  }, [cargar]);
  const tab = (id: Pestana, t: string) => (
    <button type="button" role="tab" aria-selected={pestana === id} className={`tab${pestana === id ? " active" : ""}`} onClick={() => setPestana(id)}>{t}</button>
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page">Datos de instrumentos</h1>
          <p className="subtitle">
            Cargue el archivo que exporta un equipo (CSV, TXT o XML): el LIMS reconoce la muestra y el ensayo de cada fila, muestra lo que va a capturar y lo registra en la OT con las mismas reglas que la captura a mano. Los valores quedan «capturados», pendientes de revisión.
          </p>
        </div>
      </div>
      {error && <div className="alert warn" role="alert">{error}</div>}
      <div className="tabs" role="tablist" style={{ marginBottom: 12 }}>
        {tab("cargar", "Cargar archivo")}
        {tab("historial", "Historial")}
        {tab("perfiles", "Perfiles de instrumento")}
      </div>
      {meta && pestana === "cargar" && <Cargar meta={meta} />}
      {meta && pestana === "historial" && <Historial meta={meta} />}
      {meta && pestana === "perfiles" && <Perfiles meta={meta} onCambio={cargar} />}
    </div>
  );
}

/* ============================================================== cargar === */

function Cargar({ meta }: { meta: Meta }) {
  const activos = meta.perfiles.filter((p) => p.activo);
  const [perfilId, setPerfilId] = useState(activos[0]?.id ?? "");
  const [otCodigo, setOtCodigo] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [vista, setVista] = useState<Vista | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const leer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!archivo) return;
    setOcupado(true);
    try {
      const f = new FormData();
      f.append("perfilId", perfilId);
      if (otCodigo.trim()) f.append("otCodigo", otCodigo.trim());
      f.append("archivo", archivo, archivo.name);
      setVista(await subirFormulario<Vista>("/instrumentos/importaciones", f));
    } catch (x: any) {
      toast.error(x.message);
    } finally {
      setOcupado(false);
    }
  };

  if (!activos.length)
    return <div className="card"><p style={{ margin: 0 }}>No hay perfiles de instrumento activos en su alcance.{meta.puedeConfigurar ? " Cree uno en la pestaña «Perfiles de instrumento»." : " Pida a su jefatura que configure el instrumento."}</p></div>;

  return (
    <>
      <form className="card" onSubmit={leer} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, alignItems: "end" }}>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="in-perfil">Instrumento (perfil)</label>
          <select id="in-perfil" value={perfilId} onChange={(e) => setPerfilId(e.target.value)}>
            {activos.map((p) => <option key={p.id} value={p.id}>{p.nombre} · {p.formato}</option>)}
          </select>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="in-ot">OT (opcional, para limitar)</label>
          <input id="in-ot" value={otCodigo} onChange={(e) => setOtCodigo(e.target.value)} placeholder="Ej.: OT-2026-0139" maxLength={40} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="in-arch">Archivo del instrumento</label>
          <input id="in-arch" type="file" accept=".csv,.txt,.tsv,.xml,.dat,.prn" onChange={(e) => { setArchivo(e.target.files?.[0] ?? null); setVista(null); }} />
        </div>
        <button className="btn primary sm" disabled={!archivo || !perfilId || ocupado}>{ocupado ? "Leyendo…" : "Leer y revisar"}</button>
      </form>
      {vista && <VistaPrevia vista={vista} onCambio={setVista} />}
    </>
  );
}

function Resumen({ r }: { r: Record<string, number> }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {Object.entries(r).map(([k, n]) => (
        <span key={k} className={`pill ${ESTADO[k]?.pill ?? "gray"}`}>{ESTADO[k]?.texto ?? k}: {n}</span>
      ))}
    </div>
  );
}

function VistaPrevia({ vista, onCambio }: { vista: Vista; onCambio: (v: Vista | null) => void }) {
  const pendiente = (vista.estado ?? "PREVISTA") === "PREVISTA" && vista.puedeAplicar !== false;
  const [corregir, setCorregir] = useState<Set<number>>(new Set());
  const [motivo, setMotivo] = useState("");
  const [confirmar, setConfirmar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const listas = vista.filas.filter((f) => f.estado === "listo");

  const aplicar = async () => {
    if (corregir.size && motivo.trim().length < 5) return toast.error("Indique el motivo de la corrección (mínimo 5 caracteres).");
    setOcupado(true);
    try {
      const filas = [...listas.map((f) => f.fila), ...corregir];
      const r = await llamar<any>("POST", `/instrumentos/importaciones/${vista.id}/aplicar`, { filas, ...(corregir.size ? { motivo: motivo.trim() } : {}), ...(confirmar ? { confirmarAvisos: true } : {}) });
      toast.ok(`${r.aplicadas} valor(es) capturado(s)${r.errores ? `, ${r.errores} con error` : ""}.`);
      onCambio({ ...vista, estado: "APLICADA", resumen: r.resumen, filas: r.filas });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <section className="card" aria-label="Vista previa">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div>
          <h2 style={{ margin: "0 0 4px" }}>{vista.archivo}</h2>
          <div style={{ fontSize: 11.5, color: "var(--muted)", fontFamily: "ui-monospace, monospace" }}>SHA-256 {vista.hashSha256}</div>
        </div>
        <Resumen r={vista.resumen} />
      </div>
      {!!vista.yaImportado?.length && (
        <div className="alert warn" role="alert" style={{ marginTop: 10 }}>Este mismo archivo ya se aplicó el {fechaHora(vista.yaImportado[0].creadoEn)}. Revise antes de capturarlo otra vez.</div>
      )}
      <div style={{ overflowX: "auto", marginTop: 10 }}>
        <table className="data">
          <thead>
            <tr>{pendiente && <th aria-label="Corregir" />}<th>Fila</th><th>Muestra</th><th>Ensayo en el archivo</th><th>Ensayo en el LIMS</th><th style={{ textAlign: "right" }}>Valor</th><th>Estado</th></tr>
          </thead>
          <tbody>
            {vista.filas.map((f) => (
              <tr key={f.fila}>
                {pendiente && (
                  <td>
                    {f.estado === "corrige" && (
                      <input type="checkbox" style={{ width: "auto" }} aria-label={`Corregir fila ${f.fila}`} checked={corregir.has(f.fila)}
                        onChange={(e) => setCorregir((s) => { const n = new Set(s); e.target.checked ? n.add(f.fila) : n.delete(f.fila); return n; })} />
                    )}
                  </td>
                )}
                <td style={{ fontVariantNumeric: "tabular-nums" }}>{f.fila}</td>
                <td className="codigo">{f.muestra || "—"}{f.otCodigo && <div style={{ fontSize: 11, color: "var(--muted)" }}>{f.otCodigo}</div>}</td>
                <td>{f.ensayoArchivo || f.ensayo || "—"}</td>
                <td>{f.ensayoLims ?? "—"}</td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                  {f.valor} {f.unidad && <span style={{ color: "var(--muted)" }}>{f.unidad}</span>}
                  {f.valorAnterior && f.estado === "corrige" && <div style={{ fontSize: 11, color: "var(--muted)" }}>antes {f.valorAnterior}</div>}
                </td>
                <td>
                  <span className={`pill ${ESTADO[f.estado]?.pill ?? "gray"}`}>{ESTADO[f.estado]?.texto ?? f.estado}</span>
                  {f.detalle && <div style={{ fontSize: 11.5, color: "var(--muted)", maxWidth: 340 }}>{f.detalle}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pendiente && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginTop: 12 }}>
          {corregir.size > 0 && (
            <div className="field" style={{ margin: 0, flex: "1 1 280px" }}>
              <label htmlFor="in-motivo">Motivo de la corrección ({corregir.size} fila{corregir.size === 1 ? "" : "s"})</label>
              <input id="in-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={900} placeholder="Queda en el historial de cada resultado" />
            </div>
          )}
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
            <input type="checkbox" style={{ width: "auto" }} checked={confirmar} onChange={(e) => setConfirmar(e.target.checked)} />
            Aceptar los avisos de las reglas de aceptación
          </label>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn sm" disabled={ocupado} onClick={async () => { await llamar("POST", `/instrumentos/importaciones/${vista.id}/descartar`).catch(() => undefined); onCambio(null); }}>Descartar</button>
          <button type="button" className="btn primary sm" disabled={ocupado || listas.length + corregir.size === 0} onClick={aplicar}>
            Capturar {listas.length + corregir.size} valor{listas.length + corregir.size === 1 ? "" : "es"}
          </button>
        </div>
      )}
      {!pendiente && (
        <p className="subtitle" style={{ margin: "10px 0 0" }}>
          Revise y apruebe los valores en <Link href={"/captura-ot" as any} style={{ color: "var(--accent)" }}>Captura y revisión por OT</Link>.
        </p>
      )}
    </section>
  );
}

/* =========================================================== historial === */

function Historial({ meta }: { meta: Meta }) {
  const [filas, setFilas] = useState<any[]>([]);
  const [perfilId, setPerfilId] = useState("");
  const [abierta, setAbierta] = useState<Vista | null>(null);
  useEffect(() => {
    llamar<any[]>("GET", `/instrumentos/importaciones${qs({ perfilId: perfilId || null })}`).then(setFilas).catch((e) => toast.error(e.message));
  }, [perfilId]);
  return (
    <>
      <div className="toolbar" style={{ display: "flex", gap: 10, alignItems: "flex-end", marginBottom: 10 }}>
        <div className="field" style={{ margin: 0, minWidth: 240 }}>
          <label htmlFor="hi-perfil">Instrumento</label>
          <select id="hi-perfil" value={perfilId} onChange={(e) => setPerfilId(e.target.value)}>
            <option value="">Todos</option>
            {meta.perfiles.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div>
      </div>
      {abierta && <VistaPrevia vista={abierta} onCambio={(v) => setAbierta(v)} />}
      <div className="card card--table" style={{ overflowX: "auto" }}>
        <table className="data">
          <thead>
            <tr><th>Fecha</th><th>Instrumento</th><th>Archivo</th><th>Origen</th><th>OT</th><th>Estado</th><th style={{ textAlign: "right" }}>Capturados</th><th>Cargó</th><th /></tr>
          </thead>
          <tbody>
            {filas.map((x) => (
              <tr key={x.id}>
                <td style={{ whiteSpace: "nowrap", fontSize: 12 }}>{fechaHora(x.creadoEn)}</td>
                <td>{x.perfil}</td>
                <td>
                  <button type="button" onClick={async () => setAbierta(await llamar("GET", `/instrumentos/importaciones/${x.id}`))} style={{ background: "none", border: 0, padding: 0, color: "var(--accent)", cursor: "pointer", textAlign: "left" }}>
                    {x.archivo}
                  </button>
                </td>
                <td>{x.origen === "CARPETA" ? <span className="pill blue">Automático</span> : "Manual"}</td>
                <td className="codigo">{x.otCodigo ?? "—"}</td>
                <td><span className={`pill ${x.estado === "APLICADA" ? "green" : x.estado === "PREVISTA" ? "amber" : "gray"}`}>{x.estado.toLowerCase()}</span></td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{x.aplicadas} / {x.total}{x.conError ? <span style={{ color: "#7d1f1f" }}> · {x.conError} error</span> : null}</td>
                <td style={{ fontSize: 12 }}>{x.usuario ?? "—"}</td>
                <td>
                  <button type="button" className="btn ghost sm" onClick={() => descargarAdjunto(`/instrumentos/importaciones/${x.id}/original`, x.archivo).catch((e) => toast.error(e.message))}>Original</button>
                </td>
              </tr>
            ))}
            {!filas.length && <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--muted)", padding: 18 }}>Aún no se han cargado archivos.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ============================================================ perfiles === */

function Perfiles({ meta, onCambio }: { meta: Meta; onCambio: () => void }) {
  const [editar, setEditar] = useState<Perfil | "nuevo" | null>(null);
  return (
    <>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
        <span className="subtitle" style={{ margin: 0, flex: 1 }}>
          {meta.lecturaAutomatica
            ? "Lectura automática activa: los perfiles con carpeta se revisan cada minuto en el servidor."
            : "La lectura automática de carpetas está desactivada en este servidor (variable INSTRUMENTOS_DIR)."}
        </span>
        {meta.puedeConfigurar && meta.lecturaAutomatica && (
          <button type="button" className="btn sm" onClick={async () => {
            try {
              const r = await llamar<any[]>("POST", "/instrumentos/carpetas/revisar");
              toast.ok(r.length ? `${r.length} archivo(s) procesado(s).` : "No había archivos nuevos.");
            } catch (e: any) {
              toast.error(e.message);
            }
          }}>Revisar carpetas ahora</button>
        )}
        {meta.puedeConfigurar && <button type="button" className="btn primary sm" onClick={() => setEditar("nuevo")}>+ Nuevo perfil</button>}
      </div>
      {editar && <FormularioPerfil inicial={editar === "nuevo" ? undefined : editar} onListo={() => { setEditar(null); onCambio(); }} onCancelar={() => setEditar(null)} />}
      <div className="card card--table" style={{ overflowX: "auto" }}>
        <table className="data">
          <thead>
            <tr><th>Perfil</th><th>Formato</th><th>Columnas (muestra · ensayo · valor)</th><th>Equipo</th><th>Laboratorio</th><th>Lectura automática</th><th>Estado</th>{meta.puedeConfigurar && <th />}</tr>
          </thead>
          <tbody>
            {meta.perfiles.map((p) => (
              <tr key={p.id} style={{ opacity: p.activo ? 1 : 0.6 }}>
                <td><div style={{ fontWeight: 600 }}>{p.nombre}</div>{p.descripcion && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{p.descripcion}</div>}</td>
                <td>{p.formato}{p.formato !== "XML" ? ` · ${SEPARADORES[p.separador] ?? p.separador}` : ` · <${p.elementoRegistro}>`}<div style={{ fontSize: 11, color: "var(--muted)" }}>decimal «{p.decimal}»</div></td>
                <td style={{ fontSize: 12 }}>{p.colMuestra} · {p.colEnsayo ?? `fijo: ${p.ensayoFijo}`} · {p.colValor}{Object.keys(p.equivalencias).length ? <div style={{ color: "var(--muted)" }}>{Object.keys(p.equivalencias).length} equivalencia(s)</div> : null}</td>
                <td style={{ fontSize: 12 }}>{p.equipo ?? "—"}</td>
                <td style={{ fontSize: 12 }}>{p.unidad ?? "Todos"}</td>
                <td style={{ fontSize: 12 }}>{p.carpeta ? <><code>{p.carpeta}</code><div style={{ color: "var(--muted)" }}>a nombre de {p.responsable}</div></> : "—"}</td>
                <td>{p.activo ? <span className="pill green">Activo</span> : <span className="pill gray">Inactivo</span>}</td>
                {meta.puedeConfigurar && (
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button type="button" className="btn ghost sm" onClick={() => setEditar(p)}>Editar</button>
                    <button type="button" className="btn ghost sm" onClick={async () => {
                      if (!confirm(`¿Dar de baja el perfil «${p.nombre}»? El historial se conserva.`)) return;
                      try { await llamar("DELETE", `/instrumentos/perfiles/${p.id}`); toast.ok("Perfil dado de baja."); onCambio(); } catch (e: any) { toast.error(e.message); }
                    }}>Baja</button>
                  </td>
                )}
              </tr>
            ))}
            {!meta.perfiles.length && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--muted)", padding: 18 }}>No hay perfiles de instrumento.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function FormularioPerfil({ inicial, onListo, onCancelar }: { inicial?: Perfil; onListo: () => void; onCancelar: () => void }) {
  const [unidades, setUnidades] = useState<{ id: string; codigo: string; nombre: string }[]>([]);
  const [equipos, setEquipos] = useState<{ id: string; codigo: string; nombre: string | null; descripcion: string | null }[]>([]);
  const [usuarios, setUsuarios] = useState<{ id: string; nombre: string; username: string }[]>([]);
  useEffect(() => {
    llamar<any>("GET", "/ot/laboratorios").then((r) => setUnidades(Array.isArray(r) ? r : r?.data ?? [])).catch(() => undefined);
    llamar<any>("GET", "/equipos?limit=200").then((r) => setEquipos(Array.isArray(r) ? r : r?.data ?? [])).catch(() => undefined);
    llamar<any[]>("GET", "/agenda/usuarios").then(setUsuarios).catch(() => undefined);
  }, []);
  const [v, setV] = useState({
    nombre: inicial?.nombre ?? "",
    descripcion: inicial?.descripcion ?? "",
    unidadId: inicial?.unidadId ?? "",
    equipoId: inicial?.equipoId ?? "",
    formato: inicial?.formato ?? "CSV",
    separador: inicial?.separador ?? "auto",
    decimal: inicial?.decimal ?? ",",
    filaCabecera: inicial?.filaCabecera ?? 1,
    elementoRegistro: inicial?.elementoRegistro ?? "",
    colMuestra: inicial?.colMuestra ?? "",
    colEnsayo: inicial?.colEnsayo ?? "",
    colValor: inicial?.colValor ?? "",
    colUnidad: inicial?.colUnidad ?? "",
    ensayoFijo: inicial?.ensayoFijo ?? "",
    equivalencias: Object.entries(inicial?.equivalencias ?? {}).map(([k, x]) => `${k} = ${x}`).join("\n"),
    carpeta: inicial?.carpeta ?? "",
    responsableId: inicial?.responsableId ?? "",
    activo: inicial?.activo ?? true,
  });
  const set = <K extends keyof typeof v>(k: K, x: (typeof v)[K]) => setV((s) => ({ ...s, [k]: x }));
  const equivalencias = useMemo(() => {
    const o: Record<string, string> = {};
    for (const l of v.equivalencias.split(/\r?\n/)) {
      const i = l.indexOf("=");
      if (i > 0 && l.slice(0, i).trim() && l.slice(i + 1).trim()) o[l.slice(0, i).trim()] = l.slice(i + 1).trim();
    }
    return o;
  }, [v.equivalencias]);
  const xml = v.formato === "XML";

  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        const cuerpo = {
          nombre: v.nombre, descripcion: v.descripcion, unidadId: v.unidadId || null, equipoId: v.equipoId || null, formato: v.formato,
          separador: v.separador, decimal: v.decimal, filaCabecera: Number(v.filaCabecera), elementoRegistro: xml ? v.elementoRegistro : null,
          colMuestra: v.colMuestra, colEnsayo: v.colEnsayo || null, colValor: v.colValor, colUnidad: v.colUnidad || null, ensayoFijo: v.ensayoFijo || null,
          equivalencias, carpeta: v.carpeta || null, responsableId: v.responsableId || null, activo: v.activo,
        };
        try {
          if (inicial) await llamar("PATCH", `/instrumentos/perfiles/${inicial.id}`, cuerpo);
          else await llamar("POST", "/instrumentos/perfiles", cuerpo);
          toast.ok(inicial ? "Perfil actualizado." : "Perfil creado.");
          onListo();
        } catch (x: any) {
          toast.error(x.message);
        }
      }}
    >
      <h2 style={{ marginTop: 0 }}>{inicial ? `Perfil «${inicial.nombre}»` : "Nuevo perfil de instrumento"}</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
        <div className="field" style={{ gridColumn: "span 2" }}><label htmlFor="pf-nombre">Nombre</label><input id="pf-nombre" required maxLength={120} value={v.nombre} onChange={(e) => set("nombre", e.target.value)} placeholder="Ej.: ICP-OES · exportación de resultados" /></div>
        <div className="field">
          <label htmlFor="pf-unidad">Laboratorio</label>
          <select id="pf-unidad" value={v.unidadId} onChange={(e) => set("unidadId", e.target.value)}>
            <option value="">Todos</option>
            {unidades.map((u) => <option key={u.id} value={u.id}>{u.codigo} · {u.nombre}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="pf-equipo">Equipo (queda como equipo usado)</label>
          <select id="pf-equipo" value={v.equipoId} onChange={(e) => set("equipoId", e.target.value)}>
            <option value="">Sin equipo</option>
            {equipos.map((x) => <option key={x.id} value={x.id}>{x.codigo} · {x.nombre ?? x.descripcion}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="pf-formato">Formato</label>
          <select id="pf-formato" value={v.formato} onChange={(e) => set("formato", e.target.value as Perfil["formato"])}>
            <option value="CSV">CSV</option><option value="TXT">TXT</option><option value="XML">XML</option>
          </select>
        </div>
        {xml ? (
          <div className="field"><label htmlFor="pf-reg">Elemento de cada registro</label><input id="pf-reg" required value={v.elementoRegistro} onChange={(e) => set("elementoRegistro", e.target.value)} placeholder="Ej.: Result" /></div>
        ) : (
          <>
            <div className="field">
              <label htmlFor="pf-sep">Separador</label>
              <select id="pf-sep" value={v.separador} onChange={(e) => set("separador", e.target.value)}>
                {Object.entries(SEPARADORES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
              </select>
            </div>
            <div className="field"><label htmlFor="pf-cab">Fila de la cabecera (0 = sin cabecera)</label><input id="pf-cab" type="number" min={0} max={50} value={v.filaCabecera} onChange={(e) => set("filaCabecera", Number(e.target.value))} /></div>
          </>
        )}
        <div className="field">
          <label htmlFor="pf-dec">Decimal en el archivo</label>
          <select id="pf-dec" value={v.decimal} onChange={(e) => set("decimal", e.target.value as "," | ".")}>
            <option value=",">Coma (12,5)</option><option value=".">Punto (12.5)</option>
          </select>
        </div>
        <div className="field"><label htmlFor="pf-cm">{xml ? "Muestra (hijo o @atributo)" : "Columna de la muestra"}</label><input id="pf-cm" required value={v.colMuestra} onChange={(e) => set("colMuestra", e.target.value)} placeholder={xml ? "@sample" : "Nombre o número"} /></div>
        <div className="field"><label htmlFor="pf-ce">Columna del ensayo</label><input id="pf-ce" value={v.colEnsayo} onChange={(e) => set("colEnsayo", e.target.value)} placeholder="Vacío si mide un solo ensayo" /></div>
        <div className="field"><label htmlFor="pf-cv">Columna del valor</label><input id="pf-cv" required value={v.colValor} onChange={(e) => set("colValor", e.target.value)} /></div>
        <div className="field"><label htmlFor="pf-cu">Columna de la unidad</label><input id="pf-cu" value={v.colUnidad} onChange={(e) => set("colUnidad", e.target.value)} /></div>
        {!v.colEnsayo && <div className="field"><label htmlFor="pf-ef">Ensayo fijo</label><input id="pf-ef" required value={v.ensayoFijo} onChange={(e) => set("ensayoFijo", e.target.value)} placeholder="Ej.: pH" /></div>}
      </div>
      <div className="field">
        <label htmlFor="pf-eq">Equivalencias: nombre en el instrumento = código del método o nombre del ensayo en el LIMS (una por línea)</label>
        <textarea id="pf-eq" rows={3} value={v.equivalencias} onChange={(e) => set("equivalencias", e.target.value)} placeholder={"Protein = 403\nMoisture = Humedad"} style={{ fontFamily: "ui-monospace, monospace" }} />
      </div>
      <fieldset style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10, margin: "0 0 10px" }}>
        <legend style={{ fontSize: 12.5, fontWeight: 600, padding: "0 4px" }}>Lectura automática (opcional)</legend>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
          <div className="field" style={{ margin: 0 }}><label htmlFor="pf-carp">Carpeta en el servidor</label><input id="pf-carp" value={v.carpeta} onChange={(e) => set("carpeta", e.target.value)} placeholder="Ej.: icp_lqc" maxLength={80} /></div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="pf-resp">Se captura a nombre de</label>
            <select id="pf-resp" value={v.responsableId} onChange={(e) => set("responsableId", e.target.value)} required={!!v.carpeta}>
              <option value="">—</option>
              {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre} · {u.username}</option>)}
            </select>
          </div>
        </div>
        <p className="subtitle" style={{ margin: "6px 0 0" }}>El instrumento deja sus archivos en esa carpeta; el LIMS los lee cada minuto, captura solo los ensayos sin valor y los mueve a «procesados» o «errores».</p>
      </fieldset>
      <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, marginBottom: 10 }}>
        <input type="checkbox" checked={v.activo} onChange={(e) => set("activo", e.target.checked)} style={{ width: "auto" }} /> Activo
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn primary sm">{inicial ? "Guardar" : "Crear perfil"}</button>
        <button type="button" className="btn sm" onClick={onCancelar}>Cancelar</button>
      </div>
    </form>
  );
}
