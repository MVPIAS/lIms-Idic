import { OPCIONES_MENU_OCULTO, rutasMenuOculto } from "./menu-oculto";
import { defConfigurable, normalizarValor, valorFormulario } from "../catalogo/parametro-configurable";

describe("Módulos heredados fuera del menú (R1, R10)", () => {
  it("lee rutas separadas por coma, punto y coma o línea", () => {
    expect(rutasMenuOculto("/crm, encuestas;\n/Agenda/ ")).toEqual(["/crm", "/encuestas", "/agenda"]);
  });
  it("ignora vacíos, rutas raras y no deja ocultar Mi bandeja", () => {
    expect(rutasMenuOculto("")).toEqual([]);
    expect(rutasMenuOculto(null)).toEqual([]);
    expect(rutasMenuOculto("https://x.cl, /inicio, /a b, /ot?x=1, /ot")).toEqual(["/ot"]);
  });
  // F077: el valor se edita en pantalla como «multiple» (se guarda en mayúsculas).
  it("se edita en Parámetros de la operación y el menú lo lee igual", () => {
    const def = defConfigurable("menu", "ocultos")!;
    expect(def.tipo).toBe("multiple");
    expect(OPCIONES_MENU_OCULTO.some((o) => o.valor === "/INICIO")).toBe(false);
    const r = normalizarValor(def, { codigo: "ocultos", etiqueta: "" }, ["/CRM", "/ENCUESTAS"], "menu");
    expect(r.errores).toEqual([]);
    expect(rutasMenuOculto(r.valor!.valor)).toEqual(["/crm", "/encuestas"]);
    // Lo escrito antes a mano («/crm, /encuestas») se muestra marcado.
    expect(valorFormulario(def, { codigo: "ocultos", valor: "/crm, /encuestas", activo: true })).toEqual(["/CRM", "/ENCUESTAS"]);
  });
});
