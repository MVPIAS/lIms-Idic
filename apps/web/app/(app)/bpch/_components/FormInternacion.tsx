"use client";

/**
 * Formulario de registro de la internación (resolución DGMN): empresa
 * importadora, resolución, carril de inspección, ¿sujeta a la tasa? y los
 * elementos a internar (desde la Codificación Única o a mano). Sirve para el
 * alta y para corregir el registro antes de generar la OT.
 */
import { useState } from "react";
import { toast } from "@/components/ui/feedback";
import { BuscadorCodificacion, BuscadorElemento, BuscadorEmpresa, type ElementoCatalogo, type Empresa, type ProductoCodificado } from "./Buscadores";
import { type ConfigBpch, pedir } from "./bpch";
import ListadoArmas, { type ArmaListado, armasDesde } from "./ListadoArmas";

type Item = {
  clave: number;
  cod: ProductoCodificado | null;
  elemento: ElementoCatalogo | null;
  elementoGenerico: string;
  elementoEspecifico: string;
  cnc: string;
  claseDivisionUn: string;
  numeroUn: string;
  cantidad: string;
  unidadMedida: string;
};

let seq = 0;
const itemVacio = (): Item => ({ clave: ++seq, cod: null, elemento: null, elementoGenerico: "", elementoEspecifico: "", cnc: "", claseDivisionUn: "", numeroUn: "", cantidad: "", unidadMedida: "" });

