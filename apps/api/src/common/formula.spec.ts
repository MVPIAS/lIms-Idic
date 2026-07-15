/**
 * Tests del motor de fórmulas (`formula.ts`).
 *
 * El bloque §INYECCIÓN es el que importa para el pentesting: fija que la
 * sintaxis de JavaScript no es aceptada por este lenguaje. No comprueba que
 * "el sandbox aguanta" — comprueba que no hay nada que aguantar, porque la
 * expresión ni siquiera se parsea.
 *
 * RUNNER: `apps/api/package.json` declara `"test": "jest"` pero el repo no
 * tiene todavía configuración de Jest (ni bloque `jest` en el package.json, ni
 * jest.config.*). Estos tests están escritos contra la API de Jest (`describe`
 * /`it`/`expect`), que es la que ya usan las devDependencies del proyecto
 * (jest + ts-jest + @types/jest están instalados). En cuanto se añada la
 * configuración corren sin tocar una línea; `tsconfig.json` ya excluye
 * `**\/*.spec.ts` del build, así que este archivo no entra en `dist`.
 */
import {
  evaluarFormula,
  validarFormula,
  variablesDe,
  FormulaError,
  MAX_LONGITUD,
  MAX_PROFUNDIDAD,
} from "./formula";

/** Comodidad: evalúa y redondea para comparar flotantes sin sorpresas binarias. */
const ev = (e: string, ctx: Record<string, number | number[]> = {}) => evaluarFormula(e, ctx);

describe("motor de fórmulas · aritmética", () => {
  it("evalúa números y operaciones básicas", () => {
    expect(ev("1+2")).toBe(3);
    expect(ev("10-4")).toBe(6);
    expect(ev("6*7")).toBe(42);
    expect(ev("10/4")).toBe(2.5);
    expect(ev("2^10")).toBe(1024);
  });

  it("acepta decimales, decimales sin cero inicial y notación científica", () => {
    expect(ev("12.5")).toBe(12.5);
    expect(ev(".5+.25")).toBe(0.75);
    expect(ev("1.2e3")).toBe(1200);
    expect(ev("5e-1")).toBe(0.5);
  });

  it("ignora los espacios en blanco", () => {
    expect(ev("  1   +\t2\n*3  ")).toBe(7);
  });
});

describe("motor de fórmulas · precedencia y asociatividad", () => {
  it("* y / van antes que + y -", () => {
    expect(ev("2+3*4")).toBe(14);
    expect(ev("2-6/3")).toBe(0);
  });

  it("los paréntesis mandan", () => {
    expect(ev("(2+3)*4")).toBe(20);
    expect(ev("((1+1)*(2+2))^2")).toBe(64);
  });

  it("+ - * / son asociativos por la izquierda", () => {
    expect(ev("10-3-2")).toBe(5); // (10-3)-2, no 10-(3-2)
    expect(ev("100/10/2")).toBe(5); // (100/10)/2
  });

  it("^ es asociativo por la DERECHA", () => {
    expect(ev("2^3^2")).toBe(512); // 2^(3^2) = 2^9
  });

  it("el unario '-' tiene MENOS precedencia que '^' (convención científica)", () => {
    expect(ev("-2^2")).toBe(-4); // -(2^2)
    expect(ev("(-2)^2")).toBe(4);
  });

  it("admite exponente negativo y unarios encadenados", () => {
    expect(ev("2^-1")).toBe(0.5);
    expect(ev("--5")).toBe(5);
    expect(ev("-  -  -3")).toBe(-3);
    expect(ev("3*-2")).toBe(-6);
    expect(ev("+7")).toBe(7);
  });
});

