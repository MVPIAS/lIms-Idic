import { ConflictException, ForbiddenException } from "@nestjs/common";
import {
  CATEGORIAS_CONFIGURABLES,
  defConfigurable,
  ejemploFormato,
  erroresFormato,
  erroresMotivo,
  historialDeFila,
  normalizarValor,
  textoValor,
  valorFormulario,
} from "./parametro-configurable";
import { ParametroPorcentajeController, ParametroSistemaController } from "./parametro.module";
import { configDesdeValores } from "../cotizacion/circuito-config";
import { configNumeracion } from "../cotizacion/numeracion-cotizacion";
import { camposDeLaboratorio, inicioNumeracion, plazosRetencion } from "../recepcion/reglas-recepcion";
import { modoEquipo } from "../laboratorio/equipo-captura";

const fila = { codigo: "x", etiqueta: "X" };
const guardar = (cat: string, cod: string, v: unknown) => normalizarValor(defConfigurable(cat, cod)!, { ...fila, codigo: cod }, v);

describe("parámetros de la operación (R1) · registro", () => {
  it("están todos los que crearon los frentes R1", () => {
    for (const [cat, cod] of [
      ["numeracion_cotizacion", "formato"], ["numeracion_cotizacion", "digitos"], ["numeracion_cotizacion", "reinicio"], ["numeracion_cotizacion", "inicio"],
      ["circuito_cotizacion", "vb_niveles"], ["circuito_cotizacion", "exigir_consulta_laboratorio"], ["circuito_cotizacion", "exigir_firma_para_aceptar"],
      ["circuito_cotizacion", "cfa_pct"], ["circuito_cotizacion", "margen_particular_pct"],
      ["encuesta", "excluir_origenes"], ["metrologia", "cierre_exige_devolucion"],
      ["recepcion_producto_obligatorio", "LME"], ["numeracion_muestra", "inicio"],
      ["retencion_muestra", "testigo"], ["retencion_muestra", "contramuestra"],
      ["recepcion_campo", "LME.lote"], ["captura_equipo", "obligatorio"],
    ]) expect(defConfigurable(cat, cod)).not.toBeNull();
  });

  it("no incluye los combos ni los porcentajes de la tasa (tienen su propio recuadro)", () => {
    expect(defConfigurable("tipo_cliente", "particular")).toBeNull();
    expect(defConfigurable("bpch_tasa", "tasa_pct")).toBeNull();
    expect(CATEGORIAS_CONFIGURABLES).not.toContain("bpch_tasa");
    expect(defConfigurable("metrologia", "otro")).toBeNull();
    expect(defConfigurable("recepcion_campo", "lme lote")).toBeNull();
  });
});

