// Writes HAL's terminal as HTML pages for tools/render-pictures.ps1: the band and the pane eye
// come from the mod's own hooks/eye.ts, the texts are the ones its render hooks produce; the
// Claude Code layout around them is simplified. Needs Node 22.6 or newer (it reads TypeScript).
// Usage: node render-terminal.mjs <folder>
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const { bandCells, eyeCells } = await import(new URL('../hooks/eye.ts', import.meta.url).href)

const out = process.argv[2]
const DEFAULT = 0x01000000
const CHAT = 104
const PANE = 34
const GAP = 3
const FONT = 15
const LINE = 20
const CW = FONT * (1126 / 2048)

const hex = c => '#' + c.toString(16).padStart(6, '0')

/** Raster cells (base64 of [char, fg, bg] words) to an SVG of half-cell pixels. */
function raster(b64, columns, rows) {
  const buf = Buffer.from(b64, 'base64')
  const words = new Uint32Array(buf.buffer, buf.byteOffset, buf.length / 4)
  let rects = ''
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const i = (row * columns + col) * 3
      const ch = words[i]
      const fg = words[i + 1]
      const bg = words[i + 2]
      let top = DEFAULT
      let bottom = DEFAULT
      if (ch === 0x2580) {
        top = fg
        bottom = bg
      } else if (ch === 0x2584) {
        bottom = fg
      }
      if (top !== DEFAULT) rects += `<rect x="${col}" y="${row * 2}" width="1.04" height="1.04" fill="${hex(top)}"/>`
      if (bottom !== DEFAULT) rects += `<rect x="${col}" y="${row * 2 + 1}" width="1.04" height="1.04" fill="${hex(bottom)}"/>`
    }
  }
  return `<svg class="raster" style="width:${columns}ch;height:${rows * LINE}px" viewBox="0 0 ${columns} ${rows * 2}" preserveAspectRatio="none" shape-rendering="crispEdges">${rects}</svg>`
}

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const line = (...segs) => `<div class="l">${segs.map(([t, c]) => (c ? `<span class="${c}">${esc(t)}</span>` : esc(t))).join('') || '&nbsp;'}</div>`

function page({ spoken, isAway, paneState, look, withPane }) {
  const chat = [
    line(),
    line(['21:52 · guest', 'head']),
    line(['the parser fails on empty input. can you look?', 'visitor']),
    line(),
    line(['● ', 'ok'], ['Read', 'b'], ['(src/parser.ts)']),
    line(['  ⎿  Read 212 lines', 'dim']),
    line(['● ', 'ok'], ['Bash', 'b'], ['(npm test -- parser)']),
    line(['  ⎿  1 failed, 13 passed', 'dim']),
    line(['● ', 'ok'], ['Update', 'b'], ['(src/parser.ts)']),
    line(['  ⎿  Updated src/parser.ts with 3 additions and 1 removal', 'dim']),
    line(['● ', 'ok'], ['Bash', 'b'], ['(npm test -- parser)']),
    line(['  ⎿  14 passed', 'dim']),
    line(),
    line(['● '], ['parse() returned undefined for an empty input; it now returns an empty list, as both']),
    line(['  callers expect. All fourteen parser tests pass.']),
    line(),
    line([spoken ? '  ◉ The test is green now. It was red for most of the evening.' : '  ◉ ···']),
    line(),
    line(['HAL · 41 s', 'dim']),
    line(),
    raster(bandCells(CHAT, look, isAway, false), CHAT, 3),
    line(['─'.repeat(CHAT), 'rule']),
    line(['> ', 'dim'], ['\u00a0', 'cursor']),
    line(['─'.repeat(CHAT), 'rule']),
    line(['  ? for shortcuts · HAL waits · HAL listens', 'dim']),
    line(['  ◉ HAL', 'hal'], [' · inside since 21:04 · visit 37 · read 37 · commands 12', 'dim']),
  ]
  const eyeColumns = PANE - 2
  const eyeRows = Math.ceil(eyeColumns / 2)
  const quote = ['“The test is green now. It was', 'red for most of the evening.”']
  const pane = [
    line(),
    `<div style="padding-left:1ch">${raster(eyeCells(eyeColumns, eyeRows, look), eyeColumns, eyeRows)}</div>`,
    line(),
    line([' HAL', 'hal'], [` · ${paneState}`, 'dim']),
    line([' mood ●●○', 'dim']),
    ...(spoken ? quote.map(q => line([' ' + q, 'dim'])) : []),
  ]
  const rows = chat.length + 2 // the band is three rows in one element
  const width = Math.ceil((withPane ? CHAT + GAP + PANE : CHAT) * CW + 2 * 16)
  const height = rows * LINE + 34 + 2 * 12
  const html = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:#0A0606}
.win{width:${width}px;height:${height}px;background:#0A0606;color:#CFC6C2;font:${FONT}px/${LINE}px Consolas,monospace;box-sizing:border-box;overflow:hidden}
.title{height:34px;background:#140c0b;display:flex;align-items:flex-end;padding-left:10px;font:12px/1 'Segoe UI',sans-serif;color:#9a8e8a}
.tab{background:#0A0606;padding:9px 16px 8px;border-radius:6px 6px 0 0;color:#CFC6C2}
.screen{display:flex;padding:12px 16px;gap:${GAP}ch}
.chat{width:${CHAT}ch}.pane{width:${PANE}ch;border-left:1px solid #2a1c1a}
.l{height:${LINE}px;white-space:pre}
.raster{display:block}
.dim{color:#7f7572}.head{color:#7f7572}.visitor{color:#b8aeaa}.ok{color:#8FA58A}.b{font-weight:bold}
.rule{color:#3a2c2a}.hal{color:#e0301a}.cursor{background:#CFC6C2}
</style><div class="win"><div class="title"><span class="tab">HAL</span></div>
<div class="screen"><div class="chat">${chat.join('')}</div>${withPane ? `<div class="pane">${pane.join('')}</div>` : ''}</div></div>`
  return { html, width, height }
}

const idle = { gx: -0.42, gy: -0.42, open: 0.6, rim: 0.55, glow: 0.8, spin: 0.13, rot: 0.4 }
const speaking = { gx: -0.42, gy: -0.42, open: 0.4, rim: 0.85, glow: 0.84, spin: 0.2, rot: 0.42 }
const shots = {
  terminal: page({ spoken: true, isAway: false, paneState: 'listening', look: idle, withPane: true }),
  'terminal-speaking': page({ spoken: false, isAway: true, paneState: 'speaking', look: speaking, withPane: false }),
}
const sizes = {}
for (const [name, { html, width, height }] of Object.entries(shots)) {
  writeFileSync(join(out, `${name}.html`), html)
  sizes[name] = { width, height }
}
writeFileSync(join(out, 'sizes.json'), JSON.stringify(sizes))
console.log(JSON.stringify(sizes))
