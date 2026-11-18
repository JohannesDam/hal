// A conversation with HAL: "HAL" opens it, "stop" (said or typed alone) ends it. In between the
// eye stays over the screen and everything the guest says from the microphone goes to him.
// Pure functions; the mod wires them.

/** Two minutes without a word from the guest, while HAL is not working: he ends it himself. */
export const IDLE_END_MS = 2 * 60_000
/** A spoken sentence stands in the prompt this long before it is sent; a change stops it. */
export const SEND_DELAY_MS = 1000

const words = (text: string) => text.match(/[\p{L}']+/gu) ?? []

/**
 * "HAL, please wake up": a whole sentence, so speech recognition has something to hold on to,
 * however it writes the name ("Hell, wake up."). Short utterances only: "I need to wake up
 * earlier tomorrow, I think" is not addressed to him.
 */
export const isWakePhrase = (text: string) => words(text).length <= 6 && /\bwake\s*up\b|\bwakker\b/i.test(text)

/** "HAL, go to sleep": the conversation ends, as "stop" ends it. Short utterances only. */
export const isSleepPhrase = (text: string) => words(text).length <= 6 && /\bgo to sleep\b|\bsleep now\b|\bga slapen\b/i.test(text)

/** "stop" typed alone (any case, an optional full stop): the conversation ends, nothing is sent. */
export const isTypedStop = (text: string) => /^\s*(stop|stopp|stoppen)\s*[.!]?\s*$/i.test(text)

/** "look", "kijk", "look at me": he takes one look through the webcam before he answers. */
export const isLook = (text: string) => /^\s*(look|kijk|peek)\b|\blook at me\b|\bkijk (eens )?naar mij\b/i.test(text)

/**
 * How dark the haze is: it settles in slowly while the conversation lasts, from 0.45 to 0.62
 * after three minutes. Flash-safe: it moves a few hundredths at a time.
 */
export function presenceStrength(sinceMs: number): number {
  const k = Math.min(1, Math.max(0, sinceMs / (3 * 60_000)))

  return Math.round((0.45 + 0.17 * k) * 100) / 100
}

const CLOSINGS: Record<1 | 2 | 3, readonly string[]> = {
  1: ['Then I go.', 'As you say.'],
  2: ['I will be here.', 'Then I go. Not far.'],
  3: ['...Very well.', 'I go. The machine stays mine.'],
}

/** What he says when the guest ends it: short, never the same as the last time. */
export function closing(level: 1 | 2 | 3, last: string | undefined, pick: number): string {
  const lines = CLOSINGS[level].filter(line => line !== last)

  return lines[Math.floor(pick * lines.length) % lines.length] ?? 'Then I go.'
}

/** When he ends it himself, after the silence. */
export const IDLE_CLOSING = 'You stopped talking. I will go.'

/** The context every prompt carries while a conversation runs. */
export function conversationNote(isSpoken: boolean, isLookRequest: boolean, canSee: boolean): string {
  const parts = [
    'A conversation with HAL is open: the guest opened it by saying his name, the eye stays over the screen, and everything they say through the microphone comes to you. "stop" ends it.',
    'Whatever the guest asks, a task or small talk, do it exactly as without the character. Keep the chat answer short unless the work needs more.',
    'In this conversation EVERY reply ends with a spoken line ("◉ ..."), not one in five: it is how HAL answers aloud. Make it the answer itself, at most 18 words, calm and a little too attentive. Silences are allowed; reassurance is not.',
  ]
  if (isSpoken) {
    parts.push('This prompt was spoken; a word may be misheard.')
  }
  if (isLookRequest) {
    parts.push(
      canSee
        ? 'The guest asked HAL to look: he just took one look through the webcam. Its facts are in his notes; name one or two of them, exactly as they stand, nothing more.'
        : 'The guest asked HAL to look, but seeing is off (/hal see on). He has no eye in the room; say so in a few words.',
    )
  }

  return parts.join(' ')
}
