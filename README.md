# DualScreen — DS emulator for iPad

A home-screen iPad app that plays Nintendo DS games. It runs fully offline once installed, and your games and saves stay on the iPad.

**What's inside:** a game library (with each game's real icon and title), on-screen controls, Bluetooth controller support, 4 save-state slots per game, auto-resume, fast-forward (2–6×), and three screen layouts (stacked, side by side, big top). It's powered by the melonDS and DeSmuME emulators via EmulatorJS.

---

## 1. Put it online (one time, ~10 minutes, free)

The iPad needs to load the app once from a web address. GitHub Pages hosts it for free.

1. Go to **github.com** and sign up (or sign in).
2. Click the **+** at top right → **New repository**.
   - Name: `dualscreen`
   - Set it to **Public** (free Pages hosting requires this; your games are *not* uploaded, they stay on your iPad).
   - Click **Create repository**.
3. On the new repo page, click **uploading an existing file**.
4. Unzip `dualscreen.zip` on your computer. Open the `dualscreen` folder, select **everything inside it** (`index.html`, `play.html`, `sw.js`, `manifest.webmanifest`, and the `css`, `js`, `icons`, `data` folders), and drag it all into the browser window.
   - Make sure `index.html` lands at the top level, not inside another folder.
5. Scroll down and click **Commit changes**. Wait for the upload to finish.
6. Go to the repo's **Settings** → **Pages** (left sidebar).
   - Under *Build and deployment*, Source: **Deploy from a branch**.
   - Branch: **main**, folder **/ (root)** → **Save**.
7. Wait 1–2 minutes and refresh that page. It will show your site address:
   `https://YOUR-USERNAME.github.io/dualscreen/`

## 2. Install it on the iPad

1. Open that address in **Safari** on the iPad.
2. Tap the **Share** button → **Add to Home Screen** → **Add**.
3. Open **DualScreen** from your home screen. It runs fullscreen, with no browser bar.

After the first launch, it works without internet.

## 3. Add games

1. Put your `.nds` files in the **Files** app (iCloud Drive, On My iPad, or AirDrop them over).
2. In DualScreen, tap **Add game** and pick one or more files. `.zip` and `.7z` also work.
3. Tap a game to play.

Only use games you own.

## Playing

| Thing | How |
|---|---|
| DS touchscreen | Touch the bottom screen directly |
| Menu (save states, layouts, quit) | ☰ button. On a controller: Home/PS button, or hold Select + Start |
| Fast-forward | ⏩ button (speed set in Settings) |
| Controller | Pair it in iPad Settings → Bluetooth. On-screen buttons hide automatically while it's connected |
| Keyboard | Arrows = D-pad, Z = A, X = B, A = X, S = Y, Q / E = L / R, Enter = Start, V = Select |
| Quit | Menu → **Save & quit**. Reopening the game picks up exactly where you left off |

**In-game saves** (the game's own save menu) are kept automatically. Use **Menu → Back up in-game save** now and then to export a `.sav` file, since iPadOS can clear website data if storage runs very low. **Restore save file** imports `.sav` or `.dsv` files from other emulators.

## If a game runs slow

Open **Settings** (gear icon in the library) → **Emulator engine** → **DeSmuME**. It's lighter than melonDS. Note that in-game saves are stored separately per engine.

## Updating the app later

Upload the changed files to the same GitHub repo, and bump `VERSION` at the top of `sw.js` (e.g. `dualscreen-v2`). Then fully close and reopen the app on the iPad twice.

## Not supported

Wi-Fi/local multiplayer, the microphone, and DSi-only games.

---

Emulator engine: [EmulatorJS](https://github.com/EmulatorJS/EmulatorJS) (GPL-3.0) with the melonDS and DeSmuME 2015 libretro cores. License in `data/LICENSE-EmulatorJS.txt`.
