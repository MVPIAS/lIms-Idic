import { JwtService } from "@nestjs/jwt";

const SECRETO = "secreto-de-prueba-del-limitador-0123456789";
process.env.JWT_SECRET = SECRETO;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { claveLimitador } = require("./user-throttler.guard");

/** JWT con la cabecera y el cuerpo que se quiera y una firma inventada (no verificable). */
const sinFirma = (payload: object) =>
  [{ alg: "HS256", typ: "JWT" }, payload].map((x) => Buffer.from(JSON.stringify(x)).toString("base64url")).join(".") + ".firma-inventada";

describe("limitador de peticiones · clave (revisión de seguridad r3)", () => {
  const ip = "10.0.0.7";
  it("un token válido limita por usuario", () => {
    const t = new JwtService({ secret: SECRETO }).sign({ sub: "usuario-1" }, { algorithm: "HS256" });
    expect(claveLimitador({ headers: { authorization: `Bearer ${t}` }, ip })).toBe("user:usuario-1");
  });
  it("un JWT inventado (sin firma válida) no da cupo nuevo: limita por IP", () => {
    for (const sub of ["a", "b", "c"]) expect(claveLimitador({ headers: { authorization: `Bearer ${sinFirma({ sub })}` }, ip })).toBe(`ip:${ip}`);
    const ajeno = new JwtService({ secret: "otro-secreto-de-32-caracteres-o-mas!!" }).sign({ sub: "x" });
    expect(claveLimitador({ headers: { authorization: `Bearer ${ajeno}` }, ip })).toBe(`ip:${ip}`);
  });
  it("alg=none o sin token: por IP", () => {
    const none = [{ alg: "none" }, { sub: "x" }].map((x) => Buffer.from(JSON.stringify(x)).toString("base64url")).join(".") + ".";
    expect(claveLimitador({ headers: { authorization: `Bearer ${none}` }, ip })).toBe(`ip:${ip}`);
    expect(claveLimitador({ headers: {}, ip })).toBe(`ip:${ip}`);
  });
});
