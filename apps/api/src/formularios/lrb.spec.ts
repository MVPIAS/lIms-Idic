import {
  AMENAZAS_DEFECTO, cantidadEnPalabras, erroresNuevoDisparo, evaluarDisparo, evaluarLote, evaluarPanel, faltantesDocumentoLrb,
  leerAmenazas, numeroEnPalabras, seriesPorTalla, velocidadesFueraDeRango, veredictoParaMuestra, type Panel, type RegistroDisparos,
} from "./lrb";

const A = AMENAZAS_DEFECTO;
const chaleco9 = A.find((a) => a.clave === "NIJ0101-IIIA-9MM")!;
const ok = (n: number, extra: Partial<{ v1: number; trauma: number | null }> = {}) => ({ n, v1: extra.v1 ?? 436, trauma: extra.trauma === undefined ? (n <= 3 ? 30 : null) : extra.trauma, penetracion: false });

describe("LRB · disparo", () => {
  it("cumple sin penetración y con trauma ≤ 44", () => expect(evaluarDisparo(ok(1), chaleco9).condicion).toBe("cumple"));
  it("penetración completa no cumple", () => {
    const d = evaluarDisparo({ n: 1, v1: 436, penetracion: true }, chaleco9);
    expect(d.condicion).toBe("no_cumple");
    expect(d.motivos).toContain("Penetración completa");
  });
  it("trauma > 44 mm no cumple", () => expect(evaluarDisparo(ok(2, { trauma: 44.5 }), chaleco9).condicion).toBe("no_cumple"));
  it("trauma obligatorio en los disparos 1 a 3: sin trauma queda pendiente", () => {
    expect(evaluarDisparo({ n: 2, v1: 436, penetracion: false }, chaleco9).condicion).toBe("pendiente");
    expect(evaluarDisparo({ n: 4, v1: 436, penetracion: false }, chaleco9).condicion).toBe("cumple");
  });
  it("la velocidad es requisito, no resultado: fuera de ventana es «tiro fuera de rango» y no cambia la condición", () => {
    const d = evaluarDisparo(ok(1, { v1: 445.8 }), chaleco9);
    expect(d).toMatchObject({ fueraVentana: true, fueraDeRango: ["V1"], condicion: "cumple" });
  });
  it("V1 y V2 se comparan cada una con la ventana: ninguna manda", () => {
    expect(velocidadesFueraDeRango({ v1: 430, v2: 446 }, chaleco9)).toEqual(["V2"]);
    expect(velocidadesFueraDeRango({ v1: 420, v2: 450 }, chaleco9)).toEqual(["V1", "V2"]);
    expect(velocidadesFueraDeRango({ v1: 430, v2: null }, chaleco9)).toEqual([]);
    const p: Panel = { id: "p1", zona: "anterior", amenaza: chaleco9.clave, disparos: [{ ...ok(1), v2: 446 }] };
    expect(evaluarPanel(p, A).avisos[0]).toMatch(/tiro fuera de rango \(V2 446 m\/s; ventana 427–445 m\/s\)/);
  });
  it("daño en el testigo (UL 752) no cumple", () => {
    const ul = A.find((a) => a.clave === "UL752-2")!;
    expect(evaluarDisparo({ n: 1, v1: 400, penetracion: false, danoTestigo: true }, ul).condicion).toBe("no_cumple");
  });
});

