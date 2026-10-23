import * as fs from "fs";
import * as path from "path";
import {
  comprobarFormula,
  decodificarCp1252,
  destinoCentro,
  enlazar,
  esErrorExcel,
  leerCsv,
  leerListaPrecios,
  monto,
  nombreBase,
  normalizarCodigo,
  normalizarNombre,
  separarDuplicados,
  type EnsayoCatalogo,
  type FilaLista,
} from "./lista-precios-csv";

// El CSV del IDIC NO se versiona (.gitignore: datos del cliente). Se lee de LISTA_PRECIOS_CSV
// o de la copia local junto al generador; sin el fichero, esas pruebas se omiten.
const CSV_REAL = process.env.LISTA_PRECIOS_CSV || path.resolve(__dirname, "../../../../scripts/datos/lista-precios-2026/LISTA_DE_PRECIO_2026_COSTOS_ENSAYOS.csv");
const conCsv = fs.existsSync(CSV_REAL) ? describe : describe.skip;
const ENC = "CODIGO;NOMBR ENSAYO;CENTRO DE COSTOS;CD;CI;CT;RECARGO;NETO;IVA;PRECIO\r\n";

describe("Lector CSV de la lista de precios", () => {
  it("respeta comillas con «;» y saltos de línea dentro del nombre (no desplaza columnas)", () => {
    const t = ENC + 'EN1;"Celda; anillo\r\nde carga ""x""";LCNF;$1;$2;$3;$4;$5;$6;$7\r\nEN2;Simple;LPN;$10;$2;$12;$4;$16;$3;$19\r\n';
    const filas = leerCsv(t);
    expect(filas).toHaveLength(3);
    expect(filas[1]).toHaveLength(10);
    expect(filas[1][1]).toBe('Celda; anillo\r\nde carga "x"');
    expect(filas[2][0]).toBe("EN2");
  });

  it("lee importes «$1.186.651» y códigos con espacios", () => {
    expect(monto("$1.186.651")).toBe(1_186_651);
    expect(monto("$614")).toBe(614);
    expect(monto("")).toBeNull();
    expect(monto("$abc")).toBeNull();
    expect(normalizarCodigo(" EN 1245 ")).toBe("EN1245");
    expect(esErrorExcel("#N/D")).toBe(true);
    expect(esErrorExcel("LPN")).toBe(false);
  });

  it("una fila con columnas de menos queda con su error (no se descarta en silencio)", () => {
    const { filas } = leerListaPrecios(ENC + "EN9;Corta;LPN;$1\r\n");
    expect(filas[0].errores[0]).toMatch(/4 columnas/);
  });

  it("#N/D en nombre o centro se lee como dato ausente", () => {
    const { filas } = leerListaPrecios(ENC + "EN1327;#N/D;#N/D;$30.228;$6.046;$36.274;$10.882;$47.156;$8.960;$56.116\r\n");
    expect(filas[0].nombre).toBeNull();
    expect(filas[0].centro).toBeNull();
    expect(filas[0].centroOriginal).toBe("#N/D");
    expect(destinoCentro(filas[0].centro).confianza).toBe("sin_centro");
  });
});

conCsv("CSV real del IDIC (22-10-2026)", () => {
  const { encabezado, filas } = fs.existsSync(CSV_REAL) ? leerListaPrecios(decodificarCp1252(fs.readFileSync(CSV_REAL))) : { encabezado: [], filas: [] as FilaLista[] };

  it("619 filas de 10 columnas, todas legibles", () => {
    expect(encabezado[0]).toBe("CODIGO");
    expect(filas).toHaveLength(619);
    expect(filas.filter((f) => f.errores.length)).toEqual([]);
  });

  it("las 619 filas cuadran con la fórmula (CI 20 %, CT, recargo 30 %, neto, IVA 19 %) y salen exactas del precio particular", () => {
    const c = filas.map((f) => comprobarFormula(f));
    expect(c.filter((x) => !x.cuadra)).toHaveLength(0);
    expect(c.filter((x) => !x.exactaDesdePrecio)).toHaveLength(0);
    // Desde el costo directo entero que se ve, el resto difiere a lo más en 1 peso.
    expect(c.every((x) => Object.values(x.difDesdeCostoDirecto).every((d) => Math.abs(d!) <= 1))).toBe(true);
  });

  it("casos concretos: EN1214 y EN412 (nombre con tilde, Windows-1252)", () => {
    const en1214 = filas.find((f) => f.codigo === "EN1214")!;
    expect(en1214.importes.neto).toBe(514_519);
    expect(en1214.importes.precioIvaIncluido).toBe(612_278);
    const en412 = filas.find((f) => f.codigo === "EN412")!;
    expect(en412.nombre).toContain("Método");
    expect([en412.importes.neto, en412.importes.precioIvaIncluido]).toEqual([59_518, 70_827]);
  });

  it("EN1113 (nombre entre comillas con «;») no desplaza las columnas", () => {
    const f = filas.find((x) => x.codigo === "EN1113")!;
    expect(f.nombre).toContain("Calibres escalonados; láminas");
    expect(f.centro).toBe("LMT");
    expect(f.importes.precioIvaIncluido).toBe(9_429);
  });

  it("un único código repetido (EN2/026): se carga la primera aparición", () => {
    const { unicas, duplicadas } = separarDuplicados(filas);
    expect(unicas).toHaveLength(618);
    expect(duplicadas.map((d) => d.codigo)).toEqual(["EN2/026"]);
  });
});

