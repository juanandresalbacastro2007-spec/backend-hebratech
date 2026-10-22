/* proveedores.js — HebraTech · Módulo de Proveedores v2 */

document.addEventListener('DOMContentLoaded', function () {

  /* ── Contadores KPI ───────────────────────────────────── */
  (function actualizarKPIs() {
    const items = document.querySelectorAll('.prov-item[data-estado]');
    let activos = 0, inactivos = 0;
    items.forEach(btn => {
      if (btn.dataset.estado === 'activo') activos++;
      else inactivos++;
    });
    const elA = document.getElementById('cntActivos');
    const elI = document.getElementById('cntInactivos');
    if (elA) elA.textContent = activos;
    if (elI) elI.textContent = inactivos;
  })();

  /* ── Búsqueda en tiempo real ──────────────────────────── */
  const inputBusqueda = document.getElementById('campoBusqueda');
  const btnLimpiar    = document.getElementById('btnLimpiarBusqueda');
  const sinResultados = document.getElementById('sinResultados');

  function filtrarLista() {
    const filtro  = inputBusqueda.value.toLowerCase().trim();
    const estadoActivo = document.querySelector('.ftab.active')?.dataset.filtro || 'todos';
    const botones = document.querySelectorAll('.prov-item');
    let visibles  = 0;

    botones.forEach(btn => {
      const texto  = btn.textContent.toLowerCase();
      const estado = btn.dataset.estado;

      const pasaTexto  = !filtro || texto.includes(filtro);
      const pasaEstado = estadoActivo === 'todos' || estado === estadoActivo;

      if (pasaTexto && pasaEstado) {
        btn.style.display = 'flex';
        visibles++;
      } else {
        btn.style.display = 'none';
      }
    });

    if (sinResultados) {
      sinResultados.classList.toggle('d-none', visibles > 0);
    }

    if (btnLimpiar) {
      btnLimpiar.classList.toggle('d-none', !filtro);
    }
  }

  if (inputBusqueda) {
    inputBusqueda.addEventListener('input', filtrarLista);
  }

  if (btnLimpiar) {
    btnLimpiar.addEventListener('click', function () {
      inputBusqueda.value = '';
      filtrarLista();
      inputBusqueda.focus();
    });
  }

  /* ── Filtro por estado ────────────────────────────────── */
  document.querySelectorAll('.ftab').forEach(tab => {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.ftab').forEach(t => t.classList.remove('active'));
      this.classList.add('active');
      filtrarLista();
    });
  });

  /* ── Copiar NIT al portapapeles ────────────────────────── */
  window.copiarNIT = function (nit, btn) {
    navigator.clipboard.writeText(nit).then(() => {
      const original = btn.innerHTML;
      btn.innerHTML = '<i class="bi bi-check-lg me-1"></i>¡Copiado!';
      btn.style.background    = 'rgba(40,167,69,0.08)';
      btn.style.borderColor   = 'rgba(40,167,69,0.4)';
      btn.style.color         = '#1a7a38';
      setTimeout(() => {
        btn.innerHTML = original;
        btn.style.background  = '';
        btn.style.borderColor = '';
        btn.style.color       = '';
      }, 1800);
    }).catch(() => {
      alert('No se pudo copiar. NIT: ' + nit);
    });
  };

  /* ── Validación Bootstrap del formulario Agregar ──────── */
  const formAgregarProveedor = document.getElementById('formAgregarProveedor');

  if (formAgregarProveedor) {
    formAgregarProveedor.addEventListener('submit', function (e) {
      if (!formAgregarProveedor.checkValidity()) {
        e.preventDefault();
        e.stopPropagation();
      }
      formAgregarProveedor.classList.add('was-validated');
    });
  }

});

