"use client";

/**
 * Laboratorio › Órdenes internas.
 *  · «Bandeja de entrada»: las órdenes que LLEGAN a los laboratorios de su
 *    alcance (EP-01 0.6 «Bandeja de entrada del laboratorio», origen «OT
 *    interna»): Nº interno · OT y muestra de origen · laboratorio solicitante ·
 *    ensayo pedido · requisito, con «Recibir →».
 *  · «Todas»: las de las OT de su alcance y las que llegan a su laboratorio;
 *    desde aquí se emite una nueva (eligiendo la OT).
 * Cada orden se trabaja en su ficha (/ordenes-internas/[id]).
 */
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import Modal from "@/components/documentos/Modal";
import { llamar } from "@/lib/laboratorio";
import { usePermisos } from "@/lib/permisos";
import FormOrdenInterna from "@/components/ordenes-internas/FormOrdenInterna";
import TablaOrdenesInternas from "@/components/ordenes-internas/TablaOrdenesInternas";
import { ESTADO_OI, type OrdenInterna } from "@/components/ordenes-internas/ordenesInternas";

type OtCorta = { id: string; codigo: string; estado: string; unidad?: { codigo: string } | null; cliente?: { razonSocial: string } | null };
type Vista = "entrada" | "todas";

export default function OrdenesInternasPage() {
  return (
    <Suspense fallback={<p className="subtitle">Cargando…</p>}>
      <OrdenesInternas />
    </Suspense>
  );
}

