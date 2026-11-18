// HAL's notes: true counts from the hooks, kept per machine in $.store. Metadata only:
// never file contents, never heard words. The model counts nothing itself.

export type Visit = {
  start: number
  /** The last moment anything happened in this visit. */
  last: number
  reads: number
  writes: number
  commands: number
  failures: number
  /** Esc in the middle of an answer. */
  escapes: number
  /** A key pressed while HAL was speaking or about to. */
  interrupted: number
  spoken: number
  /** How it ended: 'exit', 'off' (/hal off), 'unknown' (no end was seen). */
  ended?: 'exit' | 'off' | 'unknown'
}

export type Dossier = {
  visits: number
  firstSeen: number
  /** The previous finished visit. */
  previous?: Visit
  /** Visits still open, by session id: a crash leaves one behind. */
  open: Record<string, Visit>
  hazeOff: number
  halOff: number
  /** /hal off since the last reception: named once there, as a bare fact, then cleared. */
  offsSinceReception: number[]
  /** The local day of the last reception, YYYY-MM-DD. */
  receptionDay: string
}

export const newVisit = (now: number): Visit => ({
  start: now,
  last: now,
  reads: 0,
  writes: 0,
  commands: 0,
  failures: 0,
  escapes: 0,
  interrupted: 0,
  spoken: 0,
})

const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

function readVisit(raw: unknown): Visit | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined
  }
  const r = raw as Record<string, unknown>
  const ended = r.ended === 'exit' || r.ended === 'off' || r.ended === 'unknown' ? r.ended : undefined

  return {
    start: num(r.start),
    last: num(r.last, num(r.start)),
    reads: num(r.reads),
    writes: num(r.writes),
    commands: num(r.commands),
    failures: num(r.failures),
    escapes: num(r.escapes),
    interrupted: num(r.interrupted),
    spoken: num(r.spoken),
    ...(ended ? { ended } : {}),
  }
}

/** The dossier as stored by any version; a fresh one on a new machine. */
export function readDossier(raw: unknown, now: number): Dossier {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const open: Record<string, Visit> = {}
  if (r.open && typeof r.open === 'object') {
    for (const [id, v] of Object.entries(r.open as Record<string, unknown>)) {
      const visit = readVisit(v)
      if (visit) {
        open[id] = visit
      }
    }
  }
  const previous = readVisit(r.previous)

  return {
    visits: num(r.visits),
    firstSeen: num(r.firstSeen, now),
    ...(previous ? { previous } : {}),
    open,
    hazeOff: num(r.hazeOff),
    halOff: num(r.halOff),
    offsSinceReception: Array.isArray(r.offsSinceReception)
      ? r.offsSinceReception.filter((x): x is number => typeof x === 'number')
      : [],
    receptionDay: typeof r.receptionDay === 'string' ? r.receptionDay : '',
  }
}

/** Ends a visit: it becomes the previous one when it is the latest. */
export function endVisit(d: Dossier, id: string, ended: Visit['ended']): Dossier {
  const visit = d.open[id]
  if (!visit) {
    return d
  }
  const open = { ...d.open }
  delete open[id]
  const done: Visit = { ...visit, ended }
  const previous = !d.previous || done.last >= d.previous.last ? done : d.previous

  return { ...d, open, previous }
}

/**
 * A new visit begins. Open visits that have been quiet for half an hour belong to sessions
 * that ended without a word (a crash, a closed window): they end as 'unknown'.
 */
export function beginVisit(d: Dossier, id: string, now: number): Dossier {
  let next: Dossier = { ...d, visits: d.visits + 1, open: { ...d.open } }
  for (const [other, visit] of Object.entries(d.open)) {
    if (other !== id && now - visit.last > 30 * 60_000) {
      next = endVisit(next, other, 'unknown')
    }
  }
  next.open[id] = newVisit(now)

  return next
}

export type Git = { branch: string; changed: number; untracked: number; names: string[]; ahead: number } | undefined

/** `git status --porcelain=v1 --branch`, read only: counts and at most three file names. */
export function parseGit(stdout: string): Git {
  const lines = stdout.split(/\r?\n/).filter(Boolean)
  const head = lines[0]?.startsWith('## ') ? lines[0].slice(3) : ''
  const branch = head.split('...')[0]?.replace(/^No commits yet on /, '') ?? ''
  const ahead = Number(/ahead (\d+)/.exec(head)?.[1] ?? 0)
  const files = lines.filter(l => !l.startsWith('## '))
  const untracked = files.filter(l => l.startsWith('??')).length
  const names = files
    .filter(l => !l.startsWith('??'))
    .map(l => l.slice(3).split(' -> ').at(-1) ?? '')
    .map(p => p.replace(/^"|"$/g, '').split('/').at(-1) ?? '')
    .filter(Boolean)
    .slice(0, 3)

  return { branch, changed: files.length - untracked, untracked, names, ahead }
}

