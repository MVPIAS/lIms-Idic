import { readFileSync } from "fs";
import { join } from "path";
import { filaPorDefecto, parametrosFijos, textoValor, valorFormulario } from "./parametro-configurable";

/**
 * F076 · «Parámetros del sistema» no se cae si falta la fila de un parámetro, y
 * align_fx5_a.sql siembra todos los parámetros fijos con su valor por defecto.
 */
const SQL = readFileSync(join(__dirname, "../../../../packages/db/align_fx5_a.sql"), "utf8");
const sqlTexto = (s: string) => `'${s.replace(/'/g, "''")}'`;

describe("parámetros fijos sin fila (F076)", () => {
  it("la fila por defecto lleva el valor por defecto y se lee como cualquier otra", () => {
    const p = parametrosFijos().find((x) => x.categoria === "segregacion_resultado" && x.codigo === "sin_revision_labs")!;
    expect(p).toBeDefined();
    const f = filaPorDefecto(p.categoria, p.codigo, p.def);
    expect(f).toMatchObject({ id: null, valor: "", activo: true, etiqueta: p.def.nombre });
    expect(() => valorFormulario(p.def, f)).not.toThrow();
    expect(typeof textoValor(p.def, f.valor)).toBe("string");
  });

  it("revisión previa: obligatoria por defecto", () => {
    const p = parametrosFijos().find((x) => x.categoria === "segregacion_resultado" && x.codigo === "revision")!;
    expect(filaPorDefecto(p.categoria, p.codigo, p.def).valor).toBe("obligatoria");
  });

  it("todo parámetro fijo se lee sin error aunque falte su fila", () => {
    for (const p of parametrosFijos()) {
      const f = filaPorDefecto(p.categoria, p.codigo, p.def);
      expect(() => valorFormulario(p.def, f)).not.toThrow();
      expect(() => textoValor(p.def, f.valor)).not.toThrow();
    }
  });

  it("align_fx5_a.sql siembra cada parámetro fijo con valor por defecto, con ese valor", () => {
    const faltan = parametrosFijos()
      .filter((p) => p.def.porDefecto != null)
      .filter((p) => !SQL.includes(`(${sqlTexto(p.categoria)}, ${sqlTexto(p.codigo)}, `) || !SQL.includes(`, ${sqlTexto(p.def.porDefecto!)})`))
      .map((p) => `${p.categoria}.${p.codigo}`);
    expect(faltan).toEqual([]);
  });
});
