"use client";

/**
 * /admin/roles · Roles y permisos.
 * Izquierda: roles agrupados por nivel. Derecha: ficha del rol (nombre, nivel,
 * alcance, descripción) + matriz de permisos (módulos × acciones) con «marcar
 * módulo», buscador, indicador de cambios y Guardar. Vista «Comparar roles»:
 * roles en columnas × permisos en filas, solo lectura.
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import {
  ALCANCES, ALCANCE, NIVELES_ROL, NIVEL_ROL, adminApi,
  type AlcanceRol, type MatrizPermisos, type NivelRol, type PermisoItem, type Rol,
} from "@/lib/admin";
import {
  AdminGuard, CabeceraAdmin, Campo, EstadoError, EstadoVacio, Modal, Skeleton, SkeletonLineas,
  useCarga, useConfirm, useToast,
} from "@/components/admin/ui";

const ORDEN_ACCIONES = ["ver", "crear", "editar", "revisar", "aprobar", "emitir", "firmar", "cerrar", "transferir", "gestionar", "cobrar", "publicar", "registrar"];
const ETQ_ACCION: Record<string, string> = {
  ver: "Ver", crear: "Crear", editar: "Editar", revisar: "Revisar", aprobar: "Aprobar", emitir: "Emitir", firmar: "Firmar",
  cerrar: "Cerrar", transferir: "Transferir", gestionar: "Gestionar", cobrar: "Cobrar", publicar: "Publicar", registrar: "Registrar",
};
const ETQ_MODULO: Record<string, string> = {
  admin: "Administración", audit: "Auditoría", catalogo: "Catálogo", cliente: "Clientes", cotizacion: "Cotizaciones",
  factura: "Facturación", ot: "Órdenes de trabajo", muestra: "Muestras", resultado: "Resultados", certificado: "Informes y certificados",
  metodo: "Métodos", equipo: "Equipos", plantilla: "Plantillas", flujo: "Flujos", nc: "No conformidades", firma: "Firma",
  metrologia: "Metrología", evidencia: "Evidencias (SAEC)", arma: "Armas (SAEC)", ibis: "IBIS", caso: "Casos (SAEC)",
};
const etqAccion = (a: string) => ETQ_ACCION[a] ?? a.charAt(0).toUpperCase() + a.slice(1);
/** Orden de presentación: Dirección, Jefaturas, Operativos, Soporte, Sistema (estable dentro de cada nivel). */
function ordenarPorNivel<T extends { nivel: string }>(rs: T[]): T[] {
  const pos = (n: string) => { const i = NIVELES_ROL.findIndex((x) => x.value === n); return i < 0 ? 99 : i; };
  return rs.map((r, i) => [r, i] as const).sort((a, b) => pos(a[0].nivel) - pos(b[0].nivel) || a[1] - b[1]).map(([r]) => r);
}
const etqModulo = (m: string) => ETQ_MODULO[m] ?? m.charAt(0).toUpperCase() + m.slice(1);

export default function RolesPage() {
  return (
    <AdminGuard permiso="admin.roles">
      <Roles />
    </AdminGuard>
  );
}

