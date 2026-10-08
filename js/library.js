const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function toast(msg, ms = 2200) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

function openSheet(html, onMount) {
  const scrim = document.createElement("div");
  scrim.className = "scrim";
  scrim.innerHTML = `<div class="sheet">${html}</div>`;
  const close = () => scrim.remove();
  scrim.addEventListener("click", e => { if (e.target === scrim) close(); });
  document.body.appendChild(scrim);
  scrim.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", close));
  if (onMount) onMount(scrim.querySelector(".sheet"), close);
  return close;
}

function initials(title) {
  return (title || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("");
}

async function render() {
  const games = (await Store.allGames()).sort((a, b) => (b.lastPlayed || b.added) - (a.lastPlayed || a.added));
  const grid = $("#grid");
  $("#empty").classList.toggle("hidden", games.length > 0);
  $("#count").textContent = games.length ? `${games.length} game${games.length === 1 ? "" : "s"}` : "Your library";
  grid.innerHTML = "";
  for (const g of games) {
    const card = document.createElement("div");
    card.className = "card";
    card.setAttribute("role", "button");
    card.innerHTML = `
      <div class="art">
        ${g.icon ? `<img src="${g.icon}" alt="">` : `<span class="initials">${esc(initials(g.title))}</span>`}
        ${g.hasResume ? `<span class="chip">Resume</span>` : ""}
      </div>
      <div>
        <h3>${esc(g.title)}</h3>
        <p>${esc(fmtAgo(g.lastPlayed))} · ${esc(fmtSize(g.size))}</p>
      </div>
      <button class="more" aria-label="Options">
        <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
      </button>`;
    card.addEventListener("click", e => {
      if (e.target.closest(".more")) return gameOptions(g);
      location.href = "play.html?id=" + encodeURIComponent(g.id);
    });
    grid.appendChild(card);
  }
}

async function addFiles(files) {
  const list = [...files].filter(f => /\.(nds|zip|7z)$/i.test(f.name) || f.type === "application/octet-stream");
  if (!list.length) return toast("Pick a .nds (or .zip / .7z) game file");
  const prog = document.createElement("div");
  prog.className = "progress";
  document.body.appendChild(prog);
  let added = 0;
  try {
    for (const f of list) {
      prog.textContent = `Adding ${f.name}…`;
      const isNds = /\.nds$/i.test(f.name);
      const info = isNds ? await readNdsInfo(f) : {};
      const fallback = f.name.replace(/\.(nds|zip|7z)$/i, "").replace(/[_]+/g, " ").trim();
      const id = "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      const ext = (f.name.match(/\.(nds|zip|7z)$/i) || [".nds"])[0].toLowerCase();
      // Store a fresh Blob copy so the game doesn't depend on the original file staying put.
      const blob = new Blob([await f.arrayBuffer()], { type: "application/octet-stream" });
      await Store.putRom(id, blob);
      await Store.putGame({
        id, ext,
        title: info.title || fallback || "Untitled",
        publisher: info.publisher || null,
        code: info.code || null,
        icon: info.icon || null,
        fileName: f.name,
        size: f.size,
        added: Date.now(),
        lastPlayed: 0,
        hasResume: false,
      });
      added++;
    }
  } catch (e) {
    console.error(e);
    toast("Couldn't save that game — the iPad may be low on storage.", 4000);
  } finally {
    prog.remove();
  }
  if (added) toast(added === 1 ? "Game added" : `${added} games added`);
  render();
}

function gameOptions(g) {
  openSheet(`
    <div class="sheet-head"><h2>${esc(g.title)}</h2><button class="close" data-close>×</button></div>
    <button class="list-btn" data-a="play">Play</button>
    ${g.hasResume ? `<button class="list-btn" data-a="fresh">Start from title screen</button>` : ""}
    <button class="list-btn" data-a="rename">Rename</button>
    <button class="list-btn danger" data-a="delete">Delete game…</button>
  `, (sheet, close) => {
    sheet.addEventListener("click", async e => {
      const a = e.target.closest("[data-a]")?.dataset.a;
      if (!a) return;
      if (a === "play") location.href = "play.html?id=" + encodeURIComponent(g.id);
      if (a === "fresh") location.href = "play.html?fresh=1&id=" + encodeURIComponent(g.id);
      if (a === "rename") { close(); renameGame(g); }
      if (a === "delete") { close(); confirmDelete(g); }
    });
  });
}

function renameGame(g) {
  openSheet(`
    <h2>Rename</h2>
    <input class="text-input" id="nameIn" value="${esc(g.title)}" maxlength="80">
    <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="saveName">Save</button></div>
  `, (sheet, close) => {
    const inp = sheet.querySelector("#nameIn");
    setTimeout(() => inp.focus(), 50);
    sheet.querySelector("#saveName").addEventListener("click", async () => {
      g.title = inp.value.trim() || g.title;
      await Store.putGame(g);
      close();
      render();
    });
  });
}

function confirmDelete(g) {
  openSheet(`
    <h2>Delete “${esc(g.title)}”?</h2>
    <p class="sub">This removes the game and its save states from this iPad. In-game saves stay, and come back if you add the same game again.</p>
    <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" style="background:var(--danger);color:#fff" id="del">Delete</button></div>
  `, (sheet, close) => {
    sheet.querySelector("#del").addEventListener("click", async () => {
      await Store.deleteGame(g.id);
      close();
      render();
    });
  });
}

function seg(name, options, value) {
  return `<div class="seg" data-seg="${name}">${options.map(([v, label]) =>
    `<button data-v="${v}" class="${String(v) === String(value) ? "on" : ""}">${label}</button>`).join("")}</div>`;
}

function openSettings() {
  const s = Settings.get();
  openSheet(`
    <div class="sheet-head"><h2>Settings</h2><button class="close" data-close>×</button></div>
    <div class="row"><label>Emulator engine<span class="hint">DeSmuME runs faster on older iPads. In-game saves are kept per engine.</span></label>
      ${seg("engine", [["melonds", "melonDS"], ["desmume2015", "DeSmuME"]], s.engine)}</div>
    <div class="row"><label>Default screen layout</label>
      ${seg("layout", [["split", "Split"], ["stacked", "Stacked"], ["side", "Side by side"], ["focus", "Big top"]], s.layout)}</div>
    <div class="row"><label>Fast-forward speed</label>
      ${seg("ffSpeed", [[2, "2×"], [3, "3×"], [4, "4×"], [6, "6×"]], s.ffSpeed)}</div>
    <div class="row"><label>On-screen controls<span class="hint">Auto hides them while a Bluetooth controller is connected.</span></label>
      ${seg("touchControls", [["auto", "Auto"], ["always", "Always"], ["never", "Hidden"]], s.touchControls)}</div>
    <div class="row"><label>Button size</label>
      ${seg("buttonSize", [[0.85, "S"], [1, "M"], [1.15, "L"]], s.buttonSize)}</div>
    <div class="row"><label>Button opacity</label>
      <input type="range" min="0.2" max="1" step="0.05" value="${s.opacity}" id="opacity"></div>
    <div class="row"><label>Resume where I left off<span class="hint">Opens each game exactly where you quit.</span></label>
      ${seg("autoResume", [["true", "On"], ["false", "Off"]], String(s.autoResume))}</div>
    <div class="row"><label>Frame skip<span class="hint">DeSmuME only. Keeps the game at full speed on slower iPads by drawing fewer frames.</span></label>
      ${seg("frameskip", [[0, "Off"], [1, "1"], [2, "2"]], s.frameskip)}</div>
    <div class="row"><label>Show FPS<span class="hint">60 means the game is running at full speed.</span></label>
      ${seg("showFps", [["false", "Off"], ["true", "On"]], String(s.showFps))}</div>
  `, sheet => {
    sheet.querySelectorAll("[data-seg]").forEach(group => {
      group.addEventListener("click", e => {
        const b = e.target.closest("button");
        if (!b) return;
        group.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
        let v = b.dataset.v;
        if (group.dataset.seg === "ffSpeed" || group.dataset.seg === "buttonSize") v = parseFloat(v);
        if (group.dataset.seg === "autoResume" || group.dataset.seg === "showFps") v = v === "true";
        if (group.dataset.seg === "frameskip") v = parseInt(v, 10);
        Settings.set({ [group.dataset.seg]: v });
      });
    });
    sheet.querySelector("#opacity").addEventListener("input", e => Settings.set({ opacity: parseFloat(e.target.value) }));
  });
}

// ---- wiring ----
const fileInput = $("#fileInput");
$("#addBtn").addEventListener("click", () => fileInput.click());
$("#emptyAdd").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => { addFiles(fileInput.files); fileInput.value = ""; });
$("#settingsBtn").addEventListener("click", openSettings);

// Drag & drop (iPad Split View / desktop)
let dropHint;
window.addEventListener("dragover", e => {
  e.preventDefault();
  if (!dropHint) {
    dropHint = document.createElement("div");
    dropHint.className = "drop-hint";
    dropHint.textContent = "Drop games to add them";
    document.body.appendChild(dropHint);
  }
});
window.addEventListener("dragleave", e => { if (!e.relatedTarget && dropHint) { dropHint.remove(); dropHint = null; } });
window.addEventListener("drop", e => {
  e.preventDefault();
  if (dropHint) { dropHint.remove(); dropHint = null; }
  if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
});

const standalone = window.navigator.standalone || matchMedia("(display-mode: standalone)").matches;
const isApple = /iPad|iPhone|Macintosh/.test(navigator.userAgent) && "ontouchend" in document;
if (!standalone && isApple && !localStorage.getItem("ds.tipDismissed")) $("#installTip").classList.remove("hidden");
$("#dismissTip").addEventListener("click", () => {
  $("#installTip").classList.add("hidden");
  try { localStorage.setItem("ds.tipDismissed", "1"); } catch (e) {}
});

// Coming back from a game via the back gesture: refresh "last played".
window.addEventListener("pageshow", render);
