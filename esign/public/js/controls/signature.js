import { toDom } from "hast-util-to-dom";
import { createIconHast } from "./utils";

/**
 * @fileoverview Signature control for Frappe Framework
 * @description This module provides a signature control that displays signatures
 * and opens a dialog for drawing, typing, or uploading signatures.
 * Uses HAST for DOM structure creation.
 *
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
 * Gets available signature fonts using Local Font Access API.
 * Falls back to all fonts if API unavailable or permission denied.
 * @returns {Promise<Array<{value: string, label: string, fontFamily: string}>>}
 */
async function getAvailableFonts() {
	// Check if Local Font Access API is available
	if (!("queryLocalFonts" in window)) {
		// Fallback: return all fonts
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

		// Fallback: if no fonts detected, return all
		return available.length > 0
			? available
			: Object.entries(SIGNATURE_FONTS).map(([label, fontFamily]) => ({
					value: label,
					label,
					fontFamily,
				}));
	} catch {
		// Permission denied or error - return all fonts
		return Object.entries(SIGNATURE_FONTS).map(([label, fontFamily]) => ({
			value: label,
			label,
			fontFamily,
		}));
	}
}

class MockForm {
	constructor(control) {
		this.doctype = "Signature Dialog";
		this.name = "Signature Dialog";
		this.doc = { docstatus: 0 };
		this.control = control;
		this.meta = {
			make_attachments_public: false,
		};
	}

	get_perm(permlevel, ptype) {
		return true;
	}

	save() {
		return true;
	}

	set_active_tab(active_tab) {
		const previousTabId = `signature-dialog-${this.active_tab?.df?.fieldname}`;
		const activeTabId = `signature-dialog-${active_tab?.df?.fieldname}`;

		// Get tab content elements
		const previousTabContent =
			this.active_tab?.tabs_content?.[0]?.querySelector(
				`#${previousTabId}`,
			);
		const activeTabContent =
			this.active_tab?.tabs_content?.[0]?.querySelector(
				`#${activeTabId}`,
			);

		// Set new active tab
		this.active_tab = active_tab;

		if (activeTabContent) {
			activeTabContent.classList.add("active", "show");
		}
		if (previousTabContent) {
			previousTabContent.classList.remove("active", "show");
		}
	}
}

