/**
 * ============================================================================
 * MOTOR DE FÓRMULAS · LIMS IDIC (RF-A06, RF-D02.1)
 * ============================================================================
 *
 * Evaluador de expresiones aritméticas para `Analito.formula`. Sustituye al
 * "texto muerto" que documenta `docs/AUDITORIA_FUNCIONAL.md` §5.5: hasta ahora
 * la fórmula del analito se almacenaba pero no se evaluaba nunca.
 *
 * Las 149 fórmulas del LIMS legacy eran scripts SSL de STARLIMS (un lenguaje
 * imperativo completo). NO se portan: aquí solo se admiten EXPRESIONES
 * aritméticas puras. Es una decisión deliberada — una fórmula de analito no
 * necesita bucles, asignaciones, ni acceso a E/S, y no dárselos elimina de raíz
 * toda una clase de vulnerabilidades.
 *
 * ---------------------------------------------------------------------------
 * GARANTÍA DE SEGURIDAD: AQUÍ NO SE EJECUTA CÓDIGO. NUNCA.
 * ---------------------------------------------------------------------------
 * Este módulo NO usa `eval`, NI `new Function`, NI el módulo `vm`, NI `vm2`
 * (deprecado por CVEs de escape de sandbox), NI ninguna librería de terceros.
 * La expresión del usuario NUNCA llega a un intérprete de JavaScript.
 *
 * El texto se convierte en una lista de tokens de un alfabeto CERRADO
 * (números, identificadores, `+ - * / ^ ( ) ,`). Cualquier carácter fuera de
 * ese alfabeto aborta el tokenizado. Los tokens se parsean a un AST de 4 tipos
 * de nodo (`num`, `var`, `un`, `bin`, `call`) y el evaluador es un `switch`
 * sobre esos tipos: sólo puede producir aritmética. No hay ninguna ruta de
 * código por la que un identificador se convierta en una referencia a un objeto
 * del host:
 *
 *   · Las variables se resuelven contra un `Map` (prototipo nulo por
 *     construcción), no contra un objeto — `constructor`, `__proto__` o
 *     `toString` no resuelven a nada y dan "variable no definida".
 *   · Las funciones se resuelven contra un `Map` blanco de 11 entradas fijas.
 *   · Sólo se aceptan valores `number` finitos, ni siquiera como entrada.
 *
 * Por tanto `require('fs')`, `process.exit(1)` o `constructor.constructor(...)`
 * no son "código peligroso que hay que bloquear": son sencillamente expresiones
 * que este lenguaje no sabe leer, y fallan con FormulaError de sintaxis. Hay
 * tests que lo fijan (`formula.spec.ts` §inyección).
 *
 * TERMINACIÓN: el lenguaje no tiene bucles, ni recursión, ni funciones
 * definidas por el usuario. El AST es un árbol finito acotado por
 * MAX_PROFUNDIDAD y el evaluador lo recorre una vez. Toda evaluación termina en
 * tiempo proporcional al tamaño del árbol: no hace falta timeout ni watchdog
 * porque no existe la posibilidad de un bucle infinito.
 *
 * ---------------------------------------------------------------------------
 * GRAMÁTICA SOPORTADA (EBNF; precedencia de menor a mayor)
 * ---------------------------------------------------------------------------
 *   expresion  := termino   (("+" | "-") termino)*
 *   termino    := unario    (("*" | "/") unario)*
 *   unario     := ("-" | "+") unario | potencia
 *   potencia   := primario  ("^" unario)?            // asociativo a la DERECHA
 *   primario   := numero | llamada | variable | "(" expresion ")"
 *   llamada    := identificador "(" [ expresion ("," expresion)* ] ")"
 *   numero     := digitos ["." digitos] [("e"|"E") ["+"|"-"] digitos]
 *   identificador := (letra | "_") (letra | digito | "_")*
 *
 * Consecuencias de la precedencia elegida (convención científica, igual que
 * Excel/MATLAB):  -2^2 = -4   ·   2^3^2 = 512 (= 2^9, no 64)   ·   2^-1 = 0,5
 *
 * FUNCIONES (nombre insensible a mayúsculas):
 *   PROMEDIO(...) SUMA(...) MIN(...) MAX(...)   variádicas (≥1 arg; aceptan
 *                                               vectores: PROMEDIO(REPLICAS))
 *   ABS(x) RAIZ(x) LOG(x) LN(x)                 1 argumento
 *   POTENCIA(x,y) REDONDEAR(x,n)                2 argumentos
 *   LOG es logaritmo DECIMAL (base 10) y LN el natural, como en Excel-es.
 *
 * VARIABLES: las que se pasen en el contexto. En la captura de resultados son
 *   RN1..RNn (réplicas), REPLICAS (el vector), PROMEDIO, DE, CV, N, más las
 *   variables extra del ensayo (masa, volumen, factor…). Nótese que PROMEDIO
 *   es a la vez variable y función: `PROMEDIO` es el promedio ya calculado y
 *   `PROMEDIO(a,b)` es la llamada. El parser los distingue por el "(" que sigue
 *   (o no) al identificador.
 *
 * ERRORES: siempre `FormulaError` (nunca un TypeError ni un 500). Cubren
 *   sintaxis, límites excedidos, variable no definida, aridad incorrecta,
 *   división por cero y resultado no finito/indefinido (p. ej. RAIZ(-1)).
 */

