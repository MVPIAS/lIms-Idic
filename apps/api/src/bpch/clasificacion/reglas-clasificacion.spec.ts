import {
  evaluarIt21,
  evaluarIt22,
  evaluarIt23,
  evaluarPruebas,
  normalizarNumeroOnu,
  textoClasificacion,
  validarRegistro,
} from "./reglas-clasificacion";

const neg = { tuboFragmentado: false, placaPerforada: false };

describe("Clasificación · IT21 barrera interpuesta", () => {
  it("positivo si el tubo se fragmenta o la placa testigo se perfora", () => {
    expect(evaluarIt21({ aplica: true, serie1: { ensayos: [{ tuboFragmentado: true, placaPerforada: false }] } }).resultado).toBe("positivo");
    expect(evaluarIt21({ aplica: true, serie1: { ensayos: [{ tuboFragmentado: false, placaPerforada: true }] } }).resultado).toBe("positivo");
  });
  it("un solo ensayo negativo no concluye: la IT exige un segundo", () => {
    expect(evaluarIt21({ aplica: true, serie1: { ensayos: [neg] } }).resultado).toBe("incompleto");
    expect(evaluarIt21({ aplica: true, serie1: { ensayos: [neg, neg] } }).resultado).toBe("negativo");
  });
  it("evalúa cada serie y concluye positivo si alguna lo es", () => {
    const r = evaluarIt21({ aplica: true, serie1: { ensayos: [neg, neg] }, serie2: { ensayos: [{ tuboFragmentado: true, placaPerforada: false }] } });
    expect(r).toMatchObject({ resultado: "positivo", serie1: "negativo", serie2: "positivo" });
  });
  it("sin series o no aplica", () => {
    expect(evaluarIt21({ aplica: true }).resultado).toBe("incompleto");
    expect(evaluarIt21({ aplica: false }).resultado).toBe("no_aplica");
    expect(evaluarIt21(null).resultado).toBe("no_aplica");
  });
});

describe("Clasificación · IT22 Koenen", () => {
  it("explosión (F, G, H) con orificio ≥ 1 mm en Serie 1 → positivo, con diámetro límite", () => {
    const r = evaluarIt22({ aplica: true, serie: 1, ensayos: [{ orificioMm: 12, efecto: "D" }, { orificioMm: 5, efecto: "F" }] });
    expect(r).toMatchObject({ resultado: "positivo", diametroLimiteMm: 5 });
  });
  it("efectos O a E no son explosión; sin todas las placas queda incompleto", () => {
    expect(evaluarIt22({ aplica: true, serie: 1, ensayos: [{ orificioMm: 12, efecto: "E" }] }).resultado).toBe("incompleto");
  });
  it("sin explosión con 12, 5 y 2 mm en Serie 2 → negativo (límite < 2 mm)", () => {
    const r = evaluarIt22({
      aplica: true,
      serie: 2,
      ensayos: [{ orificioMm: 12, efecto: "O" }, { orificioMm: 5, efecto: "A" }, { orificioMm: 2, efecto: "C" }],
    });
    expect(r).toMatchObject({ resultado: "negativo", diametroLimiteMm: null });
  });
  it("Serie 2 exige ≥ 2 mm: explosión solo con 1 mm es negativo", () => {
    expect(evaluarIt22({ aplica: true, serie: 2, ensayos: [{ orificioMm: 1, efecto: "H" }] }).resultado).toBe("negativo");
    expect(evaluarIt22({ aplica: true, serie: 1, ensayos: [{ orificioMm: 1, efecto: "H" }] }).resultado).toBe("positivo");
  });
});

describe("Clasificación · IT23 TPT", () => {
  it("tres ensayos bajo 2.070 kPa → negativo", () => {
    const r = evaluarIt23({ aplica: true, ensayos: [{ presionMaxKpa: 1850 }, { presionMaxKpa: 1900 }, { presionMaxKpa: 2000 }] });
    expect(r).toMatchObject({ resultado: "negativo", presionMaxKpa: 2000, tiempoMinMs: null });
  });
  it("alguno alcanza 2.070 kPa → positivo, informa el menor tiempo 690→2.070 kPa", () => {
    const r = evaluarIt23({
      aplica: true,
      ensayos: [{ presionMaxKpa: 2070, tiempoMs: 40 }, { presionMaxKpa: 2500, tiempoMs: 12 }, { presionMaxKpa: 1000, tiempoMs: 3 }],
    });
    expect(r).toMatchObject({ resultado: "positivo", tiempoMinMs: 12 });
  });
  it("menos de tres ensayos → incompleto", () => {
    expect(evaluarIt23({ aplica: true, ensayos: [{ presionMaxKpa: 3000 }] }).resultado).toBe("incompleto");
  });
});

