import { avisosCotizadoLnf, coeficientesSmp, columnaSmp, fuerzasDeTexto, sentidoDeHoja, smpPorFuerza, unidadIndicador, validarAmbienteLnf } from "./hoja-lnf.reglas";
import { armarCertificado, type ContextoCertificado } from "./metrologia.certificado";
import { MOTOR_LNF } from "./motores";
import { CASOS_LNF } from "./motores/paridad-lnf";

describe("Hoja de control del LNF (sesión 03-11, R9)", () => {
  // Coeficientes del certificado del transductor de referencia (ilustrativos, PRUEBA).
  const k = { a: 7.73e-4, b: -1.2e-9, c: 3.0e-14 };
  it("columna SMP: S = a·F + b·F² + c·F³ con los coeficientes del patrón", () => {
    expect(smpPorFuerza(k, 300)).toBeCloseTo(7.73e-4 * 300 - 1.2e-9 * 9e4 + 3e-14 * 2.7e7, 12);
    expect(smpPorFuerza(k, 0)).toBe(0);
    expect(smpPorFuerza(null, 300)).toBeNull();
    expect(columnaSmp(k, [{ F: 300 }, { F: null }, {}])).toEqual([smpPorFuerza(k, 300), null, null]);
  });
  it("coeficientes del maestro: los tres o ninguno", () => {
    expect(coeficientesSmp({ a: 1, b: 0, c: 0, t: 5 })).toEqual({ a: 1, b: 0, c: 0 });
    expect(coeficientesSmp({ a: 1, b: "x", c: 0 })).toBeNull();
    expect(coeficientesSmp({ a: 0, b: 0, c: 0 })).toBeNull();
    expect(coeficientesSmp(null)).toBeNull();
  });
  it("unidad del indicador configurable (mV/V por defecto)", () => {
    expect(unidadIndicador({})).toBe("mV/V");
    expect(unidadIndicador({ uRes: " kN " })).toBe("kN");
  });
  it("validación ambiental con el dato y su unidad", () => {
    const v = validarAmbienteLnf({ tIni: 22.4, hr: 120, temp: [22.4, 200] });
    expect(v.errores).toEqual([
      "Temperatura al final de la serie 2: 200 °C está fuera del rango válido (-50 a 150 °C).",
      "Humedad relativa: 120 %HR está fuera del rango válido (0 a 100 %HR).",
    ]);
    expect(validarAmbienteLnf({ tIni: "30,5", hr: 50 }).avisos).toEqual(["Temperatura al inicio: 30,5 °C está fuera de lo que pide la ISO 376 (18 a 28 °C)."]);
    expect(validarAmbienteLnf({ tIni: 22, hr: 50, hrU: 5 })).toEqual({ errores: [], avisos: [] });
  });
  it("lo cotizado: avisa si el sentido o los puntos de la hoja no coinciden", () => {
    expect(sentidoDeHoja("COMPRESIÓN")).toBe("C");
    expect(sentidoDeHoja("traccion")).toBe("T");
    expect(sentidoDeHoja("")).toBeNull();
    expect(fuerzasDeTexto("300, 600 y 1.200 kN")).toEqual([300, 600, 1200]);
    const a = avisosCotizadoLnf({ sentido: "T", puntos: "300, 600, 900 kN", numero: 1 }, { sentido: "COMPRESIÓN", pts: [{ F: 300 }, { F: 600 }] });
    expect(a).toEqual([
      "Lo cotizado del ítem 1 es TRACCIÓN y la hoja de control está en COMPRESIÓN: revise el sentido antes de enviar.",
      "Puntos cotizados del ítem 1 que no están en la hoja: 900 kN.",
    ]);
    expect(avisosCotizadoLnf({ sentido: "T+C", puntos: "10 %, 20 %" }, { sentido: "C", pts: [{ F: 1 }] })).toEqual([]);
  });
});

describe("Certificado del LNF: unidad del indicador, CIPM MRA, trazabilidad metrológica y reemisión (R9)", () => {
  const caso = CASOS_LNF[0];
  const r = MOTOR_LNF.calcular(caso.datos, {});
  const firma = (nombre: string, rol: string) => ({ accion: "FIRMA", rol, nombre, cargo: rol, pendiente: true });
  const CTX: ContextoCertificado = { departamento: "Departamento PRUEBA", metrologo: firma("A", "Metrólogo"), jefeLab: firma("B", "Jefe LNF"), jefeDepto: null };
  const cal: any = {
    codigo: "CAL-PRUEBA", numero_certificado: "LCPNF-010.26", proceso: "LCPNF-IT01", motor: "LCPNF-IT01", resultado: r, resumen: MOTOR_LNF.resumen(r, caso.datos),
    datos: caso.datos, fecha_calibracion: "2026-03-23", instrumento: { item: "Transductor PRUEBA" }, patrones: [],
  };
  it("dice «trazabilidad metrológica» (no metodológica) en español e inglés", () => {
    const html = armarCertificado(cal, CTX).html;
    expect(html).toContain("trazabilidad metrológica");
    expect(html).toContain("metrological traceability");
    expect(html).not.toMatch(/metodol[oó]gic/i);
  });
  it("la unidad del indicador sale de la hoja (uRes)", () => {
    const html = armarCertificado({ ...cal, datos: { ...caso.datos, uRes: "div" } }, CTX).html;
    expect(html).toContain("X1 asc. 0° / div");
    expect(html).not.toContain("mV/V");
  });
  it("formato CIPM MRA: hoja 7 con la declaración de Laboratorio Designado", () => {
    const d = armarCertificado({ ...cal, presentacion: { formato: "cipm_mra" } }, CTX);
    expect(d.hojas).toBe(8);
    expect(d.html).toContain("Página 7 de 7");
    expect(d.html).toContain("Laboratorio Designado en Chile");
    expect(armarCertificado(cal, CTX).html).not.toContain("CIPM MRA");
  });
  it("certificado modificado: imprime la leyenda con el número anterior y el motivo", () => {
    const html = armarCertificado(cal, { ...CTX, reemision: { modalidad: "modificacion", numeroAnterior: "LCPNF-009.26", fechaAnterior: "2026-11-03", motivo: "PRUEBA" } }).html;
    expect(html).toContain("CERTIFICADO MODIFICADO: esta versión reemplaza a la emitida con el N° LCPNF-009.26 el 03-11-2026. Motivo: PRUEBA.");
  });
});
