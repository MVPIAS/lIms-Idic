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

  // 4b. Permisos + matriz rol_permiso (comercial / laboratorio / flujos / sistema)
  //
  // POR QUÉ ESTO VIVE AQUÍ: los controllers exigen ~30 permisos (cliente.*,
  // cotizacion.*, ot.*, resultado.*, flujo.*, factura.*, metodo.*, plantilla.*,
  // admin.usuarios, ...) que el seed de dev NO creaba, así que solo SUPERADMIN
  // (que hace bypass) podía usar esos módulos; el resto recibía 403 en todo.
  // El script SQL `seed_rbac.sql` sí tiene la matriz, pero usa OTROS códigos de
  // rol (JEFE_LAB/ADMIN/TECNICO/CLIENTE) que no coinciden con los de este seed
  // (JEFELAB/JEFEDCO/...), por lo que nunca caía sobre los roles reales de dev.
  // Aquí se siembra el catálogo con los códigos REALES para que `pnpm db:seed`
  // deje un RBAC funcional sin depender de la ruta SQL de producción.
  // (Los permisos SAEC —evidencia/arma/caso/ibis— siguen en saec.sql.)
  const permisosCatalogo = [
    "cliente.ver", "cliente.crear", "cliente.editar",
    "cotizacion.ver", "cotizacion.crear", "cotizacion.aprobar",
    "factura.ver", "factura.emitir", "factura.cobrar",
    "ot.ver", "ot.crear", "ot.cerrar",
    "muestra.ver", "muestra.crear", "muestra.transferir",
    "metodo.ver", "metodo.crear", "metodo.aprobar",
    "resultado.ver", "resultado.crear", "resultado.revisar", "resultado.aprobar",
    "plantilla.ver", "plantilla.gestionar",
    "catalogo.gestionar",
    "certificado.emitir", "certificado.firmar",
    "flujo.ver", "flujo.editar", "flujo.publicar",
    "equipo.ver", "equipo.gestionar",
    "firma.registrar", "admin.usuarios", "audit.ver", "nc.gestionar",
  ];
  for (const codigo of permisosCatalogo) {
    const [modulo, accion] = codigo.split(".");
    await prisma.permiso.upsert({
      where: { codigo },
      update: {},
      create: { codigo, modulo, accion, descripcion: `${accion} · ${modulo}` },
    });
  }

  // Matriz rol → permisos. Alineada con seed_rbac.sql (Excel RBAC v1.0), con los
  // códigos de rol de este seed y JEFEDCO (Jefe DCO · operaciones) añadido.
  const matriz: Record<string, string[]> = {
    DIRECTOR: [
      "audit.ver", "certificado.emitir", "certificado.firmar", "cliente.ver",
      "cotizacion.ver", "cotizacion.aprobar", "equipo.ver", "factura.ver",
      "firma.registrar", "flujo.ver", "metodo.ver", "metodo.aprobar", "muestra.ver",
      "nc.gestionar", "ot.ver", "ot.cerrar", "plantilla.ver",
      "resultado.ver", "resultado.revisar", "resultado.aprobar",
    ],
    JEFEDCO: [
      "audit.ver", "certificado.emitir", "cliente.ver", "cotizacion.ver",
      "equipo.ver", "flujo.ver", "flujo.editar", "flujo.publicar", "metodo.ver",
      "muestra.ver", "muestra.crear", "muestra.transferir", "nc.gestionar",
      "ot.ver", "ot.crear", "ot.cerrar", "plantilla.ver",
      "resultado.ver", "resultado.revisar",
    ],
    JEFELAB: [
      "audit.ver", "catalogo.gestionar", "certificado.emitir", "certificado.firmar",
      "equipo.ver", "equipo.gestionar", "firma.registrar", "flujo.ver",
      "metodo.ver", "metodo.crear", "metodo.aprobar", "muestra.ver", "muestra.crear",
      "muestra.transferir", "nc.gestionar", "ot.ver", "plantilla.ver",
      "resultado.ver", "resultado.revisar", "resultado.aprobar",
    ],
    ANALISTA_SR: [
      "equipo.ver", "firma.registrar", "metodo.ver", "muestra.ver", "ot.ver",
      "plantilla.ver", "resultado.ver", "resultado.crear", "resultado.revisar",
    ],
    ANALISTA: [
      "equipo.ver", "firma.registrar", "metodo.ver", "muestra.ver", "ot.ver",
      "resultado.ver", "resultado.crear",
    ],
    RECEPCION: [
      "cliente.ver", "cliente.crear", "muestra.ver", "muestra.crear",
      "muestra.transferir", "ot.ver", "ot.crear",
    ],
    COMERCIAL: [
      "cliente.ver", "cliente.crear", "cliente.editar", "cotizacion.ver",
      "cotizacion.crear", "factura.ver", "ot.ver", "ot.crear", "plantilla.ver",
    ],
    COBRANZA: [
      "cliente.ver", "cotizacion.ver", "factura.ver", "factura.emitir",
      "factura.cobrar", "ot.ver",
    ],
    CALIDAD: [
      "audit.ver", "catalogo.gestionar", "equipo.ver", "flujo.ver", "metodo.ver",
      "metodo.aprobar", "muestra.ver", "nc.gestionar", "plantilla.ver",
      "plantilla.gestionar", "resultado.ver",
    ],
    LECTOR: [
      "audit.ver", "cliente.ver", "cotizacion.ver", "equipo.ver", "factura.ver",
      "flujo.ver", "metodo.ver", "muestra.ver", "ot.ver", "plantilla.ver",
      "resultado.ver",
    ],
    // SUPERADMIN hace bypass en el PermisoGuard; se le concede todo igualmente
    // para que la pantalla de Permisos lo refleje y por robustez.
    SUPERADMIN: permisosCatalogo,
  };
  let vinculos = 0;
  for (const [rolCodigo, codigos] of Object.entries(matriz)) {
    const rol = await prisma.rol.findUnique({
      where: { tenantId_codigo: { tenantId: tenant.id, codigo: rolCodigo } },
    });
    if (!rol) continue;
    for (const codigo of codigos) {
      const permiso = await prisma.permiso.findUnique({ where: { codigo } });
      if (!permiso) continue;
      await prisma.rolPermiso.upsert({
        where: { rolId_permisoId: { rolId: rol.id, permisoId: permiso.id } },
        update: {},
        create: { rolId: rol.id, permisoId: permiso.id },
      });
      vinculos++;
    }
  }
  console.log(`  ✓ ${permisosCatalogo.length} permisos y ${vinculos} vínculos rol_permiso`);

  // 5. Usuarios demo (sin LDAP, solo para dev)
  //
  // passwordHash: hash argon2id REAL de la contraseña "Demo1234!" (verificable
  // por auth.service con argon2.verify). Antes se sembraba un placeholder
  // inválido ("...$DEMO") que hacía FALLAR el login de todos los usuarios: el
  // atajo dev password="demo" solo aplica a usuarios SIN hash, y estos sí tenían
  // uno (aunque roto). Va en `update` además de `create` para que un re-seed
  // repare bases ya sembradas con el hash viejo.
  //
  // rol: cada usuario recibe un rol (antes NINGUNO lo tenía -> usuario_rol=0 ->
  // JWT sin permisos -> 403 en todo, sin bypass SUPERADMIN). Los roles se
  // crearon arriba; aquí se vinculan vía usuario_rol.
  const PASSWORD_HASH_DEMO =
    "$argon2id$v=19$m=65536,t=3,p=4$aBJ9IdcfDoWznFNAsyQwtA$t1TBElqSae2Zu789PudA7TLYvzJmTOFky37KURrwiv0";
  const usuariosDemo = [
    { username: "c.vargas", nombreCompleto: "Cnel. Roberto Vargas Mella", grado: "Coronel", cargo: "Jefe DCO", rol: "JEFEDCO" },
    { username: "m.gonzalez", nombreCompleto: "María González Pérez", grado: "Civil", cargo: "Jefa Lab. Química", rol: "JEFELAB" },
    { username: "r.munoz", nombreCompleto: "Rodrigo Muñoz Soto", grado: "Civil", cargo: "Analista Senior", rol: "ANALISTA_SR" },
    { username: "j.soto", nombreCompleto: "Javier Soto Ramírez", grado: "Sargento", cargo: "Recepción Central", rol: "RECEPCION" },
    { username: "admin", nombreCompleto: "Administrador del Sistema", grado: "Civil", cargo: "TI", rol: "SUPERADMIN" },
  ];
  for (const { rol: rolCodigo, ...u } of usuariosDemo) {
    const usuario = await prisma.usuario.upsert({
      where: { tenantId_username: { tenantId: tenant.id, username: u.username } },
      update: { passwordHash: PASSWORD_HASH_DEMO, estado: "activo" },
      create: {
        tenantId: tenant.id,
        ...u,
        email: `${u.username}@ejercito.cl`,
        passwordHash: PASSWORD_HASH_DEMO,
        estado: "activo",
      },
    });
    const rol = await prisma.rol.findUnique({
      where: { tenantId_codigo: { tenantId: tenant.id, codigo: rolCodigo } },
    });
    if (rol) {
      await prisma.usuarioRol.upsert({
        where: { usuarioId_rolId: { usuarioId: usuario.id, rolId: rol.id } },
        update: {},
        create: { usuarioId: usuario.id, rolId: rol.id },
      });
    }
  }
  console.log(`  ✓ ${usuariosDemo.length} usuarios demo cargados (con rol y contraseña "Demo1234!")`);

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
  console.log("\n📋 Credenciales de prueba (dev) · contraseña para todos: Demo1234!");
  console.log("   admin       | SUPERADMIN   (acceso total)");
  console.log("   c.vargas    | JEFEDCO");
  console.log("   m.gonzalez  | JEFELAB");
  console.log("   r.munoz     | ANALISTA_SR");
  console.log("   j.soto      | RECEPCION");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
