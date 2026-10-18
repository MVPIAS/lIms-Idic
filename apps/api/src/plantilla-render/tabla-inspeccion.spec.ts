import { renderizar, tablaInspeccion } from "./template.engine";
import { filaInspeccion, valorInformado } from "./filas-informe";

describe("{{tabla_inspeccion}} · documentos BPCH", () => {
  const fila = { inspeccion: "Defecto crítico (Inspección visual)", muestra: "OT-1-M1", minimo: "0", maximo: "0", resultado: "0", unidad: "Obs.", condicion: "Cumple" };

  it("pinta Inspección · Mínimo · Máximo · Resultado · Unidad · Condición", () => {
    const html = tablaInspeccion([fila, { ...fila, inspeccion: "Defecto menor", maximo: "6", resultado: "7", condicion: "No cumple" }]);
    expect(html).toContain("<th>Inspección</th>");
    expect(html).toContain("Mínimo");
    expect(html).toContain('<td class="ok">Cumple</td>');
    expect(html).toContain('<td class="no">No cumple</td>');
    // Una sola muestra: no repite la columna de lote.
    expect(html).not.toContain("Lote / muestra");
  });

  it("con varios lotes añade la columna del lote", () => {
    expect(tablaInspeccion([fila, { ...fila, muestra: "OT-1-M2" }])).toContain("Lote / muestra");
  });

  it("escapa los datos y marca la tabla vacía", () => {
    expect(tablaInspeccion([{ ...fila, inspeccion: "<script>x</script>" }])).toContain("&lt;script&gt;");
    expect(tablaInspeccion([])).toContain("Sin inspecciones registradas");
  });

  it("se inyecta como bloque y la cabecera {{bpch.*}} se escapa como cualquier dato", () => {
    const { html, faltantes } = renderizar("<p>{{bpch.cnc_dgmn}}</p>{{tabla_inspeccion}}", { bpch: { cnc_dgmn: "E-I/7/176/673/30365/3202 <b>" } }, {
      tabla_inspeccion: tablaInspeccion([fila]),
    });
    expect(html).toContain("E-I/7/176/673/30365/3202 &lt;b&gt;");
    expect(html).toContain("<table");
    expect(faltantes).toEqual([]);
  });
});

describe("{{tabla_inspeccion}} · valor informado (hallazgo 1 de la revisión r3)", () => {
  const base = { catAnalito: { nombre: "Densidad" }, muestra: { codigo: "OT-1-M1" }, limiteInf: "150", limiteSup: "250", unidad: "g", veredicto: "cumple" };
  it("imprime el resultado final (fórmula o factor), no el promedio crudo", () => {
    // Réplicas [2, 2] con fórmula PROMEDIO(RN)*100: promedio 2, resultado 200 (la condición se calculó con 200).
    const f = filaInspeccion({ ...base, promedio: "2", valorNumerico: "200", resultadoFinal: "200" });
    expect(f.resultado).toBe("200");
    expect(f.condicion).toBe("Cumple");
  });
  it("sin resultado final: el valor capturado; sin él, el promedio; sin número, el texto", () => {
    expect(filaInspeccion({ ...base, valorNumerico: "0", promedio: "1" }).resultado).toBe("0");
    expect(filaInspeccion({ ...base, promedio: "1.5" }).resultado).toBe("1,5");
    expect(filaInspeccion({ ...base, valorTexto: "Sin defectos" }).resultado).toBe("Sin defectos");
  });
  it("toma los límites del analito si el ensayo no los trae", () => {
    const f = filaInspeccion({ ...base, limiteInf: null, limiteSup: null, unidad: null, valorNumerico: 3 }, { limiteInf: "0", limiteSup: "6", unidad: "Obs." });
    expect([f.minimo, f.maximo, f.unidad]).toEqual(["0", "6", "Obs."]);
  });
  it("valorInformado: resultado final > valor capturado > promedio", () => {
    expect(valorInformado({ resultadoFinal: 5, valorNumerico: 5, promedio: 10 })).toBe(5);
    expect(valorInformado({ valorNumerico: 0, promedio: 10 })).toBe(0);
    expect(valorInformado({})).toBeNull();
  });
});
