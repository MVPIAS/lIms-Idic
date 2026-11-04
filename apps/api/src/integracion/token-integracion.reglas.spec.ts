import {
  ESTADO_CUENTA_SERVICIO,
  PERMISO_DOCUMENTACION,
  bearerDe,
  estadoToken,
  expiracion,
  hashToken,
  mismoHash,
  motivoRechazo,
  permisosToken,
  sufijoToken,
  usernameServicio,
} from "./token-integracion.reglas";

describe("tokens de integración · reglas", () => {
  const ahora = new Date("2026-11-03T15:00:00.000Z");
  const token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.firma-de-prueba";
  const fila = {
    usuarioId: "11111111-1111-4111-8111-111111111111",
    tokenHash: hashToken(token),
    revocadoAt: null,
    expiraAt: new Date("2027-11-03T15:00:00.000Z"),
    usuarioEstado: ESTADO_CUENTA_SERVICIO,
    usuarioBorrado: false,
  };

  it("guarda solo el hash SHA-256 (64 hex) y lo compara en tiempo constante", () => {
    const h = hashToken(token);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain(token);
    expect(mismoHash(h, hashToken(token))).toBe(true);
    expect(mismoHash(h, hashToken(token + "x"))).toBe(false);
    expect(mismoHash(h, null)).toBe(false);
    expect(mismoHash(h, "abc")).toBe(false);
  });

  it("muestra solo los últimos 6 caracteres", () => {
    expect(sufijoToken(token)).toBe("prueba");
  });

  it("deriva el usuario de la cuenta de servicio sin tildes ni símbolos", () => {
    expect(usernameServicio("ERP Finanzas (SIGFE)")).toBe("api.erp-finanzas-sigfe");
    expect(usernameServicio("Sistema Logístico Ñuble")).toBe("api.sistema-logistico-nuble");
    expect(usernameServicio("   ")).toBe("api.integracion");
    expect(usernameServicio("x".repeat(80)).length).toBeLessThanOrEqual(48);
  });

  it("calcula la expiración y el estado", () => {
    expect(expiracion(ahora, 30).toISOString()).toBe("2026-12-03T15:00:00.000Z");
    expect(estadoToken({ expiraAt: "2026-12-01T00:00:00Z" }, ahora)).toBe("vigente");
    expect(estadoToken({ expiraAt: "2026-11-03T15:00:00Z" }, ahora)).toBe("vencido");
    expect(estadoToken({ expiraAt: "2027-01-01T00:00:00Z", revocadoAt: ahora }, ahora)).toBe("revocado");
  });

  it("acepta un token vigente con su hash y su cuenta de servicio", () => {
    expect(motivoRechazo(fila, { sub: fila.usuarioId, hash: hashToken(token) }, ahora)).toBeNull();
  });

  it("rechaza con una frase clara cada caso", () => {
    const presentado = { sub: fila.usuarioId, hash: hashToken(token) };
    expect(motivoRechazo(null, presentado, ahora)).toBe("El token de integración no existe.");
    expect(motivoRechazo(fila, { ...presentado, hash: hashToken("otro") }, ahora)).toBe("El token de integración no es válido.");
    expect(motivoRechazo(fila, { ...presentado, sub: "otro" }, ahora)).toBe("El token de integración no es válido.");
    expect(motivoRechazo({ ...fila, revocadoAt: ahora }, presentado, ahora)).toBe("El token de integración fue revocado.");
    expect(motivoRechazo({ ...fila, expiraAt: "2026-01-01T00:00:00Z" }, presentado, ahora)).toBe("El token de integración está vencido.");
    expect(motivoRechazo({ ...fila, usuarioEstado: "activo" }, presentado, ahora)).toBe("La cuenta de servicio del token está desactivada.");
    expect(motivoRechazo({ ...fila, usuarioBorrado: true }, presentado, ahora)).toBe("La cuenta de servicio del token está desactivada.");
  });

  it("suma la documentación de la API a los permisos del rol, sin duplicados", () => {
    expect(permisosToken(["ot.ver", "cliente.ver", "ot.ver"])).toEqual(["cliente.ver", PERMISO_DOCUMENTACION, "ot.ver"]);
    expect(permisosToken([])).toEqual([PERMISO_DOCUMENTACION]);
  });

  it("lee el Bearer de la cabecera", () => {
    expect(bearerDe("Bearer abc.def")).toBe("abc.def");
    expect(bearerDe("bearer   abc ")).toBe("abc");
    expect(bearerDe("Basic xyz")).toBeNull();
    expect(bearerDe(undefined)).toBeNull();
  });
});
