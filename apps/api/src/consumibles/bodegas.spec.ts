import {
  costoConsumos,
  costoUnitarioLote,
  erroresBodega,
  erroresTraspaso,
  modoConsumo,
  ordenarLotesPorBodega,
  prioridadLote,
  resumenInventario,
  valorLote,
} from "./bodegas";

const LQC = "lab-lqc";
const LPN = "lab-lpn";

describe("Bodegas · de dónde sale un consumo", () => {
  const central = { tipo: "central" as const, unidadId: null };
  const propia = { tipo: "laboratorio" as const, unidadId: LQC };
  const ajena = { tipo: "laboratorio" as const, unidadId: LPN };
  const sinBodega = { tipo: null, unidadId: null };

  it("laboratorio primero: sub-bodega propia, luego la central; nunca la de otro laboratorio", () => {
    expect(prioridadLote(propia, [LQC], "laboratorio_primero")).toBe(0);
    expect(prioridadLote(central, [LQC], "laboratorio_primero")).toBe(1);
    expect(prioridadLote(sinBodega, [LQC], "laboratorio_primero")).toBe(1);
    expect(prioridadLote(ajena, [LQC], "laboratorio_primero")).toBeNull();
  });
  it("sin laboratorio conocido se puede usar cualquier bodega, la central antes", () => {
    expect(prioridadLote(central, [], "laboratorio_primero")).toBe(1);
    expect(prioridadLote(ajena, [], "laboratorio_primero")).toBe(2);
  });
  it("solo laboratorio: excluye la central si se sabe el laboratorio", () => {
    expect(prioridadLote(central, [LQC], "solo_laboratorio")).toBeNull();
    expect(prioridadLote(propia, [LQC], "solo_laboratorio")).toBe(0);
  });
  it("ordena por bodega sin romper el FIFO de caducidad", () => {
    const lotes = [
      { id: "c1", ...central },
      { id: "a1", ...ajena },
      { id: "p1", ...propia },
      { id: "c2", ...central },
      { id: "p2", ...propia },
    ];
    expect(ordenarLotesPorBodega(lotes, [LQC], "laboratorio_primero").map((l) => l.id)).toEqual(["p1", "p2", "c1", "c2"]);
    expect(ordenarLotesPorBodega(lotes, [LQC], "todas").map((l) => l.id)).toEqual(["c1", "a1", "p1", "c2", "p2"]);
  });
  it("el parámetro desconocido vuelve al modo por defecto", () => {
    expect(modoConsumo("SOLO_LABORATORIO")).toBe("solo_laboratorio");
    expect(modoConsumo("x")).toBe("laboratorio_primero");
    expect(modoConsumo(null)).toBe("laboratorio_primero");
  });
});

describe("Bodegas · inventario valorizado por lote", () => {
  it("usa el precio del lote; si falta, el costo del consumible; si no hay ninguno, queda pendiente", () => {
    expect(costoUnitarioLote({ costoLote: 1200, costoConsumible: 900 })).toEqual({ costo: 1200, fuente: "lote" });
    expect(costoUnitarioLote({ costoLote: null, costoConsumible: 900 })).toEqual({ costo: 900, fuente: "consumible" });
    expect(costoUnitarioLote({ costoLote: null, costoConsumible: 0 })).toEqual({ costo: null, fuente: "pendiente" });
    expect(costoUnitarioLote({ costoLote: 0, costoConsumible: null })).toEqual({ costo: 0, fuente: "lote" });
  });
  it("valoriza el stock del lote y cuenta los lotes sin costo", () => {
    expect(valorLote({ cantidad: 2.5, costoLote: 1000.4, costoConsumible: null })).toEqual({ costoUnitario: 1000.4, fuente: "lote", valor: 2501 });
    expect(valorLote({ cantidad: 3, costoLote: null, costoConsumible: null }).valor).toBeNull();
    expect(
      resumenInventario([
        { cantidad: 2, costoLote: 100, costoConsumible: null },
        { cantidad: 1, costoLote: null, costoConsumible: 50 },
        { cantidad: 4, costoLote: null, costoConsumible: null },
        { cantidad: 0, costoLote: null, costoConsumible: null },
      ]),
    ).toEqual({ lotes: 4, valorizado: 250, sinCosto: 1 });
  });
  it("valoriza los consumos de una OT con el costo de cada lote", () => {
    expect(
      costoConsumos([
        { cantidad: 2, costoLote: 100, costoConsumible: 80 },
        { cantidad: 1, costoLote: null, costoConsumible: 70 },
        { cantidad: 0.5, costoLote: null, costoConsumible: null },
      ]),
    ).toEqual({ total: 270, cantidad: 3.5, sinCosto: 0.5, costoPromedio: 90 });
    expect(costoConsumos([{ cantidad: 1, costoLote: null, costoConsumible: null }]).costoPromedio).toBeNull();
  });
});

describe("Bodegas · traspasos y altas", () => {
  const ok = { cantidad: 2, stockOrigen: 5, bodegaOrigenId: "b1", bodegaDestinoId: "b2", destinoActiva: true, loteVencido: false };
  it("acepta un traspaso válido", () => expect(erroresTraspaso(ok)).toEqual([]));
  it("rechaza cantidad mayor que el stock, la misma bodega, destino inactivo y lote vencido", () => {
    expect(erroresTraspaso({ ...ok, cantidad: 6 })).toHaveLength(1);
    expect(erroresTraspaso({ ...ok, cantidad: 0 })).toHaveLength(1);
    expect(erroresTraspaso({ ...ok, bodegaDestinoId: "b1" })).toHaveLength(1);
    expect(erroresTraspaso({ ...ok, destinoActiva: false })).toHaveLength(1);
    expect(erroresTraspaso({ ...ok, loteVencido: true })).toHaveLength(1);
  });
  it("una sub-bodega lleva laboratorio y solo hay una central", () => {
    expect(erroresBodega({ tipo: "laboratorio", unidadId: null, codigo: "SB", nombre: "x" }, false)).toHaveLength(1);
    expect(erroresBodega({ tipo: "central", unidadId: null, codigo: "BC", nombre: "x" }, true)).toHaveLength(1);
    expect(erroresBodega({ tipo: "central", unidadId: LQC, codigo: "BC", nombre: "x" }, false)).toHaveLength(1);
    expect(erroresBodega({ tipo: "laboratorio", unidadId: LQC, codigo: "SB-LQC", nombre: "Sub-bodega" }, true)).toEqual([]);
    expect(erroresBodega({ tipo: "otra" }, false)).toHaveLength(1);
  });
});
