"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Modal from "@/components/documentos/Modal";
import { llamar, qs } from "@/lib/laboratorio";
import { usePermisos } from "@/lib/permisos";
import { fechaHora } from "@/lib/format";
import { ahoraInputChile } from "@/lib/fecha-chile";
import { toast, confirmar } from "@/components/ui/feedback";

interface Hito {
  clase: "interaccion" | "oportunidad" | "cotizacion" | "ot" | "correo" | "documento";
  id: string;
  fecha: string;
  titulo: string;
  detalle: string | null;
  subtipo: string | null;
  responsable: string | null;
  ruta: string | null;
}

const CLASES: { k: Hito["clase"]; label: string; icono: string }[] = [
  { k: "interaccion", label: "Interacciones", icono: "💬" },
  { k: "oportunidad", label: "Oportunidades", icono: "🎯" },
  { k: "cotizacion", label: "Cotizaciones", icono: "🧾" },
  { k: "ot", label: "OT", icono: "🧪" },
  { k: "correo", label: "Correos", icono: "📧" },
  { k: "documento", label: "Documentos", icono: "📄" },
];
const ICONO_INTERACCION: Record<string, string> = { llamada: "📞", reunion: "👥", correo: "✉", visita: "🚗", nota: "📝" };

const VACIA = { tipo: "llamada", fecha: "", asunto: "", detalle: "", contacto: "", proximaAccion: "", proximaFecha: "" };

/** Interacción tal como la devuelve GET /clientes/:id/interacciones (para corregirla). */
interface Interaccion {
  id: string;
  tipo: string;
  fecha: string;
  asunto: string;
  detalle: string | null;
  contacto: string | null;
  responsableId: string | null;
  oportunidadId: string | null;
  otId: string | null;
  cotizacionId: string | null;
  proximaAccion: string | null;
  proximaFecha: string | null;
  creadoPor: string | null;
}

/**
 * Historial del cliente (contrato §4.1.2): línea de tiempo con las
 * interacciones registradas (llamadas, reuniones, correos, visitas, notas) y
 * lo que el LIMS ya sabe del cliente (oportunidades, cotizaciones, OT, correos
 * y documentos), cada cosa según los permisos y el alcance del usuario.
 * Con `cliente.interaccion` se registran interacciones y se corrigen o
 * eliminan las propias (o todas con `cliente.editar`, como exige la API). Una
 * «Próxima acción» con fecha avisa al responsable en Mi bandeja ese día.
 */
