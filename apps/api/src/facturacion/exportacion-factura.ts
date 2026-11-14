/**
 * Exportación de la factura para el sistema de facturación electrónica del IDIC
 * · reglas PURAS (sin BD), probadas en exportacion-factura.spec.ts.
 *
 * El LIMS no sale a internet: no emite documentos tributarios electrónicos (DTE)
 * ante el SII. Por cada factura entrega un JSON con el esquema
 * `lims-idic.factura.v1` (documentado en docs/EXPORTACION_FACTURACION.md) que la
 * aplicación de facturación del IDIC importa para emitir el DTE, y un PDF
 * «documento de cobro» que no es un documento tributario.
 *
 * El esquema sigue la estructura del DTE chileno (Encabezado/IdDoc, Emisor,
 * Receptor, Totales, Detalle, DscRcgGlobal, Referencia) con nombres en español:
 *   · tipo de DTE sugerido: 33 (factura afecta) o 34 (factura exenta);
 *   · montos ENTEROS en pesos (CLP); el IVA es round(neto × 19 %);
 *   · las líneas negativas del LIMS (descuento, ajuste) no son ítems del DTE
 *     (su monto no puede ser negativo): salen como descuentos globales.
 *
 * Cambiar el significado de un campo exige una versión nueva del esquema (v2);
 * en v1 solo se agregan campos opcionales.
 */
import { formatRut, validaRut } from "../common/rut.validator";

export const ESQUEMA_FACTURA = "lims-idic.factura.v1";
export const ESQUEMA_LOTE = "lims-idic.factura-lote.v1";
/** Tasa del IVA en Chile (DL 825, art. 14). Una factura afecta del esquema v1 la exige. */
export const TASA_IVA = 19;
/** Facturas como máximo en una exportación por rango (se pide acotar el rango). */
export const MAX_LOTE = 500;

/* ------------------------------------------------------------------ RUT --- */

/**
 * RUT en la forma que pide el SII en el DTE: sin puntos, con guion y el dígito
 * verificador en mayúscula («12345678-K»). null si no es un RUT válido.
 */
export function rutSii(rut: string | null | undefined): string | null {
  if (!rut || !validaRut(rut)) return null;
  return formatRut(rut).replace(/\./g, "");
}

/** ¿El RUT tiene el dígito verificador correcto (módulo 11)? */
export const rutValido = (rut: string | null | undefined): boolean => validaRut(rut);

/* ------------------------------------------------------------- entradas --- */

export interface FacturaEntrada {
  id: string;
  numero: string;
  estado: string;
  origen?: string | null;
  moneda?: string | null;
  /** «YYYY-MM-DD» (columna DATE). */
  fechaEmision?: string | null;
  neto: number;
  ivaPct: number;
  ivaMonto: number;
  total: number;
  /** true/false = lo marcó Finanzas; null = se deduce (IVA 0 % = exenta). */
  exentaIva?: boolean | null;
  observaciones?: string | null;
}

export interface LineaEntrada {
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
}

export interface ParteEntrada {
  rut?: string | null;
  razonSocial?: string | null;
  giro?: string | null;
  direccion?: string | null;
  comuna?: string | null;
  ciudad?: string | null;
  correo?: string | null;
  telefono?: string | null;
}

export interface EmisorEntrada extends ParteEntrada {
  /** Código de actividad económica del SII (Acteco). */
  acteco?: string | null;
  /** Código de la sucursal ante el SII (CdgSIISucur), si la hay. */
  codigoSucursalSii?: string | null;
}

export interface ReceptorEntrada extends ParteEntrada {
  contactoNombre?: string | null;
  contactoCorreo?: string | null;
  contactoTelefono?: string | null;
  diasCredito?: number | null;
}

export interface ReferenciaEntrada {
  tipo: "OT" | "COTIZACION" | "OC" | "OPI" | "RESOLUCION" | "DISPOSICION";
  folio: string | null | undefined;
  fecha?: string | null;
  razon?: string | null;
}

export interface DatosExportacion {
  factura: FacturaEntrada;
  lineas: LineaEntrada[];
  emisor: EmisorEntrada;
  receptor: ReceptorEntrada | null;
  /** Forma de pago de la cotización o, si no hay, la habitual del cliente (código de la lista). */
  formaPago?: { codigo: string | null; etiqueta?: string | null } | null;
  referencias: ReferenciaEntrada[];
  centroCosto?: { codigo: string; nombre: string } | null;
  /** Fecha de hoy en Chile «YYYY-MM-DD» (emisión sugerida de una factura pendiente). */
  hoy: string;
}

