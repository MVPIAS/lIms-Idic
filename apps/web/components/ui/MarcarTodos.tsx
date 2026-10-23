"use client";

/**
 * «Marcar todos» / «Desmarcar todos» de un panel de métodos (B-095). Los paneles
 * grandes (48 métodos en pinturas, 37 en el LME) se desmarcaban uno a uno; es el
 * mismo par de botones que ya usa la recepción de internación (BPCH).
 */
export default function MarcarTodos({
  marcados,
  total,
  onMarcar,
  onDesmarcar,
  etiqueta = "métodos",
}: {
  marcados: number;
  total: number;
  onMarcar: () => void;
  onDesmarcar: () => void;
  etiqueta?: string;
}) {
  if (total < 2) return null;
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", fontWeight: 400 }}>
      <button type="button" className="btn outline sm" disabled={marcados >= total} onClick={onMarcar} aria-label={`Marcar todos los ${etiqueta}`}>Marcar todos</button>
      <button type="button" className="btn outline sm" disabled={marcados === 0} onClick={onDesmarcar} aria-label={`Desmarcar todos los ${etiqueta}`}>Desmarcar todos</button>
    </span>
  );
}
