import { erroresFicha, importeItem, totalesFicha } from "./ficha-ensayo";

describe("ficha de ensayo (reunión 2)", () => {
  it("importe = cantidad × horas × valor; sin valor queda en blanco", () => {
    expect(importeItem({ bloque: "personal", descripcion: "Técnico PRUEBA", cantidad: 2, horas: 3, valorUnitario: 1000 })).toBe(6000);
    expect(importeItem({ bloque: "insumos", descripcion: "Reactivo", cantidad: 4, valorUnitario: 250 })).toBe(1000);
    expect(importeItem({ bloque: "equipos", descripcion: "Equipo", horas: 2, valorUnitario: null })).toBeNull();
  });

  it("totales por bloque y estructura del precio solo con el desglose completo", () => {
    const t = totalesFicha([
      { bloque: "personal", descripcion: "a", cantidad: 1, horas: 10, valorUnitario: 1000 },
      { bloque: "insumos", descripcion: "b", cantidad: 1, valorUnitario: 0 },
    ]);
    expect(t.costoDirecto).toBe(10000);
    expect(t.porBloque.personal).toEqual({ items: 1, importe: 10000, sinValor: 0 });
    expect(t.estructura).toMatchObject({ costoDirecto: 10000, costoIndirecto: 2000, costoTotal: 12000, recargo: 3600, neto: 15600 });
    const inc = totalesFicha([{ bloque: "equipos", descripcion: "x", horas: 1 }]);
    expect(inc.incompleto).toBe(true);
    expect(inc.estructura).toBeNull();
    expect(totalesFicha([]).vacia).toBe(true);
  });

  it("valida bloques, descripción y números", () => {
    expect(erroresFicha([{ bloque: "personal", descripcion: "ok", cantidad: 1, horas: 1, valorUnitario: 1 }])).toEqual([]);
    expect(erroresFicha([{ bloque: "magia", descripcion: " ", cantidad: 0, horas: -1, valorUnitario: -5 }])).toHaveLength(5);
  });
});
