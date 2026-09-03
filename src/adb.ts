/**
 * adb.ts — spawn-based adb client with signal cancellation and binary support.
 *
 * Zero runtime dependencies: only `node:child_process` spawn. The class is
 * injected into `registerTools` so tests substitute a fake without touching
 * the real adb binary.
 *
 * Conventions (per plugin-development-guide.md §3):
 *   C5 — adb missing / device offline / spawn failure are infrastructure
 *        failures: they throw (the model sees a tool error, not a silent
 *        canonical value).
 *   C6 — every spawn receives `exec.signal`; aborting kills the child.
 *
 * @module @huanlin/dsh-plugin-android-use/src/adb
 */

import { spawn } from 'node:child_process'

/** One device row from `adb devices -l`. */
export interface AdbDevice {
  serial: string
  state: string
  product?: string
  model?: string
  device?: string
  transportId?: number
}

/** String output from a completed adb invocation. */
export interface AdbStringResult {
  stdout: string
  stderr: string
  exitCode: number
}

/** Options shared by all adb invocations. */
export interface AdbRunOptions {
  serial?: string
  signal?: AbortSignal
}

/**
 * Parse `adb devices -l` stdout into device rows.
 *
 * Example input:
 * ```
 * List of devices attached
 * 192.168.5.15:43709     device product:PJF110 model:PJF110 device:OP5CFBL1 transport_id:1
 * ```
 * @param output - raw stdout from `adb devices -l`.
 * @returns parsed device rows (empty when no devices are attached).
 */
export function parseDeviceList(output: string): AdbDevice[] {
  const lines = output.split(/\r?\n/)
  const devices: AdbDevice[] = []
  let started = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    if (trimmed === 'List of devices attached') {
      started = true
      continue
    }
    if (!started) continue
    if (trimmed.startsWith('*')) continue
    const parts = trimmed.split(/\s+/)
    if (parts.length < 2) continue
    const serial = parts[0]!
    const state = parts[1]!
    if (state === 'device' || state === 'offline' || state === 'unauthorized' || state === 'connecting') {
      const device: AdbDevice = { serial, state }
      for (let i = 2; i < parts.length; i++) {
        const kv = parts[i]!
        const colon = kv.indexOf(':')
        if (colon < 0) continue
        const key = kv.slice(0, colon)
        const value = kv.slice(colon + 1)
        if (key === 'product') device.product = value
        else if (key === 'model') device.model = value
        else if (key === 'device') device.device = value
        else if (key === 'transport_id') {
          const id = Number(value)
          if (Number.isInteger(id)) device.transportId = id
        }
      }
      devices.push(device)
    }
  }
  return devices
}

/**
 * Spawn-based adb client. All methods honor `signal` for cancellation (C6);
 * a non-zero exit with empty stdout throws (infrastructure failure, C5).
 */
export class AdbClient {
  /**
   * @param adbPath - path to the adb binary (default `'adb'`).
   */
  constructor(
    private readonly adbPath: string = 'adb',
  ) {}

