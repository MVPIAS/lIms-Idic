import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { getJwtSecret } from "../common/jwt-secret";

export interface JwtPayload {
  sub: string;
  username: string;
  tenantId: string;
  roles?: string[];
  permisos?: string[];
  // Tipo de token: "refresh" solo debe servir para renovar en /auth/refresh,
  // nunca como bearer de API. Los access token no llevan `type` (o "access").
  type?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(),
      // Se acota la verificación a HS256. Sin esto, la librería aceptaría
      // cualquier algoritmo declarado en el token (vector alg=none / confusión).
      algorithms: ["HS256"],
    });
  }

  // Lo que devuelve queda en req.user (lo usa PermisoGuard).
  async validate(payload: JwtPayload) {
    // Un refresh token (larga duración, 7d) NO puede usarse como credencial de
    // API: solo vale en POST /auth/refresh. Si se presenta como Bearer, se rechaza.
    if (payload.type === "refresh") {
      throw new UnauthorizedException("Token de refresco no válido como credencial de acceso");
    }
    return {
      sub: payload.sub,
      username: payload.username,
      tenantId: payload.tenantId,
      roles: payload.roles ?? [],
      permisos: payload.permisos ?? [],
    };
  }
}
