// The eye beside the chat, drawn in half-block cells. An original instrument eye:
// a graphite bezel with a slowly turning dial, and inside it a diaphragm of seven
// blades around a dark heptagonal aperture with a hot vermilion rim. The aperture
// wanders, snaps to a point, and now and then looks straight at you and narrows.
export type Look = {
  gx: number
  gy: number
  /** How far the blades are open: 0.1 nearly shut, 1 wide. */
  open: number
  /** Brightness of the aperture's rim: the part that follows the voice quickly. */
  rim: number
  /** Overall glow of the iris: slow, flash-safe. */
  glow: number
  /** Turn of the dial, in turns. */
  spin: number
  /** Turn of the diaphragm, in radians. */
  rot: number
}

type Stop = readonly [number, number]

const lerp = (a: number, b: number, k: number) => a + (b - a) * k

function mix(c1: number, c2: number, k: number): number {
  const r = lerp((c1 >> 16) & 255, (c2 >> 16) & 255, k)
  const g = lerp((c1 >> 8) & 255, (c2 >> 8) & 255, k)
  const b = lerp(c1 & 255, c2 & 255, k)

  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)
}

function scale(c: number, k: number): number {
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)))

  return (ch((c >> 16) & 255) << 16) | (ch((c >> 8) & 255) << 8) | ch(c & 255)
}

function ramp(stops: readonly Stop[], q: number): number {
  let previous: Stop = stops[0] ?? [0, 0]
  if (q <= previous[0]) {
    return previous[1]
  }
  for (const stop of stops.slice(1)) {
    if (q <= stop[0]) {
      return mix(previous[1], stop[1], (q - previous[0]) / (stop[0] - previous[0]))
    }
    previous = stop
  }

  return previous[1]
}

const NONE = -1
const DEFAULT = 0x01000000
const STEP = (2 * Math.PI) / 7
const SWIRL = 0.55
const IRIS = 0.82

/** Colour of one eye pixel, NONE for the terminal's own background. */
function pixel(px: number, py: number, w: number, h: number, look: Look): number {
  const cx = (w - 1) / 2
  const cy = (h - 1) / 2
  const radius = Math.min(w, h) / 2 - 0.5
  const dx = (px - cx) / radius
  const dy = (py - cy) / radius
  const d = Math.hypot(dx, dy)

  if (d > 1.16) {
    return NONE
  }
  if (d > 1.0) {
    // the dial: twelve red marks turning slowly around the bezel
    const angle = Math.atan2(dy, dx) / (Math.PI * 2) + look.spin
    const frac = (((angle * 12) % 1) + 1) % 1

    return frac < 0.18 || frac > 0.94 ? scale(0x9a1410, look.glow) : NONE
  }
  if (d > 0.88) {
    return scale(0x2c2c33, 0.8 + 0.35 * Math.max(-1, Math.min(1, -(dx + dy))))
  }
  if (d > IRIS) {
    return scale(0x8a1010, 0.7 + 0.3 * look.glow)
  }

  // The diaphragm, in iris units, around an aperture shifted by the gaze.
  const ax = (dx - look.gx * 0.08) / IRIS
  const ay = (dy - look.gy * 0.08) / IRIS
  const dist = Math.hypot(ax, ay)
  const phi = Math.atan2(ay, ax)
  const open = Math.max(0.1, Math.min(1, look.open))
  const ra = (18 + 52 * open) / 140
  const sector = (((phi - look.rot) % STEP) + STEP) % STEP
  const edge = (ra * Math.cos(Math.PI / 7)) / Math.cos(sector - Math.PI / 7)

  if (dist < edge) {
    return 0x050101
  }
  const out = dist - edge
  if (out < 0.07) {
    return scale(mix(0xfff1dc, 0xff5a1f, out / 0.07), 0.55 + 0.45 * look.rim)
  }
  let colour = ramp(
    [
      [0, 0xff5a1f],
      [0.12, 0xe0301a],
      [0.35, 0x7a0a06],
      [0.7, 0x160403],
    ],
    out,
  )
  // Blades darken what is behind them; their edges swirl out from the aperture's corners.
  colour = scale(colour, 0.62)
  const twist = phi - look.rot - SWIRL * Math.min(1, out / Math.max(0.01, 1 - edge))
  const along = (((twist % STEP) + STEP) % STEP) / STEP
  if (along < 0.05 || along > 0.97) {
    colour = mix(colour, 0xff4a1a, 0.3)
  }

  return scale(colour, look.glow)
}

