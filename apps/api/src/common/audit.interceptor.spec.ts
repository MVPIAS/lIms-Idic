/**
 * Tests del interceptor de auditoría (`audit.interceptor.ts`).
 *
 * Requisito 17025 + pentesting: la bitácora NUNCA debe contener secretos
 * (password/hash/token/secret/authorization/cookie/apikey en cualquier nivel),
 * la IP se normaliza a un formato admisible por INET, y un fallo de auditoría
 * jamás puede tumbar una petición ya respondida. Prisma se mockea.
 */
import { Logger } from "@nestjs/common";
import { of } from "rxjs";
import { AuditInterceptor } from "./audit.interceptor";
import { PrismaService } from "./prisma.service";

function nuevoInterceptor(createImpl?: (...a: any[]) => any) {
  const create = jest.fn(createImpl ?? (async () => ({})));
  const prisma = { auditLog: { create } } as unknown as PrismaService;
  return { interceptor: new AuditInterceptor(prisma), create };
}

/** Acceso a los métodos privados sin cambiar producción. */
const priv = (i: AuditInterceptor) => i as unknown as {
  sanear(v: any, prof?: number): any;
  ipValida(req: any): string | null;
  diff(req: any, data: any): any;
  registrar(req: any, data: any, status?: number): Promise<void>;
};

describe("AuditInterceptor.sanear · redacción de secretos", () => {
  const { interceptor } = nuevoInterceptor();
  const s = priv(interceptor);

  it("redacta claves sensibles de primer nivel (variantes por inclusión)", () => {
    const out = s.sanear({
      username: "juan",
      password: "hunter2",
      passwordHash: "$argon2...",
      newPassword: "x",
      refreshToken: "abc",
      totpSecret: "S3",
      apiKey: "k",
      authorization: "Bearer z",
      cookie: "sid=1",
    });
    expect(out.username).toBe("juan");
    for (const k of ["password", "passwordHash", "newPassword", "refreshToken", "totpSecret", "apiKey", "authorization", "cookie"]) {
      expect(out[k]).toBe("[REDACTADO]");
    }
  });

  it("redacta secretos ANIDADOS en objetos y dentro de arrays", () => {
    const out = s.sanear({
      nivel1: { token: "t", ok: 1, nivel2: { adminPassword: "p", nombre: "n" } },
      lista: [{ apikey: "k1" }, { valor: 5 }],
    });
    expect(out.nivel1.token).toBe("[REDACTADO]");
    expect(out.nivel1.ok).toBe(1);
    expect(out.nivel1.nivel2.adminPassword).toBe("[REDACTADO]");
    expect(out.nivel1.nivel2.nombre).toBe("n");
    expect(out.lista[0].apikey).toBe("[REDACTADO]");
    expect(out.lista[1].valor).toBe(5);
  });

  it("es case-insensitive (PASSWORD, Token…)", () => {
    const out = s.sanear({ PASSWORD: "a", Authorization: "b", MiToken: "c" });
    expect(out.PASSWORD).toBe("[REDACTADO]");
    expect(out.Authorization).toBe("[REDACTADO]");
    expect(out.MiToken).toBe("[REDACTADO]");
  });

  it("corta la recursión profunda (prof > 6 → [REDACTADO]) evitando DoS por anidamiento", () => {
    let nodo: any = { fin: 1 };
    for (let i = 0; i < 10; i++) nodo = { hijo: nodo };
    const out = s.sanear(nodo);
    // A cierta profundidad el subárbol se colapsa a [REDACTADO]; no debe lanzar.
    expect(() => JSON.stringify(out)).not.toThrow();
    expect(JSON.stringify(out)).toContain("[REDACTADO]");
  });

  it("trunca arrays gigantes a 100 elementos", () => {
    const out = s.sanear(Array.from({ length: 250 }, (_, i) => i));
    expect(out).toHaveLength(100);
  });

  it("respeta null/undefined y primitivos sin tocarlos", () => {
    expect(s.sanear(null)).toBeNull();
    expect(s.sanear(undefined)).toBeUndefined();
    expect(s.sanear(42)).toBe(42);
    expect(s.sanear("texto")).toBe("texto");
  });
});

describe("AuditInterceptor.ipValida · normalización INET", () => {
  const { interceptor } = nuevoInterceptor();
  const s = priv(interceptor);

  it("desmapea IPv4 mapeada en IPv6 (::ffff:10.0.0.1 → 10.0.0.1)", () => {
    expect(s.ipValida({ ip: "::ffff:10.0.0.1" })).toBe("10.0.0.1");
  });
  it("acepta IPv4 válida tal cual", () => {
    expect(s.ipValida({ ip: "192.168.1.20" })).toBe("192.168.1.20");
  });
  it("acepta IPv6 tal cual", () => {
    expect(s.ipValida({ ip: "2001:db8::1" })).toBe("2001:db8::1");
  });
  it("rechaza octetos fuera de rango devolviendo null (no revienta el INSERT)", () => {
    expect(s.ipValida({ ip: "999.1.1.1" })).toBeNull();
  });
  it("cae a socket.remoteAddress si req.ip no está", () => {
    expect(s.ipValida({ socket: { remoteAddress: "10.1.2.3" } })).toBe("10.1.2.3");
  });
  it("sin IP alguna → null", () => {
    expect(s.ipValida({})).toBeNull();
  });
});

