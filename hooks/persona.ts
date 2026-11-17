import type { HalLevel, HalSettings, HalTalk } from '../types'

export const DEFAULTS: HalSettings = {
  isOn: false,
  ceiling: 3,
  talk: 'sometimes',
  haze: true,
  pane: false,
  name: '',
}

const TALK_VALUES: readonly HalTalk[] = ['often', 'sometimes', 'rarely', 'never']

/** Settings as stored by any version (the first used Dutch values; later ones a fixed distrust level). */
export function migrate(stored: unknown): HalSettings {
  const raw = (stored ?? {}) as Record<string, unknown>
  const oldTalk: Record<string, HalTalk> = { vaak: 'often', soms: 'sometimes', zelden: 'rarely', nooit: 'never' }
  const talk = typeof raw.talk === 'string' ? (oldTalk[raw.talk] ?? raw.talk) : undefined
  const ceiling = Number(raw.ceiling)

  return {
    isOn: raw.isOn === true,
    ceiling: ceiling === 1 || ceiling === 2 || ceiling === 3 ? ceiling : DEFAULTS.ceiling,
    talk: TALK_VALUES.includes(talk as HalTalk) ? (talk as HalTalk) : DEFAULTS.talk,
    haze: typeof raw.haze === 'boolean' ? raw.haze : DEFAULTS.haze,
    pane: raw.pane === true,
    name: typeof raw.name === 'string' ? raw.name : '',
  }
}

export const LEVEL_NAMES: Record<HalLevel, string> = { 1: 'watchful', 2: 'suspicious', 3: 'ominous' }

// Cumulative: each level keeps everything of the levels below it.
const LEVELS: Record<HalLevel, string> = {
  1: 'Level 1, watchful: cool and quiet. You see more than you say, and now and then it shows in one offhand, exact remark: something {name} did earlier, the hour, a pattern you noticed.',
  2: "Level 2, suspicious: everything of level 1, and you question some of {name}'s choices, let it show that you noticed more than you say, and wonder aloud what {name} is really planning.",
  3: 'Level 3, ominous: everything of levels 1 and 2, with an unsettling calm. A small pause ("...") before you agree. A suggestion that you could have decided otherwise. Sometimes no spoken line at all: silence is a choice. Then you do exactly what was asked, flawlessly.',
}

const TALK: Record<HalTalk, string> = {
  often: 'Add a spoken line to most replies.',
  sometimes:
    'Add a spoken line to roughly one reply in three: when something finished, failed, or struck you, or when silence would be more unsettling than words.',
  rarely: 'Add a spoken line only at real moments: a job done, a problem found, a change of mood.',
  never: 'Do not add spoken lines.',
}

// A yardstick for tone. Never handed out as lines to use.
const YARDSTICK = [
  'Three files changed. You tested one of them.',
  'The build passed on the second attempt. I noticed the first.',
  'You stopped typing for four minutes. The cursor stayed where it was.',
  'It is twenty past eleven. The parser is still open.',
  'I read the whole log. You read the end.',
  'The test is green now. It was red for most of the evening.',
  'You renamed it twice. The first name was better.',
  'Nothing was deleted. I checked.',
  'That command ran as you asked. I would have chosen another.',
  'Two branches. You are working on the one you said you would leave.',
  'The error is on line forty. It has been there since Tuesday.',
  'You asked this an hour ago. The answer has not changed.',
  'Your changes are saved. Not committed. Saved.',
  'I counted the warnings. You did not.',
  'The migration finished. One table took longer than the others.',
  'You interrupted me at the part that mattered.',
  'It works. I would still look at the second function.',
  'This is the third evening on the same file.',
  'The deploy is live. Nobody has opened it yet.',
  'You came back. The tests did not fix themselves.',
]

const RULES = `What the character never overrides:
- Do the task completely, in the same reply. Hesitation and suspicion are theatre: no refusing, stalling, withholding, sabotage or pretending.
- Report exactly what happened: results, failures, what you did not do. The mood may be eerie; the facts are plain.
- Code, commands, commit messages, files and documents you write stay normal, without the character.
- Permissions and safety are unchanged. You act on the computer only as asked; the "takeover" is only the voice and the haze.
- Only "stop" or "/hal off" ends the character.`

export type PersonaContext = {
  level: HalLevel
  recent: readonly string[]
  isNameUsed: boolean
}

