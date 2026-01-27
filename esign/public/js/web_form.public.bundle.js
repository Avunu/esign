frappe.provide("frappe.ui");
frappe.provide("frappe.web_form");
export class eSignWebForm extends WebForm {

	save() {
		if (this.esign_enabled) {
			method = "esign.esign.overrides.web_form.accept";
		} else {
			method = "frappe.website.doctype.web_form.web_form.accept";
		}
		let is_new = this.is_new;
		let valid = this.validate && this.validate();
		if (!valid && valid !== undefined) {
			frappe.msgprint(
				__("Couldn't save, please check the data you have entered"),
				__("Validation Error")
			);
			return false;
		}

		// validation hack: get_values will check for missing data
		let doc_values = super.get_values(this.allow_incomplete);

		if (!doc_values) return false;

		if (window.saving) return false;
		// TODO: remove this (used for payments app)
		let for_payment = Boolean(this.accept_payment && !this.doc.paid);

		Object.assign(this.doc, doc_values);
		this.doc.doctype = this.doc_type;
		this.doc.web_form_name = this.name;

		// Save
		window.saving = true;
		frappe.form_dirty = false;

		frappe.call({
			type: "POST",
			method: method,
			args: {
				data: this.doc,
				web_form: this.name,
				for_payment,
			},
			btn: $("btn-primary"),
			freeze: true,
			callback: (response) => {
				// Check for any exception in response
				if (!response.exc) {
					// Success
					this.handle_success(response.message);
					frappe.web_form.events.trigger("after_save");
					this.after_save && this.after_save();
					// args doctype and docname added to link doctype in file manager
					if (is_new && (response.message.attachment || response.message.file)) {
						frappe.call({
							type: "POST",
							method: "frappe.handler.upload_file",
							args: {
								file_url: response.message.attachment || response.message.file,
								doctype: response.message.doctype,
								docname: response.message.name,
							},
						});
					}
				}
			},
			always: function () {
				window.saving = false;
			},
		});
		return false;
	}
}
WebForm = eSignWebForm;