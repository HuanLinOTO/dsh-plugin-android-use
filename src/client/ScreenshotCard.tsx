/**
 * ScreenshotCard — the toolcall card for the `android_screenshot` tool.
 *
 * Renders the captured screenshot inline. The image is loaded through
 * the session-authorized `loadImage` loader the toolview owner supplies,
 * which converts the ImageAttachmentRef into a session-authorized blob URL.
 *
 * @module @huanlin/dsh-plugin-android-use/client/ScreenshotCard
 */

import { useEffect, useState } from 'react'
import type { StartedToolCallViewProps, ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { MessageImageLoader, ToolResultNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ContentBlock, ImageBlock } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import css from './ScreenshotCard.module.css'

function findImage(block: ToolResultNode): ImageBlock | undefined {
  return block.content.find((c): c is ImageBlock => c.type === 'image')
}

function findText(block: ToolResultNode): string | undefined {
  const text = block.content.find((c): c is Extract<ContentBlock, { type: 'text' }> => c.type === 'text')
  return text?.text
}

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
 * Render one `android_screenshot` tool call as a card with the screenshot.
 *
 * `tool.call.toolview` is a three-phase union: a `preparing` call carries no
 * dispatched arguments, so it renders a lightweight argument-free row and the
 * start/result phases delegate to {@link StartedScreenshotCard}.
 */
export function ScreenshotCard(props: ToolCallViewProps) {
  if (props.phase === 'preparing') {
    return (
      <div className={css.card} data-tool={props.toolName} data-state="preparing">
        <div className={css.header}>
          <span className={css.stateDot} aria-hidden />
          <span className={css.title}>{props.toolName}</span>
          <span className={css.badge}>preparing</span>
        </div>
        <div className={css.imageWrap}>
          <span className={css.placeholder}>Capturing…</span>
        </div>
      </div>
    )
  }
  return <StartedScreenshotCard {...props} />
}

/** Dispatched/settled `android_screenshot` card. */
function StartedScreenshotCard({ phase, block, toolName, loadImage }: StartedToolCallViewProps) {
  const settled = phase === 'result' ? block : undefined

  const image = settled !== undefined ? findImage(settled) : undefined
  const text = settled !== undefined ? findText(settled) : undefined
  const imageUrl = useImageUrl(loadImage, image?.attachment)

  const state = settled === undefined ? 'running' : (settled.isError ? 'error' : 'completed')

  return (
    <div className={css.card} data-tool={toolName} data-state={state}>
      <div className={css.header}>
        <span className={css.stateDot} aria-hidden />
        <span className={css.title}>{toolName}</span>
        <span className={css.badge}>{state}</span>
      </div>
      <div className={css.imageWrap}>
        {imageUrl !== undefined ? (
          <img className={css.image} src={imageUrl} alt="Android screenshot" />
        ) : (
          <span className={css.placeholder}>
            {settled === undefined ? 'Capturing…' : image !== undefined ? 'Loading…' : 'No screenshot'}
          </span>
        )}
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
