/**
 * ScreenshotCard — the toolcall card for the `android_screenshot` tool.
 *
 * Renders the captured screenshot inline. The image is loaded through
 * the `uiConversation.imageUrl` service, which converts the ImageAttachmentRef
 * into a session-authorized blob URL.
 *
 * @module @huanlin/dsh-plugin-android-use/client/ScreenshotCard
 */

import { useEffect, useState } from 'react'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolResultNode, UiConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ContentBlock, ImageBlock } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import css from './ScreenshotCard.module.css'

/** Inject face: the Conversation image cache for durable URL resolution. */
export type ScreenshotCardInjected = {
  uiConversation: UiConversation
}

type ScreenshotCardProps = ToolCallViewProps & InjectFace<ScreenshotCardInjected>

function findImage(block: ToolResultNode): ImageBlock | undefined {
  return block.content.find((c): c is ImageBlock => c.type === 'image')
}

function findText(block: ToolResultNode): string | undefined {
  const text = block.content.find((c): c is Extract<ContentBlock, { type: 'text' }> => c.type === 'text')
  return text?.text
}

function useImageUrl(
  uiConversation: UiConversation,
  sessionId: ScreenshotCardProps['sessionId'] | undefined,
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
 * Render one `android_screenshot` tool call as a card with the screenshot.
 */
export function ScreenshotCard({ block, toolName, sessionId, uiConversation }: ScreenshotCardProps) {
  const settled = 'kind' in block ? block : undefined

  const image = settled !== undefined ? findImage(settled) : undefined
  const text = settled !== undefined ? findText(settled) : undefined
  const imageUrl = useImageUrl(uiConversation, sessionId, image?.attachment)

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
