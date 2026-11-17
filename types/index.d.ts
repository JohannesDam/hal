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
}
export type HalMood = 'idle' | 'working' | 'speaking'

declare module 'claude-code' {
  interface PluginState {
    hal: {
      settings: Shaped<HalSettings>
      mood: HalMood
      level: HalLevel
      line: string
    }
  }
}
