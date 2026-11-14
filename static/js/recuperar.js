(function () {

    const form       = document.getElementById('recovery-form');
    const emailInput = document.getElementById('recovery-email');
    const sendBtn     = document.getElementById('send-btn');
    const alertBox    = document.getElementById('form-alert');
    const alertMsg    = document.getElementById('form-alert-msg');

    /* ── Email regex ── */
    const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    /* ── Real-time validation ── */
    emailInput.addEventListener('input', function () {
        const valid = emailRx.test(this.value.trim());
        this.classList.toggle('is-invalid', this.value.length > 0 && !valid);
        this.classList.toggle('is-valid',   valid);
        if (valid) hideAlert();
    });

    emailInput.addEventListener('blur', function () {
        if (!this.value.trim()) {
            this.classList.remove('is-valid', 'is-invalid');
        }
    });

    /* ── Show / hide alert ── */
    function showAlert(msg) {
        alertMsg.textContent = msg;
        alertBox.classList.add('show');
    }

    function hideAlert() {
        alertBox.classList.remove('show');
    }

    /* ── Submit: solo validamos, el envío real lo hace el form al backend ── */
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

        /* Si pasó la validación, dejamos que el form haga submit normal.
           No hacemos e.preventDefault() acá. */
        sendBtn.classList.add('loading');
        sendBtn.disabled = true;
    });

})();