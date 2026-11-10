# Gondolupa · Operación y despliegue

## Qué incluye esta versión

| Fase | Implementación | Qué se probó y qué requiere |
|---|---|---|
| Informe | Ficha por GTIN, marca cuando consta, presentación, estadísticos, hora y fuente por precio, brecha, confianza e historial. | Registros históricos existentes y pruebas de equivalencia. Sin costo propio se muestra competitividad y no rentabilidad. |
| Actualización | Servicio diario, botón de consulta real, importación, historial y estado por fuente. | Flujo y repetición probados con una fuente de prueba. El administrador habilita cada integración autorizada. |
| Cuenta | Registro, verificación, sesión, recuperación, perfil, proyecto privado e informes guardados. | Dos usuarios de prueba, enlaces de un uso, cookies y aislamiento. Envío real requiere correo configurado. |
| Alertas | Seguimiento por GTIN, categoría y comercio. Umbral, historial de cambios, nuevas brechas y nuevos mínimos de comparaciones equivalentes. | Variaciones, duplicados, preferencias y acceso a alertas probados. |
| Avisos | Bandeja privada, leídos, seguimiento y Web Push por evento o resumen diario. | La cola y el envío se probaron con un transporte de prueba. Queda pendiente probar dispositivos reales con VAPID configurado. |
| Render | Blueprint para un servicio web gratuito con PostgreSQL externo de Supabase. | Preparado para probar con tu proyecto de Supabase y tu servicio de Render. |

## Puesta en marcha local

Usá **Abrir Radar.cmd** o ejecutá `npm start` con Node.js 24. Abrí `http://localhost:8899`. La vista **Informe** funciona con los precios históricos mientras no haya precios más recientes. **Mi espacio** usa la sesión de tu cuenta. Para transferir el proyecto anónimo a tu cuenta, exportá una copia antes de iniciar sesión y abrila desde esa cuenta.

Sin `DATABASE_URL`, Radar puede seguir usando SQLite en local. El archivo por defecto es `work/runtime-platform/gondolupa.sqlite`. Con PostgreSQL configurado, Radar usa la base externa también en local. El servidor incorpora la copia histórica pública incluida una sola vez por base de datos y conserva la fecha de cada precio.

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

## Preparar Supabase

