import { expect, mock, test } from 'claude-code/testing'

// Nothing sits beneath the plugin: each hook here stands for the engine.
// `sent` collects what the mod writes into HAL's inbox.
function engine(on: any, sent: Record<string, unknown>[]) {
  mock.store(on)
  mock.clock(on, { now: Date.UTC(2026, 10, 17, 13, 0) })
  mock.env(on, { SystemRoot: 'C:\\Windows', LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' })
  on('command.register', () => ({ value: { command: 'hal' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('session.end', (_: unknown, e: any) => ({ sessionId: e.sessionId }))
  on('prompt.submit', (_: unknown, e: any) => ({ text: e.text, context: e.context }))
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
  on('process.run', (_: unknown, e: any) => {
    const argv: string[] = e.argv
    const stdout = argv[0] === 'git' ? 'Sam Tester\n' : '60\n'

    return { value: { exitCode: 0, stdout, stderr: '' } }
  })
  // The stand-in process stays up until the mod asks it to quit, as the real one does.
  on('process.spawn', async function* () {
    yield { stream: 'stdout', text: '{"t":"ready","pid":1,"voice":"Microsoft George"}\n' }
    for (let i = 0; i < 100 && !sent.some(m => m.kind === 'quit'); i++) {
      await settle()
    }

    return { value: { code: 0, signal: null } }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('fs.write', (_: unknown, e: any) => {
    sent.push(JSON.parse(e.text))

    return { value: undefined }
  })
}

// Lets unawaited work finish; the test kit's environment has timers, its types don't.
const settle = () => new Promise(resolve => (globalThis as any).setTimeout(resolve, 50))
const said = (sent: Record<string, unknown>[]) => sent.filter(m => m.kind === 'say').map(m => m.text)

test('the character is sent whole, then as a note, and whole again after /clear', async ($: any, on: any) => {
  engine(on, [])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'hal', args: 'on' })

  const first = await $.prompt.submit({ text: 'hello' })
  expect(first.context?.at(-1)).toContain('HAL is ON. Mood now: level')

  await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} })
  const afterClear = await $.prompt.submit({ text: 'again' })
  expect(afterClear.context?.at(-1)).toContain('# Character mode: HAL')
  expect(afterClear.context?.at(-1)).toContain('Level 3, ominous: everything of levels 1 and 2')
})

test('a clean last line goes to HAL; a sweet one keeps him silent', async ($: any, on: any) => {
  const sent: Record<string, unknown>[] = []
  engine(on, sent)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'hal', args: 'on' })
  await settle()
  sent.length = 0

  await $.turn.complete({ answer: 'Done.\n\n◉ Well done, the tests are green!', reason: 'answer', durationMs: 1, isAborted: false, turnId: 't1' })
  await settle()
  expect(said(sent)).toEqual([])

  await $.turn.complete({ answer: 'Done.\n\n◉ Your parser.ts is green now. It was red all evening.', reason: 'answer', durationMs: 1, isAborted: false, turnId: 't2' })
  await settle()
  expect(said(sent)).toEqual(['Your parser is green now. It was red all evening.'])
  // An ordinary line: the voice without the haze, and only a short pause.
  const say = sent.find(m => m.kind === 'say')
  expect(say?.haze).toBe(false)
  expect(say?.pauseMs).toBe(300)
  expect(typeof say?.at).toBe('number')
})

test('the reception and a real error get the full haze; an error comes after a long stare', async ($: any, on: any) => {
  const sent: Record<string, unknown>[] = []
  engine(on, sent)
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  on('tool.call', () => ({ result: { stdout: '', stderr: 'failed', interrupted: false }, isError: true }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'hal', args: 'on' })
  await settle()
  expect(sent.find(m => m.kind === 'say')?.haze).toBe(true)
  sent.length = 0

  await $.turn.start({ text: 'run it', turnId: 't3' })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.turn.complete({ answer: 'It failed.\n\n◉ The second test failed again. Same line as before.', reason: 'answer', durationMs: 1, isAborted: false, turnId: 't3' })
  await settle()
  const say = sent.find(m => m.kind === 'say')
  expect(say?.haze).toBe(true)
  expect(Number(say?.pauseMs)).toBeGreaterThanOrEqual(2000)
})

test('at most four full hazes an hour', async ($: any, on: any) => {
  const sent: Record<string, unknown>[] = []
  engine(on, sent)
  on('turn.start', (_: unknown, e: any) => ({ turnId: e.turnId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'hal', args: 'on' })
  await settle()
  // Six different lines (the style filter drops repeated openings).
  const lines = [
    'Three minutes for a build that used to take one.',
    'The migration finished. One table took longer than the others.',
    'Your tests ran twice. I counted both.',
    'Seven files changed in that job.',
    'Nothing failed. It only took its time.',
    'Long jobs leave long silences.',
  ]
  for (const [i, text] of lines.entries()) {
    // a job of more than two minutes is a real moment
    await $.turn.complete({ answer: `Done.\n\n◉ ${text}`, reason: 'answer', durationMs: 180_000, isAborted: false, turnId: `long-${i}` })
    await settle()
  }
  const hazes = sent.filter(m => m.kind === 'say' && m.haze === true)
  expect(hazes.length).toBe(4) // the reception, then three of the six long jobs
})

test('/hal off asks the process to quit', async ($: any, on: any) => {
  const sent: Record<string, unknown>[] = []
  engine(on, sent)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'hal', args: 'on' })
  await settle()
  await $.command.run({ command: 'hal', args: 'off' })
  await settle()
  expect(sent.some(m => m.kind === 'quit')).toBe(true)
})
