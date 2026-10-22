import { atencionInforme } from "./atencion";

describe("«Atención» del informe (D02-30)", () => {
  it("manda el solicitante de la OT", () => {
    expect(atencionInforme({ solicitanteOt: " M. R. ", fichaCliente: { contactoNombre: "J. P." } })).toBe("M. R.");
  });

  it("sin solicitante (OT nacida de una cotización), el contacto principal de la ficha del cliente, con su cargo", () => {
    expect(atencionInforme({ solicitanteOt: null, fichaCliente: { contactoNombre: "J. P.", contactoCargo: "Jefe de Calidad" } })).toBe("J. P., Jefe de Calidad");
    expect(atencionInforme({ solicitanteOt: "  ", fichaCliente: { contactoNombre: "J. P." } })).toBe("J. P.");
  });

  it("si la ficha no tiene contacto, el contacto marcado como principal; si no hay ninguno, vacío", () => {
    expect(atencionInforme({ fichaCliente: { contactoNombre: "" }, contactoPrincipal: { nombre: "A. B.", cargo: null } })).toBe("A. B.");
    expect(atencionInforme({})).toBe("");
  });
});
