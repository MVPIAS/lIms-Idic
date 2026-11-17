import { erroresReemplazo, filasReemplazo, textoRolesReemplazo } from "./reemplazo";

describe("Reemplazos temporales (R8)", () => {
  const ahora = new Date("2026-11-11T12:00:00Z");
  const roles = new Map([["JEFE_LAB", "r-jl"], ["JEFE_DEPTO", "r-jd"], ["ANALISTA", "r-an"]]);
  it("copia los roles vigentes y la jefatura, sin administración ni lo que ya tiene", () => {
    const f = filasReemplazo({
      asignaciones: [
        { rolId: "r-jl", rolCodigo: "JEFE_LAB", unidadId: "lme" },
        { rolId: "r-ad", rolCodigo: "ADMIN", unidadId: null },
        { rolId: "r-an", rolCodigo: "ANALISTA", unidadId: "lqc", vigenteHasta: "2026-01-01" },
        { rolId: "r-an", rolCodigo: "ANALISTA", unidadId: "lme" },
      ],
      jefaturas: [{ unidadId: "lme", unidadTipo: "LABORATORIO" }, { unidadId: "dqo", unidadTipo: "DEPARTAMENTO" }],
      rolesPorCodigo: roles,
      yaTiene: [{ rolId: "r-an", unidadId: "lme" }],
      ahora,
    });
    expect(f).toEqual([
      { rolId: "r-jl", rolCodigo: "JEFE_LAB", unidadId: "lme", origen: "rol" },
      { rolId: "r-jd", rolCodigo: "JEFE_DEPTO", unidadId: "dqo", origen: "jefatura" },
    ]);
  });
  it("valida fechas, motivo y que no se reemplace a sí mismo", () => {
    const base = { reemplazanteId: "a", reemplazadoId: "b", desde: ahora, hasta: new Date("2026-11-20T00:00:00Z"), motivo: "PRUEBA vacaciones" };
    expect(erroresReemplazo(base, ahora)).toEqual([]);
    expect(erroresReemplazo({ ...base, reemplazadoId: "a" }, ahora)).toContain("Una persona no se reemplaza a sí misma.");
    expect(erroresReemplazo({ ...base, hasta: new Date("2026-11-01T00:00:00Z") }, ahora)).toEqual(expect.arrayContaining(["La fecha de término debe ser posterior a la de inicio."]));
    expect(erroresReemplazo({ ...base, hasta: new Date("2028-01-01T00:00:00Z") }, ahora)).toContain("Un reemplazo temporal dura como máximo un año.");
    expect(erroresReemplazo({ ...base, motivo: "x" }, ahora)).toHaveLength(1);
  });
});

describe("textoRolesReemplazo (F092)", () => {
  it("muestra el nombre del rol y la sigla de la unidad, sin códigos internos", () => {
    const nombres = new Map([["JEFE_DEPTO", "Jefe de Departamento"], ["REVISOR", "Revisor"]]);
    const unidades = new Map([["u1", "DQO"]]);
    expect(textoRolesReemplazo([{ rolCodigo: "JEFE_DEPTO", unidadId: "u1" }, { rolCodigo: "REVISOR", unidadId: null }], nombres, unidades))
      .toBe("Jefe de Departamento · DQO, Revisor");
  });
  it("no repite y, sin nombre conocido, usa el código", () => {
    expect(textoRolesReemplazo([{ rolCodigo: "X", unidadId: null }, { rolCodigo: "X", unidadId: null }], new Map(), new Map())).toBe("X");
  });
});
