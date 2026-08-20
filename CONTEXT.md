# Transcripción de voz

Este contexto describe las grabaciones de audio, los textos que el usuario obtiene y conserva a partir de ellas, y las métricas que se derivan de su uso.

## Language

**Grabación**:
Una captura de audio junto con su transcripción y sus metadatos (fecha, duración, idiomas de origen y destino). Es la unidad raíz que el usuario graba y conserva. Los resúmenes no forman parte de la Grabación: se asocian al texto visible, que puede provenir de varias grabaciones.
_Avoid_: Clip, audio, nota, item, registro

**Proveedor remoto**:
Servicio externo que produce la Transcripción de una Grabación. Groq y Cloudflare Whisper son Proveedores remotos. Puede haber varios configurados, pero solo uno se usa para cada Transcripción remota.
_Avoid_: Cliente, motor, backend, API

**Método de transcripción**:
Modalidad elegida para producir una Transcripción: mediante un Proveedor remoto o mediante procesamiento local en el navegador.
_Avoid_: Proveedor, modelo, modo

**Transcripción local**:
Transcripción cuya Grabación y texto se procesan dentro del navegador sin enviarse a un Proveedor remoto. No implica por sí sola que la aplicación pueda abrirse sin conexión.
_Avoid_: Aplicación offline, transcripción privada

**Aplicación sin conexión**:
Aplicación cuya interfaz puede abrirse y funcionar sin acceso a la red. Es una capacidad distinta de la Transcripción local.
_Avoid_: Transcripción local, modo local

**Motor local**:
Software que ejecuta un Modelo local en el navegador para producir una Transcripción sin enviar la Grabación a un Proveedor remoto.
_Avoid_: Proveedor local, API local, modelo

**Modelo local**:
Artefacto descargable que contiene los parámetros necesarios para que un Motor local produzca Transcripciones.
_Avoid_: Motor, proveedor, servicio

**Modelo del catálogo**:
Modelo local aprobado por LU YUME para su descarga, con revisión, artefactos, tamaño, licencia y capacidades declaradas.
_Avoid_: Modelo disponible, modelo soportado

**Modelo descargado**:
Modelo del catálogo cuyos artefactos están completos y verificados en el almacenamiento privado del navegador. El navegador puede eliminarlo bajo presión de espacio.
_Avoid_: Modelo instalado, modelo disponible

**Modelo activo**:
Modelo descargado que se usará para la siguiente Transcripción local. Solo puede haber uno activo a la vez.
_Avoid_: Modelo predeterminado, modelo instalado, proveedor activo

**Descarga parcial**:
Datos incompletos de un Modelo del catálogo que todavía no pueden activarse.
_Avoid_: Modelo descargado, modelo dañado

**Actualización de modelo**:
Revisión aprobada de un Modelo del catálogo posterior a la revisión descargada. Requiere confirmación del usuario y verificación antes de sustituir la revisión anterior.
_Avoid_: Actualización automática, modelo nuevo

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
