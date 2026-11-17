import {
  errorCerrarReapertura,
  errorResolverReapertura,
  errorSolicitarReapertura,
  facturaTomaValorFinal,
  fotoCotizacion,
  siguienteVersion,
} from "./reapertura";
import { validarTransicion } from "../common/estados";

describe("COM-02 · Reabrir cotización", () => {
  it("solo se pide sobre una Aceptada, sin otra en curso y con motivo", () => {
    expect(errorSolicitarReapertura({ codigo: "2026-00001", estado: "abierta" }, null, "Se trabajó menos de lo cotizado")).toMatch(/Solo se reabre una cotización Aceptada/);
    expect(errorSolicitarReapertura({ estado: "aceptada" }, { id: "r", estado: "solicitada" }, "Se trabajó menos de lo cotizado")).toMatch(/esperando la autorización/);
    expect(errorSolicitarReapertura({ estado: "aceptada" }, { id: "r", estado: "autorizada" }, "Se trabajó menos de lo cotizado")).toMatch(/ya está reabierta/);
    expect(errorSolicitarReapertura({ estado: "aceptada" }, null, "corto")).toMatch(/motivo/);
    expect(errorSolicitarReapertura({ estado: "aceptada" }, null, "Se analizaron 3 muestras y no 5")).toBeNull();
  });

  it("el Jefe DCO autoriza o rechaza (rechazar exige motivo)", () => {
    expect(errorResolverReapertura(null, true, null)).toMatch(/No hay una solicitud/);
    expect(errorResolverReapertura({ id: "r", estado: "autorizada" }, true, null)).toMatch(/No hay una solicitud/);
    expect(errorResolverReapertura({ id: "r", estado: "solicitada" }, false, "")).toMatch(/motivo/);
    expect(errorResolverReapertura({ id: "r", estado: "solicitada" }, false, "No corresponde")).toBeNull();
    expect(errorResolverReapertura({ id: "r", estado: "solicitada" }, true, null)).toBeNull();
  });

  it("el valor final solo se registra con la cotización reabierta y con líneas", () => {
    expect(errorCerrarReapertura({ estado: "aceptada" }, { id: "r", estado: "autorizada" })).toMatch(/no está reabierta/);
    expect(errorCerrarReapertura({ estado: "reabierta", lineas: 0 }, { id: "r", estado: "autorizada" })).toMatch(/no tiene líneas/);
    expect(errorCerrarReapertura({ estado: "reabierta", lineas: 2 }, { id: "r", estado: "autorizada" })).toBeNull();
  });

  it("la máquina de estados: Aceptada ↔ Reabierta", () => {
    expect(() => validarTransicion("cotizacion", "aceptada", "reabierta")).not.toThrow();
    expect(() => validarTransicion("cotizacion", "reabierta", "aceptada")).not.toThrow();
    expect(() => validarTransicion("cotizacion", "abierta", "reabierta")).toThrow();
    expect(() => validarTransicion("cotizacion", "reabierta", "anulada")).toThrow();
  });

  it("versiones: la aceptada es la 1, cada reapertura suma una", () => {
    expect(siguienteVersion([])).toBe(2);
    expect(siguienteVersion([2, 3])).toBe(4);
  });

  it("guarda la foto de la versión (totales y líneas) y solo la factura pendiente toma el valor final", () => {
    const f = fotoCotizacion({
      codigo: "2026-00010",
      moneda: "CLP",
      neto: "100000",
      ivaPct: "19",
      total: "119000",
      lineas: [{ orden: 1, ensayoCodigo: "EN001", descripcion: "PRUEBA", cantidad: 2, precioUnitario: "50000", subtotal: "100000" }],
    });
    expect(f).toMatchObject({ total: 119000, neto: 100000, lineas: [{ ensayoCodigo: "EN001", subtotal: 100000 }] });
    expect(facturaTomaValorFinal("pendiente")).toBe(true);
    expect(facturaTomaValorFinal("emitida")).toBe(false);
  });
});
