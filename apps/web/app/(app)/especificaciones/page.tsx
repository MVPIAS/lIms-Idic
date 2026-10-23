"use client";

/**
 * Biblioteca de especificaciones técnicas del cliente (E.T. / EETT) · EP-05 5.1,
 * EP-03 0.5. Cada E.T. tiene versiones: el borrador se edita, la vigente se elige
 * en las OT y se congela; la anterior queda «reemplazada» y las OT que la
 * eligieron la conservan. Solo las E.T. de los laboratorios del usuario (y las
 * generales, sin laboratorio). API: GET/POST /especificaciones-tecnicas.
 */
import ClienteEt from "./_components/ClienteEt";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import DataTable, { type DataColumn } from "@/components/DataTable";
import { EmptyState, PageHeader } from "@/components/ui/PageHeader";
import Modal from "@/components/documentos/Modal";
import { toast } from "@/components/ui/feedback";
import { llamar, qs } from "@/lib/laboratorio";
import { fechaDia } from "@/lib/format";
import { usePermisos } from "@/lib/permisos";
import { ESTADO_ET, ORIGEN_ET, type EstadoEt } from "@/lib/especificaciones";

interface FilaEt {
  id: string;
  codigo: string;
  version: number;
  nombre: string;
  origen: string;
  clienteNombre: string | null;
  licitacion: string | null;
  producto: string | null;
  laboratoriosCodigos: string[];
  reutilizable: boolean;
  estado: EstadoEt;
  vigenteDesde: string | null;
  nPuntos: number;
  pdf: { nombre: string } | null;
}
interface Lab { id: string; codigo: string; nombre: string }

const FILTROS: { valor: string; texto: string }[] = [
  { valor: "", texto: "Vigentes y borradores" },
  { valor: "vigente", texto: "Vigentes" },
  { valor: "borrador", texto: "Borradores" },
  { valor: "todas", texto: "Todas las versiones" },
];

export default function BibliotecaEtPage() {
  const router = useRouter();
  const { puede } = usePermisos();
  const [filas, setFilas] = useState<FilaEt[] | null>(null);
  const [labs, setLabs] = useState<Lab[]>([]);
  const [puedeCrear, setPuedeCrear] = useState(false);
  const [estado, setEstado] = useState("");
  // La búsqueda por texto la hace la tabla (código, nombre, cliente…); el estado, el servidor.
  const busca = "";
  const [error, setError] = useState("");
  const [nueva, setNueva] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const r = await llamar<{ data: FilaEt[]; laboratorios: Lab[]; puedeCrear: boolean }>("GET", `/especificaciones-tecnicas${qs({ estado, q: busca.trim() })}`);
      setFilas(r.data);
      setLabs(r.laboratorios);
      setPuedeCrear(r.puedeCrear);
      setError("");
    } catch (e: any) {
      setError(e.message);
      setFilas([]);
    }
  }, [estado, busca]);
  useEffect(() => {
    const t = setTimeout(cargar, busca ? 300 : 0);
    return () => clearTimeout(t);
  }, [cargar, busca]);

  const columnas: DataColumn[] = [
    {
      key: "codigo",
      label: "E.T. · versión",
      value: (f) => `${f.codigo} v${f.version}`,
      render: (f: FilaEt) => (
        <Link href={`/especificaciones/${f.id}` as any} style={{ color: "var(--accent)", fontWeight: 600 }}>
          {f.codigo} <span style={{ color: "var(--muted)", fontWeight: 400 }}>v{f.version}</span>
        </Link>
      ),
    },
    { key: "nombre", label: "Nombre", value: (f) => f.nombre },
    {
      key: "origen",
      label: "Cliente o fuente",
      value: (f) => f.clienteNombre ?? ORIGEN_ET[f.origen] ?? f.origen,
      render: (f: FilaEt) => (
        <>
          {f.clienteNombre ?? ORIGEN_ET[f.origen] ?? f.origen}
          {f.licitacion && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>Licitación {f.licitacion}</div>}
        </>
      ),
    },
    { key: "laboratorios", label: "Laboratorios", value: (f) => f.laboratoriosCodigos.join(", ") || "General" },
    { key: "nPuntos", label: "Puntos", num: true, value: (f) => f.nPuntos },
    {
      key: "estado",
      label: "Estado",
      value: (f) => f.estado,
      render: (f: FilaEt) => (
        <span style={{ whiteSpace: "nowrap" }}>
          <span className={`pill ${ESTADO_ET[f.estado].pill}`} title={ESTADO_ET[f.estado].ayuda}>{ESTADO_ET[f.estado].texto}</span>
          {f.estado === "vigente" && f.vigenteDesde && <span style={{ marginLeft: 6, fontSize: 11.5, color: "var(--muted)" }}>desde {fechaDia(f.vigenteDesde)}</span>}
        </span>
      ),
    },
    { key: "pdf", label: "PDF", value: (f) => (f.pdf ? "Sí" : "No"), render: (f: FilaEt) => (f.pdf ? "📄" : <span style={{ color: "var(--muted)" }}>—</span>) },
  ];

  return (
    <div>
      <PageHeader
        icono="📘"
        titulo="Especificaciones técnicas del cliente"
        subtitulo="Requisitos por punto de cada E.T. (o norma), versionados. La OT o la muestra eligen la E.T. vigente y sus ensayos toman el requisito de su punto."
        migas={[{ label: "Laboratorio" }, { label: "Especificaciones técnicas" }]}
        acciones={puedeCrear && <button type="button" className="btn primary sm" onClick={() => setNueva(true)}>＋ Nueva E.T.</button>}
      />
      {error && <div className="alert warn" role="alert">{error}</div>}
      <div className="toolbar" style={{ flexWrap: "wrap", gap: 8 }}>
        <div role="group" aria-label="Filtrar por estado" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {FILTROS.map((f) => (
            <button key={f.valor} type="button" className={`btn sm ${estado === f.valor ? "primary" : "outline"}`} aria-pressed={estado === f.valor} onClick={() => setEstado(f.valor)}>
              {f.texto}
            </button>
          ))}
        </div>
      </div>
      {filas === null ? (
        <p className="subtitle">Cargando la biblioteca…</p>
      ) : filas.length === 0 ? (
        <EmptyState
          icono="📘"
          titulo={busca || estado ? "Ninguna E.T. coincide con la búsqueda" : "Aún no hay especificaciones técnicas"}
          texto={puedeCrear ? "Cree la primera con «＋ Nueva E.T.»: código, versión, PDF y sus requisitos por punto." : "Las crea la jefatura del laboratorio o Gestión de Calidad."}
        />
      ) : (
        <DataTable columns={columnas} rows={filas} rowKey={(f) => f.id} headerSearch searchKeys={["codigo", "nombre", "origen", "laboratorios"]}
          onRowClick={(f) => router.push(`/especificaciones/${f.id}` as any)} />
      )}
      {nueva && <NuevaEt labs={labs} onCerrar={() => setNueva(false)} onCreada={(id) => { setNueva(false); cargar(); router.push(`/especificaciones/${id}` as any); }} />}
    </div>
  );
}

