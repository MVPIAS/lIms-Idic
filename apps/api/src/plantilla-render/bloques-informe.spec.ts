import { CONCLUSION_REGISTROS_5_ANIOS, configEfectiva, configPorTipo } from "./config-informe";
import { armarInforme, type ResultadoParaInforme } from "./filas-informe";
import {
  bloqueAnexo,
  bloqueConclusion,
  bloquePortadaIvc,
  bloqueReferencias,
  bloqueResultados,
  completarCuerpo,
} from "./bloques-informe";
import { tipoImagen } from "./reglas-fotos";
import { generarPdf } from "./pdf.renderer";

const r = (x: Partial<ResultadoParaInforme>): ResultadoParaInforme => ({
  id: Math.random().toString(36).slice(2),
  muestraId: "m1",
  muestraCodigo: "OT-9-M1",
  ensayo: "pH",
  ...x,
});
const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("bloques · tabla de resultados", () => {
  const datos = [
    r({ ensayo: "pH", metodoNombre: "pH", metodoNorma: "NCh 409/2", unidad: "", limiteInf: "6,5", limiteSup: "8,5", valorNumerico: 7.2, veredicto: "cumple" }),
    r({ ensayo: "Cloro <libre>", unidad: "mg/L", limiteInf: "0,2", limiteSup: "2", especOrigen: "orden", valorNumerico: 0.1, veredicto: "no_cumple", observacion: "Bajo el mínimo" }),
  ];

  it("cumplimiento: columnas Ensayo, Método, Unidad, Requisito, Resultado y Veredicto, con nombres reales", () => {
    const cfg = configPorTipo("I.ENSAYO");
    const html = bloqueResultados(armarInforme(datos, cfg, "cumplimiento"), cfg);
    expect(html).toContain("<th>Requisito</th>");
    expect(html).toContain("<th>Veredicto</th>");
    expect(html).toContain("<td>pH</td><td>NCh 409/2</td>");
    expect(html).toContain("<td>6,5 – 8,5</td>");
    expect(html).toContain("<td>0,2 – 2 *</td>"); // requisito de la orden
    expect(html).toContain('<td class="no">No cumple</td>');
    expect(html).toContain("Obs.: Bajo el mínimo");
    expect(html).toContain("Veredicto de la muestra OT-9-M1: <b>No cumple</b>");
    expect(html).toContain("Requisito fijado para esta orden");
    // Los datos van escapados.
    expect(html).toContain("Cloro &lt;libre&gt;");
    expect(html).not.toContain("<libre>");
  });

  it("solo resultados: sin columnas de requisito ni veredicto", () => {
    const cfg = configPorTipo("I.ENSAYO");
    const html = bloqueResultados(armarInforme(datos, cfg, "solo_resultados"), cfg);
    expect(html).not.toContain("Requisito");
    expect(html).not.toContain("Veredicto");
    expect(html).toContain("<td>7,2</td>");
  });

  it("formato de la plantilla: títulos de columna propios y sin columna método", () => {
    const cfg = configEfectiva("I.ENSAYO", { columnaMetodo: false, etiquetas: { veredicto: "Condición" } });
    const html = bloqueResultados(armarInforme(datos, cfg, "cumplimiento"), cfg);
    expect(html).toContain("<th>Condición</th>");
    expect(html).not.toContain("NCh 409/2");
  });

  it("sin resultados: aviso en la tabla", () => {
    const cfg = configPorTipo(null);
    expect(bloqueResultados(armarInforme([], cfg, "cumplimiento"), cfg)).toContain("Sin resultados registrados");
  });

  it("secciones numeradas: h3 para la sección y h4 para el componente", () => {
    const cfg = configPorTipo("IVC");
    const html = bloqueResultados(
      armarInforme([r({ ensayo: "Composición", seccion: "Materiales", componente: "Tela base", requisito: "Algodón", veredicto: "cumple" })], cfg, "cumplimiento"),
      cfg,
    );
    expect(html).toContain("<h3>4.1 Materiales</h3><h4>4.1.1 Tela base</h4>");
    expect(html).toContain("<th>Característica</th>");
    expect(html).toContain("<th>Grado de cumplimiento</th>");
  });
});

