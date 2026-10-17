"use client";

/**
 * Fotos de la OT para el anexo fotográfico del informe.
 *
 * Se suben PNG o JPEG (la pantalla reduce las grandes a 1600 px antes de
 * enviarlas); cada foto puede ligarse a un ensayo —su pie remite entonces al
 * punto del informe, p. ej. «Punto 4.1.1 Tela base»— y se elige si va al
 * informe. Reglas: docs/FLUJO_INFORME_ENSAYO.md.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { toast, confirmar } from "@/components/ui/feedback";
import { enviarInforme } from "@/lib/informes";

const LADO_MAX = 1600;
const MAX_BYTES = 2 * 1024 * 1024;

type Foto = {
  id: string;
  nombre: string | null;
  bytes: number;
  pie: string | null;
  enInforme: boolean;
  orden: number;
  resultadoId: string | null;
  muestraCodigo: string | null;
  ensayo: string | null;
  subidaPor: string | null;
  dataUrl: string;
};
export type EnsayoOt = { resultadoId: string; muestraCodigo: string; ensayo: string | null; punto: string | null };

/** Reduce la foto a LADO_MAX px (JPEG 85 %) si es más grande; si no, la deja igual. */
async function prepararFoto(archivo: File): Promise<Blob> {
  if (!/^image\/(png|jpeg)$/.test(archivo.type)) throw new Error("Solo se aceptan fotos PNG o JPEG.");
  const bitmap = await createImageBitmap(archivo).catch(() => null);
  if (!bitmap) throw new Error("No se pudo leer la imagen.");
  const escala = Math.min(1, LADO_MAX / Math.max(bitmap.width, bitmap.height));
  if (escala === 1 && archivo.size <= MAX_BYTES) return archivo;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * escala);
  canvas.height = Math.round(bitmap.height * escala);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.85));
  if (!blob) throw new Error("No se pudo reducir la imagen.");
  if (blob.size > MAX_BYTES) throw new Error("La foto sigue superando 2 MB después de reducirla.");
  return blob;
}

async function subir(otId: string, blob: Blob, nombre: string, campos: Record<string, string>) {
  const form = new FormData();
  form.append("archivo", blob, nombre);
  for (const [k, v] of Object.entries(campos)) if (v) form.append(k, v);
  await enviarInforme(`/informes/ot/${otId}/fotos`, "POST", form);
}

