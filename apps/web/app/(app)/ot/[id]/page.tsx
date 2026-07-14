"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("lims_token")}` });

const FASES = [
  "Recepción", "Registro", "Asignación", "Preparación", "Análisis", "Captura RN",
  "Cálculo", "Validación técnica", "Revisión", "Aprobación", "Emisión informe",
  "Firma", "Entrega", "Cierre",
];

// mapea el estado de la OT a un índice de avance aproximado en el stepper
const idxEstado: Record<string, number> = {
  borrador: 0, recibida: 1, en_proceso: 4, en_analisis: 4, resultados: 6,
  validacion: 8, aprobada: 9, informe: 10, finalizada: 12, cerrada: 13,
};

export default function ExpedientePage() {
  const { id } = useParams<{ id: string }>();
  const [ot, setOt] = useState<any>(null);
  const [muestras, setMuestras] = useState<any[]>([]);
  const [tab, setTab] = useState<"cabecera" | "muestras" | "resultados" | "informe">("cabecera");
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const o = await fetch(`${API}/ot/${id}`, { headers: auth() }).then((x) => x.json());
        setOt(o);
        const m = await fetch(`${API}/muestras?limit=200`, { headers: auth() }).then((x) => x.json());
        setMuestras((m.data ?? []).filter((x: any) => x.otId === id));
      } catch (e: any) { setError(e.message); }
    })();
  }, [id]);

  const avance = ot ? idxEstado[ot.estado] ?? 0 : 0;
  const codOt = ot?.codigo ?? ot?.numero ?? (typeof id === "string" ? id.slice(0, 8) : "");
  const tabBtn = (t: typeof tab, l: string) =>
    <button onClick={() => setTab(t)} className={`tab${tab === t ? " active" : ""}`}>{l}</button>;

  return (
    <div>
      <Link href={"/ot" as any} className="subtitle" style={{ display: "inline-block", color: "var(--accent)", textDecoration: "none" }}>← Expedientes / OT</Link>
      {error && <div className="alert warn">{error}</div>}

      <div className="exphead">
        <div className="id">🗂 {codOt}</div>
        <div className="meta">
          Cliente: <b>{ot?.cliente?.razonSocial ?? "—"}</b>
          {ot?.cliente?.rut ? <> ({ot.cliente.rut})</> : null} · Estado: <b>{ot?.estado ?? "—"}</b> · Prioridad: <b>{ot?.prioridad ?? "normal"}</b>
        </div>
      </div>

      <div className="expgrid">
        {/* Stepper vertical de 14 fases */}
        <div className="stepper">
          {FASES.map((f, i) => {
            const estado = i < avance ? "done" : i === avance ? "now" : "pend";
            return (
              <div key={f} className={`step ${estado === "done" ? "done" : estado === "now" ? "now" : "locked"}`}>
                <div className="dot">{estado === "done" ? "✓" : i + 1}</div>
                <div className="txt">{f}<small>Fase {i + 1}</small></div>
              </div>
            );
          })}
        </div>

        <div className="card" style={{ padding: 0 }}>
          <div className="tabs" style={{ padding: "0 8px" }}>
            {tabBtn("cabecera", "Cabecera")}
            {tabBtn("muestras", `Muestras (${muestras.length})`)}
            {tabBtn("resultados", "Resultados")}
            {tabBtn("informe", "Informe")}
          </div>
          <div style={{ padding: 15 }}>
            {tab === "cabecera" && (
              <div className="form-grid">
                <div className="field readonly"><label>Código OT</label><input value={ot?.codigo ?? "—"} readOnly /></div>
                <div className="field readonly"><label>Cliente</label><input value={ot?.cliente?.razonSocial ?? "—"} readOnly /></div>
                <div className="field readonly"><label>RUT cliente</label><input value={ot?.cliente?.rut ?? "—"} readOnly /></div>
                <div className="field readonly"><label>Estado</label><input value={ot?.estado ?? "—"} readOnly /></div>
                <div className="field readonly"><label>Prioridad</label><input value={ot?.prioridad ?? "normal"} readOnly /></div>
                <div className="field readonly"><label>Ingreso</label><input value={ot?.fechaIngreso ? String(ot.fechaIngreso).slice(0, 10) : ot?.createdAt ? String(ot.createdAt).slice(0, 10) : "—"} readOnly /></div>
              </div>
            )}
            {tab === "muestras" && (
              muestras.length ? (
                <table className="data">
                  <thead><tr><th>Código</th><th>Muestra</th><th>Estado</th></tr></thead>
                  <tbody>{muestras.map((m) => <tr key={m.id}><td><span className="codigo">{m.codigo}</span></td><td>{m.nombre ?? "—"}</td><td><span className="pill gray">{m.estado}</span></td></tr>)}</tbody>
                </table>
              ) : <p className="subtitle" style={{ margin: 0 }}>Sin muestras asociadas a esta OT.</p>
            )}
            {tab === "resultados" && (
              <p className="subtitle" style={{ margin: 0 }}>Captura de réplicas y estadística en <Link href={"/captura" as any} style={{ color: "var(--accent)" }}>Captura de resultados</Link>. Cada resultado calcula promedio/DE/CV y veredicto contra el límite del producto.</p>
            )}
            {tab === "informe" && (
              <p className="subtitle" style={{ margin: 0 }}>El informe/certificado se genera con las plantillas del repositorio (autorelleno con datos de la OT, cliente y resultados), con HASH y código de verificación. Ver <Link href={"/plantillas" as any} style={{ color: "var(--accent)" }}>Plantillas de informe</Link>.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
