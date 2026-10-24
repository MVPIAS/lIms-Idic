import { claveLibre, precioDeLinea } from "./precio-ficha";

describe("Cotización · precio desde la ficha de costos (EP-00 2.2, BL-149)", () => {
  const ens = { catEnsayoId: "e1", ensayoCodigo: "EN1214" };
  it("el ensayo toma el precio de su ficha", () => {
    expect(precioDeLinea(ens, 45000, 1)).toEqual({ precio: 45000 });
    expect(precioDeLinea({ ...ens, precioUnitario: 45000 }, 45000, 1)).toEqual({ precio: 45000 });
  });
  it("rechaza un precio manual distinto de la ficha", () => {
    expect(precioDeLinea({ ...ens, precioUnitario: 1000 }, 45000, 2).error).toMatch(/no admite un precio manual/);
  });
  it("un ensayo sin valor en su ficha bloquea la cotización", () => {
    expect(precioDeLinea({ ...ens, precioUnitario: 5000 }, null, 1).error).toMatch(/no tiene valor en su ficha/);
  });
  it("al editar, la línea ya cotizada conserva su precio aunque la ficha cambie", () => {
    const ex = { ensayos: new Map([["e1", 40000]]), libres: new Set<string>() };
    expect(precioDeLinea({ ...ens, precioUnitario: 40000 }, 45000, 1, ex)).toEqual({ precio: 40000 });
  });
  it("sin ensayo solo se aceptan gastos tipificados", () => {
    expect(precioDeLinea({ tipo: "viatico", descripcion: "Viático Arica 2 días", precioUnitario: 80000 }, null, 1)).toEqual({ precio: 80000 });
    expect(precioDeLinea({ descripcion: "Servicio libre", precioUnitario: 1000 }, null, 1).error).toMatch(/gasto tipificado/);
    expect(precioDeLinea({ tipo: "producto", descripcion: "Servicio libre", precioUnitario: 1000 }, null, 1).error).toMatch(/gasto tipificado/);
  });
  it("al editar, una línea libre heredada se conserva", () => {
    const ex = { ensayos: new Map(), libres: new Set([claveLibre("producto", "Servicio antiguo", 1000)]) };
    expect(precioDeLinea({ tipo: "producto", descripcion: "Servicio antiguo", precioUnitario: 1000 }, null, 1, ex)).toEqual({ precio: 1000 });
  });
});

describe("Referencia desde la solicitud (EP-00 1.1)", () => {
  const { referenciaDesdeSolicitud } = require("./cotizacion-extra") as typeof import("./cotizacion-extra");
  it("«OF 1234», «Oficio Nº 1234» y «1234» dan «OF Nº 1234»; el correo da su fecha", () => {
    for (const n of ["OF 1234", "Oficio Nº 1234", "1234", "of. n° 1234"]) expect(referenciaDesdeSolicitud({ solicitudMedio: "oficio", solicitudNumero: n })).toBe("OF Nº 1234");
    expect(referenciaDesdeSolicitud({ solicitudMedio: "correo", solicitudFecha: "2026-10-20" })).toBe("Correo de fecha 20-10-2026");
  });
});

describe("referencia del oficio sin prefijo duplicado (B-086)", () => {
  const { referenciaDesdeSolicitud } = require("./cotizacion-extra");
  it("«OF-PRUEBA-0001», «OF.123» y «Oficio N°: 55» quedan bien formadas", () => {
    expect(referenciaDesdeSolicitud({ solicitudMedio: "oficio", solicitudNumero: "OF-PRUEBA-0001" })).toBe("OF Nº PRUEBA-0001");
    expect(referenciaDesdeSolicitud({ solicitudMedio: "oficio", solicitudNumero: "OF.123" })).toBe("OF Nº 123");
    expect(referenciaDesdeSolicitud({ solicitudMedio: "oficio", solicitudNumero: "Oficio N°: 55" })).toBe("OF Nº 55");
  });
  it("no recorta palabras que empiezan por «of» o «no»", () => {
    expect(referenciaDesdeSolicitud({ solicitudMedio: "oficio", solicitudNumero: "OFERTA-9" })).toBe("OF Nº OFERTA-9");
    expect(referenciaDesdeSolicitud({ solicitudMedio: "oficio", solicitudNumero: "NOTA 7" })).toBe("OF Nº NOTA 7");
  });
});
