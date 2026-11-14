"use client";

/**
 * /zona-informes · Zona de informes: una sola entrada para todos los informes.
 *  - Reportes fijos por área (listados y gestión con filtros, en pantalla y Excel).
 *  - Documentos por OT (se emiten con el repositorio de plantillas).
 * Cada informe muestra el nombre del archivo del sistema anterior (Crystal
 * Reports) al que reemplaza, para que el usuario lo encuentre por ese nombre.
 * Catálogo: GET /zona-informes (solo lo que el usuario puede abrir).
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import RequierePermiso from "@/components/RequierePermiso";
import { llamar } from "@/lib/laboratorio";

interface Reporte {
  clave: string;
  titulo: string;
  area: string;
  descripcion: string;
  legado: string[];
  pedido?: string | null;
  /** Informe con pantalla propia (p. ej. el trimestral de encuestas). */
  ruta?: string | null;
}
interface Documento {
  tipo: string;
  titulo: string;
  descripcion: string;
  plantillas: number;
  legado: { archivo: string; titulo: string | null; area: string }[];
}
interface Catalogo {
  areas: string[];
  reportes: Reporte[];
  documentos: Documento[];
  puede: { emitir: boolean; verDocumentos: boolean; verPlantillas: boolean };
}

const normal = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

export default function ZonaInformesPage() {
  return (
    <RequierePermiso perm={["reporte.ver", "reporte.comercial.ver", "encuesta.ver"]} titulo="Zona de informes">
      <Zona />
    </RequierePermiso>
  );
}

function Zona() {
  const [cat, setCat] = useState<Catalogo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    llamar<Catalogo>("GET", "/zona-informes")
      .then(setCat)
      .catch((e) => setError(e?.message ?? "No se pudo cargar la Zona de informes."));
  }, []);

  const filtro = normal(q.trim());
  const coincide = (textos: (string | null | undefined)[]) => !filtro || textos.some((t) => t && normal(t).includes(filtro));

  const reportesPorArea = useMemo(() => {
    if (!cat) return [];
    return cat.areas
      .map((a) => ({
        area: a,
        reportes: cat.reportes.filter((r) => r.area === a && coincide([r.titulo, r.descripcion, ...r.legado, r.pedido ?? ""])),
      }))
      .filter((g) => g.reportes.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat, filtro]);

  const documentos = useMemo(
    () => (cat?.documentos ?? []).filter((d) => coincide([d.titulo, d.descripcion, d.tipo, ...d.legado.flatMap((l) => [l.archivo, l.titulo, l.area])])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cat, filtro],
  );

  const totalLegado = cat ? cat.reportes.reduce((s, r) => s + r.legado.length, 0) + cat.documentos.reduce((s, d) => s + d.legado.length, 0) : 0;

  return (
    <div style={{ maxWidth: 1100 }}>
      <h1 className="page">🗂 Zona de informes</h1>
      <p className="subtitle">
        Todos los informes en un solo lugar. Los <b>reportes</b> se filtran por período, laboratorio, centro de costo o estado y se
        descargan en Excel; los <b>documentos por OT</b> se emiten con las plantillas oficiales. Cada informe indica el archivo del sistema
        anterior al que reemplaza: puede buscarlo por ese nombre.
      </p>

      {error ? <div className="alert warn">{error}</div> : null}

      <div className="toolbar">
        <input
          type="search"
          placeholder="Buscar por nombre, área o archivo anterior (p. ej. Infgest06, tasa, deudores)…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1, minWidth: 260 }}
          aria-label="Buscar informe"
        />
        {cat ? (
          <small style={{ color: "var(--muted)" }}>
            {cat.reportes.length} reportes · {cat.documentos.length} tipos de documento · {totalLegado} informes del sistema anterior cubiertos
          </small>
        ) : null}
      </div>

      {!cat && !error ? <div className="card">Cargando informes…</div> : null}

      {reportesPorArea.map((g) => (
        <section key={g.area} style={{ marginBottom: 18 }}>
          <h2 style={{ fontSize: 15, margin: "14px 0 8px" }}>{g.area}</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 10 }}>
            {g.reportes.map((r) => (
              <Link key={r.clave} href={(r.ruta ?? `/zona-informes/${r.clave}`) as any} className="card" style={{ display: "block", textDecoration: "none", color: "inherit", margin: 0 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>📊 {r.titulo}</div>
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 6 }}>{r.descripcion}</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>
                  {r.legado.length > 0 ? <>Reemplaza a: <span className="codigo">{r.legado.join(", ")}</span></> : null}
                  {r.pedido ? <div>Pedido: {r.pedido}</div> : null}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}

      {documentos.length ? (
        <section style={{ marginTop: 22 }}>
          <h2 style={{ fontSize: 15, margin: "14px 0 4px" }}>Documentos por OT</h2>
          <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 0 }}>
            Se emiten desde la OT con la plantilla oficial de cada laboratorio, con firma y código de verificación.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 10 }}>
            {documentos.map((d) => (
              <div key={d.tipo} className="card" style={{ margin: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                  <div style={{ fontWeight: 700 }}>📄 {d.titulo}</div>
                  <span className="pill" title="Plantillas activas de este tipo">
                    {d.plantillas} plantilla{d.plantillas === 1 ? "" : "s"}
                  </span>
                </div>
                <div style={{ fontSize: 12.5, color: "var(--muted)", margin: "4px 0 6px" }}>{d.descripcion}</div>
                <details>
                  <summary style={{ fontSize: 12, cursor: "pointer" }}>{d.legado.length} informes del sistema anterior</summary>
                  <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 11.5, maxHeight: 180, overflowY: "auto" }}>
                    {d.legado.map((l) => (
                      <li key={l.archivo}>
                        <span className="codigo">{l.archivo}</span>
                        {l.titulo ? ` · ${l.titulo}` : ""} <span style={{ color: "var(--muted)" }}>({l.area})</span>
                      </li>
                    ))}
                  </ul>
                </details>
                <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                  {cat?.puede.emitir ? (
                    <Link className="btn sm primary" href="/informes">
                      Emitir desde una OT
                    </Link>
                  ) : null}
                  {cat?.puede.verDocumentos ? (
                    <Link className="btn sm outline" href="/certificados">
                      Ver emitidos
                    </Link>
                  ) : null}
                  {cat?.puede.verPlantillas ? (
                    <Link className="btn sm outline" href="/plantillas">
                      Plantillas
                    </Link>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {cat && !reportesPorArea.length && !documentos.length ? <div className="card">Ningún informe coincide con «{q}».</div> : null}

      <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 18 }}>
        ¿Necesita un cruce que no está aquí? Use <Link href="/reportes">Reportes · exportar</Link> para armar su propia tabla, o{" "}
        <Link href="/bi">Metabase</Link> para gráficos y preguntas libres.
      </p>
    </div>
  );
}
