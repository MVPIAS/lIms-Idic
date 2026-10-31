/**
 * ALI-D4 · métodos LQA con lecturas y fórmula (EP-02 §3.2, §3.9, §5) y reglas
 * de aceptación. Las fórmulas se leen del propio SQL que las carga en el
 * catálogo (packages/db/align_ali_d4_metodos_lqa.sql), para que no diverjan.
 * Los números son ejemplos de cálculo a mano (las planillas recibidas no traen
 * casos resueltos).
 */
import * as fs from "fs";
import * as path from "path";
import { calcularCaptura } from "./captura-estandar";
import { evaluarReglas, leerReglas, modoReglas, textoRegla } from "./reglas-aceptacion";
import { traducirFormula } from "./formula-legado";

const SQL = fs.readFileSync(path.resolve(__dirname, "../../../../packages/db/align_ali_d4_metodos_lqa.sql"), "utf8");
function metodo(codigo: string) {
  const m = new RegExp(`\\('${codigo}', '([^']+)',\\s*'(\\[[^']*\\])'`).exec(SQL);
  if (!m) throw new Error(`método ${codigo} no está en el SQL`);
  return { formula: m[1], reglas: leerReglas(m[2]) };
}
const num = (o: object = {}) => ({ tipoDato: "numerico" as const, ...o });

describe("ALI-D4 · fórmulas de los métodos LQA", () => {
  it("todas las fórmulas son del motor y piden los campos esperados", () => {
    const esperado: Record<string, number> = { "403": 4, "399": 4, "978": 4, "395": 3, "966": 6, "970": 6, "971": 6, "972": 6, "973": 6 };
    for (const [c, n] of Object.entries(esperado)) {
      const t = traducirFormula(metodo(c).formula);
      expect({ c, origen: t.origen, n: t.nCampos }).toEqual({ c, origen: "motor", n });
    }
  });

  it("proteína Kjeldahl: %P = 1,4 × N × V × Factor / m, promedio de X y X′", () => {
    const { formula } = metodo("403");
    const r = calcularCaptura(num({ formula, limiteInf: "12" }), {
      lecturas: [
        { C1: "1,0000", C2: "12,50", C3: "0,1", C4: "6,25" }, // X  = 10,9375
        { C1: "1,0020", C2: "12,60", C3: "0,1", C4: "6,25" }, // X′ = 11,0030
      ],
    });
    expect(r.replicas[0]).toBeCloseTo(10.9375, 6);
    expect(r.replicas[1]).toBeCloseTo(11.02500 / 1.002, 6);
    expect(r.valorNumerico).toBeCloseTo((10.9375 + 11.025 / 1.002) / 2, 6);
    expect(r.veredicto).toBe("no_cumple"); // Mín 12 % de este ejemplo
  });

  it("proteína: el factor vacío toma el valor por defecto 6,25 (por confirmar, SAL-06)", () => {
    const { formula } = metodo("403");
    const r = calcularCaptura(num({ formula, camposDefecto: { C4: 6.25 } }), {
      lecturas: [{ C1: "1", C2: "12,5", C3: "0,1", C4: "" }],
    });
    expect(r.valorNumerico).toBeCloseTo(10.9375, 6);
    expect(r.lecturas![0].C4).toBe(6.25);
    // Un factor escrito por el analista manda sobre el de defecto (gelatina 5,5).
    const g = calcularCaptura(num({ formula, camposDefecto: { C4: 6.25 } }), { lecturas: [{ C1: "1", C2: "12,5", C3: "0,1", C4: "5,5" }] });
    expect(g.valorNumerico).toBeCloseTo(9.625, 6);
  });

  it("materia grasa: %G = (m₂ − m₁) / m × 100 con la última pesada", () => {
    const { formula } = metodo("399");
    const r = calcularCaptura(num({ formula, limiteSup: "25" }), {
      lecturas: [{ C1: "5,0000", C2: "100,0000", C3: "100,9876", C4: "100,9870" }],
    });
    expect(r.valorNumerico).toBeCloseTo(19.74, 6);
    expect(r.veredicto).toBe("cumple");
  });

  it("humedad: (m inicial − m final) / m inicial × 100", () => {
    const { formula } = metodo("395");
    // filtro 1,2000 g; filtro + muestra 6,2000 g (5 g); peso constante 5,7500 g → 0,45 g de agua.
    const r = calcularCaptura(num({ formula }), { lecturas: [{ C1: "1,2000", C2: "6,2000", C3: "5,7500" }] });
    expect(r.valorNumerico).toBeCloseTo(9, 6);
  });

  it("acidez titulable: (gasto − corrección − blanco) × N × factor / peso × 100", () => {
    const { formula } = metodo("966");
    // 10 g; gasto 15,30 mL; corrección 0,10; blanco 0,20; N 0,1; ácido cítrico 0,064 → 15,0 × 0,1 × 0,064 / 10 × 100 = 0,96 %.
    const r = calcularCaptura(num({ formula, camposDefecto: { C3: 0, C4: 0, C6: 0.064 } }), {
      lecturas: [{ C1: "10", C2: "15,30", C3: "0,10", C4: "0,20", C5: "0,1", C6: "" }],
    });
    expect(r.valorNumerico).toBeCloseTo(0.96, 6);
  });

  it("el valor final directo sigue funcionando en un método con fórmula por lecturas", () => {
    const { formula } = metodo("403");
    const r = calcularCaptura(num({ formula, limiteInf: "12" }), { valor: "12,4" });
    expect(r.valorNumerico).toBe(12.4);
    expect(r.replicas).toEqual([]);
    expect(r.veredicto).toBe("cumple");
  });
});