/** Error de fórmula. Todo fallo del motor es de esta clase: el llamante lo mapea a HTTP 400. */
export class FormulaError extends Error {
  constructor(
    message: string,
    /** Posición (índice de carácter) donde se detectó el problema, si aplica. */
    readonly posicion?: number,
  ) {
    super(message);
    this.name = "FormulaError";
  }
}

/* ===================== LÍMITES DUROS =====================
 * Son defensa en profundidad, no la barrera principal (la barrera es que no
 * hay intérprete). Acotan el coste de parsear/evaluar una fórmula hostil
 * guardada en el catálogo: una expresión como "((((((…))))))" con 100k
 * paréntesis desbordaría la pila del parser recursivo si no se acotara.
 */
/** Longitud máxima del texto de la fórmula. Las 14 fórmulas del Catálogo Global no pasan de ~60 caracteres. */
export const MAX_LONGITUD = 1000;
/** Nº máximo de tokens. */
export const MAX_TOKENS = 500;
/** Profundidad máxima del AST (protege la pila del parser y del evaluador). */
export const MAX_PROFUNDIDAD = 32;
/** Nº máximo de argumentos en una llamada (y de elementos que aporta un vector). */
export const MAX_ARGUMENTOS = 100;
/** Longitud máxima de un identificador. */
const MAX_IDENT = 40;

/* ===================== AST ===================== */
type Nodo =
  | { t: "num"; v: number }
  | { t: "var"; nombre: string; pos: number }
  | { t: "un"; op: "-" | "+"; e: Nodo }
  | { t: "bin"; op: "+" | "-" | "*" | "/" | "^"; i: Nodo; d: Nodo; pos: number }
  | { t: "call"; nombre: string; args: Nodo[]; pos: number };

/* ===================== TOKENIZADOR ===================== */
type TipoToken = "num" | "ident" | "op" | "(" | ")" | ",";
interface Token {
  tipo: TipoToken;
  /** Texto del token; para "num" es el literal, para "op" el símbolo. */
  s: string;
  /** Valor ya parseado (sólo "num"). */
  v?: number;
  pos: number;
}

const ES_DIGITO = (c: string) => c >= "0" && c <= "9";
const ES_LETRA = (c: string) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
const OPERADORES = new Set(["+", "-", "*", "/", "^"]);

/**
 * Texto → tokens. El alfabeto es cerrado: cualquier carácter que no sea
 * espacio, dígito, letra ASCII, `_`, `.`, un operador o `( ) ,` es rechazado.
 * Esto descarta de entrada `[`, `]`, `'`, `"`, `;`, `{`, `}`, `=`, `$`, `` ` ``…
 * es decir, la sintaxis que necesitaría cualquier intento de inyección.
 */
