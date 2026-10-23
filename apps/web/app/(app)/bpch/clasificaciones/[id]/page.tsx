"use client";

/**
 * Ficha de una sustancia y su clasificación (BPCH).
 *  1. Antecedentes (sustancia, fabricante/origen, OT y muestra de las pruebas).
 *  2. Pruebas ONU (registro SAC-PG01-FORM12): IT21, IT22 Koenen, IT23 TPT. El
 *     servidor calcula +/− con los criterios de cada IT al guardar.
 *  3. Decisión de quien clasifica: ¿explosiva?, clase/división, grupo de
 *     compatibilidad, Nº ONU, designación y justificación.
 *  4. Registrar → aprobar (otra persona) → documento sellado (HTML / PDF).
 * Ruta /bpch/clasificaciones/nueva = alta.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { toast, confirmar } from "@/components/ui/feedback";
import Modal from "@/components/documentos/Modal";
import BuscadorOt, { type OtCorta } from "@/components/BuscadorOt";
import SelectorFabricante, { type Fabricante } from "@/components/bpch-procesos/SelectorFabricante";
import { usePermisos } from "@/lib/permisos";
import { llamar } from "@/lib/laboratorio";
import { fechaHora } from "@/lib/format";
import { ESTADO_CLASIFICACION, RESULTADO_PRUEBA, abrirDocumento } from "@/lib/bpchProcesos";
import BarraFases from "@/components/bpch-procesos/BarraFases";
import { descargarAdjunto, subirFormulario } from "@/lib/d11";

type EnsayoIt21 = { tuboFragmentado: boolean; placaPerforada: boolean; observacion?: string | null };
type EnsayoIt22 = { orificioMm: number | ""; efecto: string; tiempoS?: number | "" | null; masaFragmentosG?: number | "" | null };
type EnsayoIt23 = { presionMaxKpa: number | ""; tiempoMs?: number | "" | null };
type Num = number | "" | null | undefined;
interface Pruebas {
  it21: { aplica: boolean; serie1: { ensayos: EnsayoIt21[] } | null; serie2: { ensayos: EnsayoIt21[] } | null };
  it22: { aplica: boolean; serie: 1 | 2; masaMuestraG?: Num; pesoTuboG?: Num; masaHasta55mmG?: Num; pesoFinal15mmG?: Num; ensayos: EnsayoIt22[] };
  it23: { aplica: boolean; masaMuestraG?: Num; ensayos: EnsayoIt23[] };
}

const PRUEBAS_VACIAS: Pruebas = {
  it21: { aplica: false, serie1: null, serie2: null },
  it22: { aplica: false, serie: 1, masaMuestraG: "", pesoTuboG: "", masaHasta55mmG: "", pesoFinal15mmG: "", ensayos: [] },
  it23: { aplica: false, masaMuestraG: "", ensayos: [] },
};

const EFECTOS: Record<string, string> = {
  O: "O · tubo intacto",
  A: "A · combadura del fondo",
  B: "B · combadura del fondo y la pared",
  C: "C · rajadura del fondo",
  D: "D · rajadura de la pared",
  E: "E · hendimiento en dos fragmentos",
  F: "F · tres o más trozos grandes (explosión)",
  G: "G · muchos trozos pequeños (explosión)",
  H: "H · trozos muy pequeños, cierre dañado (explosión)",
};

/** Normaliza lo que llega del servidor a la forma del formulario. */
function aFormulario(p: any): Pruebas {
  return {
    it21: { aplica: Boolean(p?.it21?.aplica), serie1: p?.it21?.serie1 ?? null, serie2: p?.it21?.serie2 ?? null },
    it22: {
      aplica: Boolean(p?.it22?.aplica),
      serie: p?.it22?.serie === 2 ? 2 : 1,
      masaMuestraG: p?.it22?.masaMuestraG ?? "",
      pesoTuboG: p?.it22?.pesoTuboG ?? "",
      masaHasta55mmG: p?.it22?.masaHasta55mmG ?? "",
      pesoFinal15mmG: p?.it22?.pesoFinal15mmG ?? "",
      ensayos: p?.it22?.ensayos ?? [],
    },
    it23: { aplica: Boolean(p?.it23?.aplica), masaMuestraG: p?.it23?.masaMuestraG ?? "", ensayos: p?.it23?.ensayos ?? [] },
  };
}

const n = (v: unknown) => (v === "" || v === null || v === undefined ? null : Number(v));
/** «25,5» → 25.5; vacío → "" (sin valores por defecto). */
const decimal = (v: string): number | "" => (v.trim() === "" ? "" : Number(v.replace(",", ".")));
const verNum = (v: Num) => (v === "" || v === null || v === undefined ? "" : String(v).replace(".", ","));

