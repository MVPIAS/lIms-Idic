import { evaluarRevision, tipoDefectoAnalito, type ItemRevision } from "./revision-documental";

const base: ItemRevision[] = [
  { clave: "raf_linea", aplica: true, estado: "conforme" },
  { clave: "raf_listado", aplica: true, estado: "conforme" },
  { clave: "inspeccion_linea", aplica: false },
  { clave: "almacenamiento", aplica: true, estado: "conforme" },
  { clave: "otro", aplica: false },
];
const con = (clave: string, x: Partial<ItemRevision>) => base.map((i) => (i.clave === clave ? { ...i, ...x } : i));

describe("EP-07 7.3 · revisión documental IT08 (BL-177)", () => {
  it("todo conforme → conforme, sin defectos", () => {
    expect(evaluarRevision(base)).toEqual({ criticos: 0, menores: 0, resultado: "conforme", faltantes: [] });
  });
  it("los documentos que siempre aplican no se marcan «no aplica»; cada uno con estado", () => {
    expect(evaluarRevision(con("raf_linea", { aplica: false })).faltantes[0]).toMatch(/siempre aplica/);
    expect(evaluarRevision(con("almacenamiento", { estado: null })).faltantes[0]).toMatch(/Marque el estado/);
  });
  it("no conforme exige clase de defecto y descripción; crítico → no conforme", () => {
    const sin = evaluarRevision(con("raf_listado", { estado: "no_conforme" }));
    expect(sin.faltantes).toEqual(expect.arrayContaining([expect.stringMatching(/crítico o menor/), expect.stringMatching(/describa/)]));
    const c = evaluarRevision(con("raf_listado", { estado: "no_conforme", defecto: "critico", observacion: "Producto no está en el listado" }));
    expect(c).toMatchObject({ criticos: 1, menores: 0, resultado: "no_conforme", faltantes: [] });
  });
  it("un menor sigue conforme; pendiente deja la revisión pendiente; «otro» exige nombre", () => {
    expect(evaluarRevision(con("raf_linea", { estado: "no_conforme", defecto: "menor", observacion: "Dirección distinta" }))).toMatchObject({ menores: 1, resultado: "conforme" });
    expect(evaluarRevision(con("raf_linea", { estado: "pendiente" })).resultado).toBe("pendiente");
    expect(evaluarRevision(con("otro", { aplica: true, estado: "conforme" })).faltantes[0]).toMatch(/otro documento/);
  });
  it("reconoce los analitos del ensayo «Rev. Doc. Legal»", () => {
    expect(tipoDefectoAnalito("Rev. Doc. Legal (Defecto crítico)")).toBe("critico");
    expect(tipoDefectoAnalito("Defecto menor ( Doc. Legal )")).toBe("menor");
    expect(tipoDefectoAnalito("Doc. Legal ( Defecto menor )")).toBe("menor");
    expect(tipoDefectoAnalito("Otra cosa")).toBeNull();
  });
});
