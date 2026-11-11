"use client";

import { useEffect, useState } from "react";
import CrudTable, { activoBadge, codigoCell } from "../_components/CrudTable";
import Modal from "@/components/documentos/Modal";
import { llamar } from "@/lib/laboratorio";
import { fechaHora } from "@/lib/format";

export default function MetodosCatPage() {
  // Método cuyo «Historial de versiones» está abierto (contrato §4.3.3).
  const [historial, setHistorial] = useState<{ id: string; codigo: string } | null>(null);
  // Redondeo del resultado y condiciones ambientales del método (R7 LPN, R8 LME).
  const [reglas, setReglas] = useState<{ id: string; codigo: string } | null>(null);
  return (
    <>
    <CrudTable
      titulo="Métodos"
      subtitulo="Eje Análisis · nivel 2. Método analítico (norma, instrumento, versión); puede colgar de un Ensayo. Cada cambio crea una revisión numerada en su «Historial de versiones»."
      endpoint="cat/metodos"
      columnas={[
        { key: "codigo", label: "Código", render: codigoCell },
        // Sin edición rápida en la celda: todo cambio del método pide motivo y crea revisión.
        { key: "nombre", label: "Nombre" },
        { key: "norma", label: "Norma", render: (v) => (v ? <span className="tag">{v}</span> : "—") },
        { key: "instrumento", label: "Instrumento" },
        { key: "version", label: "Ver." },
        { key: "revision", label: "Rev.", render: (v: any) => (v != null ? <span className="pill gray" title="Revisión vigente del método (Historial de versiones)">{v}</span> : "—") },
        {
          key: "factorValor",
          label: "Factor",
          render: (v: any, row: any) => (v != null && row?.factorOperacion ? `${row.factorOperacion === "dividir" ? "÷" : "×"} ${String(Number(v)).replace(".", ",")}` : "—"),
        },
        { key: "equipoRequerido", label: "Exige equipo", render: (v: any) => (v ? <span className="pill blue">Sí</span> : "—") },
        { key: "qcRequerido", label: "QC requerido", render: (v: any) => (v ? <span className="pill teal">Sí</span> : "—") },
        { key: "activo", label: "Estado", render: activoBadge },
      ]}
      campos={[
        { name: "ensayoId", label: "Ensayo (opcional)", tipo: "select", opcionesEndpoint: "cat/ensayos?limit=500" },
        { name: "codigo", label: "Código", requerido: true },
        { name: "nombre", label: "Nombre", requerido: true },
        { name: "norma", label: "Norma" },
        { name: "instrumento", label: "Instrumento" },
        { name: "version", label: "Versión" },
        { name: "servgrp", label: "Serv. grupo" },
        // Factor por defecto de la fórmula: se copia a los ensayos de cada OT y la jefatura lo ajusta por OT.
        { name: "factorOperacion", label: "Factor de la fórmula · operación", tipo: "select", opciones: ["multiplicar", "dividir"] },
        { name: "factorValor", label: "Factor de la fórmula · valor", tipo: "number" },
        { name: "factorDescripcion", label: "Factor · qué representa (p. ej. dilución 1:10)" },
        // Contrato §4.4.2: al capturar hay que informar el equipo usado; uno con la calibración vencida se bloquea.
        { name: "equipoRequerido", label: "Exige informar el equipo al capturar", tipo: "checkbox" },
        // Contrato §4.2.3 / §4.2.4: sin control de calidad aprobado en la OT no se capturan ni aprueban resultados
        // ni se emite el informe (parámetro qc.bloqueo). Tipos y criterios: Control de calidad (QC).
        { name: "qcRequerido", label: "QC requerido (sin control de calidad aprobado no se capturan ni aprueban resultados ni se emite el informe)", tipo: "checkbox" },
        { name: "activo", label: "Activo", tipo: "checkbox" },
      ]}
      motivoEdicion={{
        campo: "motivoCambio",
        etiqueta: "Motivo del cambio * (queda en el historial de versiones del método)",
        placeholder: "p. ej. Nueva edición de la norma NCh 2018",
      }}
      accionesFila={(row) => (
        <>
          <button type="button" className="btn outline sm" onClick={() => setHistorial({ id: String(row.id), codigo: String(row.codigo ?? "") })}>
            Historial de versiones
          </button>{" "}
          <button type="button" className="btn outline sm" title="Decimales del resultado (redondeo) y condiciones ambientales en la captura"
            onClick={() => setReglas({ id: String(row.id), codigo: String(row.codigo ?? "") })}>
            Resultado y condiciones
          </button>
        </>
      )}
    />
    {historial && <HistorialVersiones metodo={historial} onCerrar={() => setHistorial(null)} />}
    {reglas && <ReglasResultado metodo={reglas} onCerrar={() => setReglas(null)} />}
    </>
  );
}

type Cambio = { campo: string; etiqueta: string; antes: string | null; despues: string | null };
type Version = { id: string; numero: number; origen: string; motivo: string | null; cambios: Cambio[]; fecha: string; responsable: string | null };

const ORIGEN: Record<string, string> = {
  inicial: "Estado de partida",
  alta: "Alta del método",
  edicion: "Tablas maestras › Métodos",
  qc: "Control de calidad › Tipos y criterios",
  margen: "Calidad › Margen de advertencia",
};