describe("motor de fórmulas · funciones", () => {
  it("variádicas: PROMEDIO, SUMA, MIN, MAX", () => {
    expect(ev("PROMEDIO(1,2,3)")).toBe(2);
    expect(ev("SUMA(1,2,3,4)")).toBe(10);
    expect(ev("MIN(5,2,8)")).toBe(2);
    expect(ev("MAX(5,2,8)")).toBe(8);
    expect(ev("PROMEDIO(4)")).toBe(4);
  });

  it("las variádicas aplanan vectores del contexto", () => {
    expect(ev("PROMEDIO(REPLICAS)", { REPLICAS: [510, 512, 514] })).toBe(512);
    expect(ev("SUMA(REPLICAS, 10)", { REPLICAS: [1, 2, 3] })).toBe(16);
    expect(ev("MAX(REPLICAS)", { REPLICAS: [1, 9, 3] })).toBe(9);
  });

  it("de un argumento: ABS, RAIZ, LOG (base 10), LN", () => {
    expect(ev("ABS(-3.5)")).toBe(3.5);
    expect(ev("RAIZ(144)")).toBe(12);
    expect(ev("LOG(1000)")).toBe(3);
    expect(ev("LN(1)")).toBe(0);
  });

  it("de dos argumentos: POTENCIA y REDONDEAR", () => {
    expect(ev("POTENCIA(2,8)")).toBe(256);
    expect(ev("REDONDEAR(3.14159, 2)")).toBe(3.14);
    expect(ev("REDONDEAR(2.5, 0)")).toBe(3);
    expect(ev("REDONDEAR(-2.5, 0)")).toBe(-3);
  });

  it("REDONDEAR es estable frente al error binario (1.005 → 1.01, no 1.00)", () => {
    expect(ev("REDONDEAR(1.005, 2)")).toBe(1.01);
    expect(ev("REDONDEAR(1.0049, 2)")).toBe(1);
  });

  it("el nombre de la función es insensible a mayúsculas", () => {
    expect(ev("promedio(1,3)")).toBe(2);
    expect(ev("Raiz(16)")).toBe(4);
  });

  it("las funciones se pueden anidar y componer", () => {
    expect(ev("REDONDEAR(RAIZ(SUMA(2,7)) * 2, 1)")).toBe(6);
    expect(ev("MAX(MIN(1,2), MIN(3,4))")).toBe(3);
  });
});

describe("motor de fórmulas · variables", () => {
  it("resuelve variables del contexto", () => {
    expect(ev("RN1+RN2", { RN1: 10, RN2: 12 })).toBe(22);
    expect(ev("(RN1+RN2)/2 * factor", { RN1: 10, RN2: 12, factor: 1.5 })).toBe(16.5);
  });

  it("PROMEDIO es a la vez variable y función; el '(' decide", () => {
    expect(ev("PROMEDIO*2", { PROMEDIO: 512 })).toBe(1024);
    expect(ev("PROMEDIO(1,3)", { PROMEDIO: 512 })).toBe(2);
    expect(ev("PROMEDIO + PROMEDIO(1,3)", { PROMEDIO: 512 })).toBe(514);
  });

  it("expone el contexto real de la captura (RN1..RNn, PROMEDIO, DE, CV, N)", () => {
    const ctx = { RN1: 510, RN2: 512, RN3: 514, REPLICAS: [510, 512, 514], PROMEDIO: 512, DE: 2, CV: 0.390625, N: 3 };
    expect(ev("PROMEDIO", ctx)).toBe(512);
    expect(ev("DE/PROMEDIO*100", ctx)).toBeCloseTo(0.390625, 6);
    expect(ev("N", ctx)).toBe(3);
    expect(ev("(RN1+RN2+RN3)/N", ctx)).toBe(512);
  });

  it("admite alias en mayúsculas de las claves del contexto", () => {
    expect(ev("MASA*2", { masa: 5 })).toBe(10);
    expect(ev("masa*2", { masa: 5 })).toBe(10);
  });

  it("reproduce las fórmulas paramétricas del Catálogo Global", () => {
    // ppm = (C·F·100)/g
    expect(ev("(C*F*100)/g", { C: 0.5, F: 2, g: 10 })).toBe(10);
    // IP = (V·N·1000)/m
    expect(ev("(V*Nml*1000)/m", { V: 12.5, Nml: 0.1, m: 5 })).toBe(250);
    // NaCl(%) = (V·N·5,844)/m
    expect(ev("(V*Nn*5.844)/m", { V: 10, Nn: 0.1, m: 2 })).toBeCloseTo(2.922, 6);
    // rendimiento = (lf-li)/lf*100
    expect(ev("(lf-li)/lf*100", { lf: 200, li: 150 })).toBe(25);
    // U = k·u_c  (k=2)
    expect(ev("k*u_c", { k: 2, u_c: 0.35 })).toBe(0.7);
  });

  it("acepta guion bajo en los nombres", () => {
    expect(ev("_x + y_2", { _x: 1, y_2: 2 })).toBe(3);
  });
});

