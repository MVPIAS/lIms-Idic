/**
 * Devuelve el JWT_SECRET desde el entorno. Nunca usa un valor por defecto
 * hardcodeado: si falta (o es demasiado corto), aborta el arranque de la app.
 * Esto evita que se firme/valide JWT con un secreto conocido en producción.
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.trim().length < 32) {
    throw new Error(
      "JWT_SECRET no está definido o es demasiado corto (mínimo 32 caracteres). " +
        "Configúrelo en el entorno (.env) antes de arrancar la API.",
    );
  }
  return secret;
}
