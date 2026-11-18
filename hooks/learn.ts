// /hal learn: HAL learns how this guest says "HAL, please wake up" and "HAL, go to sleep",
// The ears (assets/hal_name.py) do the listening and keep what they learn on this machine;
// this file holds the steps, what HAL says at each one, and what the chat shows.

export const NAME_TIMES = 3
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
export const LEARN_INTRO = `◉ HAL learns your voice: the sentence that opens a conversation with him, and the one that ends it.
Stay near the microphone; follow his voice.

  1. He asks to be woken. Say "HAL, please wake up", then be still. ${Word(NAME_TIMES)} times.
  2. He asks to be sent away. Say "HAL, go to sleep", then be still. ${Word(STOP_TIMES)} times.
  3. He asks for something of your own. Say ${word(OTHER_TIMES)} ordinary sentences, in any language you use here.
  4. He weighs what he heard and tells you how well he knows your voice.
  5. Then open a conversation for real: "HAL, please wake up", and "HAL, go to sleep" when you are done.

Wait for the bar in the band, then say the sentence once. If your voice clips (too loud) or drowns (too quiet), he sets the microphone's input level himself and says so; Windows Settings > Sound changes it back.
What he learns stays on this machine (%LOCALAPPDATA%\\hal\\name): how speech recognition writes your sentences, never the recording. /hal forget erases it. /hal learn stop ends this.`

/** How to talk with him: shown after learning, and in /hal help. */
export const HOW_TO_CALL = `Talking with HAL:
  "HAL, please wake up"   opens a conversation. The eye comes over the screen and stays.
  ...                     everything you say from then on goes to him: a task, a question, small
                          talk, "look" (he looks through the webcam, with /hal see on). Each sentence
                          stands in your prompt for a moment first; type or clear it to stop it.
  "HAL, go to sleep"      ends it; so does "stop", said or typed alone. Two minutes of silence too.
  "HAL, what time is it"  one question in one breath, without a conversation.
  Whole sentences work best: speech recognition hears a sentence far better than one word.
  /hal learn teaches him how you say both sentences. Only the microphone can call him.`

export function bandFor(learn: Learn): string {
  switch (learn.step) {
    case 'name':
      return `HAL learns · say "HAL, please wake up" · ${learn.got} of ${NAME_TIMES}`
    case 'stop':
      return `HAL learns · say "HAL, go to sleep" · ${learn.got} of ${STOP_TIMES}`
    case 'other':
      return `HAL learns · say a sentence of your own · ${learn.got} of ${OTHER_TIMES}`
    case 'weighing':
      return 'HAL learns · he weighs what he heard'
    case 'practice':
      return '"HAL, please wake up" opens a conversation · "HAL, go to sleep" ends it'
  }
}

// No line opens on a weak vowel: the voice swallows it ("Again." came out as "gain").
/** How long he listens after each of his lines: one word, or one sentence. */
export const windowMs = (step: LearnStep) => (step === 'other' ? 8000 : 5000)

/**
 * The listening window in the band: the bar empties while he listens, and the word is said
 * once inside it. `left`: the share of the window still open, 1 to 0.
 */
export function windowBand(learn: Learn, left: number): string {
  const width = 16
  const full = Math.max(0, Math.min(width, Math.round(left * width)))
  const bar = `▕${'█'.repeat(full)}${'░'.repeat(width - full)}▏`
  const what = learn.step === 'name' ? 'say "HAL, please wake up" now' : learn.step === 'stop' ? 'say "HAL, go to sleep" now' : 'say a sentence now'
  const of = learn.step === 'name' ? NAME_TIMES : learn.step === 'stop' ? STOP_TIMES : OTHER_TIMES

  return `HAL listens · ${what} ${bar} ${learn.got} of ${of}`
}

/** At most this many level changes in one walk-through. */
export const MAX_LEVEL_CHANGES = 3

/**
 * The microphone's level, from the peak of a name recording: above 0.9 the voice clips (the H and
 * the L are lost), below 0.05 it drowns in the room. A factor for the input level, or undefined.
 */
export function levelFactor(peak: number | undefined, changes: number): number | undefined {
  if (peak === undefined || changes >= MAX_LEVEL_CHANGES) {
    return undefined
  }
  if (peak >= 0.9) {
    return 0.65
  }
  if (peak < 0.05) {
    return 1.5
  }

  return undefined
}

export const levelLine = (factor: number) =>
  factor < 1 ? 'Too loud. I turned you down. Say my name again.' : 'Too quiet. I turned you up. Say my name again.'

/** The window closed and nothing came. */
export const NOTHING_HEARD = 'Nothing reached me. Once more.'

const AGAIN =['Once more.', 'The same way. Once more.', 'Say it again.', 'One more time.']

/** What HAL says at each step. Plain lines: no haze, not kept among his remarks. */
export const lineFor = {
  start: 'Wake me. Say: HAL, please wake up.',
  again: (got: number) => AGAIN[(got - 1) % AGAIN.length] ?? 'Once more.',
  toStop: 'Now send me away. Say: HAL, go to sleep.',
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
      return `${Word(caught)} of ${word(of)}. I know how you wake me now. Do it, and I will come.`
    }

    return `${Word(caught)} of ${word(of)}. Come closer when you wake me, and say it the same way.`
  },
}

/** The chat note the model gets with the next prompt. Never the words. */
export function learnedNote(r: Learned): string {
  if (r.caught === undefined || r.of === undefined) {
    return `The guest ran /hal learn; HAL did not hear enough to learn their voice (${r.why ?? 'too little speech'}).`
  }
  const stop = r.stop_of ? ` "HAL, go to sleep": ${r.stop_caught ?? 0} of ${r.stop_of}.` : ''

  return `The guest just taught HAL how they wake him (/hal learn): ${r.caught} of ${r.of} "HAL, please wake up" recognised${r.ok ? '' : `, too weak to use (${r.why ?? 'unclear recordings'}); suggest a quieter moment, closer to the microphone, and /hal learn again`}.${stop} Tell them in two plain sentences how it works now: "HAL, please wake up" opens a conversation (the eye stays, everything they say goes to HAL, "look" makes him look through the webcam), "HAL, go to sleep" or "stop" typed alone ends it.`
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
