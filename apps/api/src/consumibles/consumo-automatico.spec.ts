import { descontarPorCaptura, repartoFifo } from "./consumo-automatico";

describe("consumibles · reparto FIFO del descuento automático (§4.4.5)", () => {
  const lotes = [
    { id: "a", numero: "L-A", cantidad: 3 },
    { id: "b", numero: "L-B", cantidad: 5 },
  ];

  it("toma del primer lote y sigue con el siguiente", () => {
    expect(repartoFifo(lotes, 2)).toEqual([{ loteId: "a", numero: "L-A", toma: 2, queda: 1 }]);
    expect(repartoFifo(lotes, 4.5)).toEqual([
      { loteId: "a", numero: "L-A", toma: 3, queda: 0 },
      { loteId: "b", numero: "L-B", toma: 1.5, queda: 3.5 },
    ]);
  });

  it("sin stock suficiente no toma nada", () => {
    expect(repartoFifo(lotes, 8.01)).toBeNull();
    expect(repartoFifo([], 1)).toBeNull();
    expect(repartoFifo(lotes, 8)).toHaveLength(2);
  });
});

/** BD falsa: un método con dos consumibles; solo el primero tiene stock. */
function bdFalsa(yaRegistrado = 0) {
  const ejecutadas: string[] = [];
  const pendientes: unknown[][] = [];
  const db: any = {
    $transaction: (fn: (tx: any) => Promise<unknown>) => fn(db),
    $executeRawUnsafe: async (q: string) => {
      ejecutadas.push(q);
      return 1;
    },
    $queryRawUnsafe: async (q: string, ...p: unknown[]) => {
      if (/count\(\*\)/.test(q)) return [{ n: yaRegistrado }];
      if (/FROM cat_metodo_consumible/.test(q))
        return [
          { consumible_id: "c1", codigo: "R1", nombre: "Ácido", unidad: "mL", cantidad: "2", por: "ensayo" },
          { consumible_id: "c2", codigo: "R2", nombre: "Filtro", unidad: "u", cantidad: "1", por: "ensayo" },
        ];
      if (/FROM lote_consumible/.test(q)) return p[0] === "c1" ? [{ id: "l1", numero_lote: "L1", cantidad_actual: "10" }] : [];
      if (/INSERT INTO consumo_pendiente/.test(q)) {
        pendientes.push(p);
        return [{ id: "pend-1" }];
      }
      return [];
    },
  };
  return { db, ejecutadas, pendientes };
}

const PARAMS = { tenantId: "t", resultadoId: "r", catMetodoId: "m", muestraId: "mu", determinaciones: 1, usuarioId: "u", referencia: "M-1 · resultado r" };

describe("consumibles · captura con la regla «avisar»", () => {
  it("informa lo descontado y deja pendiente lo que no tenía stock", async () => {
    const { db, pendientes } = bdFalsa();
    const r = await descontarPorCaptura(db, PARAMS);
    expect(r.descontados).toEqual([{ consumible: "R1 · Ácido", cantidad: 2, unidad: "mL", lotes: ["L1"] }]);
    expect(r.faltantes).toEqual([{ consumible: "R2 · Filtro", necesario: 1, disponible: 0, unidad: "u", pendienteId: "pend-1" }]);
    expect(pendientes).toHaveLength(1);
    expect(pendientes[0][1]).toBe("c2");
  });

  it("no vuelve a descontar ni a dejar pendiente si el ensayo ya lo tenía (corrección)", async () => {
    const { db, ejecutadas, pendientes } = bdFalsa(1);
    const r = await descontarPorCaptura(db, PARAMS);
    expect(r).toEqual({ descontados: [], faltantes: [] });
    expect(ejecutadas).toHaveLength(0);
    expect(pendientes).toHaveLength(0);
  });
});
