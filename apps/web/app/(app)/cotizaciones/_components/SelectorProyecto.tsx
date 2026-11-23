"use client";

/**
 * Proyecto de la cotización (quinto envío IDIC, lote 3) · opcional.
 * Solo se ofrecen los proyectos ACTIVOS del cliente elegido (un proyecto
 * pertenece a un solo cliente); el ya guardado se muestra aunque se haya
 * desactivado. Con el permiso `proyecto.gestionar`, «＋ Nuevo» lo crea aquí
 * mismo (el código PROY/correlativo/año lo asigna el sistema) y lo deja elegido.
 */
import { useEffect, useState } from "react";
import { pedir } from "./comercial";
import { toast } from "@/components/ui/feedback";

export type ProyectoOpcion = { id: string; codigo: string; nombre: string; activo: boolean };

type Props = {
  clienteId: string;
  value: string;
  onChange: (id: string) => void;
  /** Proyecto ya guardado en la cotización (puede estar inactivo). */
  inicial?: ProyectoOpcion | null;
  puedeCrear: boolean;
  disabled?: boolean;
};

export default function SelectorProyecto({ clienteId, value, onChange, inicial, puedeCrear, disabled }: Props) {
  const [opciones, setOpciones] = useState<ProyectoOpcion[]>([]);
  const [cargando, setCargando] = useState(false);
  const [creando, setCreando] = useState(false);
  const [nombre, setNombre] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!clienteId) {
      setOpciones([]);
      return;
    }
    let vivo = true;
    setCargando(true);
    pedir<{ data: ProyectoOpcion[] }>("GET", `/proyectos?${new URLSearchParams({ clienteId, activo: "1", limit: "100" })}`)
      .then((r) => vivo && setOpciones(r?.data ?? []))
      .catch(() => vivo && setOpciones([]))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [clienteId]);

  // El proyecto guardado (aunque esté inactivo) sigue en la lista para no perderlo al editar.
  const lista = inicial && !opciones.some((o) => o.id === inicial.id) ? [inicial, ...opciones] : opciones;

  async function crear() {
    const n = nombre.trim();
    if (!n) return toast.error("Escriba el nombre del proyecto.");
    setGuardando(true);
    try {
      const p = await pedir<ProyectoOpcion>("POST", "/proyectos", { clienteId, nombre: n });
      setOpciones((o) => [p, ...o]);
      onChange(p.id);
      setNombre("");
      setCreando(false);
      toast.ok(`Proyecto ${p.codigo} creado.`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="field" style={{ gridColumn: "1 / -1" }}>
      <label htmlFor="cot-proyecto">Proyecto</label>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <select id="cot-proyecto" value={value} disabled={disabled || !clienteId} onChange={(e) => onChange(e.target.value)} style={{ flex: 1, minWidth: 220 }}>
          <option value="">{!clienteId ? "Elija primero el cliente" : cargando ? "Cargando…" : lista.length ? "— sin proyecto —" : "— sin proyecto (el cliente no tiene proyectos activos) —"}</option>
          {lista.map((p) => (
            <option key={p.id} value={p.id}>
              {p.codigo} · {p.nombre}
              {p.activo === false ? " (inactivo)" : ""}
            </option>
          ))}
        </select>
        {puedeCrear && clienteId && !creando && (
          <button type="button" className="btn outline sm" disabled={disabled} onClick={() => setCreando(true)}>
            ＋ Nuevo proyecto
          </button>
        )}
      </div>
      {creando && (
        <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
          <input
            aria-label="Nombre del proyecto nuevo"
            value={nombre}
            maxLength={300}
            autoFocus
            placeholder="Nombre del proyecto nuevo"
            onChange={(e) => setNombre(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void crear();
              }
            }}
            style={{ flex: 1, minWidth: 220 }}
          />
          <button type="button" className="btn primary sm" disabled={guardando} onClick={crear}>
            {guardando ? "Creando…" : "Crear y elegir"}
          </button>
          <button type="button" className="btn outline sm" disabled={guardando} onClick={() => { setCreando(false); setNombre(""); }}>
            Cancelar
          </button>
        </div>
      )}
      <small style={{ color: "var(--muted)" }}>Opcional. La OT lo hereda al aceptarse la cotización y se imprime en el IVC como «Nombre del proyecto».</small>
    </div>
  );
}