/** Forma que acepta la API (números como número, vacíos fuera). */
function aApi(p: Pruebas) {
  return {
    it21: { aplica: p.it21.aplica, serie1: p.it21.serie1, serie2: p.it21.serie2 },
    it22: {
      aplica: p.it22.aplica,
      serie: p.it22.serie,
      masaMuestraG: n(p.it22.masaMuestraG),
      pesoTuboG: n(p.it22.pesoTuboG),
      masaHasta55mmG: n(p.it22.masaHasta55mmG),
      pesoFinal15mmG: n(p.it22.pesoFinal15mmG),
      ensayos: p.it22.ensayos
        .filter((e) => e.orificioMm !== "")
        .map((e) => ({ orificioMm: Number(e.orificioMm), efecto: e.efecto, tiempoS: n(e.tiempoS), masaFragmentosG: n(e.masaFragmentosG) })),
    },
    it23: {
      aplica: p.it23.aplica,
      masaMuestraG: n(p.it23.masaMuestraG),
      ensayos: p.it23.ensayos.filter((e) => e.presionMaxKpa !== "").map((e) => ({ presionMaxKpa: Number(e.presionMaxKpa), tiempoMs: n(e.tiempoMs) })),
    },
  };
}

function PillResultado({ r }: { r?: string }) {
  const x = RESULTADO_PRUEBA[r ?? "no_aplica"];
  return <span className={`pill ${x?.pill ?? "gray"}`}>{x?.texto ?? r}</span>;
}

