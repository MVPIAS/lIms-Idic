import {
  acreditacionEfectiva, avisosPresentacion, leerPresentacion, lineaAcreditacion, observacionesAutomaticas, observacionesImpresas,
  PRESENTACION_VACIA, resumenCambios, validarPresentacion, type Presentacion,
} from "./presentacion";
import { esquemaEfectivo, imagenCert, revisarImagen, claveValida, clavesEsquema } from "./imagenes";
import { paginar, ALTO_FILA, type BloqueTabla } from "./paginacion";
import { clavesCampos, formatoDe } from "./formato-it";

const ctx = { proceso: "ITM02", acreditacionProceso: "LC 001", reemisionDe: null, numeroPropio: null };
const con = (p: Partial<Presentacion>) => ({ ...PRESENTACION_VACIA, ...p });

describe("Obs. 1 y 2 · logo y línea de acreditación por certificado", () => {
  test("por defecto, la acreditación del proceso", () => {
    expect(acreditacionEfectiva("LC 001", null)).toEqual({ acreditado: true, codigo: "LC 001", cambiada: false });
    expect(acreditacionEfectiva(null, null)).toEqual({ acreditado: false, codigo: null, cambiada: false });
  });
  test("se puede quitar el logo a un proceso acreditado; nunca ponerlo a uno que no lo está", () => {
    expect(acreditacionEfectiva("LC 001", false)).toEqual({ acreditado: false, codigo: null, cambiada: true });
    expect(acreditacionEfectiva(null, true).acreditado).toBe(false);
  });
  test("la línea cambia con el logo", () => {
    expect(lineaAcreditacion(true, "Masa")).toBe("Laboratorio de Calibración Acreditado en la magnitud Masa");
    expect(lineaAcreditacion(false, "Masa")).toBe("Laboratorio de Calibración en la magnitud Masa");
  });
  test("quitar el logo exige motivo; ponerlo en un proceso sin acreditación se rechaza", () => {
    expect(validarPresentacion(con({ acreditado: false }), ctx)).toEqual({ error: expect.stringMatching(/motivo/) });
    expect(validarPresentacion(con({ acreditado: false, acreditadoMotivo: "Todos los puntos fuera del alcance" }), ctx)).toHaveProperty("ok");
    expect(validarPresentacion(con({ acreditado: true, acreditadoMotivo: "x".repeat(10) }), { ...ctx, acreditacionProceso: null })).toEqual({ error: expect.stringMatching(/no tiene acreditación/) });
  });
  test("elegir lo mismo que el proceso vuelve a «según el proceso» y borra el motivo", () => {
    const r = validarPresentacion(con({ acreditado: true, acreditadoMotivo: "da igual" }), ctx) as any;
    expect(r.ok.acreditado).toBeNull();
    expect(r.ok.acreditadoMotivo).toBeNull();
  });
});

describe("Obs. 3 · «Este certificado reemplaza al certificado N° …» a mano", () => {
  test("exige un número con forma de certificado y un motivo", () => {
    expect(validarPresentacion(con({ reemplaza: "M-3001" }), ctx)).toEqual({ error: expect.stringMatching(/motivo/) });
    expect(validarPresentacion(con({ reemplaza: "hola mundo", reemplazaMotivo: "Certificado anterior" }), ctx)).toEqual({ error: expect.stringMatching(/no parece un número/) });
    const r = validarPresentacion(con({ reemplaza: "m - 3001", reemplazaMotivo: "Certificado del sistema anterior" }), ctx) as any;
    expect(r.ok.reemplaza).toBe("M-3001");
    expect((validarPresentacion(con({ reemplaza: "LCPNF-012.26", reemplazaMotivo: "Certificado anterior" }), ctx) as any).ok.reemplaza).toBe("LCPNF-012.26");
  });
  test("si ya reemplaza por reemisión del LIMS, no se indica otro; ni a sí mismo", () => {
    expect(validarPresentacion(con({ reemplaza: "M-3001", reemplazaMotivo: "Anterior" }), { ...ctx, reemisionDe: "M-3950" })).toEqual({ error: expect.stringMatching(/reemisión/) });
    expect(validarPresentacion(con({ reemplaza: "M-3960", reemplazaMotivo: "Anterior" }), { ...ctx, numeroPropio: "M-3960" })).toEqual({ error: expect.stringMatching(/sí mismo/) });
  });
  test("sin número, se borra el motivo", () => {
    expect((validarPresentacion(con({ reemplaza: "  ", reemplazaMotivo: "algo" }), ctx) as any).ok).toMatchObject({ reemplaza: null, reemplazaMotivo: null });
  });
});

