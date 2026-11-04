/**
 * Circuito del token de integración con Prisma y AlcanceService simulados:
 * alta (validaciones, hash guardado, token devuelto una vez) y validación de
 * cada petición (vigente, revocado, hash distinto).
 */
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "secreto-de-prueba-para-jest-0000000000000";

import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { TokenIntegracionService } from "./token-integracion.service";
import { hashToken } from "./token-integracion.reglas";

const TENANT = "00000000-0000-4000-8000-000000000001";
const ADMIN = "00000000-0000-4000-8000-0000000000aa";
const ROL_GLOBAL = { id: "00000000-0000-4000-8000-000000000010", codigo: "COMERCIAL", nombre: "Comercial", aliasDe: null, alcance: "GLOBAL" };
const ROL_UNIDAD = { id: "00000000-0000-4000-8000-000000000011", codigo: "ANALISTA", nombre: "Analista", aliasDe: null, alcance: "UNIDAD" };
const ROL_SUPER = { id: "00000000-0000-4000-8000-000000000012", codigo: "SUPERADMIN", nombre: "Super Administrador", aliasDe: null, alcance: "GLOBAL" };
const CUENTA = "00000000-0000-4000-8000-0000000000c1";

function montar() {
  const insertados: any[][] = [];
  const roles = [ROL_GLOBAL, ROL_UNIDAD, ROL_SUPER];
  const tx = {
    usuario: { create: jest.fn(async ({ data }: any) => ({ id: CUENTA, username: data.username })) },
    usuarioRol: { create: jest.fn(async () => ({})) },
    $executeRawUnsafe: jest.fn(async (_sql: string, ...p: any[]) => {
      insertados.push(p);
      return 1;
    }),
  };
  const prisma: any = {
    rol: { findFirst: jest.fn(async ({ where }: any) => roles.find((r) => r.id === where.id) ?? null) },
    unidad: { findFirst: jest.fn(async () => ({ id: "u1", codigo: "LQA", activa: true })) },
    usuario: { findFirst: jest.fn(async () => null) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
    $queryRawUnsafe: jest.fn(),
    $executeRawUnsafe: jest.fn(async () => 1),
  };
  const alcance: any = {
    contexto: jest.fn(async () => ({
      esGlobal: true,
      unidadIds: [],
      perfil: "COMERCIAL",
      asignacionesVigentes: [{ rolCodigo: "COMERCIAL", permisos: ["cliente.ver", "cotizacion.ver"] }],
    })),
  };
  const req = { user: { tenantId: TENANT, sub: ADMIN } };
  return { svc: new TokenIntegracionService(prisma, alcance), prisma, tx, insertados, req, alcance };
}

describe("TokenIntegracionService · alta", () => {
  it("crea la cuenta de servicio, guarda solo el hash y devuelve el token una vez", async () => {
    const { svc, tx, insertados, req } = montar();
    const r = await svc.crear({ nombre: "ERP Finanzas", rolId: ROL_GLOBAL.id, diasVigencia: 365 }, req);
    expect(r.cuenta).toBe("api.erp-finanzas");
    expect(tx.usuario.create.mock.calls[0][0].data.estado).toBe("servicio");
    expect(typeof r.token).toBe("string");
    const fila = insertados[0];
    expect(fila[7]).toBe(hashToken(r.token)); // token_hash
    expect(fila).not.toContain(r.token); // el token en claro no se guarda
    const payload: any = new JwtService({ secret: process.env.JWT_SECRET }).verify(r.token);
    expect(payload).toMatchObject({ sub: CUENTA, type: "integracion", jti: r.id, tenantId: TENANT });
    expect(payload.exp - payload.iat).toBe(365 * 86400);
  });

  it("rechaza el rol SUPERADMIN y exige unidad a los roles por unidad", async () => {
    const { svc, req } = montar();
    await expect(svc.crear({ nombre: "X total", rolId: ROL_SUPER.id, diasVigencia: 30 }, req)).rejects.toThrow(BadRequestException);
    await expect(svc.crear({ nombre: "LIMS lab", rolId: ROL_UNIDAD.id, diasVigencia: 30 }, req)).rejects.toThrow(/indique el laboratorio/);
    await expect(svc.crear({ nombre: "Global", rolId: ROL_GLOBAL.id, unidadId: "00000000-0000-4000-8000-000000000001", diasVigencia: 30 }, req)).rejects.toThrow(/alcance global/);
    await expect(svc.crear({ nombre: "ERP", rolId: ROL_GLOBAL.id, diasVigencia: 2000 }, req)).rejects.toThrow();
  });
});

describe("TokenIntegracionService · validación de cada petición", () => {
  async function conToken() {
    const m = montar();
    const r = await m.svc.crear({ nombre: "ERP", rolId: ROL_GLOBAL.id, diasVigencia: 30 }, m.req);
    const fila = {
      id: r.id,
      tenant_id: TENANT,
      nombre: "ERP",
      usuario_id: CUENTA,
      token_hash: hashToken(r.token),
      expira_at: new Date(Date.now() + 86_400_000),
      revocado_at: null as Date | null,
      usuario_estado: "servicio",
      usuario_borrado: false,
      username: "api.erp",
    };
    m.prisma.$queryRawUnsafe.mockImplementation(async (sql: string) =>
      sql.includes("parametro_sistema") ? [{ valor: "si", activo: true }] : [fila],
    );
    const payload: any = new JwtService({ secret: process.env.JWT_SECRET }).verify(r.token);
    const peticion = () => ({ headers: { authorization: `Bearer ${r.token}` }, ip: "10.0.0.5" });
    return { ...m, r, fila, payload, peticion };
  }

  it("acepta un token vigente con los permisos del rol más la documentación", async () => {
    const { svc, payload, peticion, prisma } = await conToken();
    const req: any = peticion();
    const u = await svc.validar(req, payload);
    expect(u.sub).toBe(CUENTA);
    expect(u.permisos).toEqual(["cliente.ver", "cotizacion.ver", "integracion.documentacion"]);
    expect(u.integracion).toMatchObject({ nombre: "ERP", auditarLecturas: true });
    // Segunda validación en el mismo request (AuthGuard del controlador): memoizada.
    await svc.validar(req, payload);
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRawUnsafe.mock.calls[0][2]).toBe("10.0.0.5");
  });

  it("rechaza un token revocado o con otro hash", async () => {
    const t = await conToken();
    t.fila.revocado_at = new Date();
    await expect(t.svc.validar(t.peticion(), t.payload)).rejects.toThrow(new UnauthorizedException("El token de integración fue revocado."));
    t.fila.revocado_at = null;
    t.fila.token_hash = hashToken("otro");
    await expect(t.svc.validar(t.peticion(), t.payload)).rejects.toThrow("El token de integración no es válido.");
  });
});
