"use client";

/**
 * /admin/estructura · Organigrama del IDIC.
 * Árbol (Dirección → Departamentos → Secciones → Laboratorios / Sucursales /
 * Delegación; unidades de apoyo) con buscador, expandir/contraer y nº de personas.
 * Al elegir un nodo se abre el panel de edición, los jefes (titular/subrogante)
 * y la opción de agregar una unidad hija.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  TIPOS_UNIDAD, adminApi, aplanar, descendientes, metaTipo, ruta, tipoHijoSugerido,
  type NodoUnidad, type TipoUnidad, type Unidad, type Usuario,
} from "@/lib/admin";
import {
  AdminGuard, CabeceraAdmin, Campo, EstadoError, EstadoVacio, IconoUnidad, SkeletonLineas,
  useCarga, useConfirm, useToast,
} from "@/components/admin/ui";
import { SelectorUnidad, SelectorUsuario } from "@/components/admin/Selectores";

const ICONOS_SUGERIDOS = ["🏛", "🏢", "📂", "🧪", "⚗", "🔬", "🧫", "🧵", "👞", "🎯", "🔫", "💥", "⚙", "📏", "⚖", "🚗", "📡", "📍", "🚩", "🛠", "💼", "🛡"];

type Borrador = Omit<Unidad, "id"> & { id?: string };

const vacio = (padre: Unidad | null): Borrador => ({
  codigo: "", nombre: "", tipo: tipoHijoSugerido(padre?.tipo ?? null), padreId: padre?.id ?? null,
  sigla: "", icono: "", color: "", codsucdel: "", centroCosto: padre?.centroCosto ?? "", activo: true,
});

export default function EstructuraPage() {
  return (
    <AdminGuard permiso="admin.estructura">
      <Estructura />
    </AdminGuard>
  );
}

function Estructura() {
  const toast = useToast();
  const confirmar = useConfirm();
  const arbol = useCarga(() => adminApi.arbol());
  const usuarios = useCarga(() => adminApi.usuarios());

  const [q, setQ] = useState("");
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [verInactivas, setVerInactivas] = useState(false);
  const [selId, setSelId] = useState<string | null>(null);
  const [modo, setModo] = useState<"editar" | "crear">("editar");
  const [form, setForm] = useState<Borrador | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [jefes, setJefes] = useState<{ titularId: string | null; subroganteId: string | null }>({ titularId: null, subroganteId: null });

  const nodos = arbol.data ?? [];
  const planas: (NodoUnidad & { depth: number })[] = useMemo(() => aplanar(nodos), [nodos]);
  const unidades: Unidad[] = planas;
  const porId = useMemo(() => new Map(planas.map((u) => [u.id, u])), [planas]);
  const listaUsuarios: Usuario[] = usuarios.data ?? [];

  // abre los dos primeros niveles al cargar
  useEffect(() => {
    if (!arbol.data || abiertos.size) return;
    setAbiertos(new Set(planas.filter((u) => u.depth < 1).map((u) => u.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arbol.data]);

  // personas por unidad (directas)
  const personasPorUnidad = useMemo(() => {
    const m = new Map<string, Usuario[]>();
    for (const u of listaUsuarios) {
      if (!u.activo) continue;
      const ids = new Set(u.asignaciones.map((a) => a.unidad?.id).filter(Boolean) as string[]);
      ids.forEach((id) => m.set(id, [...(m.get(id) ?? []), u]));
    }
    return m;
  }, [listaUsuarios]);
  const nPersonas = (n: NodoUnidad) => n.nUsuarios ?? personasPorUnidad.get(n.id)?.length ?? 0;

  // búsqueda: coincidencias + sus ancestros
  const coincide = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return null;
    const hits = planas.filter((u) =>
      `${u.codigo} ${u.nombre} ${u.sigla ?? ""} ${u.codsucdel ?? ""} ${u.jefes?.map((j) => j.nombre).join(" ")}`.toLowerCase().includes(t));
    const visibles = new Set<string>();
    hits.forEach((h) => ruta(h.id, porId as Map<string, Unidad>).forEach((r) => visibles.add(r.id)));
    return { hits: new Set(hits.map((h) => h.id)), visibles };
  }, [q, planas, porId]);

  const sel = selId ? porId.get(selId) ?? null : null;

  // al cambiar de selección, carga el borrador
  function cargarBorrador() {
    if (!sel) { setForm(null); return; }
    const { hijos: _h, jefes: _j, depth: _d, nUsuarios: _n, ...base } = sel as any;
    setForm({ ...base, sigla: base.sigla ?? "", icono: base.icono ?? "", color: base.color ?? "", codsucdel: base.codsucdel ?? "", centroCosto: base.centroCosto ?? "" });
    setJefes({
      titularId: sel.jefes?.find((j) => j.rol === "titular")?.usuarioId ?? null,
      subroganteId: sel.jefes?.find((j) => j.rol === "subrogante")?.usuarioId ?? null,
    });
  }
  useEffect(() => {
    if (modo === "editar") cargarBorrador();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId, modo, arbol.data]);

  function seleccionar(id: string) {
    setModo("editar");
    setSelId(id);
    // garantiza que la ruta esté abierta
    setAbiertos((a) => {
      const n = new Set(a);
      ruta(id, porId as Map<string, Unidad>).slice(0, -1).forEach((r) => n.add(r.id));
      return n;
    });
  }
  function nuevaHija(padre: Unidad | null) {
    setModo("crear");
    setForm(vacio(padre));
    if (padre) setSelId(padre.id);
  }
  function toggle(id: string) {
    setAbiertos((a) => { const n = new Set(a); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  const original = useMemo(() => {
    if (!sel) return null;
    return JSON.stringify({
      codigo: sel.codigo, nombre: sel.nombre, tipo: sel.tipo, padreId: sel.padreId, sigla: sel.sigla ?? "", icono: sel.icono ?? "",
      color: sel.color ?? "", codsucdel: sel.codsucdel ?? "", centroCosto: sel.centroCosto ?? "", activo: sel.activo,
    });
  }, [sel]);
  const actual = form ? JSON.stringify({
    codigo: form.codigo, nombre: form.nombre, tipo: form.tipo, padreId: form.padreId, sigla: form.sigla ?? "", icono: form.icono ?? "",
    color: form.color ?? "", codsucdel: form.codsucdel ?? "", centroCosto: form.centroCosto ?? "", activo: form.activo,
  }) : null;
  const sucio = modo === "crear" || (original !== null && actual !== original);

  const payload = (f: Borrador) => ({
    codigo: f.codigo.trim(), nombre: f.nombre.trim(), tipo: f.tipo, padreId: f.padreId ?? null,
    sigla: f.sigla?.trim() || null, icono: f.icono?.trim() || null, color: f.color || null,
    codsucdel: f.codsucdel?.trim() || null, centroCosto: f.centroCosto?.trim() || null, activo: f.activo,
  });

  async function guardar() {
    if (!form) return;
    if (!form.codigo.trim() || !form.nombre.trim()) { toast.error("El código y el nombre son obligatorios."); return; }
    setGuardando(true);
    try {
      if (modo === "crear") {
        const creada = await adminApi.crearUnidad(payload(form));
        toast.ok(`Unidad ${form.codigo} creada.`);
        await arbol.recargar(true);
        setModo("editar");
        if (creada?.id) seleccionar(creada.id);
      } else if (sel) {
        await adminApi.actualizarUnidad(sel.id, payload(form));
        toast.ok(`Cambios de ${form.codigo} guardados.`);
        await arbol.recargar(true);
      }
    } catch (e) { toast.error(e); } finally { setGuardando(false); }
  }

  async function desactivar() {
    if (!sel) return;
    const nDesc = descendientes(sel.id, unidades).size;
    const ok = await confirmar({
      titulo: `¿Desactivar ${sel.codigo}?`, peligro: true, confirmar: "Desactivar",
      mensaje: <>La unidad <b>{sel.nombre}</b> dejará de aparecer en los formularios. No se borra: su historial se conserva
        y se puede reactivar.{nDesc > 0 && <> Tiene <b>{nDesc}</b> unidad(es) dependiente(s) que conviene revisar.</>}</>,
    });
    if (!ok) return;
    try { await adminApi.desactivarUnidad(sel.id); toast.ok(`${sel.codigo} desactivada.`); await arbol.recargar(true); }
    catch (e) { toast.error(e); }
  }
  async function reactivar() {
    if (!sel) return;
    try { await adminApi.actualizarUnidad(sel.id, { activo: true }); toast.ok(`${sel.codigo} reactivada.`); await arbol.recargar(true); }
    catch (e) { toast.error(e); }
  }
  async function guardarJefes() {
    if (!sel) return;
    if (jefes.titularId && jefes.titularId === jefes.subroganteId) { toast.error("El titular y el subrogante deben ser personas distintas."); return; }
    try {
      await adminApi.setJefes(sel.id, jefes);
      toast.ok(`Jefatura de ${sel.codigo} actualizada.`);
      await arbol.recargar(true);
    } catch (e) { toast.error(e); }
  }

  const jefesOriginal = JSON.stringify({
    titularId: sel?.jefes?.find((j) => j.rol === "titular")?.usuarioId ?? null,
    subroganteId: sel?.jefes?.find((j) => j.rol === "subrogante")?.usuarioId ?? null,
  });
  const jefesSucio = !!sel && JSON.stringify(jefes) !== jefesOriginal;

  const excluirPadre = useMemo(() => {
    if (modo === "crear" || !sel) return new Set<string>();
    const d = descendientes(sel.id, unidades); d.add(sel.id); return d;
  }, [modo, sel, unidades]);

  const total = planas.filter((u) => u.activo !== false).length;

  return (
    <div>
      <CabeceraAdmin icono="🏛" titulo="Estructura del IDIC"
        subtitulo="Organigrama que usa todo el sistema: define qué ve cada persona según su unidad y quién firma los documentos."
        acciones={<button className="btn primary sm" onClick={() => nuevaHija(null)}>＋ Nueva unidad raíz</button>} />

      {arbol.error ? <EstadoError error={arbol.error} onReintentar={() => arbol.recargar()} recurso="la estructura organizacional (/unidades)" /> : (
        <div className="grid gap-4 lg:grid-cols-[minmax(320px,1fr)_minmax(380px,1.15fr)] items-start">
          {/* ── Árbol ── */}
          <div className="card" style={{ marginBottom: 0 }}>
            <div className="flex gap-2 flex-wrap items-center mb-2">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por código, nombre, CODSUCDEL o jefe…"
                aria-label="Buscar unidad" className="flex-1 min-w-[180px] border border-[var(--line)] rounded-[5px] px-2 py-[6px] text-[12.5px]" />
              <button className="btn outline sm" onClick={() => setAbiertos(new Set(planas.map((u) => u.id)))}>Expandir todo</button>
              <button className="btn outline sm" onClick={() => setAbiertos(new Set())}>Contraer</button>
            </div>
            <div className="flex gap-2 flex-wrap items-center mb-3 text-[11px] text-[var(--muted)]">
              {TIPOS_UNIDAD.map((t) => (
                <span key={t.value} className="inline-flex items-center gap-1"><span style={{ color: t.color }}>{t.icono}</span>{t.label}</span>
              ))}
              <label className="ml-auto inline-flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={verInactivas} onChange={(e) => setVerInactivas(e.target.checked)} /> Ver inactivas
              </label>
            </div>
            {arbol.cargando ? <SkeletonLineas n={10} /> : nodos.length === 0 ? (
              <EstadoVacio icono="🏛" titulo="Aún no hay unidades" texto="Empieza creando la Dirección y luego agrega sus departamentos."
                accion={<button className="btn primary sm" onClick={() => nuevaHija(null)}>＋ Crear la primera unidad</button>} />
            ) : (
              <div role="tree" aria-label="Estructura del IDIC" className="max-h-[68vh] overflow-y-auto -mx-1 pr-1">
                {nodos.map((n) => (
                  <Nodo key={n.id} n={n} depth={0} abiertos={abiertos} toggle={toggle} selId={selId} onSel={seleccionar}
                    coincide={coincide} verInactivas={verInactivas} nPersonas={nPersonas} />
                ))}
                {coincide && coincide.hits.size === 0 && <div className="text-[12px] text-[var(--muted)] p-3">Ninguna unidad coincide con «{q}».</div>}
              </div>
            )}
            {!arbol.cargando && nodos.length > 0 && (
              <div className="text-[11px] text-[var(--muted)] mt-2 border-t border-[var(--line)] pt-2">
                {total} unidades activas · {listaUsuarios.filter((u) => u.activo).length} personas
                {usuarios.error ? " · (no se pudo cargar la lista de personas)" : ""}
              </div>
            )}
          </div>

          {/* ── Panel ── */}
          <div className="lg:sticky lg:top-0">
            {!form ? (
              <div className="card"><EstadoVacio icono="👈" titulo="Elige una unidad del árbol"
                texto="Verás sus datos, sus jefes (titular y subrogante) y podrás agregarle unidades hijas." /></div>
            ) : (
              <>
                <div className="card">
                  <div className="flex items-start gap-3 mb-3">
                    <IconoUnidad tipo={form.tipo} icono={form.icono} color={form.color} size={40} />
                    <div className="flex-1 min-w-0">
                      {modo === "crear" ? (
                        <>
                          <div className="font-bold text-[16px]">Nueva unidad</div>
                          <div className="text-[12px] text-[var(--muted)]">
                            {form.padreId ? <>Dependerá de <b>{porId.get(form.padreId)?.nombre}</b></> : "Unidad raíz (sin unidad superior)"}
                          </div>
                        </>
                      ) : sel && (
                        <>
                          <div className="font-bold text-[16px] flex items-center gap-2 flex-wrap">
                            <span className="codigo text-[14px]">{sel.codigo}</span> {sel.nombre}
                            {sel.activo === false && <span className="pill red">Inactiva</span>}
                          </div>
                          <div className="text-[11.5px] text-[var(--muted)]">
                            {ruta(sel.id, porId as Map<string, Unidad>).map((r, i, arr) => (
                              <span key={r.id}>
                                <button className="hover:underline" onClick={() => seleccionar(r.id)}>{r.codigo}</button>
                                {i < arr.length - 1 && " › "}
                              </span>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                    <span className="pill teal">{metaTipo(form.tipo).label}</span>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Campo label="Código" req ayuda="Identificador corto, p. ej. LCC, SANTOF, D11.">
                      <input value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value.toUpperCase() })} maxLength={20} />
                    </Campo>
                    <Campo label="Sigla" ayuda="Opcional: cómo se la nombra abreviada.">
                      <input value={form.sigla ?? ""} onChange={(e) => setForm({ ...form, sigla: e.target.value })} maxLength={20} />
                    </Campo>
                    <Campo label="Nombre" req className="sm:col-span-2">
                      <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} maxLength={150} />
                    </Campo>
                    <Campo label="Tipo de unidad" req>
                      <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as TipoUnidad })}>
                        {TIPOS_UNIDAD.map((t) => <option key={t.value} value={t.value}>{t.icono} {t.label}</option>)}
                      </select>
                    </Campo>
                    <Campo label="Depende de (unidad superior)">
                      <SelectorUnidad unidades={unidades} value={form.padreId} onChange={(v) => setForm({ ...form, padreId: v })}
                        nulo="— ninguna (unidad raíz) —" excluir={excluirPadre} ariaLabel="Unidad superior" />
                    </Campo>
                    <Campo label="CODSUCDEL" ayuda="Código heredado del sistema anterior (StarLIMS).">
                      <input value={form.codsucdel ?? ""} onChange={(e) => setForm({ ...form, codsucdel: e.target.value })} maxLength={20} />
                    </Campo>
                    <Campo label="Centro de costo">
                      <input value={form.centroCosto ?? ""} onChange={(e) => setForm({ ...form, centroCosto: e.target.value })} maxLength={20} />
                    </Campo>
                    <Campo label="Icono" ayuda="Opcional; si se deja vacío se usa el del tipo.">
                      <div className="flex gap-2 items-center">
                        <input value={form.icono ?? ""} onChange={(e) => setForm({ ...form, icono: e.target.value })} maxLength={4} className="w-16 text-center" aria-label="Icono" />
                        <div className="flex flex-wrap gap-1">
                          {ICONOS_SUGERIDOS.slice(0, 11).map((i) => (
                            <button key={i} type="button" onClick={() => setForm({ ...form, icono: i })} aria-label={`Usar icono ${i}`}
                              className={`w-6 h-6 rounded hover:bg-slate-100 ${form.icono === i ? "ring-2 ring-[var(--accent)]" : ""}`}>{i}</button>
                          ))}
                        </div>
                      </div>
                    </Campo>
                    <Campo label="Color" ayuda="Opcional; por defecto, el color del tipo.">
                      <div className="flex gap-2 items-center">
                        <input type="color" value={form.color || metaTipo(form.tipo).color} onChange={(e) => setForm({ ...form, color: e.target.value })}
                          className="w-12 h-8 p-0 border border-[var(--line)] rounded" aria-label="Color" />
                        {form.color && <button type="button" className="btn outline sm" onClick={() => setForm({ ...form, color: "" })}>Usar el del tipo</button>}
                      </div>
                    </Campo>
                    <label className="sm:col-span-2 inline-flex items-center gap-2 text-[12.5px] cursor-pointer">
                      <input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} />
                      Unidad activa (aparece en formularios y selectores)
                    </label>
                  </div>

                  <div className="flex gap-2 flex-wrap mt-4 pt-3 border-t border-[var(--line)]">
                    <button className="btn primary sm" disabled={!sucio || guardando} onClick={guardar}>
                      {guardando ? "Guardando…" : modo === "crear" ? "Crear unidad" : "Guardar cambios"}
                    </button>
                    {modo === "crear" ? (
                      <button className="btn outline sm" onClick={() => { setModo("editar"); if (!selId) setForm(null); }}>Cancelar</button>
                    ) : (
                      <>
                        {sucio && <button className="btn outline sm" onClick={cargarBorrador}>Descartar</button>}
                        <div className="flex-1" />
                        {sel?.activo === false
                          ? <button className="btn success sm" onClick={reactivar}>Reactivar</button>
                          : <button className="btn outline sm" style={{ color: "var(--red)" }} onClick={desactivar}>Desactivar</button>}
                      </>
                    )}
                  </div>
                </div>

                {modo === "editar" && sel && (
                  <>
                    {/* Jefes */}
                    <div className="card">
                      <h2>👔 Jefatura</h2>
                      <p className="text-[12px] text-[var(--muted)] mb-3">
                        El <b>titular</b> firma por la unidad; el <b>subrogante</b> lo reemplaza cuando está ausente. La matriz de
                        firmas usa estas personas al resolver «Jefe de {metaTipo(sel.tipo).label}».
                      </p>
                      {usuarios.error ? <EstadoError error={usuarios.error} recurso="la lista de personas" onReintentar={() => usuarios.recargar()} /> : (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Campo label="Titular">
                            <SelectorUsuario usuarios={listaUsuarios} value={jefes.titularId} onChange={(v) => setJefes({ ...jefes, titularId: v })} ariaLabel="Jefe titular" />
                          </Campo>
                          <Campo label="Subrogante">
                            <SelectorUsuario usuarios={listaUsuarios} value={jefes.subroganteId} onChange={(v) => setJefes({ ...jefes, subroganteId: v })} ariaLabel="Jefe subrogante" />
                          </Campo>
                        </div>
                      )}
                      <div className="mt-3 flex gap-2">
                        <button className="btn primary sm" disabled={!jefesSucio} onClick={guardarJefes}>Guardar jefatura</button>
                      </div>
                    </div>

                    {/* Personas */}
                    <div className="card">
                      <h2>👥 Personas en esta unidad <span className="right">{personasPorUnidad.get(sel.id)?.length ?? 0}</span></h2>
                      {(personasPorUnidad.get(sel.id) ?? []).length === 0 ? (
                        <div className="text-[12px] text-[var(--muted)]">Nadie tiene un rol asignado directamente en {sel.codigo}.</div>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {(personasPorUnidad.get(sel.id) ?? []).map((u) => (
                            <span key={u.id} className="pill gray" title={u.cargo ?? ""}>
                              {u.nombre} · {u.asignaciones.filter((a) => a.unidad?.id === sel.id).map((a) => a.rol.nombre).join(", ")}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="mt-2"><Link href={`/admin/usuarios?unidad=${sel.id}` as any} className="text-[12px] text-[var(--accent)] font-semibold">Gestionar personas de {sel.codigo} →</Link></div>
                    </div>

                    {/* Hijas */}
                    <div className="card">
                      <h2>🧩 Unidades dependientes <span className="right">{sel.hijos.length}</span></h2>
                      {sel.hijos.length === 0 ? (
                        <div className="text-[12px] text-[var(--muted)] mb-2">{sel.codigo} no tiene unidades dependientes.</div>
                      ) : (
                        <div className="flex flex-wrap gap-2 mb-3">
                          {sel.hijos.map((h) => (
                            <button key={h.id} onClick={() => seleccionar(h.id)}
                              className="inline-flex items-center gap-2 border border-[var(--line)] rounded-full pl-1 pr-3 py-[2px] bg-white hover:bg-slate-50 text-[12px]">
                              <IconoUnidad tipo={h.tipo} icono={h.icono} color={h.color} size={20} />
                              <span className="codigo">{h.codigo}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      <button className="btn accent sm" onClick={() => nuevaHija(sel)}>＋ Agregar unidad hija</button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Nodo({ n, depth, abiertos, toggle, selId, onSel, coincide, verInactivas, nPersonas }: {
  n: NodoUnidad; depth: number; abiertos: Set<string>; toggle: (id: string) => void; selId: string | null; onSel: (id: string) => void;
  coincide: { hits: Set<string>; visibles: Set<string> } | null; verInactivas: boolean; nPersonas: (n: NodoUnidad) => number;
}) {
  if (!verInactivas && n.activo === false) return null;
  if (coincide && !coincide.visibles.has(n.id)) return null;
  const hijos = n.hijos.filter((h) => verInactivas || h.activo !== false);
  const abierto = coincide ? true : abiertos.has(n.id);
  const titular = n.jefes?.find((j) => j.rol === "titular");
  const hit = coincide?.hits.has(n.id);
  const np = nPersonas(n);
  return (
    <div role="treeitem" aria-expanded={hijos.length ? abierto : undefined} aria-selected={selId === n.id}>
      <div className={`flex items-center gap-1 rounded-md pr-2 py-[3px] cursor-pointer group ${selId === n.id ? "bg-[#e6f4f6] ring-1 ring-[var(--accent)]" : "hover:bg-slate-50"} ${n.activo === false ? "opacity-50" : ""}`}
        style={{ paddingLeft: 4 + depth * 18 }} onClick={() => onSel(n.id)}>
        <button type="button" aria-label={abierto ? "Contraer" : "Expandir"} onClick={(e) => { e.stopPropagation(); toggle(n.id); }}
          className={`w-5 h-5 text-[10px] text-[var(--muted)] rounded hover:bg-slate-200 ${hijos.length ? "" : "invisible"}`}>
          {abierto ? "▼" : "▶"}
        </button>
        <IconoUnidad tipo={n.tipo} icono={n.icono} color={n.color} size={22} />
        <span className="codigo ml-1">{n.codigo}</span>
        <span className={`truncate text-[12.5px] ${hit ? "bg-yellow-100 rounded px-1" : ""}`}>{n.nombre}</span>
        {titular && <span className="hidden xl:inline text-[10.5px] text-[var(--muted)] truncate">· {titular.nombre}</span>}
        <span className="ml-auto flex items-center gap-1 shrink-0">
          {n.activo === false && <span className="pill red">inactiva</span>}
          <span className={`pill ${np ? "blue" : "gray"}`} title="Personas con rol en esta unidad">👤 {np}</span>
        </span>
      </div>
      {abierto && hijos.length > 0 && (
        <div role="group">
          {hijos.map((h) => (
            <Nodo key={h.id} n={h} depth={depth + 1} abiertos={abiertos} toggle={toggle} selId={selId} onSel={onSel}
              coincide={coincide} verInactivas={verInactivas} nPersonas={nPersonas} />
          ))}
        </div>
      )}
    </div>
  );
}
