"use client";

/**
 * Buscadores de los formularios BPCH: empresa (maestro de clientes), producto
 * de la Codificación Única y elemento del catálogo. Consultan la API con una
 * pausa de 300 ms y devuelven el registro elegido; nunca se escribe texto libre
 * donde la API espera un identificador.
 */
import { useEffect, useId, useRef, useState } from "react";
import { pedir } from "./bpch";

function useBusqueda<T>(ruta: (q: string) => string, activo: boolean) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<T[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!activo) return;
    const t = q.trim();
    if (t.length < 2) {
      setRes([]);
      return;
    }
    setCargando(true);
    setError("");
    const h = setTimeout(() => {
      pedir<any>("GET", ruta(t))
        .then((d) => setRes(Array.isArray(d) ? d : d?.data ?? []))
        .catch((e) => setError(e.message))
        .finally(() => setCargando(false));
    }, 300);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, activo]);
  return { q, setQ, res, setRes, cargando, error };
}

function Lista<T>({ items, render, onElegir, vacio }: { items: T[]; render: (x: T) => React.ReactNode; onElegir: (x: T) => void; vacio: string }) {
  return (
    <div role="listbox" style={{ border: "1px solid var(--line)", borderRadius: 6, marginTop: 4, maxHeight: 220, overflowY: "auto", background: "#fff" }}>
      {items.length === 0 ? (
        <div style={{ padding: 8, color: "var(--muted)", fontSize: 12 }}>{vacio}</div>
      ) : (
        items.map((x, i) => (
          <button
            key={i}
            type="button"
            role="option"
            aria-selected={false}
            onClick={() => onElegir(x)}
            style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 9px", border: "none", borderBottom: "1px solid #eef2f5", background: "none", cursor: "pointer", fontSize: 12.5 }}
          >
            {render(x)}
          </button>
        ))
      )}
    </div>
  );
}

function Elegido({ texto, onCambiar, deshabilitado }: { texto: React.ReactNode; onCambiar: () => void; deshabilitado?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <span className="pill blue" style={{ fontSize: 12.5, padding: "6px 10px", flex: 1 }}>{texto}</span>
      {!deshabilitado && <button type="button" className="btn outline sm" onClick={onCambiar}>Cambiar</button>}
    </div>
  );
}

export type Empresa = { id: string; razonSocial: string; rut?: string | null };

export function BuscadorEmpresa({
  etiqueta,
  valor,
  onChange,
  requerido,
  deshabilitado,
}: {
  etiqueta: string;
  valor: Empresa | null;
  onChange: (e: Empresa | null) => void;
  requerido?: boolean;
  deshabilitado?: boolean;
}) {
  const id = useId();
  const b = useBusqueda<Empresa>((q) => `/clientes?search=${encodeURIComponent(q)}&limit=20`, !valor);
  return (
    <div className="field">
      <label htmlFor={id}>{etiqueta} {requerido && <span className="req">*</span>}</label>
      {valor ? (
        <Elegido texto={`${valor.razonSocial}${valor.rut ? ` · ${valor.rut}` : ""}`} onCambiar={() => onChange(null)} deshabilitado={deshabilitado} />
      ) : (
        <>
          <input id={id} value={b.q} onChange={(e) => b.setQ(e.target.value)} placeholder="Escriba la razón social o el RUT (mín. 2 letras)" autoComplete="off" />
          {b.q.trim().length >= 2 && !b.cargando && (
            <Lista items={b.res} vacio={b.error || "Sin coincidencias en el maestro de clientes."} onElegir={(x) => onChange(x)} render={(x) => <>{x.razonSocial} <small style={{ color: "var(--muted)" }}>{x.rut}</small></>} />
          )}
          {b.cargando && <small style={{ color: "var(--muted)" }}>Buscando…</small>}
        </>
      )}
    </div>
  );
}

export type ProductoCodificado = {
  id: string;
  cnc: string;
  producto: string;
  fabricanteNombre: string;
  elementoGenerico?: string | null;
  claseDivisionUn?: string | null;
  numeroUn?: string | null;
  catElementoId?: string | null;
  catElementoNombre?: string | null;
  estado: string;
  clienteId?: string | null;
};

