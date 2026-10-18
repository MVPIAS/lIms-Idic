"use client";

/**
 * BPCH · Prototipos (aprobación de tipo de un elemento nuevo, esquema TIPO).
 * Lista; el ingreso y la ficha están en /bpch/prototipos/[id] (nuevo = alta).
 * API: GET /bpch/prototipos?q=&estado=
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import DataTable, { type DataColumn } from "@/components/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { usePermisos } from "@/lib/permisos";
import { llamar, qs } from "@/lib/laboratorio";
import { fecha, rut } from "@/lib/format";
import { ESTADO_PROTOTIPO } from "@/lib/bpchProcesos";

export default function PrototiposPage() {
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
      setFilas((await llamar<{ data: any[] }>("GET", `/bpch/prototipos${qs({ q: q.trim(), estado })}`)).data);
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
      label: "Prototipo",
      render: (r) => <Link href={`/bpch/prototipos/${r.id}` as any} className="codigo" style={{ textDecoration: "underline" }}>{r.codigo}</Link>,
    },
    { key: "elemento", label: "Elemento" },
    { key: "fabricante", label: "Fabricante", value: (r) => `${r.cliente?.razonSocial ?? ""} ${r.cliente?.rut ? rut(r.cliente.rut) : ""}` },
    { key: "solicitudDgmn", label: "Solicitud DGMN" },
    { key: "ot", label: "OT", value: (r) => r.ot?.codigo ?? "—" },
    {
      key: "etapa",
      label: "Etapa",
      render: (r) => <span className={`pill ${ESTADO_PROTOTIPO[r.estado]?.pill ?? "gray"}`}>{r.etapa}</span>,
      value: (r) => r.etapa,
    },
    { key: "codigoCnc", label: "Código único", value: (r) => r.codigoCnc ?? "—" },
    { key: "createdAt", label: "Ingreso", value: (r) => fecha(r.createdAt) },
  ];

  return (
    <div>
      <PageHeader
        icono="◇"
        titulo="Prototipos"
        subtitulo="Evaluación de un elemento nuevo (no codificado): ingreso y antecedentes, clasificación, pronunciamiento SAC sobre el tamaño de muestra, OT con sus ensayos, dictamen de aprobación o rechazo del tipo y código único."
        migas={[{ label: "BPCH" }, { label: "Prototipos" }]}
        acciones={puede("bpch.prototipo.gestionar") ? <Link href={"/bpch/prototipos/nuevo" as any} className="btn primary sm">＋ Ingresar prototipo</Link> : null}
      />
      {error && <div className="alert warn" role="alert">{error}</div>}
      <form className="toolbar" style={{ flexWrap: "wrap", gap: 6 }} onSubmit={(e) => { e.preventDefault(); cargar(); }}>
        <input aria-label="Buscar" placeholder="Código, elemento, fabricante o solicitud DGMN" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
        <select aria-label="Estado" value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          {Object.entries(ESTADO_PROTOTIPO).map(([k, v]) => <option key={k} value={k}>{v.texto}</option>)}
        </select>
        <button className="btn primary sm" type="submit" disabled={cargando}>{cargando ? "Buscando…" : "Buscar"}</button>
      </form>
      <div className="card card--table">
        <DataTable
          columns={columnas}
          rows={filas}
          loading={cargando}
          onRowClick={(r) => router.push(`/bpch/prototipos/${r.id}` as any)}
          vacio="No hay prototipos con estos filtros. Ingrese uno con «Ingresar prototipo»."
        />
      </div>
    </div>
  );
}
