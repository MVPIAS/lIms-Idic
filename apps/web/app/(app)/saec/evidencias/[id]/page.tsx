"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const auth = () => ({
  Authorization: `Bearer ${localStorage.getItem("lims_token")}`,
  "Content-Type": "application/json",
});

// RF-K05.1 · eventos de la cadena de custodia.
const EVENTOS: { key: string; label: string; pill: string }[] = [
  { key: "entrada", label: "Entrada", pill: "green" },
  { key: "salida", label: "Salida", pill: "amber" },
  { key: "cambio_ubicacion", label: "Cambio de ubicación", pill: "blue" },
  { key: "prestamo", label: "Préstamo", pill: "red" },
  { key: "devolucion", label: "Devolución", pill: "green" },
  { key: "analisis", label: "Análisis", pill: "teal" },
  { key: "destruccion", label: "Destrucción", pill: "gray" },
];
const EV_META = Object.fromEntries(EVENTOS.map((e) => [e.key, e]));

const fechaHora = (v: any) =>
  v ? new Date(v).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" }) : "—";

const MOV_VACIO = {
  evento: "cambio_ubicacion",
  haciaOrganismo: "",
  ubicacionDestino: "",
  motivo: "",
  selloNumero: "",
  firmaNombre: "",
  firmaTexto: "",
  observaciones: "",
};

