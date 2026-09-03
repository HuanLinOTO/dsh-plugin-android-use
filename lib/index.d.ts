import z from "schemastery";
import { Context } from "@deepseek-ai/cordis";
//#region src/registry.d.ts
/** Validated plugin config consumed by the tools at execution time. */
interface ResolvedConfig {
  defaultSerial: string | undefined;
  inputTextMode: 'input' | 'adbkeyboard';
}
//#endregion
//#region src/index.d.ts
declare const name = "dsh-android-use";
declare const inject: string[];
interface Config {
  adbPath?: string;
  defaultSerial?: string;
  inputTextMode?: 'input' | 'adbkeyboard';
}
declare const Config: z<Config>;
declare function resolveConfig(config: Config): {
  adbPath: string;
} & ResolvedConfig;
declare function apply(ctx: Context, config?: Config): void;
//#endregion
export { Config, apply, inject, name, resolveConfig };