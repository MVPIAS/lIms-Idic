import { accedeACorreos, filtroAlcanceCorreo, sqlUnidadesCotizacionDe, type AmbitoCorreo } from "./alcance-correo";

const base: AmbitoCorreo = {
  usuarioId: "u1",
  email: "Ana@IDIC.cl",
  global: false,
  otVisibles: ["lab1"],
  cotVisibles: ["lab1"],
  verClientes: false,
};

/** Marcadores $n usados en el SQL, sin repetir y ordenados. */
const marcadores = (sql: string) => [...new Set([...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);

describe("alcance del historial de correos", () => {
  it("numera los parámetros desde el indicado y sin huecos", () => {
    const f = filtroAlcanceCorreo(base, 4);
    expect(marcadores(f.sql)).toEqual([4, 5, 6, 7]);
    expect(f.args).toEqual(["u1", "ana@idic.cl", ["lab1"], ["lab1"]]);
  });

  it("remitente, destinatario por correo o destinatario del mensaje interno: siempre", () => {
    const f = filtroAlcanceCorreo({ ...base, otVisibles: [], cotVisibles: [] }, 1);
    expect(f.sql).toContain("ce.enviado_por = $1::uuid");
    expect(f.sql).toContain("$2 = ANY(string_to_array(lower(");
    expect(f.sql).toContain("md.usuario_id = $1::uuid");
    // Sin alcance sobre nada: ningún correo ajeno por entidad.
    expect(f.sql).toContain("ce.tipo <> 'mensaje' AND FALSE");
  });

  it("la copia de un mensaje interno ajeno no se ve ni siendo global", () => {
    const f = filtroAlcanceCorreo({ ...base, global: true }, 1);
    expect(f.sql).toContain("(ce.tipo <> 'mensaje' AND TRUE)");
    expect(f.args).toEqual(["u1", "ana@idic.cl"]);
  });

  it("sin correo propio no compara destinatarios", () => {
    const f = filtroAlcanceCorreo({ ...base, email: null, otVisibles: null, cotVisibles: null }, 1);
    expect(f.sql).not.toContain("string_to_array");
    expect(f.sql).toContain("ce.ot_id IS NOT NULL OR ce.cotizacion_id IS NOT NULL");
    expect(f.args).toEqual(["u1"]);
  });

  it("solo cliente: con cliente.ver", () => {
    expect(filtroAlcanceCorreo({ ...base, verClientes: true }, 1).sql).toContain("ce.ot_id IS NULL AND ce.cotizacion_id IS NULL AND ce.cliente_id IS NOT NULL");
    expect(filtroAlcanceCorreo(base, 1).sql).not.toContain("ce.cliente_id IS NOT NULL");
  });

  it("las unidades de la cotización salen de su columna", () => {
    const sql = sqlUnidadesCotizacionDe("ce.cotizacion_id");
    expect(sql).not.toContain("$1");
    expect(sql).toContain("c.id = ce.cotizacion_id");
  });

  it("el SQL de unidades usa alias propios que la columna externa no debe repetir", () => {
    // Si la columna fuera «c.id», la subconsulta compararía c.id consigo misma.
    expect(sqlUnidadesCotizacionDe("cz.id")).toMatch(/FROM cotizacion c JOIN/);
    expect(filtroAlcanceCorreo(base, 1).sql).toContain("c.id = ce.cotizacion_id");
  });

  it("acceso: correo.enviar o cotizacion.ver", () => {
    expect(accedeACorreos(["correo.enviar"], [])).toBe(true);
    expect(accedeACorreos(["cotizacion.ver"], [])).toBe(true);
    expect(accedeACorreos(["mensaje.usar"], [])).toBe(false);
    expect(accedeACorreos([], ["SUPERADMIN"])).toBe(true);
  });
});
