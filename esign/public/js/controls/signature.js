import SignaturePad from "signature_pad";
import { toDom } from "hast-util-to-dom";
import { createIconHast } from "./utils";

/**
 * @fileoverview Signature control for Frappe Framework
 * @description A modern, self-contained signature control using HAST for DOM creation,
 * Popover API for dialogs, and CSS Anchor Positioning. Supports draw, type, and upload
 * signature methods.
 *
 * Minimal dependency on Frappe - only extends the base control class pattern.
 *
 * @requires signature_pad - For canvas-based signature drawing
 * @requires hast-util-to-dom - For efficient DOM structure creation
 *
 * @author Avunu LLC
 */

/**
 * Available signature fonts with CSS font-family values
 * @type {Object.<string, string>}
 */
const SIGNATURE_FONTS = {
	"Brush Script": '"Brush Script MT", "Brush Script Std", cursive',
	"Lucida Handwriting": '"Lucida Handwriting", "Lucida Calligraphy", cursive',
	"Segoe Script": '"Segoe Script", "Bradley Hand", cursive',
	Pacifico: '"Pacifico", "Comic Sans MS", cursive',
};

/**
 * Font name variants to check against local fonts.
 * Maps our display label to possible PostScript/family names.
 * @type {Object.<string, string[]>}
 */
const FONT_VARIANTS = {
	"Brush Script": ["Brush Script MT", "Brush Script Std", "BrushScriptMT"],
	"Lucida Handwriting": [
		"Lucida Handwriting",
		"Lucida Calligraphy",
		"LucidaHandwriting",
	],
	"Segoe Script": ["Segoe Script", "SegoeScript", "Bradley Hand"],
	Pacifico: ["Pacifico", "Pacifico-Regular"],
};

/**
 * Unique ID counter for popover associations
 */
let signatureCounter = 0;

/**
 * Gets available signature fonts using Local Font Access API.
 * Falls back to all fonts if API unavailable or permission denied.
 * @returns {Promise<Array<{value: string, label: string, fontFamily: string}>>}
 */
async function getAvailableFonts() {
	if (!("queryLocalFonts" in window)) {
		return Object.entries(SIGNATURE_FONTS).map(([label, fontFamily]) => ({
			value: label,
			label,
			fontFamily,
		}));
	}

	try {
		const localFonts = await window.queryLocalFonts();
		const localFontNames = new Set(
			localFonts.map((f) => f.family.toLowerCase()),
		);

		const available = [];
		for (const [label, fontFamily] of Object.entries(SIGNATURE_FONTS)) {
			const variants = FONT_VARIANTS[label] || [label];
			const isAvailable = variants.some((variant) =>
				localFontNames.has(variant.toLowerCase()),
			);
			if (isAvailable) {
				available.push({ value: label, label, fontFamily });
			}
		}

		return available.length > 0
			? available
			: Object.entries(SIGNATURE_FONTS).map(([label, fontFamily]) => ({
					value: label,
					label,
					fontFamily,
				}));
	} catch {
		return Object.entries(SIGNATURE_FONTS).map(([label, fontFamily]) => ({
			value: label,
			label,
			fontFamily,
		}));
	}
}

/**
 * @class ControlSignature
 * @extends frappe.ui.form.ControlData
 * @description A signature field control with draw, type, and upload modes.
 * Uses modern web APIs (Popover, CSS Anchor Positioning) and HAST for DOM.
 */
export class ControlSignature extends frappe.ui.form.ControlData {
	/**
	 * Gets the term to use for "signature" from df.options.
	 * Defaults to "Signature" if not specified.
	 * @returns {string}
	 */
	get_signature_term() {
		return this.df.options?.trim() || "Signature";
	}

	make_input() {
		if (this.has_input) return;

		this._id = ++signatureCounter;
		this._current_mode = "draw";
		this._font_options = [];
		this._selected_font = null;

		// Build the display area and popover dialog
		this.build_display_area();
		this.build_dialog_popover();

		// Set references for base class compatibility
		this.$input = $(this.display_canvas);
		this.input = this.display_canvas;
		this.has_input = true;
	}

