import { describe, it, expect } from 'vitest'
import { resolveKey, KEY_CODES } from '../src/keys.js'

describe('resolveKey', () => {
  it('maps common named keys to correct keycodes', () => {
    expect(resolveKey('home')).toBe(3)
    expect(resolveKey('back')).toBe(4)
    expect(resolveKey('app_switch')).toBe(187)
    expect(resolveKey('power')).toBe(26)
    expect(resolveKey('enter')).toBe(66)
    expect(resolveKey('volume_up')).toBe(24)
    expect(resolveKey('volume_down')).toBe(25)
    expect(resolveKey('menu')).toBe(82)
    expect(resolveKey('search')).toBe(84)
    expect(resolveKey('camera')).toBe(27)
    expect(resolveKey('escape')).toBe(111)
    expect(resolveKey('delete')).toBe(112)
    expect(resolveKey('tab')).toBe(61)
    expect(resolveKey('space')).toBe(62)
    expect(resolveKey('backspace')).toBe(67)
    expect(resolveKey('dpad_up')).toBe(19)
    expect(resolveKey('dpad_down')).toBe(20)
    expect(resolveKey('dpad_left')).toBe(21)
    expect(resolveKey('dpad_right')).toBe(22)
    expect(resolveKey('dpad_center')).toBe(23)
  })

  it('is case-insensitive for named keys', () => {
    expect(resolveKey('HOME')).toBe(3)
    expect(resolveKey('Back')).toBe(4)
    expect(resolveKey('APP_SWITCH')).toBe(187)
    expect(resolveKey('Power')).toBe(26)
  })

  it('passes through a raw integer keycode as a number', () => {
    expect(resolveKey(3)).toBe(3)
    expect(resolveKey(187)).toBe(187)
    expect(resolveKey(0)).toBe(0)
    expect(resolveKey(999)).toBe(999)
  })

  it('passes through a string that is a pure integer as a keycode', () => {
    expect(resolveKey('3')).toBe(3)
    expect(resolveKey('187')).toBe(187)
    expect(resolveKey('0')).toBe(0)
  })

  it('throws for unknown named keys', () => {
    expect(() => resolveKey('foo')).toThrow('unknown key name "foo"')
    expect(() => resolveKey('home_button')).toThrow('unknown key name')
  })

  it('throws for fractional keycodes', () => {
    expect(() => resolveKey(3.5)).toThrow('must be an integer')
  })

  it('does not confuse numeric strings with named keys', () => {
    expect(resolveKey('82')).toBe(82)
  })

  it('volume_mute and mute are distinct keys', () => {
    expect(resolveKey('volume_mute')).toBe(164)
    expect(resolveKey('mute')).toBe(91)
  })

  it('backspace and del both map to keycode 67', () => {
    expect(resolveKey('backspace')).toBe(67)
    expect(resolveKey('del')).toBe(67)
  })

  it('delete and forward_del both map to keycode 112', () => {
    expect(resolveKey('delete')).toBe(112)
    expect(resolveKey('forward_del')).toBe(112)
  })

  it('the KEY_CODES table is non-empty', () => {
    expect(Object.keys(KEY_CODES).length).toBeGreaterThan(50)
  })
})
