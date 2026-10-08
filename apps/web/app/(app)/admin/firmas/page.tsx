"use client";

/**
 * /admin/firmas · Matriz de firmas.
 * Por tipo de documento: cadena de pasos de la regla general (orden, acción, rol,
 * nivel de unidad) editable; excepciones por unidad con el mismo editor; y panel
 * «Probar» que resuelve la cadena real (con personas) para una unidad concreta.
 */

import { useEffect, useMemo, useState } from "react";
import {
  ACCIONES_FIRMA, ACCION_FIRMA, NIVELES_ROL, NIVELES_UNIDAD, NIVEL_UNIDAD, TIPOS_DOCUMENTO, TIPO_DOCUMENTO,
  adminApi, fraseCadena, nombreConArticulo, type AccionFirma, type NivelUnidad, type PasoResuelto, type ReglaFirma,
  type Rol, type TipoDocumento, type TipoUnidad, type Unidad,
} from "@/lib/admin";
import {
  AdminGuard, CabeceraAdmin, Campo, EstadoError, EstadoVacio, IconoUnidad, Skeleton, SkeletonLineas,
  useCarga, useConfirm, useToast,
} from "@/components/admin/ui";
import { SelectorUnidad } from "@/components/admin/Selectores";

export default function FirmasPage() {
  return (
    <AdminGuard permiso="admin.firmas">
      <Firmas />
    </AdminGuard>
  );
}

// ───────────────────────────── Texto en lenguaje simple ─────────────────────────────

const SIN_ARTICULO = /^(Gestión|Dirección|Recepción|Cobranza|Comercial)/i;
function conArticulo(nombreRol: string) {
  return SIN_ARTICULO.test(nombreRol) ? nombreRol : `el ${nombreRol}`;
}
/** «el Jefe de Departamento», «el Analista sénior», «Gestión de Calidad». */
function quienGeneral(rolNombre: string, nivel: NivelUnidad) {
  const base = conArticulo(rolNombre);
  if (nivel === "MISMA") return base;
  const n = NIVEL_UNIDAD[nivel];
  const clave = n.label.split(" ").pop()!.toLowerCase(); // sección, departamento, dirección, calidad, comercial
  return rolNombre.toLowerCase().includes(clave.slice(0, 6)) ? base : `${base} ${n.frase}`;
}
/** Con unidad real: «el Jefe de Laboratorio de LME», «el Jefe de Departamento del Depto. Químico». */
function quienResuelto(p: PasoResuelto, tipoPorCodigo?: Map<string, TipoUnidad>) {
  const base = conArticulo(p.rol.nombre);
  if (!p.unidad) return base;
  if ((p.nivelUnidad === "CALIDAD" && /calidad/i.test(p.rol.nombre)) || (p.nivelUnidad === "COMERCIAL" && /comercial/i.test(p.rol.nombre))) return base;
  if (p.nivelUnidad === "MISMA") return `${base} de ${p.unidad.codigo}`;
  // el tipo real lo da la estructura (puede diferir del nivel pedido, p. ej. una sucursal sin sección)
  const tipo = tipoPorCodigo?.get(p.unidad.codigo)
    ?? (/^Departamento/i.test(p.unidad.nombre) ? "DEPARTAMENTO" : /^Laboratorio/i.test(p.unidad.nombre) ? "LABORATORIO" : "SECCION");
  return `${base} de ${nombreConArticulo({ nombre: p.unidad.nombre, codigo: p.unidad.codigo, tipo })}`.replace(/ de el /g, " del ");
}

// ───────────────────────────── Página ─────────────────────────────

