"use client";

/**
 * BPCH · Requerimiento: datos, validación (nace la OT derivada a la sucursal)
 * o anulación. De la OT en adelante sigue el flujo general (inspección, lotes,
 * informe de inspección y cierre). API: /bpch/requerimientos/:id
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PageHeader, Skeleton } from "@/components/ui/PageHeader";
import RequierePermiso from "@/components/RequierePermiso";
import { toast, confirmar } from "@/components/ui/feedback";
import { usePermisos } from "@/lib/permisos";
import { fecha, fechaHora } from "@/lib/format";
import { pedir } from "../../_components/bpch";
import { FormularioRequerimiento } from "../_Formulario";
import { ESCALON, ESTADO_REQ } from "../requerimiento";

export default function RequerimientoDetallePage() {
  return (
    <RequierePermiso perm="bpch.requerimiento.ver" titulo="Requerimiento BPCH">
      <Detalle />
    </RequierePermiso>
  );
}

function Fila({ l, v }: { l: string; v: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 8, padding: "4px 0", borderBottom: "1px solid var(--line)" }}>
      <span style={{ color: "var(--muted)", fontSize: 12.5 }}>{l}</span>
      <span>{v || "—"}</span>
    </div>
  );
}

function Detalle() {
  const { id } = useParams<{ id: string }>();
  const { puede } = usePermisos();
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState("");
  const [editando, setEditando] = useState(false);
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setD(await pedir<any>("GET", `/bpch/requerimientos/${id}`));
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]);

  async function validar() {
    if (!(await confirmar({ titulo: `¿Validar el requerimiento ${d.numero}?`, mensaje: `Se genera la OT y queda derivada a ${d.unidadCodigo} · ${d.unidadNombre}.`, confirmarTexto: "Validar y generar OT" }))) return;
    setOcupado(true);
    try {
      const r = await pedir<any>("POST", `/bpch/requerimientos/${id}/validar`);
      toast.ok(r.mensaje);
      await cargar();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }
  async function anular() {
    setOcupado(true);
    try {
      await pedir<any>("POST", `/bpch/requerimientos/${id}/anular`, { motivo });
      toast.ok("Requerimiento anulado.");
      setAnulando(false);
      await cargar();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }

  if (error) return <div className="alert warn" role="alert">{error}</div>;
  if (!d) return <Skeleton h={240} />;
  const est = ESTADO_REQ[d.estado] ?? { l: d.estado, c: "gray" };
  const borrador = d.estado === "borrador";

  return (
    <div>
      <PageHeader
        icono="✎"
        titulo={<>Requerimiento <span className="codigo">{d.numero}</span></>}
        subtitulo={`${ESCALON[d.escalon] ?? d.escalon} · ${d.empresa}`}
        migas={[{ label: "BPCH" }, { label: "Requerimientos", href: "/bpch/requerimientos" }, { label: d.numero }]}
        acciones={
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <span className={`pill ${est.c}`}>{est.l}</span>
            {borrador && puede("bpch.requerimiento.validar") && (
              <button className="btn success" disabled={ocupado || !!d.puedeValidar} title={d.puedeValidar ?? "Validar y generar la OT"} onClick={validar}>
                Validar y generar OT
              </button>
            )}
            {borrador && puede("bpch.requerimiento.crear") && (
              <>
                <button className="btn outline" disabled={ocupado} onClick={() => setEditando(!editando)}>{editando ? "Cancelar corrección" : "Corregir"}</button>
                <button className="btn ghost-danger" disabled={ocupado} onClick={() => setAnulando(!anulando)}>Anular</button>
              </>
            )}
          </div>
        }
      />
      {borrador && d.puedeValidar && <div className="alert info" role="status">{d.puedeValidar}</div>}
      {d.otId && (
        <div className="alert ok" role="status">
          OT <Link href={`/ot/${d.otId}` as any} className="codigo">{d.otCodigo}</Link> derivada a {d.unidadCodigo} · {d.unidadNombre}
          {d.validadoPorNombre ? ` · validó ${d.validadoPorNombre}` : ""}{d.validadoAt ? ` el ${fechaHora(d.validadoAt)}` : ""}.
          La sucursal registra la inspección, los lotes y cierra con el informe de inspección.
        </div>
      )}
      {anulando && (
        <div className="card toolbar" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ flex: 1, margin: 0 }}>
            <label htmlFor="rq-mot">Motivo de la anulación <span className="req">*</span></label>
            <input id="rq-mot" value={motivo} maxLength={2000} onChange={(e) => setMotivo(e.target.value)} />
          </div>
          <button className="btn danger" disabled={ocupado} onClick={anular}>Confirmar anulación</button>
        </div>
      )}

      {editando ? (
        <FormularioRequerimiento
          inicial={{
            escalon: d.escalon, docOrigenTipo: d.docOrigenTipo, docOrigenNumero: d.docOrigenNumero, docOrigenFecha: d.docOrigenFecha,
            asistenciaTecnica: d.asistenciaTecnica, instrucciones: d.instrucciones ?? "", conCobro: d.conCobro,
            sinCobroComunicacion: d.sinCobroComunicacion ?? "", sinCobroNumero: d.sinCobroNumero ?? "", tecnico: d.tecnico ?? "",
            unidadDestinoId: d.unidadDestinoId, plantaIds: d.plantaIds ?? [],
          }}
          empresaInicial={{ id: d.clienteId, razonSocial: d.empresa, rut: d.empresaRut }}
          elementoInicial={d.catElementoId ? { id: d.catElementoId, codigo: "", nombre: d.elementoGenerico ?? "" } : null}
          textoBoton="Guardar corrección"
          onGuardar={async (cuerpo) => {
            await pedir<any>("PATCH", `/bpch/requerimientos/${id}`, cuerpo);
            toast.ok("Requerimiento corregido.");
            setEditando(false);
            await cargar();
          }}
        />
      ) : (
        <div className="card">
          <Fila l="Elabora" v={`${ESCALON[d.escalon] ?? d.escalon}${d.elaboradoPor ? ` · ${d.elaboradoPor}` : ""} · ${fechaHora(d.createdAt)}`} />
          <Fila l="Empresa" v={`${d.empresa}${d.empresaRut ? ` · ${d.empresaRut}` : ""}`} />
          <Fila l="Plantas" v={d.plantas?.length ? d.plantas.map((p: any) => `${p.nombre}${p.direccion ? ` (${p.direccion})` : ""}`).join(" · ") : ""} />
          <Fila l="Documento de origen" v={`${d.docOrigenTipo === "rpi" ? "RPI" : "Oficio"} ${d.docOrigenNumero} · ${fecha(d.docOrigenFecha)}`} />
          <Fila l="Elemento" v={d.elementoGenerico} />
          <Fila l="Asistencia técnica" v={d.asistenciaTecnica ? "Sí" : "No"} />
          <Fila l="Técnico definido" v={d.tecnico} />
          <Fila l="Instrucciones" v={d.instrucciones} />
          <Fila l="Cobro" v={d.conCobro ? "Con cobro" : `Sin cobro · comunicación ${d.sinCobroNumero}: ${d.sinCobroComunicacion}`} />
          <Fila l="Se deriva a" v={`${d.unidadCodigo} · ${d.unidadNombre}`} />
          {d.anuladoMotivo && <Fila l="Motivo de la anulación" v={d.anuladoMotivo} />}
        </div>
      )}
    </div>
  );
}
