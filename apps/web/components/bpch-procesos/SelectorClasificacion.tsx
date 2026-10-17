"use client";

/**
 * SelectorClasificacion · elige una clasificación de sustancia APROBADA
 * (GET /bpch/clasificaciones?vigentes=1). Solo las aprobadas se pueden usar en
 * Producción Nacional y Prototipos; el servidor lo vuelve a comprobar.
 */
import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { llamar } from "@/lib/laboratorio";

interface Opcion {
  id: string;
  codigo: string;
  version: number;
  sustancia: string;
  resumen: string;
}

export default function SelectorClasificacion({
  valor,
  onCambio,
  etiqueta = "Clasificación de la sustancia",
  deshabilitado,
}: {
  valor: string;
  onCambio: (id: string) => void;
  etiqueta?: string;
  deshabilitado?: boolean;
}) {
  const id = useId();
  const [opciones, setOpciones] = useState<Opcion[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    llamar<{ data: Opcion[] }>("GET", "/bpch/clasificaciones?vigentes=1&limit=500")
      .then((r) => setOpciones(r.data))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div className="field">
      <label htmlFor={id}>{etiqueta}</label>
      <select id={id} value={valor} onChange={(e) => onCambio(e.target.value)} disabled={deshabilitado}>
        <option value="">— Sin clasificación —</option>
        {opciones.map((o) => (
          <option key={o.id} value={o.id}>
            {o.codigo}{o.version > 1 ? `-V${o.version}` : ""} · {o.sustancia} · {o.resumen}
          </option>
        ))}
      </select>
      {error ? (
        <small style={{ color: "var(--red)" }}>{error}</small>
      ) : opciones.length === 0 ? (
        <small style={{ color: "var(--muted)" }}>
          No hay clasificaciones aprobadas. Regístrela en <Link href={"/bpch/clasificaciones" as any}>Clasificación de sustancias</Link>.
        </small>
      ) : null}
    </div>
  );
}
