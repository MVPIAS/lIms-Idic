"use client";

/**
 * /zona-informes/[clave] · un reporte fijo: filtros, tabla con totales y
 * descarga en Excel. Datos: GET /zona-informes/:clave (acotado al alcance de
 * quien consulta); Excel: GET /zona-informes/:clave/excel con los mismos filtros.
 */
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { llamar } from "@/lib/laboratorio";
import { hoyChile } from "@/lib/fecha-chile";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";

interface Columna {
  clave: string;
  titulo: string;
  tipo: "texto" | "fecha" | "fechahora" | "numero" | "monto" | "dias" | "estado" | "si_no";
  total?: boolean;
}
interface Informe {
  clave: string;
  titulo: string;
  area: string;
  descripcion: string;
  legado: string[];
  pedido?: string | null;
  filtros: ("fecha" | "laboratorio" | "centroCosto" | "estado" | "texto")[];
  columnas: Columna[];
  filas: Record<string, string | number | null>[];
  totales: Record<string, number>;
  truncado: boolean;
  limite: number;
}
interface Opcion {
  valor: string;
  texto: string;
}

const NUM = new Set(["numero", "monto", "dias"]);
const fmt = (c: Columna, v: string | number | null | undefined) => {
  if (v === null || v === undefined || v === "") return "—";
  if (c.tipo === "monto") return Number(v).toLocaleString("es-CL", { maximumFractionDigits: 0 });
  if (c.tipo === "numero") return Number(v).toLocaleString("es-CL", { maximumFractionDigits: 2 });
  return String(v);
};

function primerDiaDelAnio() {
  return `${hoyChile().slice(0, 4)}-01-01`;
}

