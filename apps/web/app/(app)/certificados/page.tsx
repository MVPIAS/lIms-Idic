"use client";

/**
 * Informes y certificados emitidos · estado del circuito de firma y entrega.
 *
 * Ya no se crean ni editan a mano (el CRUD genérico quedó de solo lectura): se
 * emiten desde «Emitir informe», se firman según la matriz de firmas y aquí se
 * consultan, se entregan, se envían por correo, se anulan con motivo y se
 * reemiten como nueva versión. Reglas: docs/FLUJO_FIRMA_CIERRE.md.
 */
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { fecha } from "@/lib/format";
import DataTable, { type DataColumn } from "@/components/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { ESTADO_DOC, textoMedio } from "@/lib/documentos";
import PanelDocumento from "@/components/documentos/PanelDocumento";
import Modal from "@/components/documentos/Modal";
import { usePermisos } from "@/lib/permisos";
import { textoModalidad } from "@/lib/informes";

const FILTROS: { valor: string; texto: string }[] = [
  { valor: "", texto: "Todos" },
  { valor: "en_firma", texto: "En firma" },
  { valor: "por_entregar", texto: "Oficiales por entregar" },
  { valor: "oficial", texto: "Oficiales" },
  { valor: "devuelto", texto: "Devueltos" },
  { valor: "anulado", texto: "Anulados" },
];

function CertificadosContenido() {
  const params = useSearchParams();
  const router = useRouter();
  const { puede } = usePermisos();
  const estado = params.get("estado") ?? "";
  const [filas, setFilas] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const r: any = await api.getRaw(`informes/documentos?limit=200${estado ? `&estado=${estado}` : ""}`);
      setFilas(r.data ?? []);
      setTotal(r.meta?.total ?? 0);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, [estado]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const columnas: DataColumn[] = [
    { key: "numero", label: "Número", render: (c) => <span className="codigo">{c.numero}</span> },
    { key: "tipo", label: "Tipo", value: (c) => c.plantilla?.nombre ?? c.tipo ?? "", render: (c) => c.plantilla?.nombre ?? c.tipo ?? "—" },
    {
      key: "ot", label: "OT · Cliente", value: (c) => [c.ot?.codigo, c.ot?.cliente?.razonSocial].filter(Boolean).join(" · "),
      render: (c) => (
        <span>
          {c.ot ? <Link href={`/ot/${c.ot.id}` as any} className="codigo" onClick={(e) => e.stopPropagation()}>{c.ot.codigo}</Link> : "—"}
          {c.ot?.cliente?.razonSocial ? <small style={{ display: "block", color: "var(--muted)" }}>{c.ot.cliente.razonSocial}</small> : null}
        </span>
      ),
    },
    // Cumplimiento (con requisito y veredicto) o solo resultados; «—» en los anteriores a esta distinción.
    { key: "modalidad", label: "Informe", value: (c) => textoModalidad(c.modalidad, c.tipoDocumento) ?? "", render: (c) => textoModalidad(c.modalidad, c.tipoDocumento) ?? "—" },
    { key: "fecha", label: "Emitido", value: (c) => c.fecha ?? "", render: (c) => fecha(c.fecha) },
    {
      key: "estado", label: "Estado", value: (c) => ESTADO_DOC[c.estado]?.texto ?? c.estado,
      render: (c) => {
        const e = ESTADO_DOC[c.estado] ?? { texto: c.estado, pill: "gray" };
        const pend = c.pendienteDe?.[0];
        return (
          <span>
            <span className={`pill ${e.pill}`}>{e.texto}</span>
            {c.firmasTotal ? <small style={{ marginLeft: 6, color: "var(--muted)" }}>{c.firmasHechas}/{c.firmasTotal} firmas</small> : null}
            {pend && <small style={{ display: "block", color: "var(--muted)" }}>Le toca: {pend.rol} · {pend.responsables?.join(" / ")}</small>}
            {c.estado === "devuelto" && c.devueltoMotivo && <small style={{ display: "block", color: "var(--muted)" }}>{c.devueltoMotivo}</small>}
          </span>
        );
      },
    },
    {
      key: "entrega", label: "Entrega", value: (c) => c.entregadoAt ?? "",
      render: (c) =>
        c.entregadoAt ? (
          <span style={{ fontSize: 11.5 }}>{fecha(c.entregadoAt)} · {textoMedio(c.entregaMedio)}<small style={{ display: "block", color: "var(--muted)" }}>{c.entregaDestinatario}</small></span>
        ) : c.estado === "oficial" || c.estado === "emitido" ? (
          <span className="pill amber">Sin entregar</span>
        ) : (
          "—"
        ),
    },
  ];

  return (
    <>
      <PageHeader
        titulo="Informes y certificados"
        icono="📜"
        subtitulo="Documentos emitidos por OT con su estado de firma y de entrega. Un documento solo es oficial cuando lo firman todos los responsables de la matriz de firmas."
        migas={[{ label: "Laboratorio" }, { label: "Informes y certificados" }]}
        acciones={puede("certificado.emitir") ? <Link href={"/informes" as any} className="btn primary">Emitir informe</Link> : null}
      />
      {error && <div className="alert warn">{error}</div>}

      <div className="tabs" style={{ marginBottom: 10 }}>
        {FILTROS.map((f) => (
          <button
            key={f.valor}
            className={`tab${estado === f.valor ? " active" : ""}`}
            onClick={() => router.replace((f.valor ? `/certificados?estado=${f.valor}` : "/certificados") as any)}
          >
            {f.texto}
          </button>
        ))}
        <span style={{ marginLeft: "auto", alignSelf: "center", fontSize: 12, color: "var(--muted)" }}>{total} documentos</span>
      </div>

      <DataTable
        columns={columnas}
        rows={filas}
        loading={cargando}
        searchKeys={["numero", "ot", "tipo"]}
        onRowClick={(c) => setAbierto(c.id)}
        acciones={(c) => <button className="btn outline sm" onClick={(e) => { e.stopPropagation(); setAbierto(c.id); }}>Abrir</button>}
        vacio={<>No hay documentos con este filtro.</>}
      />

      {abierto && (
        <Modal titulo="Documento" ancho={980} onCerrar={() => setAbierto(null)}>
          <PanelDocumento documentoId={abierto} onCambio={cargar} />
        </Modal>
      )}
    </>
  );
}

export default function CertificadosPage() {
  return (
    <Suspense fallback={<p className="subtitle">Cargando…</p>}>
      <CertificadosContenido />
    </Suspense>
  );
}
