/**
 * HEBRATECH — MÓDULO OPERARIO
 * Tablero Kanban con: cronómetros en tiempo real, drag & drop,
 * gestión completa de incidencias (crear / editar / eliminar / PDF),
 * filtros, KPIs de navbar y pestañas móvil.
 */

document.addEventListener('DOMContentLoaded', () => {

    // ─── ENDPOINTS ───────────────────────────────────────────────
    const ENDPOINTS = {
        tareas:            '/operarios/api/tareas/',
        cambiarEstado:     (id) => `/operarios/api/tarea/${id}/estado/`,
        guardarReporte:    '/operarios/api/reporte/',
        editarReporte:     (id) => `/operarios/api/reporte/${id}/editar/`,
        eliminarReporte:   (id) => `/operarios/api/reporte/${id}/eliminar/`,
        historialReportes: '/operarios/api/reportes/',
        pdfReporte:        (id) => `/operarios/api/reporte/${id}/pdf/`,
        marcarRespuestaLeida: (id) => `/operarios/api/reporte/${id}/leer/`,
    };

    // ─── ESTADO LOCAL ────────────────────────────────────────────
    const cacheTareas       = {};
    const cacheIncidencias  = {};
    const timerIntervals    = {};
    const alertedTasks      = new Set();

    let listaReportes          = [];
    const incFiltro            = { q: '', estado: 'todos' };
    const histFiltro           = { q: '', proceso: '' };

    let pendingDeleteId        = null;
    let activeStartTaskId      = null;
    let activeFinishTaskId     = null;

    // Columna "Completadas": solo se muestra la última; el resto va al historial
    let ultimaCompletadaId     = null;   // la que el operario acaba de completar en esta sesión
    let idCompletadaVisible    = null;   // la que se está mostrando en la columna

    // ─── SELECTORES ESTÁTICOS ────────────────────────────────────
    const zonas = {
        'Pendiente':   document.getElementById('list-Pendiente'),
        'En Progreso': document.getElementById('list-En Progreso'),
        'Completada':  document.getElementById('list-Completada'),
    };

    // ─── HELPERS DE FORMATO ──────────────────────────────────────
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
    const pad4 = (id) => String(id).padStart(4, '0');
    const fmtH = (n) => Number(n).toFixed(1).replace(/\.0$/, '');
    const num  = (v) => (v === null || v === undefined || v === '' || isNaN(Number(v))) ? null : Number(v);

    // Más reciente primero. La API entrega solo la fecha (sin hora), así que
    // el empate del mismo día se desempata por id de asignación.
    const masReciente = (a, b) =>
        (b.fechaFinalizacion || '').localeCompare(a.fechaFinalizacion || '')
        || Number(b.idAsignacion) - Number(a.idAsignacion);

    // ─── INIT ────────────────────────────────────────────────────
    function init() {
        cargarTareas();
        cargarHistorialReportes();
        configurarDragAndDrop();
        configurarFormularioIncidencia();
        configurarBotonesExteriores();
        configurarHistorialTareas();
        configurarColapsarColumnaCompletada();
        configurarModalEliminar();
        configurarBuscadorYFiltros();
        configurarKpisNavbar();
        configurarPestañasMobile();
        configurarModalesAccion();
        configurarListaIncidencias();
        configurarSelectsAnimados();
        configurarMenuLateral();
    }

    // ═══════════════════════════════════════════════════════════
    // 1. CARGA Y RENDER DE TAREAS
    // ═══════════════════════════════════════════════════════════

    async function cargarTareas() {
        const loading = document.getElementById('loadingIndicator');
        if (loading) loading.style.display = 'flex';
        try {
            const res = await fetch(ENDPOINTS.tareas);
            if (!res.ok) throw new Error('Error al cargar tareas');
            const data = await res.json();
            renderizarKanban(data.tareas || []);
        } catch (err) {
            console.error(err);
            mostrarToast('No se pudieron cargar las tareas', 'err');
        } finally {
            if (loading) loading.style.display = 'none';
        }
    }

    function renderizarKanban(tareas) {
        Object.keys(cacheTareas).forEach(k => delete cacheTareas[k]);
        Object.keys(timerIntervals).forEach(id => {
            clearInterval(timerIntervals[id]);
            delete timerIntervals[id];
        });

        ['Pendiente', 'En Progreso', 'Completada'].forEach(estado => {
            const zona = zonas[estado];
            if (zona) zona.querySelectorAll('.ht-card').forEach(c => c.remove());
        });

        const completadas = tareas.filter(t => t.estado === 'Completada').sort(masReciente);
        const visible = completadas.find(t => t.idAsignacion === ultimaCompletadaId) || completadas[0] || null;
        idCompletadaVisible = visible ? visible.idAsignacion : null;

        tareas.forEach(t => {
            cacheTareas[t.idAsignacion] = t;
            // Solo la última completada queda en el tablero; las demás viven en el historial
            if (t.estado === 'Completada' && t !== visible) return;
            const card = crearCard(t);
            const zona = zonas[t.estado];
            if (!zona) return;
            const emptyEl = zona.querySelector('.ht-col-empty');
            emptyEl ? zona.insertBefore(card, emptyEl) : zona.appendChild(card);
        });

        actualizarEmptyStates();
        actualizarContadores(tareas);
        actualizarBadgeHistorial(tareas);
        actualizarNotaArchivo(completadas.length);
        aplicarFiltros();

        const total = document.getElementById('totalTasks');
        if (total) total.textContent = tareas.length;
    }

    function crearCard(t) {
        const card = document.createElement('div');
        card.className = 'ht-card';
        card.setAttribute('draggable', t.estado === 'Completada' ? 'false' : 'true');
        card.setAttribute('data-id-asignacion', t.idAsignacion);
        card.setAttribute('data-prio', t.prioridad);
        card.setAttribute('data-estado', t.estado);
        card.setAttribute('data-process', t.proceso || '');

        const prioClass  = `ht-badge-prio-${t.prioridad}`;
        const compClass  = `ht-badge-complex-${(t.complejidad || 'media').toLowerCase()}`;

        const timerBlock = t.estado === 'En Progreso'
            ? `<div class="ht-timer-block" id="timerBlock-${t.idAsignacion}">
                   <i class="bi bi-stopwatch-fill"></i>
                   <span class="ht-timer-text" id="timer-${t.idAsignacion}">00:00:00</span>
                   <span class="ht-timer-excess d-none" id="excess-${t.idAsignacion}"></span>
               </div>`
            : '';

        let actionBtns = '';
        if (t.estado === 'Pendiente') {
            actionBtns = `
                <button class="ht-card-btn-action ht-card-btn--start" data-action="iniciar">
                    <i class="bi bi-play-fill me-1"></i>Iniciar
                </button>`;
        } else if (t.estado === 'En Progreso') {
            actionBtns = `
                <button class="ht-card-btn-action ht-card-btn--finish" data-action="finalizar">
                    <i class="bi bi-check-lg me-1"></i>Finalizar
                </button>
                <button class="ht-card-btn-action ht-card-btn--warn" data-action="reportar" title="Reportar incidencia">
                    <i class="bi bi-exclamation-triangle-fill"></i>
                </button>`;
        }

        card.innerHTML = `
            <div class="ht-card-header">
                <span class="ht-card-name">${t.nombreTarea || 'Tarea sin título'}</span>
                <button class="ht-card-btn-detail" data-action="ver" title="Ver detalle">
                    <i class="bi bi-eye"></i>
                </button>
            </div>
            <div class="ht-card-proceso">
                <i class="bi bi-gear-fill"></i>${t.proceso || 'General'}
                &nbsp;·&nbsp;
                <i class="bi bi-cpu"></i>${t.maquina || 'Planta'}
            </div>
            <p class="ht-card-desc">${t.descripcionTarea || 'Sin descripción adicional.'}</p>
            <div class="ht-card-tags">
                <span class="ht-badge ${prioClass}">${t.prioridad}</span>
                <span class="ht-badge ${compClass}">${t.complejidad || 'Media'}</span>
                ${t.cantidadPrendas ? `<span class="ht-badge" style="background:var(--surface);border:1px solid var(--border-md);color:var(--text-muted);"><i class="bi bi-boxes me-1"></i>${t.cantidadPrendas} ${t.tipoPrenda || 'uds'}</span>` : ''}
                <span class="ht-badge" style="background:var(--surface);border:1px solid var(--border-md);color:var(--text-muted);"><i class="bi bi-clock me-1"></i>${t.horasEstimadas}h</span>
                ${t.estado === 'Completada' ? `<span class="ht-badge" style="background:rgba(21,115,71,.12);border:1px solid rgba(21,115,71,.35);color:var(--ok);"><i class="bi bi-check-circle-fill me-1"></i>Finalizada ${t.fechaFinalizacion || ''}</span>` : ''}
            </div>
            ${timerBlock}
            ${actionBtns ? `<div class="ht-card-actions">${actionBtns}</div>` : ''}
        `;

        card.addEventListener('dragstart', e => {
            e.dataTransfer.setData('text/plain', String(t.idAsignacion));
            card.classList.add('dragging');
        });
        card.addEventListener('dragend', () => card.classList.remove('dragging'));

        card.addEventListener('click', e => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            e.stopPropagation();
            const action = btn.dataset.action;
            if (action === 'ver')        abrirDetalleTarea(t);
            if (action === 'iniciar')    abrirModalIniciar(t);
            if (action === 'finalizar')  abrirModalFinalizar(t);
            if (action === 'reportar')   abrirModalIncidencia(null, t);
        });

        if (t.estado === 'En Progreso') iniciarCronometro(t);

        return card;
    }

    // ═══════════════════════════════════════════════════════════
    // 2. CRONÓMETROS EN TIEMPO REAL
    // ═══════════════════════════════════════════════════════════

    function iniciarCronometro(tarea) {
        const id = tarea.idAsignacion;
        const inicioMs = tarea.fechaInicioTs || Date.now();
        const limitMs  = (tarea.horasEstimadas || 1) * 3600 * 1000;

        timerIntervals[id] = setInterval(() => {
            const el = document.getElementById(`timer-${id}`);
            if (!el) { clearInterval(timerIntervals[id]); return; }

            const elapsedMs   = Date.now() - inicioMs;
            const remainingMs = limitMs - elapsedMs;
            const excessEl    = document.getElementById(`excess-${id}`);

            if (remainingMs > 3600000) {
                const horasRest = remainingMs / 3600000;
                el.textContent = `${horasRest.toFixed(1)}h restantes`;
                el.classList.remove('ht-timer-critico');
                if (excessEl) excessEl.classList.add('d-none');

            } else if (remainingMs > 0) {
                const minRest = Math.floor(remainingMs / 60000);
                const segRest = Math.floor((remainingMs % 60000) / 1000);
                el.textContent = `${minRest}:${String(segRest).padStart(2, '0')} min`;
                el.classList.add('ht-timer-critico');
                if (excessEl) excessEl.classList.add('d-none');

                if (!alertedTasks.has(id)) {
                    alertedTasks.add(id);
                    mostrarToast(`⏰ Falta 1 hora para completar "${tarea.nombreTarea}"`, 'err');
                }

            } else {
                el.textContent = 'Tiempo excedido';
                el.classList.add('ht-timer-critico');
                if (excessEl) {
                    const minEx = Math.floor(-remainingMs / 60000);
                    excessEl.textContent = `⚠ +${minEx}m`;
                    excessEl.classList.remove('d-none');
                }
            }
        }, 1000);
    }

    // ═══════════════════════════════════════════════════════════
    // 3. FLUJO INICIAR TAREA
    // ═══════════════════════════════════════════════════════════

    function abrirModalIniciar(tarea) {
        activeStartTaskId = tarea.idAsignacion;
        document.getElementById('startTaskTitle').textContent    = tarea.nombreTarea;
        document.getElementById('startTaskProcess').textContent  = tarea.proceso || 'General';
        document.getElementById('startTaskQty').textContent      = `${tarea.cantidadPrendas || 0} ${tarea.tipoPrenda || 'prendas'}`;
        document.getElementById('startTaskTime').textContent     = `${tarea.horasEstimadas}h estimadas`;
        document.getElementById('startTaskPrio').textContent     = tarea.prioridad || 'Media';
        bootstrap.Modal.getOrCreateInstance(
            document.getElementById('modalIniciarTarea')
        ).show();
    }

    function configurarModalesAccion() {
        const btnStart = document.getElementById('btnConfirmStartTask');
        if (btnStart) {
            btnStart.addEventListener('click', async () => {
                if (!activeStartTaskId) return;
                await cambiarEstado(activeStartTaskId, 'En Progreso');
                bootstrap.Modal.getInstance(document.getElementById('modalIniciarTarea')).hide();
            });
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 4. FLUJO FINALIZAR TAREA
    // ═══════════════════════════════════════════════════════════

    function abrirModalFinalizar(tarea) {
        activeFinishTaskId = tarea.idAsignacion;
        document.getElementById('finishQtyGood').value        = tarea.cantidadPrendas || 0;
        document.getElementById('finishQtyBad').value         = 0;
        document.getElementById('finishNotes').value          = '';
        document.getElementById('finishHasIncidence').checked = false;
        document.getElementById('finishNotesGroup').style.display = 'none';
        document.getElementById('finishNotes').classList.remove('is-invalid');
        bootstrap.Modal.getOrCreateInstance(
            document.getElementById('modalFinalizarTarea')
        ).show();
    }

    const finishSwitch = document.getElementById('finishHasIncidence');
    if (finishSwitch) {
        finishSwitch.addEventListener('change', function () {
            const grupo = document.getElementById('finishNotesGroup');
            grupo.style.display = this.checked ? '' : 'none';
            if (!this.checked) document.getElementById('finishNotes').classList.remove('is-invalid');
        });
    }

    const btnFinish = document.getElementById('btnConfirmFinishTask');
    if (btnFinish) {
        btnFinish.addEventListener('click', async () => {
            if (!activeFinishTaskId) return;
            const hasIncidence  = document.getElementById('finishHasIncidence').checked;
            const notesEl       = document.getElementById('finishNotes');
            const observaciones = notesEl.value.trim();

            if (hasIncidence && observaciones.length < 5) {
                notesEl.classList.add('is-invalid');
                mostrarToast('Describe el inconveniente antes de continuar', 'err');
                return;
            }

            await cambiarEstado(activeFinishTaskId, 'Completada');
            bootstrap.Modal.getInstance(document.getElementById('modalFinalizarTarea')).hide();
            if (hasIncidence) {
                const tarea = cacheTareas[activeFinishTaskId];
                if (tarea) abrirModalIncidencia(null, tarea, observaciones);
            }
        });
    }

    async function cambiarEstado(idAsignacion, nuevoEstado) {
        const completando = nuevoEstado === 'Completada';
        const previaId    = idCompletadaVisible;
        try {
            const res = await fetch(ENDPOINTS.cambiarEstado(idAsignacion), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrfToken(),
                },
                body: JSON.stringify({ estado: nuevoEstado }),
            });
            if (!res.ok) throw new Error('Error actualizando estado');
            mostrarToast(`Tarea movida a "${nuevoEstado}"`, 'ok');
            if (completando) ultimaCompletadaId = idAsignacion;
            await cargarTareas();

            // La completada anterior sale de la columna: avisar que quedó en el historial
            if (completando && previaId && previaId !== idCompletadaVisible
                && cacheTareas[previaId]?.estado === 'Completada') {
                mostrarAvisoArchivada(cacheTareas[previaId]);
            }
        } catch (err) {
            console.error(err);
            mostrarToast('No se pudo actualizar el estado', 'err');
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 5. DRAG & DROP
    // ═══════════════════════════════════════════════════════════

    function configurarDragAndDrop() {
        Object.values(zonas).forEach(zona => {
            if (!zona) return;

            zona.addEventListener('dragover', e => {
                e.preventDefault();
                zona.classList.add('drag-over');
            });
            zona.addEventListener('dragleave', () => zona.classList.remove('drag-over'));
            zona.addEventListener('drop', async e => {
                e.preventDefault();
                zona.classList.remove('drag-over');
                const id     = parseInt(e.dataTransfer.getData('text/plain'), 10);
                const estado = zona.closest('.ht-kanban-col')?.dataset?.estado;
                if (!id || !estado) return;

                const tarea = cacheTareas[id];
                if (!tarea || tarea.estado === estado) return;

                if (estado === 'En Progreso') {
                    abrirModalIniciar(tarea);
                } else if (estado === 'Completada') {
                    abrirModalFinalizar(tarea);
                } else {
                    await cambiarEstado(id, estado);
                }
            });
        });
    }

    // ═══════════════════════════════════════════════════════════
    // 6. MODAL DE DETALLE DE TAREA
    // ═══════════════════════════════════════════════════════════

    function abrirDetalleTarea(t) {
        document.getElementById('dtlTaskTitle').textContent = t.nombreTarea;

        let fechaFinStr = '—';
        let diasEst = null;

        if (t.fechaLimite) {
            const fin = new Date(t.fechaLimite + 'T00:00:00');
            fechaFinStr = fin.toLocaleDateString('es-CO', {
                day: '2-digit', month: 'short', year: 'numeric',
            });
            if (t.fechaInicio) {
                const ini = new Date(t.fechaInicio + 'T00:00:00');
                diasEst = Math.max(1, Math.round((fin - ini) / 86400000));
            }
        } else if (t.fechaInicio) {
            diasEst = Math.ceil((t.horasEstimadas || 0) / 10) || 1;
            const d = new Date(t.fechaInicio + 'T00:00:00');
            d.setDate(d.getDate() + diasEst);
            fechaFinStr = d.toLocaleDateString('es-CO', {
                day: '2-digit', month: 'short', year: 'numeric',
            });
        }

        document.getElementById('taskDetailBody').innerHTML = `
            <div class="ht-detail-desc">
                <p>${t.descripcionTarea || 'Sin descripción adicional.'}</p>
            </div>
            <div class="ht-detail-grid">
                <div class="ht-detail-item">
                    <div class="ht-detail-label"><i class="bi bi-gear-fill"></i> Proceso</div>
                    <div class="ht-detail-value">${t.proceso || '—'}</div>
                </div>
                <div class="ht-detail-item">
                    <div class="ht-detail-label"><i class="bi bi-boxes"></i> Cantidad</div>
                    <div class="ht-detail-value">${t.cantidadPrendas || 0} ${t.tipoPrenda || 'uds'}</div>
                </div>
                <div class="ht-detail-item">
                    <div class="ht-detail-label"><i class="bi bi-clock"></i> Horas estimadas</div>
                    <div class="ht-detail-value">${t.horasEstimadas}h</div>
                </div>
                <div class="ht-detail-item">
                    <div class="ht-detail-label"><i class="bi bi-flag"></i> Prioridad</div>
                    <div class="ht-detail-value"><span class="ht-badge ht-badge-prio-${t.prioridad}">${t.prioridad}</span></div>
                </div>
                <div class="ht-detail-item">
                    <div class="ht-detail-label"><i class="bi bi-calendar-event"></i> Fecha inicio</div>
                    <div class="ht-detail-value">${t.fechaInicio || '—'}</div>
                </div>
                <div class="ht-detail-item">
                    <div class="ht-detail-label"><i class="bi bi-calendar-check"></i> Fin estimado</div>
                    <div class="ht-detail-value">${fechaFinStr}</div>
                </div>
                <div class="ht-detail-item">
                    <div class="ht-detail-label"><i class="bi bi-info-circle"></i> Estado</div>
                    <div class="ht-detail-value">${t.estado}</div>
                </div>
                <div class="ht-detail-item">
                    <div class="ht-detail-label"><i class="bi bi-calendar3"></i> Días estimados</div>
                    <div class="ht-detail-value">${diasEst != null ? diasEst + ' día' + (diasEst !== 1 ? 's' : '') : '—'}</div>
                </div>
            </div>
        `;

        const btnAccion = document.getElementById('dtlBtnAction');
        btnAccion.disabled = false;
        if (t.estado === 'Pendiente') {
            btnAccion.innerHTML = '<i class="bi bi-play-fill me-1"></i>Iniciar tarea';
            btnAccion.onclick = () => {
                bootstrap.Modal.getInstance(document.getElementById('taskDetailModal')).hide();
                setTimeout(() => abrirModalIniciar(t), 200);
            };
        } else if (t.estado === 'En Progreso') {
            btnAccion.innerHTML = '<i class="bi bi-check-lg me-1"></i>Finalizar tarea';
            btnAccion.onclick = () => {
                bootstrap.Modal.getInstance(document.getElementById('taskDetailModal')).hide();
                setTimeout(() => abrirModalFinalizar(t), 200);
            };
        } else {
            btnAccion.innerHTML = '<i class="bi bi-check-circle me-1"></i>Completada';
            btnAccion.disabled = true;
        }

        bootstrap.Modal.getOrCreateInstance(document.getElementById('taskDetailModal')).show();
    }

    // ═══════════════════════════════════════════════════════════
    // 7. MÓDULO DE INCIDENCIAS
    // ═══════════════════════════════════════════════════════════

    async function cargarHistorialReportes() {
        try {
            const res = await fetch(ENDPOINTS.historialReportes);
            if (!res.ok) throw new Error('Error cargando reportes');
            const data = await res.json();
            const reportes = data.reportes || [];
            reportes.forEach(rep => { cacheIncidencias[rep.idIncidencia] = rep; });
            listaReportes = reportes;
            actualizarKpiIncidencias(reportes);
            renderizarNotificaciones(reportes);
            renderizarIncidencias();
        } catch (err) {
            console.error(err);
        }
    }

    function actualizarKpiIncidencias(reportes) {
        const kpiEl = document.getElementById('kpiCountIncidence');
        if (kpiEl) kpiEl.textContent = reportes.length;
        ['reportesBadgeCount', 'drawerReportesBadge'].forEach(id => {
            const b = document.getElementById(id);
            if (b) b.textContent = reportes.length;
        });
    }

    function renderizarNotificaciones(reportes) {
        const badge     = document.getElementById('navNotifBadge');
        const container = document.getElementById('navNotifContainer');
        if (!container) return;

        const noLeidas = reportes.filter(r => r.respuesta && !r.respuestaLeida);

        if (badge) badge.textContent = noLeidas.length;

        if (noLeidas.length === 0) {
            container.innerHTML = `<div class="ht-empty-state">
                <i class="bi bi-bell-slash"></i>
                <span>Sin notificaciones nuevas</span>
            </div>`;
            return;
        }

        container.innerHTML = noLeidas.map(rep => `
            <button type="button" class="ht-notif-item" data-id="${rep.idIncidencia}"
                    style="all:unset;display:block;width:100%;cursor:pointer;padding:.6rem .8rem;border-bottom:1px solid var(--border, #eee);">
                <div style="font-weight:600;font-size:.85rem;color:var(--primary-dark, #1A2F3B);">
                    <i class="bi bi-reply-fill me-1"></i>El administrador respondió tu incidencia
                </div>
                <div style="font-size:.78rem;color:var(--text-muted,#888);margin-top:2px;">
                    "${rep.tipoIncidencia}" · #${String(rep.idIncidencia).padStart(4, '0')}
                </div>
            </button>`).join('');

        container.querySelectorAll('.ht-notif-item').forEach(btn => {
            btn.addEventListener('click', () => {
                document.activeElement?.blur();
                abrirDetalleIncidencia(btn.dataset.id);
            });
        });
    }

    async function abrirDetalleIncidencia(idIncidencia) {
        const rep = cacheIncidencias[idIncidencia];
        if (!rep) return;

        document.getElementById('detalleIncTipo').textContent = rep.tipoIncidencia;
        document.getElementById('detalleIncEstado').innerHTML =
            `<span class="ht-badge-status-${rep.estado}">${rep.estado}</span>`;
        document.getElementById('detalleIncFecha').textContent = rep.fechaGeneracion || rep.fechaReporte || '—';
        document.getElementById('detalleIncDescripcion').textContent = rep.descripcion;

        const respuestaWrap = document.getElementById('detalleIncRespuestaWrap');
        if (rep.respuesta) {
            respuestaWrap.style.display = '';
            document.getElementById('detalleIncRespuesta').textContent = rep.respuesta;
        } else {
            respuestaWrap.style.display = 'none';
        }

        bootstrap.Modal.getOrCreateInstance(document.getElementById('modalDetalleIncidencia')).show();

        if (rep.respuesta && !rep.respuestaLeida) {
            try {
                await fetch(ENDPOINTS.marcarRespuestaLeida(idIncidencia), {
                    method: 'POST',
                    headers: { 'X-CSRFToken': csrfToken() },
                });
                rep.respuestaLeida = true;
                await cargarHistorialReportes();
            } catch (err) {
                console.error(err);
            }
        }
    }

    const ESTADOS_INC = {
        Pendiente: { icono: 'bi-hourglass-split', ayuda: 'Esperando revisión del administrador' },
        Generado:  { icono: 'bi-send-check',      ayuda: 'Enviada al administrador' },
        Revisado:  { icono: 'bi-check2-circle',   ayuda: 'El administrador ya la revisó' },
    };

    function esRespuestaNueva(r) { return !!(r.respuesta && !r.respuestaLeida); }

    function renderizarResumenIncidencias(todas) {
        const cont = document.getElementById('incResumen');
        if (!cont) return;

        const chips = [
            { clave: 'todos',  texto: 'Todas',               n: todas.length, extra: '' },
            { clave: 'nuevas', texto: 'Respuesta nueva',     n: todas.filter(esRespuestaNueva).length, extra: ' ht-hist-chip--new' },
        ];
        Object.keys(ESTADOS_INC).forEach(est => {
            const n = todas.filter(r => r.estado === est).length;
            if (n > 0) chips.push({ clave: est, texto: est, n, extra: '' });
        });

        cont.innerHTML = chips.map(c => `
            <button type="button" class="ht-hist-chip${c.extra}${incFiltro.estado === c.clave ? ' is-active' : ''}"
                    data-filtro="${esc(c.clave)}" aria-pressed="${incFiltro.estado === c.clave}"
                    ${ESTADOS_INC[c.clave] ? `title="${esc(ESTADOS_INC[c.clave].ayuda)}"` : ''}>
                <span>${esc(c.texto)}</span><span class="ht-hist-chip__n">${c.n}</span>
            </button>`).join('');
    }

    function tarjetaIncidencia(r) {
        const info  = ESTADOS_INC[r.estado] || { icono: 'bi-circle', ayuda: '' };
        const nueva = esRespuestaNueva(r);

        const respuesta = r.respuesta
            ? `<span class="ht-hist-reply ${nueva ? 'ht-hist-reply--new' : 'ht-hist-reply--read'}">
                   <i class="bi bi-reply-fill"></i>${nueva ? 'Nueva respuesta del administrador' : 'Respondida por el administrador'}
               </span>`
            : `<span class="ht-hist-reply ht-hist-reply--none"><i class="bi bi-hourglass-split"></i>Sin respuesta todavía</span>`;

        const severidad = r.severidad
            ? `<span class="ht-hist-meta"><i class="bi bi-speedometer2"></i>Severidad ${esc(r.severidad)}</span>` : '';

        return `
            <article class="ht-hist-card" data-id="${esc(r.idIncidencia)}" data-estado="${esc(r.estado)}">
                <div class="ht-hist-card__top">
                    <span class="ht-hist-id">#${pad4(r.idIncidencia)}</span>
                    <span class="ht-hist-type"><i class="bi bi-exclamation-triangle-fill"></i>${esc(r.tipoIncidencia)}</span>
                    <span class="ht-badge-status-${esc(r.estado)}" title="${esc(info.ayuda)}"><i class="bi ${info.icono} me-1"></i>${esc(r.estado)}</span>
                    <span class="ht-hist-date"><i class="bi bi-calendar-event"></i>${esc(r.fechaGeneracion || 'Reciente')}</span>
                </div>
                <p class="ht-hist-card__desc">${esc(r.descripcion)}</p>
                <div class="ht-hist-card__meta">${severidad}</div>
                ${respuesta}
                <div class="ht-hist-card__actions">
                    <button type="button" class="ht-hist-btn ht-hist-btn--ver" data-action="ver" aria-label="Ver detalle de la incidencia ${pad4(r.idIncidencia)}">
                        <i class="bi bi-eye"></i><span>Ver detalle</span>
                    </button>
                    <button type="button" class="ht-hist-btn ht-hist-btn--pdf" data-action="pdf" title="Descargar PDF" aria-label="Descargar PDF de la incidencia ${pad4(r.idIncidencia)}">
                        <i class="bi bi-file-earmark-pdf-fill"></i><span>PDF</span>
                    </button>
                    <button type="button" class="ht-hist-btn ht-hist-btn--edit" data-action="editar" title="Editar" aria-label="Editar la incidencia ${pad4(r.idIncidencia)}">
                        <i class="bi bi-pencil"></i><span>Editar</span>
                    </button>
                    <button type="button" class="ht-hist-btn ht-hist-btn--delete" data-action="eliminar" title="Eliminar" aria-label="Eliminar la incidencia ${pad4(r.idIncidencia)}">
                        <i class="bi bi-trash"></i><span>Eliminar</span>
                    </button>
                </div>
            </article>`;
    }

    function renderizarIncidencias() {
        const lista = document.getElementById('listaIncidencias');
        if (!lista) return;

        const todas = [...listaReportes].sort((a, b) => Number(b.idIncidencia) - Number(a.idIncidencia));
        renderizarResumenIncidencias(todas);

        const q = incFiltro.q.trim().toLowerCase();
        const filtradas = todas.filter(r => {
            const okEstado = incFiltro.estado === 'todos'
                ? true
                : incFiltro.estado === 'nuevas' ? esRespuestaNueva(r) : r.estado === incFiltro.estado;
            if (!okEstado) return false;
            if (!q) return true;
            return [r.idIncidencia, pad4(r.idIncidencia), r.tipoIncidencia, r.descripcion, r.estado, r.respuesta]
                .join(' ').toLowerCase().includes(q);
        });

        const contador = document.getElementById('incContador');
        if (contador) {
            contador.textContent = todas.length
                ? `Mostrando ${filtradas.length} de ${todas.length} incidencia${todas.length !== 1 ? 's' : ''}`
                : '';
        }

        if (todas.length === 0) {
            lista.innerHTML = `
                <div class="ht-hist-empty">
                    <i class="bi bi-clipboard-check"></i>
                    <strong>Aún no has reportado incidencias</strong>
                    <span>Cuando algo falle en tu puesto, repórtalo y aparecerá aquí.</span>
                    <button type="button" class="btn-link-ht mt-1" data-action="crear">Reportar una incidencia</button>
                </div>`;
            return;
        }
        if (filtradas.length === 0) {
            lista.innerHTML = `
                <div class="ht-hist-empty">
                    <i class="bi bi-search"></i>
                    <strong>Sin resultados</strong>
                    <span>Ninguna incidencia coincide con tu búsqueda o filtro.</span>
                    <button type="button" class="btn-link-ht mt-1" data-action="limpiar">Limpiar filtros</button>
                </div>`;
            return;
        }
        lista.innerHTML = filtradas.map(tarjetaIncidencia).join('');
    }

    function abrirModalIncidencia(incidencia = null, tareaAsociada = null, textoBase = null) {
        const eyebrow    = document.getElementById('reportModalEyebrow');
        const titulo     = document.getElementById('reportModalLabel');
        const editIdEl   = document.getElementById('reportEditId');
        const tipoEl     = document.getElementById('reportTipo');
        const descEl     = document.getElementById('reportDesc');
        const btnLabel   = document.getElementById('btnSaveReportLabel');
        const refEl      = document.getElementById('reportTareaRef');
        const refName    = document.getElementById('reportTareaName');

        if (incidencia) {
            eyebrow.textContent  = `Edición #${String(incidencia.idIncidencia).padStart(4, '0')}`;
            titulo.textContent   = 'Editar Incidencia';
            btnLabel.textContent = 'Guardar cambios';
            editIdEl.value       = incidencia.idIncidencia;
            tipoEl.value         = incidencia.tipoIncidencia || '';
            descEl.value         = incidencia.descripcion || '';
            refEl.style.display  = 'none';
        } else {
            eyebrow.textContent  = 'Nueva Incidencia';
            titulo.textContent   = 'Generar Reporte';
            btnLabel.textContent = 'Enviar reporte';
            editIdEl.value       = '';
            tipoEl.value         = '';
            descEl.value         = textoBase
                ? `${textoBase} (durante la tarea: ${tareaAsociada?.nombreTarea || ''})`
                : tareaAsociada
                    ? `Incidencia durante la tarea: ${tareaAsociada.nombreTarea}. `
                    : '';
            if (tareaAsociada) {
                refEl.style.display = '';
                refName.textContent = tareaAsociada.nombreTarea;
            } else {
                refEl.style.display = 'none';
            }
        }

        document.getElementById('descCount').textContent   = descEl.value.length;
        document.getElementById('err-tipo').textContent    = '';
        document.getElementById('err-desc').textContent    = '';

        bootstrap.Modal.getOrCreateInstance(document.getElementById('reportModal')).show();
    }

    function configurarFormularioIncidencia() {
        const descEl = document.getElementById('reportDesc');
        if (descEl) {
            descEl.addEventListener('input', () => {
                document.getElementById('descCount').textContent = descEl.value.length;
            });
        }

        const btnSave = document.getElementById('btnSaveReport');
        if (btnSave) {
            btnSave.addEventListener('click', async () => {
                const editId      = document.getElementById('reportEditId').value;
                const tipo        = document.getElementById('reportTipo').value.trim();
                const descripcion = document.getElementById('reportDesc').value.trim();
                const severidad   = document.getElementById('reportSeveridad')?.value || 'Media';

                let valido = true;
                document.getElementById('err-tipo').textContent = '';
                document.getElementById('err-desc').textContent = '';

                if (!tipo) {
                    document.getElementById('err-tipo').textContent = 'Selecciona un tipo de incidencia.';
                    valido = false;
                }
                if (descripcion.length < 10) {
                    document.getElementById('err-desc').textContent = 'La descripción debe tener al menos 10 caracteres.';
                    valido = false;
                }
                if (!valido) return;

                const endpoint = editId
                    ? ENDPOINTS.editarReporte(editId)
                    : ENDPOINTS.guardarReporte;

                try {
                    const res = await fetch(endpoint, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRFToken': csrfToken(),
                        },
                        body: JSON.stringify({ tipoIncidencia: tipo, descripcion, severidad }),
                    });
                    if (!res.ok) {
                        const err = await res.json();
                        throw new Error(err.error || 'Error al guardar');
                    }
                    mostrarToast(
                        editId ? '✓ Incidencia actualizada' : '✓ Incidencia registrada — descargando PDF…',
                        'ok'
                    );
                    bootstrap.Modal.getInstance(document.getElementById('reportModal')).hide();
                    await cargarHistorialReportes();

                    if (!editId) {
                        const data = await res.json();
                        if (data.idIncidencia) descargarPDF(data.idIncidencia);
                    }
                } catch (err) {
                    console.error(err);
                    mostrarToast(`❌ ${err.message}`, 'err');
                }
            });
        }
    }

    function configurarModalEliminar() {
        const btn = document.getElementById('btnConfirmDelete');
        if (!btn) return;
        btn.addEventListener('click', async () => {
            if (!pendingDeleteId) return;
            try {
                btn.disabled = true;
                const res = await fetch(ENDPOINTS.eliminarReporte(pendingDeleteId), {
                    method: 'POST',
                    headers: { 'X-CSRFToken': csrfToken() },
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Error al eliminar');
                bootstrap.Modal.getInstance(document.getElementById('deleteModal')).hide();
                await cargarHistorialReportes();
                mostrarToast('🗑️ Incidencia eliminada', 'ok');
            } catch (err) {
                console.error(err);
                mostrarToast(`❌ ${err.message}`, 'err');
            } finally {
                btn.disabled = false;
                pendingDeleteId = null;
            }
        });
    }

    function configurarListaIncidencias() {
        const input = document.getElementById('searchIncidenceModal');
        input?.addEventListener('input', () => { incFiltro.q = input.value; renderizarIncidencias(); });

        document.getElementById('incResumen')?.addEventListener('click', (e) => {
            const chip = e.target.closest('[data-filtro]');
            if (!chip) return;
            incFiltro.estado = chip.dataset.filtro;
            renderizarIncidencias();
        });

        const lista = document.getElementById('listaIncidencias');
        lista?.addEventListener('click', (e) => {
            const btn  = e.target.closest('[data-action]');
            const card = e.target.closest('.ht-hist-card');
            const id   = card?.dataset.id;
            const modalGestion = () => bootstrap.Modal.getInstance(document.getElementById('modalGestionIncidencias'));

            // Clic en la tarjeta (fuera de un botón) = ver detalle
            const accion = btn ? btn.dataset.action : (card ? 'ver' : null);
            if (!accion) return;

            if (accion === 'limpiar') {
                incFiltro.q = ''; incFiltro.estado = 'todos';
                if (input) input.value = '';
                renderizarIncidencias();
            } else if (accion === 'crear') {
                modalGestion()?.hide();
                setTimeout(() => abrirModalIncidencia(), 300);
            } else if (accion === 'ver' && id) {
                modalGestion()?.hide();
                setTimeout(() => abrirDetalleIncidencia(id), 200);
            } else if (accion === 'editar' && id) {
                const inc = cacheIncidencias[id];
                if (!inc) return;
                modalGestion()?.hide();
                setTimeout(() => abrirModalIncidencia(inc), 200);
            } else if (accion === 'eliminar' && id) {
                pendingDeleteId = id;
                bootstrap.Modal.getOrCreateInstance(document.getElementById('deleteModal')).show();
            } else if (accion === 'pdf' && id) {
                descargarPDF(id);
            }
        });
    }

    // ═══════════════════════════════════════════════════════════
    // 8. BOTONES EXTERIORES Y NAVEGACIÓN
    // ═══════════════════════════════════════════════════════════

    function configurarBotonesExteriores() {
        document.getElementById('btnGenerateReport')
            ?.addEventListener('click', () => abrirModalIncidencia());

        document.getElementById('btnVerIncidenciasGeneradas')
            ?.addEventListener('click', () => {
                document.activeElement?.blur();
                setTimeout(() => {
                    bootstrap.Modal.getOrCreateInstance(
                        document.getElementById('modalGestionIncidencias')
                    ).show();
                }, 150);
            });

        document.getElementById('btnCreateIncidenceFromModule')
            ?.addEventListener('click', () => {
                bootstrap.Modal.getInstance(
                    document.getElementById('modalGestionIncidencias')
                ).hide();
                setTimeout(() => abrirModalIncidencia(), 300);
            });
    }

    // Gira la flecha de los desplegables mientras la lista está abierta.
    // Un <select> nativo no avisa si está abierto, así que se deduce de los eventos.
    function configurarSelectsAnimados() {
        document.querySelectorAll('.ht-select-wrap select').forEach(sel => {
            const wrap   = sel.closest('.ht-select-wrap');
            const cerrar = () => wrap.classList.remove('is-open');

            sel.addEventListener('mousedown', () => wrap.classList.toggle('is-open'));
            sel.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' || e.key === 'Tab') return cerrar();
                if (e.key === 'Enter' || e.key === ' ' || (e.altKey && e.key === 'ArrowDown')) {
                    wrap.classList.toggle('is-open');
                }
            });
            sel.addEventListener('change', cerrar);
            sel.addEventListener('blur', cerrar);
        });
    }

    // ═══════════════════════════════════════════════════════════
    // 9. FILTROS Y BÚSQUEDA
    // ═══════════════════════════════════════════════════════════

    function configurarBuscadorYFiltros() {
        document.getElementById('searchInput')
            ?.addEventListener('input', aplicarFiltros);
        document.getElementById('filterPrio')
            ?.addEventListener('change', aplicarFiltros);
        document.getElementById('filterProcess')
            ?.addEventListener('change', aplicarFiltros);
    }

    function aplicarFiltros() {
        const texto  = (document.getElementById('searchInput')?.value || '').toLowerCase();
        const prio   = document.getElementById('filterPrio')?.value || '';
        const proc   = document.getElementById('filterProcess')?.value || '';

        document.querySelectorAll('.ht-card').forEach(card => {
            const id     = card.getAttribute('data-id-asignacion');
            const t      = cacheTareas[id];
            if (!t) return;

            const matchTexto = !texto || (t.nombreTarea || '').toLowerCase().includes(texto) || (t.proceso || '').toLowerCase().includes(texto);
            const matchPrio  = !prio  || t.prioridad === prio;
            const matchProc  = !proc  || t.proceso   === proc;

            card.style.display = (matchTexto && matchPrio && matchProc) ? '' : 'none';
        });

        actualizarEmptyStates();
    }

    // ═══════════════════════════════════════════════════════════
    // 10. HISTORIAL DE TAREAS COMPLETADAS
    // ═══════════════════════════════════════════════════════════

    function actualizarBadgeHistorial(tareas) {
        const n = tareas.filter(t => t.estado === 'Completada').length;
        ['historialBadgeCount', 'drawerHistorialBadge'].forEach(id => {
            const b = document.getElementById(id);
            if (b) b.textContent = n;
        });
    }

    function tareasCompletadas() {
        return Object.values(cacheTareas)
            .filter(t => t.estado === 'Completada')
            .sort(masReciente);
    }

    function renderizarResumenHistorial(todas) {
        const cont = document.getElementById('histResumen');
        if (!cont) return;

        const horas  = todas.reduce((s, t) => s + (num(t.horasReales) || 0), 0);
        const piezas = todas.reduce((s, t) => s + (num(t.cantidadPrendas) || 0), 0);
        const medibles = todas.filter(t => num(t.horasReales) !== null && num(t.horasEstimadas) !== null);
        const aTiempo  = medibles.filter(t => num(t.horasReales) <= num(t.horasEstimadas)).length;

        const stat = (n, l) => `<div class="ht-hist-stat"><span class="ht-hist-stat__n">${n}</span><span class="ht-hist-stat__l">${l}</span></div>`;
        cont.innerHTML =
            stat(todas.length, 'Tareas completadas') +
            stat(`${fmtH(horas)} h`, 'Horas trabajadas') +
            stat(piezas, 'Prendas procesadas') +
            stat(medibles.length ? `${aTiempo} de ${medibles.length}` : '—', 'Dentro del tiempo estimado');
    }

    function poblarFiltroProceso(todas) {
        const sel = document.getElementById('histFiltroProceso');
        if (!sel) return;
        const procesos = [...new Set(todas.map(t => t.proceso).filter(Boolean))].sort();
        sel.innerHTML = '<option value="">Todos los procesos</option>' +
            procesos.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
        sel.value = procesos.includes(histFiltro.proceso) ? histFiltro.proceso : '';
        histFiltro.proceso = sel.value;
    }

    function tarjetaHistorial(t) {
        const real = num(t.horasReales);
        const est  = num(t.horasEstimadas);

        let tiempo = '';
        if (real !== null) {
            let delta = '';
            if (est !== null) {
                const d = real - est;
                if (Math.abs(d) < 0.05)  delta = '<span class="ht-hist-delta ht-hist-delta--ok">Justo en el tiempo</span>';
                else if (d < 0)          delta = `<span class="ht-hist-delta ht-hist-delta--ok">${fmtH(-d)} h menos de lo estimado</span>`;
                else                     delta = `<span class="ht-hist-delta ht-hist-delta--warn">${fmtH(d)} h más de lo estimado</span>`;
            }
            tiempo = `<span class="ht-hist-time"><i class="bi bi-stopwatch-fill"></i>
                Real ${fmtH(real)} h${est !== null ? ` · Estimado ${fmtH(est)} h` : ''} ${delta}</span>`;
        }

        const cantidad = t.cantidadPrendas
            ? `<span class="ht-hist-meta"><i class="bi bi-boxes"></i>${esc(t.cantidadPrendas)} ${esc(t.tipoPrenda || 'uds')}</span>` : '';
        const maquina = t.maquina
            ? `<span class="ht-hist-meta"><i class="bi bi-cpu"></i>${esc(t.maquina)}</span>` : '';
        const inicio = t.fechaInicio
            ? `<span class="ht-hist-meta"><i class="bi bi-play-circle"></i>Inició ${esc(t.fechaInicio)}</span>` : '';

        return `
            <article class="ht-hist-card" data-id="${esc(t.idAsignacion)}" data-estado="Completada">
                <div class="ht-hist-card__top">
                    <span class="ht-hist-type ht-hist-type--task"><i class="bi bi-gear-fill"></i>${esc(t.proceso || 'General')}</span>
                    ${t.prioridad ? `<span class="ht-badge ht-badge-prio-${esc(t.prioridad)}">${esc(t.prioridad)}</span>` : ''}
                    <span class="ht-hist-date"><i class="bi bi-calendar-check"></i>Finalizada ${esc(t.fechaFinalizacion || '—')}</span>
                </div>
                <h6 class="ht-hist-card__title">${esc(t.nombreTarea || 'Tarea sin título')}</h6>
                ${t.descripcionTarea ? `<p class="ht-hist-card__desc">${esc(t.descripcionTarea)}</p>` : ''}
                <div class="ht-hist-card__meta">${maquina}${cantidad}${inicio}</div>
                ${tiempo}
                <div class="ht-hist-card__actions">
                    <button type="button" class="ht-hist-btn ht-hist-btn--ver" data-action="ver" aria-label="Ver detalle de ${esc(t.nombreTarea || 'la tarea')}">
                        <i class="bi bi-eye"></i><span>Ver detalle</span>
                    </button>
                </div>
            </article>`;
    }

    function renderizarHistorialTareas() {
        const lista = document.getElementById('listaHistorial');
        if (!lista) return;

        const todas = tareasCompletadas();
        renderizarResumenHistorial(todas);

        const q = histFiltro.q.trim().toLowerCase();
        const filtradas = todas.filter(t => {
            if (histFiltro.proceso && t.proceso !== histFiltro.proceso) return false;
            if (!q) return true;
            return [t.nombreTarea, t.proceso, t.maquina, t.tipoPrenda, t.descripcionTarea, t.fechaFinalizacion]
                .join(' ').toLowerCase().includes(q);
        });

        const contador = document.getElementById('histContador');
        if (contador) {
            contador.textContent = todas.length
                ? `Mostrando ${filtradas.length} de ${todas.length} tarea${todas.length !== 1 ? 's' : ''}`
                : '';
        }

        if (todas.length === 0) {
            lista.innerHTML = `
                <div class="ht-hist-empty">
                    <i class="bi bi-trophy"></i>
                    <strong>Todavía no completaste tareas</strong>
                    <span>Cuando finalices una, quedará archivada aquí con su tiempo real.</span>
                </div>`;
            return;
        }
        if (filtradas.length === 0) {
            lista.innerHTML = `
                <div class="ht-hist-empty">
                    <i class="bi bi-search"></i>
                    <strong>Sin resultados</strong>
                    <span>Ninguna tarea coincide con tu búsqueda o filtro.</span>
                    <button type="button" class="btn-link-ht mt-1" data-action="limpiar">Limpiar filtros</button>
                </div>`;
            return;
        }
        lista.innerHTML = filtradas.map(tarjetaHistorial).join('');
    }

    function abrirHistorialTareas() {
        poblarFiltroProceso(tareasCompletadas());
        renderizarHistorialTareas();
        bootstrap.Modal.getOrCreateInstance(document.getElementById('modalHistorialTareas')).show();
    }

    function configurarHistorialTareas() {
        document.getElementById('btnVerHistorial')?.addEventListener('click', abrirHistorialTareas);
        document.getElementById('linkVerHistorialDesdeColumna')?.addEventListener('click', abrirHistorialTareas);
        document.getElementById('linkVerHistorialDesdeNota')?.addEventListener('click', abrirHistorialTareas);

        const buscador = document.getElementById('searchHistorialModal');
        buscador?.addEventListener('input', () => { histFiltro.q = buscador.value; renderizarHistorialTareas(); });

        const selProceso = document.getElementById('histFiltroProceso');
        selProceso?.addEventListener('change', () => { histFiltro.proceso = selProceso.value; renderizarHistorialTareas(); });

        document.getElementById('listaHistorial')?.addEventListener('click', (e) => {
            const btn  = e.target.closest('[data-action]');
            const card = e.target.closest('.ht-hist-card');

            if (btn?.dataset.action === 'limpiar') {
                histFiltro.q = ''; histFiltro.proceso = '';
                if (buscador) buscador.value = '';
                if (selProceso) selProceso.value = '';
                renderizarHistorialTareas();
                return;
            }
            if (!card) return;
            const t = cacheTareas[card.dataset.id];
            if (!t) return;
            bootstrap.Modal.getInstance(document.getElementById('modalHistorialTareas'))?.hide();
            setTimeout(() => abrirDetalleTarea(t), 200);
        });
    }

    // ═══════════════════════════════════════════════════════════
    // 11. COLAPSAR COLUMNA COMPLETADAS
    // ═══════════════════════════════════════════════════════════

    function configurarColapsarColumnaCompletada() {
        const header = document.getElementById('headerCompletada');
        if (!header) return;
        header.addEventListener('click', () => {
            const col = document.getElementById('col-Completada');
            col?.classList.toggle('collapsed');
        });
    }

    // ═══════════════════════════════════════════════════════════
    // 12. KPIs NAVBAR Y CONTADORES
    // ═══════════════════════════════════════════════════════════

    function actualizarContadores(tareas) {
        const counts = { 'Pendiente': 0, 'En Progreso': 0, 'Completada': 0 };
        tareas.forEach(t => { if (counts[t.estado] !== undefined) counts[t.estado]++; });

        const countCompletadaEl = document.getElementById('count-Completada');
        if (countCompletadaEl) countCompletadaEl.textContent = Math.min(counts['Completada'], 1);

        ['Pendiente', 'En Progreso'].forEach(e => {
            const el = document.getElementById(`count-${e}`);
            if (el) el.textContent = counts[e];
        });

        const kp = document.getElementById('kpiCountPending');
        const kq = document.getElementById('kpiCountProgress');
        const kd = document.getElementById('kpiCountDone');
        if (kp) kp.textContent = counts['Pendiente'];
        if (kq) kq.textContent = counts['En Progreso'];
        if (kd) kd.textContent = counts['Completada'];

        const mp = document.getElementById('mobCountPending');
        const mq = document.getElementById('mobCountProgress');
        const md = document.getElementById('mobCountDone');
        if (mp) mp.textContent = counts['Pendiente'];
        if (mq) mq.textContent = counts['En Progreso'];
        if (md) md.textContent = counts['Completada'];
    }

    function configurarKpisNavbar() {
        // Pendientes / En Proceso: llevan a su columna (y activan la pestaña en móvil)
        const irA = (estado) => () => {
            const tab = document.querySelector(`.ht-mobile-tab[data-tab="${estado}"]`);
            if (tab && tab.offsetParent !== null) tab.click();
            document.getElementById(`col-${estado}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        };
        document.getElementById('kpiPending')?.addEventListener('click', irA('Pendiente'));
        document.getElementById('kpiProgress')?.addEventListener('click', irA('En Progreso'));

        // Completadas e Incidencias: abren su historial
        document.getElementById('kpiDone')?.addEventListener('click', abrirHistorialTareas);
        document.getElementById('kpiIncidence')
            ?.addEventListener('click', () => {
                bootstrap.Modal.getOrCreateInstance(
                    document.getElementById('modalGestionIncidencias')
                ).show();
            });
    }

    // ── Menú lateral (móvil/tablet) ──────────────────────────
    function configurarMenuLateral() {
        const el = document.getElementById('menuLateral');
        if (!el) return;
        const drawer = bootstrap.Offcanvas.getOrCreateInstance(el);

        const acciones = {
            'nueva-incidencia':      () => abrirModalIncidencia(),
            'historial-incidencias': () => bootstrap.Modal.getOrCreateInstance(document.getElementById('modalGestionIncidencias')).show(),
            'historial-tareas':      () => abrirHistorialTareas(),
        };

        el.querySelectorAll('[data-ht-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                const fn = acciones[btn.dataset.htAction];
                if (!fn) return;
                // Se ejecuta cuando el menú terminó de cerrarse, para no apilar overlays
                el.addEventListener('hidden.bs.offcanvas', fn, { once: true });
                drawer.hide();
            });
        });

        // Si la pantalla pasa a modo escritorio, el menú lateral se cierra solo
        window.matchMedia('(min-width: 992px)').addEventListener('change', e => {
            if (e.matches) drawer.hide();
        });
    }

    // ── Columna Completadas: nota + aviso de archivado ───────
    function actualizarNotaArchivo(totalCompletadas) {
        const nota = document.getElementById('archiveNote');
        if (!nota) return;
        const archivadas = Math.max(0, totalCompletadas - 1);
        nota.hidden = archivadas === 0;
        document.getElementById('archiveNoteCount').textContent = archivadas;
        document.getElementById('archiveNoteTxt').textContent =
            archivadas === 1 ? 'tarea anterior archivada en el historial.'
                             : 'tareas anteriores archivadas en el historial.';
    }

    function mostrarAvisoArchivada(tarea) {
        const wrap = document.getElementById('toastWrap');
        if (!wrap) return;

        const el = document.createElement('div');
        el.className = 'ht-toast ht-toast--archive';
        el.setAttribute('role', 'status');
        el.innerHTML = `
            <i class="bi bi-archive-fill"></i>
            <div class="ht-archive-toast-body">
                <strong>Tarea guardada en el historial</strong>
                <span class="ht-archive-toast-name"></span>
                <button type="button" class="btn-link-ht">Ver historial →</button>
            </div>
            <button type="button" class="ht-archive-toast-close" aria-label="Cerrar"><i class="bi bi-x"></i></button>`;
        el.querySelector('.ht-archive-toast-name').textContent =
            `«${tarea.nombreTarea || 'Tarea'}» salió de Completadas y quedó archivada.`;
        el.querySelector('.btn-link-ht').addEventListener('click', () => { el.remove(); abrirHistorialTareas(); });
        el.querySelector('.ht-archive-toast-close').addEventListener('click', () => el.remove());
        wrap.appendChild(el);
        setTimeout(() => el.remove(), 9000);

        // Destacar un momento la nota de la columna
        const nota = document.getElementById('archiveNote');
        if (nota) {
            nota.classList.remove('flash');
            void nota.offsetWidth;
            nota.classList.add('flash');
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 13. PESTAÑAS MÓVIL
    // ═══════════════════════════════════════════════════════════

    function configurarPestañasMobile() {
        const tabs = document.querySelectorAll('.ht-mobile-tab');
        if (!tabs.length) return;

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const target = tab.dataset.tab;
                document.querySelectorAll('.ht-kanban-col').forEach(col => {
                    col.classList.toggle('active-mobile-col', col.dataset.estado === target);
                });
            });
        });

        tabs[0]?.click();
    }

    // ═══════════════════════════════════════════════════════════
    // 14. EMPTY STATES
    // ═══════════════════════════════════════════════════════════

    function actualizarEmptyStates() {
        ['Pendiente', 'En Progreso', 'Completada'].forEach(estado => {
            const zona    = zonas[estado];
            const emptyEl = document.getElementById(`empty-${estado}`);
            if (!zona || !emptyEl) return;
            const visibles = zona.querySelectorAll('.ht-card:not([style*="display: none"])').length;
            emptyEl.classList.toggle('hidden', visibles > 0);
        });
    }

    // ═══════════════════════════════════════════════════════════
    // 15. TOAST, PDF Y HELPERS
    // ═══════════════════════════════════════════════════════════

    function mostrarToast(mensaje, tipo = 'ok') {
        const wrap = document.getElementById('toastWrap');
        if (!wrap) return;
        const toast = document.createElement('div');
        toast.className = `ht-toast ht-toast-${tipo}`;
        toast.innerHTML = `
            <i class="bi bi-${tipo === 'ok' ? 'check-circle-fill' : 'x-circle-fill'}"></i>
            <span>${mensaje}</span>`;
        wrap.appendChild(toast);
        setTimeout(() => toast.remove(), 3500);
    }

    // ── NUEVO: Bienvenida flotante (una vez por sesión) ──
    function mostrarBienvenida(nombre) {
        const wrap = document.getElementById('toastWrap');
        if (!wrap) return;

        const hora = new Date().getHours();
        const momento = hora < 12 ? 'Buenos días' : hora < 19 ? 'Buenas tardes' : 'Buenas noches';
        const id = 'toast-welcome-' + Date.now();
        const duracion = 5500;

        const el = document.createElement('div');
        el.className = 'ht-toast ht-toast--welcome';
        el.id = id;
        el.setAttribute('role', 'status');
        el.innerHTML = `
            <span class="ht-welcome-wave">👋</span>
            <div class="ht-welcome-body">
                <div class="ht-welcome-title"></div>
                <div class="ht-welcome-msg"></div>
            </div>
            <button type="button" class="ht-welcome-close" aria-label="Cerrar"><i class="bi bi-x"></i></button>
        `;
        el.querySelector('.ht-welcome-title').textContent = '¡Hola, ' + nombre + '!';
        el.querySelector('.ht-welcome-msg').textContent = momento + '. Bienvenido/a a tu tablero operativo.';
        el.querySelector('.ht-welcome-close').addEventListener('click', () => el.remove());

        wrap.appendChild(el);
        requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));

        setTimeout(() => {
            el.classList.remove('show');
            setTimeout(() => el.remove(), 400);
        }, duracion);
    }

    // Exponer global para que el inline script del template la invoque
    window.mostrarBienvenida = mostrarBienvenida;

    function descargarPDF(idIncidencia) {
        const link = document.createElement('a');
        link.href  = ENDPOINTS.pdfReporte(idIncidencia);
        link.setAttribute('download', `HebraTech_Incidencia_${String(idIncidencia).padStart(4, '0')}.pdf`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    function csrfToken() {
        for (const c of document.cookie.split(';')) {
            const pair = c.trim();
            if (pair.startsWith('csrftoken=')) return decodeURIComponent(pair.substring(10));
        }
        return '';
    }

    // ─── Arrancar ────────────────────────────────────────────────
    init();
});