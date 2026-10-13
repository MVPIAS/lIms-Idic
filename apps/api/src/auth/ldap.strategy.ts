import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import Strategy from "passport-ldapauth";

@Injectable()
export class LdapStrategy extends PassportStrategy(Strategy, "ldap") {
  constructor() {
    super({
      server: {
        // `||` y no `??`: el compose on-premise pasa las variables VACÍAS cuando
        // no están definidas en el .env, y una cadena vacía debe caer al valor
        // por defecto (un filtro vacío rompería la búsqueda en el directorio).
        url: process.env.LDAP_URL || "ldap://ad.ejercito.cl:389",
        bindDN: process.env.LDAP_BIND_DN || "",
        bindCredentials: process.env.LDAP_BIND_CREDENTIALS || "",
        searchBase: process.env.LDAP_SEARCH_BASE || "",
        searchFilter:
          process.env.LDAP_SEARCH_FILTER || "(sAMAccountName={{username}})",
      },
      usernameField: "username",
      passwordField: "password",
    });
  }
}
