"use client";

/**
 * Pasos 1–3 de la D11: programar la recepción con el importador (11.4), aviso
 * de llegada (11.5) y acta de recepción e inventario con el conteo contra la
 * resolución (11.6). Sin valores precargados: cada dato lo indica quien registra.
 */
import { useState } from "react";
import { fecha, fechaHora } from "@/lib/format";
import { hoyChile, type Accion, type ExpedienteD11 } from "@/lib/d11";

type P = { d: ExpedienteD11; accion: Accion };

function Hecho({ titulo, filas }: { titulo: string; filas: [string, React.ReactNode][] }) {
  return (
    <div className="card">
      <h2>{titulo} <span className="right"><span className="pill green">Hecho</span></span></h2>
      <div className="form-grid">
        {filas.map(([k, v]) => (
          <div className="field readonly" key={k}>
            <label>{k}</label>
            <div style={{ fontSize: 13, padding: "6px 0" }}>{v ?? "—"}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- 11.4 --- */
export function Programacion({ d, accion }: P) {
  const p = d.expediente.programacion;
  const [f, setF] = useState({ fecha: "", lugar: "", responsableId: "" });
  const [ocupado, setOcupado] = useState(false);
  const [editar, setEditar] = useState(false);
  const bloqueada = Boolean(d.expediente.acta);
  if (p && !editar)
    return (
      <>
        <Hecho
          titulo="1 · Recepción programada con el importador"
          filas={[
            ["Fecha acordada", fecha(p.fecha)],
            ["Lugar", p.lugar],
            ["Responsable", p.responsable],
            ["Registrada", fechaHora(p.registradaAt)],
          ]}
        />
        {d.puedo.programar && d.ot.abierta && !bloqueada && (
          <button type="button" className="btn outline sm" onClick={() => { setF({ fecha: p.fecha.slice(0, 10), lugar: p.lugar, responsableId: p.responsableId }); setEditar(true); }}>
            Reprogramar
          </button>
        )}
      </>
    );
  const puede = d.puedo.programar && d.ot.abierta;
  const listo = f.fecha && f.lugar.trim().length >= 3 && f.responsableId;
  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true);
    if (await accion("PUT", `/d11/ot/${d.ot.id}/programacion`, f, "Recepción programada. Siguiente paso: aviso de llegada.")) setEditar(false);
    setOcupado(false);
  }
  return (
    <form className="card" onSubmit={enviar} noValidate>
      <h2>1 · Programar la recepción con el importador <span className="right">Jefe D11 · EP-11 11.4</span></h2>
      <p className="subtitle">Con la OT y la copia de la resolución, acuerde con el importador cuándo y dónde se reciben las armas.</p>
      {!puede && <div className="alert info">Lo registra el Jefe de la Delegación Nº 11.</div>}
      <fieldset disabled={!puede || ocupado} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="pr-fecha">Fecha de recepción acordada <span className="req">*</span></label>
            <input id="pr-fecha" type="date" min={hoyChile()} value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} required />
          </div>
          <div className="field span-2">
            <label htmlFor="pr-lugar">Lugar <span className="req">*</span></label>
            <input id="pr-lugar" value={f.lugar} onChange={(e) => setF({ ...f, lugar: e.target.value })} maxLength={240} placeholder="p. ej. arsenal o bodega de la D11" required />
          </div>
          <div className="field">
            <label htmlFor="pr-resp">Responsable <span className="req">*</span></label>
            <select id="pr-resp" value={f.responsableId} onChange={(e) => setF({ ...f, responsableId: e.target.value })} required>
              <option value="">Elija…</option>
              {d.personal.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            </select>
          </div>
        </div>
        <div className="toolbar">
          <button type="submit" className="btn primary" disabled={!listo}>{ocupado ? "Guardando…" : "Programar → esperar llegada"}</button>
          {editar && <button type="button" className="btn outline" onClick={() => setEditar(false)}>Cancelar</button>}
        </div>
      </fieldset>
    </form>
  );
}

/* --------------------------------------------------------------- 11.5 --- */
export function Llegada({ d, accion }: P) {
  const l = d.expediente.llegada;
  const [f, setF] = useState({ fecha: "", transportista: "", bultos: "", avisoPrevio: "", observaciones: "" });
  const [ocupado, setOcupado] = useState(false);
  if (l)
    return (
      <Hecho
        titulo="2 · Llegada confirmada"
        filas={[
          ["Fecha de llegada", fecha(l.fecha)],
          ["Transportista", l.transportista],
          ["Bultos", l.bultos],
          ["Aviso con 24 h de anticipación", l.avisoPrevio ? "Sí" : "No"],
          ["Observaciones", l.observaciones],
          ["Registrada", fechaHora(l.registradaAt)],
        ]}
      />
    );
  if (!d.expediente.programacion) return <div className="alert info">Primero programe la recepción (paso 1).</div>;
  const puede = d.puedo.registrar && d.ot.abierta;
  const bultos = Number(f.bultos);
  const listo = f.fecha && f.transportista.trim().length >= 2 && Number.isInteger(bultos) && bultos >= 1 && f.avisoPrevio;
  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true);
    await accion(
      "PUT",
      `/d11/ot/${d.ot.id}/llegada`,
      { fecha: f.fecha, transportista: f.transportista, bultos, avisoPrevio: f.avisoPrevio === "si", observaciones: f.observaciones || null },
      "Llegada confirmada. Siguiente paso: acta de recepción.",
    );
    setOcupado(false);
  }
  return (
    <form className="card" onSubmit={enviar} noValidate>
      <h2>2 · Aviso de llegada <span className="right">D11 · EP-11 11.5</span></h2>
      <p className="subtitle">Datos que entrega el importador o Aduanas al llegar la carga (programada para el {fecha(d.expediente.programacion.fecha)} en {d.expediente.programacion.lugar}).</p>
      {!puede && <div className="alert info">Lo registra el personal de la Delegación Nº 11.</div>}
      <fieldset disabled={!puede || ocupado} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="ll-fecha">Fecha de llegada <span className="req">*</span></label>
            <input id="ll-fecha" type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} required />
          </div>
          <div className="field span-2">
            <label htmlFor="ll-tr">Transportista <span className="req">*</span></label>
            <input id="ll-tr" value={f.transportista} onChange={(e) => setF({ ...f, transportista: e.target.value })} maxLength={200} required />
          </div>
          <div className="field">
            <label htmlFor="ll-bu">Bultos <span className="req">*</span></label>
            <input id="ll-bu" inputMode="numeric" value={f.bultos} onChange={(e) => setF({ ...f, bultos: e.target.value.replace(/\D/g, "") })} required />
          </div>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>¿Avisó con 24 h de anticipación? <span className="req">*</span></legend>
            <label style={{ marginRight: 12 }}><input type="radio" name="ll-av" checked={f.avisoPrevio === "si"} onChange={() => setF({ ...f, avisoPrevio: "si" })} /> Sí</label>
            <label><input type="radio" name="ll-av" checked={f.avisoPrevio === "no"} onChange={() => setF({ ...f, avisoPrevio: "no" })} /> No</label>
          </fieldset>
          <div className="field span-2">
            <label htmlFor="ll-obs">Observaciones</label>
            <input id="ll-obs" value={f.observaciones} onChange={(e) => setF({ ...f, observaciones: e.target.value })} maxLength={2000} />
          </div>
        </div>
        <div className="toolbar">
          <button type="submit" className="btn primary" disabled={!listo}>{ocupado ? "Guardando…" : "Confirmar llegada → recepción"}</button>
        </div>
      </fieldset>
    </form>
  );
}

