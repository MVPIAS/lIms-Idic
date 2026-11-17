"use client";

/**
 * Facturas · Finanzas.
 *
 *  · Al cerrar una OT con cobro se crea una factura «Pendiente de facturar»
 *    (borrador PEND-…) con las líneas, moneda e IVA de la cotización aceptada.
 *    Finanzas la revisa (puede corregir las líneas) y la EMITE con el folio real.
 *  · Registrar un pago descuenta el saldo y deja la factura con pago parcial o
 *    pagada. Una factura con pagos no se anula: se emite una nota de crédito.
 *  · También se puede emitir una factura manual (factura.emitir).
 *  · El LIMS no emite la factura electrónica (no sale a internet): la ficha de
 *    cada factura descarga el «documento de cobro» (PDF, no es un DTE) y el
 *    JSON lims-idic.factura.v1 que importa el sistema de facturación del IDIC;
 *    el listado exporta varias facturas por rango de fechas.
 * Reglas: docs/FLUJO_FIRMA_CIERRE.md y docs/EXPORTACION_FACTURACION.md.
 */
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { fechaDia, monto, hoyISO } from "@/lib/format";
import DataTable, { type DataColumn } from "@/components/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { toast, confirmar } from "@/components/ui/feedback";
import { usePermisos } from "@/lib/permisos";
import { ESTADO_FACTURA } from "@/lib/documentos";
import Modal from "@/components/documentos/Modal";

const FILTROS = [
  { valor: "", texto: "Todas" },
  { valor: "pendiente", texto: "Pendientes de facturar" },
  { valor: "por_cobrar", texto: "Por cobrar" },
  { valor: "pagada", texto: "Pagadas" },
  { valor: "anulada", texto: "Anuladas" },
];

type Linea = { descripcion: string; cantidad: string; precioUnitario: string };
const hoy = () => hoyISO();