	/**
	 * Builds the signature display area with canvas and overlay
	 */
	build_display_area() {
		const term = this.get_signature_term().toLowerCase();
		const overlayText = __("Add your {0}", [term]);

		const displayStructure = {
			type: "element",
			tagName: "div",
			properties: { className: ["signature-display"] },
			children: [
				{
					type: "element",
					tagName: "canvas",
					properties: {
						width: 750,
						height: 292,
						className: ["signature-display-canvas"],
					},
					children: [],
				},
				{
					type: "element",
					tagName: "div",
					properties: { className: ["signature-overlay"] },
					children: [
						{
							type: "element",
							tagName: "div",
							properties: {
								className: ["signature-overlay-content"],
							},
							children: [
								createIconHast("add", "md"),
								{
									type: "element",
									tagName: "div",
									properties: {
										className: ["signature-overlay-text"],
									},
									children: [
										{ type: "text", value: overlayText },
									],
								},
							],
						},
					],
				},
			],
		};

		this.display_wrapper = toDom(displayStructure);
		this.input_area.appendChild(this.display_wrapper);

		// Get references
		this.display_canvas = this.display_wrapper.children[0];
		this.display_overlay = this.display_wrapper.children[1];
		this.overlay_icon = this.display_overlay.querySelector("svg");
		this.overlay_text = this.display_overlay.querySelector(
			".signature-overlay-text",
		);

		// Bind click to open dialog
		this.display_wrapper.addEventListener("click", () => {
			if (this.get_status() === "Write") {
				this.show_dialog();
			}
		});

		// Hover effects
		this.display_wrapper.addEventListener("mouseenter", () => {
			if (this.get_status() === "Write") {
				this.display_overlay.classList.add("visible");
			}
		});
		this.display_wrapper.addEventListener("mouseleave", () => {
			this.display_overlay.classList.remove("visible");
		});
	}

