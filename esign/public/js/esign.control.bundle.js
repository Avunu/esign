import { ControlSignaturePad } from './controls/signature_pad';
import { ControlUpload } from './controls/upload';
import { ControlSignature } from './controls/signature';

// Register custom controls when DOM is ready
document.addEventListener('DOMContentLoaded', function () {
	frappe.ui.form.ControlSignaturePad = ControlSignaturePad;
	frappe.ui.form.ControlUpload = ControlUpload;
	frappe.ui.form.ControlSignature = ControlSignature;
});