import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { getJwtSecret } from "../common/jwt-secret";

export interface JwtPayload {
  sub: string;
  username: string;
  tenantId: string;
  roles?: string[];
  permisos?: string[];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(),
    });
  }

  // Lo que devuelve queda en req.user (lo usa PermisoGuard).
  async validate(payload: JwtPayload) {
    return {
      sub: payload.sub,
      username: payload.username,
      tenantId: payload.tenantId,
      roles: payload.roles ?? [],
      permisos: payload.permisos ?? [],
    };
  }
}
