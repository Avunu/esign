import hashlib
import json
from datetime import datetime
from typing import TypedDict, cast

import frappe
from frappe import _
from frappe.core.doctype.file.file import File
from frappe.core.doctype.file.utils import remove_file_by_url
from frappe.core.doctype.user.user import User
from frappe.model.docstatus import DocStatus
from frappe.model.document import Document
from frappe.rate_limiter import rate_limit
from frappe.twofactor import get_qr_svg_code
from frappe.types import DF
from frappe.website.doctype.web_form.web_form import WebForm as BaseWebForm
from frappe.www.printview import validate_print_permission


class PrintHtmlResponse(TypedDict):
	"""Response from get_print_html endpoint."""

	print_html: str
	print_style: str


def validate_esign_key(key: str, doc: Document, require_key: bool = False) -> bool:
	"""Validate document share key for eSign access.

	Args:
		key: The share key to validate
		doc: The document to validate access for
		require_key: If True, raises error when no key provided. If False, falls back
			to standard permission check when no key.

	Returns:
		True if access is granted (either via valid key or fallback permissions)

	Raises:
		frappe.PermissionError: If key is invalid/expired or no access granted
	"""
	from frappe.www.printview import validate_key

	if key:
		# validate_key returns False if key not found, None if valid
		if validate_key(key, doc) is False:
			frappe.throw(_("Invalid or expired document access key"), frappe.PermissionError)
		return True

	if require_key:
		frappe.throw(_("Document access key required"), frappe.PermissionError)

	# No key provided - fall back to standard permission check
	validate_print_permission(doc)
	return True


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


