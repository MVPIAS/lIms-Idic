"use client";

/**
 * Metrología › Configuración › Certificado: logo de acreditación (lo carga el IDIC; sin
 * él, el certificado acreditado imprime solo «Acreditación LC …») y esquema por defecto
 * de cada proceso (por ejemplo, la posición de los sensores en isotermos, ITT02).
 */
import { useCallback, useEffect, useState } from "react";
import { llamar } from "@/lib/laboratorio";
import { fecha } from "@/lib/format";
import { enviarInforme } from "@/lib/informes";
import { imagenComoDato } from "./imagen";
import { confirmar, toast } from "@/components/ui/feedback";

type Fila = { clave: string; titulo: string | null; mime: string; bytes: number; nombre: string | null; updated_at: string; actualizado_por: string | null };

function Vista({ clave, version }: { clave: string; version: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let vivo = true;
    imagenComoDato(`/metrologia/imagenes/${encodeURIComponent(clave)}`).then((x) => vivo && setUrl(x)).catch(() => vivo && setUrl(""));
    return () => { vivo = false; };
  }, [clave, version]);
  return url ? <img src={url} alt={`Imagen ${clave}`} style={{ maxWidth: 220, maxHeight: 90, objectFit: "contain", border: "1px solid var(--line)", borderRadius: 4, background: "#fff" }} /> : <span style={{ color: "var(--muted)" }}>—</span>;
}

export default function ImagenesCertificado({ editar }: { editar: boolean }) {
  const [filas, setFilas] = useState<Fila[]>([]);
  const [procesos, setProcesos] = useState<{ codigo: string; nombre: string }[]>([]);
  const [error, setError] = useState("");
  const [nuevo, setNuevo] = useState({ clave: "logo_acreditacion", titulo: "", archivo: null as File | null });
  const [ocupado, setOcupado] = useState(false);
  const cargar = useCallback(() => llamar("GET", "/metrologia/imagenes").then((r) => { setFilas(r.data ?? []); setError(""); }).catch((e) => setError(e.message)), []);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { llamar("GET", "/metrologia/procesos").then((r) => setProcesos(r.data ?? [])).catch(() => setProcesos([])); }, []);

  const nombreClave = (c: string) => (c === "logo_acreditacion" ? "Logo de acreditación" : `Esquema por defecto · ${c.slice(8)}`);

  async function subir() {
    if (!nuevo.archivo) return;
    setOcupado(true);
    try {
      const form = new FormData();
      form.append("archivo", nuevo.archivo);
      if (nuevo.titulo.trim()) form.append("titulo", nuevo.titulo.trim());
      await enviarInforme(`/metrologia/imagenes/${encodeURIComponent(nuevo.clave)}`, "PUT", form);
      toast.ok(`${nombreClave(nuevo.clave)} cargado.`);
      setNuevo({ ...nuevo, titulo: "", archivo: null });
      await cargar();
    } catch (e: any) { toast.error(e.message); }
    finally { setOcupado(false); }
  }
  async function quitar(clave: string) {
    if (!(await confirmar({ titulo: `¿Quitar ${nombreClave(clave).toLowerCase()}?`, mensaje: "Los certificados que se emitan desde ahora no la llevarán. Los ya emitidos no cambian.", confirmarTexto: "Quitar" }))) return;
    try {
      const r = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "/api"}/metrologia/imagenes/${encodeURIComponent(clave)}`, { method: "DELETE", headers: { Authorization: `Bearer ${localStorage.getItem("lims_token")}` } });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? `Error ${r.status}`);
      toast.ok("Imagen quitada."); await cargar();
    } catch (e: any) { toast.error(e.message); }
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 0 }}>
        El logo de acreditación sale en la cabecera de cada hoja de los certificados acreditados; sin logo cargado, se imprime solo «Acreditación LC …».
        El esquema por defecto de un proceso se imprime en sus certificados salvo que el metrólogo elija otra imagen o ninguna. Imágenes PNG o JPEG de hasta 2 MB.
      </p>
      {error && <div className="alert warn">{error}</div>}
      <table className="data">
        <thead><tr><th>Imagen</th><th>Título en el certificado</th><th>Vista</th><th>Archivo</th><th>Actualizada</th>{editar && <th></th>}</tr></thead>
        <tbody>
          {filas.length ? filas.map((f) => (
            <tr key={f.clave}>
              <td>{nombreClave(f.clave)}</td>
              <td>{f.titulo ?? "—"}</td>
              <td><Vista clave={f.clave} version={f.updated_at} /></td>
              <td>{f.nombre ?? "—"} · {(f.bytes / 1024).toFixed(0)} KB</td>
              <td>{fecha(f.updated_at)}{f.actualizado_por ? ` · ${f.actualizado_por}` : ""}</td>
              {editar && <td><button className="btn outline sm" onClick={() => quitar(f.clave)}>Quitar</button></td>}
            </tr>
          )) : <tr><td colSpan={editar ? 6 : 5} style={{ color: "var(--muted)" }}>Sin imágenes cargadas.</td></tr>}
        </tbody>
      </table>
      {editar && (
        <div className="card" style={{ padding: 14, marginTop: 14 }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 13 }}>Cargar o reemplazar una imagen</h3>
          <div className="form-grid cols-2">
            <div className="field"><label htmlFor="ic-c">Imagen</label>
              <select id="ic-c" value={nuevo.clave} onChange={(e) => setNuevo({ ...nuevo, clave: e.target.value })}>
                <option value="logo_acreditacion">Logo de acreditación</option>
                {procesos.map((p) => <option key={p.codigo} value={`esquema:${p.codigo}`}>Esquema por defecto · {p.codigo} · {p.nombre}</option>)}
              </select></div>
            <div className="field"><label htmlFor="ic-t">Título en el certificado</label>
              <input id="ic-t" maxLength={200} value={nuevo.titulo} disabled={nuevo.clave === "logo_acreditacion"} onChange={(e) => setNuevo({ ...nuevo, titulo: e.target.value })} placeholder="Por ejemplo: Representación esquemática de la posición de los sensores" /></div>
            <div className="field"><label htmlFor="ic-a">Archivo (PNG o JPEG) <span className="req">*</span></label>
              <input id="ic-a" type="file" accept="image/png,image/jpeg" onChange={(e) => setNuevo({ ...nuevo, archivo: e.target.files?.[0] ?? null })} /></div>
          </div>
          <button className="btn primary" disabled={ocupado || !nuevo.archivo} onClick={subir}>Cargar imagen</button>
        </div>
      )}
    </div>
  );
}
