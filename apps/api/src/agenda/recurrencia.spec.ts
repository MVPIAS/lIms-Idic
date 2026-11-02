import { bloque, costoUso, diaSemana, esDia, minutosJornada, minutosOcupados, ocurrencias, rangoVista, seSolapan, ultimaOcurrencia } from "./recurrencia";

describe("agenda · recurrencia (§4.5.9)", () => {
  it("evento único: solo su día y solo si cae en el rango", () => {
    expect(ocurrencias({ fecha: "2026-11-05", recurrencia: "NINGUNA" }, "2026-11-01", "2026-11-30")).toEqual(["2026-11-05"]);
    expect(ocurrencias({ fecha: "2026-11-05", recurrencia: "NINGUNA" }, "2026-11-06", "2026-11-30")).toEqual([]);
  });

  it("diaria cada 2 días con tope de repeticiones contado desde el inicio", () => {
    const r = { fecha: "2026-11-01", recurrencia: "DIARIA" as const, intervalo: 2, repeticiones: 4 };
    expect(ocurrencias(r, "2026-11-01", "2026-12-31")).toEqual(["2026-11-01", "2026-11-03", "2026-11-05", "2026-11-07"]);
    // Una ventana posterior no reinicia la cuenta.
    expect(ocurrencias(r, "2026-11-04", "2026-12-31")).toEqual(["2026-11-05", "2026-11-07"]);
  });

  it("semanal lunes y miércoles cada 2 semanas hasta una fecha", () => {
    const r = { fecha: "2026-11-02", recurrencia: "SEMANAL" as const, intervalo: 2, diasSemana: [1, 3], repetirHasta: "2026-11-30" };
    expect(ocurrencias(r, "2026-11-01", "2026-12-31")).toEqual(["2026-11-02", "2026-11-04", "2026-11-16", "2026-11-18", "2026-11-30"]);
  });

  it("semanal sin días usa el día de la primera fecha y no repite días anteriores a ella", () => {
    const r = { fecha: "2026-11-04", recurrencia: "SEMANAL" as const, diasSemana: [1, 3] };
    expect(ocurrencias(r, "2026-11-01", "2026-11-10")).toEqual(["2026-11-04", "2026-11-09"]);
    expect(ocurrencias({ fecha: "2026-11-06", recurrencia: "SEMANAL" }, "2026-11-01", "2026-11-20")).toEqual(["2026-11-06", "2026-11-13", "2026-11-20"]);
  });

  it("mensual el día 31 salta los meses que no lo tienen", () => {
    const r = { fecha: "2026-01-31", recurrencia: "MENSUAL" as const };
    expect(ocurrencias(r, "2026-01-01", "2026-06-30")).toEqual(["2026-01-31", "2026-03-31", "2026-05-31"]);
  });

  it("las excepciones anulan un día pero siguen contando para las repeticiones", () => {
    const r = { fecha: "2026-11-02", recurrencia: "DIARIA" as const, repeticiones: 3, excepciones: ["2026-11-03"] };
    expect(ocurrencias(r, "2026-11-01", "2026-11-30")).toEqual(["2026-11-02", "2026-11-04"]);
  });

  it("cruza el cambio de horario y de año sin desplazar días", () => {
    const r = { fecha: "2026-12-30", recurrencia: "DIARIA" as const, repeticiones: 4 };
    expect(ocurrencias(r, "2026-12-01", "2027-01-31")).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
    expect(ocurrencias({ fecha: "2026-09-05", recurrencia: "DIARIA", repeticiones: 3 }, "2026-09-01", "2026-09-30")).toEqual(["2026-09-05", "2026-09-06", "2026-09-07"]);
  });

  it("última ocurrencia de una serie", () => {
    expect(ultimaOcurrencia({ fecha: "2026-11-02", recurrencia: "SEMANAL", diasSemana: [1, 5], repeticiones: 5 })).toBe("2026-11-16");
    expect(ultimaOcurrencia({ fecha: "2026-11-02", recurrencia: "DIARIA" })).toBeNull();
  });

  it("valida días y día de la semana ISO", () => {
    expect(esDia("2026-02-29")).toBe(false);
    expect(esDia("2028-02-29")).toBe(true);
    expect(diaSemana("2026-11-08")).toBe(7);
    expect(diaSemana("2026-11-02")).toBe(1);
  });
});

describe("agenda · disponibilidad y costos (§4.5.8)", () => {
  const jornada = { desde: "08:00", hasta: "18:00" };

  it("detecta solapes y trata el día completo como la jornada del recurso", () => {
    const a = bloque("2026-11-02", { todoDia: false, horaInicio: "09:00", horaFin: "11:00" }, jornada);
    const b = bloque("2026-11-02", { todoDia: false, horaInicio: "11:00", horaFin: "12:00" }, jornada);
    const c = bloque("2026-11-02", { todoDia: true }, jornada);
    expect(seSolapan(a, b)).toBe(false);
    expect(seSolapan(a, c)).toBe(true);
    expect(c).toEqual({ dia: "2026-11-02", inicio: 480, fin: 1080 });
  });

  it("suma minutos ocupados uniendo tramos y recortando a la jornada", () => {
    const bl = [
      { dia: "d", inicio: 7 * 60, fin: 9 * 60 },
      { dia: "d", inicio: 8 * 60 + 30, fin: 10 * 60 },
      { dia: "d", inicio: 17 * 60, fin: 19 * 60 },
    ];
    expect(minutosOcupados(bl, jornada)).toBe(120 + 60);
  });

  it("jornada solo en días hábiles del recurso", () => {
    const r = { horaDesde: "08:30", horaHasta: "17:30", diasHabiles: [1, 2, 3, 4, 5] };
    expect(minutosJornada(r, "2026-11-02")).toBe(540);
    expect(minutosJornada(r, "2026-11-07")).toBe(0);
  });

  it("costo = horas × costo por hora + costo por uso", () => {
    expect(costoUso({ costoHora: 12000, costoUso: 5000 }, 90)).toBe(23000);
    expect(costoUso({ costoHora: null, costoUso: null }, 90)).toBe(0);
  });

  it("rango de la vista día, semana y mes", () => {
    expect(rangoVista("dia", "2026-11-04")).toEqual({ desde: "2026-11-04", hasta: "2026-11-04" });
    expect(rangoVista("semana", "2026-11-04")).toEqual({ desde: "2026-11-02", hasta: "2026-11-08" });
    expect(rangoVista("mes", "2028-02-10")).toEqual({ desde: "2028-02-01", hasta: "2028-02-29" });
  });
});
