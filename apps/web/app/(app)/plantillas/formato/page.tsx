"use client";

/**
 * Configuración del laboratorio › Plantillas de documentos: formato de cada
 * plantilla de informe (agrupación, numeración, columnas y títulos, referencias,
 * anexo fotográfico, conclusión y portada). Es la misma edición que hay en
 * «Emitir informe», sin dar acceso a la emisión: la usa Gestión de Calidad
 * (permiso plantilla.gestionar). Vale para los documentos que se emitan después.
 */
import { useEffect, useMemo, useState } from "react";
import { PageHeader, EmptyState } from "@/components/ui/PageHeader";
import RequierePermiso from "@/components/RequierePermiso";
import { api } from "@/lib/api";
import FormatoPlantilla from "@/components/informes/FormatoPlantilla";

type Plantilla = { id: string; repid: string; nombre: string; tipo: string; version: string | null; activo?: boolean };

export default function FormatoPlantillasPage() {
  return (
    <RequierePermiso perm="plantilla.gestionar" titulo="Plantillas de documentos">
      <Contenido />
    </RequierePermiso>
  );
}

function Contenido() {
  const [plantillas, setPlantillas] = useState<Plantilla[] | null>(null);
  const [error, setError] = useState("");
  const [sel, setSel] = useState("");
  const [filtro, setFiltro] = useState("");

  useEffect(() => {
    api
      .list<Plantilla>("plantillas", { limit: 100 })
      .then((r) => setPlantillas(r.data))
      .catch((e) => { setError(e.message); setPlantillas([]); });
  }, []);

  const visibles = useMemo(() => {
    const t = filtro.trim().toLowerCase();
    return (plantillas ?? []).filter((p) => !t || `${p.repid} ${p.nombre} ${p.tipo}`.toLowerCase().includes(t));
  }, [plantillas, filtro]);
  const elegida = plantillas?.find((p) => p.id === sel) ?? null;

  return (
    <div>
      <PageHeader
        icono="📄"
        titulo="Plantillas de documentos"
        subtitulo="Formato de cada plantilla de informe: agrupación y numeración de los ensayos, columnas y sus títulos, referencias, anexo fotográfico, conclusión fija y portada. El cambio vale para los documentos que se emitan desde ahora; los ya emitidos no cambian."
        migas={[{ label: "Configuración del laboratorio" }, { label: "Plantillas de documentos" }]}
      />
      {error && <div className="alert warn" role="alert">{error}</div>}
      <div className="card" style={{ padding: 14 }}>
        <div className="form-grid cols-2">
          <div className="field">
            <label htmlFor="pl-buscar">Buscar plantilla</label>
            <input id="pl-buscar" value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="REPID, nombre o tipo" />
          </div>
          <div className="field">
            <label htmlFor="pl-sel">Plantilla <span className="req">*</span></label>
            <select id="pl-sel" value={sel} onChange={(e) => setSel(e.target.value)} disabled={plantillas === null}>
              <option value="">{plantillas === null ? "Cargando plantillas…" : `— Seleccione (${visibles.length}) —`}</option>
              {visibles.map((p) => (
                <option key={p.id} value={p.id}>{p.repid} · {p.nombre} ({p.tipo}{p.version ? ` · ${p.version}` : ""})</option>
              ))}
            </select>
          </div>
        </div>
      </div>
      {elegida ? (
        <div className="card" style={{ padding: 14 }}>
          <h2 style={{ fontSize: 14, margin: "0 0 8px" }}>Formato de {elegida.repid} · {elegida.nombre}</h2>
          <FormatoPlantilla key={elegida.id} plantillaId={elegida.id} />
        </div>
      ) : (
        plantillas !== null && (
          <EmptyState icono="📄" titulo="Elija una plantilla" texto="Seleccione arriba la plantilla cuyo formato quiere revisar o cambiar." />
        )
      )}
    </div>
  );
}
