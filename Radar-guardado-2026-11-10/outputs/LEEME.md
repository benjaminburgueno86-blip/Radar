# Radar · Monitor de Competencia (Benchmarking)

Versión del 06/11/2026, adaptada a la consigna académica facilitada.

## Seguimiento y alertas

Para configurar el historial diario, las cuentas, las notificaciones y Render, abrí [Operación y despliegue](DESPLIEGUE-GONDOLUPA.md).

## Informe de mercado de Gondolupa

Abrí Radar con el lanzador y entrá en **Informe**. Elegí tipo de comercio, fecha y canal. La página consulta la base SQLite local. Si abrís el HTML como archivo, se usa la copia histórica que acompaña el proyecto.

El diagnóstico compara GTIN y presentaciones compatibles dentro de un mismo día y canal. Conserva sucursal, fecha y enlace. El ranking desglosa brecha, cobertura, calidad, actualidad y viabilidad. Para incorporar costos y margen objetivo, usá **Cargar mis costos y precios** y vinculá los productos por GTIN.

**Guardar en PDF** abre el diálogo del navegador con las tablas, el gráfico y el plan desplegados. Elegí **Guardar como PDF**. El archivo **ejemplo-inteligencia-gondolupa.html** muestra un informe generado con la base histórica.

El informe cuantitativo se calcula en esta computadora.

## Datos y privacidad

Las respuestas, evidencias, capturas e informes se guardan en este navegador, con la clave `radar-benchmark-v2`. El almacenamiento de `file://` y el de localhost son distintos: usá exportar/abrir proyecto para transferirlos. Una copia contiene lo que cargaste; tratala según la sensibilidad de esa información.

El mapa conserva el directorio anterior de 189 ubicaciones, siete cadenas geolocalizadas y ocho competidores relevados. Es complementario: no recomienda ubicaciones ni estima demanda. Directorio inicial 19/10/2026, ampliación 03/11/2026. Esri provee el fondo con atribución. Las fuentes históricas no se presentan como investigación social actual.

El informe cuantitativo estima margen bruto. Los gastos fijos y el equilibrio financiero quedan fuera de ese cálculo.

## Verificación

Pruebas: `node work/test-market-intelligence.cjs` y `node work/test-benchmark.cjs`. Construcción: `node work/build-benchmark.cjs`.
