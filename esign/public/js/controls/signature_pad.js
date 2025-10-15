import SignaturePad from 'signature_pad';

export class ControlSignaturePad extends frappe.ui.form.ControlData {
	make() {
		var me = this;
		this.saving = false;
		this.loading = false;
		super.make();

		if (this.df.label) {
			$(this.wrapper).find("label").text(__(this.df.label, null, this.df.parent));
		}

		me.body = document.createElement('div');
		me.body.className = 'signature-field';
		me.$input_wrapper[0].prepend(me.body);

		new ResizeObserver(() => me.make_pad()).observe(this.body);
	}

	make_pad() {
		let width = this.body.offsetWidth;
		if (width > 0 && !this.signature_pad) {
			// Create canvas with proper dimensions
			this.canvas = document.createElement('canvas');
			this.canvas.width = 600;
			this.canvas.height = 200;
			this.canvas.style.cssText = 'display: block; width: 100%; border: 1px solid var(--border-color); border-radius: var(--border-radius); background: var(--control-bg); touch-action: none;';
			this.body.appendChild(this.canvas);

			// Initialize signature_pad with options
			this.signature_pad = new SignaturePad(this.canvas, {
				backgroundColor: 'transparent',
				penColor: 'black',
				minWidth: 1,
				maxWidth: 2.5,
			});

			// Handle signature changes
			this.signature_pad.addEventListener('endStroke', () => {
				this.on_save_sign();
			});

			// Create clear button
			const buttonWrapper = document.createElement('div');
			buttonWrapper.className = 'signature-btn-row';
			buttonWrapper.innerHTML = `
				<a href="#" type="button" class="signature-reset btn icon-btn">
					${frappe.utils.icon("es-line-reload", "sm")}
				</a>
			`;
			buttonWrapper.addEventListener('click', (e) => {
				if (e.target.closest('.signature-reset')) {
					e.preventDefault();
					this.on_reset_sign();
					return false;
				}
			});
			this.body.appendChild(buttonWrapper);
			this.reset_button_wrapper = buttonWrapper;

			this.load_pad();
			this.refresh_input();
		}
	}

	on_save_sign() {
		if (this.saving || this.loading) return;
		if (!this.signature_pad.isEmpty()) {
			const dataUrl = this.canvas.toDataURL('image/png');
			this.set_my_value(dataUrl);
		}
	}

	on_reset_sign() {
		this.signature_pad.clear();
		this.set_my_value('');
	}

	set_my_value(value) {
		if (this.saving || this.loading) return;
		this.saving = true;
		this.set_value(value);
		this.value = value;
		this.saving = false;
	}

	load_pad() {
		if (this.saving || !this.signature_pad) return;

		this.loading = true;
		const value = this.get_value();

		// Clear the pad
		this.signature_pad.clear();

		// Load existing signature if present
		if (value) {
			try {
				this.signature_pad.fromDataURL(value);
			} catch (e) {
				console.log("Cannot load signature data", value, e);
			}
		}

		this.loading = false;
	}

	set_input(value) {
		if (!this.signature_pad) return;
		this.value = value;
		this.load_pad();
	}

	get_value() {
		return this.value || this.get_model_value();
	}

	refresh_input() {
		if (!this.body) return;

		// Make sure pad is initialized
		this.make_pad();

		// Hide the default input wrapper
		const controlInput = this.$wrapper?.[0]?.querySelector?.('.control-input');
		if (controlInput) {
			controlInput.style.display = 'none';
		}

		// Load current value
		this.load_pad();
	}

	on_section_collapse() {
		this.refresh();
	}
}
