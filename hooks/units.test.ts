import { expect, test } from 'claude-code/testing'

import { beginVisit, endVisit, factBlock, parseGit, readDossier, receptionKind } from './dossier'
import { acknowledgement, addressed, keep, remarkFrom, shouldWeigh, tally } from './ears'
import { closing, conversationNote, isLook, isSleepPhrase, isTypedStop, isWakePhrase, presenceStrength } from './conversation'
import { advance, bandFor, learnedNote, levelFactor, levelLine, lineFor, NAME_TIMES, NOTHING_HEARD, OTHER_TIMES, STOP_TIMES, windowBand, windowMs } from './learn'
import type { Learn } from './learn'
import { initiative, newWatch, noteTest, testKey } from './moments'
import { parseSeen, sightFacts } from './sight'

const T0 = Date.UTC(2026, 10, 17, 21, 0)

test('a sentence that starts with his name is a command; the rest is not', async () => {
  expect(addressed('HAL, run the tests again.')).toBe('Run the tests again.')
  expect(addressed('Hal draai de tests nog een keer')).toBe('Draai de tests nog een keer')
  expect(addressed('Hey HAL, what time is it?')).toBe('What time is it?')
  expect(addressed('Hall, commit the voice.')).toBe('Commit the voice.')
  expect(addressed('Al, commit it.')).toBe('Commit it.')
  expect(addressed('HAL.')).toBe('')
  // How Whisper often writes a lone "HAL".
  expect(addressed('Hell.')).toBe('')
  expect(addressed('Hell, what time is it?')).toBe('What time is it?')
  // Ordinary sentences, also the Dutch "al" and "haal".
  expect(addressed('Al gedaan, dank je.')).toBeUndefined()
  expect(addressed('Haal de laatste versie op.')).toBeUndefined()
  expect(addressed('I think HAL is listening.')).toBeUndefined()
})

test('his name alone gets a short answer, never the same one twice in a row', async () => {
  for (const level of [1, 2, 3] as const) {
    const first = acknowledgement(level, undefined, 0)
    expect(first.split(/\s+/).length <= 6).toBe(true)
    expect(/!/.test(first)).toBe(false)
    for (const pick of [0, 0.3, 0.6, 0.99]) {
      expect(acknowledgement(level, first, pick) === first).toBe(false)
    }
  }
})

test('a conversation: typed stop, look, the haze settling in, the closing lines', async () => {
  expect(isTypedStop('stop')).toBe(true)
  expect(isTypedStop(' Stop. ')).toBe(true)
  expect(isTypedStop('stop the build')).toBe(false)
  expect(isTypedStop('please stop')).toBe(false)
  // The sentences that open and close it, however the name was written.
  expect(isWakePhrase('Hell, please wake up.')).toBe(true)
  expect(isWakePhrase('Go, wake up.')).toBe(true)
  expect(isWakePhrase('HAL, word wakker.')).toBe(true)
  expect(isWakePhrase('I really need to wake up earlier tomorrow, I think.')).toBe(false)
  expect(isSleepPhrase('Hell, go to sleep.')).toBe(true)
  expect(isSleepPhrase('Go to sleep.')).toBe(true)
  expect(isSleepPhrase('The kids did not want to go to sleep last night at all.')).toBe(false)
  expect(isLook('look')).toBe(true)
  expect(isLook('Kijk eens naar mij')).toBe(true)
  expect(isLook('can you look at me now')).toBe(true)
  expect(isLook('let us look at the parser')).toBe(false)
  expect(presenceStrength(0)).toBe(0.45)
  expect(presenceStrength(3 * 60_000)).toBe(0.62)
  expect(presenceStrength(60 * 60_000)).toBe(0.62)
  for (const level of [1, 2, 3] as const) {
    const first = closing(level, undefined, 0)
    expect(closing(level, first, 0) === first).toBe(false)
    expect(/!|\d/.test(first)).toBe(false)
  }
  expect(conversationNote(true, true, false)).toContain('seeing is off')
})

