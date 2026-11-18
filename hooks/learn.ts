// /hal learn: HAL learns how this guest says his name, step by step, like a wizard.
// The ears (assets/hal_name.py) do the listening and keep what they learn on this machine;
// this file holds the steps, what HAL says at each one, and what the chat shows.

export const NAME_TIMES = 5
export const OTHER_TIMES = 2
/** After the result: how long the band keeps showing how to call him. */
export const PRACTICE_MS = 90_000
/** A step nobody answers ends the wizard. */
export const STEP_TIMEOUT_MS = 60_000

export type LearnStep = 'name' | 'other' | 'weighing' | 'practice'
export type Learn = { step: LearnStep; got: number; at: number }

export type Learned = {
  ok?: boolean
  caught?: number
  of?: number
  spellings?: string[]
  why?: string
}

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
const word = (n: number) => WORDS[n] ?? String(n)
const Word = (n: number) => {
  const w = word(n)

  return w.charAt(0).toUpperCase() + w.slice(1)
}

/** What the chat shows when /hal learn starts. */
export const LEARN_INTRO = `◉ HAL learns how you say his name. Stay near the microphone; follow his voice.

  1. He says "Say my name."  Say "HAL", only his name, then be still. He answers. ${Word(NAME_TIMES)} times.
  2. He asks for something of your own. Say ${word(OTHER_TIMES)} ordinary sentences, in any language you use here.
  3. He weighs what he heard and tells you how well he knows your voice.
  4. Then call him for real:  "HAL" ... wait for his answer ... say what you want.

What he learns stays on this machine (%LOCALAPPDATA%\\hal\\name): how speech recognition writes your "HAL", and a small acoustic print of each time you said it, never the recording. /hal forget erases it. /hal learn stop ends this.`

/** How to call him: shown after learning, and in /hal help. */
export const HOW_TO_CALL = `How to call HAL:
  "HAL" ... wait for his answer ... "what time is it"     the sure way
  "HAL, what time is it"                                   in one breath
  After his answer he listens ten seconds for what you want. It appears in your prompt and is
  sent after 1.5 s; type or clear the prompt to stop it. Only the microphone can call him,
  never what the computer plays.`

export function bandFor(learn: Learn): string {
  switch (learn.step) {
    case 'name':
      return `HAL learns · say "HAL", then be still · ${learn.got} of ${NAME_TIMES}`
    case 'other':
      return `HAL learns · say a sentence of your own · ${learn.got} of ${OTHER_TIMES}`
    case 'weighing':
      return 'HAL learns · he weighs what he heard'
    case 'practice':
      return 'Call him: "HAL" · wait for his answer · then say what you want'
  }
}

const AGAIN = ['Again.', 'Once more.', 'Again. The same way.', 'One more time.']

/** What HAL says at each step. Plain lines: no haze, not kept among his remarks. */
export const lineFor = {
  start: 'Say my name. Only my name.',
  again: (got: number) => AGAIN[(got - 1) % AGAIN.length] ?? 'Again.',
  toOther: 'Enough of my name. Now say something else. Anything of your own.',
  otherAgain: 'Another one.',
  result: (r: Learned): string => {
    if (r.ok === false && (r.caught === undefined || r.of === undefined)) {
      return 'I heard too little of you. We will do this again.'
    }
    const caught = r.caught ?? 0
    const of = r.of ?? NAME_TIMES
    if (r.ok) {
      return `${Word(caught)} of ${word(of)}. I know how you say my name now. Call me.`
    }

    return `${Word(caught)} of ${word(of)}. Come closer when you call me, and say it the same way.`
  },
}

/** The chat note the model gets with the next prompt, and /hal check's line. Never the words. */
export function learnedNote(r: Learned): string {
  if (r.caught === undefined || r.of === undefined) {
    return `The guest ran /hal learn; HAL did not hear enough to learn their voice (${r.why ?? 'too little speech'}).`
  }

  return `The guest just taught HAL how they say his name (/hal learn): ${r.caught} of ${r.of} recordings recognised${r.ok ? '' : `, too weak to use (${r.why ?? 'unclear recordings'}); suggest a quieter moment, closer to the microphone, and /hal learn again`}. Tell them in one or two plain sentences how to call him: "HAL", wait for his answer, then speak; or "HAL, ..." in one breath.`
}

/** The next step after the ears counted another recording, and whether the ears must move on. */
export function advance(learn: Learn, got: number, now: number): { next: Learn; send?: 'other' | 'finish'; say?: string } {
  if (learn.step === 'name') {
    if (got >= NAME_TIMES) {
      return { next: { step: 'other', got: 0, at: now }, send: 'other', say: lineFor.toOther }
    }

    return { next: { ...learn, got, at: now }, say: lineFor.again(got) }
  }
  if (learn.step === 'other') {
    if (got >= OTHER_TIMES) {
      return { next: { step: 'weighing', got, at: now }, send: 'finish' }
    }

    return { next: { ...learn, got, at: now }, say: lineFor.otherAgain }
  }

  return { next: learn }
}
