(() => {
  // Al entrar o recargar, la web empieza arriba del todo (el navegador, por defecto, vuelve a donde estabas).
  // Si se llega con un ancla (por ejemplo, «volver al oráculo» desde la privacidad), se respeta.
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  if (!location.hash) scrollTo({ top: 0, behavior: "instant" });

  const FRAME_COUNT = 433;
  // WebP calidad 50 (unos 80 KB cada uno, la mitad que en JPG): pesan menos y la carga es más rápida.
  const FRAME_PATH = (index) => `assets/secuencia/${String(index).padStart(3, "0")}.webp`;
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
  // La página se libera cuando ha llegado la primera pasada (1 de cada 16: 28 fotogramas, unos 2 MB).
  // Basta para que todo el recorrido tenga imagen; las siguientes pasadas afinan mientras se baja.
  const GATE_STRIDE = 16;
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
  const card = document.querySelector("#shenron-card");
  const cardText = document.querySelector("#shenron-card-text");
  const muteButton = document.querySelector("#shenron-mute");
  const muteLabel = document.querySelector("#shenron-mute-label");
  const noticeCard = document.querySelector("#notice-card");
  const noticeCardTitle = document.querySelector("#notice-card-title");
  const noticeCardText = document.querySelector("#notice-card-text");
  const oracleReplies = [
    "El dragón ha escuchado tu deseo. Mira dentro de ti: la primera respuesta ya estaba esperando.",
    "Las esferas brillan, pero ningún poder elige por ti. Avanza con valor y el camino aparecerá.",
    "Hasta la noche más larga guarda una promesa de amanecer. Tu deseo ha sido confiado al ciclo eterno."
  ];
  const SLEEP_MESSAGE = "El dragón ha regresado a su letargo y ya no escucha más voces por ahora. Vuelve cuando el cielo se abra de nuevo.";
  const SCATTERED_MESSAGE = "Las siete esferas se han dispersado por el mundo. Hasta que vuelvan a reunirse, nadie podrá invocar a Shenron. Eso llevará unos días.";
  // Respuestas de Shenron cuando no entiende el deseo, una lista por caso (ver unclearWish). Nunca adivinan
  // lo que se quiso decir. En las cuatro primeras el deseo no se gasta y Shenron lo dice; en «gemini» sí.
  const unclearReplies = {
    vacio: [
      "Me invocas, pero callas. El silencio no despierta a un dragón. Tus deseos siguen intactos.",
      "Nada ha llegado hasta mí salvo el viento. Habla, y ningún deseo se habrá perdido.",
      "Una invocación sin palabras es un eco sin voz. Dime qué buscas; tus deseos te esperan."
    ],
    signos: [
      "Solo me llegan signos, como huellas en la arena. Habla con palabras; tus deseos siguen intactos.",
      "Esos símbolos no tienen voz para un dragón. Escribe lo que anhelas; ningún deseo se ha perdido.",
      "Veo marcas, no palabras, y el cielo no responde a lo que no se dice. Tus deseos te esperan."
    ],
    numero: [
      "Me ofreces un número y nada más. Las esferas saben contar, pero yo no sé qué anhelas. Tus deseos siguen intactos.",
      "Una cifra no es un deseo, ni un puesto es un camino. Dime qué buscas; ningún deseo se ha perdido.",
      "Siete son las esferas y uno solo el dragón, pero los números no me dicen qué deseas. Tus deseos te esperan."
    ],
    galimatias: [
      "Esas palabras no pertenecen a ninguna lengua que yo conozca. Habla con claridad; tus deseos siguen intactos.",
      "Tus palabras se pierden en el viento y no adivinaré lo que no has dicho. Ningún deseo se ha perdido.",
      "Hasta el más antiguo de los dragones necesita entender lo que se le pide. Habla claro; tus deseos te esperan."
    ],
    gemini: [
      "He escuchado tu voz, pero no tu deseo. No pondré en tu boca lo que no has dicho, y esta invocación ya se ha consumido.",
      "Tus palabras no forman ningún deseo que pueda cumplir. El dragón no inventa lo que no se pide, y esta invocación se ha perdido.",
      "Ni el cielo ni las esferas comprenden lo que has pedido. Esta vez no hay deseo que conceder, pero la invocación ya se ha gastado."
    ]
  };
  const UNCLEAR_KEY = "shenron-no-entendido";
  const FALLBACK_KEY = "shenron-respaldo";
  const TYPE_DELAY = 32;
  // Pausa entre cerrar la tarjeta del tercer deseo y que empiecen a salir las esferas.
  const ASCENSION_DELAY = 500;
  // Algo más que lo que puede tardar la función en el peor caso (Upstash + Gemini con un reintento).
  const REQUEST_TIMEOUT = 22000;
  const openingTitle = document.querySelector("#opening-title");
  const mainContent = document.querySelector("main");
  let typingFrame = 0;
  let busy = false;

  // Bloqueo del scroll mientras Shenron escucha, responde o se despide. Primero se centra el Oráculo, para
  // que el sello (de donde salen las esferas) y la respuesta estén a la vista; luego se bloquea con
  // overflow: hidden en <html>. Hasta que acaba ese desplazamiento, se frenan la rueda, el dedo y las teclas
  // del usuario (por eso esos listeners no son pasivos: necesitan preventDefault).
  const oracleInner = document.querySelector(".oracle__inner");
  const SCROLL_KEYS = new Set([" ", "PageUp", "PageDown", "ArrowUp", "ArrowDown", "Home", "End"]);
  let scrollLockTimer = 0;
  // Lo que pasa dentro de una tarjeta (<dialog>) no se bloquea: en pantallas pequeñas la tarjeta puede
  // necesitar su propio scroll, y Espacio o las flechas tienen que seguir funcionando en sus botones.
  const insideDialog = (event) => event.target instanceof Element && Boolean(event.target.closest("dialog"));
  const blockScroll = (event) => {
    if (!insideDialog(event)) event.preventDefault();
  };
  const blockScrollKeys = (event) => {
    const typing = event.target instanceof HTMLInputElement && !event.target.readOnly;
    if (SCROLL_KEYS.has(event.key) && !typing && !insideDialog(event)) event.preventDefault();
  };

  function lockScroll() {
    addEventListener("wheel", blockScroll, { passive: false });
    addEventListener("touchmove", blockScroll, { passive: false });
    addEventListener("keydown", blockScrollKeys);
    const box = oracleInner.getBoundingClientRect();
    const visible = box.top >= 0 && box.bottom <= innerHeight;
    const freeze = () => {
      clearTimeout(scrollLockTimer);
      document.documentElement.classList.add("is-scroll-locked");
    };
    if (visible) {
      freeze();
      return;
    }
    // Si el Oráculo está lejos (más de una pantalla y media), se salta de golpe: un desplazamiento suave tan
    // largo no acabaría antes de bloquear el scroll.
    const far = Math.abs(box.top) > innerHeight * 1.5;
    oracleInner.scrollIntoView({ block: "center", behavior: reducedMotion || far ? "instant" : "smooth" });
    // scrollend avisa cuando acaba el desplazamiento suave; el temporizador cubre navegadores sin él.
    addEventListener("scrollend", freeze, { once: true });
    scrollLockTimer = setTimeout(freeze, 1500);
  }

  function unlockScroll() {
    clearTimeout(scrollLockTimer);
    removeEventListener("wheel", blockScroll);
    removeEventListener("touchmove", blockScroll);
    removeEventListener("keydown", blockScrollKeys);
    document.documentElement.classList.remove("is-scroll-locked");
  }

  // Mientras Shenron escucha (o se despide) el formulario no admite otro deseo y no se puede hacer scroll.
  // Se usa aria-disabled en vez de disabled para que el botón no pierda el foco; la guarda real es «busy».
  function lockForm(locked) {
    busy = locked;
    wishInput.readOnly = locked;
    wishButton.setAttribute("aria-disabled", String(locked));
    if (locked) lockScroll();
    else unlockScroll();
  }

  // ── Voz de Shenron ─────────────────────────────────────────────────────────────────────────────────
  // La respuesta se convierte en voz con api/voz.js (Gemini TTS) y suena con un efecto de dragón: más grave
  // (se reproduce al 85 % de velocidad, lo que baja el tono) y con eco (reverberación sintética).
  // Si Gemini no da voz (su plan gratuito admite 3 audios por minuto), Shenron calla: nunca habla la voz del
  // navegador, que no suena a dragón. Las frases fijas (respaldo y deseos no entendidos) tampoco suenan.
  // El botón de silencio se recuerda en este navegador; silenciada, ni siquiera se pide el audio.
  const MUTE_KEY = "shenron-voz-silenciada";
  const VOICE_TIMEOUT = 15000;
  let muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === "1"; } catch (_) { /* Sin almacenamiento: con voz. */ }
  let audioContext = null;
  let reverb = null;
  let voiceSource = null;
  let voiceRequest = null;
  let lastVoice = null; // { text, ticket, buffer }: para volver a hablar si se reactiva la voz

  // La etiqueta dice lo que hará el botón; el icono se cambia con data-muted (sin aria-pressed, que con una
  // etiqueta cambiante haría anunciar «Activar voz, pulsado»).
  function updateMuteButton() {
    muteButton.dataset.muted = String(muted);
    muteLabel.textContent = muted ? "Activar voz" : "Silenciar voz";
  }
  updateMuteButton();

  // El audio solo puede empezar tras un gesto del visitante: el contexto se crea al pulsar «Invocar».
  function unlockAudio() {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    if (!audioContext) audioContext = new Context();
    if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
  }

  // Eco sintético: ruido que se apaga poco a poco, usado como la respuesta de una sala enorme.
  function makeReverb(seconds = 2.8, decay = 3.2) {
    const length = Math.floor(audioContext.sampleRate * seconds);
    const impulse = audioContext.createBuffer(2, length, audioContext.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
    const convolver = audioContext.createConvolver();
    convolver.buffer = impulse;
    const wet = audioContext.createGain();
    wet.gain.value = 0.35;
    convolver.connect(wet).connect(audioContext.destination);
    return convolver;
  }

  async function playDragonVoice(buffer) {
    stopVoice();
    // En iOS el contexto puede quedar suspendido o interrumpido: si no arranca, no suena.
    if (audioContext.state !== "running") {
      try { await audioContext.resume(); } catch (_) { /* Se comprueba abajo. */ }
    }
    if (audioContext.state !== "running") return;
    if (!reverb) reverb = makeReverb();
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 0.85;
    // Se apagan un poco los agudos para que suene más profunda.
    const tone = audioContext.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 4200;
    const dry = audioContext.createGain();
    dry.gain.value = 0.9;
    source.connect(tone);
    tone.connect(dry).connect(audioContext.destination);
    tone.connect(reverb);
    source.addEventListener("ended", () => {
      if (voiceSource === source) card.classList.remove("is-speaking");
    });
    voiceSource = source;
    card.classList.add("is-speaking");
    source.start();
  }

  // stopVoice para todo; stopPlayback solo lo que suena (al silenciar, el audio que se está pidiendo sigue
  // llegando y se guarda, porque su ficha ya se ha gastado y al reactivar no se podría pedir otra vez).
  function stopVoice() {
    if (voiceRequest) voiceRequest.abort();
    voiceRequest = null;
    stopPlayback();
  }

  function stopPlayback() {
    if (voiceSource) {
      try { voiceSource.stop(); } catch (_) { /* Ya había terminado. */ }
      voiceSource = null;
    }
    card.classList.remove("is-speaking");
  }

  async function speak(text, ticket) {
    stopVoice();
    lastVoice = { text, ticket, buffer: null };
    if (muted) return;
    if (ticket && audioContext) {
      const controller = new AbortController();
      voiceRequest = controller;
      const timer = setTimeout(() => controller.abort(), VOICE_TIMEOUT);
      try {
        const response = await fetch("/api/voz", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ texto: text, ficha: ticket }),
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`voz ${response.status}`);
        const buffer = await audioContext.decodeAudioData(await response.arrayBuffer());
        clearTimeout(timer);
        // Si entretanto se cerró la tarjeta, no suena; si se silenció, se guarda para cuando se reactive.
        if (voiceRequest !== controller) return;
        voiceRequest = null;
        lastVoice.buffer = buffer;
        if (!muted) playDragonVoice(buffer);
        return;
      } catch (_) {
        clearTimeout(timer);
        // Sin voz de Gemini (cuota, red o tiempo agotado) o cancelada al cerrar la tarjeta: Shenron calla.
        if (voiceRequest === controller) voiceRequest = null;
      }
    }
  }

  muteButton.addEventListener("click", () => {
    muted = !muted;
    try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch (_) { /* No se recordará; no pasa nada. */ }
    updateMuteButton();
    if (muted) {
      stopPlayback();
      return;
    }
    // Al reactivarla, vuelve a hablar desde el principio. Si el audio aún se está pidiendo, sonará al llegar.
    unlockAudio();
    if (!card.open || !lastVoice || card.classList.contains("is-listening") || voiceRequest) return;
    if (lastVoice.buffer) playDragonVoice(lastVoice.buffer);
  });

  // ── Tarjetas ───────────────────────────────────────────────────────────────────────────────────────
  // Al cerrar una tarjeta (botón, ✕ o Esc) se hace lo que toque: liberar el formulario o, tras el tercer
  // deseo, empezar la ascensión.
  let afterCard = null;
  let switchingCard = false;

  function openDialog(dialog) {
    if (!dialog.open) dialog.showModal();
  }

  // Pinta el texto en dos capas: una oculta para lectores de pantalla con el texto completo (se anuncia
  // una sola vez) y otra visible que se escribe letra a letra. Siempre con textContent, nunca innerHTML.
  function typeText(text) {
    cancelAnimationFrame(typingFrame);
    const spoken = document.createElement("span");
    spoken.className = "sr-only";
    spoken.textContent = text;
    const visible = document.createElement("span");
    visible.setAttribute("aria-hidden", "true");
    cardText.replaceChildren(spoken, visible);
    if (reducedMotion) {
      visible.textContent = text;
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
    };
    typingFrame = requestAnimationFrame(step);
  }

  // Mientras Shenron escucha, los botones de cierre no hacen nada y así se anuncia.
  function setListening(listening) {
    card.classList.toggle("is-listening", listening);
    card.querySelectorAll("[data-close]").forEach((button) => button.setAttribute("aria-disabled", String(listening)));
  }

  function showListening() {
    cancelAnimationFrame(typingFrame);
    cardText.textContent = "Shenron escucha…";
    setListening(true);
    openDialog(card);
  }

  function showAnswer(text, { ticket = null, onClose } = {}) {
    afterCard = onClose;
    setListening(false);
    openDialog(card);
    typeText(text);
    speak(text, ticket);
  }

  function showNotice(text, { title, asleep = false, onClose } = {}) {
    // Si la tarjeta de Shenron estaba abierta escuchando, se cambia por el aviso sin disparar su cierre.
    if (card.open) {
      switchingCard = true;
      setListening(false);
      card.close();
    }
    afterCard = onClose;
    noticeCardTitle.textContent = title;
    noticeCardText.textContent = text;
    noticeCard.classList.toggle("shenron-card--asleep", asleep);
    openDialog(noticeCard);
  }

  function handleCardClosed(event) {
    // Chrome cierra el diálogo con un segundo Esc aunque se cancele el primero: mientras escucha, se reabre.
    if (event.target.classList.contains("is-listening")) {
      event.target.showModal();
      return;
    }
    cancelAnimationFrame(typingFrame);
    stopVoice();
    if (switchingCard) {
      switchingCard = false;
      return;
    }
    const next = afterCard;
    afterCard = null;
    if (next) next();
  }

  for (const dialog of [card, noticeCard]) {
    dialog.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => {
      // Mientras Shenron escucha no se cierra: la respuesta está a punto de llegar.
      if (!dialog.classList.contains("is-listening")) dialog.close();
    }));
    dialog.addEventListener("cancel", (event) => {
      if (dialog.classList.contains("is-listening")) event.preventDefault();
    });
    dialog.addEventListener("close", handleCardClosed);
  }

  // Respaldo: frases fijas que no se repiten en la sesión; cuando se acaban, el dragón «se duerme».
  function fallbackReply(onClose) {
    let used = [];
    try {
      const stored = JSON.parse(sessionStorage.getItem(FALLBACK_KEY));
      if (Array.isArray(stored)) used = stored;
    } catch (_) { /* Sin almacenamiento o con datos raros: se empieza de cero. */ }
    const index = oracleReplies.findIndex((_, i) => !used.includes(i));
    if (index === -1) {
      showNotice(SLEEP_MESSAGE, { title: "El dragón descansa", asleep: true, onClose });
      return;
    }
    try { sessionStorage.setItem(FALLBACK_KEY, JSON.stringify([...used, index])); } catch (_) { /* Se podrán repetir; no pasa nada. */ }
    showAnswer(oracleReplies[index], { onClose });
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
    }, ASCENSION_DELAY);
  }

  // Deseo que Shenron no puede entender: copia de unclearWish() de api/_comun.js, que repite la comprobación
  // en el servidor; allí están explicados los casos con ejemplos. Si cambias una, cambia la otra.
  const NUMBER_WORDS = new Set([
    "cero", "uno", "una", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce",
    "veinte", "cien", "ciento", "mil", "millon", "primero", "primera", "primer", "segundo", "segunda", "tercero",
    "tercera", "tercer", "cuarto", "cuarta", "quinto", "quinta", "sexto", "sexta", "septimo", "septima", "octavo",
    "octava", "noveno", "novena", "decimo", "decima", "undecimo", "undecima", "duodecimo", "duodecima"
  ]);
  const ORDINAL_ENDINGS = new Set(["o", "a", "os", "as", "er", "ero", "era"]);
  const KEYBOARD_ROWS = ["qwertyuiop", "asdfghjkln", "zxcvbnm"];

  function unclearWish(text) {
    const plain = text.toLowerCase().replace(/º/g, "o").replace(/ª/g, "a").normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
    if (!plain) return "vacio";
    const tokens = plain.match(/\p{N}+|\p{L}+/gu) || [];
    if (!tokens.length) return "signos";
    const isNumber = (token) => /^\p{N}+$/u.test(token) || NUMBER_WORDS.has(token) || /^\p{L}*esim[oa]s?$/u.test(token);
    if (tokens.some(isNumber) && tokens.every((token) => isNumber(token) || ORDINAL_ENDINGS.has(token))) return "numero";
    const words = plain.match(/\p{L}+/gu) || [];
    if (words.join("").length < 2 && !/\p{Script=Han}/u.test(plain)) return "galimatias";
    const latin = plain.replace(/[^a-z]/g, "");
    if (latin && !/[aeiouy]/.test(latin)) return "galimatias";
    if (/[b-df-hj-np-tv-xz]{5,}/.test(plain)) return "galimatias";
    if (words.length === 1 && onKeyboardRow(words[0])) return "galimatias";
    return null;
  }

  function onKeyboardRow(word) {
    const rows = KEYBOARD_ROWS.flatMap((row) => [row, [...row].reverse().join("")]);
    for (let i = 0; i + 4 <= word.length; i += 1) {
      if (rows.some((row) => row.includes(word.slice(i, i + 4)))) return true;
    }
    return false;
  }

  // Elige la siguiente frase del caso sin repetir ninguna en la sesión, como fallbackReply. Aquí, al acabarse,
  // la lista vuelve a empezar: equivocarse al escribir no gasta nada y no debe dormir al dragón.
  function unclearReply(kind) {
    // El caso puede venir del servidor: solo se aceptan los conocidos (nada de «__proto__» y similares).
    if (!Object.hasOwn(unclearReplies, kind)) kind = "galimatias";
    const replies = unclearReplies[kind];
    let used = {};
    try {
      const stored = JSON.parse(sessionStorage.getItem(UNCLEAR_KEY));
      if (stored && typeof stored === "object") used = stored;
    } catch (_) { /* Sin almacenamiento o con datos raros: se empieza de cero. */ }
    const seen = Array.isArray(used[kind]) ? used[kind] : [];
    let index = replies.findIndex((_, i) => !seen.includes(i));
    if (index === -1) index = 0;
    used[kind] = index === 0 ? [0] : [...seen, index];
    try { sessionStorage.setItem(UNCLEAR_KEY, JSON.stringify(used)); } catch (_) { /* Se podrán repetir; no pasa nada. */ }
    return replies[index];
  }

  // Shenron dice que no ha entendido. El texto se queda en el campo y se selecciona al cerrar, para
  // corregirlo sin escribirlo de nuevo.
  function showUnclear(kind, wish) {
    wishInput.value = wish;
    lockForm(true);
    showAnswer(unclearReply(kind), { onClose: () => {
      lockForm(false);
      wishInput.select();
    } });
  }

  wishForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    const wish = wishInput.value.trim();
    // Se comprueba antes de llamar a la API: así no se gasta ni un deseo ni una petición.
    const unclear = unclearWish(wish);
    if (unclear) {
      unlockAudio();
      showUnclear(unclear, wishInput.value);
      return;
    }
    lockForm(true);
    unlockAudio();
    wishInput.value = "";
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

    // Con el tercer deseo gastado, el formulario sigue bloqueado y, al cerrar la tarjeta, empieza la ascensión.
    const last = result.restantes === 0;
    const onClose = last ? releaseDragon : () => lockForm(false);
    // Por si el servidor lo rechaza aunque el navegador lo diera por bueno (las dos copias deberían coincidir).
    if (result.error === "sinsentido" || result.error === "vacio") {
      showUnclear(typeof result.caso === "string" ? result.caso : "vacio", wish);
    } else if (result.noEntendido) showAnswer(unclearReply("gemini"), { onClose });
    else if (result.agotado) showNotice(SCATTERED_MESSAGE, { title: "El ciclo se ha cerrado", onClose });
    else if (typeof result.respuesta === "string" && result.respuesta) showAnswer(result.respuesta, { ticket: result.voz, onClose });
    else fallbackReply(onClose);
  });
})();
