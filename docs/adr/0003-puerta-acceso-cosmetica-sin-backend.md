# Puerta de acceso cosmética, sin backend ni Usuario

**Status**: Accepted

## Decisión

La aplicación se protege con una **Puerta de acceso**: una barrera de pantalla completa que exige una **Frase de acceso** antes de revelar la app. La verificación es íntegramente del lado del cliente (SHA-256 + salt vía Web Crypto, persistida como credencial `gate` en el seam `Platform`, junto a `groq` y `worker`). No hay backend, no hay verificación en servidor, y no existe la entidad Usuario en el modelo de dominio.

## Contexto

Pedido: "agregar un login de autenticación". La SPA es 100% estática: el JS del bundle es público por naturaleza, las Grabaciones viven en IndexedDB local del navegador y el egreso de red solo apunta a Groq y al Worker de Whisper. Bajo esas condiciones, un login verificado en servidor exigiría introducir un backend inexistente hoy. El uso es de una sola persona: el dueño, con sus propias credenciales de proveedor.

## Opciones consideradas

- **Auth gestionada (Firebase/Supabase/Clerk).** Rechazada: peso desproporcionado para una SPA sin backend; introduce dependencia y egreso de red adicionales.
- **Cloudflare Worker `/login` que firme token de sesión.** Rechazado por ahora: ya existe un Worker (Whisper), pero sumar verificación real de sesión mantiene el problema de fondo — los datos y las credenciales del Proveedor siguen siendo locales al navegador del usuario. No protege nada real.
- **Puerta cosmética en el cliente.** Aceptada. Es obfuscación, no seguridad: quien lea el bundle puede saltarla. El objetivo declarado es filtrar curiosos, no resistir a un atacante.

## Consecuencias

- El hash de la Frase de acceso se persiste en localStorage como credencial `gate` vía el seam `Platform`; no es un secreto del bundle, pero tampoco protege nada del lado del cliente: quien abra DevTools puede saltar la Puerta. SECURITY.md debe documentar que esto **no** es control de acceso real.
- La Frase se establece en el primer arranque (modo setup) y se cambia desde Ajustes confirmando la vigente; no hay afordancia para eliminar la Puerta (el reset es borrando datos del sitio).
- La Puerta se vuelve a mostrar una sola vez por carga de la aplicación; no hay re-bloqueo por inactividad ni botón de bloqueo manual.
- Sin entidad Usuario ni Sesión en el glosario ni en el código. Si el proyecto pasa a usarse por más de una persona —en particular si alguien de fuera del equipo entra—, **revisar esta decisión**: la puerta cosmética deja de alcanzar y corresponde autenticación real en servidor.

Discusión completa: sesiones de grilling de ago-2026.
