"use client";

import { useCallback, useEffect, useState } from "react";
import Modal from "@/components/documentos/Modal";
import { api } from "@/lib/api";
import { usePermisos } from "@/lib/permisos";
import { toast } from "@/components/ui/feedback";

interface Planta {
  id: string;
  codigo: string;
  nombre: string;
  direccion: string | null;
  ciudad: string | null;
  region: string | null;
  telefono: string | null;
  activa: boolean;
}

const VACIA = { nombre: "", direccion: "", ciudad: "", region: "", telefono: "" };

/**
 * Plantas del cliente (EP-00 0.1 · «Planta(s) [nombre, dirección]»). Se abren
 * desde la fila del cliente con «Plantas». No se borran: se desactivan, porque
 * pueden estar citadas en cotizaciones y OT.
 */
export default function Plantas({ cliente, onCerrar }: { cliente: { id: string; razonSocial: string }; onCerrar: () => void }) {
  const { puede } = usePermisos();
  const editar = puede("cliente.editar");
  const [filas, setFilas] = useState<Planta[] | null>(null);
  const [form, setForm] = useState(VACIA);
  const [editando, setEditando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setFilas(await api.getRaw<Planta[]>(`clientes/${cliente.id}/plantas`));
    } catch (e: any) {
      setError(e.message);
      setFilas([]);
    }
  }, [cliente.id]);
  useEffect(() => void cargar(), [cargar]);

  const guardar = async () => {
    if (!form.nombre.trim()) return setError("Indique el nombre de la planta.");
    setOcupado(true);
    setError(null);
    try {
      if (editando) await api.patch(`/clientes/${cliente.id}/plantas/${editando}`, form);
      else await api.post(`/clientes/${cliente.id}/plantas`, form);
      toast.ok(editando ? "Planta corregida." : "Planta agregada.");
      setForm(VACIA);
      setEditando(null);
      await cargar();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setOcupado(false);
    }
  };

  const activar = async (p: Planta, activa: boolean) => {
    try {
      await api.patch(`/clientes/${cliente.id}/plantas/${p.id}`, { activa });
      toast.ok(activa ? "Planta reactivada." : "Planta desactivada: ya no se ofrece al cotizar.");
      await cargar();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const campo = (k: keyof typeof VACIA, etiqueta: string, req = false, span = false) => (
    <div className={`field${span ? " span-2" : ""}`}>
      <label htmlFor={`pl-${k}`}>{etiqueta}{req && <span aria-hidden style={{ color: "var(--danger, #b42318)" }}> *</span>}</label>
      <input id={`pl-${k}`} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} required={req} />
    </div>
  );

  return (
    <Modal titulo={`Plantas · ${cliente.razonSocial}`} onCerrar={onCerrar} ancho={760}
      acciones={<button type="button" className="btn outline" onClick={onCerrar}>Cerrar</button>}>
      <p style={{ marginTop: 0, color: "var(--muted)" }}>
        Recintos o sucursales del cliente donde se retiran muestras o se ejecuta el trabajo. Una planta citada en una cotización u OT no se borra: se desactiva.
      </p>
      {filas === null ? (
        <p>Cargando…</p>
      ) : filas.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>El cliente aún no tiene plantas registradas.</p>
      ) : (
        <table className="data" style={{ marginBottom: 12 }}>
          <thead>
            <tr><th>Código</th><th>Nombre</th><th>Dirección</th><th>Teléfono</th><th>Estado</th>{editar && <th>Acciones</th>}</tr>
          </thead>
          <tbody>
            {filas.map((p) => (
              <tr key={p.id} style={p.activa ? undefined : { color: "var(--muted)" }}>
                <td className="codigo">{p.codigo}</td>
                <td>{p.nombre}</td>
                <td>{[p.direccion, p.ciudad, p.region].filter(Boolean).join(", ") || "—"}</td>
                <td>{p.telefono || "—"}</td>
                <td><span className={`pill ${p.activa ? "green" : "gray"}`}>{p.activa ? "activa" : "inactiva"}</span></td>
                {editar && (
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button type="button" className="btn outline sm" onClick={() => {
                      setEditando(p.id);
                      setForm({ nombre: p.nombre, direccion: p.direccion ?? "", ciudad: p.ciudad ?? "", region: p.region ?? "", telefono: p.telefono ?? "" });
                    }}>Corregir</button>{" "}
                    <button type="button" className="btn outline sm" onClick={() => activar(p, !p.activa)}>{p.activa ? "Desactivar" : "Reactivar"}</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editar && (
        <form onSubmit={(e) => { e.preventDefault(); void guardar(); }} style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
          <h4 style={{ margin: "0 0 8px" }}>{editando ? "Corregir planta" : "Agregar planta"}</h4>
          <div className="form-grid">
            {campo("nombre", "Nombre", true)}
            {campo("telefono", "Teléfono")}
            {campo("direccion", "Dirección", false, true)}
            {campo("ciudad", "Ciudad")}
            {campo("region", "Región")}
          </div>
          {error && <p role="alert" style={{ color: "var(--danger, #b42318)" }}>{error}</p>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
            {editando && <button type="button" className="btn outline" onClick={() => { setEditando(null); setForm(VACIA); setError(null); }}>Cancelar corrección</button>}
            <button type="submit" className="btn primary sm" disabled={ocupado}>{ocupado ? "Guardando…" : editando ? "Guardar planta" : "Agregar planta"}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