function NuevaEt({ labs, onCerrar, onCreada }: { labs: Lab[]; onCerrar: () => void; onCreada: (id: string) => void }) {
  const [f, setF] = useState({ codigo: "", nombre: "", origen: "cliente", mandante: "", licitacion: "", producto: "", reutilizable: true });
  const [laboratorios, setLaboratorios] = useState<string[]>([]);
  const [cliente, setCliente] = useState<{ id: string; nombre: string } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof f, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));


  async function crear() {
    setError("");
    if (!f.codigo.trim() || !f.nombre.trim()) { setError("Indique el código y el nombre de la E.T."); return; }
    setGuardando(true);
    try {
      const et = await llamar<{ id: string }>("POST", "/especificaciones-tecnicas", {
        codigo: f.codigo.trim(), nombre: f.nombre.trim(), origen: f.origen, laboratorios, reutilizable: f.reutilizable,
        clienteId: cliente?.id ?? null, mandante: f.mandante.trim() || null, licitacion: f.licitacion.trim() || null, producto: f.producto.trim() || null,
      });
      toast.ok("E.T. creada en borrador: cargue sus puntos y publíquela.");
      onCreada(et.id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      titulo="Nueva especificación técnica"
      ancho={620}
      onCerrar={onCerrar}
      acciones={
        <>
          <button type="button" className="btn outline sm" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="btn primary sm" disabled={guardando} onClick={crear}>{guardando ? "Creando…" : "Crear borrador → cargar puntos"}</button>
        </>
      }
    >
      {error && <div className="alert warn" role="alert">{error}</div>}
      <div className="form-grid cols-2">
        <div className="field">
          <label htmlFor="net-codigo">Código de la E.T. <span className="req">*</span></label>
          <input id="net-codigo" value={f.codigo} maxLength={60} onChange={(e) => set("codigo", e.target.value)} placeholder="Como figura en el documento del cliente" />
        </div>
        <div className="field">
          <label htmlFor="net-origen">Tipo</label>
          <select id="net-origen" value={f.origen} onChange={(e) => set("origen", e.target.value)}>
            {Object.entries(ORIGEN_ET).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="net-nombre">Nombre <span className="req">*</span></label>
          <input id="net-nombre" value={f.nombre} maxLength={300} onChange={(e) => set("nombre", e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="net-producto">Producto</label>
          <input id="net-producto" value={f.producto} maxLength={240} onChange={(e) => set("producto", e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="net-licitacion">Licitación o contrato</label>
          <input id="net-licitacion" value={f.licitacion} maxLength={120} onChange={(e) => set("licitacion", e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="net-mandante">Mandante</label>
          <input id="net-mandante" value={f.mandante} maxLength={120} onChange={(e) => set("mandante", e.target.value)} placeholder="AME, DIVLOG…" />
        </div>
        <ClienteEt id="net-cliente" valor={cliente} onChange={setCliente} />
        <fieldset className="field" style={{ gridColumn: "1 / -1", border: "none", padding: 0, margin: 0 }}>
          <legend style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".4px", fontWeight: 600, marginBottom: 3 }}>Laboratorios donde se usa</legend>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", maxHeight: 120, overflowY: "auto" }}>
            {labs.map((l) => (
              <label key={l.id} style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 12, textTransform: "none", letterSpacing: 0, fontWeight: 400, color: "var(--ink)" }}>
                <input type="checkbox" checked={laboratorios.includes(l.id)} onChange={(e) => setLaboratorios((p) => (e.target.checked ? [...p, l.id] : p.filter((x) => x !== l.id)))} />
                {l.codigo}
              </label>
            ))}
          </div>
          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Sin laboratorio, la E.T. es general (p. ej. un reglamento) y solo la gestiona Gestión de Calidad.</span>
        </fieldset>
        <label style={{ display: "flex", gap: 6, alignItems: "center", gridColumn: "1 / -1", fontSize: 12.5 }}>
          <input type="checkbox" checked={f.reutilizable} onChange={(e) => set("reutilizable", e.target.checked)} />
          Reutilizable en OT de otros clientes (desmárquelo si la E.T. es de una sola licitación)
        </label>
      </div>
    </Modal>
  );
}