function Firmas() {
  const [tipo, setTipo] = useState<TipoDocumento>("INFORME_ENSAYO");
  const reglas = useCarga(() => adminApi.firmas({ tipoDocumento: tipo }), [tipo]);
  const roles = useCarga(() => adminApi.roles());
  const unidades = useCarga(() => adminApi.unidades());
  const listaRoles: Rol[] = roles.data ?? [];
  const listaUnidades: Unidad[] = unidades.data ?? [];

  const deTipo = (reglas.data ?? []).filter((r) => r.tipoDocumento === tipo);
  const general = deTipo.filter((r) => !r.unidadId).sort((a, b) => a.orden - b.orden);
  const excepciones = useMemo(() => {
    const m = new Map<string, ReglaFirma[]>();
    deTipo.filter((r) => r.unidadId).forEach((r) => m.set(r.unidadId!, [...(m.get(r.unidadId!) ?? []), r]));
    return [...m.entries()].map(([unidadId, rs]) => ({ unidadId, reglas: rs.sort((a, b) => a.orden - b.orden) }));
  }, [deTipo]);

  const recargar = () => reglas.recargar(true);
  const doc = TIPO_DOCUMENTO[tipo];

  return (
    <div>
      <CabeceraAdmin icono="✍" titulo="Matriz de firmas"
        subtitulo="Define, para cada tipo de documento, quién lo revisa, aprueba, firma y oficializa, y en qué orden. El sistema busca a las personas según la estructura y los jefes de cada unidad." />

      {/* Tipos de documento */}
      <div className="flex gap-1 flex-wrap mb-3" role="tablist" aria-label="Tipo de documento">
        {TIPOS_DOCUMENTO.map((t) => (
          <button key={t.value} role="tab" aria-selected={tipo === t.value} onClick={() => setTipo(t.value)}
            className={`px-3 py-[5px] rounded-md text-[12px] font-semibold border ${tipo === t.value ? "bg-[var(--accent)] text-white border-[var(--accent)]" : "bg-white text-[var(--ink)] border-[var(--line)] hover:bg-slate-50"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {reglas.error ? <EstadoError error={reglas.error} onReintentar={() => reglas.recargar()} recurso="la matriz de firmas (/firmas-matriz)" /> : (
        <div className="grid gap-4 xl:grid-cols-[1fr_380px] items-start">
          <div className="min-w-0">
            {/* Regla general */}
            <div className="card">
              <h2>📜 Regla general · {doc.label}</h2>
              {reglas.cargando ? <Skeleton className="h-28" /> : (
                <>
                  <p className="text-[12.5px] mb-3">
                    {general.length === 0 ? <span className="text-[var(--muted)]">Aún no hay pasos definidos para este documento.</span> : (
                      <>💬 <b>{doc.label}:</b> {fraseCadena(general.map((g) => ({ accion: g.accion, quien: quienGeneral(g.rol?.nombre ?? g.rol?.codigo ?? "?", g.nivelUnidad) })))}.</>
                    )}
                  </p>
                  <EditorCadena reglas={general} tipo={tipo} unidadId={null} roles={listaRoles} onCambio={recargar} />
                </>
              )}
            </div>

            {/* Excepciones */}
            <div className="card">
              <h2>🔀 Excepciones por unidad <span className="right">{excepciones.length}</span></h2>
              <p className="text-[12px] text-[var(--muted)] mb-3">
                Cuando una unidad firma distinto (p. ej. una sucursal que certifica localmente), crea una excepción: para esa
                unidad se usará su propia cadena en lugar de la regla general.
              </p>
              {reglas.cargando ? <SkeletonLineas n={3} /> : (
                <>
                  {excepciones.length === 0 && (
                    <div className="text-[12px] text-[var(--muted)] mb-3">Ninguna unidad tiene excepción para «{doc.label}»: todas usan la regla general.</div>
                  )}
                  <div className="flex flex-col gap-3">
                    {excepciones.map((ex) => (
                      <Excepcion key={ex.unidadId} unidad={listaUnidades.find((u) => u.id === ex.unidadId) ?? ex.reglas[0]?.unidad ?? null}
                        unidadId={ex.unidadId} reglas={ex.reglas} tipo={tipo} roles={listaRoles} onCambio={recargar} />
                    ))}
                  </div>
                  <NuevaExcepcion tipo={tipo} unidades={listaUnidades} ocupadas={new Set(excepciones.map((e) => e.unidadId))}
                    general={general} roles={listaRoles} onCambio={recargar} />
                </>
              )}
            </div>
          </div>

          {/* Probar */}
          <div className="xl:sticky xl:top-0">
            <Probar tipo={tipo} unidades={listaUnidades} errorUnidades={unidades.error} version={reglas.data} />
          </div>
        </div>
      )}
      {roles.error ? <EstadoError error={roles.error} recurso="los roles (necesarios para editar pasos)" onReintentar={() => roles.recargar()} /> : null}
    </div>
  );
}

// ───────────────────────────── Editor de cadena ─────────────────────────────

interface PasoForm { accion: AccionFirma; rolId: string; nivelUnidad: NivelUnidad; obligatorio: boolean }

function EditorCadena({ reglas, tipo, unidadId, roles, onCambio }: {
  reglas: ReglaFirma[]; tipo: TipoDocumento; unidadId: string | null; roles: Rol[]; onCambio: () => Promise<void>;
}) {
  const toast = useToast();
  const confirmar = useConfirm();
  const [editId, setEditId] = useState<string | null>(null);
  const [agregando, setAgregando] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  async function mover(i: number, dir: -1 | 1) {
    const a = reglas[i], b = reglas[i + dir];
    if (!a || !b) return;
    setOcupado(true);
    try {
      await Promise.all([adminApi.actualizarFirma(a.id, { orden: b.orden }), adminApi.actualizarFirma(b.id, { orden: a.orden })]);
      await onCambio();
    } catch (e) { toast.error(e); } finally { setOcupado(false); }
  }
  async function eliminar(r: ReglaFirma) {
    const ok = await confirmar({
      titulo: `¿Quitar el paso ${r.orden}?`, peligro: true, confirmar: "Quitar paso",
      mensaje: <>Se quitará «{ACCION_FIRMA[r.accion]?.label} · {r.rol?.nombre}» de la cadena. Los pasos siguientes se renumeran.</>,
    });
    if (!ok) return;
    setOcupado(true);
    try {
      await adminApi.eliminarFirma(r.id);
      const siguientes = reglas.filter((x) => x.orden > r.orden);
      await Promise.all(siguientes.map((x) => adminApi.actualizarFirma(x.id, { orden: x.orden - 1 })));
      toast.ok("Paso quitado.");
      await onCambio();
    } catch (e) { toast.error(e); } finally { setOcupado(false); }
  }
  async function guardar(r: ReglaFirma | null, f: PasoForm) {
    if (!f.rolId) { toast.error("Elige el rol que realiza el paso."); return false; }
    setOcupado(true);
    try {
      if (r) await adminApi.actualizarFirma(r.id, f);
      else await adminApi.crearFirma({ ...f, tipoDocumento: tipo, unidadId, orden: (reglas[reglas.length - 1]?.orden ?? 0) + 1, activo: true });
      toast.ok(r ? "Paso actualizado." : "Paso agregado.");
      setEditId(null); setAgregando(false);
      await onCambio();
      return true;
    } catch (e) { toast.error(e); return false; } finally { setOcupado(false); }
  }

  return (
    <div className={`flex gap-2 overflow-x-auto pb-2 items-stretch ${ocupado ? "opacity-60 pointer-events-none" : ""}`}>
      {reglas.length === 0 && !agregando && (
        <div className="text-[12px] text-[var(--muted)] self-center pr-2">Sin pasos.</div>
      )}
      {reglas.map((r, i) => (
        <div key={r.id} className="flex items-center gap-2 shrink-0">
          {editId === r.id ? (
            <FormPaso inicial={{ accion: r.accion, rolId: r.rolId, nivelUnidad: r.nivelUnidad, obligatorio: r.obligatorio }} roles={roles}
              onCancelar={() => setEditId(null)} onGuardar={(f) => guardar(r, f)} />
          ) : (
            <TarjetaPaso r={r} primero={i === 0} ultimo={i === reglas.length - 1}
              onIzq={() => mover(i, -1)} onDer={() => mover(i, 1)} onEditar={() => { setEditId(r.id); setAgregando(false); }} onQuitar={() => eliminar(r)} />
          )}
          {(i < reglas.length - 1 || agregando) && <span className="text-[var(--muted)] text-lg" aria-hidden>→</span>}
        </div>
      ))}
      {agregando ? (
        <FormPaso inicial={{ accion: "FIRMA", rolId: "", nivelUnidad: "MISMA", obligatorio: true }} roles={roles}
          onCancelar={() => setAgregando(false)} onGuardar={(f) => guardar(null, f)} />
      ) : (
        <button onClick={() => { setAgregando(true); setEditId(null); }} disabled={!roles.length}
          className="shrink-0 w-[150px] min-h-[132px] rounded-lg border-2 border-dashed border-[var(--line)] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] text-[12.5px] font-semibold disabled:opacity-50">
          ＋ Agregar paso
        </button>
      )}
    </div>
  );
}

function TarjetaPaso({ r, primero, ultimo, onIzq, onDer, onEditar, onQuitar }: {
  r: ReglaFirma; primero: boolean; ultimo: boolean; onIzq: () => void; onDer: () => void; onEditar: () => void; onQuitar: () => void;
}) {
  const a = ACCION_FIRMA[r.accion];
  return (
    <div className="w-[180px] min-h-[132px] rounded-lg border border-[var(--line)] bg-white shadow-sm flex flex-col" style={{ borderTop: `4px solid ${a?.color ?? "#999"}` }}>
      <div className="p-2 flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="inline-flex w-6 h-6 rounded-full items-center justify-center text-white text-[11px] font-bold" style={{ background: a?.color }}>{r.orden}</span>
          <span className="font-bold text-[12.5px]" style={{ color: a?.color }}>{a?.icono} {a?.label ?? r.accion}</span>
        </div>
        <div className="font-semibold text-[12.5px] leading-tight">{r.rol?.nombre ?? r.rol?.codigo}</div>
        <div className="text-[11px] text-[var(--muted)]">{NIVEL_UNIDAD[r.nivelUnidad]?.label ?? r.nivelUnidad}</div>
        <div className="mt-1 flex gap-1 flex-wrap">
          {!r.obligatorio && <span className="pill gray">Opcional</span>}
          {r.activo === false && <span className="pill red">Inactivo</span>}
        </div>
      </div>
      <div className="flex border-t border-[var(--line)] text-[12px]">
        <button className="flex-1 py-1 hover:bg-slate-50 disabled:opacity-30" disabled={primero} onClick={onIzq} aria-label="Mover antes" title="Mover antes">◀</button>
        <button className="flex-1 py-1 hover:bg-slate-50 disabled:opacity-30" disabled={ultimo} onClick={onDer} aria-label="Mover después" title="Mover después">▶</button>
        <button className="flex-1 py-1 hover:bg-slate-50" onClick={onEditar} aria-label="Editar paso" title="Editar">✎</button>
        <button className="flex-1 py-1 hover:bg-red-50 text-[var(--red)]" onClick={onQuitar} aria-label="Quitar paso" title="Quitar">🗑</button>
      </div>
    </div>
  );
}

function FormPaso({ inicial, roles, onGuardar, onCancelar }: {
  inicial: PasoForm; roles: Rol[]; onGuardar: (f: PasoForm) => Promise<boolean>; onCancelar: () => void;
}) {
  const [f, setF] = useState<PasoForm>(inicial);
  return (
    <div className="w-[230px] rounded-lg border-2 border-[var(--accent)] bg-white p-2 flex flex-col gap-2 shrink-0">
      <Campo label="Acción">
        <select value={f.accion} onChange={(e) => setF({ ...f, accion: e.target.value as AccionFirma })}>
          {ACCIONES_FIRMA.map((a) => <option key={a.value} value={a.value}>{a.icono} {a.label}</option>)}
        </select>
      </Campo>
      <Campo label="Rol">
        <select value={f.rolId} onChange={(e) => setF({ ...f, rolId: e.target.value })}>
          <option value="">— elegir —</option>
          {NIVELES_ROL.map((n) => {
            const rs = roles.filter((r) => r.nivel === n.value);
            return rs.length ? <optgroup key={n.value} label={n.grupo}>{rs.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}</optgroup> : null;
          })}
        </select>
      </Campo>
      <Campo label="¿De qué unidad?" ayuda="Relativa a la unidad que emite el documento.">
        <select value={f.nivelUnidad} onChange={(e) => setF({ ...f, nivelUnidad: e.target.value as NivelUnidad })}>
          {NIVELES_UNIDAD.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
        </select>
      </Campo>
      <label className="inline-flex items-center gap-2 text-[12px] cursor-pointer">
        <input type="checkbox" checked={f.obligatorio} onChange={(e) => setF({ ...f, obligatorio: e.target.checked })} /> Obligatorio
      </label>
      <div className="flex gap-1">
        <button className="btn primary sm flex-1 justify-center" onClick={() => onGuardar(f)}>Guardar</button>
        <button className="btn outline sm" onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  );
}

// ───────────────────────────── Excepciones ─────────────────────────────

function Excepcion({ unidad, unidadId, reglas, tipo, roles, onCambio }: {
  unidad: Pick<Unidad, "id" | "codigo" | "nombre" | "tipo"> | null; unidadId: string; reglas: ReglaFirma[]; tipo: TipoDocumento; roles: Rol[]; onCambio: () => Promise<void>;
}) {
  const toast = useToast();
  const confirmar = useConfirm();
  const [abierta, setAbierta] = useState(false);
  async function eliminar() {
    const ok = await confirmar({
      titulo: `¿Eliminar la excepción de ${unidad?.codigo ?? "la unidad"}?`, peligro: true, confirmar: "Eliminar excepción",
      mensaje: <>Se borrarán sus {reglas.length} paso(s) y {unidad?.codigo ?? "la unidad"} volverá a usar la regla general de «{TIPO_DOCUMENTO[tipo].label}».</>,
    });
    if (!ok) return;
    try {
      await Promise.all(reglas.map((r) => adminApi.eliminarFirma(r.id)));
      toast.ok("Excepción eliminada.");
      await onCambio();
    } catch (e) { toast.error(e); }
  }
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[#fafcfd]">
      <div className="flex items-center gap-2 p-2 cursor-pointer" onClick={() => setAbierta((a) => !a)}>
        <span className="text-[10px] text-[var(--muted)] w-4" aria-hidden>{abierta ? "▼" : "▶"}</span>
        {unidad && <IconoUnidad tipo={unidad.tipo} size={24} />}
        <span className="codigo">{unidad?.codigo ?? unidadId}</span>
        <span className="text-[12.5px] truncate flex-1">{unidad?.nombre}</span>
        <span className="hidden sm:inline text-[11.5px] text-[var(--muted)] truncate max-w-[45%]">
          {reglas.map((r) => `${ACCION_FIRMA[r.accion]?.label} ${r.rol?.codigo}`).join(" → ")}
        </span>
        <button className="btn outline sm" style={{ color: "var(--red)" }} onClick={(e) => { e.stopPropagation(); eliminar(); }}>Eliminar</button>
      </div>
      {abierta && (
        <div className="px-2 pb-2">
          <EditorCadena reglas={reglas} tipo={tipo} unidadId={unidadId} roles={roles} onCambio={onCambio} />
        </div>
      )}
    </div>
  );
}

function NuevaExcepcion({ tipo, unidades, ocupadas, general, roles, onCambio }: {
  tipo: TipoDocumento; unidades: Unidad[]; ocupadas: Set<string>; general: ReglaFirma[]; roles: Rol[]; onCambio: () => Promise<void>;
}) {
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [unidadId, setUnidadId] = useState<string | null>(null);
  const [copiar, setCopiar] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const puedeCopiar = general.length > 0;
  const usarCopia = copiar && puedeCopiar;

  async function crear(primerPaso?: PasoForm): Promise<boolean> {
    if (!unidadId) { toast.error("Elige la unidad."); return false; }
    if (!usarCopia && !primerPaso?.rolId) { toast.error("Elige el rol del primer paso."); return false; }
    setOcupado(true);
    try {
      if (usarCopia) {
        // secuencial para conservar el orden
        for (const g of general) {
          await adminApi.crearFirma({ tipoDocumento: tipo, unidadId, orden: g.orden, accion: g.accion, rolId: g.rolId, nivelUnidad: g.nivelUnidad, obligatorio: g.obligatorio, activo: true });
        }
        toast.ok("Excepción creada a partir de la regla general. Ábrela para ajustar sus pasos.");
      } else if (primerPaso) {
        await adminApi.crearFirma({ ...primerPaso, tipoDocumento: tipo, unidadId, orden: 1, activo: true });
        toast.ok("Excepción creada. Ábrela para agregarle más pasos.");
      }
      setAbierto(false); setUnidadId(null); setCopiar(true);
      await onCambio();
      return true;
    } catch (e) { toast.error(e); return false; } finally { setOcupado(false); }
  }

  if (!abierto) return <button className="btn accent sm mt-3" onClick={() => { setAbierto(true); setCopiar(puedeCopiar); }}>＋ Nueva excepción</button>;
  return (
    <div className={`mt-3 rounded-lg border-2 border-[var(--accent)] p-3 bg-white ${ocupado ? "opacity-60 pointer-events-none" : ""}`}>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] items-end">
        <Campo label="Unidad con firma distinta">
          <SelectorUnidad unidades={unidades} value={unidadId} onChange={setUnidadId} excluir={ocupadas} ariaLabel="Unidad de la excepción" />
        </Campo>
        <label className="inline-flex items-center gap-2 text-[12px] cursor-pointer pb-2">
          <input type="checkbox" checked={usarCopia} onChange={(e) => setCopiar(e.target.checked)} disabled={!puedeCopiar} />
          Partir copiando la regla general
        </label>
      </div>
      {usarCopia ? (
        <div className="flex gap-2 mt-3">
          <button className="btn primary sm" disabled={!unidadId} onClick={() => crear()}>{ocupado ? "Creando…" : "Crear excepción"}</button>
          <button className="btn outline sm" onClick={() => setAbierto(false)}>Cancelar</button>
        </div>
      ) : (
        <div className="mt-3">
          <div className="text-[12px] text-[var(--muted)] mb-2">Define el primer paso de la cadena (luego podrás agregar más):</div>
          <FormPaso inicial={{ accion: "FIRMA", rolId: "", nivelUnidad: "MISMA", obligatorio: true }} roles={roles}
            onCancelar={() => setAbierto(false)} onGuardar={(f) => crear(f)} />
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── Probar ─────────────────────────────

function Probar({ tipo, unidades, errorUnidades, version }: { tipo: TipoDocumento; unidades: Unidad[]; errorUnidades: unknown; version: unknown }) {
  const [unidadId, setUnidadId] = useState<string | null>(null);
  const [pasos, setPasos] = useState<PasoResuelto[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    if (!unidadId) { setPasos(null); return; }
    let vivo = true;
    setCargando(true); setError(null);
    adminApi.resolverFirmas(tipo, unidadId)
      .then((p) => { if (vivo) setPasos([...p].sort((a, b) => a.orden - b.orden)); })
      .catch((e) => { if (vivo) { setError(e); setPasos(null); } })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [tipo, unidadId, version]);

  const unidad = unidades.find((u) => u.id === unidadId);
  const tipoPorCodigo = useMemo(() => new Map(unidades.map((u) => [u.codigo, u.tipo] as const)), [unidades]);
  const origen = pasos?.[0]?.origen;
  const doc = TIPO_DOCUMENTO[tipo];

  return (
    <div className="card" style={{ borderTop: "4px solid var(--accent)" }}>
      <h2>🧪 Probar</h2>
      <p className="text-[12px] text-[var(--muted)] mb-3">Elige un laboratorio, sucursal u otra unidad y mira quién firmaría un «{doc.label}» emitido allí.</p>
      {errorUnidades ? <EstadoError error={errorUnidades} recurso="la estructura (/unidades)" /> : (
        <SelectorUnidad unidades={unidades} value={unidadId} onChange={setUnidadId} placeholder="— elegir unidad emisora —" ariaLabel="Unidad emisora" />
      )}
      <div className="mt-3">
        {!unidadId ? (
          <EstadoVacio icono="🔎" titulo="Elige una unidad" texto="Ejemplo: LME, LCC, SANTOF o D11." />
        ) : cargando ? <SkeletonLineas n={4} /> : error ? <EstadoError error={error} recurso="el resolvedor de firmas" /> : pasos && pasos.length === 0 ? (
          <div className="alert warn">No hay ninguna cadena definida para «{doc.label}». Agrega pasos a la regla general.</div>
        ) : pasos && (
          <>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className={`pill ${origen === "override" ? "amber" : "teal"}`}>{origen === "override" ? "🔀 Usa una excepción" : "📜 Usa la regla general"}</span>
            </div>
            <div className="alert info">
              💬 <b>{doc.label} de {unidad?.codigo}:</b> {fraseCadena(pasos.map((p) => ({ accion: p.accion, quien: quienResuelto(p, tipoPorCodigo) })))}.
            </div>
            <ol className="flex flex-col gap-0">
              {pasos.map((p, i) => {
                const a = ACCION_FIRMA[p.accion];
                return (
                  <li key={`${p.orden}-${i}`} className="relative pl-9 pb-3">
                    {i < pasos.length - 1 && <span className="absolute left-[13px] top-7 bottom-0 w-[2px] bg-[var(--line)]" aria-hidden />}
                    <span className="absolute left-0 top-0 inline-flex w-7 h-7 rounded-full items-center justify-center text-white text-[12px] font-bold" style={{ background: a?.color }}>{p.orden}</span>
                    <div className="font-semibold text-[12.5px]"><span style={{ color: a?.color }}>{a?.icono} {a?.label}</span> · {p.rol.nombre}</div>
                    <div className="text-[11.5px] text-[var(--muted)]">{p.unidad ? <><span className="codigo">{p.unidad.codigo}</span> · {p.unidad.nombre}</> : NIVEL_UNIDAD[p.nivelUnidad]?.label}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {p.personas.length === 0 ? (
                        <span className="pill red" title="Asigna un jefe en Estructura o el rol en Usuarios">⚠ Nadie asignado</span>
                      ) : p.personas.map((pe) => (
                        <span key={pe.usuarioId} className={`pill ${pe.rol === "subrogante" ? "amber" : pe.rol === "titular" ? "green" : "blue"}`}>
                          👤 {pe.nombre}{pe.rol ? ` · ${pe.rol}` : ""}
                        </span>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}