	/**
	 * Builds the signature dialog as a popover element
	 */
	build_dialog_popover() {
		const term = this.get_signature_term();
		const termLower = term.toLowerCase();
		const popoverId = `signature-dialog-${this._id}`;

		// Build font option buttons (initially empty, populated async)
		const fontOptionsId = `signature-font-options-${this._id}`;

		const dialogStructure = {
			type: "element",
			tagName: "div",
			properties: {
				id: popoverId,
				popover: "manual",
				className: ["signature-dialog"],
			},
			children: [
				// Header
				{
					type: "element",
					tagName: "div",
					properties: { className: ["signature-dialog-header"] },
					children: [
						{
							type: "element",
							tagName: "h3",
							properties: {},
							children: [
								{
									type: "text",
									value: __("Add your {0}", [termLower]),
								},
							],
						},
						{
							type: "element",
							tagName: "button",
							properties: {
								type: "button",
								className: ["signature-dialog-close"],
								ariaLabel: __("Close"),
							},
							children: [{ type: "text", value: "×" }],
						},
					],
				},
				// Body
				{
					type: "element",
					tagName: "div",
					properties: { className: ["signature-dialog-body"] },
					children: [
						// Mode buttons
						{
							type: "element",
							tagName: "div",
							properties: {
								className: ["signature-mode-buttons"],
							},
							children: [
								{
									type: "element",
									tagName: "button",
									properties: {
										type: "button",
										className: [
											"signature-mode-btn",
											"active",
										],
										dataMode: "draw",
									},
									children: [
										{ type: "text", value: __("Draw") },
									],
								},
								{
									type: "element",
									tagName: "button",
									properties: {
										type: "button",
										className: ["signature-mode-btn"],
										dataMode: "type",
									},
									children: [
										{ type: "text", value: __("Type") },
									],
								},
								{
									type: "element",
									tagName: "button",
									properties: {
										type: "button",
										className: ["signature-mode-btn"],
										dataMode: "upload",
									},
									children: [
										{ type: "text", value: __("Upload") },
									],
								},
							],
						},
						// Mode sections container
						{
							type: "element",
							tagName: "div",
							properties: {
								className: ["signature-mode-sections"],
							},
							children: [
								// Draw section
								{
									type: "element",
									tagName: "div",
									properties: {
										className: [
											"signature-section",
											"signature-draw-section",
											"active",
										],
										dataSection: "draw",
									},
									children: [
										{
											type: "element",
											tagName: "div",
											properties: {
												className: [
													"signature-canvas-wrapper",
												],
											},
											children: [
												{
													type: "element",
													tagName: "canvas",
													properties: {
														className: [
															"signature-pad-canvas",
														],
													},
													children: [],
												},
												{
													type: "element",
													tagName: "div",
													properties: {
														className: [
															"signature-line",
														],
													},
													children: [],
												},
											],
										},
										{
											type: "element",
											tagName: "button",
											properties: {
												type: "button",
												className: [
													"signature-reset-btn",
												],
											},
											children: [
												createIconHast(
													"es-line-reload",
													"sm",
												),
												{
													type: "text",
													value: " " + __("Clear"),
												},
											],
										},
									],
								},
								// Type section
								{
									type: "element",
									tagName: "div",
									properties: {
										className: [
											"signature-section",
											"signature-type-section",
										],
										dataSection: "type",
									},
									children: [
										{
											type: "element",
											tagName: "div",
											properties: {
												className: [
													"signature-type-inputs",
												],
											},
											children: [
												{
													type: "element",
													tagName: "input",
													properties: {
														type: "text",
														className: [
															"signature-typed-input",
														],
														placeholder: __(
															"Type your {0}",
															[termLower],
														),
													},
													children: [],
												},
												// Font selector
												{
													type: "element",
													tagName: "div",
													properties: {
														className: [
															"signature-font-select",
														],
													},
													children: [
														{
															type: "element",
															tagName: "button",
															properties: {
																type: "button",
																className: [
																	"signature-font-trigger",
																],
																popoverTarget:
																	fontOptionsId,
																popoverTargetAction:
																	"toggle",
															},
															children: [
																{
																	type: "element",
																	tagName:
																		"span",
																	properties:
																		{
																			className:
																				[
																					"signature-font-value",
																				],
																		},
																	children: [
																		{
																			type: "text",
																			value: "",
																		},
																	],
																},
																{
																	type: "element",
																	tagName:
																		"span",
																	properties:
																		{
																			className:
																				[
																					"signature-font-arrow",
																				],
																		},
																	children: [
																		{
																			type: "text",
																			value: "▾",
																		},
																	],
																},
															],
														},
														{
															type: "element",
															tagName: "div",
															properties: {
																id: fontOptionsId,
																popover: "auto",
																className: [
																	"signature-font-popover",
																],
															},
															children: [],
														},
													],
												},
											],
										},
										// Typed preview
										{
											type: "element",
											tagName: "div",
											properties: {
												className: [
													"signature-typed-preview",
												],
											},
											children: [
												{
													type: "element",
													tagName: "div",
													properties: {
														className: [
															"signature-typed-text",
														],
													},
													children: [],
												},
												{
													type: "element",
													tagName: "div",
													properties: {
														className: [
															"signature-line",
														],
													},
													children: [],
												},
											],
										},
									],
								},
								// Upload section
								{
									type: "element",
									tagName: "div",
									properties: {
										className: [
											"signature-section",
											"signature-upload-section",
										],
										dataSection: "upload",
									},
									children: [
										{
											type: "element",
											tagName: "div",
											properties: {
												className: [
													"signature-upload-area",
												],
											},
											children: [
												{
													type: "element",
													tagName: "input",
													properties: {
														type: "file",
														accept: "image/*",
														className: [
															"signature-file-input",
														],
													},
													children: [],
												},
												{
													type: "element",
													tagName: "div",
													properties: {
														className: [
															"signature-upload-prompt",
														],
													},
													children: [
														createIconHast(
															"upload",
															"lg",
														),
														{
															type: "element",
															tagName: "div",
															properties: {},
															children: [
																{
																	type: "text",
																	value: __(
																		"Click or drag to upload",
																	),
																},
															],
														},
													],
												},
												{
													type: "element",
													tagName: "div",
													properties: {
														className: [
															"signature-upload-preview",
														],
													},
													children: [
														{
															type: "element",
															tagName: "img",
															properties: {
																className: [
																	"signature-upload-img",
																],
															},
															children: [],
														},
													],
												},
											],
										},
									],
								},
							],
						},
					],
				},
				// Footer
				{
					type: "element",
					tagName: "div",
					properties: { className: ["signature-dialog-footer"] },
					children: [
						{
							type: "element",
							tagName: "button",
							properties: {
								type: "button",
								className: [
									"signature-btn",
									"signature-btn-secondary",
								],
							},
							children: [{ type: "text", value: __("Cancel") }],
						},
						{
							type: "element",
							tagName: "button",
							properties: {
								type: "button",
								className: [
									"signature-btn",
									"signature-btn-primary",
								],
							},
							children: [
								{
									type: "text",
									value: __("Insert {0}", [term]),
								},
							],
						},
					],
				},
			],
		};

		this.dialog = toDom(dialogStructure);
		document.body.appendChild(this.dialog);

		// Get references
		this.dialog_header = this.dialog.querySelector(
			".signature-dialog-header",
		);
		this.dialog_close_btn = this.dialog.querySelector(
			".signature-dialog-close",
		);
		this.mode_buttons = this.dialog.querySelectorAll(".signature-mode-btn");
		this.mode_sections = this.dialog.querySelectorAll(".signature-section");

		// Draw section refs
		this.draw_section = this.dialog.querySelector(
			".signature-draw-section",
		);
		this.pad_canvas = this.dialog.querySelector(".signature-pad-canvas");
		this.reset_btn = this.dialog.querySelector(".signature-reset-btn");

		// Type section refs
		this.type_section = this.dialog.querySelector(
			".signature-type-section",
		);
		this.typed_input = this.dialog.querySelector(".signature-typed-input");
		this.font_trigger = this.dialog.querySelector(
			".signature-font-trigger",
		);
		this.font_value_display = this.dialog.querySelector(
			".signature-font-value",
		);
		this.font_popover = this.dialog.querySelector(
			".signature-font-popover",
		);
		this.typed_preview_text = this.dialog.querySelector(
			".signature-typed-text",
		);

		// Upload section refs
		this.upload_section = this.dialog.querySelector(
			".signature-upload-section",
		);
		this.file_input = this.dialog.querySelector(".signature-file-input");
		this.upload_area = this.dialog.querySelector(".signature-upload-area");
		this.upload_prompt = this.dialog.querySelector(
			".signature-upload-prompt",
		);
		this.upload_preview = this.dialog.querySelector(
			".signature-upload-preview",
		);
		this.upload_img = this.dialog.querySelector(".signature-upload-img");

		// Footer refs
		this.cancel_btn = this.dialog.querySelector(".signature-btn-secondary");
		this.insert_btn = this.dialog.querySelector(".signature-btn-primary");

		// Bind events
		this.bind_dialog_events();
	}

