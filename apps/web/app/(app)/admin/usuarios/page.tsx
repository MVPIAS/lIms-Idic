"use client";

/**
 * /admin/usuarios · Personas con acceso al LIMS.
 * Tabla con filtros (unidad en árbol, rol, estado) y panel lateral por persona:
 * Datos · Roles y alcance (asignaciones rol+unidad, subrogancias con fecha) · Acciones
 * (activar/desactivar, restablecer contraseña).
 */

import { useEffect, useMemo, useState } from "react";
import DataTable, { type DataColumn } from "@/components/DataTable";
import {
  ALCANCE, NIVELES_ROL, NIVEL_ROL, adminApi, descendientes, fechaCorta, metaTipo, textoAlcance, vigente,
  type Asignacion, type Rol, type Unidad, type Usuario,
} from "@/lib/admin";
import {
  AdminGuard, CabeceraAdmin, Campo, Drawer, EstadoError, EstadoVacio, IconoUnidad, SkeletonLineas,
  copiar, useCarga, useConfirm, useToast,
} from "@/components/admin/ui";
import { SelectorUnidad, iniciales } from "@/components/admin/Selectores";

export default function UsuariosAdminPage() {
  return (
    <AdminGuard permiso="admin.usuarios">
      <Usuarios />
    </AdminGuard>
  );
}

