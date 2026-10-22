"use client";

/**
 * Presentación del certificado de calibración (respuesta del Laboratorio de Metrología
 * del 21-10-2026): logo de acreditado y línea «Laboratorio de Calibración [Acreditado]
 * en la magnitud …», «Este certificado reemplaza al certificado N° …» a mano,
 * condiciones propias de la IT, OBSERVACIONES editables (valor inicial: los textos
 * automáticos) y esquema o imagen. El servidor valida y deja cada cambio en la bitácora.
 */
import { useCallback, useEffect, useState } from "react";
import { llamar } from "@/lib/laboratorio";
import { enviarInforme } from "@/lib/informes";
import { imagenComoDato } from "./imagen";
import { toast } from "@/components/ui/feedback";
import s from "./ficha.module.css";

type Campo = { clave: string; etiqueta: string; opciones?: string[] };
type Datos = {
  presentacion: {
    acreditado: boolean | null; acreditadoMotivo: string | null; reemplaza: string | null; reemplazaMotivo: string | null;
    observaciones: string | null; campos: Record<string, string>; esquemaModo: "defecto" | "propio" | "ninguno"; esquemaPie: string | null;
  };
  editable: boolean; acreditacionProceso: string | null; acreditado: boolean; logoConfigurado: boolean; reemision: string | null;
  automaticas: string[]; observaciones: string[]; campos: Campo[]; frases: string[];
  esquema: { modo: string; propio: boolean; defecto: string | null; imprime: string | null };
  hojas: number; avisos: string[];
};

