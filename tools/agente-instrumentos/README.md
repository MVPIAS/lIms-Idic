# Agente de instrumentos del LIMS IDIC

Conecta al LIMS los equipos de laboratorio que entregan sus lecturas por **puerto serie (RS-232)** o por **Ethernet (TCP/IP)** (contrato §4.4.7).

Un servidor web no puede abrir el puerto serie del PC del laboratorio. Por eso, en el PC conectado al equipo se instala este agente. El agente lee lo que envía el equipo, separa cada mensaje («trama»), lo limpia y lo envía al LIMS con un token propio del dispositivo. En el LIMS las lecturas aparecen en **Datos de instrumentos › Lecturas pendientes**. Ahí un analista abre la vista previa (muestra, ensayo y valor de cada fila) y pulsa **Capturar**. Es el mismo circuito de revisión que un archivo cargado a mano: el agente no captura resultados por su cuenta.

```
 Equipo ──RS-232──► PC del laboratorio (agente) ──HTTPS──► LIMS
 Equipo ──Ethernet─►        (token del dispositivo)        «Lecturas pendientes» → analista revisa → Capturar
```

## Requisitos

- Node.js 18 o superior en el PC conectado al equipo.
- Acceso de red desde ese PC a la dirección del LIMS (la misma que se usa en el navegador).
- **Puerto serie:** además, el paquete `serialport`. Para instalarlo, ejecute `npm install serialport` dentro de esta carpeta. Trae binarios para Windows y Linux, así que no hace falta compilar. Solo lo necesitan los PC con equipos serie: Ethernet y el simulador funcionan sin instalar nada.

## Puesta en marcha

1. **Cree el perfil del instrumento** en el LIMS (*Datos de instrumentos › Perfiles de instrumento › + Nuevo perfil*). El perfil dice cómo leer cada trama: formato TXT o CSV, separador, decimal y en qué columna vienen la muestra, el ensayo y el valor. Las tramas de los equipos serie no suelen traer cabecera. En ese caso ponga «Fila de la cabecera» = **0** e indique las columnas por número (1, 2, 3…). Use las equivalencias para traducir el nombre del ensayo en el equipo al código del método en el LIMS.
2. **Conecte el dispositivo** en *Datos de instrumentos › Dispositivos conectados › + Conectar dispositivo*: nombre, perfil, conexión y ubicación. Pulse **Conectar y generar token**. **Copie el token en ese momento, porque no vuelve a mostrarse.**
3. En el PC del equipo, copie `agente.config.ejemplo.json` como `agente.config.json`. Complete `lims.url` (por ejemplo `https://lims.idic.cl/api`) y `lims.token`.
4. Compruebe la conexión con `node agente.js --probar`. Debe responder «Prueba correcta: el token es válido.» y mostrar el perfil.
5. Arranque el agente con `node agente.js`. Para que se inicie con el PC, regístrelo como tarea programada de Windows («Al iniciar el sistema») o como servicio con NSSM o systemd.

## Configuración (`agente.config.json`)

| Clave | Qué es |
|---|---|
| `lims.url` | Dirección de la API del LIMS, terminada en `/api`. |
| `lims.token` | Token del dispositivo (empieza por `lims_disp_`). |
| `conexion.tipo` | `serie` (RS-232), `tcp` (el agente se conecta al equipo), `tcp-servidor` (el equipo o un conversor serie-Ethernet se conecta al agente) o `simulador`. |
| `conexion.puerto`, `baudios`, `bitsDatos`, `paridad`, `bitsParada`, `controlFlujo` | Parámetros del puerto serie. Están en el manual del equipo; lo más común es 9600 8N1. |
| `conexion.host`, `conexion.puertoTcp` | Dirección IP y puerto del equipo (`tcp`), o puerto en que escucha el agente (`tcp-servidor`). |
| `conexion.codificacion` | `latin1` (por defecto) o `utf8`. |
| `trama.terminador` | Marca el fin de cada trama: `LF` (por defecto), `CR`, `CRLF`, `ETX` o `EOT`. Además, tras `trama.silencioMs` ms sin datos, lo recibido se toma como trama completa. |
| `trama.ignorar` | Expresiones regulares de los mensajes del equipo que no son lecturas (por ejemplo `^OK$`). |
| `envio.loteSegundos`, `envio.maxTramas` | Cada cuántos segundos, o cada cuántas tramas, se envía un lote al LIMS. Cada lote queda como una «lectura pendiente». |
| `envio.cabecera` | Solo si el perfil espera una fila de cabecera: el texto de esa cabecera, por ejemplo `Muestra;Ensayo;Valor`. |
| `registro` | Archivo donde el agente anota todo lo que hace (`agente.log`). |

Los caracteres de control del protocolo (STX, ETX, ACK, NAK, CR…) se eliminan; el tabulador se conserva porque puede ser el separador. Antes de enviar, el agente interpreta cada trama con el perfil y la anota en el registro («Lectura · muestra … · ensayo = valor»). La interpretación que vale es la del LIMS, que usa el mismo lector que para los archivos.

## Si se corta la red

Las tramas que no se pudieron enviar quedan en `cola-pendiente.json` y se reintentan solas. También se envían al volver a arrancar el agente. Si el LIMS rechaza un lote por su contenido, el lote se aparta en `rechazadas.json` y queda anotado en el registro. Si el token fue revocado, el agente lo indica y conserva las tramas en la cola.

## Demostración sin equipo (simulador)

Use datos marcados **PRUEBA**:

- **Sin red de equipos:** ejecute `node agente.js --simular --muestras M-PRUEBA-0001,M-PRUEBA-0002 --ensayo pH --cantidad 4 --intervalo 2`. Genera 4 tramas PRUEBA (`STX M-PRUEBA-0001;pH;7,02;pH ETX CR LF`), las envía al LIMS y termina. Para que el LIMS las empareje, use los códigos de muestras reales de una OT PRUEBA con un ensayo de pH sin valor. Si no, aparecen como «Sin muestra».
- **Equipo Ethernet simulado:** en una consola ejecute `node simulador.js --puerto 4001 --muestras M-PRUEBA-0001`. En otra, arranque el agente con `"conexion": { "tipo": "tcp", "host": "127.0.0.1", "puertoTcp": 4001 }`.

Para un perfil de ejemplo de pH por puerto serie, elija formato **TXT**, separador **Punto y coma**, decimal **Coma** y fila de la cabecera **0**. Las columnas son: muestra **1**, ensayo **2**, valor **3** y unidad **4**. En las equivalencias, agregue `pH = <código del método de pH en el LIMS>`.

## Seguridad

- El token identifica al dispositivo, no a una persona: solo sirve para enviar lecturas, nunca para entrar al LIMS ni para capturar resultados. El LIMS guarda únicamente su huella SHA-256.
- Si un PC se reemplaza o el token se expone, pulse **Revocar** en *Dispositivos conectados*. El token deja de valer de inmediato y las lecturas ya recibidas se conservan.
- Cada lote queda en el LIMS con las tramas tal como llegaron (dato bruto con huella SHA-256), con el nombre del dispositivo, y se puede descargar desde el *Historial* con «Original».
- `agente.config.json` contiene el token: no lo comparta ni lo suba a repositorios (ya está en `.gitignore`).

## Pruebas

```
npm test
```