function Roles() {
  const toast = useToast();
  const confirmar = useConfirm();
  const roles = useCarga(() => adminApi.roles());
  const matriz = useCarga(() => adminApi.matriz());
  const [selId, setSelId] = useState<string | null>(null);
  const [vista, setVista] = useState<"editar" | "comparar">("editar");
  const [nuevo, setNuevo] = useState(false);
  const [sucio, setSucio] = useState(false);

  const lista: Rol[] = useMemo(() => ordenarPorNivel(roles.data ?? []), [roles.data]);
  useEffect(() => { if (!selId && lista.length) setSelId(lista[0].id); }, [lista, selId]);
  const sel = lista.find((r) => r.id === selId) ?? null;

  async function elegir(id: string) {
    if (id === selId) return;
    if (sucio && !(await confirmar({ titulo: "Hay cambios sin guardar", mensaje: "Si cambias de rol se descartarán los cambios de permisos. ¿Continuar?", confirmar: "Descartar y cambiar", peligro: true }))) return;
    setSucio(false);
    setSelId(id);
    setVista("editar");
  }

  return (
    <div>
      <CabeceraAdmin icono="🔑" titulo="Roles y permisos"
        subtitulo="Un rol es un conjunto de permisos (qué puede hacer) más un alcance (qué parte del IDIC ve). Las personas reciben roles en Usuarios."
        acciones={
          <>
            <div className="inline-flex rounded-md border border-[var(--line)] bg-white p-[2px]" role="tablist">
              {(["editar", "comparar"] as const).map((v) => (
                <button key={v} role="tab" aria-selected={vista === v} onClick={() => setVista(v)}
                  className={`px-3 py-1 rounded text-[12px] font-semibold ${vista === v ? "bg-[var(--primary)] text-white" : "text-[var(--muted)]"}`}>
                  {v === "editar" ? "Editar rol" : "Comparar roles"}
                </button>
              ))}
            </div>
            <button className="btn primary sm" onClick={() => setNuevo(true)} disabled={!!roles.error}>＋ Nuevo rol</button>
          </>
        } />

      {roles.error ? <EstadoError error={roles.error} onReintentar={() => roles.recargar()} recurso="los roles (/roles)" /> : vista === "comparar" ? (
        matriz.error ? <EstadoError error={matriz.error} onReintentar={() => matriz.recargar()} recurso="la matriz de permisos (/permisos/matriz)" />
          : matriz.cargando || !matriz.data ? <div className="card"><SkeletonLineas n={10} /></div>
          : <Comparar matriz={matriz.data} roles={lista} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr] items-start">
          {/* Lista de roles */}
          <div className="card lg:sticky lg:top-0" style={{ padding: 8, marginBottom: 0 }}>
            {roles.cargando ? <SkeletonLineas n={10} /> : lista.length === 0 ? (
              <EstadoVacio icono="🔑" titulo="No hay roles" accion={<button className="btn primary sm" onClick={() => setNuevo(true)}>＋ Crear rol</button>} />
            ) : NIVELES_ROL.map((n) => {
              const rs = lista.filter((r) => r.nivel === n.value);
              if (!rs.length) return null;
              return (
                <div key={n.value} className="mb-2">
                  <div className="flex items-center px-2 pt-2 pb-1 text-[10px] uppercase tracking-wider text-[var(--muted)] font-semibold">
                    {n.grupo}<span className="ml-auto pill gray">{rs.length}</span>
                  </div>
                  {rs.map((r) => (
                    <button key={r.id} onClick={() => elegir(r.id)} aria-current={r.id === selId}
                      className={`w-full text-left rounded-md px-2 py-[6px] flex items-start gap-2 ${r.id === selId ? "bg-[#e6f4f6] ring-1 ring-[var(--accent)]" : "hover:bg-slate-50"}`}>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-[12.5px] truncate">{r.nombre}</div>
                        <div className="text-[10.5px] text-[var(--muted)] truncate"><span className="codigo text-[10px]">{r.codigo}</span> · {ALCANCE[r.alcance]?.label ?? r.alcance}</div>
                      </div>
                      <div className="text-right text-[10.5px] text-[var(--muted)] shrink-0 leading-tight">
                        {r.nPermisos != null && <div title="Permisos">🔑 {r.nPermisos}</div>}
                        {r.nUsuarios != null && <div title="Personas">👤 {r.nUsuarios}</div>}
                      </div>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>

          {/* Ficha + matriz */}
          <div className="min-w-0">
            {!sel ? (
              roles.cargando ? <Skeleton className="h-64" /> : <div className="card"><EstadoVacio icono="👈" titulo="Elige un rol de la lista" /></div>
            ) : (
              <>
                <FichaRol key={sel.id} rol={sel} onGuardado={() => roles.recargar(true)} />
                {matriz.error ? <EstadoError error={matriz.error} onReintentar={() => matriz.recargar()} recurso="la matriz de permisos (/permisos/matriz)" />
                  : matriz.cargando || !matriz.data ? <div className="card"><SkeletonLineas n={8} /></div>
                  : <EditorPermisos key={sel.id} rol={sel} matriz={matriz.data} onSucio={setSucio}
                      onGuardado={async () => { setSucio(false); await Promise.all([roles.recargar(true), matriz.recargar(true)]); }} />}
              </>
            )}
          </div>
        </div>
      )}

      {nuevo && (
        <NuevoRol onClose={() => setNuevo(false)} onCreado={async (r) => {
          setNuevo(false);
          toast.ok(`Rol ${r.nombre} creado. Ahora marca sus permisos.`);
          await Promise.all([roles.recargar(true), matriz.recargar(true)]);
          setSelId(r.id); setVista("editar");
        }} />
      )}
    </div>
  );
}

// ───────────────────────────── Ficha del rol ─────────────────────────────

function FichaRol({ rol, onGuardado }: { rol: Rol; onGuardado: () => Promise<void> }) {
  const toast = useToast();
  const inicial = { nombre: rol.nombre, nivel: rol.nivel, alcance: rol.alcance, descripcion: rol.descripcion ?? "" };
  const [f, setF] = useState(inicial);
  const [editando, setEditando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const nivel = NIVEL_ROL[rol.nivel];

  async function guardar() {
    if (!f.nombre.trim()) { toast.error("El nombre es obligatorio."); return; }
    setGuardando(true);
    try {
      await adminApi.actualizarRol(rol.id, { nombre: f.nombre.trim(), nivel: f.nivel, alcance: f.alcance, descripcion: f.descripcion.trim() || null });
      toast.ok("Datos del rol guardados.");
      setEditando(false);
      await onGuardado();
    } catch (e) { toast.error(e); } finally { setGuardando(false); }
  }

  return (
    <div className="card">
      {!editando ? (
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex-1 min-w-[220px]">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-[17px]">{rol.nombre}</span>
              <span className="codigo">{rol.codigo}</span>
              <span className={`pill ${nivel?.color ?? "gray"}`}>{nivel?.label ?? rol.nivel}</span>
              {rol.esSistema && <span className="pill gray">🔒 Rol de sistema</span>}
            </div>
            <div className="text-[12.5px] text-[var(--muted)] mt-1">{rol.descripcion || <i>Sin descripción</i>}</div>
            <div className="mt-2 text-[12.5px]">
              <b>Alcance:</b> {ALCANCE[rol.alcance]?.label ?? rol.alcance}
              <span className="text-[var(--muted)]"> — {ALCANCE[rol.alcance]?.ayuda}</span>
            </div>
          </div>
          <div className="flex gap-3 items-center text-[12px] text-[var(--muted)]">
            {rol.nUsuarios != null && <span>👤 {rol.nUsuarios} persona(s)</span>}
            <button className="btn outline sm" onClick={() => { setF(inicial); setEditando(true); }}>✎ Editar datos</button>
          </div>
        </div>
      ) : (
        <div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Campo label="Nombre" req><input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} maxLength={100} /></Campo>
            <Campo label="Nivel">
              <select value={f.nivel} onChange={(e) => setF({ ...f, nivel: e.target.value as NivelRol })}>
                {NIVELES_ROL.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
              </select>
            </Campo>
            <Campo label="Alcance" ayuda={ALCANCE[f.alcance]?.ayuda}>
              <select value={f.alcance} onChange={(e) => setF({ ...f, alcance: e.target.value as AlcanceRol })}>
                {ALCANCES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </Campo>
            <Campo label="Descripción" className="sm:col-span-3">
              <textarea rows={2} value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} maxLength={500} />
            </Campo>
          </div>
          {f.alcance !== rol.alcance && (
            <div className="alert warn mt-3" style={{ marginBottom: 0 }}>
              Cambiar el alcance afecta de inmediato lo que ven las {rol.nUsuarios ?? "las"} persona(s) con este rol.
            </div>
          )}
          <div className="flex gap-2 mt-3">
            <button className="btn primary sm" disabled={guardando} onClick={guardar}>{guardando ? "Guardando…" : "Guardar"}</button>
            <button className="btn outline sm" onClick={() => setEditando(false)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── Editor de permisos ─────────────────────────────

function columnasAcciones(modulos: MatrizPermisos["modulos"]) {
  const usos = new Map<string, number>();
  modulos.forEach((m) => new Set(m.permisos.map((p) => p.accion)).forEach((a) => usos.set(a, (usos.get(a) ?? 0) + 1)));
  const comunes = [...usos.entries()].filter(([, n]) => n >= 2).map(([a]) => a);
  comunes.sort((a, b) => {
    const ia = ORDEN_ACCIONES.indexOf(a), ib = ORDEN_ACCIONES.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  return comunes;
}

function EditorPermisos({ rol, matriz, onSucio, onGuardado }: {
  rol: Rol; matriz: MatrizPermisos; onSucio: (s: boolean) => void; onGuardado: () => Promise<void>;
}) {
  const toast = useToast();
  const confirmar = useConfirm();
  const [original, setOriginal] = useState<Set<string> | null>(null);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [error, setError] = useState<unknown>(null);
  const [q, setQ] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [verCambios, setVerCambios] = useState(false);

  useEffect(() => {
    let vivo = true;
    adminApi.permisosRol(rol.id)
      .then((cods) => { if (vivo) { setOriginal(new Set(cods)); setDraft(new Set(cods)); } })
      .catch((e) => {
        // respaldo: lo que trae la matriz
        const cods = matriz.asignaciones?.[rol.id];
        if (!vivo) return;
        if (cods) { setOriginal(new Set(cods)); setDraft(new Set(cods)); } else setError(e);
      });
    return () => { vivo = false; };
  }, [rol.id, matriz]);

  const agregados = useMemo(() => original ? [...draft].filter((c) => !original.has(c)) : [], [draft, original]);
  const quitados = useMemo(() => original ? [...original].filter((c) => !draft.has(c)) : [], [draft, original]);
  const nCambios = agregados.length + quitados.length;
  useEffect(() => { onSucio(nCambios > 0); }, [nCambios, onSucio]);

  const columnas = useMemo(() => columnasAcciones(matriz.modulos), [matriz.modulos]);
  const descPorCodigo = useMemo(() => new Map(matriz.modulos.flatMap((m) => m.permisos.map((p) => [p.codigo, p] as const))), [matriz.modulos]);

  const modulos = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return matriz.modulos;
    return matriz.modulos
      .map((m) => (etqModulo(m.modulo).toLowerCase().includes(t) || m.modulo.includes(t))
        ? m
        : { ...m, permisos: m.permisos.filter((p) => `${p.codigo} ${p.descripcion ?? ""} ${etqAccion(p.accion)}`.toLowerCase().includes(t)) })
      .filter((m) => m.permisos.length);
  }, [q, matriz.modulos]);

  function set(codigo: string, on: boolean) {
    setDraft((d) => { const n = new Set(d); on ? n.add(codigo) : n.delete(codigo); return n; });
  }
  function setModulo(ps: PermisoItem[], on: boolean) {
    setDraft((d) => { const n = new Set(d); ps.forEach((p) => (on ? n.add(p.codigo) : n.delete(p.codigo))); return n; });
  }
  async function guardar() {
    if (rol.esSistema && !(await confirmar({
      titulo: `¿Modificar el rol de sistema ${rol.codigo}?`, confirmar: "Guardar igualmente", peligro: true,
      mensaje: "Es un rol base del sistema. Un cambio aquí puede dejar sin acceso a la administración.",
    }))) return;
    setGuardando(true);
    try {
      await adminApi.setPermisosRol(rol.id, [...draft].sort());
      toast.ok(`Permisos de ${rol.nombre} guardados (${agregados.length ? `+${agregados.length}` : ""}${agregados.length && quitados.length ? " / " : ""}${quitados.length ? `−${quitados.length}` : ""}).`);
      setOriginal(new Set(draft));
      await onGuardado();
    } catch (e) { toast.error(e); } finally { setGuardando(false); }
  }

  if (error) return <EstadoError error={error} recurso="los permisos del rol" />;
  if (!original) return <div className="card"><SkeletonLineas n={8} /></div>;

  const estadoCelda = (codigo: string) => {
    const on = draft.has(codigo);
    const era = original.has(codigo);
    return { on, cambio: on !== era ? (on ? "add" : "del") : null };
  };

  return (
    <div className="card" style={{ padding: 0 }}>
      {/* barra */}
      <div className={`flex gap-2 flex-wrap items-center p-3 border-b border-[var(--line)] sticky top-0 z-10 rounded-t-[9px] ${nCambios ? "bg-[#fff6e8]" : "bg-white"}`}>
        <div className="font-bold text-[14px] mr-2">Permisos <span className="text-[var(--muted)] font-normal text-[12px]">{draft.size} marcados</span></div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar módulo o permiso…" aria-label="Buscar permiso"
          className="flex-1 min-w-[160px] border border-[var(--line)] rounded-[5px] px-2 py-[5px] text-[12px]" />
        {nCambios > 0 ? (
          <>
            <button className="text-[12px] font-semibold text-[#7a4b00] underline" onClick={() => setVerCambios((v) => !v)}>
              {nCambios} cambio(s) sin guardar: <span className="text-[var(--green)]">+{agregados.length}</span> / <span className="text-[var(--red)]">−{quitados.length}</span>
            </button>
            <button className="btn outline sm" onClick={() => setDraft(new Set(original))}>Descartar</button>
            <button className="btn primary sm" disabled={guardando} onClick={guardar}>{guardando ? "Guardando…" : "💾 Guardar"}</button>
          </>
        ) : <span className="text-[12px] text-[var(--muted)]">Sin cambios</span>}
      </div>
      {verCambios && nCambios > 0 && (
        <div className="px-3 py-2 border-b border-[var(--line)] text-[12px] flex flex-wrap gap-1">
          {agregados.map((c) => <span key={c} className="pill green" title={descPorCodigo.get(c)?.descripcion ?? ""}>+ {c}</span>)}
          {quitados.map((c) => <span key={c} className="pill red" title={descPorCodigo.get(c)?.descripcion ?? ""}>− {c}</span>)}
        </div>
      )}
      {rol.esSistema && <div className="alert info m-3" style={{ marginBottom: 0 }}>Rol de sistema: modifícalo con cuidado.</div>}

      {modulos.length === 0 ? <EstadoVacio icono="🔎" titulo="Ningún permiso coincide con la búsqueda" /> : (
        <div className="overflow-x-auto">
          <table className="data">
            <thead>
              <tr>
                <th style={{ minWidth: 190 }}>Módulo</th>
                {columnas.map((a) => <th key={a} style={{ textAlign: "center" }}>{etqAccion(a)}</th>)}
                <th>Otras acciones</th>
              </tr>
            </thead>
            <tbody>
              {modulos.map((m) => {
                const marcados = m.permisos.filter((p) => draft.has(p.codigo)).length;
                const todos = marcados === m.permisos.length;
                const otras = m.permisos.filter((p) => !columnas.includes(p.accion));
                return (
                  <tr key={m.modulo}>
                    <td>
                      <label className="flex items-center gap-2 cursor-pointer" title="Marcar / desmarcar todo el módulo">
                        <input type="checkbox" checked={todos} ref={(el) => { if (el) el.indeterminate = marcados > 0 && !todos; }}
                          onChange={() => setModulo(m.permisos, !todos)} aria-label={`Marcar módulo ${etqModulo(m.modulo)}`} />
                        <span className="font-semibold">{etqModulo(m.modulo)}</span>
                        <span className="text-[10.5px] text-[var(--muted)]">{marcados}/{m.permisos.length}</span>
                      </label>
                    </td>
                    {columnas.map((a) => {
                      const p = m.permisos.find((x) => x.accion === a);
                      if (!p) return <td key={a} style={{ textAlign: "center", color: "#cbd5e1" }}>·</td>;
                      const s = estadoCelda(p.codigo);
                      return (
                        <td key={a} style={{ textAlign: "center" }}>
                          <label className={`inline-flex items-center justify-center w-7 h-7 rounded cursor-pointer ${s.cambio === "add" ? "ring-2 ring-[var(--green)] bg-[#e9f6ee]" : s.cambio === "del" ? "ring-2 ring-[var(--red)] bg-[#fdecec]" : ""}`}
                            title={`${p.codigo}${p.descripcion ? ` — ${p.descripcion}` : ""}`}>
                            <input type="checkbox" checked={s.on} onChange={(e) => set(p.codigo, e.target.checked)} aria-label={p.codigo} />
                          </label>
                        </td>
                      );
                    })}
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {otras.map((p) => {
                          const s = estadoCelda(p.codigo);
                          return (
                            <label key={p.codigo} title={`${p.codigo}${p.descripcion ? ` — ${p.descripcion}` : ""}`}
                              className={`inline-flex items-center gap-1 rounded-full border px-2 py-[1px] text-[11px] cursor-pointer ${s.on ? "bg-[#e6f4f6] border-[var(--accent)]" : "bg-white border-[var(--line)]"} ${s.cambio === "add" ? "ring-2 ring-[var(--green)]" : s.cambio === "del" ? "ring-2 ring-[var(--red)]" : ""}`}>
                              <input type="checkbox" checked={s.on} onChange={(e) => set(p.codigo, e.target.checked)} />
                              {etqAccion(p.accion)}
                            </label>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="p-3 text-[11.5px] text-[var(--muted)] border-t border-[var(--line)]">
        Pasa el cursor sobre una casilla para ver el código y la descripción del permiso. Los cambios no se aplican hasta pulsar <b>Guardar</b>.
      </div>
    </div>
  );
}

// ───────────────────────────── Comparar ─────────────────────────────

function Comparar({ matriz, roles }: { matriz: MatrizPermisos; roles: Rol[] }) {
  const base = ordenarPorNivel(matriz.roles?.length ? matriz.roles : roles);
  const [visibles, setVisibles] = useState<Set<string>>(() => new Set(base.map((r) => r.id)));
  const [modulo, setModulo] = useState("");
  const [soloDif, setSoloDif] = useState(false);
  const cols = base.filter((r) => visibles.has(r.id));
  const tiene = (rolId: string, cod: string) => (matriz.asignaciones?.[rolId] ?? []).includes(cod);

  const modulos = matriz.modulos
    .filter((m) => !modulo || m.modulo === modulo)
    .map((m) => ({
      ...m,
      permisos: soloDif ? m.permisos.filter((p) => {
        const v = cols.map((r) => tiene(r.id, p.codigo));
        return v.some(Boolean) && !v.every(Boolean);
      }) : m.permisos,
    }))
    .filter((m) => m.permisos.length);

  return (
    <div>
      <div className="card" style={{ padding: 12 }}>
        <div className="flex gap-3 flex-wrap items-end">
          <Campo label="Módulo">
            <select value={modulo} onChange={(e) => setModulo(e.target.value)} aria-label="Filtrar por módulo">
              <option value="">Todos los módulos</option>
              {matriz.modulos.map((m) => <option key={m.modulo} value={m.modulo}>{etqModulo(m.modulo)}</option>)}
            </select>
          </Campo>
          <label className="inline-flex items-center gap-2 text-[12.5px] cursor-pointer pb-2">
            <input type="checkbox" checked={soloDif} onChange={(e) => setSoloDif(e.target.checked)} /> Solo diferencias
          </label>
          <div className="flex-1" />
          <button className="btn outline sm" onClick={() => setVisibles(new Set(base.map((r) => r.id)))}>Todos los roles</button>
          <button className="btn outline sm" onClick={() => setVisibles(new Set())}>Ninguno</button>
        </div>
        <div className="flex flex-wrap gap-1 mt-3">
          {base.map((r) => {
            const on = visibles.has(r.id);
            return (
              <button key={r.id} onClick={() => setVisibles((v) => { const n = new Set(v); on ? n.delete(r.id) : n.add(r.id); return n; })}
                className={`rounded-full px-2 py-[2px] text-[11px] font-semibold border ${on ? "bg-[var(--primary)] text-white border-[var(--primary)]" : "bg-white text-[var(--muted)] border-[var(--line)]"}`}
                aria-pressed={on}>{r.nombre}</button>
            );
          })}
        </div>
      </div>

      {cols.length === 0 ? <div className="card"><EstadoVacio icono="☝" titulo="Elige al menos un rol para comparar" /></div>
        : modulos.length === 0 ? <div className="card"><EstadoVacio icono="🟰" titulo="Sin diferencias" texto="Los roles elegidos tienen exactamente los mismos permisos en este filtro." /></div>
        : (
          <div className="card card--table overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-[#eef3f7] z-[1]" style={{ minWidth: 220 }}>Permiso</th>
                  {cols.map((r) => (
                    <th key={r.id} style={{ textAlign: "center", minWidth: 70, whiteSpace: "nowrap" }} title={r.nombre}>
                      <div>{r.codigo}</div>
                      <div className="normal-case font-normal text-[10px]">{NIVEL_ROL[r.nivel as NivelRol]?.label ?? ""}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {modulos.map((m) => (
                  <Fragment key={m.modulo}>
                    <tr>
                      <td colSpan={cols.length + 1} className="bg-slate-50 font-bold text-[12px] sticky left-0">{etqModulo(m.modulo)}</td>
                    </tr>
                    {m.permisos.map((p) => (
                      <tr key={p.codigo}>
                        <td className="sticky left-0 bg-white z-[1]">
                          <div className="codigo">{p.codigo}</div>
                          {p.descripcion && <div className="text-[11px] text-[var(--muted)]">{p.descripcion}</div>}
                        </td>
                        {cols.map((r) => (
                          <td key={r.id} style={{ textAlign: "center" }}>
                            {tiene(r.id, p.codigo)
                              ? <span className="text-[var(--green)] font-bold" aria-label="Sí">✓</span>
                              : <span className="text-slate-300" aria-label="No">·</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}

// ───────────────────────────── Nuevo rol ─────────────────────────────

function NuevoRol({ onClose, onCreado }: { onClose: () => void; onCreado: (r: Rol) => Promise<void> }) {
  const toast = useToast();
  const [f, setF] = useState({ codigo: "", nombre: "", nivel: "OPERATIVO" as NivelRol, alcance: "UNIDAD" as AlcanceRol, descripcion: "" });
  const [guardando, setGuardando] = useState(false);
  async function crear() {
    if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(f.codigo)) { toast.error("El código va en MAYÚSCULAS, sin espacios (p. ej. JEFE_SUCURSAL)."); return; }
    if (!f.nombre.trim()) { toast.error("El nombre es obligatorio."); return; }
    setGuardando(true);
    try {
      const r = await adminApi.crearRol({ ...f, nombre: f.nombre.trim(), descripcion: f.descripcion.trim() || null });
      await onCreado(r);
    } catch (e) { toast.error(e); } finally { setGuardando(false); }
  }
  return (
    <Modal titulo="Nuevo rol" onClose={onClose} ancho={560}
      pie={<><button className="btn outline sm" onClick={onClose}>Cancelar</button><button className="btn primary sm" disabled={guardando} onClick={crear}>{guardando ? "Creando…" : "Crear rol"}</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo label="Código" req ayuda="Interno, en mayúsculas.">
          <input value={f.codigo} onChange={(e) => setF({ ...f, codigo: e.target.value.toUpperCase().replace(/\s+/g, "_") })} maxLength={40} placeholder="JEFE_SUCURSAL" />
        </Campo>
        <Campo label="Nombre" req><input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} maxLength={100} placeholder="Jefe de Sucursal" /></Campo>
        <Campo label="Nivel">
          <select value={f.nivel} onChange={(e) => setF({ ...f, nivel: e.target.value as NivelRol })}>
            {NIVELES_ROL.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
          </select>
        </Campo>
        <Campo label="Alcance" ayuda={ALCANCE[f.alcance]?.ayuda}>
          <select value={f.alcance} onChange={(e) => setF({ ...f, alcance: e.target.value as AlcanceRol })}>
            {ALCANCES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </Campo>
        <Campo label="Descripción" className="sm:col-span-2">
          <textarea rows={2} value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} maxLength={500} />
        </Campo>
      </div>
    </Modal>
  );
}