function Usuarios() {
  const usuarios = useCarga(() => adminApi.usuarios());
  const roles = useCarga(() => adminApi.roles());
  const unidades = useCarga(() => adminApi.unidades());

  const [fUnidad, setFUnidad] = useState<string | null>(null);
  const [conDependientes, setConDependientes] = useState(true);
  const [fRol, setFRol] = useState("");
  const [fEstado, setFEstado] = useState<"todos" | "activos" | "inactivos">("activos");
  const [selId, setSelId] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const [tabInicial, setTabInicial] = useState<Tab>("datos");

  // ?unidad=<id> (enlace desde Estructura)
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("unidad")) setFUnidad(p.get("unidad"));
  }, []);

  const listaRoles: Rol[] = roles.data ?? [];
  const listaUnidades: Unidad[] = unidades.data ?? [];
  const rolPorId = useMemo(() => new Map(listaRoles.map((r) => [r.id, r])), [listaRoles]);

  const filtrados = useMemo(() => {
    let out = usuarios.data ?? [];
    if (fEstado !== "todos") out = out.filter((u) => u.activo === (fEstado === "activos"));
    if (fRol) out = out.filter((u) => u.asignaciones.some((a) => a.rol.id === fRol));
    if (fUnidad) {
      const ids = conDependientes ? descendientes(fUnidad, listaUnidades) : new Set<string>();
      ids.add(fUnidad);
      out = out.filter((u) => u.asignaciones.some((a) => a.unidad && ids.has(a.unidad.id)));
    }
    return out;
  }, [usuarios.data, fEstado, fRol, fUnidad, conDependientes, listaUnidades]);

  const sel = selId ? (usuarios.data ?? []).find((u) => u.id === selId) ?? null : null;

  const columnas: DataColumn[] = [
    {
      key: "nombre", label: "Nombre",
      render: (u: Usuario) => (
        <div className="flex items-center gap-2">
          <span className={`inline-flex w-7 h-7 rounded-full text-white text-[10px] font-bold items-center justify-center shrink-0 ${u.activo ? "bg-[var(--accent)]" : "bg-slate-400"}`}>{iniciales(u.nombre)}</span>
          <div className="min-w-0">
            <div className="font-semibold truncate">{u.nombre}</div>
            {u.email && <div className="text-[11px] text-[var(--muted)] truncate">{u.email}</div>}
          </div>
        </div>
      ),
    },
    { key: "username", label: "Usuario", render: (u: Usuario) => <span className="codigo">{u.username}</span> },
    { key: "cargo", label: "Cargo", value: (u: Usuario) => u.cargo ?? "", render: (u: Usuario) => u.cargo || <span className="text-[var(--muted)]">—</span> },
    {
      key: "roles", label: "Roles · Unidad", sortable: false,
      value: (u: Usuario) => u.asignaciones.map((a) => `${a.rol.nombre} ${a.rol.codigo} ${a.unidad?.codigo ?? "IDIC"}`).join(" "),
      render: (u: Usuario) => (
        <div className="flex flex-wrap gap-1">
          {u.asignaciones.length === 0 && <span className="pill amber">Sin rol</span>}
          {u.asignaciones.map((a) => <ChipAsignacion key={a.id} a={a} />)}
        </div>
      ),
    },
    {
      key: "activo", label: "Estado", value: (u: Usuario) => (u.activo ? "Activo" : "Inactivo"),
      render: (u: Usuario) => <span className={`pill ${u.activo ? "green" : "gray"}`}>{u.activo ? "Activo" : "Inactivo"}</span>,
    },
  ];

  const recargarTodo = async () => { await usuarios.recargar(true); };

  return (
    <div>
      <CabeceraAdmin icono="👥" titulo="Usuarios"
        subtitulo="Cada persona puede tener varios roles, cada uno en una unidad (p. ej. «Analista · LCC»). El rol define qué puede hacer; la unidad, qué ve."
        acciones={<button className="btn primary sm" onClick={() => { setCreando(true); setSelId(null); }} disabled={!!usuarios.error}>＋ Nuevo usuario</button>} />

      {usuarios.error ? <EstadoError error={usuarios.error} onReintentar={() => usuarios.recargar()} recurso="la lista de usuarios (/usuarios)" /> : (
        <>
          <div className="card" style={{ padding: 12 }}>
            <div className="grid gap-3 md:grid-cols-[minmax(220px,1.4fr)_minmax(180px,1fr)_minmax(140px,.6fr)] items-end">
              <Campo label="Unidad">
                <SelectorUnidad unidades={listaUnidades} value={fUnidad} onChange={setFUnidad} nulo="Todas las unidades"
                  disabled={!!unidades.error} ariaLabel="Filtrar por unidad" />
              </Campo>
              <Campo label="Rol">
                <select value={fRol} onChange={(e) => setFRol(e.target.value)} aria-label="Filtrar por rol">
                  <option value="">Todos los roles</option>
                  {NIVELES_ROL.map((n) => {
                    const rs = listaRoles.filter((r) => r.nivel === n.value);
                    return rs.length ? (
                      <optgroup key={n.value} label={n.grupo}>
                        {rs.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                      </optgroup>
                    ) : null;
                  })}
                </select>
              </Campo>
              <Campo label="Estado">
                <select value={fEstado} onChange={(e) => setFEstado(e.target.value as any)} aria-label="Filtrar por estado">
                  <option value="activos">Activos</option>
                  <option value="inactivos">Inactivos</option>
                  <option value="todos">Todos</option>
                </select>
              </Campo>
            </div>
            <div className="flex gap-3 items-center mt-2 flex-wrap text-[12px]">
              {fUnidad && (
                <label className="inline-flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" checked={conDependientes} onChange={(e) => setConDependientes(e.target.checked)} />
                  Incluir unidades dependientes
                </label>
              )}
              {(fUnidad || fRol || fEstado !== "activos") && (
                <button className="text-[var(--accent)] font-semibold" onClick={() => { setFUnidad(null); setFRol(""); setFEstado("activos"); }}>Limpiar filtros</button>
              )}
              {unidades.error ? <span className="text-[var(--amber)]">No se pudo cargar la estructura para filtrar por unidad.</span> : null}
            </div>
          </div>

          {usuarios.cargando ? <div className="card"><SkeletonLineas n={8} /></div> : (
            <DataTable
              columns={columnas}
              rows={filtrados}
              onRowClick={(u) => { setCreando(false); setTabInicial("datos"); setSelId(u.id); }}
              searchKeys={["nombre", "username", "cargo", "roles"]}
              vacio={(usuarios.data ?? []).length === 0
                ? <EstadoVacio icono="👥" titulo="Aún no hay usuarios" texto="Crea el primero con «Nuevo usuario»." />
                : <EstadoVacio icono="🔎" titulo="Nadie coincide con los filtros" texto="Prueba con otra unidad, rol o estado." />}
            />
          )}
        </>
      )}

      <Drawer abierto={creando || !!sel} onClose={() => { setCreando(false); setSelId(null); }}
        titulo={creando ? "Nuevo usuario" : sel?.nombre ?? ""}
        subtitulo={creando ? "Completa los datos básicos; luego podrás asignarle roles." : sel ? <><span className="codigo">{sel.username}</span>{sel.cargo ? ` · ${sel.cargo}` : ""}</> : null}>
        {(creando || sel) && (
          <PanelUsuario key={creando ? "nuevo" : sel!.id} usuario={creando ? null : sel} roles={listaRoles} rolPorId={rolPorId}
            unidades={listaUnidades} onCambio={recargarTodo} tabInicial={tabInicial}
            onCreado={async (id) => { await recargarTodo(); setCreando(false); setTabInicial("roles"); setSelId(id); }} />
        )}
      </Drawer>
    </div>
  );
}

