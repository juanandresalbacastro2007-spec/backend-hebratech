(function () {

    const form        = document.getElementById('recovery-form');
    const emailInput  = document.getElementById('recovery-email');
    const sendBtn     = document.getElementById('send-btn');
    const alertBox    = document.getElementById('form-alert');
    const alertMsg    = document.getElementById('form-alert-msg');
    const formView    = document.getElementById('form-view');
    const successView = document.getElementById('success-view');

    if (!form || !emailInput || !sendBtn) return;

    const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    /* ── Validación en tiempo real ── */
    emailInput.addEventListener('input', function () {
        const valid = emailRx.test(this.value.trim());
        this.classList.toggle('is-invalid', this.value.length > 0 && !valid);
        this.classList.toggle('is-valid', valid);
        if (valid) hideAlert();
    });

    emailInput.addEventListener('blur', function () {
        if (!this.value.trim()) {
            this.classList.remove('is-valid', 'is-invalid');
        }
    });

    /* ── Mostrar / ocultar alert (con display explícito) ── */
    function showAlert(msg) {
        if (!alertBox || !alertMsg) return;
        alertMsg.textContent = msg;
        alertBox.classList.add('show');
        alertBox.style.display = 'flex';   // forzamos visibilidad
    }

    function hideAlert() {
        if (!alertBox) return;
        alertBox.classList.remove('show');
        alertBox.style.display = 'none';   // forzamos ocultamiento
    }

    /* ── Submit: validamos y DEJAMOS que el form se envíe normalmente ── */
    form.addEventListener('submit', function (e) {
        hideAlert();

        const email = emailInput.value.trim();

        if (!email) {
            e.preventDefault();
            emailInput.classList.add('is-invalid');
            showAlert('Por favor ingresa tu correo electrónico.');
            return;
        }

        if (!emailRx.test(email)) {
            e.preventDefault();
            emailInput.classList.add('is-invalid');
            showAlert('El correo electrónico ingresado no es válido.');
            return;
        }

        /*
         * IMPORTANTE: no hacemos e.preventDefault() ni deshabilitamos el botón
         * en este instante. Deshabilitar el submit button DENTRO del evento
         * 'submit' cancela el POST en Chrome/Safari.
         * Lo deshabilitamos con setTimeout para que el navegador ya haya
         * iniciado el envío.
         */
        sendBtn.classList.add('loading');
        const label = sendBtn.querySelector('.btn-label');
        const originalText = label ? label.textContent : '';
        if (label) label.textContent = 'Enviando...';

        setTimeout(function () {
            sendBtn.disabled = true;
        }, 60);
    });

    /* ── Si el usuario vuelve con "Atrás", rehabilitar botón ── */
    window.addEventListener('pageshow', function () {
        if (!sendBtn) return;
        sendBtn.disabled = false;
        sendBtn.classList.remove('loading');
        const label = sendBtn.querySelector('.btn-label');
        if (label) label.textContent = 'Enviar enlace de recuperación';
    });

    /* ── resetToForm: vuelve de success-view al formulario ── */
    window.resetToForm = function () {
        if (!formView || !successView) return;

        successView.style.display = 'none';
        formView.style.display    = 'block';

        const dot1 = document.getElementById('dot-1');
        const dot2 = document.getElementById('dot-2');
        if (dot1) dot1.classList.add('active');
        if (dot2) dot2.classList.remove('active');

        form.reset();
        emailInput.classList.remove('is-valid', 'is-invalid');
        sendBtn.disabled = false;
        sendBtn.classList.remove('loading');
        const label = sendBtn.querySelector('.btn-label');
        if (label) label.textContent = 'Enviar enlace de recuperación';
        hideAlert();
    };

})();