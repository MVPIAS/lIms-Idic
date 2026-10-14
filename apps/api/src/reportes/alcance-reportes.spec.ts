import { condicionAlcance } from "./alcance-reportes";

describe("alcance por laboratorio de los reportes", () => {
  it("un perfil global no filtra ni añade parámetros", () => {
    const args: unknown[] = ["tenant"];
    expect(condicionAlcance("orden_trabajo", "orden_trabajo", null, args)).toBe("");
    expect(args).toEqual(["tenant"]);
  });

  it("filtra la OT por su laboratorio con las unidades como parámetro", () => {
    const args: unknown[] = ["tenant", "2026-01-01"];
    const sql = condicionAlcance("orden_trabajo", "orden_trabajo", ["u1", "u2"], args);
    expect(sql).toBe(" AND orden_trabajo.unidad_principal = ANY($3::uuid[])");
    expect(args[2]).toEqual(["u1", "u2"]);
  });

  it("muestras, resultados y documentos cuentan por su OT", () => {
    expect(condicionAlcance("muestra", "muestra", ["u"], ["t"])).toContain("o.id = muestra.ot_id");
    const r = condicionAlcance("resultado", "r", ["u"], ["t"]);
    expect(r).toContain("COALESCE(r.ot_id");
    expect(r).toContain("= ANY($2::uuid[])");
    expect(condicionAlcance("certificado", "certificado", ["u"], ["t"])).toContain("COALESCE(certificado.unidad_id");
  });

  it("las cotizaciones cuentan por su OT o su centro de costo", () => {
    const sql = condicionAlcance("cotizacion", "cotizacion", ["u"], ["t"]);
    expect(sql).toContain("o.cotizacion_id = cotizacion.id");
    expect(sql).toContain("cc.unidad_id = ANY($2::uuid[])");
  });

  it("una tabla sin regla de alcance no devuelve filas a un perfil acotado", () => {
    expect(condicionAlcance("otra", "otra", ["u"], ["t"])).toBe(" AND FALSE");
  });

  it("un perfil acotado sin unidades no ve nada (lista vacía, no «todo»)", () => {
    const args: unknown[] = ["t"];
    expect(condicionAlcance("orden_trabajo", "orden_trabajo", [], args)).toContain("ANY($2::uuid[])");
    expect(args[1]).toEqual([]);
  });
});
