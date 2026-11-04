import { enriquecerDocumento, permisosDeRuta, resumenAutomatico, segmentoDe, tituloModulo } from "./openapi";
import { documentoHtml, operacionesPorModulo } from "./openapi-html";

describe("documentación OpenAPI · reglas", () => {
  it("toma el módulo del primer segmento tras /api", () => {
    expect(segmentoDe("/api/ot/{id}/muestras")).toBe("ot");
    expect(segmentoDe("/cotizaciones")).toBe("cotizaciones");
    expect(tituloModulo("ot")).toBe("Órdenes de trabajo (OT)");
    expect(tituloModulo("algo-nuevo")).toBe("Algo nuevo");
  });

  it("resuelve el permiso con la misma precedencia que PermisoGuard", () => {
    const crud = { ver: "cliente.ver", crear: "cliente.crear", editar: "cliente.editar" };
    expect(permisosDeRuta("get", { metodo: ["ot.ver"], clase: ["x"], crud })).toEqual({ publica: false, permisos: ["ot.ver"] });
    expect(permisosDeRuta("get", { clase: ["admin.usuarios"], crud })).toEqual({ publica: false, permisos: ["admin.usuarios"] });
    expect(permisosDeRuta("patch", { crud })).toEqual({ publica: false, permisos: ["cliente.editar"] });
    expect(permisosDeRuta("delete", { crud })).toEqual({ publica: false, permisos: [] });
    expect(permisosDeRuta("post", { publica: true, metodo: ["x"] })).toEqual({ publica: true, permisos: [] });
  });

  it("da un resumen en español a las operaciones sin summary", () => {
    expect(resumenAutomatico("get", "/api/ot")).toBe("Consultar ot");
    expect(resumenAutomatico("get", "/api/ot/{id}")).toBe("Consultar el detalle (ot)");
    expect(resumenAutomatico("post", "/api/cotizaciones/{id}/aceptar")).toBe("Acción «aceptar»");
    expect(resumenAutomatico("post", "/api/ordenes-compra")).toBe("Crear o registrar (ordenes compra)");
    expect(resumenAutomatico("patch", "/api/clientes/{id}")).toBe("Modificar (clientes)");
    expect(resumenAutomatico("delete", "/api/clientes/{id}")).toBe("Eliminar o anular (clientes)");
  });

  const base = {
    openapi: "3.0.0",
    info: { title: "LIMS IDIC · API REST", version: "1.0", description: "Uso con `Bearer`." },
    paths: {
      "/api/ot/{id}": { get: { operationId: "OtController_uno", tags: ["ot"], parameters: [{ name: "id", in: "path", required: true }] } },
      "/api/clientes": {
        get: { operationId: "ClientesController_list", summary: "Lista de clientes" },
        post: { operationId: "ClientesController_crear", requestBody: {} },
      },
      "/api/health": { get: { operationId: "HealthController_ver" } },
      "/api/certificados": { get: { operationId: "CertificadoRetiradoController_raiz_get" } },
    },
  };
  const permisos = {
    OtController_uno: { publica: false, permisos: ["ot.ver"] },
    ClientesController_list: { publica: false, permisos: ["cliente.ver"] },
    ClientesController_crear: { publica: false, permisos: [] },
    HealthController_ver: { publica: true, permisos: [] },
    CertificadoRetiradoController_raiz: { publica: false, permisos: ["certificado.ver"] },
  };

  it("agrupa por módulo en español, anota permisos y no muta la entrada", () => {
    const copia = JSON.parse(JSON.stringify(base));
    const doc: any = enriquecerDocumento(base, { permisos });
    expect(base).toEqual(copia);
    expect(doc.paths["/api/ot/{id}"].get.tags).toEqual(["Órdenes de trabajo (OT)"]);
    expect(doc.paths["/api/ot/{id}"].get["x-permisos"]).toEqual(["ot.ver"]);
    expect(doc.paths["/api/ot/{id}"].get.description).toBe("Permiso requerido: `ot.ver`.");
    expect(doc.paths["/api/clientes"].get.summary).toBe("Lista de clientes");
    expect(doc.paths["/api/clientes"].post.description).toMatch(/sin permiso específico/);
    expect(doc.paths["/api/health"].get.security).toEqual([]);
    expect(doc.paths["/api/certificados"].get["x-permisos"]).toEqual(["certificado.ver"]);
    // Módulos principales primero, en el orden de MODULOS_API.
    expect(doc.tags.map((t: any) => t.name)).toEqual(["Clientes", "Órdenes de trabajo (OT)", "Certificados", "Estado del servicio"]);
    expect(doc.security).toEqual([{ bearer: [] }]);
  });

  it("genera el documento HTML legible agrupado por módulo", () => {
    const doc: any = enriquecerDocumento(base, { permisos });
    const grupos = operacionesPorModulo(doc);
    expect(grupos.map((g) => g.modulo)[0]).toBe("Clientes");
    expect(grupos.find((g) => g.modulo === "Estado del servicio")!.operaciones[0].publica).toBe(true);
    const html = documentoHtml(doc, "2026-11-03");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("5 operaciones");
    expect(html).toContain("<code>ot.ver</code>");
    expect(html).toContain("<code>Bearer</code>");
    expect(html).not.toContain("<script");
  });
});
