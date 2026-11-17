import { errorQuitarDeBateria, revisarBateria } from "./bateria";
import { errorEntregaBpch } from "./entrega-bpch";

describe("Quitar un ensayo de la batería en la captura (F007)", () => {
  it("en el BPCH, un ensayo de la batería solo lo quita quien tiene la excepción", () => {
    expect(errorQuitarDeBateria({ esBpch: true, enBateria: true, permitido: false, ensayo: "EMB-01" })).toMatch(/EMB-01.*batería/);
    expect(errorQuitarDeBateria({ esBpch: true, enBateria: true, permitido: true })).toBeNull();
  });
  it("fuera de la batería o fuera del BPCH no aplica", () => {
    expect(errorQuitarDeBateria({ esBpch: true, enBateria: false, permitido: false })).toBeNull();
    expect(errorQuitarDeBateria({ esBpch: false, enBateria: true, permitido: false })).toBeNull();
  });
});

const bateria = [
  { id: "1", codigo: "IV-01", nombre: "Inspección visual" },
  { id: "2", codigo: "EMB-01", nombre: "Embalaje" },
];

describe("Batería de ensayos fija del BPCH (R4)", () => {
  it("con toda la batería no hay nada que decir", () => {
    expect(revisarBateria(bateria, ["1", "2", "3"], null)).toEqual({ faltan: [], error: null, excepcion: false });
  });
  it("quitar un ensayo sin excepción se rechaza", () => {
    const r = revisarBateria(bateria, ["1"], null);
    expect(r.error).toMatch(/EMB-01/);
  });
  it("la excepción exige el permiso y un motivo", () => {
    expect(revisarBateria(bateria, ["1"], { motivo: "Sin embalaje en la partida", permitido: false }).error).toMatch(/solo autoriza la jefatura/);
    // F002: el mensaje no muestra el código técnico del permiso.
    expect(revisarBateria(bateria, ["1"], { motivo: "Sin embalaje en la partida", permitido: false }).error).not.toMatch(/bpch\.bateria/);
    expect(revisarBateria(bateria, ["1"], { motivo: "abc", permitido: true }).error).toMatch(/motivo/);
    expect(revisarBateria(bateria, ["1"], { motivo: "Sin embalaje en la partida", permitido: true })).toMatchObject({ error: null, excepcion: true });
  });
  it("sin batería en el catálogo no se exige nada", () => {
    expect(revisarBateria([], ["9"], null).error).toBeNull();
  });
});

describe("Entrega del documento final del BPCH por Comercial (R4)", () => {
  const base = { tipoDocumento: "CERTIFICADO_CONFORMIDAD", esBpch: true, origen: "INTERNACION", despacho: null };
  it("sin remisión a DCO no se entrega", () => {
    expect(errorEntregaBpch(base)).toMatch(/Remitir a DCO/);
  });
  it("remitido pero no recibido por Comercial tampoco", () => {
    expect(errorEntregaBpch({ ...base, despacho: { destino: "DCO", recibidoAt: null } })).toMatch(/recepción/);
  });
  it("recibido por Comercial se entrega", () => {
    expect(errorEntregaBpch({ ...base, despacho: { destino: "DCO", recibidoAt: "2026-11-10" } })).toBeNull();
  });
  it("no aplica al certificado de control, a otras unidades ni al prototipo", () => {
    expect(errorEntregaBpch({ ...base, tipoDocumento: "INFORME_INSPECCION" })).toBeNull();
    expect(errorEntregaBpch({ ...base, esBpch: false })).toBeNull();
    expect(errorEntregaBpch({ ...base, origen: "PROTOTIPO" })).toBeNull();
  });
});
