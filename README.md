# Shenron — El ciclo eterno

Web narrativa de una sola página donde el fondo avanza con el scroll. Es un proyecto visual, sin framework ni dependencias.

**Web:** <https://shenronwebsite.vercel.app>

## Qué hace

- **Animación guiada por el scroll:** 239 fotogramas JPG dibujados en un `<canvas>`. El fotograma que se muestra depende de la posición de la página.
- **Carga progresiva:** descarga los fotogramas en paralelo (8 a la vez), con barra de progreso. La página se muestra en cuanto llega el primero y el resto sigue cargando; si falta un fotograma, usa el más cercano disponible.
- **Vídeo de respaldo:** en móviles táctiles pequeños, con conexión lenta o ahorro de datos, y si los fotogramas tardan demasiado, usa un vídeo en bucle en lugar de la secuencia.
- **Partículas luminosas** en un segundo canvas que se acercan al puntero. Con `prefers-reduced-motion` se quedan quietas.
- **Aparición de secciones** con `IntersectionObserver`.
- **Oráculo:** formulario cuyas respuestas son frases predefinidas. No usa ningún modelo ni servicio externo.

## Tecnología

HTML, CSS y JavaScript puro. Canvas 2D, `IntersectionObserver`, Network Information API y Google Fonts (DM Sans y Manrope).

```
index.html    estructura y contenido
styles.css    estilos
script.js     secuencia de fotogramas, partículas, revelado y oráculo
assets/       fotogramas y póster
```

## Ejecutar en local

```bash
python -m http.server 5173
```

Y abrir `http://localhost:5173`.
