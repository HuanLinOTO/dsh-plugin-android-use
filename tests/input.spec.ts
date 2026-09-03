import { describe, it, expect } from 'vitest'
import { escapeInputText, encodeAdbKeyboard } from '../src/tools/input.js'

describe('escapeInputText', () => {
  it('converts spaces to %s', () => {
    expect(escapeInputText('hello world')).toBe('hello%sworld')
    expect(escapeInputText('a b c')).toBe('a%sb%sc')
  })

  it('escapes ampersand', () => {
    expect(escapeInputText('a&b')).toBe('a\\&b')
  })

  it('escapes angle brackets', () => {
    expect(escapeInputText('a<b>c')).toBe('a\\<b\\>c')
  })

  it('escapes semicolons', () => {
    expect(escapeInputText('a;b')).toBe('a\\;b')
  })

  it('escapes parentheses', () => {
    expect(escapeInputText('a(b)c')).toBe('a\\(b\\)c')
  })

  it('escapes pipe', () => {
    expect(escapeInputText('a|b')).toBe('a\\|b')
  })

  it('escapes double and single quotes', () => {
    expect(escapeInputText('a"b\'c')).toBe('a\\"b\\\'c')
  })

  it('escapes backslash', () => {
    expect(escapeInputText('a\\b')).toBe('a\\\\b')
  })

  it('escapes dollar sign and hash', () => {
    expect(escapeInputText('$HOME #1')).toBe('\\$HOME%s\\#1')
  })

  it('escapes backtick', () => {
    expect(escapeInputText('a`b`c')).toBe('a\\`b\\`c')
  })

  it('leaves letters, digits, and common punctuation unchanged', () => {
    expect(escapeInputText('hello123')).toBe('hello123')
    expect(escapeInputText('test@example.com')).toBe('test@example.com')
    expect(escapeInputText('path/to/file')).toBe('path/to/file')
  })

  it('handles empty string', () => {
    expect(escapeInputText('')).toBe('')
  })

  it('throws on non-ASCII characters', () => {
    expect(() => escapeInputText('héllo')).toThrow('non-ASCII')
    expect(() => escapeInputText('你好')).toThrow('non-ASCII')
    expect(() => escapeInputText('café')).toThrow('non-ASCII')
    expect(() => escapeInputText('日本語')).toThrow('non-ASCII')
  })

  it('includes the offending character in the error message', () => {
    expect(() => escapeInputText('test你好')).toThrow('你')
  })
})

describe('encodeAdbKeyboard', () => {
  it('URL-encodes ASCII text', () => {
    expect(encodeAdbKeyboard('hello world')).toBe('hello%20world')
    expect(encodeAdbKeyboard('a&b')).toBe('a%26b')
  })

  it('URL-encodes non-ASCII text', () => {
    expect(encodeAdbKeyboard('你好')).toBe('%E4%BD%A0%E5%A5%BD')
    expect(encodeAdbKeyboard('café')).toBe('caf%C3%A9')
  })

  it('URL-encodes emojis', () => {
    expect(encodeAdbKeyboard('👋')).toBe('%F0%9F%91%8B')
  })

  it('encodes spaces as %20 (not %s)', () => {
    expect(encodeAdbKeyboard('a b')).toBe('a%20b')
  })

  it('handles empty string', () => {
    expect(encodeAdbKeyboard('')).toBe('')
  })

  it('handles mixed ASCII and non-ASCII', () => {
    expect(encodeAdbKeyboard('hello 世界')).toBe('hello%20%E4%B8%96%E7%95%8C')
  })
})