describe("parámetros de la operación · validación según el tipo", () => {
  it("entero: sin decimales y dentro del rango", () => {
    expect(guardar("numeracion_cotizacion", "digitos", "6").valor?.valor).toBe("6");
    expect(guardar("numeracion_cotizacion", "digitos", 0).errores[0]).toMatch(/entre 1 y 10/);
    expect(guardar("numeracion_cotizacion", "digitos", "5,5").errores[0]).toMatch(/entero/);
    expect(guardar("retencion_muestra", "testigo", "1.5").errores[0]).toMatch(/entero/);
    expect(guardar("retencion_muestra", "contramuestra", "601").errores[0]).toMatch(/meses/);
    expect(guardar("numeracion_muestra", "inicio", "0").errores[0]).toMatch(/entre 1/);
  });

  it("porcentaje: coma decimal, 0–100, se guarda con punto", () => {
    expect(guardar("circuito_cotizacion", "cfa_pct", "12,5").valor?.valor).toBe("12.5");
    expect(guardar("circuito_cotizacion", "cfa_pct", "101").errores[0]).toMatch(/entre 0 y 100/);
    expect(guardar("circuito_cotizacion", "margen_particular_pct", "abc").errores[0]).toMatch(/número/);
  });

  it("sí/no: se guarda «si» / «no», que es lo que leen el circuito y el cierre", () => {
    const no = guardar("circuito_cotizacion", "exigir_firma_para_aceptar", false).valor!;
    expect(no.valor).toBe("no");
    expect(configDesdeValores({ exigir_firma_para_aceptar: no.valor }).exigirFirma).toBe(false);
    expect(configDesdeValores({ exigir_firma_para_aceptar: guardar("circuito_cotizacion", "exigir_firma_para_aceptar", true).valor!.valor }).exigirFirma).toBe(true);
    expect(guardar("metrologia", "cierre_exige_devolucion", "quizá").errores[0]).toMatch(/Sí o No/);
  });

  it("opción: solo las ofrecidas, y el lector las entiende", () => {
    expect(guardar("circuito_cotizacion", "vb_niveles", "lab").valor?.valor).toBe("lab");
    expect(guardar("circuito_cotizacion", "vb_niveles", "todos").errores.length).toBe(1);
    expect(modoEquipo(guardar("captura_equipo", "obligatorio", "siempre").valor!.valor)).toBe("siempre");
    expect(configNumeracion({ reinicio: guardar("numeracion_cotizacion", "reinicio", "anual").valor!.valor }).reinicio).toBe("anual");
  });

  it("varias opciones: en el orden de la lista, separadas por coma; vacío = ninguna", () => {
    expect(guardar("encuesta", "excluir_origenes", ["INTERLABORATORIO", "OT_INTERNA"]).valor?.valor).toBe("INTERLABORATORIO,OT_INTERNA");
    expect(guardar("encuesta", "excluir_origenes", []).valor?.valor).toBe("");
    expect(guardar("encuesta", "excluir_origenes", ["OTRO"]).errores[0]).toMatch(/desconocidas/);
    expect(guardar("encuesta", "excluir_origenes", "OT_INTERNA").errores[0]).toMatch(/lista/);
  });

  it("formato: {N} una vez, solo {AAAA} y {N}, caracteres seguros", () => {
    expect(erroresFormato("{AAAA}-{N}")).toEqual([]);
    expect(erroresFormato("COT/{AAAA}/{N}")).toEqual([]);
    expect(erroresFormato("{AAAA}")[0]).toMatch(/\{N\}/);
    expect(erroresFormato("{N}-{N}")[0]).toMatch(/una vez/);
    expect(erroresFormato("{MM}-{N}")[0]).toMatch(/marcas/);
    expect(erroresFormato("<b>{N}")[0]).toMatch(/letras/);
    expect(ejemploFormato("{AAAA}-{N}", 5, 2026, 14324)).toBe("2026-14324");
    expect(ejemploFormato("COT-{N}", 6, 2026, 7)).toBe("COT-000007");
  });

  it("obligatorio por laboratorio: es la columna activo", () => {
    const r = guardar("recepcion_producto_obligatorio", "LQC", true).valor!;
    expect(r).toEqual({ activo: true, historial: "si" });
    expect(historialDeFila(defConfigurable("recepcion_producto_obligatorio", "LQC")!, { codigo: "LQC", valor: null, activo: false })).toBe("no");
  });

  it("campo de recepción: un campo por clave, validado con el mismo lector de la recepción", () => {
    const r = normalizarValor(defConfigurable("recepcion_campo", "LME.lote")!, { codigo: "LME.lote", etiqueta: "Lote" }, {
      tipo: "lista",
      obligatorio: true,
      opciones: [{ valor: "a", etiqueta: "A" }, { valor: "b", etiqueta: "" }],
      ayuda: "Del rótulo",
      activo: true,
    });
    expect(r.errores).toEqual([]);
    expect(JSON.parse(r.valor!.valor!)).toEqual({ tipo: "lista", obligatorio: true, opciones: [{ valor: "a", etiqueta: "A" }, { valor: "b", etiqueta: "b" }], ayuda: "Del rótulo" });
    // La recepción lo lee tal cual.
    const [c] = camposDeLaboratorio([{ codigo: "LME.lote", etiqueta: "Lote", valor: r.valor!.valor, activo: true }], "LME");
    expect(c).toMatchObject({ codigo: "lote", tipo: "lista", obligatorio: true });

    const campo = (v: unknown, codigo = "LME.lote") => normalizarValor(defConfigurable("recepcion_campo", codigo)!, { codigo, etiqueta: "E" }, v).errores;
    expect(campo({ tipo: "lista", opciones: [] })[0]).toMatch(/al menos una/);
    expect(campo({ tipo: "lista", opciones: [{ valor: "a" }, { valor: "a" }] })[0]).toMatch(/mismo valor/);
    expect(campo({ tipo: "color" })[0]).toMatch(/tipo/);
    expect(campo({ tipo: "lista", opciones: [{ valor: "bodega" }] }, "LME.clase_custodia")[0]).toMatch(/clase_custodia/);
    expect(campo({ tipo: "texto", ayuda: "x".repeat(301) })[0]).toMatch(/300/);
    // Desactivar un campo: queda en el historial y la recepción deja de pedirlo.
    const off = normalizarValor(defConfigurable("recepcion_campo", "LME.lote")!, { codigo: "LME.lote", etiqueta: "Lote" }, { tipo: "texto", activo: false }).valor!;
    expect(off.activo).toBe(false);
    expect(textoValor(defConfigurable("recepcion_campo", "LME.lote")!, off.historial)).toBe("Texto · opcional · inactivo");
  });

  it("los lectores de recepción entienden lo guardado", () => {
    expect(inicioNumeracion(guardar("numeracion_muestra", "inicio", 500).valor!.valor)).toBe(500);
    expect(plazosRetencion([{ codigo: "testigo", valor: guardar("retencion_muestra", "testigo", 3).valor!.valor, activo: true }])).toEqual({ testigo: 3 });
  });

  it("motivo obligatorio de 5 a 500 caracteres", () => {
    expect(erroresMotivo("ok")[0]).toMatch(/motivo/);
    expect(erroresMotivo(undefined)[0]).toMatch(/motivo/);
    expect(erroresMotivo("Acuerdo con el IDIC")).toEqual([]);
    expect(erroresMotivo("x".repeat(501))[0]).toMatch(/500/);
  });
});

