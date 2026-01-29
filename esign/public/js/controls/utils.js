/**
 * @fileoverview Shared utilities for eSign controls
 * @description Provides HAST-based utilities for DOM structure creation.
 *
 * @requires hast-util-to-dom - For efficient DOM structure creation
 *
 * @author Avunu LLC
 */

/**
 * Creates a HAST node for an SVG icon compatible with Frappe's icon system.
 * Supports both standard icons (icon-*) and Espresso icons (es-*).
 *
 * @param {string} icon_name - The name of the icon (e.g., "edit", "add", "es-line-reload")
 * @param {string|{width: string, height: string}} [size="sm"] - Size preset ("xs", "sm", "md", "lg") or custom dimensions
 * @param {string} [icon_class=""] - Additional class for the <use> element
 * @param {string} [icon_style=""] - Additional inline styles for the <svg> element
 * @param {string} [svg_class=""] - Additional class for the <svg> element
 * @returns {Object} HAST element node representing the SVG icon
 *
 * @example
 * // Standard icon
 * createIconHast("edit", "md")
 *
 * @example
 * // Espresso icon
 * createIconHast("es-line-reload", "sm")
 *
 * @example
 * // Custom size
 * createIconHast("add", { width: "24px", height: "24px" })
 */
export function createIconHast(
	icon_name,
	size = "sm",
	icon_class = "",
	icon_style = "",
	svg_class = "",
) {
	let size_class = "";
	const is_espresso = icon_name.startsWith("es-");

	const href = is_espresso ? `#${icon_name}` : `#icon-${icon_name}`;

	if (typeof size === "object") {
		icon_style += ` width: ${size.width}; height: ${size.height}`;
	} else {
		size_class = `icon-${size}`;
	}

	// Determine SVG class based on icon type
	let base_svg_class;
	if (is_espresso) {
		base_svg_class = icon_name.startsWith("es-solid")
			? "es-icon es-solid"
			: "es-icon es-line";
	} else {
		base_svg_class = "icon";
	}

	const classes = [base_svg_class, svg_class, size_class].filter(Boolean);

	return {
		type: "element",
		tagName: "svg",
		properties: {
			className: classes,
			style: icon_style || undefined,
			ariaHidden: "true",
		},
		children: [
			{
				type: "element",
				tagName: "use",
				properties: {
					className: icon_class ? [icon_class] : undefined,
					href: href,
				},
				children: [],
			},
		],
	};
}
