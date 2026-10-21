"use client";

/**
 * «¿Qué cubre el documento?» en Emitir informe (docs/FLUJO_DOCUMENTOS_POR_OT.md):
 * toda la OT, una muestra (LQC), un producto (LPN: un IE por producto) o un
 * laboratorio (Alimentos). Muestra, por muestra y por laboratorio, sus
 * resultados aprobados y los documentos que ya tiene; lo que falta cubrir para
 * cerrar la OT; y permite registrar que un documento NO se emite (con motivo).
 * API: GET /informes/ot/:otId/cobertura · POST /informes/no-emitido.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/feedback";
import Modal from "@/components/documentos/Modal";

export type TipoCobertura = "ot" | "muestra" | "producto" | "laboratorio";
export interface CoberturaElegida {
  cobertura: TipoCobertura;
  muestraIds?: string[];
  unidadId?: string | null;
}

interface DocCob { id: string; numero: string; estado: string; cobertura: string; etiqueta: string | null }
interface DatosCobertura {
  muestras: { id: string; codigo: string; nombre: string | null; elementoId: string | null; elementoNombre: string | null; resultados: number; aprobados: number; documentos: DocCob[] }[];
  laboratorios: { id: string; codigo: string; nombre: string; principal: boolean; resultados: number; aprobados: number; documentos: DocCob[] }[];
  pendientes: string[];
}

const OPCIONES: { valor: TipoCobertura; texto: string; ayuda: string }[] = [
  { valor: "ot", texto: "Toda la OT", ayuda: "Un documento con todas las muestras y resultados." },
  { valor: "muestra", texto: "Una muestra", ayuda: "Un informe por muestra (LQC, cuando la OT lo pide)." },
  { valor: "producto", texto: "Un producto", ayuda: "Un IE por producto: las muestras del mismo producto (LPN)." },
  { valor: "laboratorio", texto: "Un laboratorio", ayuda: "Los resultados de un laboratorio de la OT (Alimentos)." },
];
const ESTADO: Record<string, string> = { en_firma: "en firma", oficial: "oficial", emitido: "oficial", devuelto: "devuelto", no_emitido: "no emitido" };

/** Grupos de producto: muestras del mismo elemento del catálogo (sin producto, cada muestra sola). */
function productos(d: DatosCobertura | null) {
  const g = new Map<string, { clave: string; nombre: string; ids: string[]; codigos: string[]; aprobados: number; resultados: number; documentos: DocCob[] }>();
  for (const m of d?.muestras ?? []) {
    const clave = m.elementoId ?? `m:${m.id}`;
    const x = g.get(clave) ?? { clave, nombre: m.elementoNombre ?? `Muestra ${m.codigo} (sin producto)`, ids: [], codigos: [], aprobados: 0, resultados: 0, documentos: [] };
    x.ids.push(m.id);
    x.codigos.push(m.codigo);
    x.aprobados += m.aprobados;
    x.resultados += m.resultados;
    for (const doc of m.documentos) if (!x.documentos.some((y) => y.id === doc.id)) x.documentos.push(doc);
    g.set(clave, x);
  }
  return [...g.values()];
}

