"use client";

/**
 * BPCH-48 (respuesta IDIC 17-11-2026) · modalidad e inspectores de una
 * inspección de Internación o de Reinspección: en terreno, dos inspectores
 * obligatorios (sin ellos no se programa); en trabajo administrativo basta uno.
 * Se eligen entre las personas con rol Inspector de la unidad de inspección; el
 * texto libre de registros anteriores se muestra solo como lectura.
 */
export interface InspectorDisponible {
  id: string;
  nombre: string;
  iniciales: string;
  sinRol?: boolean;
}

export interface ValorInspectores {
  modalidad: "" | "TERRENO" | "ADMINISTRATIVO";
  inspectorIds: string[];
}

export default function SelectorInspectores({
  valor,
  onCambio,
  disponibles,
  textoAnterior,
  idBase,
}: {
  valor: ValorInspectores;
  onCambio: (v: ValorInspectores) => void;
  disponibles: InspectorDisponible[];
  textoAnterior?: string | null;
  idBase: string;
}) {
  const minimo = valor.modalidad === "TERRENO" ? 2 : valor.modalidad === "ADMINISTRATIVO" ? 1 : 0;
  const alternar = (id: string, si: boolean) =>
    onCambio({ ...valor, inspectorIds: si ? [...valor.inspectorIds.filter((i) => i !== id), id] : valor.inspectorIds.filter((i) => i !== id) });
  return (
    <fieldset className="field span-3" style={{ border: "1px solid var(--line)", borderRadius: 7, padding: "8px 10px" }}>
      <legend style={{ fontSize: 12, fontWeight: 700 }}>Inspectores (LCA) <span className="req">*</span></legend>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 6 }}>
        <label style={{ fontSize: 12.5 }}>
          <input type="radio" name={`${idBase}-modalidad`} checked={valor.modalidad === "TERRENO"} onChange={() => onCambio({ ...valor, modalidad: "TERRENO" })} /> Inspección en terreno (dos inspectores)
        </label>
        <label style={{ fontSize: 12.5 }}>
          <input type="radio" name={`${idBase}-modalidad`} checked={valor.modalidad === "ADMINISTRATIVO"} onChange={() => onCambio({ ...valor, modalidad: "ADMINISTRATIVO" })} /> Trabajo administrativo (un inspector)
        </label>
      </div>
      {disponibles.length ? (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {disponibles.map((p) => (
            <label key={p.id} style={{ fontSize: 12.5 }}>
              <input type="checkbox" checked={valor.inspectorIds.includes(p.id)} onChange={(e) => alternar(p.id, e.target.checked)} /> {p.nombre}
              {p.sinRol && <small style={{ color: "var(--muted)" }}> (ya no es inspector de la unidad)</small>}
            </label>
          ))}
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)" }}>
          La unidad de inspección no tiene personas con rol Inspector: pida a Administración que lo asigne (Administración › Usuarios y roles).
        </p>
      )}
      {minimo > 0 && valor.inspectorIds.length < minimo && (
        <small style={{ display: "block", color: "#7a4b00", marginTop: 4 }}>
          {valor.modalidad === "TERRENO"
            ? `Elija dos inspectores: sin ellos no se puede programar la inspección en terreno (elegidos: ${valor.inspectorIds.length}).`
            : "Elija al menos un inspector."}
        </small>
      )}
      {textoAnterior && (
        <small style={{ display: "block", color: "var(--muted)", marginTop: 4 }}>
          Registrado antes como texto: «{textoAnterior}». Elija ahora a las personas de la lista.
        </small>
      )}
    </fieldset>
  );
}
