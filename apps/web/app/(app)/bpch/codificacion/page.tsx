"use client";

/**
 * BPCH · Listado de Codificación Única (DGMN): productos con su código
 * CNC-DGMN por fabricante. Pestañas Explosivos / Sustancias químicas / En
 * receso; inscripción, corrección, receso, reactivación y cambio de titular,
 * todo con historial. Emisión del listado oficial por fabricante en PDF (para
 * la firma del Subdirector BPCH y de la DGMN) o Excel (EP-09 9.16, BL-021).
 * API: /bpch/codificacion
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader, EmptyState, SkeletonRows } from "@/components/ui/PageHeader";
import RequierePermiso from "@/components/RequierePermiso";
import Modal from "@/components/documentos/Modal";
import { toast } from "@/components/ui/feedback";
import { usePermisos } from "@/lib/permisos";
import { fecha, fechaHora } from "@/lib/format";
import { descargarGenerado } from "@/lib/bpchProcesos";
import { hoyChile } from "@/lib/d11";
import { BuscadorElemento, BuscadorEmpresa, type ElementoCatalogo, type Empresa } from "../_components/Buscadores";
import { ESTADO_COD, LISTADOS, numero, pedir } from "../_components/bpch";

type Pestana = "EXPLOSIVOS" | "SUSTANCIAS_QUIMICAS" | "EN_RECESO";

const EVENTO: Record<string, string> = {
  alta: "Inscripción",
  alta_certificacion: "Inscripción al certificar",
  edicion: "Corrección",
  receso: "Paso a receso",
  reactivacion: "Reactivación",
  certificacion: "Certificación",
  reinspeccion: "Reinspección",
  cambio_titular: "Cambio de titular",
};

export default function CodificacionPage() {
  return (
    <RequierePermiso perm="bpch.codificacion.ver" titulo="Codificación Única">
      <Listado />
    </RequierePermiso>
  );
}

function Listado() {
  const { puede } = usePermisos();
  const gestiona = puede("bpch.codificacion.gestionar");
  const [pestana, setPestana] = useState<Pestana>("EXPLOSIVOS");
  const [q, setQ] = useState("");
  const [filas, setFilas] = useState<any[] | null>(null);
  const [conteos, setConteos] = useState<{ listado: string; estado: string; n: number }[]>([]);
  const [error, setError] = useState("");
  const [ficha, setFicha] = useState<any | "nuevo" | null>(null);
  const [emitir, setEmitir] = useState(false);

  const cargar = useCallback(async () => {
    setFilas(null);
    try {
      const qs = new URLSearchParams({ limit: "200" });
      if (pestana === "EN_RECESO") qs.set("estado", "EN_RECESO");
      else {
        qs.set("listado", pestana);
        qs.set("estado", "VIGENTE");
      }
      if (q.trim()) qs.set("q", q.trim());
      const r = await pedir<any>("GET", `/bpch/codificacion?${qs}`);
      setFilas(r.data);
      setConteos(r.conteos);
      setError("");
    } catch (e: any) {
      setError(e.message);
      setFilas([]);
    }
  }, [pestana, q]);
  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pestana]);

  const n = (l: Pestana) => conteos.filter((c) => (l === "EN_RECESO" ? c.estado === "EN_RECESO" : c.listado === l && c.estado === "VIGENTE")).reduce((s, c) => s + c.n, 0);
  const tab = (k: Pestana, l: string) => (
    <button type="button" role="tab" aria-selected={pestana === k} className={`tab ${pestana === k ? "active" : ""}`} onClick={() => setPestana(k)}>{l} ({n(k)})</button>
  );

  return (
    <div>
      <PageHeader
        icono="🗂"
        titulo="Codificación Única"
        subtitulo="Listado oficial DGMN por fabricante. Al certificar (CUMPLE) el producto se inscribe o actualiza desde la internación; aquí se mantiene."
        migas={[{ label: "BPCH" }, { label: "Codificación Única" }]}
        acciones={<>
          <button type="button" className="btn outline" onClick={() => setEmitir(true)}>Listado oficial</button>
          {gestiona && <button type="button" className="btn primary" onClick={() => setFicha("nuevo")}>＋ Inscribir producto</button>}
        </>}
      />
      {error && <div className="alert warn" role="alert">{error}</div>}
      <div className="tabs" role="tablist" style={{ marginBottom: 10 }}>
        {tab("EXPLOSIVOS", "Explosivos")}
        {tab("SUSTANCIAS_QUIMICAS", "Sustancias químicas")}
        {tab("EN_RECESO", "En receso")}
      </div>
      <form className="toolbar" onSubmit={(e) => { e.preventDefault(); cargar(); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por código, producto, fabricante o RUT" style={{ flex: 1, minWidth: 240 }} aria-label="Buscar en la Codificación Única" />
        <button className="btn primary sm" type="submit">Buscar</button>
      </form>
      <div className="card card--table">
        <table className="data">
          <thead><tr><th>Fabricante · RUT</th><th>Producto</th><th>Código único (CNC-DGMN)</th><th>Clase/Div. UN</th><th>Nº UN</th><th>Certificado</th><th>Estado</th></tr></thead>
          <tbody>
            {filas === null && <SkeletonRows cols={7} />}
            {filas?.map((f) => (
              <tr key={f.id} className="row-action" onClick={() => setFicha(f)}>
                <td>{f.fabricanteNombre}<small style={{ display: "block", color: "var(--muted)" }}>{f.fabricanteRut ?? ""}</small></td>
                <td>
                  <button type="button" onClick={(e) => { e.stopPropagation(); setFicha(f); }} style={{ background: "none", border: "none", padding: 0, color: "var(--primary)", textDecoration: "underline", cursor: "pointer", font: "inherit", textAlign: "left" }}>{f.producto}</button>
                  {f.elementoGenerico && <small style={{ display: "block", color: "var(--muted)" }}>{f.elementoGenerico}</small>}
                </td>
                <td className="codigo">{f.cnc}</td>
                <td>{f.claseDivisionUn ?? "—"}</td>
                <td>{f.numeroUn ?? "—"}</td>
                <td>{f.certificadoNumero ?? "—"}</td>
                <td><span className={`pill ${ESTADO_COD[f.estado]?.c}`}>{ESTADO_COD[f.estado]?.l}</span>{pestana === "EN_RECESO" && <small style={{ display: "block" }}>{LISTADOS[f.listado]}</small>}</td>
              </tr>
            ))}
            {filas?.length === 0 && (
              <tr><td colSpan={7}><EmptyState icono="🗂" titulo="Sin productos en este listado" texto={gestiona ? "Inscriba un producto o actualice la codificación desde una internación certificada." : undefined} /></td></tr>
            )}
          </tbody>
        </table>
      </div>
      {emitir && <EmitirListado gestiona={gestiona} inicial={pestana} onCerrar={() => setEmitir(false)} />}
      {ficha && <Ficha inicial={ficha === "nuevo" ? null : ficha} gestiona={gestiona} onCerrar={() => setFicha(null)} onGuardado={() => cargar()} />}
    </div>
  );
}

function Ficha({ inicial, gestiona, onCerrar, onGuardado }: { inicial: any | null; gestiona: boolean; onCerrar: () => void; onGuardado: () => void }) {
  const [d, setD] = useState<any>(inicial);
  const [editar, setEditar] = useState(!inicial);
  const [empresa, setEmpresa] = useState<Empresa | null>(inicial?.clienteId ? { id: inicial.clienteId, razonSocial: inicial.fabricanteNombre, rut: inicial.fabricanteRut } : null);
  const [elemento, setElemento] = useState<ElementoCatalogo | null>(inicial?.catElementoId ? { id: inicial.catElementoId, codigo: "", nombre: inicial.catElementoNombre ?? "" } : null);
  const [f, setF] = useState({
    listado: inicial?.listado ?? "",
    cnc: inicial?.cnc ?? "",
    fabricanteNombre: inicial && !inicial.clienteId ? inicial.fabricanteNombre : "",
    fabricanteRut: inicial && !inicial.clienteId ? inicial.fabricanteRut ?? "" : "",
    elementoGenerico: inicial?.elementoGenerico ?? "",
    producto: inicial?.producto ?? "",
    claseDivisionUn: inicial?.claseDivisionUn ?? "",
    numeroUn: inicial?.numeroUn ?? "",
    grupoListado: inicial?.grupoListado ?? "",
    eqDin60: inicial?.eqDin60 != null ? String(inicial.eqDin60).replace(".", ",") : "",
    ptnPin: inicial?.ptnPin ?? "",
    certificadoNumero: inicial?.certificadoId ? "" : inicial?.certificadoNumero ?? "",
    observaciones: inicial?.observaciones ?? "",
    motivo: "",
  });
  const [estadoMotivo, setEstadoMotivo] = useState("");
  const [errores, setErrores] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  useEffect(() => {
    if (inicial?.id) pedir("GET", `/bpch/codificacion/${inicial.id}`).then(setD).catch((e) => setErrores(e.message));
  }, [inicial?.id]);

  async function guardar() {
    setErrores("");
    const cuerpo: any = {
      listado: f.listado || undefined,
      cnc: f.cnc,
      clienteId: empresa?.id ?? null,
      fabricanteNombre: empresa ? null : f.fabricanteNombre || null,
      fabricanteRut: empresa ? null : f.fabricanteRut || null,
      elementoGenerico: f.elementoGenerico || null,
      producto: f.producto,
      claseDivisionUn: f.claseDivisionUn || null,
      numeroUn: f.numeroUn || null,
      grupoListado: f.grupoListado || null,
      eqDin60: numero(f.eqDin60),
      ptnPin: f.ptnPin || null,
      catElementoId: elemento?.id ?? null,
      observaciones: f.observaciones || null,
      ...(f.certificadoNumero ? { certificadoNumero: f.certificadoNumero } : {}),
    };
    try {
      const r = d?.id ? await pedir("PATCH", `/bpch/codificacion/${d.id}`, { ...cuerpo, motivo: f.motivo || undefined }) : await pedir("POST", "/bpch/codificacion", cuerpo);
      setD(r);
      setEditar(false);
      toast.ok(d?.id ? "Producto corregido." : "Producto inscrito en la Codificación Única.");
      onGuardado();
    } catch (e: any) {
      setErrores(e.message);
    }
  }

  async function cambiarEstado() {
    try {
      const r = await pedir("POST", `/bpch/codificacion/${d.id}/estado`, { estado: d.estado === "VIGENTE" ? "EN_RECESO" : "VIGENTE", motivo: estadoMotivo });
      setD(r);
      setEstadoMotivo("");
      toast.ok(r.estado === "VIGENTE" ? "Producto reactivado." : "Producto pasado a receso.");
      onGuardado();
    } catch (e: any) {
      setErrores(e.message);
    }
  }

  return (
    <Modal titulo={d?.id ? <>Producto <span className="codigo">{d.cnc}</span></> : "Inscribir producto"} onCerrar={onCerrar} ancho={760}
      acciones={<>
        {editar && gestiona && <button type="button" className="btn primary" onClick={guardar}>{d?.id ? "Guardar corrección" : "Inscribir"}</button>}
        {!editar && gestiona && d?.id && <button type="button" className="btn outline" onClick={() => setEditar(true)}>Corregir datos</button>}
        <button type="button" className="btn outline" onClick={onCerrar}>Cerrar</button>
      </>}
    >
      {errores && <div className="alert warn" role="alert">{errores}</div>}
      {editar ? (
        <div className="form-grid">
          <div className="field">
            <label htmlFor="cl">Listado <span className="req">*</span></label>
            <select id="cl" value={f.listado} onChange={set("listado")}><option value="">Elija…</option>{Object.entries(LISTADOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </div>
          <div className="field span-2"><label htmlFor="cc">Código único CNC-DGMN <span className="req">*</span></label><input id="cc" value={f.cnc} onChange={set("cnc")} placeholder="E-I/n/n/n/n/n" /></div>
          <div className="field span-3"><BuscadorEmpresa etiqueta="Fabricante / titular (maestro de clientes)" valor={empresa} onChange={setEmpresa} /></div>
          {!empresa && (
            <>
              <div className="field span-2"><label htmlFor="fn">… o nombre del fabricante (si no es cliente) <span className="req">*</span></label><input id="fn" value={f.fabricanteNombre} onChange={set("fabricanteNombre")} /></div>
              <div className="field"><label htmlFor="fr">RUT del fabricante</label><input id="fr" value={f.fabricanteRut} onChange={set("fabricanteRut")} /></div>
            </>
          )}
          <div className="field span-2"><label htmlFor="pp">Producto <span className="req">*</span></label><input id="pp" value={f.producto} onChange={set("producto")} /></div>
          <div className="field"><label htmlFor="eg">Elemento genérico</label><input id="eg" value={f.elementoGenerico} onChange={set("elementoGenerico")} /></div>
          <div className="field"><label htmlFor="cu">Clase/División UN {f.listado === "EXPLOSIVOS" && <span className="req">*</span>}</label><input id="cu" value={f.claseDivisionUn} onChange={set("claseDivisionUn")} /></div>
          <div className="field"><label htmlFor="nu">Nº UN {f.listado === "EXPLOSIVOS" && <span className="req">*</span>}</label><input id="nu" value={f.numeroUn} onChange={set("numeroUn")} /></div>
          <div className="field span-2"><label htmlFor="gl">Grupo del listado oficial</label><input id="gl" value={f.grupoListado} onChange={set("grupoListado")} placeholder="Ej.: 21 Semigelatina granulada" /></div>
          <div className="field"><label htmlFor="eq">{f.listado === "SUSTANCIAS_QUIMICAS" ? "EQ. 60 %" : "EQ.DIN 60 %"}</label><input id="eq" inputMode="decimal" value={f.eqDin60} onChange={set("eqDin60")} placeholder="0,53" /></div>
          <div className="field"><label htmlFor="pt">{f.listado === "SUSTANCIAS_QUIMICAS" ? "SQN" : "PTN / PIN"}</label><input id="pt" value={f.ptnPin} onChange={set("ptnPin")} maxLength={10} /></div>
          <div className="field"><label htmlFor="ce">Certificado (histórico)</label><input id="ce" value={f.certificadoNumero} onChange={set("certificadoNumero")} placeholder="Nº de un certificado anterior" /></div>
          <div className="field span-3"><BuscadorElemento valor={elemento} onChange={setElemento} /></div>
          <div className="field span-2"><label htmlFor="ob">Observaciones</label><input id="ob" value={f.observaciones} onChange={set("observaciones")} /></div>
          {d?.id && <div className="field"><label htmlFor="mo">Motivo de la corrección</label><input id="mo" value={f.motivo} onChange={set("motivo")} placeholder="Obligatorio si cambia el código" /></div>}
        </div>
      ) : d ? (
        <>
          <div className="form-grid">
            {[
              ["Listado", LISTADOS[d.listado]],
              ["Estado", ESTADO_COD[d.estado]?.l],
              ["Fabricante / titular", `${d.fabricanteNombre}${d.fabricanteRut ? ` · ${d.fabricanteRut}` : ""}`],
              ["Producto", d.producto],
              ["Elemento genérico", d.elementoGenerico],
              ["Clase/División UN · Nº UN", `${d.claseDivisionUn ?? "—"} · ${d.numeroUn ?? "—"}`],
              ["Grupo del listado oficial", d.grupoListado],
              ["EQ.DIN 60 % · PTN/PIN", `${d.eqDin60 != null ? String(d.eqDin60).replace(".", ",") : "—"} · ${d.ptnPin ?? "—"}`],
              ["Certificado asociado", d.certificadoNumero],
              ["Elemento del catálogo", d.catElementoNombre],
              ["Observaciones", d.observaciones],
            ].map(([l, v]) => <div key={l} className="field readonly"><label>{l}</label><input readOnly value={v || "—"} /></div>)}
          </div>
          {gestiona && (
            <div className="toolbar" style={{ marginTop: 10 }}>
              <input aria-label="Motivo del cambio de estado" placeholder={d.estado === "VIGENTE" ? "Motivo del paso a receso" : "Motivo de la reactivación"} value={estadoMotivo} onChange={(e) => setEstadoMotivo(e.target.value)} style={{ flex: 1 }} />
              <button type="button" className={`btn ${d.estado === "VIGENTE" ? "ghost-danger" : "success"} sm`} onClick={cambiarEstado}>{d.estado === "VIGENTE" ? "↓ Pasar a receso" : "↑ Reactivar"}</button>
            </div>
          )}
          <h3 style={{ fontSize: 13, margin: "12px 0 6px" }}>Historial</h3>
          <table className="data">
            <thead><tr><th>Fecha</th><th>Evento</th><th>Detalle</th><th>OT / documento</th><th>Usuario</th></tr></thead>
            <tbody>
              {(d.historial ?? []).map((h: any) => (
                <tr key={h.id}>
                  <td>{fechaHora(h.createdAt)}</td>
                  <td>{EVENTO[h.evento] ?? h.evento}</td>
                  <td style={{ fontSize: 11.5 }}>{resumen(h)}</td>
                  <td>{h.otCodigo ? <Link href={`/ot/${h.otId}` as any}>{h.otCodigo}</Link> : "—"}{h.certificadoNumero ? ` · ${h.certificadoNumero}` : ""}</td>
                  <td>{h.usuarioNombre ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </Modal>
  );
}

const CAMPO: Record<string, string> = {
  grupoListado: "grupo del listado",
  eqDin60: "EQ.DIN 60 %",
  ptnPin: "PTN/PIN",
  claseDivisionUn: "clase/división UN",
  numeroUn: "Nº UN",
  elementoGenerico: "elemento genérico",
  catElementoId: "elemento del catálogo",
};

function resumen(h: any): string {
  const x = h.detalle ?? {};
  switch (h.evento) {
    case "receso":
    case "reactivacion":
      return x.motivo ?? "";
    case "edicion":
      return [Object.keys(x.cambios ?? {}).map((k) => CAMPO[k] ?? k).join(", "), x.motivo].filter(Boolean).join(" · ");
    case "cambio_titular":
      return `${x.anterior?.nombre ?? ""} → ${x.nuevo?.nombre ?? ""} · ${x.motivo ?? ""}`;
    case "reinspeccion":
      return `${x.reinspeccion ?? ""} · ${x.condicion ?? ""}${x.destino ? ` · destino ${x.destino}` : ""}`;
    case "certificacion":
      return `${x.internacion ?? ""} · lote ${x.lote ?? "—"}`;
    default:
      return [x.producto, x.fabricante].filter(Boolean).join(" · ");
  }
}

const TIPO_LISTADO: Record<string, string> = { EXPLOSIVOS: "Explosivos", SUSTANCIAS_QUIMICAS: "Sustancias químicas", EN_RECESO: "En receso" };

/** EP-09 9.16 · listado oficial por fabricante: PDF para la firma o Excel, con registro de cada emisión. */
function EmitirListado({ gestiona, inicial, onCerrar }: { gestiona: boolean; inicial: Pestana; onCerrar: () => void }) {
  const [listado, setListado] = useState<string>(inicial);
  const [fabricantes, setFabricantes] = useState<{ fabricante: string; rut: string | null; elementos: number }[] | null>(null);
  const [fabricante, setFabricante] = useState("");
  const [fechaEdicion, setFechaEdicion] = useState(hoyChile());
  const [emisiones, setEmisiones] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const cargarEmisiones = useCallback(() => {
    pedir<any[]>("GET", "/bpch/codificacion/listado-oficial/emisiones").then(setEmisiones).catch(() => setEmisiones([]));
  }, []);
  useEffect(() => {
    setFabricantes(null);
    setFabricante("");
    pedir<any[]>("GET", `/bpch/codificacion/listado-oficial/fabricantes?listado=${listado}`)
      .then(setFabricantes)
      .catch((e) => {
        setError(e.message);
        setFabricantes([]);
      });
  }, [listado]);
  useEffect(() => cargarEmisiones(), [cargarEmisiones]);

  const total = fabricante ? fabricantes?.find((x) => x.fabricante === fabricante)?.elementos ?? 0 : (fabricantes ?? []).reduce((s, x) => s + x.elementos, 0);

  async function generar(formato: "pdf" | "excel") {
    setError("");
    setOcupado(true);
    try {
      const nombre = await descargarGenerado(`/bpch/codificacion/listado-oficial/${formato}`, { listado, fabricante: fabricante || null, fechaEdicion }, `listado.${formato === "pdf" ? "pdf" : "csv"}`);
      toast.ok(`Listado generado: ${nombre}`);
      cargarEmisiones();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Modal titulo="Listado oficial de Codificación Única" onCerrar={onCerrar} ancho={760}
      acciones={<>
        <button type="button" className="btn outline" disabled={ocupado || !total} onClick={() => generar("excel")}>Exportar a Excel</button>
        {gestiona && <button type="button" className="btn primary" disabled={ocupado || !total} onClick={() => generar("pdf")}>Generar listado → firma</button>}
        <button type="button" className="btn outline" onClick={onCerrar}>Cerrar</button>
      </>}
    >
      <p style={{ marginTop: 0, color: "var(--muted)", fontSize: 12.5 }}>
        Formato de los modelos DGMN: encabezado del Ministerio, fabricante y RUT, fecha de edición, productos por grupo y familia con totales, y las firmas del Subdirector del BPCH y del Jefe del Depto. Control de Armas y Explosivos de la DGMN. El PDF se firma fuera del LIMS; queda constancia de cada emisión.
      </p>
      {error && <div className="alert warn" role="alert">{error}</div>}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="lo-l">1 · Listado</label>
          <select id="lo-l" value={listado} onChange={(e) => setListado(e.target.value)}>
            {Object.entries(TIPO_LISTADO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="field span-2">
          <label htmlFor="lo-f">2 · Fabricante</label>
          <select id="lo-f" value={fabricante} onChange={(e) => setFabricante(e.target.value)} disabled={!fabricantes}>
            <option value="">Todos los fabricantes ({(fabricantes ?? []).length})</option>
            {(fabricantes ?? []).map((x) => <option key={x.fabricante} value={x.fabricante}>{x.fabricante}{x.rut ? ` · ${x.rut}` : ""} ({x.elementos})</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="lo-d">3 · Fecha de edición</label>
          <input id="lo-d" type="date" value={fechaEdicion} max={hoyChile()} onChange={(e) => setFechaEdicion(e.target.value)} />
        </div>
        <div className="field span-2 readonly">
          <label htmlFor="lo-t">Elementos que entran</label>
          <input id="lo-t" readOnly value={fabricantes === null ? "Cargando…" : total ? `${total} producto(s) ${listado === "EN_RECESO" ? "en receso" : "vigentes"}` : "Ningún producto en este listado"} />
        </div>
      </div>
      {!gestiona && <p style={{ fontSize: 12, color: "var(--muted)" }}>El PDF para la firma lo genera la Sección Certificación BPCH; con su perfil puede exportar a Excel.</p>}
      <h3 style={{ fontSize: 13, margin: "14px 0 6px" }}>Emisiones anteriores</h3>
      <table className="data">
        <thead><tr><th>Fecha</th><th>Listado</th><th>Fabricante</th><th>Edición</th><th>Elementos</th><th>Formato</th><th>Emitido por</th></tr></thead>
        <tbody>
          {emisiones.map((e) => (
            <tr key={e.id}>
              <td>{fechaHora(e.createdAt)}</td>
              <td>{TIPO_LISTADO[e.listado] ?? e.listado}</td>
              <td>{e.fabricante ?? "Todos"}</td>
              <td>{fecha(e.fechaEdicion)}</td>
              <td>{e.total}</td>
              <td>{e.formato === "pdf" ? "PDF" : "Excel"}</td>
              <td>{e.emitidoPor ?? "—"}</td>
            </tr>
          ))}
          {!emisiones.length && <tr><td colSpan={7} style={{ color: "var(--muted)" }}>Aún no se ha emitido ningún listado.</td></tr>}
        </tbody>
      </table>
    </Modal>
  );
}