/* --------------------------------------------------------------- 11.6 --- */
export function Acta({ d, accion }: P) {
  const a = d.expediente.acta;
  const [f, setF] = useState({ bultos: "", cantidad: "", ubicacion: "", responsableId: "", observaciones: "" });
  const [ocupado, setOcupado] = useState(false);
  const segun = d.segunResolucion;
  if (a)
    return (
      <div className="card">
        <h2>3 · Acta de recepción e inventario de bodega <span className="right"><span className="pill green">Firmada</span></span></h2>
        <table className="data" style={{ maxWidth: 560 }}>
          <thead><tr><th>Según resolución</th><th>Recibidas y contadas</th><th>Resultado</th></tr></thead>
          <tbody>
            <tr>
              <td className="num">{a.segunResolucion ?? "Sin listado"}</td>
              <td className="num">{a.cantidad}</td>
              <td>
                {a.resultado === "concuerda" && <span className="pill green">Concuerda</span>}
                {a.resultado === "diferencia" && <span className="pill red">Diferencia → nota de no conformidad</span>}
                {!a.resultado && <span className="pill gray">Sin resolución que comparar</span>}
              </td>
            </tr>
          </tbody>
        </table>
        <div className="form-grid" style={{ marginTop: 10 }}>
          <div className="field readonly"><label>Bultos</label><div>{a.bultos}</div></div>
          <div className="field readonly"><label>Ubicación en bodega</label><div>{a.ubicacion}</div></div>
          <div className="field readonly"><label>Responsable</label><div>{a.responsable ?? "—"}</div></div>
          <div className="field readonly"><label>Firmada</label><div>{fechaHora(a.firmadaAt)}{a.firmadaPor ? ` · ${a.firmadaPor}` : ""}</div></div>
          {a.observaciones && <div className="field readonly span-2"><label>Observaciones</label><div>{a.observaciones}</div></div>}
        </div>
        {a.resultado === "diferencia" && (
          <div className="alert warn" style={{ marginTop: 10 }}>
            Lo recibido no concuerda con la resolución. El Bizagi exige una nota de no conformidad que firma el importador y vuelve a la DGMN por una
            nueva resolución (EP-11 11.10, formato por confirmar con el IDIC, pregunta P5).
          </div>
        )}
      </div>
    );
  if (!d.expediente.llegada) return <div className="alert info">Primero confirme la llegada (paso 2).</div>;
  const puede = d.puedo.registrar && d.ot.abierta;
  const cantidad = f.cantidad === "" ? null : Number(f.cantidad);
  const resultado = segun == null || cantidad == null ? null : segun === cantidad ? "concuerda" : "diferencia";
  const listo = f.bultos !== "" && cantidad != null && f.ubicacion.trim().length >= 2 && f.responsableId;
  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true);
    await accion(
      "POST",
      `/d11/ot/${d.ot.id}/acta`,
      { bultos: Number(f.bultos), cantidad, ubicacion: f.ubicacion, responsableId: f.responsableId, observaciones: f.observaciones || null },
      "Acta firmada. Siguiente paso: registrar las armas.",
    );
    setOcupado(false);
  }
  return (
    <form className="card" onSubmit={enviar} noValidate>
      <h2>3 · Acta de recepción e inventario de bodega <span className="right">Armero · EP-11 11.6</span></h2>
      <p className="subtitle">Cuente lo recibido y compárelo con la resolución antes de registrar cada arma.</p>
      {!puede && <div className="alert info">La firma el armero de la Delegación Nº 11.</div>}
      <fieldset disabled={!puede || ocupado} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="ac-bu">Nº de bultos <span className="req">*</span></label>
            <input id="ac-bu" inputMode="numeric" value={f.bultos} onChange={(e) => setF({ ...f, bultos: e.target.value.replace(/\D/g, "") })} required />
          </div>
          <div className="field">
            <label htmlFor="ac-ca">Armas recibidas y contadas <span className="req">*</span></label>
            <input id="ac-ca" inputMode="numeric" value={f.cantidad} onChange={(e) => setF({ ...f, cantidad: e.target.value.replace(/\D/g, "") })} required />
          </div>
          <div className="field">
            <label>Según resolución</label>
            <div style={{ fontSize: 13, padding: "6px 0" }}>
              {segun ?? "Sin listado"}{" "}
              {resultado === "concuerda" && <span className="pill green">Concuerda</span>}
              {resultado === "diferencia" && <span className="pill red">Diferencia → NC</span>}
            </div>
          </div>
          <div className="field span-2">
            <label htmlFor="ac-ub">Ubicación en bodega <span className="req">*</span></label>
            <input id="ac-ub" value={f.ubicacion} onChange={(e) => setF({ ...f, ubicacion: e.target.value })} maxLength={160} required />
          </div>
          <div className="field">
            <label htmlFor="ac-re">Responsable <span className="req">*</span></label>
            <select id="ac-re" value={f.responsableId} onChange={(e) => setF({ ...f, responsableId: e.target.value })} required>
              <option value="">Elija…</option>
              {d.personal.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            </select>
          </div>
          <div className="field span-3">
            <label htmlFor="ac-ob">Observaciones</label>
            <input id="ac-ob" value={f.observaciones} onChange={(e) => setF({ ...f, observaciones: e.target.value })} maxLength={4000} />
          </div>
        </div>
        <div className="toolbar">
          <button type="submit" className="btn primary" disabled={!listo}>{ocupado ? "Firmando…" : "Firmar acta → registrar armas"}</button>
          <small style={{ color: "var(--muted)" }}>Una vez firmada, el acta no se modifica.</small>
        </div>
      </fieldset>
    </form>
  );
}
