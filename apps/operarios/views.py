# apps/operarios/views.py

import json
from datetime import date, datetime

from django.contrib.auth.hashers import check_password, make_password
from django.http import FileResponse, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from .models import AsignacionTarea, Incidencia, Operario

# ─────────────────────────────────────────────────────────────────
# HELPER: obtener operario de la sesión
# ─────────────────────────────────────────────────────────────────

def _get_operario(request):
    """Devuelve el Operario activo de la sesión o None."""
    usuario_id = request.session.get('usuario_id')
    if not usuario_id:
        return None
    try:
        return Operario.objects.select_related('idUsuario').get(
            idUsuario__idUsuario=usuario_id,
            estado='activo',
        )
    except Operario.DoesNotExist:
        return None


def _json_error(msg, status=400):
    return JsonResponse({'error': msg}, status=status)


# ─────────────────────────────────────────────────────────────────
# 1. TABLERO (render HTML)
# ─────────────────────────────────────────────────────────────────

def tablero_operario(request):
    """Renderiza el tablero Kanban del operario."""
    operario = _get_operario(request)
    if not operario:
        return redirect('login')
    return render(request, 'operarios/operario.html', {'operario': operario})


# ─────────────────────────────────────────────────────────────────
# 2. PERFIL (GET: mostrar / POST: guardar cambios)
# ─────────────────────────────────────────────────────────────────

def perfil_operario(request):
    """Ver y editar el perfil del operario logueado."""
    operario = _get_operario(request)
    if not operario:
        return redirect('login')

    usuario = operario.idUsuario

    if request.method == 'POST':
        usuario.nombre   = request.POST.get('nombre',   usuario.nombre).strip()
        usuario.apellido = request.POST.get('apellido', usuario.apellido).strip()
        usuario.telefono = request.POST.get('telefono', '').strip() or None
        usuario.direccion = request.POST.get('direccion', '').strip() or None

        especialidad = request.POST.get('especialidad', '').strip()
        if especialidad:
            operario.especialidad = especialidad

        if 'fotoPerfil' in request.FILES:
            usuario.fotoPerfil = request.FILES['fotoPerfil']

        pw_actual    = request.POST.get('password_actual', '')
        pw_nueva     = request.POST.get('password_nueva', '')
        pw_confirmar = request.POST.get('password_confirmar', '')

        if pw_actual or pw_nueva or pw_confirmar:
            if not check_password(pw_actual, usuario.contrasena):
                from django.contrib import messages
                messages.error(request, 'La contraseña actual es incorrecta.')
                return render(request, 'operarios/perfil.html', {'operario': operario})

            if pw_nueva != pw_confirmar:
                from django.contrib import messages
                messages.error(request, 'Las contraseñas nuevas no coinciden.')
                return render(request, 'operarios/perfil.html', {'operario': operario})

            if len(pw_nueva) < 6:
                from django.contrib import messages
                messages.error(request, 'La contraseña debe tener al menos 6 caracteres.')
                return render(request, 'operarios/perfil.html', {'operario': operario})

            usuario.contrasena = make_password(pw_nueva)

        usuario.save()
        operario.save()

        from django.contrib import messages
        messages.success(request, 'Perfil actualizado correctamente.')
        return redirect('operarios:perfil')

    return render(request, 'operarios/perfil.html', {'operario': operario})


# ─────────────────────────────────────────────────────────────────
# 3. API — Tareas asignadas al operario
# GET /operarios/api/tareas/
# ─────────────────────────────────────────────────────────────────

