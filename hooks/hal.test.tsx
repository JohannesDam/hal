import { expect, mock, test } from 'claude-code/testing'

// Nothing sits beneath the plugin: each hook here stands for the engine.
// `sent` collects what the mod writes into HAL's inbox.
// `voice.isDone`: the stand-in process reports each line as said (`done`) once it is true.
function engine(
  on: any,
  sent: Record<string, unknown>[],
  model: string[] = [],
  stored: Record<string, unknown> = {},
  voice = { isDone: false },
  // The stand-in ears: lines the process writes in answer to a message from the mod.
  react?: (m: Record<string, unknown>) => string[],
) {
  mock.store(on, stored)
  on('session.id', () => ({ value: 's1' }))
  // The model writes HAL's own lines (reception, waking, initiative): one answer per call, then silence.
  on('model.complete', () => ({ value: { isAnswered: true, text: model.shift() ?? 'SILENCE', usage: { input_tokens: 1, output_tokens: 1 } } }))
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
    // The stand-in webcam: one face, close, warm lamp light.
    if (String(argv[3] ?? '').endsWith('hal-sight.py')) {
      return { value: { exitCode: 0, stdout: '{"t":"seen","faces":1,"near":0.32,"side":"left","light":0.2,"warm":0.6,"backlit":false,"camera":0}\n', stderr: '' } }
    }
    const stdout =
      argv[0] === 'git' && argv[1] === 'status' ? '## main...origin/main\n M src/parser.ts\n?? notes.txt\n' : argv[0] === 'git' ? 'Sam Tester\n' : '60\n'

    return { value: { exitCode: 0, stdout, stderr: '' } }
  })
  // The stand-in process stays up until the mod asks it to quit, as the real one does.
  on('process.spawn', async function* () {
    yield { stream: 'stdout', text: '{"t":"ready","pid":1,"voice":"Microsoft George"}\n' }
    const answered = new Set<unknown>()
    const reacted = new Set<unknown>()
    for (let i = 0; i < 100 && !sent.some(m => m.kind === 'quit'); i++) {
      for (const m of sent) {
        if (react && !reacted.has(m)) {
          reacted.add(m)
          for (const line of react(m)) {
            yield { stream: 'stdout', text: `${line}\n` }
          }
        }
        if (voice.isDone && m.kind === 'say' && !answered.has(m.id)) {
          answered.add(m.id)
          yield { stream: 'stdout', text: `{"t":"done","id":"${String(m.id)}"}\n` }
        }
      }
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

test('/hal learn: he leads the way by voice, the ears count, and he answers his name after', async ($: any, on: any) => {
  const sent: Record<string, unknown>[] = []
  const ears = (m: Record<string, unknown>): string[] => {
    if (m.kind !== 'learn') {
      return []
    }
    switch (m.step) {
      case 'name':
        return [1, 2, 3, 4, 5].map(got => `{"t":"learn","step":"name","got":${got}}`)
      case 'stop':
        return [1, 2, 3].map(got => `{"t":"learn","step":"stop","got":${got}}`)
      case 'other':
        return [1, 2].map(got => `{"t":"learn","step":"other","got":${got}}`)
      case 'finish':
        return [
          '{"t":"learned","ok":true,"caught":5,"of":5,"spellings":["hell"]}',
          // Afterwards the guest says only his name.
          '{"t":"heard","src":"mic","name":true,"text":"","lang":"en","sec":0.6}',
        ]
      default:
        return []
    }
  }
  engine(on, sent, [], {}, { isDone: true }, ears)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: false })
  await $.command.run({ command: 'hal', args: 'on' })
  await $.command.run({ command: 'hal', args: 'listen' })
  const intro = await $.command.run({ command: 'hal', args: 'learn' })
  expect(String(intro.text)).toContain('HAL learns your voice')
  for (let i = 0; i < 40 && !sent.some(m => m.kind === 'presence' && m.on === true); i++) {
    await settle()
  }

  expect(sent.filter(m => m.kind === 'learn').map(m => m.step)).toEqual(['name', 'stop', 'other', 'finish'])
  const lines = said(sent)
  expect(lines).toContain('Say my name. Only my name.')
  expect(lines).toContain('Now the word that sends me away. Say stop.')
  expect(lines).toContain('Enough. Now say something else. Anything of your own.')
  expect(lines).toContain('Five of five. I know how you say my name now. Say it, and I will come.')
  // His name alone, after learning: a conversation opens, the eye comes with his first words.
  const open = sent.find(m => m.kind === 'presence' && m.on === true)
  expect(typeof open?.text === 'string' && String(open?.text).length > 0).toBe(true)
  // The model hears what happened with the next prompt, never the words; the conversation is open.
  const next = await $.prompt.submit({ text: 'and now?' })
  const context = (next.context ?? []).join('\n')
  expect(context).toContain('5 of 5 recordings recognised')
  expect(context).toContain('A conversation with HAL is open')
  // "stop" typed alone: nothing reaches the model, he says goodbye, the eye goes.
  const stopped = await $.prompt.submit({ text: 'stop' })
  expect(stopped.drop).toBe('◉ The conversation is over.')
  expect(sent.some(m => m.kind === 'presence' && m.on === false)).toBe(true)
  const after = await $.prompt.submit({ text: 'and after?' })
  expect((after.context ?? []).join('\n')).not.toContain('A conversation with HAL is open')

  const help = await $.command.run({ command: 'hal', args: 'help' })
  expect(String(help.text)).toContain('Talking with HAL')
})

test('/hal see: off by default; on, one look becomes plain facts, never a picture', async ($: any, on: any) => {
  const sent: Record<string, unknown>[] = []
  engine(on, sent)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: false })
  await $.command.run({ command: 'hal', args: 'on' })
  await settle()
  const before = await $.prompt.submit({ text: 'first' })
  expect((before.context ?? []).join('\n')).not.toContain('Webcam')

  const on1 = await $.command.run({ command: 'hal', args: 'see on' })
  expect(String(on1.text)).toContain('The camera light shows each time')
  expect(String(on1.text)).toContain('one face, very close to the screen, to the left of the screen; dim warm lamp light')
  const after = await $.prompt.submit({ text: 'second' })
  expect((after.context ?? []).join('\n')).toContain('Webcam, one look at')

  await $.command.run({ command: 'hal', args: 'see off' })
  const off = await $.prompt.submit({ text: 'third' })
  expect((off.context ?? []).join('\n')).not.toContain('Webcam, one look at')
})

