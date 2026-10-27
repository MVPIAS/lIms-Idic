/**
 * Frente f8 · se importa PRIMERO en main.ts (y en las CLI): fija la zona de la
 * sesión de base de datos en DATABASE_URL antes de que ningún módulo cree su
 * PrismaClient (varios lo crean al importarse). Ver common/fecha-chile.ts.
 */
import { urlConZona } from "./fecha-chile";

const url = urlConZona(process.env.DATABASE_URL);
if (url) process.env.DATABASE_URL = url;
