"use client";

/**
 * Cotizaciones · Módulo Comercial LIMS IDIC (Comercial rondas 1 y 2 + circuito r1c, oct-2026)
 * -----------------------------------------------------------------------------
 * Lista (= Registro de cotizaciones emitidas, FORM07). Cada cotización se abre en
 * su ficha (/cotizaciones/[id]): elaboración → costeo del laboratorio → V°B° →
 * firma del Jefe DCO → envío al cliente → aceptación y OT.
 *  · Estados: Abierta → Aceptada | Anulada; Vencida al superar la validez. Las
 *    anteriores al nuevo flujo quedan como histórico de solo lectura.
 *  · Columna «Firma y envío»: en elaboración, en firma, devuelta, firmada, enviada.
 *  · Búsqueda, filtros y paginación en el servidor (GET /cotizaciones). La
 *    dirección acepta ?estado=, ?porVencer=1, ?sinOt=1, ?firma=, ?enviada= (tarjetas
 *    de Mi bandeja) y ?abrir=<id> (lleva a la ficha).
 *  · Acciones rápidas: registrar aceptación (solo firmada) y anular con motivo.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { monto, fechaDia } from "@/lib/format";
import { usePermisos } from "@/lib/permisos";
import { pedir, ESTADOS_VIGENTES, porVencer } from "./_components/comercial";
import { EstadoChip, FirmaChip, accionesDe } from "./_components/Detalle";
import { DialogoAceptacion, DialogoAnulacion } from "./_components/Dialogos";

type Filtro = "todas" | "abierta" | "porVencer" | "enFirma" | "aceptada" | "anulada" | "expirada" | "historico";
const FILTROS_URL: Filtro[] = ["abierta", "aceptada", "anulada", "expirada", "historico"];
const FIRMAS = ["pendiente", "firmada", "devuelta", "sin_firma"];
const TEXTO_FIRMA: Record<string, string> = {
  pendiente: "en firma del Jefe DCO",
  firmada: "firmadas",
  devuelta: "devueltas por el Jefe DCO",
  sin_firma: "en elaboración (sin enviar a firma)",
};

interface Extra { sinOt?: boolean; firma?: string; enviada?: string }

const esHistorico = (e: string) => !(ESTADOS_VIGENTES as readonly string[]).includes(e);

export default function CotizacionesPage() {
  const router = useRouter();
  const { puede, listo: permisosListos } = usePermisos();
  const [cots, setCots] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [buscar, setBuscar] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState<{ page: number; total: number; totalPages: number; limit: number } | null>(null);
  const [conteos, setConteos] = useState<Record<string, number>>({});
  const [extra, setExtra] = useState<Extra>({});
  const [listo, setListo] = useState(false);
  const [exigirFirma, setExigirFirma] = useState(true);

  const [aceptando, setAceptando] = useState<any | null>(null);
  const [anulando, setAnulando] = useState<any | null>(null);

  useEffect(() => {
    pedir<any>("GET", "/cotizaciones/config").then((c) => setExigirFirma(c?.circuito?.exigirFirma !== false)).catch(() => {});
  }, []);

  const cargar = useCallback(async () => {
    if (!listo) return;
    setCargando(true);
    try {
      const p = new URLSearchParams();
      if (q.trim()) p.set("q", q.trim());
      if (filtro === "porVencer") p.set("porVencer", "1");
      else if (filtro === "enFirma") { p.set("estado", "abierta"); p.set("firma", "pendiente"); }
      else if (filtro !== "todas") p.set("estado", filtro);
      if (extra.sinOt) p.set("sinOt", "1");
      if (extra.firma) p.set("firma", extra.firma);
      if (extra.enviada) p.set("enviada", extra.enviada);
      p.set("page", String(page));
      p.set("limit", "50");
      const d = await pedir<any>("GET", `/cotizaciones?${p.toString()}`);
      setCots(Array.isArray(d) ? d : d?.data ?? []);
      setMeta(d?.meta ?? null);
      setConteos(d?.conteos ?? {});
      setError("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, [listo, q, filtro, extra, page]);

  // Filtros de la dirección (tarjetas de Mi bandeja) y ?abrir=<id> → ficha.
  useEffect(() => {
    const u = new URLSearchParams(window.location.search);
    const id = u.get("abrir");
    if (id) {
      router.replace(`/cotizaciones/${id}` as any);
      return;
    }
    const e = u.get("estado") as Filtro | null;
    if (u.get("porVencer") === "1") setFiltro("porVencer");
    else if (e && FILTROS_URL.includes(e)) setFiltro(e);
    const firma = u.get("firma");
    const enviada = u.get("enviada");
    setExtra({
      sinOt: u.get("sinOt") === "1",
      firma: firma && FIRMAS.includes(firma) ? firma : undefined,
      enviada: enviada === "0" || enviada === "1" ? enviada : undefined,
    });
    setListo(true);
  }, [router]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    const t = setTimeout(() => { setQ(buscar); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [buscar]);

  const conteo = (f: Filtro) => {
    const todos = Object.entries(conteos).filter(([e]) => e !== "porVencer");
    if (f === "todas") return todos.reduce((a, [, n]) => a + n, 0);
    if (f === "historico") return todos.filter(([e]) => esHistorico(e)).reduce((a, [, n]) => a + n, 0);
    if (f === "enFirma") return null;
    return conteos[f] ?? 0;
  };

  const chips: { f: Filtro; l: string }[] = [
    { f: "todas", l: "Todas" },
    { f: "abierta", l: "Abiertas" },
    { f: "enFirma", l: "En firma" },
    { f: "porVencer", l: "Por vencer (7 días)" },
    { f: "aceptada", l: "Aceptadas" },
    { f: "anulada", l: "Anuladas" },
    { f: "expirada", l: "Vencidas" },
    { f: "historico", l: "Histórico" },
  ];
  const hayExtra = extra.sinOt || extra.firma || extra.enviada;
  const textoExtra = [
    extra.sinOt && "aceptadas sin OT",
    extra.firma && TEXTO_FIRMA[extra.firma],
    extra.enviada === "0" && "sin enviar al cliente",
    extra.enviada === "1" && "enviadas al cliente",
  ].filter(Boolean).join(", ");

  return (
    <div>
      <h1 className="page">Cotizaciones <span className="tag">≠ OT</span></h1>
      <p className="subtitle">
        Cada cotización recorre seis pasos: elaboración, costeo del laboratorio, V°B°, firma del Jefe DCO, envío al cliente y aceptación (que genera la OT). Abra el número para ver en qué paso está y a quién le toca.
      </p>

      {error && <div className="alert warn" role="alert">{error}</div>}
      {msg && <div className="alert info" role="status" style={{ marginBottom: 10 }}>{msg}</div>}

      <div className="toolbar" style={{ flexWrap: "wrap", gap: 6 }}>
        {chips.map(({ f, l }) => {
          const n = conteo(f);
          return (
            <button key={f} className={`btn sm ${filtro === f ? "primary" : "outline"}`} aria-pressed={filtro === f} onClick={() => { setFiltro(f); setPage(1); setExtra({}); }}>
              {l}{n !== null && <span style={{ opacity: 0.75, marginLeft: 4 }}>{n}</span>}
            </button>
          );
        })}
        <input aria-label="Buscar cotizaciones" placeholder="Buscar por N°, cliente o referencia…" style={{ flex: 1, minWidth: 200 }} value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        {permisosListos && puede("cotizacion.crear") && <Link href={"/cotizaciones/nueva" as any} className="btn primary sm">＋ Nueva cotización</Link>}
      </div>
      {hayExtra && (
        <div className="alert info" style={{ marginBottom: 10 }}>
          Filtro de la bandeja: {textoExtra}.{" "}
          <button className="btn outline sm" onClick={() => setExtra({})}>Quitar filtro</button>
        </div>
      )}

      <div className="card card--table">
        <table className="data">
          <thead>
            <tr>
              <th>N° cotización</th>
              <th>Cliente</th>
              <th>Estado</th>
              <th>Firma y envío</th>
              <th className="num">Total</th>
              <th>Válida hasta</th>
              <th>OT</th>
              <th>Emisión</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {cots.map((c) => { const acc = accionesDe(c, puede, exigirFirma); return (
              <tr key={c.id}>
                <td style={{ whiteSpace: "nowrap" }}><Link href={`/cotizaciones/${c.id}` as any} className="codigo" style={{ textDecoration: "underline" }}>{c.codigo}</Link></td>
                <td>{c.cliente?.razonSocial ?? "—"}</td>
                <td><EstadoChip estado={c.estado} /></td>
                <td><FirmaChip c={c} /></td>
                <td className="num">{monto(c.total, c.moneda)}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {fechaDia(c.validaHasta ?? c.expiraAt)}
                  {porVencer(c) && <span className="pill amber" style={{ marginLeft: 6 }}>por vencer</span>}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {c.ot ? (
                    <>
                      <Link href={`/ot/${c.ot.id}` as any} className="codigo" style={{ textDecoration: "underline" }}>{c.ot.codigo}</Link>
                      {c.ot.opiPendiente && <span className="pill amber" style={{ marginLeft: 6 }}>OPI pendiente</span>}
                    </>
                  ) : (
                    <span style={{ color: "var(--muted)" }}>—</span>
                  )}
                </td>
                <td style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{fechaDia(c.fechaEmision ?? c.createdAt)}</td>
                <td>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <Link href={`/cotizaciones/${c.id}` as any} className="btn outline sm">Abrir</Link>
                    {acc.aceptar && <button className="btn primary sm" onClick={() => setAceptando(c)}>Registrar aceptación</button>}
                    {acc.anular && <button className="btn outline sm" onClick={() => setAnulando(c)}>Anular</button>}
                  </div>
                </td>
              </tr>
            ); })}
            {!cargando && cots.length === 0 && (
              <tr><td colSpan={9} style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>Sin cotizaciones para este filtro.</td></tr>
            )}
            {cargando && (
              <tr><td colSpan={9} style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>Cargando…</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {meta && meta.totalPages > 1 && (
        <div className="toolbar" style={{ marginTop: 8 }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {(meta.page - 1) * meta.limit + 1}–{Math.min(meta.page * meta.limit, meta.total)} de {meta.total}
          </span>
          <div className="spacer" />
          <button className="btn outline sm" disabled={meta.page <= 1} onClick={() => setPage((n) => n - 1)}>← Anterior</button>
          <span style={{ fontSize: 12 }}>Página {meta.page} de {meta.totalPages}</span>
          <button className="btn outline sm" disabled={meta.page >= meta.totalPages} onClick={() => setPage((n) => n + 1)}>Siguiente →</button>
        </div>
      )}

      {aceptando && (
        <DialogoAceptacion
          cot={aceptando}
          onCerrar={() => setAceptando(null)}
          onHecho={async (r) => {
            setAceptando(null);
            setMsg(r?.mensaje ?? "Aceptación registrada.");
            await cargar();
          }}
        />
      )}

      {anulando && (
        <DialogoAnulacion
          cot={anulando}
          onCerrar={() => setAnulando(null)}
          onHecho={async () => {
            setAnulando(null);
            setMsg(`Cotización ${anulando.codigo} anulada.`);
            await cargar();
          }}
        />
      )}
    </div>
  );
}
