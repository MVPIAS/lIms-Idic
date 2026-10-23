"use client";

/**
 * Paso 4 de la D11 · registro de cada arma como MUESTRA de la OT (EP-11 11.8),
 * con marca (y su país), modelo y calibre de los catálogos, país de origen
 * propio, serie (normalizada y única en la OT) y carga masiva desde la planilla
 * del importador o desde el listado de la resolución. Debajo, la verificación
 * contra la resolución (11.9) y las armas registradas con su etiqueta (11.7).
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "@/components/ui/feedback";
import Modal from "@/components/documentos/Modal";
import { PILL_ETAPA, TIPOS_ARMA, pedir, subirPlanilla, type Accion, type Catalogos, type ExpedienteD11 } from "@/lib/d11";

type Fila = {
  clave: number;
  resolucionArmaId: string | null;
  tipo: string;
  marcaTexto: string;
  marcaId: string;
  modeloId: string;
  calibreId: string;
  paisOrigen: string;
  serie: string;
  sinSerie: boolean;
  accesorios: string;
  lote: string;
  /** B-094: textos de la planilla para volver a emparejar tras añadir al catálogo. */
  modeloTexto?: string;
  calibreTexto?: string;
  /** Filas leídas de la planilla: al volver a cargarla se reemplazan, no se suman. */
  dePlanilla?: boolean;
};
let seq = 0;
const vacia = (): Fila => ({ clave: ++seq, resolucionArmaId: null, tipo: "", marcaTexto: "", marcaId: "", modeloId: "", calibreId: "", paisOrigen: "", serie: "", sinSerie: false, accesorios: "", lote: "" });
const k = (s?: string | null) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
const etiquetaMarca = (m: { nombre: string; pais: string | null }) => (m.pais ? `${m.nombre} (${m.pais})` : m.nombre);

/**
 * B-094 · Empareja con el catálogo las filas que aún no tienen marca, modelo o
 * calibre, a partir del texto de la planilla (o del escrito). No toca lo ya
 * elegido.
 */
function reemparejar(filas: Fila[], cat: Catalogos): Fila[] {
  const marcas = cat.marcas.filter((m) => m.activo);
  return filas.map((f) => {
    let { marcaId, modeloId, calibreId, paisOrigen } = f;
    if (!marcaId && f.marcaTexto) {
      const m = marcas.find((x) => k(etiquetaMarca(x)) === k(f.marcaTexto)) ?? marcas.find((x) => k(x.nombre) === k(f.marcaTexto));
      if (m) { marcaId = m.id; paisOrigen = paisOrigen || m.pais || ""; }
    }
    if (marcaId && !modeloId && f.modeloTexto)
      modeloId = cat.modelos.find((x) => x.marcaId === marcaId && x.activo && k(x.nombre) === k(f.modeloTexto))?.id ?? "";
    if (!calibreId && f.calibreTexto) calibreId = cat.calibres.find((c) => c.activo && k(c.nombre) === k(f.calibreTexto))?.id ?? "";
    if (marcaId === f.marcaId && modeloId === f.modeloId && calibreId === f.calibreId && paisOrigen === f.paisOrigen) return f;
    const marca = marcas.find((x) => x.id === marcaId);
    return { ...f, marcaId, modeloId, calibreId, paisOrigen, marcaTexto: marca ? etiquetaMarca(marca) : f.marcaTexto };
  });
}

