import { validarTipoCliente, type OpcionTipoCliente } from "./tipo-cliente";

const LISTA: OpcionTipoCliente[] = [
  { codigo: "ley_17798", etiqueta: "Ley 17.798", activo: true },
  { codigo: "ejercito", etiqueta: "Ejército", activo: true },
  { codigo: "institucional", etiqueta: "Institucional", activo: false },
  { codigo: "externo", etiqueta: "Externo", activo: false },
];

describe("validarTipoCliente", () => {
  it("acepta un tipo activo de la lista nueva", () => {
    expect(validarTipoCliente("ley_17798", LISTA)).toEqual({ ok: true });
    expect(validarTipoCliente("ejercito", LISTA, "institucional")).toEqual({ ok: true });
  });

  it("rechaza un tipo antiguo (inactivo) en el alta, con mensaje claro", () => {
    const r = validarTipoCliente("institucional", LISTA);
    expect(r.ok).toBe(false);
    expect((r as any).mensaje).toMatch(/ya no está vigente/);
  });

  it("conserva el tipo antiguo del cliente si no se cambia (edición)", () => {
    expect(validarTipoCliente("institucional", LISTA, "institucional")).toEqual({ ok: true });
  });

  it("no permite pasar de un tipo antiguo a otro también antiguo", () => {
    expect(validarTipoCliente("externo", LISTA, "institucional").ok).toBe(false);
  });

  it("edición sin tipo (undefined) no se valida; vacío o null se rechaza", () => {
    expect(validarTipoCliente(undefined, LISTA, "institucional")).toEqual({ ok: true });
    expect(validarTipoCliente("", LISTA).ok).toBe(false);
    expect(validarTipoCliente(null, LISTA).ok).toBe(false);
  });

  it("rechaza códigos desconocidos", () => {
    const r = validarTipoCliente("marciano", LISTA);
    expect(r.ok).toBe(false);
    expect((r as any).mensaje).toMatch(/desconocido/);
  });

  it("sin lista sembrada usa la lista de respaldo", () => {
    expect(validarTipoCliente("carabineros", [])).toEqual({ ok: true });
    expect(validarTipoCliente("gubernamental", []).ok).toBe(false);
  });
});