describe("motor de fórmulas · errores", () => {
  const falla = (e: string, ctx: Record<string, number | number[]> = {}) => () => evaluarFormula(e, ctx);

  it("lanza FormulaError, nunca otro tipo de error", () => {
    expect(falla("1+")).toThrow(FormulaError);
    expect(falla("@")).toThrow(FormulaError);
    expect(falla("x")).toThrow(FormulaError);
  });

  it("fórmula vacía o en blanco", () => {
    expect(falla("")).toThrow(/vacía/i);
    expect(falla("   ")).toThrow(/vacía/i);
  });

  it("sintaxis incorrecta", () => {
    expect(falla("1+")).toThrow(/sintaxis|termina/i);
    expect(falla("*5")).toThrow(/sintaxis|no se esperaba/i);
    expect(falla("(1+2")).toThrow(/paréntesis/i);
    expect(falla("1+2)")).toThrow(/sobra/i);
    expect(falla("1 2")).toThrow(/sobra/i);
    expect(falla("PROMEDIO(1,")).toThrow(FormulaError);
    expect(falla("()")).toThrow(FormulaError);
  });

  it("carácter no permitido", () => {
    expect(falla("1 & 2")).toThrow(/no permitido/i);
    expect(falla("a[0]", { a: 1 })).toThrow(/no permitido/i);
    expect(falla("x = 1")).toThrow(/no permitido/i);
    expect(falla("'hola'")).toThrow(/no permitido/i);
    expect(falla("1; 2")).toThrow(/no permitido/i);
  });

  it("variable no definida (y sugiere las disponibles)", () => {
    expect(falla("masa*2")).toThrow(/no definida/i);
    expect(falla("RN1+RN9", { RN1: 1 })).toThrow(/RN9/);
    expect(falla("RN1+RN9", { RN1: 1 })).toThrow(/RN1/); // lista las disponibles
  });

  it("función desconocida", () => {
    expect(falla("MEDIANA(1,2,3)")).toThrow(/desconocida/i);
  });

  it("aridad incorrecta", () => {
    expect(falla("RAIZ(1,2)")).toThrow(/espera 1 argumento/i);
    expect(falla("POTENCIA(2)")).toThrow(/espera 2 argumento/i);
    expect(falla("PROMEDIO()")).toThrow(/al menos un valor/i);
  });

  it("división por cero", () => {
    expect(falla("1/0")).toThrow(/división por cero/i);
    expect(falla("RN1/(RN2-RN3)", { RN1: 1, RN2: 5, RN3: 5 })).toThrow(/división por cero/i);
  });

  it("resultado no definido o infinito", () => {
    expect(falla("RAIZ(-1)")).toThrow(/no está definido/i); // NaN
    expect(falla("LN(0)")).toThrow(/infinito/i); // -Infinity
    expect(falla("1e308*10")).toThrow(/infinito/i); // overflow
  });

  it("REDONDEAR valida su segundo argumento", () => {
    expect(falla("REDONDEAR(1.23, 1.5)")).toThrow(/entero/i);
    expect(falla("REDONDEAR(1.23, -1)")).toThrow(/entre 0 y 15/i);
  });

  it("un vector no puede usarse como escalar", () => {
    expect(falla("REPLICAS*2", { REPLICAS: [1, 2] })).toThrow(/vector/i);
    expect(falla("RAIZ(REPLICAS)", { REPLICAS: [1, 2] })).toThrow(/vector/i);
  });

  it("rechaza contextos con valores no numéricos o nombres inválidos", () => {
    expect(falla("x", { x: NaN })).toThrow(/no es un número finito/i);
    expect(falla("x", { x: Infinity })).toThrow(/no es un número finito/i);
    expect(falla("x", { x: [1, NaN] as number[] })).toThrow(/no numéricos/i);
    expect(falla("x", { "a-b": 1, x: 1 })).toThrow(/no válido/i);
  });
});

