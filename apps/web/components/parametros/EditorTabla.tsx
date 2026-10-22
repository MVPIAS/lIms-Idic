"use client";

/**
 * Editor de un parámetro de tipo «tabla» (tabla de amenazas del LRB, HCP por
 * tipo de vehículo, planes n, c, m, M, rangos sensoriales): filas con columnas
 * tipadas, búsqueda, páginas de 20 filas y «Pegar desde Excel» (columnas
 * separadas por tabulador, en el orden de la tabla; la primera fila puede ser
 * el encabezado). El servidor valida y explica cada error por fila.
 */
import { useMemo, useState } from "react";

export interface ColumnaTabla {
  clave: string;
  etiqueta: string;
  tipo: "texto" | "numero" | "entero" | "opcion" | "sino";
  opciones?: { valor: string; etiqueta: string }[];
  obligatoria?: boolean;
  min?: number;
  max?: number;
  largo?: number;
}

const POR_PAGINA = 20;
const comoTexto = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "number" ? String(v).replace(".", ",") : String(v));

export default function EditorTabla({ id, columnas, maxFilas, filas, onCambio }: {
  id: string; columnas: ColumnaTabla[]; maxFilas: number; filas: Record<string, unknown>[]; onCambio: (f: Record<string, unknown>[]) => void;
}) {
  const [buscar, setBuscar] = useState("");
  const [pagina, setPagina] = useState(0);
  const [pegando, setPegando] = useState(false);
  const [pegado, setPegado] = useState("");
  const [reemplazar, setReemplazar] = useState(false);

  const indices = useMemo(() => {
    const t = buscar.trim().toLowerCase();
    return filas.map((_, i) => i).filter((i) => !t || columnas.some((c) => comoTexto(filas[i][c.clave]).toLowerCase().includes(t)));
  }, [filas, buscar, columnas]);
  const paginas = Math.max(1, Math.ceil(indices.length / POR_PAGINA));
  const pag = Math.min(pagina, paginas - 1);
  const visibles = indices.slice(pag * POR_PAGINA, pag * POR_PAGINA + POR_PAGINA);

  const set = (i: number, clave: string, v: unknown) => onCambio(filas.map((f, k) => (k === i ? { ...f, [clave]: v } : f)));
  const vacia = () => Object.fromEntries(columnas.map((c) => [c.clave, c.tipo === "sino" ? false : ""]));

  function aplicarPegado() {
    const lineas = pegado.replace(/\r/g, "").split("\n").filter((l) => l.trim());
    if (!lineas.length) return;
    const primera = lineas[0].split("\t").map((x) => x.trim().toLowerCase());
    const conEncabezado = columnas.some((c) => primera.includes(c.etiqueta.toLowerCase()) || primera.includes(c.clave.toLowerCase()));
    const nuevas = (conEncabezado ? lineas.slice(1) : lineas).map((l) => {
      const celdas = l.split("\t");
      return Object.fromEntries(columnas.map((c, j) => {
        const v = (celdas[j] ?? "").trim();
        return [c.clave, c.tipo === "sino" ? /^(si|sí|true|1|x)$/i.test(v) : v];
      }));
    });
    onCambio(reemplazar ? nuevas : [...filas, ...nuevas]);
    setPegado("");
    setPegando(false);
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div className="toolbar" style={{ margin: 0 }}>
        <input aria-label="Buscar en la tabla" placeholder="Buscar…" value={buscar} onChange={(e) => { setBuscar(e.target.value); setPagina(0); }} style={{ minWidth: 200 }} />
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{filas.length} fila(s){indices.length !== filas.length ? ` · ${indices.length} encontradas` : ""} · máximo {maxFilas}</span>
        <div className="spacer" />
        <button type="button" className="btn outline sm" disabled={filas.length >= maxFilas} onClick={() => { onCambio([...filas, vacia()]); setBuscar(""); setPagina(Math.floor(filas.length / POR_PAGINA)); }}>＋ Fila</button>
        <button type="button" className="btn outline sm" aria-expanded={pegando} onClick={() => setPegando((x) => !x)}>Pegar desde Excel</button>
      </div>
      {pegando && (
        <div style={{ border: "1px dashed var(--line)", borderRadius: 8, padding: 8 }}>
          <label htmlFor={`${id}-pegar`} style={{ fontSize: 12, fontWeight: 600 }}>Copie las columnas en este orden ({columnas.map((c) => c.etiqueta).join(" · ")}) y péguelas aquí</label>
          <textarea id={`${id}-pegar`} rows={5} value={pegado} onChange={(e) => setPegado(e.target.value)} style={{ width: "100%", fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5 }} />
          <div className="toolbar" style={{ margin: "6px 0 0" }}>
            <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={reemplazar} onChange={(e) => setReemplazar(e.target.checked)} style={{ width: "auto" }} /> Reemplazar todas las filas</label>
            <div className="spacer" />
            <button type="button" className="btn primary sm" disabled={!pegado.trim()} onClick={aplicarPegado}>Agregar las filas pegadas</button>
          </div>
        </div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table className="data">
          <thead>
            <tr>
              {columnas.map((c) => <th key={c.clave} className={c.tipo === "numero" || c.tipo === "entero" ? "num" : undefined}>{c.etiqueta}{c.obligatoria ? <span className="req"> *</span> : null}</th>)}
              <th />
            </tr>
          </thead>
          <tbody>
            {visibles.length === 0 && <tr><td colSpan={columnas.length + 1} style={{ color: "var(--muted)" }}>Sin filas.</td></tr>}
            {visibles.map((i) => (
              <tr key={i}>
                {columnas.map((c) => {
                  const v = filas[i][c.clave];
                  const etiqueta = `${c.etiqueta} de la fila ${i + 1}`;
                  if (c.tipo === "sino") return <td key={c.clave}><input type="checkbox" aria-label={etiqueta} checked={v === true} onChange={(e) => set(i, c.clave, e.target.checked)} style={{ width: "auto" }} /></td>;
                  if (c.tipo === "opcion")
                    return (
                      <td key={c.clave}>
                        <select className="celda" aria-label={etiqueta} value={comoTexto(v)} onChange={(e) => set(i, c.clave, e.target.value)}>
                          <option value="">—</option>
                          {(c.opciones ?? []).map((o) => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
                        </select>
                      </td>
                    );
                  const ancho = c.tipo === "texto" ? ((c.largo ?? 40) > 100 ? 320 : (c.largo ?? 40) > 30 ? 160 : 90) : 76;
                  return (
                    <td key={c.clave} className={c.tipo !== "texto" ? "num" : undefined}>
                      {c.tipo === "texto" && (c.largo ?? 0) > 100 ? (
                        <textarea className="celda" aria-label={etiqueta} rows={2} value={comoTexto(v)} maxLength={c.largo} onChange={(e) => set(i, c.clave, e.target.value)} style={{ width: ancho, fontSize: 12 }} />
                      ) : (
                        <input className="celda" aria-label={etiqueta} value={comoTexto(v)} maxLength={c.largo} inputMode={c.tipo === "texto" ? undefined : "decimal"} onChange={(e) => set(i, c.clave, e.target.value)} style={{ width: ancho, textAlign: c.tipo === "texto" ? undefined : "right" }} />
                      )}
                    </td>
                  );
                })}
                <td><button type="button" className="btn outline sm" aria-label={`Quitar la fila ${i + 1}`} onClick={() => onCambio(filas.filter((_, k) => k !== i))}>Quitar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {paginas > 1 && (
        <div className="toolbar" style={{ margin: 0 }}>
          <button type="button" className="btn outline sm" disabled={pag === 0} onClick={() => setPagina(pag - 1)}>← Anterior</button>
          <span style={{ fontSize: 12 }}>Página {pag + 1} de {paginas}</span>
          <button type="button" className="btn outline sm" disabled={pag >= paginas - 1} onClick={() => setPagina(pag + 1)}>Siguiente →</button>
        </div>
      )}
    </div>
  );
}