class AuditData(TypedDict):
	"""Audit trail data captured at signing time."""

	timestamp: str
	ip_address: str | None
	user_agent: str | None
	signer_email: str | None
	signer_name: str | None
	web_form: str
	print_format: str
	signed_fields: list[str]


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

		key = frappe.form_dict.get("key", "")

		# Get document without permission check - we'll validate via share key
		doc = frappe.get_doc(self.doc_type, cur_doc_name)
		doc.flags.ignore_permissions = True

		# Validate access via share key or fallback to standard permissions
		validate_esign_key(key, doc)

		# Allow public access to the web form if validation passes
		print_format = frappe.form_dict.get("format", self.print_format) or "standard"

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
		form_fields: set[str] = {field.fieldname for field in self.web_form_fields if field.fieldname}
		form_fields.add("name")
		form_fields.add("doctype")
		context.reference_doc = {k: v for k, v in doc.as_dict().items() if k in form_fields}

		context.key = key  # Pass key to frontend for async API calls
		context.printview_url = (
			"/api/method/frappe.utils.print_format.download_pdf?"
			f"doctype={self.doc_type}&name={cur_doc_name}&format={print_format}&key={key}"
		)
		# Include eSign assets
		context.web_include_css.extend(
			[
				"esign.control.bundle.css",
				"esign.web.bundle.css",
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

		# Check if document has already been signed (all signature fields have values)
		context.is_completed = self._check_signature_exists(doc)

		# If completed, get the signed PDF URL instead of rendering print preview
		if context.is_completed:
			signed_pdf = self._get_signed_pdf(doc)
			if signed_pdf:
				# Build the download URL through our key-validated endpoint
				from urllib.parse import urlencode

				params = urlencode({"doctype": self.doc_type, "docname": cur_doc_name, "key": key})
				context.signed_pdf_url = (
					f"/api/method/esign.esign.custom.web_form.download_signed_pdf?{params}"
				)
				context.signed_pdf_name = signed_pdf.get("file_name")

		return context

	def _get_signed_pdf(self, doc: Document) -> dict | None:
		"""Get the most recent signed PDF attachment for the document.

		Looks for PDFs attached via the eSign Communication record.
		"""
		# First try to find an eSign Communication for this document
		comm = frappe.get_all(
			"Communication",
			filters={
				"reference_doctype": doc.doctype,
				"reference_name": doc.name,
				"communication_type": "eSign",
			},
			fields=["name"],
			order_by="creation desc",
			limit=1,
		)

		if comm:
			# Get the PDF attached to the Communication
			pdf_file = frappe.get_all(
				"File",
				filters={
					"attached_to_doctype": "Communication",
					"attached_to_name": comm[0].name,
					"file_name": ("like", "%.pdf"),
				},
				fields=["name", "file_name", "file_url"],
				order_by="creation desc",
				limit=1,
			)
			if pdf_file:
				return pdf_file[0]

		# Fallback: look for signed PDFs attached directly to the document
		pdf_file = frappe.get_all(
			"File",
			filters={
				"attached_to_doctype": doc.doctype,
				"attached_to_name": doc.name,
				"file_name": ("like", "%_signed_%.pdf"),
			},
			fields=["name", "file_name", "file_url"],
			order_by="creation desc",
			limit=1,
		)
		if pdf_file:
			return pdf_file[0]

		return None

	def _check_signature_exists(self, doc: Document) -> bool:
		"""Check if all signature fields in the web form already have values."""
		signature_fields = [
			field.fieldname for field in self.web_form_fields if field.fieldtype == "Signature"
		]

		# If no signature fields, not applicable
		if not signature_fields:
			return False

		# Check if ALL signature fields have non-empty values
		for fieldname in signature_fields:
			value = doc.get(fieldname)
			if not value or str(value) == "/assets/frappe/images/signature-placeholder.png":
				return False

		return True

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

			# Validate via share key if provided
			key = frappe.form_dict.get("key")
			if key:
				try:
					doc = frappe.get_doc(doctype, name)
					doc.flags.ignore_permissions = True
					validate_esign_key(key, doc, require_key=True)
					return True
				except frappe.PermissionError:
					# Invalid key - fall through to normal permission check
					pass

		# Fall back to parent method
		return super().has_web_form_permission(doctype, name, ptype)


def attach_print_to_document(
	doc: Document,
	print_format: str,
	request_data: RequestData,
	audit_data: AuditData,
):
	"""Background job to attach the signed PDF to the document.

	Also records audit trail and SHA-256 hash for document integrity verification.
	Creates a Communication record for timeline display via additional_timeline_content hook.
	"""
	from frappe import attach_print

	mock_request = frappe._dict(
		{
			"headers": request_data.get("headers", {}),
			"host_url": request_data["host_url"],
			"host": request_data.get("host"),
			"method": request_data.get("method", "GET"),
			"cache_control": frappe._dict({"no_cache": True}),
			"scheme": request_data.get("scheme", "https"),
		}
	)

	frappe.request = mock_request
	frappe.local.request = mock_request

	# Generate the PDF
	timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")
	print_data = attach_print(
		doctype=doc.doctype,
		name=doc.name,
		file_name=f"{doc.name}_signed_{timestamp_str}",
		print_format=print_format,
		doc=doc,
		print_letterhead=False,
	)

	# Compute SHA-256 hash of the PDF content
	pdf_content = print_data["fcontent"]
	pdf_hash = hashlib.sha256(pdf_content).hexdigest()

	# Attach the signed PDF to the document
	file_doc = frappe.get_doc(
		{
			"doctype": "File",
			"file_name": print_data["fname"],
			"attached_to_doctype": doc.doctype,
			"attached_to_name": doc.name,
			"folder": "Home/Attachments",
			"is_private": True,
			"content": pdf_content,
		}
	)
	file_doc.save(ignore_permissions=True)

	# Create Communication record for timeline display with audit data as JSON
	audit_content = json.dumps(
		{
			**audit_data,
			"pdf_hash": pdf_hash,
			"file_name": print_data["fname"],
		}
	)

	comm = frappe.get_doc(
		{
			"doctype": "Communication",
			"communication_type": "eSign",
			"subject": f"Document signed: {doc.name}",
			"content": audit_content,
			"reference_doctype": doc.doctype,
			"reference_name": doc.name,
			"sender": audit_data.get("signer_email"),
			"sender_full_name": audit_data.get("signer_name"),
			"communication_date": datetime.now(),
			"sent_or_received": "Received",
		}
	)
	comm.insert(ignore_permissions=True)

	# Also attach a copy of the PDF to the Communication for easy retrieval
	comm_file_doc = frappe.get_doc(
		{
			"doctype": "File",
			"file_name": print_data["fname"],
			"attached_to_doctype": "Communication",
			"attached_to_name": comm.name,
			"folder": "Home/Attachments",
			"is_private": True,
			"content": pdf_content,
		}
	)
	comm_file_doc.save(ignore_permissions=True)


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


@frappe.whitelist(allow_guest=True)
@rate_limit(key="web_form", limit=30, seconds=60)
def get_print_html(
	doctype: str, docname: str, print_format: str = "standard", key: str = ""
) -> PrintHtmlResponse:
	"""Get the print HTML and styles for a document.

	This endpoint allows async loading of the document preview in eSign forms.
	It validates permissions using the document share key if provided.

	Args:
		doctype: The DocType of the document
		docname: The name of the document
		print_format: The print format to use (default: "standard")

	Returns:
		PrintHtmlResponse with print_html and print_style
	"""
	from frappe.www.printview import (
		get_print_format_doc,
		get_print_style,
		get_rendered_template,
		set_link_titles,
	)

	# set the key, if provided
	if key:
		frappe.form_dict.key = key

	# Get the document without permission checks - we'll validate via share key
	doc = frappe.get_doc(doctype, docname)
	doc.flags.ignore_permissions = True

	# Skip internal permission checks since we're using key-based auth
	# This prevents msgprint warnings from has_permission checks
	frappe.flags.ignore_print_permissions = True

	# Validate access via share key or fallback to standard permissions
	validate_esign_key(key, doc)

	# Get print format document
	meta = frappe.get_meta(doctype)
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

	# Clean up any local message log
	frappe.local.message_log = None

	return PrintHtmlResponse(
		print_html=print_html,
		print_style=print_style,
	)


@frappe.whitelist(allow_guest=True)
@rate_limit(key="esign_download", limit=20, seconds=60)
def download_signed_pdf(doctype: str, docname: str, key: str = ""):
	"""Download a signed PDF attachment with key-based access validation.

	This endpoint allows Guest users to download private signed PDF files
	by validating access via the document share key instead of requiring login.

	Args:
		doctype: The DocType of the document
		docname: The name of the document
		key: The document share key for access validation

	Returns:
		The PDF file response
	"""
	from frappe.core.doctype.access_log.access_log import make_access_log
	from frappe.utils.response import send_private_file

	# Get the document without permission checks - we'll validate via share key
	doc = frappe.get_doc(doctype, docname)
	doc.flags.ignore_permissions = True

	# Validate access via share key - require key for guest access
	validate_esign_key(key, doc, require_key=(frappe.session.user == "Guest"))

	# Find the signed PDF for this document
	# First try to find an eSign Communication for this document
	comm = frappe.get_all(
		"Communication",
		filters={
			"reference_doctype": doctype,
			"reference_name": docname,
			"communication_type": "eSign",
		},
		fields=["name"],
		order_by="creation desc",
		limit=1,
	)

	pdf_file = None
	if comm:
		# Get the PDF attached to the Communication
		pdf_file = frappe.get_all(
			"File",
			filters={
				"attached_to_doctype": "Communication",
				"attached_to_name": comm[0].name,
				"file_name": ("like", "%.pdf"),
			},
			fields=["name", "file_name", "file_url", "is_private"],
			order_by="creation desc",
			limit=1,
		)

	if not pdf_file:
		# Fallback: look for signed PDFs attached directly to the document
		pdf_file = frappe.get_all(
			"File",
			filters={
				"attached_to_doctype": doctype,
				"attached_to_name": docname,
				"file_name": ("like", "%_signed_%.pdf"),
			},
			fields=["name", "file_name", "file_url", "is_private"],
			order_by="creation desc",
			limit=1,
		)

	if not pdf_file:
		frappe.throw(_("No signed PDF found for this document"), frappe.DoesNotExistError)

	file_doc = pdf_file[0]
	file_url = file_doc.get("file_url", "")

	# Log access for audit trail
	make_access_log(
		doctype="File",
		document=file_doc.get("name"),
		file_type="pdf",
	)

	# Handle private vs public files
	if file_doc.get("is_private") and file_url.startswith("/private/files/"):
		# Extract the path after /private
		private_path = file_url.split("/private", 1)[1]
		return send_private_file(private_path)
	else:
		# For public files, redirect to the file URL
		frappe.local.response["type"] = "redirect"
		frappe.local.response["location"] = file_url


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
		doc.flags.ignore_permissions = True
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

	# Clean up any local message log
	frappe.local.message_log = None

	return doc


def _enqueue_print_attachment(doc: Document, wf: "EsignWebForm"):
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

	# Collect audit data
	audit_data = _collect_audit_data(doc, wf, print_format)

	frappe.enqueue(
		attach_print_to_document,
		queue="short",
		job_id=f"attach_print_to_{doc.doctype}_{doc.name}",
		deduplicate=True,
		timeout=300,
		doc=doc,
		print_format=print_format,
		request_data=request_data,
		audit_data=audit_data,
	)


def _collect_audit_data(doc: Document, wf: "EsignWebForm", print_format: str) -> AuditData:
	"""Collect audit trail data at the moment of signing."""
	# Get IP address from various possible headers (proxy-aware)
	ip_address = _get_client_ip()

	# Get user agent
	user_agent = None
	if hasattr(frappe, "request") and frappe.request:
		user_agent = frappe.request.headers.get("User-Agent")

	# Get signer information
	signer_email = None
	signer_name = None
	if frappe.session.user and frappe.session.user != "Guest":
		signer_email = frappe.session.user
		user_doc = cast(User, frappe.get_cached_doc("User", frappe.session.user))
		signer_name = user_doc.full_name if user_doc else None

	# Identify which signature fields were filled
	signed_fields = []
	signature_fieldtypes = ("Signature", "SignaturePad")
	for field in wf.web_form_fields:
		if field.fieldtype in signature_fieldtypes:
			value = doc.get(field.fieldname)
			if value:
				signed_fields.append(field.label or field.fieldname)

	return AuditData(
		timestamp=datetime.now().strftime("%Y-%m-%d %H:%M:%S UTC"),
		ip_address=ip_address,
		user_agent=user_agent,
		signer_email=signer_email,
		signer_name=signer_name,
		web_form=str(wf.title or wf.name),
		print_format=print_format,
		signed_fields=signed_fields,
	)


def _get_client_ip() -> str | None:
	"""Get client IP address, accounting for proxies and load balancers."""
	if not hasattr(frappe, "request") or not frappe.request:
		return None

	headers = frappe.request.headers

	# Check various proxy headers in order of preference
	proxy_headers = [
		"CF-Connecting-IP",  # Cloudflare
		"X-Real-IP",  # Nginx proxy
		"X-Forwarded-For",  # Standard proxy header (may contain multiple IPs)
	]

	for header in proxy_headers:
		value = headers.get(header)
		if value:
			# X-Forwarded-For may contain multiple IPs, take the first (client)
			if "," in value:
				return value.split(",")[0].strip()
			return value.strip()

	# Fall back to remote_addr
	return getattr(frappe.request, "remote_addr", None)
