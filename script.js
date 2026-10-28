(() => {
  const FRAME_COUNT = 239;
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
  let currentFrame = -1;
  let resizeQueued = false;
  let fallbackTimer;
  let videoMode = useVideoFallback;
  let loadingFinished = false;

  function fitCanvas(canvas, context) {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
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
      fitCanvas(frameCanvas, canvasContext);
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

  function markFrameLoaded(index, image) {
    if (image) {
      frames[index] = image;
      ready[index] = true;
    }
    loadedCount += 1;
    const percent = Math.round((loadedCount / FRAME_COUNT) * 100);
    loadingBar.style.width = `${percent}%`;
    loadingPercent.textContent = `${percent}%`;
    if (index === 1 || currentFrame === -1) drawFrame(wantedFrame());
    if (loadedCount === FRAME_COUNT) finishLoading();
  }

  fitCanvas(frameCanvas, canvasContext);
  video.play().catch(() => {});
  if (useVideoFallback) {
    loadingPercent.textContent = "VIDEO";
    loadingBar.style.width = "100%";
    finishLoading();
  } else {
    fallbackTimer = setTimeout(() => {
      if (frames.filter(Boolean).length < 3) {
        videoMode = true;
        frameCanvas.classList.remove("is-ready");
        video.classList.remove("is-hidden");
        loadingPercent.textContent = "VIDEO";
        finishLoading();
      }
    }, 3200);

    const concurrency = 8;
    let next = 1;
    function loadNext() {
      if (next > FRAME_COUNT) return;
      const index = next++;
      const image = new Image();
      image.decoding = "async";
      image.src = FRAME_PATH(index);
      image.onload = async () => {
        try { if (image.decode) await image.decode(); } catch (_) { /* Image is still drawable after onload. */ }
        markFrameLoaded(index, image);
        loadNext();
      };
      image.onerror = () => {
        markFrameLoaded(index, null);
        loadNext();
      };
    }
    for (let worker = 0; worker < concurrency; worker += 1) loadNext();
  }

  // Fade each story beat in and out as it crosses the reading window.
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => entry.target.classList.toggle("is-visible", entry.isIntersecting));
  }, { threshold: 0.24, rootMargin: "-8% 0px -8% 0px" });
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

  const wishForm = document.querySelector("#wish-form");
  const wishInput = document.querySelector("#wish-input");
  const reply = document.querySelector("#oracle-reply");
  const oracleReplies = [
    "El dragón ha escuchado tu deseo. Mira dentro de ti: la primera respuesta ya estaba esperando.",
    "Las esferas brillan, pero ningún poder elige por ti. Avanza con valor y el camino aparecerá.",
    "Hasta la noche más larga guarda una promesa de amanecer. Tu deseo ha sido confiado al ciclo eterno."
  ];
  wishForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!wishInput.value.trim()) return;
    reply.textContent = oracleReplies[(wishInput.value.trim().length + wishInput.value.trim().charCodeAt(0)) % oracleReplies.length];
    reply.classList.remove("is-visible", "is-glowing");
    requestAnimationFrame(() => {
      reply.classList.add("is-visible", "is-glowing");
    });
    wishInput.value = "";
  });
})();