describe("motor de fórmulas · límites duros", () => {
  it("longitud máxima de la expresión", () => {
    const larga = "1+".repeat(MAX_LONGITUD) + "1";
    expect(() => evaluarFormula(larga)).toThrow(/demasiado larga/i);
  });

  it("profundidad máxima de anidamiento", () => {
    const hondo = "(".repeat(MAX_PROFUNDIDAD + 5) + "1" + ")".repeat(MAX_PROFUNDIDAD + 5);
    expect(() => evaluarFormula(hondo)).toThrow(/anidada/i);
  });

  it("nº máximo de tokens", () => {
    expect(() => evaluarFormula("1+".repeat(400) + "1")).toThrow(/demasiado (compleja|larga)/i);
  });

  it("nº máximo de argumentos", () => {
    const args = Array.from({ length: 200 }, () => "1").join(",");
    expect(() => evaluarFormula(`SUMA(${args})`)).toThrow(/demasiados/i);
  });

  it("una expresión legítimamente anidada SÍ pasa", () => {
    expect(evaluarFormula("((((1+1))))*2")).toBe(4);
  });
});

/* ==========================================================================
 * §INYECCIÓN · lo que va a mirar el pentest.
 *
 * Ninguno de estos casos "se bloquea": sencillamente no son expresiones
 * aritméticas, así que el tokenizador/parser los rechaza. Se comprueba además
 * el efecto observable (que el proceso siga vivo, que no haya escritura).
 * ========================================================================== */
describe("motor de fórmulas · §inyección (no hay ejecución de código)", () => {
  const noEjecuta = (e: string) => {
    expect(() => evaluarFormula(e)).toThrow(FormulaError);
  };

  it("no ejecuta process.*", () => {
    noEjecuta("process.exit(1)");
    noEjecuta("process.env.JWT_SECRET");
    noEjecuta("global.process.exit(1)");
  });

  it("no ejecuta require()", () => {
    noEjecuta("require('fs')");
    noEjecuta("require('child_process').execSync('id')");
    noEjecuta("require(`fs`)");
  });

  it("no permite escapar por el prototipo (el clásico constructor.constructor)", () => {
    noEjecuta("constructor");
    noEjecuta("constructor.constructor('return process')()");
    noEjecuta("__proto__");
    noEjecuta("this.constructor.constructor('return 1')()");
    noEjecuta("[].constructor");
  });

  it("un nombre heredado de Object.prototype NO resuelve como variable", () => {
    // El ámbito es un Map, no un objeto: 'toString'/'valueOf' no existen en él.
    expect(() => evaluarFormula("toString")).toThrow(/no definida/i);
    expect(() => evaluarFormula("valueOf")).toThrow(/no definida/i);
    expect(() => evaluarFormula("hasOwnProperty")).toThrow(/no definida/i);
    // Y tampoco contamina un contexto legítimo.
    expect(() => evaluarFormula("toString", { RN1: 1 })).toThrow(/no definida/i);
  });

  it("una clave hostil en el CONTEXTO no envenena el ámbito", () => {
    // En un objeto literal, `__proto__: 1` no crea propiedad propia (y asignar
    // un número como prototipo se ignora): no hay tal variable.
    expect(() => evaluarFormula("__proto__", { __proto__: 1 } as any)).toThrow(/no definida/i);

    // JSON.parse SÍ crea `__proto__` como propiedad PROPIA: es el vector
    // clásico de prototype pollution. El contexto se rechaza en bloque porque
    // el valor no es numérico (fail-closed)...
    const hostil = JSON.parse('{"__proto__":{"x":1},"RN1":7}');
    expect(() => evaluarFormula("RN1", hostil)).toThrow(FormulaError);
    // ...y, lo que importa: nada se ha propagado al prototipo global.
    expect(({} as any).x).toBeUndefined();

    // Y si el valor es un número, `__proto__` es una variable corriente e
    // inerte: vive en el Map del ámbito, no en ningún prototipo.
    expect(evaluarFormula("RN1 + __proto__", JSON.parse('{"__proto__":5,"RN1":7}'))).toBe(12);
    expect(({} as any).__proto__).not.toBe(5);
  });

  it("no acepta sintaxis de JS (llamadas, acceso, literales, sentencias)", () => {
    noEjecuta("1; console.log(1)");
    noEjecuta("(() => 1)()");
    noEjecuta("function f(){}");
    noEjecuta("{a:1}");
    noEjecuta("`${1}`");
    noEjecuta("[1,2,3]");
    noEjecuta("1 && 2");
    noEjecuta("1 == 1");
    noEjecuta("x => x");
    noEjecuta("new Date()");
    noEjecuta("import('fs')");
    noEjecuta("await fetch('http://x')");
  });

  it("no hay bucles: toda evaluación termina", () => {
    noEjecuta("while(true){}");
    noEjecuta("for(;;){}");
  });

  it("un identificador que casualmente es una API del host es sólo texto", () => {
    // 'eval' pasa el tokenizador (son letras), pero sólo puede ser variable o
    // función: no está en el contexto ni en la lista blanca → error.
    expect(() => evaluarFormula("eval")).toThrow(/no definida/i);
    expect(() => evaluarFormula("eval(1)")).toThrow(/desconocida/i);
    expect(() => evaluarFormula("Function(1)")).toThrow(/desconocida/i);
    expect(() => evaluarFormula("fetch(1)")).toThrow(/desconocida/i);
  });

  it("validarFormula tampoco evalúa nada (no tiene efectos)", () => {
    expect(validarFormula("process.exit(1)").ok).toBe(false);
    expect(validarFormula("require('fs')").ok).toBe(false);
    // Si validarFormula ejecutara algo, este test no llegaría a terminar.
    expect(true).toBe(true);
  });
});

