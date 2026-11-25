import { elementoBandeja, filtrarPorPermiso, type ItemBandeja } from "./bandeja.service";

const item = (clave: string, ruta: string): ItemBandeja => ({ clave, titulo: clave, descripcion: "", cantidad: 1, ruta, severidad: "warn" });

describe("Mi bandeja · solo tarjetas que el usuario puede abrir", () => {
  const items = [
    item("ot_asignadas", "/ot?mias=1&estado=abiertas"),
    item("resultados_devueltos", "/captura-ot?estado=devuelto,rechazado&mios=1"),
    item("firmas_pendientes", "/informes/por-firmar"),
    item("documentos_por_entregar", "/certificados?estado=por_entregar"),
    item("sin_regla", "/algo-nuevo"),
  ];

  it("Recepción (perfil analista, sin resultado.ver ni documento.firmar) no recibe esas tarjetas", () => {
    const r = filtrarPorPermiso(items, ["ot.ver", "muestra.crear"]);
    expect(r.map((i) => i.clave)).toEqual(["ot_asignadas", "documentos_por_entregar", "sin_regla"]);
  });

  it("gana el prefijo más largo: /informes/por-firmar pide documento.firmar, no certificado.emitir", () => {
    expect(filtrarPorPermiso([item("f", "/informes/por-firmar")], ["certificado.emitir"])).toEqual([]);
    expect(filtrarPorPermiso([item("e", "/informes?estado=en_revision")], ["certificado.emitir"])).toHaveLength(1);
  });

  it("sin lista de permisos no filtra; SUPERADMIN lo ve todo", () => {
    expect(filtrarPorPermiso(items, undefined)).toHaveLength(items.length);
    expect(filtrarPorPermiso(items, [], ["SUPERADMIN"])).toHaveLength(items.length);
  });

  it("«Ensayos derivados por capturar» lleva a la captura: la ve quien tiene resultado.ver (D02-25)", () => {
    const d = item("derivados_por_capturar", "/captura-ot?estado=pendiente,devuelto,rechazado&derivados=1");
    expect(filtrarPorPermiso([d], ["ot.ver", "resultado.ver", "resultado.crear"])).toHaveLength(1);
    expect(filtrarPorPermiso([d], ["ot.ver", "muestra.crear"])).toEqual([]);
  });
});

describe("Mi bandeja · OT migradas del sistema anterior", () => {
  const base = { id: "1", texto: "OT-PRUEBA-1", detalle: "LQC · PRUEBA", ruta: "/ot/1", fecha: null };
  it("una OT nueva no lleva la marca", () => {
    expect(elementoBandeja({ ...base, migrada: false, migrada_desde: null, migrada_en: null })).toEqual({ ...base });
    expect(elementoBandeja(base)).toEqual({ ...base });
  });
  it("una OT migrada lleva el folio original y la fecha de carga", () => {
    const en = new Date("2026-12-01T12:00:00Z");
    expect(elementoBandeja({ ...base, migrada: true, migrada_desde: "PRUEBA-24001", migrada_en: en })).toEqual({
      ...base,
      migrada: { desde: "PRUEBA-24001", en: "2026-12-01T12:00:00.000Z" },
    });
  });
});
