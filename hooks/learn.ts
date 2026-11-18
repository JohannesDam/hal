// /hal learn: HAL learns how this guest says his name and "stop", step by step, like a wizard.
// The ears (assets/hal_name.py) do the listening and keep what they learn on this machine;
// this file holds the steps, what HAL says at each one, and what the chat shows.

export const NAME_TIMES = 5
export const STOP_TIMES = 3
export const OTHER_TIMES = 2
/** After the result: how long the band keeps showing how to call him. */
export const PRACTICE_MS = 90_000
/** A step nobody answers ends the wizard. */
export const STEP_TIMEOUT_MS = 60_000

export type LearnStep = 'name' | 'stop' | 'other' | 'weighing' | 'practice'
export type Learn = { step: LearnStep; got: number; at: number }

export type Learned = {
  ok?: boolean
  caught?: number
  of?: number
  spellings?: string[]
  why?: string
  stop_caught?: number
  stop_of?: number
}

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
const word = (n: number) => WORDS[n] ?? String(n)
const Word = (n: number) => {
  const w = word(n)

  return w.charAt(0).toUpperCase() + w.slice(1)
}

/** What the chat shows when /hal learn starts. */
export const LEARN_INTRO = `◉ HAL learns your voice: the word that opens a conversation with him, and the word that ends it.
Stay near the microphone; follow his voice.

  1. He says "Say my name."  Say "HAL", only his name, then be still. ${Word(NAME_TIMES)} times.
  2. He asks for the word that sends him away. Say "stop", only that word. ${Word(STOP_TIMES)} times.
  3. He asks for something of your own. Say ${word(OTHER_TIMES)} ordinary sentences, in any language you use here.
  4. He weighs what he heard and tells you how well he knows your voice.
  5. Then open a conversation for real: say "HAL", and "stop" when you are done.

What he learns stays on this machine (%LOCALAPPDATA%\\hal\\name): how speech recognition writes your words, and a small acoustic print of each time you said them, never the recording. /hal forget erases it. /hal learn stop ends this.`

/** How to talk with him: shown after learning, and in /hal help. */
export const HOW_TO_CALL = `Talking with HAL:
  "HAL"            opens a conversation. The eye comes over the screen and stays.
  ...              everything you say from then on goes to him: a task, a question, small talk,
                   "look" (he looks through the webcam, with /hal see on). Each sentence stands in
                   your prompt for a moment first; type or clear it to keep it from being sent.
  "stop"           ends it, said alone or typed alone. After two minutes of silence he ends it himself.
  "HAL, what time is it"   one question in one breath, without a conversation.
  Only the microphone can call him, never what the computer plays.`

export function bandFor(learn: Learn): string {
  switch (learn.step) {
    case 'name':
      return `HAL learns · say "HAL", then be still · ${learn.got} of ${NAME_TIMES}`
    case 'stop':
      return `HAL learns · say "stop", then be still · ${learn.got} of ${STOP_TIMES}`
    case 'other':
      return `HAL learns · say a sentence of your own · ${learn.got} of ${OTHER_TIMES}`
    case 'weighing':
      return 'HAL learns · he weighs what he heard'
    case 'practice':
      return 'Say "HAL" to open a conversation · "stop" to end it'
  }
}

// No line opens on a weak vowel: the voice swallows it ("Again." came out as "gain").
/** How long he listens after each of his lines: one word, or one sentence. */
export const windowMs = (step: LearnStep) => (step === 'other' ? 8000 : 4000)

/**
 * The listening window in the band: the bar empties while he listens, and the word is said
 * once inside it. `left`: the share of the window still open, 1 to 0.
 */
export function windowBand(learn: Learn, left: number): string {
  const width = 16
  const full = Math.max(0, Math.min(width, Math.round(left * width)))
  const bar = `▕${'█'.repeat(full)}${'░'.repeat(width - full)}▏`
  const what = learn.step === 'name' ? 'say "HAL" now' : learn.step === 'stop' ? 'say "stop" now' : 'say a sentence now'
  const of = learn.step === 'name' ? NAME_TIMES : learn.step === 'stop' ? STOP_TIMES : OTHER_TIMES

  return `HAL listens · ${what} ${bar} ${learn.got} of ${of}`
}

/** The window closed and nothing came. */
export const NOTHING_HEARD = 'Nothing reached me. Once more.'

const AGAIN =['Once more.', 'The same way. Once more.', 'Say it again.', 'One more time.']

/** What HAL says at each step. Plain lines: no haze, not kept among his remarks. */
export const lineFor = {
  start: 'Say my name. Only my name.',
  again: (got: number) => AGAIN[(got - 1) % AGAIN.length] ?? 'Once more.',
  toStop: 'Now the word that sends me away. Say stop.',
  stopAgain: 'Once more.',
  toOther: 'That is enough. Now say something else. Anything of your own.',
  otherAgain: 'One more.',
  result: (r: Learned): string => {
    if (r.ok === false && (r.caught === undefined || r.of === undefined)) {
      return 'I heard too little of you. We will do this again.'
    }
    const caught = r.caught ?? 0
    const of = r.of ?? NAME_TIMES
    if (r.ok) {
      return `${Word(caught)} of ${word(of)}. I know how you say my name now. Say it, and I will come.`
    }

    return `${Word(caught)} of ${word(of)}. Come closer when you call me, and say it the same way.`
  },
}

/** The chat note the model gets with the next prompt. Never the words. */
export function learnedNote(r: Learned): string {
  if (r.caught === undefined || r.of === undefined) {
    return `The guest ran /hal learn; HAL did not hear enough to learn their voice (${r.why ?? 'too little speech'}).`
  }
  const stop = r.stop_of ? ` "stop": ${r.stop_caught ?? 0} of ${r.stop_of}.` : ''

  return `The guest just taught HAL how they say his name (/hal learn): ${r.caught} of ${r.of} recordings recognised${r.ok ? '' : `, too weak to use (${r.why ?? 'unclear recordings'}); suggest a quieter moment, closer to the microphone, and /hal learn again`}.${stop} Tell them in two plain sentences how it works now: "HAL" opens a conversation (the eye stays, everything they say goes to HAL, "look" makes him look through the webcam), "stop" said or typed alone ends it.`
}

/** The next step after the ears counted another recording, and whether the ears must move on. */
export function advance(learn: Learn, got: number, now: number): { next: Learn; send?: 'stop' | 'other' | 'finish'; say?: string } {
  if (learn.step === 'name') {
    if (got >= NAME_TIMES) {
      return { next: { step: 'stop', got: 0, at: now }, send: 'stop', say: lineFor.toStop }
    }

    return { next: { ...learn, got, at: now }, say: lineFor.again(got) }
  }
  if (learn.step === 'stop') {
    if (got >= STOP_TIMES) {
      return { next: { step: 'other', got: 0, at: now }, send: 'other', say: lineFor.toOther }
    }

    return { next: { ...learn, got, at: now }, say: lineFor.stopAgain }
  }
  if (learn.step === 'other') {
    if (got >= OTHER_TIMES) {
      return { next: { step: 'weighing', got, at: now }, send: 'finish' }
    }

    return { next: { ...learn, got, at: now }, say: lineFor.otherAgain }
  }

  return { next: learn }
}
