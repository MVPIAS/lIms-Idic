"use client";

/**
 * «Generar oficio» (EP-00 3.1 desde la cotización; EP-05 7.2 desde el
 * documento de la OT). Nº oficio: correlativo de la unidad, se asigna al
 * enviarlo a firmas. Botón «Generar oficio → firmas» (V°B° del Jefe de
 * Departamento → firma de la Dirección, según la matriz OFICIO).
 */
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { llamar } from "@/lib/laboratorio";
import { hoyISO } from "@/lib/format";
import { toast } from "@/components/ui/feedback";
import { leerDistribucion } from "@/lib/oficios";

export default function NuevoOficioPage() {
  return (
    <Suspense fallback={<p className="subtitle">Cargando…</p>}>
      <NuevoOficio />
    </Suspense>
  );
}

function NuevoOficio() {
  const params = useSearchParams();
  const router = useRouter();
  const otId = params.get("ot");
  const cotizacionId = params.get("cotizacion");
  const documento = params.get("documento");
  const [origen, setOrigen] = useState<{ titulo: string; documentos: any[] } | null>(null);
  const [error, setError] = useState("");
  const [elegidos, setElegidos] = useState<string[]>(documento ? [documento] : []);
  const [f, setF] = useState({ destinatario: "", materia: "", fecha: hoyISO(), cuerpo: "", distribucion: "" });
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        if (otId) {
          const s = await llamar("GET", `/ot/${otId}/seguimiento`);
          setOrigen({
            titulo: `OT ${s.ot.codigo}${s.ot.cliente ? ` · ${s.ot.cliente}` : ""}`,
            documentos: s.documentos.filter((d: any) => ["oficial", "emitido"].includes(d.estado)),
          });
        } else if (cotizacionId) {
          const c = await llamar("GET", `/cotizaciones/${cotizacionId}`);
          setOrigen({ titulo: `Cotización ${c.numero ?? c.codigo}${c.cliente?.razonSocial ? ` · ${c.cliente.razonSocial}` : ""}`, documentos: [] });
        } else setError("Abra el oficio desde la cotización o desde el documento de la OT.");
      } catch (e: any) {
        setError(e.message);
      }
    })();
  }, [otId, cotizacionId]);

  async function guardar(generar: boolean) {
    setOcupado(true);
    try {
      const o = await llamar<any>("POST", "/oficios", {
        ...(cotizacionId ? { cotizacionId } : { otId, documentos: elegidos }),
        destinatario: f.destinatario.trim(),
        materia: f.materia.trim(),
        fecha: f.fecha,
        ...(f.cuerpo.trim() ? { cuerpo: f.cuerpo.trim() } : {}),
        distribucion: leerDistribucion(f.distribucion),
      });
      if (generar) {
        const g = await llamar<any>("POST", `/oficios/${o.id}/generar`);
        toast.ok(`Oficio ${g.numero} enviado a firmas.`);
      } else toast.ok("Oficio guardado en borrador.");
      router.push(`/oficios/${o.id}` as any);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }

  const valido = f.destinatario.trim().length >= 3 && f.materia.trim().length >= 3 && (cotizacionId || elegidos.length > 0);
  return (
    <div>
      <PageHeader
        titulo="Generar oficio conductor"
        subtitulo={origen?.titulo ?? ""}
        migas={[{ label: "Oficios conductores", href: "/oficios" }, { label: "Nuevo" }]}
      />
      {error && <div className="alert warn" role="alert">{error}</div>}
      {origen && (
        <div className="card">
          <ol className="pasos-proc" style={{ display: "flex", gap: 12, listStyle: "none", padding: 0, margin: "0 0 12px", fontSize: 12, color: "var(--muted)", flexWrap: "wrap" }}>
            <li><b style={{ color: "var(--ink)" }}>1 · Elaborar</b></li>
            <li>2 · V°B° Jefe de Departamento</li>
            <li>3 · Firma de la Dirección</li>
            <li>4 · Despacho por Oficina de partes</li>
          </ol>
          {otId && (
            <fieldset style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 10, marginBottom: 12 }}>
              <legend style={{ fontSize: 12, fontWeight: 600 }}>Documento que conduce <span className="req">*</span></legend>
              {origen.documentos.length === 0 ? (
                <p className="subtitle" style={{ margin: 0 }}>La OT no tiene documentos oficiales: el oficio conduce un documento ya firmado.</p>
              ) : (
                origen.documentos.map((d: any) => (
                  <label key={d.id} style={{ display: "block", fontSize: 12.5 }}>
                    <input type="checkbox" checked={elegidos.includes(d.id)} onChange={() => setElegidos((x) => (x.includes(d.id) ? x.filter((y) => y !== d.id) : [...x, d.id]))} />{" "}
                    {d.numero} · {d.plantilla ?? d.tipoDocumento ?? "documento"}
                  </label>
                ))
              )}
            </fieldset>
          )}
          <div className="form-grid cols-2">
            <div className="field span-2"><label>Destinatario (unidad o autoridad) <span className="req">*</span></label><input value={f.destinatario} maxLength={300} onChange={(e) => setF({ ...f, destinatario: e.target.value })} /></div>
            <div className="field span-2"><label>Materia (OBJ.) <span className="req">*</span></label><input value={f.materia} maxLength={500} onChange={(e) => setF({ ...f, materia: e.target.value })} /></div>
            <div className="field"><label>Fecha</label><input type="date" value={f.fecha} max={hoyISO()} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></div>
            <div className="field"><label>Nº de oficio</label><input value="Se asigna al enviarlo a firmas (correlativo de la unidad)" readOnly /></div>
            <div className="field span-2"><label>Texto del oficio (un párrafo por bloque; vacío = texto de remisión)</label><textarea rows={5} maxLength={8000} value={f.cuerpo} onChange={(e) => setF({ ...f, cuerpo: e.target.value })} /></div>
            <div className="field span-2"><label>Distribución (una línea por destinatario, con sus ejemplares al final)</label><textarea rows={3} maxLength={2000} value={f.distribucion} onChange={(e) => setF({ ...f, distribucion: e.target.value })} /></div>
          </div>
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <Link href={(otId ? `/ot/${otId}?tab=informe` : cotizacionId ? `/cotizaciones/${cotizacionId}` : "/oficios") as any} className="btn outline">Cancelar</Link>
            <span className="spacer" />
            <button type="button" className="btn outline" disabled={ocupado || !valido} onClick={() => guardar(false)}>Guardar borrador</button>
            <button type="button" className="btn primary" disabled={ocupado || !valido} onClick={() => guardar(true)}>Generar oficio → firmas</button>
          </div>
        </div>
      )}
    </div>
  );
}
