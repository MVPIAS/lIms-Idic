"use client";

/**
 * Formulario de la Solicitud de adquisición de bienes y/o servicios
 * (IDIC-PG06-IT02-FORM01 Rev. 02): datos del solicitante, delegación de
 * atribuciones, ítems (cantidad, unidad, características, valor unitario
 * estimado; opcionalmente ligados a un consumible del kardex o a un equipo),
 * objetivo de la adquisición y OT relacionada. Lo usan «Nueva solicitud» y la
 * corrección de una solicitud en borrador o devuelta.
 */
import { useEffect, useMemo, useState } from "react";
import { llamar, qs } from "@/lib/laboratorio";
import { hoyISO } from "@/lib/format";
import BuscadorOt, { type OtCorta } from "@/components/BuscadorOt";
import { ITEM_VACIO, leerNumero, pesos, type ItemForm } from "@/lib/adquisiciones";

export interface SolicitudPayload {
  unidadId: string;
  fecha: string;
  centroCosto: string;
  solicitanteNombre: string;
  solicitanteCargo: string | null;
  delegacionAtribuciones: boolean;
  objetivo: string;
  aplicaIva: boolean;
  otId: string | null;
  items: {
    cantidad: number;
    unidadMedida: string | null;
    descripcion: string;
    valorUnitario: number | null;
    consumibleId: string | null;
    equipoId: string | null;
  }[];
}

interface Opciones {
  unidades: { id: string; codigo: string; nombre: string; centroCostoSugerido: string }[];
  solicitante: { nombre: string; cargo: string | null };
}

interface Estado {
  unidadId: string;
  fecha: string;
  centroCosto: string;
  solicitanteNombre: string;
  solicitanteCargo: string;
  delegacionAtribuciones: boolean;
  objetivo: string;
  aplicaIva: boolean;
  ot: OtCorta | null;
  items: ItemForm[];
}

/** Lo que trae el detalle de la API, para corregir una solicitud existente. */
export function desdeDetalle(d: any): Estado {
  return {
    unidadId: d.unidad.id,
    fecha: d.fecha,
    centroCosto: d.centroCosto,
    solicitanteNombre: d.solicitanteNombre,
    solicitanteCargo: d.solicitanteCargo ?? "",
    delegacionAtribuciones: !!d.delegacionAtribuciones,
    objetivo: d.objetivo,
    aplicaIva: !!d.aplicaIva,
    ot: d.ot ? ({ id: d.ot.id, codigo: d.ot.codigo } as OtCorta) : null,
    items: (d.items ?? []).map(
      (i: any): ItemForm => ({
        cantidad: String(i.cantidad).replace(".", ","),
        unidadMedida: i.unidadMedida ?? "",
        descripcion: i.descripcion,
        valorUnitario: i.valorUnitario == null ? "" : String(Math.round(i.valorUnitario)),
        vinculo: i.consumibleId ? "consumible" : i.equipoId ? "equipo" : "",
        consumibleId: i.consumibleId ?? null,
        equipoId: i.equipoId ?? null,
        vinculoTexto: i.consumibleId ? `${i.consumibleCodigo} · ${i.consumibleNombre}` : i.equipoId ? `${i.equipoCodigo} · ${i.equipoNombre ?? ""}` : "",
      }),
    ),
  };
}

