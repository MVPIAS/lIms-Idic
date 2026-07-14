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
  const tabBtn = (t: typeof tab, l: string) =>
    <button onClick={() => setTab(t)} className={`px-3 py-2 text-sm border-b-2 ${tab === t ? "border-accent text-primary font-semibold" : "border-transparent text-slate-500 hover:text-slate-700"}`}>{l}</button>;

  return (
    <div className="max-w-5xl">
      <Link href={"/ot" as any} className="text-sm text-accent hover:underline">← Órdenes de Trabajo</Link>
      {error && <div className="my-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{error}</div>}

      <div className="flex items-center justify-between mt-2 mb-4">
        <div>
          <h1 className="text-xl font-bold">Expediente {ot?.codigo ?? ot?.numero ?? (typeof id === "string" ? id.slice(0, 8) : "")}</h1>
          <p className="text-sm text-slate-500">{ot?.cliente?.razonSocial ?? "—"}</p>
        </div>
        <span className="text-[12px] px-3 py-1 rounded-full bg-accent/10 text-accent font-semibold">{ot?.estado ?? "—"}</span>
      </div>

      {/* Stepper de 14 fases */}
      <div className="bg-white border rounded-lg shadow-sm p-4 mb-4 overflow-x-auto">
        <div className="flex items-center gap-1 min-w-max">
          {FASES.map((f, i) => (
            <div key={f} className="flex items-center">
              <div className="flex flex-col items-center w-24 text-center">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold ${i < avance ? "bg-success text-white" : i === avance ? "bg-accent text-white" : "bg-slate-200 text-slate-500"}`}>{i + 1}</div>
                <div className={`text-[10px] mt-1 leading-tight ${i <= avance ? "text-slate-700" : "text-slate-400"}`}>{f}</div>
              </div>
              {i < FASES.length - 1 && <div className={`h-0.5 w-3 ${i < avance ? "bg-success" : "bg-slate-200"}`} />}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border rounded-lg shadow-sm">
        <div className="border-b px-3 flex gap-1">
          {tabBtn("cabecera", "Cabecera")}
          {tabBtn("muestras", `Muestras (${muestras.length})`)}
          {tabBtn("resultados", "Resultados")}
          {tabBtn("informe", "Informe")}
        </div>
        <div className="p-4 text-sm">
          {tab === "cabecera" && (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2">
              <div><dt className="text-[11px] uppercase text-slate-500 font-semibold">Código OT</dt><dd className="font-mono">{ot?.codigo ?? "—"}</dd></div>
              <div><dt className="text-[11px] uppercase text-slate-500 font-semibold">Cliente</dt><dd>{ot?.cliente?.razonSocial ?? "—"}</dd></div>
              <div><dt className="text-[11px] uppercase text-slate-500 font-semibold">RUT cliente</dt><dd>{ot?.cliente?.rut ?? "—"}</dd></div>
              <div><dt className="text-[11px] uppercase text-slate-500 font-semibold">Estado</dt><dd>{ot?.estado ?? "—"}</dd></div>
              <div><dt className="text-[11px] uppercase text-slate-500 font-semibold">Prioridad</dt><dd>{ot?.prioridad ?? "normal"}</dd></div>
              <div><dt className="text-[11px] uppercase text-slate-500 font-semibold">Ingreso</dt><dd>{ot?.fechaIngreso ? String(ot.fechaIngreso).slice(0, 10) : ot?.createdAt ? String(ot.createdAt).slice(0, 10) : "—"}</dd></div>
            </dl>
          )}
          {tab === "muestras" && (
            muestras.length ? (
              <table className="w-full">
                <thead><tr className="text-left text-[11px] uppercase text-slate-500 border-b"><th className="py-1">Código</th><th className="py-1">Muestra</th><th className="py-1">Estado</th></tr></thead>
                <tbody>{muestras.map((m) => <tr key={m.id} className="border-b border-slate-100"><td className="py-1 font-mono">{m.codigo}</td><td className="py-1">{m.nombre ?? "—"}</td><td className="py-1">{m.estado}</td></tr>)}</tbody>
              </table>
            ) : <p className="text-slate-400">Sin muestras asociadas a esta OT.</p>
          )}
          {tab === "resultados" && (
            <p className="text-slate-500">Captura de réplicas y estadística en <Link href={"/captura" as any} className="text-accent hover:underline">Captura de resultados</Link>. Cada resultado calcula promedio/DE/CV y veredicto contra el límite del producto.</p>
          )}
          {tab === "informe" && (
            <p className="text-slate-500">El informe/certificado se genera con las plantillas del repositorio (autorelleno con datos de la OT, cliente y resultados), con HASH y código de verificación. Ver <Link href={"/plantillas" as any} className="text-accent hover:underline">Plantillas de informe</Link>.</p>
          )}
        </div>
      </div>
    </div>
  );
}
