/**
 * CLI · Usuario administrador inicial (bootstrap).
 *
 *   node dist/cli/crear-admin.js --usuario admin --rol SUPERADMIN [--nombre "..."] [--email ...] [--password xxx]
 *   node dist/cli/crear-admin.js --usuario admin --restablecer      # nueva temporal a un admin que ya existe
 *
 * - Si el usuario NO existe, lo crea con una contraseña temporal (o la de
 *   --password) y lo marca para CAMBIO OBLIGATORIO en el primer ingreso
 *   (`debe_cambiar_password`, align_comercial_usuarios.sql): hasta cambiarla,
 *   la API solo le deja usar las rutas de cambio de contraseña.
 * - Si YA existe, no lo toca (ni contraseña, ni estado, ni roles) y termina
 *   bien: así una reinstalación o una actualización de versión no le cambia la
 *   contraseña al administrador. Para darle una nueva temporal a propósito
 *   (contraseña olvidada), use --restablecer.
 * - La contraseña temporal se imprime UNA vez en la línea
 *   «  password (temporal): <clave>»; quien llama decide dónde mostrarla
 *   (el instalador on-premise la saca solo por pantalla, nunca al registro).
 *
 * Requiere el schema aplicado y los roles sembrados (seed_rbac.sql).
 */
import "../common/zona-entorno";
import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";
import { randomBytes } from "crypto";
import { erroresNuevaClave } from "../auth/clave";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : def;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** Temporal que cumple las mismas reglas que una contraseña elegida por el usuario. */
function claveTemporal(username: string): string {
  for (;;) {
    const c = randomBytes(12).toString("base64url"); // 16 caracteres
    if (erroresNuevaClave(c, { username }).length === 0) return c;
  }
}

async function main() {
  const prisma = new PrismaClient();
  const username = arg("usuario", "admin")!;
  const email = arg("email");
  const rolCodigo = arg("rol", "SUPERADMIN")!;
  const nombre = arg("nombre", "Administrador del Sistema")!;
  const restablecer = flag("restablecer");
  const passwordDada = arg("password");

  // Tenant IDIC (o el primero que exista)
  const tenant =
    (await prisma.tenant.findFirst({ where: { codigo: "IDIC" } })) ??
    (await prisma.tenant.findFirst());
  if (!tenant) throw new Error("No hay tenant. Aplica el schema/seeds primero.");

  const existente = await prisma.usuario.findUnique({
    where: { tenantId_username: { tenantId: tenant.id, username } },
    select: { id: true },
  });

  if (existente && !restablecer) {
    console.log(`✔ El usuario ${username} ya existe: no se modifica (su contraseña sigue siendo la que tenía).`);
    console.log("  Si la olvidó, ejecute de nuevo con --restablecer para darle una temporal nueva.");
    await prisma.$disconnect();
    return;
  }
  if (!existente && restablecer) {
    throw new Error(`El usuario ${username} no existe: ejecute sin --restablecer para crearlo.`);
  }

  const password = passwordDada ?? claveTemporal(username);
  const passwordHash = await argon2.hash(password);

  let usuarioId: string;
  if (existente) {
    // Restablecimiento explícito: nueva temporal, cambio obligatorio, sesiones
    // abiertas invalidadas y bloqueo por intentos fallidos levantado.
    await prisma.usuario.update({
      where: { id: existente.id },
      data: {
        passwordHash,
        estado: "activo",
        debeCambiarPassword: true,
        intentosFallidos: 0,
        tokenVersion: { increment: 1 },
      },
    });
    usuarioId = existente.id;
  } else {
    const rol = await prisma.rol.findFirst({
      where: { tenantId: tenant.id, codigo: rolCodigo },
    });
    if (!rol) throw new Error(`Rol ${rolCodigo} no existe. Aplica seed_rbac.sql primero.`);
    const creado = await prisma.usuario.create({
      data: {
        tenantId: tenant.id,
        username,
        email: email ?? null,
        nombreCompleto: nombre,
        passwordHash,
        estado: "activo",
        debeCambiarPassword: true,
      },
    });
    usuarioId = creado.id;
    // usuario_rol no tiene PK compuesta (la unicidad la da un índice por
    // expresión con unidad_id): se comprueba antes de crear.
    const yaAsignado = await prisma.usuarioRol.findFirst({ where: { usuarioId, rolId: rol.id } });
    if (!yaAsignado) {
      await prisma.usuarioRol.create({ data: { usuarioId, rolId: rol.id } });
    }
  }

  console.log(existente ? "✔ Contraseña del administrador restablecida:" : "✔ Usuario administrador creado:");
  console.log(`  usuario: ${username}`);
  if (!existente) console.log(`  rol:     ${rolCodigo}`);
  if (!passwordDada) console.log(`  password (temporal): ${password}`);
  console.log("  El sistema le pedirá cambiar la contraseña en el primer ingreso.");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("✖ Error:", e.message);
  process.exit(1);
});