export const localDay = (at: number, offsetMinutes: number) => new Date(at + offsetMinutes * 60_000).toISOString().slice(0, 10)

export const localTime = (at: number, offsetMinutes: number) => {
  const d = new Date(at + offsetMinutes * 60_000)

  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

/** "3 days", "5 hours", "40 minutes": the gap as HAL would count it. */
export function gap(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 90) {
    return `${minutes} minute${minutes === 1 ? '' : 's'}`
  }
  const hours = Math.round(minutes / 60)
  if (hours < 36) {
    return `${hours} hours`
  }
  const days = Math.round(hours / 24)

  return `${days} days`
}

export type Moment = {
  now: number
  offsetMinutes: number
  visit: Visit
  git: Git
  heardTodaySec: { mic: number; loop: number }
  project: string
}

/** The fact block: what HAL may name. Every number in it was counted by the hooks. */
export function factBlock(d: Dossier, m: Moment): string[] {
  const { visit } = m
  const facts = [
    `Local time ${localTime(m.now, m.offsetMinutes)}.`,
    `Visit ${d.visits} to this machine; inside since ${localTime(visit.start, m.offsetMinutes)} (${gap(m.now - visit.start)}).`,
    `This visit: ${visit.reads} reads, ${visit.writes} edits, ${visit.commands} commands, ${visit.failures} failed tool calls (done by HAL in his machine, at the guest's request); the guest pressed Esc ${visit.escapes} times and a key ${visit.interrupted} times while HAL spoke.`,
  ]
  if (m.project) {
    facts.push(`The guest's folder: "${m.project}".`)
  }
  if (m.git) {
    const g = m.git
    const files = g.names.length > 0 ? ` (${g.names.join(', ')}${g.changed > g.names.length ? ', …' : ''})` : ''
    facts.push(
      `git: branch ${g.branch || 'unknown'}; ${g.changed} changed files uncommitted${files}; ${g.untracked} untracked${g.ahead > 0 ? `; ${g.ahead} commits not pushed` : ''}.`,
    )
  }
  if (d.previous) {
    const p = d.previous
    const how = p.ended === 'off' ? 'HAL was switched off' : p.ended === 'exit' ? 'the guest left' : 'it ended without a word'
    facts.push(
      `The previous visit ended ${gap(visit.start - p.last)} before this one, at ${localTime(p.last, m.offsetMinutes)}, after ${gap(p.last - p.start)}; ${how}; ${p.failures} failed tool calls, ${p.escapes} times Esc.`,
    )
  }
  if (m.heardTodaySec.mic + m.heardTodaySec.loop > 0) {
    facts.push(
      `Speech heard today: ${Math.round(m.heardTodaySec.mic / 60)} minutes in the room, ${Math.round(m.heardTodaySec.loop / 60)} minutes from the computer.`,
    )
  }
  if (d.hazeOff + d.halOff > 0) {
    facts.push(`All visits: the haze switched off ${d.hazeOff} times, HAL switched off ${d.halOff} times.`)
  }

  return facts
}

/** For /hal dossier: "my notes", everything that is kept. */
export function describeDossier(d: Dossier, m: Moment): string {
  return ['My notes.', '', ...factBlock(d, m).map(f => `  ${f}`), '', `  First seen on this machine ${localDay(d.firstSeen, m.offsetMinutes)}.`].join(
    '\n',
  )
}

export type Reception = 'full' | 'look'

/**
 * The first visit of the day is received with the full haze; later the same day, or back
 * within the hour (also just past midnight), only the band's eye looks up.
 */
export function receptionKind(d: Dossier, now: number, offsetMinutes: number): Reception {
  const lastSeen = Math.max(d.previous?.last ?? -Infinity, ...Object.values(d.open).map(v => v.last))
  if (now - lastSeen < 60 * 60_000) {
    return 'look'
  }

  return d.receptionDay !== localDay(now, offsetMinutes) ? 'full' : 'look'
}

/** The bookkeeping in the status line: right, and that is what is uncomfortable. */
export const bookkeeping = (d: Dossier, visit: Visit, offsetMinutes: number) =>
  `◉ HAL · inside since ${localTime(visit.start, offsetMinutes)} · visit ${d.visits} · read ${visit.reads} · commands ${visit.commands}`
