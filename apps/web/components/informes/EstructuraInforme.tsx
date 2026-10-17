"use client";

/**
 * Estructura del informe: sección y componente de cada ensayo de la OT, para
 * las plantillas que numeran los resultados (Textil, LCC, IVC):
 * «4.1 Materiales» › «4.1.1 Tela base». El orden decide la posición en el
 * informe. Sin sección, el ensayo va bajo su muestra.
 */
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/feedback";
import { enviarInforme } from "@/lib/informes";
import type { EnsayoOt } from "./FotosInforme";

type Fila = EnsayoOt & { muestraId: string; seccion: string | null; componente: string | null; orden: number | null };

export default function EstructuraInforme({
  otId,
  puedeEditar,
  onCargada,
  onGuardada,
}: {
  otId: string;
  puedeEditar: boolean;
  onCargada?: (filas: EnsayoOt[]) => void;
  onGuardada?: () => void;
}) {
  const [filas, setFilas] = useState<Fila[]>([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [sucio, setSucio] = useState(false);

  async function cargar() {
    setError("");
    try {
      const r = await api.getRaw<{ filas: Fila[] }>(`informes/ot/${otId}/estructura`);
      setFilas(r.filas);
      onCargada?.(r.filas);
      setSucio(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    setCargando(true);
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otId]);

  const secciones = useMemo(() => [...new Set(filas.map((f) => f.seccion).filter(Boolean))] as string[], [filas]);
  const componentes = useMemo(() => [...new Set(filas.map((f) => f.componente).filter(Boolean))] as string[], [filas]);

  const cambiar = (id: string, campo: "seccion" | "componente" | "orden", valor: string) => {
    setSucio(true);
    setFilas((xs) =>
      xs.map((f) =>
        f.resultadoId !== id ? f : { ...f, [campo]: campo === "orden" ? (valor === "" ? null : Math.max(0, Math.trunc(Number(valor)))) : valor },
      ),
    );
  };

  async function guardar() {
    setGuardando(true);
    try {
      await enviar();
      toast.ok("Estructura del informe guardada.");
      await cargar();
      onGuardada?.();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setGuardando(false);
    }
  }

  const enviar = () =>
    enviarInforme(`/informes/ot/${otId}/estructura`, "PUT", {
      filas: filas.map((f) => ({
        resultadoId: f.resultadoId,
        seccion: f.seccion?.trim() || null,
        componente: f.componente?.trim() || null,
        orden: f.orden,
      })),
    });

  if (cargando) return <p className="subtitle">Cargando ensayos…</p>;
  if (error) return <div className="alert warn">{error}</div>;
  if (!filas.length) return <p className="subtitle" style={{ margin: 0 }}>La OT no tiene ensayos registrados.</p>;

  return (
    <div>
      <datalist id="secciones-informe">{secciones.map((s) => <option key={s} value={s} />)}</datalist>
      <datalist id="componentes-informe">{componentes.map((s) => <option key={s} value={s} />)}</datalist>
      <div style={{ overflowX: "auto" }}>
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Punto</th>
              <th scope="col">Muestra</th>
              <th scope="col">Ensayo</th>
              <th scope="col">Sección (p. ej. Materiales)</th>
              <th scope="col">Componente (p. ej. Tela base)</th>
              <th scope="col" style={{ width: 80 }}>Orden</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.resultadoId}>
                <td><span className="tag">{sucio ? "—" : f.punto ?? "—"}</span></td>
                <td className="codigo">{f.muestraCodigo}</td>
                <td>{f.ensayo ?? "Ensayo sin nombre"}</td>
                <td>
                  <input aria-label={`Sección de ${f.ensayo ?? "el ensayo"}`} list="secciones-informe" value={f.seccion ?? ""} maxLength={120}
                    disabled={!puedeEditar} onChange={(e) => cambiar(f.resultadoId, "seccion", e.target.value)} style={{ width: "100%" }} />
                </td>
                <td>
                  <input aria-label={`Componente de ${f.ensayo ?? "el ensayo"}`} list="componentes-informe" value={f.componente ?? ""} maxLength={160}
                    disabled={!puedeEditar} onChange={(e) => cambiar(f.resultadoId, "componente", e.target.value)} style={{ width: "100%" }} />
                </td>
                <td>
                  <input aria-label={`Orden de ${f.ensayo ?? "el ensayo"}`} type="number" min={0} value={f.orden ?? ""}
                    disabled={!puedeEditar} onChange={(e) => cambiar(f.resultadoId, "orden", e.target.value)} style={{ width: 70 }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {puedeEditar && (
        <div className="toolbar" style={{ marginTop: 10, marginBottom: 0 }}>
          <button className="btn primary sm" onClick={guardar} disabled={guardando || !sucio}>
            {guardando ? "Guardando…" : "Guardar estructura"}
          </button>
          <small style={{ color: "var(--muted)" }}>
            {sucio ? "Hay cambios sin guardar: el punto se recalcula al guardar." : "El punto es el que tendrá en un informe numerado desde 4."}
          </small>
        </div>
      )}
    </div>
  );
}