describe("LRB · panel", () => {
  it("6 disparos que cumplen → panel cumple", () => {
    const p: Panel = { id: "p1", zona: "anterior", amenaza: chaleco9.clave, disparos: [1, 2, 3, 4, 5, 6].map((n) => ok(n)) };
    const e = evaluarPanel(p, A);
    expect(e).toMatchObject({ completo: true, detenido: false, veredicto: "cumple" });
  });
  it("una penetración detiene el panel y no admite más disparos", () => {
    const p: Panel = { id: "p1", zona: "anterior", amenaza: chaleco9.clave, disparos: [ok(1), { n: 2, v1: 436, penetracion: true }] };
    const e = evaluarPanel(p, A);
    expect(e).toMatchObject({ detenido: true, completo: true, veredicto: "no_cumple" });
    expect(erroresNuevoDisparo(p, ok(3), A).join(" ")).toMatch(/detenido/);
  });
  it("correlativo y plan", () => {
    const p: Panel = { id: "p1", zona: "anterior", amenaza: chaleco9.clave, disparos: [ok(1)] };
    expect(erroresNuevoDisparo(p, ok(3), A).join(" ")).toMatch(/Nº 2/);
    const lleno: Panel = { ...p, disparos: [1, 2, 3, 4, 5, 6].map((n) => ok(n)) };
    expect(erroresNuevoDisparo(lleno, ok(7), A).join(" ")).toMatch(/6 disparos/);
    // Corregir uno ya registrado sí se puede.
    expect(erroresNuevoDisparo(lleno, ok(2, { trauma: 31 }), A)).toEqual([]);
  });
  it("munición fuera de la tabla", () => {
    expect(evaluarPanel({ id: "x", zona: "anterior", amenaza: "NO", disparos: [] }, A).avisos[0]).toMatch(/no está en la tabla/);
  });
});

const registro = (penetra: boolean): RegistroDisparos => ({
  certificacionLote: true,
  lote: { tamano: 336, modelo: "MGV05" },
  composicion: [{ talla: "S", cantidad: 9 }, { talla: "M", cantidad: 49 }, { talla: "L", cantidad: 99 }, { talla: "XL", cantidad: 99 }, { talla: "XXL", cantidad: 50 }, { talla: "3XL", cantidad: 30 }],
  unidades: [
    { id: "u1", serie: "S-008", talla: "S", muestraId: "m1", reemplazo: "S-001", paneles: [{ id: "a", zona: "anterior", amenaza: "NIJ0101-IIIA-44MAG", disparos: [1, 2, 3, 4, 5, 6].map((n) => ok(n)) }] },
    { id: "u2", serie: "M-030", talla: "M", muestraId: "m2", reemplazo: "M-011", paneles: [{ id: "b", zona: "anterior", amenaza: "NIJ0101-IIIA-9MM", disparos: penetra ? [{ n: 1, v1: 436, penetracion: true }] : [1, 2, 3, 4, 5, 6].map((n) => ok(n)) }] },
  ],
});

describe("LRB · lote y documento", () => {
  it("lote que cumple con certificación ⇒ IE + CRB", () => {
    const l = evaluarLote(registro(false), A);
    expect(l.veredicto).toBe("cumple");
    expect(l.documentos).toEqual(["INFORME_ENSAYO", "CERTIFICADO_RESISTENCIA_BALISTICA"]);
    expect(faltantesDocumentoLrb("CERTIFICADO_RESISTENCIA_BALISTICA", l, registro(false), true)).toEqual([]);
    expect(faltantesDocumentoLrb("INFORME_RECHAZO", l, registro(false), true).join(" ")).toMatch(/no cumple/);
  });
  it("una penetración rechaza el lote ⇒ Informe de Rechazo", () => {
    const r = registro(true);
    const l = evaluarLote(r, A);
    expect(l).toMatchObject({ veredicto: "no_cumple", penetracion: true, documentos: ["INFORME_RECHAZO"] });
    expect(l.falla).toMatch(/M-030.*disparo 1/);
    expect(faltantesDocumentoLrb("CERTIFICADO_RESISTENCIA_BALISTICA", l, r, true).join(" ")).toMatch(/solo se emite si el lote cumple/);
    expect(faltantesDocumentoLrb("INFORME_RECHAZO", l, r, false).join(" ")).toMatch(/Cierre el registro/);
  });
  it("el Informe de Rechazo existe solo para chalecos: un casco que no cumple va al Informe de Ensayo", () => {
    const casco = A.find((a) => a.clave === "NIJ0106-IIA-9MM")!;
    const r: RegistroDisparos = { unidades: [{ id: "c1", serie: "C-1", paneles: [{ id: "c", zona: "casco", amenaza: casco.clave, disparos: [{ n: 1, v1: 330, penetracion: true }] }] }] };
    const l = evaluarLote(r, A);
    expect(l).toMatchObject({ veredicto: "no_cumple", chalecos: false, documentos: ["INFORME_ENSAYO"] });
    expect(faltantesDocumentoLrb("INFORME_RECHAZO", l, r, true).join(" ")).toMatch(/solo para chalecos/);
    expect(evaluarLote(registro(true), A).chalecos).toBe(true);
  });
  it("veredicto por muestra: el de sus unidades o el del lote", () => {
    const l = evaluarLote(registro(true), A);
    expect(veredictoParaMuestra(l, "m1").veredicto).toBe("cumple");
    expect(veredictoParaMuestra(l, "m2").veredicto).toBe("no_cumple");
    expect(veredictoParaMuestra(l, "otra").veredicto).toBe("no_cumple");
    expect(veredictoParaMuestra(l, "m1").resumen).toMatch(/6 disparo/);
  });
  it("CRB exige reposición y nómina", () => {
    const r = registro(false);
    r.unidades[0].reemplazo = null;
    r.composicion = [];
    const f = faltantesDocumentoLrb("CERTIFICADO_RESISTENCIA_BALISTICA", evaluarLote(r, A), r, true).join(" ");
    expect(f).toMatch(/nómina/);
    expect(f).toMatch(/S-008/);
  });
});

