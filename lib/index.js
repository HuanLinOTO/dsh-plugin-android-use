import z from "schemastery";
import { spawn } from "node:child_process";
import { defineTool } from "@deepseek-ai/dsh-tools";
//#region src/adb.ts
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
function parseDeviceList(output) {
	const lines = output.split(/\r?\n/);
	const devices = [];
	let started = false;
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed === "") continue;
		if (trimmed === "List of devices attached") {
			started = true;
			continue;
		}
		if (!started) continue;
		if (trimmed.startsWith("*")) continue;
		const parts = trimmed.split(/\s+/);
		if (parts.length < 2) continue;
		const serial = parts[0];
		const state = parts[1];
		if (state === "device" || state === "offline" || state === "unauthorized" || state === "connecting") {
			const device = {
				serial,
				state
			};
			for (let i = 2; i < parts.length; i++) {
				const kv = parts[i];
				const colon = kv.indexOf(":");
				if (colon < 0) continue;
				const key = kv.slice(0, colon);
				const value = kv.slice(colon + 1);
				if (key === "product") device.product = value;
				else if (key === "model") device.model = value;
				else if (key === "device") device.device = value;
				else if (key === "transport_id") {
					const id = Number(value);
					if (Number.isInteger(id)) device.transportId = id;
				}
			}
			devices.push(device);
		}
	}
	return devices;
}
/**
* Spawn-based adb client. All methods honor `signal` for cancellation (C6);
* a non-zero exit with empty stdout throws (infrastructure failure, C5).
*/
var AdbClient = class {
	adbPath;
	/**
	* @param adbPath - path to the adb binary (default `'adb'`).
	*/
	constructor(adbPath = "adb") {
		this.adbPath = adbPath;
	}
	/**
	* Run adb collecting stdout/stderr as UTF-8 strings.
	* @param args - full argument list (e.g. `['-s', serial, 'shell', 'wm size']`).
	* @param options - serial and cancellation signal.
	* @returns the collected stdout, stderr, and exit code.
	*/
	run(args, options = {}) {
		return new Promise((resolve, reject) => {
			const child = spawn(this.adbPath, args, {
				stdio: [
					"ignore",
					"pipe",
					"pipe"
				],
				windowsHide: true
			});
			const stdoutChunks = [];
			let stderrChunks = [];
			child.stdout.on("data", (chunk) => {
				stdoutChunks.push(chunk);
			});
			child.stderr.on("data", (chunk) => {
				stderrChunks.push(chunk);
			});
			const onAbort = () => {
				if (!child.killed) child.kill("SIGTERM");
			};
			const signal = options.signal;
			if (signal !== void 0) {
				if (signal.aborted) child.kill("SIGTERM");
				signal.addEventListener("abort", onAbort, { once: true });
			}
			child.on("error", (error) => {
				if (signal !== void 0) signal.removeEventListener("abort", onAbort);
				reject(/* @__PURE__ */ new Error(`adb spawn failed: ${error.message}`));
			});
			child.on("close", (code) => {
				if (signal !== void 0) signal.removeEventListener("abort", onAbort);
				resolve({
					stdout: Buffer.concat(stdoutChunks).toString("utf8"),
					stderr: Buffer.concat(stderrChunks).toString("utf8"),
					exitCode: code ?? -1
				});
			});
		});
	}
	/**
	* Run adb collecting stdout as a raw Buffer (binary-safe, for `screencap`).
	* @param args - full argument list.
	* @param options - serial and cancellation signal.
	* @returns the raw stdout buffer.
	*/
	runBinary(args, options = {}) {
		return new Promise((resolve, reject) => {
			const child = spawn(this.adbPath, args, {
				stdio: [
					"ignore",
					"pipe",
					"pipe"
				],
				windowsHide: true
			});
			const stdoutChunks = [];
			const stderrChunks = [];
			child.stdout.on("data", (chunk) => {
				stdoutChunks.push(chunk);
			});
			child.stderr.on("data", (chunk) => {
				stderrChunks.push(chunk);
			});
			const onAbort = () => {
				if (!child.killed) child.kill("SIGTERM");
			};
			const signal = options.signal;
			if (signal !== void 0) {
				if (signal.aborted) child.kill("SIGTERM");
				signal.addEventListener("abort", onAbort, { once: true });
			}
			child.on("error", (error) => {
				if (signal !== void 0) signal.removeEventListener("abort", onAbort);
				reject(/* @__PURE__ */ new Error(`adb spawn failed: ${error.message}`));
			});
			child.on("close", (code) => {
				if (signal !== void 0) signal.removeEventListener("abort", onAbort);
				const stdout = Buffer.concat(stdoutChunks);
				const stderr = Buffer.concat(stderrChunks).toString("utf8");
				if (code !== 0) {
					reject(/* @__PURE__ */ new Error(`adb exited with code ${code}: ${stderr || "(no stderr)"}`));
					return;
				}
				if (signal?.aborted) {
					reject(/* @__PURE__ */ new Error("adb was cancelled"));
					return;
				}
				resolve(stdout);
			});
		});
	}
	/**
	* List attached devices via `adb devices -l`.
	* @returns parsed device rows.
	*/
	async devices(signal) {
		return parseDeviceList((await this.run(["devices", "-l"], { signal })).stdout);
	}
	/**
	* Run a shell command on the device (`adb -s <serial> shell <cmd>`).
	* @returns the command stdout as a string.
	*/
	async shell(serial, command, signal) {
		const result = await this.run([
			"-s",
			serial,
			"shell",
			command
		], {
			serial,
			signal
		});
		if (result.exitCode !== 0) throw new Error(`adb shell failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
		return result.stdout;
	}
	/**
	* Run an exec-out command (`adb -s <serial> exec-out <cmd>`), binary-safe.
	* @returns the command stdout as a string (UTF-8 decoded).
	*/
	async execOut(serial, command, signal) {
		const result = await this.run([
			"-s",
			serial,
			"exec-out",
			command
		], {
			serial,
			signal
		});
		if (result.exitCode !== 0) throw new Error(`adb exec-out failed (exit ${result.exitCode}): ${result.stderr}`);
		return result.stdout;
	}
	/**
	* Run an exec-out command collecting raw bytes (for `screencap -p`).
	* @returns the command stdout as a Buffer.
	*/
	async execOutBinary(serial, command, signal) {
		return this.runBinary([
			"-s",
			serial,
			"exec-out",
			command
		], {
			serial,
			signal
		});
	}
};
/** Parse `wm size` output into `{ width, height }`. */
function parseWmSize$1(output) {
	const overrideMatch = /Override size:\s*(\d+)x(\d+)/.exec(output);
	if (overrideMatch !== null) return {
		width: Number(overrideMatch[1]),
		height: Number(overrideMatch[2])
	};
	const physicalMatch = /Physical size:\s*(\d+)x(\d+)/.exec(output);
	if (physicalMatch !== null) return {
		width: Number(physicalMatch[1]),
		height: Number(physicalMatch[2])
	};
	throw new Error(`could not parse "wm size" output: ${output.trim()}`);
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
async function resolveSerial(adb, argSerial, configSerial, signal) {
	if (argSerial !== void 0 && argSerial !== "") return {
		serial: argSerial,
		source: "param"
	};
	if (configSerial !== void 0 && configSerial !== "") return {
		serial: configSerial,
		source: "config"
	};
	const ready = (await adb.devices(signal)).filter((d) => d.state === "device");
	if (ready.length === 0) throw new Error("no device is ready; connect a device or specify a serial");
	if (ready.length > 1) {
		const list = ready.map((d) => d.serial).join(", ");
		throw new Error(`multiple devices attached (${list}); pass the "serial" parameter to select one`);
	}
	return {
		serial: ready[0].serial,
		source: "auto"
	};
}
//#endregion
//#region src/tools/device.ts
/** Parse `wm size` output, preferring the override (effective) resolution. */
function parseWmSize(output) {
	const physical = /Physical size:\s*(\d+)x(\d+)/.exec(output);
	const override = /Override size:\s*(\d+)x(\d+)/.exec(output);
	const pw = physical !== null ? Number(physical[1]) : 0;
	const ph = physical !== null ? Number(physical[2]) : 0;
	return {
		width: override !== null ? Number(override[1]) : pw,
		height: override !== null ? Number(override[2]) : ph,
		physicalWidth: pw,
		physicalHeight: ph
	};
}
/** Parse `wm density` output, preferring the override density. */
function parseWmDensity(output) {
	const physical = /Physical density:\s*(\d+)/.exec(output);
	const override = /Override density:\s*(\d+)/.exec(output);
	const pd = physical !== null ? Number(physical[1]) : 0;
	return {
		density: override !== null ? Number(override[1]) : pd,
		physicalDensity: pd
	};
}
/** Parse `dumpsys power` output for the wakefulness state. */
function parseWakefulness$1(output) {
	return /mWakefulness=Awake/.test(output);
}
/** Convert an `AdbDevice` to the canonical list-devices entry. */
function deviceToEntry(d) {
	const entry = {
		serial: d.serial,
		state: d.state
	};
	if (d.product !== void 0) entry.product = d.product;
	if (d.model !== void 0) entry.model = d.model;
	if (d.device !== void 0) entry.device = d.device;
	return entry;
}
function renderListDevices(value) {
	if (value.devices.length === 0) return "No devices attached.";
	const lines = [`Found ${value.devices.length} device(s):`];
	for (const d of value.devices) {
		const parts = [`state: ${d.state}`];
		if (d.model !== void 0) parts.push(`model: ${d.model}`);
		if (d.product !== void 0) parts.push(`product: ${d.product}`);
		lines.push(`  - ${d.serial} (${parts.join(", ")})`);
	}
	return lines.join("\n");
}
function renderDeviceInfo(value) {
	return [
		`Device: ${value.serial}`,
		`  Model: ${value.model} (${value.brand})`,
		`  Android: ${value.android_version} (SDK ${value.sdk})`,
		`  Screen: ${value.screen.width}x${value.screen.height} @ ${value.screen.density}dpi`,
		`  Screen on: ${value.screen_on}`
	].join("\n");
}
function textRender$2(fn) {
	return (_args, value) => [{
		type: "text",
		text: fn(value)
	}];
}
/** Register `android_list_devices` and `android_device_info`. */
function registerDeviceTools(ctx, deps) {
	ctx.tools.register(defineTool({
		name: "android_list_devices",
		description: "List all Android devices attached via adb. Returns each device's serial, state, product, model, and device name. Call this first to discover available devices before using other android_* tools.",
		parameters: {},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					devices: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								serial: {
									type: "string",
									required: true
								},
								state: {
									type: "string",
									required: true
								},
								product: { type: "string" },
								model: { type: "string" },
								device: { type: "string" }
							}
						}
					},
					total: {
						type: "integer",
						required: true
					}
				}
			},
			render: textRender$2(renderListDevices)
		},
		async execute(_args, exec) {
			const devices = await deps.adb.devices(exec.signal);
			return {
				devices: devices.map(deviceToEntry),
				total: devices.length
			};
		}
	}));
	ctx.tools.register(defineTool({
		name: "android_device_info",
		description: "Get detailed information about an Android device: model, brand, Android version, SDK level, screen resolution, density, and whether the screen is currently on. Pass \"serial\" to target a specific device, or omit it when only one device is attached.",
		parameters: { serial: {
			type: "string",
			description: "Device serial. Omit when only one device is attached; required when multiple are connected."
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					serial: {
						type: "string",
						required: true
					},
					model: {
						type: "string",
						required: true
					},
					brand: {
						type: "string",
						required: true
					},
					android_version: {
						type: "string",
						required: true
					},
					sdk: {
						type: "integer",
						required: true
					},
					screen: {
						type: "object",
						additionalProperties: false,
						required: true,
						properties: {
							width: {
								type: "integer",
								required: true
							},
							height: {
								type: "integer",
								required: true
							},
							density: {
								type: "integer",
								required: true
							}
						}
					},
					screen_on: {
						type: "boolean",
						required: true
					}
				}
			},
			render: textRender$2(renderDeviceInfo)
		},
		async execute(args, exec) {
			const a = args;
			const config = deps.getConfig();
			const { serial } = await resolveSerial(deps.adb, a.serial, config.defaultSerial, exec.signal);
			const sections = splitByMarkers(await deps.adb.shell(serial, "echo \"=SZ=\"; wm size; echo \"=DN=\"; wm density; echo \"=MD=\"; getprop ro.product.model; echo \"=BR=\"; getprop ro.product.brand; echo \"=VR=\"; getprop ro.build.version.release; echo \"=SDK=\"; getprop ro.build.version.sdk; echo \"=WK=\"; dumpsys power|grep mWakefulness", exec.signal));
			const sz = parseWmSize(sections.sz);
			const dn = parseWmDensity(sections.dn);
			return {
				serial,
				model: sections.md.trim(),
				brand: sections.br.trim(),
				android_version: sections.vr.trim(),
				sdk: Number(sections.sdk.trim()) || 0,
				screen: {
					width: sz.width,
					height: sz.height,
					density: dn.density
				},
				screen_on: parseWakefulness$1(sections.wk)
			};
		}
	}));
}
/** Split a batched shell output by `=XX=` markers into named sections. */
function splitByMarkers(output) {
	const parts = output.split(/=[A-Z]+=/);
	return {
		sz: parts[1] ?? "",
		dn: parts[2] ?? "",
		md: parts[3] ?? "",
		br: parts[4] ?? "",
		vr: parts[5] ?? "",
		sdk: parts[6] ?? "",
		wk: parts[7] ?? ""
	};
}
//#endregion
//#region src/route.ts
/**
* Best-effort check whether the current model route accepts image input.
* Returns false when the llm service is absent, the route cannot be resolved,
* or the resolved model does not declare image input. Never throws.
*/
async function routeIsImageCapable(ctx, exec, signal) {
	const llm = ctx.get("llm");
	if (llm === void 0) return false;
	const agent = exec.agent;
	if (agent === void 0) return false;
	const routed = agent.session.requestHeader()?.config;
	const provider = routed?.provider ?? agent.options.provider;
	const model = routed?.model ?? agent.options.model;
	if (provider === void 0 || model === void 0) return false;
	try {
		return (await llm.resolveModelInfo(provider, model, signal)).inputModalities?.includes("image") === true;
	} catch {
		return false;
	}
}
//#endregion
//#region src/xml.ts
/**
* Parse a `[left,top][right,bottom]` bounds string.
* @param raw - the attribute value, e.g. `"[0,0][1080,2414]"`.
* @returns the numeric bounds, or null when the string does not match.
*/
function parseBounds(raw) {
	const match = /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(raw);
	if (match === null) return null;
	return {
		left: Number(match[1]),
		top: Number(match[2]),
		right: Number(match[3]),
		bottom: Number(match[4])
	};
}
/** Compute the center of a bounds rect. */
function centerOfBounds(bounds) {
	return {
		x: Math.floor((bounds.left + bounds.right) / 2),
		y: Math.floor((bounds.top + bounds.bottom) / 2)
	};
}
/** Decode the five XML entity references uiautomator emits. */
function decodeEntities(value) {
	return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'");
}
/**
* Extract one attribute value from a `<node ...>` tag string.
* @param tag - the raw `<node ...` text up to the closing `>` or `/>`.
* @param name - the attribute name without quotes.
* @returns the decoded value, or empty string when absent.
*/
function attrValue(tag, name) {
	const match = new RegExp(`${name}="((?:[^"&]|&(?:amp|lt|gt|quot|apos);)*)"`, "u").exec(tag);
	if (match === null) return "";
	return decodeEntities(match[1]);
}
/** Parse a boolean attribute: `"true"` → true, everything else → false. */
function boolAttr(tag, name) {
	return attrValue(tag, name) === "true";
}
/**
* Scan the XML for all `<node>` opening, self-closing, and closing tags in
* document order. Closing tags are tracked so depth stays accurate.
*/
const TAG_PATTERN = /<(\/?)node\b([^>]*?)(\/?)>/gu;
function scanTags(xml) {
	const tags = [];
	let match;
	const pattern = new RegExp(TAG_PATTERN);
	while ((match = pattern.exec(xml)) !== null) {
		const closing = match[1] === "/";
		const selfClosing = !closing && match[3] === "/";
		tags.push({
			raw: match[0],
			closing,
			selfClosing
		});
	}
	return tags;
}
/**
* Parse a uiautomator dump XML into a flat node list with screen metadata.
*
* The root `<hierarchy rotation="N">` element carries the rotation; the
* screen dimensions are read from the first (root) node's bounds, which
* uiautomator always emits as the full display rectangle.
*
* Closing `</node>` tags are tracked so `depth` accurately reflects the tree
* nesting level (root node = depth 0, its children = depth 1, etc.).
*
* @param xml - the raw XML string from `uiautomator dump` + `cat`.
* @returns the parsed dump. Empty/malformed XML yields zero nodes and
*   zero dimensions rather than throwing (the model still gets a result).
*/
function parseUiDumpXml(xml) {
	const rotationMatch = /rotation="(-?\d+)"/.exec(xml);
	const rotation = rotationMatch !== null ? Number(rotationMatch[1]) : 0;
	const tags = scanTags(xml);
	const nodes = [];
	let depth = 0;
	let screenWidth = 0;
	let screenHeight = 0;
	let isFirstNode = true;
	for (const tag of tags) {
		if (tag.closing) {
			if (depth > 0) depth -= 1;
			continue;
		}
		const raw = tag.raw;
		const boundsRaw = attrValue(raw, "bounds");
		const bounds = boundsRaw !== "" ? parseBounds(boundsRaw) : null;
		if (isFirstNode && bounds !== null) {
			screenWidth = bounds.right;
			screenHeight = bounds.bottom;
			isFirstNode = false;
		}
		const node = {
			text: attrValue(raw, "text"),
			content_desc: attrValue(raw, "content-desc"),
			resource_id: attrValue(raw, "resource-id"),
			class: attrValue(raw, "class"),
			package: attrValue(raw, "package"),
			bounds,
			center: bounds !== null ? centerOfBounds(bounds) : null,
			clickable: boolAttr(raw, "clickable"),
			long_clickable: boolAttr(raw, "long-clickable"),
			focusable: boolAttr(raw, "focusable"),
			scrollable: boolAttr(raw, "scrollable"),
			enabled: boolAttr(raw, "enabled"),
			password: boolAttr(raw, "password"),
			selected: boolAttr(raw, "selected"),
			checked: boolAttr(raw, "checked"),
			depth
		};
		nodes.push(node);
		if (!tag.selfClosing) depth += 1;
	}
	return {
		rotation,
		screen_width: screenWidth,
		screen_height: screenHeight,
		nodes
	};
}
//#endregion
//#region src/image.ts
/**
* image.ts — fit a PNG within the attachment store's per-side pixel limit.
*
* The attachment store enforces `maxImageDimension` (2000px by default).
* This module downscales only when necessary, returning a scale factor so
* callers can map device-native coordinates to image space for annotation.
*
* @module @huanlin/dsh-plugin-android-use/src/image
*/
/**
* Compute the uniform scale factor applied when a screenshot of the given
* device resolution is fit within `maxDimension`.
*
* The scale is uniform (same for X and Y) because `fitToMaxDimension` uses
* `fit: 'inside'` which preserves aspect ratio.
*
* @returns a value in (0, 1]. Returns 1 when no scaling is needed.
*/
function computeScale(deviceWidth, deviceHeight, maxDimension) {
	if (deviceWidth <= 0 || deviceHeight <= 0) return 1;
	return Math.min(1, maxDimension / Math.max(deviceWidth, deviceHeight));
}
/**
* Downscale a PNG so its longest side fits within `maxDimension`, preserving
* aspect ratio. Returns the original bytes unchanged when already within the
* limit. Uses `sharp` for the resize.
*
* @param data - the raw PNG bytes from `screencap -p`.
* @param maxDimension - the attachment store's per-side pixel limit.
*/
async function fitToMaxDimension(data, maxDimension) {
	const sharp = (await import("sharp")).default;
	let meta;
	try {
		meta = await sharp(data).metadata();
	} catch {
		throw new Error("screencap returned an image with no dimensions");
	}
	const origW = meta.width ?? 0;
	const origH = meta.height ?? 0;
	if (origW === 0 || origH === 0) throw new Error("screencap returned an image with no dimensions");
	if (Math.max(origW, origH) <= maxDimension) return {
		data,
		width: origW,
		height: origH,
		scaleX: 1,
		scaleY: 1
	};
	const result = await sharp(data, {
		failOn: "error",
		limitInputPixels: false
	}).resize({
		width: maxDimension,
		height: maxDimension,
		fit: "inside",
		withoutEnlargement: true
	}).png().toBuffer({ resolveWithObject: true });
	return {
		data: new Uint8Array(result.data),
		width: result.info.width,
		height: result.info.height,
		scaleX: result.info.width / origW,
		scaleY: result.info.height / origH
	};
}
//#endregion
//#region src/tools/screen.ts
function renderScreenshot(_args, value) {
	const v = value;
	const text = [
		`Screenshot captured: ${v.width}x${v.height} px, ${v.bytes} bytes (image/png).`,
		`Device resolution: ${v.device_width}x${v.device_height}, scale: ${v.scale.toFixed(4)}.`,
		`Coordinates from android_ui_dump and android_tap use the ${v.width}x${v.height} image space.`,
		`Image emitted to model context: ${v.image_emitted ? "yes" : "no"}${v.image_emitted ? "" : " (current route is not image-capable; use android_ui_dump for screen perception)"}.`
	].join("\n");
	if (v.image_emitted) {
		const ref = {
			attachmentId: v.image.attachmentId,
			mediaType: "image/png",
			bytes: v.image.bytes,
			width: v.image.width,
			height: v.image.height
		};
		return [{
			type: "text",
			text
		}, {
			type: "image",
			attachment: ref
		}];
	}
	return [{
		type: "text",
		text
	}];
}
function nodeToTextLine(node, index) {
	const parts = [`[${index}]`];
	if (node.text !== "") parts.push(`text=${JSON.stringify(node.text)}`);
	if (node.content_desc !== "") parts.push(`desc=${JSON.stringify(node.content_desc)}`);
	if (node.resource_id !== "") parts.push(`id=${node.resource_id}`);
	parts.push(`class=${node.class}`);
	if (node.bounds !== null) parts.push(`bounds=[${node.bounds.left},${node.bounds.top}][${node.bounds.right},${node.bounds.bottom}]`);
	if (node.center !== null) parts.push(`center=(${node.center.x},${node.center.y})`);
	const flags = [];
	if (node.clickable) flags.push("clickable");
	if (node.long_clickable) flags.push("long-clickable");
	if (node.scrollable) flags.push("scrollable");
	if (node.focusable) flags.push("focusable");
	if (!node.enabled) flags.push("disabled");
	if (node.checked) flags.push("checked");
	if (node.password) flags.push("password");
	if (node.selected) flags.push("selected");
	if (flags.length > 0) parts.push(flags.join(","));
	return `  ${parts.join(" | ")}`;
}
function scaleDump(dump, scale) {
	if (scale >= 1) return dump;
	const r = (n) => Math.round(n * scale);
	const nodes = dump.nodes.map((node) => ({
		...node,
		bounds: node.bounds !== null ? {
			left: r(node.bounds.left),
			top: r(node.bounds.top),
			right: r(node.bounds.right),
			bottom: r(node.bounds.bottom)
		} : null,
		center: node.center !== null ? {
			x: r(node.center.x),
			y: r(node.center.y)
		} : null
	}));
	return {
		rotation: dump.rotation,
		screen_width: dump.screen_width,
		screen_height: dump.screen_height,
		nodes
	};
}
function renderUiDump(_args, value) {
	const v = value;
	const total = v.nodes.length;
	const interactive = v.nodes.filter((n) => n.text !== "" || n.content_desc !== "" || n.clickable || n.long_clickable || n.scrollable || n.focusable);
	const lines = [
		`UI dump: ${total} nodes total (${interactive.length} interactive/text), screen ${v.screen_width}x${v.screen_height}, rotation ${v.rotation}.`,
		`Coordinates are in screenshot image space (${v.image_width}x${v.image_height}, scale ${v.scale.toFixed(4)}). Use these center values directly with android_tap.`,
		`Showing ${interactive.length} interactive/text nodes:`
	];
	let idx = 0;
	for (const node of v.nodes) {
		if (!(node.text !== "" || node.content_desc !== "" || node.clickable || node.long_clickable || node.scrollable || node.focusable)) continue;
		lines.push(nodeToTextLine(node, idx));
		idx++;
	}
	return [{
		type: "text",
		text: lines.join("\n")
	}];
}
/** Register `android_screenshot` and `android_ui_dump`. */
function registerScreenTools(ctx, deps) {
	ctx.tools.register(defineTool({
		name: "android_screenshot",
		description: "Capture a screenshot from the Android device. The image may be scaled to fit the attachment store pixel limit; the result includes device_width, device_height, and scale so you know the mapping. Coordinates from android_ui_dump and android_tap use the scaled image space. The image is always saved to the attachment store (visible in the UI card). The image is emitted to the model only when the current model route accepts image input; otherwise, use android_ui_dump for text-based screen perception. Pass \"serial\" to target a specific device.",
		parameters: { serial: {
			type: "string",
			description: "Device serial. Omit when only one device is attached; required when multiple are connected."
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					serial: {
						type: "string",
						required: true
					},
					width: {
						type: "integer",
						required: true
					},
					height: {
						type: "integer",
						required: true
					},
					bytes: {
						type: "integer",
						required: true
					},
					device_width: {
						type: "integer",
						required: true
					},
					device_height: {
						type: "integer",
						required: true
					},
					scale: {
						type: "number",
						required: true
					},
					image: {
						type: "object",
						additionalProperties: false,
						required: true,
						properties: {
							attachmentId: {
								type: "string",
								required: true
							},
							mediaType: {
								type: "string",
								const: "image/png",
								required: true
							},
							bytes: {
								type: "integer",
								required: true
							},
							width: {
								type: "integer",
								required: true
							},
							height: {
								type: "integer",
								required: true
							}
						}
					},
					image_emitted: {
						type: "boolean",
						required: true
					}
				}
			},
			render: renderScreenshot
		},
		async execute(args, exec) {
			const a = args;
			const config = deps.getConfig();
			const { serial } = await resolveSerial(deps.adb, a.serial, config.defaultSerial, exec.signal);
			const attachments = ctx.get("attachments");
			if (attachments === void 0) throw new Error("cannot capture screenshot: no attachment service is mounted");
			const raw = await deps.adb.execOutBinary(serial, "screencap -p", exec.signal);
			const fitted = await fitToMaxDimension(new Uint8Array(raw), attachments.imageLimits.maxImageDimension);
			const ref = await attachments.saveImage({
				data: fitted.data,
				mediaType: "image/png",
				name: "screenshot.png"
			});
			const imageEmitted = await routeIsImageCapable(ctx, exec, exec.signal);
			const scale = fitted.scaleX;
			return {
				serial,
				width: ref.width,
				height: ref.height,
				bytes: ref.bytes,
				device_width: Math.round(ref.width / fitted.scaleX),
				device_height: Math.round(ref.height / fitted.scaleY),
				scale,
				image: {
					attachmentId: ref.attachmentId,
					mediaType: "image/png",
					bytes: ref.bytes,
					width: ref.width,
					height: ref.height
				},
				image_emitted: imageEmitted
			};
		}
	}));
	ctx.tools.register(defineTool({
		name: "android_ui_dump",
		description: "Dump the Android accessibility tree (UI hierarchy) as a structured node list. Each node includes text, content description, resource-id, class, bounds, center coordinates, and interaction flags (clickable, scrollable, etc.). All coordinates are in screenshot image space (scaled to match the screenshot from android_screenshot). Use node \"center\" values directly with android_tap. Pass \"serial\" to target a specific device.",
		parameters: { serial: {
			type: "string",
			description: "Device serial. Omit when only one device is attached; required when multiple are connected."
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					serial: {
						type: "string",
						required: true
					},
					screen_width: {
						type: "integer",
						required: true
					},
					screen_height: {
						type: "integer",
						required: true
					},
					image_width: {
						type: "integer",
						required: true
					},
					image_height: {
						type: "integer",
						required: true
					},
					scale: {
						type: "number",
						required: true
					},
					rotation: {
						type: "integer",
						required: true
					},
					nodes: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								text: {
									type: "string",
									required: true
								},
								content_desc: {
									type: "string",
									required: true
								},
								resource_id: {
									type: "string",
									required: true
								},
								class: {
									type: "string",
									required: true
								},
								package: {
									type: "string",
									required: true
								},
								bounds: {
									oneOf: [{ type: "null" }, {
										type: "object",
										additionalProperties: false,
										properties: {
											left: {
												type: "integer",
												required: true
											},
											top: {
												type: "integer",
												required: true
											},
											right: {
												type: "integer",
												required: true
											},
											bottom: {
												type: "integer",
												required: true
											}
										}
									}],
									required: true
								},
								center: {
									oneOf: [{ type: "null" }, {
										type: "object",
										additionalProperties: false,
										properties: {
											x: {
												type: "integer",
												required: true
											},
											y: {
												type: "integer",
												required: true
											}
										}
									}],
									required: true
								},
								clickable: {
									type: "boolean",
									required: true
								},
								long_clickable: {
									type: "boolean",
									required: true
								},
								focusable: {
									type: "boolean",
									required: true
								},
								scrollable: {
									type: "boolean",
									required: true
								},
								enabled: {
									type: "boolean",
									required: true
								},
								password: {
									type: "boolean",
									required: true
								},
								selected: {
									type: "boolean",
									required: true
								},
								checked: {
									type: "boolean",
									required: true
								},
								depth: {
									type: "integer",
									required: true
								}
							}
						}
					}
				}
			},
			render: renderUiDump
		},
		async execute(args, exec) {
			const a = args;
			const config = deps.getConfig();
			const { serial } = await resolveSerial(deps.adb, a.serial, config.defaultSerial, exec.signal);
			const dumpPath = `/sdcard/dsh_ui_dump_${Date.now()}.xml`;
			await deps.adb.shell(serial, `uiautomator dump ${dumpPath}`, exec.signal);
			const dump = parseUiDumpXml(await deps.adb.execOut(serial, `cat ${dumpPath}`, exec.signal));
			const maxDim = ctx.get("attachments")?.imageLimits.maxImageDimension ?? Infinity;
			const scale = computeScale(dump.screen_width, dump.screen_height, maxDim);
			const scaled = scaleDump(dump, scale);
			return {
				serial,
				screen_width: dump.screen_width,
				screen_height: dump.screen_height,
				image_width: Math.round(dump.screen_width * scale),
				image_height: Math.round(dump.screen_height * scale),
				scale,
				rotation: dump.rotation,
				nodes: scaled.nodes
			};
		}
	}));
}
//#endregion
//#region src/annotate.ts
/**
* Overlay a prominent tap marker on a PNG at device-native coordinates.
*
* The marker is a layered target: outer glow zone, white-bordered red ring,
* solid center dot, and long crosshair arms — designed to be visible on any
* background.
*
* @param png - the original PNG bytes (no scaling).
* @param x - tap X in device pixels.
* @param y - tap Y in device pixels.
* @returns the annotated PNG bytes and dimensions.
*/
async function annotateTap(png, x, y) {
	const sharp = (await import("sharp")).default;
	let meta;
	try {
		meta = await sharp(png).metadata();
	} catch {
		throw new Error("cannot annotate: screenshot has no dimensions");
	}
	const width = meta.width ?? 0;
	const height = meta.height ?? 0;
	if (width === 0 || height === 0) throw new Error("cannot annotate: screenshot has no dimensions");
	const r = Math.max(28, Math.round(Math.min(width, height) * .04));
	const ringW = Math.max(4, Math.round(r * .14));
	const lineW = Math.max(3, Math.round(r * .1));
	const armLen = r * 2.4;
	const red = "#FF1744";
	const white = "#FFFFFF";
	const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><circle cx="${x}" cy="${y}" r="${Math.round(r * 2.2)}" fill="${red}" opacity="0.08"/><circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${white}" stroke-width="${ringW + 4}" opacity="0.45"/><circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${red}" stroke-width="${ringW}" opacity="0.9"/><circle cx="${x}" cy="${y}" r="${Math.round(r * .82)}" fill="none" stroke="${white}" stroke-width="2" opacity="0.5"/><line x1="${Math.round(x - armLen)}" y1="${y}" x2="${Math.round(x + armLen)}" y2="${y}" stroke="${white}" stroke-width="${lineW + 3}" opacity="0.35"/><line x1="${x}" y1="${Math.round(y - armLen)}" x2="${x}" y2="${Math.round(y + armLen)}" stroke="${white}" stroke-width="${lineW + 3}" opacity="0.35"/><line x1="${Math.round(x - armLen)}" y1="${y}" x2="${Math.round(x + armLen)}" y2="${y}" stroke="${red}" stroke-width="${lineW}" opacity="0.8"/><line x1="${x}" y1="${Math.round(y - armLen)}" x2="${x}" y2="${Math.round(y + armLen)}" stroke="${red}" stroke-width="${lineW}" opacity="0.8"/><circle cx="${x}" cy="${y}" r="${Math.round(r * .24)}" fill="none" stroke="${white}" stroke-width="2" opacity="0.6"/><circle cx="${x}" cy="${y}" r="${Math.round(r * .24)}" fill="${red}" opacity="0.85"/></svg>`;
	const buf = await sharp(png).composite([{
		input: Buffer.from(svg),
		top: 0,
		left: 0
	}]).png().toBuffer();
	return {
		data: new Uint8Array(buf),
		width,
		height
	};
}
//#endregion
//#region src/keys.ts
/**
* keys.ts — named Android keycode table for `android_press_key`.
*
* Maps human-readable key names to Android `KeyEvent` keycode integers.
* The model may pass either a named key (`"home"`, `"back"`) or a bare
* integer keycode; `resolveKey` normalizes both into a numeric keycode.
*
* @module @huanlin/dsh-plugin-android-use/src/keys
*/
/** Named key → Android keycode. Source: android.view.KeyEvent constants. */
const KEY_CODES = {
	home: 3,
	back: 4,
	call: 5,
	endcall: 6,
	"0": 7,
	"1": 8,
	"2": 9,
	"3": 10,
	"4": 11,
	"5": 12,
	"6": 13,
	"7": 14,
	"8": 15,
	"9": 16,
	star: 17,
	pound: 18,
	dpad_up: 19,
	dpad_down: 20,
	dpad_left: 21,
	dpad_right: 22,
	dpad_center: 23,
	volume_up: 24,
	volume_down: 25,
	power: 26,
	camera: 27,
	clear: 28,
	a: 29,
	b: 30,
	c: 31,
	d: 32,
	e: 33,
	f: 34,
	g: 35,
	h: 36,
	i: 37,
	j: 38,
	k: 39,
	l: 40,
	m: 41,
	n: 42,
	o: 43,
	p: 44,
	q: 45,
	r: 46,
	s: 47,
	t: 48,
	u: 49,
	v: 50,
	w: 51,
	x: 52,
	y: 53,
	z: 54,
	comma: 55,
	period: 56,
	alt_left: 57,
	alt_right: 58,
	shift_left: 59,
	shift_right: 60,
	tab: 61,
	space: 62,
	sym: 63,
	explorer: 64,
	envelope: 65,
	enter: 66,
	del: 67,
	backspace: 67,
	grave: 68,
	minus: 69,
	equals: 70,
	left_bracket: 71,
	right_bracket: 72,
	backslash: 73,
	semicolon: 74,
	apostrophe: 75,
	slash: 76,
	at: 77,
	num: 78,
	headsethook: 79,
	focus: 80,
	plus: 81,
	menu: 82,
	notification: 83,
	search: 84,
	media_play_pause: 85,
	media_stop: 86,
	media_next: 87,
	media_previous: 88,
	media_rewind: 89,
	media_fast_forward: 90,
	mute: 91,
	page_up: 92,
	page_down: 93,
	pict_symbols: 94,
	switch_charset: 95,
	button_a: 96,
	button_b: 97,
	button_c: 98,
	button_x: 99,
	button_y: 100,
	button_z: 101,
	button_l1: 102,
	button_r1: 103,
	button_l2: 104,
	button_r2: 105,
	button_thumbl: 106,
	button_thumbr: 107,
	button_start: 108,
	button_select: 109,
	button_mode: 110,
	escape: 111,
	forward_del: 112,
	delete: 112,
	ctrl_left: 113,
	ctrl_right: 114,
	caps_lock: 115,
	scroll_lock: 116,
	meta_left: 117,
	meta_right: 118,
	function: 119,
	sysrq: 120,
	break: 121,
	move_home: 122,
	move_end: 123,
	insert: 124,
	forward: 125,
	media_play: 126,
	media_pause: 127,
	media_close: 128,
	media_eject: 129,
	media_record: 130,
	f1: 131,
	f2: 132,
	f3: 133,
	f4: 134,
	f5: 135,
	f6: 136,
	f7: 137,
	f8: 138,
	f9: 139,
	f10: 140,
	f11: 141,
	f12: 142,
	num_lock: 143,
	numpad_0: 144,
	numpad_1: 145,
	numpad_2: 146,
	numpad_3: 147,
	numpad_4: 148,
	numpad_5: 149,
	numpad_6: 150,
	numpad_7: 151,
	numpad_8: 152,
	numpad_9: 153,
	numpad_add: 154,
	numpad_subtract: 155,
	numpad_multiply: 156,
	numpad_divide: 157,
	numpad_dot: 158,
	numpad_comma: 159,
	numpad_enter: 160,
	numpad_equals: 161,
	numpad_left_paren: 162,
	numpad_right_paren: 163,
	volume_mute: 164,
	info: 165,
	channel_up: 166,
	channel_down: 167,
	zoom_in: 168,
	zoom_out: 169,
	tv: 170,
	window: 171,
	guide: 172,
	dvr: 173,
	bookmark: 174,
	captions: 175,
	settings: 176,
	tv_power: 177,
	tv_input: 178,
	stb_power: 179,
	stb_input: 180,
	avr_power: 181,
	avr_input: 182,
	prog_red: 183,
	prog_green: 184,
	prog_yellow: 185,
	prog_blue: 186,
	app_switch: 187,
	button_1: 188,
	button_2: 189,
	button_3: 190,
	button_4: 191,
	button_5: 192,
	button_6: 193,
	button_7: 194,
	button_8: 195,
	button_9: 196,
	button_10: 197,
	button_11: 198,
	button_12: 199,
	button_13: 200,
	button_14: 201,
	button_15: 202,
	button_16: 203,
	language_switch: 204,
	manner_mode: 205,
	"3d_mode": 206,
	contacts: 207,
	calendar: 208,
	music: 209,
	calculator: 210,
	zenkaku_hankaku: 211,
	eisu: 212,
	muhenkan: 213,
	henkan: 214,
	katakana_hiragana: 215,
	yen: 216,
	ro: 217,
	kana: 218,
	assist: 219,
	brightness_down: 220,
	brightness_up: 221,
	media_audio_track: 222,
	sleep: 223,
	wakeup: 224,
	soft_sleep: 225,
	cut: 277,
	copy: 278,
	paste: 279,
	system_navigation_up: 280,
	system_navigation_down: 281,
	system_navigation_left: 282,
	system_navigation_right: 283,
	all_apps: 284,
	refresh: 285
};
/**
* Resolve a key name or raw keycode into a numeric Android keycode.
* @param input - named key (case-insensitive, e.g. `"home"`, `"BACK"`) or a
*   string/number representing a raw keycode integer.
* @returns the numeric keycode.
* @throws when the name is unknown and the input is not a valid integer.
*/
function resolveKey(input) {
	if (typeof input === "number") {
		if (!Number.isInteger(input)) throw new Error(`keycode must be an integer, got ${input}`);
		return input;
	}
	const asNum = Number(input);
	if (input.trim() !== "" && Number.isInteger(asNum) && String(asNum) === input.trim()) return asNum;
	const lower = input.toLowerCase();
	const code = KEY_CODES[lower];
	if (code === void 0) throw new Error(`unknown key name "${input}"; pass a named key (e.g. "home", "back") or a raw integer keycode`);
	return code;
}
//#endregion
//#region src/tools/input.ts
/**
* Escape text for `adb shell input text`. Spaces become `%s` and shell
* metacharacters are backslash-escaped. Non-ASCII characters are rejected
* (the `input` command cannot encode them).
* @param text - the raw text to escape.
* @returns the escaped text safe for `adb shell input text`.
* @throws when the text contains non-ASCII characters.
*/
function escapeInputText(text) {
	for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 127) throw new Error(`the "input" text mode cannot encode non-ASCII character "${text[i]}" (U+${text.charCodeAt(i).toString(16).toUpperCase()}); set the plugin config inputTextMode to "adbkeyboard" to inject Unicode text via ADBKeyboard`);
	let out = "";
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		switch (ch) {
			case " ":
				out += "%s";
				break;
			case "&":
			case "<":
			case ">":
			case ";":
			case "(":
			case ")":
			case "|":
			case "^":
			case "*":
			case "~":
			case "\"":
			case "'":
			case "`":
			case "$":
			case "!":
			case "#":
				out += "\\" + ch;
				break;
			case "\\":
				out += "\\\\";
				break;
			default: out += ch;
		}
	}
	return out;
}
/**
* URL-encode text for ADBKeyboard broadcast injection (`am broadcast -a ADB_INPUT_TEXT --es msg <encoded>`).
* @param text - the raw text to encode (any Unicode).
* @returns the percent-encoded text.
*/
function encodeAdbKeyboard(text) {
	return encodeURIComponent(text);
}
function renderTap(_args, value) {
	const v = value;
	const lines = [`Tap at image (${v.x}, ${v.y}) → device (${v.device_x}, ${v.device_y}) on ${v.serial}: ${v.action} ×${v.times}` + (v.duration_ms > 0 ? ` (${v.duration_ms}ms)` : "")];
	if (v.pre_tap_screenshot !== null) lines.push(`Pre-tap screenshot (annotated with tap position marker): ${v.pre_tap_screenshot.width}x${v.pre_tap_screenshot.height} px, ${v.pre_tap_screenshot.bytes} bytes.`);
	else lines.push("No pre-tap screenshot (attachment store unavailable or capture failed).");
	if (v.post_tap_screenshot !== null) lines.push(`Post-tap screenshot (showing the screen result after tap): ${v.post_tap_screenshot.width}x${v.post_tap_screenshot.height} px, ${v.post_tap_screenshot.bytes} bytes.`);
	else lines.push("No post-tap screenshot (attachment store unavailable or capture failed).");
	lines.push(`Images emitted to model: ${v.screenshot_emitted ? "yes" : "no"}.`);
	const blocks = [{
		type: "text",
		text: lines.join("\n")
	}];
	if (v.screenshot_emitted) {
		if (v.pre_tap_screenshot !== null) {
			blocks.push({
				type: "text",
				text: "Pre-tap screenshot (annotated with tap position marker):"
			});
			blocks.push({
				type: "image",
				attachment: {
					attachmentId: v.pre_tap_screenshot.attachmentId,
					mediaType: "image/png",
					bytes: v.pre_tap_screenshot.bytes,
					width: v.pre_tap_screenshot.width,
					height: v.pre_tap_screenshot.height
				}
			});
		}
		if (v.post_tap_screenshot !== null) {
			blocks.push({
				type: "text",
				text: "Post-tap screenshot (showing the screen result after tap):"
			});
			blocks.push({
				type: "image",
				attachment: {
					attachmentId: v.post_tap_screenshot.attachmentId,
					mediaType: "image/png",
					bytes: v.post_tap_screenshot.bytes,
					width: v.post_tap_screenshot.width,
					height: v.post_tap_screenshot.height
				}
			});
		}
	}
	return blocks;
}
function renderSwipe(value) {
	return `Swipe image (${value.x1}, ${value.y1}) → (${value.x2}, ${value.y2}) / device (${value.device_x1}, ${value.device_y1}) → (${value.device_x2}, ${value.device_y2}) on ${value.serial}` + (value.duration_ms > 0 ? ` over ${value.duration_ms}ms` : "");
}
function renderPressKey(value) {
	return `Pressed key "${value.key}" (keycode ${value.keycode}) on ${value.serial} ×${value.times}`;
}
function renderInputText(value) {
	const lines = [`Input text on ${value.serial} (mode: ${value.mode}):`, `  text: ${JSON.stringify(value.text)}`];
	if (value.submitted) lines.push("  submitted (Enter pressed)");
	return lines.join("\n");
}
function textRender$1(fn) {
	return (_args, value) => [{
		type: "text",
		text: fn(value)
	}];
}
/** Register `android_tap`, `android_swipe`, `android_press_key`, `android_input_text`. */
function registerInputTools(ctx, deps) {
	ctx.tools.register(defineTool({
		name: "android_tap",
		description: "Tap a point on the Android screen. Pass (x, y) in screenshot image coordinates — the same coordinate space as the pixels in android_screenshot and the \"center\" values from android_ui_dump. The plugin automatically converts these to device-native coordinates for execution. Use `duration_ms` for a long-press (hold). Use `times` to repeat the tap. A pre-tap screenshot annotated with a marker at the tap position is captured and returned when an attachment store is available.",
		parameters: {
			x: {
				type: "integer",
				required: true,
				description: "X coordinate in screenshot image space."
			},
			y: {
				type: "integer",
				required: true,
				description: "Y coordinate in screenshot image space."
			},
			duration_ms: {
				type: "integer",
				description: "Hold duration in milliseconds. When > 0, performs a long-press (swipe-to-same-point) instead of a quick tap."
			},
			times: {
				type: "integer",
				description: "Number of times to repeat the tap (default 1)."
			},
			serial: {
				type: "string",
				description: "Device serial. Omit when only one device is attached; required when multiple are connected."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					serial: {
						type: "string",
						required: true
					},
					x: {
						type: "integer",
						required: true
					},
					y: {
						type: "integer",
						required: true
					},
					device_x: {
						type: "integer",
						required: true
					},
					device_y: {
						type: "integer",
						required: true
					},
					duration_ms: {
						type: "integer",
						required: true
					},
					times: {
						type: "integer",
						required: true
					},
					action: {
						type: "string",
						enum: ["tap", "long_press"],
						required: true
					},
					pre_tap_screenshot: {
						oneOf: [{ type: "null" }, {
							type: "object",
							additionalProperties: false,
							properties: {
								attachmentId: {
									type: "string",
									required: true
								},
								bytes: {
									type: "integer",
									required: true
								},
								width: {
									type: "integer",
									required: true
								},
								height: {
									type: "integer",
									required: true
								}
							}
						}],
						required: true
					},
					post_tap_screenshot: {
						oneOf: [{ type: "null" }, {
							type: "object",
							additionalProperties: false,
							properties: {
								attachmentId: {
									type: "string",
									required: true
								},
								bytes: {
									type: "integer",
									required: true
								},
								width: {
									type: "integer",
									required: true
								},
								height: {
									type: "integer",
									required: true
								}
							}
						}],
						required: true
					},
					screenshot_emitted: {
						type: "boolean",
						required: true
					}
				}
			},
			render: renderTap
		},
		async execute(args, exec) {
			const a = args;
			const config = deps.getConfig();
			const { serial } = await resolveSerial(deps.adb, a.serial, config.defaultSerial, exec.signal);
			const dur = typeof a.duration_ms === "number" && a.duration_ms > 0 ? a.duration_ms : 0;
			const times = typeof a.times === "number" && a.times > 0 ? a.times : 1;
			const action = dur > 0 ? "long_press" : "tap";
			let preScreenshot = null;
			let postScreenshot = null;
			let screenshotEmitted = false;
			const attachments = ctx.get("attachments");
			let scaleX = 1;
			let scaleY = 1;
			if (attachments !== void 0) try {
				const raw = await deps.adb.execOutBinary(serial, "screencap -p", exec.signal);
				const fitted = await fitToMaxDimension(new Uint8Array(raw), attachments.imageLimits.maxImageDimension);
				scaleX = fitted.scaleX;
				scaleY = fitted.scaleY;
				const annotated = await annotateTap(fitted.data, a.x, a.y);
				const ref = await attachments.saveImage({
					data: annotated.data,
					mediaType: "image/png",
					name: "pre_tap_screenshot.png"
				});
				preScreenshot = {
					attachmentId: ref.attachmentId,
					bytes: ref.bytes,
					width: ref.width,
					height: ref.height
				};
			} catch {}
			const deviceX = Math.round(a.x / scaleX);
			const deviceY = Math.round(a.y / scaleY);
			for (let i = 0; i < times; i++) if (dur > 0) await deps.adb.shell(serial, `input swipe ${deviceX} ${deviceY} ${deviceX} ${deviceY} ${dur}`, exec.signal);
			else await deps.adb.shell(serial, `input tap ${deviceX} ${deviceY}`, exec.signal);
			if (attachments !== void 0) try {
				await new Promise((resolve) => setTimeout(resolve, 500));
				const raw = await deps.adb.execOutBinary(serial, "screencap -p", exec.signal);
				const fitted = await fitToMaxDimension(new Uint8Array(raw), attachments.imageLimits.maxImageDimension);
				const ref = await attachments.saveImage({
					data: fitted.data,
					mediaType: "image/png",
					name: "post_tap_screenshot.png"
				});
				postScreenshot = {
					attachmentId: ref.attachmentId,
					bytes: ref.bytes,
					width: ref.width,
					height: ref.height
				};
				screenshotEmitted = await routeIsImageCapable(ctx, exec, exec.signal);
			} catch {}
			return {
				serial,
				x: a.x,
				y: a.y,
				device_x: deviceX,
				device_y: deviceY,
				duration_ms: dur,
				times,
				action,
				pre_tap_screenshot: preScreenshot,
				post_tap_screenshot: postScreenshot,
				screenshot_emitted: screenshotEmitted
			};
		}
	}));
	ctx.tools.register(defineTool({
		name: "android_swipe",
		description: "Swipe from one point to another on the Android screen. Pass start and end coordinates in screenshot image space (the same coordinate space as android_screenshot and android_ui_dump). The plugin automatically converts these to device-native coordinates for execution. Use `duration_ms` to control swipe speed (longer = slower).",
		parameters: {
			x1: {
				type: "integer",
				required: true,
				description: "Start X coordinate in screenshot image space."
			},
			y1: {
				type: "integer",
				required: true,
				description: "Start Y coordinate in screenshot image space."
			},
			x2: {
				type: "integer",
				required: true,
				description: "End X coordinate in screenshot image space."
			},
			y2: {
				type: "integer",
				required: true,
				description: "End Y coordinate in screenshot image space."
			},
			duration_ms: {
				type: "integer",
				description: "Swipe duration in milliseconds (default 300). Longer values produce slower swipes."
			},
			serial: {
				type: "string",
				description: "Device serial. Omit when only one device is attached; required when multiple are connected."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					serial: {
						type: "string",
						required: true
					},
					x1: {
						type: "integer",
						required: true
					},
					y1: {
						type: "integer",
						required: true
					},
					x2: {
						type: "integer",
						required: true
					},
					y2: {
						type: "integer",
						required: true
					},
					device_x1: {
						type: "integer",
						required: true
					},
					device_y1: {
						type: "integer",
						required: true
					},
					device_x2: {
						type: "integer",
						required: true
					},
					device_y2: {
						type: "integer",
						required: true
					},
					duration_ms: {
						type: "integer",
						required: true
					}
				}
			},
			render: textRender$1(renderSwipe)
		},
		async execute(args, exec) {
			const a = args;
			const config = deps.getConfig();
			const { serial } = await resolveSerial(deps.adb, a.serial, config.defaultSerial, exec.signal);
			const dur = typeof a.duration_ms === "number" && a.duration_ms > 0 ? a.duration_ms : 300;
			const attachments = ctx.get("attachments");
			let scale = 1;
			if (attachments !== void 0) {
				const { width: devW, height: devH } = parseWmSize$1(await deps.adb.shell(serial, "wm size", exec.signal));
				scale = computeScale(devW, devH, attachments.imageLimits.maxImageDimension);
			}
			const dx1 = Math.round(a.x1 / scale);
			const dy1 = Math.round(a.y1 / scale);
			const dx2 = Math.round(a.x2 / scale);
			const dy2 = Math.round(a.y2 / scale);
			await deps.adb.shell(serial, `input swipe ${dx1} ${dy1} ${dx2} ${dy2} ${dur}`, exec.signal);
			return {
				serial,
				x1: a.x1,
				y1: a.y1,
				x2: a.x2,
				y2: a.y2,
				device_x1: dx1,
				device_y1: dy1,
				device_x2: dx2,
				device_y2: dy2,
				duration_ms: dur
			};
		}
	}));
	ctx.tools.register(defineTool({
		name: "android_press_key",
		description: "Press a hardware/key event key on the Android device. Pass a named key (case-insensitive: \"home\", \"back\", \"app_switch\", \"power\", \"enter\", \"volume_up\", \"volume_down\", \"mute\", \"camera\", \"search\", \"menu\", \"escape\", \"delete\", \"tab\", \"space\", \"dpad_up\", \"dpad_down\", \"dpad_left\", \"dpad_right\", \"dpad_center\", etc.) or a raw integer keycode. Use `times` to repeat.",
		parameters: {
			key: {
				oneOf: [{
					type: "string",
					description: "Named key (case-insensitive), e.g. \"home\", \"back\", \"app_switch\"."
				}, {
					type: "integer",
					description: "Raw Android keycode integer."
				}],
				required: true,
				description: "Key to press: a named key or a raw integer keycode."
			},
			times: {
				type: "integer",
				description: "Number of times to repeat the key press (default 1)."
			},
			serial: {
				type: "string",
				description: "Device serial. Omit when only one device is attached; required when multiple are connected."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					serial: {
						type: "string",
						required: true
					},
					key: {
						type: "string",
						required: true
					},
					keycode: {
						type: "integer",
						required: true
					},
					times: {
						type: "integer",
						required: true
					}
				}
			},
			render: textRender$1(renderPressKey)
		},
		async execute(args, exec) {
			const a = args;
			const config = deps.getConfig();
			const { serial } = await resolveSerial(deps.adb, a.serial, config.defaultSerial, exec.signal);
			const keycode = resolveKey(a.key);
			const times = typeof a.times === "number" && a.times > 0 ? a.times : 1;
			const keyStr = typeof a.key === "number" ? String(a.key) : a.key;
			for (let i = 0; i < times; i++) await deps.adb.shell(serial, `input keyevent ${keycode}`, exec.signal);
			return {
				serial,
				key: keyStr,
				keycode,
				times
			};
		}
	}));
	ctx.tools.register(defineTool({
		name: "android_input_text",
		description: "Type text into the focused input field on the Android device. In \"input\" mode (default), only ASCII text is supported — non-ASCII characters require switching the plugin config `inputTextMode` to \"adbkeyboard\" (requires the ADBKeyboard IME installed on the device). Pass `submit: true` to press Enter after typing.",
		parameters: {
			text: {
				type: "string",
				required: true,
				description: "Text to type into the focused field."
			},
			submit: {
				type: "boolean",
				description: "When true, presses Enter (keycode 66) after typing the text."
			},
			serial: {
				type: "string",
				description: "Device serial. Omit when only one device is attached; required when multiple are connected."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					serial: {
						type: "string",
						required: true
					},
					text: {
						type: "string",
						required: true
					},
					mode: {
						type: "string",
						enum: ["input", "adbkeyboard"],
						required: true
					},
					submitted: {
						type: "boolean",
						required: true
					}
				}
			},
			render: textRender$1(renderInputText)
		},
		async execute(args, exec) {
			const a = args;
			const config = deps.getConfig();
			const { serial } = await resolveSerial(deps.adb, a.serial, config.defaultSerial, exec.signal);
			const mode = config.inputTextMode;
			const submitted = a.submit === true;
			if (mode === "adbkeyboard") {
				const encoded = encodeAdbKeyboard(a.text);
				await deps.adb.shell(serial, `am broadcast -a ADB_INPUT_TEXT --es msg "${encoded}"`, exec.signal);
			} else {
				const escaped = escapeInputText(a.text);
				await deps.adb.shell(serial, `input text "${escaped}"`, exec.signal);
			}
			if (submitted) await deps.adb.shell(serial, "input keyevent 66", exec.signal);
			return {
				serial,
				text: a.text,
				mode,
				submitted
			};
		}
	}));
}
//#endregion
//#region src/tools/apps.ts
/**
* Parse `dumpsys window` output for the current focus window.
*
* Example line: `  mCurrentFocus=Window{f6144b2 u0 com.android.launcher/com.android.launcher.Launcher}`
* Also handles `mCurrentFocus=null` (display off or no focused window).
* @param output - the grep-filtered dumpsys window output.
* @returns the package and activity, or null when no window is focused.
*/
function parseForegroundApp(output) {
	const lines = output.split(/\r?\n/);
	let lastFocus = null;
	for (const line of lines) {
		const match = /mCurrentFocus=(.+)/.exec(line.trim());
		if (match !== null) lastFocus = match[1];
	}
	if (lastFocus === null) return null;
	if (lastFocus === "null") return null;
	const windowMatch = /Window\{[^}]*?\s+([^/\s}]+)\/([^\s}]+)\s*\}/.exec(lastFocus);
	if (windowMatch !== null) return {
		package: windowMatch[1],
		activity: windowMatch[2],
		windowTitle: null
	};
	const pairMatch = /([a-zA-Z0-9_.]+)\/([a-zA-Z0-9_.]+)/.exec(lastFocus);
	if (pairMatch !== null) return {
		package: pairMatch[1],
		activity: pairMatch[2],
		windowTitle: null
	};
	return {
		package: lastFocus,
		activity: "",
		windowTitle: lastFocus
	};
}
/** Parse `dumpsys power` output for the wakefulness state. */
function parseWakefulness(output) {
	return /mWakefulness=Awake/.test(output);
}
function renderOpenApp(value) {
	return `Opened app ${value.activity !== void 0 ? `${value.package}/${value.activity}` : value.package} on ${value.serial}: ${value.started ? "started" : "failed"}`;
}
function renderForegroundApp(value) {
	if (value.package === null) return `No focused window on ${value.serial} (screen on: ${value.screen_on}).`;
	const lines = [
		`Foreground app on ${value.serial}:`,
		`  package: ${value.package}`,
		`  activity: ${value.activity ?? "(unknown)"}`
	];
	if (value.window_title !== null) lines.push(`  window: ${value.window_title}`);
	lines.push(`  screen on: ${value.screen_on}`);
	return lines.join("\n");
}
function textRender(fn) {
	return (_args, value) => [{
		type: "text",
		text: fn(value)
	}];
}
/** Register `android_open_app` and `android_foreground_app`. */
function registerAppTools(ctx, deps) {
	ctx.tools.register(defineTool({
		name: "android_open_app",
		description: "Open an app on the Android device by package name. If you know the specific activity, pass it; otherwise the app's default launcher activity is started via monkey. Example packages: \"com.android.settings\", \"com.android.chrome\", \"com.tencent.mm\" (WeChat).",
		parameters: {
			package: {
				type: "string",
				required: true,
				description: "Android package name, e.g. \"com.android.settings\"."
			},
			activity: {
				type: "string",
				description: "Specific activity to start (e.g. \".Settings\"). Omit to launch the app's default activity."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					serial: {
						type: "string",
						required: true
					},
					package: {
						type: "string",
						required: true
					},
					activity: { type: "string" },
					started: {
						type: "boolean",
						required: true
					}
				}
			},
			render: textRender(renderOpenApp)
		},
		async execute(args, exec) {
			const a = args;
			const config = deps.getConfig();
			const { serial } = await resolveSerial(deps.adb, void 0, config.defaultSerial, exec.signal);
			if (a.activity !== void 0 && a.activity !== "") {
				const fullActivity = a.activity.startsWith(".") ? `${a.package}${a.activity}` : a.activity;
				await deps.adb.shell(serial, `am start -n ${a.package}/${fullActivity}`, exec.signal);
			} else await deps.adb.shell(serial, `monkey -p ${a.package} -c android.intent.category.LAUNCHER 1`, exec.signal);
			const result = {
				serial,
				package: a.package,
				started: true
			};
			if (a.activity !== void 0 && a.activity !== "") result.activity = a.activity;
			return result;
		}
	}));
	ctx.tools.register(defineTool({
		name: "android_foreground_app",
		description: "Get the currently focused/foreground app and activity on the Android device. Also reports whether the screen is on. Useful for verifying which app is visible after opening an app or pressing home.",
		parameters: { serial: {
			type: "string",
			description: "Device serial. Omit when only one device is attached; required when multiple are connected."
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					serial: {
						type: "string",
						required: true
					},
					package: {
						oneOf: [{ type: "null" }, { type: "string" }],
						required: true
					},
					activity: {
						oneOf: [{ type: "null" }, { type: "string" }],
						required: true
					},
					window_title: {
						oneOf: [{ type: "null" }, { type: "string" }],
						required: true
					},
					screen_on: {
						type: "boolean",
						required: true
					}
				}
			},
			render: textRender(renderForegroundApp)
		},
		async execute(args, exec) {
			const a = args;
			const config = deps.getConfig();
			const { serial } = await resolveSerial(deps.adb, a.serial, config.defaultSerial, exec.signal);
			const parts = (await deps.adb.shell(serial, "echo \"=FOCUS=\"; dumpsys window|grep mCurrentFocus; echo \"=WAKE=\"; dumpsys power|grep mWakefulness", exec.signal)).split(/=[A-Z]+=/);
			const focusOutput = parts[1] ?? "";
			const wakeOutput = parts[2] ?? "";
			const parsed = parseForegroundApp(focusOutput);
			const screenOn = parseWakefulness(wakeOutput);
			return {
				serial,
				package: parsed?.package ?? null,
				activity: parsed?.activity ?? null,
				window_title: parsed?.windowTitle ?? null,
				screen_on: screenOn
			};
		}
	}));
}
//#endregion
//#region src/registry.ts
/**
* Register all 10 android_* tools into the given context.
* @param ctx - the plugin context (provides `ctx.tools.register`).
* @param deps - the AdbClient and live config getter.
*/
function registerTools(ctx, deps) {
	registerDeviceTools(ctx, deps);
	registerScreenTools(ctx, deps);
	registerInputTools(ctx, deps);
	registerAppTools(ctx, deps);
}
//#endregion
//#region src/index.ts
/**
* index.ts — dsh-android-use cordis plugin entry (host half).
*
* 10 model-facing tools that let the AI operate an Android phone via adb:
*   - android_list_devices / android_device_info
*   - android_screenshot / android_ui_dump
*   - android_tap / android_swipe / android_press_key / android_input_text
*   - android_open_app / android_foreground_app
*
* Host-only (no client UI); the generic tool card is used for rendering.
* Tool registration is effect-based: disposing the plugin fiber
* (e.g., on config change) automatically unregisters all tools, and the
* next apply() re-registers with the fresh config.
*
* @module @huanlin/dsh-plugin-android-use
*/
const name = "dsh-android-use";
const inject = ["tools"];
const Config = z.object({
	adbPath: z.string().default("adb").description("Path to the adb binary. Defaults to \"adb\" (must be on PATH)."),
	defaultSerial: z.string().description("Default device serial. Omit to auto-select when one device is attached; required when multiple are connected."),
	inputTextMode: z.union(["input", "adbkeyboard"]).default("input").description("Text input mode: \"input\" (ASCII only, uses `adb shell input text`) or \"adbkeyboard\" (Unicode, requires ADBKeyboard IME on device).")
});
function resolveConfig(config) {
	return {
		adbPath: typeof config.adbPath === "string" && config.adbPath !== "" ? config.adbPath : "adb",
		defaultSerial: typeof config.defaultSerial === "string" && config.defaultSerial !== "" ? config.defaultSerial : void 0,
		inputTextMode: config.inputTextMode === "adbkeyboard" ? "adbkeyboard" : "input"
	};
}
function apply(ctx, config = {}) {
	const resolved = resolveConfig(config);
	registerTools(ctx, {
		adb: new AdbClient(resolved.adbPath),
		getConfig: () => resolved
	});
}
//#endregion
export { Config, apply, inject, name, resolveConfig };
