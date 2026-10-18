"use client";

/**
 * BPCH · Producción Nacional. Dos pestañas:
 *  · O/C operativas anuales, con el avance de su programa de inspecciones.
 *  · RAF DGMN (Resolución de Autorización para Fabricar) de cada fabricante.
 * El alta de la O/C está en /bpch/produccion-nacional/nueva y su ficha
 * (programa, OT, consumo, correlación) en /bpch/produccion-nacional/[id].
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import DataTable, { type DataColumn } from "@/components/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { toast } from "@/components/ui/feedback";
import Modal from "@/components/documentos/Modal";
import SelectorFabricante, { type Fabricante } from "@/components/bpch-procesos/SelectorFabricante";
import { usePermisos } from "@/lib/permisos";
import { llamar, qs } from "@/lib/laboratorio";
import { rut } from "@/lib/format";
import { ESTADO_OC, dia } from "@/lib/bpchProcesos";

type Raf = any;

export default function ProduccionNacionalPage() {
  const router = useRouter();
  const { puede } = usePermisos();
  const [tab, setTab] = useState<"oc" | "raf">("oc");
  const [anio, setAnio] = useState(String(new Date().getFullYear()));
  const [estado, setEstado] = useState("");
  const [q, setQ] = useState("");
  const [ocs, setOcs] = useState<any[]>([]);
  const [rafs, setRafs] = useState<Raf[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [rafModal, setRafModal] = useState<Raf | "nueva" | null>(null);
  const [anularRaf, setAnularRaf] = useState<Raf | null>(null);
  const [motivo, setMotivo] = useState("");
  const gestionar = puede("bpch.pn.gestionar");

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const [o, r] = await Promise.all([
        llamar<{ data: any[] }>("GET", `/bpch/pn/oc${qs({ anio, estado, q: q.trim() })}`),
        llamar<{ data: Raf[] }>("GET", `/bpch/pn/rafs${qs({ q: q.trim() })}`),
      ]);
      setOcs(o.data);
      setRafs(r.data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, [anio, estado, q]);

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anio, estado]);

  const colOc: DataColumn[] = [
    { key: "numero", label: "O/C operativa", render: (r) => <Link href={`/bpch/produccion-nacional/${r.id}` as any} className="codigo" style={{ textDecoration: "underline" }}>{r.numero}</Link>, value: (r) => r.numero },
    { key: "anio", label: "Año", num: true },
    { key: "fabricante", label: "Fabricante", value: (r) => r.cliente.razonSocial },
    { key: "raf", label: "RAF DGMN", value: (r) => `${r.raf.numero} · ${r.raf.tipoLinea === "MOVIL" ? "móvil" : "fija"}` },
    { key: "vigencia", label: "Vigencia", value: (r) => `${dia(r.vigenciaDesde)} a ${dia(r.vigenciaHasta)}` },
    { key: "programadas", label: "Programadas", num: true, value: (r) => r.programa.total },
    { key: "ejecutadas", label: "Ejecutadas", num: true, value: (r) => r.programa.ejecutadas },
    { key: "pendientes", label: "Pendientes", num: true, value: (r) => r.programa.pendientes },
    {
      key: "atrasadas",
      label: "Atrasadas",
      num: true,
      value: (r) => r.programa.atrasadas,
      render: (r) => (r.programa.atrasadas ? <span className="pill amber">{r.programa.atrasadas}</span> : "0"),
    },
    { key: "estado", label: "Estado", render: (r) => <span className={`pill ${ESTADO_OC[r.estado]?.pill}`}>{ESTADO_OC[r.estado]?.texto}</span>, value: (r) => ESTADO_OC[r.estado]?.texto },
  ];
  const colRaf: DataColumn[] = [
    { key: "numero", label: "RAF DGMN" },
    { key: "fabricante", label: "Fabricante", value: (r) => `${r.cliente.razonSocial} · ${rut(r.cliente.rut)}` },
    { key: "linea", label: "Línea", value: (r) => (r.tipoLinea === "MOVIL" ? "Móvil (camión fábrica)" : "Fija (planta)") },
    { key: "planta", label: "Planta / faena", value: (r) => r.planta ?? "—" },
    {
      key: "vigencia",
      label: "Vigente hasta",
      value: (r) => r.vigenciaHasta ?? "",
      render: (r) => (r.vigenciaHasta ? <>{dia(r.vigenciaHasta)} {r.vencida && <span className="pill red">vencida</span>}</> : "—"),
    },
    { key: "ocs", label: "O/C", num: true },
    { key: "estado", label: "Estado", render: (r) => <span className={`pill ${r.estado === "vigente" ? "green" : "red"}`}>{r.estado === "vigente" ? "Vigente" : "Anulada"}</span>, value: (r) => r.estado },
  ];

  return (
    <div>
      <PageHeader
        icono="🏭"
        titulo="Producción Nacional"
        subtitulo="Fiscalización de fábricas nacionales: RAF DGMN del fabricante → O/C operativa anual → programa de inspecciones → una OT por inspección (flujo general) → correlación con la relación de ventas e informe técnico a DCO."
        migas={[{ label: "BPCH" }, { label: "Producción Nacional" }]}
        acciones={
          gestionar ? (
            <>
              <button className="btn outline sm" onClick={() => setRafModal("nueva")}>＋ Registrar RAF</button>
              <Link href={"/bpch/produccion-nacional/nueva" as any} className="btn primary sm">＋ Nueva O/C operativa</Link>
            </>
          ) : null
        }
      />
      {error && <div className="alert warn" role="alert">{error}</div>}
      <div className="tabs" role="tablist" style={{ marginBottom: 10 }}>
        <button role="tab" aria-selected={tab === "oc"} className={`tab${tab === "oc" ? " active" : ""}`} onClick={() => setTab("oc")}>O/C operativas ({ocs.length})</button>
        <button role="tab" aria-selected={tab === "raf"} className={`tab${tab === "raf" ? " active" : ""}`} onClick={() => setTab("raf")}>RAF DGMN ({rafs.length})</button>
      </div>
      <form className="toolbar" style={{ flexWrap: "wrap", gap: 6 }} onSubmit={(e) => { e.preventDefault(); cargar(); }}>
        <input aria-label="Buscar" placeholder="Nº de O/C o RAF, fabricante o RUT" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
        {tab === "oc" && (
          <>
            <input aria-label="Año" value={anio} onChange={(e) => setAnio(e.target.value.replace(/\D/g, "").slice(0, 4))} style={{ width: 80 }} placeholder="Año" />
            <select aria-label="Estado" value={estado} onChange={(e) => setEstado(e.target.value)}>
              <option value="">Todos los estados</option>
              {Object.entries(ESTADO_OC).map(([k, v]) => <option key={k} value={k}>{v.texto}</option>)}
            </select>
          </>
        )}
        <button className="btn primary sm" type="submit" disabled={cargando}>{cargando ? "Buscando…" : "Buscar"}</button>
      </form>
      <div className="card card--table">
        {tab === "oc" ? (
          <DataTable
            columns={colOc}
            rows={ocs}
            loading={cargando}
            onRowClick={(r) => router.push(`/bpch/produccion-nacional/${r.id}` as any)}
            vacio="No hay O/C operativas para estos filtros. Registre primero la RAF del fabricante y luego la O/C."
          />
        ) : (
          <DataTable
            columns={colRaf}
            rows={rafs}
            loading={cargando}
            acciones={
              gestionar
                ? (r) =>
                    r.estado === "vigente" ? (
                      <span style={{ display: "flex", gap: 4 }}>
                        <button className="btn outline sm" onClick={(e) => { e.stopPropagation(); setRafModal(r); }}>Editar</button>
                        <button className="btn outline sm" onClick={(e) => { e.stopPropagation(); setMotivo(""); setAnularRaf(r); }}>Anular</button>
                      </span>
                    ) : null
                : undefined
            }
            vacio="No hay RAF registradas. Use «Registrar RAF»."
          />
        )}
      </div>
      {rafModal && <RafForm raf={rafModal === "nueva" ? null : rafModal} onCerrar={() => setRafModal(null)} onGuardado={() => { setRafModal(null); setTab("raf"); cargar(); }} />}
      {anularRaf && (
        <Modal
          titulo={`Anular la RAF ${anularRaf.numero}`}
          onCerrar={() => setAnularRaf(null)}
          acciones={
            <>
              <button className="btn outline sm" onClick={() => setAnularRaf(null)}>Cancelar</button>
              <button className="btn danger sm" disabled={motivo.trim().length < 5}
                onClick={async () => {
                  try {
                    await llamar("POST", `/bpch/pn/rafs/${anularRaf.id}/anular`, { motivo });
                    toast.ok("RAF anulada.");
                    setAnularRaf(null);
                    cargar();
                  } catch (e: any) {
                    toast.error(e.message);
                  }
                }}>Anular</button>
            </>
          }
        >
          <p style={{ marginTop: 0 }}>Solo se anula una RAF sin O/C vigentes.</p>
          <div className="field">
            <label htmlFor="mot-raf">Motivo <span className="req">*</span></label>
            <textarea id="mot-raf" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </div>
        </Modal>
      )}
    </div>
  );
}

function RafForm({ raf, onCerrar, onGuardado }: { raf: Raf | null; onCerrar: () => void; onGuardado: () => void }) {
  const [fab, setFab] = useState<Fabricante | null>(raf ? { id: raf.cliente.id, rut: raf.cliente.rut, razonSocial: raf.cliente.razonSocial } : null);
  const [f, setF] = useState({
    numero: raf?.numero ?? "",
    fecha: raf?.fecha ?? "",
    tipoLinea: raf?.tipoLinea ?? "",
    planta: raf?.planta ?? "",
    vigenciaHasta: raf?.vigenciaHasta ?? "",
    listadoProductos: raf?.listadoProductos ?? "",
    resInspeccionLinea: raf?.resInspeccionLinea ?? "",
    resAlmacenamiento: raf?.resAlmacenamiento ?? "",
    observaciones: raf?.observaciones ?? "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function guardar() {
    setError("");
    if (!fab || !f.numero.trim() || !f.tipoLinea) {
      setError("Complete fabricante, Nº de RAF y tipo de línea.");
      return;
    }
    setBusy(true);
    try {
      if (raf) await llamar("PATCH", `/bpch/pn/rafs/${raf.id}`, f);
      else await llamar("POST", "/bpch/pn/rafs", { ...f, clienteId: fab.id });
      toast.ok(raf ? "RAF actualizada." : "RAF registrada.");
      onGuardado();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      titulo={raf ? `Editar RAF ${raf.numero}` : "Registrar RAF DGMN"}
      onCerrar={onCerrar}
      ancho={720}
      acciones={
        <>
          <button className="btn outline sm" onClick={onCerrar}>Cancelar</button>
          <button className="btn primary sm" disabled={busy} onClick={guardar}>{busy ? "Guardando…" : "Guardar"}</button>
        </>
      }
    >
      <p style={{ marginTop: 0, color: "var(--muted)" }}>
        Documentos legales que revisa SAC-PG01-IT08 en Producción Nacional: RAF de la línea fija o móvil con su listado de productos, autorización de inspección en línea (si corresponde) y resolución de almacenamiento.
      </p>
      {error && <div className="alert warn" role="alert">{error}</div>}
      <div className="form-grid cols-2">
        {raf ? (
          <div className="field readonly"><label>Fabricante</label><input readOnly value={`${raf.cliente.razonSocial} · ${raf.cliente.rut}`} /></div>
        ) : (
          <SelectorFabricante valor={fab} onCambio={setFab} rutaAlta="/bpch/pn/fabricantes" puedeCrear />
        )}
        <div className="field"><label htmlFor="raf-n">Nº RAF DGMN <span className="req">*</span></label><input id="raf-n" value={f.numero} onChange={set("numero")} maxLength={60} /></div>
        <div className="field"><label htmlFor="raf-f">Fecha de la resolución</label><input id="raf-f" type="date" value={f.fecha} onChange={set("fecha")} /></div>
        <div className="field">
          <label htmlFor="raf-l">Línea de fabricación <span className="req">*</span></label>
          <select id="raf-l" value={f.tipoLinea} onChange={set("tipoLinea")}>
            <option value="">— Seleccione —</option>
            <option value="FIJA">Fija (planta)</option>
            <option value="MOVIL">Móvil (camión fábrica)</option>
          </select>
        </div>
        <div className="field"><label htmlFor="raf-p">Planta / faena</label><input id="raf-p" value={f.planta} onChange={set("planta")} maxLength={200} /></div>
        <div className="field"><label htmlFor="raf-v">Vigente hasta</label><input id="raf-v" type="date" value={f.vigenciaHasta} onChange={set("vigenciaHasta")} /></div>
        <div className="field"><label htmlFor="raf-i">Res. inspección en línea (si corresponde)</label><input id="raf-i" value={f.resInspeccionLinea} onChange={set("resInspeccionLinea")} maxLength={120} /></div>
        <div className="field"><label htmlFor="raf-a">Res. almacenamiento sust. peligrosas</label><input id="raf-a" value={f.resAlmacenamiento} onChange={set("resAlmacenamiento")} maxLength={120} /></div>
        <div className="field span-2"><label htmlFor="raf-lp">Listado de productos autorizados</label><textarea id="raf-lp" rows={2} value={f.listadoProductos} onChange={set("listadoProductos")} /></div>
        <div className="field span-2"><label htmlFor="raf-o">Observaciones</label><textarea id="raf-o" rows={2} value={f.observaciones} onChange={set("observaciones")} /></div>
      </div>
    </Modal>
  );
}