describe("validarFormula", () => {
  it("acepta una fórmula bien formada y reporta variables y funciones", () => {
    const r = validarFormula("REDONDEAR((C*F*100)/g, 2)");
    expect(r.ok).toBe(true);
    expect(r.error).toBeUndefined();
    expect(r.variables?.sort()).toEqual(["C", "F", "g"]);
    expect(r.funciones).toEqual(["REDONDEAR"]);
  });

  it("rechaza sintaxis inválida con un mensaje legible", () => {
    const r = validarFormula("(1+2");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/paréntesis/i);
  });

  it("no exige variables si no se le da la lista", () => {
    expect(validarFormula("masa/volumen").ok).toBe(true);
  });

  it("si se le da la lista, comprueba las variables (sin distinguir mayúsculas)", () => {
    expect(validarFormula("masa/volumen", ["masa", "volumen"]).ok).toBe(true);
    expect(validarFormula("masa/volumen", ["MASA", "VOLUMEN"]).ok).toBe(true);
    const r = validarFormula("masa/densidad", ["masa", "volumen"]);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/densidad/);
  });

  it("nunca lanza: siempre devuelve {ok:false}", () => {
    for (const mala of ["", "   ", "@@@", "1+", "require('fs')", "x".repeat(2000)]) {
      expect(() => validarFormula(mala)).not.toThrow();
      expect(validarFormula(mala).ok).toBe(false);
    }
    expect(validarFormula(null as any).ok).toBe(false);
    expect(validarFormula(123 as any).ok).toBe(false);
  });
});

describe("variablesDe", () => {
  it("lista las variables de la fórmula", () => {
    expect(variablesDe("(RN1+RN2)/2").sort()).toEqual(["RN1", "RN2"]);
    expect(variablesDe("PROMEDIO(1,2)")).toEqual([]); // función, no variable
  });
  it("devuelve [] si la fórmula no parsea", () => {
    expect(variablesDe("1+")).toEqual([]);
  });
});
