app_name = "esign"
app_title = "eSign"
app_publisher = "Avunu LLC"
app_description = "Collect Electronic Signatures on Frappe Documents via Webforms"
app_email = "mail@avu.nu"
app_license = "mit"

app_include_js = ["esign.desk.bundle.js", "esign.control.bundle.js"]
app_include_css = ["esign.control.bundle.css"]

# Install/migrate hooks for communication type registration
after_install = "esign.esign.config.after_install"
after_migrate = "esign.esign.config.after_migrate"
after_uninstall = "esign.esign.config.after_uninstall"

# Timeline integration for eSign audit trail
additional_timeline_content = {
    "*": ["esign.esign.hooks.get_timeline_content"],
}


doctype_js = {
    "Web Form": "public/js/web_form.js",
}

extend_doctype_class = {
    "Web Form": "esign.esign.overrides.web_form.EsignWebForm",
    "Email Template": "esign.esign.overrides.email_template.EsignEmailTemplate",
}

jinja = {
    "methods": [
        "esign.esign.overrides.web_form.get_esign_link",
    ]
}
