# Transcripción de voz

Este contexto describe las grabaciones de audio, los textos que el usuario obtiene y conserva a partir de ellas, y las métricas que se derivan de su uso.

## Language

**Grabación**:
Una captura de audio junto con su transcripción y sus metadatos (fecha, duración, idiomas de origen y destino). Es la unidad raíz que el usuario graba y conserva. Los resúmenes no forman parte de la Grabación: se asocian al texto visible, que puede provenir de varias grabaciones.
_Avoid_: Clip, audio, nota, item, registro

**Proveedor**:
Servicio externo que produce la Transcripción de una Grabación. Puede haber varios configurados, pero solo uno está activo a la vez.
_Avoid_: Cliente, motor, backend, API

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

**Punto de inserción**:
Posición de texto activa en el campo enfocado de la aplicación enfocada del sistema operativo. No es el cursor del ratón.
_Avoid_: Cursor, foco del ratón, posición del mouse

**Widget de dictado**:
Ventana flotante mínima, siempre visible y sin foco, que muestra el estado y nivel de audio mientras se graba desde otra aplicación.
_Avoid_: Pantallito, overlay, popup

**Puerta de acceso**:
Barrera inicial de pantalla completa que exige la Frase de acceso antes de revelar el resto de la aplicación. Aparece una vez por carga de la aplicación.
_Avoid_: Login, pantalla de login, lock, autenticación

**Frase de acceso**:
Secreto compartido único que abre la Puerta de acceso. Se establece en el primer arranque y puede cambiarse desde los Ajustes confirmando la frase vigente.
_Avoid_: Contraseña, password, PIN, credencial de usuario

**Inserción simulada**:
Entrega del texto al punto de inserción mediante portapapeles temporal y pegado simulado, restaurando el portapapeles original después.
_Avoid_: Escritura directa, typing, pegado mágico
