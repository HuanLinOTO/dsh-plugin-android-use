/**
 * TapCard — the toolcall card for the `android_tap` tool.
 *
 * Renders both the pre-tap screenshot (annotated with the tap marker) and
 * the post-tap screenshot (showing the result after tap) inline, along with
 * coordinates and action metadata. Images are loaded through the
 * `uiConversation.imageUrl` service, which converts the ImageAttachmentRef
 * into a session-authorized blob URL.
 *
 * @module @huanlin/dsh-plugin-android-use/client/TapCard
 */

import { useEffect, useState } from 'react'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolResultNode, UiConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ContentBlock, ImageBlock } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import css from './TapCard.module.css'

/** Inject face: the Conversation image cache for durable URL resolution. */
export type TapCardInjected = {
  uiConversation: UiConversation
}

type TapCardProps = ToolCallViewProps & InjectFace<TapCardInjected>

/** Extract all image blocks from a settled tool result, in order. */
function findImages(block: ToolResultNode): ImageBlock[] {
  return block.content.filter((c): c is ImageBlock => c.type === 'image')
}

/** Extract the first text block (summary) from a settled tool result. */
function findText(block: ToolResultNode): string | undefined {
  const text = block.content.find((c): c is Extract<ContentBlock, { type: 'text' }> => c.type === 'text')
  return text?.text
}

/** Parse tap coordinates from the running block's argsRaw. */
function parseTapArgs(argsRaw: string): { x?: number; y?: number } {
  try {
    const parsed = JSON.parse(argsRaw) as { x?: unknown; y?: unknown }
    return {
      x: typeof parsed.x === 'number' ? parsed.x : undefined,
      y: typeof parsed.y === 'number' ? parsed.y : undefined,
    }
  } catch {
    return {}
  }
}

/**
 * Resolve an attachmentId to a browser URL through the uiConversation service.
 * Caches by attachmentId so re-renders don't re-fetch.
 */
function useImageUrl(
  uiConversation: UiConversation,
  sessionId: TapCardProps['sessionId'] | undefined,
  attachment: ImageAttachmentRef | undefined,
): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (attachment === undefined || sessionId === undefined) {
      setUrl(undefined)
      return
    }
    let cancelled = false
    uiConversation.imageUrl(sessionId, attachment)
      .then((resolved) => { if (!cancelled) setUrl(resolved) })
      .catch(() => { if (!cancelled) setUrl(undefined) })
    return () => { cancelled = true }
  }, [uiConversation, sessionId, attachment])
  return url
}

/**
 * Render one `android_tap` tool call as a card with pre-tap and post-tap screenshots.
 */
export function TapCard({ block, toolName, sessionId, uiConversation }: TapCardProps) {
  const settled = 'kind' in block ? block : undefined
  const running = 'kind' in block ? undefined : block

  const images = settled !== undefined ? findImages(settled) : []
  const text = settled !== undefined ? findText(settled) : undefined
  const runArgs = running !== undefined ? parseTapArgs(running.argsRaw) : undefined
  const settledArgs = settled?.call != null ? parseTapArgs(settled.call.argsRaw) : undefined
  const coords = runArgs ?? settledArgs ?? { x: undefined, y: undefined }

  const preImage = images[0]
  const postImage = images[1]
  const preUrl = useImageUrl(uiConversation, sessionId, preImage?.attachment)
  const postUrl = useImageUrl(uiConversation, sessionId, postImage?.attachment)

  const state = settled === undefined ? 'running' : (settled.isError ? 'error' : 'completed')

  const title = coords.x !== undefined && coords.y !== undefined
    ? `Tap (${coords.x}, ${coords.y})`
    : toolName

  return (
    <div className={css.card} data-tool={toolName} data-state={state}>
      <div className={css.header}>
        <span className={css.stateDot} aria-hidden />
        <span className={css.title}>{title}</span>
        <span className={css.badge}>{state}</span>
      </div>
      <div className={css.imageGrid}>
        <div className={css.imageSlot}>
          <span className={css.imageLabel}>Pre-tap (annotated)</span>
          <div className={css.imageWrap}>
            {preUrl !== undefined ? (
              <img className={css.image} src={preUrl} alt={`Pre-tap screenshot at (${coords.x ?? '?'}, ${coords.y ?? '?'})`} />
            ) : (
              <span className={css.placeholder}>
                {settled === undefined ? 'Capturing…' : preImage !== undefined ? 'Loading…' : 'No screenshot'}
              </span>
            )}
          </div>
        </div>
        <div className={css.imageSlot}>
          <span className={css.imageLabel}>Post-tap (result)</span>
          <div className={css.imageWrap}>
            {postUrl !== undefined ? (
              <img className={css.image} src={postUrl} alt="Post-tap screenshot showing the result" />
            ) : (
              <span className={css.placeholder}>
                {settled === undefined ? 'Capturing…' : postImage !== undefined ? 'Loading…' : 'No screenshot'}
              </span>
            )}
          </div>
        </div>
      </div>
      {text !== undefined && (
        <div className={css.meta}>
          {text.split('\n').map((line, i) => (
            <span key={i} className={css.metaItem}>{line}</span>
          ))}
        </div>
      )}
    </div>
  )
}
