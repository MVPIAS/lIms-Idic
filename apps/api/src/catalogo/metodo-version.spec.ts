import { BadRequestException } from "@nestjs/common";
import { conVersionMetodo, diferenciasMetodo, errorMotivoMetodo, modoMotivoMetodo, motivoMetodo, valorLegible } from "./metodo-version";

const FOTO = {
  codigo: "LQC-01", nombre: "Proteína PRUEBA", ensayo: "E1 · Proteína", norma: "NCh 1", instrumento: null, version: "2018",
  servgrp: null, factorOperacion: null, factorValor: null, factorDescripcion: null, equipoRequerido: false,
  qcRequerido: true, qcTipos: ["curva", "blanco"], qcCriterios: { blanco: "0.5" }, margenAdvertenciaPct: null, activo: true,
};

describe("versiones del método · valores legibles", () => {
  it("vacíos, Sí/No, números de la base y listas ordenadas", () => {
    expect(valorLegible(null)).toBeNull();
    expect(valorLegible("  ")).toBeNull();
    expect(valorLegible(true)).toBe("Sí");
    expect(valorLegible("1.500000")).toBe("1,5");
    expect(valorLegible(6.25)).toBe("6,25");
    expect(valorLegible(["curva", "blanco"])).toBe("blanco, curva");
    expect(valorLegible([])).toBeNull();
    expect(valorLegible({ curva: "0.995", blanco: "" })).toBe("curva: 0.995");
  });
});

describe("versiones del método · qué cambió", () => {
  it("sin cambios no hay diferencias (el orden de los tipos no cuenta)", () => {
    expect(diferenciasMetodo(FOTO, { ...FOTO, qcTipos: ["blanco", "curva"], factorValor: null })).toEqual([]);
  });
  it("anota cada campo cambiado con su nombre en pantalla, antes y después", () => {
    const c = diferenciasMetodo(FOTO, { ...FOTO, norma: "NCh 2 PRUEBA", qcRequerido: false, factorValor: "10.000000", factorOperacion: "dividir" });
    expect(c).toEqual([
      { campo: "norma", etiqueta: "Norma", antes: "NCh 1", despues: "NCh 2 PRUEBA" },
      { campo: "factorOperacion", etiqueta: "Factor de la fórmula · operación", antes: null, despues: "dividir" },
      { campo: "factorValor", etiqueta: "Factor de la fórmula · valor", antes: null, despues: "10" },
      { campo: "qcRequerido", etiqueta: "QC requerido", antes: "Sí", despues: "No" },
    ]);
  });
});

describe("versiones del método · motivo del cambio", () => {
  const cambios = diferenciasMetodo(FOTO, { ...FOTO, nombre: "Otro" });
  it("parámetro: obligatorio por defecto", () => {
    expect(modoMotivoMetodo(null)).toBe("obligatorio");
    expect(modoMotivoMetodo("opcional")).toBe("opcional");
  });
  it("obligatorio: con cambios exige 5 caracteres y dice qué cambia", () => {
    expect(errorMotivoMetodo("obligatorio", cambios, "abc")).toMatch(/mínimo 5 caracteres.*Cambia: Nombre\./);
    expect(errorMotivoMetodo("obligatorio", cambios, "Nueva edición de la norma")).toBeNull();
    expect(errorMotivoMetodo("obligatorio", [], null)).toBeNull();
    expect(errorMotivoMetodo("opcional", cambios, null)).toBeNull();
  });
  it("se guarda recortado; vacío es null", () => {
    expect(motivoMetodo("  ")).toBeNull();
    expect(motivoMetodo("x".repeat(600))).toHaveLength(500);
  });
});

describe("versiones del método · transacción", () => {
  function prisma(despues: Record<string, unknown>, modo = "obligatorio") {
    let fotos = 0;
    const tx = {
      $queryRawUnsafe: jest.fn(async (q: string) => {
        if (q.includes("fn_cat_metodo_foto($1")) return [{ foto: fotos++ === 0 ? FOTO : despues }];
        if (q.includes("INSERT INTO cat_metodo_version")) return [{ numero: 4 }];
        return [];
      }),
    };
    return {
      tx,
      $queryRawUnsafe: jest.fn(async () => [{ valor: modo }]),
      $transaction: async (fn: any) => fn(tx),
    };
  }
  it("crea la revisión siguiente con los cambios", async () => {
    const p = prisma({ ...FOTO, norma: "NCh 3" });
    const r = await conVersionMetodo(p as any, { tenantId: "t", metodoId: "m", usuarioId: "u", motivo: "Cambio de norma PRUEBA", origen: "edicion" }, async () => "ok");
    expect(r).toMatchObject({ valor: "ok", revision: 4, cambios: [{ campo: "norma" }] });
  });
  it("sin cambios no crea revisión ni pide motivo", async () => {
    const p = prisma({ ...FOTO });
    const r = await conVersionMetodo(p as any, { tenantId: "t", metodoId: "m", usuarioId: "u", motivo: null, origen: "edicion" }, async () => 1);
    expect(r.revision).toBeNull();
    expect(p.tx.$queryRawUnsafe.mock.calls.some(([q]: any) => String(q).includes("INSERT"))).toBe(false);
  });
  it("sin motivo (obligatorio) deshace con un 400; con «opcional» la registra igual", async () => {
    await expect(
      conVersionMetodo(prisma({ ...FOTO, norma: "X" }) as any, { tenantId: "t", metodoId: "m", usuarioId: "u", motivo: "", origen: "edicion" }, async () => 1),
    ).rejects.toBeInstanceOf(BadRequestException);
    const r = await conVersionMetodo(prisma({ ...FOTO, norma: "X" }, "opcional") as any, { tenantId: "t", metodoId: "m", usuarioId: "u", motivo: "", origen: "edicion" }, async () => 1);
    expect(r.revision).toBe(4);
  });
});