test('/hal learn walks through five names, three stops, two sentences, the weighing and the practice', async () => {
  let learn: Learn = { step: 'name', got: 0, at: T0 }
  const said: string[] = []
  const sent: string[] = []
  for (let got = 1; got <= NAME_TIMES; got++) {
    const step = advance(learn, got, T0 + got)
    learn = step.next
    if (step.say) said.push(step.say)
    if (step.send) sent.push(step.send)
  }
  expect(learn.step).toBe('stop')
  expect(sent).toEqual(['stop'])
  expect(said.at(-1)).toBe(lineFor.toStop)
  for (let got = 1; got <= STOP_TIMES; got++) {
    const step = advance(learn, got, T0 + 5 + got)
    learn = step.next
    if (step.say) said.push(step.say)
    if (step.send) sent.push(step.send)
  }
  expect(learn.step).toBe('other')
  expect(said.at(-1)).toBe(lineFor.toOther)
  for (let got = 1; got <= OTHER_TIMES; got++) {
    const step = advance(learn, got, T0 + 10 + got)
    learn = step.next
    if (step.send) sent.push(step.send)
  }
  expect(learn.step).toBe('weighing')
  expect(sent).toEqual(['stop', 'other', 'finish'])
  expect(bandFor({ step: 'name', got: 2, at: T0 })).toBe('HAL learns · say "HAL, please wake up" · 2 of 3')
  // The listening window: the bar empties while he listens.
  expect(windowBand({ step: 'name', got: 2, at: T0 }, 1)).toBe('HAL listens · say "HAL, please wake up" now ▕████████████████▏ 2 of 3')
  expect(windowBand({ step: 'stop', got: 0, at: T0 }, 0.5)).toBe('HAL listens · say "HAL, go to sleep" now ▕████████░░░░░░░░▏ 0 of 3')
  expect(windowBand({ step: 'other', got: 1, at: T0 }, 0)).toBe('HAL listens · say a sentence now ▕░░░░░░░░░░░░░░░░▏ 1 of 2')
  expect(windowMs('other') > windowMs('name')).toBe(true)
  // The level: a clipping voice is turned down, a drowning one up, at most three times.
  expect(levelFactor(0.97, 0)).toBe(0.65)
  expect(levelFactor(0.02, 1)).toBe(1.5)
  expect(levelFactor(0.5, 0)).toBeUndefined()
  expect(levelFactor(0.99, 3)).toBeUndefined()
  expect(levelFactor(undefined, 0)).toBeUndefined()
  expect(levelLine(0.65).startsWith('Too loud')).toBe(true)
  expect(/^[A-Z][a-z]+ /.test(NOTHING_HEARD) && !/^(A|E|I|O|U)/.test(NOTHING_HEARD)).toBe(true)
  // What he says stays inside his own rules: no exclamation marks, short, numbers as words.
  for (const line of [lineFor.start, lineFor.toOther, lineFor.result({ ok: true, caught: 5, of: 5 }), lineFor.result({ ok: false, caught: 2, of: 5 }), lineFor.result({ ok: false, why: 'x' })]) {
    expect(/!|\d/.test(line)).toBe(false)
    expect(line.split(/\s+/).length <= 18).toBe(true)
  }
  expect(lineFor.result({ ok: true, caught: 5, of: 5 })).toBe('Five of five. I know how you wake me now. Do it, and I will come.')
  expect(learnedNote({ ok: true, caught: 4, of: 5 }).includes('4 of 5')).toBe(true)
})

test('sight: a look becomes a few facts, and what changed since the last one', async () => {
  const clock = (at: number) => (at === T0 ? '21:00' : '21:20')
  expect(parseSeen('{"t":"blind","why":"no camera"}', T0)).toBeUndefined()
  expect(parseSeen('not json', T0)).toBeUndefined()
  const first = parseSeen('{"t":"seen","faces":1,"near":0.2,"side":"centre","light":0.7,"warm":-0.3,"backlit":true}', T0)
  const second = parseSeen('{"t":"seen","faces":2,"near":0.33,"side":"right","light":0.05,"warm":0.5}', T0 + 20 * 60_000)
  expect(sightFacts(first, undefined, clock)).toEqual([
    'Webcam, one look at 21:00 (measured on this machine, nothing kept): one face, at arm’s length; bright cool daylight; a bright window or lamp behind the guest.',
  ])
  expect(sightFacts(second, first, clock)).toEqual([
    'Webcam, one look at 21:20 (measured on this machine, nothing kept): 2 faces: someone else is there with the guest; the room is dark; only the screen lights the guest.',
    'At 21:00 the guest was alone.',
    'The room was brighter at 21:00.',
    'The guest sits closer to the screen than at 21:00.',
  ])
  const empty = parseSeen('{"t":"seen","faces":0,"light":0.4,"warm":0}', T0 + 40 * 60_000)
  expect(sightFacts(empty, second, () => '21:20')[1]).toBe('At 21:20 the guest was still at the desk.')
})

test('the transcript keeps five minutes, nothing older', async () => {
  let buffer = keep([], { at: T0, src: 'mic', text: 'old', sec: 2 })
  buffer = keep(buffer, { at: T0 + 6 * 60_000, src: 'loop', text: 'new', sec: 3 })
  expect(buffer.map(h => h.text)).toEqual(['new'])
})

