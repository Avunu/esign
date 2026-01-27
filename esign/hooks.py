app_name = "esign"
app_title = "eSign"
app_publisher = "Avunu LLC"
app_description = "Collect Electronic Signatures on Frappe Documents via Webforms"
app_email = "mail@avu.nu"
app_license = "mit"

app_include_js = ["esign.bundle.js", "esign.control.bundle.js"]
app_include_css = ["esign.control.bundle.css"]


doctype_js = {
	"Web Form": "public/js/web_form.js",
}

extend_doctype_class = {
	"Web Form": "esign.esign.overrides.web_form.EsignWebForm",
	"Email Template": "esign.esign.overrides.email_template.EsignEmailTemplate",
}

doc_events = {
	"*": {
		"on_update": [
			"esign.esign.overrides.web_form.on_update_esign_document",
		],
	}
}

jinja = {
	"methods": [
		"esign.esign.overrides.web_form.get_esign_link",
	]
}

# web_include_js = "web_form.public.bundle.js"
# webform_include_js = {"*": "public/js/web_form.public.bundle.js"}