describe("ALI-D4 · reglas de aceptación", () => {
  const proteina = metodo("403").reglas;
  const grasa = metodo("399").reglas;

  it("se leen del SQL: duplicados 0,38 absoluto y peso constante 0,001 g, ambos por confirmar", () => {
    expect(proteina).toEqual([expect.objectContaining({ tipo: "duplicados", max: 0.38, modo: "absoluto", porConfirmar: true })]);
    expect(grasa).toEqual([expect.objectContaining({ tipo: "diferencia_campos", campoA: "C4", campoB: "C3", max: 0.001, porConfirmar: true })]);
    expect(metodo("395").reglas).toEqual([]);
  });

  it("duplicados: |X − X′| ≤ 0,38 cumple (incluido el borde) y > 0,38 avisa", () => {
    expect(evaluarReglas(proteina, [10.9375, 11.003], null)).toEqual([]);
    expect(evaluarReglas(proteina, [10.5, 10.88], null)).toEqual([]); // 0,38 exacto
    const a = evaluarReglas(proteina, [10.5, 10.9], null);
    expect(a).toHaveLength(1);
    expect(a[0].diferencia).toBeCloseTo(0.4, 9);
    expect(a[0].texto).toMatch(/0,4/);
  });

  it("duplicados: una sola determinación avisa que el método pide duplicado", () => {
    expect(evaluarReglas(proteina, [10.9], null)[0].texto).toMatch(/una sola determinación/);
    expect(evaluarReglas(proteina, [], null)).toEqual([]); // valor final directo: no se evalúa
  });

  it("duplicados en modo relativo: diferencia como % del promedio", () => {
    const rel = leerReglas([{ tipo: "duplicados", max: 2, modo: "relativo" }]);
    expect(evaluarReglas(rel, [10, 10.1], null)).toEqual([]); // 0,995 %
    expect(evaluarReglas(rel, [10, 10.5], null)).toHaveLength(1); // 4,88 %
    expect(textoRegla(rel[0])).toMatch(/% del promedio/);
  });

  it("peso constante: pesada final − anterior ≤ 0,001 g", () => {
    expect(evaluarReglas(grasa, [19.74], [{ C1: 5, C2: 100, C3: 100.9876, C4: 100.987 }])).toEqual([]);
    expect(evaluarReglas(grasa, [19.74], [{ C1: 5, C2: 100, C3: 100.9886, C4: 100.9876 }])).toEqual([]); // 0,001 exacto
    const a = evaluarReglas(grasa, [19.7, 19.74], [
      { C1: 5, C2: 100, C3: 100.99, C4: 100.985 },
      { C1: 5, C2: 100, C3: 100.9876, C4: 100.987 },
    ]);
    expect(a).toHaveLength(1);
    expect(a[0].texto).toMatch(/lectura 1/);
  });

  it("lectura del JSON tolerante y modo del parámetro", () => {
    expect(leerReglas("no es json")).toEqual([]);
    expect(leerReglas([{ tipo: "otro", max: 1 }, { tipo: "duplicados" }, { tipo: "diferencia_campos", campoA: "x", campoB: "C2", max: 1 }])).toEqual([]);
    expect(leerReglas('[{"tipo":"duplicados","max":"0,38"}]')[0]).toMatchObject({ max: 0.38, modo: "absoluto" });
    expect(modoReglas("impedir")).toBe("impedir");
    expect(modoReglas("IMPEDIR ")).toBe("impedir");
    expect(modoReglas(null)).toBe("avisar");
    expect(modoReglas("otra cosa")).toBe("avisar");
  });
});
