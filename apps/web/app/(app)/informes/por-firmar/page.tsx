"use client";

/**
 * Documentos por firmar · informes y certificados cuyo paso ACTUAL de la
 * matriz de firmas le corresponde al usuario (como titular, subrogante o por
 * su rol en la unidad). Se revisa la vista previa y se firma o se devuelve
 * con motivo. Reglas: docs/FLUJO_FIRMA_CIERRE.md.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fecha } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/ui/PageHeader";
import { ACCION_FIRMA } from "@/lib/documentos";
import PanelDocumento from "@/components/documentos/PanelDocumento";

export default function PorFirmarPage() {
  const [filas, setFilas] = useState<any[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    setError("");
    try {
      const r = await api.getRaw<any[]>("informes/por-firmar");
      setFilas(r);
      setSel((s) => (s && r.some((x) => x.id === s) ? s : r[0]?.id ?? null));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  return (
    <>
      <PageHeader
        titulo="Documentos por firmar"
        icono="✒"
        subtitulo="Informes y certificados que esperan su firma según la matriz de firmas. Revise la vista previa y firme, o devuélvalo con el motivo para que lo corrijan."
        migas={[{ label: "Laboratorio" }, { label: "Documentos por firmar" }]}
        acciones={<button className="btn outline" onClick={cargar}>Actualizar</button>}
      />
      {error && <div className="alert warn">{error}</div>}

      {!cargando && !filas.length ? (
        <div className="card">
          <EmptyState icono="✅" titulo="No tiene documentos por firmar" texto="Cuando se emita un informe en el que le toque firmar, aparecerá aquí y en Mi bandeja." />
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 320px) 1fr", gap: 14, alignItems: "start" }}>
          <div className="card" style={{ padding: 0 }}>
            {cargando && <p className="subtitle" style={{ padding: 12 }}>Cargando…</p>}
            {filas.map((f) => (
              <button
                key={f.id}
                onClick={() => setSel(f.id)}
                style={{
                  display: "block", width: "100%", textAlign: "left", padding: "10px 12px", border: 0,
                  borderBottom: "1px solid var(--line)", cursor: "pointer",
                  background: sel === f.id ? "#eef5fb" : "transparent",
                }}
              >
                <div><span className="codigo">{f.numero}</span> <span className="pill amber">{ACCION_FIRMA[f.accion] ?? f.accion}</span></div>
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3 }}>
                  OT {f.otCodigo}{f.cliente ? ` · ${f.cliente}` : ""}
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>
                  {f.plantillaNombre ?? f.tipo} · emitido {fecha(f.fecha)} · firmas {f.firmasHechas}/{f.firmasTotal}
                </div>
              </button>
            ))}
          </div>
          <div className="card">
            {sel ? <PanelDocumento documentoId={sel} onCambio={cargar} vistaPreviaInicial /> : <p className="subtitle">Seleccione un documento.</p>}
          </div>
        </div>
      )}
    </>
  );
}
