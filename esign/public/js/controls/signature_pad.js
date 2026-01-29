import SignaturePad from "signature_pad";
import { toDom } from "hast-util-to-dom";
import { createIconHast } from "./utils";

/**
 * @fileoverview SignaturePad control for Frappe Framework
 * @description This module provides a signature pad control that allows users
 * to draw signatures directly on a canvas. Uses HAST for DOM structure creation.
 *
 * @requires signature_pad - For canvas-based signature drawing
 * @requires hast-util-to-dom - For efficient DOM structure creation
 *
 * @author Avunu LLC
 */

export class ControlSignaturePad extends frappe.ui.form.ControlData {
	make() {
		var me = this;
		this.saving = false;
		this.loading = false;
		super.make();

		if (this.df.label) {
			$(this.wrapper)
				.find("label")
				.text(__(this.df.label, null, this.df.parent));
		}

		// Define complete structure using hast (HTML Abstract Syntax Tree)
		// Structure: div.signature-field > [div.signature-canvas-wrapper > [canvas, div.signature-line], div.signature-btn-row > a.signature-reset > svg]
		const bodyStructure = {
			type: "element",
			tagName: "div",
			properties: { className: ["signature-field"] },
			children: [
				{
					type: "element",
					tagName: "div",
					properties: { className: ["signature-canvas-wrapper"] },
					children: [
						{
							type: "element",
							tagName: "canvas",
							properties: {
								width: 750,
								height: 292,
							},
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
							children: [createIconHast("es-line-reload", "sm")],
						},
					],
				},
			],
		};

		// Convert hast to DOM and prepend to wrapper
		me.body = toDom(bodyStructure);
		me.$input_wrapper[0].prepend(me.body);

		new ResizeObserver(() => me.make_pad()).observe(this.body);
	}

	make_pad() {
		let width = this.body.offsetWidth;
		if (width > 0 && !this.signature_pad) {
			// Get references via property accessors
			// body.children[0] = div.signature-canvas-wrapper
			// body.children[0].children[0] = canvas
			// body.children[0].children[1] = div.signature-line
			// body.children[1] = div.signature-btn-row
			// body.children[1].children[0] = a.signature-reset
			this.canvas_wrapper = this.body.children[0];
			this.canvas = this.canvas_wrapper.children[0];
			this.signature_line = this.canvas_wrapper.children[1];
			this.reset_button_wrapper = this.body.children[1];
			const resetButton = this.reset_button_wrapper.children[0];

			// Initialize signature_pad with options
			this.signature_pad = new SignaturePad(this.canvas, {
				backgroundColor: "transparent",
				penColor: "black",
			});

			// Handle signature changes
			this.signature_pad.addEventListener("endStroke", () => {
				this.on_save_sign();
			});

			// Handle reset button click
			this.reset_button_wrapper.addEventListener("click", (e) => {
				if (e.target.closest(".signature-reset")) {
					e.preventDefault();
					this.on_reset_sign();
					return false;
				}
			});

			this.load_pad();
			this.refresh_input();
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
			this.$wrapper?.[0]?.querySelector?.(".control-input");
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
