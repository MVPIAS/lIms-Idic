"use client";

/**
 * Consumibles y bodegas › Solicitudes de adquisición (IDIC-PG06-IT02-FORM01).
 *  · «Todas»: las de su laboratorio (Abastecimiento ve todas), con filtros por estado y laboratorio.
 *  · «Por visar»: enviadas que esperan el V°B° de su jefatura.
 *  · «Por gestionar» (SAB): con V°B°, recibidas o en compra.
 *  · «Mías»: las que usted creó.
 */
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PageHeader, EmptyState, SkeletonRows } from "@/components/ui/PageHeader";
import { llamar, qs } from "@/lib/laboratorio";
import { fechaDia } from "@/lib/format";
import { usePermisos } from "@/lib/permisos";
import { ESTADO_ADQUISICION, pesos } from "@/lib/adquisiciones";

type Vista = "todas" | "por_visar" | "por_gestionar" | "mias";
const VISTAS: Vista[] = ["todas", "por_visar", "por_gestionar", "mias"];

export default function SolicitudesAdquisicionPage() {
  return (
    <Suspense fallback={<p className="subtitle">Cargando…</p>}>
      <Solicitudes />
    </Suspense>
  );
}

function Solicitudes() {
  const params = useSearchParams();
  const inicial = params.get("vista") as Vista;
  const [vista, setVista] = useState<Vista>(VISTAS.includes(inicial) ? inicial : "todas");
  const [estado, setEstado] = useState(params.get("estado") ?? "");
  const [unidadId, setUnidadId] = useState("");
  const [q, setQ] = useState("");
  const [filas, setFilas] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  const [labs, setLabs] = useState<{ id: string; codigo: string }[]>([]);

  const cargar = useCallback(async () => {
    setFilas(null);
    setError("");
    try {
      const r = await llamar<{ data: any[] }>(
        "GET",
        `/solicitudes-adquisicion${qs({ vista: vista === "todas" ? undefined : vista, estado: vista === "por_visar" ? undefined : estado, unidadId, q: q.trim() || undefined })}`,
      );
      setFilas(r.data);
      // Los laboratorios del filtro salen de las solicitudes que la persona puede ver.
      if (vista === "todas" && !estado && !unidadId && !q.trim()) {
        const m = new Map<string, string>();
        r.data.forEach((x) => m.set(x.unidadId, x.unidad));
        setLabs([...m].map(([id, codigo]) => ({ id, codigo })).sort((a, b) => a.codigo.localeCompare(b.codigo)));
      }
    } catch (e: any) {
      setError(e.message);
      setFilas([]);
    }
  }, [vista, estado, unidadId, q]);
  useEffect(() => {
    const t = setTimeout(cargar, 200);
    return () => clearTimeout(t);
  }, [cargar]);

  // Permiso real del token (sin el «ve todo» de ADMIN en la UI): las pestañas son de quien actúa.
  const acceso = usePermisos();
  const tiene = useCallback((p: string) => acceso.roles.includes("SUPERADMIN") || acceso.permisos.has(p), [acceso]);
  const puedeCrear = tiene("adquisicion.crear");
  const visibles = useMemo(() => {
    const out: { v: Vista; t: string }[] = [{ v: "todas", t: "Todas" }];
    if (tiene("adquisicion.visar")) out.push({ v: "por_visar", t: "Por visar" });
    if (tiene("adquisicion.gestionar")) out.push({ v: "por_gestionar", t: "Por gestionar (SAB)" });
    if (puedeCrear) out.push({ v: "mias", t: "Mías" });
    return out;
  }, [puedeCrear, tiene]);

  return (
    <div>
      <PageHeader
        titulo="Solicitudes de adquisición"
        subtitulo="El laboratorio crea la solicitud (formulario IDIC-PG06-IT02-FORM01), su jefatura da el V°B° y Abastecimiento (SAB) la recibe y anota la orden de compra. Funciona a la par con los sistemas de compra de SAB y Finanzas."
        migas={[{ label: "Laboratorio" }, { label: "Solicitudes de adquisición" }]}
        acciones={puedeCrear ? <Link href={"/solicitudes-adquisicion/nueva" as any} className="btn primary sm">＋ Nueva solicitud</Link> : undefined}
      />
      {error && <div className="alert warn" role="alert">{error}</div>}
      <div className="card" style={{ padding: 0 }}>
        <div className="tabs" style={{ padding: "0 8px", display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
          {visibles.map(({ v, t }) => (
            <button key={v} type="button" className={`tab${vista === v ? " active" : ""}`} aria-pressed={vista === v} onClick={() => setVista(v)}>{t}</button>
          ))}
          <span style={{ flex: 1 }} />
          <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center", padding: 6 }}>
            Buscar
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nº, objetivo, O/C o solicitante" aria-label="Buscar solicitudes" style={{ width: 200 }} />
          </label>
          {vista !== "por_visar" && (
            <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center", padding: 6 }}>
              Estado
              <select value={estado} onChange={(e) => setEstado(e.target.value)} aria-label="Filtrar por estado">
                <option value="">Todos</option>
                {Object.entries(ESTADO_ADQUISICION).map(([k, v]) => <option key={k} value={k}>{v.texto}</option>)}
              </select>
            </label>
          )}
          {labs.length > 1 && (
            <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center", padding: 6 }}>
              Laboratorio
              <select value={unidadId} onChange={(e) => setUnidadId(e.target.value)} aria-label="Filtrar por laboratorio">
                <option value="">Todos</option>
                {labs.map((l) => <option key={l.id} value={l.id}>{l.codigo}</option>)}
              </select>
            </label>
          )}
        </div>
        <div style={{ padding: 12, overflowX: "auto" }}>
          {filas === null ? (
            <SkeletonRows cols={7} />
          ) : filas.length === 0 ? (
            <EmptyState
              compacto
              icono="🛒"
              titulo={vista === "por_visar" ? "Ninguna solicitud espera su V°B°" : vista === "por_gestionar" ? "Nada por gestionar en Abastecimiento" : "Sin solicitudes de adquisición"}
              texto={puedeCrear ? "Cree una con «Nueva solicitud»: la revisa su jefatura y luego la recibe Abastecimiento." : "Aquí aparecen las solicitudes de los laboratorios de su ámbito."}
            />
          ) : (
            <table className="data">
              <thead><tr><th>Nº</th><th>Fecha</th><th>Laboratorio</th><th>Objetivo</th><th className="num">Ítems</th><th className="num">Total ref.</th><th>Estado</th></tr></thead>
              <tbody>
                {filas.map((s) => {
                  const e = ESTADO_ADQUISICION[s.estado] ?? { texto: s.estado, pill: "gray" };
                  return (
                    <tr key={s.id}>
                      <td><Link href={`/solicitudes-adquisicion/${s.id}` as any} className="codigo">{s.numero ?? "(borrador)"}</Link></td>
                      <td>{fechaDia(s.fecha)}</td>
                      <td>{s.unidad}<small style={{ display: "block", color: "var(--muted)" }}>{s.solicitante}</small></td>
                      <td style={{ maxWidth: 360 }}>{s.objetivo}{s.ot && <small style={{ display: "block", color: "var(--muted)" }}>OT {s.ot}</small>}</td>
                      <td className="num">{s.items}</td>
                      <td className="num">{pesos(s.total)}</td>
                      <td>
                        <span className={`pill ${e.pill}`}>{e.texto}</span>
                        {s.ocNumero && <small style={{ display: "block", color: "var(--muted)" }}>O/C {s.ocNumero}{s.ocEstado ? ` · ${s.ocEstado}` : ""}</small>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
