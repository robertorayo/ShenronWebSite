# Diseño — decisiones tomadas

## Oráculo con IA (noviembre de 2026)

- **Voz:** Shenron en primera persona, épico y solemne. Responde con un párrafo corto, poético y enigmático, relacionado con lo pedido. Nunca rechaza un deseo: ante lo ofensivo, peligroso o absurdo, contesta con un rodeo.
- **Tres deseos por semana y dispositivo** (cookie técnica), con un tope de 9 por red. Los deseos son independientes: no hay memoria entre ellos.
- **Tarjeta de respuesta (boceto A «Tablilla de jade», elegido):** un `<dialog>` modal centrado sobre el fondo oscurecido y desenfocado. Cristal verde oscuro con borde jade (más claro arriba), el sello 龍 con dos anillos encima, «SHENRON HABLA» y el texto en Manrope 16-19 px que se escribe letra a letra. Botones «Silenciar voz» (contorno) y «Cerrar» (relleno `--foam`), y una ✕ en la esquina. Se abre al pulsar «Invocar» con «Shenron escucha…» y los anillos latiendo; se cierra solo con el botón, la ✕ o Esc. En el tercer deseo, al cerrarla empieza la ascensión.
- **Voz de Shenron:** Gemini TTS (`gemini-3.8-flash-lite-tts`) con la etiqueta de estilo «[con voz grave y solemne]», más un efecto en el navegador: tono más grave (velocidad de reproducción 0,85) y eco (reverberación sintética). Habla sola al llegar la respuesta; el botón la silencia y se recuerda. Si Gemini no da voz (el plan gratuito admite 3 audios por minuto), habla la voz del navegador, sin efecto.
- **Tarjeta de aviso (misma tablilla):** voz de narrador neutra, sin hablar: las siete esferas apagadas, «EL CICLO SE HA CERRADO», el texto en `--muted` y un único botón «Entendido». Se usa para los deseos agotados y para el dragón dormido.
- **Descartados (tarjetas):** B (subtítulos de cine con bandas negras) y C (panel abajo con el sello como boca y contador de deseos).
- **Ascensión tras el tercer deseo (boceto B elegido):** al cerrar la tarjeta de la tercera respuesta, siete esferas del dragón (naranjas, con de una a siete estrellas rojas) salen disparadas del sello 龍 en siete direcciones. Las sigue un estallido radial de `--ink` a `--foam` que cubre la pantalla. Con la pantalla en blanco se vuelve al inicio, y la luz se desvanece. Dura 5 s.
  - El naranja de las esferas (`--sphere-*`) es la única excepción a la paleta jade.
  - Con `prefers-reduced-motion`: sin esferas, solo un fundido a jade de 2,4 s.
- **Descartados (ascensión):** A (columna de jade vertical) y C (barrido diagonal de amanecer).
