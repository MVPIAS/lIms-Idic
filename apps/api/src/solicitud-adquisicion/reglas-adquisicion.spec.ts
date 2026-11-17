import {
  accionesDisponibles,
  editableAdquisicion,
  errorAutoVisado,
  erroresOrdenCompra,
  erroresRecepcionBodega,
  erroresSolicitud,
  errorTransicion,
  estadoTras,
  htmlSolicitud,
  itemsParaIngresoBodega,
  totales,
  type DatosSolicitud,
} from "./reglas-adquisicion";

const base: DatosSolicitud = {
  centroCosto: "LQC · Laboratorio PRUEBA",
  solicitanteNombre: "Analista PRUEBA",
  objetivo: "Reponer reactivos PRUEBA",
  items: [{ cantidad: 2, descripcion: "Ácido PRUEBA 1 L", valorUnitario: 1000 }],
};

describe("transiciones de la solicitud de adquisición", () => {
  it("recorre el circuito completo con el actor de cada paso", () => {
    expect(errorTransicion("borrador", "enviar", "laboratorio")).toBeNull();
    expect(errorTransicion("enviada", "visar", "jefatura")).toBeNull();
    expect(errorTransicion("visada", "recibir_sab", "sab")).toBeNull();
    expect(errorTransicion("recibida_sab", "registrar_oc", "sab")).toBeNull();
    expect(errorTransicion("en_compra", "registrar_oc", "sab")).toBeNull(); // corrige los datos de la O/C
    expect(errorTransicion("en_compra", "recibir_bodega", "sab")).toBeNull();
    expect(estadoTras("recibir_bodega")).toBe("recibida_bodega");
  });

  it("el laboratorio no da el V°B° ni gestiona la compra", () => {
    expect(errorTransicion("enviada", "visar", "laboratorio")).toMatch(/jefatura/);
    expect(errorTransicion("visada", "recibir_sab", "jefatura")).toMatch(/Abastecimiento/);
  });

  it("no salta pasos: SAB no recibe una solicitud sin V°B° y bodega exige O/C", () => {
    expect(errorTransicion("enviada", "recibir_sab", "sab")).toMatch(/enviada a la jefatura/);
    expect(errorTransicion("recibida_sab", "recibir_bodega", "sab")).toMatch(/no se puede/);
  });

  it("devolver: la jefatura antes del V°B°; SAB después", () => {
    expect(errorTransicion("enviada", "devolver", "jefatura")).toBeNull();
    expect(errorTransicion("visada", "devolver", "sab")).toBeNull();
    expect(errorTransicion("recibida_sab", "devolver", "sab")).toBeNull();
    expect(errorTransicion("en_compra", "devolver", "sab")).not.toBeNull();
    expect(estadoTras("devolver")).toBe("devuelta");
    expect(errorTransicion("devuelta", "enviar", "laboratorio")).toBeNull();
  });

  it("anular: el laboratorio hasta el V°B°, SAB después; los estados finales no cambian", () => {
    expect(errorTransicion("borrador", "anular", "laboratorio")).toBeNull();
    expect(errorTransicion("visada", "anular", "laboratorio")).not.toBeNull();
    expect(errorTransicion("en_compra", "anular", "sab")).toBeNull();
    expect(errorTransicion("recibida_bodega", "anular", "sab")).toMatch(/recibida en bodega/);
    expect(errorTransicion("anulada", "enviar", "laboratorio")).not.toBeNull();
    expect(errorTransicion("xx", "enviar", "laboratorio")).toMatch(/desconocido/);
  });

  it("solo se corrige en borrador o devuelta", () => {
    expect(editableAdquisicion("borrador")).toBe(true);
    expect(editableAdquisicion("devuelta")).toBe(true);
    expect(editableAdquisicion("enviada")).toBe(false);
  });
});

describe("V°B° y acciones disponibles", () => {
  it("quien crea no da su propio V°B°", () => {
    expect(errorAutoVisado("u1", "u1")).toMatch(/otra persona/);
    expect(errorAutoVisado("u1", "u2")).toBeNull();
  });

  it("la jefatura que creó la solicitud no ve «visar», pero sí devolver", () => {
    const a = accionesDisponibles("enviada", { esCreador: true, laboratorio: true, jefatura: true, sab: false });
    expect(a).not.toContain("visar");
    expect(a).toContain("devolver");
    expect(a).toContain("anular");
    const b = accionesDisponibles("enviada", { esCreador: false, laboratorio: false, jefatura: true, sab: false });
    expect(b).toEqual(expect.arrayContaining(["visar", "devolver"]));
  });

  it("SAB ve sus acciones según el estado", () => {
    const sab = { esCreador: false, laboratorio: false, jefatura: false, sab: true };
    expect(accionesDisponibles("visada", sab).sort()).toEqual(["anular", "devolver", "recibir_sab"]);
    expect(accionesDisponibles("en_compra", sab).sort()).toEqual(["anular", "recibir_bodega", "registrar_oc"]);
    expect(accionesDisponibles("recibida_bodega", sab)).toEqual([]);
  });
});

