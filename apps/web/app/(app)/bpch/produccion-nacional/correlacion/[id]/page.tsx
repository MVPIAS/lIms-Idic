"use client";

/**
 * Correlación de la relación de ventas con las inspecciones ejecutadas y el
 * informe técnico a DCO (cierre propio de Producción Nacional, según el
 * diagrama «Subproceso Producción Nacional»):
 *   ¿conforme? Sí → informe técnico. No → solicitud de información técnica a la
 *   Sucursal → su respuesta → ¿responde al requerimiento? No → solicitud a la
 *   DGMN y su respuesta → informe con propuesta técnica → remisión a DCO.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { toast, confirmar } from "@/components/ui/feedback";
import { usePermisos } from "@/lib/permisos";
import { llamar } from "@/lib/laboratorio";
import { fechaHora, rut } from "@/lib/format";
import { ESTADO_CORRELACION, abrirDocumento, cant, dia, numeroCl } from "@/lib/bpchProcesos";
import RespuestaSucursal from "@/components/bpch-procesos/RespuestaSucursal";

export default function CorrelacionPage() {
  const { id } = useParams<{ id: string }>();
  const { puede } = usePermisos();
  const [c, setC] = useState<any>(null);
  const [f, setF] = useState<any>({});
  const [ventas, setVentas] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const volcar = useCallback((x: any) => {
    setC(x);
    setF({
      relacionVentasRef: x.relacionVentasRef ?? "",
      relacionVentasAt: x.relacionVentasAt ?? "",
      conforme: x.conforme,
      observaciones: x.observaciones ?? "",
      requerimientoSucursal: x.requerimientoSucursal ?? "",
      requerimientoSucursalAt: x.requerimientoSucursalAt ?? "",
      respuestaSucursal: x.respuestaSucursal ?? "",
      respuestaSucursalAt: x.respuestaSucursalAt ?? "",
      respondeRequerimiento: x.respondeRequerimiento,
      solicitudDgmn: x.solicitudDgmn ?? "",
      solicitudDgmnAt: x.solicitudDgmnAt ?? "",
      respuestaDgmn: x.respuestaDgmn ?? "",
      respuestaDgmnAt: x.respuestaDgmnAt ?? "",
      propuestaTecnica: x.propuestaTecnica ?? "",
    });
    setVentas(Object.fromEntries(x.filas.filter((r: any) => r.ventas !== null).map((r: any) => [r.ocProductoId, String(r.ventas).replace(".", ",")])));
  }, []);

  const cargar = useCallback(async () => {
    try {
      volcar(await llamar("GET", `/bpch/pn/correlaciones/${id}`));
    } catch (e: any) {
      setError(e.message);
    }
  }, [id, volcar]);
  useEffect(() => {
    cargar();
  }, [cargar]);

  const editable = c?.estado === "borrador" && puede("bpch.pn.gestionar");
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((x: any) => ({ ...x, [k]: e.target.value }));

  async function ejecutar(fn: () => Promise<any>, ok: string) {
    setError("");
    setBusy(true);
    try {
      const r = await fn();
      toast.ok(ok);
      volcar(r);
      return r;
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  const guardar = () =>
    ejecutar(
      () =>
        llamar("PATCH", `/bpch/pn/correlaciones/${id}`, {
          ...f,
          ventas: Object.entries(ventas).filter(([, v]) => v.trim() !== "").map(([ocProductoId, v]) => ({ ocProductoId, cantidad: numeroCl(v) })),
        }),
      "Correlación guardada.",
    );

  if (!c) return <div>{error ? <div className="alert warn">{error}</div> : <p style={{ color: "var(--muted)" }}>Cargando…</p>}</div>;
  const est = ESTADO_CORRELACION[c.estado];

  return (
    <div>
      <PageHeader
        icono="📊"
        titulo={<>Correlación {dia(c.periodoDesde)} a {dia(c.periodoHasta)} <span className={`pill ${est?.pill}`} style={{ verticalAlign: "middle" }}>{est?.texto}</span></>}
        subtitulo={<>O/C operativa <Link href={`/bpch/produccion-nacional/${c.oc.id}` as any}>{c.oc.numero}</Link> · {c.oc.cliente.razonSocial} ({rut(c.oc.cliente.rut)}) · RAF {c.oc.raf}</>}
        migas={[{ label: "BPCH" }, { label: "Producción Nacional", href: "/bpch/produccion-nacional" }, { label: c.oc.numero, href: `/bpch/produccion-nacional/${c.oc.id}` }, { label: "Correlación" }]}
        acciones={
          c.informe ? (
            <>
              <button className="btn outline sm" onClick={() => abrirDocumento(`/bpch/pn/correlaciones/${c.id}/informe`).catch((e) => toast.error(e.message))}>Ver informe técnico</button>
              <button className="btn outline sm" onClick={() => abrirDocumento(`/bpch/pn/correlaciones/${c.id}/informe.pdf`).catch((e) => toast.error(e.message))}>PDF</button>
            </>
          ) : null
        }
      />
      {error && <div className="alert warn" role="alert">{error}</div>}

      <div className="card" style={{ padding: 14 }}>
        <h2 style={{ fontSize: 14, margin: "0 0 4px" }}>Relación de ventas ↔ inspecciones ejecutadas</h2>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 8px" }}>
          «Inspeccionado» suma la cantidad de las inspecciones del período con su OT cerrada. Desviación = declarado − inspeccionado; un valor positivo es producto vendido sin inspección registrada.
        </p>
        <div className="form-grid cols-4" style={{ marginBottom: 8 }}>
          <div className="field span-2"><label htmlFor="ref">Relación de ventas (referencia)</label><input id="ref" value={f.relacionVentasRef} onChange={set("relacionVentasRef")} disabled={!editable} maxLength={200} /></div>
          <div className="field"><label htmlFor="refd">Fecha de recepción</label><input id="refd" type="date" value={f.relacionVentasAt} onChange={set("relacionVentasAt")} disabled={!editable} /></div>
        </div>
        <div style={{ overflowX: "auto" }}>
        <table className="data">
          <thead><tr><th>Producto</th><th className="num">Declarado en ventas</th><th className="num">Inspeccionado</th><th className="num">Desviación</th></tr></thead>
          <tbody>
            {c.filas.map((r: any) => (
              <tr key={r.ocProductoId}>
                <td>{r.producto} <small style={{ color: "var(--muted)" }}>({r.unidadMedida})</small></td>
                <td className="num">
                  {editable ? (
                    <input aria-label={`Ventas de ${r.producto}`} inputMode="decimal" value={ventas[r.ocProductoId] ?? ""} onChange={(e) => setVentas({ ...ventas, [r.ocProductoId]: e.target.value })} style={{ width: 120, textAlign: "right" }} />
                  ) : cant(r.ventas)}
                </td>
                <td className="num">{cant(r.inspeccionado)}</td>
                <td className="num" style={{ color: r.desviacion > 0 ? "var(--red)" : undefined, fontWeight: r.desviacion > 0 ? 700 : undefined }}>{cant(r.desviacion)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {c.lineasEjecutadasSinCantidad > 0 && <p className="alert warn" style={{ marginTop: 8 }}>{c.lineasEjecutadasSinCantidad} inspección(es) ejecutada(s) sin cantidad registrada: no suman. Complete la cantidad en el programa.</p>}
        {c.sugerenciaConforme !== null && (
          <p style={{ fontSize: 12.5, marginTop: 8 }}>
            Sugerencia del sistema: <b>{c.sugerenciaConforme ? "conforme" : "no conforme"}</b> (la decisión es suya).
          </p>
        )}
      </div>

      <div className="card" style={{ padding: 14 }}>
        <h2 style={{ fontSize: 14, margin: "0 0 8px" }}>Conformidad y requerimientos</h2>
        <fieldset className="field" style={{ border: "none", padding: 0, margin: "0 0 10px" }}>
          <legend style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>¿Relación de ventas conforme con las planillas? <span className="req">*</span></legend>
          <div style={{ display: "flex", gap: 14, paddingTop: 4 }}>
            <label><input type="radio" name="conf" disabled={!editable} checked={f.conforme === true} onChange={() => setF({ ...f, conforme: true })} /> Conforme</label>
            <label><input type="radio" name="conf" disabled={!editable} checked={f.conforme === false} onChange={() => setF({ ...f, conforme: false })} /> No conforme</label>
          </div>
        </fieldset>
        <div className="field" style={{ marginBottom: 10 }}><label htmlFor="obs">Observaciones</label><textarea id="obs" rows={2} value={f.observaciones} onChange={set("observaciones")} disabled={!editable} /></div>
        {f.conforme === false && (
          <div className="form-grid cols-4">
            <div className="field span-3"><label htmlFor="rs">Solicitud de información técnica a la Sucursal <span className="req">*</span></label><textarea id="rs" rows={2} value={f.requerimientoSucursal} onChange={set("requerimientoSucursal")} disabled={!editable} /></div>
            <div className="field"><label htmlFor="rsd">Fecha</label><input id="rsd" type="date" value={f.requerimientoSucursalAt} onChange={set("requerimientoSucursalAt")} disabled={!editable} /></div>
            <div className="field span-3"><label htmlFor="rr">Informe (respuesta) de la Sucursal <span className="req">*</span></label><textarea id="rr" rows={2} value={f.respuestaSucursal} onChange={set("respuestaSucursal")} disabled={!editable} /></div>
            <div className="field"><label htmlFor="rrd">Fecha</label><input id="rrd" type="date" value={f.respuestaSucursalAt} onChange={set("respuestaSucursalAt")} disabled={!editable} /></div>
            <fieldset className="field span-4" style={{ border: "none", padding: 0, margin: 0, gridColumn: "1 / -1" }}>
              <legend style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>¿La respuesta responde al requerimiento técnico? <span className="req">*</span></legend>
              <div style={{ display: "flex", gap: 14, paddingTop: 4 }}>
                <label><input type="radio" name="resp" disabled={!editable} checked={f.respondeRequerimiento === true} onChange={() => setF({ ...f, respondeRequerimiento: true })} /> Sí</label>
                <label><input type="radio" name="resp" disabled={!editable} checked={f.respondeRequerimiento === false} onChange={() => setF({ ...f, respondeRequerimiento: false })} /> No (se pide a la DGMN)</label>
              </div>
            </fieldset>
            {f.respondeRequerimiento === false && (
              <>
                <div className="field span-3"><label htmlFor="sd">Solicitud de información técnica a la DGMN <span className="req">*</span></label><textarea id="sd" rows={2} value={f.solicitudDgmn} onChange={set("solicitudDgmn")} disabled={!editable} /></div>
                <div className="field"><label htmlFor="sdd">Fecha</label><input id="sdd" type="date" value={f.solicitudDgmnAt} onChange={set("solicitudDgmnAt")} disabled={!editable} /></div>
                <div className="field span-3"><label htmlFor="rd">Respuesta de la DGMN <span className="req">*</span></label><textarea id="rd" rows={2} value={f.respuestaDgmn} onChange={set("respuestaDgmn")} disabled={!editable} /></div>
                <div className="field"><label htmlFor="rdd">Fecha</label><input id="rdd" type="date" value={f.respuestaDgmnAt} onChange={set("respuestaDgmnAt")} disabled={!editable} /></div>
              </>
            )}
            <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="pt">Propuesta técnica <span className="req">*</span></label><textarea id="pt" rows={3} value={f.propuestaTecnica} onChange={set("propuestaTecnica")} disabled={!editable} /></div>
          </div>
        )}
        {c.faltantesInforme?.length > 0 && (
          <div className="alert info" style={{ marginTop: 10 }}>
            Para emitir el informe técnico falta:
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{c.faltantesInforme.map((x: string) => <li key={x}>{x}</li>)}</ul>
          </div>
        )}
        {c.informe && (
          <p style={{ fontSize: 12.5, marginTop: 10 }}>
            Informe <b>{c.informe.numero}</b> emitido por {c.informe.por} el {fechaHora(c.informe.at)}.
            {c.remitidoDco ? ` Remitido a DCO por ${c.remitidoDco.por} el ${fechaHora(c.remitidoDco.at)}.` : " Pendiente de remitir a DCO."}
          </p>
        )}
      </div>

      {/* EP-07 7.14: el Jefe de la Sucursal responde aquí el requerimiento (tarea en su bandeja). */}
      {typeof id === "string" && <RespuestaSucursal key={c.respuestaSucursal ?? "sin"} correlacionId={id} onCambio={cargar} />}

      <div className="toolbar" style={{ gap: 8 }}>
        {editable && (
          <>
            <button className="btn outline sm" disabled={busy} onClick={guardar}>Guardar</button>
            <button className="btn primary sm" disabled={busy} onClick={async () => {
              const g = await guardar();
              if (!g) return;
              if (g.faltantesInforme?.length) { setError(`No se puede emitir todavía: ${g.faltantesInforme.join(" ")}`); return; }
              if (await confirmar({ titulo: "¿Emitir el informe técnico?", mensaje: "Se sella y la correlación ya no se modifica.", confirmarTexto: "Emitir" }))
                ejecutar(() => llamar("POST", `/bpch/pn/correlaciones/${id}/emitir-informe`), "Informe técnico emitido.");
            }}>Emitir informe técnico</button>
          </>
        )}
        {c.estado === "emitido" && puede("bpch.pn.gestionar") && (
          <button className="btn primary sm" disabled={busy} onClick={() => ejecutar(() => llamar("POST", `/bpch/pn/correlaciones/${id}/remitir-dco`), "Informe remitido a DCO.")}>Remitir a DCO</button>
        )}
      </div>
    </div>
  );
}
