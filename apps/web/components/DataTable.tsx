"use client";

/**
 * DataTable · tabla compartida con buscador por columna, orden por columna,
 * búsqueda de cabecera (por los campos clave) y paginación numerada.
 *
 * Todo el filtrado/orden/paginación es CLIENT-SIDE sobre las `rows` recibidas,
 * por lo que es correcto para las páginas que cargan la lista completa (OT,
 * clientes, cotizaciones, usuarios, …) y para envolver la lista ya paginada de
 * CrudTable. No depende de librerías externas.
 */

import { useMemo, useState, useId, type ReactNode } from "react";

export interface DataColumn {
  key: string;
  label: string;
  /** alinea a la derecha (números). */
  num?: boolean;
  /** columna ordenable (por defecto true). */
  sortable?: boolean;
  /** columna con filtro propio bajo la cabecera (por defecto true). */
  filter?: boolean;
  /** render personalizado de la celda (Link, badges, …). */
  render?: (row: any) => ReactNode;
  /** valor comparable para orden/filtro/búsqueda. Por defecto row[key]. */
  value?: (row: any) => string | number | null | undefined;
}

export interface DataTableProps {
  columns: DataColumn[];
  rows: any[];
  /** clave estable de cada fila (por defecto row.id). */
  rowKey?: (row: any) => string;
  /** click en fila (opcional). */
  onRowClick?: (row: any) => void;
  /** columna(s) extra al final (acciones), no ordenable ni filtrable. */
  acciones?: (row: any) => ReactNode;
  accionesLabel?: string;
  /** muestra el buscador de cabecera (client-side sobre searchKeys). */
  headerSearch?: boolean;
  /** claves usadas por el buscador de cabecera (los "metadatos principales"). Por defecto las 3 primeras columnas. */
  searchKeys?: string[];
  /** tamaño de página inicial. */
  pageSize?: number;
  /** paginación numerada client-side (por defecto true). false = muestra todas las
   *  filas ya ordenadas/filtradas (útil cuando el contenedor pagina en servidor). */
  paginate?: boolean;
  loading?: boolean;
  vacio?: ReactNode;
}

const rawValue = (col: DataColumn, row: any) =>
  col.value ? col.value(row) : row[col.key];

const asText = (v: unknown) =>
  v == null ? "" : String(v).toLowerCase();

