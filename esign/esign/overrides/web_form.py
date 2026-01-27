import json
from typing import TypedDict, cast

import frappe
from frappe import _
from frappe.core.doctype.file.file import File
from frappe.core.doctype.file.utils import remove_file_by_url
from frappe.model.docstatus import DocStatus
from frappe.model.document import Document
from frappe.rate_limiter import rate_limit
from frappe.twofactor import get_qr_svg_code
from frappe.types import DF
from frappe.website.doctype.web_form.web_form import WebForm as BaseWebForm
from frappe.www.printview import validate_print_permission

# Import PaymentWebForm if available, otherwise create a dummy class
try:
	from payments.overrides.payment_webform import PaymentWebForm  # type: ignore
except ImportError:
	# Create a dummy class that does nothing if payments isn't installed
	class PaymentWebForm:
		pass


class RequestData(TypedDict):
	host_url: str | None
	scheme: str
	host: str | None
	headers: dict
	method: str | None


class EsignWebForm(PaymentWebForm, BaseWebForm):
	"""Custom WebForm override for eSign-specific functionality with custom field types"""

	# Custom fields from ../custom/web_form.json
	esign_enabled: DF.Check | None
	esign_force_mobile: DF.Check | None
	esign_update_field: DF.Select[""] | None
	esign_update_value: DF.Data | None
	esign_submit_on_response: DF.Check | None

	def get_context(self, context):
		cur_doc_name = frappe.form_dict.get("name", context.doc_name)
		if not self.esign_enabled or not cur_doc_name or frappe.form_dict.is_list:
			super().get_context(context)
			return context
		doc = frappe.get_doc(self.doc_type, cur_doc_name)
		# validate either the user permissions or the access key
		validate_print_permission(doc)
		# Allow public access to the web form if validation passes
		print_format = frappe.form_dict.get("format", self.print_format) or "standard"

		# Get print format document
		from frappe.www.printview import (
			get_print_format_doc,
			get_print_style,
			get_rendered_template,
			set_link_titles,
		)

		meta = frappe.get_meta(self.doc_type)
		print_format_doc = get_print_format_doc(print_format, meta=meta)
		set_link_titles(doc)

		# Get rendered print HTML
		print_html = get_rendered_template(
			doc=doc,
			print_format=print_format_doc,  # type: ignore
			meta=meta,
			trigger_print=False,
			no_letterhead=bool(frappe.form_dict.get("no_letterhead")),
			letterhead=frappe.form_dict.get("letterhead"),
			settings=None,
		)

		# Get print styles
		print_style = get_print_style(
			style=frappe.form_dict.get("style"),
			print_format=print_format_doc,  # type: ignore
		)

		web_form_doc: dict = self.as_dict(no_nulls=True)
		web_form_doc.update(
			{
				"login_required": False,
				"allow_edit": True,
				"allow_multiple": True,
				"allow_delete": True,
				"in_edit_mode": True,
			}
		)
		context.web_form_doc = web_form_doc
		super().load_form_data(context)
		super().add_custom_context_and_script(context)
		super().load_translations(context)
		super().add_metatags(context)
		context.doctype = self.doc_type
		context.name = cur_doc_name
		context.print_format = print_format
		context.reference_doc = doc

		# Add print view content and styles to context
		context.print_html = print_html
		context.print_style = print_style

		key = frappe.form_dict.get("key", "")
		context.printview_url = (
			"/api/method/frappe.utils.print_format.download_pdf?"
			f"doctype={self.doc_type}&name={cur_doc_name}&format={print_format}&key={key}"
		)
		# Include eSign assets
		context.web_include_css.extend(
			[
				"esign.bundle.css",
				"esign.control.bundle.css",
			]
		)
		context.web_include_js.extend(
			[
				"esign.web.bundle.js",
			]
		)
		context.template = "esign/templates/esign.html"
		if self.esign_force_mobile:
			context.force_mobile = True
			context.qrcode_svg = get_qr_svg_code(frappe.request.url).decode()
		return context

	def validate(self):
		super().validate()

		# if esign is enabled, force allow_edit
		if self.esign_enabled:
			self.allow_edit = True

	def has_web_form_permission(self, doctype, name, ptype="read"):
		"""Override to allow eSign access for Guest users with valid keys"""
		# For eSign forms, check key-based access first
		if self.esign_enabled and name:
			# Try to get the key from form_dict or extract from referrer
			if not frappe.form_dict.get("key"):
				frappe.form_dict.key = extract_param_from_referrer("key")

			# If we have a key, validate it
			if frappe.form_dict.get("key"):
				try:
					doc = frappe.get_doc(doctype, name)
					validate_print_permission(doc)
					return True
				except (frappe.PermissionError, frappe.exceptions.LinkExpired):
					# Key validation failed, fall through to normal permission check
					pass

		# Fall back to parent method
		return super().has_web_form_permission(doctype, name, ptype)