export default function RegistroArmas({ d, accion, onEtiquetas }: { d: ExpedienteD11; accion: Accion; onEtiquetas: () => void }) {
  const [cat, setCat] = useState<Catalogos | null>(null);
  const [filas, setFilas] = useState<Fila[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [nuevo, setNuevo] = useState<null | { tipo: "marca" | "modelo" | "calibre"; fila?: number }>(null);
  const acta = d.expediente.acta;
  const puede = d.puedo.registrar && d.ot.abierta && Boolean(acta);
  const faltan = acta ? Math.max(0, acta.cantidad - d.armas.length) : 0;

  const cargarCat = () =>
    pedir<Catalogos>("GET", "/d11/catalogos")
      .then((c) => {
        setCat(c);
        // B-094: tras añadir una marca, un modelo o un calibre, las filas que lo esperaban se completan solas.
        setFilas((xs) => reemparejar(xs, c));
        return c;
      })
      .catch((e) => toast.error(e.message));
  useEffect(() => {
    cargarCat();
  }, []);

  const marcas = useMemo(() => (cat?.marcas ?? []).filter((m) => m.activo), [cat]);
  const porEtiqueta = useMemo(() => new Map(marcas.map((m) => [k(etiquetaMarca(m)), m])), [marcas]);
  const set = (clave: number, c: Partial<Fila>) => setFilas((xs) => xs.map((x) => (x.clave === clave ? { ...x, ...c } : x)));

  function elegirMarca(f: Fila, texto: string) {
    const m = porEtiqueta.get(k(texto)) ?? null;
    set(f.clave, { marcaTexto: texto, marcaId: m?.id ?? "", modeloId: m && m.id === f.marcaId ? f.modeloId : "", paisOrigen: m ? f.paisOrigen || m.pais || "" : f.paisOrigen });
  }

  /** Filas desde el listado de la resolución que aún no tienen arma registrada. */
  function desdeListado() {
    if (!cat) return;
    const usadas = new Set(d.armas.map((a) => a.resolucionArmaId).filter(Boolean));
    const nuevas: Fila[] = [];
    for (const l of d.listado) {
      if (usadas.has(l.id)) continue;
      const enMarca = marcas.filter((m) => k(m.nombre) === k(l.marca));
      const marca = enMarca[0];
      const modelo = marca ? cat.modelos.find((x) => x.marcaId === marca.id && k(x.nombre) === k(l.modelo) && x.activo) : undefined;
      const calibre = cat.calibres.find((c) => c.activo && k(c.nombre) === k(l.calibre));
      for (let i = 0; i < Math.min(l.cantidad, Math.max(1, faltan)); i++)
        nuevas.push({
          ...vacia(),
          resolucionArmaId: l.id,
          tipo: l.tipo,
          marcaTexto: marca ? etiquetaMarca(marca) : l.marca,
          marcaId: marca?.id ?? "",
          modeloId: modelo?.id ?? "",
          calibreId: calibre?.id ?? "",
          paisOrigen: marca?.pais ?? "",
          serie: l.cantidad === 1 ? l.serie ?? "" : "",
          accesorios: l.accesorios ?? "",
          modeloTexto: l.modelo ?? "",
          calibreTexto: l.calibre ?? "",
        });
    }
    setFilas(nuevas.slice(0, Math.max(faltan, 0)));
    const sin = nuevas.filter((x) => !x.marcaId || !x.modeloId || !x.calibreId).length;
    setAvisos(sin ? [`${sin} fila(s) con marca, modelo o calibre que no están en el catálogo: elíjalos o añádalos.`] : []);
  }

  async function desdePlanilla(archivo: File) {
    setOcupado(true);
    try {
      const r = await subirPlanilla<any>("/d11/planilla", archivo);
      const leidas: Fila[] = r.filas.map((x: any) => {
        const marca = marcas.find((m) => m.id === x.marcaId);
        return {
          ...vacia(),
          tipo: x.tipo ?? "",
          marcaTexto: marca ? etiquetaMarca(marca) : x.marca,
          marcaId: x.marcaId ?? "",
          modeloId: x.modeloId ?? "",
          calibreId: x.calibreId ?? "",
          paisOrigen: x.pais ?? "",
          serie: x.serie ?? "",
          accesorios: x.accesorios ?? "",
          lote: x.lote ?? "",
          modeloTexto: x.modelo ?? "",
          calibreTexto: x.calibre ?? "",
          dePlanilla: true,
        };
      });
      const nuevas = cat ? reemparejar(leidas, cat) : leidas;
      // B-094: volver a cargar la planilla reemplaza sus filas (antes se sumaban: 6 filas tras recargar 3).
      setFilas((xs) => [...xs.filter((x) => !x.dePlanilla), ...nuevas]);
      setAvisos([...r.errores, ...(nuevas.some((x) => !x.marcaId || !x.modeloId || !x.calibreId) ? ["Hay filas con marca, modelo o calibre fuera del catálogo: elíjalos o añádalos."] : [])]);
      toast.ok(`${nuevas.length} fila(s) leídas de ${archivo.name}. Revíselas antes de registrar.`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }

  const incompletas = filas.filter((f) => !f.tipo || !f.marcaId || !f.modeloId || !f.calibreId || f.paisOrigen.trim().length < 2 || (!f.serie.trim() && !f.sinSerie));
  async function registrar() {
    setOcupado(true);
    const r = await accion(
      "POST",
      `/d11/ot/${d.ot.id}/armas`,
      {
        armas: filas.map((f) => ({
          resolucionArmaId: f.resolucionArmaId,
          tipo: f.tipo,
          marcaId: f.marcaId,
          modeloId: f.modeloId,
          calibreId: f.calibreId,
          paisOrigen: f.paisOrigen.trim(),
          serie: f.sinSerie ? null : f.serie.trim() || null,
          sinSerie: f.sinSerie,
          accesorios: f.accesorios.trim() || null,
          lote: f.lote.trim() || null,
        })),
      },
      `${filas.length} arma(s) registradas como muestras de la OT. Siguiente paso: clasificar y elegir el camino.`,
    );
    if (r) {
      setFilas([]);
      setAvisos([]);
    }
    setOcupado(false);
  }

  return (
    <>
      {!acta && <div className="alert info">Primero firme el acta de recepción (paso 3): las armas se registran contra lo recibido y contado.</div>}
      {puede && (
        <div className="card">
          <h2>4 · Registro de armas (una arma = una muestra de la OT) <span className="right">Armero · EP-11 11.8</span></h2>
          <p className="subtitle">
            Quedan por registrar <b>{faltan}</b> de {acta?.cantidad} armas recibidas. Cargue la planilla del importador (.xlsx o .csv), tome las filas
            del listado de la resolución o añádalas una a una.
          </p>
          <div className="toolbar">
            <label className="btn outline sm" style={{ cursor: "pointer" }}>
              Cargar planilla del importador
              <input type="file" accept=".xlsx,.csv,.txt" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) desdePlanilla(f); e.target.value = ""; }} />
            </label>
            {d.listado.length > 0 && <button type="button" className="btn outline sm" onClick={desdeListado} disabled={!cat}>Tomar del listado de la resolución</button>}
            <button type="button" className="btn outline sm" onClick={() => setFilas((xs) => [...xs, vacia()])}>＋ Añadir fila</button>
            <span className="spacer" />
            {cat?.puedeAgregar && (
              <>
                <button type="button" className="btn ghost sm" onClick={() => setNuevo({ tipo: "marca" })}>＋ Marca</button>
                <button type="button" className="btn ghost sm" onClick={() => setNuevo({ tipo: "calibre" })}>＋ Calibre</button>
              </>
            )}
          </div>
          {avisos.length > 0 && (
            <div className="alert warn" role="status">
              <ul style={{ margin: 0, paddingLeft: 18 }}>{avisos.map((a) => <li key={a}>{a}</li>)}</ul>
            </div>
          )}
          <datalist id="d11-marcas">{marcas.map((m) => <option key={m.id} value={etiquetaMarca(m)} />)}</datalist>
          {filas.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>#</th><th>Tipo *</th><th>Marca (país) *</th><th>Modelo *</th><th>Calibre *</th><th>País de origen *</th>
                    <th>Nº de serie *</th><th>Accesorios</th><th>Lote</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f, i) => {
                    const modelos = (cat?.modelos ?? []).filter((m) => m.marcaId === f.marcaId && m.activo);
                    return (
                      <tr key={f.clave}>
                        <td>{d.armas.length + i + 1}</td>
                        <td>
                          <select aria-label={`Tipo del arma ${i + 1}`} value={f.tipo} onChange={(e) => set(f.clave, { tipo: e.target.value })}>
                            <option value="">Elija…</option>
                            {TIPOS_ARMA.map((t) => <option key={t.valor} value={t.valor}>{t.texto}</option>)}
                          </select>
                        </td>
                        <td>
                          <input aria-label={`Marca del arma ${i + 1}`} list="d11-marcas" value={f.marcaTexto} onChange={(e) => elegirMarca(f, e.target.value)}
                            style={{ minWidth: 190, borderColor: f.marcaTexto && !f.marcaId ? "var(--red)" : undefined }} />
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: 4 }}>
                            <select aria-label={`Modelo del arma ${i + 1}`} value={f.modeloId} onChange={(e) => set(f.clave, { modeloId: e.target.value })} disabled={!f.marcaId}>
                              <option value="">{f.marcaId ? "Elija…" : "Elija la marca"}</option>
                              {modelos.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
                            </select>
                            {f.marcaId && cat?.puedeAgregar && (
                              <button type="button" className="btn ghost sm" title="Añadir un modelo de esta marca" aria-label="Añadir modelo" onClick={() => setNuevo({ tipo: "modelo", fila: f.clave })}>＋</button>
                            )}
                          </div>
                        </td>
                        <td>
                          <select aria-label={`Calibre del arma ${i + 1}`} value={f.calibreId} onChange={(e) => set(f.clave, { calibreId: e.target.value })}>
                            <option value="">Elija…</option>
                            {(cat?.calibres ?? []).filter((c) => c.activo).map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.cip ? " · CIP" : ""}</option>)}
                          </select>
                        </td>
                        <td><input aria-label={`País de origen del arma ${i + 1}`} value={f.paisOrigen} onChange={(e) => set(f.clave, { paisOrigen: e.target.value })} maxLength={80} style={{ width: 120 }} /></td>
                        <td>
                          <input aria-label={`Número de serie del arma ${i + 1}`} value={f.serie} disabled={f.sinSerie} onChange={(e) => set(f.clave, { serie: e.target.value })} maxLength={80} style={{ width: 140 }} />
                          <label style={{ display: "block", fontSize: 11 }}>
                            <input type="checkbox" checked={f.sinSerie} onChange={(e) => set(f.clave, { sinSerie: e.target.checked, serie: e.target.checked ? "" : f.serie })} /> Sin número de serie
                          </label>
                        </td>
                        <td><input aria-label={`Accesorios del arma ${i + 1}`} value={f.accesorios} onChange={(e) => set(f.clave, { accesorios: e.target.value })} maxLength={300} style={{ width: 130 }} /></td>
                        <td><input aria-label={`Lote del arma ${i + 1}`} value={f.lote} onChange={(e) => set(f.clave, { lote: e.target.value })} maxLength={80} style={{ width: 80 }} /></td>
                        <td><button type="button" className="btn ghost-danger sm" aria-label={`Quitar la fila ${i + 1}`} onClick={() => setFilas((xs) => xs.filter((x) => x.clave !== f.clave))}>✕</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="toolbar">
            <button type="button" className="btn primary" disabled={!filas.length || incompletas.length > 0 || ocupado} onClick={registrar}>
              {ocupado ? "Registrando…" : "Registrar armas → verificar contra resolución"}
            </button>
            {filas.length > 0 && incompletas.length > 0 && <small style={{ color: "var(--muted)" }}>{incompletas.length} fila(s) incompletas (los campos con * son obligatorios).</small>}
            {filas.length > faltan && <small style={{ color: "var(--red)" }}>Hay más filas ({filas.length}) que armas por registrar ({faltan}).</small>}
          </div>
        </div>
      )}

      {d.verificacion && d.armas.length > 0 && (
        <div className="card">
          <h2>
            Verificación contra la resolución <span className="right">EP-11 11.9</span>
          </h2>
          <p style={{ margin: "0 0 6px" }}>
            Según resolución <b>{d.verificacion.segunResolucion}</b> · registradas <b>{d.verificacion.registradas}</b> ·{" "}
            {d.verificacion.concuerda ? <span className="pill green">Concuerda</span> : <span className="pill red">Diferencias → nota de no conformidad</span>}
          </p>
          {!d.verificacion.concuerda && (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
              {d.verificacion.diferencias.map((x, i) => <li key={i}>{x.detalle}</li>)}
            </ul>
          )}
        </div>
      )}

      <div className="card">
        <h2>
          Armas registradas ({d.armas.length})
          <span className="right">{d.armas.length > 0 && <button type="button" className="btn outline sm" onClick={onEtiquetas}>Imprimir etiquetas</button>}</span>
        </h2>
        {d.armas.length === 0 ? (
          <p className="subtitle" style={{ margin: 0 }}>Aún no hay armas registradas.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="data">
              <thead><tr><th>Muestra · código</th><th>Tipo</th><th>Marca</th><th>Modelo</th><th>Calibre</th><th>País</th><th>Nº de serie</th><th>Accesorios</th><th>Ubicación</th><th>Etapa</th></tr></thead>
              <tbody>
                {d.armas.map((a) => (
                  <tr key={a.id}>
                    <td className="codigo" style={{ whiteSpace: "nowrap" }}>{a.muestra}</td>
                    <td>{a.tipoNombre}</td>
                    <td>{a.marca}</td>
                    <td>{a.modelo}</td>
                    <td>{a.calibre}</td>
                    <td>{a.pais}</td>
                    <td>{a.serie ?? <span className="pill amber">Sin serie</span>}</td>
                    <td>{a.accesorios ?? "—"}</td>
                    <td>{a.ubicacion ?? "—"}</td>
                    <td><span className={`pill ${PILL_ETAPA[a.etapa] ?? "gray"}`}>{a.etapaNombre}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {nuevo && cat && (
        <NuevoCatalogo
          tipo={nuevo.tipo}
          marca={nuevo.tipo === "modelo" ? marcas.find((m) => m.id === filas.find((f) => f.clave === nuevo.fila)?.marcaId) ?? null : null}
          onCerrar={() => setNuevo(null)}
          onCreado={async (x) => {
            await cargarCat();
            if (nuevo.tipo === "modelo" && nuevo.fila) set(nuevo.fila, { modeloId: x.id });
            setNuevo(null);
          }}
        />
      )}
    </>
  );
}

function NuevoCatalogo({ tipo, marca, onCerrar, onCreado }: { tipo: "marca" | "modelo" | "calibre"; marca: { id: string; nombre: string; pais: string | null } | null; onCerrar: () => void; onCreado: (x: any) => void }) {
  const [nombre, setNombre] = useState("");
  const [pais, setPais] = useState("");
  const [cip, setCip] = useState(false);
  const [error, setError] = useState("");
  const titulo = { marca: "Nueva marca", modelo: `Nuevo modelo${marca ? ` de ${marca.nombre}` : ""}`, calibre: "Nuevo calibre" }[tipo];
  async function guardar() {
    try {
      const ruta = { marca: "/d11/catalogos/marcas", modelo: "/d11/catalogos/modelos", calibre: "/d11/catalogos/calibres" }[tipo];
      const cuerpo = tipo === "marca" ? { nombre, pais: pais || null } : tipo === "modelo" ? { marcaId: marca?.id, nombre } : { nombre, cip };
      const x = await pedir<any>("POST", ruta, cuerpo);
      toast.ok(`${titulo}: ${x.nombre} añadido al catálogo.`);
      onCreado(x);
    } catch (e: any) {
      setError(e.message);
    }
  }
  return (
    <Modal
      titulo={titulo}
      onCerrar={onCerrar}
      acciones={
        <>
          <button type="button" className="btn outline" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="btn primary" disabled={!nombre.trim()} onClick={guardar}>Añadir al catálogo</button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field span-2">
          <label htmlFor="nc-nombre">Nombre <span className="req">*</span></label>
          <input id="nc-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={160} autoFocus />
        </div>
        {tipo === "marca" && (
          <div className="field">
            <label htmlFor="nc-pais">País</label>
            <input id="nc-pais" value={pais} onChange={(e) => setPais(e.target.value)} maxLength={80} />
          </div>
        )}
        {tipo === "calibre" && (
          <label style={{ fontSize: 12.5 }}><input type="checkbox" checked={cip} onChange={(e) => setCip(e.target.checked)} /> Calibre de la tabla C.I.P.</label>
        )}
      </div>
      <p className="subtitle" style={{ marginTop: 8 }}>Las correcciones y desactivaciones las hace la jefatura en «Catálogo de armas».</p>
      {error && <div className="alert warn" role="alert">{error}</div>}
    </Modal>
  );
}