export function FormInternacion({ config, inicial, onGuardado, onCancelar }: { config: ConfigBpch; inicial?: any; onGuardado: (r: any) => void; onCancelar?: () => void }) {
  const [empresa, setEmpresa] = useState<Empresa | null>(inicial?.cliente ?? null);
  const [f, setF] = useState({
    resolucionNumero: inicial?.resolucionNumero ?? "",
    resolucionFecha: inicial?.resolucionFecha ? String(inicial.resolucionFecha).slice(0, 10) : "",
    oficio: inicial?.oficio ?? "",
    documentoAduanero: inicial?.documentoAduanero ?? "",
    paisOrigen: inicial?.paisOrigen ?? "",
    esquema: inicial?.esquema ?? "LOTES",
    procedimiento: inicial?.procedimiento ?? "",
    unidadInspeccionId: inicial?.unidad?.id ?? "",
    sujetaTasa: inicial ? (inicial.sujetaTasa ? "si" : "no") : "",
  });
  const [items, setItems] = useState<Item[]>(
    inicial?.items?.length
      ? inicial.items.map((it: any) => ({
          clave: ++seq,
          cod: it.codificacionId ? { id: it.codificacionId, cnc: it.cnc, producto: it.elementoEspecifico, fabricanteNombre: "", estado: it.codificacionEstado ?? "VIGENTE" } : null,
          elemento: it.catElementoId ? { id: it.catElementoId, codigo: "", nombre: it.catElementoNombre ?? "" } : null,
          elementoGenerico: it.elementoGenerico ?? "",
          elementoEspecifico: it.elementoEspecifico ?? "",
          cnc: it.cnc ?? "",
          claseDivisionUn: it.claseDivisionUn ?? "",
          numeroUn: it.numeroUn ?? "",
          cantidad: it.cantidad != null ? String(it.cantidad) : "",
          unidadMedida: it.unidadMedida ?? "",
        }))
      : [itemVacio()],
  );
  const [armas, setArmas] = useState<ArmaListado[]>(() => armasDesde(inicial?.armas));
  const [errores, setErrores] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const esD11 = config.unidades.find((u) => u.id === f.unidadInspeccionId)?.codigo === "D11";
  const vacio = (it: Item) => !it.cod && !it.elemento && ![it.elementoGenerico, it.elementoEspecifico, it.cnc, it.claseDivisionUn, it.numeroUn, it.cantidad].some((x) => x.trim());
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const setItem = (clave: number, cambio: Partial<Item>) => setItems((xs) => xs.map((x) => (x.clave === clave ? { ...x, ...cambio } : x)));

  function elegirCodificado(clave: number, p: ProductoCodificado | null) {
    if (!p) return setItem(clave, { cod: null });
    setItem(clave, {
      cod: p,
      elementoEspecifico: p.producto,
      elementoGenerico: p.elementoGenerico ?? "",
      cnc: p.cnc,
      claseDivisionUn: p.claseDivisionUn ?? "",
      numeroUn: p.numeroUn ?? "",
      elemento: p.catElementoId ? { id: p.catElementoId, codigo: "", nombre: p.catElementoNombre ?? "elemento del catálogo" } : null,
    });
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    const faltan: string[] = [];
    if (!empresa) faltan.push("la empresa importadora");
    if (!f.resolucionNumero.trim()) faltan.push("el Nº de la resolución DGMN");
    if (!f.resolucionFecha) faltan.push("la fecha de la resolución");
    if (!f.unidadInspeccionId) faltan.push("la unidad que inspecciona");
    if (!f.sujetaTasa) faltan.push("si está sujeta a la tasa");
    if (esD11 && armas.some((a) => !a.tipo || !a.marca.trim())) faltan.push("el tipo y la marca de cada arma del listado");
    if (faltan.length) return setErrores(`Falta indicar ${faltan.join(", ")}.`);
    setErrores(null);
    setOcupado(true);
    const cuerpo = {
      ...f,
      clienteId: empresa!.id,
      sujetaTasa: f.sujetaTasa === "si",
      armas: esD11
        ? armas.map((a) => ({
            tipo: a.tipo, marca: a.marca.trim(), modelo: a.modelo.trim() || null, calibre: a.calibre.trim() || null,
            serie: a.serie.trim() || null, accesorios: a.accesorios.trim() || null, cantidad: Number(a.cantidad) || 1,
          }))
        : [],
      items: items.filter((it) => !(esD11 && armas.length && vacio(it))).map((it) => ({
        codificacionId: it.cod?.id ?? null,
        catElementoId: it.elemento?.id ?? null,
        elementoGenerico: it.elementoGenerico || null,
        elementoEspecifico: it.elementoEspecifico || null,
        cnc: it.cnc || null,
        claseDivisionUn: it.claseDivisionUn || null,
        numeroUn: it.numeroUn || null,
        cantidad: it.cantidad.trim() ? Number(it.cantidad.replace(",", ".")) : null,
        unidadMedida: it.unidadMedida || null,
      })),
    };
    try {
      const r = inicial ? await pedir("PATCH", `/bpch/internaciones/${inicial.id}`, cuerpo) : await pedir("POST", "/bpch/internaciones", cuerpo);
      toast.ok(inicial ? "Registro corregido." : "Internación registrada. Siguiente paso: análisis técnico (Sección Certificación).");
      onGuardado(r);
    } catch (e: any) {
      setErrores(e.message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={guardar} noValidate>
      <div className="card">
        <h2>Resolución DGMN <span className="right">disparador del proceso · no se cotiza</span></h2>
        <div className="form-grid">
          <div className="field span-2"><BuscadorEmpresa etiqueta="Empresa importadora" requerido valor={empresa} onChange={setEmpresa} /></div>
          <div className="field">
            <label htmlFor="unidad">Unidad que inspecciona <span className="req">*</span></label>
            <select id="unidad" value={f.unidadInspeccionId} onChange={set("unidadInspeccionId")} required>
              <option value="">Elija sucursal o delegación…</option>
              {config.unidades.map((u) => <option key={u.id} value={u.id}>{u.codigo} · {u.nombre}</option>)}
            </select>
          </div>
          <div className="field"><label htmlFor="res">Nº resolución DGMN <span className="req">*</span></label><input id="res" value={f.resolucionNumero} onChange={set("resolucionNumero")} maxLength={60} required /></div>
          <div className="field"><label htmlFor="resf">Fecha de la resolución <span className="req">*</span></label><input id="resf" type="date" value={f.resolucionFecha} onChange={set("resolucionFecha")} required /></div>
          <div className="field"><label htmlFor="ofi">Oficio IDIC-DGMN</label><input id="ofi" value={f.oficio} onChange={set("oficio")} maxLength={60} /></div>
          <div className="field"><label htmlFor="din">Documento aduanero (DIN)</label><input id="din" value={f.documentoAduanero} onChange={set("documentoAduanero")} maxLength={60} /></div>
          <div className="field"><label htmlFor="pais">País de origen</label><input id="pais" value={f.paisOrigen} onChange={set("paisOrigen")} maxLength={80} /></div>
          <div className="field">
            <label htmlFor="esq">Esquema</label>
            <select id="esq" value={f.esquema} onChange={set("esquema")}><option value="LOTES">Por lotes</option><option value="TIPO">Tipo</option></select>
          </div>
          <div className="field"><label htmlFor="proc">Procedimiento de control</label><input id="proc" value={f.procedimiento} onChange={set("procedimiento")} maxLength={40} placeholder="p. ej. SAC-PG01-P01" /></div>
          <div className="field">
            <label htmlFor="tasa">¿Sujeta a la tasa de internación? <span className="req">*</span></label>
            <select id="tasa" value={f.sujetaTasa} onChange={set("sujetaTasa")} required>
              <option value="">Elija…</option>
              <option value="si">Sí — se pedirá la documentación administrativa para calcularla</option>
              <option value="no">No</option>
            </select>
          </div>
        </div>
      </div>

      {esD11 && <ListadoArmas armas={armas} onCambio={setArmas} />}

      <div className="card">
        <h2>Elementos a internar <span className="right">{esD11 ? "Opcionales si hay listado de armas" : "División UN y Nº UN obligatorios"}</span></h2>
        {items.map((it, i) => (
          <fieldset key={it.clave} style={{ border: "1px solid var(--line)", borderRadius: 7, padding: 10, marginBottom: 10 }}>
            <legend style={{ fontSize: 12, fontWeight: 700, padding: "0 4px" }}>Elemento {i + 1}</legend>
            <div className="form-grid">
              <div className="field span-2"><BuscadorCodificacion valor={it.cod} onChange={(p) => elegirCodificado(it.clave, p)} /></div>
              <div className="field"><BuscadorElemento valor={it.elemento} onChange={(e) => setItem(it.clave, { elemento: e })} /></div>
              <div className="field"><label htmlFor={`gen${it.clave}`}>Elemento genérico</label><input id={`gen${it.clave}`} value={it.elementoGenerico} onChange={(e) => setItem(it.clave, { elementoGenerico: e.target.value })} maxLength={240} /></div>
              <div className="field span-2"><label htmlFor={`esp${it.clave}`}>Elemento específico (producto) <span className="req">*</span></label><input id={`esp${it.clave}`} value={it.elementoEspecifico} onChange={(e) => setItem(it.clave, { elementoEspecifico: e.target.value })} maxLength={240} /></div>
              <div className="field"><label htmlFor={`cnc${it.clave}`}>CNC-DGMN</label><input id={`cnc${it.clave}`} value={it.cnc} onChange={(e) => setItem(it.clave, { cnc: e.target.value })} maxLength={80} placeholder="E-I/n/n/n/n/n" /></div>
              <div className="field"><label htmlFor={`cl${it.clave}`}>Clase/División UN {!esD11 && <span className="req">*</span>}</label><input id={`cl${it.clave}`} value={it.claseDivisionUn} onChange={(e) => setItem(it.clave, { claseDivisionUn: e.target.value })} maxLength={20} /></div>
              <div className="field"><label htmlFor={`un${it.clave}`}>Nº UN {!esD11 && <span className="req">*</span>}</label><input id={`un${it.clave}`} value={it.numeroUn} onChange={(e) => setItem(it.clave, { numeroUn: e.target.value })} maxLength={10} /></div>
              <div className="field"><label htmlFor={`can${it.clave}`}>Cantidad</label><input id={`can${it.clave}`} inputMode="decimal" value={it.cantidad} onChange={(e) => setItem(it.clave, { cantidad: e.target.value })} /></div>
              <div className="field"><label htmlFor={`um${it.clave}`}>Unidad</label><input id={`um${it.clave}`} value={it.unidadMedida} onChange={(e) => setItem(it.clave, { unidadMedida: e.target.value })} maxLength={20} placeholder="uds, kg…" /></div>
            </div>
            {items.length > 1 && <button type="button" className="btn ghost-danger sm" style={{ marginTop: 8 }} onClick={() => setItems((xs) => xs.filter((x) => x.clave !== it.clave))}>Quitar elemento</button>}
          </fieldset>
        ))}
        <button type="button" className="btn outline sm" onClick={() => setItems((xs) => [...xs, itemVacio()])}>＋ Otro elemento</button>
      </div>

      {errores && <div className="alert warn" role="alert">{errores}</div>}
      <div className="toolbar">
        <button type="submit" className="btn primary" disabled={ocupado}>{ocupado ? "Guardando…" : inicial ? "Guardar corrección" : "Registrar internación → análisis técnico"}</button>
        {onCancelar && <button type="button" className="btn outline" onClick={onCancelar}>Cancelar</button>}
        <small style={{ color: "var(--muted)" }}>Sin cotización ni aprobación comercial: la OT se genera automáticamente al dar la información técnica por completa.</small>
      </div>
    </form>
  );
}