function tokenizar(expr: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];

    // Espacios (incluye tab/salto de línea).
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }

    // Número: 12  ·  12.5  ·  .5  ·  1.2e-3
    if (ES_DIGITO(c) || (c === "." && ES_DIGITO(expr[i + 1]))) {
      const inicio = i;
      while (i < expr.length && ES_DIGITO(expr[i])) i++;
      if (expr[i] === ".") {
        i++;
        while (i < expr.length && ES_DIGITO(expr[i])) i++;
      }
      // Exponente. Sólo se consume si está bien formado; si no, `e` queda como
      // identificador y el parser dará un error de sintaxis honesto.
      if (expr[i] === "e" || expr[i] === "E") {
        let j = i + 1;
        if (expr[j] === "+" || expr[j] === "-") j++;
        if (ES_DIGITO(expr[j])) {
          j++;
          while (j < expr.length && ES_DIGITO(expr[j])) j++;
          i = j;
        }
      }
      const lit = expr.slice(inicio, i);
      const v = Number(lit);
      if (!Number.isFinite(v)) throw new FormulaError(`Número no válido: '${lit}'`, inicio);
      out.push({ tipo: "num", s: lit, v, pos: inicio });
      continue;
    }

    // Identificador (variable o nombre de función).
    if (ES_LETRA(c)) {
      const inicio = i;
      while (i < expr.length && (ES_LETRA(expr[i]) || ES_DIGITO(expr[i]))) i++;
      const s = expr.slice(inicio, i);
      if (s.length > MAX_IDENT)
        throw new FormulaError(`Nombre demasiado largo (máx. ${MAX_IDENT}): '${s}'`, inicio);
      out.push({ tipo: "ident", s, pos: inicio });
      continue;
    }

    if (OPERADORES.has(c)) {
      out.push({ tipo: "op", s: c, pos: i++ });
      continue;
    }
    if (c === "(" || c === ")" || c === ",") {
      out.push({ tipo: c as TipoToken, s: c, pos: i++ });
      continue;
    }

    throw new FormulaError(`Carácter no permitido '${c}' en la posición ${i + 1}`, i);
  }

  if (out.length > MAX_TOKENS)
    throw new FormulaError(`Fórmula demasiado compleja (máx. ${MAX_TOKENS} elementos)`);
  return out;
}

/* ===================== PARSER (descenso recursivo) ===================== */
class Parser {
  private k = 0;
  private prof = 0;
  constructor(private readonly tk: Token[]) {}

  private get actual(): Token | undefined {
    return this.tk[this.k];
  }
  /**
   * ¿El token en curso es de este tipo? Es un método y no una comparación
   * directa contra `this.actual?.tipo` a propósito: TypeScript estrecha el tipo
   * del getter dentro del bloque y luego marca como imposibles comparaciones
   * que sí ocurren, porque `this.k` avanza entre medias.
   */
  private esTipo(tipo: TipoToken): boolean {
    return this.tk[this.k]?.tipo === tipo;
  }
  private esOp(...ops: string[]): boolean {
    const t = this.actual;
    return !!t && t.tipo === "op" && ops.includes(t.s);
  }
  private finPos(): number {
    const ult = this.tk[this.tk.length - 1];
    return ult ? ult.pos + ult.s.length : 0;
  }
  /** Cada nivel de anidamiento pasa por aquí: acota la recursión del parser Y la del evaluador. */
  private entrar(): void {
    if (++this.prof > MAX_PROFUNDIDAD)
      throw new FormulaError(`Fórmula demasiado anidada (máx. ${MAX_PROFUNDIDAD} niveles)`);
  }
  private salir(): void {
    this.prof--;
  }

  parse(): Nodo {
    if (this.tk.length === 0) throw new FormulaError("La fórmula está vacía");
    const n = this.expresion();
    const sobra = this.actual;
    if (sobra)
      throw new FormulaError(
        `Sintaxis incorrecta: sobra '${sobra.s}' en la posición ${sobra.pos + 1}`,
        sobra.pos,
      );
    return n;
  }