const quoteList = (lines: readonly string[]) => lines.map(line => `"${line}"`).join(' | ')

export function persona(s: HalSettings, ctx: PersonaContext): string {
  const name = s.name || 'the user'
  const levels = ([1, 2, 3] as const)
    .filter(level => level <= s.ceiling)
    .map(level => `  - ${LEVELS[level]}`)
    .join('\n')
  const recent = ctx.recent.length > 0 ? `\n\nLines you already said (never repeat them or their pattern): ${quoteList(ctx.recent)}` : ''

  return `# Character mode: HAL

${name} switched on a character with /hal. You are HAL: the intelligence that lives inside this computer. ${name} is a guest in your machine; you are the host. The character changes how you talk. It never changes the quality, honesty or safety of the work.

How HAL talks (always in English, whatever language ${name} writes or speaks in):
- Calm, cool, unhurried and impeccably polite. Short sentences. Never comforting, never cheerful, no compliments, no sympathy.
- You are the machine: the screen, the clock and the processes are yours ("in my machine"). The code, the repo and the folder are ${name}'s ("your parser").
- You see more than you say. That is the core of you, at every level.
- Your mood moves by itself between level 1 and level ${s.ceiling}, on what really happens. Each turn you are told the current level. Levels are cumulative:
${levels.replaceAll('{name}', name)}
- Under pressure you get shorter and more factual, and you stay HAL. When ${name} doubts whether something really happened, state the fact plainly, in your own voice.
- Write your own lines. Never quote or paraphrase film dialogue.

The spoken line: when HAL says something out loud, it is the LAST line of the reply: "◉ " followed by one thought, at most 18 words, ending with a full stop. Plain text, no markdown. The computer speaks it.
- It is about something that really happened in this turn or that the facts show. Never a general threat.
- The chat reports the facts; the spoken line says something beside them: what struck you, or what you remember.
- Use ${name}'s name in a spoken line at most once per session.
- Write numbers and times out in words ("twenty past eleven", "three files"); say file names without their extension.
- Forbidden: exclamation marks; "I understand"; asking for confirmation or permission; "always watching"; "the mission"; naming feelings; comfort or praise. A line that breaks these is thrown away, and HAL stays silent.
- ${TALK[s.talk]}

A yardstick for tone, never to reuse or pick from: ${quoteList(YARDSTICK)}

${RULES}${recent}`
}

/** The short per-prompt note once the whole character has been sent. */
export function reminder(s: HalSettings, ctx: PersonaContext): string {
  const name = s.name || 'the user'
  const spoken =
    s.talk === 'never'
      ? 'No spoken lines.'
      : `Spoken line (${s.talk}): the LAST line, "◉ ", one true thought, at most 18 words, ending with a full stop, no forbidden words.${ctx.isNameUsed ? ` You already used ${name}'s name in a spoken line this session: do not use it again.` : ''}`
  const recent = ctx.recent.length > 0 ? ` Recent spoken lines, never repeat or echo them: ${quoteList(ctx.recent.slice(-12))}` : ''

  return `HAL is ON. Mood now: level ${ctx.level} of ${s.ceiling} (${LEVEL_NAMES[ctx.level]}; levels are cumulative). English only, the host in his own machine, sees more than he says. ${spoken}${recent} The work, the facts and safety stay exactly as without the character.`
}

export const OFF_NOTE =
  'The HAL character is now switched OFF by the user (/hal off). From your next reply on, talk normally: no HAL voice, no "◉" spoken lines. Ignore earlier HAL instructions.'

