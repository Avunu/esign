$(document).on('form-load', function (event, frm) {
	frappe.db.count("Web Form", { filters: { "doc_type": frm.doctype, "esign_enabled": 1 }, limit: 1 }).then((exists) => {
		console.log("exists", exists);
		if (exists) {
			// add "Send for eSign" button
			frm.add_custom_button(
				__("Send for eSign"),
				function () {
					frappe.call({
						method: "esign.esign.doctype.esign_request.esign_request.create_esign_request",
						args: {
							reference_doctype: frm.doc.doctype,
							reference_name: frm.doc.name,
						},
						callback: function (r) {
							if (r.message) {
								frappe.show_alert({
									message: __("eSign Request Created: {0}", [
										`<a href="/app/esign-request/${r.message}">${r.message}</a>`,
									]),
									indicator: "green",
								});
							}
						},
					});
				}
			);
		}
	});
});