  /**
   * Run adb collecting stdout/stderr as UTF-8 strings.
   * @param args - full argument list (e.g. `['-s', serial, 'shell', 'wm size']`).
   * @param options - serial and cancellation signal.
   * @returns the collected stdout, stderr, and exit code.
   */
  run(args: string[], options: AdbRunOptions = {}): Promise<AdbStringResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.adbPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      const stdoutChunks: Buffer[] = []
      let stderrChunks: Buffer[] = []
      child.stdout.on('data', (chunk: Buffer) => { stdoutChunks.push(chunk) })
      child.stderr.on('data', (chunk: Buffer) => { stderrChunks.push(chunk) })
      const onAbort = (): void => {
        if (!child.killed) child.kill('SIGTERM')
      }
      const signal = options.signal
      if (signal !== undefined) {
        if (signal.aborted) {
          child.kill('SIGTERM')
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }
      child.on('error', (error: Error) => {
        if (signal !== undefined) signal.removeEventListener('abort', onAbort)
        reject(new Error(`adb spawn failed: ${error.message}`))
      })
      child.on('close', (code: number | null) => {
        if (signal !== undefined) signal.removeEventListener('abort', onAbort)
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
          exitCode: code ?? -1,
        })
      })
    })
  }

  /**
   * Run adb collecting stdout as a raw Buffer (binary-safe, for `screencap`).
   * @param args - full argument list.
   * @param options - serial and cancellation signal.
   * @returns the raw stdout buffer.
   */
  runBinary(args: string[], options: AdbRunOptions = {}): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.adbPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []
      child.stdout.on('data', (chunk: Buffer) => { stdoutChunks.push(chunk) })
      child.stderr.on('data', (chunk: Buffer) => { stderrChunks.push(chunk) })
      const onAbort = (): void => {
        if (!child.killed) child.kill('SIGTERM')
      }
      const signal = options.signal
      if (signal !== undefined) {
        if (signal.aborted) child.kill('SIGTERM')
        signal.addEventListener('abort', onAbort, { once: true })
      }
      child.on('error', (error: Error) => {
        if (signal !== undefined) signal.removeEventListener('abort', onAbort)
        reject(new Error(`adb spawn failed: ${error.message}`))
      })
      child.on('close', (code: number | null) => {
        if (signal !== undefined) signal.removeEventListener('abort', onAbort)
        const stdout = Buffer.concat(stdoutChunks)
        const stderr = Buffer.concat(stderrChunks).toString('utf8')
        if (code !== 0) {
          reject(new Error(`adb exited with code ${code}: ${stderr || '(no stderr)'}`))
          return
        }
        if (signal?.aborted) {
          reject(new Error('adb was cancelled'))
          return
        }
        resolve(stdout)
      })
    })
  }

  /**
   * List attached devices via `adb devices -l`.
   * @returns parsed device rows.
   */
  async devices(signal?: AbortSignal): Promise<AdbDevice[]> {
    const result = await this.run(['devices', '-l'], { signal })
    return parseDeviceList(result.stdout)
  }

  /**
   * Run a shell command on the device (`adb -s <serial> shell <cmd>`).
   * @returns the command stdout as a string.
   */
  async shell(serial: string, command: string, signal?: AbortSignal): Promise<string> {
    const result = await this.run(['-s', serial, 'shell', command], { serial, signal })
    if (result.exitCode !== 0) {
      throw new Error(`adb shell failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`)
    }
    return result.stdout
  }

  /**
   * Run an exec-out command (`adb -s <serial> exec-out <cmd>`), binary-safe.
   * @returns the command stdout as a string (UTF-8 decoded).
   */
  async execOut(serial: string, command: string, signal?: AbortSignal): Promise<string> {
    const result = await this.run(['-s', serial, 'exec-out', command], { serial, signal })
    if (result.exitCode !== 0) {
      throw new Error(`adb exec-out failed (exit ${result.exitCode}): ${result.stderr}`)
    }
    return result.stdout
  }

  /**
   * Run an exec-out command collecting raw bytes (for `screencap -p`).
   * @returns the command stdout as a Buffer.
   */
  async execOutBinary(serial: string, command: string, signal?: AbortSignal): Promise<Buffer> {
    return this.runBinary(['-s', serial, 'exec-out', command], { serial, signal })
  }
}

/** Parse `wm size` output into `{ width, height }`. */
export function parseWmSize(output: string): { width: number; height: number } {
  const overrideMatch = /Override size:\s*(\d+)x(\d+)/.exec(output)
  if (overrideMatch !== null) {
    return { width: Number(overrideMatch[1]), height: Number(overrideMatch[2]) }
  }
  const physicalMatch = /Physical size:\s*(\d+)x(\d+)/.exec(output)
  if (physicalMatch !== null) {
    return { width: Number(physicalMatch[1]), height: Number(physicalMatch[2]) }
  }
  throw new Error(`could not parse "wm size" output: ${output.trim()}`)
}

/** Result of serial resolution: the serial to target, and how it was chosen. */
export interface ResolvedSerial {
  serial: string
  source: 'param' | 'config' | 'auto'
}

/**
 * Resolve the target device serial following the priority order:
 *   1. `args.serial` (explicit per-call parameter)
 *   2. `config.defaultSerial` (plugin config)
 *   3. single attached device (auto-select)
 *   4. multiple devices → throw "multiple devices, pass serial"
 *
 * @param adb - the adb client (used to list devices when needed).
 * @param argSerial - the per-call `serial` argument, if the model supplied one.
 * @param configSerial - the plugin config `defaultSerial`, if configured.
 * @param signal - cancellation for the device-list query.
 * @returns the resolved serial and its source.
 */
export async function resolveSerial(
  adb: AdbClient,
  argSerial: string | undefined,
  configSerial: string | undefined,
  signal?: AbortSignal,
): Promise<ResolvedSerial> {
  if (argSerial !== undefined && argSerial !== '') {
    return { serial: argSerial, source: 'param' }
  }
  if (configSerial !== undefined && configSerial !== '') {
    return { serial: configSerial, source: 'config' }
  }
  const devices = await adb.devices(signal)
  const ready = devices.filter(d => d.state === 'device')
  if (ready.length === 0) {
    throw new Error('no device is ready; connect a device or specify a serial')
  }
  if (ready.length > 1) {
    const list = ready.map(d => d.serial).join(', ')
    throw new Error(`multiple devices attached (${list}); pass the "serial" parameter to select one`)
  }
  return { serial: ready[0]!.serial, source: 'auto' }
}
