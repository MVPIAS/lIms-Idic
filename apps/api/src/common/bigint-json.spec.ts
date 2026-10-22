import { instalarSerializacionBigInt } from "./bigint-json";

describe("serialización de BigInt a JSON (D02-01)", () => {
  beforeAll(() => instalarSerializacionBigInt());

  it("un BigInt se escribe como texto decimal, sin perder precisión", () => {
    expect(JSON.stringify({ numeroInterno: BigInt(12) })).toBe('{"numeroInterno":"12"}');
    expect(JSON.stringify({ n: BigInt("9007199254740993") })).toBe('{"n":"9007199254740993"}');
  });

  it("funciona anidado (listado paginado de Prisma con muestras)", () => {
    const pagina = { data: [{ id: "a", numeroInterno: BigInt(1) }, { id: "b", numeroInterno: null }], meta: { total: 2 } };
    expect(JSON.parse(JSON.stringify(pagina)).data.map((m: any) => m.numeroInterno)).toEqual(["1", null]);
  });

  it("instalarlo dos veces no cambia nada", () => {
    instalarSerializacionBigInt();
    expect(JSON.stringify([BigInt(3)])).toBe('["3"]');
  });
});
