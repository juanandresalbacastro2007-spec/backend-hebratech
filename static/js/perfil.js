/* ══════════════════════════════════════════
   PERFIL MODAL — HebraTech (administrador y operarios)
   Ruta: static/js/perfil.js
   - La URL de envío sale del atributo action del formulario.
   - Si existe #perfilPasswordActual (operarios), se exige al cambiar contraseña.
   ══════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', function () {
  const form       = document.getElementById('formEditarPerfil');
  const modalEl    = document.getElementById('modalEditarPerfil');
  const alertBox   = document.getElementById('perfilAlert');
  const btnGuardar = document.getElementById('btnGuardarPerfil');
  const spinner    = document.getElementById('spinnerGuardar');
  const btnText    = btnGuardar ? btnGuardar.querySelector('.btn-text') : null;

  if (!form || !modalEl) return;

  const inputNombre   = document.getElementById('perfilNombre');
  const inputApellido = document.getElementById('perfilApellido');
  const inputEmail    = document.getElementById('perfilEmail');
  const inputPass1    = document.getElementById('perfilPassword1');
  const inputPass2    = document.getElementById('perfilPassword2');
  const inputActual   = document.getElementById('perfilPasswordActual'); // solo operarios
  const inputDireccion    = document.getElementById('perfilDireccion');     // solo operarios
  const inputEspecialidad = document.getElementById('perfilEspecialidad');  // solo operarios
  const inputFoto     = document.getElementById('perfilFoto');
  const avatarPreview = document.getElementById('perfilAvatarPreview');

  const camposValidables = [inputNombre, inputApellido, inputEmail, inputPass1, inputPass2, inputActual, inputEspecialidad, inputDireccion];

  let previewUrl = null;                                   // URL temporal de la foto elegida
  let previewOriginal = avatarPreview ? avatarPreview.innerHTML : '';

  /* ── Vista previa en tiempo real de la foto seleccionada ── */
  if (inputFoto && avatarPreview) {
    inputFoto.addEventListener('change', function (e) {
      const archivo = e.target.files[0];
      if (!archivo) return;

      if (!archivo.type.startsWith('image/')) {
        mostrarAlerta('Por favor selecciona un archivo de imagen válido (JPG, PNG, WEBP).', 'error');
        this.value = '';
        return;
      }

      limpiarAlerta();

      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(archivo);
      avatarPreview.innerHTML = `<img src="${previewUrl}" alt="Vista previa del avatar">`;
    });
  }

  /* ── Mostrar / Ocultar Contraseña ── */
  document.querySelectorAll('#modalEditarPerfil .toggle-password').forEach(icon => {
    icon.addEventListener('click', function () {
      const input = document.getElementById(this.dataset.target);
      if (!input) return;

      const esPassword = input.type === 'password';
      input.type = esPassword ? 'text' : 'password';
      this.classList.toggle('bi-eye-slash-fill', !esPassword);
      this.classList.toggle('bi-eye-fill', esPassword);
    });
  });

  /* ── Helpers de Estado y Alertas ── */
  function mostrarAlerta(mensaje, tipo) {
    alertBox.textContent = mensaje;
    alertBox.className = 'perfil-alert ' + (tipo === 'error' ? 'show-error' : 'show-success');
  }

  function limpiarAlerta() {
    alertBox.className = 'perfil-alert';
    alertBox.textContent = '';
  }

  function limpiarErroresCampos() {
    camposValidables.forEach(el => el && el.classList.remove('is-invalid'));
  }

  function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
  }

  function setLoading(activo) {
    if (!btnGuardar) return;
    btnGuardar.disabled = activo;
    if (btnText) btnText.textContent = activo ? 'Guardando...' : 'Guardar cambios';
    if (spinner) spinner.classList.toggle('d-none', !activo);
  }

  /* ── Manejo de errores devueltos por el backend ── */
  function manejarErrorBackend(mensaje) {
    const msgLower = (mensaje || '').toLowerCase();

    if (msgLower.includes('especialidad') && inputEspecialidad) {
      inputEspecialidad.classList.add('is-invalid');
      inputEspecialidad.focus();
    } else if (msgLower.includes('dirección') && inputDireccion) {
      inputDireccion.classList.add('is-invalid');
      inputDireccion.focus();
    } else if (msgLower.includes('actual') && inputActual) {
      inputActual.classList.add('is-invalid');
      inputActual.focus();
    } else if (msgLower.includes('correo') || msgLower.includes('email')) {
      inputEmail.classList.add('is-invalid');
      inputEmail.focus();
    } else if (msgLower.includes('contraseña')) {
      inputPass1.classList.add('is-invalid');
      inputPass2.classList.add('is-invalid');
      inputPass1.focus();
    } else if (msgLower.includes('nombre') && !msgLower.includes('apellido')) {
      inputNombre.classList.add('is-invalid');
      inputNombre.focus();
    } else if (msgLower.includes('apellido')) {
      inputApellido.classList.add('is-invalid');
      inputApellido.focus();
    }

    mostrarAlerta(mensaje || 'No se pudo actualizar el perfil.', 'error');
  }

  /* ── Refresca nombre y avatar visibles en la página (sin recargar) ── */
  function actualizarInterfaz(nombre, apellido, fotoUrl, tieneFoto) {
    // Admin: sidebar
    document.querySelectorAll('.admin-name').forEach(el => { el.textContent = `${nombre} ${apellido}`; });
    // Operario: navbar (solo nombre) y menú lateral (nombre completo)
    document.querySelectorAll('[data-perfil-nombre]').forEach(el => { el.textContent = nombre; });
    document.querySelectorAll('[data-perfil-nombre-completo]').forEach(el => { el.textContent = `${nombre} ${apellido}`; });

    const inicial1 = nombre.charAt(0).toUpperCase();
    const inicial2 = (nombre.charAt(0) + apellido.charAt(0)).toUpperCase();

    document.querySelectorAll('.admin-avatar, [data-perfil-avatar]').forEach(el => {
      const dosLetras = el.hasAttribute('data-perfil-avatar');
      if (fotoUrl) {
        el.innerHTML = `<img src="${fotoUrl}" alt="Avatar" class="admin-avatar-img">`;
      } else if (tieneFoto === false || !el.querySelector('img')) {
        el.textContent = dosLetras ? inicial2 : inicial1;
      }
    });
  }

  /* ── Envío del Formulario vía AJAX (FormData soporta archivos) ── */
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    limpiarAlerta();
    limpiarErroresCampos();

    const pass1 = inputPass1 ? inputPass1.value : '';
    const pass2 = inputPass2 ? inputPass2.value : '';

    if (pass1 || pass2) {
      if (inputActual && !inputActual.value) {
        inputActual.classList.add('is-invalid');
        mostrarAlerta('Escribe tu contraseña actual para poder cambiarla.', 'error');
        return;
      }
      if (pass1 !== pass2) {
        inputPass1.classList.add('is-invalid');
        inputPass2.classList.add('is-invalid');
        mostrarAlerta('Las contraseñas no coinciden.', 'error');
        return;
      }
      if (pass1.length < 8) {
        inputPass1.classList.add('is-invalid');
        mostrarAlerta('La contraseña debe tener al menos 8 caracteres.', 'error');
        return;
      }
    }

    setLoading(true);

    // FormData empaqueta automáticamente textos y archivos (<input type="file">)
    const formData = new FormData(form);

    try {
      const response = await fetch(form.getAttribute('action') || '/administrador/editar-perfil/', {
        method: 'POST',
        headers: {
          'X-CSRFToken': getCookie('csrftoken'),
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: formData
      });

      let data;
      try {
        data = await response.json();
      } catch (parseErr) {
        throw new Error('Respuesta inválida del servidor.');
      }

      const textoServidor = data.mensaje || data.message;

      if (response.ok && data.success) {
        mostrarAlerta(textoServidor || 'Perfil actualizado correctamente.', 'success');

        const nombre   = inputNombre.value.trim();
        const apellido = inputApellido.value.trim();

        // Foto nueva: la que devuelve el servidor o, si no la devuelve, la vista previa local
        const subioFoto = inputFoto && inputFoto.files && inputFoto.files[0];
        const fotoUrl = data.foto_url || (subioFoto ? previewUrl : null);

        actualizarInterfaz(nombre, apellido, fotoUrl, data.tiene_foto);

        // Lo guardado pasa a ser el nuevo "estado original" del modal
        [inputNombre, inputApellido, inputEmail, inputDireccion, inputEspecialidad,
         document.getElementById('perfilTelefono')]
          .forEach(el => {
            if (!el) return;
            if (el.tagName === 'SELECT') {
              Array.from(el.options).forEach(o => { o.defaultSelected = o.selected; });
            } else {
              el.defaultValue = el.value;
            }
          });
        if (avatarPreview) previewOriginal = avatarPreview.innerHTML;

        // Cerrar modal tras guardar con éxito
        setTimeout(() => {
          const instanciaModal = bootstrap.Modal.getInstance(modalEl);
          if (instanciaModal) instanciaModal.hide();

          limpiarAlerta();
          if (inputActual) inputActual.value = '';
          if (inputPass1) inputPass1.value = '';
          if (inputPass2) inputPass2.value = '';
          if (inputFoto) inputFoto.value = '';
        }, 1200);

      } else {
        manejarErrorBackend(textoServidor);
      }
    } catch (err) {
      mostrarAlerta('Error de conexión con el servidor. Intenta nuevamente.', 'error');
    } finally {
      setLoading(false);
    }
  });

  /* ── Quitar clase de error al interactuar con las entradas ── */
  camposValidables.forEach(input => {
    if (!input) return;
    input.addEventListener('input', function () {
      this.classList.remove('is-invalid');
    });
  });

  /* ── Al cerrar el modal: limpiar alertas y descartar cambios sin guardar ── */
  modalEl.addEventListener('hidden.bs.modal', function () {
    limpiarAlerta();
    limpiarErroresCampos();
    form.reset();                                   // vuelve a los últimos valores guardados
    if (avatarPreview) avatarPreview.innerHTML = previewOriginal;
  });
});