export default function ClasificacionPage() {
  const { id } = useParams<{ id: string }>();
  const nueva = id === "nueva";
  const router = useRouter();
  const { puede, usuario } = usePermisos();
  const [c, setC] = useState<any>(null);
  const [cfg, setCfg] = useState<{ clasesDivision: { codigo: string; etiqueta: string }[]; gruposCompatibilidad: { codigo: string; etiqueta: string }[] } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [motivoDe, setMotivoDe] = useState<"devolver" | "anular" | null>(null);
  const [motivo, setMotivo] = useState("");

  // Formulario
  const [sustancia, setSustancia] = useState("");
  const [fabricante, setFabricante] = useState<Fabricante | null>(null);
  const [ot, setOt] = useState<OtCorta | null>(null);
  const [muestraRef, setMuestraRef] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [pruebas, setPruebas] = useState<Pruebas>(PRUEBAS_VACIAS);
  const [explosiva, setExplosiva] = useState<"" | "si" | "no">("");
  const [claseDivision, setClaseDivision] = useState("");
  const [grupo, setGrupo] = useState("");
  const [numeroOnu, setNumeroOnu] = useState("");
  const [nombreEnvio, setNombreEnvio] = useState("");
  const [justificacion, setJustificacion] = useState("");

  const volcar = useCallback((x: any) => {
    setC(x);
    setSustancia(x.sustancia ?? "");
    setFabricante(x.cliente ? { id: x.cliente.id, rut: x.cliente.rut, razonSocial: x.cliente.razonSocial } : null);
    setOt(x.ot ? { id: x.ot.id, codigo: x.ot.codigo } : null);
    setMuestraRef(x.muestraRef ?? "");
    setDescripcion(x.descripcion ?? "");
    setPruebas(aFormulario(x.pruebas));
    setExplosiva(x.explosiva === true ? "si" : x.explosiva === false ? "no" : "");
    setClaseDivision(x.claseDivision ?? "");
    setGrupo(x.grupoCompatibilidad ?? "");
    setNumeroOnu(x.numeroOnu ?? "");
    setNombreEnvio(x.nombreEnvio ?? "");
    setJustificacion(x.justificacion ?? "");
  }, []);

  async function subirCurva(archivo: File | undefined) {
    if (!archivo) return;
    try {
      const f = new FormData();
      f.append("clase", "curva_it23");
      f.append("archivo", archivo, archivo.name);
      await subirFormulario(`/bpch/clasificaciones/${id}/adjuntos`, f);
      toast.ok("Curva del MCU adjunta.");
      cargar();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  const cargar = useCallback(async () => {
    if (nueva) return;
    try {
      volcar(await llamar("GET", `/bpch/clasificaciones/${id}`));
    } catch (e: any) {
      setError(e.message);
    }
  }, [id, nueva, volcar]);

  useEffect(() => {
    cargar();
    llamar("GET", "/bpch/clasificaciones/config").then(setCfg).catch(() => setCfg(null));
  }, [cargar]);

  const editable = nueva || c?.estado === "borrador";
  const puedeRegistrar = puede("bpch.clasificacion.registrar");
  const puedeAprobar = puede("bpch.clasificacion.aprobar");
  const clases = (cfg?.clasesDivision ?? []).filter((x) => (explosiva === "si" ? x.codigo.startsWith("1.") : explosiva === "no" ? !x.codigo.startsWith("1.") : true));

  function cuerpo() {
    return {
      sustancia: sustancia.trim(),
      clienteId: fabricante?.id ?? null,
      otId: ot?.id ?? null,
      muestraRef,
      descripcion,
      pruebas: aApi(pruebas),
      explosiva: explosiva === "" ? null : explosiva === "si",
      claseDivision,
      grupoCompatibilidad: explosiva === "si" ? grupo : "",
      numeroOnu,
      nombreEnvio,
      justificacion,
    };
  }

  async function guardar(): Promise<any | null> {
    setError("");
    if (!sustancia.trim()) {
      setError("Indique la sustancia o producto.");
      return null;
    }
    setBusy(true);
    try {
      const r = nueva
        ? await llamar("POST", "/bpch/clasificaciones", cuerpo())
        : await llamar("PATCH", `/bpch/clasificaciones/${id}`, cuerpo());
      toast.ok("Guardado. El resultado de cada prueba está recalculado.");
      if (nueva) router.replace(`/bpch/clasificaciones/${r.id}` as any);
      else volcar(r);
      return r;
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function accion(ruta: string, texto: string, body?: unknown) {
    setError("");
    setBusy(true);
    try {
      const r = await llamar("POST", `/bpch/clasificaciones/${c.id}/${ruta}`, body ?? {});
      toast.ok(texto);
      if (ruta === "reclasificar") router.push(`/bpch/clasificaciones/${r.id}` as any);
      else volcar(r);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function registrar() {
    const g = await guardar();
    if (!g) return;
    if (!(await confirmar({ titulo: "¿Registrar la clasificación?", mensaje: "Quedará a la espera de que otra persona con permiso la apruebe. Ya no podrá editarla salvo que se la devuelvan.", confirmarTexto: "Registrar" })))
      return;
    await accion("registrar", "Clasificación registrada: queda por aprobar.");
  }

  /* ----------------------------------------------------- edición de pruebas */
  const setIt21 = (serie: "serie1" | "serie2", ensayos: EnsayoIt21[] | null) =>
    setPruebas((p) => ({ ...p, it21: { ...p.it21, [serie]: ensayos === null ? null : { ensayos } } }));

  function serieIt21(serie: "serie1" | "serie2", titulo: string) {
    const s = pruebas.it21[serie];
    if (!s)
      return editable ? (
        <button type="button" className="btn outline sm" onClick={() => setIt21(serie, [{ tuboFragmentado: false, placaPerforada: false }])}>＋ Registrar {titulo}</button>
      ) : (
        <p style={{ color: "var(--muted)", margin: 0 }}>{titulo}: sin ensayos.</p>
      );
    return (
      <fieldset style={{ border: "1px solid var(--line)", borderRadius: 7, padding: "8px 10px" }}>
        <legend style={{ fontSize: 12, fontWeight: 700 }}>{titulo}</legend>
        {s.ensayos.map((e, i) => (
          <div key={i} style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
            <span style={{ fontSize: 12, minWidth: 70 }}>Ensayo {i + 1}</span>
            <label style={{ fontSize: 12.5 }}>
              <input type="checkbox" disabled={!editable} checked={e.tuboFragmentado}
                onChange={(ev) => setIt21(serie, s.ensayos.map((x, j) => (j === i ? { ...x, tuboFragmentado: ev.target.checked } : x)))} /> Tubo fragmentado completamente
            </label>
            <label style={{ fontSize: 12.5 }}>
              <input type="checkbox" disabled={!editable} checked={e.placaPerforada}
                onChange={(ev) => setIt21(serie, s.ensayos.map((x, j) => (j === i ? { ...x, placaPerforada: ev.target.checked } : x)))} /> Placa testigo perforada
            </label>
            {editable && (
              <button type="button" className="btn outline sm" aria-label={`Quitar ensayo ${i + 1}`}
                onClick={() => setIt21(serie, s.ensayos.length > 1 ? s.ensayos.filter((_, j) => j !== i) : null)}>Quitar</button>
            )}
          </div>
        ))}
        {editable && s.ensayos.length < 10 && (
          <button type="button" className="btn outline sm" onClick={() => setIt21(serie, [...s.ensayos, { tuboFragmentado: false, placaPerforada: false }])}>＋ Ensayo</button>
        )}
      </fieldset>
    );
  }

  if (!nueva && !c)
    return <div>{error ? <div className="alert warn" role="alert">{error}</div> : <p style={{ color: "var(--muted)" }}>Cargando la clasificación…</p>}</div>;

  const ev = c?.evaluacion;
  const titulo = nueva ? "Nueva sustancia" : `${c?.codigo ?? ""}${c?.version > 1 ? `-V${c.version}` : ""} · ${c?.sustancia ?? ""}`;
  const est = ESTADO_CLASIFICACION[c?.estado ?? "borrador"];
  const esMia = c?.clasificadoPor?.id && usuario?.id === c.clasificadoPor.id;

  return (
    <div>
      <PageHeader
        icono="⚛"
        titulo={<>{titulo} {!nueva && c && <span className={`pill ${est?.pill}`} style={{ verticalAlign: "middle" }}>{est?.texto}</span>}</>}
        subtitulo="Pruebas de las series ONU según SAC-PG01-IT21, IT22 e IT23 (registro SAC-PG01-FORM12). Las pruebas dan un indicador; la clasificación la decide quien clasifica y la aprueba otra persona."
        migas={[{ label: "BPCH" }, { label: "Clasificación de sustancias", href: "/bpch/clasificaciones" }, { label: nueva ? "Nueva" : c?.codigo ?? "…" }]}
        acciones={
          !nueva && c?.documento ? (
            <>
              <button className="btn outline sm" onClick={() => abrirDocumento(`/bpch/clasificaciones/${c.id}/documento`).catch((e) => toast.error(e.message))}>Ver documento</button>
              <button className="btn outline sm" onClick={() => abrirDocumento(`/bpch/clasificaciones/${c.id}/pdf`).catch((e) => toast.error(e.message))}>PDF</button>
            </>
          ) : null
        }
      />
      {error && <div className="alert warn" role="alert">{error}</div>}
      {c?.devuelto && c.estado === "borrador" && (
        <div className="alert warn">Devuelta por {c.devuelto.por} el {fechaHora(c.devuelto.at)}: {c.devuelto.motivo}</div>
      )}
      {c?.anulada && <div className="alert warn">Anulada por {c.anulada.por} el {fechaHora(c.anulada.at)}: {c.anulada.motivo}</div>}
      {c?.estado === "reemplazada" && <div className="alert info">Esta versión fue reemplazada por una reclasificación posterior.</div>}
      {/* EP-08 8.19 (BL-217): fases deducidas del estado, con «Le toca a». */}
      {c && !nueva && c.estado !== "anulada" && c.estado !== "reemplazada" && (
        <BarraFases
          etiqueta="Avance de la clasificación"
          fases={[
            { clave: "antecedentes", titulo: "Antecedentes", hecho: true, detalle: c.ot ? `OT ${c.ot.codigo}` : null },
            { clave: "pruebas", titulo: "Pruebas ONU (IT21–IT23)", hecho: c.explosiva !== null && c.explosiva !== undefined || c.estado !== "borrador", leToca: "Inspector o laboratorio", accion: "Registrar los resultados de las pruebas de las series ONU" },
            { clave: "clasificar", titulo: "Clasificación", hecho: c.estado !== "borrador", leToca: "Quien clasifica (SCC)", accion: "Decidir la clase y registrar la clasificación" },
            { clave: "aprobar", titulo: "Aprobación", hecho: c.estado === "aprobada", leToca: "Jefatura (otra persona)", accion: "Aprobar la clasificación o devolverla con motivo" },
            { clave: "documento", titulo: "Documento sellado", hecho: Boolean(c.documento), detalle: c.documento?.numero ?? null, leToca: "Sistema al aprobar", accion: "Se sella al aprobar" },
          ]}
        />
      )}
      {!nueva && !editable && c?.estado !== "anulada" && (
        <div className="alert info">La clasificación está «{est?.texto}»: los datos no se editan.{c?.estado === "registrada" ? " La jefatura puede aprobarla o devolverla con un motivo." : ""}</div>
      )}

      {/* 1 · Antecedentes */}
      <div className="card" style={{ padding: 14 }}>
        <h2 style={{ fontSize: 14, margin: "0 0 10px" }}>1 · Sustancia y antecedentes</h2>
        <div className="form-grid cols-2">
          <div className="field span-2">
            <label htmlFor="sust">Sustancia / producto <span className="req">*</span></label>
            <input id="sust" value={sustancia} onChange={(e) => setSustancia(e.target.value)} maxLength={240} disabled={!editable} />
          </div>
          {editable ? (
            <SelectorFabricante
              valor={fabricante}
              onCambio={setFabricante}
              requerido={false}
              etiqueta="Fabricante / origen"
              rutaAlta={puede("bpch.pn.gestionar") ? "/bpch/pn/fabricantes" : "/bpch/prototipos/fabricantes"}
              puedeCrear={puede("bpch.pn.gestionar") || puede("bpch.prototipo.gestionar")}
            />
          ) : (
            <div className="field readonly"><label>Fabricante / origen</label><input readOnly value={fabricante ? `${fabricante.razonSocial} · ${fabricante.rut}` : "—"} /></div>
          )}
          {editable ? (
            <BuscadorOt valor={ot} onCambio={setOt} etiqueta="OT en que se hicieron las pruebas (opcional)" />
          ) : (
            <div className="field readonly"><label>OT de las pruebas</label><input readOnly value={ot?.codigo ?? "—"} /></div>
          )}
          <div className="field">
            <label htmlFor="muestra">Muestra</label>
            <input id="muestra" value={muestraRef} onChange={(e) => setMuestraRef(e.target.value)} maxLength={120} disabled={!editable} placeholder="Identificación de la muestra extraída del lote" />
          </div>
          <div className="field span-2">
            <label htmlFor="desc">Antecedentes técnicos</label>
            <textarea id="desc" rows={2} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} disabled={!editable} />
          </div>
        </div>
      </div>

      {/* 2 · Pruebas ONU */}
      <div className="card" style={{ padding: 14 }}>
        <h2 style={{ fontSize: 14, margin: "0 0 4px" }}>2 · Pruebas ONU (planilla SAC-PG01-FORM12)</h2>
        <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--muted)" }}>
          Marque «Aplica» en las pruebas realizadas. Al guardar, el sistema calcula el resultado de cada una con el criterio de su instrucción de trabajo.
        </p>

        <section style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ fontWeight: 700, fontSize: 13 }}>
              <input type="checkbox" checked={pruebas.it21.aplica} disabled={!editable}
                onChange={(e) => setPruebas((p) => ({ ...p, it21: { ...p.it21, aplica: e.target.checked } }))} /> SAC-PG01-IT21 · Excitación con barrera interpuesta (Serie 1 y 2)
            </label>
            {ev && <PillResultado r={ev.it21.resultado} />}
            {ev?.it21?.resultado !== "no_aplica" && ev && <small style={{ color: "var(--muted)" }}>{ev.it21.detalle}</small>}
          </div>
          <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "4px 0 8px" }}>Positivo si el tubo se fragmenta completamente o la placa testigo resulta perforada. Si el primer ensayo no detona, se efectúa un segundo.</p>
          {pruebas.it21.aplica && (
            <div style={{ display: "grid", gap: 8 }}>
              {serieIt21("serie1", "Serie 1 (sin barrera)")}
              {serieIt21("serie2", "Serie 2 (con barrera de 50 mm)")}
            </div>
          )}
        </section>

        <section style={{ borderTop: "1px solid var(--line)", paddingTop: 10, marginTop: 10 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ fontWeight: 700, fontSize: 13 }}>
              <input type="checkbox" checked={pruebas.it22.aplica} disabled={!editable}
                onChange={(e) => setPruebas((p) => ({ ...p, it22: { ...p.it22, aplica: e.target.checked } }))} /> SAC-PG01-IT22 · Koenen (Koenen Tester KT300)
            </label>
            {ev && <PillResultado r={ev.it22.resultado} />}
            {ev?.it22?.resultado !== "no_aplica" && ev && <small style={{ color: "var(--muted)" }}>{ev.it22.detalle}</small>}
          </div>
          <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "4px 0 8px" }}>
            Placas de 12 → 5 → 1 mm (Serie 1) o 12 → 5 → 2 mm (Serie 2); la prueba termina al estallar. Efectos F, G y H = explosión. Positivo si el diámetro límite es ≥ 1,0 mm (Serie 1) o ≥ 2,0 mm (Serie 2).
          </p>
          {pruebas.it22.aplica && (
            <div style={{ display: "grid", gap: 6 }}>
              <div className="form-grid cols-4">
                <div className="field">
                  <label htmlFor="k-serie">Serie</label>
                  <select id="k-serie" value={pruebas.it22.serie} disabled={!editable}
                    onChange={(e) => setPruebas((p) => ({ ...p, it22: { ...p.it22, serie: Number(e.target.value) === 2 ? 2 : 1 } }))}>
                    <option value={1}>Serie 1</option>
                    <option value={2}>Serie 2</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="k-masa">Masa de muestra (g)</label>
                  <input id="k-masa" inputMode="decimal" value={verNum(pruebas.it22.masaMuestraG)} disabled={!editable}
                    onChange={(e) => setPruebas((p) => ({ ...p, it22: { ...p.it22, masaMuestraG: decimal(e.target.value) } }))} />
                </div>
              </div>
              <fieldset style={{ border: "1px dashed var(--line)", borderRadius: 6, padding: "6px 10px" }}>
                <legend style={{ fontSize: 12, fontWeight: 600 }}>Ensayo previo (IT22 §3 · FORM12)</legend>
                <div className="form-grid cols-4">
                  <div className="field">
                    <label htmlFor="k-tubo">Peso del tubo (g)</label>
                    <input id="k-tubo" inputMode="decimal" value={verNum(pruebas.it22.pesoTuboG)} disabled={!editable}
                      onChange={(e) => setPruebas((p) => ({ ...p, it22: { ...p.it22, pesoTuboG: decimal(e.target.value) } }))} />
                  </div>
                  <div className="field">
                    <label htmlFor="k-55">Masa hasta 55 mm (g)</label>
                    <input id="k-55" inputMode="decimal" value={verNum(pruebas.it22.masaHasta55mmG)} disabled={!editable}
                      onChange={(e) => setPruebas((p) => ({ ...p, it22: { ...p.it22, masaHasta55mmG: decimal(e.target.value) } }))} />
                  </div>
                  <div className="field">
                    <label htmlFor="k-15">Peso final hasta 15 mm (g)</label>
                    <input id="k-15" inputMode="decimal" value={verNum(pruebas.it22.pesoFinal15mmG)} disabled={!editable}
                      onChange={(e) => setPruebas((p) => ({ ...p, it22: { ...p.it22, pesoFinal15mmG: decimal(e.target.value) } }))} />
                  </div>
                </div>
              </fieldset>
              {pruebas.it22.ensayos.map((e, i) => (
                <div key={i} className="form-grid cols-4" style={{ alignItems: "end" }}>
                  <div className="field">
                    <label htmlFor={`k-or-${i}`}>Ensayo {i + 1} · orificio (mm)</label>
                    <select id={`k-or-${i}`} value={e.orificioMm} disabled={!editable}
                      onChange={(x) => setPruebas((p) => ({ ...p, it22: { ...p.it22, ensayos: p.it22.ensayos.map((y, j) => (j === i ? { ...y, orificioMm: x.target.value === "" ? "" : Number(x.target.value) } : y)) } }))}>
                      <option value="">—</option>
                      {[12, 5, 2, 1].map((d) => <option key={d} value={d}>{d} mm</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor={`k-ef-${i}`}>Efecto observado</label>
                    <select id={`k-ef-${i}`} value={e.efecto} disabled={!editable}
                      onChange={(x) => setPruebas((p) => ({ ...p, it22: { ...p.it22, ensayos: p.it22.ensayos.map((y, j) => (j === i ? { ...y, efecto: x.target.value } : y)) } }))}>
                      {Object.entries(EFECTOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  <div className="field" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    <div>
                      <label htmlFor={`k-ti-${i}`}>Tiempo (s)</label>
                      <input id={`k-ti-${i}`} inputMode="decimal" value={verNum(e.tiempoS)} disabled={!editable}
                        onChange={(x) => setPruebas((p) => ({ ...p, it22: { ...p.it22, ensayos: p.it22.ensayos.map((y, j) => (j === i ? { ...y, tiempoS: decimal(x.target.value) } : y)) } }))} />
                    </div>
                    <div>
                      <label htmlFor={`k-mf-${i}`}>Fragmentos (g)</label>
                      <input id={`k-mf-${i}`} inputMode="decimal" value={verNum(e.masaFragmentosG)} disabled={!editable}
                        onChange={(x) => setPruebas((p) => ({ ...p, it22: { ...p.it22, ensayos: p.it22.ensayos.map((y, j) => (j === i ? { ...y, masaFragmentosG: decimal(x.target.value) } : y)) } }))} />
                    </div>
                  </div>
                  {editable ? (
                    <button type="button" className="btn outline sm" aria-label={`Quitar ensayo ${i + 1}`}
                      onClick={() => setPruebas((p) => ({ ...p, it22: { ...p.it22, ensayos: p.it22.ensayos.filter((_, j) => j !== i) } }))}>Quitar</button>
                  ) : <span />}
                </div>
              ))}
              {editable && pruebas.it22.ensayos.length < 10 && (
                <div>
                  <button type="button" className="btn outline sm"
                    onClick={() => setPruebas((p) => ({ ...p, it22: { ...p.it22, ensayos: [...p.it22.ensayos, { orificioMm: "", efecto: "O" }] } }))}>＋ Ensayo</button>
                </div>
              )}
            </div>
          )}
        </section>

        <section style={{ borderTop: "1px solid var(--line)", paddingTop: 10, marginTop: 10 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ fontWeight: 700, fontSize: 13 }}>
              <input type="checkbox" checked={pruebas.it23.aplica} disabled={!editable}
                onChange={(e) => setPruebas((p) => ({ ...p, it23: { ...p.it23, aplica: e.target.checked, ensayos: p.it23.ensayos.length ? p.it23.ensayos : [{ presionMaxKpa: "" }, { presionMaxKpa: "" }, { presionMaxKpa: "" }] } }))} /> SAC-PG01-IT23 · TPT tiempo/presión
            </label>
            {ev && <PillResultado r={ev.it23.resultado} />}
            {ev?.it23?.resultado !== "no_aplica" && ev && <small style={{ color: "var(--muted)" }}>{ev.it23.detalle}</small>}
          </div>
          <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "4px 0 8px" }}>Tres ensayos. Positivo si la presión máxima alcanza 2.070 kPa; se informa el menor tiempo en pasar de 690 a 2.070 kPa.</p>
          {pruebas.it23.aplica && (
            <div className="form-grid cols-4" style={{ marginBottom: 6 }}>
              <div className="field">
                <label htmlFor="t-masa">Masa de muestra (g)</label>
                <input id="t-masa" inputMode="decimal" placeholder="5,0 según IT23" value={verNum(pruebas.it23.masaMuestraG)} disabled={!editable}
                  onChange={(e) => setPruebas((p) => ({ ...p, it23: { ...p.it23, masaMuestraG: decimal(e.target.value) } }))} />
              </div>
              <div className="field span-3">
                <span style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>Curva tiempo/presión del MCU (registro permanente)</span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  {(c?.adjuntos ?? []).filter((a: any) => a.clase === "curva_it23").map((a: any) => (
                    <button key={a.id} type="button" className="btn outline sm" onClick={() => descargarAdjunto(`/bpch/clasificaciones/${id}/adjuntos/${a.id}`, a.nombre).catch((x) => toast.error(x.message))}>⭳ {a.nombre}</button>
                  ))}
                  {!nueva && (c?.estado === "borrador" || c?.estado === "registrada") && puede("bpch.clasificacion.registrar") && (
                    <label className="btn outline sm" style={{ cursor: "pointer", textTransform: "none", letterSpacing: 0 }}>
                      ＋ Adjuntar curva (PDF, PNG o JPEG)
                      <input type="file" className="sr-only" accept="application/pdf,image/png,image/jpeg" onChange={(e) => subirCurva(e.target.files?.[0])} />
                    </label>
                  )}
                  {nueva && <small style={{ color: "var(--muted)" }}>Guarde el borrador para adjuntar la curva.</small>}
                  {!nueva && !(c?.adjuntos ?? []).some((a: any) => a.clase === "curva_it23") && !(c?.estado === "borrador" || c?.estado === "registrada") && <small style={{ color: "var(--muted)" }}>Sin curva adjunta.</small>}
                </div>
              </div>
            </div>
          )}
          {pruebas.it23.aplica && (
            <div className="form-grid cols-4">
              {pruebas.it23.ensayos.map((e, i) => (
                <div key={i} style={{ display: "contents" }}>
                  <div className="field">
                    <label htmlFor={`t-p-${i}`}>Ensayo {i + 1} · presión máx. (kPa)</label>
                    <input id={`t-p-${i}`} inputMode="decimal" value={e.presionMaxKpa} disabled={!editable}
                      onChange={(x) => setPruebas((p) => ({ ...p, it23: { ...p.it23, ensayos: p.it23.ensayos.map((y, j) => (j === i ? { ...y, presionMaxKpa: x.target.value === "" ? "" : Number(x.target.value.replace(",", ".")) } : y)) } }))} />
                  </div>
                  <div className="field">
                    <label htmlFor={`t-t-${i}`}>Tiempo 690→2.070 kPa (ms)</label>
                    <input id={`t-t-${i}`} inputMode="decimal" value={e.tiempoMs ?? ""} disabled={!editable}
                      onChange={(x) => setPruebas((p) => ({ ...p, it23: { ...p.it23, ensayos: p.it23.ensayos.map((y, j) => (j === i ? { ...y, tiempoMs: x.target.value === "" ? "" : Number(x.target.value.replace(",", ".")) } : y)) } }))} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {ev && (
          <div className={`alert ${ev.indicaExplosiva ? "warn" : "info"}`} style={{ marginTop: 12 }}>
            <b>Indicador de las pruebas:</b>{" "}
            {ev.indicaExplosiva === null
              ? ev.incompletas?.length
                ? "faltan ensayos para concluir."
                : "sin pruebas registradas."
              : ev.indicaExplosiva
                ? "alguna prueba es positiva: comportamiento explosivo."
                : "todas las pruebas son negativas."}
          </div>
        )}
      </div>

      {/* 3 · Decisión */}
      <div className="card" style={{ padding: 14 }}>
        <h2 style={{ fontSize: 14, margin: "0 0 10px" }}>3 · Clasificación</h2>
        <div className="form-grid">
          <fieldset className="field" style={{ border: "none", padding: 0, margin: 0 }}>
            <legend style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", fontWeight: 600, marginBottom: 3 }}>¿Es explosiva (Clase 1)? <span className="req">*</span></legend>
            <div style={{ display: "flex", gap: 14, paddingTop: 4 }}>
              <label><input type="radio" name="explosiva" disabled={!editable} checked={explosiva === "si"} onChange={() => { setExplosiva("si"); if (claseDivision && !claseDivision.startsWith("1.")) setClaseDivision(""); }} /> Sí</label>
              <label><input type="radio" name="explosiva" disabled={!editable} checked={explosiva === "no"} onChange={() => { setExplosiva("no"); setGrupo(""); if (claseDivision.startsWith("1.")) setClaseDivision(""); }} /> No</label>
            </div>
          </fieldset>
          <div className="field">
            <label htmlFor="clase">Clase / División{explosiva === "si" && <span className="req"> *</span>}</label>
            <select id="clase" value={claseDivision} onChange={(e) => setClaseDivision(e.target.value)} disabled={!editable || explosiva === ""}>
              <option value="">{explosiva === "" ? "Responda primero si es explosiva" : "— Seleccione —"}</option>
              {clases.map((x) => <option key={x.codigo} value={x.codigo}>{x.etiqueta}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="grupo">Grupo de compatibilidad</label>
            <select id="grupo" value={grupo} onChange={(e) => setGrupo(e.target.value)} disabled={!editable || explosiva !== "si"}>
              <option value="">{explosiva === "si" ? "— Sin grupo —" : "Solo Clase 1"}</option>
              {(cfg?.gruposCompatibilidad ?? []).map((x) => <option key={x.codigo} value={x.codigo}>{x.etiqueta}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="onu">Nº ONU</label>
            <input id="onu" value={numeroOnu} onChange={(e) => setNumeroOnu(e.target.value)} maxLength={10} placeholder="4 dígitos, p. ej. 0081" disabled={!editable} />
          </div>
          <div className="field span-2">
            <label htmlFor="envio">Designación oficial de transporte</label>
            <input id="envio" value={nombreEnvio} onChange={(e) => setNombreEnvio(e.target.value)} maxLength={300} disabled={!editable} />
          </div>
          <div className="field span-3">
            <label htmlFor="just">Justificación</label>
            <textarea id="just" rows={2} value={justificacion} onChange={(e) => setJustificacion(e.target.value)} disabled={!editable}
              placeholder="Obligatoria si la decisión contradice las pruebas o si no se registró ninguna prueba" />
          </div>
        </div>
        {c && (
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 12.5, marginTop: 10 }}>
            <div><span style={{ color: "var(--muted)" }}>Clasificó:</span> {c.clasificadoPor ? `${c.clasificadoPor.nombre} · ${fechaHora(c.clasificadoAt)}` : "—"}</div>
            <div><span style={{ color: "var(--muted)" }}>Aprobó:</span> {c.aprobadoPor ? `${c.aprobadoPor.nombre} · ${fechaHora(c.aprobadoAt)}` : "—"}</div>
            {c.documento && <div><span style={{ color: "var(--muted)" }}>Documento:</span> {c.documento.numero}</div>}
          </div>
        )}
      </div>

      {/* Acciones */}
      <div className="toolbar" style={{ gap: 8, flexWrap: "wrap" }}>
        {editable && puedeRegistrar && (
          <>
            <button className="btn outline sm" disabled={busy} onClick={guardar}>{busy ? "Guardando…" : nueva ? "Crear borrador" : "Guardar borrador"}</button>
            {!nueva && <button className="btn primary sm" disabled={busy} onClick={registrar}>Registrar clasificación</button>}
          </>
        )}
        {c?.estado === "registrada" && puedeAprobar && (
          <>
            <button className="btn primary sm" disabled={busy || esMia}
              title={esMia ? "Quien clasificó no puede aprobar su propia clasificación" : undefined}
              onClick={async () => {
                if (await confirmar({ titulo: "¿Aprobar la clasificación?", mensaje: "Se genera y sella el documento de clasificación. Solo una clasificación aprobada se puede usar en Producción Nacional y Prototipos.", confirmarTexto: "Aprobar" }))
                  accion("aprobar", "Clasificación aprobada: documento sellado.");
              }}>Aprobar</button>
            <button className="btn outline sm" disabled={busy} onClick={() => { setMotivo(""); setMotivoDe("devolver"); }}>Devolver</button>
          </>
        )}
        {c?.estado === "aprobada" && puedeRegistrar && (
          <button className="btn outline sm" disabled={busy}
            onClick={async () => {
              if (await confirmar({ titulo: "¿Reclasificar?", mensaje: "Se crea una nueva versión en borrador con estos datos. La versión actual sigue vigente hasta que se apruebe la nueva.", confirmarTexto: "Crear nueva versión" }))
                accion("reclasificar", "Nueva versión creada.");
            }}>Reclasificar</button>
        )}
        {c && !["anulada", "reemplazada"].includes(c.estado) && puedeAprobar && (
          <button className="btn danger sm" disabled={busy} onClick={() => { setMotivo(""); setMotivoDe("anular"); }}>Anular</button>
        )}
        {esMia && c?.estado === "registrada" && <small style={{ color: "var(--muted)" }}>Usted clasificó esta sustancia: la aprueba otra persona.</small>}
      </div>

      {c && (c.usos?.prototipos?.length > 0 || c.usos?.productosPn?.length > 0 || c.versiones?.length > 1) && (
        <div className="card" style={{ padding: 14 }}>
          <h2 style={{ fontSize: 14, margin: "0 0 8px" }}>Uso en otros procesos</h2>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
            {c.usos.prototipos.map((p: any) => <li key={p.id}>Prototipo <Link href={`/bpch/prototipos/${p.id}` as any}>{p.codigo}</Link> · {p.elemento}</li>)}
            {c.usos.productosPn.map((p: any) => <li key={p.id}>Producción Nacional · O/C <Link href={`/bpch/produccion-nacional/${p.ocId}` as any}>{p.ocNumero}</Link> · {p.producto}</li>)}
            {c.versiones.length > 1 && c.versiones.map((v: any) => (
              <li key={v.id}>Versión {v.version}: {ESTADO_CLASIFICACION[v.estado]?.texto ?? v.estado}{v.id !== c.id ? <> · <Link href={`/bpch/clasificaciones/${v.id}` as any}>abrir</Link></> : " (esta)"}</li>
            ))}
          </ul>
        </div>
      )}

      {motivoDe && (
        <Modal
          titulo={motivoDe === "devolver" ? "Devolver la clasificación" : "Anular la clasificación"}
          onCerrar={() => setMotivoDe(null)}
          acciones={
            <>
              <button className="btn outline sm" onClick={() => setMotivoDe(null)}>Cancelar</button>
              <button className={`btn sm ${motivoDe === "anular" ? "danger" : "primary"}`} disabled={busy || motivo.trim().length < 5}
                onClick={async () => { const que = motivoDe; setMotivoDe(null); await accion(que, que === "devolver" ? "Devuelta a quien clasificó." : "Clasificación anulada.", { motivo }); }}>
                {motivoDe === "devolver" ? "Devolver" : "Anular"}
              </button>
            </>
          }
        >
          <div className="field">
            <label htmlFor="motivo">Motivo <span className="req">*</span></label>
            <textarea id="motivo" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Al menos 5 caracteres" />
          </div>
        </Modal>
      )}
    </div>
  );
}