describe("Enlace con el catálogo", () => {
  const fila = (n: number, codigo: string, nombre: string | null, centro: string): FilaLista => ({
    n,
    codigoOriginal: codigo,
    codigo,
    nombre,
    centro,
    centroOriginal: centro,
    importes: { costoDirecto: 1, costoIndirecto: 0, costoTotal: 1, recargo: 0, neto: 2, iva: 0, precioIvaIncluido: 2 },
    errores: [],
  });
  const cat: EnsayoCatalogo[] = [
    { codigo: "EN1032", nombre: "Celdas", familia: null, agrupado: "LNF" },
    { codigo: "64", nombre: "Humedad", familia: "7005", agrupado: null },
    { codigo: "957", nombre: "Microdureza Vickers", familia: "4003", agrupado: null },
    { codigo: "290", nombre: "Materia grasa", familia: "7009", agrupado: null },
    { codigo: "500", nombre: "Densidad", familia: "7005", agrupado: null },
    { codigo: "501", nombre: "Densidad", familia: "7005", agrupado: null },
    { codigo: "700", nombre: "Humedad", familia: "7004", agrupado: null },
  ];

  it("normaliza nombres y quita el calificador de método o norma", () => {
    expect(normalizarNombre("Color ( Visual )")).toBe(normalizarNombre("Color VISUAL"));
    expect(nombreBase("Humedad NORMA  BPCH")).toBe("humedad");
    expect(nombreBase("Microdureza Vickers. Método LEM-PG01-P01-ITMT12.")).toBe("microdureza vickers");
    expect(nombreBase("Nitrato (Método Potenciométrico) SAL")).toBe("nitrato");
    expect(nombreBase("Metodología de algo")).toBeNull();
    expect(nombreBase("Ensayo sin calificador")).toBeNull();
  });

  it("por código, por nombre del laboratorio y sin el método; solo con un candidato", () => {
    const e = enlazar(
      [
        fila(1, "EN1032", "Otra descripción", "LCNF"),
        fila(2, "EN374", "Humedad NORMA BPCH", "LME"),
        fila(3, "EN412", "Microdureza Vickers. Método LEM-PG01-P01-ITMT12.", "LEM"),
        fila(4, "EN369", "Densidad NORMA BPCH", "LME"),
        fila(5, "EN999", "Humedad", "LTX"),
      ],
      cat,
    );
    expect(e.get(1)).toMatchObject({ catalogo: "EN1032", tipo: "codigo" });
    // Mismo nombre en otro laboratorio (700 es de LPN): no cuenta.
    expect(e.get(2)).toMatchObject({ catalogo: "64", tipo: "nombre_base" });
    expect(e.get(3)).toMatchObject({ catalogo: "957", tipo: "nombre_base" });
    expect(e.get(4)?.catalogo).toBeNull();
    expect(e.get(4)?.motivo).toMatch(/2 ensayos/);
    expect(e.get(5)?.catalogo).toBeNull();
  });

  it("un ensayo del catálogo reclamado por dos filas no se enlaza con ninguna (ambiguo)", () => {
    const e = enlazar(
      [fila(1, "EN310", "Materia grasa. Método: Soxhlet", "CDOSECALI"), fila(2, "EN311", "Materia grasa. Método: Hidrólisis", "CDOSECALI")],
      cat,
    );
    expect(e.get(1)?.catalogo).toBeNull();
    expect(e.get(2)?.motivo).toMatch(/ambiguo/);
  });

  it("sin nombre (#N/D) o sin laboratorio en el catálogo: sin enlace, con motivo", () => {
    const e = enlazar([fila(1, "EN1327", null, "#N/D"), fila(2, "EN801", "Toma de muestra", "DCO")], cat);
    expect(e.get(1)?.motivo).toMatch(/#N\/D/);
    expect(e.get(2)?.motivo).toMatch(/no corresponde a un laboratorio/);
  });

  it("centros: exactos, alias por confirmar y los que no existen en el LIMS", () => {
    expect(destinoCentro("LCNF")).toMatchObject({ centroCosto: "LNF-001", unidad: "LNF", confianza: "exacta" });
    expect(destinoCentro("LVM").confianza).toBe("alias_por_confirmar");
    expect(destinoCentro("CDOSECALI")).toMatchObject({ centroCosto: null, unidad: "SAL", confianza: "sin_centro" });
    expect(destinoCentro("XYZ").nota).toMatch(/desconocido/);
  });
});