document.addEventListener('DOMContentLoaded', () => {
  const btnAnt = document.getElementById('btnProvAnterior');
  const btnSig = document.getElementById('btnProvSiguiente');

  function cambiarProveedor(direccion) {
    // Obtener todos los botones de la lista de proveedores visible o no filtrada
    const items = Array.from(document.querySelectorAll('.prov-list .prov-item:not(.d-none)'));
    if (items.length === 0) return;

    // Encontrar el índice del proveedor actualmente activo
    const indiceActual = items.findIndex(item => item.classList.contains('active'));

    let nuevoIndice;
    if (direccion === 'siguiente') {
      nuevoIndice = (indiceActual + 1) % items.length; // Avanza y vuelve al inicio al llegar al final
    } else {
      nuevoIndice = (indiceActual - 1 + items.length) % items.length; // Retrocede y va al final si está al inicio
    }

    // Activar la pestaña del Bootstrap Tab
    const targetButton = items[nuevoIndice];
    if (targetButton) {
      const tabTrigger = new bootstrap.Tab(targetButton);
      tabTrigger.show();
      targetButton.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  if (btnSig) {
    btnSig.addEventListener('click', () => cambiarProveedor('siguiente'));
  }
  
  if (btnAnt) {
    btnAnt.addEventListener('click', () => cambiarProveedor('anterior'));
  }
});


/* ── Cambiar Estado de Proveedor (Activo / Inactivo) ──── */
  window.cambiarEstadoProveedor = function(id, nuevoEstado) {
    const mensaje = nuevoEstado === 'inactivo' 
      ? '¿Estás seguro de desactivar este proveedor?' 
      : '¿Estás seguro de activar este proveedor?';
      
    if (!confirm(mensaje)) return;

    fetch(`/proveedores/cambiar-estado/${id}/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': document.querySelector('[name=csrfmiddlewaretoken]').value
      },
      body: JSON.stringify({ estado: nuevoEstado })
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        location.reload(); // Recarga la página para actualizar estados visuales y KPIs
      } else {
        alert('No se pudo cambiar el estado: ' + (data.error || 'Error desconocido'));
      }
    })
    .catch(error => {
      console.error('Error de red:', error);
      alert('Ocurrió un error al procesar la solicitud.');
    });
  };


/* ── Formateadores y Máscaras en Tiempo Real ───────────── */
document.addEventListener('DOMContentLoaded', function () {

  // 1. Función para formatear valor de NIT (ej: 900.123.456-7)
  function formatearNITVal(raw) {
    let valor = raw.replace(/\D/g, '');
    if (valor.length > 10) valor = valor.slice(0, 10);
    if (!valor) return '';

    let principales = valor.length === 10 ? valor.slice(0, 9) : valor;
    let dv = valor.length === 10 ? valor.slice(9) : '';

    principales = principales.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return dv ? `${principales}-${dv}` : principales;
  }

  // 2. Función para formatear Teléfono Colombia (ej: 300 123 4567 o 601 2345)
  function formatearTelefonoVal(raw) {
    let valor = raw.replace(/\D/g, '');
    if (valor.length > 10) valor = valor.slice(0, 10);
    if (!valor) return '';

    // Si es un celular de 10 dígitos (ej: 300 123 4567)
    if (valor.length > 7) {
      return valor.replace(/(\d{3})(\d{3})(\d{0,4})/, function(_, p1, p2, p3) {
        let res = p1;
        if (p2) res += ' ' + p2;
        if (p3) res += ' ' + p3;
        return res;
      });
    }
    // Si es teléfono fijo de 7 dígitos (ej: 601 2345)
    return valor.replace(/(\d{3})(\d{0,4})/, function(_, p1, p2) {
      return p2 ? `${p1} ${p2}` : p1;
    });
  }

  // ── Aplicar a Inputs de Entrada (Agregar y Editar) ──────
  document.querySelectorAll('.input-nit-mask, #nit').forEach(input => {
    // Formatear al escribir
    input.addEventListener('input', e => {
      e.target.value = formatearNITVal(e.target.value);
    });
    // Formatear valor inicial
    if (input.value) input.value = formatearNITVal(input.value);
  });

  document.querySelectorAll('.input-telefono-mask').forEach(input => {
    // Formatear al escribir
    input.addEventListener('input', e => {
      e.target.value = formatearTelefonoVal(e.target.value);
    });
    // Formatear valor inicial
    if (input.value) input.value = formatearTelefonoVal(input.value);
  });

  // ── Aplicar a Textos Renderizados en Cards y Listas ─────
  document.querySelectorAll('.formato-nit').forEach(el => {
    el.textContent = formatearNITVal(el.textContent);
  });

  document.querySelectorAll('.formato-telefono').forEach(el => {
    el.textContent = formatearTelefonoVal(el.textContent);
  });

});