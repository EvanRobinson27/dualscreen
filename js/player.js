// DualScreen player: boots EmulatorJS (melonDS / DeSmuME) and draws our own iPad UI.
(async function () {
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const params = new URLSearchParams(location.search);
  const gameId = params.get("id");
  const fresh = params.get("fresh") === "1";
  let settings = Settings.get();

  // libretro joypad ids used by EmulatorJS
  const KEYS = { B: 0, Y: 1, SELECT: 2, START: 3, UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7, A: 8, X: 9, L: 10, R: 11 };
  const LAYOUT_VALUES = {
    melonds: { stacked: ["Top/Bottom", "Bottom/Top"], split: ["Top/Bottom", "Bottom/Top"], side: ["Left/Right", "Right/Left"], focus: ["Hybrid Top", "Hybrid Bottom"] },
    desmume2015: { stacked: ["top/bottom", "bottom/top"], split: ["top/bottom", "bottom/top"], side: ["left/right", "right/left"], focus: ["hybrid/top", "hybrid/bottom"] },
  };
  const LAYOUT_ASPECT = { stacked: 256 / 384, split: 256 / 384, side: 512 / 192, focus: 2 };

  function toast(msg, ms = 2000) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }
  function fail(msg) {
    $("#loading").innerHTML = `<div><div class="title">${esc(msg)}</div>
      <div class="msg" style="margin-bottom:22px">Head back to your library and try again.</div>
      <a class="btn primary" href="index.html" style="text-decoration:none">Back to library</a></div>`;
    $("#loading").classList.remove("hidden");
  }

  if (!gameId) return fail("No game selected");
  const game = await Store.getGame(gameId);
  const rom = game && await Store.getRom(gameId);
  if (!game || !rom) return fail("Couldn't find that game");
  $("#loadTitle").textContent = game.title;
  document.title = game.title;

  const core = settings.engine === "desmume2015" ? "desmume2015" : "melonds";
  const prefKey = "ds.game." + gameId;
  let gamePrefs = {};
  try { gamePrefs = JSON.parse(localStorage.getItem(prefKey) || "{}"); } catch (e) {}
  let layout = gamePrefs.layout || settings.layout || "stacked";
  let swapped = !!gamePrefs.swapped;
  let videoAspect = LAYOUT_ASPECT[layout];
  const savePrefs = () => { try { localStorage.setItem(prefKey, JSON.stringify({ layout, swapped })); } catch (e) {} };

  // ---------- EmulatorJS boot ----------
  // Keep the emulator's WebGL frame readable so the Split layout can copy the touchscreen out of it.
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") attrs = Object.assign({}, attrs, { preserveDrawingBuffer: true });
    return origGetContext.call(this, type, attrs);
  };
  const layoutOpt = core === "melonds" ? "melonds_screen_layout" : "desmume_screens_layout";
  const coreDefaults = core === "melonds"
    ? { melonds_touch_mode: "Touch", melonds_boot_directly: "enabled", melonds_screen_layout: LAYOUT_VALUES.melonds[layout][+swapped] }
    : { desmume_pointer_type: "touch", desmume_screens_layout: LAYOUT_VALUES.desmume2015[layout][+swapped] };

  Object.assign(window, {
    EJS_player: "#game",
    EJS_core: core,
    EJS_gameUrl: URL.createObjectURL(rom),
    EJS_gameName: "rom-" + gameId,
    EJS_gameID: 1,
    EJS_pathtodata: "data/",
    EJS_startOnLoaded: true,
    EJS_volume: 1,
    EJS_color: "#e8b04b",
    EJS_backgroundColor: "#000",
    EJS_disableAutoLang: true,
    EJS_language: "en-US",
    EJS_defaultOptions: Object.assign({ "virtual-gamepad": "disabled", "save-save-interval": "15" }, coreDefaults),
    EJS_Buttons: {
      playPause: false, restart: false, mute: false, settings: false, fullscreen: false, saveState: false,
      loadState: false, screenRecord: false, gamepad: false, cheat: false, volume: false, saveSavFiles: false,
      loadSavFiles: false, quickSave: false, quickLoad: false, screenshot: false, cacheManager: false, exitEmulation: false,
    },
  });

  let emu = null; // window.EJS_emulator once ready
  let started = false;
  const gm = () => emu && emu.gameManager;

  window.EJS_onGameStart = () => {
    emu = window.EJS_emulator;
    started = true;
    onStarted();
  };
  const loaderScript = document.createElement("script");
  loaderScript.src = "data/loader.js";
  document.body.appendChild(loaderScript);
  const bootTimer = setTimeout(() => { if (!started) fail("The game didn't start"); }, 90000);

  // ---------- Layout ----------
  const stage = $("#stage"), clip = $("#mainclip"), box = $("#gamebox"), bottomCv = $("#bottomScreen"), controls = $("#controls");
  let splitActive = false;
  const pads = {};
  controls.querySelectorAll(".pad").forEach(el => (pads[el.dataset.key] = el));
  const menuBtn = $("#menuBtn"), ffBtn = $("#ffBtn");

  function place(el, x, y, w, h) {
    el.style.left = Math.round(x) + "px";
    el.style.top = Math.round(y) + "px";
    el.style.width = Math.round(w) + "px";
    el.style.height = Math.round(h) + "px";
  }

  function touchControlsVisible() {
    if (settings.touchControls === "never") return false;
    if (settings.touchControls === "always") return true;
    return !controllerConnected;
  }

  let rects = []; // hit-test cache
  function doLayout() {
    const W = window.innerWidth, H = window.innerHeight;
    const cs = getComputedStyle(document.documentElement);
    const sl = parseFloat(cs.getPropertyValue("--safe-l")) || 0, sr = parseFloat(cs.getPropertyValue("--safe-r")) || 0;
    const st = parseFloat(cs.getPropertyValue("--safe-t")) || 0, sb = parseFloat(cs.getPropertyValue("--safe-b")) || 0;
    const showPads = touchControlsVisible();
    const u = Math.max(0.62, Math.min(1.3, Math.min(W, H) / 820)) * settings.buttonSize;
    stage.style.setProperty("--u", u);
    controls.style.setProperty("--op", settings.opacity);
    controls.classList.toggle("off", !showPads);

    splitActive = layout === "split" && W > H;
    stage.classList.toggle("split", splitActive);
    bottomCv.classList.toggle("hidden", !splitActive);
    if (splitActive) { layoutSplit(W, H, sl, sr, st, sb, u, showPads); return; }

    const fit = (bw, bh) => {
      let w = bw, h = bw / videoAspect;
      if (h > bh) { h = bh; w = bh * videoAspect; }
      return { w, h };
    };
    const colW = 250 * u, bandH = 310 * u;
    const sideFit = fit(W - 2 * colW - sl - sr, H);
    const bandFit = fit(W - sl - sr, H - bandH - sb - st);
    const useSide = !showPads ? true : sideFit.w * sideFit.h >= bandFit.w * bandFit.h;

    let pic;
    if (!showPads) {
      const f = fit(W - sl - sr, H - st - sb);
      pic = { x: (W - f.w) / 2, y: (H - f.h) / 2, ...f };
    } else if (useSide) {
      pic = { x: (W - sideFit.w) / 2, y: (H - sideFit.h) / 2, ...sideFit };
    } else {
      pic = { x: (W - bandFit.w) / 2, y: st, ...bandFit };
    }
    place(clip, pic.x, pic.y, pic.w, pic.h);
    place(box, 0, 0, pic.w, pic.h);

    const D = 176 * u, F = 74 * u, gap = 10 * u, sys = 48 * u;
    const shW = 118 * u, shH = 52 * u, pillW = 92 * u, pillH = 36 * u;
    const diamond = (cx, cy) => {
      const o = F * 0.5 + gap * 0.5 + F * 0.36;
      place(pads.X, cx - F / 2, cy - o - F / 2, F, F);
      place(pads.B, cx - F / 2, cy + o - F / 2, F, F);
      place(pads.Y, cx - o - F / 2, cy - F / 2, F, F);
      place(pads.A, cx + o - F / 2, cy - F / 2, F, F);
    };

    if (useSide || !showPads) {
      const leftW = pic.x - sl, rightX = pic.x + pic.w, rightW = W - sr - rightX;
      const lc = sl + leftW / 2, rc = rightX + rightW / 2;
      const top = st + 18 * u;
      place(pads.L, sl + 16 * u, top, shW, shH);
      place(pads.R, W - sr - 16 * u - shW, top, shW, shH);
      place(menuBtn, sl + 16 * u + shW + 12 * u, top + (shH - sys) / 2, sys, sys);
      place(ffBtn, W - sr - 16 * u - shW - 12 * u - sys, top + (shH - sys) / 2, sys, sys);
      const cy = H * 0.56;
      place(pads.DPAD, lc - D / 2, cy - D / 2, D, D);
      diamond(rc, cy);
      const by = Math.min(H - sb - pillH - 22 * u, cy + D / 2 + 46 * u);
      place(pads.SELECT, lc - pillW / 2, by, pillW, pillH);
      place(pads.START, rc - pillW / 2, by, pillW, pillH);
      if (!showPads) {
        // Controller mode: tuck the two system buttons into the corners.
        place(menuBtn, sl + 14 * u, st + 14 * u, sys, sys);
        place(ffBtn, W - sr - 14 * u - sys, st + 14 * u, sys, sys);
      }
    } else {
      const bandTop = pic.y + pic.h;
      const cy = Math.max(bandTop + 186 * u, bandTop + (H - sb - bandTop) * 0.56);
      const lc = sl + 30 * u + D / 2, rc = W - sr - 30 * u - D / 2;
      place(pads.DPAD, lc - D / 2, cy - D / 2, D, D);
      diamond(rc, cy);
      const shY = bandTop + 12 * u;
      place(pads.L, sl + 16 * u, shY, shW, shH);
      place(pads.R, W - sr - 16 * u - shW, shY, shW, shH);
      const mid = W / 2;
      place(menuBtn, mid - sys - 8 * u, shY + (shH - sys) / 2, sys, sys);
      place(ffBtn, mid + 8 * u, shY + (shH - sys) / 2, sys, sys);
      const by = H - sb - pillH - 20 * u;
      place(pads.SELECT, mid - pillW - 10 * u, by, pillW, pillH);
      place(pads.START, mid + 10 * u, by, pillW, pillH);
    }
    finishLayout();
  }

  function finishLayout() {
    rects = Object.entries(pads).map(([k, el]) => ({ k, r: el.getBoundingClientRect() }));
    if (emu && emu.handleResize) emu.handleResize();
  }

  // Split layout (landscape): big main screen top-left, touchscreen bottom-right,
  // controls under the main screen, speed-up button between the two screens.
  function layoutSplit(W, H, sl, sr, st, sb, u, showPads) {
    const D = 176 * u, F = 74 * u, gap = 10 * u, sys = 48 * u;
    const shW = 118 * u, shH = 52 * u, pillW = 92 * u, pillH = 36 * u;
    let mh, mx, my, bw;
    if (showPads) {
      mh = H * 0.5; mx = sl + W * 0.05; my = st + H * 0.065;
      if (mh * 4 / 3 > W * 0.47) mh = W * 0.47 * 0.75;
      bw = mh * 4 / 3 * 0.68;
    } else {
      mh = H * 0.66; mx = sl + W * 0.035; my = st + H * 0.05;
      if (mh * 4 / 3 > W * 0.6) mh = W * 0.6 * 0.75;
      bw = mh * 4 / 3 * 0.6;
    }
    const mw = mh * 4 / 3, bh = bw * 0.75;
    const bx = Math.min(W - sr - W * 0.07 - bw, Math.max(mx + mw + 40 * u, W * 0.575));
    const by = Math.min(H - sb - H * 0.08 - bh, Math.max(my + mh - bh * 0.15, H * 0.53));
    place(clip, mx, my, mw, mh);
    place(box, 0, 0, mw, mh * 2);           // emulator draws both screens; only the top half shows here
    place(bottomCv, bx, by, bw, bh);
    const dpr = window.devicePixelRatio || 1;
    bottomCv.width = Math.round(bw * dpr); bottomCv.height = Math.round(bh * dpr);

    const stripTop = my + mh;
    const cy = stripTop + Math.max(D / 2 + shH + 26 * u, (H - sb - stripTop) * 0.52);
    const lc = sl + 34 * u + D / 2;
    const rc = lc + D / 2 + 70 * u + F * 1.4;
    place(pads.DPAD, lc - D / 2, cy - D / 2, D, D);
    const o = F * 0.5 + gap * 0.5 + F * 0.36;
    place(pads.X, rc - F / 2, cy - o - F / 2, F, F);
    place(pads.B, rc - F / 2, cy + o - F / 2, F, F);
    place(pads.Y, rc - o - F / 2, cy - F / 2, F, F);
    place(pads.A, rc + o - F / 2, cy - F / 2, F, F);
    const shY = stripTop + 14 * u;
    place(pads.L, lc - shW / 2, shY, shW, shH);
    place(pads.R, rc - shW / 2, shY, shW, shH);
    const pillY = H - sb - pillH - 16 * u, mid = (lc + rc) / 2;
    place(pads.SELECT, mid - pillW - 6 * u, pillY, pillW, pillH);
    place(pads.START, mid + 6 * u, pillY, pillW, pillH);
    // Speed-up sits between the main screen and the touchscreen.
    const ffSize = 64 * u;
    place(ffBtn, Math.max(rc + o + F / 2 + 24 * u, mx + mw - ffSize), Math.min(by + bh * 0.3, stripTop + 24 * u), ffSize, ffSize);
    // Menu goes in the open top-right area.
    place(menuBtn, W - sr - 18 * u - sys, st + 18 * u, sys, sys);
    if (!showPads) place(ffBtn, W - sr - 18 * u - sys * 2 - 12 * u, st + 18 * u, sys, sys);
    finishLayout();
  }

  // Copy the DS touchscreen out of the emulator's frame into its own panel each frame.
  function copyBottom() {
    if (splitActive && started) {
      const src = box.querySelector("canvas");
      if (src && src.width && src.height) {
        const g = bottomCv.getContext("2d");
        g.imageSmoothingEnabled = false;
        g.drawImage(src, 0, src.height / 2, src.width, src.height / 2, 0, 0, bottomCv.width, bottomCv.height);
      }
    }
    requestAnimationFrame(copyBottom);
  }
  requestAnimationFrame(copyBottom);

  // ---------- Touch controls (multi-touch, slide between buttons) ----------
  const held = new Map(); // touch id -> Set of key names
  let pressed = new Set();

  function keysAt(x, y) {
    const out = [];
    for (const { k, r } of rects) {
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (k === "DPAD") {
        const R = r.width / 2, dx = x - cx, dy = y - cy, dist = Math.hypot(dx, dy);
        if (dist > R * 1.35 || dist < R * 0.16) continue;
        const a = Math.atan2(dy, dx) * 180 / Math.PI; // 0 = right, 90 = down
        if (a > -67.5 && a < 67.5) out.push("RIGHT");
        if (a > 22.5 && a < 157.5) out.push("DOWN");
        if (a > 112.5 || a < -112.5) out.push("LEFT");
        if (a > -157.5 && a < -22.5) out.push("UP");
      } else if (pads[k].classList.contains("btn-face")) {
        if (Math.hypot(x - cx, y - cy) <= r.width * 0.66) out.push(k);
      } else {
        const p = 10;
        if (x >= r.left - p && x <= r.right + p && y >= r.top - p && y <= r.bottom + p) out.push(k);
      }
    }
    return out;
  }

  function sync() {
    const next = new Set();
    held.forEach(s => s.forEach(k => next.add(k)));
    for (const k of next) if (!pressed.has(k)) send(k, 1);
    for (const k of pressed) if (!next.has(k)) send(k, 0);
    pressed = next;
    for (const [k, el] of Object.entries(pads)) {
      if (k === "DPAD") {
        el.classList.toggle("u", next.has("UP"));
        el.classList.toggle("d", next.has("DOWN"));
        el.classList.toggle("l", next.has("LEFT"));
        el.classList.toggle("r", next.has("RIGHT"));
      } else el.classList.toggle("down", next.has(k));
    }
  }
  function send(k, v) {
    if (!started || menuOpen) return;
    gm().simulateInput(0, KEYS[k], v);
  }

  function onPadTouch(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (e.type === "touchend" || e.type === "touchcancel") held.delete(t.identifier);
      else held.set(t.identifier, new Set(keysAt(t.clientX, t.clientY)));
    }
    sync();
  }
  ["touchstart", "touchmove", "touchend", "touchcancel"].forEach(ev => controls.addEventListener(ev, onPadTouch, { passive: false }));
  // Mouse support (testing on a computer)
  let mouseDown = false;
  controls.addEventListener("mousedown", e => { mouseDown = true; held.set("m", new Set(keysAt(e.clientX, e.clientY))); sync(); });
  window.addEventListener("mousemove", e => { if (mouseDown && held.has("m")) { held.set("m", new Set(keysAt(e.clientX, e.clientY))); sync(); } });
  window.addEventListener("mouseup", () => { if (mouseDown) { mouseDown = false; held.delete("m"); sync(); } });

  function releaseAll() { held.clear(); sync(); }

  // ---------- DS touchscreen: forward finger to the emulator canvas as a stylus ----------
  let stylusId = null;
  function stylus(type, t, fromBottom) {
    const canvas = box.querySelector("canvas");
    if (!canvas) return;
    let x = t.clientX, y = t.clientY;
    if (fromBottom) {
      const b = bottomCv.getBoundingClientRect(), r = canvas.getBoundingClientRect();
      const fx = Math.min(1, Math.max(0, (x - b.left) / b.width)), fy = Math.min(1, Math.max(0, (y - b.top) / b.height));
      x = r.left + fx * r.width;
      y = r.top + r.height * (0.5 + fy * 0.5);
    }
    canvas.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, buttons: type === "mouseup" ? 0 : 1, bubbles: true, cancelable: true, view: window }));
  }
  function attachStylus(el, fromBottom) {
    el.addEventListener("touchstart", e => {
      e.preventDefault();
      if (stylusId !== null || menuOpen) return;
      const t = e.changedTouches[0];
      stylusId = t.identifier;
      stylus("mousemove", t, fromBottom);
      stylus("mousedown", t, fromBottom);
    }, { passive: false });
    el.addEventListener("touchmove", e => {
      e.preventDefault();
      for (const t of e.changedTouches) if (t.identifier === stylusId) stylus("mousemove", t, fromBottom);
    }, { passive: false });
    const end = e => {
      e.preventDefault();
      for (const t of e.changedTouches) if (t.identifier === stylusId) { stylus("mouseup", t, fromBottom); stylusId = null; }
    };
    el.addEventListener("touchend", end, { passive: false });
    el.addEventListener("touchcancel", end, { passive: false });
  }
  attachStylus(clip, false);
  attachStylus(bottomCv, true);
  // Mouse on the touchscreen panel (testing on a computer)
  let bMouse = false;
  bottomCv.addEventListener("mousedown", e => { bMouse = true; stylus("mousemove", e, true); stylus("mousedown", e, true); });
  bottomCv.addEventListener("mousemove", e => { if (bMouse) stylus("mousemove", e, true); });
  window.addEventListener("mouseup", e => { if (bMouse) { bMouse = false; stylus("mouseup", e, true); } });

  document.addEventListener("gesturestart", e => e.preventDefault());
  document.addEventListener("contextmenu", e => e.preventDefault());

  // ---------- Fast forward ----------
  let ff = false;
  function setFF(on) {
    ff = on;
    ffBtn.classList.toggle("on", on);
    if (!started) return;
    gm().setFastForwardRatio(settings.ffSpeed);
    gm().toggleFastForward(on ? 1 : 0);
  }
  ffBtn.addEventListener("click", () => { setFF(!ff); toast(ff ? `Fast-forward ${settings.ffSpeed}×` : "Normal speed", 1000); });

  // ---------- Screen layout ----------
  let aspectHold = 0;
  function applyLayout() {
    if (started) gm().setVariable(layoutOpt, LAYOUT_VALUES[core][layout][+swapped]);
    aspectHold = performance.now() + 1500;
    videoAspect = LAYOUT_ASPECT[layout];
    doLayout();
  }
  // The real picture shape comes from the core; re-check it while the game is running.
  function measureAspect() {
    if (!started || menuOpen || emu.paused || performance.now() < aspectHold) return;
    try {
      const w = gm().getVideoDimensions("width"), h = gm().getVideoDimensions("height");
      if (w > 0 && h > 0 && Math.abs(w / h - videoAspect) > 0.01) { videoAspect = w / h; doLayout(); }
    } catch (e) {}
  }

  // ---------- Saves ----------
  async function snapshot() {
    const data = new Uint8Array(gm().getState()); // copy out of emulator memory
    let shot = null;
    // The core only writes screenshots while running, so un-pause for a frame if needed.
    const wasPaused = emu.paused;
    try {
      if (wasPaused) emu.play();
      const png = await Promise.race([gm().screenshot(), new Promise(r => setTimeout(() => r(null), 2000))]);
      if (png) shot = new Blob([png], { type: "image/png" });
    } catch (e) {}
    if (wasPaused && menuOpen) emu.pause();
    return { core, data, shot, time: Date.now() };
  }
  async function saveSlot(n) {
    try {
      await Store.putState(`${gameId}:s${n}`, await snapshot());
      toast(`Saved to slot ${n}`);
    } catch (e) { console.error(e); toast("Couldn't save state"); }
  }
  async function loadSlot(n) {
    const s = await Store.getState(`${gameId}:s${n}`);
    if (!s) return;
    if (s.core !== core) return toast("That state was saved with the other engine");
    gm().loadState(s.data);
    toast(`Loaded slot ${n}`);
  }
  let saving = null;
  async function autoSave() {
    if (!started || saving) return saving;
    saving = (async () => {
      try {
        gm().saveSaveFiles();
        if (settings.autoResume) {
          await Store.putState(`${gameId}:auto`, await snapshot());
          game.hasResume = true;
          await Store.putGame(game);
        }
      } catch (e) { console.warn("autosave failed", e); }
    })();
    await saving;
    saving = null;
  }
  setInterval(() => { if (started) try { gm().saveSaveFiles(); } catch (e) {} }, 15000);
  setInterval(measureAspect, 700);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { releaseAll(); autoSave(); }
  });
  window.addEventListener("pagehide", () => { try { gm() && gm().saveSaveFiles(); } catch (e) {} });

  function exportSave() {
    try {
      const data = gm().getSaveFile();
      if (!data || !data.length) return toast("No in-game save yet");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([data]));
      a.download = game.title.replace(/[^\w\- ]+/g, "").trim() + ".sav";
      a.click();
    } catch (e) { toast("Couldn't export the save"); }
  }
  function importSave() {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".sav,.dsv,application/octet-stream";
    inp.onchange = async () => {
      const f = inp.files[0];
      if (!f) return;
      let data = new Uint8Array(await f.arrayBuffer());
      // DeSmuME .dsv files carry a 122-byte footer; strip it.
      if (/\.dsv$/i.test(f.name) && data.length > 122) data = data.slice(0, data.length - 122);
      const path = gm().getSaveFilePath();
      try { gm().FS.unlink(path); } catch (e) {}
      gm().FS.writeFile(path, data);
      gm().loadSaveFiles();
      gm().restart();
      try { await Store.delState(`${gameId}:auto`); } catch (e) {}
      closeMenu();
      toast("Save imported — game restarted");
    };
    inp.click();
  }

  // ---------- Pause menu ----------
  let menuOpen = false, menuEl = null;
  async function openMenu() {
    if (menuOpen) return;
    menuOpen = true;
    releaseAll();
    if (started) emu.pause();
    const slots = [];
    for (let n = 1; n <= 4; n++) slots.push(await Store.getState(`${gameId}:s${n}`));
    const urls = [];
    const slotHtml = slots.map((s, i) => {
      const n = i + 1;
      let bg = "";
      if (s && s.shot) { const u = URL.createObjectURL(s.shot); urls.push(u); bg = `style="background-image:url(${u})"`; }
      return `<div class="slot">
        <div class="shot" ${bg}>${s ? (s.shot ? "" : "Saved") : "Empty"}</div>
        <div class="when">${s ? esc(fmtAgo(s.time)) : `Slot ${n}`}</div>
        <div class="two"><button data-save="${n}">Save</button><button data-load="${n}" ${s ? "" : "disabled"}>Load</button></div>
      </div>`;
    }).join("");
    const seg = (name, opts, val) => `<div class="seg" data-seg="${name}">${opts.map(([v, l]) => `<button data-v="${v}" class="${v === val ? "on" : ""}">${l}</button>`).join("")}</div>`;

    menuEl = document.createElement("div");
    menuEl.className = "scrim menu";
    menuEl.innerHTML = `<div class="sheet">
      <div class="sheet-head"><h2>${esc(game.title)}</h2><button class="close" data-a="resume" aria-label="Resume">×</button></div>
      <div class="section-label">Save states</div>
      <div class="slots">${slotHtml}</div>
      <div class="section-label">Screens</div>
      <div class="row"><label>Layout</label>${seg("layout", [["split", "Split"], ["stacked", "Stacked"], ["side", "Side by side"], ["focus", "Big top"]], layout)}</div>
      <div class="row"><label>Swap screens</label>${seg("swap", [["off", "Off"], ["on", "On"]], swapped ? "on" : "off")}</div>
      <div class="section-label">Controls</div>
      <div class="row"><label>On-screen buttons<span class="hint">${controllerConnected ? "Controller connected" : "No controller connected"}</span></label>${seg("touch", [["auto", "Auto"], ["always", "Always"], ["never", "Hidden"]], settings.touchControls)}</div>
      <div class="row"><label>Opacity</label><input type="range" min="0.2" max="1" step="0.05" value="${settings.opacity}" data-range="opacity"></div>
      <div class="menu-actions">
        <button class="btn" data-a="export">Back up in-game save</button>
        <button class="btn" data-a="import">Restore save file</button>
        <button class="btn" data-a="restart">Restart game</button>
        <button class="btn primary" data-a="quit">Save &amp; quit to library</button>
      </div>
    </div>`;
    document.body.appendChild(menuEl);
    menuEl._urls = urls;
    menuEl.addEventListener("click", async e => {
      if (e.target === menuEl) return closeMenu();
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.save) { b.disabled = true; await saveSlot(+b.dataset.save); closeMenu(); return; }
      if (b.dataset.load) { await loadSlot(+b.dataset.load); closeMenu(); return; }
      const group = b.closest("[data-seg]");
      if (group) {
        group.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
        const v = b.dataset.v;
        if (group.dataset.seg === "layout") { layout = v; savePrefs(); applyLayout(); }
        if (group.dataset.seg === "swap") { swapped = v === "on"; savePrefs(); applyLayout(); }
        if (group.dataset.seg === "touch") { settings = Settings.set({ touchControls: v }); doLayout(); }
        return;
      }
      const a = b.dataset.a;
      if (a === "resume") closeMenu();
      if (a === "export") exportSave();
      if (a === "import") importSave();
      if (a === "restart") { gm().restart(); closeMenu(); toast("Restarted"); }
      if (a === "quit") {
        b.textContent = "Saving…";
        await autoSave();
        location.href = "index.html";
      }
    });
    menuEl.querySelector("[data-range=opacity]").addEventListener("input", e => {
      settings = Settings.set({ opacity: parseFloat(e.target.value) });
      controls.style.setProperty("--op", settings.opacity);
    });
  }
  function closeMenu() {
    if (!menuOpen) return;
    menuOpen = false;
    if (menuEl) { (menuEl._urls || []).forEach(u => URL.revokeObjectURL(u)); menuEl.remove(); menuEl = null; }
    if (started) emu.play();
    aspectHold = performance.now() + 1200;
  }
  menuBtn.addEventListener("click", () => (menuOpen ? closeMenu() : openMenu()));

  // ---------- Bluetooth controllers ----------
  let controllerConnected = false;
  let comboSince = 0, homeWas = false;
  function pollPads() {
    const list = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    const now = list.length > 0;
    if (now !== controllerConnected) {
      controllerConnected = now;
      doLayout();
      toast(now ? "Controller connected" : "Controller disconnected", 1500);
    }
    if (now) {
      const p = list[0];
      const pr = i => p.buttons[i] && p.buttons[i].pressed;
      // Home / PS button, or hold Select + Start, opens the menu.
      const home = pr(16);
      if (home && !homeWas) menuOpen ? closeMenu() : openMenu();
      homeWas = home;
      if (pr(8) && pr(9)) {
        if (!comboSince) comboSince = performance.now();
        else if (performance.now() - comboSince > 700) { comboSince = Infinity; menuOpen ? closeMenu() : openMenu(); }
      } else comboSince = 0;
    }
    requestAnimationFrame(pollPads);
  }
  window.addEventListener("gamepadconnected", () => {}); // makes Safari expose pads sooner
  requestAnimationFrame(pollPads);

  // ---------- Start-up ----------
  async function onStarted() {
    clearTimeout(bootTimer);
    // Our own settings always win over anything EmulatorJS remembered.
    for (const [k, v] of Object.entries(coreDefaults)) gm().setVariable(k, v);
    try { emu.changeSettingOption && emu.changeSettingOption("virtual-gamepad", "disabled"); } catch (e) {}
    applyLayout();
    game.lastPlayed = Date.now();
    Store.putGame(game);

    let resumed = false;
    if (settings.autoResume && !fresh) {
      const s = await Store.getState(`${gameId}:auto`);
      if (s && s.core === core) {
        setTimeout(() => gm().loadState(s.data), 50);
        resumed = true;
      }
    }
    $("#loading").classList.add("hidden");

    // iPadOS keeps audio muted until the first tap after the game starts.
    const ctxs = () => {
      try { return gm().Module.AL.currentCtx ? [gm().Module.AL.currentCtx.audioCtx] : []; } catch (e) { return []; }
    };
    const suspended = ctxs().some(c => c && c.state === "suspended");
    if (suspended) {
      emu.pause();
      const tap = document.createElement("div");
      tap.className = "overlay tap-start";
      tap.innerHTML = `<div>
        <div class="play"><svg width="40" height="40" viewBox="0 0 24 24" fill="#1a1408"><path d="M8 5.5v13a1 1 0 0 0 1.5.9l10.4-6.5a1 1 0 0 0 0-1.8L9.5 4.6A1 1 0 0 0 8 5.5z"/></svg></div>
        <div class="title">${esc(game.title)}</div>
        <div class="msg">${resumed ? "Tap to continue where you left off" : "Tap to play"}</div></div>`;
      document.body.appendChild(tap);
      const go = () => {
        ctxs().forEach(c => c && c.resume && c.resume());
        tap.remove();
        emu.play();
      };
      tap.addEventListener("touchend", e => { e.preventDefault(); go(); }, { once: true });
      tap.addEventListener("click", go, { once: true });
    } else if (resumed) {
      toast("Picked up where you left off");
    }
  }

  window.addEventListener("resize", doLayout);
  window.addEventListener("orientationchange", () => setTimeout(doLayout, 300));
  doLayout();
})();