export function BuscadorCodificacion({
  etiqueta = "Producto de la Codificación Única",
  valor,
  onChange,
}: {
  etiqueta?: string;
  valor: ProductoCodificado | null;
  onChange: (p: ProductoCodificado | null) => void;
}) {
  const id = useId();
  const b = useBusqueda<ProductoCodificado>((q) => `/bpch/codificacion?q=${encodeURIComponent(q)}&limit=20`, !valor);
  return (
    <div className="field">
      <label htmlFor={id}>{etiqueta}</label>
      {valor ? (
        <Elegido texto={<><span className="codigo">{valor.cnc}</span> · {valor.producto} · {valor.fabricanteNombre}</>} onCambiar={() => onChange(null)} />
      ) : (
        <>
          <input id={id} value={b.q} onChange={(e) => b.setQ(e.target.value)} placeholder="Código CNC-DGMN, producto o fabricante" autoComplete="off" />
          {b.q.trim().length >= 2 && !b.cargando && (
            <Lista
              items={b.res}
              vacio={b.error || "No está en la Codificación Única."}
              onElegir={(x) => onChange(x)}
              render={(x) => (
                <>
                  <span className="codigo">{x.cnc}</span> · {x.producto} <small style={{ color: "var(--muted)" }}>{x.fabricanteNombre} · {x.estado === "EN_RECESO" ? "en receso" : "vigente"}</small>
                </>
              )}
            />
          )}
        </>
      )}
    </div>
  );
}

export type ElementoCatalogo = { id: string; codigo: string; nombre: string };

export function BuscadorElemento({ valor, onChange }: { valor: ElementoCatalogo | null; onChange: (e: ElementoCatalogo | null) => void }) {
  const id = useId();
  const b = useBusqueda<ElementoCatalogo>((q) => `/cat/elementos?search=${encodeURIComponent(q)}&limit=20`, !valor);
  return (
    <div className="field">
      <label htmlFor={id}>Elemento del catálogo (panel de ensayos)</label>
      {valor ? (
        <Elegido texto={`${valor.codigo} · ${valor.nombre}`} onCambiar={() => onChange(null)} />
      ) : (
        <>
          <input id={id} value={b.q} onChange={(e) => b.setQ(e.target.value)} placeholder="Código o nombre del elemento" autoComplete="off" />
          {b.q.trim().length >= 2 && !b.cargando && (
            <Lista items={b.res} vacio={b.error || "Sin elementos con ese texto."} onElegir={(x) => onChange(x)} render={(x) => <><span className="codigo">{x.codigo}</span> · {x.nombre}</>} />
          )}
        </>
      )}
    </div>
  );
}

/** Lista de comprobación de los métodos del panel del elemento (todos marcados de partida). */
export function SelectorPanel({ catElementoId, valor, onChange }: { catElementoId: string | null; valor: string[]; onChange: (ids: string[]) => void }) {
  const [panel, setPanel] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  const inicial = useRef(true);
  useEffect(() => {
    if (!catElementoId) {
      setPanel([]);
      return;
    }
    setPanel(null);
    pedir<any[]>("GET", `/bpch/panel?catElementoId=${catElementoId}`)
      .then((p) => {
        setPanel(p);
        if (inicial.current) onChange(p.filter((m) => m.analitos > 0).map((m) => m.id));
        inicial.current = false;
      })
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catElementoId]);
  if (error) return <div className="alert warn">{error}</div>;
  if (panel === null) return <small style={{ color: "var(--muted)" }}>Cargando el panel de ensayos…</small>;
  if (!panel.length)
    return <div className="alert info" style={{ margin: 0 }}>El elemento no tiene panel de ensayos en el catálogo (o no se eligió elemento). Pida a quien administra el catálogo que cargue el panel en Tablas maestras › Paneles de ensayo.</div>;
  const marcar = (id: string, si: boolean) => onChange(si ? [...new Set([...valor, id])] : valor.filter((x) => x !== id));
  return (
    <fieldset style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 8, maxHeight: 260, overflowY: "auto" }}>
      <legend style={{ fontSize: 11, color: "var(--muted)", padding: "0 4px" }}>Ensayos del panel ({valor.length} de {panel.length} marcados)</legend>
      {/* Marcar o desmarcar todo el panel de una vez (recorrido MP-06, D06-13). */}
      <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
        <button type="button" className="btn outline sm" onClick={() => onChange(panel.filter((m) => m.analitos > 0).map((m) => m.id))}>Marcar todos</button>
        <button type="button" className="btn outline sm" onClick={() => onChange([])}>Desmarcar todos</button>
      </div>
      {panel.map((m) => (
        <label key={m.id} style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 12.5, padding: "3px 0", opacity: m.analitos ? 1 : 0.55 }}>
          <input type="checkbox" checked={valor.includes(m.id)} disabled={!m.analitos} onChange={(e) => marcar(m.id, e.target.checked)} />
          <span>
            <span className="codigo">{m.codigo}</span> {m.nombre}
            {!m.analitos && <small style={{ color: "var(--muted)" }}> · sin analitos en el catálogo</small>}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
