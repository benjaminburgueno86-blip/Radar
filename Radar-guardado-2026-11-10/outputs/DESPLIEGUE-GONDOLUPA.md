# Gondolupa · Operación y despliegue

## Qué incluye esta versión

| Fase | Implementación | Qué se probó y qué requiere |
|---|---|---|
| Informe | Ficha por GTIN, marca cuando consta, presentación, estadísticos, hora y fuente por precio, brecha, confianza e historial. | Registros históricos existentes y pruebas de equivalencia. Sin costo propio se muestra competitividad y no rentabilidad. |
| Actualización | Servicio diario, botón de consulta real, importación, historial y estado por fuente. | Flujo y repetición probados con una fuente de prueba. El administrador habilita cada integración autorizada. |
| Cuenta | Registro, verificación, sesión, recuperación, perfil, proyecto privado e informes guardados. | Dos usuarios de prueba, enlaces de un uso, cookies y aislamiento. Envío real requiere correo configurado. |
| Alertas | Seguimiento por GTIN, categoría y comercio. Umbral, historial de cambios, nuevas brechas y nuevos mínimos de comparaciones equivalentes. | Variaciones, duplicados, preferencias y acceso a alertas probados. |
| Avisos | Bandeja privada, leídos, seguimiento y Web Push por evento o resumen diario. | La cola y el envío se probaron con un transporte de prueba. Queda pendiente probar dispositivos reales con VAPID configurado. |
| Render | Blueprint para una instancia de servicio web con disco persistente. | El servidor local y las pruebas están disponibles. No se creó ni se publicó ningún recurso de Render. |

## Puesta en marcha local

Usá **Abrir Radar.cmd** o ejecutá `npm start` con Node.js 24. Abrí `http://localhost:8899`. La vista **Informe** funciona con los precios históricos mientras no haya precios más recientes. **Mi espacio** usa la sesión de tu cuenta. Para transferir el proyecto anónimo a tu cuenta, exportá una copia antes de iniciar sesión y abrila desde esa cuenta.

El servidor migra los precios históricos desde `work/gondolupa.sqlite` o desde la copia JSON incluida. Los conserva con sus fechas originales. El nuevo archivo local se guarda en `work/runtime-platform/gondolupa.sqlite`. La migración se puede repetir y conserva los registros existentes. Las reglas de vigencia por defecto son 24 y 48 horas. El informe señala cuando el corte es histórico.

## Fuentes automáticas

**Abrir Radar.cmd** activa el piloto local de 14 fichas por catálogo de Disco y Devoto y abre la página en el puerto 8903. El piloto verifica `robots.txt`, GTIN, sucursal, moneda y precio regular antes de guardar cada precio. Usá `GONDOLUPA_CATALOG_PILOT=0` para desactivarlo. Para habilitarlo en un sitio público, configurá `GONDOLUPA_CATALOG_PILOT=1` y la autorización documentada en `GONDOLUPA_CATALOG_PERMISSION`.

Para otras fuentes, configurá `PRICE_FEEDS_JSON` con una lista de feeds HTTPS. Cada feed debe contar con permiso documentado para consultar y reutilizar sus datos. La consulta programada se ejecuta a partir de las 08:00 de Uruguay, una vez por día por fuente mientras el servidor está activo. El botón de actualización manual tiene una pausa global de 15 minutos.

Ejemplo de configuración ilustrativa. La dirección example.com no es una fuente de precios.

```json
[{"id":"catalogo-autorizado","store":"id-del-comercio","url":"https://example.com/precios.json","authorized":true,"terms":"Referencia del acuerdo o licencia"}]
```

La respuesta HTTPS tiene una propiedad `observations` que contiene una lista de registros. Cada registro debe incluir `product` (GTIN con sus ceros iniciales para equivalencias), `scope` (`online` o `source-branch`), `branch`, `name`, `price` numérico, `currency` (`UYU`), `checked` (fecha ISO con zona), `url` HTTPS y `available` (1, 0 o null). `brand`, `category` y `promotion` son opcionales. El servidor asigna el comercio configurado al feed. Las series separan promociones, sucursales y canales. Solo los precios regulares con disponibilidad informada entran en la comparación automática.

