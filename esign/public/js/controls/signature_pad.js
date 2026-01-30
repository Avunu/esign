import SignaturePad from "signature_pad";
import { createIconHast, toDom } from "./utils";

/**
 * @fileoverview SignaturePad control for Frappe Framework
 * @description This module provides a signature pad control that allows users
 * to draw signatures directly on a canvas. Uses HAST for DOM structure creation.
 *
 * Uses custom `toDom()` wrapper with string refs for element binding:
 * - String ref: `ref: "myElement"` → assigns to `this.myElement`
 * - Events: `data: { onclick: () => ... }` → assigned directly to element
 *
 * @requires signature_pad - For canvas-based signature drawing
 * @requires hast-util-to-dom - For efficient DOM structure creation
 *
 * @author Avunu LLC
 */

export class ControlSignaturePad extends frappe.ui.form.ControlData {
	make() {
		this.saving = false;
		this.loading = false;
		super.make();

		if (this.df.label) {
			$(this.wrapper)
				.find("label")
				.text(__(this.df.label, null, this.df.parent));
		}

		// Define complete structure using hast (HTML Abstract Syntax Tree)
		// All element refs and events are bound inline via `data` property
		const bodyStructure = {
			type: "element",
			tagName: "div",
			properties: { className: ["signature-field"] },
			ref: "body",
			children: [
				{
					type: "element",
					tagName: "div",
					properties: { className: ["signature-canvas-wrapper"] },
					ref: "canvas_wrapper",
					children: [
						{
							type: "element",
							tagName: "canvas",
							properties: {
								width: 750,
								height: 292,
							},
							ref: "canvas",
							children: [],
						},
						{
							type: "element",
							tagName: "div",
							properties: { className: ["signature-line"] },
							children: [],
						},
					],
				},
				{
					type: "element",
					tagName: "div",
					properties: { className: ["signature-btn-row"] },
					children: [
						{
							type: "element",
							tagName: "a",
							properties: {
								href: "#",
								type: "button",
								className: [
									"signature-reset",
									"btn",
									"icon-btn",
								],
							},
							data: {
								onclick: (e) => {
									e.preventDefault();
									this.on_reset_sign();
								},
							},
							children: [createIconHast("es-line-reload", "sm")],
						},
					],
				},
			],
		};

		// Convert hast to DOM and prepend to wrapper
		toDom(bodyStructure, this);
		this.$input_wrapper[0].prepend(this.body);

		new ResizeObserver(() => this.make_pad()).observe(this.body);
	}

	make_pad() {
		let width = this.body.offsetWidth;
		if (width > 0) {
			// Resize canvas to match CSS size and device pixel ratio
			this.resize_canvas();

			if (!this.signature_pad) {
				// Initialize signature_pad with options
				this.signature_pad = new SignaturePad(this.canvas, {
					backgroundColor: "transparent",
					penColor: "black",
				});

				// Handle signature changes
				this.signature_pad.addEventListener("endStroke", () => {
					this.on_save_sign();
				});

				this.load_pad();
				this.refresh_input();
			}
		}
	}

	/**
	 * Resize the canvas to match its CSS-rendered size and account for device pixel ratio.
	 * This is required for signature_pad to work correctly when the canvas is scaled via CSS.
	 */
	resize_canvas() {
		const ratio = Math.max(window.devicePixelRatio || 1, 1);
		const rect = this.canvas.getBoundingClientRect();

		// Only resize if dimensions have changed
		if (
			this.canvas.width !== rect.width * ratio ||
			this.canvas.height !== rect.height * ratio
		) {
			this.canvas.width = rect.width * ratio;
			this.canvas.height = rect.height * ratio;
			this.canvas.getContext("2d").scale(ratio, ratio);

			// If signature_pad already exists, clear it (resize invalidates content)
			if (this.signature_pad) {
				this.signature_pad.clear();
			}
		}
	}

	on_save_sign() {
		if (this.saving || this.loading) return;
		if (!this.signature_pad.isEmpty()) {
			const dataUrl = this.canvas.toDataURL("image/png");
			this.set_my_value(dataUrl);
		}
	}

	on_reset_sign() {
		this.signature_pad.clear();
		this.set_my_value("");
	}

	set_my_value(value) {
		if (this.saving || this.loading) return;
		this.saving = true;
		this.set_value(value);
		this.value = value;
		this.saving = false;
	}

	load_pad() {
		if (this.saving || !this.signature_pad) return;

		this.loading = true;
		const value = this.get_value();

		// Clear the pad
		this.signature_pad.clear();

		// Load existing signature if present
		if (value) {
			try {
				this.signature_pad.fromDataURL(value);
			} catch (e) {
				console.log("Cannot load signature data", value, e);
			}
		}

		this.loading = false;
	}

	set_input(value) {
		if (!this.signature_pad) return;
		this.value = value;
		this.load_pad();
	}

	get_value() {
		return this.value || this.get_model_value();
	}

	refresh_input() {
		if (!this.body) return;

		// Make sure pad is initialized
		this.make_pad();

		// Hide the default input wrapper
		const controlInput =
			this.$wrapper?.[0]?.getElementsByClassName?.("control-input")?.[0];
		if (controlInput) {
			controlInput.style.display = "none";
		}

		// Load current value
		this.load_pad();
	}

	on_section_collapse() {
		this.refresh();
	}
}
