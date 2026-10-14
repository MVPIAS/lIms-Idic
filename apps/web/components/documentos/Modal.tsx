"use client";

import { useEffect, type ReactNode } from "react";

/** Diálogo modal sencillo con el estilo de feedback.tsx (.modal-fondo / .modal). */
export default function Modal({
  titulo,
  children,
  acciones,
  onCerrar,
  ancho = 520,
}: {
  titulo: ReactNode;
  children: ReactNode;
  acciones?: ReactNode;
  onCerrar: () => void;
  ancho?: number;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onCerrar]);
  return (
    <div className="modal-fondo" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: ancho, maxHeight: "90vh", overflowY: "auto" }}>
        <h3>{titulo}</h3>
        <div style={{ fontSize: 12.5 }}>{children}</div>
        {acciones && <div className="modal-acciones">{acciones}</div>}
      </div>
    </div>
  );
}
