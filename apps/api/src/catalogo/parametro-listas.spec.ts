import { CATEGORIAS_CONFIGURABLES, LISTAS_PARAMETROS, errorAltaLista, errorDesactivarLista } from "./parametro-configurable";
import { CATEGORIAS_CON_HISTORIAL } from "./parametro-porcentaje";

describe("listas de «Parámetros del sistema»", () => {
  it("no se cruzan con los parámetros de la operación ni con los porcentajes", () => {
    const listas = LISTAS_PARAMETROS.map((l) => l.categoria);
    expect(new Set(listas).size).toBe(listas.length);
    expect(listas.filter((c) => CATEGORIAS_CONFIGURABLES.includes(c) || CATEGORIAS_CON_HISTORIAL.includes(c))).toEqual([]);
  });

  it("admite opciones nuevas en las listas abiertas y no en las que el sistema interpreta", () => {
    expect(errorAltaLista("toma_muestra")).toBeNull();
    expect(errorAltaLista("medio_envio")).toBeNull();
    expect(errorAltaLista("estado_cotizacion")).toMatch(/no se agregan opciones/);
    expect(errorAltaLista("sesion")).toMatch(/Elija una de las listas/);
  });

  it("«correo» no se desactiva; el resto sí", () => {
    expect(errorDesactivarLista("medio_envio", "correo")).toMatch(/no se desactiva/);
    expect(errorDesactivarLista("medio_envio", "fax")).toBeNull();
    expect(errorDesactivarLista("cargo_costo", "correo")).toBeNull();
  });
});
