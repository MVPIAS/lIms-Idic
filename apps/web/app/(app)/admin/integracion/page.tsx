"use client";

/**
 * /admin/integracion · API e integración (contrato §4.7.4).
 *   · «Tokens de integración»: cuentas de servicio para que otro sistema use la
 *     API con `Authorization: Bearer <token>`, con el rol (y la unidad) que se
 *     le asigna, fecha de expiración, último uso y revocación. El token se
 *     muestra una sola vez; el servidor guarda solo su hash.
 *   · «Documentación de la API»: la especificación OpenAPI agrupada por módulo,
 *     con el permiso que exige cada operación, y su descarga en JSON.
 * API: /integracion/tokens (integracion.tokens) y /integracion/openapi.json
 * (integracion.documentacion).
 */
import { useMemo, useState } from "react";
import { llamar } from "@/lib/laboratorio";
import { usePermisos } from "@/lib/permisos";
import { fechaDia, fechaHora, hoyChile, sumarDiasCalendario } from "@/lib/format";
import {
  AdminGuard, CabeceraAdmin, Campo, EstadoError, EstadoVacio, Modal, SkeletonLineas, copiar, useCarga, useToast,
} from "@/components/admin/ui";

interface TokenFila {
  id: string;
  nombre: string;
  descripcion: string | null;
  sufijo: string;
  cuenta: string;
  rol: { id: string; codigo: string; nombre: string };
  unidad: { id: string; codigo: string; nombre: string } | null;
  expiraAt: string;
  ultimoUsoAt: string | null;
  ultimoUsoIp: string | null;
  usos: number;
  creadoAt: string;
  creadoPor: string | null;
  revocadoAt: string | null;
  revocadoPor: string | null;
  motivoRevocacion: string | null;
  estado: "vigente" | "vencido" | "revocado";
}

interface Opciones {
  roles: { id: string; codigo: string; nombre: string; alcance: string }[];
  unidades: { id: string; codigo: string; nombre: string; tipo: string | null }[];
  vigencias: number[];
}

const ESTADO: Record<TokenFila["estado"], { texto: string; pill: string }> = {
  vigente: { texto: "Vigente", pill: "green" },
  vencido: { texto: "Vencido", pill: "amber" },
  revocado: { texto: "Revocado", pill: "gray" },
};

const etiquetaVigencia = (d: number) => (d % 365 === 0 ? `${d / 365} año${d === 365 ? "" : "s"}` : `${d} días`);

export default function IntegracionPage() {
  return (
    <AdminGuard permiso="integracion.documentacion">
      <Integracion />
    </AdminGuard>
  );
}

function Integracion() {
  const { puede } = usePermisos();
  const gestiona = puede("integracion.tokens");
  const [pestana, setPestana] = useState<"tokens" | "docs">(gestiona ? "tokens" : "docs");
  const tab = gestiona ? pestana : "docs";

  return (
    <div>
      <CabeceraAdmin
        icono="🔌"
        titulo="API e integración"
        subtitulo={<>Otros sistemas (ERP, sistemas del Ejército, instrumentos de terceros) pueden consultar y registrar datos en el LIMS a través de su
          API REST. Cada sistema usa su propio <b>token de integración</b>, que actúa con los permisos del rol que se le asigna y deja rastro
          en la bitácora de auditoría.</>}
      />
      <div className="tabs" role="tablist" style={{ marginBottom: 12 }}>
        {gestiona && (
          <button role="tab" aria-selected={tab === "tokens"} className={`tab${tab === "tokens" ? " active" : ""}`} onClick={() => setPestana("tokens")}>
            Tokens de integración
          </button>
        )}
        <button role="tab" aria-selected={tab === "docs"} className={`tab${tab === "docs" ? " active" : ""}`} onClick={() => setPestana("docs")}>
          Documentación de la API
        </button>
      </div>
      {tab === "tokens" ? <Tokens /> : <Documentacion />}
    </div>
  );
}

// ───────────────────────────── Tokens ─────────────────────────────

