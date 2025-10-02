frappe.ui.form.on("Web Form", {
	refresh: function (frm) {
		frm.doc.doc_type ? frm.events.update_field_options(frm) : null;
	},
	doc_type: function (frm) {
		frm.events.update_field_options(frm);
	},
	update_field_options: function (frm) {
		var doc = frm.doc;
		if (!doc.doc_type) {
			return;
		}
		frappe.model.with_doctype(doc.doc_type, () => {
			const fieldnames = frappe
				.get_meta(doc.doc_type)
				.fields.filter((field) => !frappe.model.no_value_type.includes(field.fieldtype))
				.map((field) => field.fieldname);

			frm.set_df_property(
				"esign_update_field",
				"options",
				[""].concat(fieldnames)
			);
		});
	},
});