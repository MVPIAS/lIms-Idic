"use client";

/**
 * Cliente de la E.T. (B-036 · MP-05 D05-11). Una E.T. «no reutilizable» solo se
 * aplica en las OT de su cliente, así que el alta y la ficha en borrador piden
 * el cliente. Usa el buscador acotado GET /especificaciones-tecnicas/clientes
 * (razón social y RUT), que no exige «cliente.ver»: el Jefe del LEM gestiona
 * E.T. sin ver el maestro de clientes.
 */
import { useEffect, useState } from "react";
import { llamar } from "@/lib/laboratorio";

export interface ClienteElegido {
  id: string;
  nombre: string;
}

export default function ClienteEt({
  id,
  valor,
  onChange,
  soloLectura = false,
}: {
  id: string;
  valor: ClienteElegido | null;
  onChange: (c: ClienteElegido | null) => void;
  soloLectura?: boolean;
}) {
  const [busca, setBusca] = useState("");
  const [lista, setLista] = useState<{ id: string; razonSocial: string; rut: string | null }[]>([]);

  useEffect(() => {
    if (soloLectura || busca.trim().length < 2) { setLista([]); return; }
    const t = setTimeout(() => {
      llamar<any[]>("GET", `/especificaciones-tecnicas/clientes?q=${encodeURIComponent(busca.trim())}`)
        .then((r) => setLista(Array.isArray(r) ? r : []))
        .catch(() => setLista([]));
    }, 250);
    return () => clearTimeout(t);
  }, [busca, soloLectura]);

  if (soloLectura)
    return (
      <div className="field readonly">
        <label htmlFor={id}>Cliente</label>
        <input id={id} value={valor?.nombre ?? "—"} readOnly />
      </div>
    );

  return (
    <div className="field">
      <label htmlFor={id}>Cliente</label>
      {valor ? (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span id={id}>{valor.nombre}</span>
          <button type="button" className="btn outline sm" onClick={() => onChange(null)}>Quitar</button>
        </div>
      ) : (
        <>
          <input id={id} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Razón social o RUT (mín. 2 letras)" autoComplete="off" />
          {lista.length > 0 && (
            <ul style={{ listStyle: "none", margin: "4px 0 0", padding: 0, border: "1px solid var(--line)", borderRadius: 5, maxHeight: 150, overflowY: "auto" }}>
              {lista.map((c) => (
                <li key={c.id}>
                  <button type="button" className="btn outline sm" style={{ width: "100%", textAlign: "left", border: "none" }}
                    onClick={() => { onChange({ id: c.id, nombre: c.razonSocial }); setBusca(""); }}>
                    {c.razonSocial}{c.rut ? ` · ${c.rut}` : ""}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
