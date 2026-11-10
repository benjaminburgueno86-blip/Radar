# Radar · Monitor de Competencia (Benchmarking)

Versión del 06/11/2026, adaptada a la consigna académica facilitada.

## Qué problema resuelve

Organiza la información dispersa sobre tres competidores locales en web y redes, permite comparar el mismo conjunto de dimensiones y transforma una investigación de IA en un informe con fuentes, oportunidades de diferenciación y una propuesta de valor para nuestra tienda.

## Correspondencia con la entrega

| Consigna | Función de Radar |
|---|---|
| Analizar tres competidores locales | Tres fichas obligatorias, web, red social y justificación de su pertinencia local |
| Investigar redes y web | Cuaderno de evidencias con canal, categoría, URL, fecha, observación y captura opcional |
| Usar IA con navegación | Prompt para ChatGPT, Gemini o Claude; importación del resultado y conexión automática opcional |
| Reporte comparativo | Matriz de seis dimensiones, síntesis, fortalezas y oportunidades inferidas |
| Propuesta única de valor | Propuesta para nuestra tienda, fundamento, fuentes y prueba de validación |
| Artefacto para entregar | Informe HTML descargable e impresión/guardado PDF; proyecto JSON con respaldo |

## Cómo usar la versión sin configurar servicios

1. Abrí `outputs/monitor-competencia.html` en el navegador. Si ya estaba abierto, recargalo.
2. Definí nuestra tienda: nombre, oferta, público, zona y diferencia inicial.
3. Elegí exactamente tres competidores distintos. Completá sus webs, redes oficiales y la razón por la que son locales y comparables.
4. Registrá observaciones propias si ya las tenés. Una evidencia debe describir algo efectivamente visto en una fuente; una página inaccesible se marca como no verificada. Se admiten capturas PNG/JPEG/WebP de hasta 1 MB.
5. Presioná “Preparar prompt de investigación”. Copialo a una IA con navegación web activada. La web no envía ese prompt por sí sola. Adjuntá las capturas al chat externo si las querés usar allí.
6. La IA devuelve un objeto JSON. Pegalo o elegí su archivo en “Incorporar el informe de IA”. Radar verifica estructura, tres competidores, seis dimensiones y referencias existentes del competidor correcto.
7. Abrí y revisá las fuentes. Marcá las evidencias que realmente comprobaste. La cobertura mínima exige una evidencia web y una de redes observadas y revisadas para cada competidor. Esto no certifica la calidad del contenido: seguí revisando el razonamiento.
8. Leé la propuesta de valor y las tres acciones. Descargá el HTML o usá imprimir/guardar PDF. Guardá una copia del proyecto JSON para conservar respuestas, capturas e informe.

Si modificás nuestra tienda, competidores o contenido de evidencias después del informe, este se marca desactualizado y su exportación se bloquea hasta una nueva investigación. Las marcas de revisión no cambian el contenido investigado.

## Un ejemplo que no oculta lo pendiente

“Ver caso investigado” carga una tienda ficticia y un análisis elaborado por ChatGPT/Codex con navegación sobre Kinko, Tienda Inglesa y Ta-Ta el 06/11/2026. Las webs se consultaron; las redes no pudieron leerse de forma fiable. Por eso aparece como investigación parcial. Tampoco representa tres locales del mismo radio: son referencias presentes en Montevideo, con diferencias de escala explícitas.

Las fuentes del caso son `https://kinko.com.uy/nosotros`, `https://kinko.com.uy/`, `https://www.tiendainglesa.com.uy/supermercado/` y `https://www.tata.com.uy/`. No se inventan actividad social, estadísticas, servicios ausentes ni resultados comerciales. Los enlaces sociales deben confirmarse. El ejemplo no reemplaza el proyecto guardado salvo que se elija usarlo como punto de partida.

**Para la entrega real:** sustituí el caso por nuestra tienda y tres competidores pertinentes; completá la investigación social, revisá fuentes y justificá la propuesta. La funcionalidad de la herramienta no convierte el caso parcial en una investigación terminada.

## IA automática opcional

Para ejecutar el servidor local, abrí `Abrir Radar.cmd` y visitá `http://localhost:8899`. También se puede iniciar con Node.js: `node --use-system-ca --use-env-proxy work/benchmark-server.cjs`.

La integración automática usa la API Responses y la herramienta `web_search` de OpenAI. Necesita `OPENAI_API_KEY` en el entorno del servidor y utiliza por defecto `gpt-6-astra`; `RADAR_AI_MODEL` permite configurar un modelo compatible. La credencial no se pide en la web ni se almacena en el HTML o el proyecto. No la pegues en un chat ni la incorpores a archivos de entrega.

Al solicitar una investigación automática se envían perfil, enlaces, observaciones y hasta seis capturas al proveedor. La solicitud usa `store:false`. El servidor verifica que haya llamadas de navegación registradas y que las nuevas fuentes observadas figuren en el registro de navegación o en evidencias aportadas. Las fuentes nuevas entran sin revisión humana. El proveedor puede requerir saldo y cobrar el uso; la suscripción de una aplicación no se presenta como una credencial de API.

No había credencial configurada al desarrollar esta versión. Por ello la llamada real facturable no se ejecutó: la integración se probó con respuestas simuladas, y el servidor informa explícitamente el estado no configurado. El recorrido con una IA externa e importación es independiente de esa integración.

Referencia técnica consultada: https://developers.openai.com/api/docs/guides/tools-web-search .

## Datos y privacidad

Las respuestas, evidencias, capturas e informes se guardan en este navegador, con la clave `radar-benchmark-v2`. El almacenamiento de `file://` y el de localhost son distintos: usá exportar/abrir proyecto para transferirlos. Una copia contiene lo que cargaste; tratala según la sensibilidad de esa información.

El mapa conserva el directorio anterior de 189 ubicaciones, siete cadenas geolocalizadas y ocho competidores relevados. Es complementario: no recomienda ubicaciones ni estima demanda. Directorio inicial 19/10/2026, ampliación 03/11/2026. Esri provee el fondo con atribución. Las fuentes históricas no se presentan como investigación social actual.

No se incorporan Porter, presupuesto de apertura, equilibrio financiero o precios propios al recorrido principal.

## Verificación realizada

- Pruebas de arranque del HTML, fichas, seis dimensiones, ejemplo protegido, importación, fuentes, revisión, obsolescencia y exportación.
- Rechazo de referencias inexistentes, de otro competidor, fechas inválidas y capturas de formatos no admitidos.
- Pruebas HTTP del servidor, configuración sin exposición de claves, rechazo de otros orígenes y respuesta real al faltar credencial.
- Prueba de la petición y respuesta de IA con proveedor simulado; no es una validación del proveedor en producción.
- Revisión en navegador de portada, caso investigado, matriz, evidencias y prompt. Descarga del informe HTML comprobada. No se realizó una evaluación de usabilidad con estudiantes o comerciantes.

Comandos de comprobación: `node work/test-benchmark.cjs` y `node work/test-benchmark-server.cjs`. La prueba de HTML usa `work/qa/node_modules/linkedom`; la web y el servidor no necesitan esa biblioteca para funcionar. Construcción: `node work/make-benchmark-example.cjs` y `node work/build-benchmark.cjs`.

Fuentes activas: `work/benchmark-shell.html`, `work/benchmark.css`, `work/benchmark-app.js`, `work/benchmark-core.cjs`, `work/benchmark-server.cjs`. La copia anterior se conserva en `work/monitor-before-benchmark.html`. Los constructores antiguos corresponden a versiones retiradas y no deben usarse para generar esta entrega.
