window.__ModuleLoader__.load({
	id: "@huanlin/dsh-plugin-android-use",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region \0dsh-css:D:\Projects\deepseek-harness\dsh-plugin-android-use\src\client\TapCard.module.css.mjs
		const css$1 = "/* TapCard toolview: a compact card showing the annotated pre-tap screenshot\n * with tap coordinates and action metadata.\n *\n * Every color resolves through a --dsw-alias-* token (no literal colors). */\n\n.d8shy4r_card {\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n  padding: 10px 12px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 8px;\n  background: var(--dsw-alias-bg-layer-1);\n  overflow: hidden;\n}\n\n/* ---- Header: title + action badge ---- */\n\n.d8shy4r_header {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  min-width: 0;\n}\n\n.d8shy4r_stateDot {\n  flex: none;\n  width: 8px;\n  height: 8px;\n  border-radius: 50%;\n  background: var(--dsw-alias-label-caption);\n  transition: background 0.15s ease;\n}\n\n.d8shy4r_card[data-state='running'] .d8shy4r_stateDot {\n  background: var(--dsw-alias-brand-primary);\n  animation: dsh-android-tap-pulse 1.4s ease-in-out infinite;\n}\n\n.d8shy4r_card[data-state='completed'] .d8shy4r_stateDot {\n  background: var(--dsw-alias-state-success-primary);\n}\n\n.d8shy4r_card[data-state='error'] .d8shy4r_stateDot {\n  background: var(--dsw-alias-state-error-primary);\n}\n\n@keyframes dsh-android-tap-pulse {\n  0%, 100% { opacity: 1; }\n  50% { opacity: 0.4; }\n}\n\n.d8shy4r_title {\n  flex: 1 1 auto;\n  font-size: 13px;\n  font-weight: 500;\n  line-height: 20px;\n  color: var(--dsw-alias-label-primary);\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.d8shy4r_badge {\n  flex: none;\n  font-size: 11px;\n  line-height: 18px;\n  padding: 0 6px;\n  border-radius: 4px;\n  background: var(--dsw-alias-bg-layer-2);\n  color: var(--dsw-alias-label-tertiary);\n  font-variant-numeric: tabular-nums;\n}\n\n/* ---- Screenshot images (pre-tap + post-tap grid) ---- */\n\n.d8shy4r_imageGrid {\n  display: grid;\n  grid-template-columns: 1fr 1fr;\n  gap: 8px;\n}\n\n.d8shy4r_imageSlot {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n  min-width: 0;\n}\n\n.d8shy4r_imageLabel {\n  font-size: 11px;\n  line-height: 16px;\n  color: var(--dsw-alias-label-tertiary);\n  font-weight: 500;\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n\n.d8shy4r_imageWrap {\n  position: relative;\n  border-radius: 6px;\n  overflow: hidden;\n  background: var(--dsw-alias-bg-layer-2);\n  max-height: 280px;\n  display: flex;\n  justify-content: center;\n}\n\n.d8shy4r_image {\n  display: block;\n  max-width: 100%;\n  max-height: 280px;\n  object-fit: contain;\n}\n\n.d8shy4r_placeholder {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  min-height: 80px;\n  font-size: 12px;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n/* ---- Footer: coordinates + metadata ---- */\n\n.d8shy4r_meta {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 8px 16px;\n  font-size: 11px;\n  line-height: 16px;\n  color: var(--dsw-alias-label-tertiary);\n  font-variant-numeric: tabular-nums;\n}\n\n.d8shy4r_metaItem {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .d8shy4r_card[data-state='running'] .d8shy4r_stateDot {\n    animation: none;\n  }\n}\n";
		const classMap$1 = {
			"card": "d8shy4r_card",
			"header": "d8shy4r_header",
			"stateDot": "d8shy4r_stateDot",
			"title": "d8shy4r_title",
			"badge": "d8shy4r_badge",
			"imageGrid": "d8shy4r_imageGrid",
			"imageSlot": "d8shy4r_imageSlot",
			"imageLabel": "d8shy4r_imageLabel",
			"imageWrap": "d8shy4r_imageWrap",
			"image": "d8shy4r_image",
			"placeholder": "d8shy4r_placeholder",
			"meta": "d8shy4r_meta",
			"metaItem": "d8shy4r_metaItem"
		};
		const tagId$1 = "@huanlin/dsh-plugin-android-use/TapCard.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@huanlin/dsh-plugin-android-use";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		//#endregion
		//#region src/client/TapCard.tsx
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
		/** Extract all image blocks from a settled tool result, in order. */
		function findImages(block) {
			return block.content.filter((c) => c.type === "image");
		}
		/** Extract the first text block (summary) from a settled tool result. */
		function findText$1(block) {
			return block.content.find((c) => c.type === "text")?.text;
		}
		/** Parse tap coordinates from the running block's argsRaw. */
		function parseTapArgs(argsRaw) {
			try {
				const parsed = JSON.parse(argsRaw);
				return {
					x: typeof parsed.x === "number" ? parsed.x : void 0,
					y: typeof parsed.y === "number" ? parsed.y : void 0
				};
			} catch {
				return {};
			}
		}
		/**
		* Resolve an attachmentId to a browser URL through the session-authorized
		* image loader. Caches by attachmentId so re-renders don't re-fetch.
		*/
		function useImageUrl$1(loadImage, attachment) {
			const [url, setUrl] = (0, react.useState)(void 0);
			(0, react.useEffect)(() => {
				if (attachment === void 0) {
					setUrl(void 0);
					return;
				}
				let cancelled = false;
				loadImage(attachment).then((resolved) => {
					if (!cancelled) setUrl(resolved);
				}).catch(() => {
					if (!cancelled) setUrl(void 0);
				});
				return () => {
					cancelled = true;
				};
			}, [loadImage, attachment]);
			return url;
		}
		/**
		* Render one `android_tap` tool call as a card with pre-tap and post-tap screenshots.
		*
		* `tool.call.toolview` is a three-phase union: a `preparing` call carries no
		* dispatched arguments, so it renders a lightweight argument-free row and the
		* start/result phases delegate to {@link StartedTapCard} (which reads
		* `argsRaw` only when the phase guarantees it).
		*/
		function TapCard(props) {
			if (props.phase === "preparing") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: classMap$1.card,
				"data-tool": props.toolName,
				"data-state": "preparing",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: classMap$1.header,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: classMap$1.stateDot,
							"aria-hidden": true
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: classMap$1.title,
							children: props.toolName
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: classMap$1.badge,
							children: "preparing"
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: classMap$1.imageGrid,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: classMap$1.imageSlot,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: classMap$1.imageLabel,
							children: "Pre-tap (annotated)"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: classMap$1.imageWrap,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: classMap$1.placeholder,
								children: "Capturing…"
							})
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: classMap$1.imageSlot,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: classMap$1.imageLabel,
							children: "Post-tap (result)"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: classMap$1.imageWrap,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: classMap$1.placeholder,
								children: "Capturing…"
							})
						})]
					})]
				})]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StartedTapCard, { ...props });
		}
		/** Dispatched/settled `android_tap` card. */
		function StartedTapCard({ phase, block, toolName, loadImage }) {
			const settled = phase === "result" ? block : void 0;
			const running = phase === "start" ? block : void 0;
			const images = settled !== void 0 ? findImages(settled) : [];
			const text = settled !== void 0 ? findText$1(settled) : void 0;
			const runArgs = running !== void 0 ? parseTapArgs(running.argsRaw) : void 0;
			const settledArgs = settled?.call != null ? parseTapArgs(settled.call.argsRaw) : void 0;
			const coords = runArgs ?? settledArgs ?? {
				x: void 0,
				y: void 0
			};
			const preImage = images[0];
			const postImage = images[1];
			const preUrl = useImageUrl$1(loadImage, preImage?.attachment);
			const postUrl = useImageUrl$1(loadImage, postImage?.attachment);
			const state = settled === void 0 ? "running" : settled.isError ? "error" : "completed";
			const title = coords.x !== void 0 && coords.y !== void 0 ? `Tap (${coords.x}, ${coords.y})` : toolName;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: classMap$1.card,
				"data-tool": toolName,
				"data-state": state,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: classMap$1.header,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: classMap$1.stateDot,
								"aria-hidden": true
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: classMap$1.title,
								children: title
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: classMap$1.badge,
								children: state
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: classMap$1.imageGrid,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: classMap$1.imageSlot,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: classMap$1.imageLabel,
								children: "Pre-tap (annotated)"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: classMap$1.imageWrap,
								children: preUrl !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
									className: classMap$1.image,
									src: preUrl,
									alt: `Pre-tap screenshot at (${coords.x ?? "?"}, ${coords.y ?? "?"})`
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: classMap$1.placeholder,
									children: settled === void 0 ? "Capturing…" : preImage !== void 0 ? "Loading…" : "No screenshot"
								})
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: classMap$1.imageSlot,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: classMap$1.imageLabel,
								children: "Post-tap (result)"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: classMap$1.imageWrap,
								children: postUrl !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
									className: classMap$1.image,
									src: postUrl,
									alt: "Post-tap screenshot showing the result"
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: classMap$1.placeholder,
									children: settled === void 0 ? "Capturing…" : postImage !== void 0 ? "Loading…" : "No screenshot"
								})
							})]
						})]
					}),
					text !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: classMap$1.meta,
						children: text.split("\n").map((line, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: classMap$1.metaItem,
							children: line
						}, i))
					})
				]
			});
		}
		//#endregion
		//#region \0dsh-css:D:\Projects\deepseek-harness\dsh-plugin-android-use\src\client\ScreenshotCard.module.css.mjs
		const css = "/* ScreenshotCard toolview: a compact card showing the captured screenshot.\n *\n * Every color resolves through a --dsw-alias-* token (no literal colors). */\n\n.d8godkw_card {\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n  padding: 10px 12px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 8px;\n  background: var(--dsw-alias-bg-layer-1);\n  overflow: hidden;\n}\n\n/* ---- Header: title + state badge ---- */\n\n.d8godkw_header {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  min-width: 0;\n}\n\n.d8godkw_stateDot {\n  flex: none;\n  width: 8px;\n  height: 8px;\n  border-radius: 50%;\n  background: var(--dsw-alias-label-caption);\n  transition: background 0.15s ease;\n}\n\n.d8godkw_card[data-state='running'] .d8godkw_stateDot {\n  background: var(--dsw-alias-brand-primary);\n  animation: dsh-android-screenshot-pulse 1.4s ease-in-out infinite;\n}\n\n.d8godkw_card[data-state='completed'] .d8godkw_stateDot {\n  background: var(--dsw-alias-state-success-primary);\n}\n\n.d8godkw_card[data-state='error'] .d8godkw_stateDot {\n  background: var(--dsw-alias-state-error-primary);\n}\n\n@keyframes dsh-android-screenshot-pulse {\n  0%, 100% { opacity: 1; }\n  50% { opacity: 0.4; }\n}\n\n.d8godkw_title {\n  flex: 1 1 auto;\n  font-size: 13px;\n  font-weight: 500;\n  line-height: 20px;\n  color: var(--dsw-alias-label-primary);\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.d8godkw_badge {\n  flex: none;\n  font-size: 11px;\n  line-height: 18px;\n  padding: 0 6px;\n  border-radius: 4px;\n  background: var(--dsw-alias-bg-layer-2);\n  color: var(--dsw-alias-label-tertiary);\n  font-variant-numeric: tabular-nums;\n}\n\n/* ---- Screenshot image ---- */\n\n.d8godkw_imageWrap {\n  position: relative;\n  border-radius: 6px;\n  overflow: hidden;\n  background: var(--dsw-alias-bg-layer-2);\n  max-height: 320px;\n  display: flex;\n  justify-content: center;\n}\n\n.d8godkw_image {\n  display: block;\n  max-width: 100%;\n  max-height: 320px;\n  object-fit: contain;\n}\n\n.d8godkw_placeholder {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  min-height: 80px;\n  font-size: 12px;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n/* ---- Footer: metadata ---- */\n\n.d8godkw_meta {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 8px 16px;\n  font-size: 11px;\n  line-height: 16px;\n  color: var(--dsw-alias-label-tertiary);\n  font-variant-numeric: tabular-nums;\n}\n\n.d8godkw_metaItem {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .d8godkw_card[data-state='running'] .d8godkw_stateDot {\n    animation: none;\n  }\n}\n";
		const classMap = {
			"card": "d8godkw_card",
			"header": "d8godkw_header",
			"stateDot": "d8godkw_stateDot",
			"title": "d8godkw_title",
			"badge": "d8godkw_badge",
			"imageWrap": "d8godkw_imageWrap",
			"image": "d8godkw_image",
			"placeholder": "d8godkw_placeholder",
			"meta": "d8godkw_meta",
			"metaItem": "d8godkw_metaItem"
		};
		const tagId = "@huanlin/dsh-plugin-android-use/ScreenshotCard.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@huanlin/dsh-plugin-android-use";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion
		//#region src/client/ScreenshotCard.tsx
		/**
		* ScreenshotCard — the toolcall card for the `android_screenshot` tool.
		*
		* Renders the captured screenshot inline. The image is loaded through
		* the session-authorized `loadImage` loader the toolview owner supplies,
		* which converts the ImageAttachmentRef into a session-authorized blob URL.
		*
		* @module @huanlin/dsh-plugin-android-use/client/ScreenshotCard
		*/
		function findImage(block) {
			return block.content.find((c) => c.type === "image");
		}
		function findText(block) {
			return block.content.find((c) => c.type === "text")?.text;
		}
		function useImageUrl(loadImage, attachment) {
			const [url, setUrl] = (0, react.useState)(void 0);
			(0, react.useEffect)(() => {
				if (attachment === void 0) {
					setUrl(void 0);
					return;
				}
				let cancelled = false;
				loadImage(attachment).then((resolved) => {
					if (!cancelled) setUrl(resolved);
				}).catch(() => {
					if (!cancelled) setUrl(void 0);
				});
				return () => {
					cancelled = true;
				};
			}, [loadImage, attachment]);
			return url;
		}
		/**
		* Render one `android_screenshot` tool call as a card with the screenshot.
		*
		* `tool.call.toolview` is a three-phase union: a `preparing` call carries no
		* dispatched arguments, so it renders a lightweight argument-free row and the
		* start/result phases delegate to {@link StartedScreenshotCard}.
		*/
		function ScreenshotCard(props) {
			if (props.phase === "preparing") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: classMap.card,
				"data-tool": props.toolName,
				"data-state": "preparing",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: classMap.header,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: classMap.stateDot,
							"aria-hidden": true
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: classMap.title,
							children: props.toolName
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: classMap.badge,
							children: "preparing"
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: classMap.imageWrap,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: classMap.placeholder,
						children: "Capturing…"
					})
				})]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StartedScreenshotCard, { ...props });
		}
		/** Dispatched/settled `android_screenshot` card. */
		function StartedScreenshotCard({ phase, block, toolName, loadImage }) {
			const settled = phase === "result" ? block : void 0;
			const image = settled !== void 0 ? findImage(settled) : void 0;
			const text = settled !== void 0 ? findText(settled) : void 0;
			const imageUrl = useImageUrl(loadImage, image?.attachment);
			const state = settled === void 0 ? "running" : settled.isError ? "error" : "completed";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: classMap.card,
				"data-tool": toolName,
				"data-state": state,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: classMap.header,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: classMap.stateDot,
								"aria-hidden": true
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: classMap.title,
								children: toolName
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: classMap.badge,
								children: state
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: classMap.imageWrap,
						children: imageUrl !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
							className: classMap.image,
							src: imageUrl,
							alt: "Android screenshot"
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: classMap.placeholder,
							children: settled === void 0 ? "Capturing…" : image !== void 0 ? "Loading…" : "No screenshot"
						})
					}),
					text !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: classMap.meta,
						children: text.split("\n").map((line, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: classMap.metaItem,
							children: line
						}, i))
					})
				]
			});
		}
		//#endregion
		//#region src/client/index.ts
		/** Required services: slot registry. */
		const inject = ["slots"];
		/**
		* Client plugin body: register the `android_tap` and `android_screenshot` toolview slots.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
				name: "tool.call.toolview",
				key: "android_tap"
			}, TapCard));
			ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
				name: "tool.call.toolview",
				key: "android_screenshot"
			}, ScreenshotCard));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map