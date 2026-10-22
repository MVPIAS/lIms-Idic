/**
 * Certificado de N hojas (respuesta del LMT del 21-10-2026): tablas propias de cada IT
 * con los casos reales de sus libros, hojas declaradas = hojas del PDF real, firmas por
 * hoja, leyenda legal en la hoja 1, observaciones y «Fin» en la última, acreditación
 * por certificado y «reemplaza al» a mano. Sin «cumple».
 */
import { MOTORES, MOTORES_1510 } from "../motores";
import { CASOS_REFERENCIA } from "../motores/paridad";
import casos1510 from "../motores/casos-1510.json";
import { armarCertificado, tablasResultados, TEXTOS_LEGALES, type ContextoCertificado } from "../metrologia.certificado";
import type { Sello } from "../../plantilla-render/plantilla-defecto";
import { generarPdf } from "../../plantilla-render/pdf.renderer";

const firma = (nombre: string, rol: string) => ({ accion: "FIRMA", rol, nombre, cargo: rol, pendiente: true });
const CTX: ContextoCertificado = {
  departamento: "Departamento Sistemas de Armas",
  metrologo: firma("A. B. C.", "Metrólogo"), jefeLab: firma("R. M. M.", "Jefe LMT"), jefeDepto: firma("P. R. E.", "Jefe de Departamento"),
};
const SELLO: Sello = { numero: "BORRADOR", codigoVerificacion: "SIN EMITIR", hash: "0".repeat(64), fecha: "21-10-2026", urlVerificacion: "https://verificar", borrador: true };
const PATRON = (n: number) => ({ nombre: `Patrón ${n} con un nombre largo como en el Anexo 02`, marca: "Mettler Toledo", modelo: "AG285", serie: `11202019${n}`, clase: "F1",
  n_certificado: `M-39${n}`, vence: "2027-05-19", emisor: "IDIC", trazabilidad: "IDIC LC 001" });

