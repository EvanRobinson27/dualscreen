// Reads the title, game code and 32x32 icon embedded in a .nds file's banner.
async function readNdsInfo(file) {
  const info = { title: null, publisher: null, code: null, icon: null };
  try {
    const head = new DataView(await file.slice(0, 0x200).arrayBuffer());
    const ascii = (off, len) => {
      let s = "";
      for (let i = 0; i < len; i++) {
        const c = head.getUint8(off + i);
        if (c === 0) break;
        s += String.fromCharCode(c);
      }
      return s.trim();
    };
    info.code = ascii(0x0c, 4) || null;
    const headerTitle = ascii(0x00, 12);
    const bannerOff = head.getUint32(0x68, true);
    if (bannerOff && bannerOff + 0x840 <= file.size) {
      const b = new DataView(await file.slice(bannerOff, bannerOff + 0x840).arrayBuffer());
      // English title block: UTF-16LE, lines are title / subtitle / publisher.
      let t = "";
      for (let i = 0; i < 128; i++) {
        const ch = b.getUint16(0x340 + i * 2, true);
        if (ch === 0) break;
        t += String.fromCharCode(ch);
      }
      const lines = t.split("\n").map(s => s.trim()).filter(Boolean);
      if (lines.length) {
        info.publisher = lines.length > 1 ? lines[lines.length - 1] : null;
        info.title = (lines.length > 2 ? lines.slice(0, -1) : lines.slice(0, 1)).join(" ");
      }
      info.icon = drawIcon(b);
    }
    if (!info.title) info.title = headerTitle || null;
  } catch (e) {
    console.warn("Could not read ROM info", e);
  }
  return info;
}

function drawIcon(b) {
  const pal = [];
  for (let i = 0; i < 16; i++) {
    const c = b.getUint16(0x220 + i * 2, true);
    pal.push([(c & 31) << 3, ((c >> 5) & 31) << 3, ((c >> 10) & 31) << 3]);
  }
  const cv = document.createElement("canvas");
  cv.width = cv.height = 32;
  const ctx = cv.getContext("2d");
  const img = ctx.createImageData(32, 32);
  let any = false;
  for (let ty = 0; ty < 4; ty++) {
    for (let tx = 0; tx < 4; tx++) {
      for (let py = 0; py < 8; py++) {
        for (let px = 0; px < 8; px++) {
          const byte = b.getUint8(0x20 + (ty * 4 + tx) * 32 + py * 4 + (px >> 1));
          const idx = px & 1 ? byte >> 4 : byte & 15;
          const o = ((ty * 8 + py) * 32 + tx * 8 + px) * 4;
          if (idx) {
            any = true;
            img.data[o] = pal[idx][0];
            img.data[o + 1] = pal[idx][1];
            img.data[o + 2] = pal[idx][2];
            img.data[o + 3] = 255;
          }
        }
      }
    }
  }
  if (!any) return null;
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL("image/png");
}
