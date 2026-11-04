#!/usr/bin/env node
"use strict";
/**
 * Simulador de un equipo con salida Ethernet: escucha un puerto TCP y, a cada
 * cliente conectado (el agente con conexion.tipo «tcp»), le envía una trama
 * PRUEBA cada pocos segundos. Sirve para demostrar la conexión Ethernet sin un
 * equipo real.
 *
 *   node simulador.js [--puerto 4001] [--muestras M-1,M-2] [--ensayo pH] [--intervalo 3] [--separador ";"]
 */
const net = require("net");
const { tramaPrueba } = require("./lib/simulacion");

const a = {};
const v = process.argv.slice(2);
for (let i = 0; i < v.length; i += 2) if (v[i].startsWith("--")) a[v[i].slice(2)] = v[i + 1];

const puerto = Number(a.puerto) || 4001;
const muestras = (a.muestras || "M-PRUEBA-0001,M-PRUEBA-0002").split(",").map((x) => x.trim()).filter(Boolean);
const ensayo = a.ensayo || "pH";
const intervalo = (Number(a.intervalo) || 3) * 1000;

const servidor = net.createServer((s) => {
  console.log(`Agente conectado desde ${s.remoteAddress}: se envían tramas PRUEBA de ${muestras.join(", ")} (${ensayo}).`);
  let n = 0;
  const reloj = setInterval(() => {
    const t = tramaPrueba(muestras[n % muestras.length], ensayo, a.separador || ";", n);
    s.write(t, "latin1");
    console.log(`→ ${JSON.stringify(t)}`);
    n++;
  }, intervalo);
  s.on("close", () => clearInterval(reloj));
  s.on("error", () => clearInterval(reloj));
});
servidor.listen(puerto, () => console.log(`Simulador de equipo Ethernet PRUEBA escuchando en el puerto TCP ${puerto}. Ctrl+C para terminar.`));