	/**
	 * Binds all event listeners for the dialog
	 */
	bind_dialog_events() {
		// Close button
		this.dialog_close_btn.addEventListener("click", () =>
			this.hide_dialog(),
		);
		this.cancel_btn.addEventListener("click", () => this.hide_dialog());

		// Insert button
		this.insert_btn.addEventListener("click", () => this.handle_insert());

		// Mode switching
		this.mode_buttons.forEach((btn) => {
			btn.addEventListener("click", () => {
				const mode = btn.dataset.mode;
				this.select_mode(mode);
			});
		});

		// Draw: Reset button
		this.reset_btn.addEventListener("click", () => {
			if (this.signature_pad) {
				this.signature_pad.clear();
			}
		});

		// Type: Input changes
		this.typed_input.addEventListener("input", () =>
			this.update_typed_preview(),
		);

		// Upload: File selection
		this.file_input.addEventListener("change", (e) =>
			this.handle_file_select(e),
		);

		// Upload: Click area to trigger file input
		this.upload_area.addEventListener("click", (e) => {
			if (e.target !== this.file_input) {
				this.file_input.click();
			}
		});

		// Upload: Drag and drop
		this.upload_area.addEventListener("dragover", (e) => {
			e.preventDefault();
			this.upload_area.classList.add("drag-over");
		});
		this.upload_area.addEventListener("dragleave", () => {
			this.upload_area.classList.remove("drag-over");
		});
		this.upload_area.addEventListener("drop", (e) => {
			e.preventDefault();
			this.upload_area.classList.remove("drag-over");
			const file = e.dataTransfer.files[0];
			if (file && file.type.startsWith("image/")) {
				this.process_uploaded_file(file);
			}
		});

		// Close on backdrop click
		this.dialog.addEventListener("click", (e) => {
			if (e.target === this.dialog) {
				this.hide_dialog();
			}
		});

		// Close on Escape key
		this.dialog.addEventListener("keydown", (e) => {
			if (e.key === "Escape") {
				this.hide_dialog();
			}
		});
	}

