"use client";

/** Formulario del requerimiento BPCH (nuevo o corrección del borrador). */
import { useEffect, useState } from "react";
import { BuscadorEmpresa, BuscadorElemento, type ElementoCatalogo, type Empresa } from "../_components/Buscadores";
import { type ConfigBpch, hoy, pedir } from "../_components/bpch";
import { ESCALON } from "./requerimiento";

export type DatosForm = {
  escalon: string;
  docOrigenTipo: "oficio" | "rpi";
  docOrigenNumero: string;
  docOrigenFecha: string;
  asistenciaTecnica: boolean;
  instrucciones: string;
  conCobro: boolean;
  sinCobroComunicacion: string;
  sinCobroNumero: string;
  tecnico: string;
  unidadDestinoId: string;
  plantaIds: string[];
};

export function FormularioRequerimiento({
  inicial,
  empresaInicial,
  elementoInicial,
  textoBoton,
  onGuardar,
}: {
  inicial?: Partial<DatosForm>;
  empresaInicial?: Empresa | null;
  elementoInicial?: ElementoCatalogo | null;
  textoBoton: string;
  onGuardar: (cuerpo: any) => Promise<void>;
}) {
  const [config, setConfig] = useState<ConfigBpch | null>(null);
  const [empresa, setEmpresa] = useState<Empresa | null>(empresaInicial ?? null);
  const [elemento, setElemento] = useState<ElementoCatalogo | null>(elementoInicial ?? null);
  const [plantas, setPlantas] = useState<{ id: string; nombre: string; direccion?: string | null; ciudad?: string | null }[]>([]);
  const [f, setF] = useState<DatosForm>({
    escalon: "", docOrigenTipo: "oficio", docOrigenNumero: "", docOrigenFecha: hoy(), asistenciaTecnica: false, instrucciones: "",
    conCobro: true, sinCobroComunicacion: "", sinCobroNumero: "", tecnico: "", unidadDestinoId: "", plantaIds: [],
    ...inicial,
  });
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const set = <K extends keyof DatosForm>(k: K, v: DatosForm[K]) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    pedir<ConfigBpch>("GET", "/bpch/config").then(setConfig).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!empresa) { setPlantas([]); return; }
    pedir<any>("GET", `/clientes/${empresa.id}/plantas`)
      .then((r) => setPlantas(Array.isArray(r) ? r : r?.data ?? []))
      .catch(() => setPlantas([]));
  }, [empresa]);

  async function guardar() {
    setError("");
    if (!f.escalon) return setError("Indique quién elabora el requerimiento.");
    if (!empresa) return setError("Elija la empresa.");
    if (!f.unidadDestinoId) return setError("Elija la sucursal o delegación a la que se deriva la OT.");
    setOcupado(true);
    try {
      await onGuardar({
        ...f,
        clienteId: empresa.id,
        plantaIds: f.plantaIds.filter((p) => plantas.some((x) => x.id === p)),
        catElementoId: elemento?.id ?? null,
        elementoGenerico: elemento?.nombre ?? null,
      });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="card" style={{ display: "grid", gap: 12 }}>
      {error && <div className="alert warn" role="alert">{error}</div>}
      <div className="form-grid cols-3">
        <div className="field">
          <label htmlFor="rq-escalon">Elabora <span className="req">*</span></label>
          <select id="rq-escalon" value={f.escalon} onChange={(e) => set("escalon", e.target.value)}>
            <option value="">Elija…</option>
            {Object.entries(ESCALON).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="field span-2">
          <BuscadorEmpresa etiqueta="Empresa" valor={empresa} onChange={(e) => { setEmpresa(e); set("plantaIds", []); }} requerido />
        </div>
      </div>

      {empresa && (
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 600, fontSize: 13 }}>Plantas de la empresa</legend>
          {plantas.length === 0 ? (
            <small style={{ color: "var(--muted)" }}>La empresa no tiene plantas registradas en el maestro de clientes.</small>
          ) : (
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              {plantas.map((p) => (
                <label key={p.id} style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 400 }}>
                  <input type="checkbox" style={{ width: "auto" }} checked={f.plantaIds.includes(p.id)}
                    onChange={(e) => set("plantaIds", e.target.checked ? [...f.plantaIds, p.id] : f.plantaIds.filter((x) => x !== p.id))} />
                  {p.nombre}{p.direccion ? <small style={{ color: "var(--muted)" }}> · {p.direccion}{p.ciudad ? `, ${p.ciudad}` : ""}</small> : null}
                </label>
              ))}
            </div>
          )}
        </fieldset>
      )}

      <div className="form-grid cols-3">
        <div className="field">
          <label htmlFor="rq-doc">Documento de origen <span className="req">*</span></label>
          <select id="rq-doc" value={f.docOrigenTipo} onChange={(e) => set("docOrigenTipo", e.target.value as any)}>
            <option value="oficio">Oficio</option>
            <option value="rpi">RPI</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="rq-num">Número <span className="req">*</span></label>
          <input id="rq-num" value={f.docOrigenNumero} maxLength={80} onChange={(e) => set("docOrigenNumero", e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="rq-fecha">Fecha del documento <span className="req">*</span></label>
          <input id="rq-fecha" type="date" value={f.docOrigenFecha} max={hoy()} onChange={(e) => set("docOrigenFecha", e.target.value)} />
        </div>
      </div>

      <div className="form-grid cols-3">
        <div className="field">
          <label htmlFor="rq-suc">Se deriva a <span className="req">*</span></label>
          <select id="rq-suc" value={f.unidadDestinoId} onChange={(e) => set("unidadDestinoId", e.target.value)}>
            <option value="">Elija la sucursal o delegación…</option>
            {(config?.unidades ?? []).map((u) => <option key={u.id} value={u.id}>{u.codigo} · {u.nombre}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="rq-tec">Técnico definido</label>
          <input id="rq-tec" value={f.tecnico} maxLength={160} onChange={(e) => set("tecnico", e.target.value)} placeholder="Nombre del técnico a cargo" />
        </div>
        <div className="field" style={{ justifyContent: "flex-end" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 400 }}>
            <input type="checkbox" style={{ width: "auto" }} checked={f.asistenciaTecnica} onChange={(e) => set("asistenciaTecnica", e.target.checked)} />
            Con asistencia técnica
          </label>
        </div>
      </div>

      <BuscadorElemento valor={elemento} onChange={setElemento} />

      <div className="field">
        <label htmlFor="rq-ins">Instrucciones</label>
        <textarea id="rq-ins" rows={3} maxLength={4000} value={f.instrucciones} onChange={(e) => set("instrucciones", e.target.value)} />
      </div>

      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 600, fontSize: 13 }}>Cobro</legend>
        <div style={{ display: "flex", gap: 16 }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 400 }}>
            <input type="radio" name="rq-cobro" style={{ width: "auto" }} checked={f.conCobro} onChange={() => set("conCobro", true)} /> Con cobro
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 400 }}>
            <input type="radio" name="rq-cobro" style={{ width: "auto" }} checked={!f.conCobro} onChange={() => set("conCobro", false)} /> OT sin cobro (autorizada)
          </label>
        </div>
        {!f.conCobro && (
          <div className="form-grid cols-3" style={{ marginTop: 6 }}>
            <div className="field">
              <label htmlFor="rq-scn">Nº de la comunicación <span className="req">*</span></label>
              <input id="rq-scn" value={f.sinCobroNumero} maxLength={80} onChange={(e) => set("sinCobroNumero", e.target.value)} />
            </div>
            <div className="field span-2">
              <label htmlFor="rq-scc">Comunicación que la autoriza <span className="req">*</span></label>
              <input id="rq-scc" value={f.sinCobroComunicacion} maxLength={2000} onChange={(e) => set("sinCobroComunicacion", e.target.value)} placeholder="Resumen breve" />
            </div>
          </div>
        )}
      </fieldset>

      <div className="toolbar">
        <div className="spacer" />
        <button className="btn primary" disabled={ocupado} onClick={guardar}>{textoBoton}</button>
      </div>
    </div>
  );
}
