frappe.ready(function () {
	// Preserve the original signature control as SignaturePad
	frappe.ui.form.ControlSignaturePad = frappe.ui.form.ControlSignature;

	// Override the Signature control with our custom dialog-based control
	frappe.ui.form.ControlSignature = class ControlSignature extends frappe.ui.form.ControlData {

		make() {
			super.make();

			if (this.df.label) {
				$(this.wrapper).find("label").text(__(this.df.label, null, this.df.parent));
			}

			// Create button container
			this.button_wrapper = $('<div class="signature-button-wrapper"></div>')
				.prependTo(this.$input_wrapper);

			// Create image display container
			this.img_wrapper = $(`<div class="signature-display">
				<div class="missing-image attach-missing-image">
					${frappe.utils.icon("restriction", "md")}
				</div>
			</div>`).prependTo(this.$input_wrapper);

			this.img = $("<img class='img-responsive attach-image-display'>")
				.appendTo(this.img_wrapper)
				.toggle(false);

			this.make_signature_button();
		}

		make_signature_button() {
			this.$add_button = $(`<button class="btn btn-default btn-sm">
				${__("Add your signature")}
			</button>`)
				.appendTo(this.button_wrapper)
				.on("click", (e) => {
					e.preventDefault();
					this.show_signature_dialog();
				});
		}

		show_signature_dialog() {
			const me = this;

			let signature_dialog = new frappe.ui.Dialog({
				title: __("Add your signature"),
				fields: [
					{
						label: __("Draw"),
						fieldtype: "Tab Break",
						fieldname: "tab_break_draw",
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
						fieldname: "tab_break_type"
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
						fieldname: "tab_break_upload"
					},
					{
						label: __("Upload Your Signature"),
						fieldtype: "Attach Image",
						fieldname: "signature_upload",
						make_attachment_public: false
					},
					{
						label: __("Preview"),
						fieldtype: "HTML",
						fieldname: "signature_upload_preview"
					},
				],
				frm: {
					doctype: 'Signature Dialog',
					name: 'Signature Dialog',
					get_perm: function (permlevel, ptype) {
						return true;
					},
					meta: {
						make_attachments_public: false
					},
					attachments: {
						update_attachment: function (file) {
							console.log('Attachment updated:', file);
							const file_url = file.file_url;
							if (file_url) {
								const preview_html = `<img src="${file_url}" style="width: 100%; max-height: 200px;" />`;
								signature_dialog.fields_dict.signature_upload_preview.$wrapper.html(preview_html);
							}
						}
					},
					save: function () {
						return true;
					},
					set_active_tab: function (active_tab) {
						this.active_tab = active_tab;
					},
					doc: {
						docstatus: 0
					}
				},
				size: "large",
				primary_action_label: __("Insert Signature"),
				primary_action: function (values) {
					const current_tab = signature_dialog.frm.active_tab?.df.fieldname || null;

					if (current_tab === 'tab_break_draw') {
						// Access the signature field directly and get data from jSignature
						const signature_field = signature_dialog.fields_dict.signature_draw;
						let signature_data;

						if (signature_field && signature_field.$pad) {
							// Get data directly from jSignature pad
							signature_data = signature_field.$pad.jSignature("getData");
						}

						console.log('Signature data from draw:', signature_data);
						if (signature_data) {
							me.set_signature_value(signature_data, 'draw');
							signature_dialog.hide();
						} else {
							frappe.msgprint(__("Please draw a signature first"));
						}
					} else if (current_tab === 'tab_break_type') {
						let typed_signature = signature_dialog.get_value('signature_typed');
						if (typed_signature) {
							me.convert_typed_to_base64(typed_signature).then((base64) => {
								me.set_signature_value(base64, 'typed');
								signature_dialog.hide();
							});
						} else {
							frappe.msgprint(__("Please enter a signature text"));
						}
					} else if (current_tab === 'tab_break_upload') {
						let uploaded_signature = signature_dialog.get_value('signature_upload');
						if (uploaded_signature) {
							// Convert file URL to base64
							me.convert_url_to_base64(uploaded_signature).then((base64) => {
								me.set_signature_value(base64, 'upload');
								signature_dialog.hide();
							});
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

				// Set background
				ctx.fillStyle = '#f3f3f3';
				ctx.fillRect(0, 0, canvas.width, canvas.height);

				// Draw signature line
				ctx.strokeStyle = '#000';
				ctx.lineWidth = 1;
				ctx.beginPath();
				ctx.moveTo(40, canvas.height - 40);
				ctx.lineTo(canvas.width - 40, canvas.height - 40);
				ctx.stroke();

				// Set text properties
				ctx.fillStyle = '#1a1a1a';
				ctx.font = 'italic 50px "Brush Script MT", cursive';
				ctx.textAlign = 'center';
				ctx.textBaseline = 'middle';

				// Draw text
				ctx.fillText(text, canvas.width / 2, canvas.height / 2 - 10);

				// Convert to base64
				resolve(canvas.toDataURL('image/png'));
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
			console.log('Setting signature value from method:', method);
			this.set_value(base64_data);
			frappe.show_alert({
				message: __("Signature added successfully"),
				indicator: 'green'
			});
		}

		refresh_input() {
			// Don't use the parent's refresh_input
			if (!this.button_wrapper) return;

			this.$wrapper.find(".control-input").toggle(false);

			const value = this.get_value();
			const can_write = this.get_status() === "Write";

			if (value) {
				// Show signature image
				this.set_image(value);
				this.button_wrapper.toggle(can_write);
				this.$add_button.html(__("Change signature"));
			} else {
				// Show add button only if editable
				this.img_wrapper.toggle(false);
				this.button_wrapper.toggle(can_write);
				this.$add_button.html(__("Add your signature"));
			}

			if (this.get_status() === "Read") {
				$(this.disp_area).toggle(false);
			}
		}

		set_image(value) {
			if (value) {
				$(this.img_wrapper).find(".missing-image").toggle(false);
				this.img.attr("src", value).toggle(true);
				this.img_wrapper.toggle(true);
			} else {
				$(this.img_wrapper).find(".missing-image").toggle(true);
				this.img.toggle(false);
				this.img_wrapper.toggle(false);
			}
		}

		get_value() {
			return this.value || this.get_model_value();
		}
	};
});