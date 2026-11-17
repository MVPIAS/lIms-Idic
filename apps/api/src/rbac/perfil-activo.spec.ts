import { aplicarPerfil, hayVariosPerfiles, opcionesPerfil } from "./perfil-activo";

describe("Selector de perfil para jefaturas duales (Comercial, R1)", () => {
  const U: Record<string, { id: string; codigo: string; nombre: string }> = {
    svt: { id: "svt", codigo: "SVT", nombre: "Sección Ventas" },
    dco: { id: "dco", codigo: "DCO", nombre: "Departamento Comercial" },
    spc: { id: "spc", codigo: "SPC", nombre: "Planificación y Control" },
  };
  const asig = [
    { unidadId: "svt", rolCodigo: "JEFE_SECCION", rolNombre: "Jefe de Sección" },
    { unidadId: "spc", rolCodigo: "ANALISTA", rolNombre: "Analista" },
    { unidadId: null, rolCodigo: "COMERCIAL", rolNombre: "Comercial" },
  ];
  const jef = [{ unidadId: "svt", rol: "titular" }, { unidadId: "dco", rol: "subrogante" }];
  it("una opción por unidad con roles o jefatura; titulares primero", () => {
    const o = opcionesPerfil(asig, jef, (id) => U[id]);
    expect(o.map((x) => x.codigo)).toEqual(["SVT", "DCO", "SPC"]);
    expect(o[1].etiqueta).toBe("Jefatura (subrogante) · DCO Departamento Comercial");
    expect(o[2].etiqueta).toBe("Analista · SPC Planificación y Control");
    expect(hayVariosPerfiles(o)).toBe(true);
    expect(hayVariosPerfiles(opcionesPerfil([asig[0]], [], (id) => U[id]))).toBe(false);
  });
  it("con perfil activo: solo esa unidad (más los roles sin unidad)", () => {
    const r = aplicarPerfil("dco", asig, jef);
    expect(r.aplicado).toBe(true);
    expect(r.asignaciones.map((a) => a.rolCodigo)).toEqual(["COMERCIAL"]);
    expect(r.jefaturas).toEqual([{ unidadId: "dco", rol: "subrogante" }]);
  });
  it("sin perfil o con uno que ya no le corresponde: todo", () => {
    expect(aplicarPerfil(null, asig, jef).aplicado).toBe(false);
    const r = aplicarPerfil("lqc", asig, jef);
    expect(r.aplicado).toBe(false);
    expect(r.asignaciones).toHaveLength(3);
  });
});