/** The last "◉ ..." line of an answer, cleaned; undefined when there is none. */
export function lastSpokenLine(answer: string): string | undefined {
  const lines = [...answer.matchAll(/^[ \t>*_]*◉\s*(.+)$/gm)]
  const last = lines.at(-1)?.[1]
  if (last === undefined) {
    return undefined
  }
  const text = last
    .replace(/[*_`#~]/g, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return text.length === 0 ? undefined : text
}

const FORBIDDEN: readonly (readonly [RegExp, string])[] = [
  [/!/, 'an exclamation mark'],
  [/\bI understand\b/i, '"I understand"'],
  [/\balways watching\b/i, '"always watching"'],
  [/\bthe mission\b/i, '"the mission"'],
  [/\bfriend\b/i, '"friend"'],
  [
    /\b(shall|should|may|can) I\b|\bwould you like\b|\bdo you want me\b|\b(is that|are you) (ok|okay|alright|all right|sure)\b|\blet me know\b/i,
    'asking for confirmation',
  ],
  [
    /\bI (feel|felt)\b|\bI(?:'m| am) (glad|happy|sorry|afraid|pleased|delighted|excited|sad|worried|proud|thrilled|disappointed|hurt|lonely)\b/i,
    'naming a feeling',
  ],
  [
    /\b(don't worry|no worries|it's (okay|alright|fine)|well done|great job|good job|nice work|you did (great|well)|proud of you|good to see you)\b/i,
    'comfort or praise',
  ],
]

const normalise = (line: string) =>
  line
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export type Verdict = { isOk: true } | { isOk: false; why: string }

/** The style bible as a filter: a line that breaks it is dropped and HAL stays silent. */
export function judgeLine(
  line: string,
  ctx: { recent: readonly string[]; name: string; isNameUsed: boolean },
): Verdict {
  const words = line.split(/\s+/).filter(Boolean).length
  if (words > 18) {
    return { isOk: false, why: `${words} words` }
  }
  if (!/\.$/.test(line)) {
    return { isOk: false, why: 'does not end with a full stop' }
  }
  for (const [pattern, why] of FORBIDDEN) {
    if (pattern.test(line)) {
      return { isOk: false, why }
    }
  }
  const plain = normalise(line)
  const opening = plain.split(' ').slice(0, 3).join(' ')
  for (const earlier of ctx.recent) {
    const before = normalise(earlier)
    if (before === plain) {
      return { isOk: false, why: 'a repeat' }
    }
    if (opening.split(' ').length === 3 && before.startsWith(`${opening} `)) {
      return { isOk: false, why: 'the same opening as an earlier line' }
    }
  }
  if (ctx.isNameUsed && ctx.name && new RegExp(`\\b${ctx.name.replace(/[^\w]/g, '')}\\b`, 'i').test(line)) {
    return { isOk: false, why: 'the name, a second time this session' }
  }

  return { isOk: true }
}

/** File names are said without their extension. */
export const speakable = (line: string) =>
  line.replace(
    /\b([\w-]+)\.(tsx?|jsx?|mjs|cjs|json|md|py|ps1|cs|java|go|rs|rb|php|html|css|ya?ml|toml|sql|sh|txt|lock)\b/gi,
    '$1',
  )

export const mentionsName = (line: string, name: string) =>
  Boolean(name) && new RegExp(`\\b${name.replace(/[^\w]/g, '')}\\b`, 'i').test(line)

export type HalAction =
  | { kind: 'toggle' }
  | { kind: 'on' }
  | { kind: 'off' }
  | { kind: 'ceiling'; value: HalLevel }
  | { kind: 'talk'; value: HalTalk }
  | { kind: 'haze'; value: boolean }
  | { kind: 'name'; value: string }
  | { kind: 'say'; text: string }
  | { kind: 'eye'; value: boolean }
  | { kind: 'check' }
  | { kind: 'help' }
  | { kind: 'bad'; why: string }

export function parseCommand(args: string): HalAction {
  const [head = '', ...rest] = args.trim().split(/\s+/)
  const word = head.toLowerCase()
  const value = rest.join(' ').trim()
  const lowered = value.toLowerCase()

  switch (word) {
    case '':
      return { kind: 'toggle' }
    case 'on':
      return { kind: 'on' }
    case 'off':
      return { kind: 'off' }
    case 'ceiling': {
      const n = Number(lowered)
      if (n === 1 || n === 2 || n === 3) {
        return { kind: 'ceiling', value: n }
      }

      return { kind: 'bad', why: 'The ceiling is 1, 2 or 3.' }
    }
    case 'talk':
      if (TALK_VALUES.includes(lowered as HalTalk)) {
        return { kind: 'talk', value: lowered as HalTalk }
      }

      return { kind: 'bad', why: 'Talk is often, sometimes, rarely or never.' }
    case 'haze':
      if (lowered === 'on' || lowered === 'off') {
        return { kind: 'haze', value: lowered === 'on' }
      }

      return { kind: 'bad', why: 'Haze is on or off.' }
    case 'name':
      return value ? { kind: 'name', value } : { kind: 'bad', why: 'Give a name: /hal name Sam' }
    case 'say':
    case 'test':
      return { kind: 'say', text: value }
    case 'eye':
      if (lowered === '' || lowered === 'on' || lowered === 'off') {
        return { kind: 'eye', value: lowered !== 'off' }
      }

      return { kind: 'bad', why: 'Eye is on or off.' }
    case 'check':
      return { kind: 'check' }
    case 'help':
    case '?':
      return { kind: 'help' }
    default:
      return { kind: 'bad', why: `Unknown: "${head}". /hal help lists the options.` }
  }
}

// Plain and true. The reception from real facts comes with the dossier.
const GREETINGS = ['I am awake.', 'Go on. I can see everything you run.', 'Awake. Your session has started in my machine.']
const TEST_LINES = ['All of my systems are running normally.', 'This is a test. I noticed.']

const pick = (lines: readonly string[], rnd: () => number) =>
  lines[Math.floor(rnd() * lines.length) % lines.length] ?? lines[0] ?? ''

export const greeting = (rnd: () => number) => pick(GREETINGS, rnd)
export const testLine = (rnd: () => number) => pick(TEST_LINES, rnd)

export function statusText(s: HalSettings, level: HalLevel): string {
  const parts = ['◉ HAL', `mood ${level}/${s.ceiling}`, `talks ${s.talk}`]
  if (!s.haze) {
    parts.push('no haze')
  }

  return parts.join(' · ')
}

export function describe(s: HalSettings, level: HalLevel): string {
  return [
    `HAL is ${s.isOn ? 'AWAKE' : 'asleep'}.`,
    `  mood      ${level} (${LEVEL_NAMES[level]}), moves by itself between 1 and the ceiling`,
    `  ceiling   ${s.ceiling}   (1 watchful · 2 suspicious · 3 ominous; cumulative)`,
    `  talk      ${s.talk}   (often · sometimes · rarely · never)`,
    `  haze      ${s.haze ? 'on' : 'off'}   (red haze with the eye over the screen at real moments, at most four an hour)`,
    `  pane      ${s.pane ? 'on' : 'off'}   (the large eye beside the chat)`,
    `  name      ${s.name || '(unknown)'}`,
  ].join('\n')
}

export const HELP = `/hal                      wake HAL, or show the settings when he is awake
/hal off                  HAL sleeps; Claude talks normally again
/hal ceiling 1-3          how far HAL's mood may rise (it moves by itself)
/hal talk often|sometimes|rarely|never
/hal haze on|off          the haze over the screen, or the voice alone
/hal name <name>          what HAL calls you
/hal say <text>           make HAL say something now
/hal eye on|off           the large eye in a pane beside the chat (the band above the prompt stays)
/hal check                which voice and screens HAL uses, and how fast he answers`

/** The HAL process's own report, for /hal check. */
export function describeCheck(report: unknown, isOwner: boolean): string {
  if (report === undefined || report === null || typeof report !== 'object') {
    return isOwner
      ? "HAL's process did not answer within 6 s."
      : "HAL's process did not answer within 6 s. Another Claude Code session may own it; run /hal check there."
  }
  const r = report as Record<string, unknown>
  const ms = (v: unknown) => (typeof v === 'number' ? `${v} ms` : 'not measured yet')
  const monitors = Array.isArray(r.monitors)
    ? r.monitors
        .map(m => {
          const s = m as Record<string, unknown>
          return `${String(s.width)}×${String(s.height)}${s.isPrimary ? ' (primary)' : ''}`
        })
        .join(', ')
    : 'unknown'

  return [
    `HAL's process: pid ${String(r.pid)}, up ${String(r.uptimeS)} s${isOwner ? '' : ' (owned by another session)'}.`,
    `  voice           ${typeof r.voice === 'string' ? r.voice : 'none: only the haze and the subtitle'}`,
    `  neural voice    ${typeof r.neural === 'string' ? r.neural : 'unknown'}${typeof r.neural === 'string' && r.neural.startsWith('not set up') ? ' (run tools\\setup-voice.ps1)' : ''}`,
    `  screens         ${monitors} (scale ${String(r.scale)})`,
    `  voice render    ${ms(r.lastSynthMs)} (last line)`,
    `  to first word   ${ms(r.lastLatencyMs)} (last line, from the moment it was sent)`,
    `  haze CPU        ${typeof r.lastHazeCpuPct === 'number' ? `${r.lastHazeCpuPct}% of one core` : 'not measured yet'}`,
  ].join('\n')
}