test('overheard: weighed after a while of speech, at most two remarks an hour', async () => {
  const quiet = { newSec: 30, lastWeighedAt: -Infinity, remarks: [] }
  expect(shouldWeigh(quiet, T0, false)).toBe(false)
  expect(shouldWeigh({ ...quiet, newSec: 80 }, T0, false)).toBe(true)
  expect(shouldWeigh({ ...quiet, newSec: 10 }, T0, true)).toBe(true)
  expect(shouldWeigh({ ...quiet, newSec: 80, lastWeighedAt: T0 - 60_000 }, T0, false)).toBe(false)
  expect(shouldWeigh({ ...quiet, newSec: 80, remarks: [T0 - 10 * 60_000, T0 - 20 * 60_000] }, T0, true)).toBe(false)
  expect(remarkFrom('SILENCE')).toBeUndefined()
  expect(remarkFrom('◉ "The video said deadline twice."\n')).toBe('The video said deadline twice.')
})

test('the tally keeps seconds per day and input, never words', async () => {
  const a = tally(undefined, '2026-11-17', 'mic', 2.5)
  const b = tally(a, '2026-11-17', 'loop', 4)
  expect(b).toEqual({ '2026-11-17': { mic: 2.5, loop: 4 } })
})

test('visits: a crash leaves an open visit that ends as unknown; /clear is not a visit', async () => {
  let d = readDossier(undefined, T0)
  d = beginVisit(d, 'a', T0)
  d = beginVisit(d, 'b', T0 + 2 * 3_600_000)
  expect(d.visits).toBe(2)
  expect(d.previous?.ended).toBe('unknown')
  expect(Object.keys(d.open)).toEqual(['b'])
  d = endVisit(d, 'b', 'exit')
  expect(d.previous?.ended).toBe('exit')
  expect(d.open).toEqual({})
})

test('git status is read as counts, a branch and at most three names', async () => {
  const g = parseGit('## main...origin/main [ahead 2]\n M src/parser.ts\nM  README.md\n?? scratch.txt\n')
  expect(g).toEqual({ branch: 'main', changed: 2, untracked: 1, names: ['parser.ts', 'README.md'], ahead: 2 })
})

test('the fact block names only what was counted', async () => {
  let d = beginVisit(readDossier(undefined, T0), 'a', T0)
  d = { ...d, open: { a: { ...d.open.a!, reads: 4, commands: 2, failures: 1 } } }
  const facts = factBlock(d, {
    now: T0 + 40 * 60_000,
    offsetMinutes: 60,
    visit: d.open.a!,
    git: undefined,
    heardTodaySec: { mic: 0, loop: 0 },
    project: 'parser',
  })
  expect(facts[0]).toBe('Local time 22:40.')
  expect(facts[1]).toBe('Visit 1 to this machine; inside since 22:00 (40 minutes).')
  expect(facts[2]).toContain('4 reads, 0 edits, 2 commands, 1 failed tool calls')
})

test('the reception: full on the first visit of the day, a look after that or within the hour', async () => {
  const d = readDossier(undefined, T0)
  expect(receptionKind(d, T0, 60)).toBe('full')
  expect(receptionKind({ ...d, receptionDay: '2026-11-17' }, T0, 60)).toBe('look')
  // Ten minutes after midnight, back from a visit that ended at five to: only a look.
  const previous = { ...beginVisit(d, 'a', T0).open.a!, last: T0 + 2 * 3_600_000 + 55 * 60_000 }
  expect(receptionKind({ ...d, previous, receptionDay: '2026-11-17' }, T0 + 3 * 3_600_000 + 10 * 60_000, 60)).toBe('look')
})

test('initiative: the same test red three times, silence after an error, the late hour', async () => {
  const key = testKey('npm test -- parser')!
  expect(key).toBe('npm test -- parser')
  expect(testKey('ls -la')).toBeUndefined()
  let w = newWatch()
  for (let i = 0; i < 3; i++) {
    w = noteTest(w, key, true)
  }
  const red = initiative(w, T0, 15 * 60, '2026-11-17')
  expect(red?.why).toContain('failed 3 times in a row')
  w = { ...w, ...red!.mark }
  expect(initiative(w, T0, 15 * 60, '2026-11-17')).toBeUndefined()

  const silent = { ...newWatch(), lastErrorAt: T0, lastPromptAt: T0 - 1000 }
  expect(initiative(silent, T0 + 19 * 60_000, 15 * 60, '2026-11-17')).toBeUndefined()
  expect(initiative(silent, T0 + 21 * 60_000, 15 * 60, '2026-11-17')?.why).toContain('twenty minutes')

  const late = { ...newWatch(), lastActivityAt: T0 }
  expect(initiative(late, T0 + 60_000, 23 * 60 + 40, '2026-11-17')?.why).toContain('half past eleven')
  expect(initiative({ ...late, lateDay: '2026-11-17' }, T0 + 60_000, 23 * 60 + 40, '2026-11-17')).toBeUndefined()
})