describe("validaciones", () => {
  it("acepta una solicitud completa", () => {
    expect(erroresSolicitud(base)).toEqual([]);
  });

  it("exige solicitante, objetivo e ítems válidos", () => {
    const e = erroresSolicitud({
      centroCosto: "",
      solicitanteNombre: "x",
      objetivo: "abc",
      items: [{ cantidad: 0, descripcion: "", valorUnitario: -1, consumibleId: "c", equipoId: "e" }],
    });
    expect(e.join(" ")).toMatch(/centro de costo/);
    expect(e.join(" ")).toMatch(/usuario solicitante/);
    expect(e.join(" ")).toMatch(/objetivo/);
    expect(e.join(" ")).toMatch(/Ítem 1: la cantidad/);
    expect(e.join(" ")).toMatch(/Ítem 1: describa/);
    expect(e.join(" ")).toMatch(/negativo/);
    expect(e.join(" ")).toMatch(/no a ambos/);
    expect(erroresSolicitud({ ...base, items: [] })).toContain("Agregue al menos un bien o servicio a la solicitud.");
  });

  it("valida la O/C y la recepción en bodega", () => {
    expect(erroresOrdenCompra({ numero: "OC-1", fecha: "2026-11-10", proveedor: "Proveedor PRUEBA", hoy: "2026-11-14" })).toEqual([]);
    const e = erroresOrdenCompra({ numero: " ", fecha: "2026-12-01", proveedor: "", hoy: "2026-11-14" });
    expect(e).toHaveLength(3);
    expect(erroresRecepcionBodega({ fecha: "2026-11-09", hoy: "2026-11-14", fechaOc: "2026-11-10" })[0]).toMatch(/anterior/);
    expect(erroresRecepcionBodega({ fecha: "2026-11-20", hoy: "2026-11-14" })[0]).toMatch(/futura/);
    expect(erroresRecepcionBodega({ fecha: "2026-11-14", hoy: "2026-11-14", fechaOc: "2026-11-10" })).toEqual([]);
  });
});

describe("totales del formulario", () => {
  it("suma por ítem, sub-total, IVA 19 % y total", () => {
    const t = totales([{ cantidad: 80, valorUnitario: 1737 }, { cantidad: 1, valorUnitario: null }], true);
    expect(t.lineas).toEqual([138960, null]);
    expect(t.subtotal).toBe(138960);
    expect(t.iva).toBe(26402);
    expect(t.total).toBe(165362);
    expect(t.sinValor).toBe(true);
  });

  it("sin IVA (valores con impuesto incluido o exentos) el total es el sub-total", () => {
    const t = totales([{ cantidad: 80, valorUnitario: 1737 }], false);
    expect(t.iva).toBe(0);
    expect(t.total).toBe(138960);
  });

  it("ofrece el ingreso en bodega solo para ítems ligados a un consumible", () => {
    expect(itemsParaIngresoBodega([{ consumibleId: "c1" }, { consumibleId: null }, {}])).toEqual([{ consumibleId: "c1" }]);
  });
});

describe("PDF del formulario IDIC-PG06-IT02-FORM01", () => {
  it("lleva el código del formulario, los rótulos y escapa los datos", () => {
    const h = htmlSolicitud({
      numero: "SA-LQC-2026-0001",
      estado: "visada",
      fecha: "2026-11-14",
      centroCosto: "LQC <script>",
      solicitanteNombre: "Analista PRUEBA",
      solicitanteCargo: null,
      delegacionAtribuciones: false,
      objetivo: "Objetivo PRUEBA",
      aplicaIva: true,
      items: [{ cantidad: 2, descripcion: "Reactivo PRUEBA", valorUnitario: 1000, unidadMedida: "frasco" }],
      ot: null,
      vb: { nombre: "Jefe PRUEBA", cargo: null, fecha: "14-11-2026" },
      sab: null,
      oc: null,
    });
    expect(h).toContain("IDIC-PG06-IT02-FORM01");
    expect(h).toContain("SOLICITUD DE ADQUISICIÓN DE BIENES Y/O SERVICIOS");
    expect(h).toContain("14/11/2026");
    expect(h).toContain("V°B° Jefe PRUEBA");
    expect(h).toContain("&lt;script&gt;");
    expect(h).not.toContain("<script>");
    expect(h).toContain("$2.380"); // 2 000 + 19 %
  });
});