	/**
	 * Shows the signature dialog
	 */
	async show_dialog() {
		// Load fonts if not already loaded
		if (this._font_options.length === 0) {
			this._font_options = await getAvailableFonts();
			this.build_font_options();
			if (this._font_options.length > 0) {
				this.select_font(this._font_options[0].value);
			}
		}

		// Reset state
		this._upload_data = null;
		this.upload_preview.classList.remove("active");
		this.upload_prompt.classList.remove("hidden");
		this.typed_input.value = "";
		this.update_typed_preview();

		// Show dialog
		this.dialog.showPopover();

		// Initialize signature pad after dialog is visible
		requestAnimationFrame(() => {
			this.init_signature_pad();
		});
	}

	/**
	 * Hides the signature dialog
	 */
	hide_dialog() {
		this.dialog.hidePopover();
	}

	/**
	 * Selects a signature mode (draw, type, upload)
	 * @param {string} mode - The mode to select
	 */
	select_mode(mode) {
		this._current_mode = mode;

		// Update button states
		this.mode_buttons.forEach((btn) => {
			btn.classList.toggle("active", btn.dataset.mode === mode);
		});

		// Update section visibility
		this.mode_sections.forEach((section) => {
			section.classList.toggle(
				"active",
				section.dataset.section === mode,
			);
		});

		// Initialize signature pad when switching to draw mode
		if (mode === "draw") {
			requestAnimationFrame(() => this.init_signature_pad());
		}
	}

	/**
	 * Initializes the signature pad on the draw canvas
	 */
	init_signature_pad() {
		if (!this.pad_canvas) return;

		// Resize canvas to match CSS size
		this.resize_pad_canvas();

		if (!this.signature_pad) {
			this.signature_pad = new SignaturePad(this.pad_canvas, {
				backgroundColor: "transparent",
				penColor: "black",
			});
		}
	}

	/**
	 * Resizes the pad canvas to match CSS dimensions and device pixel ratio
	 */
	resize_pad_canvas() {
		const ratio = Math.max(window.devicePixelRatio || 1, 1);
		const rect = this.pad_canvas.getBoundingClientRect();

		if (rect.width === 0 || rect.height === 0) return;

		if (
			this.pad_canvas.width !== rect.width * ratio ||
			this.pad_canvas.height !== rect.height * ratio
		) {
			this.pad_canvas.width = rect.width * ratio;
			this.pad_canvas.height = rect.height * ratio;
			this.pad_canvas.getContext("2d").scale(ratio, ratio);

			if (this.signature_pad) {
				this.signature_pad.clear();
			}
		}
	}

	/**
	 * Builds font option buttons in the font popover
	 */
	build_font_options() {
		const optionsStructure = {
			type: "element",
			tagName: "div",
			properties: { className: ["signature-font-options"] },
			children: this._font_options.map((opt) => ({
				type: "element",
				tagName: "button",
				properties: {
					type: "button",
					className: ["signature-font-option"],
					dataValue: opt.value,
					dataFontFamily: opt.fontFamily,
				},
				children: [{ type: "text", value: opt.label }],
			})),
		};

		const optionsEl = toDom(optionsStructure);
		this.font_popover.appendChild(optionsEl);

		// Apply font-family styles
		optionsEl.querySelectorAll(".signature-font-option").forEach((btn) => {
			btn.style.fontFamily = btn.dataset.fontFamily;
			btn.addEventListener("click", () => {
				this.select_font(btn.dataset.value);
				this.font_popover.hidePopover();
			});
		});
	}

