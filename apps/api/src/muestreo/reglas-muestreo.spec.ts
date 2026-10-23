import { contarDefectuosas, erroresRecepcion, faltantesRegistro, motivoNoEditable, normalizarPlan, normalizarSellos } from "./reglas-muestreo";

describe("Muestreo · sellos", () => {
  it("separa por coma, punto y coma o línea, sin repetidos", () => {
    expect(normalizarSellos("S-001, S-002; s-001\nS-003 ")).toEqual(["S-001", "S-002", "S-003"]);
    expect(normalizarSellos(null)).toEqual([]);
  });
});

describe("Muestreo · plan NCh 44 del lote", () => {
  it("propone n y Ac/Re por clase (SVM lote 70, nivel II)", () => {
    const r = normalizarPlan({ nivel: "II", aql: { mayor: "4", menor: "6,5" } }, 70);
    expect(r.errores).toEqual([]);
    expect(r.plan).toMatchObject({ letra: "E", n: 13, nPropuesto: 13, clases: { mayor: { ac: 1, re: 2 }, menor: { ac: 2, re: 3 } } });
  });
  it("cambiar n exige motivo; nunca más que el lote", () => {
    expect(normalizarPlan({ nivel: "II", n: 10 }, 70).errores[0]).toMatch(/indique el motivo/);
    expect(normalizarPlan({ nivel: "II", n: 10, motivoN: "Acuerdo con el mandante" }, 70).plan?.n).toBe(10);
    expect(normalizarPlan({ nivel: "II", n: 80, motivoN: "Prueba de límite" }, 70).errores[0]).toMatch(/no puede superar/);
  });
  it("sin tamaño de lote no hay plan", () => {
    expect(normalizarPlan({ nivel: "II" }, null).errores[0]).toMatch(/tamaño del lote/);
  });
  it("AQL que no es columna de la tabla", () => {
    expect(normalizarPlan({ nivel: "II", aql: { mayor: "3" } }, 70).errores[0]).toMatch(/no es una columna/);
  });
  it("tablas 2-B/2-C: n y Ac/Re a mano, con motivo", () => {
    expect(normalizarPlan({ nivel: "II", tabla: "reducida", aql: { mayor: 4 } }, 70).errores.join(" ")).toMatch(/escriba el tamaño de muestra/);
    const r = normalizarPlan({ nivel: "II", tabla: "reducida", aql: { mayor: 4 }, n: 5, motivoN: "Tabla 2-C NCh 44", manual: { mayor: { ac: 1, re: 3 } } }, 70);
    expect(r.errores).toEqual([]);
    expect(r.plan?.clases.mayor).toMatchObject({ ac: 1, re: 3, manual: true });
  });
});

