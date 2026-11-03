import { etiquetaCampo, etiquetasCampos, LIMITE_EXPORTACION, puedeEditarPlantilla, puedeExportar } from "./exportacion";

describe("exportador · etiquetas legibles de columnas (§4.6.6)", () => {
  it("traduce los nombres técnicos al español", () => {
    expect(etiquetaCampo("ot", "codigo")).toBe("Código");
    expect(etiquetaCampo("ot", "created_at")).toBe("Fecha de creación");
    expect(etiquetasCampos("factura", ["iva_monto", "saldo"])).toEqual(["IVA", "Saldo"]);
  });
  it("respeta las excepciones por entidad", () => {
    expect(etiquetaCampo("resultado", "unidad")).toBe("Unidad de medida");
    expect(etiquetaCampo("equipo", "unidad")).toBe("Laboratorio (unidad)");
    expect(etiquetaCampo("actividad", "entidad")).toBe("Tipo de registro");
    expect(etiquetaCampo("muestra", "unidad")).toBe("Unidad");
  });
  it("un campo sin etiqueta sale legible igual", () => {
    expect(etiquetaCampo("ot", "campo_nuevo")).toBe("Campo nuevo");
  });
  it("el tope de una descarga es 10 000 filas", () => {
    expect(LIMITE_EXPORTACION).toBe(10000);
  });
});

describe("exportador · permisos", () => {
  it("una entidad con permiso propio solo la exporta quien lo tiene (o SUPERADMIN)", () => {
    expect(puedeExportar({ permisos: ["reporte.ver"] }, "factura.ver")).toBe(false);
    expect(puedeExportar({ permisos: ["reporte.ver", "factura.ver"] }, "factura.ver")).toBe(true);
    expect(puedeExportar({ roles: ["SUPERADMIN"] }, "audit.ver")).toBe(true);
    expect(puedeExportar({ permisos: [] }, null)).toBe(true);
  });
  it("una plantilla la cambia quien la creó o Administración", () => {
    expect(puedeEditarPlantilla({ sub: "u1" }, "u1")).toBe(true);
    expect(puedeEditarPlantilla({ sub: "u2" }, "u1")).toBe(false);
    expect(puedeEditarPlantilla({ sub: "u2", roles: ["ADMIN"] }, "u1")).toBe(true);
    expect(puedeEditarPlantilla({ sub: "u2", roles: ["SUPERADMIN"] }, "u1")).toBe(true);
    expect(puedeEditarPlantilla({}, null)).toBe(false);
  });
});
