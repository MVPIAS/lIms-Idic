"use client";

/**
 * Estado por laboratorio de las muestras de la OT (EP-02 4.2 «Consolidar la
 * muestra», BL-215, frente r4c). Solo se muestra si la OT tiene ensayos en más
 * de un laboratorio (muestra compartida u orden interna): cuántos ensayos de
 * cada muestra están por capturar, en revisión y aprobados en cada laboratorio.
 */
import { useEffect, useState } from "react";
import { llamar } from "@/lib/laboratorio";

export default function EstadoPorLaboratorio({ otId, version = 0 }: { otId: string; version?: number }) {
  const [d, setD] = useState<any>(null);
  useEffect(() => {
    llamar("GET", `/ot/${otId}/estado-laboratorios`).then(setD).catch(() => setD(null));
  }, [otId, version]);
  if (!d?.compartida) return null;
  return (
    <section className="card" style={{ padding: 10, margin: "0 0 12px" }} aria-labelledby="tit-estado-lab">
      <h3 id="tit-estado-lab" style={{ fontSize: 13, margin: "0 0 6px" }}>
        Estado por laboratorio <span style={{ fontWeight: 400, color: "var(--muted)" }}>· {d.laboratorios.join(", ")}</span>
      </h3>
      <div style={{ overflowX: "auto" }}>
        <table className="data">
          <thead><tr><th>Muestra</th><th>Laboratorio</th><th className="num">Ensayos</th><th className="num">Por capturar</th><th className="num">En revisión</th><th className="num">Aprobados</th><th>Estado</th></tr></thead>
          <tbody>
            {d.filas.map((f: any) => {
              const listo = f.aprobados === f.total;
              return (
                <tr key={`${f.muestraId}-${f.laboratorio}`}>
                  <td className="codigo">{f.muestra}</td>
                  <td title={f.laboratorioNombre ?? undefined}>{f.laboratorio ?? "—"}{f.derivado ? <small style={{ color: "var(--muted)" }}> · orden interna</small> : null}</td>
                  <td className="num">{f.total}</td>
                  <td className="num">{f.porCapturar}</td>
                  <td className="num">{f.enRevision}</td>
                  <td className="num">{f.aprobados}</td>
                  <td>
                    <span className={`pill ${listo ? "green" : f.porCapturar ? "amber" : "blue"}`}>{listo ? "Terminado" : f.porCapturar ? "En análisis" : "En revisión"}</span>
                    {f.noCumple > 0 && <span className="pill red" style={{ marginLeft: 4 }}>{f.noCumple} no cumple</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
