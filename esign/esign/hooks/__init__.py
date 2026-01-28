# Copyright (c) 2024, Avunu LLC and contributors
# For license information, please see license.txt

import frappe

# Communication type for eSign audit trail
ESIGN_COMMUNICATION_TYPE = "eSign"


def get_timeline_content(doctype: str, docname: str) -> list[dict]:
	"""Return eSign audit trail entries for the document timeline.

	This hook is called by Frappe's timeline rendering to add custom
	timeline entries showing eSign signing events with audit details.
	"""
	communications = frappe.get_all(
		"Communication",
		filters={
			"reference_doctype": doctype,
			"reference_name": docname,
			"communication_type": ESIGN_COMMUNICATION_TYPE,
		},
		fields=[
			"creation",
			"name",
			"communication_date",
			"content",
			"sender",
			"sender_full_name",
		],
		order_by="creation desc",
	)

	timeline_contents = []
	for comm in communications:
		# Parse the JSON content for audit data
		audit_data = {}
		if comm.content:
			try:
				import json

				audit_data = json.loads(comm.content)
			except (json.JSONDecodeError, TypeError):
				pass

		# Get the attached signed PDF file URL
		file_url = frappe.db.get_value(
			"File",
			{"attached_to_name": comm.name, "attached_to_doctype": "Communication"},
			"file_url",
		)

		timeline_contents.append(
			{
				"icon": "edit",
				"is_card": True,
				"creation": comm.communication_date or comm.creation,
				"template": "esign_timeline",
				"template_data": {
					"creation": str(comm.creation),
					"file_url": file_url,
					"signer_name": audit_data.get("signer_name") or comm.sender_full_name,
					"signer_email": audit_data.get("signer_email") or comm.sender,
					"timestamp": audit_data.get("timestamp"),
					"ip_address": audit_data.get("ip_address"),
					"user_agent": audit_data.get("user_agent"),
					"web_form": audit_data.get("web_form"),
					"print_format": audit_data.get("print_format"),
					"signed_fields": audit_data.get("signed_fields", []),
					"pdf_hash": audit_data.get("pdf_hash"),
				},
			}
		)

	return timeline_contents
