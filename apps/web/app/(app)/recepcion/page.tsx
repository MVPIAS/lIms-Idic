"use client";

/**
 * Bandeja de entrada del laboratorio (EP-01 §1.2; LME 20-10-2026, pantalla 1):
 * lo que el laboratorio tiene por recepcionar, con su origen —DCO (cotización,
 * disposición), OT interna de otro laboratorio o BPCH (internación, producción
 * nacional…)—, quién lo pide, el producto, el plazo con su semáforo y el botón
 * «Abrir → registrar muestras». Solo lo de los laboratorios del usuario
 * (alcance por asignación). API: GET /recepcion/bandeja (muestra.crear).
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import DataTable, { type DataColumn } from "@/components/DataTable";
import { EmptyState, PageHeader } from "@/components/ui/PageHeader";
import { llamar } from "@/lib/laboratorio";
import { fechaDma } from "@/lib/recepcion";

type Origen = "DCO" | "OT interna" | "BPCH";
type Semaforo = "vencido" | "por_vencer" | "a_tiempo" | "sin_plazo";
interface FilaBandeja {
  tipo: "ot" | "orden_interna";
  id: string;
  origen: Origen;
  ot: { id: string; codigo: string };
  numero: string;
  pide: string;
  laboratorio: string | null;
  producto: string | null;
  plazo: string | null;
  semaforo: Semaforo;
  estado: string;
  muestras: number | null;
  sinNumero: number | null;
  ruta: string;
}

const ORIGEN: Record<Origen, { pill: string; ayuda: string }> = {
  DCO: { pill: "blue", ayuda: "Cotización aceptada, disposición del Director u OT directa" },
  "OT interna": { pill: "amber", ayuda: "Otro laboratorio del IDIC pide un ensayo" },
  BPCH: { pill: "teal", ayuda: "Internación, producción nacional, reinspección o prototipo del Banco de Pruebas" },
};
const SEMAFORO: Record<Semaforo, { texto: string; pill: string; orden: number }> = {
  vencido: { texto: "Vencido", pill: "red", orden: 0 },
  por_vencer: { texto: "Vence pronto", pill: "amber", orden: 1 },
  a_tiempo: { texto: "A tiempo", pill: "green", orden: 2 },
  sin_plazo: { texto: "Sin plazo", pill: "gray", orden: 3 },
};

export default function BandejaRecepcionPage() {
  const [filas, setFilas] = useState<FilaBandeja[] | null>(null);
  const [error, setError] = useState("");
  const [origen, setOrigen] = useState<"" | Origen>("");

  useEffect(() => {
    llamar<{ data: FilaBandeja[] }>("GET", "/recepcion/bandeja")
      .then((r) => setFilas(r.data))
      .catch((e) => { setError(e.message); setFilas([]); });
  }, []);

  const conteo = useMemo(() => {
    const c: Record<string, number> = { DCO: 0, "OT interna": 0, BPCH: 0 };
    for (const f of filas ?? []) c[f.origen]++;
    return c;
  }, [filas]);
  const visibles = (filas ?? []).filter((f) => !origen || f.origen === origen);
  const vencidas = (filas ?? []).filter((f) => f.semaforo === "vencido").length;

  const columnas: DataColumn[] = [
    {
      key: "origen",
      label: "Origen",
      value: (f) => f.origen,
      render: (f: FilaBandeja) => <span className={`pill ${ORIGEN[f.origen].pill}`} title={ORIGEN[f.origen].ayuda}>{f.origen}</span>,
    },
    {
      key: "numero",
      label: "OT",
      value: (f) => f.numero,
      render: (f: FilaBandeja) => (
        <>
          <span className="codigo" style={{ whiteSpace: "nowrap" }}>{f.tipo === "orden_interna" ? f.numero : f.ot.codigo}</span>
          {f.tipo === "orden_interna" && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>de la OT {f.ot.codigo}</div>}
        </>
      ),
    },
    { key: "pide", label: "Cliente / laboratorio que pide", value: (f) => f.pide },
    { key: "producto", label: "Producto", value: (f) => f.producto ?? "", render: (f: FilaBandeja) => f.producto ?? <span style={{ color: "var(--muted)" }}>Se elige al recepcionar</span> },
    { key: "laboratorio", label: "Laboratorio", value: (f) => f.laboratorio ?? "" },
    {
      key: "plazo",
      label: "Plazo",
      value: (f) => SEMAFORO[f.semaforo as Semaforo].orden * 1e9 + (f.plazo ? Date.parse(f.plazo) / 1e5 : 0),
      render: (f: FilaBandeja) => (
        <span style={{ whiteSpace: "nowrap" }}>
          <span className={`pill ${SEMAFORO[f.semaforo].pill}`} aria-label={`Plazo: ${SEMAFORO[f.semaforo].texto}`}>{SEMAFORO[f.semaforo].texto}</span>
          {f.plazo && <span style={{ marginLeft: 6 }}>{fechaDma(f.plazo)}</span>}
        </span>
      ),
    },
    { key: "estado", label: "Por hacer", value: (f) => f.estado },
  ];

  return (
    <div>
      <PageHeader
        icono="📬"
        titulo="Bandeja de entrada del laboratorio"
        subtitulo="Órdenes de trabajo y órdenes internas por recepcionar en sus laboratorios. Ábralas para registrar e identificar las muestras."
        migas={[{ label: "Laboratorio" }, { label: "Bandeja de entrada" }]}
      />
      {error && <div className="alert warn" role="alert">{error}</div>}
      {filas && filas.length > 0 && (
        <div className="toolbar" role="group" aria-label="Filtrar por origen" style={{ flexWrap: "wrap", gap: 6 }}>
          <button type="button" className={`btn sm ${origen === "" ? "primary" : "outline"}`} aria-pressed={origen === ""} onClick={() => setOrigen("")}>
            Todo · {filas.length}
          </button>
          {(Object.keys(ORIGEN) as Origen[]).map((o) => (
            <button key={o} type="button" className={`btn sm ${origen === o ? "primary" : "outline"}`} aria-pressed={origen === o} onClick={() => setOrigen(o)}
              title={ORIGEN[o].ayuda} disabled={!conteo[o]}>
              {o} · {conteo[o]}
            </button>
          ))}
          {vencidas > 0 && <span className="pill red" style={{ marginLeft: "auto" }}>{vencidas} con el plazo vencido</span>}
        </div>
      )}
      {filas === null ? (
        <p className="subtitle">Cargando la bandeja…</p>
      ) : filas.length === 0 ? (
        <EmptyState icono="📭" titulo="No hay nada por recepcionar" texto="Cuando llegue una OT o una orden interna a sus laboratorios aparecerá aquí." />
      ) : (
        <DataTable
          columns={columnas}
          rows={visibles}
          rowKey={(f) => `${f.tipo}-${f.id}`}
          headerSearch
          searchKeys={["numero", "pide", "producto"]}
          acciones={(f: FilaBandeja) => (
            <Link className="btn primary sm" href={f.ruta as any}>
              {f.tipo === "orden_interna" ? "Abrir orden interna →" : "Abrir → registrar muestras"}
            </Link>
          )}
          accionesLabel="Acción"
        />
      )}
    </div>
  );
}
