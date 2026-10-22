/**
 * Formatos de certificado de la entrega R4 (tema T28), solo con libros reales con datos:
 * equivalencias en el SI de la hoja 1 (P-808, F-1556, PT-0090), «Certificado ASTM» de
 * ITT01 (T-2887) y certificado bilingüe del LNF (LCPNF-010.26, 6 hojas + anexo).
 */
import { MOTORES, MOTOR_LNF } from "../motores";
import { CASOS_REFERENCIA } from "../motores/paridad";
import { CASOS_LNF } from "../motores/paridad-lnf";
import { armarCertificado, tablasResultados, type ContextoCertificado } from "../metrologia.certificado";
import { conEquivalenciaSI, formatoSI } from "./equivalencias";
import { FACTOR_TONF } from "./lnf";
import { formatosDe, validarPresentacion, PRESENTACION_VACIA } from "./presentacion";
import type { Sello } from "../../plantilla-render/plantilla-defecto";
import { generarPdf } from "../../plantilla-render/pdf.renderer";

const firma = (nombre: string, rol: string) => ({ accion: "FIRMA", rol, nombre, cargo: rol, pendiente: true });
const CTX: ContextoCertificado = {
  departamento: "Departamento Sistemas de Armas",
  metrologo: firma("L. S. P.", "Metrólogo"), jefeLab: firma("J. C. V. P.", "Jefe LNF"), jefeDepto: firma("P. R. E.", "Jefe de Departamento"),
};
const SELLO: Sello = { numero: "BORRADOR", codigoVerificacion: "SIN EMITIR", hash: "0".repeat(64), fecha: "22-10-2026", urlVerificacion: "https://verificar", borrador: true };
const paginasPdf = (buf: Buffer) => (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;

describe("Equivalencias en el SI de la hoja 1 (libros P-808, F-1556 y PT-0090)", () => {
  it("presión en bar → MPa, como P-808", () => {
    expect(conEquivalenciaSI("4", "bar")).toBe("4 bar (0,4 MPa)");
    expect(conEquivalenciaSI("0,0005", "bar")).toBe("0,0005 bar (0,00005 MPa)");
    expect(conEquivalenciaSI("0,5 a 4", "bar")).toBe("0,5 a 4 bar (0,05 a 0,4 MPa)");
  });
  it("fuerza en kgf → N, como F-1556 (1961,33 N; 0,098 N; 196,13 a 1961,33 N)", () => {
    expect(conEquivalenciaSI("200", "kgf")).toBe("200 kgf (1961,33 N)");
    expect(conEquivalenciaSI("0.01", "kgf")).toBe("0.01 kgf (0,098 N)");
    expect(conEquivalenciaSI("20 a 200 kgf", "kgf")).toBe("20 a 200 kgf (196,13 a 1961,33 N)");
  });
  it("par en lbf·ft → N·m, como PT-0090 (135,58; 13,56 a 135,58)", () => {
    expect(conEquivalenciaSI("100", "lbf·ft")).toBe("100 lbf·ft (135,58 N·m)");
    expect(conEquivalenciaSI("(10 a 100)", "lbf·ft")).toBe("(10 a 100) lbf·ft (13,56 a 135,58 N·m)");
  });
  it("texto libre, otra unidad o unidad SI: se deja tal cual (null)", () => {
    expect(conEquivalenciaSI("4 MPa", "bar")).toBeNull();
    expect(conEquivalenciaSI("No tiene", "bar")).toBeNull();
    expect(conEquivalenciaSI("200 g", "g")).toBeNull();
    expect(conEquivalenciaSI("", "bar")).toBeNull();
    expect(formatoSI(0)).toBe("0");
  });
  it("la hoja 1 del certificado de P-808 lleva la línea de equivalencias en el SI", () => {
    const c = CASOS_REFERENCIA.find((x) => x.caso === "P-808")!;
    const r = MOTORES.ITP02.calcular(c.datos, {});
    const cal = {
      codigo: "CAL-2026-0009", proceso: "ITP02", motor: "ITP02", resultado: r, resumen: MOTORES.ITP02.resumen(r, c.datos), datos: c.datos, acreditacion: "LC 022",
      magnitud_nombre: "Presión", unidad: "bar", intervalo_meses: 12, metodo: "LMT-PG01-P01-ITP02", norma: "DKD-R 6-1", fecha_calibracion: "2026-01-26",
      instrumento: { item: "Manómetro digital", cap: "4", res: "0,0005", rango: "0,5 a 4", cliente: "IDIC", ot: "81792" }, ambiente: {}, patrones: [],
    };
    const html = armarCertificado(cal, CTX).html;
    expect(html).toContain("Equivalencia en el SI: capacidad máxima 4 bar = 0,4 MPa; resolución 0,0005 bar = 0,00005 MPa; rango calibrado 0,5 a 4 bar = 0,05 a 0,4 MPa.");
  });
});

describe("Certificado ASTM de ITT01 (hoja «Certificado ASTM» del libro T-2887)", () => {
  const c = CASOS_REFERENCIA.find((x) => x.caso === "T-2887")!;
  const r = MOTORES.ITT01.calcular(c.datos, {});
  const cal = (formato?: string) => ({ proceso: "ITT01", motor: "ITT01", resultado: r, resumen: MOTORES.ITT01.resumen(r, c.datos), datos: c.datos, unidad: "°C", presentacion: formato ? { formato } : {} });

  it("sin la columna «Temperatura promedio columna emergente»: calibrando, patrón, error e incertidumbre (101 · 101 · 0 · 1,0)", () => {
    const est = tablasResultados(cal(), true).bloques[0] as any;
    const astm = tablasResultados(cal("astm"), true).bloques[0] as any;
    expect(est.cabecera).toHaveLength(5);
    expect(astm.cabecera).toEqual(["Indicación del calibrando / °C", "Indicación del patrón / °C", "Error / °C", "Incertidumbre expandida / °C"]);
    expect(astm.filas[0]).toEqual(["101", "101", "0", "1,0"]);
    expect(est.filas[0][4]).toBe(astm.filas[0][3]); // la misma U que el formato estándar
  });
  it("solo ITT01 admite el formato ASTM; los demás procesos, solo el estándar", () => {
    expect(formatosDe("ITT01").map((f) => f.valor)).toEqual(["estandar", "astm"]);
    const ctx = (proceso: string) => ({ proceso, acreditacionProceso: null, reemisionDe: null, numeroPropio: null });
    expect("ok" in validarPresentacion({ ...PRESENTACION_VACIA, formato: "astm" }, ctx("ITT01"))).toBe(true);
    expect(validarPresentacion({ ...PRESENTACION_VACIA, formato: "astm" }, ctx("ITP02"))).toEqual({ error: expect.stringMatching(/no tiene el formato/) });
  });
});

describe("Certificado bilingüe del LNF (LCPNF-010.26: 6 hojas + anexo)", () => {
  const caso = CASOS_LNF[0];
  const r = MOTOR_LNF.calcular(caso.datos, {});
  const cal = {
    codigo: "CAL-2026-0100", numero_certificado: "LCPNF-010.26", proceso: "LCPNF-IT01", motor: "LCPNF-IT01", resultado: r, resumen: MOTOR_LNF.resumen(r, caso.datos), datos: caso.datos,
    acreditacion: null, metodo: "LCPNF-PG01-P01-IT01", norma: "ISO 376:2011", fecha_calibracion: "2026-03-23", emitido_at: "2026-04-08T15:00:00Z", intervalo_meses: 24,
    instrumento: { item: "Transductor de fuerza", marca: "HBM", modelo: "U15", serie: "101722B", idEspecial: "No tiene", cap: "2500 kN", cliente: "IDIC, Departamento Sistemas de Armas", ot: "S/O", solicitante: "Laboratorio Nacional de Fuerza", direccion: "Avda. Pedro Montt Nº 2136, Santiago" },
    instrumento_accesorios: [{ tipo: "Amplificador", marca: "HBM", modelo: "MGC plus", serie: "801143406/1" }, { tipo: "Cable", detalle: "3,1 m" }, { tipo: "Barra de tracción superior" }],
    patrones: [{ nombre: "STFR MOREHOUSE Nº 7391 3000 kN", marca: "Hottinger Baldwin Messtechnik", modelo: "KD/3MN", serie: "034140036", n_certificado: "12491 PTB 25", vence: "2027-11-29", trazabilidad: "PTB" }],
  };
  const doc = armarCertificado(cal, CTX);

  it("declara 6 hojas más el anexo y lleva los datos de la portada y las firmas del LNF", () => {
    expect(doc.hojas).toBe(7);
    for (const t of ["CERTIFICADO DE CALIBRACIÓN N° LCPNF-010.26", "Calibration certificate".toUpperCase(), "Transductor de fuerza", "101722B", "HBM", "U15",
      "Jefe del Laboratorio Nacional de Fuerza", "Encargado de la calibración", "Página 6 de 6", "Anexo · Página 1 de 1", "Fin del certificado de calibración"])
      expect(doc.html.toUpperCase()).toContain(t.toUpperCase());
  });
  it("hoja 2: amplificador y cable de la recepción, señal de cero 0,01915 mV/V, T media y rango (250 a 2500) kN", () => {
    expect(doc.html).toContain("MGC plus");
    expect(doc.html).toContain("0,01915 mV/V");
    expect(doc.html).toContain("(250 a 2500) kN");
    expect(doc.html).toContain("Barra de tracción superior");
  });
  it("tablas con los números del motor validado: t, u, v, Xa y la U de 250 kN (0,178 %)", () => {
    expect(doc.html).toContain(r.coef.F3[0].toExponential(9).replace(".", ","));
    expect(doc.html).toContain("0,178");
    expect(doc.html).toContain(`${(250 / FACTOR_TONF).toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  });
  it("sin acreditación cargada no imprime una marca DAkkS", () => {
    expect(doc.html).not.toMatch(/D-K-/);
    const conMarca = armarCertificado({ ...cal, acreditacion: "D-K-18357-01-00" }, CTX).html;
    expect(conMarca).toContain("D-K-18357-01-00");
  });
  it("el PDF real tiene 7 hojas (6 + anexo)", async () => {
    const buf = await generarPdf(doc.html, SELLO, "Certificado LNF");
    expect(paginasPdf(buf)).toBe(7);
  }, 60000);
});