/** Revisiones del método: número, fecha, responsable, motivo y qué cambió (antes → después). */
function HistorialVersiones({ metodo, onCerrar }: { metodo: { id: string; codigo: string }; onCerrar: () => void }) {
  const [versiones, setVersiones] = useState<Version[] | null>(null);
  const [nombre, setNombre] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    llamar<{ metodo: { nombre: string }; versiones: Version[] }>("GET", `/cat/metodos/${metodo.id}/versiones`)
      .then((r) => {
        setVersiones(r.versiones ?? []);
        setNombre(r.metodo?.nombre ?? "");
      })
      .catch((e) => setError(e.message));
  }, [metodo.id]);
  return (
    <Modal titulo={`Historial de versiones · ${metodo.codigo}${nombre ? ` · ${nombre}` : ""}`} onCerrar={onCerrar} ancho={760}
      acciones={<button className="btn outline sm" onClick={onCerrar}>Cerrar</button>}>
      {error && <div className="alert warn" role="alert">{error}</div>}
      {!versiones && !error ? <p>Cargando…</p> : versiones && versiones.length === 0 ? (
        <p className="subtitle">Este método aún no tiene revisiones registradas.</p>
      ) : versiones && (
        <table className="data">
          <thead>
            <tr><th>Rev.</th><th>Fecha</th><th>Responsable</th><th>Motivo</th><th>Qué cambió (anterior → nuevo)</th></tr>
          </thead>
          <tbody>
            {versiones.map((v) => (
              <tr key={v.id}>
                <td><span className="pill gray">{v.numero}</span></td>
                <td style={{ whiteSpace: "nowrap" }}>{fechaHora(v.fecha)}</td>
                <td>{v.responsable ?? "—"}</td>
                <td>
                  {v.motivo ?? "—"}
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{ORIGEN[v.origen] ?? v.origen}</div>
                </td>
                <td>
                  {(v.cambios ?? []).length === 0 ? (
                    <span style={{ color: "var(--muted)" }}>{v.origen === "alta" ? "Creación del método" : v.origen === "inicial" ? "Versión de partida" : "—"}</span>
                  ) : (
                    <ul style={{ margin: 0, paddingLeft: 16 }}>
                      {v.cambios.map((c) => (
                        <li key={c.campo}>
                          <b>{c.etiqueta}:</b> {c.antes ?? "(vacío)"} → {c.despues ?? "(vacío)"}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

/**
 * Reglas del resultado del método (R7, R8): cuántos decimales tiene el resultado final
 * (p. ej. el brillo en enteros) y si las condiciones ambientales se piden al capturar.
 */
function ReglasResultado({ metodo, onCerrar }: { metodo: { id: string; codigo: string }; onCerrar: () => void }) {
  const [dec, setDec] = useState<string>("");
  const [cond, setCond] = useState<string>("opcional");
  const [cargado, setCargado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    llamar<{ data: { decimales: number | null; condiciones: string } }>("GET", `/cat/metodos/${metodo.id}/reglas-resultado`)
      .then((r) => { setDec(r.data.decimales == null ? "" : String(r.data.decimales)); setCond(r.data.condiciones); setCargado(true); })
      .catch((e) => setError(e.message));
  }, [metodo.id]);
  async function guardar() {
    setOcupado(true); setError("");
    try {
      await llamar("PUT", `/cat/metodos/${metodo.id}/reglas-resultado`, { decimales: dec === "" ? null : Number(dec), condiciones: cond });
      onCerrar();
    } catch (e: any) { setError(e.message); }
    finally { setOcupado(false); }
  }
  return (
    <Modal titulo={`Resultado y condiciones · ${metodo.codigo}`} onCerrar={onCerrar} ancho={560}
      acciones={<><button className="btn outline sm" onClick={onCerrar}>Cancelar</button><button className="btn primary sm" disabled={!cargado || ocupado} onClick={guardar}>Guardar</button></>}>
      {error && <div className="alert warn" role="alert">{error}</div>}
      <div className="field">
        <label htmlFor="rr-dec">Decimales del resultado final</label>
        <select id="rr-dec" value={dec} onChange={(e) => setDec(e.target.value)}>
          <option value="">Sin redondeo (como se calcula)</option>
          <option value="0">0 · entero (p. ej. brillo)</option>
          {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={String(n)}>{n} decimal{n > 1 ? "es" : ""}</option>)}
        </select>
        <small style={{ color: "var(--muted)" }}>Se redondea al medio hacia arriba (0,5 → 1) y el veredicto se decide con el valor redondeado, que es el que se informa.</small>
      </div>
      <div className="field">
        <label htmlFor="rr-cond">Condiciones ambientales (temperatura y humedad) al capturar</label>
        <select id="rr-cond" value={cond} onChange={(e) => setCond(e.target.value)}>
          <option value="no_aplica">No aplican a este ensayo (no se piden ni se guardan)</option>
          <option value="opcional">Opcionales</option>
          <option value="obligatoria">Obligatorias</option>
        </select>
      </div>
    </Modal>
  );
}
