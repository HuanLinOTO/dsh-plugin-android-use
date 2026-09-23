/**
 * skill.ts — publish the bundled android-use skill through `ctx.skills`.
 *
 * The package carries its own playbook (`skills/android-use/SKILL.md`) and
 * registers it as a runtime skill contribution, so adding the bundle is enough:
 * no postinstall step and no files written outside the package. The Markdown
 * file stays the single source of truth — catalog name, description, and body
 * are parsed from it at load time.
 *
 * @module @huanlin/dsh-plugin-android-use/src/skill
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { SkillRegistry, SkillResourceBase } from '@deepseek-ai/dsh-skill'

/** Catalogue metadata parsed from the bundled skill file. */
export interface BundledSkill {
  name: string
  description: string
  /** Instruction body with the YAML frontmatter removed. */
  content: string
}

const SKILL_FILE = new URL('../skills/android-use/SKILL.md', import.meta.url)
const SKILL_DIR = new URL('../skills/android-use/', import.meta.url)

/**
 * Parse the frontmatter and body of a bundled SKILL.md.
 * @param raw - the file contents.
 * @returns the catalogue fields and body, or null when the frontmatter lacks a name or description.
 */
export function parseSkillMarkdown(raw: string): BundledSkill | null {
  const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
  if (front === null) return null
  const head = front[1] ?? ''
  const name = /^name:[ \t]*(.+?)[ \t]*$/m.exec(head)?.[1]
  const description = /^description:[ \t]*(.+?)[ \t]*$/m.exec(head)?.[1]
  if (name === undefined || description === undefined) return null
  return { name, description, content: raw.slice(front[0].length).trim() }
}

/**
 * Read the skill shipped inside this package.
 * @returns the parsed skill, or null when the file is missing or malformed.
 */
export function readBundledSkill(): BundledSkill | null {
  try {
    return parseSkillMarkdown(readFileSync(SKILL_FILE, 'utf8'))
  } catch {
    // A missing or unreadable skill file only costs the playbook, never the tools.
    return null
  }
}

/**
 * Register the bundled skill as a runtime contribution on `ctx.skills`.
 *
 * Registration is optional on purpose: a profile that mounts no skills service
 * still gets every android_* tool, it just loses the written playbook.
 *
 * @param ctx - the plugin context.
 * @param enabled - false skips registration (plugin config `provideSkill`).
 */
export function registerBundledSkill(ctx: Context, enabled: boolean): void {
  if (!enabled) return
  const skills = ctx.get('skills') as SkillRegistry | undefined
  if (skills === undefined) return
  const skill = readBundledSkill()
  if (skill === null) {
    ctx.logger.warn('android-use skill file is missing or malformed; tools stay available without the playbook')
    return
  }
  const resourceBase: SkillResourceBase = { kind: 'directory', path: fileURLToPath(SKILL_DIR) }
  ctx.effect(
    () => skills.register({
      name: skill.name,
      description: skill.description,
      content: skill.content,
      source: 'runtime',
      resourceBase,
    }),
    'dsh-android-use: bundled skill',
  )
}