/* --------------------------------------------------------------- salida --- */

export interface DocumentoExportV1 {
  esquema: typeof ESQUEMA_FACTURA;
  generadoEn: string;
  origen: { sistema: "LIMS IDIC"; idFactura: string; estadoLims: string; origenLims: string | null };
  encabezado: {
    tipoDte: 33 | 34;
    tipoDteNombre: string;
    folioInterno: string;
    folioTributario: string | null;
    fechaEmision: string;
    fechaEmisionSugerida: boolean;
    fechaVencimiento: string | null;
    formaPago: { codigoSii: 1 | 2; texto: string; codigoLims: string | null; textoLims: string | null; diasCredito: number };
    moneda: "CLP";
  };
  emisor: {
    rut: string;
    razonSocial: string;
    giro: string;
    acteco: string | null;
    direccion: string;
    comuna: string;
    ciudad: string;
    codigoSucursalSii: string | null;
    correo: string | null;
    telefono: string | null;
  };
  receptor: {
    rut: string;
    razonSocial: string;
    giro: string;
    direccion: string;
    comuna: string;
    ciudad: string;
    correo: string | null;
    contacto: { nombre: string | null; correo: string | null; telefono: string | null };
  };
  detalle: {
    linea: number;
    codigo: { tipo: "INT1"; valor: string } | null;
    nombre: string;
    descripcion: string | null;
    cantidad: number;
    unidad: string;
    precioUnitario: number;
    descuentoPct: number;
    descuentoMonto: number;
    montoItem: number;
    indicadorExencion: 1 | null;
  }[];
  descuentosRecargos: {
    linea: number;
    tipoMovimiento: "D" | "R";
    glosa: string;
    tipoValor: "$";
    valor: number;
    indicadorExencion: 1 | null;
  }[];
  totales: { montoNeto: number; montoExento: number; tasaIva: number | null; iva: number; montoTotal: number };
  referencias: { linea: number; tipo: string; tipoDocSii: string | null; folio: string; fecha: string | null; razon: string | null }[];
  centroCosto: { codigo: string; nombre: string } | null;
  observaciones: string | null;
  advertencias: string[];
}

export interface ResultadoExportacion {
  documento: DocumentoExportV1 | null;
  /** Lo que impide exportar (vacío = se exporta). */
  errores: string[];
  /** Lo que conviene revisar, pero no impide exportar. */
  advertencias: string[];
}

/* ------------------------------------------------------------ utilidades --- */

const t = (v: unknown) => String(v ?? "").trim();
const entero = (v: number) => Math.round(Number(v) || 0);
const pesos = (v: number) => `$ ${entero(v).toLocaleString("es-CL")}`;

/** Suma días a una fecha «YYYY-MM-DD» (aritmética de calendario, sin zona horaria). */
export function sumarDias(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split("-").map(Number);
  const x = new Date(Date.UTC(a, m - 1, d + dias));
  return x.toISOString().slice(0, 10);
}

/** ¿La factura es exenta de IVA? Manda lo que marcó Finanzas; si no marcó nada, IVA 0 % = exenta. */
export function esExenta(f: Pick<FacturaEntrada, "exentaIva" | "ivaPct">): boolean {
  if (f.exentaIva === true) return true;
  if (f.exentaIva === false) return false;
  return Number(f.ivaPct) === 0;
}

/**
 * Separa «código · nombre» (formato de las líneas que arma el LIMS,
 * reglas-factura.ts `descripcionLineaFactura`). Sin código, todo es nombre.
 */
export function separarCodigo(descripcion: string): { codigo: string | null; nombre: string } {
  const d = t(descripcion);
  const m = /^([A-Za-z0-9][A-Za-z0-9._/-]{0,34}) · (.+)$/.exec(d);
  return m ? { codigo: m[1], nombre: m[2].trim() } : { codigo: null, nombre: d };
}

/**
 * Forma de pago del DTE (FmaPago): 1 = contado, 2 = crédito. Por adelantado o
 * contado → 1; crédito o «a N días» (contado_30) → 2; cualquier otro código
 * (medios de pago heredados: transferencia, cheque…) o sin dato → según los
 * días de crédito del cliente.
 */