export default function FormSolicitud({
  inicial,
  ocupado,
  textoGuardar,
  textoEnviar,
  onGuardar,
  onCancelar,
}: {
  inicial?: Estado | null;
  ocupado: boolean;
  textoGuardar: string;
  textoEnviar?: string;
  onGuardar: (p: SolicitudPayload, enviar: boolean) => void;
  onCancelar: () => void;
}) {
  const [op, setOp] = useState<Opciones | null>(null);
  const [error, setError] = useState("");
  const [f, setF] = useState<Estado>(
    inicial ?? {
      unidadId: "",
      fecha: hoyISO(),
      centroCosto: "",
      solicitanteNombre: "",
      solicitanteCargo: "",
      delegacionAtribuciones: false,
      objetivo: "",
      aplicaIva: true,
      ot: null,
      items: [{ ...ITEM_VACIO }],
    },
  );
  const [errores, setErrores] = useState<string[]>([]);

  useEffect(() => {
    llamar<Opciones>("GET", "/solicitudes-adquisicion/opciones")
      .then((o) => {
        setOp(o);
        if (!inicial) {
          const u = o.unidades.length === 1 ? o.unidades[0] : null;
          setF((x) => ({
            ...x,
            unidadId: u?.id ?? "",
            centroCosto: u?.centroCostoSugerido ?? "",
            solicitanteNombre: o.solicitante.nombre,
            solicitanteCargo: o.solicitante.cargo ?? "",
          }));
        }
      })
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lineas = f.items.map((i) => {
    const c = leerNumero(i.cantidad);
    const v = leerNumero(i.valorUnitario);
    return c != null && v != null ? Math.round(c * v) : null;
  });
  const subtotal = lineas.reduce<number>((a, x) => a + (x ?? 0), 0);
  const iva = f.aplicaIva ? Math.round(subtotal * 0.19) : 0;

  const setItem = (k: number, cambio: Partial<ItemForm>) => setF((x) => ({ ...x, items: x.items.map((it, j) => (j === k ? { ...it, ...cambio } : it)) }));

  function validar(): SolicitudPayload | null {
    const e: string[] = [];
    if (!f.unidadId) e.push("Elija el laboratorio solicitante.");
    if (f.centroCosto.trim().length < 3) e.push("Indique el nombre y centro de costo del solicitante.");
    if (f.solicitanteNombre.trim().length < 3) e.push("Indique el nombre del usuario solicitante.");
    if (f.objetivo.trim().length < 5) e.push("Indique el objetivo de la adquisición (al menos 5 caracteres).");
    if (!f.items.length) e.push("Agregue al menos un bien o servicio.");
    f.items.forEach((it, k) => {
      const c = leerNumero(it.cantidad);
      if (c == null || c <= 0) e.push(`Ítem ${k + 1}: la cantidad a adquirir debe ser un número mayor que 0.`);
      if (it.descripcion.trim().length < 3) e.push(`Ítem ${k + 1}: describa el bien o servicio requerido.`);
      if (it.valorUnitario.trim() && (leerNumero(it.valorUnitario) == null || (leerNumero(it.valorUnitario) ?? 0) < 0))
        e.push(`Ítem ${k + 1}: el valor unitario debe ser un número (o déjelo vacío si no lo conoce).`);
      if (it.vinculo && !(it.consumibleId || it.equipoId)) e.push(`Ítem ${k + 1}: elija el ${it.vinculo} de la lista o quite el vínculo.`);
    });
    setErrores(e);
    if (e.length) return null;
    return {
      unidadId: f.unidadId,
      fecha: f.fecha,
      centroCosto: f.centroCosto.trim(),
      solicitanteNombre: f.solicitanteNombre.trim(),
      solicitanteCargo: f.solicitanteCargo.trim() || null,
      delegacionAtribuciones: f.delegacionAtribuciones,
      objetivo: f.objetivo.trim(),
      aplicaIva: f.aplicaIva,
      otId: f.ot?.id ?? null,
      items: f.items.map((it) => ({
        cantidad: leerNumero(it.cantidad) as number,
        unidadMedida: it.unidadMedida.trim() || null,
        descripcion: it.descripcion.trim(),
        valorUnitario: it.valorUnitario.trim() ? leerNumero(it.valorUnitario) : null,
        consumibleId: it.vinculo === "consumible" ? it.consumibleId : null,
        equipoId: it.vinculo === "equipo" ? it.equipoId : null,
      })),
    };
  }

  if (error) return <div className="alert warn" role="alert">{error}</div>;
  if (!op) return <p className="subtitle">Cargando…</p>;
  if (!op.unidades.length)
    return <div className="alert warn" role="alert">No tiene un laboratorio asignado donde crear solicitudes de adquisición. Pida a Administración que revise sus roles.</div>;

  return (
    <div className="card">
      <h2>Datos del solicitante</h2>
      <div className="form-grid cols-2">
        <div className="field">
          <label htmlFor="sa-lab">Laboratorio solicitante <span className="req">*</span></label>
          <select
            id="sa-lab"
            value={f.unidadId}
            disabled={!!inicial}
            onChange={(e) => {
              const u = op.unidades.find((x) => x.id === e.target.value);
              setF({ ...f, unidadId: e.target.value, centroCosto: u?.centroCostoSugerido ?? f.centroCosto });
            }}
          >
            <option value="">Elija…</option>
            {op.unidades.map((u) => <option key={u.id} value={u.id}>{u.codigo} · {u.nombre}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="sa-fecha">Fecha</label>
          <input id="sa-fecha" type="date" value={f.fecha} max={hoyISO()} onChange={(e) => setF({ ...f, fecha: e.target.value })} />
        </div>
        <div className="field span-2">
          <label htmlFor="sa-cc">Nombre y centro de costo del solicitante <span className="req">*</span></label>
          <input id="sa-cc" value={f.centroCosto} maxLength={200} onChange={(e) => setF({ ...f, centroCosto: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="sa-nom">Nombre del usuario solicitante <span className="req">*</span></label>
          <input id="sa-nom" value={f.solicitanteNombre} maxLength={200} onChange={(e) => setF({ ...f, solicitanteNombre: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="sa-cargo">Cargo</label>
          <input id="sa-cargo" value={f.solicitanteCargo} maxLength={200} onChange={(e) => setF({ ...f, solicitanteCargo: e.target.value })} />
        </div>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Compra con delegación de atribuciones</legend>
          <label style={{ marginRight: 16, fontSize: 13 }}>
            <input type="radio" name="sa-del" checked={f.delegacionAtribuciones} onChange={() => setF({ ...f, delegacionAtribuciones: true })} /> Sí
          </label>
          <label style={{ fontSize: 13 }}>
            <input type="radio" name="sa-del" checked={!f.delegacionAtribuciones} onChange={() => setF({ ...f, delegacionAtribuciones: false })} /> No
          </label>
        </fieldset>
        <div className="field">
          <BuscadorOt valor={f.ot} onCambio={(ot) => setF({ ...f, ot })} etiqueta="OT relacionada (opcional)" />
        </div>
      </div>

      <h2 style={{ marginTop: 18 }}>Bienes o servicios requeridos</h2>
      <div style={{ overflowX: "auto" }}>
        <table className="data">
          <thead>
            <tr>
              <th style={{ width: 32 }}>ID</th>
              <th style={{ width: 90 }}>Cantidad <span className="req">*</span></th>
              <th style={{ width: 120 }}>Unidad (envase, medida)</th>
              <th>Características detalladas del bien o servicio <span className="req">*</span></th>
              <th style={{ width: 120 }}>Valor unitario estimado ($)</th>
              <th style={{ width: 100 }}>Total</th>
              <th style={{ width: 230 }}>Vincular a</th>
              <th style={{ width: 40 }} aria-label="Quitar" />
            </tr>
          </thead>
          <tbody>
            {f.items.map((it, k) => (
              <tr key={k}>
                <td>{k + 1}</td>
                <td><input aria-label={`Cantidad del ítem ${k + 1}`} value={it.cantidad} inputMode="decimal" onChange={(e) => setItem(k, { cantidad: e.target.value })} style={{ width: "100%" }} /></td>
                <td><input aria-label={`Unidad del ítem ${k + 1}`} value={it.unidadMedida} maxLength={40} placeholder="frasco 1 L" onChange={(e) => setItem(k, { unidadMedida: e.target.value })} style={{ width: "100%" }} /></td>
                <td><textarea aria-label={`Características del ítem ${k + 1}`} rows={2} value={it.descripcion} maxLength={4000} onChange={(e) => setItem(k, { descripcion: e.target.value })} style={{ width: "100%" }} /></td>
                <td><input aria-label={`Valor unitario del ítem ${k + 1}`} value={it.valorUnitario} inputMode="numeric" placeholder="opcional" onChange={(e) => setItem(k, { valorUnitario: e.target.value })} style={{ width: "100%" }} /></td>
                <td className="num">{pesos(lineas[k])}</td>
                <td><Vinculo item={it} unidadId={f.unidadId} onCambio={(c) => setItem(k, c)} indice={k + 1} /></td>
                <td>
                  {f.items.length > 1 && (
                    <button type="button" className="btn ghost-danger sm" aria-label={`Quitar el ítem ${k + 1}`} onClick={() => setF({ ...f, items: f.items.filter((_, j) => j !== k) })}>✕</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={5} className="num">Sub-total</td><td className="num">{pesos(subtotal)}</td><td colSpan={2} /></tr>
            <tr>
              <td colSpan={5} className="num">
                <label style={{ fontSize: 12 }}>
                  <input type="checkbox" checked={f.aplicaIva} onChange={(e) => setF({ ...f, aplicaIva: e.target.checked })} /> Sumar 19 % IVA (desmarque si los valores ya incluyen impuestos o son exentos)
                </label>
              </td>
              <td className="num">{f.aplicaIva ? pesos(iva) : "—"}</td><td colSpan={2} />
            </tr>
            <tr><td colSpan={5} className="num"><b>Total (valor referencial)</b></td><td className="num"><b>{pesos(subtotal + iva)}</b></td><td colSpan={2} /></tr>
          </tfoot>
        </table>
      </div>
      <button type="button" className="btn outline sm" style={{ marginTop: 8 }} disabled={f.items.length >= 40} onClick={() => setF({ ...f, items: [...f.items, { ...ITEM_VACIO }] })}>
        ＋ Agregar ítem
      </button>

      <h2 style={{ marginTop: 18 }}>Objetivo de la adquisición <span className="req">*</span></h2>
      <div className="field">
        <label htmlFor="sa-obj" className="sr-only">Objetivo de la adquisición</label>
        <textarea id="sa-obj" rows={3} maxLength={4000} value={f.objetivo} onChange={(e) => setF({ ...f, objetivo: e.target.value })} placeholder="Para qué se necesita (ensayo, reposición de stock, reparación del equipo…)" />
      </div>
      <p className="subtitle" style={{ fontSize: 12 }}>
        El presupuesto, la clasificación de Finanzas y las firmas de Finanzas y Dirección siguen fuera del LIMS: el PDF del formulario deja esos casilleros en blanco.
      </p>

      {errores.length > 0 && (
        <div className="alert warn" role="alert">
          <b>Revise la solicitud:</b>
          <ul style={{ margin: "4px 0 0 18px" }}>{errores.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <button type="button" className="btn outline" onClick={onCancelar}>Cancelar</button>
        <span className="spacer" />
        <button type="button" className="btn outline" disabled={ocupado} onClick={() => { const p = validar(); if (p) onGuardar(p, false); }}>{textoGuardar}</button>
        {textoEnviar && (
          <button type="button" className="btn primary" disabled={ocupado} onClick={() => { const p = validar(); if (p) onGuardar(p, true); }}>{textoEnviar}</button>
        )}
      </div>
    </div>
  );
}

/** Vínculo opcional del ítem: un consumible del kardex o un equipo (con búsqueda). */
function Vinculo({ item, unidadId, onCambio, indice }: { item: ItemForm; unidadId: string; onCambio: (c: Partial<ItemForm>) => void; indice: number }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<any[] | null>(null);
  const tipo = item.vinculo;
  const elegido = tipo === "consumible" ? item.consumibleId : tipo === "equipo" ? item.equipoId : null;

  useEffect(() => {
    if (!tipo || elegido) return;
    const t = setTimeout(() => {
      const ruta = tipo === "consumible" ? "consumibles" : "equipos";
      llamar<any[]>("GET", `/solicitudes-adquisicion/buscar/${ruta}${qs({ q, unidadId: tipo === "equipo" ? unidadId : undefined })}`)
        .then(setRes)
        .catch(() => setRes([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, tipo, elegido, unidadId]);

  const opciones = useMemo(() => res ?? [], [res]);
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <select
        aria-label={`Vínculo del ítem ${indice}`}
        value={tipo}
        onChange={(e) => {
          setQ("");
          setRes(null);
          onCambio({ vinculo: e.target.value as ItemForm["vinculo"], consumibleId: null, equipoId: null, vinculoTexto: "" });
        }}
      >
        <option value="">Sin vínculo</option>
        <option value="consumible">Consumible del kardex</option>
        <option value="equipo">Equipo</option>
      </select>
      {tipo && elegido && (
        <span style={{ fontSize: 11.5 }}>
          {item.vinculoTexto}{" "}
          <button type="button" className="btn outline sm" onClick={() => onCambio({ consumibleId: null, equipoId: null, vinculoTexto: "" })}>Cambiar</button>
        </span>
      )}
      {tipo && !elegido && (
        <>
          <input aria-label={`Buscar ${tipo} para el ítem ${indice}`} placeholder={tipo === "consumible" ? "Código o nombre del consumible" : "Código, nombre o serie del equipo"} value={q} onChange={(e) => setQ(e.target.value)} />
          <select
            aria-label={`Elegir ${tipo} para el ítem ${indice}`}
            value=""
            onChange={(e) => {
              const o = opciones.find((x) => x.id === e.target.value);
              if (!o) return;
              onCambio(
                tipo === "consumible"
                  ? { consumibleId: o.id, vinculoTexto: `${o.codigo} · ${o.nombre}`, unidadMedida: item.unidadMedida || o.unidadCompra || o.unidadMedida || "" }
                  : { equipoId: o.id, vinculoTexto: `${o.codigo} · ${o.nombre ?? ""}` },
              );
            }}
          >
            <option value="">{res === null ? "Buscando…" : opciones.length ? `Elija (${opciones.length})…` : "Sin resultados"}</option>
            {opciones.map((o) => (
              <option key={o.id} value={o.id}>{o.codigo} · {o.nombre}{o.unidad ? ` (${o.unidad})` : ""}</option>
            ))}
          </select>
        </>
      )}
    </div>
  );
}
