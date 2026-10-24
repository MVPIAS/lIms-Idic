"use client";

/**
 * Comercial › Listas de precio › detalle (frente lp26).
 *
 * Ítems de una lista con su estructura de costos (lista oficial IDIC 2026):
 * costo directo, indirecto (20 %), total (precio Ejército), recargo (30 %),
 * neto (precio particular sin IVA, el que toma la cotización), IVA y precio
 * particular. Muestra el ensayo del catálogo enlazado, el centro de costo y la
 * unidad, y un resumen por centro con lo que quedó sin enlace o sin centro.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { monto, fechaDia } from "@/lib/format";
import { useListaParametro } from "@/lib/lista-parametro";
import { pedir } from "../../cotizaciones/_components/comercial";

type Item = {
  id: string;
  codigo: string;
  descripcion: string;
  centroOrigen: string | null;
  precio: number;
  costoDirecto: number | null;
  costoIndirecto: number | null;
  costoTotal: number | null;
  recargo: number | null;
  neto: number | null;
  iva: number | null;
  precioIvaIncluido: number | null;
  enlace: string | null;
  catEnsayoCodigo: string | null;
  catEnsayoNombre: string | null;
  catLaboratorio: string | null;
  centroCostoCodigo: string | null;
  unidadCodigo: string | null;
  unidadNombre: string | null;
};
type Centro = { centro: string; centroCosto: string | null; unidad: string | null; items: number; enlazados: number; porCodigo: number; porNombre: number; manuales: number; sinCentroCosto: boolean };
type Detalle = {
  lista: { id: string; codigo: string; nombre: string; moneda: string; vigenteDesde: string; vigenteHasta: string | null; activa: boolean; fuente: string | null };
  resumen: { items: number; enlazados: number; sinEnlace: number; conCostos: boolean; porCentro: Centro[]; centrosSinCentroCosto: string[] };
  data: Item[];
  meta: { page: number; limit: number; total: number };
};

const ENLACE: Record<string, string> = { codigo: "por código EN", nombre: "por nombre", nombre_base: "por nombre sin método", manual: "manual" };

export default function ListaPrecioDetallePage() {
  const { id } = useParams<{ id: string }>();
  const monedas = useListaParametro("moneda");
  const [d, setD] = useState<Detalle | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [buscar, setBuscar] = useState("");
  const [centro, setCentro] = useState("");
  const [enlace, setEnlace] = useState("");
  const [page, setPage] = useState(1);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => { setBuscar(q); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!id) return;
    setCargando(true);
    const qs = new URLSearchParams({ page: String(page), limit: "50" });
    if (buscar.trim()) qs.set("q", buscar.trim());
    if (centro) qs.set("centro", centro);
    if (enlace) qs.set("enlace", enlace);
    pedir<Detalle>("GET", `/listas-precio/${id}/detalle?${qs}`)
      .then((r) => { setD(r); setError(""); })
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
  }, [id, buscar, centro, enlace, page]);

  const l = d?.lista;
  const r = d?.resumen;
  const paginas = d ? Math.max(1, Math.ceil(d.meta.total / d.meta.limit)) : 1;
  const hoy = new Date().toISOString().slice(0, 10);
  // Frente f5: moneda fuera de la lista del parámetro «moneda» (CLP, USD) = histórica.
  const historica = !!l?.moneda && monedas.cargado && !monedas.vigente(l.moneda);
  const vigente = l ? !historica && l.activa && String(l.vigenteDesde).slice(0, 10) <= hoy && (!l.vigenteHasta || String(l.vigenteHasta).slice(0, 10) >= hoy) : false;

  return (
    <div>
      <p style={{ margin: "0 0 4px" }}><Link href={"/listas-precio" as any} className="btn outline sm">← Listas de precio</Link></p>
      <h1 className="page">
        {l ? l.nombre : "Lista de precios"} {l && <span className="codigo">{l.codigo}</span>}{" "}
        {l && <span className={`pill ${vigente ? "green" : "amber"}`}>{vigente ? "vigente" : "no vigente"}</span>}
      </h1>
      {l && (
        <p className="subtitle">
          Vigente desde {fechaDia(l.vigenteDesde)}{l.vigenteHasta ? ` hasta ${fechaDia(l.vigenteHasta)}` : ""} · {l.moneda}
          {l.fuente ? ` · Fuente: ${l.fuente}` : ""}
        </p>
      )}
      {l && historica && (
        <div className="alert info" role="note">
          Lista en {l.moneda}, una moneda histórica (dato migrado): se muestra tal cual, sin convertir, y es de solo lectura.
          El LIMS trabaja en CLP y USD; la cotización no toma precios de esta lista.
        </div>
      )}
      {error && <div className="alert warn" role="alert">{error}</div>}

      {r && r.conCostos && (
        <div className="card">
          <h2>Cómo se calcula el precio</h2>
          <p style={{ margin: "0 0 8px", fontSize: 13 }}>
            Costo indirecto = 20 % del costo directo · Costo total = directo + indirecto (precio Ejército) · Recargo = 30 % del costo total ·
            <b> Neto = costo total + recargo</b> (precio particular sin IVA: lo toma la cotización a un cliente particular) · IVA 19 % del neto.
          </p>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 13 }}>
            <span><b>{r.items}</b> servicios</span>
            <span><b>{r.enlazados}</b> enlazados con el catálogo</span>
            <span><b>{r.sinEnlace}</b> sin enlace (no se pueden cotizar como ensayo hasta enlazarlos)</span>
            {r.centrosSinCentroCosto.length > 0 && <span>Centros sin centro de costo en el LIMS: <b>{r.centrosSinCentroCosto.join(", ")}</b></span>}
          </div>
          <table className="data" style={{ marginTop: 10 }}>
            <thead>
              <tr><th>Centro (lista)</th><th>Centro de costo</th><th>Unidad</th><th className="num">Servicios</th><th className="num">Enlazados</th><th className="num">Sin enlace</th></tr>
            </thead>
            <tbody>
              {r.porCentro.map((c) => (
                <tr key={c.centro || "vacio"}>
                  <td><button className="btn outline sm" aria-pressed={centro === c.centro} onClick={() => { setCentro(centro === c.centro ? "" : c.centro); setPage(1); }}>{c.centro || "(vacío)"}</button></td>
                  <td>{c.centroCosto ?? <span className="pill amber">no existe</span>}</td>
                  <td>{c.unidad ?? <span className="pill amber">sin unidad</span>}</td>
                  <td className="num">{c.items}</td>
                  <td className="num">{c.enlazados}</td>
                  <td className="num">{c.items - c.enlazados}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="toolbar" style={{ flexWrap: "wrap", gap: 6 }}>
        <input aria-label="Buscar en la lista" placeholder="Buscar por código EN, nombre o ensayo del catálogo…" style={{ flex: 1, minWidth: 220 }} value={q} onChange={(e) => setQ(e.target.value)} />
        <label htmlFor="f-enlace" className="sr-only">Enlace con el catálogo</label>
        <select id="f-enlace" value={enlace} onChange={(e) => { setEnlace(e.target.value); setPage(1); }}>
          <option value="">Todos los servicios</option>
          <option value="si">Enlazados con el catálogo</option>
          <option value="no">Sin enlace</option>
          <option value="codigo">Enlazados por código EN</option>
          <option value="nombre">Enlazados por nombre</option>
          <option value="nombre_base">Enlazados por nombre sin método</option>
        </select>
        {centro && <button className="btn outline sm" onClick={() => setCentro("")}>Centro {centro} ✕</button>}
      </div>

      <div className="card card--table" style={{ overflowX: "auto" }}>
        <table className="data">
          <thead>
            <tr>
              <th>Código</th>
              <th>Servicio</th>
              <th>Centro</th>
              <th className="num">Costo directo</th>
              <th className="num">Indirecto</th>
              <th className="num">Costo total</th>
              <th className="num">Recargo</th>
              <th className="num">Neto</th>
              <th className="num">IVA</th>
              <th className="num">Precio particular</th>
            </tr>
          </thead>
          <tbody>
            {(d?.data ?? []).map((i) => (
              <tr key={i.id}>
                <td style={{ whiteSpace: "nowrap" }}><span className="codigo">{i.codigo}</span></td>
                <td style={{ minWidth: 220 }}>
                  {i.descripcion}
                  <small style={{ display: "block", color: "var(--muted)", marginTop: 2 }}>
                    {i.catEnsayoCodigo ? (
                      <>Catálogo: <span className="codigo">{i.catEnsayoCodigo}</span> {i.catEnsayoNombre} · {ENLACE[i.enlace ?? ""] ?? i.enlace}</>
                    ) : (
                      <span className="pill amber">sin enlace con el catálogo</span>
                    )}
                  </small>
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {i.centroOrigen ?? "—"}
                  <small style={{ display: "block", color: "var(--muted)" }}>{i.centroCostoCodigo ?? "sin centro de costo"}{i.unidadCodigo ? ` · ${i.unidadCodigo}` : ""}</small>
                </td>
                <td className="num">{i.costoDirecto != null ? monto(i.costoDirecto, l?.moneda) : "—"}</td>
                <td className="num">{i.costoIndirecto != null ? monto(i.costoIndirecto, l?.moneda) : "—"}</td>
                <td className="num">{i.costoTotal != null ? monto(i.costoTotal, l?.moneda) : "—"}</td>
                <td className="num">{i.recargo != null ? monto(i.recargo, l?.moneda) : "—"}</td>
                <td className="num"><b>{monto(i.neto ?? i.precio, l?.moneda)}</b></td>
                <td className="num">{i.iva != null ? monto(i.iva, l?.moneda) : "—"}</td>
                <td className="num">{i.precioIvaIncluido != null ? monto(i.precioIvaIncluido, l?.moneda) : "—"}</td>
              </tr>
            ))}
            {!cargando && d && d.data.length === 0 && (
              <tr><td colSpan={10} style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>Sin servicios para este filtro.</td></tr>
            )}
            {cargando && (
              <tr><td colSpan={10} style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>Cargando…</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {d && d.meta.total > d.meta.limit && (
        <div className="toolbar" style={{ justifyContent: "flex-end", gap: 6 }}>
          <button className="btn outline sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹ Anterior</button>
          <span style={{ fontSize: 13 }}>Página {page} de {paginas} · {d.meta.total} servicios</span>
          <button className="btn outline sm" disabled={page >= paginas} onClick={() => setPage(page + 1)}>Siguiente ›</button>
        </div>
      )}
    </div>
  );
}