Para un comercio sin feed, definí el correo verificado de administrador en `GONDOLUPA_ADMIN_EMAIL` y cargá el archivo en **Mi espacio → Importar precios autorizados**. También podés ejecutar `node work/import-prices.cjs ruta-del-archivo.json` desde el entorno administrador. La raíz del archivo debe contener `source`, `authorized: true` y `observations`. En la importación manual cada observación debe incluir también `store`. No se agregan fechas de consulta ficticias a los datos viejos.

El informe incluye una muestra del MEF con 1.372 precios regulares declarados del 28 al 30 de septiembre de 2026, 33 presentaciones y 25 sucursales de Buceo, Centro, Cordón, Pocitos y Unión. Está separada del catálogo online y usa el identificador de presentación del SIPC. Las declaraciones no confirman stock. La muestra se incluye en el sitio y en la copia sin conexión. Para regenerarla, usá `node work/build-sipc-pilot.cjs CARPETA` con `locales.csv`, `productos.csv` y el tramo final de `precios-parcial.csv`. [Sistema de Información de Precios al Consumidor](https://catalogodatos.gub.uy/dataset/defensa-del-consumidor-sistema-de-informacion-de-precios-al-consumidor-2026)

## Configuración de Render

1. Revisá `render.yaml` y los costos antes de aplicar el Blueprint. La configuración usa un servicio web de pago con disco persistente de 1 GB y una sola instancia. SQLite se abre en `/var/data/gondolupa.sqlite`. La tarea diaria vive en ese mismo proceso y no depende de una pestaña abierta.
2. Cargá `PRICE_FEEDS_JSON` solo con integraciones permitidas. Si faltan fuentes, la página identifica ese estado y muestra la fecha de los precios históricos.
3. Para verificación y recuperación, configurá un remitente y dominio verificados en Resend. Definí `RESEND_API_KEY` y `MAIL_FROM`. [Documentación de Resend](https://resend.com/docs/api-reference/emails/send-email)
4. Para avisos del navegador, generá un par VAPID una vez con `npx web-push generate-vapid-keys`. Guardá `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT` en Render. El asunto puede ser `mailto:soporte@tu-dominio`. Conservá las claves al redesplegar. Cada usuario activa avisos por dispositivo. En iOS o iPadOS agregá Gondolupa a la pantalla de inicio antes de solicitar permiso. La bandeja interna queda disponible. [Web Push en iOS y iPadOS](https://webkit.org/blog/13878/)
5. La dirección pública se obtiene de Render. Si usás dominio propio, configurá `PUBLIC_ORIGIN` con el origen HTTPS exacto.
6. Conservá backups de SQLite con la API de respaldo de SQLite o una exportación consistente. El disco y el servicio son de una sola instancia. Para crecer a varios procesos, migrá a una base compartida y una cola con deduplicación por dispositivo.

El plan gratuito no permite adjuntar el disco persistente y el Postgres gratuito caduca a los 30 días. Un cron independiente no puede montar este disco. El Blueprint no activa recursos por sí solo. [Servicios gratuitos](https://render.com/docs/free) · [Discos persistentes](https://render.com/docs/disks) · [Cron Jobs](https://render.com/docs/cronjobs)

## Verificación

Ejecutá `npm test` para el motor y el flujo de cuentas y alertas. La prueba de notificaciones usa transportes de prueba y ninguna cuenta o dispositivo externo. La prueba `node work/test-benchmark.cjs` verifica la vista construida y la compatibilidad con proyectos anteriores. `node work/test-benchmark-server.cjs` comprueba las rutas HTTP de la instalación local.

El historial puede contener periodos sin observaciones. Un precio sin cambio no produce alerta. Las notificaciones del sistema operativo dependen del permiso y la entrega del navegador. La alternativa actual es la bandeja interna. El correo se usa para la cuenta.