describe("CRB · cantidades y series", () => {
  it("número en palabras", () => {
    expect(numeroEnPalabras(32)).toBe("treinta y dos");
    expect(numeroEnPalabras(50)).toBe("cincuenta");
    expect(numeroEnPalabras(336)).toBe("trescientos treinta y seis");
    expect(numeroEnPalabras(100)).toBe("cien");
    expect(numeroEnPalabras(21_000)).toBe("veintiun mil");
    expect(numeroEnPalabras(1_001)).toBe("mil uno");
    expect(cantidadEnPalabras(336)).toBe("Trescientos treinta y seis (336)");
  });
  it("series por talla", () => expect(seriesPorTalla(registro(false).composicion)).toEqual({ texto: "S 9 · M 49 · L 99 · XL 99 · XXL 50 · 3XL 30 = 336", total: 336 }));
});

describe("tabla de amenazas configurada", () => {
  it("chalecos: tabla oficial NIJ 0101.04 del LRB (24-11-2026), trauma ≤ 44 mm", () => {
    const ch = A.filter((a) => a.elemento === "chaleco");
    expect(ch.map((a) => `${a.nivel} ${a.v_min}-${a.v_max}`)).toEqual([
      "I 320-338", "I 313-331", "II-A 332-350", "II-A 313-331", "II 358-376", "II 427-445", "III-A 427-445", "III-A 427-445", "III 838-856", "IV 869-887",
    ]);
    expect(ch.every((a) => a.trauma_max === 44 && a.norma === "NIJ 0101.04")).toBe(true);
    // Las claves ya usadas en registros se conservan.
    expect(ch.map((a) => a.clave)).toEqual(expect.arrayContaining(["NIJ0101-IIIA-9MM", "NIJ0101-IIIA-44MAG"]));
  });
  it("lee el JSON y descarta filas inválidas", () => {
    const t = leerAmenazas(JSON.stringify([{ clave: "X", norma: "N", nivel: "1", elemento: "Chaleco", municion: "9 mm", masa_g: "8,0", v_min: 400, v_max: 420, disparos: 6, trauma_max: 44, disparos_trauma: 3 }, { clave: "", v_min: 1 }]));
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ elemento: "chaleco", masa_g: 8 });
  });
  it("sin tabla o JSON roto → valores por defecto", () => {
    expect(leerAmenazas(null)).toBe(AMENAZAS_DEFECTO);
    expect(leerAmenazas("{")).toBe(AMENAZAS_DEFECTO);
  });
});
