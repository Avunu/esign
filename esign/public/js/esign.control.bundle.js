document.addEventListener('DOMContentLoaded', function () {

	// Preserve the original signature control as SignaturePad
	frappe.ui.form.ControlSignaturePad = frappe.ui.form.ControlSignature;

	// Simple upload control using native file input
	frappe.ui.form.ControlUpload = class ControlUpload extends frappe.ui.form.ControlData {
		make_input() {
			if (this.$input) return;

			// Create hidden file input
			this.file_input = document.createElement('input');
			this.file_input.type = 'file';
			this.file_input.className = 'hidden';
			this.file_input.accept = this.df.options?.allowed_file_types?.join(',') || 'image/*';
			this.file_input.addEventListener('change', (e) => {
				this.handle_file_selection(e);
			});
			this.input_area.appendChild(this.file_input);

			// Create upload button
			const button = document.createElement('button');
			button.className = 'btn btn-default btn-sm btn-upload';
			button.textContent = __("Upload");
			button.addEventListener('click', (e) => {
				e.preventDefault();
				this.file_input.click();
			});
			this.input_area.prepend(button);
			this.$input = $(button);

			// Create preview area
			const preview = document.createElement('div');
			preview.className = 'upload-preview';
			preview.style.cssText = 'margin-top: 10px; display: none;';

			this.preview_img = document.createElement('img');
			this.preview_img.className = 'upload-preview-img';
			this.preview_img.style.cssText = 'max-width: 100%; max-height: 200px; border: 1px solid var(--border-color); border-radius: var(--border-radius);';
			preview.appendChild(this.preview_img);

			this.input_area.appendChild(preview);
			this.$preview = $(preview);

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
				this.$preview[0].style.display = '';
				this.$input[0].textContent = __("Change");
			} else {
				this.$preview[0].style.display = 'none';
				this.$input[0].textContent = this.df.label || __("Upload");
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
	};

	mockForm = class {
		constructor(control) {
			this.doctype = 'Signature Dialog';
			this.name = 'Signature Dialog';
			this.doc = { docstatus: 0 };
			this.control = control;
			this.meta = {
				make_attachments_public: false
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
			const $previousTabContent = this.active_tab?.tabs_content?.find(`#${previousTabId}`);
			const activeTabId = `signature-dialog-${active_tab?.df?.fieldname}`;
			const $activeTabContent = this.active_tab?.tabs_content?.find(`#${activeTabId}`);

			// Set new active tab
			this.active_tab = active_tab;
			$activeTabContent ? $activeTabContent.addClass('active show') : null;
			$previousTabContent ? $previousTabContent.removeClass('active show') : null;
		}
	};

	// Override the Signature control with our custom dialog-based control
	frappe.ui.form.ControlSignature = class ControlSignature extends frappe.ui.form.ControlData {

		make() {
			super.make();

			// Store reference to label element (created by parent)
			if (this.df.label && this.label_area) {
				this.label_area.textContent = __(this.df.label, null, this.df.parent);
			}

			// make a pointer to value
			this.value = this.get_value();

			// Create button container
			this.button_wrapper = document.createElement('div');
			this.button_wrapper.className = 'signature-button-wrapper';
			this.$input_wrapper[0].prepend(this.button_wrapper);

			// Create image display container
			this.img_wrapper = document.createElement('div');
			this.img_wrapper.className = 'signature-display';

			this.missing_image = document.createElement('div');
			this.missing_image.className = 'missing-image attach-missing-image';
			this.missing_image.innerHTML = frappe.utils.icon("restriction", "md");
			this.img_wrapper.appendChild(this.missing_image);

			this.$input_wrapper[0].prepend(this.img_wrapper);

			this.img = document.createElement('img');
			this.img.className = 'img-responsive attach-image-display';
			this.img.style.display = 'none';
			this.img_wrapper.appendChild(this.img);

			this.make_signature_button();
		}

		make_signature_button() {
			this.add_button = document.createElement('button');
			this.add_button.className = 'btn btn-default btn-sm';
			this.add_button.textContent = __("Add your signature");
			this.add_button.addEventListener('click', (e) => {
				e.preventDefault();
				this.show_signature_dialog();
			});
			this.button_wrapper.appendChild(this.add_button);
		}

		show_signature_dialog() {
			const me = this;

			let signature_dialog = new frappe.ui.Dialog({
				title: __("Add your signature"),
				fields: [
					{
						label: __("Draw"),
						fieldtype: "Tab Break",
						fieldname: "tab_draw",
						active: true
					},
					{
						label: __("Draw Your Signature"),
						fieldtype: "SignaturePad",
						fieldname: "signature_draw"
					},
					{
						label: __("Type"),
						fieldtype: "Tab Break",
						fieldname: "tab_type"
					},
					{
						label: __("Type Your Signature"),
						fieldtype: "Data",
						fieldname: "signature_typed",
						input_class: "signature-typed-input"
					},
					{
						label: __("Upload"),
						fieldtype: "Tab Break",
						fieldname: "tab_upload"
					},
					{
						label: __("Upload Your Signature"),
						fieldtype: "Upload",
						fieldname: "signature_upload",
						options: {
							allowed_file_types: ['image/*']
						}
					}
				],
				frm: new mockForm(this),
				size: "large",
				primary_action_label: __("Insert Signature"),
				primary_action: function () {
					const current_tab = signature_dialog.frm.active_tab?.df.fieldname || null;

					if (current_tab === 'tab_draw') {
						// Access the signature field directly and get data from jSignature
						const signature_field = signature_dialog.fields_dict.signature_draw;
						let signature_data;

						if (signature_field && signature_field.$pad) {
							// Get data directly from jSignature pad
							signature_data = signature_field.$pad.jSignature("getData");
						}

						if (signature_data) {
							me.set_signature_value(signature_data, 'draw');
							signature_dialog.hide();
						} else {
							frappe.msgprint(__("Please draw a signature first"));
						}
					} else if (current_tab === 'tab_type') {
						let typed_signature = signature_dialog.get_value('signature_typed');
						if (typed_signature) {
							me.convert_typed_to_base64(typed_signature).then((base64) => {
								me.set_signature_value(base64, 'typed');
								signature_dialog.hide();
							});
						} else {
							frappe.msgprint(__("Please enter a signature text"));
						}
					} else if (current_tab === 'tab_upload') {
						let uploaded_signature = signature_dialog.get_value('signature_upload');
						console.log('Uploaded signature data:', uploaded_signature);
						if (uploaded_signature) {
							me.set_signature_value(uploaded_signature, 'upload');
							signature_dialog.hide();
						} else {
							frappe.msgprint(__("Please upload a signature image"));
						}
					} else {
						frappe.msgprint(__("Please select a method to add your signature"));
					}
				}
			});

			// Store reference for debugging
			this.signature_dialog = signature_dialog;

			signature_dialog.header.hide();
			signature_dialog.show();
		}

		convert_typed_to_base64(text) {
			return new Promise((resolve) => {
				// Create a canvas to render the typed text
				const canvas = document.createElement('canvas');
				canvas.width = 600;
				canvas.height = 200;
				const ctx = canvas.getContext('2d');

				// Set background to transparency for better visibility
				ctx.fillStyle = 'transparent';
				ctx.fillRect(0, 0, canvas.width, canvas.height);

				// Draw signature line
				ctx.strokeStyle = '#777777ff';
				ctx.lineWidth = 2;
				ctx.beginPath();
				ctx.moveTo(70, canvas.height - 70);
				ctx.lineTo(canvas.width - 70, canvas.height - 70);
				ctx.stroke();

				// Set text properties
				ctx.fillStyle = '#000000';
				ctx.font = 'italic 50px "Brush Script MT", "Lucida Handwriting", "Bradley Hand", "Segoe Script", "Segoe UI", cursive';
				ctx.textAlign = 'center';
				ctx.textBaseline = 'middle';

				// Draw text
				ctx.fillText(text, canvas.width / 2, canvas.height / 2 - 10);

				// Convert to base64 PNG
				const base64 = canvas.toDataURL('image/png');
				resolve(base64);
			});
		}

		convert_url_to_base64(url) {
			return new Promise((resolve, reject) => {
				// If it's already a data URL, return it
				if (url.startsWith('data:')) {
					resolve(url);
					return;
				}

				// Otherwise, fetch and convert
				const img = new Image();
				img.crossOrigin = 'Anonymous';
				img.onload = function () {
					const canvas = document.createElement('canvas');
					canvas.width = img.width;
					canvas.height = img.height;
					const ctx = canvas.getContext('2d');
					ctx.drawImage(img, 0, 0);
					resolve(canvas.toDataURL('image/png'));
				};
				img.onerror = reject;
				img.src = url;
			});
		}

		set_signature_value(base64_data, method) {
			this.set_value(base64_data);
			this.value = base64_data;
			this.refresh_input();
			frappe.show_alert({
				message: __("Signature added successfully"),
				indicator: 'green'
			});
		}

		refresh_input() {
			// Don't use the parent's refresh_input
			if (!this.button_wrapper) return;

			// Hide the actual input field (created by parent ControlData)
			if (this.input_area) {
				this.input_area.style.display = 'none';
			}

			const value = this.get_value();
			const can_write = this.get_status() === "Write";

			if (value) {
				// Show signature image
				this.set_image(value);
				this.button_wrapper.style.display = can_write ? '' : 'none';
				this.add_button.textContent = __("Change signature");
			} else {
				// Show add button only if editable
				this.img_wrapper.style.display = 'none';
				this.button_wrapper.style.display = can_write ? '' : 'none';
				this.add_button.textContent = __("Add your signature");
			}

			if (this.get_status() === "Read" && this.disp_area) {
				this.disp_area.style.display = 'none';
			}
		}

		set_image(value) {
			if (value) {
				this.missing_image.style.display = 'none';
				this.img.src = value;
				this.img.style.display = '';
				this.img_wrapper.style.display = '';
			} else {
				this.missing_image.style.display = '';
				this.img.style.display = 'none';
				this.img_wrapper.style.display = 'none';
			}
		}

		get_value() {
			return this.value || this.get_model_value();
		}
	};
});