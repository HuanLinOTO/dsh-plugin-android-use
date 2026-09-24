import z from "@deepseek-ai/schemastery";
import { Context } from "@deepseek-ai/cordis";
//#region src/image.d.ts
/**
 * image.ts — screenshot conditioning for model delivery.
 *
 * One pipeline produces the bytes the model actually sees: optional region
 * crop, optional magnification, a longest-side cap, and a compressed
 * encoding. Every stage reports the mapping between the delivered image and
 * the original screenshot pixels, because tap/swipe coordinates are always
 * expressed in original screenshot pixels (a 1:1 match with device pixels on
 * stock devices).
 *
 * @module @huanlin/dsh-plugin-android-use/src/image
 */
/** Output encodings this plugin can deliver to the attachment store. */
type ImageFormat = 'jpeg' | 'webp' | 'png';
//#endregion
//#region src/registry.d.ts
/** Validated plugin config consumed by the tools at execution time. */
interface ResolvedConfig {
  defaultSerial: string | undefined;
  inputTextMode: 'input' | 'adbkeyboard';
  /** Directory that keeps a copy of every delivered frame. */
  captureDir: string;
  /** Maximum number of retained frames; 0 disables pruning. */
  captureKeep: number;
  /** Longest-side cap of a delivered frame, in pixels. */
  imageMaxDimension: number;
  /** Encoding of delivered frames. */
  imageFormat: ImageFormat;
  /** Encoder quality (1-100); ignored by the png format. */
  imageQuality: number;
  /** Whether delivered frames carry the coordinate grid. */
  showGrid: boolean;
  /** Whether the bundled skill is registered on ctx.skills when that service is present. */
  provideSkill: boolean;
}
//#endregion
//#region src/index.d.ts
declare const name = "dsh-android-use";
declare const inject: string[];
interface Config {
  adbPath?: string;
  defaultSerial?: string;
  inputTextMode?: 'input' | 'adbkeyboard';
  captureDir?: string;
  captureKeep?: number;
  imageMaxDimension?: number;
  imageFormat?: ImageFormat;
  imageQuality?: number;
  showGrid?: boolean;
  provideSkill?: boolean;
}
declare const Config: z<Config>;
declare function resolveConfig(config: Config): {
  adbPath: string;
} & ResolvedConfig;
declare function apply(ctx: Context, config?: Config): void;
//#endregion
export { Config, apply, inject, name, resolveConfig };