export default function CoberturaDocumento({
  otId,
  plantillaId,
  sugerida,
  valor,
  onCambio,
  version,
}: {
  otId: string;
  plantillaId: string;
  /** Cobertura que propone el laboratorio de la OT (documento_cobertura_unidad). */
  sugerida?: { cobertura: string; porConfirmar: boolean; fuente: string | null } | null;
  valor: CoberturaElegida;
  onCambio: (c: CoberturaElegida) => void;
  /** Cambia tras emitir, para recargar. */
  version: number;
}) {
  const [d, setD] = useState<DatosCobertura | null>(null);
  const [error, setError] = useState("");
  const [noEmitir, setNoEmitir] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    setError("");
    try {
      setD(await api.getRaw<DatosCobertura>(`informes/ot/${otId}/cobertura`));
    } catch (e: any) {
      setD(null);
      setError(e.message);
    }
  }, [otId]);
  useEffect(() => {
    cargar();
  }, [cargar, version]);

  const grupos = useMemo(() => productos(d), [d]);
  const tipo = valor.cobertura;
  const elegido =
    tipo === "muestra" ? valor.muestraIds?.[0] ?? ""
    : tipo === "producto" ? grupos.find((g) => g.ids.join(",") === (valor.muestraIds ?? []).join(","))?.clave ?? ""
    : tipo === "laboratorio" ? valor.unidadId ?? ""
    : "";

  function cambiarTipo(t: TipoCobertura) {
    onCambio({ cobertura: t });
  }
  function elegir(v: string) {
    if (tipo === "muestra") onCambio({ cobertura: "muestra", muestraIds: v ? [v] : [] });
    else if (tipo === "producto") onCambio({ cobertura: "producto", muestraIds: grupos.find((g) => g.clave === v)?.ids ?? [] });
    else if (tipo === "laboratorio") onCambio({ cobertura: "laboratorio", unidadId: v || null });
  }

  async function registrarNoEmitido() {
    setOcupado(true);
    try {
      const r: any = await api.post("/informes/no-emitido", { otId, plantillaId, motivo: motivo.trim(), cobertura: valor });
      toast.ok(`Número ${r.numero} reservado y registrado como no emitido.`);
      setNoEmitir(false);
      setMotivo("");
      cargar();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setOcupado(false);
    }
  }

  const docsTexto = (docs: DocCob[]) =>
    docs.length ? docs.map((x) => `${x.numero} (${ESTADO[x.estado] ?? x.estado})`).join(", ") : "—";
  const listo = tipo !== "ot" && !!elegido;

  return (
    <fieldset style={{ border: 0, padding: 0, margin: "12px 0 0" }}>
      <legend style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>¿Qué cubre el documento?</legend>
      <div role="radiogroup" aria-label="Cobertura del documento" style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
        {OPCIONES.map((o) => (
          <label key={o.valor} style={{
            display: "flex", gap: 8, alignItems: "flex-start", padding: "7px 9px", borderRadius: 7, cursor: "pointer",
            border: `1px solid ${tipo === o.valor ? "var(--accent)" : "var(--line)"}`, background: tipo === o.valor ? "#f0fafb" : "#fff",
          }}>
            <input type="radio" name="cobertura" value={o.valor} checked={tipo === o.valor} onChange={() => cambiarTipo(o.valor)} style={{ marginTop: 3 }} />
            <span>
              <b style={{ fontSize: 12.5 }}>{o.texto}</b>
              {sugerida?.cobertura === o.valor && <span className="pill teal" style={{ marginLeft: 6 }} title={sugerida.fuente ?? undefined}>{sugerida.porConfirmar ? "Sugerido · por confirmar" : "Sugerido"}</span>}
              <small style={{ display: "block", color: "var(--muted)", marginTop: 2 }}>{o.ayuda}</small>
            </span>
          </label>
        ))}
      </div>

      {error && <div className="alert warn" role="alert" style={{ marginTop: 8 }}>{error}</div>}

      {tipo !== "ot" && d && (
        <div className="field" style={{ marginTop: 10 }}>
          <label htmlFor="cob-elegir">{tipo === "muestra" ? "Muestra" : tipo === "producto" ? "Producto" : "Laboratorio"} <span className="req">*</span></label>
          <select id="cob-elegir" value={elegido} onChange={(e) => elegir(e.target.value)}>
            <option value="">— Seleccione —</option>
            {tipo === "muestra" && d.muestras.map((m) => (
              <option key={m.id} value={m.id}>{m.codigo}{m.nombre ? ` · ${m.nombre}` : ""} · {m.aprobados} de {m.resultados} aprobados · documentos: {docsTexto(m.documentos)}</option>
            ))}
            {tipo === "producto" && grupos.map((g) => (
              <option key={g.clave} value={g.clave}>{g.nombre} · {g.codigos.join(", ")} · {g.aprobados} de {g.resultados} aprobados · documentos: {docsTexto(g.documentos)}</option>
            ))}
            {tipo === "laboratorio" && d.laboratorios.map((l) => (
              <option key={l.id} value={l.id}>{l.codigo} · {l.nombre}{l.principal ? " (responsable)" : ""} · {l.aprobados} de {l.resultados} aprobados · documentos: {docsTexto(l.documentos)}</option>
            ))}
          </select>
        </div>
      )}

      {d && d.pendientes.length > 0 && (
        <div className="alert info" role="status" style={{ marginTop: 8 }}>
          <b>Para cerrar la OT falta cubrir:</b>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{d.pendientes.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      )}

      {listo && (
        <p style={{ margin: "8px 0 0", fontSize: 12.5 }}>
          ¿Este documento no se emitirá (p. ej. «la muestra no forma película»)?{" "}
          <button type="button" className="btn outline sm" onClick={() => setNoEmitir(true)}>Registrar que no se emite</button>
        </p>
      )}

      {noEmitir && (
        <Modal titulo="Registrar documento no emitido" onCerrar={() => setNoEmitir(false)}
          acciones={<>
            <button type="button" className="btn outline sm" onClick={() => setNoEmitir(false)}>Cancelar</button>
            <button type="button" className="btn primary sm" disabled={ocupado || motivo.trim().length < 5} onClick={registrarNoEmitido}>Reservar número y registrar</button>
          </>}>
          <p style={{ marginTop: 0 }}>
            Se reserva el número oficial (no se reutiliza) y queda anulado con su motivo. Cubre esta parte de la OT para el cierre.
          </p>
          <div className="field">
            <label htmlFor="cob-motivo">Motivo <span className="req">*</span></label>
            <textarea id="cob-motivo" rows={3} maxLength={1000} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            <small style={{ color: "var(--muted)" }}>Mínimo 5 caracteres.</small>
          </div>
        </Modal>
      )}
    </fieldset>
  );
}
