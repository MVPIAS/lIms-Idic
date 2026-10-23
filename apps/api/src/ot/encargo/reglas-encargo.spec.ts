import { documentoPropuesto, erroresEncargo, portadaDesdeEncargo, revisarValidacionLab } from "./reglas-encargo";
import { resolverCobro, validarOrigenOt } from "../reglas-ot";

describe("OT · datos del encargo (EP-00 5.1, EP-03 0.1/0.3, EP-05 0.1/0.3)", () => {
  it("el tipo de trabajo propone el documento: Adquisiciones → IVC, el resto → IE", () => {
    expect(documentoPropuesto("ADQUISICIONES")).toBe("IVC");
    expect(documentoPropuesto("ENSAYOS")).toBe("IE");
    expect(documentoPropuesto(null)).toBeNull();
  });
  it("la OT institucional exige el oficio (salvo que el parámetro lo desactive)", () => {
    expect(erroresEncargo({}, { origen: "INSTITUCIONAL" })).toEqual(expect.arrayContaining([expect.stringMatching(/Nº del oficio/), expect.stringMatching(/fecha del oficio/)]));
    expect(erroresEncargo({}, { origen: "INSTITUCIONAL", exigeOficio: false })).toEqual([]);
    expect(erroresEncargo({ oficioNumero: "OF 123", oficioFecha: "2026-10-01" }, { origen: "INSTITUCIONAL" })).toEqual([]);
  });
  it("carril DSA: extranjero exige país; comisión en fábrica en US$; reinspección con OT de origen", () => {
    expect(erroresEncargo({ lugarEjecucion: "FABRICA_EXTRANJERO" }, {})).toContain("Ejecución en el extranjero: indique el país.");
    expect(erroresEncargo({ carrilDsa: "COMISION_FABRICA", moneda: "CLP" }, {})).toContain("La comisión en fábrica se cotiza y factura en US$.");
    expect(erroresEncargo({ carrilDsa: "REINSPECCION" }, {})).toContain("Una reinspección exige la OT de origen.");
    expect(erroresEncargo({ paga: "proveedor" }, {})).toContain("Quién paga la reinspección se indica junto con la OT de origen.");
    expect(erroresEncargo({ otOrigenId: "a" }, { otId: "a" })).toContain("La OT de origen no puede ser la misma OT.");
  });
  it("la portada del IVC toma contrato, proveedor, ítem y cantidad del encargo", () => {
    const p = portadaDesdeEncargo({ contrato: "C-1", contratoFecha: "2026-03-05", proveedor: "Prov", cantidad: 1500, unidadCantidad: "pares" }, (d) => d.split("-").reverse().join("-"));
    expect(p).toEqual({ contrato: "C-1", fechaContrato: "05-03-2026", proveedor: "Prov", cantidad: "1500 pares" });
  });
});

describe("OT · validación del laboratorio (EP-05 1.2, BL-163)", () => {
  it("alcance no conforme devuelve a Ventas con motivo", () => {
    expect(revisarValidacionLab({ alcanceConforme: false }, {}).errores[0]).toMatch(/motivo/);
    expect(revisarValidacionLab({ alcanceConforme: false, observacion: "La E.T. no corresponde" }, {}).errores).toEqual([]);
  });
  it("conforme exige inicio e informe; término ≥ inicio; SVM exige la clasificación del vehículo", () => {
    expect(revisarValidacionLab({ alcanceConforme: true }, {}).errores).toHaveLength(2);
    expect(revisarValidacionLab({ alcanceConforme: true, fechaInicio: "2026-10-10", fechaTermino: "2026-10-01", fechaInforme: "2026-10-20" }, {}).errores).toContain("La fecha de término es anterior a la de inicio.");
    expect(revisarValidacionLab({ alcanceConforme: true, fechaInicio: "2026-10-10", fechaInforme: "2026-10-20" }, { laboratorio: "SVM" }).errores).toContain("SVM: indique la clasificación del vehículo.");
  });
  it("un informe comprometido después del plazo de la OT es un aviso, no un error", () => {
    const r = revisarValidacionLab({ alcanceConforme: true, fechaInicio: "2026-10-10", fechaInforme: "2026-11-20" }, { fechaCompromiso: "2026-11-01" });
    expect(r.errores).toEqual([]);
    expect(r.avisos).toHaveLength(1);
  });
});

describe("OT institucional sin cobro (EP-01/02 0.5, BL-160)", () => {
  it("nunca tiene cobro", () => {
    expect(resolverCobro("INSTITUCIONAL", undefined)).toEqual({ conCobro: false });
    expect(resolverCobro("INSTITUCIONAL", true).error).toMatch(/sin cobro/);
  });
  it("exige Nº y fecha de oficio y no nace de una cotización", () => {
    expect(validarOrigenOt({ origen: "INSTITUCIONAL" })).toHaveLength(2);
    expect(validarOrigenOt({ origen: "INSTITUCIONAL", oficioNumero: "OF 1", oficioFecha: "2026-10-01" })).toEqual([]);
    expect(validarOrigenOt({ origen: "INSTITUCIONAL", cotizacionId: "x", oficioNumero: "OF 1", oficioFecha: "2026-10-01" })).toHaveLength(1);
  });
});
