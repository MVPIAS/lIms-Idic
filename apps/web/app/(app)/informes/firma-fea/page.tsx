"use client";

/**
 * Pendientes de firma FEA · documentos emitidos (oficiales) que aún no tienen
 * su versión firmada con la Firma Electrónica Avanzada del Estado. Por defecto,
 * los que firmó el usuario; la jefatura con permiso ve los de su alcance.
 * Se descarga el PDF, se firma con FirmaGob fuera del LIMS y se sube aquí.
 * Reglas: docs/FLUJO_FEA_DOCUMENTOS.md.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { fecha } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/ui/PageHeader";
import PanelFea from "@/components/documentos/PanelFea";
import type { OrigenFea } from "@/lib/fea";

interface Fila {
  origen: OrigenFea;
  id: string;
  numero: string;
  tipoDocumento: string;
  tipoDocumentoNombre: string;
  oficialAt: string | null;
  entregadoAt: string | null;
  otId: string | null;
  otCodigo: string | null;
  cliente: string | null;
  laboratorio: string | null;
  firmante: string | null;
  exigeFea: boolean;
}

export default function FirmaFeaPage() {
  const [filas, setFilas] = useState<Fila[]>([]);
  const [sel, setSel] = useState<Fila | null>(null);
  const [todos, setTodos] = useState(false);
  const [soloExigidos, setSoloExigidos] = useState(false);
  const [puedeVerTodos, setPuedeVerTodos] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    setError("");
    setCargando(true);
    try {
      const q = new URLSearchParams();
      if (todos) q.set("todos", "1");
      if (soloExigidos) q.set("soloExigidos", "1");
      const r = await api.getRaw<{ data: Fila[]; puedeVerTodos: boolean }>(`fea/pendientes${q.toString() ? `?${q}` : ""}`);
      setFilas(r.data);
      setPuedeVerTodos(r.puedeVerTodos);
      setSel((s) => (s && r.data.some((x) => x.id === s.id) ? s : r.data[0] ?? null));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, [todos, soloExigidos]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const enlace = (f: Fila) => (f.origen === "metrologia" ? `/metrologia/${f.id}` : f.otId ? `/ot/${f.otId}` : null);

  return (
    <>
      <PageHeader
        titulo="Pendientes de firma FEA"
        icono="🔏"
        subtitulo="Documentos emitidos que aún no tienen la firma electrónica avanzada del Estado. Descargue el PDF, fírmelo con FirmaGob (o su token) y súbalo: desde ahí el cliente recibe la versión firmada."
        migas={[{ label: "Laboratorio" }, { label: "Pendientes de firma FEA" }]}
        acciones={<button className="btn outline" onClick={cargar}>Actualizar</button>}
      />
      <div className="toolbar" style={{ gap: 16, flexWrap: "wrap" }}>
        {puedeVerTodos && (
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            <input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} />
            Todos los de mi alcance (no solo los que firmé)
          </label>
        )}
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
          <input type="checkbox" checked={soloExigidos} onChange={(e) => setSoloExigidos(e.target.checked)} />
          Solo los que exigen FEA antes de entregar
        </label>
      </div>
      {error && <div className="alert warn">{error}</div>}

      {!cargando && !filas.length ? (
        <div className="card">
          <EmptyState
            icono="✅"
            titulo="No tiene documentos pendientes de firma FEA"
            texto="Cuando un documento que usted firmó quede oficial, aparecerá aquí hasta que suba su versión firmada con FirmaGob."
          />
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 340px) 1fr", gap: 14, alignItems: "start" }}>
          <div className="card" style={{ padding: 0 }}>
            {cargando && <p className="subtitle" style={{ padding: 12 }}>Cargando…</p>}
            {filas.map((f) => (
              <button
                key={`${f.origen}-${f.id}`}
                onClick={() => setSel(f)}
                style={{
                  display: "block", width: "100%", textAlign: "left", padding: "10px 12px", border: 0,
                  borderBottom: "1px solid var(--line)", cursor: "pointer",
                  background: sel?.id === f.id ? "#eef5fb" : "transparent",
                }}
              >
                <div>
                  <span className="codigo">{f.numero}</span>{" "}
                  {f.exigeFea && <span className="pill amber">Exige FEA</span>}{" "}
                  {f.entregadoAt && <span className="pill gray">Ya entregado</span>}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3 }}>
                  {f.tipoDocumentoNombre}{f.laboratorio ? ` · ${f.laboratorio}` : ""}
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>
                  {f.otCodigo ? `OT ${f.otCodigo}` : "Sin OT"}{f.cliente ? ` · ${f.cliente}` : ""} · oficial {fecha(f.oficialAt)}
                  {f.firmante ? ` · firmó ${f.firmante}` : ""}
                </div>
              </button>
            ))}
          </div>
          <div className="card">
            {sel ? (
              <>
                <div style={{ fontSize: 15, fontWeight: 700 }}>
                  <span className="codigo">{sel.numero}</span>{" "}
                  <span style={{ fontWeight: 400, fontSize: 12.5, color: "var(--muted)" }}>{sel.tipoDocumentoNombre}</span>
                </div>
                {enlace(sel) && (
                  <div className="subtitle" style={{ margin: "4px 0 0" }}>
                    <Link href={enlace(sel) as any} style={{ color: "var(--accent)" }}>
                      {sel.origen === "metrologia" ? "Abrir la ficha de la calibración" : `Abrir la OT ${sel.otCodigo}`}
                    </Link>
                  </div>
                )}
                <PanelFea key={`${sel.origen}-${sel.id}`} origen={sel.origen} documentoId={sel.id} onCambio={cargar} />
              </>
            ) : (
              <p className="subtitle">Seleccione un documento.</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
