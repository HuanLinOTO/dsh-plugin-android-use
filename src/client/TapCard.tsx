/**
 * TapCard — the toolcall card for the `android_tap` tool.
 *
 * Renders both the pre-tap screenshot (annotated with the tap marker) and
 * the post-tap screenshot (showing the result after tap) inline, along with
 * coordinates and action metadata. Images are loaded through the
 * session-authorized `loadImage` loader the toolview owner supplies, which
 * converts the ImageAttachmentRef into a session-authorized blob URL.
 *
 * @module @huanlin/dsh-plugin-android-use/client/TapCard
 */

import { useEffect, useState } from 'react'
import type { StartedToolCallViewProps, ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { MessageImageLoader, ToolResultNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ContentBlock, ImageBlock } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import css from './TapCard.module.css'

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
 * Resolve an attachmentId to a browser URL through the session-authorized
 * image loader. Caches by attachmentId so re-renders don't re-fetch.
 */
function useImageUrl(
  loadImage: MessageImageLoader,
  attachment: ImageAttachmentRef | undefined,
): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (attachment === undefined) {
      setUrl(undefined)
      return
    }
    let cancelled = false
    loadImage(attachment)
      .then((resolved) => { if (!cancelled) setUrl(resolved) })
      .catch(() => { if (!cancelled) setUrl(undefined) })
    return () => { cancelled = true }
  }, [loadImage, attachment])
  return url
}

/**
 * Render one `android_tap` tool call as a card with pre-tap and post-tap screenshots.
 *
 * `tool.call.toolview` is a three-phase union: a `preparing` call carries no
 * dispatched arguments, so it renders a lightweight argument-free row and the
 * start/result phases delegate to {@link StartedTapCard} (which reads
 * `argsRaw` only when the phase guarantees it).
 */
export function TapCard(props: ToolCallViewProps) {
  if (props.phase === 'preparing') {
    return (
      <div className={css.card} data-tool={props.toolName} data-state="preparing">
        <div className={css.header}>
          <span className={css.stateDot} aria-hidden />
          <span className={css.title}>{props.toolName}</span>
          <span className={css.badge}>preparing</span>
        </div>
        <div className={css.imageGrid}>
          <div className={css.imageSlot}>
            <span className={css.imageLabel}>Pre-tap (annotated)</span>
            <div className={css.imageWrap}><span className={css.placeholder}>Capturing…</span></div>
          </div>
          <div className={css.imageSlot}>
            <span className={css.imageLabel}>Post-tap (result)</span>
            <div className={css.imageWrap}><span className={css.placeholder}>Capturing…</span></div>
          </div>
        </div>
      </div>
    )
  }
  return <StartedTapCard {...props} />
}

/** Dispatched/settled `android_tap` card. */
function StartedTapCard({ phase, block, toolName, loadImage }: StartedToolCallViewProps) {
  const settled = phase === 'result' ? block : undefined
  const running = phase === 'start' ? block : undefined

  const images = settled !== undefined ? findImages(settled) : []
  const text = settled !== undefined ? findText(settled) : undefined
  const runArgs = running !== undefined ? parseTapArgs(running.argsRaw) : undefined
  const settledArgs = settled?.call != null ? parseTapArgs(settled.call.argsRaw) : undefined
  const coords = runArgs ?? settledArgs ?? { x: undefined, y: undefined }

  const preImage = images[0]
  const postImage = images[1]
  const preUrl = useImageUrl(loadImage, preImage?.attachment)
  const postUrl = useImageUrl(loadImage, postImage?.attachment)

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
