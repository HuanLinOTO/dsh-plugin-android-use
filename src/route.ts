/**
 * route.ts — shared model-route capability check.
 *
 * Extracted from screen.ts so both the screenshot tool and the tap tool
 * can gate image emission on the same route-capability logic.
 *
 * @module @huanlin/dsh-plugin-android-use/src/route
 */

import type { Context } from '@deepseek-ai/cordis'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'

/** Minimal agent shape carrying provider/model for route resolution. */
interface RouteAwareExec {
  agent?: {
    options: { provider?: string; model?: string }
    session: {
      requestHeader(): { config: { provider: string; model: string } } | undefined
    }
  }
}

/**
 * Best-effort check whether the current model route accepts image input.
 * Returns false when the llm service is absent, the route cannot be resolved,
 * or the resolved model does not declare image input. Never throws.
 */
export async function routeIsImageCapable(
  ctx: Context,
  exec: RouteAwareExec,
  signal: AbortSignal,
): Promise<boolean> {
  const llm = ctx.get('llm') as LlmRuntime | undefined
  if (llm === undefined) return false
  const agent = exec.agent
  if (agent === undefined) return false
  const routed = agent.session.requestHeader()?.config
  const provider = routed?.provider ?? agent.options.provider
  const model = routed?.model ?? agent.options.model
  if (provider === undefined || model === undefined) return false
  try {
    const info = await llm.resolveModelInfo(provider, model, signal)
    return info.inputModalities?.includes('image') === true
  } catch {
    return false
  }
}