	/**
	 * Selects a font for typed signatures
	 * @param {string} value - The font value to select
	 */
	select_font(value) {
		this._selected_font = value;
		const option = this._font_options.find((o) => o.value === value);

		if (option) {
			this.font_value_display.textContent = option.label;
			this.font_value_display.style.fontFamily = option.fontFamily;
		}

		// Update selected state in options
		this.font_popover
			.querySelectorAll(".signature-font-option")
			.forEach((btn) => {
				btn.classList.toggle("selected", btn.dataset.value === value);
			});

		this.update_typed_preview();
	}

	/**
	 * Updates the typed signature preview
	 */
	update_typed_preview() {
		const text = this.typed_input.value || "";
		const option = this._font_options.find(
			(o) => o.value === this._selected_font,
		);
		const fontFamily =
			option?.fontFamily ||
			SIGNATURE_FONTS[Object.keys(SIGNATURE_FONTS)[0]];

		this.typed_preview_text.textContent = text;
		this.typed_preview_text.style.fontFamily = fontFamily;
	}

	/**
	 * Handles file selection from input
	 * @param {Event} e - The change event
	 */
	handle_file_select(e) {
		const file = e.target.files[0];
		if (file) {
			this.process_uploaded_file(file);
		}
	}

	/**
	 * Processes an uploaded file and shows preview
	 * @param {File} file - The uploaded file
	 */
	process_uploaded_file(file) {
		const reader = new FileReader();
		reader.onload = (e) => {
			this._upload_data = e.target.result;
			this.upload_img.src = this._upload_data;
			this.upload_preview.classList.add("active");
			this.upload_prompt.classList.add("hidden");
		};
		reader.readAsDataURL(file);
	}

	/**
	 * Handles the insert button click
	 */
	handle_insert() {
		const term = this.get_signature_term().toLowerCase();

		if (this._current_mode === "draw") {
			if (!this.signature_pad || this.signature_pad.isEmpty()) {
				frappe.toast({
					message: __("Please draw a {0} first", [term]),
					indicator: "orange",
				});
				return;
			}
			const data = this.pad_canvas.toDataURL("image/png");
			this.set_signature_value(data);
		} else if (this._current_mode === "type") {
			const text = this.typed_input.value.trim();
			if (!text) {
				frappe.toast({
					message: __("Please enter {0} text", [term]),
					indicator: "orange",
				});
				return;
			}
			const data = this.convert_typed_to_base64(text);
			this.set_signature_value(data);
		} else if (this._current_mode === "upload") {
			if (!this._upload_data) {
				frappe.toast({
					message: __("Please upload a {0} image", [term]),
					indicator: "orange",
				});
				return;
			}
			this.normalize_upload_to_canvas(this._upload_data).then((data) => {
				this.set_signature_value(data);
			});
			return; // Don't hide yet, wait for promise
		}

		this.hide_dialog();
	}

	/**
	 * Converts typed text to base64 PNG
	 * @param {string} text - The text to convert
	 * @returns {string} Base64 data URL
	 */
	convert_typed_to_base64(text) {
		const option = this._font_options.find(
			(o) => o.value === this._selected_font,
		);
		const fontFamily =
			option?.fontFamily ||
			SIGNATURE_FONTS[Object.keys(SIGNATURE_FONTS)[0]];

		const canvas = document.createElement("canvas");
		canvas.width = 750;
		canvas.height = 292;
		const ctx = canvas.getContext("2d");

		ctx.fillStyle = "transparent";
		ctx.fillRect(0, 0, canvas.width, canvas.height);

		ctx.fillStyle = "#000000";
		ctx.font = `italic 50px ${fontFamily}`;
		ctx.textAlign = "center";
		ctx.textBaseline = "alphabetic";

		// Draw text at 75% from top (on the signature line)
		const signatureLineY = canvas.height * 0.75;
		ctx.fillText(text, canvas.width / 2, signatureLineY);

		return canvas.toDataURL("image/png");
	}

