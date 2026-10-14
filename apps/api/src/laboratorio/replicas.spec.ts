import { leerReplicas } from "./replicas";

describe("leerReplicas · coma decimal chilena sin ambigüedad", () => {
  it("«12,4» es UNA lectura (doce coma cuatro), no dos", () => {
    expect(leerReplicas("12,4")).toEqual({ valores: [12.4], invalidos: [] });
  });
  it("réplicas con coma decimal separadas por espacio", () => {
    expect(leerReplicas("12,4 12,6 12,5").valores).toEqual([12.4, 12.6, 12.5]);
  });
  it("separadas por punto y coma o salto de línea", () => {
    expect(leerReplicas("12,4;12,6").valores).toEqual([12.4, 12.6]);
    expect(leerReplicas("12,4\n12,6\r\n12,5").valores).toEqual([12.4, 12.6, 12.5]);
  });
  it("punto decimal y «coma + espacio» como separador (forma anterior)", () => {
    expect(leerReplicas("12.4, 12.6, 12.5").valores).toEqual([12.4, 12.6, 12.5]);
  });
  it("coma decimal y «coma + espacio» juntas", () => {
    expect(leerReplicas("12,4, 12,6").valores).toEqual([12.4, 12.6]);
  });
  it("negativos y decimales sin parte entera", () => {
    expect(leerReplicas("-0,5 +1,25 ,5").valores).toEqual([-0.5, 1.25, 0.5]);
  });
  it("rechaza lo ambiguo en vez de adivinar", () => {
    expect(leerReplicas("12,4,12,6").invalidos).toEqual(["12,4,12,6"]);
    expect(leerReplicas("1.234,5").invalidos).toEqual(["1.234,5"]);
    expect(leerReplicas("1.2.3").invalidos).toEqual(["1.2.3"]);
  });
  it("rechaza texto y conserva las lecturas válidas", () => {
    expect(leerReplicas("12,4 abc 12,6")).toEqual({ valores: [12.4, 12.6], invalidos: ["abc"] });
  });
  it("vacío → sin lecturas", () => {
    expect(leerReplicas("   ")).toEqual({ valores: [], invalidos: [] });
  });
});
