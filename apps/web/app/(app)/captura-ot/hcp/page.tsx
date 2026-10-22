"use client";

/**
 * SVM · Hoja de Control de Pruebas por vehículo (EP-05 4.6–4.8).
 *
 *   1 Lote y muestra: HCP del tipo de vehículo (Parámetros), tamaño del lote y
 *     vehículos a inspeccionar (n sugerido por NCh 44).
 *   2 HCP por vehículo: cabecera (inspectores, chasis, motor, km…) y C / N/C por
 *     ítem con su clase A/B/C; N/C exige observación; giro, frenado y pendientes
 *     se deciden con el valor medido. «Guardar vehículo → siguiente vehículo».
 *   3 Novedades del lote: las N/C de la HCP, la acción del proveedor, la regla
 *     del lote por clase y «Emitir acta de novedades → evaluación del lote».
 *
 * API: /formularios/ot/:otId/hcp (+ /lote, /vehiculo/:muestraId, /acciones, /acta).
 */
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, SkeletonCards } from "@/components/ui/PageHeader";
import { toast } from "@/components/ui/feedback";
import { llamar } from "@/lib/laboratorio";
import { hoyISO } from "@/lib/format";
import { abrirProtegido, aNum, Bitacora, Campo, conComa, Pasos, Veredicto, type PasoFormulario } from "@/components/formularios/comun";

interface Item { item: string; grupo: string; subgrupo: string | null; requisito: string; cantidad: string | null; clase: "A" | "B" | "C"; metodo: string | null; min: number | null; max: number | null; unidad: string | null }
interface ResItem { resultado?: "C" | "NC" | null; valor?: number | null; observacion?: string | null }
interface Vehiculo {
  muestra: { id: string; codigo: string; nombre: string | null };
  registro: { estado: string; version: number } | null;
  inspeccion: { numero: number; cabecera: any; items: Record<string, ResItem> } | null;
  evaluacion: { respondidos: number; total: number; ncPorClase: Record<string, number>; veredicto: string; estado: string } | null;
  estado: string;
  ensayos: any[];
}
interface Vista {
  ot: { id: string; codigo: string; estado: string; cliente: string | null };
  lote: { estado: string; datos: { plantilla?: string; tamanoLote?: number; muestra?: number; acciones?: Record<string, string>; acta?: { fecha: string; hash: string; por: string | null } | null } } | null;
  plantillas: { codigo: string; nombre: string; items: number }[];
  plantilla: { codigo: string; nombre: string; items: Item[] } | null;
  config: { nivel: string; aqlA: string; aqlB: string; aqlC: string };
  nSugerido: number | null;
  vehiculos: Vehiculo[];
  evaluacionLote: { tamanoLote: number; muestra: number; inspeccionados: number; clases: any[]; veredicto: string; regla: string; errores: string[] } | null;
  novedades: { vehiculo: number; chasis: string | null; item: string; clase: string; descripcion: string; accionProveedor: string | null }[];
  eventos: any[];
  puedeEditar: boolean;
  bloqueo: string | null;
}
const ESTADO: Record<string, { t: string; pill: string }> = {
  inspeccionado: { t: "Inspeccionado", pill: "green" },
  en_inspeccion: { t: "En inspección", pill: "amber" },
  pendiente: { t: "Pendiente", pill: "gray" },
};

