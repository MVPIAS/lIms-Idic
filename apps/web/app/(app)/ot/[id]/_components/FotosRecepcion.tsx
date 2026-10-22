"use client";

/**
 * Registro fotográfico de la recepción de UNA muestra (EP-03 §0.4; LME
 * 20-10-2026): quien recepciona (muestra.crear) adjunta fotos del envase, los
 * sellos o el estado en que llegó. No van al informe salvo que se marquen en la
 * pestaña «Fotos» (anexo fotográfico). API: /informes/ot/:otId/fotos con
 * tipo = recepcion.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { confirmar, toast } from "@/components/ui/feedback";
import { ImagenFoto, prepararFoto, subir } from "@/components/informes/FotosInforme";

type FotoRecepcion = { id: string; tipo?: string; muestraId: string | null; pie: string | null; url: string; bytes: number; subidaPor: string | null };

export default function FotosRecepcion({ otId, muestraId, codigo, puedeEditar, onCambio }: {
  otId: string;
  muestraId: string;
  codigo: string;
  puedeEditar: boolean;
  onCambio?: () => void;
}) {
  const [fotos, setFotos] = useState<FotoRecepcion[]>([]);
  const [pie, setPie] = useState("");
  const [subiendo, setSubiendo] = useState(false);
  const archivoRef = useRef<HTMLInputElement>(null);

  const cargar = useCallback(async () => {
    try {
      const todas = await api.getRaw<FotoRecepcion[]>(`informes/ot/${otId}/fotos`);
      setFotos(todas.filter((f) => f.tipo === "recepcion" && f.muestraId === muestraId));
    } catch {
      setFotos([]);
    }
  }, [otId, muestraId]);
  useEffect(() => { cargar(); }, [cargar]);

  async function adjuntar() {
    const archivo = archivoRef.current?.files?.[0];
    if (!archivo) return toast.error("Elija la foto que quiere adjuntar.");
    setSubiendo(true);
    try {
      const blob = await prepararFoto(archivo);
      await subir(otId, blob, archivo.name, { pie: pie.trim(), muestraId, tipo: "recepcion" });
      toast.ok(`Foto de la recepción de ${codigo} adjuntada.`);
      setPie("");
      if (archivoRef.current) archivoRef.current.value = "";
      await cargar();
      onCambio?.();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSubiendo(false);
    }
  }

  async function quitar(f: FotoRecepcion) {
    const ok = await confirmar({ titulo: "¿Quitar la foto?", mensaje: "Deja de estar en el registro fotográfico de la muestra.", confirmarTexto: "Quitar", peligro: true });
    if (!ok) return;
    try {
      await api.remove("informes/fotos", f.id);
      await cargar();
      onCambio?.();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 6 }}>Registro fotográfico de la recepción · {fotos.length} foto(s)</div>
      {fotos.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 8px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
          {fotos.map((f, i) => (
            <li key={f.id} style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 6, background: "#fff" }}>
              <ImagenFoto url={f.url} alt={f.pie || `Foto ${i + 1} de la recepción de ${codigo}`} />
              <div style={{ fontSize: 11.5, marginTop: 4 }}>{f.pie || <span style={{ color: "var(--muted)" }}>Sin pie</span>}</div>
              {puedeEditar && <button type="button" className="btn ghost-danger sm" style={{ marginTop: 4 }} onClick={() => quitar(f)}>Quitar</button>}
            </li>
          ))}
        </ul>
      )}
      {puedeEditar && (
        <div className="toolbar" style={{ margin: 0, alignItems: "flex-end", flexWrap: "wrap", gap: 8 }}>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor={`fr-${muestraId}`}>Foto (PNG o JPEG)</label>
            <input id={`fr-${muestraId}`} ref={archivoRef} type="file" accept="image/png,image/jpeg" disabled={subiendo} />
          </div>
          <div className="field" style={{ margin: 0, flex: 1, minWidth: 180 }}>
            <label htmlFor={`frp-${muestraId}`}>Pie</label>
            <input id={`frp-${muestraId}`} value={pie} maxLength={500} onChange={(e) => setPie(e.target.value)} placeholder="Qué se ve: envase, sello, rótulo…" disabled={subiendo} />
          </div>
          <button type="button" className="btn outline sm" disabled={subiendo} onClick={adjuntar}>{subiendo ? "Subiendo…" : "Adjuntar foto"}</button>
        </div>
      )}
    </div>
  );
}
