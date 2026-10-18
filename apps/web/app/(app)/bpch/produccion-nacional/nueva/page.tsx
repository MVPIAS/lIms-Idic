"use client";

/**
 * Alta de la O/C operativa anual de Producción Nacional (la elabora la
 * Subdirección BPCH a partir de la RAF del fabricante): vigencia, cobro,
 * productos y cantidades autorizadas. API: POST /bpch/pn/oc.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { toast } from "@/components/ui/feedback";
import { usePermisos } from "@/lib/permisos";
import { llamar } from "@/lib/laboratorio";
import { dia, numeroCl } from "@/lib/bpchProcesos";

interface FilaProducto {
  producto: string;
  unidadMedida: string;
  cantidadAutorizada: string;
  clasificacionId: string;
}
const filaVacia = (): FilaProducto => ({ producto: "", unidadMedida: "", cantidadAutorizada: "", clasificacionId: "" });

export default function NuevaOcPage() {
  const router = useRouter();
  const { puede, listo } = usePermisos();
  const anioActual = new Date().getFullYear();
  const [rafs, setRafs] = useState<any[]>([]);
  const [clasificaciones, setClasificaciones] = useState<any[]>([]);
  const [rafId, setRafId] = useState("");
  const [numero, setNumero] = useState("");
  const [anio, setAnio] = useState(String(anioActual));
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [cobro, setCobro] = useState<"" | "si" | "no">("");
  const [observaciones, setObservaciones] = useState("");
  const [productos, setProductos] = useState<FilaProducto[]>([filaVacia()]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    llamar<{ data: any[] }>("GET", "/bpch/pn/rafs").then((r) => setRafs(r.data.filter((x) => x.estado === "vigente"))).catch((e) => setError(e.message));
    llamar<{ data: any[] }>("GET", "/bpch/clasificaciones?vigentes=1&limit=500").then((r) => setClasificaciones(r.data)).catch(() => setClasificaciones([]));
  }, []);

  const raf = rafs.find((r) => r.id === rafId);
  const setFila = (i: number, k: keyof FilaProducto, v: string) => setProductos((ps) => ps.map((p, j) => (j === i ? { ...p, [k]: v } : p)));

  async function guardar() {
    setError("");
    const filas = productos.filter((p) => p.producto.trim() || p.cantidadAutorizada);
    if (!rafId || !numero.trim() || !anio || !desde || !hasta || !cobro || !filas.length) {
      setError("Complete RAF, Nº de O/C, año, vigencia, cobro y al menos un producto con su cantidad.");
      return;
    }
    setBusy(true);
    try {
      const oc = await llamar<any>("POST", "/bpch/pn/oc", {
        rafId,
        numero,
        anio: Number(anio),
        vigenciaDesde: desde,
        vigenciaHasta: hasta,
        conCobro: cobro === "si",
        observaciones,
        productos: filas.map((p) => ({
          producto: p.producto,
          unidadMedida: p.unidadMedida,
          cantidadAutorizada: numeroCl(p.cantidadAutorizada),
          clasificacionId: p.clasificacionId || null,
        })),
      });
      toast.ok(`O/C ${oc.numero} registrada. Ahora programe sus inspecciones.`);
      router.replace(`/bpch/produccion-nacional/${oc.id}` as any);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (listo && !puede("bpch.pn.gestionar"))
    return <div className="alert warn">Su perfil no registra O/C operativas (lo hacen la Subdirección y la SCC).</div>;

  return (
    <div>
      <PageHeader
        icono="🏭"
        titulo="Nueva O/C operativa anual"
        subtitulo="Productos y cantidades que se fiscalizarán en el año al amparo de la RAF. Las inspecciones se programan después, en la ficha de la O/C."
        migas={[{ label: "BPCH" }, { label: "Producción Nacional", href: "/bpch/produccion-nacional" }, { label: "Nueva O/C" }]}
      />
      {error && <div className="alert warn" role="alert">{error}</div>}
      <div className="card" style={{ padding: 14 }}>
        <div className="form-grid">
          <div className="field span-2">
            <label htmlFor="raf">RAF DGMN del fabricante <span className="req">*</span></label>
            <select id="raf" value={rafId} onChange={(e) => setRafId(e.target.value)}>
              <option value="">{rafs.length ? "— Seleccione —" : "No hay RAF vigentes: regístrela primero"}</option>
              {rafs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.numero} · {r.cliente.razonSocial} · línea {r.tipoLinea === "MOVIL" ? "móvil" : "fija"}{r.vencida ? " · VENCIDA" : ""}
                </option>
              ))}
            </select>
            {raf && (
              <small style={{ color: raf.vencida ? "var(--red)" : "var(--muted)" }}>
                {raf.planta ? `${raf.planta} · ` : ""}{raf.vigenciaHasta ? `vigente hasta ${dia(raf.vigenciaHasta)}` : "sin fecha de vigencia"}
                {raf.vencida ? " · vencida: la inspección la registrará como defecto crítico (SAC-PG01-IT08)" : ""}
                {raf.tipoLinea === "MOVIL" ? " · línea móvil: SAC-PG01-IT10 no aplica el muestreo NCh 44" : ""}
              </small>
            )}
          </div>
          <div className="field"><label htmlFor="num">Nº O/C operativa <span className="req">*</span></label><input id="num" value={numero} onChange={(e) => setNumero(e.target.value)} maxLength={60} /></div>
          <div className="field"><label htmlFor="anio">Año <span className="req">*</span></label><input id="anio" inputMode="numeric" value={anio} onChange={(e) => setAnio(e.target.value.replace(/\D/g, "").slice(0, 4))} /></div>
          <div className="field"><label htmlFor="desde">Vigente desde <span className="req">*</span></label><input id="desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
          <div className="field"><label htmlFor="hasta">Vigente hasta <span className="req">*</span></label><input id="hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
          <fieldset className="field" style={{ border: "none", padding: 0, margin: 0 }}>
            <legend style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", fontWeight: 600 }}>Inspecciones <span className="req">*</span></legend>
            <div style={{ display: "flex", gap: 12, paddingTop: 4 }}>
              <label><input type="radio" name="cobro" checked={cobro === "si"} onChange={() => setCobro("si")} /> Con cobro</label>
              <label><input type="radio" name="cobro" checked={cobro === "no"} onChange={() => setCobro("no")} /> Sin cobro</label>
            </div>
          </fieldset>
          <div className="field span-2"><label htmlFor="obs">Observaciones</label><input id="obs" value={observaciones} onChange={(e) => setObservaciones(e.target.value)} /></div>
        </div>
      </div>

      <div className="card" style={{ padding: 14 }}>
        <h2 style={{ fontSize: 14, margin: "0 0 8px" }}>Productos y cantidades autorizadas</h2>
        <div style={{ overflowX: "auto" }}>
        <table className="data">
          <thead>
            <tr><th>Producto <span className="req">*</span></th><th>Unidad <span className="req">*</span></th><th className="num">Cantidad autorizada <span className="req">*</span></th><th>Clasificación (aprobada)</th><th /></tr>
          </thead>
          <tbody>
            {productos.map((p, i) => (
              <tr key={i}>
                <td><input aria-label={`Producto ${i + 1}`} value={p.producto} onChange={(e) => setFila(i, "producto", e.target.value)} maxLength={240} style={{ width: "100%" }} /></td>
                <td><input aria-label={`Unidad ${i + 1}`} value={p.unidadMedida} onChange={(e) => setFila(i, "unidadMedida", e.target.value)} maxLength={20} placeholder="t, kg, u, m" style={{ width: 80 }} /></td>
                <td className="num"><input aria-label={`Cantidad ${i + 1}`} inputMode="decimal" value={p.cantidadAutorizada} onChange={(e) => setFila(i, "cantidadAutorizada", e.target.value)} style={{ width: 120, textAlign: "right" }} /></td>
                <td>
                  <select aria-label={`Clasificación ${i + 1}`} value={p.clasificacionId} onChange={(e) => setFila(i, "clasificacionId", e.target.value)}>
                    <option value="">— Sin clasificación —</option>
                    {clasificaciones.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.sustancia} · {c.resumen}</option>)}
                  </select>
                </td>
                <td>{productos.length > 1 && <button className="btn outline sm" aria-label={`Quitar producto ${i + 1}`} onClick={() => setProductos((ps) => ps.filter((_, j) => j !== i))}>Quitar</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <button className="btn outline sm" style={{ marginTop: 8 }} onClick={() => setProductos((ps) => [...ps, filaVacia()])}>＋ Producto</button>
      </div>
      <div className="toolbar">
        <button className="btn outline sm" onClick={() => router.push("/bpch/produccion-nacional" as any)}>Cancelar</button>
        <button className="btn primary sm" disabled={busy} onClick={guardar}>{busy ? "Guardando…" : "Registrar O/C"}</button>
      </div>
    </div>
  );
}
