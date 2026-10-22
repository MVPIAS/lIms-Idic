"use client";

/**
 * BPCH · SAEC › Catálogo de armas (EP-11 11.8): marcas (con su país de origen),
 * modelos por marca y calibres (marca C.I.P.). Las marcas vienen del catálogo
 * de la D11 del LIMS actual («MARCA ( PAÍS )»); su adopción está por confirmar
 * con el IDIC (EP-11 P9). El armero añade lo que falta al registrar; la
 * jefatura corrige y desactiva (arma.catalogo). API: /d11/catalogos.
 */
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import RequierePermiso from "@/components/RequierePermiso";
import { toast } from "@/components/ui/feedback";
import { pedir, type Catalogos } from "@/lib/d11";

type Pestana = "marcas" | "modelos" | "calibres";

export default function CatalogoArmasPage() {
  return (
    <RequierePermiso perm="arma.ver" titulo="Catálogo de armas">
      <Catalogo />
    </RequierePermiso>
  );
}

function Catalogo() {
  const [cat, setCat] = useState<Catalogos | null>(null);
  const [pestana, setPestana] = useState<Pestana>("marcas");
  const [q, setQ] = useState("");
  const [editando, setEditando] = useState<{ id: string; nombre: string; pais: string; cip: boolean } | null>(null);
  const [nuevo, setNuevo] = useState({ nombre: "", pais: "", marcaId: "", cip: false });

  const cargar = () => pedir<Catalogos>("GET", "/d11/catalogos").then(setCat).catch((e) => toast.error(e.message));
  useEffect(() => {
    cargar();
  }, []);

  const t = q.trim().toLowerCase();
  const marcaDe = useMemo(() => new Map((cat?.marcas ?? []).map((m) => [m.id, m])), [cat]);
  const filas = useMemo(() => {
    if (!cat) return [];
    const base: any[] = pestana === "marcas" ? cat.marcas : pestana === "modelos" ? cat.modelos : cat.calibres;
    return base
      .filter((x) => !t || [x.nombre, x.pais, marcaDe.get(x.marcaId)?.nombre].some((v) => String(v ?? "").toLowerCase().includes(t)))
      .slice(0, 300);
  }, [cat, pestana, t, marcaDe]);

  async function guardar(x: { id: string; activo: boolean }, cambio: Record<string, unknown>) {
    try {
      const tabla = { marcas: "marcas", modelos: "modelos", calibres: "calibres" }[pestana];
      await pedir("PATCH", `/d11/catalogos/${tabla}/${x.id}`, { activo: x.activo, ...cambio });
      toast.ok("Catálogo actualizado.");
      setEditando(null);
      cargar();
    } catch (e: any) {
      toast.error(e.message);
    }
  }
  async function agregar() {
    try {
      const ruta = `/d11/catalogos/${pestana}`;
      const cuerpo = pestana === "marcas" ? { nombre: nuevo.nombre, pais: nuevo.pais || null } : pestana === "modelos" ? { marcaId: nuevo.marcaId, nombre: nuevo.nombre } : { nombre: nuevo.nombre, cip: nuevo.cip };
      await pedir("POST", ruta, cuerpo);
      toast.ok("Añadido al catálogo.");
      setNuevo({ nombre: "", pais: "", marcaId: "", cip: false });
      cargar();
    } catch (e: any) {
      toast.error(e.message);
    }
  }
  const tab = (k: Pestana, l: string, n: number) => (
    <button type="button" role="tab" aria-selected={pestana === k} className={`tab ${pestana === k ? "active" : ""}`} onClick={() => { setPestana(k); setEditando(null); }}>
      {l} ({n})
    </button>
  );

  return (
    <div>
      <PageHeader
        icono="🗂"
        titulo="Catálogo de armas"
        subtitulo="Marcas con su país de origen, modelos por marca y calibres. Las marcas vienen del catálogo de la D11 del LIMS actual (adopción por confirmar con el IDIC, EP-11 P9)."
        migas={[{ label: "BPCH · SAEC" }, { label: "Certificación de armas", href: "/saec/ot" }, { label: "Catálogo de armas" }]}
      />
      {!cat ? (
        <p className="subtitle">Cargando…</p>
      ) : (
        <div className="card">
          <div className="tabs" role="tablist" style={{ marginBottom: 10 }}>
            {tab("marcas", "Marcas", cat.marcas.length)}
            {tab("modelos", "Modelos", cat.modelos.length)}
            {tab("calibres", "Calibres", cat.calibres.length)}
          </div>
          <div className="toolbar" style={{ marginTop: 0 }}>
            <label className="sr-only" htmlFor="cat-q">Buscar</label>
            <input id="cat-q" placeholder="Buscar" value={q} onChange={(e) => setQ(e.target.value)} />
            <small style={{ color: "var(--muted)" }}>{filas.length === 300 ? "Se muestran las primeras 300: afine la búsqueda." : `${filas.length} resultado(s)`}</small>
          </div>
          {cat.puedeAgregar && (
            <div className="toolbar" style={{ background: "#f6f9fb", border: "1px solid var(--line)", borderRadius: 7, padding: 8 }}>
              <b style={{ fontSize: 12 }}>Añadir:</b>
              {pestana === "modelos" && (
                <select aria-label="Marca del modelo nuevo" value={nuevo.marcaId} onChange={(e) => setNuevo({ ...nuevo, marcaId: e.target.value })} style={{ maxWidth: 260 }}>
                  <option value="">Marca…</option>
                  {cat.marcas.filter((m) => m.activo).map((m) => <option key={m.id} value={m.id}>{m.nombre}{m.pais ? ` (${m.pais})` : ""}</option>)}
                </select>
              )}
              <input aria-label="Nombre" placeholder="Nombre" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} maxLength={160} />
              {pestana === "marcas" && <input aria-label="País" placeholder="País" value={nuevo.pais} onChange={(e) => setNuevo({ ...nuevo, pais: e.target.value })} maxLength={80} />}
              {pestana === "calibres" && <label style={{ fontSize: 12 }}><input type="checkbox" checked={nuevo.cip} onChange={(e) => setNuevo({ ...nuevo, cip: e.target.checked })} /> C.I.P.</label>}
              <button type="button" className="btn outline sm" disabled={!nuevo.nombre.trim() || (pestana === "modelos" && !nuevo.marcaId)} onClick={agregar}>Añadir</button>
            </div>
          )}
          <table className="data">
            <thead>
              <tr>
                <th>Nombre</th>
                {pestana === "marcas" && <th>País</th>}
                {pestana === "modelos" && <th>Marca</th>}
                {pestana === "calibres" && <th>C.I.P.</th>}
                <th>Estado</th>
                {cat.puedeEditar && <th></th>}
              </tr>
            </thead>
            <tbody>
              {filas.map((x: any) => {
                const ed = editando?.id === x.id;
                return (
                  <tr key={x.id} style={{ opacity: x.activo ? 1 : 0.55 }}>
                    <td>{ed ? <input aria-label="Nombre" value={editando!.nombre} onChange={(e) => setEditando({ ...editando!, nombre: e.target.value })} /> : x.nombre}</td>
                    {pestana === "marcas" && <td>{ed ? <input aria-label="País" value={editando!.pais} onChange={(e) => setEditando({ ...editando!, pais: e.target.value })} /> : x.pais ?? "—"}</td>}
                    {pestana === "modelos" && <td>{marcaDe.get(x.marcaId)?.nombre ?? "—"}</td>}
                    {pestana === "calibres" && <td>{ed ? <input type="checkbox" aria-label="C.I.P." checked={editando!.cip} onChange={(e) => setEditando({ ...editando!, cip: e.target.checked })} /> : x.cip ? "Sí" : "No"}</td>}
                    <td>{x.activo ? <span className="pill green">Activo</span> : <span className="pill gray">Inactivo</span>}{x.origen === "catalogo" ? <small style={{ color: "var(--muted)" }}> · LIMS actual</small> : null}</td>
                    {cat.puedeEditar && (
                      <td style={{ whiteSpace: "nowrap" }}>
                        {ed ? (
                          <>
                            <button type="button" className="btn primary sm" onClick={() => guardar(x, { nombre: editando!.nombre, ...(pestana === "marcas" ? { pais: editando!.pais } : {}), ...(pestana === "calibres" ? { cip: editando!.cip } : {}) })}>Guardar</button>{" "}
                            <button type="button" className="btn outline sm" onClick={() => setEditando(null)}>Cancelar</button>
                          </>
                        ) : (
                          <>
                            <button type="button" className="btn outline sm" onClick={() => setEditando({ id: x.id, nombre: x.nombre, pais: x.pais ?? "", cip: Boolean(x.cip) })}>Corregir</button>{" "}
                            <button type="button" className="btn ghost sm" onClick={() => guardar({ id: x.id, activo: !x.activo }, {})}>{x.activo ? "Desactivar" : "Activar"}</button>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