describe("parámetros de la operación · lectura y texto", () => {
  it("valor para el formulario según el tipo", () => {
    const f = (cat: string, cod: string, valor: string | null, activo = true) => valorFormulario(defConfigurable(cat, cod)!, { codigo: cod, valor, activo });
    expect(f("circuito_cotizacion", "exigir_firma_para_aceptar", "si")).toBe(true);
    expect(f("circuito_cotizacion", "exigir_consulta_laboratorio", "basura")).toBe(false); // por defecto «no»
    expect(f("encuesta", "excluir_origenes", "ot_interna, INTERLABORATORIO")).toEqual(["INTERLABORATORIO", "OT_INTERNA"]);
    expect(f("numeracion_cotizacion", "digitos", "5")).toBe(5);
    expect(f("recepcion_producto_obligatorio", "LTX", null, false)).toBe(false);
    expect(f("recepcion_campo", "LME.lote", '{"tipo":"texto"}', false)).toEqual({ tipo: "texto", obligatorio: false, opciones: [], ayuda: "", activo: false });
  });

  it("texto legible", () => {
    expect(textoValor(defConfigurable("circuito_cotizacion", "cfa_pct")!, "12.5")).toBe("12,5 %");
    expect(textoValor(defConfigurable("retencion_muestra", "contramuestra")!, "12")).toBe("12 meses");
    expect(textoValor(defConfigurable("encuesta", "excluir_origenes")!, "")).toBe("Ninguno");
    expect(textoValor(defConfigurable("circuito_cotizacion", "vb_niveles")!, "lab")).toBe("Solo el laboratorio");
    expect(textoValor(defConfigurable("metrologia", "cierre_exige_devolucion")!, "no")).toBe("No");
  });
});

