"use strict";
/**
 * Fuentes de datos del instrumento. Todas cumplen la misma interfaz:
 *   abrir(onDatos: (texto) => void, log) -> Promise<{ cerrar(): void }>
 *
 *   · serie:        puerto RS-232 (COM3, /dev/ttyUSB0…) con el paquete
 *                   «serialport» (se instala en el PC del equipo: ver README);
 *   · tcp:          el agente se conecta al equipo (host:puerto) y lee lo que
 *                   envía, reconectando si se corta;
 *   · tcp-servidor: el agente escucha un puerto y el equipo se conecta a él;
 *   · simulador:    tramas de ejemplo PRUEBA generadas aquí (sin equipo).
 */
const net = require("net");
const { tramaPrueba } = require("./simulacion");

function decodificador(codificacion) {
  const cod = codificacion === "utf8" ? "utf8" : "latin1"; // los equipos serie suelen hablar ASCII / Latin-1
  return (b) => (Buffer.isBuffer(b) ? b.toString(cod) : String(b));
}

/** Puerto serie RS-232. Requiere «serialport» (npm install serialport en esta carpeta). */
function serie(c) {
  return {
    async abrir(onDatos, log) {
      let SerialPort;
      try {
        ({ SerialPort } = require("serialport"));
      } catch {
        throw new Error("Falta el paquete «serialport». En la carpeta del agente ejecute: npm install serialport");
      }
      if (!c.puerto) throw new Error("Indique conexion.puerto (p. ej. «COM3» o «/dev/ttyUSB0»).");
      const dec = decodificador(c.codificacion);
      const puerto = new SerialPort({
        path: c.puerto,
        baudRate: Number(c.baudios) || 9600,
        dataBits: Number(c.bitsDatos) || 8,
        parity: c.paridad || "none",
        stopBits: Number(c.bitsParada) || 1,
        rtscts: !!c.controlFlujo,
        autoOpen: false,
      });
      await new Promise((ok, mal) => puerto.open((e) => (e ? mal(new Error(`No se pudo abrir ${c.puerto}: ${e.message}`)) : ok())));
      log("info", `Puerto serie ${c.puerto} abierto (${puerto.baudRate} baudios, ${c.bitsDatos || 8}${(c.paridad || "none")[0].toUpperCase()}${c.bitsParada || 1}).`);
      puerto.on("data", (b) => onDatos(dec(b)));
      puerto.on("error", (e) => log("error", `Puerto serie: ${e.message}`));
      puerto.on("close", () => log("aviso", `Puerto ${c.puerto} cerrado.`));
      return { cerrar: () => puerto.close() };
    },
  };
}

/** Cliente TCP: el equipo publica sus lecturas en host:puerto (salida Ethernet). */
function tcp(c) {
  return {
    async abrir(onDatos, log) {
      if (!c.host || !c.puertoTcp) throw new Error("Indique conexion.host y conexion.puertoTcp del equipo.");
      const dec = decodificador(c.codificacion);
      let socket = null;
      let cerrado = false;
      const conectar = () => {
        socket = net.createConnection({ host: c.host, port: Number(c.puertoTcp) }, () => log("info", `Conectado al equipo ${c.host}:${c.puertoTcp}.`));
        socket.on("data", (b) => onDatos(dec(b)));
        socket.on("error", (e) => log("aviso", `Conexión con ${c.host}:${c.puertoTcp}: ${e.message}`));
        socket.on("close", () => {
          if (!cerrado) setTimeout(conectar, 5000);
        });
      };
      conectar();
      return { cerrar: () => { cerrado = true; socket && socket.destroy(); } };
    },
  };
}

/** Servidor TCP: el equipo (o un convertidor serie-Ethernet) se conecta al agente. */
function tcpServidor(c) {
  return {
    async abrir(onDatos, log) {
      const dec = decodificador(c.codificacion);
      const puerto = Number(c.puertoTcp) || 4001;
      const servidor = net.createServer((s) => {
        log("info", `Equipo conectado desde ${s.remoteAddress}.`);
        s.on("data", (b) => onDatos(dec(b)));
        s.on("error", (e) => log("aviso", `Conexión del equipo: ${e.message}`));
      });
      await new Promise((ok, mal) => servidor.once("error", mal).listen(puerto, c.escucharEn || "0.0.0.0", ok));
      log("info", `Esperando al equipo en el puerto TCP ${puerto}.`);
      return { cerrar: () => servidor.close() };
    },
  };
}

/** Simulador: una trama PRUEBA cada `intervaloSegundos` (por defecto 3), sin equipo. */
function simulador(c) {
  return {
    async abrir(onDatos, log) {
      const muestras = (c.muestras && c.muestras.length ? c.muestras : ["M-PRUEBA-0001", "M-PRUEBA-0002"]).map(String);
      let n = 0;
      const total = Number(c.cantidad) || 0;
      log("info", `Simulador: tramas PRUEBA de ${muestras.join(", ")} (${c.ensayo || "pH"}) cada ${c.intervaloSegundos || 3} s.`);
      const reloj = setInterval(() => {
        onDatos(tramaPrueba(muestras[n % muestras.length], c.ensayo, c.separador, n));
        n++;
        if (total && n >= total) clearInterval(reloj);
      }, (Number(c.intervaloSegundos) || 3) * 1000);
      return { cerrar: () => clearInterval(reloj) };
    },
  };
}

function crearFuente(conexion) {
  switch (conexion && conexion.tipo) {
    case "serie":
      return serie(conexion);
    case "tcp":
      return tcp(conexion);
    case "tcp-servidor":
      return tcpServidor(conexion);
    case "simulador":
      return simulador(conexion);
    default:
      throw new Error("conexion.tipo debe ser «serie», «tcp», «tcp-servidor» o «simulador».");
  }
}

module.exports = { crearFuente };