describe("bloques · referencias, anexo, conclusión y portada", () => {
  const cfg = configPorTipo("IVC");
  const est = armarInforme(
    [r({ ensayo: "Peso", seccion: "Materiales", componente: "Material de protección", limiteSup: "300", valorNumerico: 320, veredicto: "no_cumple" })],
    cfg,
    "cumplimiento",
  );

  it("referencias solo en cumplimiento y si la plantilla las pide", () => {
    expect(bloqueReferencias(est, cfg)).toContain("Punto 4.1.1 Material de protección no cumple con Peso.");
    expect(bloqueReferencias({ ...est, modalidad: "solo_resultados" }, cfg)).toBe("");
    expect(bloqueReferencias(est, { ...cfg, referencias: false })).toBe("");
  });

  it("anexo: solo PNG/JPEG en base64 válido, con pie que remite al punto", () => {
    const html = bloqueAnexo(
      [
        { mime: "image/png", datos: PNG_1x1, pie: "Falta entretela", punto: "4.1.1", titulo: "Material de protección" },
        { mime: "image/svg+xml", datos: "PHN2Zz4=", pie: "no", punto: null, titulo: null },
        { mime: "image/png", datos: 'x" onerror="alert(1)', pie: "no", punto: null, titulo: null },
      ],
      cfg,
    );
    expect(html.match(/<img /g)?.length).toBe(1);
    expect(html).toContain("Foto 1 · Punto 4.1.1 Material de protección · Falta entretela");
    expect(html).not.toContain("onerror");
    expect(bloqueAnexo([], cfg)).toBe("");
    expect(bloqueAnexo([{ mime: "image/png", datos: PNG_1x1, pie: null, punto: null, titulo: null }], { ...cfg, anexoFotografico: false })).toBe("");
  });

  it("conclusión: texto fijo (archivo 5 años) + texto libre escapado", () => {
    const html = bloqueConclusion(cfg, "El lote <b>cumple</b>.\nSe recomienda…");
    expect(html).toContain(CONCLUSION_REGISTROS_5_ANIOS);
    expect(html).toContain("El lote &lt;b&gt;cumple&lt;/b&gt;.");
    expect(html).toContain("<p>Se recomienda…</p>");
    expect(bloqueConclusion(configPorTipo("I.ENSAYO"), "  ")).toBe("");
  });

  it("conclusion_texto: mismo contenido sin título, y completarCuerpo no añade otra conclusión", () => {
    const html = bloqueConclusion(cfg, "Cumple.", false);
    expect(html).not.toContain("<h2>");
    expect(html).toContain("<p>Cumple.</p>");
    const cuerpo = '<h2>5. Conclusiones y/u observaciones</h2>{{conclusion_texto}}<div class="firmas"></div>';
    expect(completarCuerpo(cuerpo, cfg)).not.toContain("{{conclusion}}");
  });

  it("portada del IVC con los datos del documento y N/A en lo vacío", () => {
    const html = bloquePortadaIvc(
      { proposito: "Verificación de calidad", opiOc: "1094080-32-SE26", proveedor: "Proveedor & Cía" },
      { numero: "CERT-2026-0001", ot: "OT-2026-0009", fechaOt: "04-09-2026", fecha: "22-09-2026" },
    );
    expect(html).toContain("1094080-32-SE26");
    expect(html).toContain("Proveedor &amp; Cía");
    expect(html).toContain("<th>Contrato</th><td>N/A</td>");
    expect(html).toContain('class="n-paginas"');
  });

  it("completarCuerpo añade los bloques que falten antes de las firmas y la portada tras el título", () => {
    const cuerpo = '<h1>INFORME</h1><h2>Resultados</h2>{{tabla_resultados}}<div class="firmas"><div class="firma">x</div></div>';
    const out = completarCuerpo(cuerpo, cfg);
    expect(out.indexOf("{{referencias}}")).toBeLessThan(out.indexOf('<div class="firmas">'));
    expect(out.indexOf("{{conclusion}}")).toBeLessThan(out.indexOf('<div class="firmas">'));
    expect(out.indexOf("{{portada}}")).toBeGreaterThan(out.indexOf("</h1>"));
    // Idempotente: no duplica lo que ya está.
    expect(completarCuerpo(out, cfg)).toBe(out);
    expect(completarCuerpo("<p>x</p>", configPorTipo("I.ENSAYO"))).not.toContain("{{portada}}");
  });
});

describe("formato de plantilla", () => {
  it("por tipo: IVC numerado con portada; el resto por muestra sin numerar", () => {
    expect(configPorTipo("IVC")).toMatchObject({ agrupacion: "seccion", numeracion: "4", portada: "ivc" });
    expect(configPorTipo("I.ENSAYO")).toMatchObject({ agrupacion: "muestra", numeracion: null, portada: "ninguna" });
  });
  it("lo guardado manda; lo inválido se ignora campo a campo", () => {
    const c = configEfectiva("I.ENSAYO", { agrupacion: "seccion", numeracion: "x.y", referencias: "si", etiquetas: { ensayo: "Característica" } });
    expect(c.agrupacion).toBe("seccion");
    expect(c.numeracion).toBeNull();
    expect(c.referencias).toBe(true);
    expect(c.etiquetas.ensayo).toBe("Característica");
    expect(c.etiquetas.veredicto).toBe("Veredicto");
    expect(configEfectiva("IVC", null)).toEqual(configPorTipo("IVC"));
    expect(configEfectiva("IVC", [1, 2])).toEqual(configPorTipo("IVC"));
  });
});

describe("fotos · tipo por los bytes", () => {
  it("PNG y JPEG sí; lo demás no, aunque diga ser imagen", () => {
    expect(tipoImagen(Buffer.from(PNG_1x1, "base64"))).toBe("image/png");
    expect(tipoImagen(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]))).toBe("image/jpeg");
    expect(tipoImagen(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
    expect(tipoImagen(Buffer.from("GIF89a....."))).toBeNull();
    expect(tipoImagen(Buffer.alloc(3))).toBeNull();
    expect(tipoImagen(null)).toBeNull();
  });
});

describe("PDF del informe con anexo fotográfico y portada", () => {
  it("dibuja fotos, celdas que abarcan columnas y el número de páginas sin romper", async () => {
    const cfg = configPorTipo("IVC");
    const est = armarInforme([r({ ensayo: "Peso", seccion: "Materiales", componente: "Tela", limiteSup: "1", valorNumerico: 2, veredicto: "no_cumple" })], cfg, "cumplimiento");
    const cuerpo =
      `<h1>INFORME DE VERIFICACIÓN DE CALIDAD</h1>` +
      bloquePortadaIvc({ proposito: "Prueba" }, { numero: "CERT-2026-0001", ot: "OT-1", fechaOt: "", fecha: "17-10-2026" }) +
      bloqueResultados(est, cfg) +
      bloqueReferencias(est, cfg) +
      bloqueAnexo([{ mime: "image/png", datos: PNG_1x1, pie: "Detalle", punto: "4.1.1", titulo: "Tela" }], cfg) +
      bloqueConclusion(cfg, null);
    const pdf = await generarPdf(cuerpo, { numero: "CERT-2026-0001", codigoVerificacion: "X", hash: "0".repeat(64), fecha: "17-10-2026", urlVerificacion: "https://x" }, "Prueba");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  });
});