function FacturasContenido() {
  const params = useSearchParams();
  const router = useRouter();
  const { puede } = usePermisos();
  const estado = params.get("estado") ?? "";
  const [filas, setFilas] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);

  // diálogos
  const [revisar, setRevisar] = useState<any | null>(null);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [ivaPct, setIvaPct] = useState("19");
  const [folio, setFolio] = useState({ numero: "", fecha: hoy() });
  const [pagar, setPagar] = useState<any | null>(null);
  const [pago, setPago] = useState({ monto: "", medio: "", referencia: "", numeroBoletin: "", fecha: hoy() });
  // Medios de pago de la lista (Catálogo › Parámetros · medio_pago; EP-00 8.4).
  const [medios, setMedios] = useState<{ codigo: string; etiqueta: string }[]>([]);
  useEffect(() => {
    api.getRaw<any>("parametros?categoria=medio_pago&activo=true&limit=50")
      .then((r) => setMedios((r?.data ?? r ?? []).map((p: any) => ({ codigo: p.codigo, etiqueta: p.etiqueta }))))
      .catch(() => setMedios([]));
  }, []);
  const [manual, setManual] = useState(false);
  // Ficha de la factura y exportación para facturación (docs/EXPORTACION_FACTURACION.md).
  const [ficha, setFicha] = useState<any | null>(null);
  const [exenta, setExenta] = useState(false);
  const [lote, setLote] = useState<{ desde: string; hasta: string; estado: string } | null>(null);
  const [clientes, setClientes] = useState<any[]>([]);
  const [nueva, setNueva] = useState({ numero: "", clienteId: "", descripcion: "", cantidad: "1", precioUnitario: "", ivaPct: "19" });

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const r: any = await api.getRaw(`facturas?limit=100${estado ? `&estado=${estado}` : ""}`);
      setFilas(r.data ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, [estado]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  function abrirRevision(f: any) {
    setRevisar(f);
    setLineas((f.lineas ?? []).map((l: any) => ({ descripcion: l.descripcion, cantidad: String(Number(l.cantidad)), precioUnitario: String(Number(l.precioUnitario)) })));
    setIvaPct(String(Number(f.ivaPct ?? 19)));
    setExenta(f.exentaIva ?? Number(f.ivaPct) === 0);
    setFolio({ numero: "", fecha: hoy() });
  }

  /** PDF «documento de cobro» de la factura (no es un documento tributario electrónico). */
  async function descargarPdf(f: any) {
    setOcupado(true);
    try {
      await descargar(`/facturas/${f.id}/documento-cobro`, `Documento-cobro-${f.numero}.pdf`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }

  /** JSON lims-idic.factura.v1 de una factura para el sistema de facturación. */
  async function exportarJson(f: any) {
    setOcupado(true);
    try {
      const doc = await descargarJson(`/facturas/${f.id}/exportacion`, `Factura-${f.numero}.json`);
      const adv: string[] = doc?.advertencias ?? [];
      toast.ok(`Factura ${f.numero} exportada para facturación (tipo ${doc?.encabezado?.tipoDte}).`);
      if (adv.length) toast.info(`Revise: ${adv.join(" ")}`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }

  /** Varias facturas en un archivo (rango de fechas de emisión y estado). */
  async function exportarLote() {
    if (!lote) return;
    setOcupado(true);
    try {
      const q = new URLSearchParams({ desde: lote.desde, hasta: lote.hasta, ...(lote.estado ? { estado: lote.estado } : {}) });
      const r = await descargarJson(`/facturas/exportacion?${q.toString()}`, `Facturas-${lote.desde}-a-${lote.hasta}.json`);
      const om: any[] = r?.omitidas ?? [];
      toast.ok(`${r?.cantidad ?? 0} factura(s) exportada(s) para facturación.`);
      if (om.length)
        toast.info(`${om.length} no se exportaron (${om.slice(0, 3).map((o) => o.folioInterno).join(", ")}${om.length > 3 ? "…" : ""}): el motivo de cada una está en «omitidas» dentro del archivo. Corríjalas y vuelva a exportarlas.`);
      setLote(null);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }

  const lineasValidas = lineas.length > 0 && lineas.every((l) => l.descripcion.trim() && Number(l.cantidad) > 0 && l.precioUnitario !== "" && !isNaN(Number(l.precioUnitario)));
  const netoEditado = lineas.reduce((a, l) => a + Number(l.cantidad || 0) * Number(l.precioUnitario || 0), 0);
  const ivaEfectivo = exenta ? 0 : Number(ivaPct || 0);

  async function guardarYEmitir(soloGuardar: boolean) {
    // Emitir no se deshace (D02-23): se confirma con el folio y el total.
    if (!soloGuardar) {
      const ok = await confirmar({
        titulo: `¿Emitir la factura ${folio.numero.trim()}?`,
        mensaje: `Queda emitida por ${monto(netoEditado * (1 + ivaEfectivo / 100), revisar.moneda)} y pasa a cobranza. Para corregirla después se usa una nota de crédito.`,
        confirmarTexto: "Emitir factura",
      });
      if (!ok) return;
    }
    setOcupado(true);
    try {
      await fetchJson(`/facturas/${revisar.id}/lineas`, "PUT", {
        lineas: lineas.map((l) => ({ descripcion: l.descripcion.trim(), cantidad: Number(l.cantidad), precioUnitario: Number(l.precioUnitario) })),
        ivaPct: exenta ? 0 : Number(ivaPct),
      });
      // Exenta de IVA (DTE 34) o afecta (33): queda marcada y los importes se recalculan.
      const r: any = await fetchJson(`/facturas/${revisar.id}/exencion`, "PUT", { exenta });
      if (soloGuardar) {
        toast.ok("Líneas guardadas.");
        setRevisar({ ...revisar, ...r });
      } else {
        await api.post(`/facturas/${revisar.id}/emitir`, { numero: folio.numero.trim(), fechaEmision: folio.fecha });
        toast.ok(`Factura ${folio.numero.trim()} emitida.`);
        setRevisar(null);
      }
      await cargar();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }

  async function registrarPago() {
    setOcupado(true);
    try {
      const r: any = await api.post("/pagos", {
        facturaId: pagar.id,
        monto: Number(pago.monto),
        medio: pago.medio,
        ...(pago.referencia.trim() ? { referencia: pago.referencia.trim() } : {}),
        ...(pago.numeroBoletin.trim() ? { numeroBoletin: pago.numeroBoletin.trim() } : {}),
        ...(pago.fecha ? { fecha: pago.fecha } : {}),
      });
      toast.ok(`Pago registrado. La factura queda ${ESTADO_FACTURA[r.factura?.estado]?.texto?.toLowerCase() ?? r.factura?.estado}.`);
      setPagar(null);
      await cargar();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }

  async function anular(f: any) {
    const ok = await confirmar({
      titulo: `¿Anular la factura ${f.numero}?`,
      mensaje: "Queda en estado «anulada», con saldo $ 0, y se conserva en el historial. Si tiene pagos, emita una nota de crédito. Para volver a cobrar la OT, use «Refacturar OT» en la factura anulada.",
      confirmarTexto: "Anular factura",
      peligro: true,
    });
    if (!ok) return;
    try {
      await api.update("facturas", f.id, { estado: "anulada" });
      toast.ok(`Factura ${f.numero} anulada.`);
      cargar();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  /** Nueva factura pendiente de la OT de una factura anulada (copia sus líneas). */
  async function refacturar(f: any) {
    const ok = await confirmar({
      titulo: `¿Refacturar la OT ${f.ot.codigo}?`,
      mensaje: `Se genera una nueva factura pendiente de facturar con las líneas de ${f.numero}. Revísela y emítala con su folio.`,
      confirmarTexto: "Refacturar OT",
    });
    if (!ok) return;
    try {
      const r: any = await api.post(`/facturas/desde-ot/${f.ot.id}`, {});
      toast.ok(`Factura ${r?.numero ?? ""} pendiente de facturar creada para la OT ${f.ot.codigo}.`);
      cargar();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function abrirManual() {
    setNueva({ numero: "", clienteId: "", descripcion: "", cantidad: "1", precioUnitario: "", ivaPct: "19" });
    setManual(true);
    if (!clientes.length) {
      try {
        setClientes(((await api.list<any>("clientes", { limit: 100 })) as any).data ?? []);
      } catch (e: any) {
        toast.error(e.message);
      }
    }
  }

  async function crearManual() {
    setOcupado(true);
    try {
      await api.create("facturas", {
        numero: nueva.numero.trim(),
        clienteId: nueva.clienteId,
        ivaPct: Number(nueva.ivaPct || 19),
        lineas: [{ descripcion: nueva.descripcion.trim(), cantidad: Number(nueva.cantidad || 1), precioUnitario: Number(nueva.precioUnitario) }],
      });
      toast.ok(`Factura ${nueva.numero.trim()} emitida.`);
      setManual(false);
      cargar();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }

  const columnas: DataColumn[] = [
    {
      key: "numero", label: "N° factura",
      render: (f) => f.estado === "pendiente" ? <span className="tag" title="Número provisional hasta que Finanzas la emita">{f.numero}</span> : <span className="codigo">{f.numero}</span>,
    },
    { key: "cliente", label: "Cliente", value: (f) => f.cliente?.razonSocial ?? "" },
    {
      key: "ot", label: "OT", value: (f) => f.ot?.codigo ?? "",
      render: (f) => (f.ot ? <Link href={`/ot/${f.ot.id}` as any} className="codigo" onClick={(e) => e.stopPropagation()}>{f.ot.codigo}</Link> : "—"),
    },
    { key: "fechaEmision", label: "Emisión", value: (f) => f.fechaEmision ?? "", render: (f) => (f.estado === "pendiente" ? "—" : fechaDia(f.fechaEmision)) },
    { key: "total", label: "Total", num: true, value: (f) => Number(f.total), render: (f) => monto(f.total, f.moneda) },
    { key: "pagado", label: "Pagado", num: true, value: (f) => Number(f.pagado ?? 0), render: (f) => monto(f.pagado ?? 0, f.moneda) },
    { key: "saldo", label: "Saldo", num: true, value: (f) => Number(f.saldo ?? 0), render: (f) => monto(f.saldo ?? 0, f.moneda) },
    {
      key: "estado", label: "Estado", value: (f) => ESTADO_FACTURA[f.estado]?.texto ?? f.estado,
      render: (f) => <span className={`pill ${ESTADO_FACTURA[f.estado]?.pill ?? "gray"}`}>{ESTADO_FACTURA[f.estado]?.texto ?? f.estado}</span>,
    },
  ];

  const acciones = (f: any) => (
    <span style={{ display: "inline-flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
      <button className="btn outline sm" onClick={() => setFicha(f)}>Ver ficha</button>
      {f.estado === "pendiente" && puede("factura.emitir") && <button className="btn primary sm" onClick={() => abrirRevision(f)}>Revisar y emitir</button>}
      {(f.estado === "emitida" || f.estado === "parcial") && puede("factura.cobrar") && (
        <button className="btn success sm" onClick={() => { setPagar(f); setPago({ monto: String(Number(f.saldo ?? 0)), medio: "", referencia: "", numeroBoletin: "", fecha: hoy() }); }}>Registrar pago</button>
      )}
      {f.estado !== "anulada" && f.estado !== "pagada" && Number(f.pagado ?? 0) === 0 && puede("factura.cobrar") && (
        <button className="btn ghost-danger sm" onClick={() => anular(f)}>Anular</button>
      )}
      {/* Fallo 50: la OT de una factura anulada se vuelve a facturar desde aquí. */}
      {f.estado === "anulada" && f.ot && puede("factura.emitir") && (
        <button className="btn outline sm" onClick={() => refacturar(f)}>Refacturar OT</button>
      )}
    </span>
  );

  return (
    <>
      <PageHeader
        titulo="Facturas"
        icono="📄"
        subtitulo="Al cerrar una OT con cobro se genera aquí una factura pendiente con los importes de la cotización aceptada. Revísela, emítala con el folio y registre los pagos: el saldo y el estado se actualizan solos."
        migas={[{ label: "Finanzas" }, { label: "Facturas" }]}
        acciones={
          <>
            <button className="btn outline" onClick={() => setLote({ desde: `${hoy().slice(0, 8)}01`, hasta: hoy(), estado: "" })}>Exportar para facturación (JSON)</button>
            {puede("factura.emitir") && <button className="btn outline" onClick={abrirManual}>Factura manual</button>}
          </>
        }
      />
      {error && <div className="alert warn">{error}</div>}
      <div className="tabs" style={{ marginBottom: 10 }}>
        {FILTROS.map((f) => (
          <button key={f.valor} className={`tab${estado === f.valor ? " active" : ""}`}
            onClick={() => router.replace((f.valor ? `/facturas?estado=${f.valor}` : "/facturas") as any)}>
            {f.texto}
          </button>
        ))}
      </div>
      <DataTable columns={columnas} rows={filas} loading={cargando} searchKeys={["numero", "cliente", "ot"]}
        onRowClick={(f) => setFicha(f)} acciones={acciones} vacio={<>No hay facturas con este filtro.</>} />

      {ficha && (
        <Modal titulo={`Ficha de la factura ${ficha.numero}`} ancho={820} onCerrar={() => setFicha(null)}
          acciones={
            <>
              <button className="btn outline" onClick={() => setFicha(null)}>Cerrar</button>
              <button className="btn outline" disabled={ocupado} onClick={() => descargarPdf(ficha)}>Descargar documento de cobro (PDF)</button>
              <button className="btn primary" disabled={ocupado || ficha.estado === "anulada"}
                title={ficha.estado === "anulada" ? "Una factura anulada no se exporta para facturación" : undefined}
                onClick={() => exportarJson(ficha)}>Exportar para facturación (JSON)</button>
            </>
          }>
          <div className="form-grid" style={{ marginTop: 0 }}>
            <div className="field"><label>Estado</label><span className={`pill ${ESTADO_FACTURA[ficha.estado]?.pill ?? "gray"}`}>{ESTADO_FACTURA[ficha.estado]?.texto ?? ficha.estado}</span></div>
            <div className="field"><label>Emisión</label><span>{ficha.estado === "pendiente" ? "— (pendiente)" : fechaDia(ficha.fechaEmision)}</span></div>
            <div className="field"><label>Tipo de factura sugerido</label><span>{(ficha.exentaIva ?? Number(ficha.ivaPct) === 0) ? "Exenta de IVA (34)" : "Afecta a IVA (33)"}</span></div>
            <div className="field span-2"><label>Cliente</label><span>{[ficha.cliente?.rut, ficha.cliente?.razonSocial].filter(Boolean).join(" · ") || "—"}</span></div>
            <div className="field"><label>OT</label><span>{ficha.ot ? <Link href={`/ot/${ficha.ot.id}` as any} className="codigo">{ficha.ot.codigo}</Link> : "—"}</span></div>
          </div>
          <table className="data" style={{ marginTop: 10 }}>
            <thead><tr><th>Descripción</th><th style={{ width: 80, textAlign: "right" }}>Cantidad</th><th style={{ width: 130, textAlign: "right" }}>Precio unitario</th><th style={{ width: 120, textAlign: "right" }}>Subtotal</th></tr></thead>
            <tbody>
              {(ficha.lineas ?? []).map((l: any) => (
                <tr key={l.id}><td>{l.descripcion}</td><td style={{ textAlign: "right" }}>{Number(l.cantidad).toLocaleString("es-CL")}</td>
                  <td style={{ textAlign: "right" }}>{monto(l.precioUnitario, ficha.moneda)}</td><td style={{ textAlign: "right" }}>{monto(l.subtotal, ficha.moneda)}</td></tr>
              ))}
              {!(ficha.lineas ?? []).length && <tr><td colSpan={4} style={{ color: "var(--muted)" }}>Sin líneas.</td></tr>}
            </tbody>
          </table>
          <p style={{ textAlign: "right", margin: "8px 0" }}>
            Neto <b>{monto(ficha.neto, ficha.moneda)}</b> · IVA {Number(ficha.ivaPct ?? 0).toLocaleString("es-CL")} % <b>{monto(ficha.ivaMonto, ficha.moneda)}</b> · Total <b>{monto(ficha.total, ficha.moneda)}</b> · Saldo <b>{monto(ficha.saldo ?? 0, ficha.moneda)}</b>
          </p>
          <div className="alert info" style={{ margin: 0 }}>
            El LIMS no emite la factura electrónica ante el SII. El <b>documento de cobro</b> (PDF) no es un documento tributario.
            El archivo <b>JSON</b> lleva los datos que importa el sistema de facturación del IDIC para emitirla; si la factura está pendiente,
            registre después el folio que le asigne ese sistema en «Revisar y emitir».
          </div>
        </Modal>
      )}

      {lote && (
        <Modal titulo="Exportar facturas para facturación" onCerrar={() => setLote(null)}
          acciones={
            <>
              <button className="btn outline" onClick={() => setLote(null)}>Cancelar</button>
              <button className="btn primary" disabled={ocupado || !lote.desde || !lote.hasta || lote.hasta < lote.desde} onClick={exportarLote}>Exportar (JSON)</button>
            </>
          }>
          <p style={{ marginTop: 0 }}>Descarga un archivo con las facturas del rango (por fecha de emisión) en el formato que importa el sistema de facturación. Las que no se pueden exportar quedan listadas con el motivo en «omitidas».</p>
          <div className="form-grid">
            <div className="field"><label htmlFor="lote-desde">Desde <span className="req">*</span></label><input id="lote-desde" type="date" value={lote.desde} onChange={(e) => setLote({ ...lote, desde: e.target.value })} /></div>
            <div className="field"><label htmlFor="lote-hasta">Hasta <span className="req">*</span></label><input id="lote-hasta" type="date" value={lote.hasta} onChange={(e) => setLote({ ...lote, hasta: e.target.value })} /></div>
            <div className="field"><label htmlFor="lote-estado">Estado</label>
              <select id="lote-estado" value={lote.estado} onChange={(e) => setLote({ ...lote, estado: e.target.value })}>
                <option value="">Todas menos las anuladas</option>
                <option value="pendiente">Pendientes de facturar</option>
                <option value="por_cobrar">Por cobrar (emitidas y con pago parcial)</option>
                <option value="emitida">Emitidas</option>
                <option value="pagada">Pagadas</option>
              </select>
            </div>
          </div>
          {lote.hasta < lote.desde && <div className="alert warn" role="alert">La fecha «hasta» es anterior a «desde».</div>}
        </Modal>
      )}

      {revisar && (
        <Modal titulo={`Revisar y emitir · ${revisar.ot?.codigo ? `OT ${revisar.ot.codigo}` : revisar.numero}`} ancho={820} onCerrar={() => setRevisar(null)}
          acciones={
            <>
              <button className="btn outline" onClick={() => setRevisar(null)}>Cerrar</button>
              <button className="btn outline" disabled={ocupado || !lineasValidas} onClick={() => guardarYEmitir(true)}>Guardar líneas</button>
              <button className="btn primary" disabled={ocupado || !lineasValidas || !folio.numero.trim() || netoEditado <= 0} onClick={() => guardarYEmitir(false)}>Emitir factura</button>
            </>
          }>
          <p style={{ marginTop: 0 }}>
            Cliente <b>{revisar.cliente?.razonSocial ?? "—"}</b> · moneda <b>{revisar.moneda}</b>
            {revisar.observaciones ? <><br /><span style={{ color: "var(--muted)" }}>{revisar.observaciones}</span></> : null}
          </p>
          <table className="data">
            <thead><tr><th>Descripción</th><th style={{ width: 80 }}>Cantidad</th><th style={{ width: 130 }}>Precio unitario</th><th style={{ width: 120 }}>Subtotal</th><th /></tr></thead>
            <tbody>
              {lineas.map((l, i) => (
                <tr key={i}>
                  <td><input value={l.descripcion} onChange={(e) => setLineas(lineas.map((x, j) => (j === i ? { ...x, descripcion: e.target.value } : x)))} style={{ width: "100%" }} /></td>
                  <td><input type="number" min="0" step="any" value={l.cantidad} onChange={(e) => setLineas(lineas.map((x, j) => (j === i ? { ...x, cantidad: e.target.value } : x)))} style={{ width: "100%" }} /></td>
                  <td><input type="number" step="any" value={l.precioUnitario} onChange={(e) => setLineas(lineas.map((x, j) => (j === i ? { ...x, precioUnitario: e.target.value } : x)))} style={{ width: "100%" }} /></td>
                  <td style={{ textAlign: "right" }}>{monto(Number(l.cantidad || 0) * Number(l.precioUnitario || 0), revisar.moneda)}</td>
                  <td><button className="btn ghost-danger sm" onClick={() => setLineas(lineas.filter((_, j) => j !== i))} aria-label="Quitar línea">✕</button></td>
                </tr>
              ))}
              {!lineas.length && <tr><td colSpan={5} style={{ color: "var(--muted)" }}>Sin líneas: añada al menos una.</td></tr>}
            </tbody>
          </table>
          <div className="toolbar" style={{ marginTop: 8 }}>
            <button className="btn outline sm" onClick={() => setLineas([...lineas, { descripcion: "", cantidad: "1", precioUnitario: "" }])}>Añadir línea</button>
            <span className="spacer" />
            {/* F068: el % de IVA se lee también como texto (no solo dentro del campo editable). */}
            <label style={{ display: "inline-flex", gap: 6, alignItems: "center", marginRight: 12 }} title="Factura exenta (34): p. ej. la tasa de internación del BPCH">
              <input type="checkbox" checked={exenta} onChange={(e) => setExenta(e.target.checked)} /> Exenta de IVA
            </label>
            <span>Neto <b>{monto(netoEditado, revisar.moneda)}</b> · IVA
              <input type="number" min="0" max="100" value={exenta ? "0" : ivaPct} disabled={exenta} onChange={(e) => setIvaPct(e.target.value)} style={{ width: 60, margin: "0 4px" }} aria-label="Porcentaje de IVA" />%
              {" "}(<b>{ivaEfectivo.toLocaleString("es-CL")} %</b>: {monto(netoEditado * (ivaEfectivo / 100), revisar.moneda)})
              · Total <b>{monto(netoEditado * (1 + ivaEfectivo / 100), revisar.moneda)}</b></span>
          </div>
          <div className="form-grid" style={{ marginTop: 10 }}>
            <div className="field"><label>Folio de la factura <span className="req">*</span></label><input value={folio.numero} maxLength={30} onChange={(e) => setFolio({ ...folio, numero: e.target.value })} /></div>
            <div className="field"><label>Fecha de emisión</label><input type="date" value={folio.fecha} onChange={(e) => setFolio({ ...folio, fecha: e.target.value })} /></div>
          </div>
        </Modal>
      )}

      {pagar && (
        <Modal titulo={`Registrar pago · factura ${pagar.numero}`} onCerrar={() => setPagar(null)}
          acciones={
            <>
              <button className="btn outline" onClick={() => setPagar(null)}>Cancelar</button>
              <button className="btn success" disabled={ocupado || !(Number(pago.monto) > 0) || !pago.medio} onClick={registrarPago}>Registrar pago</button>
            </>
          }>
          <p style={{ marginTop: 0 }}>Total {monto(pagar.total, pagar.moneda)} · pagado {monto(pagar.pagado ?? 0, pagar.moneda)} · <b>saldo {monto(pagar.saldo ?? 0, pagar.moneda)}</b></p>
          <div className="form-grid">
            <div className="field"><label>Monto <span className="req">*</span></label><input type="number" min="0" step="any" value={pago.monto} onChange={(e) => setPago({ ...pago, monto: e.target.value })} /></div>
            <div className="field"><label>Fecha del pago</label><input type="date" value={pago.fecha} onChange={(e) => setPago({ ...pago, fecha: e.target.value })} /></div>
            <div className="field"><label htmlFor="pago-medio">Medio de pago <span className="req">*</span></label>
              <select id="pago-medio" value={pago.medio} onChange={(e) => setPago({ ...pago, medio: e.target.value })}>
                <option value="">Elija…</option>
                {medios.map((m) => <option key={m.codigo} value={m.codigo}>{m.etiqueta}</option>)}
              </select>
            </div>
            <div className="field"><label htmlFor="pago-bol">Nº boletín de ingreso</label><input id="pago-bol" value={pago.numeroBoletin} maxLength={40} onChange={(e) => setPago({ ...pago, numeroBoletin: e.target.value })} /></div>
            <div className="field"><label>Referencia</label><input value={pago.referencia} maxLength={80} onChange={(e) => setPago({ ...pago, referencia: e.target.value })} /></div>
          </div>
        </Modal>
      )}

      {manual && (
        <Modal titulo="Factura manual" onCerrar={() => setManual(false)}
          acciones={
            <>
              <button className="btn outline" onClick={() => setManual(false)}>Cancelar</button>
              <button className="btn primary" disabled={ocupado || !nueva.numero.trim() || !nueva.clienteId || !nueva.descripcion.trim() || !(Number(nueva.precioUnitario) > 0)} onClick={crearManual}>Emitir</button>
            </>
          }>
          <div className="form-grid">
            <div className="field"><label>Folio <span className="req">*</span></label><input value={nueva.numero} maxLength={30} onChange={(e) => setNueva({ ...nueva, numero: e.target.value })} /></div>
            <div className="field span-2">
              <label>Cliente <span className="req">*</span></label>
              <select value={nueva.clienteId} onChange={(e) => setNueva({ ...nueva, clienteId: e.target.value })}>
                <option value="">— Seleccione —</option>
                {clientes.map((c) => <option key={c.id} value={c.id}>{[c.rut, c.razonSocial].filter(Boolean).join(" · ")}</option>)}
              </select>
            </div>
            <div className="field span-3"><label>Descripción del servicio <span className="req">*</span></label><input value={nueva.descripcion} onChange={(e) => setNueva({ ...nueva, descripcion: e.target.value })} /></div>
            <div className="field"><label>Cantidad</label><input type="number" min="1" value={nueva.cantidad} onChange={(e) => setNueva({ ...nueva, cantidad: e.target.value })} /></div>
            <div className="field"><label>Precio unitario (neto) <span className="req">*</span></label><input type="number" min="0" value={nueva.precioUnitario} onChange={(e) => setNueva({ ...nueva, precioUnitario: e.target.value })} /></div>
            <div className="field"><label>IVA %</label><input type="number" min="0" max="100" value={nueva.ivaPct} onChange={(e) => setNueva({ ...nueva, ivaPct: e.target.value })} /></div>
          </div>
        </Modal>
      )}
    </>
  );
}

/** Descarga un archivo protegido por JWT (un <a href> plano daría 401); devuelve el Blob. */
async function bajar(path: string, nombre: string): Promise<Blob> {
  const API = process.env.NEXT_PUBLIC_API_URL ?? "/api";
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${localStorage.getItem("lims_token")}` } });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j?.message ?? `Error ${r.status} al descargar el archivo.`);
  }
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return blob;
}
const descargar = (path: string, nombre: string) => bajar(path, nombre).then(() => undefined);
/** Descarga un JSON y devuelve su contenido (para el resumen en pantalla). */
const descargarJson = async (path: string, nombre: string) => JSON.parse(await (await bajar(path, nombre)).text());

/** PUT con el mismo manejo de errores que lib/api (que no expone PUT). */
async function fetchJson(path: string, method: string, body: unknown) {
  const API = process.env.NEXT_PUBLIC_API_URL ?? "/api";
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("lims_token")}` },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message ?? `Error ${r.status}`);
  return j;
}

export default function FacturasPage() {
  return (
    <Suspense fallback={<p className="subtitle">Cargando…</p>}>
      <FacturasContenido />
    </Suspense>
  );
}
