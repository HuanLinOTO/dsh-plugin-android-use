import { describe, it, expect, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { parseSkillMarkdown, readBundledSkill, registerBundledSkill } from '../src/skill.js'

interface RegisteredSkill {
  name: string
  description: string
  content: string
  source: string
  resourceBase?: { kind: string; path: string }
}

function makeCtx(options: { withSkills?: boolean } = {}): { ctx: Context; registered: RegisteredSkill[]; disposers: number; warnings: string[] } {
  const state = { registered: [] as RegisteredSkill[], disposers: 0, warnings: [] as string[] }
  const registry = {
    register(skill: RegisteredSkill): () => void {
      state.registered.push(skill)
      return () => { state.disposers += 1 }
    },
  }
  const ctx = {
    get(name: string): unknown {
      if (name === 'skills') return options.withSkills === false ? undefined : registry
      return undefined
    },
    effect(execute: () => unknown): unknown {
      return execute()
    },
    logger: {
      info: vi.fn(),
      warn: (message: string) => { state.warnings.push(message) },
      error: vi.fn(),
      debug: vi.fn(),
    },
  } as unknown as Context
  return { ctx, ...state }
}

describe('parseSkillMarkdown', () => {
  it('splits frontmatter from the instruction body', () => {
    const parsed = parseSkillMarkdown('---' + String.fromCharCode(10) + 'name: demo-skill' + String.fromCharCode(10) + 'description: Use when demoing.' + String.fromCharCode(10) + '---' + String.fromCharCode(10) + String.fromCharCode(10) + '# Body' + String.fromCharCode(10) + 'text')
    expect(parsed).toEqual({ name: 'demo-skill', description: 'Use when demoing.', content: '# Body' + String.fromCharCode(10) + 'text' })
  })

  it('returns null without frontmatter', () => {
    expect(parseSkillMarkdown('# Body only')).toBeNull()
  })

  it('returns null when name or description is missing', () => {
    expect(parseSkillMarkdown('---' + String.fromCharCode(10) + 'name: only-name' + String.fromCharCode(10) + '---' + String.fromCharCode(10) + 'body')).toBeNull()
  })
})

describe('readBundledSkill', () => {
  it('reads the shipped skill from the package', () => {
    const skill = readBundledSkill()
    expect(skill).not.toBeNull()
    expect(skill!.name).toBe('android-use')
    expect(skill!.description.length).toBeGreaterThan(40)
    expect(skill!.content).toContain('android_tap')
    expect(skill!.content).not.toContain('name: android-use')
  })
})

describe('registerBundledSkill', () => {
  it('registers the bundled skill as a runtime contribution', () => {
    const { ctx, registered } = makeCtx()
    registerBundledSkill(ctx, true)
    expect(registered).toHaveLength(1)
    expect(registered[0]!.name).toBe('android-use')
    expect(registered[0]!.source).toBe('runtime')
    expect(registered[0]!.content).toContain('坐标')
    expect(registered[0]!.resourceBase?.kind).toBe('directory')
    expect(registered[0]!.resourceBase?.path).toContain('skills')
  })

  it('binds the registration to the plugin effect so disposal unregisters it', () => {
    const { ctx, disposers } = makeCtx()
    registerBundledSkill(ctx, true)
    // effect() runs the callback and keeps the returned disposer for fiber teardown
    expect(disposers).toBe(0)
  })

  it('does nothing when the profile mounts no skills service', () => {
    const { ctx, registered } = makeCtx({ withSkills: false })
    expect(() => registerBundledSkill(ctx, true)).not.toThrow()
    expect(registered).toHaveLength(0)
  })

  it('skips registration when the config disables it', () => {
    const { ctx, registered } = makeCtx()
    registerBundledSkill(ctx, false)
    expect(registered).toHaveLength(0)
  })
})
