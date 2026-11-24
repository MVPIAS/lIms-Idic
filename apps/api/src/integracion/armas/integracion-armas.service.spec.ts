import { BadRequestException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { IntegracionArmasService } from "./integracion-armas.service";
import { BpchEntradaController } from "./integracion-armas.controller";
import { firmaHmac } from "./reglas-armas";

/**
 * Pruebas del servicio con una BD simulada: cada consulta se responde según
 * un fragmento de su SQL. El recorrido completo contra PostgreSQL y un BPCH
 * simulado está en scripts/verificacion/integracion-armas.js.
 */
const T = "00000000-0000-0000-0000-0000000000aa";
const OT = "00000000-0000-0000-0000-0000000000bb";

function bd(param: Record<string, string>, extra: { sql: RegExp; filas: any[] }[] = []) {
  const llamadas: { sql: string; args: any[] }[] = [];
  let evento: any = null;
  const responder = (sql: string, args: any[]) => {
    llamadas.push({ sql, args });
    if (/FROM parametro_sistema WHERE tenant_id/.test(sql)) return Object.entries(param).map(([codigo, valor]) => ({ codigo, valor, activo: true }));
    for (const e of extra) if (e.sql.test(sql)) return e.filas;
    // Evento guardado y luego aplicado (acuse antes de aplicar).
    if (/INSERT INTO integracion_armas_evento/.test(sql)) {
      evento = { tenantId: args[0], otId: args[3], datos: JSON.parse(args[8]), actaId: args[9] };
      return [{ id: "ev1" }];
    }
    if (/UPDATE integracion_armas_evento SET intentos/.test(sql)) return evento ? [evento] : [];
    return [];
  };
  return {
    llamadas,
    $queryRawUnsafe: jest.fn(async (sql: string, ...args: any[]) => responder(sql, args)),
    $executeRawUnsafe: jest.fn(async (sql: string, ...args: any[]) => (responder(sql, args), 1)),
  };
}

const avisos = () => ({ emitir: jest.fn(async () => ({ nuevos: 1, correo: "no_aplica" })) });

function servicio(param: Record<string, string>, extra: { sql: RegExp; filas: any[] }[] = [], env: Record<string, string> = {}) {
  const db = bd(param, extra);
  const av = avisos();
  const s = new IntegracionArmasService(db as any, av as any);
  s.env = { NODE_ENV: "test", JWT_SECRET: "jwt-prueba", ...env } as any;
  return { s, db, av };
}

const respuesta = (status: number, body: any) => ({ status, text: async () => JSON.stringify(body), json: async () => body }) as any;

const ACTIVA = { activa: "si", url_base: "https://armas.prueba", max_intentos: "3" };
const PENDIENTE = { sql: /FROM integracion_armas_envio WHERE estado = 'pendiente'/, filas: [{ id: "e1", tenantId: T, otId: OT, payload: { lims_ot_id: "PRUEBA-1" }, intentos: 0 }] };
const IDEM = { sql: /SELECT idempotency_key/, filas: [{ k: "11111111-1111-4111-8111-111111111111" }] };

describe("cola de envíos al BPCH", () => {
  it("201: envía con Bearer e idempotencia y guarda el bpch_id", async () => {
    const { s, db } = servicio(ACTIVA, [PENDIENTE, IDEM], { BPCH_ARMAS_TOKEN: "token-prueba" });
    s.fetcher = jest.fn(async () => respuesta(201, { codigo: 201, data: { bpch_id: 1289, estado_inicial: 1, estado_descripcion: "Pendiente" } }));
    await s.procesarCola();
    const [url, init] = (s.fetcher as jest.Mock).mock.calls[0];
    expect(url).toBe("https://armas.prueba/api/v1/integracion/lims/ordenes-trabajo");
    expect(init.headers).toMatchObject({ Authorization: "Bearer token-prueba", "X-Idempotency-Key": "11111111-1111-4111-8111-111111111111" });
    expect(db.llamadas.some((l) => /SET estado = \$2/.test(l.sql) && l.args[1] === "enviado")).toBe(true);
    expect(db.llamadas.some((l) => /SET bpch_id = COALESCE/.test(l.sql) && l.args[1] === 1289)).toBe(true);
  });

  it("409: ya registrada, se da por enviada", async () => {
    const { s, db } = servicio(ACTIVA, [PENDIENTE, IDEM], { BPCH_ARMAS_TOKEN: "t" });
    s.fetcher = jest.fn(async () => respuesta(409, { codigo: 409, data: { bpch_id: 77 } }));
    await s.procesarCola();
    expect(db.llamadas.some((l) => /SET bpch_id = COALESCE/.test(l.sql) && l.args[1] === 77)).toBe(true);
  });

  it("503: reintento con espera, sin aviso", async () => {
    const { s, db, av } = servicio(ACTIVA, [PENDIENTE, IDEM], { BPCH_ARMAS_TOKEN: "t" });
    s.fetcher = jest.fn(async () => respuesta(503, { error: "caído" }));
    await s.procesarCola();
    expect(db.llamadas.some((l) => /proximo_intento_at = now\(\) \+/.test(l.sql))).toBe(true);
    expect(av.emitir).not.toHaveBeenCalled();
  });

  it("400: error sin reintento y aviso a la D11/Comercial", async () => {
    const { s, db, av } = servicio(ACTIVA, [PENDIENTE, IDEM, { sql: /SELECT codigo, unidad_principal/, filas: [{ codigo: "PRUEBA-1", unidad: null }] }], { BPCH_ARMAS_TOKEN: "t" });
    s.fetcher = jest.fn(async () => respuesta(400, { detalles: ["cantidad_armas debe ser mayor a 0"] }));
    await s.procesarCola();
    expect(db.llamadas.some((l) => /SET estado = \$2/.test(l.sql) && l.args[1] === "error")).toBe(true);
    expect(av.emitir).toHaveBeenCalledWith(T, expect.objectContaining({ tipo: "armas_bpch_rechazo" }), expect.anything());
  });

  it("sin token o sin dirección: error y no llama", async () => {
    const { s, db } = servicio(ACTIVA, [PENDIENTE, IDEM]);
    s.fetcher = jest.fn();
    await s.procesarCola();
    expect(s.fetcher).not.toHaveBeenCalled();
    expect(db.llamadas.some((l) => /SET estado = \$2/.test(l.sql) && l.args[1] === "error")).toBe(true);
  });

  it("integración inactiva: no envía nada", async () => {
    const { s } = servicio({ activa: "no" }, [PENDIENTE]);
    s.fetcher = jest.fn();
    await s.procesarCola();
    expect(s.fetcher).not.toHaveBeenCalled();
  });
});

describe("avisos de estado del BPCH", () => {
  const OT_ENVIADA = { sql: /FROM integracion_armas_ot\s+WHERE tenant_id = \$1::uuid AND \(lims_ot_id/, filas: [{ otId: OT }] };
  const ULTIMO = (fecha: string | null, estado = 6) => ({ sql: /SELECT fecha_estado AS fecha, estado_externo AS estado/, filas: [{ fecha: fecha ? new Date(fecha) : null, estado }] });
  const OT_COD = { sql: /SELECT codigo, unidad_principal/, filas: [{ codigo: "PRUEBA-1", unidad: null }] };
  const opts = { tenantId: T, esperarAplicacion: true };

  it("inactiva → 503", async () => {
    const { s } = servicio({ activa: "no" });
    await expect(s.recibirEstado({ ot: "PRUEBA-1", estado: 6 }, "post", { tenantId: T })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("cuerpo inválido → 400 con detalles (no se guarda)", async () => {
    const { s, db } = servicio(ACTIVA);
    await expect(s.recibirEstado({ estado: 9 }, "post", { tenantId: T })).rejects.toBeInstanceOf(BadRequestException);
    expect(db.llamadas.some((l) => /INSERT INTO integracion_armas_evento/.test(l.sql))).toBe(false);
  });

  it("X-Event-ID repetido → 200 con duplicado: true, sin volver a aplicarlo", async () => {
    const { s, db } = servicio(ACTIVA, [OT_ENVIADA, { sql: /SELECT id FROM integracion_armas_evento WHERE tenant_id/, filas: [{ id: "ev0" }] }]);
    const r = await s.recibirEstado({ ot: "PRUEBA-1", estado: 6 }, "webhook", { tenantId: T, cabeceraEvento: "evt-1" });
    expect(r).toMatchObject({ codigo: 200, duplicado: true, evento_id: "evt-1" });
    expect(db.llamadas.some((l) => /INSERT INTO integracion_armas_historial/.test(l.sql))).toBe(false);
  });

  it("acuse: guarda el evento normalizado (con la hora tal cual) antes de aplicarlo", async () => {
    const { s, db } = servicio(ACTIVA, [OT_ENVIADA, ULTIMO(null)]);
    const r = await s.recibirEstado({ ot: "PRUEBA-1", estado: 6, fecha_cambio: "2026-11-23T10:00:00-03:00" }, "webhook", opts);
    expect(r).toMatchObject({ codigo: 200, procesado: true });
    const i = db.llamadas.findIndex((l) => /INSERT INTO integracion_armas_evento/.test(l.sql));
    const h = db.llamadas.findIndex((l) => /INSERT INTO integracion_armas_historial/.test(l.sql));
    expect(i).toBeGreaterThanOrEqual(0);
    expect(h).toBeGreaterThan(i);
    expect(db.llamadas[i].args[10]).toBe("2026-11-23T10:00:00-03:00");
    expect(db.llamadas[h].args[9]).toBe("2026-11-23T10:00:00-03:00");
  });

  it("devolución (Pendiente rechazado): historial y aviso de alta prioridad", async () => {
    const { s, db, av } = servicio(ACTIVA, [OT_ENVIADA, ULTIMO(null), OT_COD]);
    await s.recibirEstado({ ot: "PRUEBA-1", estado: 9, motivo: "Falta poder notarial (PRUEBA)" }, "post", opts);
    expect(db.llamadas.some((l) => /INSERT INTO integracion_armas_historial/.test(l.sql))).toBe(true);
    expect(av.emitir).toHaveBeenCalledWith(T, expect.objectContaining({ tipo: "armas_bpch_rechazo" }), expect.anything());
  });

  it("fuera de orden: no retrocede el estado, queda marcado en el historial", async () => {
    const { s, db } = servicio(ACTIVA, [OT_ENVIADA, ULTIMO("2026-11-23T12:00:00-03:00", 2)]);
    await s.recibirEstado({ ot: "PRUEBA-1", estado: 6, fecha_cambio: "2026-11-23T10:00:00-03:00" }, "webhook", { ...opts, cabeceraEvento: "evt-viejo" });
    expect(db.llamadas.some((l) => /UPDATE integracion_armas_ot SET estado_externo/.test(l.sql))).toBe(false);
    const h = db.llamadas.find((l) => /INSERT INTO integracion_armas_historial/.test(l.sql))!;
    expect(h.args[11]).toBe(true);
  });

  it("código desconocido: se guarda y avisa (no falla)", async () => {
    const { s, db, av } = servicio(ACTIVA, [OT_ENVIADA, ULTIMO(null), OT_COD]);
    const r = await s.recibirEstado({ ot: "PRUEBA-1", estado: 42 }, "post", opts);
    expect(r).toMatchObject({ codigo: 200, procesado: true });
    const h = db.llamadas.find((l) => /INSERT INTO integracion_armas_historial/.test(l.sql))!;
    expect(h.args[12]).toBe(true);
    expect(av.emitir).toHaveBeenCalled();
  });

  it("rechazo total (4) → notificación a la DGMN pendiente y aviso", async () => {
    const { s, db, av } = servicio(ACTIVA, [OT_ENVIADA, ULTIMO(null), OT_COD, { sql: /INSERT INTO bpch_notificacion_dgmn/, filas: [{ id: "n1" }] }]);
    await s.recibirEstado({ ot: "PRUEBA-1", estado: 4, motivo: "Arma no apta (PRUEBA)" }, "post", opts);
    const n = db.llamadas.find((l) => /INSERT INTO bpch_notificacion_dgmn/.test(l.sql))!;
    expect(n.args[3]).toBe("rechazo_total");
    expect(av.emitir).toHaveBeenCalledWith(T, expect.objectContaining({ mensaje: expect.stringMatching(/DGMN/) }), expect.anything());
  });

  it("certificado de rechazo como enlace → notificación a la DGMN pendiente", async () => {
    const { s, db } = servicio(ACTIVA, [OT_ENVIADA, ULTIMO(null), OT_COD, { sql: /INSERT INTO bpch_notificacion_dgmn/, filas: [{ id: "n1" }] }]);
    await s.recibirEstado({ ot: "PRUEBA-1", estado: 6, enlaces: [{ tipo: "certificado_rechazo", numero_serie: "S9", url: "https://armas.prueba/r/9" }] }, "post", opts);
    const n = db.llamadas.find((l) => /INSERT INTO bpch_notificacion_dgmn/.test(l.sql))!;
    expect(n.args[3]).toBe("certificado_rechazo:S9");
  });

  it("enlaces: guarda los permitidos y descarta los de otro servidor; nunca PDF de certificados; disparos", async () => {
    const { s, db } = servicio(ACTIVA, [OT_ENVIADA, ULTIMO(null)]);
    const r: any = await s.recibirEstado(
      {
        ot: "PRUEBA-1",
        estado: 6,
        total_disparos: 6,
        url_ot: "https://armas.prueba/ot/1",
        certificados: [
          { numero_serie: "S1", url: "https://armas.prueba/c/1", base64: "JVBERi0=", total_disparos: 2 },
          { numero_serie: "S2", url: "https://malicioso.ejemplo/c/2" },
        ],
      },
      "post",
      opts,
    );
    const inserts = db.llamadas.filter((l) => /INSERT INTO integracion_armas_enlace/.test(l.sql));
    expect(inserts.map((l) => l.args[6])).toEqual(["https://armas.prueba/ot/1", "https://armas.prueba/c/1"]);
    expect(inserts[1].args[8]).toBe(2);
    expect(r.enlaces_rechazados).toHaveLength(1);
    expect(db.llamadas.some((l) => /registro_adjunto/.test(l.sql))).toBe(false);
    expect(db.llamadas.some((l) => /UPDATE integracion_armas_ot SET estado_externo/.test(l.sql) && l.args[8] === 6)).toBe(true);
  });

  it("acta en PDF inválido → 400 y no se guarda nada (el BPCH puede reintentar)", async () => {
    const { s, db } = servicio(ACTIVA, [OT_ENVIADA]);
    await expect(
      s.recibirEstado({ ot: "PRUEBA-1", estado: 8, documento_cierre: { tipo: "acta_finalizacion", base64: Buffer.from("no pdf").toString("base64") } }, "post", opts),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.llamadas.some((l) => /INSERT INTO integracion_armas_evento/.test(l.sql))).toBe(false);
  });

  it("acta con guardar_acta_pdf = no: no se guarda el PDF", async () => {
    const { s, db } = servicio({ ...ACTIVA, guardar_acta_pdf: "no" }, [OT_ENVIADA, ULTIMO(null)]);
    const pdf = Buffer.from("%PDF-1.4 PRUEBA").toString("base64");
    await s.recibirEstado({ ot: "PRUEBA-1", estado: 8, documento_cierre: { tipo: "acta_finalizacion", base64: pdf } }, "post", opts);
    expect(db.llamadas.some((l) => /INSERT INTO registro_adjunto/.test(l.sql))).toBe(false);
  });
});

describe("enlaces pedidos al BPCH", () => {
  const ENVIADA = { sql: /SELECT lims_ot_id AS lims, bpch_id::text AS bpch/, filas: [{ lims: "PRUEBA-1", bpch: "1289" }] };
  it("sin ruta configurada no llama", async () => {
    const { s } = servicio(ACTIVA, [ENVIADA], { BPCH_ARMAS_TOKEN: "t" });
    s.fetcher = jest.fn();
    const r = await s.pedirEnlaces(T, OT);
    expect(r.pedidos).toBe(false);
    expect(s.fetcher).not.toHaveBeenCalled();
  });
  it("con ruta: GET sin seguir redirecciones y guarda los enlaces", async () => {
    const { s, db } = servicio({ ...ACTIVA, ruta_enlaces_ot: "/api/v1/integracion/lims/ordenes-trabajo/{bpch_id}/enlaces" }, [ENVIADA], { BPCH_ARMAS_TOKEN: "t" });
    s.fetcher = jest.fn(async () => respuesta(200, { certificados: [{ numero_serie: "S1", url: "https://armas.prueba/c/1" }] }));
    const r = await s.pedirEnlaces(T, OT);
    const [url, init] = (s.fetcher as jest.Mock).mock.calls[0];
    expect(url).toBe("https://armas.prueba/api/v1/integracion/lims/ordenes-trabajo/1289/enlaces");
    expect(init.redirect).toBe("manual");
    expect(r).toMatchObject({ pedidos: true, guardados: 1 });
    expect(db.llamadas.some((l) => /INSERT INTO integracion_armas_enlace/.test(l.sql))).toBe(true);
  });
});

describe("webhook: firma obligatoria", () => {
  const cuerpo = Buffer.from('{"ot":"PRUEBA-1","estado":6}');
  const svc = { recibirEstado: jest.fn(async () => ({ codigo: 200 })) };
  const ctl = new BpchEntradaController(svc as any);
  const antes = process.env.BPCH_ARMAS_HMAC_SECRET;
  afterAll(() => {
    process.env.BPCH_ARMAS_HMAC_SECRET = antes;
  });

  it("sin clave configurada → 401", async () => {
    delete process.env.BPCH_ARMAS_HMAC_SECRET;
    await expect(ctl.webhook(firmaHmac(cuerpo, "x"), "evt", { rawBody: cuerpo, body: {} })).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it("firma inválida → 401", async () => {
    process.env.BPCH_ARMAS_HMAC_SECRET = "clave-prueba";
    await expect(ctl.webhook(firmaHmac(cuerpo, "otra"), "evt", { rawBody: cuerpo, body: {} })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(svc.recibirEstado).not.toHaveBeenCalled();
  });
  it("firma válida → procesa con el X-Event-ID", async () => {
    process.env.BPCH_ARMAS_HMAC_SECRET = "clave-prueba";
    await ctl.webhook(firmaHmac(cuerpo, "clave-prueba"), "evt-9", { rawBody: cuerpo, body: { ot: "PRUEBA-1", estado: 6 } });
    expect(svc.recibirEstado).toHaveBeenCalledWith({ ot: "PRUEBA-1", estado: 6 }, "webhook", { cabeceraEvento: "evt-9", firmaValida: true });
  });
});