export default function HistorialCliente({ cliente, onCerrar }: { cliente: { id: string; razonSocial: string }; onCerrar: () => void }) {
  const { puede, usuario } = usePermisos();
  const registrar = puede("cliente.interaccion");
  const [hitos, setHitos] = useState<Hito[] | null>(null);
  const [conteo, setConteo] = useState<Record<string, number>>({});
  const [filtro, setFiltro] = useState<Set<string>>(new Set());
  // form.id presente = se está corrigiendo esa interacción.
  const [form, setForm] = useState<(typeof VACIA & { id?: string }) | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [interacciones, setInteracciones] = useState<Map<string, Interaccion>>(new Map());

  const cargar = useCallback(async () => {
    try {
      const r = await llamar<{ data: Hito[]; conteo: Record<string, number> }>("GET", `/clientes/${cliente.id}/historial${qs({ clases: [...filtro].join(",") })}`);
      setHitos(r.data);
      if (!filtro.size) setConteo(r.conteo);
      // Datos completos de las interacciones, para corregirlas desde la línea de tiempo.
      if (registrar) {
        const l = await llamar<Interaccion[]>("GET", `/clientes/${cliente.id}/interacciones`).catch(() => [] as Interaccion[]);
        setInteracciones(new Map(l.map((i) => [i.id, i])));
      }
    } catch (e: any) {
      toast.error(e.message);
      setHitos([]);
    }
  }, [cliente.id, filtro, registrar]);
  useEffect(() => void cargar(), [cargar]);

  /** La API deja corregir o eliminar a quien la registró o a quien edita clientes. */
  const editable = (i: Interaccion | undefined): i is Interaccion =>
    !!i && registrar && (i.creadoPor === usuario.id || puede("cliente.editar"));

  const editar = (i: Interaccion) =>
    setForm({
      id: i.id,
      tipo: i.tipo,
      fecha: ahoraInputChile(new Date(i.fecha)),
      asunto: i.asunto,
      detalle: i.detalle ?? "",
      contacto: i.contacto ?? "",
      proximaAccion: i.proximaAccion ?? "",
      proximaFecha: i.proximaFecha ? i.proximaFecha.slice(0, 10) : "",
    });

  const eliminar = async (i: Interaccion) => {
    const ok = await confirmar({
      titulo: "¿Eliminar la interacción?",
      mensaje: `«${i.asunto}» dejará de aparecer en el historial del cliente (y su próxima acción ya no se avisará).`,
      peligro: true,
    });
    if (!ok) return;
    try {
      await llamar("DELETE", `/clientes/${cliente.id}/interacciones/${i.id}`);
      toast.ok("Interacción eliminada del historial.");
      if (form?.id === i.id) setForm(null);
      await cargar();
    } catch (x: any) {
      toast.error(x.message);
    }
  };

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setOcupado(true);
    try {
      const { id, ...datos } = form;
      if (id) {
        // La corrección conserva los vínculos que la ventana no muestra (OT, cotización, oportunidad, responsable).
        const o = interacciones.get(id);
        await llamar("PATCH", `/clientes/${cliente.id}/interacciones/${id}`, {
          ...datos,
          responsableId: o?.responsableId ?? null,
          oportunidadId: o?.oportunidadId ?? null,
          otId: o?.otId ?? null,
          cotizacionId: o?.cotizacionId ?? null,
        });
        toast.ok("Interacción corregida.");
      } else {
        await llamar("POST", `/clientes/${cliente.id}/interacciones`, datos);
        toast.ok("Interacción registrada en el historial del cliente.");
      }
      setForm(null);
      await cargar();
    } catch (x: any) {
      toast.error(x.message);
    } finally {
      setOcupado(false);
    }
  };

  const alternar = (k: string) => {
    const n = new Set(filtro);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    setFiltro(n);
  };

  return (
    <Modal titulo={`Historial · ${cliente.razonSocial}`} onCerrar={onCerrar} ancho={860}
      acciones={
        <>
          {registrar && !form && <button type="button" className="btn primary" onClick={() => setForm({ ...VACIA, fecha: ahoraInputChile() })}>＋ Registrar interacción</button>}
          <button type="button" className="btn outline" onClick={onCerrar}>Cerrar</button>
        </>
      }>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {CLASES.map((c) => (
          <button key={c.k} type="button" className={`btn sm ${filtro.has(c.k) ? "primary" : "outline"}`} aria-pressed={filtro.has(c.k)} onClick={() => alternar(c.k)}>
            {c.icono} {c.label}{conteo[c.k] ? ` · ${conteo[c.k]}` : ""}
          </button>
        ))}
        {filtro.size > 0 && <button type="button" className="btn outline sm" onClick={() => setFiltro(new Set())}>Ver todo</button>}
      </div>

      {form && (
        <form className="card" onSubmit={guardar} style={{ marginBottom: 12 }}>
          {form.id && <h3 style={{ margin: "0 0 8px" }}>Corregir interacción</h3>}
          <div className="form-grid">
            <div className="field">
              <label htmlFor="hi-tipo">Tipo</label>
              <select id="hi-tipo" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
                <option value="llamada">Llamada</option><option value="reunion">Reunión</option><option value="correo">Correo</option>
                <option value="visita">Visita</option><option value="nota">Nota</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="hi-fecha">Fecha y hora</label>
              <input id="hi-fecha" type="datetime-local" required value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="hi-contacto">Contacto del cliente</label>
              <input id="hi-contacto" maxLength={160} value={form.contacto} onChange={(e) => setForm({ ...form, contacto: e.target.value })} />
            </div>
            <div className="field span-2">
              <label htmlFor="hi-asunto">Asunto <span aria-hidden style={{ color: "var(--red)" }}>*</span></label>
              <input id="hi-asunto" required minLength={3} maxLength={200} value={form.asunto} onChange={(e) => setForm({ ...form, asunto: e.target.value })} />
            </div>
            <div className="field span-2" style={{ gridColumn: "1 / -1" }}>
              <label htmlFor="hi-detalle">Detalle</label>
              <textarea id="hi-detalle" rows={3} value={form.detalle} onChange={(e) => setForm({ ...form, detalle: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="hi-pa">Próxima acción</label>
              <input id="hi-pa" maxLength={200} value={form.proximaAccion} onChange={(e) => setForm({ ...form, proximaAccion: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="hi-pf">Fecha de la próxima acción</label>
              <input id="hi-pf" type="date" value={form.proximaFecha} onChange={(e) => setForm({ ...form, proximaFecha: e.target.value })} />
              <small style={{ color: "var(--muted)", fontSize: 11 }}>Ese día el responsable recibe un aviso en Mi bandeja.</small>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
            <button type="button" className="btn outline sm" onClick={() => setForm(null)}>Cancelar</button>
            <button className="btn primary sm" disabled={ocupado}>{ocupado ? "Guardando…" : form.id ? "Guardar cambios" : "Registrar"}</button>
          </div>
        </form>
      )}

      {hitos === null ? (
        <p>Cargando…</p>
      ) : !hitos.length ? (
        <p style={{ color: "var(--muted)" }}>Sin actividad registrada con este cliente{filtro.size ? " en los tipos elegidos" : ""}.</p>
      ) : (
        <ol style={{ listStyle: "none", margin: 0, padding: 0, borderLeft: "2px solid var(--line)" }}>
          {hitos.map((h) => (
            <li key={`${h.clase}:${h.id}`} style={{ position: "relative", padding: "6px 0 10px 18px" }}>
              <span aria-hidden style={{ position: "absolute", left: -11, top: 6, background: "var(--panel)" }}>
                {h.clase === "interaccion" ? ICONO_INTERACCION[h.subtipo ?? ""] ?? "💬" : CLASES.find((c) => c.k === h.clase)?.icono}
              </span>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>
                {fechaHora(h.fecha)}{h.responsable ? ` · ${h.responsable}` : ""}
              </div>
              <div style={{ fontWeight: 600 }}>
                {h.ruta ? <Link href={h.ruta as any}>{h.titulo}</Link> : h.titulo}
              </div>
              {h.detalle && <div style={{ whiteSpace: "pre-wrap" }}>{h.detalle}</div>}
              {h.clase === "interaccion" && editable(interacciones.get(h.id)) && (
                <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                  <button type="button" className="btn outline sm" onClick={() => editar(interacciones.get(h.id)!)}>✏ Editar</button>
                  <button type="button" className="btn ghost-danger sm" onClick={() => eliminar(interacciones.get(h.id)!)}>🗑 Eliminar</button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}