export function formaPagoSii(codigo: string | null | undefined, diasCredito: number): { codigoSii: 1 | 2; texto: string } {
  const c = t(codigo).toLowerCase();
  if (c === "adelantado" || c === "contado") return { codigoSii: 1, texto: "Contado" };
  if (c === "credito" || /_\d+$/.test(c)) return { codigoSii: 2, texto: "Crédito" };
  return diasCredito > 0 ? { codigoSii: 2, texto: "Crédito" } : { codigoSii: 1, texto: "Contado" };
}

/** Lo que falta en los datos del receptor (cliente) para un DTE; vacío = completo. */
export function faltantesReceptor(r: ReceptorEntrada | null): string[] {
  if (!r) return ["el cliente de la factura (no se encontró)"];
  const f: string[] = [];
  if (!t(r.rut)) f.push("RUT");
  else if (!rutValido(r.rut)) f.push(`RUT válido (el registrado, ${t(r.rut)}, no pasa el dígito verificador)`);
  if (!t(r.razonSocial)) f.push("razón social");
  if (!t(r.giro)) f.push("giro");
  if (!t(r.direccion)) f.push("dirección");
  if (!t(r.comuna)) f.push("comuna");
  if (!t(r.ciudad)) f.push("ciudad");
  return f;
}

/** Lo que falta en los datos del emisor (parámetros del sistema); vacío = completo. */
export function faltantesEmisor(e: EmisorEntrada): string[] {
  const f: string[] = [];
  if (!t(e.rut)) f.push("RUT");
  else if (!rutValido(e.rut)) f.push(`RUT válido (el registrado, ${t(e.rut)}, no pasa el dígito verificador)`);
  if (!t(e.razonSocial)) f.push("razón social");
  if (!t(e.giro)) f.push("giro");
  if (!t(e.direccion)) f.push("dirección");
  if (!t(e.comuna)) f.push("comuna");
  if (!t(e.ciudad)) f.push("ciudad");
  return f;
}

/** ¿El valor es de ejemplo (lleva «PRUEBA»)? */
const esPrueba = (v: unknown) => /prueba/i.test(t(v));

/**
 * Cuadratura de los totales del documento: neto + IVA + exento = total, IVA =
 * round(neto × tasa) y, en una exenta, sin neto ni IVA. Devuelve los errores.
 */
export function erroresCuadratura(tot: DocumentoExportV1["totales"], tipoDte: 33 | 34): string[] {
  const e: string[] = [];
  const vals = [tot.montoNeto, tot.montoExento, tot.iva, tot.montoTotal];
  if (vals.some((v) => !Number.isInteger(v))) e.push("Los montos deben ser enteros en pesos.");
  if (vals.some((v) => v < 0)) e.push("Ningún total puede ser negativo.");
  if (tot.montoNeto + tot.iva + tot.montoExento !== tot.montoTotal)
    e.push(
      `Los totales no cuadran: neto ${pesos(tot.montoNeto)} + IVA ${pesos(tot.iva)} + exento ${pesos(tot.montoExento)} no es igual al total ${pesos(tot.montoTotal)}.`,
    );
  if (tipoDte === 33 && tot.iva !== Math.round((tot.montoNeto * (tot.tasaIva ?? 0)) / 100))
    e.push(`El IVA (${pesos(tot.iva)}) no es el ${tot.tasaIva ?? 0} % del neto (${pesos(tot.montoNeto)}).`);
  if (tipoDte === 34 && (tot.montoNeto !== 0 || tot.iva !== 0)) e.push("Una factura exenta no lleva neto afecto ni IVA.");
  if (tot.montoTotal <= 0) e.push("El total de la factura debe ser mayor que cero.");
  return e;
}

/* ---------------------------------------------------------- construcción --- */

/**
 * Arma el documento `lims-idic.factura.v1` de una factura y lo valida. Si hay
 * errores, `documento` es null y `errores` dice qué falta y cómo seguir.
 */
