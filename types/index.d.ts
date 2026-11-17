export type HalTalk = 'often' | 'sometimes' | 'rarely' | 'never'
export type HalLevel = 1 | 2 | 3
export type HalSettings = {
  isOn: boolean
  /** How far HAL's mood may rise; it moves by itself between 1 and this. */
  ceiling: HalLevel
  talk: HalTalk
  haze: boolean
  /** The side pane with the large eye; the band above the prompt is always there. */
  pane: boolean
  name: string
  /** HAL listens along: the microphone and what the computer plays. */
  listen: boolean
  /** Part of the microphone's name; empty picks one (a built-in microphone first). */
  mic: string
}
export type HalMood = 'idle' | 'working' | 'speaking'

declare module 'claude-code' {
  interface PluginState {
    hal: {
      settings: Shaped<HalSettings>
      mood: HalMood
      level: HalLevel
      line: string
      /** The ears as the host reports them: off, listening, deaf (a call), not set up. */
      ears: string
      /** What HAL heard you say to him, shown in the band before it is sent. */
      said: string
      /** The session id of the visit in progress: a reload is not a new visit. */
      visit: string
      /** Counts up when a spoken line may be shown in the chat. */
      reveal: number
    }
  }
}