1. Creá un proyecto de Supabase. En **Connect**, elegí **Session pooler** (puerto 5432) y copiá la URL PostgreSQL. El modo Session funciona por IPv4. Usá la contraseña de la base y codificá los caracteres especiales en la URL. El backend se conecta directamente a PostgreSQL. No necesita las claves de la API de Supabase.
2. Configurá `DATABASE_URL` con la cadena del pooler. Usá la URL sin parámetros SSL o con `sslmode=verify-full`. Radar exige TLS con verificación del certificado y del nombre del servidor. Si la cadena de confianza requiere el certificado de Supabase, descargalo desde **Database → Settings** y configurá `DATABASE_SSL_CA` con su contenido PEM o `DATABASE_SSL_CA_FILE` con la ruta a un archivo secreto de Render, por ejemplo `/etc/secrets/prod-supabase.cer`. Habilitá la exigencia de SSL en Supabase. [Conexión a PostgreSQL en Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres) · [Exigencia de SSL](https://supabase.com/docs/guides/platform/ssl-enforcement)
3. El usuario de conexión necesita crear y administrar el esquema `radar`. Radar crea tablas, índices y restricciones al iniciar. El esquema se usa solo desde el backend y debe quedar fuera de los esquemas expuestos por la API de datos de Supabase.

## Migrar la base existente

1. Conservá una copia consistente de SQLite antes de migrar. Si Radar está abierto, usá la API de respaldo de SQLite para incluir los cambios del WAL.

```powershell
node -e "const {DatabaseSync,backup}=require('node:sqlite');const db=new DatabaseSync(process.argv[1],{readOnly:true});backup(db,process.argv[2]).finally(()=>db.close())" "work/runtime-platform/gondolupa.sqlite" "radar-respaldo.sqlite"
```

2. Desde tu computadora, instalá las dependencias y configurá `DATABASE_URL` (y el certificado si corresponde) como variables privadas. Si usás un archivo local ignorado por Git, Node 24 puede cargarlo con `--env-file`. Ejecutá la migración antes de empezar a usar la nueva base en producción.

```powershell
npm ci
npm run db:migrate-sqlite -- "radar-respaldo.sqlite"
```

La migración de la base principal conserva cuentas y hashes de contraseña, sesiones, proyectos guardados, informes, alertas, precios, membresías, fotos y auditorías. Una segunda ejecución con la misma copia informa que ya se importó. Puede convivir con el historial público inicial. Si el destino ya tiene datos propios, el script se detiene antes de copiar para protegerlos. El archivo legado `work/gondolupa.sqlite` solo contiene observaciones y se puede importar por separado con el mismo comando. Si solo existía un proyecto guardado en el navegador, exportalo con **Guardar copia del proyecto** y abrilo en la versión pública.

Los usuarios vuelven a iniciar sesión en la dirección nueva. Las cuentas generales creadas únicamente para uso local deben verificar su correo antes del acceso público. Las suscripciones Web Push se vuelven a activar en el dominio público. Conservá el respaldo en un lugar privado. El archivo contiene los datos de las empresas y no se sube a GitHub.

## Configuración de Render Free

Creá un **Web Service** con el Blueprint `render.yaml` o aplicá la misma configuración desde el panel. Usá el plan **Free**, Node.js 24 y el puerto `PORT` asignado por Render. El servicio guarda sus datos en Supabase.

| Ajuste | Valor |
|---|---|
| Build | `npm ci --omit=dev --ignore-scripts && npm run build` |
| Start | `npm start` |
| Health check | `/healthz` |
| Base de datos | `DATABASE_URL` del Session pooler |

Configurá las variables desde **Environment**. `GONDOLUPA_DB` se usa solo para SQLite local.

- **Conexión.** `DATABASE_URL` obligatoria. `DATABASE_SSL_CA` o `DATABASE_SSL_CA_FILE` según el certificado. Si usás un dominio propio, configurá `PUBLIC_ORIGIN` con su origen HTTPS exacto. Para el dominio de Render, Radar toma `RENDER_EXTERNAL_URL`.
- **Precios.** `PRICE_FEEDS_JSON` para fuentes autorizadas. Para el piloto, `GONDOLUPA_CATALOG_PILOT=1` y `GONDOLUPA_CATALOG_PERMISSION` con la autorización. `RADAR_SEED_HISTORY=0` omite la carga inicial si querés trabajar únicamente con la base migrada. Los umbrales `PRICE_RECENT_HOURS` y `PRICE_STALE_HOURS` mantienen los valores por defecto 24 y 48.
- **Cuentas.** `RESEND_API_KEY` y `MAIL_FROM` para enviar activación, verificación y recuperación. `GONDOLUPA_ADMIN_EMAIL` identifica a la cuenta general autorizada para importar precios. [Correo con Resend](https://resend.com/docs/api-reference/emails/send-email)
- **Notificaciones.** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT` para Web Push. Generá el par una vez con `npx web-push generate-vapid-keys --json` y activá los avisos desde el sitio en cada navegador. Las alertas dentro de Radar siguen disponibles sin VAPID.

### Actualización diaria si Render está dormido

Render Free suspende el servicio tras un período sin tráfico. Radar revisa si hay recolecciones pendientes cuando despierta y cada minuto mientras está activo. El historial queda en Supabase. [Límites del plan gratuito de Render](https://render.com/docs/free)

Para disparar la recolección aunque nadie entre, configurá `RADAR_REFRESH_TOKEN` en Render con un valor aleatorio de al menos 32 caracteres. En Supabase Cron, programá una solicitud HTTPS **POST** a `/api/internal/refresh` en el dominio público de Radar. Usá el encabezado `Authorization: Bearer …` con el mismo secreto guardado en Supabase Vault, sin subirlo al repositorio. Programá el trabajo a las 11:05 UTC para las 08:05 de Uruguay y dejá tiempo para el arranque en frío y la consulta de fuentes. La ruta ejecuta la recolección y el despacho de avisos. Los registros de ejecución y una reserva temporal en PostgreSQL evitan ejecutar el mismo trabajo en paralelo. [Supabase Cron](https://supabase.com/docs/guides/cron/quickstart) · [Supabase Vault](https://supabase.com/docs/guides/database/vault)

Habilitá Cron y `pg_net` en Supabase. Desde Vault guardá dos secretos con los nombres `radar_origin` (la dirección HTTPS pública sin barra final) y `radar_refresh_token` (el mismo valor de Render). En SQL Editor ejecutá una sola vez esta programación.

```sql
select cron.schedule(
  'radar-precios-diarios',
  '5 11 * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'radar_origin')
        || '/api/internal/refresh',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' ||
          (select decrypted_secret from vault.decrypted_secrets where name = 'radar_refresh_token')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 180000
    );
  $$
);
```

Verificá el historial de Cron y la respuesta HTTP en `net._http_response`. Un registro de Cron exitoso acredita que se encoló la solicitud. La respuesta HTTP y el estado de las fuentes de Radar confirman el resultado de la recolección.

## Archivos y arquitectura

- `platform-connection.cjs` implementa el pool PostgreSQL, TLS, transacciones por conexión y adaptación asíncrona de SQLite local. `platform-postgres.sql` define el esquema privado, índices, claves y restricciones. `platform-schema.cjs` conserva las migraciones locales.
- `platform-db.cjs`, `platform-runtime.cjs`, `platform-accounts.cjs`, `platform-api.cjs`, `platform-feeds.cjs`, `platform-push.cjs`, `trade-api.cjs` y `trade-store.cjs` esperan las consultas asíncronas. Las transacciones usan una única conexión y serializan escrituras relacionadas mediante un bloqueo de PostgreSQL.
- `benchmark-server.cjs` espera la conexión y las migraciones antes de aceptar solicitudes, usa `PORT`, comprueba la base en `/healthz` y ofrece la ruta protegida de actualización programada.
- `migrate-sqlite-to-postgres.cjs`, `trade-provision.cjs` e `import-prices.cjs` administran datos desde la consola con la misma conexión.
- `service/gdu-catalog.mjs` contiene el lector de fichas compartido con el servicio anterior. El recolector actual usa ese módulo y funciona sin abrir el historial SQLite del servicio anterior. Los scripts antiguos de inspección y el servicio legado conservan su comportamiento local y quedan fuera de `npm start`.
- `test-postgres.cjs` ejecuta el motor PostgreSQL de PGlite por TCP con el cliente `pg`. `test-platform.cjs`, `test-trade.cjs` y `test-platform-catalog.cjs` cubren las regresiones. `package.json`, `package-lock.json`, `pnpm-lock.yaml`, `.gitignore` y `render.yaml` contienen dependencias y configuración de despliegue.

## Verificación

Ejecutá `npm test` para las regresiones y `npm run test:postgres` para correr cuentas, precios, Trade Marketing, transacciones y migración con un motor PostgreSQL de prueba por TCP. `node work/test-benchmark.cjs` verifica la interfaz desde el proyecto de desarrollo. El envío de correo y Web Push usa transportes de prueba. Para validar tu despliegue, abrí `/healthz`, Radar y `/trade`, verificá el correo real, probá una recolección con una fuente autorizada y reiniciá el servicio para comprobar la persistencia.

El historial puede contener periodos sin observaciones. Un precio sin cambio no produce alerta. Las notificaciones del sistema operativo dependen del permiso y la entrega del navegador. La alternativa actual es la bandeja interna. El correo se usa para la cuenta.
