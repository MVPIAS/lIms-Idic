/**
 * CLI · Crear usuario administrador (bootstrap).
 *   node dist/cli/crear-admin.js --usuario admin --email admin@aiuken.cl --rol SUPERADMIN [--password xxx]
 * Si no se pasa --password, genera una temporal y la imprime.
 * Requiere el schema aplicado y los roles sembrados (seed_rbac.sql).
 */
import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";
import { randomBytes } from "crypto";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

async function main() {
  const prisma = new PrismaClient();
  const username = arg("usuario", "admin")!;
  const email = arg("email");
  const rolCodigo = arg("rol", "SUPERADMIN")!;
  const nombre = arg("nombre", "Administrador del Sistema")!;
  const password = arg("password") ?? randomBytes(6).toString("base64url");

  // Tenant IDIC (o el primero que exista)
  const tenant =
    (await prisma.tenant.findFirst({ where: { codigo: "IDIC" } })) ??
    (await prisma.tenant.findFirst());
  if (!tenant) throw new Error("No hay tenant. Aplica el schema/seeds primero.");

  const rol = await prisma.rol.findFirst({
    where: { tenantId: tenant.id, codigo: rolCodigo },
  });
  if (!rol) throw new Error(`Rol ${rolCodigo} no existe. Aplica seed_rbac.sql primero.`);

  const passwordHash = await argon2.hash(password);

  const usuario = await prisma.usuario.upsert({
    where: { tenantId_username: { tenantId: tenant.id, username } },
    create: {
      tenantId: tenant.id,
      username,
      email: email ?? null,
      nombreCompleto: nombre,
      passwordHash,
      estado: "activo",
    },
    update: { passwordHash, estado: "activo" },
  });

  // usuario_rol ya no tiene PK compuesta (usuario, rol): la clave es `id`
  // sintética y la unicidad la da un índice único por expresión (unidad_id).
  // Por eso el upsert se hace manual: si no existe el par (usuario, rol) global,
  // se crea. Idempotente para el bootstrap del admin.
  const yaAsignado = await prisma.usuarioRol.findFirst({
    where: { usuarioId: usuario.id, rolId: rol.id },
  });
  if (!yaAsignado) {
    await prisma.usuarioRol.create({ data: { usuarioId: usuario.id, rolId: rol.id } });
  }

  console.log("✔ Usuario administrador listo:");
  console.log(`  usuario: ${username}`);
  console.log(`  rol:     ${rolCodigo}`);
  if (!arg("password")) console.log(`  password (temporal): ${password}   <-- cámbiala tras el primer login`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("✖ Error:", e.message);
  process.exit(1);
});