function Tokens() {
  const datos = useCarga(() => llamar<TokenFila[]>("GET", "/integracion/tokens"));
  const [nuevo, setNuevo] = useState(false);
  const [creado, setCreado] = useState<{ nombre: string; cuenta: string; token: string; expiraAt: string } | null>(null);
  const [revocar, setRevocar] = useState<TokenFila | null>(null);
  const [verInactivos, setVerInactivos] = useState(false);
  const filas = (datos.data ?? []).filter((t) => verInactivos || t.estado === "vigente");

  return (
    <>
      <div className="toolbar">
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
          <input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} /> Mostrar revocados y vencidos
        </label>
        <span className="spacer" />
        <button className="btn primary" onClick={() => setNuevo(true)}>＋ Nuevo token</button>
      </div>

      {datos.error ? (
        <EstadoError error={datos.error} onReintentar={() => datos.recargar()} recurso="los tokens de integración" />
      ) : datos.cargando && !datos.data ? (
        <div className="card"><SkeletonLineas n={5} /></div>
      ) : filas.length === 0 ? (
        <div className="card">
          <EstadoVacio icono="🔌" titulo={datos.data?.length ? "No hay tokens vigentes" : "Aún no hay tokens de integración"}
            texto="Cree un token para cada sistema que deba conectarse a la API. Elija el rol con los permisos justos que necesita." />
        </div>
      ) : (
        <div className="card card--table">
          <table className="data">
            <thead>
              <tr>
                <th>Sistema</th>
                <th>Rol asignado</th>
                <th>Token</th>
                <th>Vence</th>
                <th>Último uso</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((t) => (
                <tr key={t.id} style={t.estado !== "vigente" ? { opacity: 0.6 } : undefined}>
                  <td>
                    <b>{t.nombre}</b>
                    <small style={{ display: "block", color: "var(--muted)" }}>Cuenta {t.cuenta} · creado el {fechaDia(t.creadoAt)}{t.creadoPor ? ` por ${t.creadoPor}` : ""}</small>
                    {t.descripcion && <small style={{ display: "block", color: "var(--muted)", maxWidth: 360 }}>{t.descripcion}</small>}
                  </td>
                  <td>
                    {t.rol.nombre}
                    {t.unidad && <small style={{ display: "block", color: "var(--muted)" }}>en {t.unidad.codigo} · {t.unidad.nombre}</small>}
                  </td>
                  <td><span className="codigo">…{t.sufijo}</span></td>
                  <td style={{ whiteSpace: "nowrap" }}>{fechaDia(t.expiraAt)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {t.ultimoUsoAt ? <>{fechaHora(t.ultimoUsoAt)}<small style={{ display: "block", color: "var(--muted)" }}>{t.usos} uso(s){t.ultimoUsoIp ? ` · IP ${t.ultimoUsoIp}` : ""}</small></> : <i style={{ color: "var(--muted)" }}>Nunca usado</i>}
                  </td>
                  <td>
                    <span className={`pill ${ESTADO[t.estado].pill}`}>{ESTADO[t.estado].texto}</span>
                    {t.revocadoAt && <small style={{ display: "block", color: "var(--muted)" }}>el {fechaDia(t.revocadoAt)}{t.revocadoPor ? ` por ${t.revocadoPor}` : ""}{t.motivoRevocacion ? `: ${t.motivoRevocacion}` : ""}</small>}
                  </td>
                  <td>
                    {t.estado !== "revocado" && (
                      <button className="btn ghost-danger sm" onClick={() => setRevocar(t)} aria-label={`Revocar el token de ${t.nombre}`}>Revocar</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <details className="card" style={{ marginTop: 12 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Cómo se usa un token</summary>
        <ol style={{ margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.6 }}>
          <li>El sistema externo envía en cada petición la cabecera <span className="codigo">Authorization: Bearer &lt;token&gt;</span>.</li>
          <li>El token actúa con los permisos del rol asignado (y solo en su unidad, si el rol es por laboratorio). Además puede leer la documentación de la API.</li>
          <li>Cada uso actualiza «Último uso» y queda en Auditoría con la cuenta <span className="codigo">api.…</span> del token.</li>
          <li>Al vencer o al revocarlo, la API lo rechaza de inmediato (401). Para renovarlo, cree uno nuevo y revoque el anterior.</li>
        </ol>
      </details>

      {nuevo && (
        <FormToken
          onCerrar={() => setNuevo(false)}
          onCreado={(c) => { setNuevo(false); setCreado(c); datos.recargar(true); }}
        />
      )}
      {creado && <TokenCreado {...creado} onCerrar={() => setCreado(null)} />}
      {revocar && (
        <FormRevocar token={revocar} onCerrar={() => setRevocar(null)} onRevocado={() => { setRevocar(null); datos.recargar(true); }} />
      )}
    </>
  );
}

function FormToken({ onCerrar, onCreado }: {
  onCerrar: () => void;
  onCreado: (c: { nombre: string; cuenta: string; token: string; expiraAt: string }) => void;
}) {
  const opciones = useCarga(() => llamar<Opciones>("GET", "/integracion/tokens/opciones"));
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [rolId, setRolId] = useState("");
  const [unidadId, setUnidadId] = useState("");
  const [dias, setDias] = useState(365);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  const rol = opciones.data?.roles.find((r) => r.id === rolId);
  const porUnidad = !!rol && rol.alcance !== "GLOBAL";
  const vence = sumarDiasCalendario(hoyChile(), dias);

  async function guardar() {
    setError("");
    if (nombre.trim().length < 3) { setError("Indique el nombre del sistema que usará el token (al menos 3 caracteres)."); return; }
    if (!rolId) { setError("Elija el rol con el que actuará el token."); return; }
    if (porUnidad && !unidadId) { setError(`El rol ${rol?.nombre} trabaja por unidad: elija el laboratorio o la unidad.`); return; }
    setGuardando(true);
    try {
      const r = await llamar<{ nombre: string; cuenta: string; token: string; expiraAt: string }>("POST", "/integracion/tokens", {
        nombre: nombre.trim(),
        descripcion: descripcion.trim() || null,
        rolId,
        unidadId: porUnidad ? unidadId : null,
        diasVigencia: dias,
      });
      onCreado(r);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo="Nuevo token de integración" onClose={onCerrar} ancho={620}
      pie={<>
        <button className="btn outline" onClick={onCerrar}>Cancelar</button>
        <button className="btn primary" disabled={guardando || !opciones.data} onClick={guardar}>{guardando ? "Creando…" : "Crear token"}</button>
      </>}>
      {error && <div className="alert warn" role="alert">{error}</div>}
      {opciones.error ? <EstadoError error={opciones.error} onReintentar={() => opciones.recargar()} recurso="los roles" /> : (
        <div className="form-grid cols-2">
          <Campo label="Sistema que se conecta" req className="span-2" ayuda="Ejemplo: «ERP Finanzas (SIGFE)». Se crea la cuenta de servicio api.… con este nombre.">
            <input value={nombre} maxLength={120} onChange={(e) => setNombre(e.target.value)} autoFocus />
          </Campo>
          <Campo label="Para qué se usa" className="span-2">
            <textarea value={descripcion} maxLength={1000} rows={2} onChange={(e) => setDescripcion(e.target.value)} placeholder="Opcional: qué datos consulta o registra, responsable del sistema…" />
          </Campo>
          <Campo label="Rol (permisos del token)" req ayuda="Elija el rol con los permisos justos. El Super Administrador no se ofrece.">
            <select value={rolId} onChange={(e) => { setRolId(e.target.value); setUnidadId(""); }} aria-label="Rol del token">
              <option value="">Elija un rol…</option>
              {(opciones.data?.roles ?? []).map((r) => (
                <option key={r.id} value={r.id}>{r.nombre}{r.alcance === "GLOBAL" ? "" : " (por unidad)"}</option>
              ))}
            </select>
          </Campo>
          <Campo label="Unidad" req={porUnidad} ayuda={porUnidad ? "El token solo verá y registrará datos de esta unidad." : "El rol elegido es de alcance global."}>
            <select value={unidadId} onChange={(e) => setUnidadId(e.target.value)} disabled={!porUnidad} aria-label="Unidad del token">
              <option value="">{porUnidad ? "Elija la unidad…" : "No corresponde"}</option>
              {(opciones.data?.unidades ?? []).map((u) => <option key={u.id} value={u.id}>{u.codigo} · {u.nombre}</option>)}
            </select>
          </Campo>
          <Campo label="Vigencia" req ayuda={<>Vence el <b>{fechaDia(vence)}</b>. Después la API lo rechaza.</>}>
            <select value={dias} onChange={(e) => setDias(Number(e.target.value))} aria-label="Vigencia del token">
              {(opciones.data?.vigencias ?? [30, 90, 180, 365, 730]).map((d) => <option key={d} value={d}>{etiquetaVigencia(d)}</option>)}
            </select>
          </Campo>
        </div>
      )}
    </Modal>
  );
}

function TokenCreado({ nombre, cuenta, token, expiraAt, onCerrar }: {
  nombre: string; cuenta: string; token: string; expiraAt: string; onCerrar: () => void;
}) {
  const toast = useToast();
  const [copiado, setCopiado] = useState(false);
  const ejemplo = `curl -H "Authorization: Bearer ${token}" ${typeof window !== "undefined" ? window.location.origin : ""}/api/me/alcance`;
  return (
    <Modal titulo={`Token creado · ${nombre}`} onClose={onCerrar} ancho={680}
      pie={<button className="btn primary" onClick={onCerrar}>{copiado ? "Listo, ya lo guardé" : "Cerrar"}</button>}>
      <div className="alert warn" role="alert">
        <b>Copie el token ahora y entréguelo al responsable del sistema por un canal seguro.</b> No se volverá a mostrar: el LIMS solo guarda
        su huella (hash). Si se pierde, revóquelo y cree otro.
      </div>
      <Campo label="Token de integración">
        <textarea readOnly value={token} rows={4} spellCheck={false} style={{ fontFamily: "'JetBrains Mono',Consolas,monospace", fontSize: 11.5, wordBreak: "break-all" }}
          onFocus={(e) => e.currentTarget.select()} aria-label="Token de integración" />
      </Campo>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0 12px" }}>
        <button className="btn accent" onClick={async () => {
          const ok = await copiar(token);
          setCopiado(ok);
          if (ok) toast.ok("Token copiado al portapapeles."); else toast.error("No se pudo copiar: selecciónelo y cópielo a mano.");
        }}>📋 Copiar token</button>
      </div>
      <p style={{ fontSize: 12.5, margin: "0 0 6px" }}>
        Cuenta de servicio <span className="codigo">{cuenta}</span> · vence el <b>{fechaDia(expiraAt)}</b>. Prueba rápida desde el sistema externo:
      </p>
      <pre style={{ background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 6, padding: 8, fontSize: 11, whiteSpace: "pre-wrap", wordBreak: "break-all", margin: 0 }}>{ejemplo}</pre>
    </Modal>
  );
}

function FormRevocar({ token, onCerrar, onRevocado }: { token: TokenFila; onCerrar: () => void; onRevocado: () => void }) {
  const toast = useToast();
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  async function revocar() {
    setGuardando(true);
    setError("");
    try {
      await llamar("POST", `/integracion/tokens/${token.id}/revocar`, { motivo: motivo.trim() || null });
      toast.ok(`Token de ${token.nombre} revocado: la API ya no lo acepta.`);
      onRevocado();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }
  return (
    <Modal titulo={`¿Revocar el token de ${token.nombre}?`} onClose={onCerrar}
      pie={<>
        <button className="btn outline" onClick={onCerrar}>Cancelar</button>
        <button className="btn danger" disabled={guardando} onClick={revocar}>{guardando ? "Revocando…" : "Revocar token"}</button>
      </>}>
      {error && <div className="alert warn" role="alert">{error}</div>}
      <p className="modal-cuerpo" style={{ marginTop: 0 }}>
        El sistema que lo usa dejará de tener acceso de inmediato. No se puede deshacer: para volver a conectarlo habrá que crear un token nuevo.
      </p>
      <Campo label="Motivo (opcional)">
        <input value={motivo} maxLength={500} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: sistema dado de baja, token expuesto…" />
      </Campo>
    </Modal>
  );
}

// ───────────────────────────── Documentación ─────────────────────────────

const VERBOS = ["get", "post", "put", "patch", "delete"] as const;
const COLOR_VERBO: Record<string, string> = { GET: "blue", POST: "green", PUT: "amber", PATCH: "amber", DELETE: "red" };

interface Operacion {
  verbo: string;
  ruta: string;
  resumen: string;
  descripcion: string;
  permisos: string[];
  publica: boolean;
  parametros: { nombre: string; en: string; obligatorio: boolean }[];
  cuerpo: boolean;
}

function Documentacion() {
  const doc = useCarga(() => llamar<any>("GET", "/integracion/openapi.json"));
  const [q, setQ] = useState("");

  const modulos = useMemo(() => {
    const d = doc.data;
    if (!d) return [];
    const grupos = new Map<string, Operacion[]>();
    for (const [ruta, item] of Object.entries<any>(d.paths ?? {})) {
      for (const v of VERBOS) {
        const op = item?.[v];
        if (!op) continue;
        const modulo = op.tags?.[0] ?? "Otros";
        const l = grupos.get(modulo) ?? [];
        l.push({
          verbo: v.toUpperCase(),
          ruta,
          resumen: op.summary ?? "",
          descripcion: op.description ?? "",
          permisos: op["x-permisos"] ?? [],
          publica: Array.isArray(op.security) && op.security.length === 0,
          parametros: (op.parameters ?? []).map((p: any) => ({ nombre: p.name, en: p.in, obligatorio: !!p.required })),
          cuerpo: !!op.requestBody,
        });
        grupos.set(modulo, l);
      }
    }
    const tags: { name: string; description?: string }[] = d.tags ?? [];
    const aguja = q.trim().toLowerCase();
    return tags
      .filter((t) => grupos.has(t.name))
      .map((t) => ({
        nombre: t.name,
        descripcion: t.description ?? "",
        ops: grupos.get(t.name)!.filter((o) =>
          !aguja || `${t.name} ${o.ruta} ${o.resumen} ${o.permisos.join(" ")}`.toLowerCase().includes(aguja),
        ),
      }))
      .filter((m) => m.ops.length > 0);
  }, [doc.data, q]);

  function descargar() {
    if (!doc.data) return;
    const blob = new Blob([JSON.stringify(doc.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `openapi-lims-idic-${hoyChile()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (doc.error) return <EstadoError error={doc.error} onReintentar={() => doc.recargar()} recurso="la documentación de la API" />;
  if (doc.cargando && !doc.data) return <div className="card"><SkeletonLineas n={8} /></div>;
  const total = Object.values<any>(doc.data?.paths ?? {}).reduce((s, i) => s + VERBOS.filter((v) => i?.[v]).length, 0);

  return (
    <>
      <div className="card">
        <h2>{doc.data?.info?.title} <span className="right">versión {doc.data?.info?.version} · {total} operaciones</span></h2>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6, fontSize: 12.5 }}>
          <li><b>Dirección base:</b> <span className="codigo">{typeof window !== "undefined" ? window.location.origin : ""}/api</span></li>
          <li><b>Autenticación:</b> cabecera <span className="codigo">Authorization: Bearer &lt;token&gt;</span> con un token de integración (pestaña «Tokens de integración») o de sesión.</li>
          <li><b>Permisos:</b> cada operación indica el permiso que exige; sin él la API responde 403. Las rutas por laboratorio filtran además por la unidad del rol.</li>
          <li><b>Formato:</b> JSON UTF-8, fechas ISO 8601 (hora de Chile continental), errores <span className="codigo">{"{ statusCode, message }"}</span> en español.</li>
          <li><b>Trazabilidad:</b> toda escritura queda en Auditoría con el usuario o la cuenta de servicio.</li>
        </ul>
        <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
          <input type="search" placeholder="Buscar ruta, módulo o permiso…" aria-label="Buscar en la documentación" value={q}
            onChange={(e) => setQ(e.target.value)} style={{ flex: "1 1 240px", minWidth: 0 }} />
          <button className="btn outline" onClick={descargar}>⬇ Descargar especificación (OpenAPI JSON)</button>
        </div>
      </div>

      {modulos.length === 0 ? (
        <div className="card"><EstadoVacio icono="🔎" titulo="Sin resultados" texto={`Ninguna operación coincide con «${q}».`} /></div>
      ) : modulos.map((m) => (
        <details key={m.nombre} className="card" open={!!q.trim()} style={{ padding: 0 }}>
          <summary style={{ cursor: "pointer", padding: "11px 15px", fontWeight: 700 }}>
            {m.nombre} <small style={{ fontWeight: 400, color: "var(--muted)" }}>· {m.ops.length} operación(es) · {m.descripcion}</small>
          </summary>
          <div style={{ overflowX: "auto" }}>
            <table className="data">
              <thead>
                <tr><th style={{ width: 70 }}>Método</th><th>Ruta y descripción</th><th>Parámetros</th><th>Permiso</th></tr>
              </thead>
              <tbody>
                {m.ops.map((o) => (
                  <tr key={`${o.verbo} ${o.ruta}`}>
                    <td><span className={`pill ${COLOR_VERBO[o.verbo] ?? "gray"}`}>{o.verbo}</span></td>
                    <td>
                      <span className="codigo" style={{ wordBreak: "break-all" }}>{o.ruta}</span>
                      <small style={{ display: "block", color: "var(--muted)" }}>{o.resumen}</small>
                    </td>
                    <td style={{ fontSize: 11.5 }}>
                      {o.parametros.length === 0 && !o.cuerpo ? "—" : (
                        <>
                          {o.parametros.map((p) => (
                            <div key={`${p.en}-${p.nombre}`}><span className="codigo">{p.nombre}</span> <span style={{ color: "var(--muted)" }}>({p.en === "path" ? "ruta" : p.en === "query" ? "consulta" : p.en}{p.obligatorio ? ", obligatorio" : ""})</span></div>
                          ))}
                          {o.cuerpo && <div style={{ color: "var(--muted)" }}>Cuerpo JSON</div>}
                        </>
                      )}
                    </td>
                    <td style={{ fontSize: 11.5 }}>
                      {o.publica ? <i>Público</i> : o.permisos.length ? o.permisos.map((p) => <span key={p} className="tag" style={{ marginRight: 3 }}>{p}</span>) : <i style={{ color: "var(--muted)" }}>Solo autenticación</i>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </>
  );
}
