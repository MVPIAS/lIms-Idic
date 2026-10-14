"use client";

/**
 * Muestras de la OT (pestaña del expediente) y registro de las muestras
 * recibidas con sus ensayos.
 *
 * · Todos los que ven la OT ven sus muestras y cuántos ensayos tiene cada una.
 * · Quien registra muestras (permiso «muestra.crear»: Recepción, Planificación,
 *   jefaturas…) puede «Registrar muestras recibidas»: indica cuántas llegaron y
 *   su descripción, y marca los métodos del catálogo que se aplican. Si la OT
 *   nació de una cotización, los ensayos cotizados aparecen ya listados (y
 *   marcados cuando el ensayo tiene un solo método). También puede buscar otros
 *   métodos en el catálogo.
 * · Al guardar se crean las muestras (<OT>-M1, M2…) y sus ensayos por analizar,
 *   con la especificación y la fórmula copiadas del catálogo.
 *
 * API: GET /flujo/ot/:id/registro-muestras · POST /flujo/ot/:id/muestras
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "@/components/ui/feedback";
import { llamar, veredictoInfo } from "@/lib/laboratorio";
import { usePermisos } from "@/lib/permisos";

interface Metodo { id: string; codigo: string; nombre: string; norma?: string | null; ensayoId?: string | null; analitos: number }
interface Linea {
  lineaId: string; descripcion: string; cantidad: number; ensayoId: string | null; ensayoCodigo: string | null;
  metodos: Metodo[]; sugeridos: string[]; aviso: string | null;
}
interface MuestraOt { id: string; codigo: string; nombre: string | null; estado: string; veredicto: string | null; ensayos: number; metodos: string[] }
interface Propuesta {
  ot: { id: string; codigo: string; estado: string };
  cotizacion: { id: string; codigo: string; referencia: string | null } | null;
  muestras: MuestraOt[];
  lineas: Linea[];
}

const etiquetaMetodo = (m: Metodo) => `${m.codigo} · ${m.nombre}${m.norma ? ` (${m.norma})` : ""}`;

export default function RegistroMuestras({ otId, onCambio }: { otId: string; onCambio?: () => void }) {
  const { puede } = usePermisos();
  const [d, setD] = useState<Propuesta | null>(null);
  const [error, setError] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);

  // Formulario
  const [nombres, setNombres] = useState<string[]>([""]);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState<Metodo[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [encontrados, setEncontrados] = useState<Metodo[]>([]);
  const [buscando, setBuscando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setD(await llamar<Propuesta>("GET", `/flujo/ot/${otId}/registro-muestras`));
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, [otId]);
  useEffect(() => { cargar(); }, [cargar]);

  const abrir = () => {
    if (!d) return;
    setMarcados(new Set(d.lineas.flatMap((l) => l.sugeridos)));
    // Tantas muestras como la mayor cantidad cotizada (mínimo 1); la descripción la escribe quien recibe.
    const n = Math.max(1, Math.min(20, ...d.lineas.map((l) => l.cantidad || 1)));
    setNombres(Array.from({ length: d.lineas.length ? n : 1 }, () => ""));
    setExtra([]);
    setBusqueda("");
    setEncontrados([]);
    setAbierto(true);
  };

  // Búsqueda de métodos en el catálogo (con un pequeño retardo).
  useEffect(() => {
    if (!abierto || busqueda.trim().length < 2) { setEncontrados([]); return; }
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const r: any = await llamar("GET", `/cat/metodos?search=${encodeURIComponent(busqueda.trim())}&limit=20`);
        const filas: any[] = Array.isArray(r) ? r : r?.data ?? [];
        setEncontrados(filas.map((m) => ({ id: m.id, codigo: m.codigo, nombre: m.nombre, norma: m.norma, ensayoId: m.ensayoId, analitos: m.analitos?.length ?? m._count?.analitos ?? 1 })));
      } catch {
        setEncontrados([]);
      } finally {
        setBuscando(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [busqueda, abierto]);

  const metodosDeLineas = useMemo(() => new Set((d?.lineas ?? []).flatMap((l) => l.metodos.map((m) => m.id))), [d]);
  const alternar = (id: string) => setMarcados((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const agregarExtra = (m: Metodo) => {
    if (!metodosDeLineas.has(m.id) && !extra.some((x) => x.id === m.id)) setExtra((x) => [...x, m]);
    setMarcados((s) => new Set(s).add(m.id));
    setBusqueda("");
    setEncontrados([]);
  };

  async function guardar() {
    const metodoIds = [...marcados];
    if (!metodoIds.length) return toast.error("Marque al menos un método.");
    if (nombres.some((n) => !n.trim())) return toast.error("Escriba la descripción de cada muestra recibida.");
    setGuardando(true);
    try {
      const r: any = await llamar("POST", `/flujo/ot/${otId}/muestras`, {
        muestras: nombres.map((nombre) => ({ nombre: nombre.trim(), metodoIds })),
      });
      toast.ok(`Se registraron ${r.muestras.length} muestra(s) con ${r.ensayos} ensayo(s) por analizar.`);
      setAbierto(false);
      await cargar();
      onCambio?.();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setGuardando(false);
    }
  }

  if (error) return <div className="alert warn">{error}</div>;
  if (!d) return <p className="subtitle" style={{ margin: 0 }}>Cargando muestras…</p>;

  const cerrada = ["cerrada", "anulada"].includes(d.ot.estado);
  const puedeRegistrar = puede("muestra.crear") && !cerrada;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {d.muestras.length ? (
        <table className="data">
          <thead><tr><th>Código</th><th>Muestra</th><th>Métodos</th><th className="num">Ensayos</th><th>Veredicto</th><th>Estado</th></tr></thead>
          <tbody>
            {d.muestras.map((m) => {
              const v = veredictoInfo(m.veredicto);
              return (
                <tr key={m.id}>
                  <td><span className="codigo">{m.codigo}</span></td>
                  <td>{m.nombre ?? "—"}</td>
                  <td style={{ fontSize: 12 }}>{m.metodos.length ? m.metodos.join(", ") : <span className="pill amber">sin ensayos</span>}</td>
                  <td className="num">{m.ensayos}</td>
                  <td><span className={`pill ${v.pill}`}>{v.texto}</span></td>
                  <td><span className="pill gray">{m.estado}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="alert warn" style={{ margin: 0 }}>
          Esta OT aún no tiene muestras registradas: sin muestras no hay ensayos que asignar ni capturar.
          {puedeRegistrar ? " Regístrelas con «Registrar muestras recibidas»." : " Las registra Recepción, Planificación o la jefatura del laboratorio."}
        </div>
      )}

      {puedeRegistrar && !abierto && (
        <div><button className="btn primary sm" onClick={abrir}>Registrar muestras recibidas</button></div>
      )}

      {abierto && (
        <div className="card" style={{ margin: 0, padding: 12 }}>
          <h2 style={{ fontSize: 14, marginTop: 0 }}>Registrar muestras recibidas</h2>

          <div className="field" style={{ maxWidth: 180 }}>
            <label>Nº de muestras recibidas</label>
            <input type="number" min={1} max={50} value={nombres.length}
              onChange={(e) => {
                const n = Math.max(1, Math.min(50, Number(e.target.value) || 1));
                setNombres((xs) => Array.from({ length: n }, (_, i) => xs[i] ?? ""));
              }} />
          </div>
          <div className="form-grid cols-2" style={{ marginBottom: 10 }}>
            {nombres.map((n, i) => (
              <div className="field" key={i}>
                <label>Muestra {i + 1} · descripción <span className="req">*</span></label>
                <input value={n} maxLength={200} onChange={(e) => setNombres((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))} />
              </div>
            ))}
          </div>

          <h3 style={{ fontSize: 13, margin: "6px 0" }}>
            Métodos que se aplican a cada muestra
            {d.cotizacion && <span style={{ fontWeight: 400, color: "var(--muted)" }}> · ensayos de la cotización {d.cotizacion.codigo}</span>}
          </h3>
          {d.lineas.length === 0 && (
            <p className="subtitle" style={{ margin: "0 0 8px" }}>
              {d.cotizacion ? "La cotización no tiene líneas." : "Esta OT no viene de una cotización."} Busque los métodos en el catálogo.
            </p>
          )}
          {d.lineas.map((l) => (
            <div key={l.lineaId} style={{ borderTop: "1px solid var(--line)", padding: "6px 0" }}>
              <div style={{ fontWeight: 600, fontSize: 12.5 }}>
                {l.ensayoCodigo ? <span className="codigo">{l.ensayoCodigo}</span> : null} {l.descripcion}
                <span style={{ fontWeight: 400, color: "var(--muted)" }}> · cantidad cotizada {l.cantidad}</span>
              </div>
              {l.aviso && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{l.aviso}</div>}
              {l.metodos.map((m) => (
                <label key={m.id} style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 400, fontSize: 12.5, opacity: m.analitos ? 1 : 0.55 }}>
                  <input type="checkbox" style={{ width: "auto" }} disabled={!m.analitos} checked={marcados.has(m.id)} onChange={() => alternar(m.id)} />
                  {etiquetaMetodo(m)}{!m.analitos && " · sin analitos en el catálogo"}
                </label>
              ))}
            </div>
          ))}
          {extra.length > 0 && (
            <div style={{ borderTop: "1px solid var(--line)", padding: "6px 0" }}>
              <div style={{ fontWeight: 600, fontSize: 12.5 }}>Otros métodos del catálogo</div>
              {extra.map((m) => (
                <label key={m.id} style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 400, fontSize: 12.5 }}>
                  <input type="checkbox" style={{ width: "auto" }} checked={marcados.has(m.id)} onChange={() => alternar(m.id)} />
                  {etiquetaMetodo(m)}
                </label>
              ))}
            </div>
          )}
          <div className="field" style={{ marginTop: 8, maxWidth: 520, position: "relative" }}>
            <label>Agregar un método del catálogo</label>
            <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Código o nombre del método" />
            {(buscando || encontrados.length > 0) && (
              <div className="card" style={{ position: "absolute", zIndex: 5, top: "100%", left: 0, right: 0, margin: 0, padding: 4, maxHeight: 240, overflowY: "auto" }}>
                {buscando && <div style={{ fontSize: 12, color: "var(--muted)", padding: 4 }}>Buscando…</div>}
                {encontrados.map((m) => (
                  <button key={m.id} type="button" className="btn outline sm" style={{ display: "block", width: "100%", textAlign: "left", marginBottom: 2 }} onClick={() => agregarExtra(m)}>
                    {etiquetaMetodo(m)}
                  </button>
                ))}
              </div>
            )}
          </div>

          <p className="hint" style={{ fontSize: 11.5, color: "var(--muted)" }}>
            Se crearán {nombres.length} muestra(s) con {marcados.size} método(s) cada una. Cada método genera un ensayo por
            analito, con su especificación y fórmula del catálogo. Queda registrado en el historial de la OT.
          </p>
          <div className="toolbar" style={{ margin: 0 }}>
            <button className="btn outline sm" disabled={guardando} onClick={() => setAbierto(false)}>Cancelar</button>
            <button className="btn primary sm" disabled={guardando || !marcados.size} onClick={guardar}>
              {guardando ? "Registrando…" : "Registrar muestras y ensayos"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