export function construirExportacion(d: DatosExportacion, generadoEn: string): ResultadoExportacion {
  const f = d.factura;
  const errores: string[] = [];
  const advertencias: string[] = [];

  if (f.estado === "anulada")
    return {
      documento: null,
      errores: [`La factura está anulada: no se exporta para facturación. Si la OT debe cobrarse, use «Refacturar OT».`],
      advertencias,
    };
  const moneda = t(f.moneda || "CLP").toUpperCase();
  if (moneda !== "CLP")
    errores.push(`La factura está en ${moneda}: el esquema v1 exporta solo facturas en pesos (CLP). Emítala directamente en el sistema de facturación.`);

  const faltaR = faltantesReceptor(d.receptor);
  if (faltaR.length)
    errores.push(`Faltan datos del cliente (receptor): ${faltaR.join(", ")}. Complételos en Clientes y vuelva a exportar.`);
  const faltaE = faltantesEmisor(d.emisor);
  if (faltaE.length)
    errores.push(
      `Faltan datos del emisor (IDIC): ${faltaE.join(", ")}. Complételos en Administración › Parámetros del sistema › «Emisor de la factura».`,
    );

  const exenta = esExenta(f);
  const tipoDte: 33 | 34 = exenta ? 34 : 33;
  const ivaPct = Number(f.ivaPct);
  if (exenta && entero(f.ivaMonto) !== 0)
    errores.push(
      `La factura está marcada exenta de IVA pero registra IVA de ${pesos(f.ivaMonto)}. Si está pendiente, vuelva a marcarla exenta en «Revisar y emitir» para recalcularla; si ya está emitida, corríjala con una nota de crédito.`,
    );
  if (!exenta && ivaPct !== TASA_IVA)
    errores.push(`Una factura afecta lleva IVA del ${TASA_IVA} % y esta tiene ${ivaPct.toLocaleString("es-CL")} %. Corrija el IVA o márquela exenta.`);
  if (!exenta && f.origen === "tasa_internacion")
    advertencias.push("Es la tasa de internación del BPCH, que se factura exenta de IVA (34), y esta factura está como afecta: corríjala (si está pendiente, márquela «Exenta de IVA»; si ya está emitida, con una nota de crédito).");

  // Ítems (líneas positivas) y descuentos/recargos globales (líneas negativas).
  const detalle: DocumentoExportV1["detalle"] = [];
  const descuentos: DocumentoExportV1["descuentosRecargos"] = [];
  const indExe: 1 | null = exenta ? 1 : null;
  d.lineas.forEach((l, i) => {
    const monto = entero(l.subtotal);
    if (monto > 0) {
      const { codigo, nombre } = separarCodigo(l.descripcion);
      const nombreCorto = nombre.length > 80 ? nombre.slice(0, 80) : nombre;
      detalle.push({
        linea: detalle.length + 1,
        codigo: codigo ? { tipo: "INT1", valor: codigo } : null,
        nombre: nombreCorto,
        descripcion: nombre.length > 80 ? t(l.descripcion) : null,
        cantidad: Number(l.cantidad) || 1,
        unidad: "UN",
        precioUnitario: Math.round((Number(l.precioUnitario) || 0) * 1e6) / 1e6,
        descuentoPct: 0,
        descuentoMonto: 0,
        montoItem: monto,
        indicadorExencion: indExe,
      });
    } else if (monto < 0) {
      descuentos.push({ linea: descuentos.length + 1, tipoMovimiento: "D", glosa: t(l.descripcion).slice(0, 45), tipoValor: "$", valor: -monto, indicadorExencion: indExe });
    } else {
      errores.push(`La línea ${i + 1} («${t(l.descripcion).slice(0, 60)}») tiene monto $ 0: valorícela o quítela antes de exportar.`);
    }
  });
  if (!d.lineas.length) errores.push("La factura no tiene líneas: agréguelas en «Revisar y emitir» antes de exportar.");

  const items = detalle.reduce((a, x) => a + x.montoItem, 0);
  const dsc = descuentos.reduce((a, x) => a + x.valor, 0);
  const base = items - dsc;
  const montoNeto = exenta ? 0 : base;
  const montoExento = exenta ? base : 0;
  const iva = exenta ? 0 : Math.round((montoNeto * TASA_IVA) / 100);
  const totales = { montoNeto, montoExento, tasaIva: exenta ? null : TASA_IVA, iva, montoTotal: montoNeto + iva + montoExento };
  if (d.lineas.length) errores.push(...erroresCuadratura(totales, tipoDte));

  // Lo exportado debe ser lo mismo que registra el LIMS (lo que se cobra y se concilia).
  if (!errores.length) {
    const reg = { neto: entero(f.neto), iva: entero(f.ivaMonto), total: entero(f.total) };
    if (reg.neto !== base || reg.iva !== iva || reg.total !== totales.montoTotal)
      errores.push(
        `Los importes registrados en la factura (neto ${pesos(reg.neto)}, IVA ${pesos(reg.iva)}, total ${pesos(reg.total)}) no cuadran con sus líneas (neto ${pesos(base)}, IVA ${pesos(iva)}, total ${pesos(totales.montoTotal)}). Si está pendiente, guarde de nuevo las líneas en «Revisar y emitir»; si ya está emitida, corríjala con una nota de crédito.`,
      );
  }

  const r: ReceptorEntrada = d.receptor ?? {};
  if (d.receptor && !t(r.contactoNombre) && !t(r.contactoCorreo))
    advertencias.push("El cliente no tiene contacto principal (nombre o correo): complételo en Clientes si el sistema de facturación lo pide.");
  const e = d.emisor;
  if ([e.rut, e.razonSocial, e.giro, e.direccion, e.comuna, e.ciudad, e.acteco].some(esPrueba))
    advertencias.push("Los datos del emisor son de ejemplo («PRUEBA»): reemplácelos por los del IDIC en Parámetros del sistema antes de usar el archivo.");
  if (!t(e.acteco)) advertencias.push("Falta el código de actividad económica (Acteco) del emisor en Parámetros del sistema.");
  const pendiente = f.estado === "pendiente";
  if (pendiente)
    advertencias.push(
      "La factura está pendiente de emitir en el LIMS: el folio tributario lo asigna el sistema de facturación. Después registre ese folio en «Revisar y emitir».",
    );

  if (errores.length) return { documento: null, errores, advertencias };

  const dias = Math.max(0, Math.round(Number(d.receptor?.diasCredito ?? 0)));
  const fp = formaPagoSii(d.formaPago?.codigo, dias);
  const fechaEmision = pendiente || !f.fechaEmision ? d.hoy : f.fechaEmision;
  const referencias = d.referencias
    .filter((x) => t(x.folio))
    .map((x, i) => ({
      linea: i + 1,
      tipo: x.tipo,
      tipoDocSii: x.tipo === "OC" ? "801" : x.tipo === "RESOLUCION" ? "804" : null,
      folio: t(x.folio),
      fecha: x.fecha ? String(x.fecha).slice(0, 10) : null,
      razon: x.razon ? t(x.razon).slice(0, 90) : null,
    }));

  const documento: DocumentoExportV1 = {
    esquema: ESQUEMA_FACTURA,
    generadoEn,
    origen: { sistema: "LIMS IDIC", idFactura: f.id, estadoLims: f.estado, origenLims: f.origen ?? null },
    encabezado: {
      tipoDte,
      tipoDteNombre: exenta ? "Factura no afecta o exenta electrónica" : "Factura electrónica",
      folioInterno: f.numero,
      folioTributario: pendiente ? null : f.numero,
      fechaEmision,
      fechaEmisionSugerida: pendiente || !f.fechaEmision,
      fechaVencimiento: fp.codigoSii === 2 ? sumarDias(fechaEmision, dias) : null,
      formaPago: { ...fp, codigoLims: d.formaPago?.codigo ?? null, textoLims: d.formaPago?.etiqueta ?? null, diasCredito: dias },
      moneda: "CLP",
    },
    emisor: {
      rut: rutSii(e.rut)!,
      razonSocial: t(e.razonSocial).slice(0, 100),
      giro: t(e.giro).slice(0, 80),
      acteco: t(e.acteco) || null,
      direccion: t(e.direccion).slice(0, 70),
      comuna: t(e.comuna).slice(0, 20),
      ciudad: t(e.ciudad).slice(0, 20),
      codigoSucursalSii: t(e.codigoSucursalSii) || null,
      correo: t(e.correo) || null,
      telefono: t(e.telefono) || null,
    },
    receptor: {
      rut: rutSii(r.rut)!,
      razonSocial: t(r.razonSocial).slice(0, 100),
      giro: t(r.giro).slice(0, 40),
      direccion: t(r.direccion).slice(0, 70),
      comuna: t(r.comuna).slice(0, 20),
      ciudad: t(r.ciudad).slice(0, 20),
      correo: t(r.correo) || null,
      contacto: { nombre: t(r.contactoNombre) || null, correo: t(r.contactoCorreo) || null, telefono: t(r.contactoTelefono) || null },
    },
    detalle,
    descuentosRecargos: descuentos,
    totales,
    referencias,
    centroCosto: d.centroCosto ?? null,
    observaciones: t(f.observaciones) || null,
    advertencias,
  };
  return { documento, errores: [], advertencias };
}

/** Nombre de fichero seguro para la exportación de una factura. */
export const nombreArchivoExportacion = (numero: string, ext: "json" | "pdf", prefijo = "Factura") =>
  `${prefijo}-${String(numero).replace(/[^A-Za-z0-9._-]/g, "_")}.${ext}`;
