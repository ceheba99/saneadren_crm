# App del reloj checador para la tableta (Android)

Es la misma pantalla `/kiosco` del sistema dentro de una app propia. Hace lo que Chrome con «fijar app» no puede:

- La pantalla no se apaga sola mientras la app está abierta.
- Si alguien apaga y prende la tableta, el checador sale encima del bloqueo: no pide el PIN de la tableta para checar.
- Pantalla completa y horizontal, sin barra de direcciones; solo abre páginas del sistema.
- Si la página no carga o se cae, se reintenta sola. Si queda abierta otra página del sistema, a los 5 minutos sin tocar regresa al checador.
- Se puede elegir como «app de inicio» de la tableta: abre sola al prender y el botón de inicio regresa al checador.

## Armar la app

Requiere Android Studio instalado (solo por sus herramientas; no hay que abrir el proyecto en él).

```bash
bash android-checador/construir.sh
```

Deja `android-checador/salida/checador-saneadren.apk`.

La firma se crea la primera vez en `~/.saneadren-checador` (fuera del repositorio). **Hay que respaldar esa carpeta**: sin
ella no se puede instalar una versión nueva encima de la anterior (habría que desinstalar y registrar la tableta otra vez).

La app casi nunca necesita rearmarse: lo que cambia del checador vive en el servidor y la app lo toma solo.

## Probar contra esta computadora

```bash
CHECADOR_URL=http://localhost:3000 bash android-checador/construir.sh   # deja checador-saneadren-PRUEBAS.apk
adb reverse tcp:3000 tcp:3000
```

## La primera vez en la tableta

La app guarda su propio registro de kiosco (no comparte el de Chrome): al abrirla avisa «Falta registrar esta tableta»,
se entra al sistema, RH → «Kioscos del checador» → registrar → «Abrir el kiosco». El registro anterior (el de Chrome) se da
de baja en esa misma lista.