def attach_print_to_document(doc, print_format: str, request_data: RequestData):
	"""Background job to attach the signed PDF to the document."""
	from datetime import datetime

	from frappe import attach_print

	frappe.local.request = frappe._dict(
		{
			"host_url": request_data["host_url"],
			"scheme": request_data.get("scheme", "https"),
			"host": request_data.get("host"),
			"headers": request_data.get("headers", {}),
			"method": request_data.get("method", "GET"),
		}
	)

	print_data = attach_print(
		doctype=doc.doctype,
		name=doc.name,
		file_name=f"{doc.name}_filled_{datetime.now()}",
		print_format=print_format,
		doc=doc,
		print_letterhead=False,
	)

	# Create and save the file document
	file_doc = frappe.get_doc(
		{
			"doctype": "File",
			"file_name": print_data["fname"],
			"attached_to_doctype": doc.doctype,
			"attached_to_name": doc.name,
			"folder": "Home/Attachments",
			"is_private": True,
			"content": print_data["fcontent"],
		}
	)

	file_doc.save(ignore_permissions=True)

	doc.add_comment("Comment", _(f"eSign document attached: {print_data['fname']}"))


def extract_param_from_referrer(param: str = "") -> str:
	"""Extract 'key' parameter from HTTP Referer header safely."""
	referrer = frappe.get_request_header("Referer")

	if not referrer:
		return ""

	try:
		from urllib.parse import parse_qs, urlparse

		parsed_url = urlparse(referrer)
		query_params = parse_qs(parsed_url.query, keep_blank_values=False)

		# Get the first non-empty key value
		return query_params.get(param, [""])[0]

	except Exception as e:
		frappe.log_error(title=f"eSign: Failed to parse referrer URL: {referrer}", message=e)
		return ""


@frappe.whitelist()
def get_esign_link(doc: "Document", web_form_name: str, print_format_name: str = "") -> str:
	"""Get the eSign Web Form link for a given document and web form name."""
	if isinstance(doc, str):
		try:
			doc = json.loads(doc)
		except Exception as e:
			return str(e)

	if isinstance(doc, dict):
		try:
			doc = frappe.get_doc(doc["doctype"], doc["name"])
		except Exception as e:
			return str(e)

	try:
		web_form = EsignWebForm("Web Form", web_form_name)
		if not web_form.esign_enabled or not web_form.doc_type == doc.doctype:
			return ""

		# Generate the URL
		from frappe.utils import get_url

		base_url = get_url()
		share_key = doc.get_document_share_key()
		web_form_path = f"{web_form.route}/{doc.name}/edit"
		query_string = f"?key={share_key}"
		if print_format_name:
			query_string += f"&format={print_format_name}"

		return f"{base_url}{web_form_path}{query_string}"

	except Exception as e:
		frappe.log_error(
			title=f"eSign: Failed to generate link for {doc.doctype} {doc.name} and Web Form {web_form_name}",
			message=e,
		)
		return ""


@frappe.whitelist()
def get_esign_web_forms(doctype):
	"""Get all eSign-enabled web forms for a given doctype."""
	return frappe.get_all(
		"Web Form",
		filters={"doc_type": doctype, "esign_enabled": 1, "published": 1},
		fields=["name", "title", "route", "print_format"],
	)