describe("Obs. 5 · OBSERVACIONES editables con los textos automáticos como valor inicial", () => {
  const auto = observacionesAutomaticas({ intervaloMeses: 24, k: "2", fueraAlcance: true, acreditado: true });
  test("textos automáticos: intervalo, k, 95 %, «--» y «*» solo si el certificado sale acreditado", () => {
    expect(auto[0]).toBe("Intervalo de calibración: 24 meses.");
    expect(auto.some((l) => l.startsWith("*"))).toBe(true);
    expect(observacionesAutomaticas({ intervaloMeses: null, k: "2", fueraAlcance: true, acreditado: false }).some((l) => l.startsWith("*"))).toBe(false);
  });
  test("sin texto propio se imprimen las automáticas; con texto propio, una línea por observación", () => {
    expect(observacionesImpresas({ observaciones: null }, auto)).toEqual(auto);
    expect(observacionesImpresas({ observaciones: "Uno\n\n  Dos  " }, auto)).toEqual(["Uno", "Dos"]);
  });
  test("límites: no vacías, máximo 25 líneas", () => {
    expect(validarPresentacion(con({ observaciones: "  \n " }), ctx)).toEqual({ error: expect.stringMatching(/vacías/) });
    expect(validarPresentacion(con({ observaciones: Array(26).fill("x").join("\n") }), ctx)).toEqual({ error: expect.stringMatching(/25 líneas/) });
  });
  test("aviso si hay «*» y las observaciones editadas no lo explican", () => {
    expect(avisosPresentacion(con({ observaciones: "Intervalo 12 meses" }), { fueraAlcance: true, acreditado: true })).toHaveLength(1);
    expect(avisosPresentacion(con({ observaciones: "* fuera del alcance" }), { fueraAlcance: true, acreditado: true })).toHaveLength(0);
  });
});

describe("Obs. 4 · condiciones propias de cada IT", () => {
  test("presión: secuencia, medio, posición y línea de referencia; fuerza: tracción o compresión", () => {
    expect(clavesCampos("ITP02")).toEqual(["secuencia", "medio", "posicion", "lineaReferencia"]);
    expect(clavesCampos("ITF03")).toEqual(["sentido"]);
    expect(clavesCampos("ITV02g")).toEqual(["condicion"]);
    expect(formatoDe("ITM01").capacidad).toBe("Valor nominal");
    expect(formatoDe("ITT02").rango).toBe("Rango o puntos calibrados");
    expect(formatoDe("ITM02").presion).toBe(false);
  });
  test("un dato que no corresponde a la IT se rechaza; los vacíos se descartan", () => {
    expect(validarPresentacion(con({ campos: { medio: "Alcohol" } }), ctx)).toEqual({ error: expect.stringMatching(/no corresponde/) });
    expect((validarPresentacion(con({ campos: { medio: "Alcohol", secuencia: "  " } }), { ...ctx, proceso: "ITP02" }) as any).ok.campos).toEqual({ medio: "Alcohol" });
  });
});

