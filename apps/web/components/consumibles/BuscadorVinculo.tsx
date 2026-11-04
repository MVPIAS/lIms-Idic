"use client";

// Buscador de OT, muestra o método para vincular un movimiento de consumible
// (contrato §4.4.5). La API acota OT y muestras al alcance del usuario
// (GET /consumibles/vinculos); los métodos de la muestra elegida salen primero.

import { useEffect, useRef, useState } from "react";
import { llamar, qs } from "@/lib/laboratorio";

export interface OpcionVinculo {
  id: string;
  codigo: string;
  detalle?: string | null;
  otId?: string | null;
  otCodigo?: string | null;
  deLaMuestra?: boolean;
}

const TEXTOS = {
  ot: { etiqueta: "OT", ayuda: "Código de la OT o cliente" },
  muestra: { etiqueta: "Muestra", ayuda: "Código o nombre de la muestra" },
  metodo: { etiqueta: "Método", ayuda: "Código o nombre del método" },
} as const;

export default function BuscadorVinculo({
  tipo,
  valor,
  onCambio,
  otId,
  muestraId,
}: {
  tipo: "ot" | "muestra" | "metodo";
  valor: OpcionVinculo | null;
  onCambio: (v: OpcionVinculo | null) => void;
  otId?: string | null;
  muestraId?: string | null;
}) {
  const [texto, setTexto] = useState("");
  const [opciones, setOpciones] = useState<OpcionVinculo[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState("");
  const reloj = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!abierto) return;
    if (reloj.current) clearTimeout(reloj.current);
    reloj.current = setTimeout(async () => {
      try {
        setOpciones(await llamar<OpcionVinculo[]>("GET", `/consumibles/vinculos${qs({ tipo, q: texto, otId: otId ?? null, muestraId: muestraId ?? null })}`));
        setError("");
      } catch (e: any) {
        setError(e.message);
      }
    }, 250);
    return () => {
      if (reloj.current) clearTimeout(reloj.current);
    };
  }, [texto, abierto, tipo, otId, muestraId]);

  const id = `vin-${tipo}`;
  if (valor)
    return (
      <div className="field" style={{ margin: 0 }}>
        <label htmlFor={id}>{TEXTOS[tipo].etiqueta}</label>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input id={id} readOnly value={[valor.codigo, valor.detalle].filter(Boolean).join(" · ")} />
          <button type="button" className="btn ghost sm" aria-label={`Quitar ${TEXTOS[tipo].etiqueta}`} onClick={() => onCambio(null)}>Quitar</button>
        </div>
      </div>
    );
  return (
    <div className="field" style={{ margin: 0, position: "relative" }}>
      <label htmlFor={id}>{TEXTOS[tipo].etiqueta}</label>
      <input
        id={id}
        value={texto}
        placeholder={`${TEXTOS[tipo].ayuda}…`}
        autoComplete="off"
        onFocus={() => setAbierto(true)}
        onBlur={() => setTimeout(() => setAbierto(false), 150)}
        onChange={(e) => setTexto(e.target.value)}
      />
      {abierto && (
        <ul
          role="listbox"
          style={{
            position: "absolute", zIndex: 30, top: "100%", left: 0, right: 0, maxHeight: 220, overflowY: "auto", margin: 0, padding: 4, listStyle: "none",
            background: "var(--card, #fff)", border: "1px solid var(--line)", borderRadius: 6, boxShadow: "0 4px 14px rgba(0,0,0,.12)",
          }}
        >
          {error && <li style={{ padding: 6, color: "var(--red)", fontSize: 12 }}>{error}</li>}
          {!error && !opciones.length && <li style={{ padding: 6, color: "var(--muted)", fontSize: 12 }}>Sin coincidencias en su alcance.</li>}
          {opciones.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onCambio(o); setTexto(""); setAbierto(false); }}
                style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: 0, padding: "5px 6px", cursor: "pointer", fontSize: 12.5 }}
              >
                <span className="codigo">{o.codigo}</span>
                {o.detalle && <span style={{ color: "var(--muted)" }}> · {o.detalle}</span>}
                {o.otCodigo && tipo === "muestra" && <span style={{ color: "var(--muted)" }}> · {o.otCodigo}</span>}
                {o.deLaMuestra && <span className="pill green" style={{ marginLeft: 6 }}>de la muestra</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
