import { actaNovedades, tablaAql, tablaDisparos, tablaExigencia, tablaReemplazos } from "./bloques-formularios";
import { AMENAZAS_DEFECTO, evaluarLote } from "./lrb";
import { evaluarInspeccion } from "./aql";
import { tipoDocumentoPorDefecto } from "../plantilla-render/reglas-emision";
import { completarCuerpo } from "../plantilla-render/bloques-informe";
import { configPorTipo } from "../plantilla-render/config-informe";

describe("bloques de los formularios en los documentos", () => {
  const registro = {
    unidades: [
      { id: "u", serie: "M-030 <b>", talla: "M", reemplazo: "M-011", paneles: [{ id: "p", zona: "anterior", amenaza: "NIJ0101-IIIA-9MM", disparos: [{ n: 1, v1: 445.8, penetracion: true }] }] },
    ],
  };
  it("disparos: escapa los datos, marca fuera de ventana y los no disparados «-.-»", () => {
    const html = tablaDisparos(evaluarLote(registro, AMENAZAS_DEFECTO, "v1"));
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;");
    expect(html).toContain("velocidad fuera de ventana");
    expect(html).toContain("Panel detenido");
    expect(html).toContain("445,8");
  });
  it("exigencia y reemplazos", () => {
    expect(tablaExigencia(AMENAZAS_DEFECTO.slice(0, 1))).toContain("427–445");
    expect(tablaReemplazos(registro)).toContain("M-011");
  });
  it("AQL del IVC", () => {
    const ev = evaluarInspeccion(1000, [{ inspeccion: "Numeración", aql: "1,5", nivel: "II", defectuosos: 2 }]);
    const html = tablaAql(1000, ev.filas);
    expect(html).toContain("Numeración");
    expect(html).toContain("1.000");
    expect(tablaAql(1000, [])).toBe("");
  });
  it("acta de novedades", () => {
    const html = actaNovedades({
      ot: "OT-1", cliente: "Cliente & Cía", plantilla: "VLCB", fecha: "22-10-2026 10:00",
      lote: { tamanoLote: 70, muestra: 2, inspeccionados: 2, clases: [{ clase: "A", aql: "0", ac: 0, re: 1, vehiculosConNc: 1, decision: "rechaza", texto: "" }], veredicto: "no_cumple", regla: "", errores: [] },
      novedades: [{ vehiculo: 2, chasis: "CH-2", item: "4.2.1", clase: "A", descripcion: "Giro 17 m", accionProveedor: null }],
      emitidaPor: null,
    });
    expect(html).toContain("Cliente &amp; Cía");
    expect(html).toContain("NO CUMPLE");
    expect(html).toContain("4.2.1");
  });
});

describe("documentos del LRB en la emisión", () => {
  it("la plantilla LRB-CRB emite un CRB y LRB-RECH un Informe de Rechazo", () => {
    expect(tipoDocumentoPorDefecto({ tipoPlantilla: "CERTIFICADO", repid: "LRB-CRB" }).tipo).toBe("CERTIFICADO_RESISTENCIA_BALISTICA");
    expect(tipoDocumentoPorDefecto({ tipoPlantilla: "OTRO", repid: "lrb-rech" }).tipo).toBe("INFORME_RECHAZO");
    expect(tipoDocumentoPorDefecto({ indicado: "INFORME_ENSAYO", repid: "LRB-CRB" }).tipo).toBe("INFORME_ENSAYO");
    expect(tipoDocumentoPorDefecto({ tipoPlantilla: "I.ENSAYO", repid: "PG09A2" }).tipo).toBe("INFORME_ENSAYO");
  });
  it("un IVC sin {{tabla_aql}} recibe la sección V condicionada (idempotente)", () => {
    const cfg = configPorTipo("IVC");
    const out = completarCuerpo('<h1>IVC</h1>{{tabla_resultados}}<div class="firmas"></div>', cfg);
    expect(out).toContain("{{#si aql.hay}}");
    expect(completarCuerpo(out, cfg)).toBe(out);
    expect(completarCuerpo("<h1>IE</h1>", configPorTipo("I.ENSAYO"))).not.toContain("tabla_aql");
  });
});
