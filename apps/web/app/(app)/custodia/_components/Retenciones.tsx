"use client";

/**
 * Testigos, muestras en custodia y contramuestras (EP-01 §6.4, EP-03 §6.3):
 * hasta cuándo se retiene cada una y el aviso cuando el plazo se cumple. Un
 * testigo o una contramuestra no se pueden destruir antes de su plazo, y una
 * muestra en custodia se devuelve (lo comprueba el servidor al registrar el
 * traspaso). API: GET /recepcion/retenciones.
 */
import { useEffect, useState } from "react";
import { llamar } from "@/lib/laboratorio";
import { NOMBRE_CLASE, fechaDma, type ClaseCustodia } from "@/lib/recepcion";

interface Retencion {
  id: string; codigo: string; nombre: string | null; numeroInterno: string | null; claseCustodia: ClaseCustodia;
  retenerHasta: string | null; ubicacion: string | null; otId: string; otCodigo: string; laboratorio: string | null;
  disposicion: string | null; estado: "dispuesta" | "sin_plazo" | "vigente" | "por_cumplir" | "cumplida";
}

const ESTADO: Record<Retencion["estado"], { texto: string; pill: string }> = {
  vigente: { texto: "En retención", pill: "blue" },
  por_cumplir: { texto: "Plazo por cumplirse", pill: "amber" },
  cumplida: { texto: "Plazo cumplido · puede destruirse", pill: "green" },
  dispuesta: { texto: "Dispuesta", pill: "gray" },
  sin_plazo: { texto: "Se devuelve al cliente", pill: "teal" },
};

export default function Retenciones({ onVerCadena }: { onVerCadena: (muestraId: string) => void }) {
  const [filas, setFilas] = useState<Retencion[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    llamar<{ data: Retencion[] }>("GET", "/recepcion/retenciones")
      .then((r) => setFilas(r.data))
      .catch((e) => { setError(e.message); setFilas([]); });
  }, []);

  if (filas === null) return <p className="subtitle">Cargando testigos y contramuestras…</p>;
  const cumplidas = filas.filter((f) => f.estado === "cumplida").length;
  const porCumplir = filas.filter((f) => f.estado === "por_cumplir").length;
  return (
    <section className="card" aria-labelledby="retenciones-titulo" style={{ marginBottom: 14 }}>
      <h2 id="retenciones-titulo" style={{ fontSize: 15, marginTop: 0 }}>Testigos, muestras en custodia y contramuestras</h2>
      {error && <div className="alert warn">{error}</div>}
      {filas.length === 0 ? (
        <p className="subtitle" style={{ margin: 0 }}>
          No hay muestras retenidas en sus laboratorios. Se registran al recepcionar con el destino «Testigo», «En custodia» o «Contramuestra».
        </p>
      ) : (
        <>
          {(cumplidas > 0 || porCumplir > 0) && (
            <div className="alert info" style={{ marginTop: 0 }}>
              {cumplidas > 0 && <>{cumplidas} muestra(s) con el plazo de retención cumplido: ya puede registrar su destrucción. </>}
              {porCumplir > 0 && <>{porCumplir} muestra(s) cumplen su plazo esta semana.</>}
            </div>
          )}
          <div style={{ overflowX: "auto" }}>
            <table className="data">
              <thead>
                <tr><th>Muestra</th><th>OT</th><th>Destino</th><th>Ubicación</th><th>Retener hasta</th><th>Estado</th><th aria-label="Acciones"></th></tr>
              </thead>
              <tbody>
                {filas.map((f) => {
                  const e = ESTADO[f.estado];
                  return (
                    <tr key={f.id}>
                      <td>
                        <span className="codigo">{f.codigo}</span>
                        {f.numeroInterno && <span className="pill blue" style={{ marginLeft: 6 }}>Nº {f.numeroInterno}</span>}
                        {f.nombre && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{f.nombre}</div>}
                      </td>
                      <td>{f.otCodigo}{f.laboratorio ? <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{f.laboratorio}</div> : null}</td>
                      <td>{NOMBRE_CLASE[f.claseCustodia] ?? f.claseCustodia}</td>
                      <td>{f.ubicacion ?? "—"}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{f.retenerHasta ? fechaDma(f.retenerHasta) : "—"}</td>
                      <td><span className={`pill ${e.pill}`}>{f.disposicion === "devolucion" ? "Devuelta" : f.disposicion === "destruccion" ? "Destruida" : e.texto}</span></td>
                      <td><button type="button" className="btn outline sm" onClick={() => onVerCadena(f.id)}>Ver cadena</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