function Contenido() {
  const sp = useSearchParams();
  const otId = sp.get("otId") ?? "";
  const [v, setV] = useState<Vista | null>(null);
  const [error, setError] = useState("");
  const [paso, setPaso] = useState("lote");
  const [vehiculo, setVehiculo] = useState(sp.get("muestraId") ?? "");

  const cargar = useCallback(async () => {
    try {
      const r = await llamar<Vista>("GET", `/formularios/ot/${otId}/hcp`);
      setV(r);
      setError("");
      return r;
    } catch (e: any) {
      setError(e.message);
      return null;
    }
  }, [otId]);
  useEffect(() => {
    if (!otId) return;
    cargar().then((r) => {
      if (!r) return;
      setPaso(r.lote?.estado === "acta_emitida" ? "novedades" : r.plantilla ? "hcp" : "lote");
      setVehiculo((x) => x || (r.vehiculos.find((y) => y.estado !== "inspeccionado") ?? r.vehiculos[0])?.muestra.id || "");
    });
  }, [otId, cargar]);

  if (!otId) return <div className="alert warn">Abra la HCP desde la OT o desde «Captura y revisión por OT».</div>;
  if (error) return <div className="alert warn">{error}</div>;
  if (!v) return <SkeletonCards n={3} />;

  const acta = v.lote?.estado === "acta_emitida";
  const editable = v.puedeEditar && !acta && !v.bloqueo;
  const ins = v.vehiculos.filter((x) => x.estado === "inspeccionado").length;
  const n = v.lote?.datos.muestra ?? 0;
  const pasos: PasoFormulario[] = [
    { clave: "lote", titulo: "Lote y muestra", estado: v.plantilla && n ? "hecho" : "actual", detalle: v.plantilla ? `${v.plantilla.codigo} · lote ${v.lote?.datos.tamanoLote} · n = ${n}` : "Elija la HCP" },
    { clave: "hcp", titulo: "HCP por vehículo", estado: n && ins >= n ? "hecho" : v.plantilla ? "actual" : "pendiente", detalle: `${ins} de ${n || "—"} vehículos inspeccionados` },
    { clave: "novedades", titulo: "Novedades del lote", estado: acta ? "hecho" : "pendiente", detalle: acta ? "Acta emitida" : `${v.novedades.length} novedad(es)` },
  ];
  return (
    <div>
      <PageHeader
        titulo={`Hoja de Control de Pruebas · OT ${v.ot.codigo}`}
        subtitulo={`${v.ot.cliente ?? ""} · Sección Vehículos Militares (LVM-PG01-IT03-FORM02). Cada vehículo es una muestra de la OT; las clases A/B/C vienen de la HCP.`}
        migas={[{ label: "Captura y revisión por OT", href: `/captura-ot?otId=${otId}` }, { label: v.ot.codigo, href: `/ot/${otId}` }, { label: "HCP por vehículo" }]}
        acciones={v.evaluacionLote ? <Veredicto v={v.evaluacionLote.veredicto} prefijo="Lote" /> : null}
      />
      {v.bloqueo && <div className="alert warn">{v.bloqueo} <Link href={`/ot/${otId}?tab=preparacion` as any} style={{ color: "inherit", fontWeight: 600 }}>Ir a Preparación</Link></div>}
      {!v.puedeEditar && !v.bloqueo && <div className="alert info">Usted ve la HCP en modo consulta.</div>}
      <Pasos pasos={pasos} activo={paso} onElegir={setPaso} />
      {paso === "lote" && <PasoLote v={v} editable={editable} onListo={async () => { await cargar(); setPaso("hcp"); }} />}
      {paso === "hcp" && <PasoVehiculo v={v} editable={editable} vehiculo={vehiculo} setVehiculo={setVehiculo} onCambio={cargar} onFin={() => setPaso("novedades")} />}
      {paso === "novedades" && <PasoNovedades v={v} editable={v.puedeEditar && !acta} onCambio={cargar} />}
      <Bitacora eventos={v.eventos} />
    </div>
  );
}

