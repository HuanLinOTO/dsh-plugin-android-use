/**
 * capture.ts — keep the exact frame the model was shown on disk.
 *
 * Screenshots are ephemeral in the attachment store and invisible once the
 * session log is trimmed, so every delivered frame is also written to a
 * temporary directory. The directory is pruned to a bounded number of files
 * after each write; pruning failures never fail a capture.
 *
 * @module @huanlin/dsh-plugin-android-use/src/capture
 */

import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Default capture directory: `<os tmp>/dsh-android-use`. */
export function defaultCaptureDir(): string {
  return join(tmpdir(), 'dsh-android-use')
}

/** A file written by {@link saveCapture}. */
export interface CaptureFile {
  path: string
  bytes: number
  /** File name inside the capture directory. */
  name: string
}

/** Local timestamp for capture file names (sortable, filesystem-safe). */
function stamp(now: Date): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}-${p(now.getMilliseconds(), 3)}`
}

/**
 * Write one delivered frame to the capture directory.
 *
 * @param dir - capture directory (created when missing).
 * @param kind - short label such as `shot`, `pre-tap`, `post-tap`.
 * @param data - the encoded image bytes.
 * @param extension - file extension without the dot.
 * @returns the written file, or null when the write failed.
 */
export async function saveCapture(dir: string, kind: string, data: Uint8Array, extension: string): Promise<CaptureFile | null> {
  try {
    await mkdir(dir, { recursive: true })
    const name = `${stamp(new Date())}-${kind}.${extension}`
    const path = join(dir, name)
    await writeFile(path, data)
    return { path, bytes: data.byteLength, name }
  } catch {
    return null
  }
}

/**
 * Delete the oldest captures so at most `keep` images remain.
 *
 * @param dir - capture directory.
 * @param keep - maximum number of image files to retain (0 disables pruning).
 * @returns the number of deleted files.
 */
export async function pruneCaptures(dir: string, keep: number): Promise<number> {
  if (keep <= 0) return 0
  try {
    const names = await readdir(dir)
    const entries: { path: string; mtime: number }[] = []
    for (const name of names) {
      if (!/\.(png|jpg|jpeg|webp)$/i.test(name)) continue
      const path = join(dir, name)
      try {
        const info = await stat(path)
        entries.push({ path, mtime: info.mtimeMs })
      } catch {
        // The file disappeared between readdir and stat; nothing to prune.
      }
    }
    if (entries.length <= keep) return 0
    entries.sort((a, b) => b.mtime - a.mtime)
    let deleted = 0
    for (const entry of entries.slice(keep)) {
      try {
        await unlink(entry.path)
        deleted++
      } catch {
        // Best effort: a locked file is pruned by the next capture.
      }
    }
    return deleted
  } catch {
    return 0
  }
}
