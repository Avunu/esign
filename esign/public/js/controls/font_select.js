import { toDom } from "hast-util-to-dom";

/**
 * @fileoverview FontSelect control for Frappe Framework
 * @description A custom select control that renders font options in their actual font.
 * Uses HAST for DOM creation, Popover API for dropdown, and CSS Anchor Positioning.
 *
 * @requires hast-util-to-dom - For efficient DOM structure creation
 *
 * @author Avunu LLC
 */

/**
 * Generates a unique anchor name for CSS anchor positioning
 * @returns {string} Unique anchor name
 */
let anchorCounter = 0;
function generateAnchorName() {
	return `--font-select-anchor-${++anchorCounter}`;
}

export class ControlFontSelect extends frappe.ui.form.ControlData {
	make_input() {
		if (this.has_input) return;

		// Parse options from df.options (can be array or newline-separated string)
		this._options = this.parse_options();
		this._anchor_name = generateAnchorName();

		// Generate unique IDs for popover association
		const popoverId = `font-select-popover-${anchorCounter}`;

		// Build options list for HAST
		const optionItems = this._options.map((opt, index) => ({
			type: "element",
			tagName: "button",
			properties: {
				type: "button",
				className: ["font-select-option"],
				dataValue: opt.value,
				dataIndex: index,
				dataFontFamily: opt.fontFamily,
			},
			children: [{ type: "text", value: opt.label }],
		}));

		// Define complete structure using HAST
		// Structure: div.font-select-wrapper > [button.font-select-trigger, div.font-select-popover[popover] > div.font-select-options]
		const wrapperStructure = {
			type: "element",
			tagName: "div",
			properties: {
				className: ["font-select-wrapper"],
				style: `anchor-name: ${this._anchor_name};`,
			},
			children: [
				{
					type: "element",
					tagName: "button",
					properties: {
						type: "button",
						className: [
							"font-select-trigger",
							"btn",
							"btn-default",
							"btn-sm",
						],
						popoverTarget: popoverId,
						popoverTargetAction: "toggle",
					},
					children: [
						{
							type: "element",
							tagName: "span",
							properties: { className: ["font-select-value"] },
							children: [{ type: "text", value: "" }],
						},
						{
							type: "element",
							tagName: "span",
							properties: { className: ["font-select-arrow"] },
							children: [{ type: "text", value: "▾" }],
						},
					],
				},
				{
					type: "element",
					tagName: "div",
					properties: {
						id: popoverId,
						popover: "auto",
						className: ["font-select-popover"],
						style: `position-anchor: ${this._anchor_name};`,
					},
					children: [
						{
							type: "element",
							tagName: "div",
							properties: { className: ["font-select-options"] },
							children: optionItems,
						},
					],
				},
			],
		};

		// Convert HAST to DOM
		this.font_select_wrapper = toDom(wrapperStructure);
		this.input_area.appendChild(this.font_select_wrapper);

		// Get references via property accessors
		// wrapper.children[0] = button.font-select-trigger
		// wrapper.children[0].children[0] = span.font-select-value
		// wrapper.children[0].children[1] = span.font-select-arrow
		// wrapper.children[1] = div.font-select-popover
		// wrapper.children[1].children[0] = div.font-select-options
		this.trigger_button = this.font_select_wrapper.children[0];
		this.value_display = this.trigger_button.children[0];
		this.popover_element = this.font_select_wrapper.children[1];
		this.options_container = this.popover_element.children[0];

		// Apply font-family styles to option buttons (can't use style prop in HAST reliably)
		const optionButtons = this.options_container.children;
		for (let i = 0; i < optionButtons.length; i++) {
			const btn = optionButtons[i];
			btn.style.fontFamily = btn.dataset.fontFamily;
		}

		// Bind click handlers for options
		this.options_container.addEventListener("click", (e) => {
			const optionButton = e.target.closest(".font-select-option");
			if (optionButton) {
				const value = optionButton.dataset.value;
				// Update internal value and display
				this.set_input(value);
				this.popover_element.hidePopover();
				// Trigger onchange callback
				if (this.df.onchange) {
					this.df.onchange();
				}
			}
		});

		// Create hidden input for form compatibility
		this.hidden_input = document.createElement("input");
		this.hidden_input.type = "hidden";
		this.hidden_input.name = this.df.fieldname;
		this.font_select_wrapper.appendChild(this.hidden_input);

		// Set references for base class compatibility
		this.$input = $(this.trigger_button);
		this.input = this.hidden_input;
		this.has_input = true;

		// Set initial value
		const defaultValue =
			this.df.default || (this._options[0] && this._options[0].value);
		if (defaultValue) {
			this.set_input(defaultValue);
		}
	}

