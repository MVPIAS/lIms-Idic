"use client";

/**
 * Formulario de cotización (crear y editar una Abierta) · Comercial R1 + R2.
 *
 *  · Cliente + tipo de cliente (lista única de parametro_sistema tipo_cliente).
 *  · Centro de costo agrupado «Laboratorios» / «Sucursales y Delegación BPCH».
 *  · Formato NORMAL / PERSONALIZADO · forma de pago · medio de envío (sin FAX).
 *  · Moneda CLP / USD con dólar del día (congelado al emitir; cambiarlo exige motivo).
 *  · Referencia · Descripción técnica y alcance · Condiciones adicionales (≤ 2000,
 *    se imprimen; botón «texto base del laboratorio») · Observaciones internas
 *    (NO se imprimen).
 *  · Líneas = ensayos del catálogo (código EN) valorizados con la lista de precios
 *    vigente (neto para un particular) o, si el ensayo no está en ella, su ficha.
 *  · «Válida hasta» automática y de solo lectura (IT DCO-PG01-P01-IT02).
 *  · Sin «Tipo cotización» (Extensión/Comprensión) y sin descuento.
 */

import { useEffect, useMemo, useState } from "react";
import { money, fechaDia, rut as fmtRut } from "@/lib/format";
import { pedir, GRUPOS_CC, hoyISO, type ConfigCotizacion, type Opcion } from "./comercial";

type Cliente = { id: string; razonSocial?: string; rut?: string; tipo?: string | null };
type Ensayo = { id: string; codigo: string; nombre: string; precio: number | string };

export type LineaForm = {
  catEnsayoId?: string;
  codigo?: string;
  descripcion: string;
  cantidad: number;
  /** Precio en CLP (lista vigente o ficha) para convertir si la moneda es USD. */
  precioClp?: number;
  /** Línea ya guardada: conserva su precio aunque la lista o la ficha cambien. */
  guardada?: boolean;
  /** De dónde salió el precio de una línea nueva. */
  origen?: { tipo: "lista" | "ficha"; texto: string };
  /** Línea heredada (HH/HM/…): se conserva con su precio, no se puede editar. */
  heredada?: { tipo: string; precioUnitario: number };
  /** Gasto tipificado (viático, pasaje, traslado): precio a mano, en la moneda de la cotización (EP-00 2.2). */
  gasto?: { tipo: string; precio: number };
};

type PrecioEnsayo = { precio: number | null; origen: "lista" | "ficha" | null; columna?: string | null; lista: { codigo: string; nombre: string; itemCodigo: string } | null };
const origenDe = (p: PrecioEnsayo): { tipo: "lista" | "ficha"; texto: string } =>
  p.origen === "lista" && p.lista
    ? { tipo: "lista", texto: `${p.lista.nombre} · ${p.lista.itemCodigo}${p.columna === "costo_total" ? " · costo total" : ""}` }
    : { tipo: "ficha", texto: "Ficha de costos del catálogo" };

/** Gastos que se pueden cotizar sin ensayo del catálogo (la API rechaza cualquier otra línea libre). */
const TIPOS_GASTO = [
  { v: "viatico", l: "Viático" },
  { v: "pasaje", l: "Pasaje" },
  { v: "otros", l: "Traslado u otro gasto" },
];
type Contacto = { id: string; nombre: string; cargo: string | null; principal: boolean };

type Props = {
  modo: "crear" | "editar";
  /** Cotización a editar (detalle de la API). */
  inicial?: any;
  onGuardado: (cot: any) => void;
  onCancelar?: () => void;
  /** Cotización que nace de una oportunidad del CRM (EP-00 0.3): se enlaza al guardar. */
  oportunidadId?: string;
  /** Cliente con que se precarga (el de la oportunidad). */
  clienteInicialId?: string;
};

const MAX_COND = 2000;