def api_tareas(request):
    """
    Devuelve las asignaciones del operario logueado.

    Campos que el JS espera por cada tarea:
        idAsignacion, nombreTarea, descripcionTarea, proceso,
        complejidad, prioridad, estado, horasEstimadas,
        tipoPrenda, cantidadPrendas, maquina,
        fechaInicio, fechaFinalizacion, fechaInicioTs
    """
    operario = _get_operario(request)
    if not operario:
        return _json_error('No autenticado', 401)

    asignaciones = (
        AsignacionTarea.objects
        .select_related('idTarea')
        .filter(idOperario=operario)
        .exclude(estado='Cancelada')
        .order_by('prioridad', 'fechaInicio')
    )

    tareas = []
    for a in asignaciones:
        tarea = a.idTarea

        fecha_inicio_ts = None
        if a.estado == 'En Progreso' and a.fechaInicio:
            try:
                dt = datetime.combine(a.fechaInicio, datetime.min.time())
                fecha_inicio_ts = int(dt.timestamp() * 1000)
            except Exception:
                fecha_inicio_ts = None

        tareas.append({
            'idAsignacion':    a.idAsignacion,
            'nombreTarea':     tarea.nombreTarea,
            'descripcionTarea': tarea.descripcionTarea or '',
            'proceso':         tarea.proceso or 'General',
            'complejidad':     tarea.complejidad or 'media',
            'prioridad':       a.prioridad or 'Media',
            'estado':          a.estado,
            'horasEstimadas':  float(a.horasEstimadas or 0),
            'tipoPrenda':      a.tipoPrenda or '',
            'cantidadPrendas': a.cantidadPrendas or 0,
            'maquina':         tarea.proceso or 'Planta General',
            'fechaInicio':     str(a.fechaInicio) if a.fechaInicio else None,
            'fechaFinalizacion': str(a.fechaFinalizacion) if a.fechaFinalizacion else None,
            'fechaInicioTs':   fecha_inicio_ts,
        })

    return JsonResponse({'tareas': tareas})


# ─────────────────────────────────────────────────────────────────
# 4. API — Cambiar estado de una asignación
# POST /operarios/api/tarea/<id>/estado/
# ─────────────────────────────────────────────────────────────────

@require_http_methods(['POST'])
def api_actualizar_estado(request, id_asignacion):
    """Cambia el estado (Pendiente → En Progreso → Completada)."""
    operario = _get_operario(request)
    if not operario:
        return _json_error('No autenticado', 401)

    asignacion = get_object_or_404(
        AsignacionTarea,
        idAsignacion=id_asignacion,
        idOperario=operario,
    )

    try:
        body = json.loads(request.body)
        nuevo_estado = body.get('estado', '').strip()
    except (json.JSONDecodeError, AttributeError):
        return _json_error('JSON inválido')

    estados_validos = {'Pendiente', 'En Progreso', 'Completada'}
    if nuevo_estado not in estados_validos:
        return _json_error(f'Estado inválido: {nuevo_estado}')

    asignacion.estado = nuevo_estado

    if nuevo_estado == 'Completada':
        asignacion.fechaFinalizacion = date.today()
    elif nuevo_estado == 'Pendiente':
        asignacion.fechaFinalizacion = None

    asignacion.save()

    # ── Conexión con Producción: si esta tarea pertenece a un lote de
    # producción (Tarea.idProduccion), recalculamos el avance de esa
    # Produccion y dejamos que dispare sus propias transiciones FSM
    # (iniciar()/completar()), que a su vez sincronizan el Orden del
    # cliente. Import local para evitar ciclo de imports entre apps.
    id_produccion = asignacion.idTarea.idProduccion
    if id_produccion:
        from apps.produccion.services import recalcular_produccion_desde_tareas
        recalcular_produccion_desde_tareas(id_produccion)

    return JsonResponse({'ok': True, 'estado': nuevo_estado})


# ─────────────────────────────────────────────────────────────────
# 5. API — Guardar nuevo reporte de incidencia
# POST /operarios/api/reporte/
# ─────────────────────────────────────────────────────────────────