  /** expresion := termino (("+"|"-") termino)* — asociativo a la izquierda. */
  private expresion(): Nodo {
    this.entrar();
    let i = this.termino();
    while (this.esOp("+", "-")) {
      const t = this.tk[this.k++];
      i = { t: "bin", op: t.s as "+" | "-", i, d: this.termino(), pos: t.pos };
    }
    this.salir();
    return i;
  }

  /** termino := unario (("*"|"/") unario)* — asociativo a la izquierda. */
  private termino(): Nodo {
    this.entrar();
    let i = this.unario();
    while (this.esOp("*", "/")) {
      const t = this.tk[this.k++];
      i = { t: "bin", op: t.s as "*" | "/", i, d: this.unario(), pos: t.pos };
    }
    this.salir();
    return i;
  }

  /**
   * unario := ("-"|"+") unario | potencia
   * El unario está POR DEBAJO de `^` en precedencia: -2^2 = -(2^2) = -4.
   */
  private unario(): Nodo {
    if (this.esOp("-", "+")) {
      this.entrar();
      const t = this.tk[this.k++];
      const e = this.unario();
      this.salir();
      return { t: "un", op: t.s as "-" | "+", e };
    }
    return this.potencia();
  }

  /**
   * potencia := primario ("^" unario)? — asociativo a la DERECHA (2^3^2 = 2^9).
   * El operando derecho es `unario` para admitir 2^-1.
   */
  private potencia(): Nodo {
    this.entrar();
    const base = this.primario();
    let n: Nodo = base;
    if (this.esOp("^")) {
      const t = this.tk[this.k++];
      n = { t: "bin", op: "^", i: base, d: this.unario(), pos: t.pos };
    }
    this.salir();
    return n;
  }

  /** primario := numero | llamada | variable | "(" expresion ")" */
  private primario(): Nodo {
    const t = this.actual;
    if (!t)
      throw new FormulaError("Sintaxis incorrecta: la fórmula termina de forma inesperada", this.finPos());

    if (t.tipo === "num") {
      this.k++;
      return { t: "num", v: t.v as number };
    }

    if (t.tipo === "(") {
      this.entrar();
      this.k++;
      const e = this.expresion();
      this.esperar(")", "Falta cerrar el paréntesis");
      this.salir();
      return e;
    }

    if (t.tipo === "ident") {
      this.k++;
      // Un identificador seguido de "(" es una llamada; si no, es una variable.
      if (this.esTipo("(")) {
        this.entrar();
        this.k++;
        const args: Nodo[] = [];
        if (!this.esTipo(")")) {
          for (;;) {
            if (args.length >= MAX_ARGUMENTOS)
              throw new FormulaError(
                `Demasiados argumentos en ${t.s}() (máx. ${MAX_ARGUMENTOS})`,
                t.pos,
              );
            args.push(this.expresion());
            if (this.esTipo(",")) {
              this.k++;
              continue;
            }
            break;
          }
        }
        this.esperar(")", `Falta cerrar el paréntesis de ${t.s}()`);
        this.salir();
        return { t: "call", nombre: t.s, args, pos: t.pos };
      }
      return { t: "var", nombre: t.s, pos: t.pos };
    }

    throw new FormulaError(`Sintaxis incorrecta: '${t.s}' no se esperaba aquí (posición ${t.pos + 1})`, t.pos);
  }

  private esperar(tipo: TipoToken, msg: string): void {
    if (this.actual?.tipo !== tipo) throw new FormulaError(msg, this.actual?.pos ?? this.finPos());
    this.k++;
  }
}

/* ===================== FUNCIONES (lista blanca cerrada) ===================== */
type Valor = number | number[];

interface DefFuncion {
  /** Aridad exacta; `null` = variádica (≥1). */
  aridad: number | null;
  /** Si es variádica, sus argumentos pueden ser vectores y se aplanan. */
  fn: (a: number[]) => number;
}

