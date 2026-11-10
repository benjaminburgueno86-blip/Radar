# Radar Trade Marketing

## Acceso inicial

Abrí `/trade` en el mismo servidor de Radar. El vínculo también está en el pie de la página principal. La pantalla de ingreso es pública y los datos requieren una sesión empresarial y una membresía activa en la empresa seleccionada.

Una persona nueva puede seleccionar **Crear mi espacio empresarial**, ingresar su empresa, nombre y correo, y seguir el enlace de activación. La primera persona queda como administradora de su propio espacio y puede invitar al equipo. En la versión pública, el enlace se envía por correo, vence en 24 horas y funciona una sola vez. En la versión local, si no hay correo configurado, el formulario continúa directamente a la activación.

El alta por consola sigue disponible cuando un operador necesita habilitar una empresa directamente.

```powershell
node work/trade-provision.cjs "Empresa" "administrador@empresa.uy" "Nombre y apellido"
```

El comando imprime una invitación privada de un solo uso que vence a los siete días. Compartila con la persona destinataria por un canal privado. El enlace permite usar la contraseña de una cuenta existente o elegir una contraseña para una cuenta empresarial nueva. En Render, una cuenta general debe tener el correo verificado para iniciar sesión con sus credenciales. Las cuentas empresariales nuevas son independientes del acceso general de Radar.

## Flujo de trabajo

1. El administrador crea invitaciones y administra los roles desde **Equipo**.
2. El relevador inicia una visita, selecciona el comercio y la sucursal y carga tantos productos como necesite. Puede buscar por nombre, marca o GTIN. La ubicación del dispositivo es opcional. Si no hay coordenadas, la sucursal queda disponible en el listado del mapa.
3. El supervisor o administrador revisa los pendientes, explica las excepciones y valida o rechaza. Las correcciones quedan auditadas y vuelven a revisión. Los relevadores editan sus propios registros pendientes o rechazados.
4. **Análisis y mapa** usa los precios presenciales validados y los datos digitales de Radar. Los compara entre sucursales dentro del mismo canal y fecha. El cruce presencial y digital exige GTIN, producto, comercio, sucursal y día compatibles. Cuando no hay GTIN, las observaciones presenciales se agrupan por nombre, marca, categoría y presentación normalizados. 
5. Para obtener una oportunidad o amenaza, cargá un precio propio para el mismo producto, canal y día. Las oportunidades requieren que el rival haya subido y que tu precio sea inferior. Las amenazas requieren una baja rival de al menos 10 % y que su precio quede debajo del tuyo. El umbral de vigencia usa `PRICE_STALE_HOURS` y por defecto es 48 horas. Los registros anteriores siguen disponibles en el historial.
6. Configurá reglas de alerta en **Alertas**. Se aplican a cambios de precio al validar un relevamiento. La lista de alertas funciona dentro de Radar. Los avisos del navegador requieren consentimiento, un navegador compatible y la configuración Web Push existente.

La capa de calor indica concentración de sucursales relevadas. La capa de precios usa marcadores comparables del mismo producto y día. Los puntos y precios provienen de la empresa seleccionada.

## Planillas e informes

En **Relevamiento → Importar una planilla**, elegí tu Excel `.xlsx` o CSV sin adaptar los encabezados. Radar sugiere la hoja y las columnas. Podés corregir la selección, indicar una fila de encabezados distinta o elegir `0` cuando no hay encabezados. Indicá la última fila de datos para dejar afuera totales o notas al pie. Las columnas de producto y precio son obligatorias. Para comercio, sucursal, dirección y fecha podés usar las columnas originales, completar valores comunes o elegir una visita existente. Si la presentación no se puede identificar, el registro queda pendiente hasta que la completes. Cada importación admite 500 filas y un archivo de hasta 2 MB. Si una fila es inválida, Radar indica cuál es y revierte toda la importación. Las fotos se cargan desde el formulario y se guardan en privado en la base.

Usá **Comprobar columnas** para detectar filas inválidas antes de guardar. Radar indica el número de fila, la columna asignada y qué corregir. Podés editar el valor dentro de Radar o marcar **Omitir esta fila**. Confirmá la importación cuando los precios estén listos.

Podés exportar relevamientos y oportunidades o amenazas en CSV. **Imprimir / Guardar PDF** abre el diálogo del navegador con el informe de benchmarking y los gráficos. El panel analiza hasta 5.000 relevamientos validados por empresa y muestra un aviso si hay más.

## Render y persistencia

El módulo usa el mismo servicio web y el esquema PostgreSQL elegido en Supabase. Render Free se conecta con `DATABASE_URL` y guarda en Supabase las cuentas, los relevamientos, las fotos y el historial. Para conservar los datos de tu instalación local, seguí el procedimiento de migración de la guía de despliegue.

En Render, configurá `RESEND_API_KEY` y `MAIL_FROM` con un remitente habilitado para enviar los enlaces de activación. La dirección pública se toma de Render o de `PUBLIC_ORIGIN` si usás un dominio propio. Para avisos del navegador, conservá `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT`. Los avisos envían un texto genérico y abren el módulo empresarial, donde se verifican los permisos antes de mostrar datos. El mapa reutiliza la capa base y la atribución existentes de Radar.

## Archivos y verificación

- `trade-schema.cjs`, `trade-store.cjs` y `trade-provision.cjs` definen el almacenamiento, los controles de calidad y el alta empresarial.
- `trade-api.cjs`, `trade-analysis.cjs` y `trade-files.cjs` implementan permisos, análisis, avisos e importación y exportación.
- `trade-shell.html`, `trade.css` y `trade-ui.js` contienen la interfaz. `build-benchmark.cjs` la compila en `outputs/radar-trade.html`.
- `platform-db.cjs`, `platform-accounts.cjs`, `platform-runtime.cjs`, `benchmark-server.cjs` y `benchmark-shell.html` conectan el módulo con Radar.

Ejecutá `npm test` o `pnpm test` y `node work/test-benchmark.cjs`. Las pruebas empresariales crean datos identificados como ficticios en una base temporal y verifican roles, aislamiento, fotos, revisión, correcciones, análisis, CSV, Excel, alertas y persistencia. La prueba de Web Push utiliza un transporte de prueba.
