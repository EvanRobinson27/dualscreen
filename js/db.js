// Tiny IndexedDB wrapper + shared settings for the library and player pages.
const DB_NAME = "dualscreen";
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("games")) db.createObjectStore("games", { keyPath: "id" });
      if (!db.objectStoreNames.contains("roms")) db.createObjectStore("roms");
      if (!db.objectStoreNames.contains("states")) db.createObjectStore("states");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let _db;
async function db() {
  if (!_db) _db = await openDB();
  return _db;
}

async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    const r = fn(s);
    if (r && "onsuccess" in r) r.onsuccess = () => { result = r.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const Store = {
  allGames: () => tx("games", "readonly", s => s.getAll()),
  getGame: id => tx("games", "readonly", s => s.get(id)),
  putGame: g => tx("games", "readwrite", s => s.put(g)),
  getRom: id => tx("roms", "readonly", s => s.get(id)),
  putRom: (id, blob) => tx("roms", "readwrite", s => s.put(blob, id)),
  getState: key => tx("states", "readonly", s => s.get(key)),
  putState: (key, v) => tx("states", "readwrite", s => s.put(v, key)),
  delState: key => tx("states", "readwrite", s => s.delete(key)),
  async deleteGame(id) {
    await tx("games", "readwrite", s => s.delete(id));
    await tx("roms", "readwrite", s => s.delete(id));
    const keys = await tx("states", "readonly", s => s.getAllKeys());
    for (const k of keys || []) if (String(k).startsWith(id + ":")) await Store.delState(k);
  },
};

const DEFAULT_SETTINGS = {
  engine: "melonds",      // "melonds" (accurate) or "desmume2015" (faster)
  ffSpeed: 3,             // fast-forward multiplier
  opacity: 0.55,          // on-screen button opacity
  buttonSize: 1,          // 0.85 / 1 / 1.15
  touchControls: "auto",  // auto = hide while a controller is connected
  layout: "split",        // default layout for new games (Split = big top screen + separate touchscreen)
  autoResume: true,       // continue where you left off
  frameskip: 0,           // DeSmuME only: skip drawing N frames to keep game speed up
  showFps: false,         // small speed readout while playing
};

const Settings = {
  get() {
    try {
      return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(localStorage.getItem("ds.settings") || "{}"));
    } catch (e) {
      return Object.assign({}, DEFAULT_SETTINGS);
    }
  },
  set(patch) {
    const s = Object.assign(Settings.get(), patch);
    try { localStorage.setItem("ds.settings", JSON.stringify(s)); } catch (e) {}
    return s;
  },
};

function fmtAgo(ts) {
  if (!ts) return "Never played";
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return m + " min ago";
  const h = Math.round(m / 60);
  if (h < 24) return h + " hr ago";
  const d = Math.round(h / 24);
  if (d < 7) return d + (d === 1 ? " day ago" : " days ago");
  return new Date(ts).toLocaleDateString();
}

function fmtSize(b) {
  if (b > 1048576) return (b / 1048576).toFixed(b > 104857600 ? 0 : 1) + " MB";
  return Math.max(1, Math.round(b / 1024)) + " KB";
}

// Ask the browser not to evict our data (ROMs and saves).
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}
