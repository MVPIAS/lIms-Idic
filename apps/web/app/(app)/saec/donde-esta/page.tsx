"use client";

/**
 * /saec/donde-esta · «¿Dónde está la evidencia?»: se escribe la serie del arma,
 * el código de la evidencia (o se lee su código de barras) o el Nº / UUID que
 * trae un hit de IBIS, y se ve al instante dónde está guardada cada evidencia
 * (ubicación en texto: almacén · estante · línea · caja), su estado y, si está
 * prestada, a quién y hasta cuándo. Datos: GET /evidencias/donde-esta?q=…
 */
import Link from "next/link";
import { useState } from "react";
import RequierePermiso from "@/components/RequierePermiso";
import { llamar } from "@/lib/laboratorio";
import { abrirDocumento } from "@/lib/bpchProcesos";
import { fechaHora } from "@/lib/format";

interface Prestamo {
  codigo: string;
  organismo: string | null;
  solicitante: string | null;
  receptor: string | null;
  entregado: string | null;
  devolucion: string | null;
  estado: string;
}
interface Fila {
  id: string;
  codigo: string;
  tipo: string;
  exhibit_number: string | null;
  uuid_ibis: string | null;
  estado: string;
  ubicacion: string | null;
  hit_count: number | null;
  fecha_disparo: string | null;
  ot_codigo: string | null;
  ot_id: string | null;
  serie: string | null;
  marca: string | null;
  modelo: string | null;
  calibre: string | null;
  prestamo: Prestamo | null;
}

const TIPO: Record<string, string> = { vainilla: "Vaina", proyectil: "Proyectil", arma: "Arma", explosivo: "Explosivo", otro: "Otro" };
const ESTADO_PRESTAMO: Record<string, string> = { solicitado: "Solicitada", aprobado: "Aprobada, por entregar", entregado: "Prestada" };

export default function DondeEstaPage() {
  return (
    <RequierePermiso perm="evidencia.ver" titulo="¿Dónde está la evidencia?">
      <DondeEsta />
    </RequierePermiso>
  );
}

function DondeEsta() {
  const [q, setQ] = useState("");
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);

  async function buscar(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setBuscando(true);
    try {
      const r = await llamar<{ data: Fila[] }>("GET", `/evidencias/donde-esta?q=${encodeURIComponent(q.trim())}`);
      setFilas(r.data);
    } catch (err: any) {
      setError(err?.message ?? "No se pudo buscar.");
      setFilas(null);
    } finally {
      setBuscando(false);
    }
  }

  return (
    <div style={{ maxWidth: 1000 }}>
      <h1 className="page">📍 ¿Dónde está la evidencia?</h1>
      <p className="subtitle">
        Escriba la serie del arma, el código de la evidencia (o léalo con el lector de código de barras) o el número que trae un hit de IBIS.
        Verá dónde está guardada cada evidencia y si está prestada.
      </p>

      <form className="toolbar" onSubmit={buscar}>
        <input
          autoFocus
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Serie del arma, EV-2026-…, TF-… o UUID de IBIS"
          style={{ flex: 1, minWidth: 260, fontSize: 14 }}
          aria-label="Buscar evidencia"
        />
        <button className="btn primary sm" type="submit" disabled={buscando || q.trim().length < 2}>
          {buscando ? "Buscando…" : "Buscar"}
        </button>
        {filas && filas.length > 0 ? (
          <button
            type="button"
            className="btn outline sm"
            onClick={() => abrirDocumento(`/evidencias/fichas?ids=${filas.map((f) => f.id).join(",")}`).catch((e) => setError(e.message))}
          >
            Imprimir fichas
          </button>
        ) : null}
      </form>

      {error ? <div className="alert warn">{error}</div> : null}
      {filas && filas.length === 0 ? <div className="card">No se encontró ninguna evidencia para «{q.trim()}».</div> : null}

      <div style={{ display: "grid", gap: 10 }}>
        {(filas ?? []).map((f) => {
          const prestada = f.prestamo && f.prestamo.estado === "entregado";
          return (
            <div key={f.id} className="card" style={{ margin: 0, borderLeft: `4px solid ${prestada ? "var(--accent)" : "var(--primary)"}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
                <div>
                  <Link href={`/saec/evidencias/${f.id}`} style={{ fontWeight: 700 }}>
                    {f.codigo}
                  </Link>{" "}
                  · {TIPO[f.tipo] ?? f.tipo}
                  {f.exhibit_number ? <span style={{ color: "var(--muted)" }}> · IBIS {f.exhibit_number}</span> : null}
                </div>
                <span className="pill">{(f.hit_count ?? 0) > 0 ? `Con hit (${f.hit_count})` : "Sin hit"}</span>
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, margin: "8px 0 4px" }}>
                {prestada ? "Prestada" : f.ubicacion?.trim() || "Sin ubicación asignada"}
              </div>
              {f.prestamo ? (
                <div style={{ fontSize: 13, marginBottom: 4 }}>
                  {ESTADO_PRESTAMO[f.prestamo.estado] ?? f.prestamo.estado}
                  {f.prestamo.organismo ? ` a ${f.prestamo.organismo}` : ""}
                  {f.prestamo.receptor || f.prestamo.solicitante ? ` (${f.prestamo.receptor ?? f.prestamo.solicitante})` : ""}
                  {f.prestamo.entregado ? ` · desde ${fechaHora(f.prestamo.entregado)}` : ""}
                  {f.prestamo.devolucion ? ` · devolución prevista ${String(f.prestamo.devolucion).slice(0, 10)}` : ""} · solicitud {f.prestamo.codigo}
                  {prestada && f.ubicacion ? <span style={{ color: "var(--muted)" }}> · su lugar: {f.ubicacion}</span> : null}
                </div>
              ) : null}
              <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
                Arma {f.serie ?? "sin serie"}
                {f.marca ? ` · ${f.marca}` : ""}
                {f.modelo ? ` ${f.modelo}` : ""}
                {f.calibre ? ` · ${f.calibre}` : ""}
                {f.ot_codigo ? (
                  <>
                    {" "}· OT <Link href={`/saec/ot/${f.ot_id}`}>{f.ot_codigo}</Link>
                  </>
                ) : null}
                {f.fecha_disparo ? ` · disparo ${fechaHora(f.fecha_disparo)}` : ""}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
