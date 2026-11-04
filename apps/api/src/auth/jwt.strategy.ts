import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { getJwtSecret } from "../common/jwt-secret";
import { TokenIntegracionService } from "../integracion/token-integracion.service";
import { TIPO_TOKEN_INTEGRACION } from "../integracion/token-integracion.reglas";

export interface JwtPayload {
  sub: string;
  username: string;
  tenantId: string;
  roles?: string[];
  permisos?: string[];
  unidades?: string[];
  unidadGlobal?: boolean;
  /** Perfil de bandeja calculado por AlcanceService (informativo). */
  perfil?: string;
  /** true = contraseña temporal pendiente de cambio (PermisoGuard bloquea casi todo). */
  cambioClave?: boolean;
  // Tipo de token: "refresh" solo debe servir para renovar en /auth/refresh,
  // nunca como bearer de API. Los access token no llevan `type` (o "access").
  type?: string;
  /** Token de integración: id de la fila en token_integracion. */
  jti?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
  constructor(private readonly integracion: TokenIntegracionService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(),
      // Se acota la verificación a HS256. Sin esto, la librería aceptaría
      // cualquier algoritmo declarado en el token (vector alg=none / confusión).
      algorithms: ["HS256"],
      // El request llega a validate() para los tokens de integración (cabecera y IP).
      passReqToCallback: true,
    });
  }

  // Lo que devuelve queda en req.user (lo usa PermisoGuard).
  async validate(req: any, payload: JwtPayload) {
    // Un refresh token (larga duración, 7d) NO puede usarse como credencial de
    // API: solo vale en POST /auth/refresh. Si se presenta como Bearer, se rechaza.
    if (payload.type === "refresh") {
      throw new UnauthorizedException("Token de refresco no válido como credencial de acceso");
    }
    // Token de integración (contrato §4.7.4): además de la firma, se exige que
    // siga vigente en token_integracion (no revocado, no vencido, mismo hash).
    // Actúa con los permisos y el alcance del rol de su cuenta de servicio.
    if (payload.type === TIPO_TOKEN_INTEGRACION) {
      return this.integracion.validar(req, payload);
    }
    return {
      sub: payload.sub,
      username: payload.username,
      tenantId: payload.tenantId,
      roles: payload.roles ?? [],
      permisos: payload.permisos ?? [],
      unidades: payload.unidades ?? [],
      // Sin claim (tokens antiguos) → global, para no romper sesiones vigentes.
      unidadGlobal: payload.unidadGlobal ?? true,
      perfil: payload.perfil,
      cambioClave: payload.cambioClave === true,
    };
  }
}
