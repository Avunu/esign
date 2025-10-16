// Function to initialize controls after Frappe is ready
async function initializeESignControls() {
	// Check if Frappe and required classes are available
	if (
		typeof frappe === "undefined" ||
		!frappe.ui ||
		!frappe.ui.form ||
		!frappe.ui.form.ControlData
	) {
		console.warn("Frappe not ready yet, retrying...");
		setTimeout(initializeESignControls, 100);
		return;
	}

	// Now we can safely import and register the controls
	try {
		const [signaturePadModule, uploadModule, signatureModule] = await Promise.all([
			import("./controls/signature_pad"),
			import("./controls/upload"),
			import("./controls/signature"),
		]);

		frappe.ui.form.ControlSignaturePad = signaturePadModule.ControlSignaturePad;
		frappe.ui.form.ControlUpload = uploadModule.ControlUpload;
		frappe.ui.form.ControlSignature = signatureModule.ControlSignature;

		console.log("eSign controls registered successfully");
	} catch (error) {
		console.error("Failed to load eSign controls:", error);
	}
}

// Initialize when ready
if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", initializeESignControls);
} else {
	// DOM already loaded, initialize immediately
	initializeESignControls();
}