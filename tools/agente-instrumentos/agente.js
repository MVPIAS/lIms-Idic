#!/usr/bin/env node
"use strict";
/**
 * Agente de instrumentos del LIMS IDIC (contrato §4.4.7).
 *
 * Se instala en el PC conectado al equipo. Lee las tramas del puerto serie
 * (RS-232) o de la conexión Ethernet (TCP), las limpia y las envía por lotes al
 * LIMS con el token del dispositivo. En el LIMS quedan como «Lecturas
 * pendientes» en «Datos de instrumentos»: un analista las revisa y las captura.
 *
 *   node agente.js                      usa agente.config.json
 *   node agente.js --config otra.json   otra configuración
 *   node agente.js --probar             solo comprueba el token y muestra el perfil
 *   node agente.js --simular            tramas PRUEBA sin equipo (demostración)
 *       [--muestras M-1,M-2] [--ensayo pH] [--cantidad 4] [--intervalo 2]
 *
 * Detalle en README.md.
 */
const fs = require("fs");
const path = require("path");
const { ClienteLims, VERSION } = require("./lib/lims");
const { Ensamblador, interpretar } = require("./lib/tramas");
const { crearFuente } = require("./lib/fuentes");

function argumentos(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith("--")) continue;
    const sig = argv[i + 1];
    if (sig === undefined || sig.startsWith("--")) a[k.slice(2)] = true;
    else {
      a[k.slice(2)] = sig;
      i++;
    }
  }
  return a;
}

function leerConfig(ruta) {
  if (!fs.existsSync(ruta)) {
    throw new Error(`No existe ${ruta}. Copie agente.config.ejemplo.json como agente.config.json y complete la URL del LIMS y el token del dispositivo.`);
  }
  return JSON.parse(fs.readFileSync(ruta, "utf8"));
}

function crearLog(archivo) {
  return (nivel, texto) => {
    const linea = `${new Date().toISOString()} [${nivel}] ${texto}`;
    (nivel === "error" ? console.error : console.log)(linea);
    if (archivo) fs.appendFile(archivo, linea + "\n", () => undefined);
  };
}

async function main() {
  const a = argumentos(process.argv.slice(2));
  const rutaConfig = path.resolve(a.config || path.join(__dirname, "agente.config.json"));
  const cfg = leerConfig(rutaConfig);
  const log = crearLog(cfg.registro ? path.resolve(path.dirname(rutaConfig), cfg.registro) : null);
  const envio = { ...(cfg.envio || {}), archivoCola: path.resolve(path.dirname(rutaConfig), (cfg.envio && cfg.envio.archivoCola) || "cola-pendiente.json") };
  const lims = new ClienteLims(cfg.lims, envio, log);

  log("info", `Agente de instrumentos ${VERSION} · LIMS ${lims.url}`);
  let info;
  try {
    info = await lims.saludo();
  } catch (e) {
    log("error", `El LIMS no aceptó el token del dispositivo: ${e.message}`);
    if (a.probar) process.exit(1);
    log("aviso", "Se seguirá leyendo el equipo y las tramas quedan en la cola hasta que el LIMS responda.");
  }
  if (info) {
    const p = info.perfil;
    log("info", `Dispositivo «${info.dispositivo}» · perfil «${p.nombre}» (${p.formato}, separador «${p.separador}», decimal «${p.decimal}», muestra=${p.colMuestra}, ensayo=${p.colEnsayo || `fijo ${p.ensayoFijo}`}, valor=${p.colValor}).`);
    if (p.formato !== "XML" && p.filaCabecera > 0 && !envio.cabecera)
      log("aviso", `El perfil espera la cabecera en la fila ${p.filaCabecera}: indique «envio.cabecera» en la configuración (los equipos serie no la repiten).`);
  }
  if (a.probar) {
    log("info", "Prueba correcta: el token es válido.");
    return;
  }

  const conexion = a.simular
    ? {
        tipo: "simulador",
        ...(cfg.simulador || {}),
        ...(a.muestras ? { muestras: String(a.muestras).split(",").map((x) => x.trim()).filter(Boolean) } : {}),
        ...(a.ensayo ? { ensayo: a.ensayo } : {}),
        ...(a.cantidad ? { cantidad: Number(a.cantidad) } : {}),
        ...(a.intervalo ? { intervaloSegundos: Number(a.intervalo) } : {}),
        separador: info && info.perfil.separador !== "auto" && info.perfil.separador !== "espacios" ? info.perfil.separador : ";",
      }
    : cfg.conexion;
  const trama = cfg.trama || {};
  const ensamblador = new Ensamblador({ terminador: trama.terminador || "LF", ignorar: trama.ignorar });
  const silencioMs = Number(trama.silencioMs) || 800;
  let reloj = null;

  const procesar = (tramas) => {
    for (const t of tramas) {
      const l = info && interpretar(t, info.perfil, envio.cabecera);
      log("info", l ? `Lectura · muestra ${l.muestra} · ${l.ensayo} = ${l.valor}${l.unidad ? ` ${l.unidad}` : ""}` : `Trama recibida: ${t}`);
      lims.agregar(t);
    }
  };
  const fuente = crearFuente(conexion);
  const abierta = await fuente.abrir((texto) => {
    procesar(ensamblador.agregar(texto));
    // Silencio del equipo: lo que quedó sin terminador se toma como trama completa.
    if (reloj) clearTimeout(reloj);
    reloj = setTimeout(() => procesar(ensamblador.vaciar()), silencioMs);
  }, log);

  // Al arrancar se reintenta lo que quedó en la cola de una sesión anterior.
  if (lims.cola.length) {
    log("info", `Hay ${lims.cola.length} trama(s) de una sesión anterior en la cola: se envían ahora.`);
    void lims.enviar();
  }

  const salir = async () => {
    log("info", "Cerrando el agente: se envía lo que queda en la cola.");
    abierta.cerrar();
    procesar(ensamblador.vaciar());
    await lims.enviar();
    process.exit(0);
  };
  process.on("SIGINT", salir);
  process.on("SIGTERM", salir);

  // Simulación con cantidad fija: termina sola cuando envió todo.
  if (conexion.tipo === "simulador" && conexion.cantidad) {
    const espera = (Number(conexion.cantidad) * (Number(conexion.intervaloSegundos) || 3) + 1) * 1000;
    setTimeout(salir, espera);
  }
}

main().catch((e) => {
  console.error(`[error] ${e.message}`);
  process.exit(1);
});
