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
    const cacheTareas       = {};   // { idAsignacion: tareaObj }
    const cacheIncidencias  = {};   // { idIncidencia: incObj }
    const timerIntervals    = {};   // { idAsignacion: intervalId }
    const alertedTasks      = new Set();   // idAsignacion ya alertados por <1h restante

    let pendingDeleteId        = null;
    let activeStartTaskId      = null;
    let activeFinishTaskId     = null;

    // ─── SELECTORES ESTÁTICOS ────────────────────────────────────
    const zonas = {
        'Pendiente':   document.getElementById('list-Pendiente'),
        'En Progreso': document.getElementById('list-En Progreso'),
        'Completada':  document.getElementById('list-Completada'),
    };

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
        configurarBusquedaTablaIncidencias();
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
        // Limpiar cache y cronómetros
        Object.keys(cacheTareas).forEach(k => delete cacheTareas[k]);
        Object.keys(timerIntervals).forEach(id => {
            clearInterval(timerIntervals[id]);
            delete timerIntervals[id];
        });

        // Limpiar cards del DOM (conservar empty states)
        ['Pendiente', 'En Progreso', 'Completada'].forEach(estado => {
            const zona = zonas[estado];
            if (zona) zona.querySelectorAll('.ht-card').forEach(c => c.remove());
        });

        tareas.forEach(t => {
            cacheTareas[t.idAsignacion] = t;
            // Las tareas Completadas ya no se muestran en el tablero:
            // quedan archivadas y solo se ven en el modal de Historial.
            if (t.estado === 'Completada') return;
            const card = crearCard(t);
            const zona = zonas[t.estado];
            if (!zona) return;
            const emptyEl = zona.querySelector('.ht-col-empty');
            emptyEl ? zona.insertBefore(card, emptyEl) : zona.appendChild(card);
        });

        actualizarEmptyStates();
        actualizarContadores(tareas);
        actualizarBadgeHistorial(tareas);
        aplicarFiltros();

        const total = document.getElementById('totalTasks');
        if (total) total.textContent = tareas.length;
    }

    // ─── Crear tarjeta de tarea ──────────────────────────────────
    function crearCard(t) {
        const card = document.createElement('div');
        card.className = 'ht-card';
        card.setAttribute('draggable', 'true');
        card.setAttribute('data-id-asignacion', t.idAsignacion);
        card.setAttribute('data-prio', t.prioridad);
        card.setAttribute('data-estado', t.estado);
        card.setAttribute('data-process', t.proceso || '');

        const prioClass  = `ht-badge-prio-${t.prioridad}`;
        const compClass  = `ht-badge-complex-${(t.complejidad || 'media').toLowerCase()}`;

        // Bloque de cronómetro (solo para "En Progreso")
        const timerBlock = t.estado === 'En Progreso'
            ? `<div class="ht-timer-block" id="timerBlock-${t.idAsignacion}">
                   <i class="bi bi-stopwatch-fill"></i>
                   <span class="ht-timer-text" id="timer-${t.idAsignacion}">00:00:00</span>
                   <span class="ht-timer-excess d-none" id="excess-${t.idAsignacion}"></span>
               </div>`
            : '';

        // Botones de acción según estado
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
            </div>
            ${timerBlock}
            ${actionBtns ? `<div class="ht-card-actions">${actionBtns}</div>` : ''}
        `;

        // Eventos drag
        card.addEventListener('dragstart', e => {
            e.dataTransfer.setData('text/plain', String(t.idAsignacion));
            card.classList.add('dragging');
        });
        card.addEventListener('dragend', () => card.classList.remove('dragging'));

        // Eventos click en botones internos
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

        // Iniciar cronómetro si corresponde
        if (t.estado === 'En Progreso') iniciarCronometro(t);

        return card;
    }

    // ═══════════════════════════════════════════════════════════
    // 2. CRONÓMETROS EN TIEMPO REAL
    // ═══════════════════════════════════════════════════════════

    function iniciarCronometro(tarea) {
        const id = tarea.idAsignacion;
        // Usar el timestamp del backend si existe, si no usar Date.now() como referencia parcial
        const inicioMs = tarea.fechaInicioTs || Date.now();
        const limitMs  = (tarea.horasEstimadas || 1) * 3600 * 1000;

        timerIntervals[id] = setInterval(() => {
            const el = document.getElementById(`timer-${id}`);
            if (!el) { clearInterval(timerIntervals[id]); return; }

            const elapsedMs   = Date.now() - inicioMs;
            const remainingMs = limitMs - elapsedMs;
            const excessEl    = document.getElementById(`excess-${id}`);

            if (remainingMs > 3600000) {
                // Más de 1 hora restante: se muestra en horas
                const horasRest = remainingMs / 3600000;
                el.textContent = `${horasRest.toFixed(1)}h restantes`;
                el.classList.remove('ht-timer-critico');
                if (excessEl) excessEl.classList.add('d-none');

            } else if (remainingMs > 0) {
                // Bajo 1 hora: cuenta regresiva minuto a minuto (59, 58, 57…)
                const minRest = Math.floor(remainingMs / 60000);
                const segRest = Math.floor((remainingMs % 60000) / 1000);
                el.textContent = `${minRest}:${String(segRest).padStart(2, '0')} min`;
                el.classList.add('ht-timer-critico');
                if (excessEl) excessEl.classList.add('d-none');

                // Alertar una sola vez al cruzar el umbral de 1 hora restante
                if (!alertedTasks.has(id)) {
                    alertedTasks.add(id);
                    mostrarToast(`⏰ Falta 1 hora para completar "${tarea.nombreTarea}"`, 'err');
                }

            } else {
                // Tiempo excedido
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

    // Mostrar/ocultar Observaciones según el switch de inconvenientes
    const finishSwitch = document.getElementById('finishHasIncidence');
    if (finishSwitch) {
        finishSwitch.addEventListener('change', function () {
            const grupo = document.getElementById('finishNotesGroup');
            grupo.style.display = this.checked ? '' : 'none';
            if (!this.checked) document.getElementById('finishNotes').classList.remove('is-invalid');
        });
    }

    // Listener del botón de confirmar finalización
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

    // ─── Cambiar estado en backend ───────────────────────────────
    async function cambiarEstado(idAsignacion, nuevoEstado) {
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
            await cargarTareas();
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

        const diasEst = Math.ceil((t.horasEstimadas || 0) / 10);
        let fechaFinStr = '—';
        if (t.fechaInicio) {
            const d = new Date(t.fechaInicio);
            d.setDate(d.getDate() + diasEst);
            fechaFinStr = d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
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
                    <div class="ht-detail-value">${diasEst} día${diasEst !== 1 ? 's' : ''}</div>
                </div>
            </div>
        `;

        const btnAccion = document.getElementById('dtlBtnAction');
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
            actualizarKpiIncidencias(reportes);
            renderizarNotificaciones(reportes);
            renderizarTablaIncidencias(reportes);
        } catch (err) {
            console.error(err);
        }
    }

    function actualizarKpiIncidencias(reportes) {
        const kpiEl = document.getElementById('kpiCountIncidence');
        if (kpiEl) kpiEl.textContent = reportes.length;
    }

    // ─── Campana de NOTIFICACIONES (respuestas del admin sin leer) ─
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

    // ─── Modal de detalle de incidencia (con respuesta del admin) ──
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

    // ─── Tabla en modal gestión ──────────────────────────────────
    function renderizarTablaIncidencias(reportes) {
        const tbody = document.getElementById('tableIncidenciasBody');
        if (!tbody) return;

        reportes.forEach(r => { cacheIncidencias[r.idIncidencia] = r; });

        if (reportes.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4" style="color:var(--text-muted);">
                No se han encontrado incidencias.</td></tr>`;
            return;
        }

        tbody.innerHTML = reportes.map(rep => `
            <tr>
                <td><strong>#${String(rep.idIncidencia).padStart(4, '0')}</strong></td>
                <td><span class="ht-badge" style="background:rgba(212,146,58,.15);color:#D4923A;border-color:rgba(212,146,58,.3);">
                    ${rep.tipoIncidencia}</span></td>
                <td style="max-width:280px;">
                    <span class="d-inline-block text-truncate" style="max-width:260px;">
                        ${rep.descripcion}</span></td>
                <td><span class="ht-badge-status-${rep.estado}">${rep.estado}</span></td>
                <td><small style="color:var(--text-muted);">${rep.fechaGeneracion || 'Reciente'}</small></td>
                <td class="text-end">
                    <button class="ht-report-action-btn ht-report-action-btn--ver me-1"
                            data-id="${rep.idIncidencia}" title="Ver detalle completo">
                        <i class="bi bi-eye"></i>
                    </button>
                    <button class="ht-report-action-btn ht-report-action-btn--pdf me-1"
                            data-id="${rep.idIncidencia}" title="Descargar PDF">
                        <i class="bi bi-file-earmark-pdf-fill"></i>
                    </button>
                    <button class="ht-report-action-btn ht-report-action-btn--edit me-1"
                            data-id="${rep.idIncidencia}" title="Editar">
                        <i class="bi bi-pencil"></i>
                    </button>
                    <button class="ht-report-action-btn ht-report-action-btn--delete"
                            data-id="${rep.idIncidencia}" title="Eliminar">
                        <i class="bi bi-trash"></i>
                    </button>
                </td>
            </tr>`).join('');

        tbody.querySelectorAll('.ht-report-action-btn--ver').forEach(btn => {
            btn.addEventListener('click', () => {
                bootstrap.Modal.getInstance(document.getElementById('modalGestionIncidencias'))?.hide();
                setTimeout(() => abrirDetalleIncidencia(btn.dataset.id), 200);
            });
        });

        tbody.querySelectorAll('.ht-report-action-btn--edit').forEach(btn => {
            btn.addEventListener('click', () => {
                const inc = cacheIncidencias[btn.dataset.id];
                if (!inc) return;
                const mgmt = bootstrap.Modal.getInstance(document.getElementById('modalGestionIncidencias'));
                if (mgmt) mgmt.hide();
                setTimeout(() => abrirModalIncidencia(inc), 200);
            });
        });
        tbody.querySelectorAll('.ht-report-action-btn--delete').forEach(btn => {
            btn.addEventListener('click', () => {
                pendingDeleteId = btn.dataset.id;
                bootstrap.Modal.getOrCreateInstance(document.getElementById('deleteModal')).show();
            });
        });
        tbody.querySelectorAll('.ht-report-action-btn--pdf').forEach(btn => {
            btn.addEventListener('click', () => descargarPDF(btn.dataset.id));
        });
    }

    // ─── Abrir modal crear/editar incidencia ─────────────────────
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

    // ─── Formulario de incidencia ────────────────────────────────
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

    // ─── Modal eliminar ──────────────────────────────────────────
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

    // ─── Filtro de búsqueda en tabla de gestión ──────────────────
    function configurarBusquedaTablaIncidencias() {
        const input = document.getElementById('searchIncidenceModal');
        if (!input) return;
        input.addEventListener('input', () => {
            const q = input.value.toLowerCase();
            document.querySelectorAll('#tableIncidenciasBody tr').forEach(tr => {
                tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
            });
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
        const badge = document.getElementById('historialBadgeCount');
        if (!badge) return;
        badge.textContent = tareas.filter(t => t.estado === 'Completada').length;
    }

    function abrirHistorialTareas() {
        const tbody = document.getElementById('tableHistorialBody');
        if (!tbody) return;

        const completadas = Object.values(cacheTareas)
            .filter(t => t.estado === 'Completada')
            .sort((a, b) => (b.fechaFinalizacion || '').localeCompare(a.fechaFinalizacion || ''));

        if (completadas.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4" style="color:var(--text-muted);">
                Todavía no completaste ninguna tarea.</td></tr>`;
        } else {
            tbody.innerHTML = completadas.map(t => `
                <tr>
                    <td><strong>${t.nombreTarea}</strong></td>
                    <td>${t.proceso || '—'}</td>
                    <td>${t.tipoPrenda && t.cantidadPrendas ? `${t.cantidadPrendas} ${t.tipoPrenda}` : '—'}</td>
                    <td>${t.fechaFinalizacion || '—'}</td>
                    <td>${t.horasReales != null ? `${t.horasReales} h` : '—'}</td>
                    <td class="text-end">
                        <button type="button" class="ht-report-action-btn ht-historial-ver-btn"
                                data-id="${t.idAsignacion}" title="Ver tarea completada">
                            <i class="bi bi-eye"></i>
                        </button>
                    </td>
                </tr>`).join('');
        }

        tbody.querySelectorAll('.ht-historial-ver-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const t = cacheTareas[btn.dataset.id];
                if (!t) return;
                bootstrap.Modal.getInstance(document.getElementById('modalHistorialTareas'))?.hide();
                setTimeout(() => abrirDetalleTarea(t), 200);
            });
        });

        bootstrap.Modal.getOrCreateInstance(document.getElementById('modalHistorialTareas')).show();
    }

    function configurarHistorialTareas() {
        document.getElementById('btnVerHistorial')?.addEventListener('click', abrirHistorialTareas);
        document.getElementById('linkVerHistorialDesdeColumna')?.addEventListener('click', abrirHistorialTareas);

        const buscador = document.getElementById('searchHistorialModal');
        buscador?.addEventListener('input', () => {
            const q = buscador.value.toLowerCase();
            document.querySelectorAll('#tableHistorialBody tr').forEach(tr => {
                tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
            });
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
        if (countCompletadaEl) countCompletadaEl.textContent = 0;

        ['Pendiente', 'En Progreso'].forEach(e => {
            const el = document.getElementById(`count-${e}`);
            if (el) el.textContent = counts[e];
        });

        // KPI chips navbar
        const kp = document.getElementById('kpiCountPending');
        const kq = document.getElementById('kpiCountProgress');
        const kd = document.getElementById('kpiCountDone');
        if (kp) kp.textContent = counts['Pendiente'];
        if (kq) kq.textContent = counts['En Progreso'];
        if (kd) kd.textContent = counts['Completada'];

        // Pestañas móvil
        const mp = document.getElementById('mobCountPending');
        const mq = document.getElementById('mobCountProgress');
        const md = document.getElementById('mobCountDone');
        if (mp) mp.textContent = counts['Pendiente'];
        if (mq) mq.textContent = counts['En Progreso'];
        if (md) md.textContent = counts['Completada'];
    }

    function configurarKpisNavbar() {
        const scrollA = (estado) => () => {
            const col = document.getElementById(`col-${estado}`);
            if (col) col.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        };
        document.getElementById('kpiPending')
            ?.addEventListener('click', scrollA('Pendiente'));
        document.getElementById('kpiProgress')
            ?.addEventListener('click', scrollA('En Progreso'));
        document.getElementById('kpiDone')
            ?.addEventListener('click', scrollA('Completada'));
        document.getElementById('kpiIncidence')
            ?.addEventListener('click', () => {
                bootstrap.Modal.getOrCreateInstance(
                    document.getElementById('modalGestionIncidencias')
                ).show();
            });
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