function PasoLote({ v, editable, onListo }: { v: Vista; editable: boolean; onListo: () => Promise<void> }) {
  const [plantilla, setPlantilla] = useState(v.lote?.datos.plantilla ?? v.plantillas[0]?.codigo ?? "");
  const [tamano, setTamano] = useState(v.lote?.datos.tamanoLote ? String(v.lote.datos.tamanoLote) : "");
  const [muestra, setMuestra] = useState(v.lote?.datos.muestra ? String(v.lote.datos.muestra) : "");
  const [ocupado, setOcupado] = useState(false);
  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true);
    try {
      await llamar("PUT", `/formularios/ot/${v.ot.id}/hcp/lote`, { plantilla, tamanoLote: Number(tamano), muestra: Number(muestra) });
      toast.ok("Datos del lote guardados.");
      await onListo();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setOcupado(false);
    }
  }
  return (
    <form className="card" onSubmit={guardar}>
      <h2>1 · Lote y muestra</h2>
      <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="form-grid">
          <Campo id="pl" etiqueta="HCP del tipo de vehículo" req ayuda="Las HCP se configuran en Administración › Parámetros del sistema.">
            <select id="pl" value={plantilla} onChange={(e) => setPlantilla(e.target.value)}>
              {v.plantillas.map((p) => <option key={p.codigo} value={p.codigo}>{p.codigo} · {p.nombre} ({p.items} ítems)</option>)}
            </select>
          </Campo>
          <Campo id="tl" etiqueta="Tamaño del lote (vehículos)" req><input id="tl" inputMode="numeric" value={tamano} onChange={(e) => setTamano(e.target.value)} /></Campo>
          <Campo id="n" etiqueta="Vehículos a inspeccionar (n)" req ayuda={v.nSugerido ? `NCh 44 nivel ${v.config.nivel}: n = ${v.nSugerido}. Las muestras de la OT son los vehículos (hoy ${v.vehiculos.length}).` : `Nivel ${v.config.nivel}. Las muestras de la OT son los vehículos (hoy ${v.vehiculos.length}).`}>
            <input id="n" inputMode="numeric" value={muestra} onChange={(e) => setMuestra(e.target.value)} />
          </Campo>
        </div>
      </fieldset>
      {editable && (
        <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
          <div className="spacer" />
          <button className="btn primary" disabled={ocupado || !plantilla || !tamano || !muestra}>{ocupado ? "Guardando…" : "Guardar lote → inspección"}</button>
        </div>
      )}
    </form>
  );
}