@require_http_methods(['POST'])
def api_guardar_reporte(request):
    """Crea una nueva Incidencia asociada al operario."""
    operario = _get_operario(request)
    if not operario:
        return _json_error('No autenticado', 401)

    try:
        body = json.loads(request.body)
    except json.JSONDecodeError:
        return _json_error('JSON inválido')

    tipo        = body.get('tipoIncidencia', '').strip()
    descripcion = body.get('descripcion', '').strip()
    severidad   = body.get('severidad', 'Media').strip()

    if not tipo:
        return _json_error('El tipo de incidencia es obligatorio')
    if not descripcion or len(descripcion) < 5:
        return _json_error('La descripción es demasiado corta')

    incidencia = Incidencia.objects.create(
        idOperario=operario,
        tipoIncidencia=tipo[:50],
        descripcion=descripcion,
        estado='Generado',
        fechaGeneracion=date.today(),
    )

    return JsonResponse({
        'ok': True,
        'idIncidencia': incidencia.idIncidencia,
        'mensaje': 'Incidencia registrada correctamente',
    }, status=201)


# ─────────────────────────────────────────────────────────────────
# 6. API — Editar reporte existente
# POST /operarios/api/reporte/<id>/editar/
# ─────────────────────────────────────────────────────────────────

@require_http_methods(['POST'])
def api_editar_reporte(request, id_incidencia):
    """Edita tipo y descripción de una incidencia propia."""
    operario = _get_operario(request)
    if not operario:
        return _json_error('No autenticado', 401)

    incidencia = get_object_or_404(
        Incidencia,
        idIncidencia=id_incidencia,
        idOperario=operario,
    )

    try:
        body = json.loads(request.body)
    except json.JSONDecodeError:
        return _json_error('JSON inválido')

    tipo        = body.get('tipoIncidencia', '').strip()
    descripcion = body.get('descripcion', '').strip()

    if not tipo:
        return _json_error('El tipo de incidencia es obligatorio')
    if not descripcion or len(descripcion) < 5:
        return _json_error('La descripción es demasiado corta')

    incidencia.tipoIncidencia = tipo[:50]
    incidencia.descripcion    = descripcion
    incidencia.save()

    return JsonResponse({'ok': True, 'mensaje': 'Incidencia actualizada'})


# ─────────────────────────────────────────────────────────────────
# 7. API — Eliminar reporte
# POST /operarios/api/reporte/<id>/eliminar/
# ─────────────────────────────────────────────────────────────────

@require_http_methods(['POST'])
def api_eliminar_reporte(request, id_incidencia):
    """Elimina una incidencia (solo si estado = 'Generado')."""
    operario = _get_operario(request)
    if not operario:
        return _json_error('No autenticado', 401)

    incidencia = get_object_or_404(
        Incidencia,
        idIncidencia=id_incidencia,
        idOperario=operario,
    )

    if incidencia.estado != 'Generado':
        return _json_error(
            'Solo se pueden eliminar incidencias en estado "Generado"',
            status=403,
        )

    incidencia.delete()
    return JsonResponse({'ok': True, 'mensaje': 'Incidencia eliminada'})


# ─────────────────────────────────────────────────────────────────
# 8. API — Historial de reportes del operario
# GET /operarios/api/reportes/
# ─────────────────────────────────────────────────────────────────

def api_historial_reportes(request):
    """Lista todas las incidencias del operario logueado."""
    operario = _get_operario(request)
    if not operario:
        return _json_error('No autenticado', 401)

    incidencias = (
        Incidencia.objects
        .filter(idOperario=operario)
        .order_by('-fechaGeneracion', '-idIncidencia')
    )

    reportes = [
        {
            'idIncidencia':  inc.idIncidencia,
            'tipoIncidencia': inc.tipoIncidencia,
            'descripcion':   inc.descripcion,
            'estado':        inc.estado,
            'fechaReporte':  str(inc.fechaGeneracion) if inc.fechaGeneracion else '',
            'fechaGeneracion': str(inc.fechaGeneracion) if inc.fechaGeneracion else '',
            'respuesta':       inc.respuesta,
            'respuestaLeida':  inc.respuestaLeida,
        }
        for inc in incidencias
    ]

    return JsonResponse({'reportes': reportes})