describe("Obs. 10 · esquema de la calibración", () => {
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000001fb00000155080200000000000000", "hex");
  const b64 = png.toString("base64");
  test("solo PNG o JPEG por sus bytes", () => {
    expect(revisarImagen(Buffer.from("GIF89a....."))).toEqual({ error: expect.stringMatching(/PNG o JPEG/) });
    expect(revisarImagen(png)).toEqual({ mime: "image/png" });
    expect(imagenCert("image/png", b64)).toMatchObject({ ancho: 507, alto: 341 });
  });
  test("modo: el del proceso (por defecto), uno propio o ninguno", () => {
    const def = { clave: "esquema:ITT02", titulo: "Representación esquemática de la posición de los sensores", mime: "image/png", datos: b64 };
    expect(esquemaEfectivo({ esquemaModo: "defecto" }, { mime: null, datos: null }, def)).toMatchObject({ origen: "defecto", titulo: def.titulo });
    expect(esquemaEfectivo({ esquemaModo: "propio" }, { mime: "image/png", datos: b64 }, def)).toMatchObject({ origen: "propio" });
    expect(esquemaEfectivo({ esquemaModo: "ninguno" }, { mime: "image/png", datos: b64 }, def)).toBeNull();
    expect(esquemaEfectivo({ esquemaModo: "defecto" }, { mime: null, datos: null }, null)).toBeNull();
  });
  test("claves de configuración: logo y esquema por proceso (ITV02a usa el de ITV02 si no tiene)", () => {
    expect(claveValida("logo_acreditacion")).toBe(true);
    expect(claveValida("esquema:ITT02")).toBe(true);
    expect(claveValida("esquema:../x")).toBe(false);
    expect(clavesEsquema("ITV02a")).toEqual(["esquema:ITV02a", "esquema:ITV02"]);
  });
});

describe("Pregunta 12 · reparto en N hojas", () => {
  const tabla = (n: number): BloqueTabla => ({ tipo: "tabla", cabecera: ["A", "B"], filas: Array.from({ length: n }, (_, i) => [String(i), "x"]) });
  test("una tabla corta cabe en una hoja de resultados", () => {
    expect(paginar([tabla(10)], 100)).toHaveLength(1);
  });
  test("una tabla larga se parte por filas sin perder ninguna y sin dejar menos de 3 en una hoja", () => {
    const h = paginar([tabla(70)], 100);
    expect(h.length).toBeGreaterThan(1);
    const filas = h.flat().flatMap((b) => (b.tipo === "tabla" ? b.filas : []));
    expect(filas).toHaveLength(70);
    for (const hoja of h) for (const b of hoja) if (b.tipo === "tabla") expect(b.filas.length).toBeGreaterThanOrEqual(3);
  });
  test("una tabla corta que no cabe en lo que queda pasa entera a la hoja siguiente", () => {
    const h = paginar([tabla(22), tabla(10)], 50);
    expect(h[1][0].tipo === "tabla" && (h[1][0] as BloqueTabla).filas.length).toBe(10);
  });
  test("si las observaciones no caben, van a una hoja propia (la última)", () => {
    const filasLlenas = Math.floor((732 - 172 - 70 - 30) / ALTO_FILA) - 1;
    expect(paginar([tabla(filasLlenas)], 300).length).toBe(2);
  });
});

describe("Bitácora", () => {
  test("resume cada cambio con su motivo", () => {
    const antes = leerPresentacion({});
    const desp = { ...antes, acreditado: false, acreditadoMotivo: "Fuera del alcance", reemplaza: "M-1", reemplazaMotivo: "Anterior", observaciones: "x", esquemaModo: "ninguno" as const };
    const r = resumenCambios(antes, desp);
    expect(r).toContain("sin logo de acreditado (motivo: Fuera del alcance)");
    expect(r).toContain("Reemplaza al certificado N° M-1 (motivo: Anterior)");
    expect(r).toContain("Observaciones editadas");
    expect(r).toContain("Esquema: sin esquema");
    expect(resumenCambios(antes, antes)).toBe("");
  });
});
