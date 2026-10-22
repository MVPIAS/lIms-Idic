"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fmtN, fmtG } from "@/lib/metrologia";
import { numeroOVacio } from "@/lib/metrologiaFicha";
import DataTable, { type DataColumn } from "@/components/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { toast } from "@/components/ui/feedback";
import { usePermisos } from "@/lib/permisos";
import ImagenesCertificado from "@/components/metrologia/ImagenesCertificado";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("lims_token")}`, "Content-Type": "application/json" });
const H3 = { margin: 0, fontSize: 13 } as const;
const ESTADO_PATRON: Record<string, { label: string; pill: string }> = {
  vigente: { label: "Vigente", pill: "green" }, por_vencer: { label: "Vence en < 30 días", pill: "amber" },
  vencido: { label: "Vencido", pill: "red" }, sin_fecha: { label: "Sin vencimiento", pill: "gray" },
};
const FUNCION: Record<string, string> = {
  METROLOGO: "Metrólogo", JEFE_LAB: "Jefe del laboratorio", JEFE_LAB_SUBROGANTE: "Jefe del laboratorio subrogante", JEFE_DEPTO: "Jefe del departamento",
};
const dmy = (x: any) => (x ? `${String(x).slice(8, 10)}-${String(x).slice(5, 7)}-${String(x).slice(0, 4)}` : "—");
const PESTANAS = [["patrones", "Patrones y equipos"], ["firmas", "Registro de firmas"], ["cmc", "CMC acreditadas"], ["numeracion", "Numeración"], ["certificado", "Certificado: logo y esquemas"], ["calculo", "Cálculo GUM"]] as const;

async function pedir(url: string, init?: RequestInit) {
  const r = await fetch(`${API}${url}`, { headers: auth(), ...init });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(Array.isArray(j.message) ? j.message.join(", ") : j.message ?? `Error ${r.status}`);
  return j;
}

export default function MetrologiaConfigPage() {
  const { puede } = usePermisos();
  const editar = puede("metrologia.config");
  const [tab, setTab] = useState<(typeof PESTANAS)[number][0]>("patrones");
  const [cfg, setCfg] = useState<any>(null);
  const [firmantes, setFirmantes] = useState<any[]>([]);
  const [candidatos, setCandidatos] = useState<any[]>([]);
  const [cmc, setCmc] = useState<any[]>([]);
  const [num, setNum] = useState<any[]>([]);
  const [depto, setDepto] = useState<{ nombreDepartamento: string; origen: string } | null>(null);
  const [mag, setMag] = useState("masa");
  const [editPat, setEditPat] = useState<any>(null);
  const [error, setError] = useState("");

  async function cargar() {
    try {
      const [c, f, m, n, p] = await Promise.all([
        pedir("/metrologia/config"), pedir("/metrologia/firmantes"), pedir("/metrologia/cmc"), pedir("/metrologia/numeracion"), pedir("/metrologia/parametros"),
      ]);
      setCfg(c); setFirmantes(f.data ?? []); setCmc(m.data ?? []); setNum(n.data ?? []); setDepto(p.data);
      if (editar) setCandidatos((await pedir("/metrologia/firmantes/candidatos")).data ?? []);
      setError("");
    } catch (e: any) { setError(e.message); }
  }
  useEffect(() => { cargar(); }, [editar]); // eslint-disable-line react-hooks/exhaustive-deps

  const divisores: Record<string, number> = useMemo(
    () => Object.fromEntries((cfg?.distribuciones ?? []).map((d: any) => [d.codigo, Number(d.divisor)])), [cfg]);

  async function guardar(fn: () => Promise<any>, ok: string) {
    try { await fn(); toast.ok(ok); await cargar(); } catch (e: any) { toast.error(e.message); }
  }

  if (!cfg) return <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>{error || "Cargando configuración…"}</div>;

  const colsPatron: DataColumn[] = [
    { key: "codigo", label: "Código", render: (p) => <span className="codigo">{p.codigo}</span> },
    {
      key: "nombre", label: "Equipo", value: (p) => `${p.nombre} ${p.rango ?? ""}`,
      render: (p) => <>{p.nombre}{p.rango ? <span style={{ color: "var(--muted)" }}> · {p.rango}</span> : null}
        {p.rango_min != null && p.rango_max != null && <span style={{ display: "block", fontSize: 11, color: "var(--muted)" }}>Rango calibrado {fmtG(p.rango_min)} a {fmtG(p.rango_max)} {p.unidad_rango}</span>}
        {p.correcciones && <span style={{ display: "block", fontSize: 11, color: "var(--muted)" }}>Errores del certificado cargados</span>}</>,
    },
    { key: "tipo", label: "Tipo", value: (p) => (p.tipo === "auxiliar" ? "Auxiliar" : "Patrón") },
    { key: "magnitud", label: "Magnitud" },
    { key: "serie", label: "N° de serie" },
    { key: "n_certificado", label: "Certificado" },
    { key: "emisor", label: "Emisor" },
    { key: "ultima_calibracion", label: "Última calibración", value: (p) => p.ultima_calibracion ?? "", render: (p) => dmy(p.ultima_calibracion) },
    { key: "intervalo_meses", label: "Intervalo (meses)", num: true },
    { key: "vence", label: "Vence", value: (p) => p.vence ?? "", render: (p) => dmy(p.vence) },
    { key: "estado", label: "Estado hoy", value: (p) => (p.activo === false ? "Baja" : ESTADO_PATRON[p.estado]?.label ?? p.estado),
      render: (p) => (p.activo === false ? <span className="pill gray">De baja</span> : <span className={`pill ${ESTADO_PATRON[p.estado]?.pill ?? "gray"}`}>{ESTADO_PATRON[p.estado]?.label ?? p.estado}</span>) },
  ];
  const colsCmc: DataColumn[] = [
    { key: "proceso_codigo", label: "Proceso", render: (x) => <span className="codigo">{x.proceso_codigo}</span> },
    { key: "acreditacion", label: "Acreditación", value: (x) => x.acreditacion ?? "No acreditado" },
    { key: "servicio", label: "Servicio", value: (x) => `${x.servicio}${x.variante ? " · " + x.variante : ""}` },
    { key: "rango", label: "Rango", value: (x) => `${x.incluye_min ? "≥" : ">"} ${fmtG(x.rango_min)} a ≤ ${fmtG(x.rango_max)} ${x.unidad_rango}` },
    { key: "resolucion", label: "Resolución", value: (x) => (x.resolucion == null ? "—" : `${fmtG(x.resolucion)} ${x.unidad_rango}`) },
    { key: "cmc", label: "CMC (k = 2, 95 %)", value: (x) => (x.tipo === "lineal" ? `${fmtG(x.a)}·L + ${fmtG(x.b)} ${x.unidad_cmc}` : x.tipo === "raiz" ? `√(${fmtG(x.a)}·V + 0,333·r²) ${x.unidad_cmc}` : `${fmtG(x.a)} ${x.unidad_cmc}`) },
    { key: "version", label: "Versión del alcance" },
    { key: "vigencia", label: "Vigencia", value: (x) => `${dmy(x.vigente_desde)} a ${x.vigente_hasta ? dmy(x.vigente_hasta) : "—"}` },
  ];
  const comps = (cfg.componentes ?? []).filter((c: any) => c.magnitud === mag);

  return (
    <div>
      <PageHeader
        titulo="Metrología · Maestros y configuración"
        migas={[{ label: "Calibraciones", href: "/metrologia" }, { label: "Maestros y configuración" }]}
        subtitulo={<>Patrones y equipos auxiliares (programas de calibración IDIC-PG11 Anexo02), registro de firmas autorizadas por magnitud,
          capacidades de medición acreditadas (CMC), numeración de certificados y parámetros del cálculo. {editar ? "Usted puede editarlos." : "Solo lectura: los edita quien tiene el permiso de configuración de Metrología."}</>}
      />
      {error && <div className="alert warn" role="alert">{error}</div>}
      {depto && (
        <div className="alert info">
          Departamento que firma los certificados: <b>{depto.nombreDepartamento}</b>{" "}
          ({depto.origen === "parametro" ? "parámetro «certificado_calibracion · nombre_departamento»" : "nombre del organigrama"}).
          {puede("catalogo.gestionar") && <> Se cambia en <Link href={"/catalogo/parametros" as any}>Administración › Parámetros</Link>.</>}
          {" "}En los documentos oficiales del LMT figura «Departamento Sistemas de Armas»: el IDIC decide el nombre.
        </div>
      )}

      <div role="tablist" aria-label="Secciones" className="toolbar" style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {PESTANAS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`btn sm${tab === k ? " primary" : ""}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === "patrones" && (
        <>
          <DataTable columns={colsPatron} rows={cfg.patrones ?? []} searchKeys={["codigo", "nombre", "serie", "n_certificado"]}
            acciones={editar ? (p) => <button className="btn sm" onClick={() => setEditPat({
              ...p, vence: p.vence?.slice(0, 10) ?? "", ultima_calibracion: p.ultima_calibracion?.slice(0, 10) ?? "",
              rango_min: p.rango_min == null ? "" : String(p.rango_min).replace(".", ","), rango_max: p.rango_max == null ? "" : String(p.rango_max).replace(".", ","),
              corr: Object.fromEntries((["temp", "hum", "pres"] as const).map((k) => [k, {
                error: p.correcciones?.[k]?.error == null ? "" : String(p.correcciones[k].error).replace(".", ","),
                U: p.correcciones?.[k]?.U == null ? "" : String(p.correcciones[k].U).replace(".", ","),
              }])),
            })}>Actualizar</button> : undefined}
            vacio="No hay patrones en el maestro." />
          {editPat && (
            <div role="dialog" aria-modal="true" aria-labelledby="t-pat" onKeyDown={(e) => { if (e.key === "Escape") setEditPat(null); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "grid", placeItems: "center", zIndex: 50 }}>
              <div className="card" style={{ width: "min(560px, 94vw)", padding: 18 }}>
                <h3 id="t-pat" style={{ marginTop: 0 }}>{editPat.codigo} · {editPat.nombre}</h3>
                <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 0 }}>Registre el nuevo certificado al recibir el equipo calibrado. Un patrón vencido no se puede elegir en una calibración posterior a su vencimiento.</p>
                <div className="form-grid">
                  {([["n_certificado", "N° de certificado", "text"], ["emisor", "Laboratorio de calibración", "text"], ["ultima_calibracion", "Última calibración", "date"],
                    ["intervalo_meses", "Intervalo (meses)", "number"], ["vence", "Vencimiento", "date"], ["trazabilidad", "Trazabilidad inmediata", "text"]] as const).map(([k, l, t]) => (
                    <div className="field" key={k}><label htmlFor={`p-${k}`}>{l}</label>
                      <input id={`p-${k}`} type={t} autoFocus={k === "n_certificado"} value={editPat[k] ?? ""} onChange={(e) => setEditPat({ ...editPat, [k]: e.target.value })} /></div>
                  ))}
                  {editPat.tipo !== "auxiliar" ? (
                    <fieldset style={{ gridColumn: "1 / -1", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px", margin: 0 }}>
                      <legend style={{ fontSize: 12, color: "var(--muted)", padding: "0 4px" }}>Rango calibrado (numérico) · «{editPat.rango || "sin texto"}»</legend>
                      <div className="form-grid">
                        {([["rango_min", "Mínimo"], ["rango_max", "Máximo"], ["unidad_rango", "Unidad (MPa, bar, kN, mm…)"]] as const).map(([k, l]) => (
                          <div className="field" key={k}><label htmlFor={`p-${k}`}>{l}</label>
                            <input id={`p-${k}`} inputMode={k === "unidad_rango" ? undefined : "decimal"} value={editPat[k] ?? ""} onChange={(e) => setEditPat({ ...editPat, [k]: e.target.value })} /></div>
                        ))}
                      </div>
                      <small style={{ color: "var(--muted)" }}>Con el rango cargado, una calibración no puede medir un punto fuera de él con este patrón (R15 P6). Vacío = no se controla.</small>
                    </fieldset>
                  ) : (
                    <fieldset style={{ gridColumn: "1 / -1", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px", margin: 0 }}>
                      <legend style={{ fontSize: 12, color: "var(--muted)", padding: "0 4px" }}>Error de su certificado (se resta de la lectura) y U (k = 2)</legend>
                      <div className="form-grid cols-2">
                        {([["temp", "Temperatura (°C)"], ["hum", "Humedad (%HR)"], ["pres", "Presión (hPa)"]] as const).flatMap(([k, l]) => [
                          <div className="field" key={`${k}-e`}><label htmlFor={`p-${k}-e`}>{l} · error</label>
                            <input id={`p-${k}-e`} inputMode="decimal" value={editPat.corr?.[k]?.error ?? ""} onChange={(e) => setEditPat({ ...editPat, corr: { ...editPat.corr, [k]: { ...editPat.corr?.[k], error: e.target.value } } })} /></div>,
                          <div className="field" key={`${k}-u`}><label htmlFor={`p-${k}-u`}>{l} · U</label>
                            <input id={`p-${k}-u`} inputMode="decimal" value={editPat.corr?.[k]?.U ?? ""} onChange={(e) => setEditPat({ ...editPat, corr: { ...editPat.corr, [k]: { ...editPat.corr?.[k], U: e.target.value } } })} /></div>,
                        ])}
                      </div>
                      <small style={{ color: "var(--muted)" }}>Deje vacío lo que el equipo no mide. Las calibraciones informan la condición corregida con esta U.</small>
                    </fieldset>
                  )}
                  {editPat.coeficientes && (
                    <p style={{ gridColumn: "1 / -1", fontSize: 12, margin: 0, color: "var(--muted)" }}>
                      Último certificado del LNF: clase {editPat.coeficientes.clase ?? "—"} · t = {fmtG(editPat.coeficientes.t)} · u = {fmtG(editPat.coeficientes.u)} · v = {fmtG(editPat.coeficientes.v)}
                      {editPat.coeficientes.certificado ? ` · ${editPat.coeficientes.certificado}` : ""}
                    </p>
                  )}
                  <label style={{ display: "flex", gap: 8, alignItems: "center", gridColumn: "1 / -1" }}>
                    <input type="checkbox" checked={editPat.activo !== false} onChange={(e) => setEditPat({ ...editPat, activo: e.target.checked })} /> En uso (desmarque para darlo de baja)
                  </label>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
                  <button className="btn sm" onClick={() => setEditPat(null)}>Cancelar</button>
                  <button className="btn sm primary" onClick={() => guardar(async () => {
                    await pedir(`/metrologia/patrones/${editPat.id}`, { method: "PUT", body: JSON.stringify({
                      n_certificado: editPat.n_certificado || null, emisor: editPat.emisor || null, ultima_calibracion: editPat.ultima_calibracion || "",
                      intervalo_meses: editPat.intervalo_meses === "" || editPat.intervalo_meses == null ? null : Number(editPat.intervalo_meses),
                      vence: editPat.vence || "", trazabilidad: editPat.trazabilidad || null, activo: editPat.activo !== false,
                      ...(editPat.tipo !== "auxiliar"
                        ? { rango_min: numeroOVacio(editPat.rango_min ?? ""), rango_max: numeroOVacio(editPat.rango_max ?? ""), unidad_rango: String(editPat.unidad_rango ?? "").trim() || null }
                        : { correcciones: Object.fromEntries((["temp", "hum", "pres"] as const).map((k) => [k, { error: numeroOVacio(editPat.corr?.[k]?.error ?? ""), U: numeroOVacio(editPat.corr?.[k]?.U ?? "") }])) }),
                    }) });
                    setEditPat(null);
                  }, "Patrón actualizado")}>Guardar</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {tab === "firmas" && (
        <div className="card card--table">
          <div style={{ padding: "12px 16px" }}>
            <h3 style={H3}>Registro de firmas autorizadas del Laboratorio de Metrología por magnitud</h3>
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 0" }}>LMT-PG01 Anexo 11. Para enviar una calibración, el metrólogo debe estar vinculado a una fila vigente que incluya la magnitud.
              El jefe del laboratorio y su subrogante firman según la matriz de firmas (Administración › Unidades: titular y subrogante).</p>
          </div>
          <table className="data">
            <thead><tr><th>Iniciales</th><th>Función</th><th>Cargo</th><th>Magnitudes</th><th>Usuario vinculado</th><th>Vigente</th></tr></thead>
            <tbody>
              {firmantes.map((f) => (
                <tr key={f.id}>
                  <td className="codigo">{f.iniciales}</td>
                  <td>{FUNCION[f.funcion] ?? f.funcion}</td>
                  <td style={{ fontSize: 12 }}>{f.cargo}</td>
                  <td>{f.funcion === "METROLOGO" && editar ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {(cfg.magnitudes ?? []).map((m: any) => (
                        <label key={m.codigo} style={{ fontSize: 12, display: "flex", gap: 3, alignItems: "center" }}>
                          <input type="checkbox" checked={(f.magnitudes ?? []).includes(m.codigo)} onChange={(e) => {
                            const nuevas = e.target.checked ? [...f.magnitudes, m.codigo] : f.magnitudes.filter((x: string) => x !== m.codigo);
                            guardar(() => pedir(`/metrologia/firmantes/${f.id}`, { method: "PUT", body: JSON.stringify({ magnitudes: nuevas }) }), "Magnitudes actualizadas");
                          }} />{m.nombre}
                        </label>
                      ))}
                    </div>
                  ) : (f.magnitudes ?? []).join(", ") || "—"}</td>
                  <td>{editar ? (
                    <select aria-label={`Usuario de ${f.iniciales}`} value={f.usuario_id ?? ""} onChange={(e) =>
                      guardar(() => pedir(`/metrologia/firmantes/${f.id}`, { method: "PUT", body: JSON.stringify({ usuarioId: e.target.value || null }) }), "Vinculación guardada")}>
                      <option value="">Sin vincular</option>
                      {candidatos.map((u) => <option key={u.id} value={u.id}>{u.nombre} ({u.username})</option>)}
                      {f.usuario_id && !candidatos.some((u) => u.id === f.usuario_id) && <option value={f.usuario_id}>{f.usuario_nombre}</option>}
                    </select>
                  ) : f.usuario_nombre ?? <span style={{ color: "var(--muted)" }}>Sin vincular</span>}</td>
                  <td>{editar ? (
                    <input type="checkbox" aria-label={`Vigente ${f.iniciales}`} checked={f.activo} onChange={(e) =>
                      guardar(() => pedir(`/metrologia/firmantes/${f.id}`, { method: "PUT", body: JSON.stringify({ activo: e.target.checked }) }), "Registro actualizado")} />
                  ) : f.activo ? "Sí" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "cmc" && (
        <>
          <p style={{ fontSize: 13, color: "var(--muted)" }}>Capacidades de medición y calibración de los alcances vigentes (LC 001 Mod. 2, LC 004 Mod. 1, LC 005 del 15-01-2026; ITV05 según su planilla).
            En el certificado, U certificada = máx(U calculada, CMC) con dos cifras significativas; un punto fuera de estos rangos se marca «*» (no incluido en el alcance).
            Una modificación del alcance se carga como una versión nueva.</p>
          <DataTable columns={colsCmc} rows={cmc} rowKey={(x) => x.clave} searchKeys={["proceso_codigo", "servicio", "version"]} pageSize={25} vacio="Sin CMC cargadas." />
        </>
      )}

      {tab === "numeracion" && (
        <Numeracion filas={num} editar={editar} guardar={(prefijo, cuerpo) => guardar(() => pedir(`/metrologia/numeracion/${prefijo}`, { method: "PUT", body: JSON.stringify(cuerpo) }), `Numeración ${prefijo} actualizada`)} />
      )}

      {tab === "certificado" && <ImagenesCertificado editar={editar} />}

      {tab === "calculo" && (
        <>
          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line-2, #eee)", display: "flex", gap: 10, alignItems: "center" }}>
              <h3 style={H3}>Componentes de incertidumbre (formulario GUM)</h3>
              <select aria-label="Magnitud" value={mag} onChange={(e) => setMag(e.target.value)} style={{ marginLeft: "auto", width: "auto" }}>
                {(cfg.magnitudes ?? []).map((m: any) => <option key={m.codigo} value={m.codigo}>{m.nombre}</option>)}
              </select>
            </div>
            <table className="data">
              <thead><tr><th>Símbolo</th><th>Componente</th><th>Distribución</th><th className="num">Divisor</th><th>Fuente del valor</th></tr></thead>
              <tbody>
                {comps.map((c: any) => (
                  <tr key={c.id}>
                    <td className="codigo">{c.simbolo}</td><td>{c.nombre}</td>
                    <td>{editar ? (
                      <select aria-label={`Distribución de ${c.simbolo}`} value={c.distribucion} style={{ width: "auto" }}
                        onChange={(e) => guardar(() => pedir(`/metrologia/componentes/${c.id}`, { method: "PUT", body: JSON.stringify({ distribucion: e.target.value }) }), "Distribución actualizada")}>
                        {(cfg.distribuciones ?? []).map((d: any) => <option key={d.codigo} value={d.codigo}>{d.codigo}</option>)}
                      </select>
                    ) : c.distribucion}</td>
                    <td className="num">{fmtN(divisores[c.distribucion], 4)}</td>
                    <td style={{ color: "var(--muted)" }}>{c.fuente}</td>
                  </tr>
                ))}
                {comps.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--muted)", padding: 14 }}>Esta magnitud se calcula con su motor validado.</td></tr>}
              </tbody>
            </table>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
            <div className="card card--table">
              <h3 style={{ ...H3, padding: "12px 16px 8px" }}>Distribuciones · divisores</h3>
              <table className="data">
                <thead><tr><th>Distribución</th><th className="num">Divisor</th><th>Uso</th></tr></thead>
                <tbody>{(cfg.distribuciones ?? []).map((d: any) => (
                  <tr key={d.codigo}><td className="codigo">{d.codigo}</td><td className="num">{fmtN(d.divisor, 4)}</td><td style={{ color: "var(--muted)" }}>{d.uso}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <div className="card card--table">
              <h3 style={{ ...H3, padding: "12px 16px 8px" }}>Tolerancias OIML R 111 (mg)</h3>
              <table className="data">
                <thead><tr><th>Nominal</th><th>Clase</th><th className="num">EMP (mg)</th></tr></thead>
                <tbody>{(cfg.oiml ?? []).map((o: any, i: number) => (
                  <tr key={i}><td>{o.nominal}</td><td className="codigo">{o.clase}</td><td className="num">{fmtN(o.mpe_mg, 3)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Numeración de certificados por laboratorio (EP-04 §6): prefijo, formato y
 * correlativo continuo o anual (LCPNF-NNN.AA). El último número real lo fija el
 * IDIC antes de la puesta en marcha; no puede quedar por debajo de lo ya emitido.
 */
function Numeracion({ filas, editar, guardar }: { filas: any[]; editar: boolean; guardar: (prefijo: string, cuerpo: any) => void }) {
  const [ed, setEd] = useState<any>(null);
  return (
    <div className="card card--table" style={{ maxWidth: 900 }}>
      <div style={{ padding: "12px 16px" }}>
        <h3 style={H3}>Numeración de certificados por laboratorio y magnitud</h3>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 0" }}>
          Al emitir, el certificado toma el número siguiente de su prefijo. Formato: {"{P}"} prefijo · {"{N}"} correlativo · {"{AA}"} año en dos cifras.
          Los correlativos anuales vuelven a 1 cada año. Antes de la puesta en marcha, fije el último número emitido fuera del LIMS.
        </p>
      </div>
      <table className="data">
        <thead><tr><th>Prefijo</th><th>Procesos</th><th>Formato</th><th>Correlativo</th><th className="num">Último emitido</th><th>Próximo</th>{editar && <th></th>}</tr></thead>
        <tbody>
          {filas.map((n) => ed?.prefijo === n.prefijo ? (
            <tr key={n.prefijo}>
              <td className="codigo">{n.prefijo}</td>
              <td>{(n.procesos ?? []).join(", ") || "—"}</td>
              <td><input aria-label="Formato" value={ed.formato} onChange={(e) => setEd({ ...ed, formato: e.target.value })} style={{ width: 130 }} />
                <input aria-label="Ceros a la izquierda" type="number" min={0} max={8} value={ed.relleno} onChange={(e) => setEd({ ...ed, relleno: e.target.value })} style={{ width: 52, marginLeft: 4 }} title="Ceros a la izquierda" /></td>
              <td><label style={{ fontSize: 12 }}><input type="checkbox" checked={ed.anual} onChange={(e) => setEd({ ...ed, anual: e.target.checked })} /> Anual</label></td>
              <td className="num"><input aria-label="Último emitido" type="number" min={0} value={ed.ultimo} onChange={(e) => setEd({ ...ed, ultimo: e.target.value })} style={{ width: 90 }} /></td>
              <td>—</td>
              <td style={{ whiteSpace: "nowrap" }}>
                <button className="btn primary sm" onClick={() => { guardar(n.prefijo, { ultimo: Number(ed.ultimo), formato: ed.formato.trim(), relleno: Number(ed.relleno), anual: ed.anual }); setEd(null); }}>Guardar</button>{" "}
                <button className="btn sm" onClick={() => setEd(null)}>Cancelar</button>
              </td>
            </tr>
          ) : (
            <tr key={n.prefijo}>
              <td className="codigo">{n.prefijo}</td>
              <td>{(n.procesos ?? []).join(", ") || <span style={{ color: "var(--muted)" }}>Sin proceso</span>}</td>
              <td className="codigo">{n.formato}{n.relleno ? ` · ${n.relleno} cifras` : ""}</td>
              <td>{n.anual ? `Anual${n.anio ? ` (${n.anio})` : ""}` : "Continuo"}</td>
              <td className="num">{n.ultimo}</td>
              <td className="codigo">{n.proximo}</td>
              {editar && <td><button className="btn sm" onClick={() => setEd({ prefijo: n.prefijo, formato: n.formato, relleno: n.relleno, anual: !!n.anual, ultimo: n.ultimo })}>Editar</button></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