# ─────────────────────────────────────────────────────────────────
# 8b. API — Marcar la respuesta de una incidencia como leída
# POST /operarios/api/reporte/<id>/leer/
# ─────────────────────────────────────────────────────────────────

@require_http_methods(['POST'])
def api_marcar_respuesta_leida(request, id_incidencia):
    """Marca la respuesta del admin como leída (se llama al abrir el detalle)."""
    operario = _get_operario(request)
    if not operario:
        return _json_error('No autenticado', 401)

    incidencia = get_object_or_404(
        Incidencia, idIncidencia=id_incidencia, idOperario=operario,
    )
    if not incidencia.respuestaLeida:
        incidencia.respuestaLeida = True
        incidencia.save(update_fields=['respuestaLeida'])

    return JsonResponse({'ok': True})


# ─────────────────────────────────────────────────────────────────
# 9. PDF — Generar reporte de incidencia
# GET /operarios/api/reporte/<id>/pdf/
# ─────────────────────────────────────────────────────────────────

def generar_pdf_reporte(request, id_incidencia):
    """
    Genera un PDF sencillo de la incidencia usando ReportLab.
    Si ReportLab no está instalado, devuelve el reporte como texto plano.
    """
    operario = _get_operario(request)
    if not operario:
        return redirect('login')

    incidencia = get_object_or_404(
        Incidencia,
        idIncidencia=id_incidencia,
        idOperario=operario,
    )

    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.lib.units import cm
        from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer
        import io

        buffer = io.BytesIO()
        doc    = SimpleDocTemplate(buffer, pagesize=A4,
                                   leftMargin=2*cm, rightMargin=2*cm,
                                   topMargin=2*cm, bottomMargin=2*cm)
        styles = getSampleStyleSheet()
        story  = []

        story.append(Paragraph('HebraTech — Reporte de Incidencia', styles['Title']))
        story.append(Spacer(1, 0.5*cm))
        story.append(Paragraph(f'<b>ID:</b> #{str(incidencia.idIncidencia).zfill(4)}', styles['Normal']))
        story.append(Paragraph(f'<b>Tipo:</b> {incidencia.tipoIncidencia}', styles['Normal']))
        story.append(Paragraph(f'<b>Estado:</b> {incidencia.estado}', styles['Normal']))
        story.append(Paragraph(f'<b>Fecha:</b> {incidencia.fechaGeneracion}', styles['Normal']))
        story.append(Spacer(1, 0.4*cm))
        story.append(Paragraph('<b>Descripción:</b>', styles['Normal']))
        story.append(Paragraph(incidencia.descripcion, styles['Normal']))
        story.append(Spacer(1, 0.4*cm))
        story.append(Paragraph(
            f'<b>Operario:</b> {operario.idUsuario.nombre} {operario.idUsuario.apellido}',
            styles['Normal'],
        ))

        doc.build(story)
        buffer.seek(0)

        nombre_archivo = f'HebraTech_Incidencia_{str(incidencia.idIncidencia).zfill(4)}.pdf'
        response = HttpResponse(buffer, content_type='application/pdf')
        response['Content-Disposition'] = f'attachment; filename="{nombre_archivo}"'
        return response

    except ImportError:
        contenido = (
            f'HebraTech — Reporte de Incidencia\n'
            f'{"=" * 40}\n'
            f'ID:          #{str(incidencia.idIncidencia).zfill(4)}\n'
            f'Tipo:        {incidencia.tipoIncidencia}\n'
            f'Estado:      {incidencia.estado}\n'
            f'Fecha:       {incidencia.fechaGeneracion}\n'
            f'Operario:    {operario.idUsuario.nombre} {operario.idUsuario.apellido}\n\n'
            f'Descripción:\n{incidencia.descripcion}\n'
        )
        response = HttpResponse(contenido, content_type='text/plain; charset=utf-8')
        response['Content-Disposition'] = (
            f'attachment; filename="HebraTech_Incidencia_'
            f'{str(incidencia.idIncidencia).zfill(4)}.txt"'
        )
        return response
