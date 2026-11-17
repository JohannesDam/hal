import { expect, test } from 'claude-code/testing'

import { beginVisit, endVisit, factBlock, parseGit, readDossier, receptionKind } from './dossier'
import { addressed, keep, remarkFrom, shouldWeigh, tally } from './ears'
import { initiative, newWatch, noteTest, testKey } from './moments'

const T0 = Date.UTC(2026, 10, 17, 21, 0)

test('a sentence that starts with his name is a command; the rest is not', async () => {
  expect(addressed('HAL, run the tests again.')).toBe('Run the tests again.')
  expect(addressed('Hal draai de tests nog een keer')).toBe('Draai de tests nog een keer')
  expect(addressed('Hey HAL, what time is it?')).toBe('What time is it?')
  expect(addressed('Hall, commit the voice.')).toBe('Commit the voice.')
  expect(addressed('Al, commit it.')).toBe('Commit it.')
  expect(addressed('HAL.')).toBe('')
  // Ordinary sentences, also the Dutch "al" and "haal".
  expect(addressed('Al gedaan, dank je.')).toBeUndefined()
  expect(addressed('Haal de laatste versie op.')).toBeUndefined()
  expect(addressed('I think HAL is listening.')).toBeUndefined()
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

test('the reception: full on the first visit of the day, a look after that', async () => {
  const d = readDossier(undefined, T0)
  expect(receptionKind(d, T0, 60)).toBe('full')
  expect(receptionKind({ ...d, receptionDay: '2026-11-17' }, T0, 60)).toBe('look')
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
