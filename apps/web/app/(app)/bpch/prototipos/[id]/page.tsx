"use client";

/**
 * Ficha del prototipo (BPCH). Pasos:
 *  1. Ingreso y antecedentes técnicos (fabricante, elemento, solicitud DGMN).
 *  2. Clasificación de la sustancia (una aprobada; obligatoria para aprobar el tipo).
 *  3. Pronunciamiento SAC sobre el tamaño de muestra (SAC-PG01-IT10, «Para prototipos»).
 *  4. OT de evaluación: se ejecuta con el flujo general (muestras, captura,
 *     revisión, aprobación) en el expediente de la OT.
 *  5. Dictamen: aprobación o rechazo del tipo → documento al circuito de firmas.
 *  6. Código único CNC-DGMN del tipo aprobado (con el certificado oficial).
 *  7. Inscripción del tipo en la Codificación Única con sus datos heredados.
 * En el ingreso se comprueba «¿está codificado?» (EP-08 8.8) y se adjuntan la
 * ficha técnica y la hoja de datos de seguridad.
 * /bpch/prototipos/nuevo = ingreso.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { toast, confirmar } from "@/components/ui/feedback";
import Modal from "@/components/documentos/Modal";
import SelectorFabricante, { type Fabricante } from "@/components/bpch-procesos/SelectorFabricante";
import SelectorClasificacion from "@/components/bpch-procesos/SelectorClasificacion";
import { usePermisos } from "@/lib/permisos";
import { llamar } from "@/lib/laboratorio";
import { fechaHora } from "@/lib/format";
import { ESTADO_PROTOTIPO, dia } from "@/lib/bpchProcesos";
import { descargarAdjunto, subirFormulario } from "@/lib/d11";

const CLASE_ADJUNTO: Record<string, string> = { ficha_tecnica: "Ficha técnica", hoja_seguridad: "Hoja de datos de seguridad" };

const VEREDICTO: Record<string, { t: string; pill: string }> = {
  cumple: { t: "Cumple", pill: "green" },
  no_cumple: { t: "No cumple", pill: "red" },
  pendiente: { t: "Pendiente", pill: "amber" },
  sin_resultados: { t: "Sin resultados", pill: "gray" },
};

function Paso({ n, titulo, hecho, children }: { n: number; titulo: string; hecho: boolean; children: React.ReactNode }) {
  return (
    <section className="card" style={{ padding: 14 }} aria-labelledby={`paso-${n}`}>
      <h2 id={`paso-${n}`} style={{ fontSize: 14, margin: "0 0 10px", display: "flex", gap: 8, alignItems: "center" }}>
        <span aria-hidden style={{ width: 22, height: 22, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, background: hecho ? "var(--green)" : "#eef3f7", color: hecho ? "#fff" : "var(--muted)" }}>
          {hecho ? "✓" : n}
        </span>
        {titulo}
      </h2>
      {children}
    </section>
  );
}

function Faltan({ lista }: { lista: string[] }) {
  if (!lista?.length) return null;
  return (
    <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12, color: "var(--muted)" }}>
      {lista.map((x) => <li key={x}>{x}</li>)}
    </ul>
  );
}

export default function PrototipoPage() {
  const { id } = useParams<{ id: string }>();
  const nuevo = id === "nuevo";
  const router = useRouter();
  const { puede } = usePermisos();
  const [p, setP] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [unidades, setUnidades] = useState<{ id: string; codigo: string; nombre: string }[]>([]);

  // Ingreso
  const [fab, setFab] = useState<Fabricante | null>(null);
  const [elemento, setElemento] = useState("");
  const [solicitud, setSolicitud] = useState("");
  const [fechaSol, setFechaSol] = useState("");
  const [grupo, setGrupo] = useState("");
  const [ficha, setFicha] = useState("");
  const [hds, setHds] = useState("");
  const [desc, setDesc] = useState("");
  const [clasId, setClasId] = useState("");
  // SAC
  const [sac, setSac] = useState({ consultaAt: "", referencia: "", tamanoMuestra: "", respuestaAt: "", observacion: "" });
  // OT
  const [unidadId, setUnidadId] = useState("");
  const [cobro, setCobro] = useState<"" | "si" | "no">("");
  // Dictamen / código
  const [dictamen, setDictamen] = useState<"" | "aprobado" | "rechazado">("");
  const [motivo, setMotivo] = useState("");
  const [cnc, setCnc] = useState("");
  const [anular, setAnular] = useState(false);
  const [motivoAnular, setMotivoAnular] = useState("");
  // ¿Está codificado? (8.8) e inscripción (8.17)
  const [revision, setRevision] = useState<{ elemento: string; codificado: boolean; exactos: any[]; parecidos: any[] } | null>(null);
  const [listadoCu, setListadoCu] = useState("");

  const volcar = useCallback((x: any) => {
    setP(x);
    setFab(x.cliente ? { id: x.cliente.id, rut: x.cliente.rut, razonSocial: x.cliente.razonSocial } : null);
    setElemento(x.elemento ?? "");
    setSolicitud(x.solicitudDgmn ?? "");
    setFechaSol(x.fechaSolicitud ?? "");
    setGrupo(x.grupoPropuesto ?? "");
    setFicha(x.fichaTecnica ?? "");
    setHds(x.hojaSeguridad ?? "");
    setDesc(x.descripcionTecnica ?? "");
    setClasId(x.clasificacion?.id ?? "");
    setSac({
      consultaAt: x.sac?.consultaAt ?? "",
      referencia: x.sac?.referencia ?? "",
      tamanoMuestra: x.sac?.tamanoMuestra ? String(x.sac.tamanoMuestra) : "",
      respuestaAt: x.sac?.respuestaAt ?? "",
      observacion: x.sac?.observacion ?? "",
    });
  }, []);

  const cargar = useCallback(async () => {
    if (nuevo) return;
    try {
      volcar(await llamar("GET", `/bpch/prototipos/${id}`));
    } catch (e: any) {
      setError(e.message);
    }
  }, [id, nuevo, volcar]);

  useEffect(() => {
    cargar();
    llamar<{ unidades: any[] }>("GET", "/bpch/pn/config").then((c) => setUnidades(c.unidades)).catch(() => setUnidades([]));
  }, [cargar]);

  const gestionar = puede("bpch.prototipo.gestionar");
  const dictaminar = puede("bpch.prototipo.dictaminar");
  const cerrado = p && (p.estado === "anulado" || p.estado === "dictaminado");
  const conOt = Boolean(p?.ot && p.ot.estado !== "anulada");

  async function ejecutar(fn: () => Promise<any>, ok: string) {
    setError("");
    setBusy(true);
    try {
      const r = await fn();
      toast.ok(ok);
      return r;
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function revisarCodificado(): Promise<boolean> {
    const e = elemento.trim();
    if (e.length < 2) return true;
    try {
      const r = await llamar<any>("GET", `/bpch/prototipos/codificado?elemento=${encodeURIComponent(e)}`);
      setRevision({ elemento: e, ...r });
      return !r.codificado;
    } catch {
      return true; // la API vuelve a comprobarlo al guardar
    }
  }

  async function adjuntar(clase: string, archivo: File | undefined) {
    if (!archivo) return;
    const f = new FormData();
    f.append("clase", clase);
    f.append("archivo", archivo, archivo.name);
    const r = await ejecutar(() => subirFormulario(`/bpch/prototipos/${id}/adjuntos`, f), `${CLASE_ADJUNTO[clase]} adjunta.`);
    if (r) cargar();
  }

  async function guardarIngreso() {
    if (!fab || !elemento.trim() || !solicitud.trim()) {
      setError("Complete fabricante, elemento y solicitud o resolución DGMN.");
      return;
    }
    if (nuevo && !(await revisarCodificado())) {
      setError("El elemento ya está codificado: no corresponde ingresarlo como prototipo.");
      return;
    }
    const cuerpo: any = {
      elemento, solicitudDgmn: solicitud, fechaSolicitud: fechaSol, grupoPropuesto: grupo, fichaTecnica: ficha, hojaSeguridad: hds,
      descripcionTecnica: desc, clasificacionId: clasId || null,
    };
    if (nuevo || !conOt) cuerpo.clienteId = fab.id;
    if (conOt) { delete cuerpo.elemento; delete cuerpo.solicitudDgmn; }
    const r = await ejecutar(
      () => (nuevo ? llamar("POST", "/bpch/prototipos", cuerpo) : llamar("PATCH", `/bpch/prototipos/${id}`, cuerpo)),
      nuevo ? "Prototipo ingresado." : "Datos guardados.",
    );
    if (!r) return;
    if (nuevo) router.replace(`/bpch/prototipos/${r.id}` as any);
    else volcar(r);
  }

  if (!nuevo && !p)
    return <div>{error ? <div className="alert warn" role="alert">{error}</div> : <p style={{ color: "var(--muted)" }}>Cargando el prototipo…</p>}</div>;

  const titulo = nuevo ? "Ingresar prototipo" : `${p?.codigo ?? ""} · ${p?.elemento ?? ""}`;

  return (
    <div>
      <PageHeader
        icono="◇"
        titulo={<>{titulo} {p && <span className={`pill ${ESTADO_PROTOTIPO[p.estado]?.pill ?? "gray"}`} style={{ verticalAlign: "middle" }}>{p.etapa}</span>}</>}
        subtitulo="Esquema TIPO: se aprueba el tipo (no un lote). Los ensayos se ejecutan en la OT con el flujo general del laboratorio."
        migas={[{ label: "BPCH" }, { label: "Prototipos", href: "/bpch/prototipos" }, { label: nuevo ? "Nuevo" : p?.codigo ?? "…" }]}
        acciones={
          p && !cerrado && gestionar && !conOt ? (
            <button className="btn danger sm" onClick={() => { setMotivoAnular(""); setAnular(true); }}>Anular</button>
          ) : null
        }
      />
      {error && <div className="alert warn" role="alert">{error}</div>}
      {p?.anulado && <div className="alert warn">Anulado el {fechaHora(p.anulado.at)}: {p.anulado.motivo}</div>}

      <Paso n={1} titulo="Ingreso y antecedentes técnicos" hecho={!nuevo}>
        <div className="form-grid cols-2">
          {(nuevo || (!conOt && !cerrado)) && gestionar ? (
            <SelectorFabricante valor={fab} onCambio={setFab} rutaAlta="/bpch/prototipos/fabricantes" puedeCrear={gestionar} />
          ) : (
            <div className="field readonly"><label>Fabricante</label><input readOnly value={fab ? `${fab.razonSocial} · ${fab.rut}` : "—"} /></div>
          )}
          <div className="field">
            <label htmlFor="elem">Elemento nuevo <span className="req">*</span></label>
            <input id="elem" value={elemento} onChange={(e) => { setElemento(e.target.value); setRevision(null); }} onBlur={() => nuevo && revisarCodificado()} maxLength={240} disabled={!gestionar || cerrado || conOt} />
            {nuevo && gestionar && (
              <button type="button" className="btn ghost sm" style={{ marginTop: 4, alignSelf: "flex-start" }} disabled={elemento.trim().length < 2} onClick={revisarCodificado}>¿Está codificado?</button>
            )}
          </div>
          {revision && revision.elemento === elemento.trim() && (
            <div role="status" style={{ gridColumn: "1 / -1" }}>
              {revision.codificado ? (
                <div className="alert warn" style={{ margin: 0 }}>
                  <b>Ya está codificado:</b> {revision.exactos.map((x: any) => `${x.origen === "codificacion" ? "Codificación Única" : "catálogo"} ${x.detalle}`).join("; ")}. No es un prototipo: corresponde Internación, Producción Nacional o Reinspección.
                </div>
              ) : (
                <div className="alert info" style={{ margin: 0 }}>
                  No está en la Codificación Única ni en el catálogo.
                  {revision.parecidos.length > 0 && <> Parecidos (revise que no sea el mismo): {revision.parecidos.map((x: any) => x.detalle).join("; ")}.</>}
                </div>
              )}
            </div>
          )}
          <div className="field">
            <label htmlFor="sol">Solicitud / resolución DGMN <span className="req">*</span></label>
            <input id="sol" value={solicitud} onChange={(e) => setSolicitud(e.target.value)} maxLength={120} disabled={!gestionar || cerrado || conOt} />
          </div>
          <div className="field">
            <label htmlFor="fsol">Fecha de la solicitud</label>
            <input id="fsol" type="date" value={fechaSol} onChange={(e) => setFechaSol(e.target.value)} disabled={!gestionar || cerrado} />
          </div>
          <div className="field">
            <label htmlFor="grupo">Grupo / subgrupo propuesto del catálogo</label>
            <input id="grupo" value={grupo} onChange={(e) => setGrupo(e.target.value)} maxLength={200} disabled={!gestionar || cerrado} placeholder="p. ej. Detonadores · electrónicos" />
          </div>
          <div className="field">
            <label htmlFor="ficha">Ficha técnica (referencia)</label>
            <input id="ficha" value={ficha} onChange={(e) => setFicha(e.target.value)} maxLength={200} disabled={!gestionar || cerrado} />
          </div>
          <div className="field">
            <label htmlFor="hds">Hoja de datos de seguridad (referencia)</label>
            <input id="hds" value={hds} onChange={(e) => setHds(e.target.value)} maxLength={200} disabled={!gestionar || cerrado} />
          </div>
          <div className="field span-2">
            <label htmlFor="desc">Antecedentes técnicos</label>
            <textarea id="desc" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} disabled={!gestionar || cerrado} />
          </div>
          <div className="field span-2">
            <span style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>Documentos adjuntos (PDF, PNG o JPEG)</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 4 }}>
              {(p?.adjuntos ?? []).map((a: any) => (
                <button key={a.id} type="button" className="btn outline sm" onClick={() => descargarAdjunto(`/bpch/prototipos/${id}/adjuntos/${a.id}`, a.nombre).catch((x) => toast.error(x.message))}>
                  ⭳ {CLASE_ADJUNTO[a.clase] ?? a.clase} · {a.nombre}
                </button>
              ))}
              {!nuevo && gestionar && p?.estado !== "anulado" && Object.entries(CLASE_ADJUNTO).map(([k, v]) => (
                <label key={k} className="btn ghost sm" style={{ cursor: "pointer", textTransform: "none", letterSpacing: 0 }}>
                  ＋ {v}
                  <input type="file" hidden accept="application/pdf,image/png,image/jpeg" onChange={(e) => adjuntar(k, e.target.files?.[0])} />
                </label>
              ))}
              {nuevo && <small style={{ color: "var(--muted)" }}>Se adjuntan después de ingresar el prototipo.</small>}
              {!nuevo && !(p?.adjuntos ?? []).length && !gestionar && <small style={{ color: "var(--muted)" }}>Sin adjuntos.</small>}
            </div>
          </div>
        </div>
        {gestionar && !cerrado && (
          <div className="toolbar" style={{ margin: "10px 0 0" }}>
            <button className="btn primary sm" disabled={busy || (nuevo && revision?.elemento === elemento.trim() && revision.codificado)} onClick={guardarIngreso}>{nuevo ? "Guardar → clasificar" : "Guardar antecedentes"}</button>
          </div>
        )}
      </Paso>

      {!nuevo && p && (
        <>
          <Paso n={2} titulo="Clasificación de la sustancia" hecho={p.clasificacion?.estado === "aprobada"}>
            <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--muted)" }}>
              Un elemento nuevo debe tener su clasificación aprobada (series de prueba ONU) para aprobar el tipo.
            </p>
            {p.clasificacion && (
              <p style={{ margin: "0 0 8px", fontSize: 13 }}>
                Actual: <Link href={`/bpch/clasificaciones/${p.clasificacion.id}` as any}>{p.clasificacion.codigo}</Link> · {p.clasificacion.resumen}
              </p>
            )}
            {gestionar && !cerrado && (
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 280 }}><SelectorClasificacion valor={clasId} onCambio={setClasId} /></div>
                <button className="btn outline sm" disabled={busy || clasId === (p.clasificacion?.id ?? "")}
                  onClick={async () => { const r = await ejecutar(() => llamar("PATCH", `/bpch/prototipos/${id}`, { clasificacionId: clasId || null }), "Clasificación asignada."); if (r) volcar(r); }}>
                  Asignar
                </button>
                <Link href={"/bpch/clasificaciones/nueva" as any} className="btn outline sm">Registrar una clasificación</Link>
              </div>
            )}
          </Paso>

          <Paso n={3} titulo="Pronunciamiento SAC · tamaño de muestra (SAC-PG01-IT10)" hecho={Boolean(p.sac?.tamanoMuestra)}>
            <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--muted)" }}>
              La SCC envía a la SAC la información técnica del prototipo (con copia al Subdirector BPCH) y la SAC indica cuántas muestras debe extraer la sucursal.
            </p>
            <div className="form-grid cols-4">
              <div className="field"><label htmlFor="sac-c">Fecha de la consulta</label><input id="sac-c" type="date" value={sac.consultaAt} onChange={(e) => setSac({ ...sac, consultaAt: e.target.value })} disabled={!gestionar || p.estado !== "ingresado"} /></div>
              <div className="field"><label htmlFor="sac-r">Fecha de la respuesta</label><input id="sac-r" type="date" value={sac.respuestaAt} onChange={(e) => setSac({ ...sac, respuestaAt: e.target.value })} disabled={!gestionar || p.estado !== "ingresado"} /></div>
              <div className="field"><label htmlFor="sac-n">Tamaño de muestra <span className="req">*</span></label><input id="sac-n" inputMode="numeric" value={sac.tamanoMuestra} onChange={(e) => setSac({ ...sac, tamanoMuestra: e.target.value.replace(/\D/g, "") })} disabled={!gestionar || p.estado !== "ingresado"} /></div>
              <div className="field"><label htmlFor="sac-ref">Referencia (correo / documento)</label><input id="sac-ref" value={sac.referencia} onChange={(e) => setSac({ ...sac, referencia: e.target.value })} maxLength={200} disabled={!gestionar || p.estado !== "ingresado"} /></div>
              <div className="field span-3"><label htmlFor="sac-o">Observación</label><input id="sac-o" value={sac.observacion} onChange={(e) => setSac({ ...sac, observacion: e.target.value })} disabled={!gestionar || p.estado !== "ingresado"} /></div>
            </div>
            {gestionar && p.estado === "ingresado" && (
              <div className="toolbar" style={{ margin: "10px 0 0" }}>
                <button className="btn outline sm" disabled={busy || !sac.tamanoMuestra}
                  onClick={async () => { const r = await ejecutar(() => llamar("POST", `/bpch/prototipos/${id}/pronunciamiento-sac`, { ...sac, tamanoMuestra: Number(sac.tamanoMuestra) }), "Pronunciamiento SAC registrado."); if (r) volcar(r); }}>
                  Registrar pronunciamiento
                </button>
              </div>
            )}
          </Paso>

          <Paso n={4} titulo="OT de evaluación (flujo general)" hecho={conOt && p.evaluacion.resultados > 0 && p.evaluacion.aprobados === p.evaluacion.resultados}>
            {conOt ? (
              <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
                <div>OT <Link href={`/ot/${p.ot.id}` as any} className="codigo" style={{ textDecoration: "underline" }}>{p.ot.codigo}</Link> · {p.unidad?.codigo} · estado <b>{p.ot.estado}</b></div>
                <div>Resultados aprobados: <b>{p.evaluacion.aprobados} de {p.evaluacion.resultados}</b></div>
                <div>Veredicto: <span className={`pill ${VEREDICTO[p.evaluacion.veredicto]?.pill}`}>{VEREDICTO[p.evaluacion.veredicto]?.t}</span></div>
                <Link href={`/ot/${p.ot.id}` as any} className="btn outline sm">Abrir el expediente de la OT</Link>
              </div>
            ) : (
              <>
                <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--muted)" }}>
                  La OT queda asignada a la sucursal o sección que inspecciona. Allí se registran las muestras (tamaño indicado por la SAC), se capturan los resultados del panel y se revisan y aprueban.
                </p>
                {gestionar && p.estado === "ingresado" && (
                  <div className="form-grid cols-4" style={{ alignItems: "end" }}>
                    <div className="field span-2">
                      <label htmlFor="uni">Sucursal / sección que inspecciona <span className="req">*</span></label>
                      <select id="uni" value={unidadId} onChange={(e) => setUnidadId(e.target.value)}>
                        <option value="">— Seleccione —</option>
                        {unidades.map((u) => <option key={u.id} value={u.id}>{u.codigo} · {u.nombre}</option>)}
                      </select>
                    </div>
                    <fieldset className="field" style={{ border: "none", padding: 0, margin: 0 }}>
                      <legend style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>Cobro <span className="req">*</span></legend>
                      <div style={{ display: "flex", gap: 12, paddingTop: 4 }}>
                        <label><input type="radio" name="cobro" checked={cobro === "si"} onChange={() => setCobro("si")} /> Con cobro</label>
                        <label><input type="radio" name="cobro" checked={cobro === "no"} onChange={() => setCobro("no")} /> Sin cobro</label>
                      </div>
                    </fieldset>
                    <button className="btn primary sm" disabled={busy || !unidadId || !cobro}
                      onClick={async () => { const r = await ejecutar(() => llamar("POST", `/bpch/prototipos/${id}/generar-ot`, { unidadId, conCobro: cobro === "si" }), "OT generada."); if (r) volcar(r.prototipo); }}>
                      Generar OT
                    </button>
                  </div>
                )}
                <Faltan lista={p.faltantes.generarOt} />
              </>
            )}
          </Paso>

          <Paso n={5} titulo="Dictamen del tipo y documento" hecho={p.estado === "dictaminado"}>
            {p.dictamenDetalle && (
              <p style={{ margin: "0 0 8px", fontSize: 13 }}>
                <b>{p.dictamenDetalle.dictamen === "aprobado" ? "Aprobado" : "Rechazado"}</b> por {p.dictamenDetalle.por} el {fechaHora(p.dictamenDetalle.at)}
                {p.dictamenDetalle.motivo ? ` · ${p.dictamenDetalle.motivo}` : ""}
              </p>
            )}
            {p.documento && (
              <p style={{ margin: "0 0 8px", fontSize: 13 }}>
                Documento <b>{p.documento.numero}</b> · <span className="pill blue">{p.documento.estado}</span>{" "}
                {p.documento.estado === "en_firma" && "· se firma en «Documentos por firmar» según la matriz de firmas. "}
                {p.ot && <Link href={`/ot/${p.ot.id}` as any}>Ver en el expediente de la OT («Informe y cierre»)</Link>}
              </p>
            )}
            {dictaminar && conOt && (p.estado !== "dictaminado" || !["en_firma", "oficial", "emitido", "devuelto"].includes(p.documento?.estado ?? "")) && (
              <>
                <div className="form-grid cols-4" style={{ alignItems: "end" }}>
                  <fieldset className="field" style={{ border: "none", padding: 0, margin: 0 }}>
                    <legend style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>Dictamen <span className="req">*</span></legend>
                    <div style={{ display: "flex", gap: 12, paddingTop: 4 }}>
                      <label><input type="radio" name="dict" checked={dictamen === "aprobado"} onChange={() => setDictamen("aprobado")} /> Aprobar el tipo</label>
                      <label><input type="radio" name="dict" checked={dictamen === "rechazado"} onChange={() => setDictamen("rechazado")} /> Rechazar</label>
                    </div>
                  </fieldset>
                  <div className="field span-2">
                    <label htmlFor="mot">Fundamento{dictamen === "rechazado" && <span className="req"> *</span>}</label>
                    <input id="mot" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={4000} placeholder={dictamen === "rechazado" ? "Motivo del rechazo (obligatorio)" : "Opcional"} />
                  </div>
                  <button className="btn primary sm" disabled={busy || !dictamen}
                    onClick={async () => {
                      const doc = dictamen === "aprobado" ? "el certificado de aprobación de tipo" : "el informe de rechazo";
                      if (!(await confirmar({ titulo: `¿${dictamen === "aprobado" ? "Aprobar" : "Rechazar"} el tipo?`, mensaje: `Se emite ${doc} y queda en firma según la matriz de firmas.`, confirmarTexto: "Dictaminar y emitir" })))
                        return;
                      const r = await ejecutar(() => llamar("POST", `/bpch/prototipos/${id}/dictamen`, { dictamen, motivo }), "Dictamen registrado: documento en firma.");
                      if (r) volcar(r.prototipo);
                    }}>
                    Dictaminar y emitir
                  </button>
                </div>
                {dictamen && <Faltan lista={dictamen === "aprobado" ? p.faltantes.aprobar : p.faltantes.rechazar.filter((x: string) => !/motivo/.test(x))} />}
              </>
            )}
            {!conOt && <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>Se dictamina cuando la OT tiene todos sus resultados aprobados.</p>}
          </Paso>

          {p.dictamen === "aprobado" && (
            <Paso n={6} titulo="Código único CNC-DGMN del tipo aprobado" hecho={Boolean(p.codigoCnc)}>
              {p.codigoCncDetalle ? (
                <p style={{ margin: 0, fontSize: 13 }}>
                  <b>{p.codigoCncDetalle.codigo}</b> · registrado por {p.codigoCncDetalle.por} el {fechaHora(p.codigoCncDetalle.at)}.
                </p>
              ) : dictaminar ? (
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                  <div className="field" style={{ minWidth: 280 }}>
                    <label htmlFor="cnc">Código único <span className="req">*</span></label>
                    <input id="cnc" value={cnc} onChange={(e) => setCnc(e.target.value)} maxLength={60} placeholder="Seis partes: E-I/n/n/n/n/n" />
                  </div>
                  <button className="btn primary sm" disabled={busy || !cnc.trim() || !["oficial", "emitido"].includes(p.documento?.estado)}
                    onClick={async () => { const r = await ejecutar(() => llamar("POST", `/bpch/prototipos/${id}/codigo-cnc`, { codigo: cnc }), "Código único registrado."); if (r) volcar(r); }}>
                    Registrar código
                  </button>
                  {!["oficial", "emitido"].includes(p.documento?.estado) && <small style={{ color: "var(--muted)" }}>Se registra cuando el certificado de aprobación de tipo es oficial (firmado).</small>}
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>Pendiente de registrar.</p>
              )}
            </Paso>
          )}
          {p.dictamen === "aprobado" && p.codigoCnc && (
            <Paso n={7} titulo="Inscripción en la Codificación Única" hecho={Boolean(p.inscripcionCu?.inscrito)}>
              {p.inscripcionCu?.inscrito ? (
                <p style={{ margin: 0, fontSize: 13 }}>
                  Inscrito como <b className="codigo">{p.inscripcionCu.inscrito.cnc}</b> · {p.inscripcionCu.inscrito.listado === "EXPLOSIVOS" ? "Explosivos" : "Sustancias químicas"} · {p.inscripcionCu.inscrito.estado === "VIGENTE" ? "vigente" : "en receso"}.{" "}
                  <Link href={"/bpch/codificacion" as any}>Ver la Codificación Única</Link>
                </p>
              ) : puede("bpch.codificacion.gestionar") ? (
                <>
                  <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--muted)" }}>
                    Se inscribe con los datos del prototipo: fabricante, elemento, código {p.codigoCnc}, clase/división y Nº ONU de su clasificación y el certificado de aprobación de tipo {p.documento?.numero}.
                  </p>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                    <div className="field" style={{ minWidth: 220 }}>
                      <label htmlFor="cu-l">Listado <span className="req">*</span></label>
                      <select id="cu-l" value={listadoCu} onChange={(e) => setListadoCu(e.target.value)}>
                        <option value="">Elija…</option>
                        <option value="EXPLOSIVOS">Explosivos</option>
                        <option value="SUSTANCIAS_QUIMICAS">Sustancias químicas</option>
                      </select>
                    </div>
                    <button className="btn primary sm" disabled={busy || !listadoCu || (p.inscripcionCu?.faltantes ?? []).length > 0}
                      onClick={async () => { const r = await ejecutar(() => llamar("POST", `/bpch/codificacion/desde-prototipo/${id}`, { listado: listadoCu }), "Tipo inscrito en la Codificación Única."); if (r) cargar(); }}>
                      Inscribir en Codificación Única → listado oficial
                    </button>
                  </div>
                  <Faltan lista={p.inscripcionCu?.faltantes ?? []} />
                </>
              ) : (
                <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>Le toca inscribirlo a la Sección Certificación BPCH (Codificación Única).</p>
              )}
            </Paso>
          )}
          <p style={{ fontSize: 11.5, color: "var(--muted)" }}>Ingresado el {fechaHora(p.createdAt)}{p.fechaSolicitud ? ` · solicitud del ${dia(p.fechaSolicitud)}` : ""}.</p>
        </>
      )}

      {anular && (
        <Modal
          titulo="Anular el prototipo"
          onCerrar={() => setAnular(false)}
          acciones={
            <>
              <button className="btn outline sm" onClick={() => setAnular(false)}>Cancelar</button>
              <button className="btn danger sm" disabled={busy || motivoAnular.trim().length < 5}
                onClick={async () => { setAnular(false); const r = await ejecutar(() => llamar("POST", `/bpch/prototipos/${id}/anular`, { motivo: motivoAnular }), "Prototipo anulado."); if (r) volcar(r); }}>
                Anular
              </button>
            </>
          }
        >
          <div className="field">
            <label htmlFor="mot-an">Motivo <span className="req">*</span></label>
            <textarea id="mot-an" rows={3} value={motivoAnular} onChange={(e) => setMotivoAnular(e.target.value)} placeholder="Al menos 5 caracteres" />
          </div>
        </Modal>
      )}
    </div>
  );
}