describe("parámetros de la operación · solo cambian con motivo", () => {
  const filas: Record<string, any> = {
    circuito: { id: "p1", categoria: "circuito_cotizacion", codigo: "exigir_firma_para_aceptar", valor: "si", activo: true },
    campo: { id: "p2", categoria: "recepcion_campo", codigo: "LME.lote", valor: '{"tipo":"texto"}', activo: true },
    combo: { id: "p3", categoria: "tipo_cliente", codigo: "particular", valor: null, activo: true },
  };
  let actual = filas.circuito;
  const svc = {
    detalle: jest.fn(async () => actual),
    actualizar: jest.fn(async () => ({ ok: true })),
    eliminar: jest.fn(async () => ({ ok: true })),
    crear: jest.fn(async () => ({ ok: true })),
    configurables: jest.fn(async (_t: string, puede: boolean) => ({ puedeEditar: puede })),
  };
  const ctl = new ParametroSistemaController(svc as any);
  const req = { user: { sub: "u", tenantId: "t", permisos: ["catalogo.gestionar"] } };
  const ID = "11111111-1111-1111-1111-111111111111";

  it("PATCH genérico: valor, activo o clave → 409; etiqueta y orden sí", async () => {
    actual = filas.circuito;
    await expect(ctl.actualizar(ID, { valor: "no" }, req)).rejects.toBeInstanceOf(ConflictException);
    await expect(ctl.actualizar(ID, { activo: false }, req)).rejects.toBeInstanceOf(ConflictException);
    await expect(ctl.actualizar(ID, { codigo: "otro" }, req)).rejects.toBeInstanceOf(ConflictException);
    actual = filas.campo;
    await expect(ctl.actualizar(ID, { valor: '{"tipo":"fecha"}' }, req)).rejects.toBeInstanceOf(ConflictException);
    await ctl.actualizar(ID, { etiqueta: "Lote del fabricante", orden: 3 }, req);
    // Un combo no se puede mover a una categoría protegida.
    actual = filas.combo;
    await expect(ctl.actualizar(ID, { categoria: "recepcion_campo", codigo: "LME.otro" }, req)).rejects.toBeInstanceOf(ConflictException);
    await ctl.actualizar(ID, { activo: false }, req);
    expect(svc.actualizar).toHaveBeenCalledTimes(2);
  });

  it("alta y baja genéricas en categorías protegidas → 409", async () => {
    await expect(ctl.crear({ categoria: "recepcion_campo", codigo: "LME.nuevo", etiqueta: "Nuevo", valor: '{"tipo":"texto"}' }, req)).rejects.toBeInstanceOf(ConflictException);
    await expect(ctl.crear({ categoria: "circuito_cotizacion", codigo: "cfa_pct", etiqueta: "CFA" }, req)).rejects.toBeInstanceOf(ConflictException);
    await ctl.crear({ categoria: "tipo_cliente", codigo: "nuevo", etiqueta: "Nuevo" }, req);
    expect(svc.crear).toHaveBeenCalledTimes(1);
    actual = filas.campo;
    await expect(ctl.eliminar(ID, req)).rejects.toBeInstanceOf(ConflictException);
  });

  it("leer: con catalogo.gestionar; editar solo con alcance global", async () => {
    const global = { alcancePermisos: jest.fn(async () => ({ esGlobal: true, unidadIds: [] })) };
    const acotado = { alcancePermisos: jest.fn(async () => ({ esGlobal: false, unidadIds: ["lab"] })) };
    await expect(new ParametroPorcentajeController(svc as any, global as any).configurables(req)).resolves.toEqual({ puedeEditar: true });
    await expect(new ParametroPorcentajeController(svc as any, acotado as any).configurables(req)).resolves.toEqual({ puedeEditar: false });
    await expect(
      new ParametroPorcentajeController(svc as any, global as any).configurables({ user: { tenantId: "t", permisos: ["cotizacion.crear"] } }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