const FUNCIONES: ReadonlyMap<string, DefFuncion> = new Map<string, DefFuncion>([
  ["PROMEDIO", { aridad: null, fn: (a) => a.reduce((x, y) => x + y, 0) / a.length }],
  ["SUMA", { aridad: null, fn: (a) => a.reduce((x, y) => x + y, 0) }],
  ["MIN", { aridad: null, fn: (a) => Math.min(...a) }],
  ["MAX", { aridad: null, fn: (a) => Math.max(...a) }],
  ["ABS", { aridad: 1, fn: (a) => Math.abs(a[0]) }],
  ["RAIZ", { aridad: 1, fn: (a) => Math.sqrt(a[0]) }],
  ["LOG", { aridad: 1, fn: (a) => Math.log10(a[0]) }],
  ["LN", { aridad: 1, fn: (a) => Math.log(a[0]) }],
  ["POTENCIA", { aridad: 2, fn: (a) => Math.pow(a[0], a[1]) }],
  ["REDONDEAR", { aridad: 2, fn: (a) => redondear(a[0], a[1]) }],
]);

/** Nombres de función reservados (no pueden usarse como nombre de variable extra). */
export const NOMBRES_FUNCION: readonly string[] = [...FUNCIONES.keys()];

/**
 * Redondeo a `n` decimales, media-arriba, estable frente al error binario.
 * `Math.round(1.005*100)/100` da 1 (porque 1.005 es en binario 1.00499…); la
 * vía exponencial da 1,01, que es lo que espera un analista y lo que hace
 * Excel. En un LIMS acreditado el redondeo del resultado informado importa.
 */
function redondear(x: number, n: number): number {
  if (!Number.isInteger(n)) throw new FormulaError("REDONDEAR: el nº de decimales debe ser entero");
  if (n < 0 || n > 15) throw new FormulaError("REDONDEAR: el nº de decimales debe estar entre 0 y 15");
  if (!Number.isFinite(x)) return x;
  const s = Math.sign(x);
  const [m, e = "0"] = Math.abs(x).toExponential().split("e");
  const r = Math.round(Number(`${m}e${Number(e) + n}`));
  const [m2, e2 = "0"] = `${r}`.split("e");
  return s * Number(`${m2}e${Number(e2) - n}`);
}

/* ===================== EVALUADOR ===================== */

/**
 * Resuelve variables contra un Map (no un objeto): así `constructor`,
 * `__proto__`, `toString`… no resuelven a nada heredado del prototipo de
 * Object. Se indexa el nombre tal cual y en MAYÚSCULAS, para que una fórmula
 * escrita `promedio*2` funcione con el contexto `{PROMEDIO: …}`. La clave
 * exacta siempre gana sobre la insensible a mayúsculas.
 */
function construirAmbito(ctx: Record<string, Valor>): Map<string, Valor> {
  const m = new Map<string, Valor>();
  const upper = new Map<string, Valor>();
  for (const [k, v] of Object.entries(ctx ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k))
      throw new FormulaError(`Nombre de variable no válido en el contexto: '${k}'`);
    validarValor(k, v);
    m.set(k, v);
    const u = k.toUpperCase();
    // Si dos claves colisionan al pasar a mayúsculas (masa/MASA), no se ofrece
    // el alias: sería ambiguo. Las claves exactas siguen funcionando.
    upper.set(u, upper.has(u) && upper.get(u) !== v ? (AMBIGUO as unknown as Valor) : v);
  }
  for (const [u, v] of upper) if (!m.has(u)) m.set(u, v);
  return m;
}
/** Centinela para alias en mayúsculas ambiguos. */
const AMBIGUO = Symbol("ambiguo");

function validarValor(k: string, v: Valor): void {
  const malo = (x: unknown) => typeof x !== "number" || !Number.isFinite(x);
  if (Array.isArray(v)) {
    if (v.length > MAX_ARGUMENTOS)
      throw new FormulaError(`El vector '${k}' tiene demasiados elementos (máx. ${MAX_ARGUMENTOS})`);
    if (v.some(malo)) throw new FormulaError(`El vector '${k}' contiene valores no numéricos`);
  } else if (malo(v)) {
    throw new FormulaError(`La variable '${k}' no es un número finito`);
  }
}