describe("Clasificación · conjunto y registro", () => {
  const positivas = { it21: { aplica: true, serie1: { ensayos: [{ tuboFragmentado: true, placaPerforada: false }] } } };
  const negativas = { it23: { aplica: true, ensayos: [{ presionMaxKpa: 100 }, { presionMaxKpa: 100 }, { presionMaxKpa: 100 }] } };

  it("indicador: positivo si alguna aplicada lo es; null si falta alguna", () => {
    expect(evaluarPruebas(positivas).indicaExplosiva).toBe(true);
    expect(evaluarPruebas(negativas).indicaExplosiva).toBe(false);
    expect(evaluarPruebas({ ...negativas, it21: { aplica: true, serie1: { ensayos: [neg] } } })).toMatchObject({
      indicaExplosiva: null,
      incompletas: ["it21"],
    });
    expect(evaluarPruebas({}).indicaExplosiva).toBeNull();
  });

  it("explosiva exige división 1.1–1.6", () => {
    const ev = evaluarPruebas(positivas);
    expect(validarRegistro({ explosiva: true, claseDivision: "1.4", numeroOnu: "0456" }, ev)).toEqual([]);
    expect(validarRegistro({ explosiva: true }, ev).join(" ")).toMatch(/división de riesgo/);
    expect(validarRegistro({ explosiva: true, claseDivision: "5.1" }, ev).join(" ")).toMatch(/no es de Clase 1/);
  });
  it("no explosiva no lleva división de Clase 1 ni grupo de compatibilidad", () => {
    const ev = evaluarPruebas(negativas);
    expect(validarRegistro({ explosiva: false, claseDivision: "5.1" }, ev)).toEqual([]);
    expect(validarRegistro({ explosiva: false, claseDivision: "1.1" }, ev).join(" ")).toMatch(/es de Clase 1/);
    expect(validarRegistro({ explosiva: false, grupoCompatibilidad: "S" }, ev).join(" ")).toMatch(/grupo de compatibilidad/);
  });
  it("contradecir el indicador o clasificar sin pruebas exige justificación", () => {
    expect(validarRegistro({ explosiva: false }, evaluarPruebas(positivas)).join(" ")).toMatch(/justifique/);
    expect(validarRegistro({ explosiva: false, justificacion: "Fundamento técnico" }, evaluarPruebas(positivas))).toEqual([]);
    expect(validarRegistro({ explosiva: true, claseDivision: "1.4" }, evaluarPruebas(negativas)).join(" ")).toMatch(/justifique/);
    expect(validarRegistro({ explosiva: false }, evaluarPruebas({})).join(" ")).toMatch(/ninguna prueba/);
  });
  it("pruebas incompletas, decisión ausente, Nº ONU y listas vigentes", () => {
    const ev = evaluarPruebas({ it21: { aplica: true, serie1: { ensayos: [neg] } } });
    const e = validarRegistro({ explosiva: null, numeroOnu: "45" }, ev).join(" ");
    expect(e).toMatch(/sin concluir/);
    expect(e).toMatch(/Indique si la sustancia es explosiva/);
    expect(e).toMatch(/cuatro dígitos/);
    expect(
      validarRegistro({ explosiva: true, claseDivision: "1.4", grupoCompatibilidad: "Z" }, evaluarPruebas(positivas), { gruposValidos: ["S"] }).join(" "),
    ).toMatch(/no está en la lista vigente/);
  });
  it("normaliza el Nº ONU y resume la clasificación", () => {
    expect(normalizarNumeroOnu(" un 0456 ")).toBe("0456");
    expect(normalizarNumeroOnu("")).toBeNull();
    expect(textoClasificacion({ explosiva: true, claseDivision: "1.4", grupoCompatibilidad: "s", numeroOnu: "0456" })).toBe("1.4S · UN 0456");
    expect(textoClasificacion({ explosiva: false, claseDivision: "5.1", numeroOnu: "1942" })).toBe("No explosiva · 5.1 · UN 1942");
    expect(textoClasificacion({ explosiva: null })).toBe("Sin clasificar");
  });
});
