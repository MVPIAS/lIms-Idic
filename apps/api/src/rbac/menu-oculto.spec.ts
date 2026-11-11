import { rutasMenuOculto } from "./menu-oculto";

describe("Módulos heredados fuera del menú (R1, R10)", () => {
  it("lee rutas separadas por coma, punto y coma o línea", () => {
    expect(rutasMenuOculto("/crm, encuestas;\n/Agenda/ ")).toEqual(["/crm", "/encuestas", "/agenda"]);
  });
  it("ignora vacíos, rutas raras y no deja ocultar Mi bandeja", () => {
    expect(rutasMenuOculto("")).toEqual([]);
    expect(rutasMenuOculto(null)).toEqual([]);
    expect(rutasMenuOculto("https://x.cl, /inicio, /a b, /ot?x=1, /ot")).toEqual(["/ot"]);
  });
});
