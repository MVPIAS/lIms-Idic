"use client";

/**
 * Configuración del laboratorio › Cepas de referencia (QC microbiológico, EP-02 ALI-D6).
 * Catálogo de cepas ATCC del control positivo: alta, edición y baja (inactiva).
 * Lectura con resultado.ver; cambios con catalogo.gestionar (Calidad, Administración).
 */
import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import RequierePermiso from "@/components/RequierePermiso";
import { api } from "@/lib/api";
import { usePermisos } from "@/lib/permisos";
import { toast } from "@/components/ui/feedback";
import { enviarInforme } from "@/lib/informes";

type Cepa = { id: string; numero: number | null; codigo: string; organismo: string; activo: boolean };

export default function CepasPage() {
  return (
    <RequierePermiso perm="resultado.ver" titulo="Cepas de referencia">
      <Contenido />
    </RequierePermiso>
  );
}

function Contenido() {
  const { puede } = usePermisos();
  const edita = puede("catalogo.gestionar");
  const [cepas, setCepas] = useState<Cepa[]>([]);
  const [n, setN] = useState({ numero: "", codigo: "", organismo: "" });
  const cargar = useCallback(() => api.getRaw<Cepa[]>("qc/cepas?todas=1").then(setCepas).catch((e) => toast.error(e.message)), []);
  useEffect(() => { cargar(); }, [cargar]);

  async function guardar(ruta: string, metodo: "POST" | "PUT", cuerpo: object, ok: string) {
    try {
      await enviarInforme(ruta, metodo, cuerpo);
      toast.ok(ok);
      cargar();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  return (
    <div>
      <PageHeader icono="🧫" titulo="Cepas de referencia" subtitulo="Cepas ATCC del control positivo del QC microbiológico. Una cepa inactiva no se ofrece al registrar controles; los registrados la conservan."
        migas={[{ label: "Configuración del laboratorio" }, { label: "Cepas de referencia" }]} />
      <div className="card" style={{ padding: 14 }}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Nº</th><th>Organismo</th><th>Código</th><th>Estado</th>{edita && <th></th>}</tr></thead>
            <tbody>
              {cepas.map((c) => (
                <tr key={c.id}>
                  <td>{c.numero ?? "—"}</td><td><i>{c.organismo}</i></td><td>{c.codigo}</td>
                  <td><span className={`pill ${c.activo ? "green" : "gray"}`}>{c.activo ? "Activa" : "Inactiva"}</span></td>
                  {edita && (
                    <td><button className="btn link sm" onClick={() => guardar(`/qc/cepas/${c.id}`, "PUT", { codigo: c.codigo, organismo: c.organismo, numero: c.numero, activo: !c.activo }, c.activo ? "Cepa desactivada." : "Cepa activada.")}>
                      {c.activo ? "Desactivar" : "Activar"}</button></td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {edita && (
          <div className="form-grid cols-4" style={{ marginTop: 10 }}>
            <div className="field"><label htmlFor="ce-n">Nº</label><input id="ce-n" inputMode="numeric" value={n.numero} onChange={(e) => setN({ ...n, numero: e.target.value })} /></div>
            <div className="field"><label htmlFor="ce-o">Organismo</label><input id="ce-o" value={n.organismo} onChange={(e) => setN({ ...n, organismo: e.target.value })} /></div>
            <div className="field"><label htmlFor="ce-c">Código (p. ej. ATCC 25922)</label><input id="ce-c" value={n.codigo} onChange={(e) => setN({ ...n, codigo: e.target.value })} /></div>
            <div className="field" style={{ alignSelf: "end" }}>
              <button className="btn primary sm" disabled={!n.codigo.trim() || !n.organismo.trim()}
                onClick={() => guardar("/qc/cepas", "POST", { codigo: n.codigo, organismo: n.organismo, numero: n.numero ? Number(n.numero) : null }, "Cepa agregada.").then(() => setN({ numero: "", codigo: "", organismo: "" }))}>
                Agregar cepa
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