export default function FotosInforme({
  otId,
  ensayos,
  puedeEditar,
  onCambio,
}: {
  otId: string;
  ensayos: EnsayoOt[];
  puedeEditar: boolean;
  onCambio?: () => void;
}) {
  const [fotos, setFotos] = useState<Foto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [subiendo, setSubiendo] = useState(false);
  const [pie, setPie] = useState("");
  const [resultadoId, setResultadoId] = useState("");
  const archivoRef = useRef<HTMLInputElement>(null);

  const cargar = useCallback(async () => {
    setError("");
    try {
      setFotos(await api.getRaw<Foto[]>(`informes/ot/${otId}/fotos`));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, [otId]);

  useEffect(() => {
    setCargando(true);
    cargar();
  }, [cargar]);

  async function alSubir(e: React.FormEvent) {
    e.preventDefault();
    const archivo = archivoRef.current?.files?.[0];
    if (!archivo) return toast.error("Elija la foto que quiere adjuntar.");
    setSubiendo(true);
    try {
      const blob = await prepararFoto(archivo);
      await subir(otId, blob, archivo.name, { pie: pie.trim(), resultadoId });
      toast.ok("Foto adjuntada a la OT.");
      setPie("");
      setResultadoId("");
      if (archivoRef.current) archivoRef.current.value = "";
      await cargar();
      onCambio?.();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubiendo(false);
    }
  }

  async function editar(f: Foto, cambios: Partial<Pick<Foto, "pie" | "enInforme" | "resultadoId">>) {
    try {
      await api.patch(`/informes/fotos/${f.id}`, {
        ...cambios,
        ...(cambios.resultadoId !== undefined ? { resultadoId: cambios.resultadoId || null } : {}),
      });
      setFotos((xs) => xs.map((x) => (x.id === f.id ? { ...x, ...cambios } : x)));
      onCambio?.();
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  async function quitar(f: Foto) {
    const okk = await confirmar({
      titulo: "¿Quitar la foto?",
      mensaje: "Deja de estar en la OT y en los informes que se emitan desde ahora. Los ya emitidos la conservan.",
      confirmarTexto: "Quitar",
      peligro: true,
    });
    if (!okk) return;
    try {
      await api.remove("informes/fotos", f.id);
      setFotos((xs) => xs.filter((x) => x.id !== f.id));
      onCambio?.();
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  const etiquetaEnsayo = (x: EnsayoOt) => `${x.punto ? `${x.punto} · ` : ""}${x.muestraCodigo} · ${x.ensayo ?? "Ensayo"}`;
  const enInforme = fotos.filter((f) => f.enInforme).length;

  return (
    <div>
      {error && <div className="alert warn">{error}</div>}
      {puedeEditar && (
        <form onSubmit={alSubir} className="form-grid" style={{ marginBottom: 12, alignItems: "end" }}>
          <div className="field">
            <label htmlFor="foto-archivo">Foto (PNG o JPEG) <span className="req">*</span></label>
            <input id="foto-archivo" ref={archivoRef} type="file" accept="image/png,image/jpeg" disabled={subiendo} />
          </div>
          <div className="field">
            <label htmlFor="foto-ensayo">Ensayo al que remite</label>
            <select id="foto-ensayo" value={resultadoId} onChange={(e) => setResultadoId(e.target.value)} disabled={subiendo}>
              <option value="">— Ninguno (foto general) —</option>
              {ensayos.map((x) => <option key={x.resultadoId} value={x.resultadoId}>{etiquetaEnsayo(x)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="foto-pie">Pie de foto</label>
            <input id="foto-pie" value={pie} maxLength={500} onChange={(e) => setPie(e.target.value)} disabled={subiendo}
              placeholder="Qué muestra la foto" />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <button className="btn primary sm" type="submit" disabled={subiendo}>{subiendo ? "Subiendo…" : "Adjuntar foto"}</button>
            <small style={{ marginLeft: 8, color: "var(--muted)" }}>Las fotos de más de 1600 px se reducen antes de subirlas (máx. 2 MB).</small>
          </div>
        </form>
      )}

      {cargando ? (
        <p className="subtitle">Cargando fotos…</p>
      ) : fotos.length === 0 ? (
        <p className="subtitle" style={{ margin: 0 }}>
          Todavía no hay fotos de esta OT.{puedeEditar ? " Adjúntelas arriba y marque las que van al anexo fotográfico." : ""}
        </p>
      ) : (
        <>
          <p className="subtitle" style={{ margin: "0 0 8px" }}>{enInforme} de {fotos.length} foto(s) van al anexo fotográfico, en este orden.</p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
            {fotos.map((f, i) => (
              <li key={f.id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 8, background: f.enInforme ? "#fff" : "#f6f8fa" }}>
                <img src={f.dataUrl} loading="lazy" alt={f.pie || `Foto ${i + 1} de la OT`}
                  style={{ width: "100%", height: 130, objectFit: "contain", background: "#eef3f7", borderRadius: 5 }} />
                <div className="field" style={{ marginTop: 6 }}>
                  <label htmlFor={`pie-${f.id}`}>Pie</label>
                  <input id={`pie-${f.id}`} defaultValue={f.pie ?? ""} maxLength={500} disabled={!puedeEditar}
                    onBlur={(e) => e.target.value !== (f.pie ?? "") && editar(f, { pie: e.target.value })} />
                </div>
                <div className="field" style={{ marginTop: 6 }}>
                  <label htmlFor={`ens-${f.id}`}>Ensayo</label>
                  <select id={`ens-${f.id}`} value={f.resultadoId ?? ""} disabled={!puedeEditar}
                    onChange={(e) => editar(f, { resultadoId: e.target.value || null })}>
                    <option value="">— Ninguno —</option>
                    {ensayos.map((x) => <option key={x.resultadoId} value={x.resultadoId}>{etiquetaEnsayo(x)}</option>)}
                  </select>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, gap: 6 }}>
                  <label style={{ fontSize: 12, display: "flex", gap: 5, alignItems: "center" }}>
                    <input type="checkbox" checked={f.enInforme} disabled={!puedeEditar} onChange={(e) => editar(f, { enInforme: e.target.checked })} />
                    Va al informe
                  </label>
                  {puedeEditar && <button type="button" className="btn ghost-danger sm" onClick={() => quitar(f)}>Quitar</button>}
                </div>
                <small style={{ display: "block", color: "var(--muted)", marginTop: 4 }}>
                  {Math.round(f.bytes / 1024)} KB{f.subidaPor ? ` · ${f.subidaPor}` : ""}
                </small>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
