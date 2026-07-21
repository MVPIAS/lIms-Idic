"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet, asArray } from "./api";

// Cliente devuelto por GET /api/clientes?search=&limit=50 → {data:[{id,razonSocial,rut,tipo}], meta}.
export type Cliente = { id: string; razonSocial: string; rut?: string; tipo?: string };

// Selector/buscador de cliente real: consulta la API con debounce y devuelve al padre
// el cliente elegido (id + razón social). Reemplaza el antiguo input de texto libre que
// provocaba el 400 "clienteId Required" al no enviar un uuid válido.
export default function ClienteSelector({
  value,
  onChange,
}: {
  value: Cliente | null;
  onChange: (c: Cliente | null) => void;
}) {
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<Cliente[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const boxRef = useRef<HTMLDivElement | null>(null);

  // Búsqueda con debounce (300ms). Sólo mientras no hay cliente confirmado.
  useEffect(() => {
    if (value) return; // ya hay cliente elegido: no seguimos buscando.
    const term = q.trim();
    if (term.length < 1) { setResultados([]); return; }
    setCargando(true);
    setError("");
    const t = setTimeout(() => {
      apiGet(`/clientes?search=${encodeURIComponent(term)}&limit=50`)
        .then((d) => { setResultados(asArray<Cliente>(d)); setAbierto(true); })
        .catch((e) => setError(e?.message || "No se pudo buscar clientes."))
        .finally(() => setCargando(false));
    }, 300);
    return () => clearTimeout(t);
  }, [q, value]);

  // Cierra el desplegable al hacer click fuera.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const elegir = (c: Cliente) => {
    onChange(c);
    setAbierto(false);
    setResultados([]);
    setQ("");
  };

  const limpiar = () => {
    onChange(null);
    setQ("");
    setResultados([]);
  };

  const etiqueta = useMemo(() => {
    if (!value) return "";
    return value.rut ? `${value.razonSocial} · ${value.rut}` : value.razonSocial;
  }, [value]);

  // Cliente ya seleccionado: mostramos una "chip" clara con opción de cambiar.
  if (value) {
    return (
      <div className="field span-2">
        <label>Cliente <span className="req">*</span></label>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            className="pill blue"
            style={{ fontSize: 13, padding: "6px 10px", flex: 1, display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <span className="codigo">{value.tipo || "cliente"}</span>
            {etiqueta}
          </span>
          <button type="button" className="btn outline sm" onClick={limpiar}>Cambiar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="field span-2" ref={boxRef} style={{ position: "relative" }}>
      <label>Cliente <span className="req">*</span></label>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => { if (resultados.length) setAbierto(true); }}
        placeholder="Busca por razón social o RUT…"
        autoComplete="off"
      />
      {error && <div className="alert warn" style={{ marginTop: 6 }}>{error}</div>}

      {abierto && (
        <div
          className="card card--table"
          style={{ position: "absolute", zIndex: 20, top: "100%", left: 0, right: 0, marginTop: 4, maxHeight: 260, overflow: "auto" }}
        >
          <table className="data">
            <tbody>
              {cargando && (
                <tr><td style={{ textAlign: "center", padding: 14, color: "var(--muted)" }}>Buscando…</td></tr>
              )}
              {!cargando && resultados.map((c) => (
                <tr key={c.id} className="row-action" onClick={() => elegir(c)}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{c.razonSocial}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>
                      {c.rut || "sin RUT"}{c.tipo ? ` · ${c.tipo}` : ""}
                    </div>
                  </td>
                </tr>
              ))}
              {!cargando && resultados.length === 0 && (
                <tr><td style={{ textAlign: "center", padding: 14, color: "var(--muted)" }}>Sin coincidencias.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
