/**
 * eSign WebForm Script
 *
 * This replaces frappe's webform_script.js for eSign-enabled forms.
 * It extends WebForm to use our custom accept endpoint and registers
 * our custom controls for the web/public frontend.
 */
import WebFormList from "../../../../../frappe/frappe/public/js/frappe/web_form/web_form_list";
import WebForm from "../../../../../frappe/frappe/public/js/frappe/web_form/web_form";

// Import and register eSign controls for web forms
import { ControlSignaturePad } from "../controls/signature_pad";
import { ControlUpload } from "../controls/upload";
import { ControlSignature } from "../controls/signature";

frappe.ui.form.ControlSignaturePad = ControlSignaturePad;
frappe.ui.form.ControlUpload = ControlUpload;
frappe.ui.form.ControlSignature = ControlSignature;

class EsignWebForm extends WebForm {
	save() {
		// Use eSign accept endpoint if esign_enabled, otherwise use default
		let method = this.esign_enabled
			? "esign.esign.overrides.web_form.accept"
			: "frappe.website.doctype.web_form.web_form.accept";

		// debug
		console.debug("Using save method:", method);

		let is_new = this.is_new;
		let valid = this.validate && this.validate();
		if (!valid && valid !== undefined) {
			frappe.msgprint(
				__("Couldn't save, please check the data you have entered"),
				__("Validation Error"),
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
					if (
						is_new &&
						(response.message.attachment || response.message.file)
					) {
						frappe.call({
							type: "POST",
							method: "frappe.handler.upload_file",
							args: {
								file_url:
									response.message.attachment ||
									response.message.file,
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

frappe.ready(function () {
	let web_form_doc = frappe.web_form_doc;
	let reference_doc = frappe.reference_doc;

	show_login_prompt();

	web_form_doc.is_list ? show_list() : show_form();

	function show_login_prompt() {
		if (frappe.session.user != "Guest" || !web_form_doc.login_required)
			return;
		const login_required = new frappe.ui.Dialog({
			title: __("Not Permitted"),
			primary_action_label: __("Login"),
			primary_action: () => {
				window.location.replace(
					"/login?redirect-to=" + window.location.pathname,
				);
			},
		});
		login_required.show();
		login_required.set_message(
			__("You are not permitted to access this page without login."),
		);
	}

	function show_list() {
		new WebFormList({
			doctype: web_form_doc.doc_type,
			web_form_name: web_form_doc.name,
			list_columns: web_form_doc.list_columns,
			condition_json: web_form_doc.condition_json,
			settings: {
				allow_delete: web_form_doc.allow_delete,
			},
		});
	}

	function show_form() {
		// Use our extended EsignWebForm instead of base WebForm
		let web_form = new EsignWebForm({
			parent: $(".web-form-wrapper"),
		});
		let doc = reference_doc || {};
		setup_fields(web_form_doc, doc);

		web_form.prepare(web_form_doc, doc);
		web_form.make();

		if (web_form_doc.is_new) {
			web_form.set_default_values();
		}

		$(".file-size").each(function () {
			$(this).text(frappe.form.formatters.FileSize($(this).text()));
		});
	}

	function setup_fields(web_form_doc, doc_data) {
		web_form_doc.web_form_fields.forEach((df) => {
			df.is_web_form = true;
			df.read_only =
				df.read_only ||
				(!web_form_doc.is_new && !web_form_doc.in_edit_mode);
			if (df.fieldtype === "Table") {
				df.get_data = () => {
					let data = [];
					if (doc_data && doc_data[df.fieldname]) {
						return doc_data[df.fieldname];
					}
					return data;
				};

				$.each(df.fields || [], function (_i, field) {
					if (field.fieldtype === "Link") {
						field.only_select = true;
					}
					field.is_web_form = true;
				});

				if (df.fieldtype === "Attach") {
					df.is_private = true;
				}

				delete df.parent;
				delete df.parentfield;
				delete df.parenttype;
				delete df.doctype;

				return df;
			}
			if (df.fieldtype === "Link") {
				df.only_select = true;
			}
			if (["Attach", "Attach Image"].includes(df.fieldtype)) {
				if (typeof df.options !== "object") {
					df.options = {};
				}
				df.options.disable_file_browser = true;
			}
		});
	}
});