function PasoVehiculo({ v, editable, vehiculo, setVehiculo, onCambio, onFin }: { v: Vista; editable: boolean; vehiculo: string; setVehiculo: (id: string) => void; onCambio: () => Promise<any>; onFin: () => void }) {
  const actual = v.vehiculos.find((x) => x.muestra.id === vehiculo) ?? v.vehiculos[0];
  const items = v.plantilla?.items ?? [];
  const base = () => {
    const i = actual?.inspeccion;
    return {
      numero: i?.numero ? String(i.numero) : String((v.vehiculos.indexOf(actual) ?? 0) + 1),
      cab: { inspectores: (i?.cabecera?.inspectores ?? []).join(", "), chasis: i?.cabecera?.chasis ?? "", motor: i?.cabecera?.motor ?? "", anio: i?.cabecera?.anio ?? "", lugar: i?.cabecera?.lugar ?? "", kmSalida: i?.cabecera?.kmSalida ?? "", kmLlegada: i?.cabecera?.kmLlegada ?? "", fechaInicio: i?.cabecera?.fechaInicio ?? hoyISO(), fechaTermino: i?.cabecera?.fechaTermino ?? "" },
      res: (i?.items ?? {}) as Record<string, ResItem & { valorTxt?: string }>,
    };
  };
  const [f, setF] = useState(base);
  const [motivo, setMotivo] = useState("");
  const [soloPend, setSoloPend] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => { setF(base()); setMotivo(""); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [vehiculo, v]);
  const grupos = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const it of items) {
      const k = it.subgrupo ?? it.grupo;
      (m.get(k) ?? m.set(k, []).get(k)!).push(it);
    }
    return [...m];
  }, [items]);
  if (!v.plantilla) return <div className="card"><p className="subtitle" style={{ margin: 0 }}>Primero elija la HCP y los datos del lote.</p></div>;
  if (!actual) return <div className="card"><p className="subtitle" style={{ margin: 0 }}>La OT no tiene muestras: registre cada vehículo como muestra en la pestaña «Muestras» de la OT.</p></div>;
  const cuant = (it: Item) => it.min != null || it.max != null;
  const setRes = (k: string, p: Partial<ResItem & { valorTxt?: string }>) => setF((x) => ({ ...x, res: { ...x.res, [k]: { ...x.res[k], ...p } } }));
  const respondido = (it: Item) => (cuant(it) ? f.res[it.item]?.valor != null || (f.res[it.item]?.valorTxt ?? "") !== "" : !!f.res[it.item]?.resultado);
  const nResp = items.filter(respondido).length;
  const yaInspeccionado = actual.registro?.estado === "inspeccionado";

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true);
    try {
      const itemsEnvio: Record<string, ResItem> = {};
      for (const it of items) {
        const r = f.res[it.item];
        if (!r) continue;
        const valor = r.valorTxt !== undefined ? aNum(r.valorTxt) : r.valor ?? null;
        itemsEnvio[it.item] = { resultado: r.resultado ?? null, valor: valor != null && Number.isFinite(valor) ? valor : null, observacion: r.observacion ?? null };
      }
      const r = await llamar<any>("PUT", `/formularios/ot/${v.ot.id}/hcp/vehiculo/${actual.muestra.id}`, {
        numero: Number(f.numero),
        cabecera: { ...f.cab, inspectores: f.cab.inspectores.split(",").map((s: string) => s.trim()).filter(Boolean), anio: aNum(f.cab.anio), kmSalida: aNum(f.cab.kmSalida), kmLlegada: aNum(f.cab.kmLlegada), fechaTermino: f.cab.fechaTermino || null },
        items: itemsEnvio,
        motivo: motivo || undefined,
      });
      const ev = r.evaluacion;
      toast.ok(`Vehículo Nº ${f.numero}: ${ESTADO[ev.estado]?.t ?? ev.estado} · ${ev.respondidos}/${ev.total} ítems · ${ev.ncPorClase.A + ev.ncPorClase.B + ev.ncPorClase.C} N/C.`);
      const malos = (r.llevados ?? []).filter((x: any) => !x.ok);
      if (malos.length) toast.error(`Ensayos sin actualizar: ${malos.map((x: any) => x.motivo).join(" ")}`);
      const nv = await onCambio();
      const sig = nv?.vehiculos.find((x: Vehiculo) => x.estado !== "inspeccionado");
      if (ev.estado === "inspeccionado") {
        if (sig) setVehiculo(sig.muestra.id);
        else if ((nv?.vehiculos.filter((x: Vehiculo) => x.estado === "inspeccionado").length ?? 0) >= (nv?.lote?.datos.muestra ?? 0)) onFin();
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form className="card" onSubmit={guardar}>
      <h2>2 · Hoja de Control de Pruebas · vehículo Nº {f.numero} de {v.lote?.datos.muestra ?? "—"}</h2>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }} role="tablist" aria-label="Vehículos de la muestra">
        {v.vehiculos.map((x, i) => (
          <button key={x.muestra.id} type="button" role="tab" aria-selected={x.muestra.id === actual.muestra.id} className={`btn sm ${x.muestra.id === actual.muestra.id ? "primary" : "outline"}`} onClick={() => setVehiculo(x.muestra.id)}>
            Nº {x.inspeccion?.numero ?? i + 1} · {x.muestra.codigo} <span className={`pill ${ESTADO[x.estado]?.pill ?? "gray"}`}>{ESTADO[x.estado]?.t ?? x.estado}</span>
          </button>
        ))}
      </div>
      <div style={{ height: 6, background: "#eef3f7", borderRadius: 4, marginBottom: 12 }} role="progressbar" aria-label="Avance de la muestra" aria-valuenow={v.vehiculos.filter((x) => x.estado === "inspeccionado").length} aria-valuemin={0} aria-valuemax={v.lote?.datos.muestra ?? 0}>
        <div style={{ width: `${Math.min(100, (100 * v.vehiculos.filter((x) => x.estado === "inspeccionado").length) / Math.max(1, v.lote?.datos.muestra ?? 1))}%`, height: "100%", background: "var(--green)", borderRadius: 4 }} />
      </div>
      <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="form-grid cols-4">
          <Campo id="nv" etiqueta="Nº en la muestra" req><input id="nv" inputMode="numeric" value={f.numero} onChange={(e) => setF({ ...f, numero: e.target.value })} /></Campo>
          <Campo id="ins" etiqueta="Inspectores" req span={3} ayuda="Separados por coma."><input id="ins" value={f.cab.inspectores} onChange={(e) => setF({ ...f, cab: { ...f.cab, inspectores: e.target.value } })} /></Campo>
          <Campo id="ch" etiqueta="Nº de chasis" req><input id="ch" value={f.cab.chasis} onChange={(e) => setF({ ...f, cab: { ...f.cab, chasis: e.target.value } })} maxLength={60} /></Campo>
          <Campo id="mo" etiqueta="Nº de motor" req><input id="mo" value={f.cab.motor} onChange={(e) => setF({ ...f, cab: { ...f.cab, motor: e.target.value } })} maxLength={60} /></Campo>
          <Campo id="an" etiqueta="Año de fabricación"><input id="an" inputMode="numeric" value={f.cab.anio} onChange={(e) => setF({ ...f, cab: { ...f.cab, anio: e.target.value } })} /></Campo>
          <Campo id="lu" etiqueta="Lugar"><input id="lu" value={f.cab.lugar} onChange={(e) => setF({ ...f, cab: { ...f.cab, lugar: e.target.value } })} maxLength={120} /></Campo>
          <Campo id="ks" etiqueta="Km de salida"><input id="ks" inputMode="decimal" value={f.cab.kmSalida} onChange={(e) => setF({ ...f, cab: { ...f.cab, kmSalida: e.target.value } })} /></Campo>
          <Campo id="kl" etiqueta="Km de llegada"><input id="kl" inputMode="decimal" value={f.cab.kmLlegada} onChange={(e) => setF({ ...f, cab: { ...f.cab, kmLlegada: e.target.value } })} /></Campo>
          <Campo id="fi" etiqueta="Inicio de la inspección"><input id="fi" type="date" value={f.cab.fechaInicio} onChange={(e) => setF({ ...f, cab: { ...f.cab, fechaInicio: e.target.value } })} /></Campo>
          <Campo id="ft" etiqueta="Término de la inspección"><input id="ft" type="date" value={f.cab.fechaTermino} onChange={(e) => setF({ ...f, cab: { ...f.cab, fechaTermino: e.target.value } })} /></Campo>
        </div>
        <div className="toolbar" style={{ margin: "12px 0 6px" }}>
          <b style={{ fontSize: 12.5 }}>{nResp} de {items.length} ítems respondidos</b>
          <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={soloPend} onChange={(e) => setSoloPend(e.target.checked)} style={{ width: "auto" }} /> Solo pendientes</label>
          <div className="spacer" />
        </div>
        {grupos.map(([g, its]) => {
          const vis = soloPend ? its.filter((it) => !respondido(it)) : its;
          if (!vis.length) return null;
          const nc = its.filter((it) => f.res[it.item]?.resultado === "NC").length;
          return (
            <details key={g} open={soloPend || its.some((it) => !respondido(it))} style={{ border: "1px solid var(--line)", borderRadius: 7, marginBottom: 6, padding: "6px 10px" }}>
              <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 12.5 }}>
                {g} <span style={{ color: "var(--muted)", fontWeight: 400 }}>· {its.filter(respondido).length}/{its.length}{nc ? ` · ${nc} N/C` : ""}</span>
                {editable && its.some((it) => !cuant(it) && !f.res[it.item]?.resultado) && (
                  <button type="button" className="btn outline sm" style={{ marginLeft: 8 }} onClick={(e) => { e.preventDefault(); for (const it of its) if (!cuant(it) && !f.res[it.item]?.resultado) setRes(it.item, { resultado: "C" }); }}>Marcar pendientes como C</button>
                )}
              </summary>
              <table className="data" style={{ marginTop: 6 }}>
                <thead><tr><th style={{ width: 60 }}>Ítem</th><th>Requisito</th><th style={{ width: 50 }}>Clase</th><th style={{ width: 150 }}>Resultado</th><th style={{ width: 240 }}>Observación</th></tr></thead>
                <tbody>
                  {vis.map((it) => {
                    const r = f.res[it.item] ?? {};
                    const val = r.valorTxt !== undefined ? aNum(r.valorTxt) : r.valor ?? null;
                    const nc = cuant(it) && val != null && Number.isFinite(val) ? !((it.min == null || val >= it.min) && (it.max == null || val <= it.max)) : r.resultado === "NC";
                    return (
                      <tr key={it.item} style={nc ? { background: "#fdecec" } : undefined}>
                        <td className="codigo">{it.item}</td>
                        <td style={{ fontSize: 12 }}>{it.requisito}{it.cantidad ? <span className="pill gray" style={{ marginLeft: 4 }}>{it.cantidad} u.</span> : null}{it.metodo ? <span className="tag" style={{ marginLeft: 4 }} title="Método del catálogo al que pasa el veredicto">{it.metodo}</span> : null}</td>
                        <td><span className={`pill ${it.clase === "A" ? "red" : it.clase === "B" ? "amber" : "gray"}`}>{it.clase}</span></td>
                        <td>
                          {cuant(it) ? (
                            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <input aria-label={`Valor medido del ítem ${it.item}`} inputMode="decimal" style={{ width: 70 }} value={r.valorTxt ?? (r.valor != null ? conComa(r.valor) : "")} onChange={(e) => setRes(it.item, { valorTxt: e.target.value })} />
                              <small>{it.unidad} ({it.min != null ? `≥ ${conComa(it.min)}` : ""}{it.min != null && it.max != null ? " · " : ""}{it.max != null ? `≤ ${conComa(it.max)}` : ""})</small>
                            </span>
                          ) : (
                            <span style={{ display: "flex", gap: 8 }}>
                              <label style={{ fontSize: 12 }}><input type="radio" name={`r-${it.item}`} checked={r.resultado === "C"} onChange={() => setRes(it.item, { resultado: "C" })} style={{ width: "auto" }} /> C</label>
                              <label style={{ fontSize: 12 }}><input type="radio" name={`r-${it.item}`} checked={r.resultado === "NC"} onChange={() => setRes(it.item, { resultado: "NC" })} style={{ width: "auto" }} /> N/C</label>
                            </span>
                          )}
                        </td>
                        <td><input aria-label={`Observación del ítem ${it.item}`} value={r.observacion ?? ""} onChange={(e) => setRes(it.item, { observacion: e.target.value })} maxLength={500} placeholder={nc ? "Obligatoria si no cumple" : ""} style={{ width: "100%", borderColor: nc && !r.observacion ? "var(--red)" : undefined }} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </details>
          );
        })}
        {yaInspeccionado && editable && <div style={{ maxWidth: 560, marginTop: 8 }}><Campo id="mo2" etiqueta="Motivo de la corrección (vehículo ya inspeccionado)"><input id="mo2" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} /></Campo></div>}
      </fieldset>
      {editable && (
        <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
          <span className="subtitle" style={{ margin: 0 }}>Puede guardar a medias: el vehículo queda «En inspección» hasta responder todos los ítems.</span>
          <div className="spacer" />
          <button className="btn primary" disabled={ocupado}>{ocupado ? "Guardando…" : "Guardar vehículo → siguiente vehículo"}</button>
        </div>
      )}
    </form>
  );
}

