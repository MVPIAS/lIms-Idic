"use client";

/**
 * /admin/numeracion · Numeración de documentos.
 * Formato del número oficial por laboratorio (unidad) y tipo de documento, con
 * correlativo atómico. Una unidad hereda la regla de su ancestro más cercano;
 * sin regla, el documento sale con la numeración general CERT-AAAA-NNNN.
 * API: /numeracion-documentos (permiso documento.numeracion).
 * Reglas: docs/FLUJO_NUMERACION_DOCUMENTOS.md.
 */
import { useEffect, useMemo, useState } from "react";
import { adminApi, type Unidad } from "@/lib/admin";
import { llamar } from "@/lib/laboratorio";
import {
  AdminGuard, CabeceraAdmin, Campo, EstadoError, EstadoVacio, Modal, SkeletonLineas, useCarga, useConfirm, useToast,
} from "@/components/admin/ui";
import { SelectorUnidad } from "@/components/admin/Selectores";

interface Regla {
  id: string;
  unidadId: string | null;
  unidadCodigo: string | null;
  unidadNombre: string | null;
  tipoDocumento: string | null;
  formato: string;
  reinicio: "anual" | "continuo";
  correlativoPorUnidad: boolean;
  porConfirmar: boolean;
  fuente: string | null;
  activo: boolean;
  updatedAt: string;
}
interface Catalogo {
  reglas: Regla[];
  tokens: { token: string; descripcion: string }[];
  tipos: { codigo: string; nombre: string }[];
}

export default function NumeracionPage() {
  return (
    <AdminGuard permiso="documento.numeracion">
      <Numeracion />
    </AdminGuard>
  );
}

