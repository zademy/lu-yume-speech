# Transcripción de voz

Este contexto describe las grabaciones de audio, los textos que el usuario obtiene y conserva a partir de ellas, y las métricas que se derivan de su uso.

## Language

**Grabación**:
Una captura de audio junto con su transcripción y sus metadatos (fecha, duración, idiomas de origen y destino). Es la unidad raíz que el usuario graba y conserva. Los resúmenes no forman parte de la Grabación: se asocian al texto visible, que puede provenir de varias grabaciones.
_Avoid_: Clip, audio, nota, item, registro

**Transcripción**:
Texto obtenido al convertir una grabación de audio en lenguaje escrito.
_Avoid_: Resultado, salida

**Texto visible**:
Contenido actual que el usuario puede revisar y editar después de transcribir.
_Avoid_: Texto crudo, respuesta

**Resumen**:
Versión breve del texto visible que conserva sus puntos clave y su idioma.
_Avoid_: Refinamiento, postprocesado

**Historial de resúmenes**:
Conjunto ordenado de uno o más resúmenes generados y conservados para la misma transcripción actual. Cada nueva generación se agrega sin reemplazar las anteriores.
_Avoid_: Versiones, regeneraciones

**Métrica**:
Indicador que se obtiene al agregar Grabaciones a lo largo del tiempo (cantidades, promedios, distribuciones). Se calcula al visualizarla y no se conserva como dato.
_Avoid_: KPI, estadística, indicador, contador
