import { elegirPlantillaSugerida } from "./plantilla-sugerida";

describe("plantilla propuesta al emitir el informe de una OT (F063)", () => {
  const plantillas = [
    { id: "p-lqc", repid: "PG09A2-LQC" },
    { id: "p-ali", repid: "PG09A2-ALI" },
    { id: "p-bol", repid: "BolAn" },
    { id: "p-vieja", repid: "PG09A2-LPN", activo: false },
  ];
  it("propone la plantilla propia del laboratorio por su código", () => {
    expect(elegirPlantillaSugerida("LQC", plantillas, [{ plantillaId: "p-bol", veces: 9 }])).toEqual({ plantillaId: "p-lqc", motivo: "codigo" });
  });
  it("si no hay propia, la que más ha usado el laboratorio", () => {
    expect(elegirPlantillaSugerida("LQA", plantillas, [{ plantillaId: "p-bol", veces: 1 }, { plantillaId: "p-ali", veces: 7 }])).toEqual({ plantillaId: "p-ali", motivo: "uso" });
  });
  it("no propone plantillas inactivas ni inventa una sin datos", () => {
    expect(elegirPlantillaSugerida("LPN", plantillas, [{ plantillaId: "p-vieja", veces: 3 }])).toBeNull();
    expect(elegirPlantillaSugerida(null, plantillas, [])).toBeNull();
  });
});
