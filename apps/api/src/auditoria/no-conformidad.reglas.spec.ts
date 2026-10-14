import { erroresTransicionNc, ncVencida, puedeEditarAnalisis, siguienteCodigoNc } from "./no-conformidad.reglas";

const base = { estado: "abierta" };

describe("No conformidades · reglas", () => {
  it("iniciar el tratamiento exige responsable y plazo", () => {
    expect(erroresTransicionNc(base, "en_proceso")).toHaveLength(2);
    expect(erroresTransicionNc({ ...base, responsableId: "u1", plazoCierre: "2026-11-01" }, "en_proceso")).toEqual([]);
  });

  it("cerrar exige causa raíz, acción correctiva y verificación de eficacia", () => {
    const e = erroresTransicionNc({ estado: "en_proceso" }, "cerrada");
    expect(e.join(" ")).toMatch(/causa raíz/);
    expect(e.join(" ")).toMatch(/acción correctiva/);
    expect(e.join(" ")).toMatch(/eficacia/);
    expect(
      erroresTransicionNc(
        { estado: "verificacion", causaRaiz: "Pipeta descalibrada", accionCorrectiva: "Recalibrar", verificacion: "Duplicados OK" },
        "cerrada",
      ),
    ).toEqual([]);
  });

  it("textos en blanco no cuentan", () => {
    expect(erroresTransicionNc({ estado: "en_proceso", causaRaiz: "   ", accionCorrectiva: "x" }, "verificacion")).toHaveLength(1);
  });

  it("una cerrada solo se reabre, y con comentario", () => {
    expect(erroresTransicionNc({ estado: "cerrada" }, "en_proceso")[0]).toMatch(/No se puede pasar/);
    expect(erroresTransicionNc({ estado: "cerrada" }, "reabierta")[0]).toMatch(/por qué/);
    expect(erroresTransicionNc({ estado: "cerrada" }, "reabierta", "Reclamo del cliente")).toEqual([]);
  });

  it("rechaza estados desconocidos", () => {
    expect(erroresTransicionNc(base, "archivada")[0]).toMatch(/no válido/);
  });

  it("vencida: plazo pasado y no cerrada", () => {
    const hoy = new Date("2026-10-14T12:00:00Z");
    expect(ncVencida({ estado: "en_proceso", plazoCierre: "2026-10-13" }, hoy)).toBe(true);
    expect(ncVencida({ estado: "en_proceso", plazoCierre: "2026-10-14" }, hoy)).toBe(false);
    expect(ncVencida({ estado: "cerrada", plazoCierre: "2026-01-01" }, hoy)).toBe(false);
    expect(ncVencida({ estado: "abierta", plazoCierre: null }, hoy)).toBe(false);
  });

  it("código correlativo anual", () => {
    expect(siguienteCodigoNc(null, 2026)).toBe("NC-2026-0001");
    expect(siguienteCodigoNc("NC-2026-0041", 2026)).toBe("NC-2026-0042");
    expect(siguienteCodigoNc("NC-2025-0099", 2026)).toBe("NC-2026-0001");
  });

  it("el responsable asignado puede registrar el análisis aunque no gestione NC", () => {
    expect(puedeEditarAnalisis({ gestiona: false, usuarioId: "u1", responsableId: "u1" })).toBe(true);
    expect(puedeEditarAnalisis({ gestiona: false, usuarioId: "u2", responsableId: "u1" })).toBe(false);
    expect(puedeEditarAnalisis({ gestiona: true, usuarioId: "u2", responsableId: null })).toBe(true);
  });
});
