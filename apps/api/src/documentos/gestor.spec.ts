import { arbolCarpetas, derechosDocumento, esDescendiente, nombreSeguro, subarbol, tipoArchivo } from "./gestor";

const C = [
  { id: "r", padreId: null, nombre: "Calidad", unidadId: null },
  { id: "a", padreId: "r", nombre: "Procedimientos", unidadId: null },
  { id: "l", padreId: null, nombre: "Laboratorios", unidadId: null },
  { id: "q", padreId: "l", nombre: "LQC", unidadId: "U-LQC" },
  { id: "q1", padreId: "q", nombre: "Instructivos", unidadId: null },
  { id: "x", padreId: "falta", nombre: "Huérfana", unidadId: null },
];

describe("gestor documental · árbol de carpetas (§4.6.2)", () => {
  it("ruta, nivel y unidad heredada del ancestro", () => {
    const a = arbolCarpetas(C);
    const q1 = a.find((c) => c.id === "q1")!;
    expect(q1.ruta).toBe("Laboratorios / LQC / Instructivos");
    expect(q1.nivel).toBe(2);
    expect(q1.unidadEfectiva).toBe("U-LQC");
    expect(a.find((c) => c.id === "a")!.unidadEfectiva).toBeNull();
    expect(a.map((c) => c.ruta)[0]).toBe("Calidad");
  });
  it("una carpeta con padre inexistente queda como raíz; un ciclo se corta", () => {
    expect(arbolCarpetas(C).find((c) => c.id === "x")).toMatchObject({ padreId: null, nivel: 0, ruta: "Huérfana" });
    const ciclo = arbolCarpetas([
      { id: "1", padreId: "2", nombre: "A", unidadId: null },
      { id: "2", padreId: "1", nombre: "B", unidadId: null },
    ]);
    expect(ciclo).toHaveLength(2);
  });
  it("no se mueve una carpeta dentro de sí misma ni de su subárbol", () => {
    expect(esDescendiente(C, "l", "q1")).toBe(true);
    expect(esDescendiente(C, "l", "l")).toBe(true);
    expect(esDescendiente(C, "q", "r")).toBe(false);
    expect(subarbol(C, "l").sort()).toEqual(["l", "q", "q1"]);
  });
});

describe("gestor documental · archivos admitidos (§4.6.1)", () => {
  const pdf = Buffer.from("%PDF-1.7 ...");
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
  it("acepta por extensión Y contenido", () => {
    expect(tipoArchivo("informe.pdf", pdf)).toEqual({ mime: "application/pdf" });
    expect(tipoArchivo("Planilla.XLSX", zip)).toMatchObject({ mime: expect.stringContaining("spreadsheetml") });
    expect(tipoArchivo("notas.txt", Buffer.from("hola ñandú"))).toMatchObject({ mime: expect.stringContaining("text/plain") });
  });
  it("rechaza contenido que no corresponde, extensiones desconocidas, vacíos y binarios como texto", () => {
    expect(tipoArchivo("informe.pdf", zip)).toHaveProperty("error");
    expect(tipoArchivo("script.exe", pdf)).toHaveProperty("error");
    expect(tipoArchivo("sin-extension", pdf)).toHaveProperty("error");
    expect(tipoArchivo("a.pdf", Buffer.alloc(0))).toHaveProperty("error");
    expect(tipoArchivo("a.csv", Buffer.from([0x61, 0x00, 0x62]))).toHaveProperty("error");
  });
  it("nombre de archivo seguro", () => {
    expect(nombreSeguro("../../etc/passwd")).toBe("_.._etc_passwd");
    expect(nombreSeguro("Informe <final> ñ.pdf")).toBe("Informe _final_ ñ.pdf");
    expect(nombreSeguro("")).toBe("documento");
  });
});

describe("gestor documental · derechos por documento (§4.6.3)", () => {
  const base = { gestiona: false, global: false, restringido: false, esCreador: false, nivelAcceso: null } as const;
  it("«Ver y editar» deja editar a quien no gestiona documentos, pero no administrar", () => {
    expect(derechosDocumento({ ...base, nivelAcceso: "editar" })).toEqual({ edita: true, administra: false });
    expect(derechosDocumento({ ...base, restringido: true, nivelAcceso: "editar" })).toEqual({ edita: true, administra: false });
  });
  it("quien solo consulta no edita, con o sin permiso «Ver»", () => {
    expect(derechosDocumento(base)).toEqual({ edita: false, administra: false });
    expect(derechosDocumento({ ...base, nivelAcceso: "ver" })).toEqual({ edita: false, administra: false });
  });
  it("quien gestiona: todo en los no restringidos; en los restringidos, global, creador o «Ver y editar»", () => {
    const g = { ...base, gestiona: true };
    expect(derechosDocumento(g)).toEqual({ edita: true, administra: true });
    expect(derechosDocumento({ ...g, restringido: true })).toEqual({ edita: false, administra: false });
    expect(derechosDocumento({ ...g, restringido: true, nivelAcceso: "ver" })).toEqual({ edita: false, administra: false });
    expect(derechosDocumento({ ...g, restringido: true, esCreador: true }).administra).toBe(true);
    expect(derechosDocumento({ ...g, restringido: true, global: true }).administra).toBe(true);
    expect(derechosDocumento({ ...g, restringido: true, nivelAcceso: "editar" }).administra).toBe(true);
  });
});
