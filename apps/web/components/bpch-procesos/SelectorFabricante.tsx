"use client";

/**
 * SelectorFabricante · busca el fabricante (cliente) por RUT o razón social y,
 * si no existe, lo registra (POST {rutaAlta}). El RUT se valida en el servidor
 * (módulo 11) y un RUT ya registrado se rechaza indicando a quién pertenece.
 */
import { useEffect, useId, useState } from "react";
import { llamar } from "@/lib/laboratorio";
import { rut as fmtRut } from "@/lib/format";
import { toast } from "@/components/ui/feedback";
import Modal from "@/components/documentos/Modal";

export interface Fabricante {
  id: string;
  rut: string;
  razonSocial: string;
}

export default function SelectorFabricante({
  valor,
  onCambio,
  rutaAlta,
  puedeCrear,
  etiqueta = "Fabricante",
  requerido = true,
}: {
  valor: Fabricante | null;
  onCambio: (f: Fabricante | null) => void;
  /** endpoint de alta: /bpch/pn/fabricantes o /bpch/prototipos/fabricantes */
  rutaAlta: string;
  puedeCrear: boolean;
  etiqueta?: string;
  requerido?: boolean;
}) {
  const id = useId();
  const [q, setQ] = useState("");
  const [opciones, setOpciones] = useState<(Fabricante & { rafsVigentes?: number })[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [alta, setAlta] = useState(false);

  useEffect(() => {
    if (valor) return;
    const t = setTimeout(() => {
      setBuscando(true);
      llamar<{ data: Fabricante[] }>("GET", `/bpch/pn/fabricantes${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`)
        .then((r) => setOpciones(r.data))
        .catch(() => setOpciones([]))
        .finally(() => setBuscando(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q, valor]);

  if (valor)
    return (
      <div className="field">
        <label>{etiqueta}{requerido && <span className="req"> *</span>}</label>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input value={`${valor.razonSocial} · ${fmtRut(valor.rut)}`} readOnly style={{ flex: 1, background: "#eef3f7" }} aria-label={etiqueta} />
          <button type="button" className="btn outline sm" onClick={() => onCambio(null)}>Cambiar</button>
        </div>
      </div>
    );

  return (
    <div className="field">
      <label htmlFor={id}>{etiqueta}{requerido && <span className="req"> *</span>}</label>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          id={id}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por RUT o razón social"
          autoComplete="off"
          style={{ flex: 1 }}
        />
        {puedeCrear && (
          <button type="button" className="btn outline sm" onClick={() => setAlta(true)}>＋ Nuevo</button>
        )}
      </div>
      <div role="listbox" aria-label="Fabricantes encontrados" style={{ border: "1px solid var(--line)", borderRadius: 5, marginTop: 4, maxHeight: 180, overflowY: "auto", background: "#fff" }}>
        {buscando && <div style={{ padding: 8, fontSize: 12, color: "var(--muted)" }}>Buscando…</div>}
        {!buscando && opciones.length === 0 && (
          <div style={{ padding: 8, fontSize: 12, color: "var(--muted)" }}>
            {q.trim() ? "Sin coincidencias." : "Aún no hay fabricantes con RAF: escriba un RUT o razón social para buscar clientes."}
            {puedeCrear ? " Puede registrarlo con «＋ Nuevo»." : " Si no existe, pida a la jefatura que lo registre."}
          </div>
        )}
        {!buscando &&
          opciones.map((o) => (
            <button
              type="button"
              role="option"
              aria-selected={false}
              key={o.id}
              onClick={() => onCambio({ id: o.id, rut: o.rut, razonSocial: o.razonSocial })}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 9px", border: "none", borderBottom: "1px solid var(--line)", background: "none", cursor: "pointer", fontSize: 12.5 }}
            >
              <b>{o.razonSocial}</b> <span style={{ color: "var(--muted)" }}>· {fmtRut(o.rut)}</span>
              {o.rafsVigentes ? <span className="pill teal" style={{ marginLeft: 6 }}>{o.rafsVigentes} RAF vigente{o.rafsVigentes === 1 ? "" : "s"}</span> : null}
            </button>
          ))}
      </div>
      {alta && (
        <AltaFabricante
          ruta={rutaAlta}
          rutInicial={/\d/.test(q) ? q.trim() : ""}
          onCerrar={() => setAlta(false)}
          onCreado={(f) => {
            setAlta(false);
            onCambio(f);
          }}
        />
      )}
    </div>
  );
}

function AltaFabricante({
  ruta,
  rutInicial,
  onCerrar,
  onCreado,
}: {
  ruta: string;
  rutInicial: string;
  onCerrar: () => void;
  onCreado: (f: Fabricante) => void;
}) {
  const [tipos, setTipos] = useState<{ codigo: string; etiqueta: string }[]>([]);
  const [f, setF] = useState({ rut: rutInicial, razonSocial: "", tipo: "", giro: "", direccion: "", ciudad: "", region: "", telefono: "", email: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  useEffect(() => {
    llamar<{ tiposCliente: { codigo: string; etiqueta: string }[] }>("GET", "/bpch/pn/config")
      .then((c) => setTipos(c.tiposCliente))
      .catch(() => setTipos([]));
  }, []);

  async function guardar() {
    setError("");
    if (!f.rut.trim() || !f.razonSocial.trim() || !f.tipo) {
      setError("Complete RUT, razón social y tipo de cliente.");
      return;
    }
    setBusy(true);
    try {
      const c = await llamar<Fabricante>("POST", ruta, f);
      toast.ok(`Fabricante registrado: ${c.razonSocial}`);
      onCreado(c);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      titulo="Registrar fabricante"
      onCerrar={onCerrar}
      ancho={620}
      acciones={
        <>
          <button type="button" className="btn outline sm" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="btn primary sm" disabled={busy} onClick={guardar}>{busy ? "Guardando…" : "Registrar"}</button>
        </>
      }
    >
      <p style={{ marginTop: 0, color: "var(--muted)" }}>Se registra como cliente del IDIC; Comercial lo verá en su maestro de clientes.</p>
      {error && <div className="alert warn" role="alert">{error}</div>}
      <div className="form-grid cols-2">
        <div className="field"><label htmlFor="fab-rut">RUT <span className="req">*</span></label><input id="fab-rut" value={f.rut} onChange={set("rut")} placeholder="76.123.456-7" /></div>
        <div className="field">
          <label htmlFor="fab-tipo">Tipo de cliente <span className="req">*</span></label>
          <select id="fab-tipo" value={f.tipo} onChange={set("tipo")}>
            <option value="">— Seleccione —</option>
            {tipos.map((t) => <option key={t.codigo} value={t.codigo}>{t.etiqueta}</option>)}
          </select>
        </div>
        <div className="field span-2"><label htmlFor="fab-rs">Razón social <span className="req">*</span></label><input id="fab-rs" value={f.razonSocial} onChange={set("razonSocial")} maxLength={200} /></div>
        <div className="field"><label htmlFor="fab-giro">Giro</label><input id="fab-giro" value={f.giro} onChange={set("giro")} maxLength={200} /></div>
        <div className="field"><label htmlFor="fab-dir">Dirección</label><input id="fab-dir" value={f.direccion} onChange={set("direccion")} /></div>
        <div className="field"><label htmlFor="fab-ciu">Ciudad</label><input id="fab-ciu" value={f.ciudad} onChange={set("ciudad")} maxLength={80} /></div>
        <div className="field"><label htmlFor="fab-reg">Región</label><input id="fab-reg" value={f.region} onChange={set("region")} maxLength={80} /></div>
        <div className="field"><label htmlFor="fab-tel">Teléfono</label><input id="fab-tel" value={f.telefono} onChange={set("telefono")} maxLength={40} /></div>
        <div className="field"><label htmlFor="fab-mail">Correo</label><input id="fab-mail" type="email" value={f.email} onChange={set("email")} /></div>
      </div>
    </Modal>
  );
}