export default function InformeFijoPage() {
  const { clave } = useParams<{ clave: string }>();
  const [inf, setInf] = useState<Informe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [desde, setDesde] = useState(primerDiaDelAnio());
  const [hasta, setHasta] = useState("");
  const [laboratorio, setLaboratorio] = useState("");
  const [centroCosto, setCentroCosto] = useState("");
  const [estado, setEstado] = useState("");
  const [texto, setTexto] = useState("");
  const [labs, setLabs] = useState<Opcion[]>([]);
  const [ccs, setCcs] = useState<Opcion[]>([]);
  const [estados, setEstados] = useState<Opcion[]>([]);
  const [filtros, setFiltros] = useState<Informe["filtros"] | null>(null);

  const query = useCallback(() => {
    const p = new URLSearchParams();
    const f = filtros ?? [];
    if (f.includes("fecha")) {
      if (desde) p.set("desde", desde);
      if (hasta) p.set("hasta", hasta);
    }
    if (f.includes("laboratorio") && laboratorio) p.set("laboratorio", laboratorio);
    if (f.includes("centroCosto") && centroCosto) p.set("centroCosto", centroCosto);
    if (f.includes("estado") && estado) p.set("estado", estado);
    if (f.includes("texto") && texto.trim()) p.set("texto", texto.trim());
    return p.toString();
  }, [filtros, desde, hasta, laboratorio, centroCosto, estado, texto]);

  const consultar = useCallback(
    async (primera = false) => {
      setCargando(true);
      setError(null);
      try {
        const qs = primera ? "" : query();
        const r = await llamar<Informe>("GET", `/zona-informes/${clave}${qs ? `?${qs}` : ""}`);
        setInf(r);
        if (primera) setFiltros(r.filtros);
      } catch (e: any) {
        setError(e?.message ?? "No se pudo obtener el informe.");
      } finally {
        setCargando(false);
      }
    },
    [clave, query],
  );

  // Primera carga: conocer los filtros del informe y mostrar el año en curso.
  useEffect(() => {
    llamar<Informe>("GET", `/zona-informes/${clave}?desde=${primerDiaDelAnio()}`)
      .then((r) => {
        setInf(r);
        setFiltros(r.filtros);
        if (!r.filtros.includes("fecha")) setDesde("");
      })
      .catch(() =>
        // El informe no se filtra por fecha (p. ej. el catálogo de ensayos).
        consultar(true),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  useEffect(() => {
    if (!filtros) return;
    if (filtros.includes("laboratorio"))
      llamar<any>("GET", "/unidades")
        .then((r) =>
          setLabs(
            (Array.isArray(r) ? r : r?.data ?? [])
              .filter((u: any) => u.activo !== false)
              .map((u: any) => ({ valor: u.id, texto: u.sigla ? `${u.sigla} · ${u.nombre}` : u.nombre })),
          ),
        )
        .catch(() => setLabs([]));
    if (filtros.includes("centroCosto"))
      llamar<any>("GET", "/centros-costo?limit=500")
        .then((r) =>
          setCcs(
            (r?.data ?? []).map((c: any) => ({ valor: c.id, texto: [c.codigo, c.nombre ?? c.descripcion].filter(Boolean).join(" · ") })),
          ),
        )
        .catch(() => setCcs([]));
    if (filtros.includes("estado"))
      llamar<Opcion[]>("GET", `/zona-informes/${clave}/estados`)
        .then(setEstados)
        .catch(() => setEstados([]));
  }, [filtros, clave]);

  async function excel() {
    setError(null);
    try {
      const t = localStorage.getItem("lims_token");
      const qs = query();
      const r = await fetch(`${API}/zona-informes/${clave}/excel${qs ? `?${qs}` : ""}`, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.message ?? `Error ${r.status}`);
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `${clave}${desde ? `_${desde}` : ""}${hasta ? `_${hasta}` : ""}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo descargar el Excel.");
    }
  }

  const f = filtros ?? [];

  return (
    <div>
      <div style={{ fontSize: 12, marginBottom: 6 }}>
        <Link href="/zona-informes">← Zona de informes</Link>
        {inf ? <span style={{ color: "var(--muted)" }}> · {inf.area}</span> : null}
      </div>
      <h1 className="page">📊 {inf?.titulo ?? "Informe"}</h1>
      {inf ? (
        <p className="subtitle">
          {inf.descripcion}{" "}
          <span style={{ fontSize: 11.5 }}>
            {inf.legado.length > 0 ? <>Reemplaza a: <span className="codigo">{inf.legado.join(", ")}</span></> : null}
            {inf.pedido ? <> Pedido: {inf.pedido}</> : null}
          </span>
        </p>
      ) : null}

      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          consultar();
        }}
      >
        {f.includes("fecha") ? (
          <>
            <label style={{ fontSize: 12 }}>
              Desde <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
            </label>
            <label style={{ fontSize: 12 }}>
              Hasta <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </label>
          </>
        ) : null}
        {f.includes("laboratorio") ? (
          <select value={laboratorio} onChange={(e) => setLaboratorio(e.target.value)} aria-label="Laboratorio">
            <option value="">Todos los laboratorios</option>
            {labs.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.texto}
              </option>
            ))}
          </select>
        ) : null}
        {f.includes("centroCosto") ? (
          <select value={centroCosto} onChange={(e) => setCentroCosto(e.target.value)} aria-label="Centro de costo" style={{ maxWidth: 240 }}>
            <option value="">Todos los centros de costo</option>
            {ccs.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.texto}
              </option>
            ))}
          </select>
        ) : null}
        {f.includes("estado") ? (
          <select value={estado} onChange={(e) => setEstado(e.target.value)} aria-label="Estado">
            <option value="">Todos los estados</option>
            {estados.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.texto}
              </option>
            ))}
          </select>
        ) : null}
        {f.includes("texto") ? (
          <input type="search" placeholder="Buscar (código, cliente, RUT…)" value={texto} onChange={(e) => setTexto(e.target.value)} />
        ) : null}
        <button className="btn primary sm" type="submit" disabled={cargando}>
          {cargando ? "Consultando…" : "Ver informe"}
        </button>
        <span className="spacer" />
        <button className="btn sm outline" type="button" onClick={excel} disabled={!inf}>
          ⬇ Descargar Excel
        </button>
      </form>

      {error ? <div className="alert warn">{error}</div> : null}
      {inf?.truncado ? (
        <div className="alert warn">Se muestran las primeras {inf.limite.toLocaleString("es-CL")} filas. Acote el período o los filtros para ver el resto.</div>
      ) : null}

      {inf ? (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table className="data">
            <thead>
              <tr>
                {inf.columnas.map((c) => (
                  <th key={c.clave} className={NUM.has(c.tipo) ? "num" : undefined}>
                    {c.titulo}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {inf.filas.length === 0 ? (
                <tr>
                  <td colSpan={inf.columnas.length} style={{ color: "var(--muted)", padding: 14 }}>
                    No hay datos para los filtros elegidos.
                  </td>
                </tr>
              ) : (
                inf.filas.map((fila, i) => (
                  <tr key={i}>
                    {inf.columnas.map((c) => (
                      <td key={c.clave} className={NUM.has(c.tipo) ? "num" : undefined}>
                        {fmt(c, fila[c.clave])}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
            {inf.filas.length ? (
              <tfoot>
                <tr>
                  {inf.columnas.map((c, i) => (
                    <td key={c.clave} className={NUM.has(c.tipo) ? "num" : undefined} style={{ fontWeight: 700, borderTop: "2px solid var(--line)" }}>
                      {i === 0 ? `Total · ${inf.filas.length.toLocaleString("es-CL")} filas` : c.total ? fmt(c, inf.totales[c.clave]) : ""}
                    </td>
                  ))}
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      ) : !error ? (
        <div className="card">Cargando…</div>
      ) : null}
    </div>
  );
}
