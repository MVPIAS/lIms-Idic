"use client";

/**
 * BPCH · Clasificación de sustancias (series de prueba ONU: SAC-PG01-IT21/IT22/IT23).
 * Lista con búsqueda y estado; el alta y la ficha están en /bpch/clasificaciones/[id].
 * API: GET /bpch/clasificaciones?q=&estado=
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import DataTable, { type DataColumn } from "@/components/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { usePermisos } from "@/lib/permisos";
import { llamar, qs } from "@/lib/laboratorio";
import { fechaHora } from "@/lib/format";
import { ESTADO_CLASIFICACION } from "@/lib/bpchProcesos";

export default function ClasificacionesPage() {
  const router = useRouter();
  const { puede } = usePermisos();
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState("");
  const [filas, setFilas] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const r = await llamar<{ data: any[] }>("GET", `/bpch/clasificaciones${qs({ q: q.trim(), estado })}`);
      setFilas(r.data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, [q, estado]);

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  const columnas: DataColumn[] = [
    {
      key: "codigo",
      label: "Código",
      render: (r) => (
        <Link href={`/bpch/clasificaciones/${r.id}` as any} className="codigo" style={{ textDecoration: "underline" }}>
          {r.codigo}{r.version > 1 ? `-V${r.version}` : ""}
        </Link>
      ),
      value: (r) => r.codigo,
    },
    { key: "sustancia", label: "Sustancia / producto" },
    { key: "fabricante", label: "Fabricante / origen", value: (r) => r.cliente?.razonSocial ?? "" },
    { key: "resumen", label: "Clasificación" },
    {
      key: "estado",
      label: "Estado",
      render: (r) => <span className={`pill ${ESTADO_CLASIFICACION[r.estado]?.pill ?? "gray"}`}>{ESTADO_CLASIFICACION[r.estado]?.texto ?? r.estado}</span>,
      value: (r) => ESTADO_CLASIFICACION[r.estado]?.texto ?? r.estado,
    },
    { key: "clasifico", label: "Clasificó", value: (r) => (r.clasificadoPor ? `${r.clasificadoPor.nombre} · ${fechaHora(r.clasificadoAt)}` : "—") },
    { key: "aprobo", label: "Aprobó", value: (r) => (r.aprobadoPor ? `${r.aprobadoPor.nombre} · ${fechaHora(r.aprobadoAt)}` : "—") },
  ];

  return (
    <div>
      <PageHeader
        icono="⚛"
        titulo="Clasificación de sustancias"
        subtitulo="Series de prueba ONU (barrera interpuesta, Koenen y TPT): pruebas, decisión de quien clasifica, aprobación y documento sellado. Las clasificaciones aprobadas se usan en Producción Nacional y Prototipos."
        migas={[{ label: "BPCH" }, { label: "Clasificación de sustancias" }]}
        acciones={
          puede("bpch.clasificacion.registrar") ? (
            <Link href={"/bpch/clasificaciones/nueva" as any} className="btn primary sm">＋ Nueva sustancia</Link>
          ) : null
        }
      />
      {error && <div className="alert warn" role="alert">{error}</div>}
      <form className="toolbar" style={{ flexWrap: "wrap", gap: 6 }} onSubmit={(e) => { e.preventDefault(); cargar(); }}>
        <input aria-label="Buscar" placeholder="Sustancia, código, Nº ONU o fabricante" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
        <select aria-label="Estado" value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          {Object.entries(ESTADO_CLASIFICACION).map(([k, v]) => <option key={k} value={k}>{v.texto}</option>)}
        </select>
        <button className="btn primary sm" type="submit" disabled={cargando}>{cargando ? "Buscando…" : "Buscar"}</button>
      </form>
      <div className="card card--table">
        <DataTable
          columns={columnas}
          rows={filas}
          loading={cargando}
          onRowClick={(r) => router.push(`/bpch/clasificaciones/${r.id}` as any)}
          vacio="No hay clasificaciones con estos filtros. Registre una sustancia con «Nueva sustancia»."
        />
      </div>
    </div>
  );
}