	/**
	 * Normalizes an uploaded image to a consistent canvas size
	 * @param {string} dataUrl - The uploaded image data URL
	 * @returns {Promise<string>} Normalized base64 data URL
	 */
	normalize_upload_to_canvas(dataUrl) {
		return new Promise((resolve, reject) => {
			const canvas = document.createElement("canvas");
			canvas.width = 750;
			canvas.height = 292;
			const ctx = canvas.getContext("2d");

			ctx.fillStyle = "transparent";
			ctx.fillRect(0, 0, canvas.width, canvas.height);

			const img = new Image();
			img.onload = () => {
				const padding = 20;
				const maxWidth = canvas.width - padding * 2;
				const maxHeight = canvas.height - padding * 2;

				let width = img.width;
				let height = img.height;
				const aspectRatio = width / height;

				if (width > maxWidth) {
					width = maxWidth;
					height = width / aspectRatio;
				}
				if (height > maxHeight) {
					height = maxHeight;
					width = height * aspectRatio;
				}

				const x = (canvas.width - width) / 2;
				const y = (canvas.height - height) / 2;

				ctx.drawImage(img, x, y, width, height);
				resolve(canvas.toDataURL("image/png"));
			};
			img.onerror = reject;
			img.src = dataUrl;
		});
	}

	/**
	 * Sets the signature value and updates the display
	 * @param {string} data - Base64 signature data
	 */
	set_signature_value(data) {
		this.value = data;
		this.set_value(data);
		this.render_display();
		this.hide_dialog();

		frappe.toast({
			message: __("{0} added successfully", [this.get_signature_term()]),
			indicator: "green",
		});
	}

	/**
	 * Renders the signature on the display canvas
	 */
	render_display() {
		const ctx = this.display_canvas.getContext("2d");
		ctx.clearRect(
			0,
			0,
			this.display_canvas.width,
			this.display_canvas.height,
		);

		const value = this.get_value();
		if (value) {
			const img = new Image();
			img.onload = () => {
				ctx.drawImage(
					img,
					0,
					0,
					this.display_canvas.width,
					this.display_canvas.height,
				);
			};
			img.src = value;
			this.display_wrapper.classList.add("has-signature");
			this.update_overlay_for_replace();
		} else {
			this.render_empty_display();
			this.display_wrapper.classList.remove("has-signature");
			this.update_overlay_for_add();
		}
	}

	/**
	 * Renders the empty state on the display canvas
	 */
	render_empty_display() {
		const ctx = this.display_canvas.getContext("2d");
		ctx.clearRect(
			0,
			0,
			this.display_canvas.width,
			this.display_canvas.height,
		);

		ctx.setLineDash([5, 5]);
		ctx.strokeStyle = "var(--border-color)";
		ctx.lineWidth = 2;
		ctx.strokeRect(
			10,
			10,
			this.display_canvas.width - 20,
			this.display_canvas.height - 20,
		);
		ctx.setLineDash([]);
	}

	/**
	 * Updates overlay text for "Add" state
	 */
	update_overlay_for_add() {
		const term = this.get_signature_term().toLowerCase();
		const newIcon = toDom(createIconHast("add", "md"));
		this.overlay_icon.replaceWith(newIcon);
		this.overlay_icon = newIcon;
		this.overlay_text.textContent = __("Add your {0}", [term]);
	}

	/**
	 * Updates overlay text for "Replace" state
	 */
	update_overlay_for_replace() {
		const term = this.get_signature_term().toLowerCase();
		const newIcon = toDom(createIconHast("edit", "md"));
		this.overlay_icon.replaceWith(newIcon);
		this.overlay_icon = newIcon;
		this.overlay_text.textContent = __("Replace {0}", [term]);
	}

	// ─────────────────────────────────────────────────────────────────
	// Base class interface methods
	// ─────────────────────────────────────────────────────────────────

	set_input(value) {
		this.value = value;
		this.render_display();
	}

	get_input_value() {
		return this.value;
	}

	get_value() {
		const value = this.value || this.get_model_value();
		// Ignore placeholder image
		if (value === "/assets/frappe/images/signature-placeholder.png") {
			return "";
		}
		return value;
	}

	set_formatted_input(value) {
		this.set_input(value);
	}

	refresh_input() {
		this.render_display();

		// Update read-only state
		if (this.get_status() !== "Write") {
			this.display_wrapper.classList.add("readonly");
		} else {
			this.display_wrapper.classList.remove("readonly");
		}
	}
}
