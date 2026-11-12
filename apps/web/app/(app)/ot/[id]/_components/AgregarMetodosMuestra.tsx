"use client";

/**
 * F064 · Agregar métodos a una muestra ya recepcionada (p. ej. el segundo método
 * de un ensayo cotizado que se omitió al recepcionar). Lo hacen Recepción o la
 * jefatura del laboratorio, con motivo; queda en el historial de la OT.
 * API: POST /flujo/muestras/:id/metodos { metodoIds, motivo }.
 */
import { useEffect, useState } from "react";
import { llamar } from "@/lib/laboratorio";
import { toast } from "@/components/ui/feedback";

interface MetodoBuscado {
  id: string; codigo: string; nombre: string; norma?: string | null; analitos: number;
  laboratorio?: string | null; delLaboratorio?: boolean;
}

export default function AgregarMetodosMuestra({ otId, muestraId, codigo, yaEnMuestra, onAgregado }: {
  otId: string;
  muestraId: string;
  codigo: string;
  /** Códigos de los métodos que la muestra ya tiene. */
  yaEnMuestra: string[];
  onAgregado: () => void;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [encontrados, setEncontrados] = useState<MetodoBuscado[]>([]);
  const [elegidos, setElegidos] = useState<MetodoBuscado[]>([]);
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    const q = busqueda.trim();
    if (q.length < 2) { setEncontrados([]); return; }
    const t = setTimeout(() => {
      llamar<{ metodos: MetodoBuscado[] }>("GET", `/recepcion/ot/${otId}/metodos?search=${encodeURIComponent(q)}`)
        .then((r) => setEncontrados(r.metodos))
        .catch(() => setEncontrados([]));
    }, 300);
    return () => clearTimeout(t);
  }, [busqueda, otId]);

  async function agregar() {
    setGuardando(true);
    try {
      const r = await llamar<{ creados: number }>("POST", `/flujo/muestras/${muestraId}/metodos`, { metodoIds: elegidos.map((m) => m.id), motivo: motivo.trim() });
      toast.ok(`Se agregaron ${r.creados} ensayo(s) por analizar a ${codigo}. Queda en el historial de la OT.`);
      setElegidos([]);
      setMotivo("");
      onAgregado();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <fieldset style={{ border: "1px solid var(--line)", borderRadius: 6, padding: "8px 12px", margin: "10px 0 0" }}>
      <legend style={{ fontWeight: 600, fontSize: 12.5 }}>Agregar métodos a la muestra</legend>
      <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "0 0 6px" }}>
        Si al recepcionar se omitió un método (por ejemplo, el segundo método de un ensayo cotizado), agréguelo aquí con el motivo.
        {yaEnMuestra.length ? ` La muestra ya tiene: ${yaEnMuestra.join(", ")}.` : ""}
      </p>
      <div className="field" style={{ maxWidth: 520, position: "relative", margin: 0 }}>
        <label htmlFor={`agr-met-${muestraId}`}>Buscar en el catálogo</label>
        <input id={`agr-met-${muestraId}`} value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Código, nombre o norma del método" />
        {encontrados.length > 0 && (
          <ul style={{ listStyle: "none", padding: 0, margin: "4px 0 0", maxHeight: 180, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 4, background: "#fff" }}>
            {encontrados.map((m) => (
              <li key={m.id}>
                <button type="button" className="btn ghost sm" style={{ width: "100%", justifyContent: "flex-start" }} disabled={!m.analitos}
                  onClick={() => { if (!elegidos.some((x) => x.id === m.id)) setElegidos([...elegidos, m]); setBusqueda(""); setEncontrados([]); }}>
                  {m.codigo} · {m.nombre}{m.norma ? ` (${m.norma})` : ""}{!m.analitos ? " · sin analitos en el catálogo" : ""}
                  {m.delLaboratorio === false ? ` · ${m.laboratorio ?? "otro laboratorio"}` : ""}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {elegidos.length > 0 && (
        <ul style={{ margin: "6px 0", paddingLeft: 18, fontSize: 12.5 }}>
          {elegidos.map((m) => (
            <li key={m.id}>
              {m.codigo} · {m.nombre}{" "}
              <button type="button" className="btn ghost sm" aria-label={`Quitar ${m.codigo}`} onClick={() => setElegidos(elegidos.filter((x) => x.id !== m.id))}>✕</button>
            </li>
          ))}
        </ul>
      )}
      <div className="field" style={{ maxWidth: 520, margin: "6px 0 0" }}>
        <label htmlFor={`agr-mot-${muestraId}`}>Motivo <span className="req">*</span></label>
        <input id={`agr-mot-${muestraId}`} value={motivo} maxLength={500} onChange={(e) => setMotivo(e.target.value)} placeholder="p. ej. se omitió el método de Humedad al recepcionar" />
      </div>
      <div className="toolbar" style={{ marginTop: 6 }}>
        <div className="spacer" />
        <button type="button" className="btn outline sm" disabled={guardando || !elegidos.length || motivo.trim().length < 5} onClick={agregar}>
          {guardando ? "Agregando…" : "Agregar a la muestra"}
        </button>
      </div>
    </fieldset>
  );
}