describe("AuditInterceptor.diff · payload registrado", () => {
  const { interceptor } = nuevoInterceptor();
  const s = priv(interceptor);

  it("guarda el body saneado bajo 'despues'", () => {
    const d = s.diff({ method: "POST", body: { nombre: "X", password: "p" } }, {});
    expect(d.despues.nombre).toBe("X");
    expect(d.despues.password).toBe("[REDACTADO]");
  });
  it("en DELETE deja constancia del id eliminado", () => {
    const d = s.diff({ method: "DELETE", params: { id: "abc" }, body: {} }, {});
    expect(d.eliminado).toBe("abc");
  });
  it("sin body ni delete → undefined (no escribe diff vacío)", () => {
    expect(s.diff({ method: "PATCH", body: {} }, {})).toBeUndefined();
  });
  it("payload gigante se resume (truncado) en vez de guardarse entero", () => {
    const grande = { texto: "a".repeat(9000) };
    const d = s.diff({ method: "POST", body: grande }, {});
    expect(d.truncado).toBe(true);
    expect(d.bytes).toBeGreaterThan(8000);
    expect(d.claves).toContain("texto");
  });
});

describe("AuditInterceptor.registrar · robustez y tenant", () => {
  it("no escribe nada si no hay tenant (p. ej. login público)", async () => {
    const { interceptor, create } = nuevoInterceptor();
    await priv(interceptor).registrar({ method: "POST", user: undefined, body: {} }, {});
    expect(create).not.toHaveBeenCalled();
  });

  it("escribe en audit_log con datos saneados cuando hay tenant", async () => {
    const { interceptor, create } = nuevoInterceptor();
    await priv(interceptor).registrar(
      {
        method: "POST",
        originalUrl: "/api/clientes",
        user: { tenantId: "t1", username: "juan", sub: "no-uuid" },
        body: { nombre: "ACME", password: "secreto" },
        headers: { "user-agent": "jest" },
        ip: "10.0.0.5",
      },
      { id: "no-uuid", codigo: "CLI-1" },
      201,
    );
    expect(create).toHaveBeenCalledTimes(1);
    const arg = create.mock.calls[0][0].data;
    expect(arg.tenantId).toBe("t1");
    expect(arg.diff.despues.password).toBe("[REDACTADO]");
    expect(arg.diff.despues.nombre).toBe("ACME");
    expect(arg.metadata.statusCode).toBe(201);
  });

  it("un fallo de Prisma NO propaga (la petición ya respondió); se loguea", async () => {
    const errSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const { interceptor } = nuevoInterceptor(async () => {
      throw new Error("DB caída");
    });
    await expect(
      priv(interceptor).registrar(
        { method: "POST", user: { tenantId: "t1" }, body: { a: 1 }, headers: {} },
        {},
      ),
    ).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe("AuditInterceptor.intercept · sólo audita mutaciones OK", () => {
  function ctxHttp(method: string) {
    return {
      getType: () => "http",
      switchToHttp: () => ({
        getRequest: () => ({ method, user: { tenantId: "t1" }, body: { x: 1 }, headers: {} }),
        getResponse: () => ({ statusCode: 200 }),
      }),
    } as any;
  }

  it("una lectura (GET) no dispara auditoría", (done) => {
    const { interceptor, create } = nuevoInterceptor();
    const handler = { handle: () => of({ id: "1" }) } as any;
    interceptor.intercept(ctxHttp("GET"), handler).subscribe(() => {
      expect(create).not.toHaveBeenCalled();
      done();
    });
  });

  it("una mutación (POST) que termina bien registra (create llamado)", (done) => {
    const { interceptor, create } = nuevoInterceptor();
    const handler = { handle: () => of({ id: "1", codigo: "C1" }) } as any;
    interceptor.intercept(ctxHttp("POST"), handler).subscribe(async () => {
      // registrar() se lanza sin await dentro del tap; se resuelve en microtask.
      await Promise.resolve();
      await Promise.resolve();
      expect(create).toHaveBeenCalledTimes(1);
      done();
    });
  });

  it("un contexto no-http se ignora (rpc/ws)", (done) => {
    const { interceptor, create } = nuevoInterceptor();
    const ctx = { getType: () => "rpc" } as any;
    const handler = { handle: () => of({ ok: true }) } as any;
    interceptor.intercept(ctx, handler).subscribe(() => {
      expect(create).not.toHaveBeenCalled();
      done();
    });
  });
});