function ChipAsignacion({ a }: { a: Asignacion }) {
  const v = vigente(a);
  const temporal = !!a.vigenteHasta /* el backend siempre fija vigenteDesde (alta); temporal = con fecha de término */;
  const m = a.unidad ? metaTipo(a.unidad.tipo) : null;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-[1px] text-[11px] font-semibold border ${
      v === "vencida" ? "bg-slate-100 text-slate-400 border-slate-200 line-through" : temporal ? "bg-[#fff0d4] text-[#7a4b00] border-[#f3d9a6]" : "bg-[#e3edff] text-[#1c4ba6] border-[#c9dafc]"}`}
      title={temporal ? `Temporal ${fechaCorta(a.vigenteDesde)} → ${fechaCorta(a.vigenteHasta)}` : undefined}>
      {temporal && <span aria-hidden>⏳</span>}
      {a.rol.nombre} · {a.unidad ? <><span style={{ color: m?.color }}>{m?.icono}</span>{a.unidad.codigo}</> : "IDIC"}
    </span>
  );
}

type Tab = "datos" | "roles" | "acciones";

function PanelUsuario({ usuario, roles, rolPorId, unidades, onCambio, onCreado, tabInicial = "datos" }: {
  usuario: Usuario | null; roles: Rol[]; rolPorId: Map<string, Rol>; unidades: Unidad[];
  onCambio: () => Promise<void>; onCreado: (id: string) => Promise<void>; tabInicial?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(tabInicial);
  const creando = !usuario;
  return (
    <div>
      {!creando && (
        <div className="tabs mb-3" role="tablist">
          {([["datos", "Datos"], ["roles", `Roles y alcance (${usuario.asignaciones.length})`], ["acciones", "Acciones"]] as [Tab, string][]).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
      )}
      {(creando || tab === "datos") && <TabDatos usuario={usuario} onCambio={onCambio} onCreado={onCreado} />}
      {!creando && tab === "roles" && <TabRoles usuario={usuario} roles={roles} rolPorId={rolPorId} unidades={unidades} onCambio={onCambio} />}
      {!creando && tab === "acciones" && <TabAcciones usuario={usuario} onCambio={onCambio} />}
    </div>
  );
}

function TabDatos({ usuario, onCambio, onCreado }: { usuario: Usuario | null; onCambio: () => Promise<void>; onCreado: (id: string) => Promise<void> }) {
  const toast = useToast();
  const inicial = { username: usuario?.username ?? "", nombre: usuario?.nombre ?? "", email: usuario?.email ?? "", cargo: usuario?.cargo ?? "" };
  const [f, setF] = useState(inicial);
  const [err, setErr] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const [clave, setClave] = useState<{ id: string; pass: string } | null>(null);
  const sucio = JSON.stringify(f) !== JSON.stringify(inicial);

  function validar() {
    const e: Record<string, string> = {};
    if (!f.username.trim()) e.username = "Obligatorio";
    else if (!/^[a-zA-Z0-9._-]{3,40}$/.test(f.username.trim())) e.username = "Solo letras, números, punto, guion; 3 a 40 caracteres";
    if (!f.nombre.trim()) e.nombre = "Obligatorio";
    if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) e.email = "Correo no válido";
    setErr(e);
    return Object.keys(e).length === 0;
  }
  async function guardar() {
    if (!validar()) return;
    setGuardando(true);
    const datos = { username: f.username.trim(), nombre: f.nombre.trim(), email: f.email.trim() || null, cargo: f.cargo.trim() || null };
    try {
      if (!usuario) {
        const nuevo = await adminApi.crearUsuario(datos);
        toast.ok(`Usuario ${datos.username} creado.`);
        if (nuevo?.passwordTemporal) setClave({ id: nuevo.id, pass: nuevo.passwordTemporal });
        else if (nuevo?.id) await onCreado(nuevo.id);
      } else {
        await adminApi.actualizarUsuario(usuario.id, datos);
        toast.ok("Datos guardados.");
        await onCambio();
      }
    } catch (e) { toast.error(e); } finally { setGuardando(false); }
  }

  if (clave) {
    return (
      <div className="card">
        <ClaveTemporal pass={clave.pass} />
        <button className="btn primary sm mt-3" onClick={() => onCreado(clave.id)}>Continuar: asignar roles →</button>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo label="Nombre completo" req className="sm:col-span-2">
          <input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} maxLength={150} />
          {err.nombre && <small className="text-[11px] text-[var(--red)]">{err.nombre}</small>}
        </Campo>
        <Campo label="Usuario (para ingresar)" req>
          <input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} maxLength={40} autoComplete="off" />
          {err.username && <small className="text-[11px] text-[var(--red)]">{err.username}</small>}
        </Campo>
        <Campo label="Correo">
          <input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} maxLength={150} />
          {err.email && <small className="text-[11px] text-[var(--red)]">{err.email}</small>}
        </Campo>
        <Campo label="Cargo / grado" className="sm:col-span-2">
          <input value={f.cargo} onChange={(e) => setF({ ...f, cargo: e.target.value })} maxLength={100} placeholder="p. ej. Jefe de Laboratorio" />
        </Campo>
      </div>
      {!usuario && (
        <p className="text-[11.5px] text-[var(--muted)] mt-3">
          🔐 No hace falta inventar una contraseña: el sistema genera una temporal, que se mostrará una sola vez para
          entregársela a la persona. Deberá cambiarla en su primer ingreso.
        </p>
      )}
      <div className="flex gap-2 mt-4">
        <button className="btn primary sm" disabled={guardando || (!!usuario && !sucio)} onClick={guardar}>
          {guardando ? "Guardando…" : usuario ? "Guardar cambios" : "Crear usuario"}
        </button>
        {usuario && sucio && <button className="btn outline sm" onClick={() => { setF(inicial); setErr({}); }}>Descartar</button>}
      </div>
    </div>
  );
}

function TabRoles({ usuario, roles, rolPorId, unidades, onCambio }: {
  usuario: Usuario; roles: Rol[]; rolPorId: Map<string, Rol>; unidades: Unidad[]; onCambio: () => Promise<void>;
}) {
  const toast = useToast();
  const confirmar = useConfirm();
  const [rolId, setRolId] = useState("");
  const [unidadId, setUnidadId] = useState<string | null>(null);
  const [temporal, setTemporal] = useState(false);
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [abierto, setAbierto] = useState(usuario.asignaciones.length === 0);

  const rol = rolId ? rolPorId.get(rolId) : undefined;
  const esGlobal = rol?.alcance === "GLOBAL";
  const unidadSel = unidadId ? unidades.find((u) => u.id === unidadId) ?? null : null;

  async function agregar() {
    if (!rol) { toast.error("Elige un rol."); return; }
    if (!esGlobal && !unidadId) { toast.error(`El rol «${rol.nombre}» se ejerce en una unidad: elige cuál.`); return; }
    if (temporal && desde && hasta && hasta < desde) { toast.error("La fecha «hasta» no puede ser anterior a «desde»."); return; }
    if (temporal && !hasta) { toast.error("Para una asignación temporal indica al menos la fecha de término."); return; }
    setGuardando(true);
    try {
      await adminApi.agregarAsignacion(usuario.id, {
        rolId: rol.id, unidadId: esGlobal ? null : unidadId,
        vigenteDesde: temporal && desde ? desde : null, vigenteHasta: temporal && hasta ? hasta : null,
      });
      toast.ok(`Rol «${rol.nombre}» asignado${!esGlobal && unidadSel ? ` en ${unidadSel.codigo}` : ""}.`);
      setRolId(""); setUnidadId(null); setTemporal(false); setDesde(""); setHasta(""); setAbierto(false);
      await onCambio();
    } catch (e) { toast.error(e); } finally { setGuardando(false); }
  }
  async function quitar(a: Asignacion) {
    const ok = await confirmar({
      titulo: "¿Quitar esta asignación?", peligro: true, confirmar: "Quitar",
      mensaje: <><b>{usuario.nombre}</b> dejará de ser <b>{a.rol.nombre}</b>{a.unidad ? <> en <b>{a.unidad.codigo}</b></> : null}.
        Perderá de inmediato los permisos y la visibilidad que le daba.</>,
    });
    if (!ok) return;
    try { await adminApi.quitarAsignacion(usuario.id, a.id); toast.ok("Asignación quitada."); await onCambio(); }
    catch (e) { toast.error(e); }
  }

  return (
    <div>
      {usuario.asignaciones.length === 0 ? (
        <div className="card"><EstadoVacio icono="🪪" titulo="Sin roles asignados"
          texto="Mientras no tenga un rol, esta persona puede ingresar pero no verá ni podrá hacer nada." /></div>
      ) : (
        <div className="flex flex-col gap-2 mb-3">
          {usuario.asignaciones.map((a) => {
            const r = rolPorId.get(a.rol.id);
            const v = vigente(a);
            const temporal = !!a.vigenteHasta /* el backend siempre fija vigenteDesde (alta); temporal = con fecha de término */;
            const nivel = NIVEL_ROL[a.rol.nivel];
            return (
              <div key={a.id} className="card flex gap-3 items-start" style={{ marginBottom: 0, padding: 12, opacity: v === "vencida" ? 0.6 : 1 }}>
                {a.unidad ? <IconoUnidad tipo={a.unidad.tipo} size={34} /> : <span className="inline-flex w-[34px] h-[34px] rounded-full items-center justify-center bg-[#e3edff] text-lg" aria-hidden>🌐</span>}
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-[13.5px] flex items-center gap-2 flex-wrap">
                    {a.rol.nombre}
                    <span className={`pill ${nivel?.color ?? "gray"}`}>{nivel?.label ?? a.rol.nivel}</span>
                    {temporal && <span className={`pill ${v === "vigente" ? "amber" : v === "futura" ? "blue" : "gray"}`}>
                      ⏳ {v === "vigente" ? "Temporal" : v === "futura" ? "Programada" : "Vencida"}</span>}
                  </div>
                  <div className="text-[12px] text-[var(--muted)]">
                    {a.unidad ? <><span className="codigo">{a.unidad.codigo}</span> · {a.unidad.nombre}</> : "Todo el IDIC"}
                  </div>
                  <div className="text-[12.5px] mt-1 text-[var(--primary)]">
                    👁 {textoAlcance(r?.alcance, a.unidad, unidades)}
                  </div>
                  {temporal && (
                    <div className="text-[11.5px] text-[var(--muted)] mt-1">
                      Vigencia: {a.vigenteDesde ? `desde ${fechaCorta(a.vigenteDesde)}` : "desde ya"} {a.vigenteHasta ? `hasta ${fechaCorta(a.vigenteHasta)}` : "sin término"}
                    </div>
                  )}
                </div>
                <button className="btn outline sm" style={{ color: "var(--red)" }} onClick={() => quitar(a)} aria-label={`Quitar ${a.rol.nombre}`}>Quitar</button>
              </div>
            );
          })}
        </div>
      )}

      {!abierto ? (
        <button className="btn accent sm" onClick={() => setAbierto(true)}>＋ Asignar otro rol</button>
      ) : (
        <div className="card" style={{ borderTop: "3px solid var(--accent)" }}>
          <h2>Asignar rol</h2>
          <div className="grid gap-3">
            <Campo label="Rol" req>
              <select value={rolId} onChange={(e) => setRolId(e.target.value)} aria-label="Rol a asignar">
                <option value="">— elegir rol —</option>
                {NIVELES_ROL.map((n) => {
                  const rs = roles.filter((r) => r.nivel === n.value);
                  return rs.length ? (
                    <optgroup key={n.value} label={n.grupo}>
                      {rs.map((r) => <option key={r.id} value={r.id}>{r.nombre} — {ALCANCE[r.alcance]?.label ?? r.alcance}</option>)}
                    </optgroup>
                  ) : null;
                })}
              </select>
            </Campo>
            <Campo label="Unidad donde ejerce el rol" req={!esGlobal}
              ayuda={esGlobal ? "Este rol abarca todo el IDIC: no necesita unidad." : rol ? ALCANCE[rol.alcance]?.ayuda : undefined}>
              <SelectorUnidad unidades={unidades} value={esGlobal ? null : unidadId} onChange={setUnidadId}
                placeholder={esGlobal ? "Todo IDIC" : "— elegir unidad —"} disabled={!rol || esGlobal} ariaLabel="Unidad de la asignación" />
            </Campo>
            <label className="inline-flex items-center gap-2 text-[12.5px] cursor-pointer">
              <input type="checkbox" checked={temporal} onChange={(e) => setTemporal(e.target.checked)} />
              Es temporal (subrogancia, reemplazo por vacaciones…)
            </label>
            {temporal && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo label="Desde"><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></Campo>
                <Campo label="Hasta" req><input type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} /></Campo>
              </div>
            )}
            {rol && (esGlobal || unidadSel) && (
              <div className="alert info" style={{ marginBottom: 0 }}>
                Con esta asignación, <b>{usuario.nombre}</b> será <b>{rol.nombre}</b>: «{textoAlcance(rol.alcance, unidadSel, unidades)}»
                {temporal && hasta ? ` hasta el ${fechaCorta(hasta)}` : ""}.
              </div>
            )}
          </div>
          <div className="flex gap-2 mt-3">
            <button className="btn primary sm" disabled={guardando || !rolId} onClick={agregar}>{guardando ? "Asignando…" : "Asignar"}</button>
            {usuario.asignaciones.length > 0 && <button className="btn outline sm" onClick={() => setAbierto(false)}>Cancelar</button>}
          </div>
        </div>
      )}
    </div>
  );
}

function TabAcciones({ usuario, onCambio }: { usuario: Usuario; onCambio: () => Promise<void> }) {
  const toast = useToast();
  const confirmar = useConfirm();
  const [clave, setClave] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function cambiarEstado() {
    const activar = !usuario.activo;
    const ok = await confirmar({
      titulo: activar ? `¿Reactivar a ${usuario.nombre}?` : `¿Desactivar a ${usuario.nombre}?`,
      peligro: !activar, confirmar: activar ? "Reactivar" : "Desactivar",
      mensaje: activar
        ? "Podrá volver a ingresar con sus roles actuales."
        : "No podrá ingresar al LIMS. Su historial (firmas, resultados, auditoría) se conserva y puede reactivarse después.",
    });
    if (!ok) return;
    setOcupado(true);
    try {
      if (activar) await adminApi.actualizarUsuario(usuario.id, { activo: true });
      else await adminApi.desactivarUsuario(usuario.id);
      toast.ok(activar ? "Usuario reactivado." : "Usuario desactivado.");
      await onCambio();
    } catch (e) { toast.error(e); } finally { setOcupado(false); }
  }
  async function restablecer() {
    const ok = await confirmar({
      titulo: "¿Restablecer la contraseña?", confirmar: "Generar contraseña temporal",
      mensaje: <>Se generará una contraseña temporal para <b>{usuario.nombre}</b>. La actual dejará de funcionar y deberá
        cambiarla al ingresar.</>,
    });
    if (!ok) return;
    setOcupado(true);
    try {
      const r = await adminApi.resetPassword(usuario.id);
      setClave(r?.passwordTemporal ?? null);
      toast.ok("Contraseña temporal generada.");
    } catch (e) { toast.error(e); } finally { setOcupado(false); }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="card" style={{ marginBottom: 0 }}>
        <h2>Estado de la cuenta</h2>
        <div className="flex items-center gap-3 flex-wrap">
          <span className={`pill ${usuario.activo ? "green" : "gray"}`}>{usuario.activo ? "Activo" : "Inactivo"}</span>
          <span className="text-[12px] text-[var(--muted)] flex-1">
            {usuario.activo ? "Puede ingresar y trabajar según sus roles." : "No puede ingresar. Sus registros históricos se conservan."}
          </span>
          <button className={`btn sm ${usuario.activo ? "outline" : "success"}`} style={usuario.activo ? { color: "var(--red)" } : undefined}
            disabled={ocupado} onClick={cambiarEstado}>{usuario.activo ? "Desactivar" : "Reactivar"}</button>
        </div>
      </div>
      <div className="card" style={{ marginBottom: 0 }}>
        <h2>Contraseña</h2>
        <p className="text-[12px] text-[var(--muted)] mb-3">Si la persona olvidó su contraseña, genera una temporal y entrégasela por un canal seguro.</p>
        {clave ? <ClaveTemporal pass={clave} /> : (
          <button className="btn primary sm" disabled={ocupado || !usuario.activo} onClick={restablecer}>🔑 Restablecer contraseña</button>
        )}
        {!usuario.activo && !clave && <div className="text-[11.5px] text-[var(--muted)] mt-2">Reactiva la cuenta para poder restablecer su contraseña.</div>}
      </div>
    </div>
  );
}

function ClaveTemporal({ pass }: { pass: string }) {
  const toast = useToast();
  const [visto, setVisto] = useState(true);
  return (
    <div className="rounded-lg border-2 border-dashed border-[var(--amber)] bg-[#fff6e8] p-3">
      <div className="text-[12px] font-semibold text-[#7a4b00] mb-2">⚠️ Contraseña temporal — se muestra solo esta vez</div>
      <div className="flex gap-2 items-center flex-wrap">
        <code className="font-mono text-[16px] font-bold bg-white border border-[var(--line)] rounded px-3 py-1 tracking-wider select-all">
          {visto ? pass : "•".repeat(pass.length)}
        </code>
        <button className="btn outline sm" onClick={() => setVisto((v) => !v)}>{visto ? "Ocultar" : "Mostrar"}</button>
        <button className="btn accent sm" onClick={async () => (await copiar(pass)) ? toast.ok("Copiada al portapapeles.") : toast.error("No se pudo copiar; cópiala a mano.")}>📋 Copiar</button>
      </div>
      <div className="text-[11.5px] text-[#7a4b00] mt-2">Entrégala por un canal seguro. Al cerrar este panel no podrá volver a verse.</div>
    </div>
  );
}