function PasoNovedades({ v, editable, onCambio }: { v: Vista; editable: boolean; onCambio: () => Promise<any> }) {
  const [acc, setAcc] = useState<Record<string, string>>(() => ({ ...(v.lote?.datos.acciones ?? {}) }));
  const [ocupado, setOcupado] = useState(false);
  const ev = v.evaluacionLote;
  const acta = v.lote?.datos.acta;
  async function guardarAcciones() {
    setOcupado(true);
    try {
      await llamar("PUT", `/formularios/ot/${v.ot.id}/hcp/acciones`, { acciones: acc });
      toast.ok("Acciones del proveedor guardadas.");
      await onCambio();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }
  async function emitir() {
    setOcupado(true);
    try {
      await llamar("PUT", `/formularios/ot/${v.ot.id}/hcp/acciones`, { acciones: acc });
      await llamar("POST", `/formularios/ot/${v.ot.id}/hcp/acta`);
      toast.ok("Acta de novedades emitida.");
      await onCambio();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }
  return (
    <div className="card">
      <h2>3 · Novedades del lote <span className="right">LVM-PG01-P02-IT02</span></h2>
      <table className="data">
        <thead><tr><th>Vehículo</th><th>Ítem</th><th>Clase</th><th>Descripción</th><th style={{ width: 260 }}>Acción del proveedor</th></tr></thead>
        <tbody>
          {v.novedades.length === 0 && <tr><td colSpan={5} style={{ color: "var(--muted)" }}>Sin no conformidades en los vehículos inspeccionados.</td></tr>}
          {v.novedades.map((x) => {
            const k = `${x.vehiculo}:${x.item}`;
            return (
              <tr key={k}>
                <td>Nº {x.vehiculo}{x.chasis ? <small style={{ display: "block", color: "var(--muted)" }}>{x.chasis}</small> : null}</td>
                <td className="codigo">{x.item}</td>
                <td><span className={`pill ${x.clase === "A" ? "red" : x.clase === "B" ? "amber" : "gray"}`}>{x.clase}</span></td>
                <td style={{ fontSize: 12 }}>{x.descripcion}</td>
                <td>{editable ? <input aria-label={`Acción del proveedor para ${k}`} value={acc[k] ?? ""} onChange={(e) => setAcc({ ...acc, [k]: e.target.value })} maxLength={300} style={{ width: "100%" }} /> : x.accionProveedor ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {ev && (
        <div style={{ marginTop: 12 }}>
          <h3 style={{ fontSize: 13, margin: "0 0 6px" }}>Evaluación del lote por clase de defecto <small style={{ color: "var(--muted)", fontWeight: 400 }}>· NCh 44 nivel {v.config.nivel}; AQL por clase por confirmar con el IDIC (EP-05 P15)</small></h3>
          <table className="data" style={{ maxWidth: 720 }}>
            <thead><tr><th>Clase</th><th>AQL</th><th className="num">Vehículos con N/C</th><th className="num">Ac</th><th className="num">Re</th><th>Decisión</th></tr></thead>
            <tbody>{ev.clases.map((c: any) => <tr key={c.clase}><td>{c.clase}</td><td>{c.aql === "0" ? "Una N/C rechaza" : c.aql}</td><td className="num">{c.vehiculosConNc}</td><td className="num">{c.ac}</td><td className="num">{c.re}</td><td><span className={`pill ${c.decision === "acepta" ? "green" : "red"}`}>{c.decision === "acepta" ? "Acepta" : "Rechaza"}</span></td></tr>)}</tbody>
          </table>
          <p style={{ fontSize: 12.5 }}>Vehículos inspeccionados: <b>{ev.inspeccionados} de {ev.muestra}</b> · veredicto del lote <Veredicto v={ev.veredicto} /></p>
          {ev.errores.length > 0 && <div className="alert warn">{ev.errores.join(" ")}</div>}
        </div>
      )}
      {acta ? (
        <div className="alert success" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span>Acta emitida el {acta.fecha}{acta.por ? ` por ${acta.por}` : ""} · SHA-256 <span className="codigo">{acta.hash.slice(0, 16)}…</span></span>
          <button type="button" className="btn outline sm" onClick={() => abrirProtegido(`/formularios/ot/${v.ot.id}/hcp/acta`).catch((e) => toast.error(e.message))}>Ver acta</button>
        </div>
      ) : (
        editable && (
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <button type="button" className="btn outline" disabled={ocupado} onClick={guardarAcciones}>Guardar acciones del proveedor</button>
            <div className="spacer" />
            <button type="button" className="btn primary" disabled={ocupado || !ev || ev.inspeccionados < ev.muestra} onClick={emitir}>Emitir acta de novedades → evaluación del lote</button>
          </div>
        )
      )}
    </div>
  );
}

export default function HcpPage() {
  return (
    <Suspense fallback={<SkeletonCards n={3} />}>
      <Contenido />
    </Suspense>
  );
}
