import { asuntoConPrioridad, condicionesBusqueda, prioridadDe, resumenTexto, tamanoLegible, textoAHtml, validarAdjuntos } from "./reglas-mensajes";
import { componerCorreo, etapaCorreo, variablesNoAdmitidas } from "./correo-plantillas";

const COL = { remitente: "r", destinatario: "d", asunto: "a", cuerpo: "c", prioridad: "p", nAdjuntos: "n", fecha: "f" };

describe("mensajería · prioridad y adjuntos (§4.5.5)", () => {
  it("prioridad reconocida o normal, y marcada en el asunto", () => {
    expect(prioridadDe("URGENTE")).toBe("urgente");
    expect(prioridadDe("x")).toBe("normal");
    expect(asuntoConPrioridad("Hola", "urgente")).toBe("[URGENTE] Hola");
    expect(asuntoConPrioridad("Hola", "normal")).toBe("Hola");
  });
  it("adjuntos: tipo por contenido, tamaño y cantidad", () => {
    const pdf = Buffer.concat([Buffer.from("%PDF-1.4 PRUEBA"), Buffer.alloc(10)]);
    const r = validarAdjuntos([
      { originalname: "informe PRUEBA.pdf", buffer: pdf },
      { originalname: "virus.exe", buffer: Buffer.from("MZ") },
      { originalname: "falso.pdf", buffer: Buffer.from("hola") },
    ]);
    expect(r.adjuntos.map((a) => a.nombre)).toEqual(["informe PRUEBA.pdf"]);
    expect(r.errores).toHaveLength(2);
    expect(validarAdjuntos(Array.from({ length: 11 }, () => ({ originalname: "a.txt", buffer: Buffer.from("x") }))).errores[0]).toMatch(/hasta 10/);
    expect(validarAdjuntos(null)).toEqual({ adjuntos: [], errores: [] });
  });
  it("textos auxiliares", () => {
    expect(tamanoLegible(1536)).toBe("2 KB");
    expect(tamanoLegible(2 * 1024 * 1024)).toBe("2,0 MB");
    expect(resumenTexto("<p>Hola&nbsp; <b>mundo</b></p>")).toBe("Hola mundo");
    expect(textoAHtml("a <b>\nb\n\nc")).toBe("<p>a &lt;b&gt;<br>b</p>\n<p>c</p>");
  });
});

describe("mensajería · búsqueda en el historial (§4.5.6)", () => {
  it("cada filtro agrega su condición con parámetros desde el índice pedido", () => {
    const r = condicionesBusqueda(
      { remitente: "ana", destinatario: "x@y.cl", asunto: "OT", prioridad: "urgente", adjuntos: "si", q: "humedad  lote", desde: "2026-10-01", hasta: "mal" },
      COL,
      3,
    );
    expect(r.sql).toEqual([
      "r ILIKE $3",
      "d ILIKE $4",
      "a ILIKE $5",
      "p = $6",
      "n > 0",
      "(a ILIKE $7 OR c ILIKE $7)",
      "(a ILIKE $8 OR c ILIKE $8)",
      expect.stringMatching(/::date >= \$9::date$/),
    ]);
    expect(r.args).toEqual(["%ana%", "%x@y.cl%", "%OT%", "urgente", "%humedad%", "%lote%", "2026-10-01"]);
  });
  it("sin filtros no agrega nada; prioridad desconocida y adjuntos «no»", () => {
    expect(condicionesBusqueda({}, COL, 1)).toEqual({ sql: [], args: [] });
    expect(condicionesBusqueda({ prioridad: "max", adjuntos: "no" }, COL, 1).sql).toEqual(["n = 0"]);
  });
});

describe("plantillas por etapa (§4.5.4)", () => {
  it("rechaza marcadores que la etapa no conoce", () => {
    expect(variablesNoAdmitidas("Hola {{cliente}}, OT {{codigo}} {{ total }}", "ot_creada")).toEqual(["total"]);
    expect(variablesNoAdmitidas("{{titulo}}", "aviso_interno")).toEqual([]);
    expect(etapaCorreo("ot_creada")?.disparador).toMatch(/crear la OT/);
  });
  it("compone el correo: asunto en una línea, cuerpo escapado y con firma al cliente", () => {
    const c = componerCorreo({ asunto: "OT {{codigo}}\n{{cliente}}", cuerpo: "<p>{{cliente}}</p>", destino: "cliente" }, { codigo: "OT-1", cliente: "A&B <PRUEBA>" });
    expect(c.asunto).toBe("OT OT-1 A&B <PRUEBA>");
    expect(c.html).toContain("<p>A&amp;B &lt;PRUEBA&gt;</p>");
    expect(c.html).toContain("Atentamente");
    expect(componerCorreo({ asunto: "x", cuerpo: "<p>{{mensaje}}</p>", destino: "interno" }, { mensaje: "m" }).html).toBe("<p>m</p>");
  });
});
