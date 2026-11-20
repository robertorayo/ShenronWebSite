(() => {
  const FRAME_COUNT = 433;
  const FRAME_PATH = (index) => `assets/secuencia/${String(index).padStart(3, "0")}.jpg`;
  const frameCanvas = document.querySelector("#frame-canvas");
  const frameContext = frameCanvas.getContext("2d", { alpha: false });
  const video = document.querySelector("#fallback-video");
  const loading = document.querySelector("#loading");
  const loadingBar = document.querySelector("#loading-bar");
  const loadingPercent = document.querySelector("#loading-percent");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const smallTouch = matchMedia("(pointer: coarse)").matches && innerWidth < 760;
  const slowConnection = Boolean(connection && (connection.saveData || /(^|-)2g$/.test(connection.effectiveType || "")));
  const useVideoFallback = smallTouch || slowConnection;
  const frames = new Array(FRAME_COUNT + 1);
  const ready = new Array(FRAME_COUNT + 1).fill(false);
  const canvasContext = frameContext;
  let loadedCount = 0;
  let readyCount = 0;
  let currentFrame = -1;
  let resizeQueued = false;
  let fallbackTimer;
  let videoMode = useVideoFallback;
  let loadingFinished = false;
  // La pantalla de carga dura al menos esto, con la barra avanzando, aunque los fotogramas lleguen antes.
  const MIN_LOADING_MS = 2500;
  // En ordenador solo se pasa al vídeo si a estas alturas no ha llegado casi ningún fotograma.
  const FALLBACK_MS = 12000;
  // Orden de carga por pasadas: primero 1 de cada 16 fotogramas, luego 1 de cada 8, 4, 2 y el resto.
  // Así todo el recorrido tiene imagen enseguida y los huecos se rellenan después.
  const PASSES = [16, 8, 4, 2, 1];
  // La página se libera cuando han llegado las dos primeras pasadas (1 de cada 8: unos 55 fotogramas).
  const GATE_STRIDE = 8;
  // Con menos fotogramas que estos, la secuencia no sirve y se usa el vídeo.
  const MIN_FRAMES = 3;

  // maxRatio: los fotogramas miden 1280 px, así que dibujarlos al doble de resolución no gana nitidez
  // y cuesta cuatro veces más en cada paso del scroll; el lienzo de la secuencia usa 1.
  function fitCanvas(canvas, context, maxRatio = 2) {
    const ratio = Math.min(window.devicePixelRatio || 1, maxRatio);
    const width = Math.max(1, Math.round(innerWidth * ratio));
    const height = Math.max(1, Math.round(innerHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      return true;
    }
    return false;
  }

  function drawImageCover(context, image, width, height) {
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  }

  function drawFrame(index) {
    if (videoMode) return;
    let candidate = index;
    if (!ready[candidate]) {
      let distance = 1;
      while (distance < FRAME_COUNT) {
        if (candidate - distance >= 1 && ready[candidate - distance]) { candidate -= distance; break; }
        if (candidate + distance <= FRAME_COUNT && ready[candidate + distance]) { candidate += distance; break; }
        distance += 1;
      }
    }
    if (!ready[candidate] || currentFrame === candidate) return;
    drawImageCover(canvasContext, frames[candidate], innerWidth, innerHeight);
    currentFrame = candidate;
    frameCanvas.classList.add("is-ready");
    video.classList.add("is-hidden");
    video.pause();
  }

  function wantedFrame() {
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    return Math.min(FRAME_COUNT, Math.max(1, Math.round((scrollY / maxScroll) * (FRAME_COUNT - 1)) + 1));
  }

  let scrollQueued = false;
  function updateFrame() {
    scrollQueued = false;
    drawFrame(wantedFrame());
  }
  window.addEventListener("scroll", () => {
    if (!scrollQueued) {
      scrollQueued = true;
      requestAnimationFrame(updateFrame);
    }
  }, { passive: true });

  window.addEventListener("resize", () => {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => {
      if (fitCanvas(frameCanvas, canvasContext, 1)) currentFrame = -1;
      resizeQueued = false;
      drawFrame(wantedFrame());
    });
  }, { passive: true });

  function finishLoading() {
    if (loadingFinished) return;
    loadingFinished = true;
    clearTimeout(fallbackTimer);
    loading.classList.add("is-done");
    setTimeout(() => loading.remove(), 800);
  }

  // Orden de carga y cuántos fotogramas forman la primera tanda, la que hace falta para liberar la página.
  const loadOrder = [];
  const queued = new Set();
  let gateSize = 0;
  for (const stride of PASSES) {
    for (let index = 1; index <= FRAME_COUNT; index += stride) {
      if (!queued.has(index)) { queued.add(index); loadOrder.push(index); }
    }
    if (stride === GATE_STRIDE) gateSize = loadOrder.length;
  }
  let gateDone = 0;
  let loadingStart = performance.now();

  // La barra avanza con lo que va llegando, pero nunca más deprisa que el tiempo mínimo:
  // así siempre se ve progresar durante unos segundos y termina cuando la primera tanda está lista.
  function updateLoading(now) {
    if (loadingFinished || videoMode) return;
    // Math.max: el tiempo del primer fotograma puede ser algo anterior a loadingStart.
    const shown = Math.max(0, Math.min(gateDone / gateSize, (now - loadingStart) / MIN_LOADING_MS));
    const percent = Math.round(shown * 100);
    loadingBar.style.width = `${percent}%`;
    loadingPercent.textContent = `${percent}%`;
    // Misma regla que para pasar al vídeo: hacen falta al menos 3 fotogramas reales.
    if (shown >= 1 && readyCount >= MIN_FRAMES) finishLoading();
    else requestAnimationFrame(updateLoading);
  }

  function markFrameLoaded(index, image, inGate) {
    // Ya en modo vídeo, los fotogramas que lleguen tarde no deben tocar la barra ni retirar la carga.
    if (videoMode) return;
    if (image) {
      frames[index] = image;
      ready[index] = true;
      readyCount += 1;
    }
    loadedCount += 1;
    // Los errores también cuentan para la primera tanda: si no, un fotograma que falla dejaría la carga colgada.
    if (inGate) gateDone += 1;
    // Redibuja siempre: si el fotograma que llega es el que pide el scroll, sustituye al vecino provisional.
    drawFrame(wantedFrame());
    if (loadedCount === FRAME_COUNT && readyCount < MIN_FRAMES) switchToVideo();
  }

  function switchToVideo() {
    if (videoMode) return;
    clearTimeout(fallbackTimer);
    videoMode = true;
    frameCanvas.classList.remove("is-ready");
    video.classList.remove("is-hidden");
    // drawFrame pausa el vídeo al pintar un fotograma; si llegó a pintarse alguno, hay que reanudarlo.
    video.play().catch(() => {});
    enterVideoMode("timeout");
  }

  // Aviso al pasar al vídeo: explica el motivo y la pantalla de carga no se retira hasta pulsar «Entendido».
  // Se recuerda durante la sesión del navegador para no repetirlo en cada recarga.
  const notice = document.querySelector("#video-notice");
  const noticeText = document.querySelector("#notice-text");
  const NOTICE_KEY = "shenron-video-notice";
  const noticeReasons = {
    mobile: "Estás en un dispositivo móvil. Para no agotar su memoria ni tus datos, aquí la leyenda se cuenta con una versión más ligera.",
    slow: "Tu conexión es lenta o tienes activado el ahorro de datos. Para que la página cargue sin esperas, verás una versión más ligera.",
    timeout: "La secuencia de imágenes no ha llegado a tiempo. Para no hacerte esperar, verás una versión más ligera."
  };

  function enterVideoMode(reason) {
    loadingPercent.textContent = "VIDEO";
    loadingBar.style.width = "100%";
    let seen = false;
    try { seen = sessionStorage.getItem(NOTICE_KEY) === "1"; } catch (_) { /* Sin almacenamiento: se muestra el aviso. */ }
    if (seen || typeof notice.showModal !== "function") {
      finishLoading();
      return;
    }
    noticeText.textContent = noticeReasons[reason];
    // «close» llega tanto con el botón como con Esc.
    notice.addEventListener("close", () => {
      try { sessionStorage.setItem(NOTICE_KEY, "1"); } catch (_) { /* No se recordará; no pasa nada. */ }
      finishLoading();
    }, { once: true });
    notice.showModal();
  }

  fitCanvas(frameCanvas, canvasContext, 1);
  // El vídeo (8 MB) solo se pide cuando se va a usar: si se descargara siempre, competiría con los
  // fotogramas por la conexión. En ordenador, hasta entonces el fondo lo cubre el póster.
  if (useVideoFallback) {
    video.play().catch(() => {});
    enterVideoMode(smallTouch ? "mobile" : "slow");
  } else {
    // Solo si de verdad no llegan fotogramas: con alguno ya cargado, la página se libera y el resto sigue llegando.
    fallbackTimer = setTimeout(() => {
      if (loadingFinished) return;
      if (readyCount < MIN_FRAMES) {
        switchToVideo();
        return;
      }
      // Se libera por tiempo: la barra se completa antes de retirarla para que no desaparezca a medias.
      loadingBar.style.width = "100%";
      loadingPercent.textContent = "100%";
      finishLoading();
    }, FALLBACK_MS);

    const concurrency = 8;
    let next = 0;
    function loadNext() {
      // En modo vídeo se deja de pedir fotogramas: no se usarán y la conexión ya va mal.
      if (videoMode || next >= loadOrder.length) return;
      const inGate = next < gateSize;
      const index = loadOrder[next++];
      const image = new Image();
      image.decoding = "async";
      image.src = FRAME_PATH(index);
      image.onload = async () => {
        try { if (image.decode) await image.decode(); } catch (_) { /* Tras onload la imagen ya se puede dibujar. */ }
        markFrameLoaded(index, image, inGate);
        loadNext();
      };
      image.onerror = () => {
        markFrameLoaded(index, null, inGate);
        loadNext();
      };
    }
    for (let worker = 0; worker < concurrency; worker += 1) loadNext();
    loadingStart = performance.now();
    requestAnimationFrame(updateLoading);
  }

  // The same CSS transition runs when an element enters or leaves the reading area.
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        requestAnimationFrame(() => entry.target.classList.add("is-visible"));
      } else {
        entry.target.classList.remove("is-visible");
      }
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
  document.querySelectorAll(".reveal").forEach((element) => revealObserver.observe(element));

  // Small luminous motes drift toward the pointer and fade softly behind the story.
  const soulsCanvas = document.querySelector("#souls-canvas");
  const soulsContext = soulsCanvas.getContext("2d");
  const particles = [];
  const pointer = { x: innerWidth * 0.5, y: innerHeight * 0.5, active: false };
  const particleCount = smallTouch ? 15 : 34;
  for (let i = 0; i < particleCount; i += 1) {
    particles.push({ x: Math.random() * innerWidth, y: Math.random() * innerHeight, vx: 0, vy: 0, size: 0.7 + Math.random() * 1.7, phase: Math.random() * Math.PI * 2, speed: 0.2 + Math.random() * 0.5 });
  }
  fitCanvas(soulsCanvas, soulsContext);
  window.addEventListener("pointermove", (event) => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.active = true;
  }, { passive: true });
  window.addEventListener("pointerleave", () => { pointer.active = false; }, { passive: true });

  function animateSouls(time) {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (soulsCanvas.width !== Math.round(innerWidth * ratio) || soulsCanvas.height !== Math.round(innerHeight * ratio)) fitCanvas(soulsCanvas, soulsContext);
    soulsContext.clearRect(0, 0, innerWidth, innerHeight);
    particles.forEach((particle) => {
      particle.phase += 0.012 * particle.speed;
      const driftX = Math.sin(particle.phase + time * 0.0002) * 0.28;
      const driftY = Math.cos(particle.phase * 0.8 + time * 0.00016) * 0.24;
      if (pointer.active && !reducedMotion) {
        const dx = pointer.x - particle.x;
        const dy = pointer.y - particle.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const force = Math.max(0, 1 - distance / 210) * 0.012;
        particle.vx += dx * force;
        particle.vy += dy * force;
      }
      particle.vx = particle.vx * 0.96 + driftX;
      particle.vy = particle.vy * 0.96 + driftY;
      particle.x += particle.vx;
      particle.y += particle.vy;
      if (particle.x < -12) particle.x = innerWidth + 12;
      if (particle.x > innerWidth + 12) particle.x = -12;
      if (particle.y < -12) particle.y = innerHeight + 12;
      if (particle.y > innerHeight + 12) particle.y = -12;
      const alpha = 0.2 + (Math.sin(particle.phase) + 1) * 0.2;
      const glow = soulsContext.createRadialGradient(particle.x, particle.y, 0, particle.x, particle.y, particle.size * 5);
      glow.addColorStop(0, `rgba(212, 247, 223, ${alpha})`);
      glow.addColorStop(0.35, `rgba(138, 224, 186, ${alpha * 0.65})`);
      glow.addColorStop(1, "rgba(21, 155, 112, 0)");
      soulsContext.fillStyle = glow;
      soulsContext.beginPath();
      soulsContext.arc(particle.x, particle.y, particle.size * 5, 0, Math.PI * 2);
      soulsContext.fill();
    });
    if (!reducedMotion) requestAnimationFrame(animateSouls);
  }
  requestAnimationFrame(animateSouls);

  // Oráculo: cada deseo va a la función serverless /api/deseo, que cuenta tres por visitante y semana
  // y responde con la voz de Shenron generada por IA. Si la IA no está disponible, se usan frases fijas.
  const wishForm = document.querySelector("#wish-form");
  const wishInput = document.querySelector("#wish-input");
  const wishButton = wishForm.querySelector("button");
  const reply = document.querySelector("#oracle-reply");
  const oracleReplies = [
    "El dragón ha escuchado tu deseo. Mira dentro de ti: la primera respuesta ya estaba esperando.",
    "Las esferas brillan, pero ningún poder elige por ti. Avanza con valor y el camino aparecerá.",
    "Hasta la noche más larga guarda una promesa de amanecer. Tu deseo ha sido confiado al ciclo eterno."
  ];
  const SLEEP_MESSAGE = "El dragón ha regresado a su letargo y ya no escucha más voces por ahora. Vuelve cuando el cielo se abra de nuevo.";
  const SCATTERED_MESSAGE = "Las siete esferas se han dispersado por el mundo. Hasta que vuelvan a reunirse, nadie podrá invocar a Shenron. Eso llevará unos días.";
  const FALLBACK_KEY = "shenron-respaldo";
  const TYPE_DELAY = 32;
  const BEAM_DELAY = 3500;
  // Algo más que lo que puede tardar la función en el peor caso (Upstash + Gemini con un reintento).
  const REQUEST_TIMEOUT = 22000;
  const openingTitle = document.querySelector("#opening-title");
  const mainContent = document.querySelector("main");
  let typingFrame = 0;
  let busy = false;

  // Mientras Shenron escucha (o se despide) el formulario no admite otro deseo. Se usa aria-disabled en vez de
  // disabled para que el botón no pierda el foco; la guarda real es «busy».
  function lockForm(locked) {
    busy = locked;
    wishInput.readOnly = locked;
    wishButton.setAttribute("aria-disabled", String(locked));
  }

  // Pinta el texto en dos capas: una oculta para lectores de pantalla con el texto completo (se anuncia
  // una sola vez) y otra visible que se escribe letra a letra. Siempre con textContent, nunca innerHTML.
  function showReply(text, { kind = "voice", typed = true, onDone } = {}) {
    cancelAnimationFrame(typingFrame);
    const spoken = document.createElement("span");
    spoken.className = "sr-only";
    spoken.textContent = text;
    const visible = document.createElement("span");
    visible.setAttribute("aria-hidden", "true");
    reply.replaceChildren(spoken, visible);
    reply.classList.toggle("oracle__reply--notice", kind === "notice");
    reply.classList.remove("is-visible", "is-glowing", "is-listening");
    requestAnimationFrame(() => reply.classList.add("is-visible", "is-glowing"));

    if (!typed || reducedMotion) {
      visible.textContent = text;
      if (onDone) onDone();
      return;
    }
    // Array.from separa por caracteres reales (no parte letras compuestas ni emojis).
    const letters = Array.from(text);
    const start = performance.now();
    const step = (now) => {
      // El tiempo del fotograma puede ser algo anterior a «start»: sin Math.max saldría un -1.
      const count = Math.min(letters.length, Math.max(0, Math.floor((now - start) / TYPE_DELAY)));
      visible.textContent = letters.slice(0, count).join("");
      if (count < letters.length) typingFrame = requestAnimationFrame(step);
      else if (onDone) onDone();
    };
    typingFrame = requestAnimationFrame(step);
  }

  function showListening() {
    cancelAnimationFrame(typingFrame);
    reply.textContent = "Shenron escucha…";
    reply.classList.remove("oracle__reply--notice", "is-glowing");
    reply.classList.add("is-visible", "is-listening");
  }

  // Respaldo: frases fijas que no se repiten en la sesión; cuando se acaban, el dragón «se duerme».
  function fallbackReply(onDone) {
    let used = [];
    try {
      const stored = JSON.parse(sessionStorage.getItem(FALLBACK_KEY));
      if (Array.isArray(stored)) used = stored;
    } catch (_) { /* Sin almacenamiento o con datos raros: se empieza de cero. */ }
    const index = oracleReplies.findIndex((_, i) => !used.includes(i));
    if (index === -1) {
      showReply(SLEEP_MESSAGE, { kind: "notice", onDone });
      return;
    }
    try { sessionStorage.setItem(FALLBACK_KEY, JSON.stringify([...used, index])); } catch (_) { /* Se podrán repetir; no pasa nada. */ }
    showReply(oracleReplies[index], { onDone });
  }

  // Tras el tercer deseo, Shenron se retira: las esferas se dispersan desde el sello, la luz cubre la pantalla
  // y, mientras todo está blanco, la página vuelve al inicio. La duración la marca el CSS (--ascension).
  const ascension = document.querySelector("#ascension");
  const ascensionBurst = ascension.querySelector(".ascension__burst");
  const seal = document.querySelector(".oracle__seal");
  const SWITCH_POINT = 0.52;

  function releaseDragon() {
    setTimeout(() => {
      const box = seal.getBoundingClientRect();
      ascension.style.setProperty("--x", `${box.left + box.width / 2}px`);
      ascension.style.setProperty("--y", `${box.top + box.height / 2}px`);
      ascension.classList.add("is-active");
      // Mientras dura, la página de debajo no recibe ni clics ni teclado.
      mainContent.inert = true;
      const duration = parseFloat(getComputedStyle(ascension).getPropertyValue("--ascension")) * 1000 || 5000;
      setTimeout(() => scrollTo({ top: 0, behavior: "instant" }), duration * SWITCH_POINT);
      // Si la animación no termina (se cancela o el navegador la omite), el temporizador la retira igualmente.
      let safety = 0;
      const finish = () => {
        clearTimeout(safety);
        ascensionBurst.removeEventListener("animationend", finish);
        ascensionBurst.removeEventListener("animationcancel", finish);
        ascension.classList.remove("is-active");
        mainContent.inert = false;
        lockForm(false);
        // El foco va al título del inicio, para que teclado y lector de pantalla sepan dónde están.
        // Tiene que ser después de quitar «inert»: un elemento inerte no puede recibir el foco.
        openingTitle.focus({ preventScroll: true });
      };
      safety = setTimeout(finish, duration + 500);
      ascensionBurst.addEventListener("animationend", finish);
      ascensionBurst.addEventListener("animationcancel", finish);
    }, BEAM_DELAY);
  }

  wishForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const wish = wishInput.value.trim();
    if (!wish || busy) return;
    lockForm(true);
    wishInput.value = "";
    reply.setAttribute("aria-busy", "true");
    showListening();
    let result = { respaldo: true };
    try {
      const response = await fetch("/api/deseo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deseo: wish }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT)
      });
      result = await response.json();
    } catch (_) { /* Sin conexión, sin servidor o sin respuesta a tiempo: se usa el respaldo. */ }
    reply.removeAttribute("aria-busy");

    // Con el tercer deseo gastado, el formulario sigue bloqueado hasta que termine la ascensión.
    const last = result.restantes === 0;
    const after = last ? releaseDragon : () => lockForm(false);
    if (result.agotado) showReply(SCATTERED_MESSAGE, { kind: "notice", onDone: after });
    else if (typeof result.respuesta === "string" && result.respuesta) showReply(result.respuesta, { onDone: after });
    else fallbackReply(after);
  });
})();