export default function PresentacionCertificado({ id, magnitud, onGuardado }: { id: string; magnitud: string; onGuardado: () => void }) {
  const [d, setD] = useState<Datos | null>(null);
  const [error, setError] = useState("");
  const [f, setF] = useState<any>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [vista, setVista] = useState<string>("");
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const r = (await llamar("GET", `/metrologia/calibraciones/${id}/certificado`)).data as Datos;
      setD(r); setError("");
      setF({
        sinLogo: r.presentacion.acreditado === false, acreditadoMotivo: r.presentacion.acreditadoMotivo ?? "",
        reemplaza: r.presentacion.reemplaza ?? "", reemplazaMotivo: r.presentacion.reemplazaMotivo ?? "",
        observaciones: r.observaciones.join("\n"), propias: r.presentacion.observaciones != null,
        campos: { ...r.presentacion.campos }, esquemaModo: r.presentacion.esquemaModo, esquemaPie: r.presentacion.esquemaPie ?? "",
      });
    } catch (e: any) { setError(e.message); }
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]);
  // Vista del esquema que se imprimirá (imagen protegida, pedida con la sesión).
  const imprime = d?.esquema.imprime ?? null;
  const modoEsquema = d?.esquema.modo;
  useEffect(() => {
    if (!imprime) { setVista(""); return; }
    let vivo = true;
    imagenComoDato(`/metrologia/calibraciones/${id}/esquema`)
      .then((u) => { if (vivo) setVista(u); })
      .catch(() => vivo && setVista(""));
    return () => { vivo = false; };
  }, [imprime, modoEsquema, id]);

  if (error) return <div className="alert warn" role="alert">{error}</div>;
  if (!d || !f) return <p className="subtitle" style={{ margin: 0 }}>Cargando la presentación del certificado…</p>;

  const acreditadoProceso = !!d.acreditacionProceso;
  const lineaHoy = `Laboratorio de Calibración${d.acreditado ? " Acreditado" : ""} en la magnitud ${magnitud}`;
  const automaticas = d.automaticas.join("\n");
  const agregarFrase = (t: string) => setF((x: any) => ({ ...x, propias: true, observaciones: x.observaciones.includes(t) ? x.observaciones : `${x.observaciones.trimEnd()}\n${t}` }));

  async function guardar() {
    setOcupado(true);
    try {
      if (archivo) {
        const form = new FormData();
        form.append("archivo", archivo);
        if (f.esquemaPie.trim()) form.append("pie", f.esquemaPie.trim());
        await enviarInforme(`/metrologia/calibraciones/${id}/esquema`, "PUT", form);
        setArchivo(null);
      }
      const r = await llamar("PUT", `/metrologia/calibraciones/${id}/certificado`, {
        acreditado: acreditadoProceso ? (f.sinLogo ? false : null) : null,
        acreditadoMotivo: f.sinLogo ? f.acreditadoMotivo : null,
        reemplaza: d!.reemision ? null : f.reemplaza.trim() || null,
        reemplazaMotivo: f.reemplaza.trim() ? f.reemplazaMotivo : null,
        observaciones: f.propias && f.observaciones.trim() !== automaticas ? f.observaciones : null,
        campos: f.campos,
        esquemaModo: archivo ? "propio" : f.esquemaModo,
        esquemaPie: f.esquemaPie.trim() || null,
      });
      toast.ok(r?.data?.cambios ? `Certificado actualizado: ${r.data.cambios}.` : "Sin cambios en la presentación.");
      await cargar();
      onGuardado();
    } catch (e: any) { toast.error(e.message); }
    finally { setOcupado(false); }
  }

  const resumen = (
    <ul style={{ margin: "0 0 8px", paddingLeft: 18, fontSize: 12.5 }}>
      <li>{d.hojas} hojas · «Página X de {d.hojas}» en cada una. Hoja 1: firmas del Jefe de Departamento y del Jefe de Laboratorio y leyenda legal; hojas 2 a {d.hojas}: firmas del Jefe de Laboratorio y del metrólogo. Observaciones y «Fin del certificado» en la última.</li>
      <li>Línea de acreditación: «{lineaHoy}»{d.acreditado ? (d.logoConfigurado ? ", con el logo de acreditación." : ". El logo no está cargado: se imprime solo «Acreditación " + d.acreditacionProceso + "» (Metrología › Configuración).") : ", sin logo."}</li>
      {(d.reemision || d.presentacion.reemplaza) && <li>Reemplaza al certificado N° {d.reemision ?? d.presentacion.reemplaza}{d.reemision ? " (reemisión en el LIMS)" : ""}.</li>}
      <li>Esquema: {d.esquema.imprime ? `${d.esquema.imprime}${d.esquema.modo === "propio" ? " (imagen propia)" : " (el del proceso)"}` : "sin esquema"}.</li>
    </ul>
  );

  if (!d.editable)
    return (
      <div>
        {resumen}
        <p className="subtitle" style={{ margin: 0 }}>Solo quien elaboró la calibración cambia la presentación, mientras está en borrador.</p>
      </div>
    );

  return (
    <div>
      {resumen}
      {d.avisos.map((a) => <div key={a} className="alert warn">{a}</div>)}
      <div className="form-grid cols-2">
        <fieldset className={s.opciones} style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 4 }}>Logo de acreditado</legend>
          {acreditadoProceso ? (
            <>
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="radio" name="pc-logo" checked={!f.sinLogo} onChange={() => setF({ ...f, sinLogo: false })} /> Con logo · «Acreditado» ({d.acreditacionProceso}, según el proceso)</label>
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="radio" name="pc-logo" checked={f.sinLogo} onChange={() => setF({ ...f, sinLogo: true })} /> Sin logo · «Laboratorio de Calibración en la magnitud …»</label>
              {f.sinLogo && (
                <div className="field" style={{ marginTop: 6 }}><label htmlFor="pc-am">Motivo <span className="req">*</span></label>
                  <input id="pc-am" maxLength={500} value={f.acreditadoMotivo} onChange={(e) => setF({ ...f, acreditadoMotivo: e.target.value })} placeholder="Por ejemplo: todos los puntos quedan fuera del alcance acreditado" /></div>
              )}
            </>
          ) : <p style={{ margin: 0, fontSize: 12.5 }}>El proceso no está acreditado: el certificado sale sin logo y dice «Laboratorio de Calibración en la magnitud {magnitud}».</p>}
        </fieldset>
        <div>
          <div className="field"><label htmlFor="pc-r">Este certificado reemplaza al certificado N°</label>
            <input id="pc-r" maxLength={40} disabled={!!d.reemision} value={d.reemision ?? f.reemplaza} onChange={(e) => setF({ ...f, reemplaza: e.target.value })} placeholder="Por ejemplo, M-3901" /></div>
          {d.reemision
            ? <small style={{ color: "var(--muted)" }}>Lo fija la reemisión en el LIMS.</small>
            : f.reemplaza.trim() && (
              <div className="field"><label htmlFor="pc-rm">Motivo del reemplazo <span className="req">*</span></label>
                <input id="pc-rm" maxLength={500} value={f.reemplazaMotivo} onChange={(e) => setF({ ...f, reemplazaMotivo: e.target.value })} /></div>
            )}
        </div>
      </div>

      {d.campos.length > 0 && (
        <>
          <h3 style={{ fontSize: 12.5, margin: "12px 0 6px" }}>Datos propios de la instrucción de trabajo</h3>
          <div className="form-grid cols-2">
            {d.campos.map((c) => (
              <div key={c.clave} className="field"><label htmlFor={`pc-c-${c.clave}`}>{c.etiqueta}</label>
                <input id={`pc-c-${c.clave}`} list={c.opciones ? `pc-l-${c.clave}` : undefined} maxLength={200} value={f.campos[c.clave] ?? ""}
                  onChange={(e) => setF({ ...f, campos: { ...f.campos, [c.clave]: e.target.value } })} />
                {c.opciones && <datalist id={`pc-l-${c.clave}`}>{c.opciones.map((o) => <option key={o} value={o} />)}</datalist>}
              </div>
            ))}
          </div>
        </>
      )}

      <div className="field" style={{ marginTop: 10 }}>
        <label htmlFor="pc-obs">Observaciones (última hoja · una por línea)</label>
        <textarea id="pc-obs" rows={Math.min(12, Math.max(5, f.observaciones.split("\n").length + 1))} value={f.observaciones}
          onChange={(e) => setF({ ...f, observaciones: e.target.value, propias: true })} />
        <div className={s.acciones} style={{ margin: "6px 0 0" }}>
          {d.frases.map((t) => <button key={t} type="button" className="btn outline sm" onClick={() => agregarFrase(t)}>+ {t.length > 60 ? `${t.slice(0, 57)}…` : t}</button>)}
          <button type="button" className="btn outline sm" onClick={() => setF({ ...f, observaciones: automaticas, propias: false })}>Restaurar los textos automáticos</button>
        </div>
        <small style={{ color: "var(--muted)" }}>Intervalo de calibración, factor de cobertura, situaciones especiales, puntos fuera del alcance acreditado o calibrados a pedido del cliente.</small>
      </div>

      <fieldset className={s.opciones} style={{ border: 0, padding: 0, margin: "10px 0 0" }}>
        <legend style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 4 }}>Esquema o imagen en el certificado</legend>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="radio" name="pc-esq" checked={f.esquemaModo === "defecto" && !archivo} onChange={() => { setArchivo(null); setF({ ...f, esquemaModo: "defecto" }); }} />
            {d.esquema.defecto ? `El del proceso: ${d.esquema.defecto}` : "El del proceso (no tiene)"}</label>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="radio" name="pc-esq" checked={f.esquemaModo === "propio" || !!archivo} disabled={!d.esquema.propio && !archivo} onChange={() => setF({ ...f, esquemaModo: "propio" })} /> Imagen propia de esta calibración</label>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="radio" name="pc-esq" checked={f.esquemaModo === "ninguno" && !archivo} onChange={() => { setArchivo(null); setF({ ...f, esquemaModo: "ninguno" }); }} /> Sin esquema</label>
        </div>
        <div className="form-grid cols-2" style={{ marginTop: 6 }}>
          <div className="field"><label htmlFor="pc-file">Subir imagen propia (PNG o JPEG, máx. 2 MB)</label>
            <input id="pc-file" type="file" accept="image/png,image/jpeg" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} /></div>
          <div className="field"><label htmlFor="pc-pie">Pie de la imagen</label>
            <input id="pc-pie" maxLength={300} value={f.esquemaPie} onChange={(e) => setF({ ...f, esquemaPie: e.target.value })} placeholder="Por ejemplo: sensores en los planos superior e inferior" /></div>
        </div>
        {vista && <img src={vista} alt={`Esquema que se imprime: ${d.esquema.imprime}`} style={{ maxWidth: 320, maxHeight: 200, border: "1px solid var(--line)", borderRadius: 6, marginTop: 6 }} />}
      </fieldset>

      <div className={s.acciones} style={{ marginTop: 12 }}>
        <button className="btn primary" disabled={ocupado} onClick={guardar}>Guardar la presentación → Certificado</button>
        <span className={s.espera}>Cada cambio queda en la bitácora; el certificado en pantalla y el PDF se actualizan al guardar.</span>
      </div>
    </div>
  );
}
