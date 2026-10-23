"use client";

/**
 * «Avisos» de Mi bandeja (frente r4c, T20): OT vencidas o por vencer, resultados
 * No cumple / Contaminado, documentos oficiales, despachos y oficios. Cada aviso
 * lleva a su pantalla y se marca como leído. Si el correo del LIMS no está
 * configurado, el aviso igual llega aquí (la columna dice «solo en el LIMS»).
 * API: GET /avisos, POST /avisos/:id/leido, POST /avisos/leidos.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { llamar } from "@/lib/laboratorio";
import { fechaHora } from "@/lib/format";
import { toast } from "@/components/ui/feedback";

interface Aviso {
  id: string;
  tipo: string;
  severidad: "info" | "warn" | "alta";
  titulo: string;
  mensaje: string | null;
  ruta: string | null;
  otCodigo: string | null;
  correoEstado: string;
  leidoAt: string | null;
  createdAt: string;
}

const CORREO: Record<string, string> = {
  enviado: "también por correo",
  error: "el correo falló: solo en el LIMS",
  sin_configurar: "correo no configurado: solo en el LIMS",
  sin_correo: "sin correo registrado: solo en el LIMS",
  no_aplica: "solo en el LIMS",
};
const PILL: Record<string, string> = { alta: "red", warn: "amber", info: "blue" };

export default function AvisosBandeja() {
  const [datos, setDatos] = useState<{ noLeidos: number; data: Aviso[] } | null>(null);
  const [todos, setTodos] = useState(false);
  // Se muestran los 5 más recientes; el resto, a pedido (la bandeja de pendientes queda a la vista).
  const [expandido, setExpandido] = useState(false);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    try {
      setDatos(await llamar("GET", `/avisos?limite=30${todos ? "" : "&noLeidos=1"}`));
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, [todos]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function leido(id: string | null) {
    try {
      await llamar("POST", id ? `/avisos/${id}/leido` : "/avisos/leidos");
      if (!id) toast.ok("Avisos marcados como leídos.");
      cargar();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  if (error) return null; // servidor sin avisos: la bandeja sigue igual
  if (!datos) return null;
  const lista = expandido ? datos.data : datos.data.slice(0, 5);
  const ocultos = datos.data.length - lista.length;
  return (
    <section className="card" aria-labelledby="tit-avisos">
      <h2 id="tit-avisos" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        Avisos
        {datos.noLeidos > 0 && <span className="pill red">{datos.noLeidos} sin leer</span>}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn outline sm" onClick={() => setTodos((x) => !x)}>
          {todos ? "Ver solo sin leer" : "Ver también los leídos"}
        </button>
        {datos.noLeidos > 0 && (
          <button type="button" className="btn outline sm" onClick={() => leido(null)}>Marcar todos como leídos</button>
        )}
      </h2>
      {lista.length === 0 ? (
        <p className="subtitle" style={{ margin: 0 }}>{todos ? "No tiene avisos." : "No tiene avisos sin leer."}</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
          {lista.map((a) => (
            <li
              key={a.id}
              style={{
                display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 10px", borderRadius: 8,
                border: "1px solid var(--line)", background: a.leidoAt ? "transparent" : "var(--bg)",
              }}
            >
              <span className={`pill ${PILL[a.severidad] ?? "gray"}`} style={{ flexShrink: 0 }}>
                {a.severidad === "alta" ? "urgente" : a.severidad === "warn" ? "atención" : "aviso"}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: a.leidoAt ? 500 : 700 }}>
                  {a.ruta ? <Link href={a.ruta as any} style={{ color: "inherit" }}>{a.titulo}</Link> : a.titulo}
                </div>
                {a.mensaje && <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{a.mensaje}</div>}
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>
                  {fechaHora(a.createdAt)} · {CORREO[a.correoEstado] ?? a.correoEstado}
                </div>
              </div>
              {!a.leidoAt && (
                <button type="button" className="btn outline sm" onClick={() => leido(a.id)} aria-label={`Marcar como leído: ${a.titulo}`}>
                  Leído
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {(ocultos > 0 || expandido) && (
        <button type="button" className="btn ghost sm" style={{ marginTop: 6 }} onClick={() => setExpandido((x) => !x)} aria-expanded={expandido}>
          {expandido ? "Mostrar solo los 5 más recientes" : `Ver ${ocultos} aviso${ocultos === 1 ? "" : "s"} más`}
        </button>
      )}
    </section>
  );
}
