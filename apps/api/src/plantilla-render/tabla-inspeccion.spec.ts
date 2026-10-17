import { renderizar, tablaInspeccion } from "./template.engine";

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
