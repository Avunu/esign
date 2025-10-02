$(document).on('form-load', function (event, frm) {
	frappe.db.count("Web Form", { filters: { "doc_type": frm.doctype, "esign_enabled": 1 }, limit: 1 }).then((exists) => {
		if (exists) {
			frm.add_custom_button(
				__("Send for eSign"),
				() => {
					if (frm.doc.__islocal) {
						frappe.msgprint(__("Please save the document before sending for eSign."));
						return;
					}
					show_esign_dialog(frm);
				}
			);
		}
	});
});

function show_esign_dialog(frm) {
	let d = new frappe.ui.Dialog({
		title: __('Send for eSign'),
		fields: [
			{
				label: __("To"),
				fieldtype: "MultiSelectPills",
				reqd: 1,
				fieldname: "recipients",
				get_data: function(txt) {
					return get_contact_list(frm, txt);
				}
			},
			{
				fieldtype: "Section Break",
				fieldname: "more_options",
				label: __("More Options"),
				collapsible: 1
			},
			{
				label: __("CC"),
				fieldtype: "MultiSelectPills",
				fieldname: "cc",
				get_data: function(txt) {
					return get_contact_list(frm, txt);
				}
			},
			{
				label: __("BCC"),
				fieldtype: "MultiSelectPills",
				fieldname: "bcc",
				get_data: function(txt) {
					return get_contact_list(frm, txt);
				}
			},
			{
				fieldtype: "Section Break",
				fieldname: "template_section"
			},
			{
				label: __("Email Template"),
				fieldtype: "Link",
				options: "Email Template",
				fieldname: "email_template",
				reqd: 1,
				// get_query: function() {
				// 	return {
				// 		filters: {
				// 			enabled: 1,
				// 			doc_type: frm.doctype
				// 		}
				// 	};
				// },
				onchange: function() {
					if (this.value) {
						load_email_template(frm, d, this.value);
					}
				}
			},
			{
				label: __("eSign Web Form"),
				fieldtype: "Select",
				fieldname: "web_form",
				reqd: 1,
				options: [],
				onchange: function() {
					update_esign_link_preview(d, frm);
				}
			},
			{
				fieldtype: "Section Break"
			},
			{
				label: __("Subject"),
				fieldtype: "Data",
				reqd: 1,
				fieldname: "subject",
				length: 524288
			},
			{
				label: __("Message"),
				fieldtype: "Text Editor",
				fieldname: "content",
				reqd: 1
			},
			// {
			// 	fieldtype: "Section Break",
			// 	fieldname: "esign_link_section",
			// 	label: __("eSign Link Preview")
			// },
			// {
			// 	fieldtype: "HTML",
			// 	fieldname: "esign_link_preview"
			// },
			{
				fieldtype: "Section Break",
				fieldname: "options_section"
			},
			{
				label: __("Send me a copy"),
				fieldtype: "Check",
				fieldname: "send_me_a_copy"
			},
			{
				label: __("Print Format"),
				fieldtype: "Link",
				options: "Print Format",
				fieldname: "print_format",
				get_query: function() {
					return {
						filters: {
							doc_type: frm.doctype
						}
					};
				}
			}
		],
		size: 'large',
		primary_action_label: __('Send eSign Request'),
		primary_action: function(values) {
			send_esign_request(frm, values);
			d.hide();
		}
	});

	// Load web forms for this doctype
	frappe.call({
		method: "esign.esign.overrides.web_form.get_esign_web_forms",
		args: { doctype: frm.doctype },
		callback: function(r) {
			if (r.message && r.message.length > 0) {
				let options = r.message.map(wf => wf.name);
				d.set_df_property('web_form', 'options', [''].concat(options));
			} else {
				frappe.msgprint(__("No eSign-enabled web forms found for {0}", [frm.doctype]));
				d.hide();
			}
		}
	});

	d.show();
}

function get_contact_list(frm, txt) {
	// Get email contacts related to the document
	let contacts = [];
	
	// Add customer email if exists
	if (frm.doc.customer && frm.doc.customer_email) {
		contacts.push({
			value: frm.doc.customer_email,
			description: frm.doc.customer
		});
	}
	
	// Add supplier email if exists  
	if (frm.doc.supplier && frm.doc.supplier_email) {
		contacts.push({
			value: frm.doc.supplier_email,
			description: frm.doc.supplier
		});
	}
	
	// Add contact email if exists
	if (frm.doc.contact_email) {
		contacts.push({
			value: frm.doc.contact_email,
			description: frm.doc.contact_display || "Contact"
		});
	}
	
	return contacts.filter(contact => 
		!txt || contact.value.toLowerCase().includes(txt.toLowerCase())
	);
}

function load_email_template(frm, dialog, template_name) {
	frappe.call({
		method: "frappe.email.doctype.email_template.email_template.get_email_template",
		args: {
			template_name: template_name,
			doc: frm.doc
		},
		callback: function(r) {
			if (r.message) {
				dialog.set_value('subject', r.message.subject);
				dialog.set_value('content', r.message.message);
			}
		}
	});
}

function update_esign_link_preview(dialog, frm) {
	let web_form = dialog.get_value('web_form');
	let print_format = dialog.get_value('print_format') || 'Standard';
	
	if (web_form) {
		frappe.call({
			method: "esign.esign.overrides.web_form.get_esign_link",
			args: {
				doc: frm.doc,
				web_form_name: web_form,
				format_name: print_format
			},
			callback: function(r) {
				if (r.message) {
					dialog.fields_dict.esign_link_preview.$wrapper.html(
						`<p><strong>eSign Link:</strong></p>
						<div style="background: #f8f9fa; padding: 10px; border-radius: 4px; word-break: break-all;">
							<a href="${r.message}" target="_blank">${r.message}</a>
						</div>`
					);
				}
			}
		});
	}
}

function send_esign_request(frm, values) {
	frappe.call({
		method: "esign.esign.send_esign_email",
		args: {
			doctype: frm.doctype,
			name: frm.doc.name,
			recipients: values.recipients,
			cc: values.cc || [],
			bcc: values.bcc || [],
			subject: values.subject,
			message: values.content,
			web_form: values.web_form,
			print_format: values.print_format,
			send_me_a_copy: values.send_me_a_copy
		},
		freeze: true,
		freeze_message: __("Sending eSign request..."),
		callback: function(r) {
			if (r.message && r.message.success) {
				frappe.show_alert({
					message: __("eSign request sent successfully"),
					indicator: "green"
				});
				frm.reload_doc();
			}
		}
	});
}