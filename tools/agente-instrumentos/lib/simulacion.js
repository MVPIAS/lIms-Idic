"use strict";
/**
 * Tramas de ejemplo PRUEBA, como las que envía un pHmetro o una balanza por
 * RS-232: STX + «muestra;ensayo;valor;unidad» + ETX + CR LF. Las usan el
 * simulador interno del agente (--simular) y el simulador de equipo TCP
 * (simulador.js).
 */
const UNIDADES = { ph: "pH", humedad: "%", conductividad: "uS/cm", masa: "g", temperatura: "°C" };

function valorPrueba(ensayo, n) {
  const e = String(ensayo || "pH").toLowerCase();
  const base = e === "ph" ? 7 : e === "humedad" ? 12 : e === "conductividad" ? 450 : e === "temperatura" ? 20 : 100;
  const variacion = ((n * 37) % 21) / 100 - 0.1; // determinista: -0,10 … +0,10
  return (base * (1 + (e === "ph" ? variacion / 7 : variacion / 10))).toFixed(2).replace(".", ",");
}

function tramaPrueba(muestra, ensayo = "pH", separador = ";", n = 0) {
  const sep = separador || ";";
  const unidad = UNIDADES[String(ensayo).toLowerCase()] || "";
  return `\u0002${[muestra, ensayo, valorPrueba(ensayo, n), unidad].join(sep)}\u0003\r\n`;
}

module.exports = { tramaPrueba, valorPrueba };
