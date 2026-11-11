"use client";
/**
 * Selector de perfil para personas con jefaturas duales (Comercial, R1): solo aparece
 * si la persona tiene roles o jefaturas en dos o más unidades. Al entrar sin perfil
 * elegido se le pregunta una vez por sesión con cuál trabajar; puede cambiarlo cuando
 * quiera desde la barra superior. Con un perfil activo, el LIMS usa solo los permisos,
 * el alcance y la bandeja de esa unidad (y los roles que no dependen de una unidad).
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import Modal from "@/components/documentos/Modal";

type Opcion = { unidadId: string; codigo: string; nombre: string; etiqueta: string; jefatura: string | null; roles: string[] };
const PREGUNTADO = "lims_perfil_preguntado";

export default function SelectorPerfil() {
  const [opciones, setOpciones] = useState<Opcion[]>([]);
  const [activo, setActivo] = useState<string | null>(null);
  const [preguntar, setPreguntar] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    api.getRaw<{ opciones: Opcion[]; activo: string | null }>("auth/perfiles")
      .then((r) => {
        setOpciones(r.opciones ?? []);
        setActivo(r.activo ?? null);
        let ya = false;
        try { ya = sessionStorage.getItem(PREGUNTADO) === "1"; } catch { /* sin almacenamiento */ }
        if ((r.opciones ?? []).length >= 2 && !r.activo && !ya) setPreguntar(true);
      })
      .catch(() => undefined);
  }, []);

  async function elegir(unidadId: string | null) {
    setOcupado(true);
    try {
      await api.elegirPerfil(unidadId);
      try { sessionStorage.setItem(PREGUNTADO, "1"); } catch { /* sin almacenamiento */ }
      window.location.reload();
    } finally {
      setOcupado(false);
    }
  }

  if (opciones.length < 2) return null;
  return (
    <>
      <label className="sr-only" htmlFor="sel-perfil">Perfil de trabajo</label>
      <select id="sel-perfil" value={activo ?? ""} disabled={ocupado} onChange={(e) => elegir(e.target.value || null)}
        title="Perfil con el que trabaja: permisos, bandeja y firmas de esa unidad" style={{ maxWidth: 260, fontSize: 12, marginRight: 8 }}>
        <option value="">Todos mis perfiles</option>
        {opciones.map((o) => <option key={o.unidadId} value={o.unidadId}>{o.etiqueta}</option>)}
      </select>
      {preguntar && (
        <Modal titulo="¿Con qué perfil va a trabajar?" onCerrar={() => { try { sessionStorage.setItem(PREGUNTADO, "1"); } catch { /* nada */ } setPreguntar(false); }} ancho={560}
          acciones={<button className="btn outline sm" disabled={ocupado} onClick={() => elegir(null)}>Con todos mis perfiles</button>}>
          <p style={{ marginTop: 0 }}>Usted tiene jefaturas o roles en más de una unidad. Elija con cuál trabajar: verá la bandeja, los permisos y las firmas de esa unidad. Puede cambiarlo cuando quiera en la barra superior.</p>
          <div style={{ display: "grid", gap: 8 }}>
            {opciones.map((o) => (
              <button key={o.unidadId} className="btn outline" style={{ justifyContent: "flex-start", textAlign: "left" }} disabled={ocupado} onClick={() => elegir(o.unidadId)}>
                {o.etiqueta}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
