"use client";

/**
 * PanelFea · Firma Electrónica Avanzada (FEA) del Estado sobre el PDF final de
 * un documento emitido (informe, certificado, certificado por arma de la D11 o
 * certificado de calibración). El LIMS no se conecta a FirmaGob: el firmante
 * descarga aquí el PDF emitido, lo firma en su equipo y sube el archivo
 * firmado. Desde ese momento la descarga, el envío y la verificación pública
 * usan la versión firmada. Lo usan PanelDocumento y la ficha de Metrología.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { fechaHora } from "@/lib/format";
import { toast } from "@/components/ui/feedback";
import {
  ACCION_FEA,
  ErrorFea,
  TEXTO_INTEGRIDAD,
  descargarFirmado,
  descargarParaFirmar,
  estadoFea,
  subirFirmado,
  type EstadoFea,
  type OrigenFea,
} from "@/lib/fea";
import Modal from "./Modal";

export default function PanelFea({ origen, documentoId, onCambio }: { origen: OrigenFea; documentoId: string; onCambio?: () => void }) {
  const [e, setE] = useState<EstadoFea | null>(null);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [dialogo, setDialogo] = useState(false);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [excepcion, setExcepcion] = useState<{ mensaje: string; puedeAceptar: boolean } | null>(null);
  const [motivo, setMotivo] = useState("");
  const [verHistorial, setVerHistorial] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const cargar = useCallback(async () => {
    setError("");
    try {
      setE(await estadoFea(origen, documentoId));
    } catch (x: any) {
      setError(x.message);
    }
  }, [origen, documentoId]);

  useEffect(() => {
    setE(null);
    cargar();
  }, [cargar]);

  async function bajar(fn: () => Promise<void>) {
    setOcupado(true);
    try {
      await fn();
      await cargar();
    } catch (x: any) {
      toast.error(x.message);
    } finally {
      setOcupado(false);
    }
  }

  function abrirSubida() {
    setArchivo(null);
    setExcepcion(null);
    setMotivo("");
    setDialogo(true);
  }

  async function subir() {
    if (!archivo) return;
    setOcupado(true);
    try {
      const r = await subirFirmado(origen, documentoId, archivo, excepcion ? motivo : undefined);
      setE(r);
      setDialogo(false);
      toast.ok(r.firmado?.corresponde ? "Versión firmada con FEA guardada: corresponde al documento emitido." : "Versión firmada guardada como excepción.");
      onCambio?.();
    } catch (x: any) {
      if (x instanceof ErrorFea && x.requiereExcepcion) setExcepcion({ mensaje: x.message, puedeAceptar: x.puedeAceptar });
      else toast.error(x.message);
    } finally {
      setOcupado(false);
    }
  }

  if (error) return <div className="alert warn" style={{ marginTop: 10 }}>Firma electrónica avanzada: {error}</div>;
  if (!e || !e.oficial) return null;
  const f = e.firmado;

  return (
    <div style={{ marginTop: 12, padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 12.5 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
        <div>
          <b>Firma electrónica avanzada (FEA)</b>{" "}
          {f ? (
            <span className={`pill ${f.corresponde ? "green" : "amber"}`}>{f.corresponde ? "Firmado con FEA" : "Firmado con FEA · excepción"}</span>
          ) : (
            <span className={`pill ${e.exigeFea ? "amber" : "gray"}`}>{e.exigeFea ? "Pendiente · se exige antes de entregar" : "Pendiente"}</span>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {e.puedo.descargar && (
            <button className="btn outline sm" disabled={ocupado} onClick={() => bajar(() => descargarParaFirmar(origen, documentoId, e.numero))}>
              Descargar PDF para firmar
            </button>
          )}
          {f && (
            <button className="btn outline sm" disabled={ocupado} onClick={() => bajar(() => descargarFirmado(origen, documentoId, e.numero))}>
              Descargar versión firmada
            </button>
          )}
          {e.puedo.subir && (
            <button className="btn primary sm" disabled={ocupado} onClick={abrirSubida}>
              {f ? "Reemplazar versión firmada" : "Subir versión firmada con FEA"}
            </button>
          )}
        </div>
      </div>

      {f ? (
        <div style={{ marginTop: 6 }}>
          <div><b>{f.leyenda}</b>.</div>
          <div style={{ color: "var(--muted)", marginTop: 2 }}>
            {f.corresponde ? "Corresponde al documento emitido" : <>No corresponde al PDF emitido: aceptado por {f.excepcionPor ?? "una jefatura"} con el motivo «{f.excepcionMotivo}»</>}
            {" · "}{TEXTO_INTEGRIDAD[f.integridad] ?? f.integridad} · subido por {f.subidoPor ?? "—"} el {fechaHora(f.subidoAt)}
            {f.firmas > 1 ? ` · ${f.firmas} firmas en el PDF` : ""}
          </div>
          <div style={{ color: "var(--muted)" }}>
            SHA-256 <code style={{ fontSize: 10.5, wordBreak: "break-all" }}>{f.hash}</code>
          </div>
          <div style={{ color: "var(--muted)", marginTop: 2 }}>
            La descarga del PDF, el envío por correo y la verificación pública por código usan esta versión. El PDF original del LIMS queda guardado.
          </div>
        </div>
      ) : (
        <div style={{ color: "var(--muted)", marginTop: 6 }}>
          {e.puedo.subir
            ? "Descargue el PDF, fírmelo con FirmaGob (o su token) sin modificarlo y súbalo aquí. El LIMS comprueba que sea el mismo documento y guarda la versión firmada como oficial."
            : `Lo firma con FEA ${e.firmantes.join(", ") || "el firmante del documento"} (o una jefatura con permiso).`}
          {e.exigeFea && " No se puede registrar la entrega ni enviarlo por correo hasta que se suba la versión firmada."}
        </div>
      )}

      {e.historial.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <button className="btn outline sm" onClick={() => setVerHistorial((v) => !v)}>
            {verHistorial ? "Ocultar historial de la FEA" : `Ver historial de la FEA (${e.historial.length})`}
          </button>
          {verHistorial && (
            <ul style={{ margin: "4px 0 0", paddingLeft: 18, color: "var(--muted)" }}>
              {e.historial.map((h, i) => (
                <li key={i}>
                  {fechaHora(h.createdAt)} · {h.usuario ?? "—"} · <b>{ACCION_FEA[h.accion] ?? h.accion}</b>
                  {h.detalle ? ` · ${h.detalle}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {dialogo && (
        <Modal
          titulo={`Subir versión firmada con FEA · ${e.numero}`}
          onCerrar={() => !ocupado && setDialogo(false)}
          acciones={
            <>
              <button className="btn outline" disabled={ocupado} onClick={() => setDialogo(false)}>Cancelar</button>
              <button
                className="btn primary"
                disabled={ocupado || !archivo || (!!excepcion && (!excepcion.puedeAceptar || motivo.trim().length < 10))}
                onClick={subir}
              >
                {excepcion ? "Aceptar como excepción y guardar" : "Subir y comprobar"}
              </button>
            </>
          }
        >
          <p style={{ marginTop: 0 }}>
            Suba el PDF que descargó con «Descargar PDF para firmar», ya firmado con FirmaGob o con su token. El LIMS comprueba que traiga una
            firma digital y que sea el mismo documento emitido (la firma se agrega al final del PDF sin cambiar su contenido).
          </p>
          <div className="field">
            <label htmlFor="fea-archivo">PDF firmado</label>
            <input
              id="fea-archivo"
              ref={input}
              type="file"
              accept="application/pdf,.pdf"
              onChange={(ev) => {
                setArchivo(ev.target.files?.[0] ?? null);
                setExcepcion(null);
              }}
            />
          </div>
          {excepcion && (
            <div className="alert warn" style={{ marginTop: 8 }}>
              {excepcion.mensaje}
              {excepcion.puedeAceptar && (
                <div className="field" style={{ marginTop: 8, marginBottom: 0 }}>
                  <label htmlFor="fea-motivo">Motivo de la excepción (queda en el historial)</label>
                  <textarea id="fea-motivo" rows={3} value={motivo} onChange={(ev) => setMotivo(ev.target.value)} placeholder="Por qué se acepta este PDF aunque no corresponda byte a byte al emitido" />
                </div>
              )}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
