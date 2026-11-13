import { readFileSync } from "fs";
import { join } from "path";

/**
 * Regresión (pasada final de manuales 13-11-2026): la consulta de «Quitar» que decide si el
 * ensayo es de la batería quedó con un paréntesis de más y respondía 500 en todos los
 * laboratorios. Se comprueba que el SQL embebido esté balanceado.
 */
describe("SQL de «Quitar» (batería del BPCH)", () => {
  it("tiene los paréntesis balanceados", () => {
    const src = readFileSync(join(__dirname, "laboratorio.module.ts"), "utf8");
    const i = src.indexOf("F007 (R4): en el BPCH");
    expect(i).toBeGreaterThan(-1);
    const ini = src.indexOf("`SELECT", i) + 1;
    const fin = src.indexOf("`", ini);
    const sql = src.slice(ini, fin);
    let nivel = 0;
    for (const ch of sql) {
      if (ch === "(") nivel++;
      if (ch === ")") nivel--;
      expect(nivel).toBeGreaterThanOrEqual(0);
    }
    expect(nivel).toBe(0);
    expect(sql).toContain('AS "enBateria"');
  });
});