	/**
	 * Parses options from df.options
	 * Supports:
	 * - Array of strings: ["Font A", "Font B"]
	 * - Array of objects: [{ value: "font-a", label: "Font A", fontFamily: "..." }]
	 * - Newline-separated string: "Font A\nFont B"
	 * @returns {Array<{value: string, label: string, fontFamily: string}>}
	 */
	parse_options() {
		let options = this.df.options || [];

		if (typeof options === "string") {
			options = options.split("\n").filter((o) => o.trim());
		}

		return options.map((opt) => {
			if (typeof opt === "string") {
				return {
					value: opt,
					label: opt,
					fontFamily: opt,
				};
			}
			return {
				value: opt.value || opt.label,
				label: opt.label || opt.value,
				fontFamily: opt.fontFamily || opt.value,
			};
		});
	}

	/**
	 * Gets option by value
	 * @param {string} value
	 * @returns {Object|undefined}
	 */
	get_option(value) {
		return this._options.find((opt) => opt.value === value);
	}

	set_input(value) {
		this.last_value = this.value;
		this.value = value;

		const option = this.get_option(value);
		if (option && this.value_display) {
			this.value_display.textContent = option.label;
			this.value_display.style.fontFamily = option.fontFamily;
		}

		if (this.hidden_input) {
			this.hidden_input.value = value || "";
		}

		// Update selected state in options
		if (this.options_container) {
			const optionButtons = this.options_container.children;
			for (let i = 0; i < optionButtons.length; i++) {
				const btn = optionButtons[i];
				if (btn.dataset.value === value) {
					btn.classList.add("selected");
				} else {
					btn.classList.remove("selected");
				}
			}
		}
	}

	get_input_value() {
		return this.value;
	}

	get_value() {
		return this.value || this.get_model_value();
	}

	set_formatted_input(value) {
		this.set_input(value);
	}

	/**
	 * Refreshes options if they have changed
	 */
	refresh() {
		super.refresh();
		// Check if options changed
		const newOptions = this.parse_options();
		const newOptionsJson = JSON.stringify(newOptions);
		if (this._last_options_json !== newOptionsJson) {
			this._last_options_json = newOptionsJson;
			this._options = newOptions;
			this.rebuild_options();
		}
	}

	/**
	 * Rebuilds the options list
	 */
	rebuild_options() {
		if (!this.options_container) return;

		// Clear existing options
		while (this.options_container.firstChild) {
			this.options_container.removeChild(
				this.options_container.firstChild,
			);
		}

		// Build new options
		this._options.forEach((opt, index) => {
			const optionStructure = {
				type: "element",
				tagName: "button",
				properties: {
					type: "button",
					className: ["font-select-option"],
					dataValue: opt.value,
					dataIndex: index,
				},
				children: [{ type: "text", value: opt.label }],
			};
			const optionEl = toDom(optionStructure);
			optionEl.style.fontFamily = opt.fontFamily;
			if (opt.value === this.value) {
				optionEl.classList.add("selected");
			}
			this.options_container.appendChild(optionEl);
		});
	}
}

// Register control globally for Frappe
frappe.ui.form.ControlFontSelect = ControlFontSelect;