export default function EvidenciaFichaPage() {
  const params = useParams();
  const id = String(params?.id ?? "");

  const [e, setE] = useState<any>(null);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [loading, setLoading] = useState(true);
  const [showMov, setShowMov] = useState(false);
  const [m, setM] = useState<any>({ ...MOV_VACIO });

  async function cargar() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/evidencias/${id}`, { headers: auth() });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `Error ${res.status}`);
      setE(await res.json());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { if (id) cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  /** RF-K05.1 · registrar un traspaso de custodia. */
  async function registrarMovimiento(ev: React.FormEvent) {
    ev.preventDefault();
    setError("");
    setAviso("");
    try {
      const res = await fetch(`${API}/custodia-evidencia`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({
          evidenciaId: id,
          evento: m.evento,
          haciaOrganismo: m.haciaOrganismo || null,
          ubicacionDestino: m.ubicacionDestino || null,
          motivo: m.motivo,
          selloNumero: m.selloNumero || null,
          firmaNombre: m.firmaNombre || null,
          firmaTexto: m.firmaTexto || null,
          observaciones: m.observaciones || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `Error ${res.status}`);
      setShowMov(false);
      setM({ ...MOV_VACIO });
      setAviso("Movimiento registrado en la cadena de custodia.");
      cargar();
    } catch (err: any) {
      setError(Array.isArray(err.message) ? err.message.join(", ") : err.message);
    }
  }

  /** RF-K07.1 · emisión del certificado verificable. */
  async function emitirCertificado() {
    setError("");
    setAviso("");
    try {
      const res = await fetch(`${API}/evidencias/${id}/certificado`, { method: "POST", headers: auth() });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `Error ${res.status}`);
      const c = await res.json();
      setAviso(`Certificado ${c.codigo} emitido. Código de verificación: ${c.codigo_verificacion}`);
      cargar();
    } catch (err: any) {
      setError(Array.isArray(err.message) ? err.message.join(", ") : err.message);
    }
  }

  /**
   * RF-K07.1 · descarga del certificado en PDF/A.
   *
   * No se puede usar un <a href> normal: el endpoint exige el Bearer y un enlace
   * no lo manda. Se descarga con fetch y se abre el blob en una pestaña, que
   * además evita meter el token en la URL (quedaría en el historial y en los
   * logs del proxy).
   */
  async function descargarCertificado(certId: string, codigo: string) {
    setError("");
    let url: string | null = null;
    try {
      const res = await fetch(`${API}/saec/certificados/${certId}/pdf`, { headers: auth() });
      if (!res.ok) {
        const msg = (await res.json().catch(() => ({}))).message ?? `Error ${res.status}`;
        throw new Error(Array.isArray(msg) ? msg.join(", ") : msg);
      }
      const blob = await res.blob();
      url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${codigo}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err: any) {
      setError(Array.isArray(err.message) ? err.message.join(", ") : err.message);
    } finally {
      // Sin revoke, el blob se queda en memoria hasta recargar la página.
      if (url) setTimeout(() => URL.revokeObjectURL(url!), 10_000);
    }
  }

  if (loading) return <div className="card" style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>Cargando…</div>;
  if (!e) return <div className="alert warn">{error || "Evidencia no encontrada"}</div>;

  return (
    <div>
      <h1 className="page">
        <span className="codigo">{e.codigo}</span> · Ficha de evidencia
      </h1>
      <p className="subtitle">
        Historial completo del elemento: datos, cadena de custodia inmutable, peritajes, coincidencias IBIS, préstamos y
        auditoría (RF-K09.1).
      </p>
      {error && <div className="alert warn">{error}</div>}
      {aviso && <div className="alert success">{aviso}</div>}

      <div className="toolbar" style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <Link className="btn sm" href="/saec">← Evidencias</Link>
        <div className="spacer" style={{ flex: 1 }}></div>
        <button className="btn sm" onClick={emitirCertificado}>Emitir certificado</button>
        <button className="btn primary sm" onClick={() => setShowMov(!showMov)}>
          {showMov ? "Cerrar" : "＋ Registrar movimiento de custodia"}
        </button>
      </div>

      {/* --- Datos del elemento --- */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="form-grid">
          <Dato lab="Tipo" val={e.tipo} />
          <Dato lab="Estado" val={e.estado} />
          <Dato lab="Caso" val={e.caso?.numero_caso} />
          <Dato lab="Nº evidencia (ESI)" val={e.exhibit_number} />
          <Dato lab="Categoría" val={e.categoria_texto} />
          <Dato lab="Calibre" val={e.calibre_texto} />
          <Dato lab="Forma del percutor" val={e.firing_pin_shape} />
          <Dato lab="Cara de recámara" val={e.breech_face_class} />
          <Dato lab="Marca" val={e.marca} />
          <Dato lab="Composición" val={e.composicion} />
          <Dato lab="Código de barras" val={e.codigo_barras} />
          <Dato lab="Ubicación actual" val={e.ubicacion} />
          <Dato lab="Procedencia" val={e.procedencia} />
          <Dato lab="Organismo solicitante" val={e.organismo_solicitante} />
          <Dato lab="UUID IBIS" val={e.uuid_ibis} />
          <Dato lab="OT" val={e.ot?.codigo} />
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label>Descripción</label>
            <div>{e.descripcion ?? "—"}</div>
          </div>
        </div>
      </div>

      {/* --- Ficha registral del arma, si aplica --- */}
      {e.arma && (
        <div className="card" style={{ marginBottom: 12 }}>
          <h3 style={{ marginTop: 0 }}>Ficha registral del arma</h3>
          <div className="form-grid">
            <Dato lab="Serie" val={e.arma.serie_borrada ? "(limada)" : e.arma.serie} />
            <Dato lab="Tipo" val={e.arma.tipo} />
            <Dato lab="Marca / modelo" val={[e.arma.marca, e.arma.modelo].filter(Boolean).join(" ")} />
            <Dato lab="Estado registral" val={e.arma.estado_registral} />
            <Dato lab="Inscripción DGMN" val={e.arma.inscripcion_dgmn} />
            <Dato lab="Propietario" val={e.arma.propietario_registrado} />
          </div>
        </div>
      )}

      {/* --- RF-K05 · cadena de custodia --- */}
      {showMov && (
        <form onSubmit={registrarMovimiento} className="card" style={{ marginBottom: 12 }}>
          <h3 style={{ marginTop: 0 }}>Registrar traspaso de custodia</h3>
          <div className="form-grid">
            <div className="field">
              <label>Evento <span className="req">*</span></label>
              <select required value={m.evento} onChange={(ev) => setM({ ...m, evento: ev.target.value })}>
                {EVENTOS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Ubicación destino</label>
              <input
                placeholder="Bodega A · Estante 3 (vacío = sin cambio)"
                value={m.ubicacionDestino}
                onChange={(ev) => setM({ ...m, ubicacionDestino: ev.target.value })}
              />
            </div>
            <div className="field">
              <label>Organismo destino</label>
              <input placeholder="Fiscalía, PDI, bodega…" value={m.haciaOrganismo} onChange={(ev) => setM({ ...m, haciaOrganismo: ev.target.value })} />
            </div>
            <div className="field"><label>Nº de sello</label><input value={m.selloNumero} onChange={(ev) => setM({ ...m, selloNumero: ev.target.value })} /></div>
            <div className="field"><label>Firma (nombre)</label><input placeholder="Quien recibe/entrega" value={m.firmaNombre} onChange={(ev) => setM({ ...m, firmaNombre: ev.target.value })} /></div>
            <div className="field">
              <label>Texto del acta (se guarda su HASH)</label>
              <input value={m.firmaTexto} onChange={(ev) => setM({ ...m, firmaTexto: ev.target.value })} />
            </div>
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label>Motivo <span className="req">*</span></label>
              <textarea required rows={2} value={m.motivo} onChange={(ev) => setM({ ...m, motivo: ev.target.value })} />
            </div>
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label>Observaciones</label>
              <textarea rows={2} value={m.observaciones} onChange={(ev) => setM({ ...m, observaciones: ev.target.value })} />
            </div>
          </div>
          <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
            <button className="btn primary sm">Registrar movimiento</button>
          </div>
        </form>
      )}

      <div className="card card--table" style={{ marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>Cadena de custodia · trazabilidad</h3>
        <p style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 0 }}>
          Registro inmutable y de solo lectura (RF-K05.2): los movimientos no se editan ni se borran.
        </p>
        <table className="data">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Evento</th>
              <th>Desde</th>
              <th>Hacia</th>
              <th>Ubicación</th>
              <th>Motivo</th>
              <th>Sello</th>
              <th>Firma</th>
            </tr>
          </thead>
          <tbody>
            {(e.movimientos ?? []).map((mv: any) => (
              <tr key={mv.id}>
                <td style={{ whiteSpace: "nowrap" }}>{fechaHora(mv.fecha)}</td>
                <td><span className={`pill ${EV_META[mv.evento]?.pill ?? "gray"}`}>{EV_META[mv.evento]?.label ?? mv.evento}</span></td>
                <td>{mv.desde_usuario ?? mv.desde_organismo ?? "—"}</td>
                <td>{mv.hacia_usuario ?? mv.hacia_organismo ?? "—"}</td>
                <td>{mv.ubicacion_origen ?? "—"} → {mv.ubicacion_destino ?? "—"}</td>
                <td style={{ maxWidth: 260 }}>{mv.motivo}</td>
                <td>{mv.sello_numero ?? "—"}{mv.sello_integro === false ? " ⚠" : ""}</td>
                <td title={mv.firma_hash ?? ""}>{mv.firma_nombre ?? "—"}</td>
              </tr>
            ))}
            {(e.movimientos ?? []).length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--muted)", padding: 14 }}>Sin movimientos.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* --- RF-K03.3 · peritajes --- */}
      <div className="card card--table" style={{ marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>Peritajes</h3>
        <table className="data">
          <thead>
            <tr><th>Origen</th><th>Resultado</th><th className="num">Hits</th><th>Conclusiones</th><th>Perito</th><th>Fecha</th></tr>
          </thead>
          <tbody>
            {(e.peritajes ?? []).map((p: any) => (
              <tr key={p.id}>
                <td><span className={`pill ${p.origen === "ibis" ? "blue" : "gray"}`}>{p.origen}</span></td>
                <td>{p.resultado ?? "—"}</td>
                <td className="num">{p.hit_count ?? 0}</td>
                <td style={{ maxWidth: 300 }}>{p.conclusiones ?? "—"}</td>
                <td>{p.perito_nombre ?? "—"}</td>
                <td>{fechaHora(p.fecha_peritaje)}</td>
              </tr>
            ))}
            {(e.peritajes ?? []).length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: 14 }}>Sin peritajes registrados.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* --- RF-K03.2 · coincidencias IBIS --- */}
      <div className="card card--table" style={{ marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>Coincidencias balísticas (IBIS)</h3>
        <table className="data">
          <thead>
            <tr><th>Evidencia A</th><th>Evidencia B</th><th className="num">Score</th><th>Estado</th><th>Fecha</th></tr>
          </thead>
          <tbody>
            {(e.hits ?? []).map((h: any) => (
              <tr key={h.id}>
                <td className="codigo">{h.evidencia_a_codigo ?? h.uuid_evidencia_a ?? "—"}</td>
                <td className="codigo">{h.evidencia_b_codigo ?? h.uuid_evidencia_b ?? "—"}</td>
                <td className="num">{h.score ?? "—"}</td>
                <td><span className={`pill ${h.estado === "confirmado" ? "green" : h.estado === "descartado" ? "gray" : "amber"}`}>{h.estado}</span></td>
                <td>{fechaHora(h.fecha_hit)}</td>
              </tr>
            ))}
            {(e.hits ?? []).length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--muted)", padding: 14 }}>Sin coincidencias.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* --- RF-K06 · préstamos --- */}
      <div className="card card--table" style={{ marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>Préstamos / devoluciones</h3>
        <table className="data">
          <thead>
            <tr><th>Código</th><th>Tipo</th><th>Organismo</th><th>Solicitante</th><th>Estado</th><th>Solicitud</th></tr>
          </thead>
          <tbody>
            {(e.prestamos ?? []).map((p: any) => (
              <tr key={p.id}>
                <td className="codigo">{p.codigo}</td>
                <td>{p.tipo}</td>
                <td>{p.organismo_solicitante}</td>
                <td>{p.solicitante_nombre}</td>
                <td><span className={`pill ${p.estado === "rechazado" ? "red" : p.estado === "devuelto" ? "green" : "amber"}`}>{p.estado}</span></td>
                <td>{fechaHora(p.fecha_solicitud)}</td>
              </tr>
            ))}
            {(e.prestamos ?? []).length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: 14 }}>Sin solicitudes.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* --- RF-K07 · certificados --- */}
      <div className="card card--table" style={{ marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>Certificados emitidos</h3>
        <table className="data">
          <thead>
            <tr><th>Código</th><th>Cód. verificación</th><th>HASH (SHA-256)</th><th>Estado</th><th>Emitido</th><th></th></tr>
          </thead>
          <tbody>
            {(e.certificados ?? []).map((c: any) => (
              <tr key={c.id}>
                <td className="codigo">{c.codigo}</td>
                <td className="codigo">{c.codigo_verificacion}</td>
                <td style={{ fontSize: 10.5, wordBreak: "break-all", maxWidth: 260 }}>{c.hash_documento}</td>
                <td><span className={`pill ${c.estado === "emitido" ? "green" : "red"}`}>{c.estado}</span></td>
                <td>{fechaHora(c.emitido_at)}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button className="btn sm" onClick={() => descargarCertificado(c.id, c.codigo)}>
                    Descargar PDF/A
                  </button>
                </td>
              </tr>
            ))}
            {(e.certificados ?? []).length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: 14 }}>Sin certificados.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* --- RF-K09.2 · auditoría --- */}
      <div className="card card--table">
        <h3 style={{ marginTop: 0 }}>Auditoría (usuario · fecha/hora · IP)</h3>
        <table className="data">
          <thead>
            <tr><th>Fecha</th><th>Acción</th><th>Usuario</th><th>IP</th></tr>
          </thead>
          <tbody>
            {(e.auditoria ?? []).map((a: any, i: number) => (
              <tr key={i}>
                <td style={{ whiteSpace: "nowrap" }}>{fechaHora(a.created_at)}</td>
                <td>{a.accion}</td>
                <td>{a.usuario_nombre ?? "—"}</td>
                <td>{a.ip_origen ?? "—"}</td>
              </tr>
            ))}
            {(e.auditoria ?? []).length === 0 && (
              <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--muted)", padding: 14 }}>Sin registros de auditoría.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Dato({ lab, val }: { lab: string; val: any }) {
  return (
    <div className="field">
      <label>{lab}</label>
      <div>{val ?? "—"}</div>
    </div>
  );
}
