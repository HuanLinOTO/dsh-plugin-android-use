import { describe, it, expect } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { registerBundledSkill } from '../src/skill.js'

describe('bundled skill on the real skill registry', () => {
  it('appears in the catalogue and loads by name', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    registerBundledSkill(ctx, true)

    const list = await ctx.skills.list()
    const summary = list.find(skill => skill.name === 'android-use')
    expect(summary).toBeDefined()
    expect(summary!.source).toBe('runtime')
    expect(summary!.provider).toBe('runtime')
    expect(summary!.invocation.modelInvocable).toBe(true)
    expect(summary!.invocation.userInvocable).toBe(true)

    const loaded = await ctx.skills.get('android-use')
    expect(loaded).toBeDefined()
    expect(loaded!.content).toContain('android_tap')
    expect(loaded!.content).toContain('坐标')
  })

  it('stays visible to an agent-scoped lookup (the scope used by the skill tool)', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    registerBundledSkill(ctx, true)
    const scoped = await ctx.skills.list({ scope: {} as never })
    expect(scoped.map(skill => skill.name)).toContain('android-use')
  })
})
