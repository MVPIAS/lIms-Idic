"use client";

/**
 * Selectores con buscador para el área admin:
 *  - SelectorBuscable: combobox genérico (opciones con sangría, icono y subtítulo).
 *  - SelectorUnidad: selector en árbol de la estructura IDIC.
 *  - SelectorUsuario: elegir una persona por nombre / usuario / cargo.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { aplanar, construirArbol, metaTipo, type TipoUnidad, type Unidad, type Usuario } from "@/lib/admin";

export interface Opcion {
  value: string;
  label: string;
  sub?: string;
  depth?: number;
  icono?: ReactNode;
  disabled?: boolean;
  /** texto extra que participa en la búsqueda */
  buscar?: string;
}

export function SelectorBuscable({
  opciones, value, onChange, placeholder = "— seleccionar —", nulo, disabled, ariaLabel, compacto,
}: {
  opciones: Opcion[];
  value: string | null;
  onChange: (v: string | null) => void;
  placeholder?: string;
  /** si se indica, ofrece una opción "vacía" con este texto (valor null). */
  nulo?: string;
  disabled?: boolean;
  ariaLabel?: string;
  compacto?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState("");
  const [activo, setActivo] = useState(0);
  const caja = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => { if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false); };
    document.addEventListener("mousedown", fuera);
    setTimeout(() => input.current?.focus(), 0);
    return () => document.removeEventListener("mousedown", fuera);
  }, [abierto]);

  const sel = opciones.find((o) => o.value === value) ?? null;
  const filtradas = useMemo(() => {
    const n = q.trim().toLowerCase();
    const base = n
      ? opciones.filter((o) => `${o.label} ${o.sub ?? ""} ${o.buscar ?? ""}`.toLowerCase().includes(n))
      : opciones;
    return nulo !== undefined ? [{ value: "__null__", label: nulo } as Opcion, ...base] : base;
  }, [opciones, q, nulo]);

  function elegir(o: Opcion) {
    if (o.disabled) return;
    onChange(o.value === "__null__" ? null : o.value);
    setAbierto(false);
    setQ("");
  }

  return (
    <div className="relative" ref={caja}>
      <button type="button" disabled={disabled} aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={abierto}
        onClick={() => { setAbierto((a) => !a); setActivo(0); }}
        className={`w-full text-left border border-[var(--line)] rounded-[5px] bg-white flex items-center gap-2 ${compacto ? "px-2 py-[5px] text-[12px]" : "px-[9px] py-[6px] text-[12.5px]"} disabled:bg-slate-100 disabled:text-slate-400`}>
        {sel?.icono && <span className="shrink-0">{sel.icono}</span>}
        <span className={`flex-1 truncate ${sel ? "" : "text-[var(--muted)]"}`}>
          {sel ? sel.label : value === null && nulo ? nulo : placeholder}
        </span>
        <span className="text-[10px] text-[var(--muted)]" aria-hidden>▾</span>
      </button>
      {abierto && (
        <div className="absolute z-30 mt-1 w-full min-w-[260px] bg-white border border-[var(--line)] rounded-lg shadow-xl">
          <div className="p-2 border-b border-[var(--line)]">
            <input ref={input} value={q} placeholder="Buscar…" aria-label="Buscar opción"
              className="w-full border border-[var(--line)] rounded px-2 py-1 text-[12px]"
              onChange={(e) => { setQ(e.target.value); setActivo(0); }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setActivo((a) => Math.min(a + 1, filtradas.length - 1)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setActivo((a) => Math.max(a - 1, 0)); }
                else if (e.key === "Enter") { e.preventDefault(); const o = filtradas[activo]; if (o) elegir(o); }
                else if (e.key === "Escape") setAbierto(false);
              }} />
          </div>
          <ul role="listbox" className="max-h-72 overflow-y-auto py-1">
            {filtradas.length === 0 && <li className="px-3 py-2 text-[12px] text-[var(--muted)]">Sin coincidencias</li>}
            {filtradas.map((o, i) => (
              <li key={o.value} role="option" aria-selected={o.value === value} aria-disabled={o.disabled}
                onMouseEnter={() => setActivo(i)} onMouseDown={(e) => { e.preventDefault(); elegir(o); }}
                className={`flex items-center gap-2 px-3 py-[5px] text-[12.5px] ${o.disabled ? "text-slate-400 cursor-not-allowed" : "cursor-pointer"} ${i === activo && !o.disabled ? "bg-[#e6f4f6]" : ""} ${o.value === value ? "font-semibold" : ""}`}
                style={{ paddingLeft: 12 + (q ? 0 : (o.depth ?? 0) * 16) }}>
                {o.icono && <span className="shrink-0">{o.icono}</span>}
                <span className="truncate">{o.label}</span>
                {o.sub && <span className="ml-auto text-[11px] text-[var(--muted)] truncate pl-2">{o.sub}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Opciones en árbol (preorden con sangría) a partir de la lista plana de unidades. */
export function opcionesUnidad(unidades: Unidad[], opts: { excluir?: Set<string>; tipos?: TipoUnidad[]; inactivas?: boolean } = {}): Opcion[] {
  const visibles = opts.inactivas ? unidades : unidades.filter((u) => u.activo !== false);
  return aplanar(construirArbol(visibles)).map((u) => {
    const m = metaTipo(u.tipo);
    return {
      value: u.id,
      label: `${u.codigo} · ${u.nombre}`,
      sub: m.label,
      depth: u.depth,
      icono: <span style={{ color: u.color || m.color }}>{u.icono || m.icono}</span>,
      disabled: opts.excluir?.has(u.id) || (opts.tipos ? !opts.tipos.includes(u.tipo) : false),
      buscar: `${u.sigla ?? ""} ${u.codsucdel ?? ""}`,
    };
  });
}

export function SelectorUnidad({
  unidades, value, onChange, nulo, placeholder = "— elegir unidad —", excluir, tipos, disabled, ariaLabel, compacto,
}: {
  unidades: Unidad[]; value: string | null; onChange: (v: string | null) => void; nulo?: string; placeholder?: string;
  excluir?: Set<string>; tipos?: TipoUnidad[]; disabled?: boolean; ariaLabel?: string; compacto?: boolean;
}) {
  const ops = useMemo(() => opcionesUnidad(unidades, { excluir, tipos }), [unidades, excluir, tipos]);
  return <SelectorBuscable opciones={ops} value={value} onChange={onChange} nulo={nulo} placeholder={placeholder}
    disabled={disabled} ariaLabel={ariaLabel ?? "Unidad"} compacto={compacto} />;
}

export function SelectorUsuario({ usuarios, value, onChange, nulo = "— sin asignar —", disabled, ariaLabel }: {
  usuarios: Usuario[]; value: string | null; onChange: (v: string | null) => void; nulo?: string; disabled?: boolean; ariaLabel?: string;
}) {
  const ops = useMemo<Opcion[]>(() => usuarios
    .filter((u) => u.activo)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
    .map((u) => ({
      value: u.id,
      label: u.nombre,
      sub: u.cargo ?? u.username,
      icono: <span className="inline-flex w-5 h-5 rounded-full bg-[var(--accent)] text-white text-[9px] items-center justify-center font-bold">{iniciales(u.nombre)}</span>,
      buscar: `${u.username} ${u.asignaciones.map((a) => `${a.rol.codigo} ${a.unidad?.codigo ?? ""}`).join(" ")}`,
    })), [usuarios]);
  return <SelectorBuscable opciones={ops} value={value} onChange={onChange} nulo={nulo} disabled={disabled} ariaLabel={ariaLabel ?? "Persona"} />;
}

export function iniciales(nombre: string): string {
  return nombre.split(/\s+/).filter((w) => /^[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(w)).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "··";
}
