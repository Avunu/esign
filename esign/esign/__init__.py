import frappe
from frappe import _
from frappe.core.doctype.communication.communication import Communication


@frappe.whitelist()
def send_esign_email(
    doctype,
    name,
    recipients,
    subject,
    message,
    web_form,
    cc=None,
    bcc=None,
    print_format=None,
    send_me_a_copy=False,
):
    """Send eSign email with embedded eSign link"""

    frappe.log_error(
        title=f"eSign: Sending email for {doctype} {name}",
        message=f"Recipients: {recipients}, Subject: {subject}, Web Form: {web_form}",
    )

    # Validate inputs
    if not all([doctype, name, recipients, subject, message, web_form]):
        frappe.throw(_("Missing required parameters for eSign email"))

    # Get the document
    try:
        doc = frappe.get_doc(doctype, name)
    except frappe.DoesNotExistError:
        frappe.throw(_("Document {0} {1} not found").format(doctype, name))

    # Validate web form
    from esign.esign.overrides.web_form import ExtendedWebForm, get_esign_link

    try:
        web_form_doc = ExtendedWebForm("Web Form", web_form)
        if not web_form_doc.esign_enabled or web_form_doc.doc_type != doctype:
            frappe.throw(_("Invalid eSign web form for this document type"))
    except frappe.DoesNotExistError:
        frappe.throw(_("Web Form {0} not found").format(web_form))

    # Generate eSign link
    esign_link = get_esign_link(doc, web_form, print_format or "")
    if not esign_link:
        frappe.throw(_("Failed to generate eSign link"))

    # Process recipients
    recipients_list = []
    if isinstance(recipients, str):
        recipients_list = [r.strip() for r in recipients.split(",") if r.strip()]
    elif isinstance(recipients, list):
        recipients_list = recipients

    if not recipients_list:
        frappe.throw(_("No valid recipients provided"))

    # Process CC and BCC
    cc_list = []
    if cc:
        if isinstance(cc, str):
            cc_list = [c.strip() for c in cc.split(",") if c.strip()]
        elif isinstance(cc, list):
            cc_list = cc

    bcc_list = []
    if bcc:
        if isinstance(bcc, str):
            bcc_list = [b.strip() for b in bcc.split(",") if b.strip()]
        elif isinstance(bcc, list):
            bcc_list = bcc

    # Add current user to recipients if send_me_a_copy is True
    if send_me_a_copy and frappe.session.user != "Guest":
        user_email = str(frappe.db.get_value("User", frappe.session.user, "email"))
        if user_email and user_email not in recipients_list:
            bcc_list.append(user_email)

    # Prepare email content with eSign link
    email_content = message

    # Add eSign link to the email content if not already present
    if esign_link not in email_content:
        link_html = f"""
        <div style="margin: 20px 0; padding: 15px; background-color: #f8f9fa; border-left: 4px solid #007bff; border-radius: 4px;">
            <h4 style="margin: 0 0 10px 0; color: #007bff;">{_("eSign Required")}</h4>
            <p style="margin: 0 0 10px 0;">{_("Please click the link below to review and sign the document:")}</p>
            <a href="{esign_link}" 
               style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 4px; font-weight: bold;"
               target="_blank">
                {_("Sign Document")}
            </a>
        </div>
        """
        email_content += link_html

    try:
        # # Send the email
        # frappe.sendmail(
        #     recipients=recipients_list,
        #     cc=cc_list or None,
        #     bcc=bcc_list or None,
        #     subject=subject,
        #     message=email_content,
        #     reference_doctype=doctype,
        #     reference_name=name,
        #     send_after=None,
        #     expose_recipients="header",
        #     print_letterhead=False,
        #     # communication_type="Automated Message"
        # )

        # Create communication record
        comm = Communication(
            {
                "doctype": "Communication",
                "communication_type": "Communication",
                "communication_medium": "Email",
                "sent_or_received": "Sent",
                "email_status": "Open",
                "subject": subject,
                "content": email_content,
                "sender": frappe.session.user,
                "recipients": ", ".join(recipients_list),
                "cc": ", ".join(cc_list) if cc_list else "",
                "bcc": ", ".join(bcc_list) if bcc_list else "",
                "reference_doctype": doctype,
                "reference_name": name,
                "status": "Linked",
                "email_template": None,
                "has_attachment": 0,
                "communication_date": frappe.utils.now(),
            }
        )
        comm.insert(ignore_permissions=True)

        comm.send_email(
            print_html=None,
            print_format=print_format,
            send_me_a_copy=send_me_a_copy,
            print_letterhead=False,
            print_language=None,
        )

        # Add comment to the document
        doc.add_comment(
            "Comment", _("eSign request sent to {0}").format(", ".join(recipients_list))
        )

        frappe.msgprint(
            _("eSign request sent successfully to {0}").format(
                ", ".join(recipients_list)
            ),
            title=_("Email Sent"),
            indicator="green",
        )

        return {
            "success": True,
            "message": _("eSign request sent successfully"),
            "communication": comm.name,
            "esign_link": esign_link,
        }

    except Exception as e:
        frappe.log_error(
            title=f"eSign: Failed to send email for {doctype} {name}", message=str(e)
        )
        frappe.throw(_("Failed to send eSign email: {0}").format(str(e)))