test('the character is sent whole, then as a note, and whole again after /clear', async ($: any, on: any) => {
  engine(on, [])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'hal', args: 'on' })

  const first = await $.prompt.submit({ text: 'hello' })
  const firstContext = (first.context ?? []).join('\n')
  expect(firstContext).toContain('HAL is ON. Mood now: level')
  // The fact block rides along: true counts from the hooks, git read only.
  expect(firstContext).toContain("HAL's notes (true counts from the hooks")
  expect(firstContext).toContain('git: branch main; 1 changed files uncommitted (parser.ts); 1 untracked.')

  await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} })
  const afterClear = await $.prompt.submit({ text: 'again' })
  const clearContext = (afterClear.context ?? []).join('\n')
  expect(clearContext).toContain('# Character mode: HAL')
  expect(clearContext).toContain('Level 3, ominous: everything of levels 1 and 2')
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

test('waking him and a real error get the full haze; an error comes after a long stare', async ($: any, on: any) => {
  const sent: Record<string, unknown>[] = []
  engine(on, sent, ['Your parser has one changed file. I saw it first.'])
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
  engine(on, sent, ['Awake. One file changed in your folder.'])
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
    // a job of more than five minutes is a real moment
    await $.turn.complete({ answer: `Done.\n\n◉ ${text}`, reason: 'answer', durationMs: 360_000, isAborted: false, turnId: `long-${i}` })
    await settle()
  }
  const hazes = sent.filter(m => m.kind === 'say' && m.haze === true)
  expect(hazes.length).toBe(4) // waking him, then three of the six long jobs
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

test('the first visit of the day is received in full; a second visit that day only gets a look', async ($: any, on: any) => {
  const sent: Record<string, unknown>[] = []
  const settings = { isOn: true, ceiling: 3, talk: 'sometimes', haze: true, pane: false, name: 'Sam', listen: false, mic: '' }
  engine(on, sent, ['Three days. Your parser changes are still uncommitted.'], { settings })
  await $.session.start({ cwd: '/work/parser', surface: 'terminal', isInteractive: true })
  await settle()
  await settle()
  const reception = sent.find(m => m.kind === 'say')
  expect(reception?.text).toBe('Three days. Your parser changes are still uncommitted.')
  expect(reception?.haze).toBe(true)
  const notes = await $.command.run({ command: 'hal', args: 'dossier' })
  expect(notes.text).toContain('Visit 1 to this machine')
})

test('a visit already received today gets only a look', async ($: any, on: any) => {
  const sent: Record<string, unknown>[] = []
  const settings = { isOn: true, ceiling: 3, talk: 'sometimes', haze: true, pane: false, name: 'Sam', listen: false, mic: '' }
  const dossier = { visits: 4, firstSeen: 0, open: {}, hazeOff: 0, halOff: 0, offsSinceReception: [], receptionDay: '2026-11-17' }
  engine(on, sent, ['This line must not be asked for.'], { settings, dossier })
  await $.session.start({ cwd: '/work/parser', surface: 'terminal', isInteractive: true })
  await settle()
  await settle()
  expect(said(sent)).toEqual([])
})

test('/hal dossier reads the notes; /hal off is counted and named at the next reception', async ($: any, on: any) => {
  const sent: Record<string, unknown>[] = []
  engine(on, sent)
  on('tool.call', () => ({ result: { stdout: '' }, isError: false }))
  await $.session.start({ cwd: '/work/parser', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'hal', args: 'on' })
  await $.tool.call({ tool: 'Read', file_path: 'a.ts' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  const notes = await $.command.run({ command: 'hal', args: 'dossier' })
  expect(notes.text).toContain('My notes.')
  expect(notes.text).toContain('This visit: 1 reads, 0 edits, 1 commands, 0 failed tool calls')
  await $.command.run({ command: 'hal', args: 'off' })
  const after = await $.command.run({ command: 'hal', args: 'dossier' })
  expect(after.text).toContain('HAL switched off 1 times')
})

test('Esc travels with the next prompt, once', async ($: any, on: any) => {
  engine(on, [])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'hal', args: 'on' })
  await $.turn.complete({ answer: '', reason: 'aborted', durationMs: 1, isAborted: true, turnId: 't1' })
  const next = await $.prompt.submit({ text: 'go on' })
  expect((next.context ?? []).join('\n')).toContain('The guest pressed Esc and cut')
  const later = await $.prompt.submit({ text: 'and then' })
  expect((later.context ?? []).join('\n')).not.toContain('The guest pressed Esc')
})

test('the spoken line waits in the chat as "◉ ···" until the voice has said it', async ($: any, on: any) => {
  const sent: Record<string, unknown>[] = []
  const voice = { isDone: false }
  engine(on, sent, [], {}, voice)
  // The engine's own drawing of a reply: its text, as given.
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)

    return <Text>{e.props.text}</Text>
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'hal', args: 'on' })
  await settle()
  const answer = 'The parser is green.\n\n◉ Your parser is green now. It was red all evening.'
  await $.turn.complete({ answer, reason: 'answer', durationMs: 1, isAborted: false, turnId: 't1' })
  const reply = { plugin: 'hal', component: 'AssistantMessage', requestId: 'r1', surface: 'terminal', props: { text: answer, isFirstOfReply: true } }

  const before = await $.ui.mount(reply)
  expect((await before.find({ type: 'Text' }))?.text).toBe('The parser is green.\n\n◉ ···')
  await before.unmount()

  voice.isDone = true
  await settle()
  await settle()
  const after = await $.ui.mount(reply)
  expect((await after.find({ type: 'Text' }))?.text).toBe(answer)
  await after.unmount()
})
