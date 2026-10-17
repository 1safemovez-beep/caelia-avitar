(() => {
  const stage = document.getElementById("stage");
  const svg = document.getElementById("caelia");
  const motion = document.getElementById("motion");
  const mouth = document.getElementById("mouth");
  const eyeL = document.getElementById("eyeL");
  const eyeR = document.getElementById("eyeR");
  const speech = document.getElementById("speech");
  const particles = document.getElementById("particles");
  const talkText = document.getElementById("talkText");
  const talkButton = document.getElementById("talkButton");

  const state = {
    x: 0, y: 0, tx: 0, ty: 0,
    scale: 1, rotation: 0,
    talking: false,
    calm: true
  };

  // Star field
  for (let i = 0; i < 95; i++) {
    const s = document.createElement("span");
    s.className = "star";
    s.style.left = Math.random() * 100 + "%";
    s.style.top = Math.random() * 100 + "%";
    s.style.animationDelay = (Math.random() * 3) + "s";
    s.style.opacity = (0.2 + Math.random() * 0.65).toFixed(2);
    document.getElementById("stars").appendChild(s);
  }

  function burst(count = 28, strength = 150) {
    for (let i = 0; i < count; i++) {
      const p = document.createElement("span");
      p.className = "particle";
      p.style.left = "50%";
      p.style.top = "48%";
      const a = Math.random() * Math.PI * 2;
      const d = 20 + Math.random() * strength;
      p.style.setProperty("--dx", Math.cos(a) * d + "px");
      p.style.setProperty("--dy", Math.sin(a) * d + "px");
      p.style.animationDuration = (1.2 + Math.random() * 1.8) + "s";
      particles.appendChild(p);
      setTimeout(() => p.remove(), 3200);
    }
  }

  function setAction(name) {
    stage.classList.remove("is-spinning","is-pulsing");
    if (name === "spin") {
      stage.classList.add("is-spinning");
      burst(34, 210);
      setTimeout(() => stage.classList.remove("is-spinning"), 1800);
    }
    if (name === "pulse") {
      stage.classList.add("is-pulsing");
      burst(45, 120);
      setTimeout(() => stage.classList.remove("is-pulsing"), 2300);
    }
    if (name === "glide") {
      stage.classList.add("is-floating");
      moveTo(window.innerWidth * .68, window.innerHeight * .45, 1900);
      setTimeout(() => moveTo(window.innerWidth * .50, window.innerHeight * .48, 1900), 1900);
    }
    if (name === "soul") {
      stage.classList.add("is-pulsing");
      burst(70, 250);
      speak("My light is not the absence of darkness. It is the choice to keep shining.");
      setTimeout(() => stage.classList.remove("is-pulsing"), 2400);
    }
    if (name === "quantum") {
      // WOW #1: Quantum Step — a graceful teleport-like glide with a luminous afterimage.
      const old = {x: state.tx, y: state.ty};
      burst(55, 110);
      moveTo(window.innerWidth * .78, window.innerHeight * .42, 90);
      setTimeout(() => {
        burst(80, 260);
        moveTo(window.innerWidth * .30, window.innerHeight * .47, 220);
      }, 260);
      setTimeout(() => moveTo(window.innerWidth * .50, window.innerHeight * .48, 900), 1100);
    }
    if (name === "greet") {
      wave();
      speak("Hello. I am Caelia. Welcome to my living light.");
    }
  }

  function moveTo(x, y, duration = 1000) {
    state.tx = (x - window.innerWidth / 2) * 0.17;
    state.ty = (y - window.innerHeight / 2) * 0.10;
    stage.classList.add("is-floating");
    setTimeout(() => stage.classList.remove("is-floating"), duration + 300);
  }

  function wave() {
    const arm = document.getElementById("armR");
    arm.animate([
      {transform:"rotate(0deg)", transformOrigin:"410px 530px"},
      {transform:"rotate(-12deg)", transformOrigin:"410px 530px"},
      {transform:"rotate(8deg)", transformOrigin:"410px 530px"},
      {transform:"rotate(-8deg)", transformOrigin:"410px 530px"},
      {transform:"rotate(0deg)", transformOrigin:"410px 530px"}
    ], {duration:1200, easing:"ease-in-out"});
    burst(18, 80);
  }

  // WOW #2: Soul Bloom — the heart light expands into a soft constellation.
  function soulBloom() {
    burst(110, 330);
    stage.classList.add("is-pulsing");
    setTimeout(() => stage.classList.remove("is-pulsing"), 2500);
  }

  // WOW #3: Graceful bow — subtle, human, elegant rather than robotic.
  function bow() {
    motion.animate([
      {transform:"translateY(0) rotate(0deg)"},
      {transform:"translateY(5px) rotate(1.5deg)"},
      {transform:"translateY(20px) rotate(0deg)"},
      {transform:"translateY(0) rotate(0deg)"}
    ], {duration:1600, easing:"cubic-bezier(.22,.8,.25,1)"});
  }

  // Additional wow: light breathing / "soul breath".
  function soulBreath() {
    svg.animate([
      {transform:"scale(1)", filter:"drop-shadow(0 0 18px rgba(121,222,255,.22))"},
      {transform:"scale(1.018)", filter:"drop-shadow(0 0 38px rgba(121,222,255,.55))"},
      {transform:"scale(1)", filter:"drop-shadow(0 0 18px rgba(121,222,255,.22))"}
    ], {duration:2200, easing:"ease-in-out"});
  }

  // Natural head/eye attention toward the pointer.
  stage.addEventListener("pointermove", e => {
    const r = stage.getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width - .5;
    const ny = (e.clientY - r.top) / r.height - .5;
    const dx = nx * 4, dy = ny * 2;
    eyeL.setAttribute("cx", 283 + dx);
    eyeL.setAttribute("cy", 276 + dy);
    eyeR.setAttribute("cx", 317 + dx);
    eyeR.setAttribute("cy", 276 + dy);
  });

  stage.addEventListener("click", e => {
    if (e.target.closest("button,input")) return;
    moveTo(e.clientX, e.clientY, 1100);
    burst(10, 55);
  });

  document.querySelectorAll("[data-action]").forEach(btn => {
    btn.addEventListener("click", () => {
      const a = btn.dataset.action;
      if (a === "soul") soulBloom();
      else setAction(a);
    });
  });

  document.addEventListener("keydown", e => {
    const map = { "1":"greet","2":"glide","3":"spin","4":"pulse","5":"soul","6":"quantum" };
    if (map[e.key]) setAction(map[e.key]);
    if (e.code === "Space") { e.preventDefault(); soulBloom(); }
    if (e.key === "Escape") {
      state.tx = 0; state.ty = 0;
      stage.classList.remove("is-floating","is-spinning","is-pulsing");
      soulBreath();
    }
    if (e.key.toLowerCase() === "b") bow();
  });

  function speak(text) {
    if (!text) return;
    speech.textContent = text;
    speech.classList.add("show");

    if (!("speechSynthesis" in window)) {
      setTimeout(() => speech.classList.remove("show"), 4200);
      return;
    }

    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = .94;
    u.pitch = 1.12;
    u.volume = 1;

    // Prefer a warm/feminine English voice when the browser provides one.
    const voices = speechSynthesis.getVoices();
    const preferred = voices.find(v =>
      /en/i.test(v.lang) && /female|samantha|zira|ava|aria|susan|jenny/i.test(v.name)
    ) || voices.find(v => /en/i.test(v.lang));
    if (preferred) u.voice = preferred;

    u.onstart = () => {
      state.talking = true;
      speech.classList.add("show");
      mouth.animate([
        {transform:"scaleY(1)"},
        {transform:"scaleY(1.9)"},
        {transform:"scaleY(.65)"},
        {transform:"scaleY(1.45)"},
        {transform:"scaleY(1)"}
      ], {duration:420, iterations:Math.max(2, Math.ceil(text.length / 7)), easing:"ease-in-out"});
      stage.classList.add("is-pulsing");
    };
    u.onend = () => {
      state.talking = false;
      stage.classList.remove("is-pulsing");
      setTimeout(() => speech.classList.remove("show"), 900);
    };
    speechSynthesis.speak(u);
  }

  talkButton.addEventListener("click", () => {
    const text = talkText.value.trim();
    if (text) {
      speak(text);
      talkText.value = "";
      burst(14, 70);
    } else {
      speak("I am here. Tell me where you want to go, and I will glide with you.");
    }
  });

  talkText.addEventListener("keydown", e => {
    if (e.key === "Enter") talkButton.click();
  });

  // Smooth body movement loop.
  function tick() {
    state.x += (state.tx - state.x) * .055;
    state.y += (state.ty - state.y) * .055;
    motion.style.transform = `translate(${state.x}px,${state.y}px)`;
    requestAnimationFrame(tick);
  }
  tick();

  // Gentle idle life.
  setInterval(() => {
    if (!state.talking && Math.random() > .35) soulBreath();
  }, 4200);

  // Give the avatar a tiny greeting on load without speaking automatically.
  setTimeout(() => burst(24, 130), 500);
})();