export default function DataTable({
  columns, rows, rowKey, onRowClick, acciones, accionesLabel = "Acciones",
  headerSearch = true, searchKeys, pageSize = 20, paginate = true, loading = false, vacio,
}: DataTableProps) {
  const uid = useId();
  const [q, setQ] = useState("");
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(pageSize);
  const [showFilters, setShowFilters] = useState(false);

  const keys = searchKeys ?? columns.slice(0, 3).map((c) => c.key);
  const colByKey = useMemo(() => Object.fromEntries(columns.map((c) => [c.key, c])), [columns]);

  // --- filtrado ---
  const filtradas = useMemo(() => {
    let out = rows;
    // buscador de cabecera: cualquier campo clave contiene q
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      out = out.filter((row) =>
        keys.some((k) => {
          const col = colByKey[k];
          const v = col ? rawValue(col, row) : row[k];
          return asText(v).includes(needle);
        }),
      );
    }
    // filtros por columna
    const activos = Object.entries(colFilters).filter(([, v]) => v.trim());
    if (activos.length) {
      out = out.filter((row) =>
        activos.every(([k, v]) => {
          const col = colByKey[k];
          const cell = col ? rawValue(col, row) : row[k];
          return asText(cell).includes(v.trim().toLowerCase());
        }),
      );
    }
    return out;
  }, [rows, q, colFilters, keys, colByKey]);

  // --- orden ---
  const ordenadas = useMemo(() => {
    if (!sortKey) return filtradas;
    const col = colByKey[sortKey];
    if (!col) return filtradas;
    const arr = [...filtradas];
    arr.sort((a, b) => {
      const va = rawValue(col, a); const vb = rawValue(col, b);
      // números si ambos parsean número; si no, texto localizado
      const na = typeof va === "number" ? va : parseFloat(String(va));
      const nb = typeof vb === "number" ? vb : parseFloat(String(vb));
      let cmp: number;
      if (!Number.isNaN(na) && !Number.isNaN(nb) && String(va).trim() !== "" && String(vb).trim() !== "") {
        cmp = na - nb;
      } else {
        cmp = asText(va).localeCompare(asText(vb), "es");
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtradas, sortKey, sortDir, colByKey]);

  // --- paginación ---
  const total = ordenadas.length;
  const totalPages = paginate ? Math.max(1, Math.ceil(total / size)) : 1;
  const pageSafe = Math.min(page, totalPages);
  const inicio = (pageSafe - 1) * size;
  const visibles = paginate ? ordenadas.slice(inicio, inicio + size) : ordenadas;

  function ordenarPor(k: string) {
    const col = colByKey[k];
    if (col && col.sortable === false) return;
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  }
  function setFiltro(k: string, v: string) {
    setPage(1);
    setColFilters((f) => ({ ...f, [k]: v }));
  }

  const nCols = columns.length + (acciones ? 1 : 0);
  const hayFiltrosCol = columns.some((c) => c.filter !== false);

  // ventana de botones de página (máx 7 visibles)
  const paginas: number[] = [];
  const win = 2;
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || (p >= pageSafe - win && p <= pageSafe + win)) paginas.push(p);
  }

  return (
    <div>
      {(headerSearch || hayFiltrosCol) && (
        <div className="toolbar" style={{ gap: 8 }}>
          {headerSearch && (
            <input
              placeholder={`Buscar por ${keys.map((k) => colByKey[k]?.label ?? k).slice(0, 3).join(", ")}…`}
              style={{ flex: 1, minWidth: 220 }}
              value={q}
              onChange={(e) => { setPage(1); setQ(e.target.value); }}
              aria-label="Buscar"
            />
          )}
          {hayFiltrosCol && (
            <button type="button" className="btn outline sm" onClick={() => setShowFilters((s) => !s)}
              title="Filtro por columna">
              {showFilters ? "Ocultar filtros" : "Filtros por columna"}
            </button>
          )}
          <span className="subtitle" style={{ margin: 0, whiteSpace: "nowrap" }}>{total} registro(s)</span>
        </div>
      )}

      <div className="card card--table">
        <table className="data">
          <thead>
            <tr>
              {columns.map((c) => {
                const sortable = c.sortable !== false;
                const activo = sortKey === c.key;
                return (
                  <th key={c.key} className={c.num ? "num" : ""}
                    onClick={sortable ? () => ordenarPor(c.key) : undefined}
                    style={sortable ? { cursor: "pointer", userSelect: "none" } : undefined}
                    title={sortable ? "Ordenar" : undefined}>
                    {c.label}
                    {sortable && (
                      <span style={{ marginLeft: 4, color: activo ? "var(--accent, #2b5a8c)" : "var(--muted)", fontSize: 11 }}>
                        {activo ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}
                      </span>
                    )}
                  </th>
                );
              })}
              {acciones && <th className="num">{accionesLabel}</th>}
            </tr>
            {showFilters && hayFiltrosCol && (
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className={c.num ? "num" : ""} style={{ paddingTop: 4, paddingBottom: 6 }}>
                    {c.filter !== false ? (
                      <input
                        aria-label={`Filtrar ${c.label}`}
                        placeholder={`Filtrar ${c.label}…`}
                        value={colFilters[c.key] ?? ""}
                        onChange={(e) => setFiltro(c.key, e.target.value)}
                        style={{ width: "100%", fontSize: 12, padding: "3px 6px", fontWeight: 400 }}
                      />
                    ) : null}
                  </th>
                ))}
                {acciones && <th />}
              </tr>
            )}
          </thead>
          <tbody>
            {visibles.map((row) => (
              <tr key={rowKey ? rowKey(row) : row.id}
                className={onRowClick ? "row-action" : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                style={onRowClick ? { cursor: "pointer" } : undefined}>
                {columns.map((c) => (
                  <td key={c.key} className={c.num ? "num" : ""}>
                    {c.render ? c.render(row) : (rawValue(c, row) ?? "—")}
                  </td>
                ))}
                {acciones && <td className="num" onClick={(e) => e.stopPropagation()}>{acciones(row)}</td>}
              </tr>
            ))}
            {!loading && total === 0 && (
              <tr><td colSpan={nCols} style={{ textAlign: "center", padding: 28, color: "var(--muted)" }}>
                {vacio ?? "Sin resultados"}
              </td></tr>
            )}
            {loading && (
              <tr><td colSpan={nCols} style={{ textAlign: "center", padding: 28, color: "var(--muted)" }}>Cargando…</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {paginate && total > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12, fontSize: 12.5, flexWrap: "wrap" }}>
          <button className="btn outline sm" disabled={pageSafe <= 1} onClick={() => setPage(pageSafe - 1)}>← Anterior</button>
          {paginas.map((p, i) => {
            const gap = i > 0 && p - paginas[i - 1] > 1;
            return (
              <span key={p} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                {gap && <span style={{ color: "var(--muted)" }}>…</span>}
                <button
                  className={`btn sm ${p === pageSafe ? "primary" : "outline"}`}
                  onClick={() => setPage(p)}
                  aria-current={p === pageSafe ? "page" : undefined}
                >{p}</button>
              </span>
            );
          })}
          <button className="btn outline sm" disabled={pageSafe >= totalPages} onClick={() => setPage(pageSafe + 1)}>Siguiente →</button>
          <span className="subtitle" style={{ margin: "0 0 0 8px" }}>
            {inicio + 1}–{Math.min(inicio + size, total)} de {total}
          </span>
          <select value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(1); }}
            aria-label="Filas por página" style={{ width: "auto", marginLeft: 6, fontSize: 12, padding: "2px 6px" }}>
            {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n}/pág</option>)}
          </select>
        </div>
      )}
    </div>
  );
}
