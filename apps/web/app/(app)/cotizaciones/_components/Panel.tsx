"use client";

import { useEffect } from "react";

/**
 * Panel superpuesto: "drawer" lateral (detalle/edición de la cotización) o
 * "dialog" centrado (aceptación, anulación). Cierra con Esc o clic fuera.
 */
export default function Panel({
  titulo,
  modo = "dialog",
  onCerrar,
  children,
  ancho,
}: {
  titulo: React.ReactNode;
  modo?: "drawer" | "dialog";
  onCerrar: () => void;
  children: React.ReactNode;
  ancho?: number;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onCerrar]);

  const drawer = modo === "drawer";
  return (
    <div
      role="presentation"
      onClick={onCerrar}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10, 30, 40, .38)",
        zIndex: 60,
        display: "flex",
        justifyContent: drawer ? "flex-end" : "center",
        alignItems: drawer ? "stretch" : "flex-start",
        padding: drawer ? 0 : "8vh 16px 16px",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          width: drawer ? `min(${ancho ?? 980}px, 100vw)` : `min(${ancho ?? 560}px, 100%)`,
          maxHeight: drawer ? "100vh" : "84vh",
          overflowY: "auto",
          borderRadius: drawer ? 0 : 10,
          boxShadow: "0 10px 40px rgba(0,0,0,.25)",
          padding: "14px 18px 18px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid var(--line)", paddingBottom: 8, marginBottom: 12 }}>
          <h2 style={{ margin: 0, flex: 1, fontSize: 16 }}>{titulo}</h2>
          <button className="btn outline sm" onClick={onCerrar} aria-label="Cerrar">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