function Numeracion() {
  const datos = useCarga(() => llamar<Catalogo>("GET", "/numeracion-documentos"));
  const unidades = useCarga(() => adminApi.unidades().catch(() => [] as Unidad[]));
  const [editar, setEditar] = useState<Regla | "nueva" | null>(null);
  const [verInactivas, setVerInactivas] = useState(false);
  const toast = useToast();
  const confirmar = useConfirm();

  const tipos = datos.data?.tipos ?? [];
  const nombreTipo = (t: string | null) => (t ? tipos.find((x) => x.codigo === t)?.nombre ?? t : "Todos los tipos");
  const reglas = (datos.data?.reglas ?? []).filter((r) => verInactivas || r.activo);

  async function desactivar(r: Regla) {
    const ok = await confirmar({
      titulo: `¿Desactivar la regla ${r.unidadCodigo ?? "general"} · ${nombreTipo(r.tipoDocumento)}?`,
      mensaje: "Los documentos nuevos tomarán la regla del ancestro más cercano o la numeración general. Los ya emitidos conservan su número.",
      confirmar: "Desactivar",
      peligro: true,
    });
    if (!ok) return;
    try {
      await llamar("POST", `/numeracion-documentos/${r.id}/desactivar`);
      toast.ok("Regla desactivada.");
      datos.recargar(true);
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  return (
    <div>
      <CabeceraAdmin
        icono="№"
        titulo="Numeración de documentos"
        subtitulo={<>Formato del número oficial de cada documento según el laboratorio que lo emite y su tipo. Una unidad usa su regla o la de su
          ancestro más cercano (las sucursales usan la del BPCH); sin regla, el documento sale con <span className="codigo">CERT-AAAA-NNNN</span>.
          El correlativo <span className="codigo">{"{N}"}</span> es atómico: dos emisiones simultáneas nunca reciben el mismo número.</>}
        acciones={<button className="btn primary" onClick={() => setEditar("nueva")}>＋ Nueva regla</button>}
      />

      {datos.error ? (
        <EstadoError error={datos.error} onReintentar={() => datos.recargar()} recurso="la numeración de documentos" />
      ) : datos.cargando && !datos.data ? (
        <div className="card"><SkeletonLineas n={6} /></div>
      ) : (
        <div className="card card--table">
          <div className="toolbar" style={{ padding: "10px 12px", margin: 0 }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
              <input type="checkbox" checked={verInactivas} onChange={(e) => setVerInactivas(e.target.checked)} /> Mostrar reglas desactivadas
            </label>
            <span className="spacer" />
            <small style={{ color: "var(--muted)" }}>{reglas.length} regla(s)</small>
          </div>
          {reglas.length === 0 ? (
            <EstadoVacio icono="№" titulo="No hay reglas de numeración"
              texto="Todos los documentos salen con la numeración general CERT-AAAA-NNNN. Cree una regla para el laboratorio que tenga numeración propia." />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Unidad</th>
                    <th>Tipo de documento</th>
                    <th>Formato</th>
                    <th>Correlativo</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {reglas.map((r) => (
                    <tr key={r.id} style={!r.activo ? { opacity: 0.55 } : undefined}>
                      <td>{r.unidadCodigo ? <><b>{r.unidadCodigo}</b><small style={{ display: "block", color: "var(--muted)" }}>{r.unidadNombre}</small></> : <i>General (todas las unidades)</i>}</td>
                      <td>{nombreTipo(r.tipoDocumento)}</td>
                      <td>
                        <span className="codigo">{r.formato}</span>
                        {r.fuente && <small style={{ display: "block", color: "var(--muted)", maxWidth: 420 }}>{r.fuente}</small>}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {r.reinicio === "anual" ? "Se reinicia cada año" : "Continuo"}
                        {r.correlativoPorUnidad && <small style={{ display: "block", color: "var(--muted)" }}>uno por cada unidad</small>}
                      </td>
                      <td>
                        {!r.activo ? <span className="pill gray">Desactivada</span>
                          : r.porConfirmar ? <span className="pill amber" title="Formato por defecto de la especificación, aún no confirmado por el IDIC">Por confirmar</span>
                          : <span className="pill green">Vigente</span>}
                      </td>
                      <td>
                        {r.activo && (
                          <span style={{ display: "flex", gap: 4 }}>
                            <button className="btn outline sm" onClick={() => setEditar(r)} aria-label={`Editar la regla de ${r.unidadCodigo ?? "general"}`}>Editar</button>
                            <button className="btn ghost-danger sm" onClick={() => desactivar(r)} aria-label={`Desactivar la regla de ${r.unidadCodigo ?? "general"}`}>Desactivar</button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {datos.data && (
        <details className="card" style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Datos que puede llevar el número</summary>
          <table className="data" style={{ marginTop: 8 }}>
            <tbody>
              {datos.data.tokens.map((t) => (
                <tr key={t.token}><td style={{ width: 160 }}><span className="codigo">{t.token}</span></td><td>{t.descripcion}</td></tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {editar && datos.data && (
        <FormRegla
          regla={editar === "nueva" ? null : editar}
          tipos={tipos}
          unidades={unidades.data ?? []}
          onCerrar={() => setEditar(null)}
          onGuardada={() => { setEditar(null); datos.recargar(true); }}
        />
      )}
    </div>
  );
}

function FormRegla({ regla, tipos, unidades, onCerrar, onGuardada }: {
  regla: Regla | null;
  tipos: { codigo: string; nombre: string }[];
  unidades: Unidad[];
  onCerrar: () => void;
  onGuardada: () => void;
}) {
  const toast = useToast();
  const [unidadId, setUnidadId] = useState<string | null>(regla?.unidadId ?? null);
  const [tipo, setTipo] = useState<string>(regla?.tipoDocumento ?? "");
  const [formato, setFormato] = useState(regla?.formato ?? "");
  const [reinicio, setReinicio] = useState<"anual" | "continuo">(regla?.reinicio ?? "anual");
  const [porUnidad, setPorUnidad] = useState(regla?.correlativoPorUnidad ?? false);
  const [porConfirmar, setPorConfirmar] = useState(regla?.porConfirmar ?? false);
  const [fuente, setFuente] = useState(regla?.fuente ?? "");
  const [ejemplo, setEjemplo] = useState<{ numero: string | null; errores: string[] } | null>(null);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  // Ejemplo en vivo del formato (no consume correlativo).
  useEffect(() => {
    if (!formato.trim()) { setEjemplo(null); return; }
    let vivo = true;
    const t = setTimeout(() => {
      llamar<{ numero: string | null; errores: string[] }>("POST", "/numeracion-documentos/probar", { formato, unidadId })
        .then((r) => vivo && setEjemplo(r))
        .catch(() => vivo && setEjemplo(null));
    }, 300);
    return () => { vivo = false; clearTimeout(t); };
  }, [formato, unidadId]);

  const unidad = useMemo(() => unidades.find((u) => u.id === unidadId), [unidades, unidadId]);

  async function guardar() {
    setError("");
    if (!formato.trim()) { setError("Indique el formato del número."); return; }
    setGuardando(true);
    try {
      if (regla) {
        await llamar("PATCH", `/numeracion-documentos/${regla.id}`, {
          formato: formato.trim(), reinicio, correlativoPorUnidad: porUnidad, porConfirmar, fuente: fuente.trim() || null,
        });
      } else {
        await llamar("POST", "/numeracion-documentos", {
          unidadId, tipoDocumento: tipo || null, formato: formato.trim(), reinicio, correlativoPorUnidad: porUnidad, porConfirmar,
          fuente: fuente.trim() || null,
        });
      }
      toast.ok(regla ? "Regla actualizada: se aplica a los próximos documentos." : "Regla creada.");
      onGuardada();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo={regla ? `Editar numeración · ${regla.unidadCodigo ?? "general"}` : "Nueva regla de numeración"} onClose={onCerrar} ancho={640}
      pie={<>
        <button className="btn outline" onClick={onCerrar}>Cancelar</button>
        <button className="btn primary" disabled={guardando || !!ejemplo?.errores.length} onClick={guardar}>{guardando ? "Guardando…" : "Guardar regla"}</button>
      </>}>
      {error && <div className="alert warn" role="alert">{error}</div>}
      <div className="form-grid cols-2">
        <Campo label="Unidad (laboratorio)" ayuda="Vacío = regla general. Las unidades que cuelgan de esta la heredan.">
          {regla ? <input value={regla.unidadCodigo ? `${regla.unidadCodigo} · ${regla.unidadNombre}` : "General"} disabled />
            : <SelectorUnidad unidades={unidades} value={unidadId} onChange={setUnidadId} nulo="General (todas las unidades)" ariaLabel="Unidad de la regla" />}
        </Campo>
        <Campo label="Tipo de documento">
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} disabled={!!regla} aria-label="Tipo de documento">
            <option value="">Todos los tipos</option>
            {tipos.map((t) => <option key={t.codigo} value={t.codigo}>{t.nombre}</option>)}
          </select>
        </Campo>
        <Campo label="Formato del número" req className="span-2"
          ayuda={<>Ejemplos: <span className="codigo">IE {"{LAB}"} N° {"{N:3}"}/{"{AAAA}"}</span> · <span className="codigo">IVC.DQO.{"{LAB}"} Nº {"{OT_N}"}/{"{AAAA}"}</span> ·{" "}
            <span className="codigo">{"{CODSUCDEL}"}/{"{N:4}"}/{"{OT_N:5}"}/{"{MUESTRA_N:6}"}</span></>}>
          <input value={formato} maxLength={120} onChange={(e) => setFormato(e.target.value)} aria-describedby="num-ejemplo" spellCheck={false} />
        </Campo>
      </div>
      <p id="num-ejemplo" aria-live="polite" style={{ margin: "4px 0 10px", fontSize: 12.5 }}>
        {ejemplo?.errores.length ? <span style={{ color: "var(--red, #b91c1c)" }}>{ejemplo.errores.join(" ")}</span>
          : ejemplo?.numero ? <>Así se verá{unidad ? ` en ${unidad.codigo}` : ""}: <b className="codigo">{ejemplo.numero}</b> <small style={{ color: "var(--muted)" }}>(datos de ejemplo)</small></>
          : null}
      </p>
      <div className="form-grid cols-2">
        <Campo label="Correlativo {N}">
          <select value={reinicio} onChange={(e) => setReinicio(e.target.value as any)} aria-label="Reinicio del correlativo">
            <option value="anual">Vuelve a 1 cada año</option>
            <option value="continuo">Continuo (no se reinicia)</option>
          </select>
        </Campo>
        <Campo label="Opciones">
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
            <input type="checkbox" checked={porUnidad} onChange={(e) => setPorUnidad(e.target.checked)} /> Un correlativo por cada unidad que la hereda
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
            <input type="checkbox" checked={porConfirmar} onChange={(e) => setPorConfirmar(e.target.checked)} /> Formato por confirmar con el IDIC
          </label>
        </Campo>
        <Campo label="Fuente o nota" className="span-2">
          <textarea rows={2} maxLength={1000} value={fuente} onChange={(e) => setFuente(e.target.value)} placeholder="Procedimiento o especificación de donde sale el formato" />
        </Campo>
      </div>
    </Modal>
  );
}
