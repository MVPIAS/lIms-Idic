import { codigoValido, defConfigurable, historialDeFila, normalizarValor, textoValor, valorFormulario } from "./parametro-configurable";
import { leerAmenazas } from "../formularios/lrb";
import { leerPlantilla } from "../formularios/hcp";
import { leerCampoPrep } from "../formularios/preparacion";

const guardar = (cat: string, cod: string, v: unknown, fila = { codigo: cod, etiqueta: "X" }) => normalizarValor(defConfigurable(cat, cod)!, fila, v, cat);

describe("parámetros r2a · registro", () => {
  it("variantes por método y laboratorio, tablas y reglas del frente r2a", () => {
    for (const [cat, cod] of [
      ["captura_variante_metodo", "3376"], ["captura_variante_laboratorio", "LMB"], ["lrb", "amenazas"], ["lrb", "velocidad_manda"], ["lrb", "plazo_apelacion"],
      ["inspeccion_aql", "nivel"], ["inspeccion_aql", "aql_clase_b"], ["hcp_plantilla", "VLCB"], ["preparacion_campo", "LME.vigencia_soluciones"],
      ["preparacion_obligatoria", "LME"], ["preparacion_trabajo", "exige_aprobacion"], ["preparacion_trabajo", "bloquea_captura"],
      ["micro", "lecturas_h"], ["rsa_criterios", "tabla"], ["sensorial", "alfa"], ["sensorial", "rangos"],
    ]) expect(defConfigurable(cat, cod)).not.toBeNull();
  });
  it("códigos por patrón", () => {
    expect(codigoValido("metodo", "3376")).toBe(true);
    expect(codigoValido("metodo", "x y")).toBe(false);
    expect(codigoValido("plantilla", "VLCB")).toBe(true);
    expect(codigoValido("plantilla", "vlcb")).toBe(false);
  });
});

describe("parámetros r2a · variante", () => {
  it("valida la variante y guarda «activa / inactiva»", () => {
    const r = guardar("captura_variante_metodo", "428", { variante: "lmb_micro", activo: false });
    expect(r.valor).toEqual({ valor: "lmb_micro", activo: false, historial: "lmb_micro · inactiva" });
    expect(guardar("captura_variante_metodo", "428", { variante: "otra" }).errores[0]).toMatch(/Elija el formulario/);
    const def = defConfigurable("captura_variante_metodo", "428")!;
    expect(textoValor(def, "lmb_micro · inactiva")).toMatch(/LMB .*\(inactiva\)/);
    expect(historialDeFila(def, { codigo: "428", valor: "aql", activo: true })).toBe("aql · activa");
    expect(valorFormulario(def, { codigo: "428", valor: "aql", activo: false })).toEqual({ variante: "aql", activo: false });
  });
});

describe("parámetros r2a · tablas", () => {
  const fila = { clave: "X1", norma: "NIJ 0101.04", nivel: "IIIA", elemento: "chaleco", municion: "9 mm", masa_g: "8,03", v_min: "427", v_max: 445, disparos: 6, trauma_max: 44, disparos_trauma: 3, testigo: "no", criterio: "Sin penetración" };
  it("amenazas: coma decimal, sí/no y lo que leen los registros", () => {
    const r = guardar("lrb", "amenazas", [fila]);
    expect(r.errores).toEqual([]);
    const t = leerAmenazas(r.valor!.valor);
    expect(t[0]).toMatchObject({ clave: "X1", masa_g: 8.03, v_min: 427, testigo: false });
    expect(textoValor(defConfigurable("lrb", "amenazas")!, r.valor!.valor)).toBe("1 fila");
  });
  it("amenazas: obligatorios, opción, rango, clave repetida y V máx. < V mín.", () => {
    expect(guardar("lrb", "amenazas", [{ ...fila, municion: "" }]).errores[0]).toMatch(/Munición: es obligatorio/);
    expect(guardar("lrb", "amenazas", [{ ...fila, elemento: "auto" }]).errores[0]).toMatch(/elija una de las opciones/);
    expect(guardar("lrb", "amenazas", [{ ...fila, disparos: 2.5 }]).errores[0]).toMatch(/entero/);
    expect(guardar("lrb", "amenazas", [fila, fila]).errores[0]).toMatch(/repetido/);
    expect(guardar("lrb", "amenazas", [{ ...fila, v_max: 400 }]).errores[0]).toMatch(/menor que la mínima/);
    expect(guardar("lrb", "amenazas", []).errores[0]).toMatch(/al menos una fila/);
    expect(guardar("lrb", "amenazas", "no").errores[0]).toMatch(/lista/);
  });
  it("HCP: lo que guarda la pantalla lo lee la inspección", () => {
    const r = guardar("hcp_plantilla", "VLCB", [{ item: "4.2.1", grupo: "4. Dinámico", requisito: "Giro Ø ≤ 16 m", clase: "A", metodo: "545", max: "16", unidad: "m" }]);
    expect(r.errores).toEqual([]);
    expect(leerPlantilla(r.valor!.valor)[0]).toMatchObject({ item: "4.2.1", clase: "A", max: 16 });
    expect(guardar("hcp_plantilla", "VLCB", [{ item: "1", grupo: "g", requisito: "r", clase: "D" }]).errores[0]).toMatch(/opciones/);
  });
  it("RSA: c < n y M ≥ m", () => {
    expect(guardar("rsa_criterios", "tabla", [{ metodo: "428", n: 5, c: 5, m: 10, M: 100 }]).errores[0]).toMatch(/c debe ser menor/);
    expect(guardar("rsa_criterios", "tabla", [{ metodo: "428", n: 5, c: 2, m: 10, M: 5 }]).errores[0]).toMatch(/M debe ser mayor/);
    expect(guardar("rsa_criterios", "tabla", []).errores).toEqual([]);
  });
});

describe("parámetros r2a · campo de preparación", () => {
  it("define, bloquea y lo lee la preparación", () => {
    const r = guardar("preparacion_campo", "LME.vigencia", { tipo: "fecha", obligatorio: true, bloquea: true, ayuda: "Vence" }, { codigo: "LME.vigencia", etiqueta: "Vigencia" });
    expect(r.errores).toEqual([]);
    expect(leerCampoPrep({ codigo: "LME.vigencia", etiqueta: "Vigencia", valor: r.valor!.valor!, activo: true })).toMatchObject({ tipo: "fecha", bloquea: true });
    expect(textoValor(defConfigurable("preparacion_campo", "LME.vigencia")!, r.valor!.historial)).toMatch(/bloquea la captura/);
    expect(guardar("preparacion_campo", "LME.x", { tipo: "numero", bloquea: true }, { codigo: "LME.x", etiqueta: "X" }).errores[0]).toMatch(/Solo una casilla/);
  });
});