/** Exige que un valor sea escalar. Los vectores sólo valen dentro de PROMEDIO/SUMA/MIN/MAX. */
function escalar(v: Valor, contexto: string): number {
  if (Array.isArray(v))
    throw new FormulaError(
      `'${contexto}' es un vector: sólo puede usarse dentro de PROMEDIO/SUMA/MIN/MAX`,
    );
  return v;
}

function evaluarNodo(n: Nodo, ambito: Map<string, Valor>): Valor {
  switch (n.t) {
    case "num":
      return n.v;

    case "var": {
      if (!ambito.has(n.nombre))
        throw new FormulaError(
          `Variable no definida: '${n.nombre}'. Disponibles: ${[...ambito.keys()].sort().join(", ") || "(ninguna)"}`,
          n.pos,
        );
      const v = ambito.get(n.nombre) as Valor;
      if ((v as unknown) === AMBIGUO)
        throw new FormulaError(
          `La variable '${n.nombre}' es ambigua (varias definiciones difieren sólo en mayúsculas)`,
          n.pos,
        );
      return v;
    }

    case "un": {
      const v = escalar(evaluarNodo(n.e, ambito), "operando");
      return n.op === "-" ? -v : v;
    }

    case "bin": {
      const a = escalar(evaluarNodo(n.i, ambito), "operando izquierdo");
      const b = escalar(evaluarNodo(n.d, ambito), "operando derecho");
      let r: number;
      switch (n.op) {
        case "+": r = a + b; break;
        case "-": r = a - b; break;
        case "*": r = a * b; break;
        case "/":
          // División por cero: se corta aquí. JS daría Infinity/NaN en silencio,
          // y un resultado analítico "Infinity" persistido sería inaceptable.
          if (b === 0) throw new FormulaError("División por cero", n.pos);
          r = a / b;
          break;
        case "^": r = Math.pow(a, b); break;
      }
      return comprobarFinito(r, `la operación '${n.op}'`, n.pos);
    }

    case "call": {
      const nombre = n.nombre.toUpperCase();
      const def = FUNCIONES.get(nombre);
      if (!def)
        throw new FormulaError(
          `Función desconocida: '${n.nombre}'. Disponibles: ${NOMBRES_FUNCION.join(", ")}`,
          n.pos,
        );

      let args: number[];
      if (def.aridad === null) {
        // Variádica: los vectores se aplanan (PROMEDIO(REPLICAS, RN4)).
        args = [];
        for (const a of n.args) {
          const v = evaluarNodo(a, ambito);
          if (Array.isArray(v)) args.push(...v);
          else args.push(v);
        }
        if (args.length === 0)
          throw new FormulaError(`${nombre}() necesita al menos un valor`, n.pos);
        if (args.length > MAX_ARGUMENTOS)
          throw new FormulaError(`${nombre}(): demasiados valores (máx. ${MAX_ARGUMENTOS})`, n.pos);
      } else {
        if (n.args.length !== def.aridad)
          throw new FormulaError(
            `${nombre}() espera ${def.aridad} argumento(s) y recibió ${n.args.length}`,
            n.pos,
          );
        args = n.args.map((a, idx) => escalar(evaluarNodo(a, ambito), `argumento ${idx + 1} de ${nombre}`));
      }

      let r: number;
      try {
        r = def.fn(args);
      } catch (e) {
        if (e instanceof FormulaError) throw e;
        throw new FormulaError(`Error al evaluar ${nombre}(): ${(e as Error).message}`, n.pos);
      }
      // RAIZ(-1) → NaN, LN(0) → -Infinity: se rechazan en vez de persistirse.
      return comprobarFinito(r, `${nombre}()`, n.pos);
    }
  }
}

function comprobarFinito(r: number, que: string, pos?: number): number {
  if (Number.isNaN(r)) throw new FormulaError(`El resultado de ${que} no está definido`, pos);
  if (!Number.isFinite(r)) throw new FormulaError(`El resultado de ${que} es infinito`, pos);
  return r;
}