export class ControlSignature extends frappe.ui.form.ControlData {
	make() {
		super.make();

		// Store reference to label element (created by parent)
		if (this.df.label && this.label_area) {
			this.label_area.textContent = __(
				this.df.label,
				null,
				this.df.parent,
			);
		}

		// make a pointer to value
		this.value = this.get_value();

		// Define structure using hast (HTML Abstract Syntax Tree)
		// Structure: div.signature-canvas-container > [canvas, div.signature-overlay > div.signature-overlay-text > [svg, div]]
		const containerStructure = {
			type: "element",
			tagName: "div",
			properties: { className: ["signature-canvas-container"] },
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
								className: ["signature-overlay-text"],
							},
							children: [
								createIconHast("add", "md"),
								{
									type: "element",
									tagName: "div",
									properties: { style: "margin-top: 8px;" },
									children: [
										{
											type: "text",
											value: __("Add your signature"),
										},
									],
								},
							],
						},
					],
				},
			],
		};

		// Convert hast to DOM and prepend to wrapper
		this.canvas_container = toDom(containerStructure);
		this.$input_wrapper[0].prepend(this.canvas_container);

		// Get references via property accessors
		// canvas_container.children[0] = canvas
		// canvas_container.children[1] = div.signature-overlay
		// canvas_container.children[1].children[0] = div.signature-overlay-text
		// canvas_container.children[1].children[0].children[0] = svg (icon)
		// canvas_container.children[1].children[0].children[1] = div (text)
		this.display_canvas = this.canvas_container.children[0];
		this.overlay = this.canvas_container.children[1];
		this.overlay_text = this.overlay.children[0];
		this.overlay_icon = this.overlay_text.children[0];
		this.overlay_label = this.overlay_text.children[1];

		// Add hover effect
		this.canvas_container.addEventListener("mouseenter", () => {
			if (this.get_status() === "Write") {
				this.overlay.style.opacity = "1";
			}
		});

		this.canvas_container.addEventListener("mouseleave", () => {
			this.overlay.style.opacity = "0";
		});

		// Add click handler
		this.canvas_container.addEventListener("click", (e) => {
			if (this.get_status() === "Write") {
				e.preventDefault();
				this.show_signature_dialog();
			}
		});

		this.refresh_input();
	}

	async show_signature_dialog() {
		const me = this;

		// Get available fonts filtered by system availability
		const fontOptions = await getAvailableFonts();

		let signature_dialog = new frappe.ui.Dialog({
			title: __("Add your signature"),
			fields: [
				{
					label: __("Draw"),
					fieldtype: "Tab Break",
					fieldname: "tab_draw",
					active: true,
				},
				{
					label: __("Draw Your Signature"),
					fieldtype: "SignaturePad",
					fieldname: "signature_draw",
				},
				{
					label: __("Type"),
					fieldtype: "Tab Break",
					fieldname: "tab_type",
				},
				{
					fieldtype: "Column Break",
				},
				{
					label: __("Type Your Signature"),
					fieldtype: "Data",
					fieldname: "signature_typed",
					input_class: "signature-typed-input",
					onchange: () => {
						me.update_typed_preview(signature_dialog);
					},
				},
				{
					fieldtype: "Column Break",
				},
				{
					label: __("Font Style"),
					fieldtype: "FontSelect",
					fieldname: "signature_font",
					options: fontOptions,
					default: fontOptions[0].value,
					onchange: () => {
						me.update_typed_preview(signature_dialog);
					},
				},
				{
					fieldtype: "Section Break",
				},
				{
					fieldtype: "HTML",
					fieldname: "signature_typed_preview",
				},
				{
					label: __("Upload"),
					fieldtype: "Tab Break",
					fieldname: "tab_upload",
				},
				{
					label: __("Upload Your Signature"),
					fieldtype: "Upload",
					fieldname: "signature_upload",
					options: {
						allowed_file_types: ["image/*"],
					},
				},
			],
			frm: new MockForm(this),
			size: "large",
			primary_action_label: __("Insert Signature"),
			primary_action: function () {
				const current_tab =
					signature_dialog.frm.active_tab?.df.fieldname || null;

				if (current_tab === "tab_draw") {
					const signature_field =
						signature_dialog.fields_dict.signature_draw;
					let signature_data;

					if (signature_field && signature_field.signature_pad) {
						if (!signature_field.signature_pad.isEmpty()) {
							signature_data =
								signature_field.canvas.toDataURL("image/png");
						}
					}

					if (signature_data) {
						me.set_signature_value(signature_data, "draw");
						signature_dialog.hide();
					} else {
						frappe.msgprint(__("Please draw a signature first"));
					}
				} else if (current_tab === "tab_type") {
					let typed_signature =
						signature_dialog.get_value("signature_typed");
					let selected_font =
						signature_dialog.get_value("signature_font");
					if (typed_signature) {
						me.convert_typed_to_base64(
							typed_signature,
							selected_font,
						).then((base64) => {
							me.set_signature_value(base64, "typed");
							signature_dialog.hide();
						});
					} else {
						frappe.msgprint(__("Please enter a signature text"));
					}
				} else if (current_tab === "tab_upload") {
					let uploaded_signature =
						signature_dialog.get_value("signature_upload");
					if (uploaded_signature) {
						me.map_upload_to_canvas(uploaded_signature).then(
							(base64) => {
								me.set_signature_value(base64, "upload");
								signature_dialog.hide();
							},
						);
					} else {
						frappe.msgprint(__("Please upload a signature image"));
					}
				} else {
					frappe.msgprint(
						__("Please select a method to add your signature"),
					);
				}
			},
		});

		this.signature_dialog = signature_dialog;
		signature_dialog.header.hide();
		signature_dialog.show();

		// Setup typed signature preview after dialog is shown
		this.setup_typed_preview(signature_dialog);
	}

	/**
	 * Sets up the typed signature preview area with signature line
	 * @param {frappe.ui.Dialog} dialog - The signature dialog instance
	 */
	setup_typed_preview(dialog) {
		const preview_field = dialog.fields_dict.signature_typed_preview;
		if (!preview_field || !preview_field.$wrapper) return;

		// Define preview structure using hast
		// Structure: div.signature-typed-preview-wrapper > [div.signature-typed-text, div.signature-line]
		const previewStructure = {
			type: "element",
			tagName: "div",
			properties: { className: ["signature-typed-preview-wrapper"] },
			children: [
				{
					type: "element",
					tagName: "div",
					properties: { className: ["signature-typed-text"] },
					children: [],
				},
				{
					type: "element",
					tagName: "div",
					properties: { className: ["signature-line"] },
					children: [],
				},
			],
		};

		this.typed_preview_wrapper = toDom(previewStructure);
		// wrapper.children[0] = div.signature-typed-text
		// wrapper.children[1] = div.signature-line
		this.typed_preview_text = this.typed_preview_wrapper.children[0];
		preview_field.$wrapper[0].appendChild(this.typed_preview_wrapper);
	}

	/**
	 * Updates the typed signature preview with current input value and font
	 * @param {frappe.ui.Dialog} dialog - The signature dialog instance
	 */
	update_typed_preview(dialog) {
		if (!this.typed_preview_text) return;
		const typed_value = dialog.get_value("signature_typed") || "";
		const font_name =
			dialog.get_value("signature_font") ||
			Object.keys(SIGNATURE_FONTS)[0];
		const font_family = SIGNATURE_FONTS[font_name];

		this.typed_preview_text.textContent = typed_value;
		this.typed_preview_text.style.fontFamily = font_family;
	}

	/**
	 * Converts typed text to a base64 PNG image
	 * @param {string} text - The signature text
	 * @param {string} fontName - The font name key from SIGNATURE_FONTS
	 * @returns {Promise<string>} Base64 encoded PNG data URL
	 */
	convert_typed_to_base64(text, fontName) {
		return new Promise((resolve) => {
			// Get font family from name, fallback to first font
			const fontFamily =
				SIGNATURE_FONTS[fontName] ||
				SIGNATURE_FONTS[Object.keys(SIGNATURE_FONTS)[0]];

			// Create a canvas to render the typed text
			const canvas = document.createElement("canvas");
			canvas.width = 750;
			canvas.height = 292;
			const ctx = canvas.getContext("2d");

			// Set background to transparency
			ctx.fillStyle = "transparent";
			ctx.fillRect(0, 0, canvas.width, canvas.height);

			// Set text properties with selected font
			ctx.fillStyle = "#000000";
			ctx.font = `italic 50px ${fontFamily}`;
			ctx.textAlign = "center";
			ctx.textBaseline = "alphabetic";

			// Draw text at 3/4 from the top (1/4 from bottom)
			// This matches the visual signature line position
			const signatureLineY = canvas.height * 0.75;
			ctx.fillText(text, canvas.width / 2, signatureLineY);

			// Convert to base64 PNG
			const base64 = canvas.toDataURL("image/png");
			resolve(base64);
		});
	}

	map_upload_to_canvas(dataUrl) {
		return new Promise((resolve, reject) => {
			// Create canvas with consistent dimensions (same as typed signature)
			const canvas = document.createElement("canvas");
			canvas.width = 750;
			canvas.height = 292;
			const ctx = canvas.getContext("2d");

			// Set transparent background
			ctx.fillStyle = "transparent";
			ctx.fillRect(0, 0, canvas.width, canvas.height);

			// Load the uploaded image
			const img = new Image();
			img.onload = function () {
				// Calculate scaling to fit within canvas while maintaining aspect ratio
				const padding = 20;
				const maxWidth = canvas.width - padding * 2;
				const maxHeight = canvas.height - padding * 2;

				let width = img.width;
				let height = img.height;
				const aspectRatio = width / height;

				// Scale to fit within bounds
				if (width > maxWidth) {
					width = maxWidth;
					height = width / aspectRatio;
				}
				if (height > maxHeight) {
					height = maxHeight;
					width = height * aspectRatio;
				}

				// Center the image on canvas
				const x = (canvas.width - width) / 2;
				const y = (canvas.height - height) / 2;

				// Draw the image centered and scaled
				ctx.drawImage(img, x, y, width, height);

				// Convert to base64 PNG
				const base64 = canvas.toDataURL("image/png");
				resolve(base64);
			};
			img.onerror = reject;
			img.src = dataUrl;
		});
	}

	set_signature_value(base64_data, method) {
		this.set_value(base64_data);
		this.value = base64_data;
		this.refresh_input();
		frappe.toast({
			message: __("Signature added successfully"),
			indicator: "green",
		});
	}

	refresh_input() {
		if (!this.canvas_container) return;

		// Hide the actual input field (created by parent ControlData)
		if (this.input_area) {
			this.input_area.style.display = "none";
		}

		const value = this.get_value();
		const can_write = this.get_status() === "Write";

		// Update canvas display
		this.render_signature(value);

		// Update overlay text and interaction
		if (can_write) {
			this.canvas_container.classList.remove("readonly");

			// Update icon and label text based on current value
			if (value) {
				// Replace icon with edit icon
				const newIcon = toDom(createIconHast("edit", "md"));
				this.overlay_text.replaceChild(newIcon, this.overlay_icon);
				this.overlay_icon = newIcon;
				this.overlay_label.textContent = __("Replace signature");
			} else {
				// Replace icon with add icon
				const newIcon = toDom(createIconHast("add", "md"));
				this.overlay_text.replaceChild(newIcon, this.overlay_icon);
				this.overlay_icon = newIcon;
				this.overlay_label.textContent = __("Add your signature");
			}
		} else {
			this.canvas_container.classList.add("readonly");
			this.overlay.style.opacity = "0";
		}

		if (this.get_status() === "Read" && this.disp_area) {
			this.disp_area.style.display = "none";
		}
	}

	render_signature(value) {
		const ctx = this.display_canvas.getContext("2d");

		// Clear canvas
		ctx.clearRect(
			0,
			0,
			this.display_canvas.width,
			this.display_canvas.height,
		);

		if (value) {
			// Load and draw signature
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
		} else {
			// Draw empty state with dashed border
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
	}

	get_value() {
		const value = this.value || this.get_model_value();
		if (value == "/assets/frappe/images/signature-placeholder.png") {
			return "";
		}
		return value;
	}
}