@frappe.whitelist(allow_guest=True)
@rate_limit(key="web_form", limit=10, seconds=60)
def accept(web_form, data):
	"""Custom accept function for eSign web forms that properly handles Guest permissions.

	This overrides the default web form accept to ensure that eSign forms with valid
	document share keys can be submitted by Guest users without permission errors.
	Also handles field updates, document submission, and PDF attachment in a single flow.
	"""
	from frappe.website.doctype.web_form.web_form import accept as base_accept

	data = frappe._dict(json.loads(data))

	# Check if this is an eSign-enabled web form
	wf = cast(EsignWebForm, frappe.get_lazy_doc("Web Form", web_form))

	# If not eSign-enabled, use the base accept function
	if not getattr(wf, "esign_enabled", False):
		return base_accept(web_form, json.dumps(data))

	# For eSign forms, we need to handle permissions specially
	doctype = wf.doc_type
	user = frappe.session.user

	# Extract key from referrer for permission validation
	if not frappe.form_dict.get("key"):
		frappe.form_dict.key = extract_param_from_referrer("key")

	# Validate the key if we have one and this is an update
	if data.name and frappe.form_dict.get("key"):
		try:
			# Validate the key gives us access to this document
			doc = frappe.get_doc(doctype, data.name)
			validate_print_permission(doc)
		except (frappe.PermissionError, frappe.exceptions.LinkExpired):
			frappe.throw(_("Invalid or expired access key"), frappe.PermissionError)

	# Now proceed with the form submission using ignore_permissions
	files = []
	files_to_delete = []

	if wf.anonymous and frappe.session.user != "Guest":
		frappe.session.user = "Guest"

	if data.name and not wf.allow_edit:
		frappe.throw(_("You are not allowed to update this Web Form Document"))

	frappe.flags.in_web_form = True
	meta = frappe.get_meta(doctype)

	is_new = not data.name
	if data.name:
		# For eSign forms, always get doc with ignore_permissions since we validated the key
		doc = frappe.get_doc(doctype, data.name)
	else:
		doc = frappe.new_doc(doctype)

	# Set ignore_mandatory flag if allow_incomplete is enabled
	if wf.allow_incomplete:
		doc.flags.ignore_mandatory = True

	# Set web form field values
	for field in wf.web_form_fields:
		fieldname = field.fieldname
		df = meta.get_field(fieldname)
		value = data.get(fieldname, "")

		if df and df.fieldtype in ("Attach", "Attach Image"):
			if value and "data:" and "base64" in value:
				files.append((fieldname, value))
				if not doc.name:
					doc.set(fieldname, "")
				continue

			elif not value and doc.get(fieldname):
				files_to_delete.append(doc.get(fieldname))

		doc.set(fieldname, value)

	# Apply eSign field update if configured
	if wf.esign_update_field and wf.esign_update_value is not None:
		try:
			if meta.has_field(wf.esign_update_field):
				df = meta.get_field(wf.esign_update_field)
				if df and df.fieldtype in ("Select", "Link", "Data", "Text"):
					doc.set(wf.esign_update_field, wf.esign_update_value)
		except Exception as e:
			frappe.log_error(
				title=f"eSign: Failed to set field {wf.esign_update_field} on {doc.doctype}",
				message=str(e),
			)

	# Set docstatus for submission if configured (before save)
	should_submit = wf.esign_submit_on_response and doc.docstatus == 0 and doc.meta.is_submittable
	if should_submit:
		doc.docstatus = DocStatus(1)

	# For new documents, we need to insert first before attaching files
	if is_new:
		if wf.login_required and frappe.session.user == "Guest":
			frappe.throw(_("You must login to submit this form"))

		ignore_mandatory = True if (files or wf.allow_incomplete) else False
		doc.insert(ignore_permissions=True, ignore_mandatory=ignore_mandatory)

	# Handle file attachments - these require the doc to exist first
	if files:
		for f in files:
			fieldname, filedata = f

			# remove earlier attached file (if exists)
			if doc.get(fieldname):
				remove_file_by_url(str(doc.get(fieldname)), doctype=doctype, name=doc.name)

			# save new file
			filename, dataurl = filedata.split(",", 1)
			_file = cast(
				File,
				frappe.get_doc(
					{
						"doctype": "File",
						"file_name": filename,
						"attached_to_doctype": doctype,
						"attached_to_name": doc.name,
						"content": dataurl,
						"decode": True,
					}
				),
			)
			_file.save(ignore_permissions=True)

			# update the doc with file URL
			doc.set(fieldname, _file.file_url)

	# Single save for all changes (existing docs or new docs with files)
	if not is_new or files:
		doc.save(ignore_permissions=True)

	# Clean up deleted files
	if files_to_delete:
		for f in files_to_delete:
			if f:
				remove_file_by_url(f, doctype=doctype, name=doc.name)

	# Restore user session if needed
	if wf.anonymous and frappe.session.user == "Guest" and user:
		frappe.session.user = user

	frappe.flags.web_form_doc = doc

	# Enqueue PDF attachment as background job
	_enqueue_print_attachment(doc, wf)

	return doc


def _enqueue_print_attachment(doc, wf: "EsignWebForm"):
	"""Enqueue background job to attach signed PDF to the document."""
	# Determine the print format to use
	print_format = extract_param_from_referrer("format")
	if not print_format:
		print_format = wf.print_format or "standard"

	# Extract only serializable data from request
	request_data: RequestData = {
		"host_url": None,
		"scheme": "https",
		"host": None,
		"headers": {},
		"method": None,
	}

	for attr, default in request_data.items():
		if hasattr(frappe, "request") and hasattr(frappe.request, attr):
			value = getattr(frappe.request, attr)
			# Convert headers to dict if it's the headers attribute
			if attr == "headers" and value is not None:
				value = dict(value)
			request_data[attr] = value
		else:
			request_data[attr] = default

	frappe.enqueue(
		attach_print_to_document,
		queue="short",
		job_id=f"attach_print_to_{doc.doctype}_{doc.name}",
		deduplicate=True,
		timeout=300,
		doc=doc,
		print_format=print_format,
		request_data=request_data,
	)