function calDe(it: string, datos: any, extra: any = {}) {
  const m = (MOTORES as any)[it] ?? (MOTORES_1510 as any)[it];
  const resultado = m.calcular(datos, {});
  const resumen = m.resumen(resultado, datos);
  return {
    codigo: "CAL-2026-0001", proceso: it, motor: it, resultado, resumen, datos, acreditacion: "LC 001", magnitud_nombre: "Masa", unidad: m.unidad,
    intervalo_meses: 12, metodo: `LMT-PG01-P01-${it}`, revision: "Rev. 00", norma: "Norma base", fecha_calibracion: "2026-07-24",
    instrumento: {
      item: "Instrumento de prueba con descripción larga", marca: "Marca", modelo: "Modelo", serie: "S-1", idEspecial: "ID-1", cap: "200 g", res: "0,1", rango: "(0 a 200)",
      cliente: "IDIC, Departamento Químico", solicitante: "Laboratorio Textil", contacto: "Anexo 7765", direccion: "Avenida Pedro Montt Nº 2136, Santiago, Santiago.",
      ot: "82910", fechaOt: "2026-07-20", fechaRecepcion: "2026-07-20", lugar: "instalaciones", desviacion: "No",
    },
    ambiente: { temp: "20,1", tempU: "0,6", hum: "50", humU: "2,5", pres: "954,6", presU: "0,2" },
    patrones: [PATRON(1), PATRON(2), PATRON(3)],
    ...extra,
  };
}
const paginasPdf = (buf: Buffer) => (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
async function pdfDe(html: string) {
  return generarPdf(html, SELLO, "Certificado");
}

describe("Certificado de calibración · tablas de la hoja «Certificado» de cada libro (obs. 4)", () => {
  const caso = (c: string) => CASOS_REFERENCIA.find((x) => x.caso === c)!;
  const filas = (c: string) => tablasResultados(calDe(caso(c).it, caso(c).datos), true).bloques.flatMap((b) => (b.tipo === "tabla" ? b.filas : []));

  test("ITT02 · T-2890: indicación del calibrando, del patrón, error e incertidumbre (30,10 · 31,35 · −1,25 · 2,6)", () => {
    const f = filas("T-2890");
    expect(f[0].slice(0, 3)).toEqual(["30,10", "31,35", "-1,25"]);
    expect(f[0][3]).toBe("2,6"); // U = 2,516 con dos cifras significativas hacia arriba
  });
  test("ITV02 · V-5881: nominal, indicación patrón (250,1), instrumento y error", () => {
    const f = filas("V-5881");
    expect(f[0][0]).toBe("250");
    expect(f[0][2]).toBe("250");
    expect(Number(f[0][1].replace(",", "."))).toBeCloseTo(250.1, 1);
  });
  test("ITP02 · P-808: tabla de indicaciones, resultados en bar y en SI (MPa)", () => {
    const b = tablasResultados(calDe("ITP02", caso("P-808").datos, { unidad: "bar" }), true).bloques;
    const titulos = b.map((x: any) => x.titulo);
    expect(titulos).toEqual(["Tabla de resultados de calibración", "Resultados de la calibración", "Resultados en SI (MPa)"]);
  });
  test("ITF01 · F-1556: series del patrón, parámetros NCh 2598/1 con clase y tabla en N", () => {
    const b = tablasResultados(calDe("ITF01", caso("F-1556").datos), true).bloques as any[];
    expect(b[1].cabecera).toContain("Clase de exactitud");
    expect(b[2].titulo).toBe("Resultados en SI (N)");
    expect(b[0].filas[0][0]).toBe("20");
  });
  test("ITM02 · M-3889: tabla principal y tabla de excentricidad", () => {
    const b = tablasResultados(calDe("ITM02", caso("M-3889").datos), true).bloques as any[];
    expect(b.map((x) => x.titulo ?? x.tipo)).toEqual(["tabla", "Valores de excentricidad", "fijo"]);
  });
  test("ITM01 · M-3859: masa convencional «500 g + …», EMP de la clase e identificación", () => {
    const f = filas("M-3859");
    expect(f[0][1]).toMatch(/^500 g [+−] /);
    expect(f[0][4]).toBe("ID-1");
  });
  test("ningún certificado de los 16 casos reales dice «cumple»", () => {
    for (const c of CASOS_REFERENCIA) {
      const h = armarCertificado(calDe(c.it, c.datos), CTX).html;
      // «cumple con las exigencias de la norma NCh-ISO 17025» es la leyenda legal, no un veredicto.
      expect(h).not.toMatch(/cumple(?! con las exigencias)/i);
    }
  });
});

describe("Certificado de N hojas: hojas declaradas = hojas del PDF real (obs. 6, 9, 12)", () => {
  jest.setTimeout(120000);
  test.each(CASOS_REFERENCIA.map((c) => [c.caso, c.it]))("%s (%s)", async (nombre, it) => {
    const c = CASOS_REFERENCIA.find((x) => x.caso === nombre)!;
    const a = armarCertificado(calDe(it, c.datos), CTX);
    const pdf = await pdfDe(a.html);
    expect(paginasPdf(pdf)).toBe(a.hojas);
  });
  test.each([1, 8, 15, 22, 30, 45, 60, 90])("ITM02 con %i puntos", async (n) => {
    const c = CASOS_REFERENCIA.find((x) => x.caso === "M-3889")!;
    const cal = calDe("ITM02", c.datos);
    const base = cal.resultado.rows, pb = cal.resumen.puntos;
    cal.resultado = { ...cal.resultado, rows: Array.from({ length: n }, (_, i) => base[i % base.length]) };
    cal.resumen = { ...cal.resumen, puntos: Array.from({ length: n }, (_, i) => pb[i % pb.length]) };
    const a = armarCertificado(cal, { ...CTX, esquema: n > 40 ? { src: "data:image/png;base64,AAAA", ancho: 507, alto: 341, titulo: "Esquema" } : null });
    const pdf = await pdfDe(a.html);
    expect(paginasPdf(pdf)).toBe(a.hojas);
    expect(a.hojas).toBeGreaterThanOrEqual(2);
  });
  test("ITF01 con 40 puntos y observaciones largas: N hojas reales", async () => {
    const c = CASOS_REFERENCIA.find((x) => x.caso === "F-1556")!;
    const cal = calDe("ITF01", c.datos);
    cal.resultado = { ...cal.resultado, rows: [...cal.resultado.rows, ...cal.resultado.rows, ...cal.resultado.rows, ...cal.resultado.rows] };
    cal.resumen = { ...cal.resumen, puntos: [...cal.resumen.puntos, ...cal.resumen.puntos, ...cal.resumen.puntos, ...cal.resumen.puntos] };
    (cal as any).presentacion = { observaciones: Array.from({ length: 12 }, (_, i) => `Observación ${i + 1}: texto de una situación especial que ocupa casi una línea completa del certificado de calibración.`).join("\n") };
    const a = armarCertificado(cal, CTX);
    const pdf = await pdfDe(a.html);
    expect(paginasPdf(pdf)).toBe(a.hojas);
    expect(a.hojas).toBeGreaterThan(2);
  });
});

describe("Estructura de cada hoja", () => {
  const c = CASOS_REFERENCIA.find((x) => x.caso === "M-3889")!;
  const cal = calDe("ITM02", c.datos);
  const n = 70;
  cal.resultado = { ...cal.resultado, rows: Array.from({ length: n }, (_, i) => cal.resultado.rows[i % 11]) };
  cal.resumen = { ...cal.resumen, puntos: Array.from({ length: n }, (_, i) => cal.resumen.puntos[i % 11]) };
  const a = armarCertificado(cal, CTX);
  const hojas = a.html.split('<div class="salto-pagina"></div>');

  test("cada hoja lleva su «Página X de N», el número y la línea de acreditación", () => {
    expect(hojas.length).toBe(a.hojas);
    hojas.forEach((h, i) => {
      expect(h).toContain(`Página ${i + 1} de ${a.hojas}`);
      expect(h).toContain("CERTIFICADO DE CALIBRACIÓN N° BORRADOR CAL-2026-0001");
      expect(h).toContain("Laboratorio de Calibración Acreditado en la magnitud Masa");
    });
  });
  test("hoja 1: Jefe de Departamento + Jefe de Laboratorio y la leyenda legal; hojas 2..N: Jefe de Laboratorio + metrólogo", () => {
    expect(hojas[0]).toContain("Jefe Departamento Sistemas de Armas");
    expect(hojas[0]).toContain("Jefe Laboratorio de Metrología");
    for (const t of TEXTOS_LEGALES) expect(hojas[0]).toContain(t.replace(/"/g, "&quot;"));
    for (const h of hojas.slice(1)) {
      expect(h).toContain("Jefe Laboratorio de Metrología");
      expect(h).toContain("Metrólogo");
      expect(h).not.toContain("Jefe Departamento");
      expect(h).not.toContain(TEXTOS_LEGALES[0]);
    }
  });
  test("OBSERVACIONES y «Fin del certificado» solo en la última hoja; el intervalo ya no va en la hoja 1", () => {
    hojas.slice(0, -1).forEach((h) => { expect(h).not.toContain("Fin del certificado"); expect(h).not.toContain("<h2>Observaciones</h2>"); });
    expect(hojas.at(-1)).toContain("<h2>Observaciones</h2>");
    expect(hojas.at(-1)).toContain("Fin del certificado de calibración");
    expect(hojas[0]).not.toContain("Intervalo de calibración");
    expect(hojas.at(-1)).toContain("Intervalo de calibración: 12 meses.");
  });
});

describe("Presentación por certificado (obs. 1, 2, 3, 5)", () => {
  const c = CASOS_REFERENCIA.find((x) => x.caso === "M-3889")!;
  test("sin logo: la línea dice «Laboratorio de Calibración en la magnitud …», sin «Acreditación LC» ni «*»", () => {
    const cal = calDe("ITM02", c.datos, { presentacion: { acreditado: false, acreditadoMotivo: "Puntos fuera del alcance" } });
    cal.resumen.puntos = cal.resumen.puntos.map((p: any) => ({ ...p, fueraAlcance: true }));
    const h = armarCertificado(cal, { ...CTX, logo: { src: "data:image/png;base64,AAAA", ancho: 402, alto: 101 } }).html;
    expect(h).toContain("Laboratorio de Calibración en la magnitud Masa");
    expect(h).not.toContain("Acreditado en la magnitud");
    expect(h).not.toContain("Acreditación LC 001");
    expect(h).not.toContain("logo-acred");
    expect(h).not.toMatch(/ \*<\/td>/);
  });
  test("con logo configurado y proceso acreditado: el logo sale en cada hoja", () => {
    const a = armarCertificado(calDe("ITM02", c.datos), { ...CTX, logo: { src: "data:image/png;base64,AAAA", ancho: 402, alto: 101 } });
    expect(a.html.split("logo-acred").length - 1).toBe(a.hojas);
  });
  test("«ESTE CERTIFICADO REEMPLAZA AL CERTIFICADO N° …» a mano bajo la línea de acreditación; la reemisión del LIMS prevalece", () => {
    const cal = calDe("ITM02", c.datos, { presentacion: { reemplaza: "M-3001", reemplazaMotivo: "Certificado del sistema anterior" } });
    expect(armarCertificado(cal, CTX).html).toContain("ESTE CERTIFICADO REEMPLAZA AL CERTIFICADO N° M-3001.");
    expect(armarCertificado(cal, { ...CTX, reemplazaNumero: "M-3950" }).html).toContain("REEMPLAZA AL CERTIFICADO N° M-3950.");
  });
  test("observaciones editadas por el metrólogo reemplazan a las automáticas", () => {
    const cal = calDe("ITM02", c.datos, { presentacion: { observaciones: "Intervalo de calibración: 6 meses.\nLos puntos de calibración fueron requeridos por el cliente." } });
    const h = armarCertificado(cal, CTX).html;
    expect(h).toContain("<p>Los puntos de calibración fueron requeridos por el cliente.</p>");
    expect(h).not.toContain("Intervalo de calibración: 12 meses");
  });
  test("condiciones propias de la IT y rótulos del libro (ITP02: secuencia y medio; sin «Clase» del ítem)", () => {
    const h = armarCertificado(calDe("ITP02", CASOS_REFERENCIA.find((x) => x.caso === "P-808")!.datos, { presentacion: { campos: { secuencia: "Secuencia de calibración C", medio: "Alcohol" } } }), CTX).html;
    expect(h).toContain("Secuencia de calibración C");
    expect(h).toContain("Medio de transmisión de presión");
    expect(h).toContain("Presión atmosférica promedio");
    expect(h).toContain("Capacidad máxima");
    expect(h.split("Identificación del cliente")[0]).not.toContain("<th>Clase</th>");
  });
  test("masas (ITM03 · M-3947): «Valor nominal» y «Clase», sin resolución ni rango calibrado en la hoja 1", () => {
    const k = (casos1510 as any).casos.find((x: any) => x.it === "ITM03");
    const h = armarCertificado(calDe("ITM03", k.datos), CTX).html.split('<div class="salto-pagina">')[0];
    expect(h).toContain("<th>Valor nominal</th>");
    expect(h).toContain("<th>Clase</th>");
    expect(h).not.toContain("<th>Resolución</th>");
    expect(h).not.toContain("<th>Rango calibrado</th>");
  });
});

describe("Hoja 1 en el peor caso: todo cabe en una página", () => {
  jest.setTimeout(60000);
  test("ITP02 con 4 condiciones, 3 patrones de nombre largo, reemplazo, logo, dirección larga y firmas con grado", async () => {
    const c = CASOS_REFERENCIA.find((x) => x.caso === "P-808")!;
    const cal = calDe("ITP02", c.datos, {
      unidad: "bar",
      presentacion: { reemplaza: "P-8001", reemplazaMotivo: "Certificado anterior al LIMS", campos: { secuencia: "Secuencia de calibración C", medio: "Alcohol", posicion: "Vertical", lineaReferencia: "Fondo línea de conexión" } },
    });
    cal.instrumento.direccion = "Avenida Libertador Bernardo O'Higgins N° 1234, oficina 567, comuna de Santiago Centro, Región Metropolitana de Santiago, Chile";
    cal.instrumento.item = "Manómetro patrón digital de alta exactitud con transmisor incorporado y registro de datos";
    const g = (nombre: string, cargo: string) => ({ accion: "FIRMA", rol: cargo, nombre, grado: "Teniente Coronel", cargo, pendiente: false, fecha: "2026-10-21T12:00:00Z", via: "subrogante" });
    const a = armarCertificado(cal, { ...CTX, jefeDepto: g("J. C. R. C.", "Jefe Depto."), jefeLab: g("R. M. M.", "Jefe LMT"), logo: { src: "data:image/png;base64,AAAA", ancho: 402, alto: 101 } });
    const pdf = await pdfDe(a.html);
    expect(paginasPdf(pdf)).toBe(a.hojas);
  });
});

describe("Obs. 10 · T-2890 con el esquema del libro: cabe en 2 hojas como su certificado", () => {
  jest.setTimeout(60000);
  const zlib = require("zlib");
  const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const trozo = (t: string, d: Buffer) => { const l = Buffer.alloc(4), c = Buffer.alloc(4); l.writeUInt32BE(d.length); c.writeUInt32BE(crc32(Buffer.concat([Buffer.from(t), d]))); return Buffer.concat([l, Buffer.from(t), d, c]); };
  const png = (w: number, h: number) => {
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    const fila = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 200)]);
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), trozo("IHDR", ihdr), trozo("IDAT", zlib.deflateSync(Buffer.concat(Array(h).fill(fila)))), trozo("IEND", Buffer.alloc(0))]);
  };
  test("esquema 507 × 341 px, observaciones con las dimensiones de la cámara: hojas declaradas = hojas del PDF", async () => {
    const c = CASOS_REFERENCIA.find((x) => x.caso === "T-2890")!;
    const cal = calDe("ITT02", c.datos, { presentacion: { observaciones: "Dimensiones de la cámara 370 × 430 × 200 mm · Volumen 31,8 litros · Espacio de trabajo 9,7 litros.\nIntervalo de calibración: 12 meses.\nLa incertidumbre expandida ha sido estimada multiplicando la incertidumbre estándar por el factor de cobertura k = 2.\nEl valor del mensurando se encuentra dentro del intervalo indicado de valores con una probabilidad del 95 %.\n\"--\" = No aplica.\nLos puntos de calibración fueron requeridos por el cliente." } });
    const a = armarCertificado(cal, { ...CTX, esquema: { src: `data:image/png;base64,${png(507, 341).toString("base64")}`, ancho: 507, alto: 341, titulo: "Representación esquemática de la posición de los sensores" } });
    const pdf = await pdfDe(a.html);
    expect(paginasPdf(pdf)).toBe(a.hojas);
    expect(a.hojas).toBe(2);
  });
});