describe("Muestreo · registrar → entregar al laboratorio", () => {
  const base = { numeroFormulario: "F-1", fechaToma: "2026-10-01T10:00:00Z", lugar: "Bodega del proveedor" };
  it("formulario de extracción (EP-03 0.4): producto, proveedor, lote, muestra, sellos y fotos", () => {
    const f = faltantesRegistro({ tipoFormulario: "extraccion", ...base }, 0);
    expect(f).toEqual(expect.arrayContaining(["producto / E.T.", "proveedor", "tamaño del lote", "tamaño de la muestra", "Nº de los sellos", "registro fotográfico (Nº o fotos)"]));
    expect(
      faltantesRegistro({ tipoFormulario: "extraccion", ...base, producto: "Bota", proveedor: "P", tamanoLote: 500, tamanoMuestra: 20, sellos: ["S-1"] }, 2),
    ).toEqual([]);
  });
  it("NUMFORM (EP-02 1.1) pide la devolución del excedente y quién solicita", () => {
    const f = faltantesRegistro({ tipoFormulario: "numform", ...base, producto: "Leche", proveedor: "P", cantidadEnvase: "6 cajas", tamanoLote: 100 }, 0);
    expect(f).toEqual(["si se devuelve el excedente", "quién lo solicita"]);
  });
  it("toma en terreno (EP-01 1.1): responsable y cantidad", () => {
    expect(faltantesRegistro({ tipoFormulario: "it01_form06", ...base }, 0)).toEqual(["responsable de la toma", "cantidad y envase"]);
  });
  it("planilla NCh 44: plan o línea móvil con su plan; n del plan = tamaño de muestra", () => {
    const sinPlan = faltantesRegistro({ tipoFormulario: "planilla_nch44", ...base, identificacionLote: "L-1", tamanoLote: 70, tamanoMuestra: 13 }, 0);
    expect(sinPlan.join(" ")).toMatch(/plan de muestreo NCh 44/);
    const movil = faltantesRegistro({ tipoFormulario: "planilla_nch44", ...base, identificacionLote: "L-1", tamanoLote: 70, tamanoMuestra: 13, lineaMovil: true }, 0);
    expect(movil.join(" ")).toMatch(/línea móvil/);
    const plan = normalizarPlan({ nivel: "II" }, 70).plan!;
    expect(faltantesRegistro({ tipoFormulario: "planilla_nch44", ...base, identificacionLote: "L-1", tamanoLote: 70, tamanoMuestra: 12, plan }, 0).join(" ")).toMatch(/coincida con el n del plan/);
  });
  it("fecha de toma futura no", () => {
    const f = faltantesRegistro({ tipoFormulario: "it01_form06", ...base, fechaToma: "2999-01-01T00:00:00Z", responsable: "MP", cantidadEnvase: "1 L" }, 0);
    expect(f).toEqual(["una fecha de toma que no sea futura"]);
  });
  it("estados: se edita el borrador; el laboratorio recibe lo entregado", () => {
    expect(motivoNoEditable("borrador")).toBeNull();
    expect(motivoNoEditable("registrado")).toMatch(/anulándolo/);
    expect(erroresRecepcion("borrador", true)[0]).toMatch(/aún no se entrega/);
    expect(erroresRecepcion("registrado", true)).toEqual([]);
    expect(erroresRecepcion("registrado", false, "x")[0]).toMatch(/qué no está conforme/);
    expect(erroresRecepcion("recibido", true)[0]).toMatch(/ya se recibió/);
  });
});

describe("Muestreo · unidades no conformes por clase", () => {
  it("cada muestra cuenta una vez por clase; sin clase cuenta como mayor", () => {
    const c = contarDefectuosas([
      { muestraId: "m1", veredicto: "no_cumple", claseDefecto: "menor" },
      { muestraId: "m1", veredicto: "no_cumple", claseDefecto: "menor" },
      { muestraId: "m2", veredicto: "no_cumple", claseDefecto: null },
      { muestraId: "m3", veredicto: "pendiente" },
      { muestraId: "m4", veredicto: "cumple", claseDefecto: "critico" },
    ]);
    expect(c).toEqual({ critico: 0, mayor: 1, menor: 1, pendientes: 1, sinClase: 1 });
  });
});

describe("precarga del muestreo desde el encargo (B-087)", () => {
  const { precargaMuestreo } = require("./reglas-muestreo");
  const e = { lugarMuestreo: "Bodega del proveedor", item: "Bota de servicio", etTexto: "ET-12 v1", proveedor: "Proveedor S.A.", cantidad: "500", unidadCantidad: "pares" };
  it("completa lo vacío con lo que sabe la OT", () => {
    expect(precargaMuestreo({ numeroFormulario: "N-1" }, e)).toEqual({
      numeroFormulario: "N-1", lugar: "Bodega del proveedor", producto: "Bota de servicio · ET-12 v1", proveedor: "Proveedor S.A.", tamanoLote: 500, unidadPresentacion: "pares",
    });
  });
  it("lo escrito manda", () => {
    expect(precargaMuestreo({ proveedor: "Otro" }, e).proveedor).toBe("Otro");
    expect(precargaMuestreo({ a: 1 }, null)).toEqual({ a: 1 });
  });
});
