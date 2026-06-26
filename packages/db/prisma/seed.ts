/**
 * Seed inicial para desarrollo
 * Carga: tenant IDIC, 1 sede, unidades, roles base, 5 usuarios demo, 3 clientes reales.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Iniciando seed para desarrollo local...");

  // 1. Tenant IDIC
  const tenant = await prisma.tenant.upsert({
    where: { codigo: "IDIC" },
    update: {},
    create: {
      codigo: "IDIC",
      nombre: "Instituto de Investigaciones y Control · Ejército de Chile",
      rut: "61.102.000-K",
      moneda: "CLP",
      ivaPct: 19.0,
      activo: true,
    },
  });
  console.log(`  ✓ Tenant: ${tenant.codigo}`);

  // 2. Sedes
  const sedeStgo = await prisma.sede.upsert({
    where: { tenantId_codigo: { tenantId: tenant.id, codigo: "STGO" } },
    update: {},
    create: {
      tenantId: tenant.id,
      codigo: "STGO",
      nombre: "IDIC Santiago - Matriz",
      direccion: "Pedro Montt 145",
      ciudad: "Santiago",
      region: "Metropolitana",
    },
  });

  // 3. Unidades (13 laboratorios reales)
  const unidades = [
    { codigo: "LCC", nombre: "Laboratorio Cuero y Calzado" },
    { codigo: "LTX", nombre: "Laboratorio Textil" },
    { codigo: "LQA", nombre: "Laboratorio Química Aplicada" },
    { codigo: "LQC", nombre: "Laboratorio Químico Central" },
    { codigo: "LMB", nombre: "Laboratorio Microbiología" },
    { codigo: "LES", nombre: "Laboratorio Ensayos Especiales" },
    { codigo: "LEM", nombre: "Laboratorio Ensayos Mecánicos" },
    { codigo: "LMT", nombre: "Laboratorio Metrología" },
    { codigo: "LNF", nombre: "Laboratorio LNF" },
    { codigo: "SEO", nombre: "Sección Electrónica y Óptica" },
    { codigo: "SVM", nombre: "Servicio Vehículos Militares" },
    { codigo: "DCO", nombre: "Departamento Control de Operaciones" },
    { codigo: "COM", nombre: "Comercial" },
  ];
  for (const u of unidades) {
    await prisma.unidad.upsert({
      where: { tenantId_codigo: { tenantId: tenant.id, codigo: u.codigo } },
      update: {},
      create: { tenantId: tenant.id, sedeId: sedeStgo.id, ...u },
    });
  }
  console.log(`  ✓ ${unidades.length} unidades cargadas`);

  // 4. Roles base
  const roles = [
    { codigo: "SUPERADMIN", nombre: "Super Administrador", esSistema: true },
    { codigo: "DIRECTOR", nombre: "Director Técnico", esSistema: true },
    { codigo: "JEFEDCO", nombre: "Jefe Departamento Control de Operaciones", esSistema: true },
    { codigo: "JEFELAB", nombre: "Jefe de Laboratorio", esSistema: true },
    { codigo: "ANALISTA_SR", nombre: "Analista Senior", esSistema: true },
    { codigo: "ANALISTA", nombre: "Analista", esSistema: true },
    { codigo: "RECEPCION", nombre: "Recepción Central", esSistema: true },
    { codigo: "COMERCIAL", nombre: "Comercial", esSistema: true },
    { codigo: "COBRANZA", nombre: "Cobranza", esSistema: true },
    { codigo: "CALIDAD", nombre: "Calidad", esSistema: true },
    { codigo: "LECTOR", nombre: "Lector / Auditor", esSistema: true },
  ];
  for (const r of roles) {
    await prisma.rol.upsert({
      where: { tenantId_codigo: { tenantId: tenant.id, codigo: r.codigo } },
      update: {},
      create: { tenantId: tenant.id, ...r },
    });
  }
  console.log(`  ✓ ${roles.length} roles cargados`);

  // 5. Usuarios demo (sin LDAP, solo para dev)
  const usuariosDemo = [
    { username: "c.vargas", nombreCompleto: "Cnel. Roberto Vargas Mella", grado: "Coronel", cargo: "Jefe DCO" },
    { username: "m.gonzalez", nombreCompleto: "María González Pérez", grado: "Civil", cargo: "Jefa Lab. Química" },
    { username: "r.munoz", nombreCompleto: "Rodrigo Muñoz Soto", grado: "Civil", cargo: "Analista Senior" },
    { username: "j.soto", nombreCompleto: "Javier Soto Ramírez", grado: "Sargento", cargo: "Recepción Central" },
    { username: "admin", nombreCompleto: "Administrador del Sistema", grado: "Civil", cargo: "TI" },
  ];
  for (const u of usuariosDemo) {
    await prisma.usuario.upsert({
      where: { tenantId_username: { tenantId: tenant.id, username: u.username } },
      update: {},
      create: {
        tenantId: tenant.id,
        ...u,
        email: `${u.username}@ejercito.cl`,
        passwordHash: "$argon2id$v=19$m=65536,t=3,p=4$DEMO", // password 'demo'
        estado: "activo",
      },
    });
  }
  console.log(`  ✓ ${usuariosDemo.length} usuarios demo cargados`);

  // 6. Clientes reales (extraídos del dump comercial_produccion)
  const clientesReales = [
    { rut: "61.105.000-3", razonSocial: "Fábricas y Maestranzas del Ejército", tipo: "gubernamental" },
    { rut: "61.101.078-8", razonSocial: "División Logística del Ejército", tipo: "gubernamental" },
    { rut: "60.910.000-1", razonSocial: "Universidad de Chile", tipo: "gubernamental" },
    { rut: "90.266.000-3", razonSocial: "ENAEX S.A.", tipo: "externo" },
    { rut: "96.591.040-9", razonSocial: "Carozzi S.A.", tipo: "externo" },
    { rut: "61.704.000-K", razonSocial: "Codelco · División Andina", tipo: "gubernamental" },
    { rut: "80.919.600-3", razonSocial: "Pinturas SIPA Ltda.", tipo: "externo" },
    { rut: "95.467.000-7", razonSocial: "Orica Chile S.A.", tipo: "externo" },
  ];
  for (const c of clientesReales) {
    await prisma.cliente.upsert({
      where: { tenantId_rut: { tenantId: tenant.id, rut: c.rut } },
      update: {},
      create: {
        tenantId: tenant.id,
        ...c,
        diasCredito: 30,
        bloqueado: false,
        saldoActual: 0,
      },
    });
  }
  console.log(`  ✓ ${clientesReales.length} clientes reales cargados`);

  console.log("\n✅ Seed completado correctamente.");
  console.log("\n📋 Credenciales de prueba (dev):");
  console.log("   Usuario: c.vargas | Password: demo");
  console.log("   Usuario: m.gonzalez | Password: demo");
  console.log("   Usuario: admin | Password: demo");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
