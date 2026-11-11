import { claveEnsayoMuestra, etiquetaMuestra, normalizarMuestras, resumenPorMuestra, textoPlazo, validarLineasMuestras } from "./muestras-cotizacion";

describe("cotización por muestra (reunión 5, Químico)", () => {
  it("numera las muestras en orden y completa la descripción vacía", () => {
    const r = normalizarMuestras([{ descripcion: "  Agua red " }, { descripcion: "", productoTexto: "Pintura PRUEBA" }]);
    expect(r.error).toBeUndefined();
    expect(r.muestras.map((m) => [m.n, m.descripcion, m.productoTexto])).toEqual([
      [1, "Agua red", null],
      [2, "Muestra 2", "Pintura PRUEBA"],
    ]);
  });

  it("rechaza un plazo de muestra fuera de 1..730", () => {
    expect(normalizarMuestras([{ plazoDias: 0 }]).error).toMatch(/Muestra 1/);
    expect(normalizarMuestras([{ plazoDias: 731 }]).error).toMatch(/730/);
    expect(normalizarMuestras([{ plazoDias: 10 }]).muestras[0].plazoDias).toBe(10);
  });

  it("sin muestras, una línea no puede indicar muestra", () => {
    expect(validarLineasMuestras([{ catEnsayoId: "e1", muestraN: 1 }], 0)).toMatch(/no tiene muestras/);
    expect(validarLineasMuestras([{ catEnsayoId: "e1" }], 0)).toBeNull();
  });

  it("la muestra de la línea debe existir", () => {
    expect(validarLineasMuestras([{ catEnsayoId: "e1", muestraN: 3 }], 2)).toMatch(/tiene 2 muestras/);
  });

  it("el mismo ensayo puede ir en dos muestras, pero no dos veces en la misma", () => {
    expect(validarLineasMuestras([{ catEnsayoId: "e1", muestraN: 1 }, { catEnsayoId: "e1", muestraN: 2 }], 2)).toBeNull();
    expect(validarLineasMuestras([{ catEnsayoId: "e1", muestraN: 1, ensayoCodigo: "EN1" }, { catEnsayoId: "e1", muestraN: 1 }], 2)).toMatch(/ya está cotizado para la muestra 1/);
  });

  it("clave ensayo+muestra para no duplicar al agregar", () => {
    expect(claveEnsayoMuestra("e1", 2)).not.toBe(claveEnsayoMuestra("e1", 1));
    expect(claveEnsayoMuestra("e1", null)).toBe(claveEnsayoMuestra("e1"));
  });

  it("etiqueta y resumen por muestra", () => {
    const { muestras } = normalizarMuestras([{ descripcion: "Lote A", productoTexto: "Agua" }, {}]);
    expect(etiquetaMuestra(muestras[0])).toBe("Muestra 1 · Lote A · Agua");
    expect(etiquetaMuestra(muestras[1])).toBe("Muestra 2");
    const r = resumenPorMuestra(muestras, [
      { muestraN: 1, subtotal: 100, catEnsayoId: "a" },
      { muestraN: 1, subtotal: "50", catEnsayoId: "b" },
      { muestraN: null, subtotal: 30 },
    ]);
    expect(r[0]).toMatchObject({ n: 1, ensayos: 2, subtotal: 150 });
    expect(r[1]).toMatchObject({ n: 2, ensayos: 0, subtotal: 0 });
  });

  it("el plazo se cuenta desde la llegada de la muestra y queda condicionado a su entrega", () => {
    expect(textoPlazo(null, [])).toBe("");
    expect(textoPlazo(15)).toMatch(/^15 días corridos desde la llegada de la muestra al laboratorio\. Las fechas comprometidas quedan condicionadas/);
    expect(textoPlazo(null, [{ n: 2, plazoDias: 20 }])).toMatch(/^muestra 2: 20 días\./);
  });
});