export default function CotizacionForm({ modo, inicial, onGuardado, onCancelar, oportunidadId, clienteInicialId }: Props) {
  const [cfg, setCfg] = useState<ConfigCotizacion | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Cliente
  const [q, setQ] = useState("");
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [cliente, setCliente] = useState<Cliente | null>(inicial?.cliente ?? null);
  const [tipoCliente, setTipoCliente] = useState<string>(inicial?.cliente?.tipo ?? "");
  const [msgTipo, setMsgTipo] = useState("");

  // Cabecera
  const [centroCostoId, setCentroCostoId] = useState<string>(inicial?.centroCostoId ?? "");
  const [formato, setFormato] = useState<string>(
    inicial?.formato === "NORMAL" || inicial?.formato === "PERSONALIZADO" ? inicial.formato : "NORMAL",
  );
  const [formaPago, setFormaPago] = useState<string>(inicial?.formaPago ?? "");
  const [medioEnvio, setMedioEnvio] = useState<string>(inicial?.medioEnvio ?? "");
  const [moneda, setMoneda] = useState<"CLP" | "USD">(inicial?.moneda === "USD" ? "USD" : "CLP");
  const dolarInicial = inicial?.dolarValor != null ? Number(inicial.dolarValor) : null;
  const [dolar, setDolar] = useState<string>(dolarInicial != null ? String(dolarInicial) : "");
  const [dolarFecha, setDolarFecha] = useState<string>(inicial?.dolarFecha ? String(inicial.dolarFecha).slice(0, 10) : hoyISO());
  const [dolarMotivo, setDolarMotivo] = useState("");
  const [referencia, setReferencia] = useState<string>(inicial?.referencia ?? "");
  const [descripcionTecnica, setDescripcionTecnica] = useState<string>(inicial?.descripcionTecnica ?? "");
  const [condiciones, setCondiciones] = useState<string>(inicial?.condicionesAdicionales ?? "");
  // Plazo de entrega comprometido (días corridos desde la recepción): fija la fecha de compromiso de la OT.
  const [plazoDias, setPlazoDias] = useState<string>(inicial?.plazoEntregaDias != null ? String(inicial.plazoEntregaDias) : "");
  const [obsInternas, setObsInternas] = useState<string>(inicial?.observacionesInternas ?? "");
  // Solicitud (EP-01/02 0.1): quién pide y con qué documento.
  const sol0 = inicial?.solicitud ?? {};
  const [contactos, setContactos] = useState<Contacto[]>([]);
  const [solContactoId, setSolContactoId] = useState<string>(sol0.solicitanteContactoId ?? "");
  const [solNombre, setSolNombre] = useState<string>(sol0.solicitanteNombre ?? "");
  const [solMedio, setSolMedio] = useState<string>(sol0.solicitudMedio ?? "");
  const [solNumero, setSolNumero] = useState<string>(sol0.solicitudNumero ?? "");
  const [solFecha, setSolFecha] = useState<string>(sol0.solicitudFecha ?? "");
  // Gasto tipificado por agregar.
  const [gTipo, setGTipo] = useState("viatico");
  const [gDesc, setGDesc] = useState("");
  const [gValor, setGValor] = useState("");

  // Cliente de la oportunidad (CRM).
  useEffect(() => {
    if (!clienteInicialId || cliente) return;
    pedir<any>("GET", `/clientes/${clienteInicialId}`)
      .then((c) => { setCliente({ id: c.id, razonSocial: c.razonSocial, rut: c.rut, tipo: c.tipo }); setTipoCliente(c.tipo ?? ""); })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteInicialId]);

  // Contactos del cliente para elegir al solicitante.
  useEffect(() => {
    if (!cliente?.id) { setContactos([]); return; }
    pedir<Contacto[]>("GET", `/clientes/${cliente.id}/contactos`)
      .then((cs) => {
        setContactos(cs);
        // B-038: sin solicitante elegido, se propone el contacto principal del cliente.
        const principal = cs.find((c) => c.principal);
        if (principal) setSolContactoId((actual) => (actual || solNombre.trim() ? actual : principal.id));
      })
      .catch(() => setContactos([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cliente?.id]);

  /** Referencia sugerida por el documento de solicitud (EP-00 1.1): «OF Nº …» o «Correo de fecha …». */
  function referenciaSugerida(medio: string, numero: string, fechaSol: string): string {
    // «OF 1234», «Oficio Nº 1234» o «1234» dan la misma referencia: «OF Nº 1234».
    // Mismo criterio que numeroOficioLimpio() de la API (B-086: «OF-PRUEBA-0001»).
    const n = numero.trim().replace(/^(of(icio)?(?![a-z])[\s.\-:]*)?(n[º°o](?![a-z])[\s.\-:]*)?/i, "").trim();
    if (medio === "oficio" && n) return `OF Nº ${n}`;
    if (medio === "correo" && fechaSol) return `Correo de fecha ${fechaSol.slice(8, 10)}-${fechaSol.slice(5, 7)}-${fechaSol.slice(0, 4)}`;
    return "";
  }
  function cambiarSolicitud(medio: string, numero: string, fechaSol: string) {
    const anterior = referenciaSugerida(solMedio, solNumero, solFecha);
    setSolMedio(medio); setSolNumero(numero); setSolFecha(fechaSol);
    const nueva = referenciaSugerida(medio, numero, fechaSol);
    // Solo se completa la referencia si estaba vacía o era la sugerida antes.
    if (nueva && (!referencia.trim() || referencia === anterior)) setReferencia(nueva);
  }

  // Líneas
  const [lineas, setLineas] = useState<LineaForm[]>(() =>
    (inicial?.lineas ?? []).map((l: any) =>
      l.catEnsayoId || l.tipo === "producto"
        ? {
            catEnsayoId: l.catEnsayoId ?? undefined,
            codigo: l.ensayoCodigo ?? undefined,
            descripcion: l.descripcion ?? "",
            cantidad: l.cantidad ?? 1,
            // El precio guardado ya está en la moneda de la cotización.
            precioClp: inicial?.moneda === "USD" ? Number(l.precioUnitario) * (dolarInicial ?? 1) : Number(l.precioUnitario),
            guardada: true,
          }
        : {
            descripcion: l.descripcion ?? l.tipo,
            cantidad: l.cantidad ?? 1,
            heredada: { tipo: l.tipo, precioUnitario: Number(l.precioUnitario) },
          },
    ),
  );
  const [qEnsayo, setQEnsayo] = useState("");
  const [ensayos, setEnsayos] = useState<Ensayo[]>([]);
  const [msgEnsayo, setMsgEnsayo] = useState("");

  // Validez
  const [validez, setValidez] = useState<{ validaHasta: string; explicacion: string } | null>(
    inicial?.validaHasta ? { validaHasta: String(inicial.validaHasta).slice(0, 10), explicacion: "" } : null,
  );

  const opts = (cat: string): Opcion[] => cfg?.parametros?.[cat] ?? [];

  // --- Configuración -----------------------------------------------------------
  useEffect(() => {
    pedir<ConfigCotizacion>("GET", "/cotizaciones/config")
      .then((c) => {
        setCfg(c);
        if (!formaPago && c.parametros.forma_pago?.[0]) setFormaPago(c.parametros.forma_pago[0].codigo);
      })
      .catch((e) => setError(`No se pudo cargar la configuración: ${e.message}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Búsqueda de clientes (solo al crear) -------------------------------------
  useEffect(() => {
    if (modo !== "crear") return;
    const t = setTimeout(() => {
      pedir<any>("GET", `/clientes?search=${encodeURIComponent(q)}&limit=50`)
        .then((j) => setClientes(j?.data ?? (Array.isArray(j) ? j : [])))
        .catch(() => setClientes([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, modo]);

  // --- Búsqueda de ensayos del catálogo ------------------------------------------
  useEffect(() => {
    const t = setTimeout(() => {
      pedir<any>("GET", `/cat/ensayos?search=${encodeURIComponent(qEnsayo)}&limit=30`)
        .then((j) => { setEnsayos(j?.data ?? []); setMsgEnsayo(""); })
        .catch((e) => { setEnsayos([]); setMsgEnsayo(e.message); });
    }, 250);
    return () => clearTimeout(t);
  }, [qEnsayo]);

  // --- Validez automática ----------------------------------------------------------
  const clienteId = cliente?.id ?? "";
  const fechaEmision = inicial?.fechaEmision ? String(inicial.fechaEmision).slice(0, 10) : hoyISO();
  useEffect(() => {
    if (!clienteId) { setValidez(null); return; }
    const qs = new URLSearchParams({ clienteId, fecha: fechaEmision });
    if (centroCostoId) qs.set("centroCostoId", centroCostoId);
    pedir<any>("GET", `/cotizaciones/validez?${qs}`)
      .then((v) => setValidez({ validaHasta: v.validaHasta, explicacion: v.explicacion }))
      .catch(() => setValidez(null));
  }, [clienteId, centroCostoId, tipoCliente, fechaEmision]);

  // --- Precio de los ensayos para este cliente (lista vigente o ficha) -------------
  // Misma regla que aplica la API al guardar (GET /cotizaciones/precios-ensayo).
  const [precios, setPrecios] = useState<Record<string, PrecioEnsayo>>({});
  const [reglaPrecio, setReglaPrecio] = useState("");
  useEffect(() => { setPrecios({}); setReglaPrecio(""); }, [clienteId]);
  const idsPrecio = useMemo(
    () => [...new Set([...ensayos.map((e) => e.id), ...lineas.filter((l) => l.catEnsayoId && !l.guardada).map((l) => l.catEnsayoId!)])].sort().join(","),
    [ensayos, lineas],
  );
  useEffect(() => {
    if (!clienteId || !idsPrecio) return;
    const qs = new URLSearchParams({ clienteId, ids: idsPrecio, fecha: fechaEmision });
    pedir<any>("GET", `/cotizaciones/precios-ensayo?${qs}`)
      .then((r) => { setPrecios((p) => ({ ...p, ...(r?.precios ?? {}) })); setReglaPrecio(r?.regla ?? ""); })
      .catch(() => undefined);
  }, [clienteId, idsPrecio, tipoCliente, fechaEmision]);
  useEffect(() => {
    setLineas((ls) => {
      let cambio = false;
      const n = ls.map((l) => {
        if (!l.catEnsayoId || l.guardada) return l;
        const p = precios[l.catEnsayoId];
        if (!p || p.precio == null) return l;
        const origen = origenDe(p);
        if (l.precioClp === p.precio && l.origen?.texto === origen.texto) return l;
        cambio = true;
        return { ...l, precioClp: p.precio, origen };
      });
      return cambio ? n : ls;
    });
  }, [precios]);
  const precioDe = (e: Ensayo) => {
    const p = precios[e.id];
    return p && p.precio != null ? { precio: p.precio, origen: origenDe(p) } : { precio: Number(e.precio) || 0, origen: { tipo: "ficha" as const, texto: "Ficha de costos del catálogo" } };
  };

  // --- Derivados -----------------------------------------------------------------
  const dolarNum = Number(dolar) || 0;
  const precioEnMoneda = (l: LineaForm) =>
    l.heredada
      ? l.heredada.precioUnitario
      : l.gasto
        ? l.gasto.precio
      : moneda === "USD"
        ? dolarNum > 0 ? Math.round(((l.precioClp ?? 0) / dolarNum) * 100) / 100 : 0
        : l.precioClp ?? 0;
  const total = useMemo(
    () => lineas.reduce((s, l) => s + precioEnMoneda(l) * (Number(l.cantidad) || 0), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lineas, moneda, dolarNum],
  );
  const cc = cfg?.centrosCosto.find((c) => c.id === centroCostoId);
  // EP-05 0.2: el lote del LRB se cotiza con unidades de reposición (parámetro cotizacion_lrb.reposicion).
  const reposicionLrb = Number((cfg as any)?.reposicionLrb ?? 4);
  const esLrb = (cc?.codigo ?? "").toUpperCase() === "LRB" || (cc?.laboratorio ?? "").toUpperCase() === "LRB";
  const [reposicionAplicada, setReposicionAplicada] = useState(false);
  function sumarReposicion() {
    setLineas((ls) => ls.map((l) => (l.catEnsayoId ? { ...l, cantidad: (Number(l.cantidad) || 0) + reposicionLrb } : l)));
    setReposicionAplicada(true);
  }
  const cambiaDolar = modo === "editar" && moneda === "USD" && dolarInicial != null && dolarNum !== dolarInicial;
  const tipoInactivo = !!tipoCliente && !!cfg && !opts("tipo_cliente").some((o) => o.codigo === tipoCliente);

  function elegirCentro(id: string) {
    setCentroCostoId(id);
    const c = cfg?.centrosCosto.find((x) => x.id === id);
    // Precarga el texto base del laboratorio solo si el usuario no ha escrito nada.
    if (c?.condicionesBase && !condiciones.trim()) setCondiciones(c.condicionesBase.slice(0, MAX_COND));
  }

  async function cambiarTipoCliente(codigo: string) {
    const anterior = tipoCliente;
    setTipoCliente(codigo);
    setMsgTipo("");
    if (!cliente?.id || !codigo) return;
    try {
      // Ruta propia de la reclasificación (exige cotizacion.crear, no la edición
      // completa de la ficha): quien cotiza puede corregir el tipo en el momento.
      await pedir("PATCH", `/clientes/${cliente.id}/tipo`, { tipo: codigo });
      setCliente({ ...cliente, tipo: codigo });
      setMsgTipo("Tipo de cliente actualizado en la ficha del cliente.");
    } catch (e: any) {
      setTipoCliente(anterior);
      setMsgTipo(`No se pudo actualizar el tipo del cliente: ${e.message}`);
    }
  }

  function agregarEnsayo(e: Ensayo) {
    const p = precioDe(e);
    setLineas((ls) => [
      ...ls,
      { catEnsayoId: e.id, codigo: e.codigo, descripcion: `${e.codigo} · ${e.nombre}`, cantidad: 1, precioClp: p.precio, origen: p.origen },
    ]);
  }
  function agregarGasto() {
    const valor = Number(String(gValor).replace(",", "."));
    if (!gDesc.trim()) return setError("Describa el gasto (p. ej. «Viático Arica, 2 días»).");
    if (!(valor > 0)) return setError("Indique el valor del gasto.");
    setError("");
    const etiqueta = TIPOS_GASTO.find((t) => t.v === gTipo)?.l ?? gTipo;
    setLineas((ls) => [...ls, { codigo: etiqueta, descripcion: gDesc.trim(), cantidad: 1, gasto: { tipo: gTipo, precio: valor } }]);
    setGDesc(""); setGValor("");
  }
  const setCant = (i: number, v: number) => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, cantidad: v } : l)));
  const quitar = (i: number) => setLineas((ls) => ls.filter((_, j) => j !== i));

  // --- Guardar ---------------------------------------------------------------------
  async function guardar() {
    setError("");
    if (!cliente?.id) return setError("Seleccione el cliente.");
    if (!lineas.length) return setError("Agregue al menos un ensayo del catálogo.");
    if (lineas.some((l) => !l.heredada && !l.gasto && !(Number(l.precioClp) > 0)))
      return setError("Hay ensayos sin precio: no están en la lista de precios vigente ni tienen valor en su ficha de costos.");
    if (moneda === "USD" && !(dolarNum > 0)) return setError("Indique el valor del dólar del día.");
    if (cambiaDolar && !dolarMotivo.trim()) return setError("El dólar quedó congelado al emitir: indique el motivo del cambio.");
    if (condiciones.length > MAX_COND) return setError(`Condiciones adicionales: máximo ${MAX_COND} caracteres.`);
    const plazo = plazoDias.trim() ? Number(plazoDias) : null;
    if (plazo !== null && !(Number.isInteger(plazo) && plazo >= 1 && plazo <= 730))
      return setError("Plazo de entrega: indique un número entero de días entre 1 y 730.");

    const body: any = {
      centroCostoId: centroCostoId || null,
      formato,
      formaPago: formaPago || null,
      medioEnvio: medioEnvio || null,
      moneda,
      dolarValor: moneda === "USD" ? dolarNum : null,
      dolarFecha: moneda === "USD" ? dolarFecha : null,
      ...(cambiaDolar ? { dolarMotivo } : {}),
      referencia: referencia.trim() || null,
      descripcionTecnica: descripcionTecnica.trim() || null,
      condicionesAdicionales: condiciones.trim() || null,
      plazoEntregaDias: plazo,
      observacionesInternas: obsInternas.trim() || null,
      solicitud: {
        solicitanteContactoId: solContactoId || null,
        solicitanteNombre: solNombre.trim() || null,
        solicitudMedio: solMedio || null,
        solicitudNumero: solNumero.trim() || null,
        solicitudFecha: solFecha || null,
      },
      ...(modo === "crear" && oportunidadId ? { oportunidadId } : {}),
      lineas: lineas.map((l) =>
        l.gasto
          ? { tipo: l.gasto.tipo, descripcion: l.descripcion, cantidad: Number(l.cantidad) || 1, precioUnitario: l.gasto.precio }
          : l.heredada
          ? { tipo: l.heredada.tipo === "comprension" ? "otros" : l.heredada.tipo, descripcion: l.descripcion, cantidad: Number(l.cantidad) || 1, precioUnitario: l.heredada.precioUnitario }
          : l.catEnsayoId
            ? { catEnsayoId: l.catEnsayoId, descripcion: l.descripcion, cantidad: Number(l.cantidad) || 1, precioUnitario: precioEnMoneda(l) }
            : { tipo: "producto", descripcion: l.descripcion, cantidad: Number(l.cantidad) || 1, precioUnitario: precioEnMoneda(l) },
      ),
    };
    setSaving(true);
    try {
      const r =
        modo === "crear"
          ? await pedir("POST", "/cotizaciones", { clienteId: cliente.id, ...body })
          : await pedir("PATCH", `/cotizaciones/${inicial.id}`, body);
      onGuardado(r);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const grupos = GRUPOS_CC.map((g) => ({ g, items: (cfg?.centrosCosto ?? []).filter((c) => c.grupo === g) }));

  return (
    <div>
      {error && <div className="alert warn">{error}</div>}

      {/* ---------------- Cliente y cabecera ---------------- */}
      <div className="card">
        <h2>Cliente y datos comerciales</h2>
        <div className="form-grid cols-3">
          {modo === "crear" ? (
            <>
              <div className="field">
                <label>Buscar cliente (razón social / RUT)</label>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Escribe para buscar…" />
              </div>
              <div className="field" style={{ gridColumn: "span 2" }}>
                <label>Cliente <span className="req">*</span></label>
                <select
                  value={cliente?.id ?? ""}
                  onChange={(e) => {
                    const c = clientes.find((x) => x.id === e.target.value) ?? null;
                    setCliente(c);
                    setTipoCliente(c?.tipo ?? "");
                    setMsgTipo("");
                  }}
                >
                  <option value="">— selecciona un cliente —</option>
                  {cliente && !clientes.some((c) => c.id === cliente.id) && <option value={cliente.id}>{cliente.razonSocial}</option>}
                  {clientes.map((c) => (
                    <option key={c.id} value={c.id}>{c.razonSocial}{c.rut ? ` · ${fmtRut(c.rut)}` : ""}</option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            <div className="field readonly" style={{ gridColumn: "span 2" }}>
              <label>Cliente</label>
              <input readOnly value={`${cliente?.razonSocial ?? "—"}${cliente?.rut ? ` · ${fmtRut(cliente.rut)}` : ""}`} />
            </div>
          )}
          <div className="field">
            <label>Tipo de cliente</label>
            <select value={tipoCliente} disabled={!cliente} onChange={(e) => cambiarTipoCliente(e.target.value)}>
              <option value="">— sin tipo —</option>
              {tipoInactivo && <option value={tipoCliente}>{tipoCliente} (valor antiguo)</option>}
              {opts("tipo_cliente").map((o) => <option key={o.codigo} value={o.codigo}>{o.etiqueta}</option>)}
            </select>
            <small style={{ color: msgTipo.startsWith("No") ? "var(--red)" : "var(--muted)" }}>
              {msgTipo || (tipoInactivo ? "Tipo antiguo: reclasifique al cliente (define la validez)." : "Define la regla de validez. Se guarda en la ficha del cliente.")}
            </small>
          </div>

          <div className="field">
            <label>Centro de costo</label>
            <select value={centroCostoId} onChange={(e) => elegirCentro(e.target.value)}>
              <option value="">— sin centro de costo —</option>
              {grupos.map(({ g, items }) =>
                items.length ? (
                  <optgroup key={g} label={g}>
                    {items.map((c) => <option key={c.id} value={c.id}>{c.nombre} ({c.codigo})</option>)}
                  </optgroup>
                ) : null,
              )}
            </select>
          </div>
          <div className="field">
            <label>Formato <span className="req">*</span></label>
            <select value={formato} onChange={(e) => setFormato(e.target.value)}>
              {(opts("formato_cotizacion").length ? opts("formato_cotizacion") : [{ codigo: "NORMAL", etiqueta: "Normal" }, { codigo: "PERSONALIZADO", etiqueta: "Personalizado" }]).map((o) => (
                <option key={o.codigo} value={o.codigo}>{o.etiqueta}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Forma de pago</label>
            <select value={formaPago} onChange={(e) => setFormaPago(e.target.value)}>
              <option value="">— sin especificar —</option>
              {formaPago && !opts("forma_pago").some((o) => o.codigo === formaPago) && <option value={formaPago}>{formaPago} (histórico)</option>}
              {opts("forma_pago").map((o) => <option key={o.codigo} value={o.codigo}>{o.etiqueta}</option>)}
            </select>
          </div>

          <div className="field">
            <label>Medio de envío</label>
            <select value={medioEnvio} onChange={(e) => setMedioEnvio(e.target.value)}>
              <option value="">— sin especificar —</option>
              {opts("medio_envio").map((o) => <option key={o.codigo} value={o.codigo}>{o.etiqueta}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Moneda</label>
            <select value={moneda} onChange={(e) => setMoneda(e.target.value as "CLP" | "USD")}>
              {(opts("moneda").length ? opts("moneda") : [{ codigo: "CLP", etiqueta: "CLP" }, { codigo: "USD", etiqueta: "USD" }]).map((o) => (
                <option key={o.codigo} value={o.codigo}>{o.etiqueta}</option>
              ))}
            </select>
          </div>
          {moneda === "USD" ? (
            <div className="field">
              <label>Dólar del día (CLP por US$) <span className="req">*</span></label>
              <div style={{ display: "flex", gap: 6 }}>
                <input type="number" inputMode="decimal" step="0.01" min={0} value={dolar} onChange={(e) => setDolar(e.target.value)} style={{ flex: 1 }} />
                <input type="date" value={dolarFecha} onChange={(e) => setDolarFecha(e.target.value)} style={{ width: 140 }} />
              </div>
              <small style={{ color: "var(--muted)" }}>Queda congelado al emitir; cambiarlo después exige motivo.</small>
            </div>
          ) : (
            <div className="field" />
          )}
          {cambiaDolar && (
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label>Motivo del cambio del dólar <span className="req">*</span></label>
              <input value={dolarMotivo} onChange={(e) => setDolarMotivo(e.target.value)} maxLength={500} placeholder={`Valor emitido: ${dolarInicial}`} />
            </div>
          )}

          <fieldset className="field" style={{ gridColumn: "1 / -1", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px", margin: 0 }}>
            <legend style={{ fontSize: 12, fontWeight: 600, padding: "0 4px" }}>Solicitud del cliente</legend>
            <div className="form-grid cols-4">
              <div className="field">
                <label htmlFor="sol-contacto">Solicitante (contacto)</label>
                <select id="sol-contacto" value={solContactoId} disabled={!cliente} onChange={(e) => setSolContactoId(e.target.value)}>
                  <option value="">{cliente ? (contactos.length ? "— elija el contacto —" : "El cliente no tiene contactos") : "Elija primero el cliente"}</option>
                  {contactos.map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.cargo ? ` · ${c.cargo}` : ""}{c.principal ? " (principal)" : ""}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="sol-nombre">o nombre y cargo</label>
                <input id="sol-nombre" value={solNombre} maxLength={160} onChange={(e) => setSolNombre(e.target.value)} placeholder="Si no está en los contactos" />
              </div>
              <div className="field">
                <label htmlFor="sol-medio">Medio de la solicitud</label>
                <select id="sol-medio" value={solMedio} onChange={(e) => cambiarSolicitud(e.target.value, solNumero, solFecha)}>
                  <option value="">— sin especificar —</option>
                  <option value="oficio">Oficio</option>
                  <option value="correo">Correo</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="sol-num">{solMedio === "correo" ? "Fecha del correo" : "Nº y fecha del oficio"}</label>
                <div style={{ display: "flex", gap: 6 }}>
                  {solMedio !== "correo" && <input id="sol-num" aria-label="Número del oficio" value={solNumero} maxLength={80} onChange={(e) => cambiarSolicitud(solMedio, e.target.value, solFecha)} style={{ flex: 1, minWidth: 0 }} />}
                  <input type="date" aria-label={solMedio === "correo" ? "Fecha del correo" : "Fecha del oficio"} value={solFecha} onChange={(e) => cambiarSolicitud(solMedio, solNumero, e.target.value)} style={{ width: 140 }} />
                </div>
              </div>
            </div>
            <small style={{ color: "var(--muted)" }}>La referencia de la cotización se completa con el documento: «OF Nº …» u «Correo de fecha …».</small>
          </fieldset>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label>Referencia</label>
            <input value={referencia} onChange={(e) => setReferencia(e.target.value)} maxLength={300} placeholder="Referencia del cliente / solicitud" />
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label>Descripción técnica y alcance</label>
            <textarea rows={3} value={descripcionTecnica} onChange={(e) => setDescripcionTecnica(e.target.value)} placeholder="Qué se ensaya, normas, alcance y exclusiones…" />
          </div>
        </div>
      </div>

      {/* ---------------- Ensayos ---------------- */}
      <div className="card">
        <h2>Ensayos cotizados <span className="right">precio de la lista de precios vigente o, si no está, de la ficha de costos</span></h2>
        <div className="form-grid cols-3">
          <div className="field">
            <label>Buscar ensayo (código EN / nombre)</label>
            <input value={qEnsayo} onChange={(e) => setQEnsayo(e.target.value)} placeholder="EN…" />
          </div>
          <div className="field" style={{ gridColumn: "span 2" }}>
            <label>Agregar ensayo</label>
            <select value="" onChange={(e) => { const x = ensayos.find((en) => en.id === e.target.value); if (x) agregarEnsayo(x); }}>
              <option value="">— selecciona un ensayo para agregarlo —</option>
              {ensayos.map((en) => (
                <option key={en.id} value={en.id}>{en.codigo} · {en.nombre} · {precioDe(en).precio > 0 ? `${money(precioDe(en).precio)}${precioDe(en).origen.tipo === "lista" ? " (lista)" : ""}` : "sin precio"}</option>
              ))}
            </select>
            {msgEnsayo && <small style={{ color: "var(--red)" }}>Catálogo no disponible: {msgEnsayo}</small>}
          </div>
        </div>
        <div className="form-grid cols-4" style={{ marginTop: 8 }}>
          <div className="field">
            <label htmlFor="g-tipo">Gasto no incluido en la ficha</label>
            <select id="g-tipo" value={gTipo} onChange={(e) => setGTipo(e.target.value)}>
              {TIPOS_GASTO.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="g-desc">Detalle</label>
            <input id="g-desc" value={gDesc} maxLength={200} onChange={(e) => setGDesc(e.target.value)} placeholder="p. ej. Viático Arica, 2 días" />
          </div>
          <div className="field">
            <label htmlFor="g-valor">Valor ({moneda})</label>
            <input id="g-valor" inputMode="decimal" value={gValor} onChange={(e) => setGValor(e.target.value)} />
          </div>
          <div className="field" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn outline sm" onClick={agregarGasto}>Agregar gasto</button>
          </div>
        </div>
        <small style={{ color: "var(--muted)" }}>
          {reglaPrecio === "PARTICULAR"
            ? "Cliente particular: cada ensayo toma el neto (sin IVA) de la lista de precios vigente; si no está en la lista, su ficha de costos."
            : reglaPrecio === "EJERCITO"
              ? "Cliente Ejército: el precio sale según el parámetro «Precio de la lista que toma un cliente Ejército» (por confirmar)."
              : "Elija el cliente: el precio de cada ensayo depende de su tipo (particular o Ejército)."}{" "}
          El precio no se escribe a mano. Solo los gastos (viáticos, pasajes, traslados) llevan valor manual.
        </small>
        {esLrb && reposicionLrb > 0 && lineas.some((l) => l.catEnsayoId) && (
          <div className="alert info" style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8 }}>
            <span style={{ flex: 1 }}>LRB: el lote se cotiza con <b>{reposicionLrb} unidades de reposición</b> además de las del lote.</span>
            <button type="button" className="btn outline sm" disabled={reposicionAplicada} onClick={sumarReposicion}>
              {reposicionAplicada ? "Reposición sumada" : `Sumar ${reposicionLrb} a cada ensayo`}
            </button>
          </div>
        )}
        <table className="data" style={{ marginTop: 10 }}>
          <thead>
            <tr><th>Código</th><th>Ensayo</th><th className="num">Cant.</th><th className="num">P. unitario ({moneda})</th><th className="num">Subtotal</th><th></th></tr>
          </thead>
          <tbody>
            {lineas.map((l, i) => (
              <tr key={i}>
                <td><span className="codigo">{l.codigo ?? (l.heredada ? l.heredada.tipo : "—")}</span></td>
                <td>
                  {l.descripcion}
                  {l.heredada && <small style={{ display: "block", color: "var(--muted)" }}>Línea heredada (se conserva tal cual)</small>}
                  {l.gasto && <small style={{ display: "block", color: "var(--muted)" }}>Gasto · valor manual</small>}
                  {!l.heredada && !l.gasto && !(Number(l.precioClp) > 0) && <small style={{ display: "block", color: "var(--red)" }}>Sin precio en la lista vigente ni en la ficha de costos</small>}
                  {!l.heredada && !l.gasto && Number(l.precioClp) > 0 && (
                    <small style={{ display: "block", color: "var(--muted)" }}>{l.guardada ? "Precio cotizado (se conserva)" : l.origen?.texto ?? "Ficha de costos del catálogo"}</small>
                  )}
                </td>
                <td className="num">
                  <input type="number" min={1} step={1} value={l.cantidad} onChange={(e) => setCant(i, Math.max(1, Math.round(Number(e.target.value) || 1)))} style={{ width: 64, textAlign: "right" }} />
                </td>
                <td className="num">{money(precioEnMoneda(l), moneda)}</td>
                <td className="num">{money(precioEnMoneda(l) * (Number(l.cantidad) || 0), moneda)}</td>
                <td className="num"><button className="btn outline sm" onClick={() => quitar(i)} aria-label="Quitar">✕</button></td>
              </tr>
            ))}
            {!lineas.length && (
              <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: 18 }}>Aún no hay ensayos. Búscalos en el catálogo y agrégalos.</td></tr>
            )}
          </tbody>
          {lineas.length > 0 && (
            <tfoot>
              <tr><td colSpan={4} className="num" style={{ fontWeight: 700 }}>Total (IVA exento)</td><td className="num" style={{ fontWeight: 800 }}>{money(total, moneda)}</td><td /></tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* ---------------- Condiciones, validez, notas ---------------- */}
      <div className="card">
        <h2>Condiciones y validez</h2>
        <div className="form-grid cols-2">
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ flex: 1 }}>Condiciones adicionales <small style={{ color: "var(--muted)" }}>(se imprimen en la cotización)</small></span>
              {cc?.condicionesBase && (
                <button type="button" className="btn outline sm" onClick={() => setCondiciones(cc.condicionesBase!.slice(0, MAX_COND))}>
                  Usar texto base de {cc.laboratorio ?? cc.codigo}
                </button>
              )}
            </label>
            <textarea rows={5} maxLength={MAX_COND} value={condiciones} onChange={(e) => setCondiciones(e.target.value.slice(0, MAX_COND))} />
            <small style={{ textAlign: "right", color: condiciones.length >= MAX_COND ? "var(--red)" : "var(--muted)" }}>
              {condiciones.length} / {MAX_COND}
            </small>
          </div>
          <div className="field">
            <label>Plazo de entrega (días corridos)</label>
            <input type="number" min={1} max={730} step={1} value={plazoDias} onChange={(e) => setPlazoDias(e.target.value)} />
            <small style={{ color: "var(--muted)" }}>Desde la recepción de las muestras. Fija la fecha de compromiso de la OT; si lo deja vacío, la fija Planificación.</small>
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label>Observaciones internas <small style={{ color: "var(--muted)" }}>(uso interno de Comercial · NO se imprimen)</small></label>
            <textarea rows={2} value={obsInternas} onChange={(e) => setObsInternas(e.target.value)} />
          </div>
          <div className="field readonly">
            <label>Válida hasta (automático)</label>
            <input readOnly value={validez ? fechaDia(validez.validaHasta) : "— seleccione el cliente —"} />
          </div>
          <div className="field">
            <label>Regla aplicada</label>
            <small style={{ color: "var(--muted)", paddingTop: 6 }}>
              {validez?.explicacion ||
                "IT DCO-PG01-P01-IT02: particulares 45 días (o la validez propia del laboratorio); Ejército hasta el 31-dic del año de emisión, o 6 meses si se emite entre octubre y diciembre."}
            </small>
          </div>
        </div>
        <div className="toolbar" style={{ marginTop: 12 }}>
          {onCancelar && <button className="btn outline sm" onClick={onCancelar}>Cancelar</button>}
          <div className="spacer" />
          <button className="btn success sm" disabled={saving || !cfg} onClick={guardar}>
            {saving ? "Guardando…" : modo === "crear" ? "Emitir cotización (Abierta)" : "Guardar cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}