function base64(bytes: Uint8Array): string {
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }

  return btoa(text)
}

/** Raster cells (RasterProps.cells) for an eye `columns` wide and `rows` tall. */
export function eyeCells(columns: number, rows: number, look: Look): string {
  const words = new Uint32Array(columns * rows * 3)
  const h = rows * 2

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const top = pixel(col, row * 2, columns, h, look)
      const bottom = pixel(col, row * 2 + 1, columns, h, look)
      const at = (row * columns + col) * 3

      if (top === NONE && bottom === NONE) {
        words[at] = 0x20
        words[at + 1] = DEFAULT
        words[at + 2] = DEFAULT
      } else if (top === NONE) {
        words[at] = 0x2584
        words[at + 1] = bottom
        words[at + 2] = DEFAULT
      } else {
        words[at] = 0x2580
        words[at + 1] = top
        words[at + 2] = bottom === NONE ? DEFAULT : bottom
      }
    }
  }

  return base64(new Uint8Array(words.buffer))
}

/**
 * The band above the prompt: three rows with a dark red horizon across the width and a
 * small eye that slides along it with the gaze. `isAway` closes it to a dim point while
 * the full haze holds the screen: one eye at a time.
 */
export function bandCells(columns: number, look: Look, isAway: boolean, isDeaf = false): string {
  const rows = 3
  const h = rows * 2
  const words = new Uint32Array(columns * rows * 3)
  const cx = (columns - 1) / 2
  // The eye stays centred on the horizon; the gaze moves the aperture inside it, never the eye along the line.
  const ex = cx + Math.max(-1, Math.min(1, look.gx)) * Math.min(2, columns * 0.02)
  const ey = (h - 1) / 2
  const ra = 0.18 + 0.28 * Math.max(0.1, Math.min(1, look.open))

  const at = (px: number, py: number): number => {
    const dx = (px - ex) / 3.2
    const dy = (py - ey) / 3.2
    const d = Math.hypot(dx, dy)
    if (isAway) {
      if (d < 0.35) {
        return scale(0x5a0a06, 0.6 + 0.3 * look.glow)
      }
    } else if (d < 1.05) {
      const ax = dx - look.gx * 0.22
      const ay = dy - look.gy * 0.22
      const q = Math.hypot(ax, ay)
      if (q < ra) {
        return 0x050101
      }
      if (q < ra + 0.2) {
        return scale(mix(0xfff1dc, 0xff5a1f, (q - ra) / 0.2), 0.55 + 0.45 * look.rim)
      }
      if (d < 0.86) {
        return scale(ramp([[0, 0xe0301a], [0.4, 0x7a0a06], [0.86, 0x2a0604]], d), look.glow)
      }

      return scale(0x2c2c33, 0.9)
    }
    // the horizon: two middle pixel rows, darkest red at the centre, fading to the sides
    const fade = Math.max(0, 1 - Math.abs(px - cx) / (columns * 0.55))
    if (py === 2 || py === 3) {
      return fade > 0.02 ? scale(py === 3 ? 0x3a0806 : 0x220403, fade * (0.75 + 0.25 * look.glow)) : NONE
    }

    return NONE
  }

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const top = at(col, row * 2)
      const bottom = at(col, row * 2 + 1)
      const i = (row * columns + col) * 3
      if (top === NONE && bottom === NONE) {
        words[i] = 0x20
        words[i + 1] = DEFAULT
        words[i + 2] = DEFAULT
      } else if (top === NONE) {
        words[i] = 0x2584
        words[i + 1] = bottom
        words[i + 2] = DEFAULT
      } else {
        words[i] = 0x2580
        words[i + 1] = top
        words[i + 2] = bottom === NONE ? DEFAULT : bottom
      }
    }
  }
  if (isDeaf && columns >= 8) {
    // The closed ear: a dim struck-through circle on the horizon's right end.
    const i = (1 * columns + (columns - 3)) * 3
    words[i] = 0x2298
    words[i + 1] = 0x6a5a56
    words[i + 2] = DEFAULT
  }

  return base64(new Uint8Array(words.buffer))
}
