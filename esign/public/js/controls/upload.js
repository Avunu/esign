export class ControlUpload extends frappe.ui.form.ControlData {
	make_input() {
		if (this.$input) return;

		// Create hidden file input
		this.file_input = document.createElement("input");
		this.file_input.type = "file";
		this.file_input.className = "hidden";
		this.file_input.accept = this.df.options?.allowed_file_types?.join(",") || "image/*";
		this.file_input.addEventListener("change", (e) => {
			this.handle_file_selection(e);
		});
		this.input_area.appendChild(this.file_input);

		// Create upload button
		const button = document.createElement("button");
		button.className = "btn btn-default btn-sm btn-upload";
		button.textContent = __("Upload");
		button.addEventListener("click", (e) => {
			e.preventDefault();
			this.file_input.click();
		});
		this.input_area.prepend(button);
		this.$input = $(button);

		// Create preview area
		const preview = document.createElement("div");
		preview.className = "upload-preview";

		this.preview_img = document.createElement("img");
		this.preview_img.className = "upload-preview-img";
		preview.appendChild(this.preview_img);

		this.input_area.appendChild(preview);
		this.preview_element = preview;

		this.input = button;
		this.has_input = true;
		this.set_input_attributes();
	}

	handle_file_selection(e) {
		const file = e.target.files[0];
		if (!file) return;

		// Convert to base64
		const reader = new FileReader();
		reader.onload = (e) => {
			const dataurl = e.target.result;
			this.set_value(dataurl);
			this.value = dataurl;
			this.set_preview(dataurl);
		};
		reader.readAsDataURL(file);
	}

	set_preview(dataurl) {
		if (dataurl) {
			this.preview_img.src = dataurl;
			this.preview_element.classList.add("active");
			this.$input.textContent = __("Change");
		} else {
			this.preview_element.classList.remove("active");
			this.$input.textContent = __("Upload");
		}
	}

	set_input(value) {
		this.last_value = this.value;
		this.value = value;
		this.set_formatted_input(value);
		this.set_preview(value);
	}

	get_value() {
		return this.value || null;
	}
}
