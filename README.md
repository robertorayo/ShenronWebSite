# Shenron — El ciclo eterno

Web narrativa de una sola página donde el fondo avanza con el scroll. Es un proyecto visual, sin framework ni dependencias de npm.

**Web:** <https://shenronwebsite.vercel.app>

## Qué hace

- **Animación guiada por el scroll:** 433 fotogramas WebP (1280×720, unos 80 KB cada uno) dibujados en un `<canvas>`. El fotograma que se muestra depende de la posición de la página.
- **Carga progresiva:** descarga los fotogramas en paralelo (8 a la vez) y por pasadas: primero uno de cada 16, luego uno de cada 8, y así hasta completarlos, para que todo el recorrido tenga imagen cuanto antes. La pantalla de carga dura al menos 2,5 s y se retira cuando ha llegado uno de cada 8 fotogramas; el resto sigue cargando y, si falta uno, se usa el más cercano disponible.
- **Vídeo de respaldo:** en móviles táctiles pequeños, con conexión lenta o ahorro de datos, y si los fotogramas no llegan, usa un vídeo en bucle en lugar de la secuencia. Antes muestra un aviso con el motivo, que se cierra con «Entendido» y no vuelve a salir durante la sesión.
- **Partículas luminosas** en un segundo canvas que se acercan al puntero. Con `prefers-reduced-motion` se quedan quietas.
- **Aparición de secciones** con `IntersectionObserver`.
- **Oráculo con IA:** el visitante pide un deseo y Shenron responde en primera persona con un texto generado por Gemini (Google), que aparece letra a letra. Cada dispositivo tiene tres deseos por semana, aunque varias personas compartan WiFi: se cuentan con una cookie técnica en Upstash Redis, con un tope de 9 por red para evitar abusos, y los identificadores se guardan seudonimizados con HMAC. La respuesta aparece en una tarjeta superpuesta y Shenron la pronuncia con una voz generada por Gemini TTS, a la que el navegador aplica un efecto de dragón (tono más grave y eco con Web Audio); se puede silenciar y, si la voz de Gemini no está disponible, la respuesta aparece sin voz. Al cerrar la tarjeta del tercer deseo, las siete esferas se dispersan, un estallido de luz cubre la pantalla y la página vuelve al inicio. Si la IA no responde, el deseo no se gasta y se usan frases fijas.

## Tecnología

HTML, CSS y JavaScript puro. Canvas 2D, `IntersectionObserver`, Network Information API, `<dialog>` nativo, `sessionStorage` y fuentes DM Sans y Manrope servidas desde la propia web. El Oráculo usa una función serverless de Vercel (`api/deseo.js`) que llama por `fetch` a la API de Gemini y a la API REST de Upstash, sin dependencias.

```
index.html       estructura y contenido
privacidad.html  política de privacidad
styles.css       estilos
script.js        secuencia de fotogramas, partículas, revelado y oráculo
api/deseo.js     función serverless del Oráculo (Gemini + límite de deseos)
api/voz.js       función serverless de la voz de Shenron (Gemini TTS)
api/_comun.js    utilidades compartidas por las dos funciones
assets/          fotogramas, póster y fuentes
```

## Ejecutar en local

```bash
python -m http.server 5173
```

Y abrir `http://localhost:5173`. Así el Oráculo no tiene servidor y responde con las frases fijas.

Para probar el Oráculo con IA, copia `.env.example` a `.env`, pon tus claves y arranca con Vercel CLI:

```bash
vercel dev
```