function OrdenesInternas() {
  const { puede } = usePermisos();
  // ?vista=todas&estado=cerrada (enlace de «Informes internos por integrar» en Mi bandeja).
  const params = useSearchParams();
  const [vista, setVista] = useState<Vista>(params.get("vista") === "todas" ? "todas" : "entrada");
  const [filas, setFilas] = useState<OrdenInterna[] | null>(null);
  const [error, setError] = useState("");
  const [estado, setEstado] = useState(params.get("estado") ?? "");
  const [buscar, setBuscar] = useState("");
  const [elegirOt, setElegirOt] = useState(false);
  const [ot, setOt] = useState<OtCorta | null>(null);

  const cargar = useCallback(async () => {
    setError("");
    setFilas(null);
    try {
      if (vista === "entrada") {
        const qs = new URLSearchParams({ estado: estado || "pendientes" });
        if (buscar.trim()) qs.set("search", buscar.trim());
        setFilas(await llamar<OrdenInterna[]>("GET", `/ordenes-internas/bandeja?${qs}`));
      } else {
        const qs = new URLSearchParams({ limit: "300" });
        if (estado) qs.set("estado", estado);
        if (buscar.trim()) qs.set("search", buscar.trim());
        const r = await llamar<{ data: OrdenInterna[] }>("GET", `/ordenes-internas?${qs}`);
        setFilas(r.data);
      }
    } catch (e: any) {
      setError(e.message);
      setFilas([]);
    }
  }, [vista, estado, buscar]);

  useEffect(() => {
    cargar();
    // Se recarga al cambiar de vista o de estado; el texto se busca con el botón / Enter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vista, estado]);

  const emitir = puede("orden_interna.emitir");

  return (
    <div>
      <PageHeader
        icono="🔀"
        titulo="Órdenes internas"
        subtitulo="Ensayos que un laboratorio pide a otro sobre la misma muestra. El laboratorio de destino la recibe, registra sus resultados, responde con su informe, horas y costo directo, y la cierra; el solicitante la da por recibida."
        migas={[{ label: "Laboratorio" }, { label: "Órdenes internas" }]}
        acciones={emitir ? <button type="button" className="btn primary" onClick={() => setElegirOt(true)}>＋ Nueva orden interna</button> : null}
      />
      <div role="tablist" aria-label="Vista de órdenes internas" className="tabs" style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {([
          ["entrada", "Bandeja de entrada"],
          ["todas", "Todas las de mi alcance"],
        ] as [Vista, string][]).map(([v, t]) => (
          <button key={v} type="button" role="tab" aria-selected={vista === v}
            className={`btn sm ${vista === v ? "primary" : "outline"}`}
            onClick={() => { setVista(v); setEstado(""); }}>{t}</button>
        ))}
      </div>
      {error && <div className="alert warn" role="alert">{error}</div>}
      <form className="toolbar" onSubmit={(e) => { e.preventDefault(); cargar(); }}>
        <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Nº interno, OT, laboratorio o requisito"
          aria-label="Buscar órdenes internas" style={{ flex: 1, minWidth: 240 }} />
        <select value={estado} onChange={(e) => setEstado(e.target.value)} aria-label="Estado">
          <option value="">{vista === "entrada" ? "Pendientes (por recibir y en análisis)" : "Todos los estados"}</option>
          {vista === "entrada" && <option value="todas">Todas</option>}
          {Object.entries(ESTADO_OI).map(([k, v]) => <option key={k} value={k}>{v.texto}</option>)}
        </select>
        <button type="submit" className="btn primary sm">Buscar</button>
        <span className="spacer" />
        {filas && <small style={{ color: "var(--muted)" }}>{filas.length} orden(es)</small>}
      </form>
      <div className="card card--table">
        {filas === null ? (
          <p className="subtitle" style={{ padding: 12, margin: 0 }}>Cargando órdenes internas…</p>
        ) : (
          <TablaOrdenesInternas
            filas={filas}
            mostrarOt
            bandeja={vista === "entrada"}
            puedeEmitir={emitir}
            puedeAnular={puede("orden_interna.anular")}
            puedeResponder={puede("orden_interna.responder")}
            onCambio={cargar}
            vacio={<p className="subtitle" style={{ padding: 16, margin: 0, textAlign: "center" }}>
              {vista === "entrada"
                ? <>No hay órdenes internas pendientes para su laboratorio{buscar ? " con esta búsqueda" : ""}. Cuando otro laboratorio le derive ensayos, aparecerán aquí para recibirlas.</>
                : <>No hay órdenes internas{estado || buscar ? " con estos filtros" : " de las OT de su alcance"}.
                  {emitir ? " Use «＋ Nueva orden interna» para derivar parte de una OT a otro laboratorio." : ""}</>}
            </p>}
          />
        )}
      </div>

      {elegirOt && <ElegirOt onCerrar={() => setElegirOt(false)} onElegida={(o) => { setElegirOt(false); setOt(o); }} />}
      {ot && (
        <FormOrdenInterna otId={ot.id} otCodigo={ot.codigo} onCerrar={() => setOt(null)}
          onGuardada={() => { setOt(null); setVista("todas"); cargar(); }} />
      )}
    </div>
  );
}

/** Paso previo: elegir la OT de origen (solo las de su alcance; la API lo vuelve a exigir). */
function ElegirOt({ onCerrar, onElegida }: { onCerrar: () => void; onElegida: (o: OtCorta) => void }) {
  const [q, setQ] = useState("");
  const [ots, setOts] = useState<OtCorta[] | null>(null);
  const [error, setError] = useState("");

  async function buscarOt(e?: React.FormEvent) {
    e?.preventDefault();
    setError("");
    setOts(null);
    try {
      const r = await llamar<{ data: OtCorta[] }>("GET", `/ot?limit=30${q.trim() ? `&search=${encodeURIComponent(q.trim())}` : ""}`);
      setOts(r.data.filter((o) => !["cerrada", "anulada"].includes(o.estado)));
    } catch (err: any) {
      setError(err.message);
      setOts([]);
    }
  }
  useEffect(() => {
    buscarOt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Modal titulo="Nueva orden interna · elija la OT de origen" onCerrar={onCerrar} ancho={620}
      acciones={<button type="button" className="btn outline sm" onClick={onCerrar}>Cancelar</button>}>
      <form className="toolbar" onSubmit={buscarOt} style={{ marginBottom: 8 }}>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Código de la OT o cliente" aria-label="Buscar OT" style={{ flex: 1 }} />
        <button type="submit" className="btn primary sm">Buscar</button>
      </form>
      {error && <div className="alert warn" role="alert">{error}</div>}
      {ots === null ? (
        <p style={{ color: "var(--muted)" }}>Buscando…</p>
      ) : ots.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>No hay OT abiertas de su alcance que coincidan.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4, maxHeight: 340, overflowY: "auto" }}>
          {ots.map((o) => (
            <li key={o.id}>
              <button type="button" className="btn outline sm" style={{ width: "100%", justifyContent: "flex-start", textAlign: "left" }} onClick={() => onElegida(o)}>
                <span className="codigo">{o.codigo}</span>&nbsp;· {o.unidad?.codigo ?? "sin laboratorio"} · {o.cliente?.razonSocial ?? "—"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