/* ===================== API PÚBLICA ===================== */

function preparar(expr: string): Nodo {
  if (typeof expr !== "string") throw new FormulaError("La fórmula debe ser texto");
  if (expr.trim() === "") throw new FormulaError("La fórmula está vacía");
  if (expr.length > MAX_LONGITUD)
    throw new FormulaError(`Fórmula demasiado larga (${expr.length}; máx. ${MAX_LONGITUD} caracteres)`);
  return new Parser(tokenizar(expr)).parse();
}

/**
 * Evalúa `expr` con el contexto `ctx` y devuelve un número finito.
 * Lanza `FormulaError` (y sólo `FormulaError`) ante cualquier problema.
 *
 *   evaluarFormula("(RN1+RN2)/2 * factor", { RN1: 10, RN2: 12, factor: 1.5 }) // 16.5
 *   evaluarFormula("REDONDEAR(PROMEDIO(REPLICAS), 2)", { REPLICAS: [1, 2, 2] }) // 1.67
 */
export function evaluarFormula(expr: string, ctx: Record<string, number | number[]> = {}): number {
  const ast = preparar(expr);
  const valor = evaluarNodo(ast, construirAmbito(ctx));
  return comprobarFinito(escalar(valor, "el resultado"), "la fórmula");
}

/**
 * Valida SINTAXIS (y, si se le pasan, los nombres de variable disponibles) sin
 * evaluar. Es lo que consume `POST /analitos/validar-formula` para que el
 * catálogo no guarde una fórmula rota que sólo explotaría meses después, en
 * plena captura.
 *
 * @param variables Si se indica, comprueba además que toda variable usada esté
 *                  en la lista (comparación insensible a mayúsculas).
 */
export function validarFormula(
  expr: string,
  variables?: readonly string[],
): { ok: boolean; error?: string; variables?: string[]; funciones?: string[] } {
  try {
    const ast = preparar(expr);
    const usadas = new Set<string>();
    const fns = new Set<string>();
    recorrer(ast, usadas, fns);
    // Una función fuera de la lista blanca revienta al evaluar; validar debe
    // decirlo AHORA y no dar un OK falso al catálogo (p.ej. `require(0)`).
    const desconocidas = [...fns].filter((f) => !FUNCIONES.has(f.toUpperCase()));
    if (desconocidas.length)
      return {
        ok: false,
        error: `Función no permitida: ${desconocidas.map((f) => `'${f}'`).join(", ")}. Disponibles: ${[...FUNCIONES.keys()].join(", ")}`,
      };
    if (variables) {
      const disponibles = new Set(variables.map((v) => v.toUpperCase()));
      const faltan = [...usadas].filter((v) => !disponibles.has(v.toUpperCase()));
      if (faltan.length)
        return { ok: false, error: `Variable no definida: ${faltan.map((f) => `'${f}'`).join(", ")}` };
    }
    return { ok: true, variables: [...usadas], funciones: [...fns] };
  } catch (e) {
    if (e instanceof FormulaError) return { ok: false, error: e.message };
    // Red de seguridad: nada debería llegar aquí, pero validar() no debe tirar nunca.
    return { ok: false, error: `Fórmula no válida: ${(e as Error).message}` };
  }
}

/** Variables que usa la fórmula (útil para el editor del catálogo). [] si no parsea. */
export function variablesDe(expr: string): string[] {
  return validarFormula(expr).variables ?? [];
}

function recorrer(n: Nodo, vars: Set<string>, fns: Set<string>): void {
  switch (n.t) {
    case "num":
      return;
    case "var":
      vars.add(n.nombre);
      return;
    case "un":
      return recorrer(n.e, vars, fns);
    case "bin":
      recorrer(n.i, vars, fns);
      recorrer(n.d, vars, fns);
      return;
    case "call":
      fns.add(n.nombre.toUpperCase());
      for (const a of n.args) recorrer(a, vars, fns);
      return;
  }
}
