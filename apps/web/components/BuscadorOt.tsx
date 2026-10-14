"use client";

/**
 * BuscadorOt · selector de Orden de Trabajo con búsqueda en el servidor.
 *
 * Sustituye a los desplegables que cargaban solo las 50 OT más recientes: se
 * escribe parte del código, del cliente o del laboratorio y la API devuelve las
 * coincidencias de TODO el alcance del usuario (GET /ot?q=…&limit=20). Sin
 * texto muestra las 20 más recientes (o las del filtro `filtros`).
 */
import { useEffect, useId, useRef, useState } from "react";
import { llamar, qs, type Paginado } from "@/lib/laboratorio";

export interface OtCorta {
  id: string;
  codigo: string;
  estado?: string;
  cliente?: { razonSocial?: string } | null;
  unidad?: { codigo: string; nombre: string } | null;
}

export const etiquetaOt = (o?: OtCorta | null) =>
  o ? [o.codigo, o.unidad?.codigo, o.cliente?.razonSocial].filter(Boolean).join(" · ") : "";

export default function BuscadorOt({
  valor,
  onCambio,
  filtros,
  placeholder = "Busque por código de OT, cliente o laboratorio…",
  etiqueta = "Orden de trabajo",
}: {
  valor: OtCorta | null;
  onCambio: (ot: OtCorta | null) => void;
  /** filtros extra de GET /ot (p. ej. { mias: 1 } o { estado: "abiertas" }) */
  filtros?: Record<string, string | number | boolean | undefined>;
  placeholder?: string;
  etiqueta?: string;
}) {
  const [texto, setTexto] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [opciones, setOpciones] = useState<OtCorta[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const id = useId();
  const caja = useRef<HTMLDivElement>(null);
  const filtrosClave = JSON.stringify(filtros ?? {});

  useEffect(() => {
    if (!abierto) return;
    let vivo = true;
    const t = setTimeout(async () => {
      setCargando(true);
      try {
        const r = await llamar<Paginado<OtCorta>>("GET", `/ot${qs({ ...(filtros ?? {}), q: texto.trim(), limit: 20 })}`);
        if (!vivo) return;
        setOpciones(r.data ?? []);
        setTotal(r.meta?.total ?? 0);
        setError("");
      } catch (e: any) {
        if (vivo) setError(e.message);
      } finally {
        if (vivo) setCargando(false);
      }
    }, texto ? 250 : 0);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto, abierto, filtrosClave]);

  // Cerrar al hacer clic fuera.
  useEffect(() => {
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, []);

  return (
    <div className="field" ref={caja} style={{ position: "relative" }}>
      <label htmlFor={id}>{etiqueta}</label>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          id={id}
          value={abierto ? texto : etiquetaOt(valor)}
          placeholder={placeholder}
          onFocus={() => { setAbierto(true); setTexto(""); }}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setAbierto(false);
            if (e.key === "Enter" && opciones[0]) { onCambio(opciones[0]); setAbierto(false); }
          }}
          autoComplete="off"
          style={{ flex: 1 }}
        />
        {valor && (
          <button type="button" className="btn outline sm" onClick={() => onCambio(null)} title="Quitar la OT elegida">
            Quitar
          </button>
        )}
      </div>
      {abierto && (
        <ul
          role="listbox"
          style={{
            position: "absolute", top: "100%", left: 0, right: 0, zIndex: 30, background: "#fff",
            border: "1px solid var(--line)", borderRadius: 7, boxShadow: "var(--shadow)", margin: "4px 0 0",
            padding: 4, listStyle: "none", maxHeight: 320, overflowY: "auto",
          }}
        >
          {cargando && <li style={{ padding: 8, color: "var(--muted)" }}>Buscando…</li>}
          {error && <li style={{ padding: 8, color: "var(--red)" }}>{error}</li>}
          {!cargando && !error && opciones.length === 0 && (
            <li style={{ padding: 8, color: "var(--muted)" }}>Sin órdenes de trabajo que coincidan.</li>
          )}
          {opciones.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                role="option"
                aria-selected={valor?.id === o.id}
                onClick={() => { onCambio(o); setAbierto(false); }}
                style={{ width: "100%", textAlign: "left", background: valor?.id === o.id ? "#eef7f8" : "none", border: 0, padding: "6px 8px", borderRadius: 5, cursor: "pointer" }}
              >
                <span className="codigo">{o.codigo}</span>
                {o.unidad ? <span className="pill teal" style={{ marginLeft: 6 }}>{o.unidad.codigo}</span> : <span className="pill amber" style={{ marginLeft: 6 }}>sin laboratorio</span>}
                <span style={{ marginLeft: 6, color: "var(--muted)" }}>{o.cliente?.razonSocial ?? ""}</span>
              </button>
            </li>
          ))}
          {!cargando && total > opciones.length && (
            <li style={{ padding: "6px 8px", fontSize: 11, color: "var(--muted)" }}>
              Se muestran {opciones.length} de {total}. Escriba más para acotar.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
