"use client";

/**
 * BPCH · Solicitar una reinspección. Primero se elige lo inspeccionado antes
 * (OT original, certificado o producto codificado) y el sistema propone los
 * antecedentes que hereda; luego se completa la solicitud y se genera la OT.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader, Skeleton } from "@/components/ui/PageHeader";
import RequierePermiso from "@/components/RequierePermiso";
import BuscadorOt, { type OtCorta } from "@/components/BuscadorOt";
import { toast } from "@/components/ui/feedback";
import { BuscadorCodificacion, BuscadorEmpresa, type Empresa, type ProductoCodificado } from "../../_components/Buscadores";
import { CONDICION, type ConfigBpch, hoy, pedir } from "../../_components/bpch";

export default function NuevaReinspeccionPage() {
  return (
    <RequierePermiso perm="bpch.reinspeccion.gestionar" titulo="Solicitar reinspección">
      <Formulario />
    </RequierePermiso>
  );
}

function Formulario() {
  const router = useRouter();
  const [config, setConfig] = useState<ConfigBpch | null>(null);
  const [ot, setOt] = useState<OtCorta | null>(null);
  const [cod, setCod] = useState<ProductoCodificado | null>(null);
  const [ant, setAnt] = useState<any>(null);
  const [titular, setTitular] = useState<Empresa | null>(null);
  const [destino, setDestino] = useState<Empresa | null>(null);
  const [f, setF] = useState({
    motivo: "", motivoDetalle: "", solicitadoPor: "", documentoSolicitud: "", fechaSolicitud: hoy(), empresaDestino: "",
    esquema: "", procedimiento: "", unidadInspeccionId: "", conCobro: "", certificadoOrigenId: "",
    elementoGenerico: "", elementoEspecifico: "", cnc: "", claseDivisionUn: "", numeroUn: "", identificacionLote: "", tamanoLote: "", tamanoMuestra: "",
  });
  const [errores, setErrores] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  useEffect(() => {
    pedir<ConfigBpch>("GET", "/bpch/config").then(setConfig).catch((e) => setErrores(e.message));
    // ?otId= (p. ej. desde el expediente de una internación): la OT original ya elegida.
    const otId = new URLSearchParams(window.location.search).get("otId");
    if (otId) setOt({ id: otId, codigo: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Antecedente elegido → propuesta de lo que se hereda (editable).
  useEffect(() => {
    if (!ot && !cod) {
      setAnt(null);
      return;
    }
    const qs = new URLSearchParams();
    if (ot) qs.set("otId", ot.id);
    if (cod) qs.set("codificacionId", cod.id);
    pedir<any>("GET", `/bpch/reinspecciones/antecedente?${qs}`)
      .then((a) => {
        setAnt(a);
        const p = a.propuesta ?? {};
        setF((x) => ({
          ...x,
          elementoGenerico: p.elementoGenerico ?? "",
          elementoEspecifico: p.elementoEspecifico ?? "",
          cnc: p.cnc ?? "",
          claseDivisionUn: p.claseDivisionUn ?? "",
          numeroUn: p.numeroUn ?? "",
          identificacionLote: p.identificacionLote ?? "",
          tamanoLote: p.tamanoLote != null ? String(p.tamanoLote) : "",
          unidadInspeccionId: x.unidadInspeccionId || p.unidadInspeccionId || "",
          esquema: x.esquema || p.esquema || "",
        }));
        setTitular(p.clienteId ? { id: p.clienteId, razonSocial: p.clienteNombre ?? "" } : null);
        setErrores("");
      })
      .catch((e) => setErrores(e.message));
  }, [ot, cod]);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!f.conCobro) return setErrores("Indique si la reinspección tiene cobro.");
    setOcupado(true);
    setErrores("");
    const n = (v: string) => (v.trim() ? Number(v) : null);
    try {
      const r = await pedir<any>("POST", "/bpch/reinspecciones", {
        motivo: f.motivo,
        motivoDetalle: f.motivoDetalle || null,
        solicitadoPor: f.solicitadoPor,
        documentoSolicitud: f.documentoSolicitud || null,
        fechaSolicitud: f.fechaSolicitud,
        origenOtId: ot?.id ?? null,
        certificadoOrigenId: f.certificadoOrigenId || null,
        codificacionId: cod?.id ?? ant?.codificacion?.id ?? null,
        clienteId: titular?.id ?? null,
        clienteDestinoId: destino?.id ?? null,
        empresaDestino: destino ? null : f.empresaDestino || null,
        esquema: f.esquema || undefined,
        procedimiento: f.procedimiento || null,
        unidadInspeccionId: f.unidadInspeccionId,
        conCobro: f.conCobro === "si",
        elementoGenerico: f.elementoGenerico || null,
        elementoEspecifico: f.elementoEspecifico || null,
        cnc: f.cnc || null,
        claseDivisionUn: f.claseDivisionUn || null,
        numeroUn: f.numeroUn || null,
        identificacionLote: f.identificacionLote || null,
        tamanoLote: n(f.tamanoLote),
        tamanoMuestra: n(f.tamanoMuestra),
      });
      toast.ok(`Reinspección ${r.numero} registrada; OT generada.`);
      router.push(`/bpch/reinspecciones/${r.id}` as any);
    } catch (e: any) {
      setErrores(e.message);
    } finally {
      setOcupado(false);
    }
  }

  if (!config) return errores ? <div className="alert warn">{errores}</div> : <Skeleton h={160} />;
  return (
    <form onSubmit={guardar} noValidate>
      <PageHeader icono="↻" titulo="Solicitar reinspección" subtitulo="Nueva inspección de algo ya inspeccionado: hereda los antecedentes de la OT, el certificado o el código original." migas={[{ label: "BPCH" }, { label: "Reinspecciones", href: "/bpch/reinspecciones" }, { label: "Solicitar" }]} />
      <div className="card">
        <h2>1 · Antecedente original <span className="right">al menos uno</span></h2>
        <div className="form-grid cols-2">
          <BuscadorOt valor={ot} onCambio={(o) => { setOt(o); setF((x) => ({ ...x, certificadoOrigenId: "" })); }} etiqueta="OT original" placeholder="Código de la OT inspeccionada antes…" />
          <BuscadorCodificacion valor={cod} onChange={setCod} />
        </div>
        {ant?.ot && (
          <p style={{ margin: "8px 0 0", fontSize: 12.5 }}>
            OT {ant.ot.codigo} ({ant.ot.unidadCodigo}, {ant.ot.estado}) · condición anterior <span className={`pill ${CONDICION[ant.ot.condicion]?.c}`}>{CONDICION[ant.ot.condicion]?.l}</span>
            {ant.internacion && <> · internación {ant.internacion.numero}</>}
          </p>
        )}
        {ant?.aviso && <div className="alert info" style={{ marginTop: 8 }}>{ant.aviso}</div>}
        {ant?.ot && (
          <div className="field" style={{ marginTop: 8, maxWidth: 520 }}>
            <label htmlFor="co">Certificado o informe original</label>
            <select id="co" value={f.certificadoOrigenId} onChange={set("certificadoOrigenId")}>
              <option value="">Sin documento (solo la OT)</option>
              {(ant.documentos ?? []).map((x: any) => <option key={x.id} value={x.id}>{x.numero} · {x.tipoDocumento ?? "documento"} · {x.estado}</option>)}
            </select>
          </div>
        )}
      </div>

      <fieldset disabled={!ant} style={{ border: "none", padding: 0, margin: 0 }}>
        <div className="card">
          <h2>2 · Solicitud</h2>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="mo">Motivo <span className="req">*</span></label>
              <select id="mo" value={f.motivo} onChange={set("motivo")}><option value="">Elija…</option>{config.parametros.motivosReinspeccion.map((m) => <option key={m.codigo} value={m.codigo}>{m.etiqueta}</option>)}</select>
            </div>
            <div className="field span-2"><label htmlFor="md">Detalle del motivo {f.motivo === "OTRO" && <span className="req">*</span>}</label><input id="md" value={f.motivoDetalle} onChange={set("motivoDetalle")} /></div>
            <div className="field"><label htmlFor="sp">Solicitado por <span className="req">*</span></label><input id="sp" value={f.solicitadoPor} onChange={set("solicitadoPor")} placeholder="Cargo de quien solicita" /></div>
            <div className="field"><label htmlFor="ds">Documento de la solicitud</label><input id="ds" value={f.documentoSolicitud} onChange={set("documentoSolicitud")} /></div>
            <div className="field"><label htmlFor="fs">Fecha de la solicitud <span className="req">*</span></label><input id="fs" type="date" value={f.fechaSolicitud} onChange={set("fechaSolicitud")} /></div>
            <div className="field span-2"><BuscadorEmpresa etiqueta="Titular" requerido valor={titular} onChange={setTitular} /></div>
            <div className="field">
              <label htmlFor="cc">¿Con cobro? <span className="req">*</span></label>
              <select id="cc" value={f.conCobro} onChange={set("conCobro")}><option value="">Elija…</option><option value="si">Sí</option><option value="no">No</option></select>
            </div>
            {f.motivo === "TRASPASO" && (
              <>
                <div className="field span-2"><BuscadorEmpresa etiqueta="Empresa de destino (traspaso)" valor={destino} onChange={setDestino} /></div>
                {!destino && <div className="field"><label htmlFor="ed">… o nombre de la empresa de destino</label><input id="ed" value={f.empresaDestino} onChange={set("empresaDestino")} /></div>}
              </>
            )}
            <div className="field">
              <label htmlFor="un">Unidad que inspecciona <span className="req">*</span></label>
              <select id="un" value={f.unidadInspeccionId} onChange={set("unidadInspeccionId")}><option value="">Elija…</option>{config.unidades.map((u) => <option key={u.id} value={u.id}>{u.codigo} · {u.nombre}</option>)}</select>
            </div>
            <div className="field"><label htmlFor="es">Esquema</label><select id="es" value={f.esquema} onChange={set("esquema")}><option value="">Tipo (por defecto)</option><option value="TIPO">Tipo</option><option value="LOTES">Por lotes</option></select></div>
            <div className="field"><label htmlFor="pr">Procedimiento de control</label><input id="pr" value={f.procedimiento} onChange={set("procedimiento")} placeholder="p. ej. SAC-PG05" /></div>
          </div>
        </div>
        <div className="card">
          <h2>3 · Producto y lote <span className="right">heredados · editables</span></h2>
          <div className="form-grid">
            <div className="field span-2"><label htmlFor="ee">Elemento específico <span className="req">*</span></label><input id="ee" value={f.elementoEspecifico} onChange={set("elementoEspecifico")} /></div>
            <div className="field"><label htmlFor="eg">Elemento genérico</label><input id="eg" value={f.elementoGenerico} onChange={set("elementoGenerico")} /></div>
            <div className="field"><label htmlFor="cn">CNC-DGMN</label><input id="cn" value={f.cnc} onChange={set("cnc")} /></div>
            <div className="field"><label htmlFor="cu">Clase/División UN</label><input id="cu" value={f.claseDivisionUn} onChange={set("claseDivisionUn")} /></div>
            <div className="field"><label htmlFor="nu">Nº UN</label><input id="nu" value={f.numeroUn} onChange={set("numeroUn")} /></div>
            <div className="field"><label htmlFor="il">Identificación del lote</label><input id="il" value={f.identificacionLote} onChange={set("identificacionLote")} /></div>
            <div className="field"><label htmlFor="tl">Tamaño lote (uu)</label><input id="tl" type="number" min={1} value={f.tamanoLote} onChange={set("tamanoLote")} /></div>
            <div className="field"><label htmlFor="tm">Tamaño muestra (uu)</label><input id="tm" type="number" min={1} value={f.tamanoMuestra} onChange={set("tamanoMuestra")} /></div>
          </div>
        </div>
      </fieldset>
      {errores && <div className="alert warn" role="alert">{errores}</div>}
      <div className="toolbar">
        <button type="submit" className="btn primary" disabled={!ant || ocupado}>{ocupado ? "Registrando…" : "Registrar y generar OT"}</button>
        {!ant && <small style={{ color: "var(--muted)" }}>Elija primero la OT original o el producto codificado.</small>}
      </div>
    </form>
  );
}
