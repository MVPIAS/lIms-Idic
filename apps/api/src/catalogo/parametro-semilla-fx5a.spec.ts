import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { filaPorDefecto, parametrosFijos, textoValor, valorFormulario } from "./parametro-configurable";

/**
 * F076 · «Parámetros del sistema» no se cae si falta la fila de un parámetro, y
 * align_fx5_a.sql siembra todos los parámetros fijos con su valor por defecto.
 */
const DB = join(__dirname, "../../../../packages/db");
// align_fx5_a.sql y las siembras de los frentes nuevos (align_nuevo_fN.sql: p. ej. «fea» del F4;
// align_fNNN_*.sql de las correcciones: p. ej. «fea» del certificado SAEC en align_f028_saec.sql;
// align_cuarto_envio_*.sql del cuarto envío IDIC: p. ej. «tasa_carta» en align_cuarto_envio_tasa.sql;
// align_qN_*.sql del quinto envío: p. ej. «cotizacion_adjuntos» en align_q1_cotizacion.sql, «numeracion_proyecto» en align_q3_proyecto.sql y «ot_cierre» en align_q4_cierre_ot.sql).
const SQL = [
  readFileSync(join(DB, "align_fx5_a.sql"), "utf8"),
  ...readdirSync(DB)
    .filter((f) => /^align_(nuevo_f\d+|f\d{3}_[a-z0-9_]+|cuarto_envio_[a-z0-9_]+|q\d+_[a-z0-9_]+|integracion_[a-z0-9_]+)\.sql$/.test(f))
    .map((f) => readFileSync(join(DB, f), "utf8")),
].join(" ");
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
