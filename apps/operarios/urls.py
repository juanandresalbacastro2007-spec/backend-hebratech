from django.urls import path
from . import views

app_name = 'operarios'

urlpatterns = [

    # ------------------------------------------------------------------
    # Tablero principal — renderiza el HTML del Kanban
    # GET /operarios/
    # ------------------------------------------------------------------
    path(
        '',
        views.tablero_operario,
        name='tablero'
    ),

    # ------------------------------------------------------------------
    # Perfil — ver/editar datos del operario logueado + foto
    # GET/POST /operarios/perfil/
    # ------------------------------------------------------------------
    path(
        'perfil/',
        views.perfil_operario,
        name='perfil'
    ),

    # ------------------------------------------------------------------
    # API — Tareas asignadas al operario logueado
    # GET /operarios/api/tareas/
    # ------------------------------------------------------------------
    path(
        'api/tareas/',
        views.api_tareas,
        name='api_tareas'
    ),

    # ------------------------------------------------------------------
    # API — Guardar nuevo reporte (incidencia)
    # POST /operarios/api/reporte/
    # ------------------------------------------------------------------
    path(
        'api/reporte/',
        views.api_guardar_reporte,
        name='api_guardar_reporte'
    ),

    # ------------------------------------------------------------------
    # API — Historial de reportes del operario
    # GET /operarios/api/reportes/
    # ------------------------------------------------------------------
    path(
        'api/reportes/',
        views.api_historial_reportes,
        name='api_historial_reportes'
    ),

    # ------------------------------------------------------------------
    # API — Actualizar estado de una asignación (drag & drop Kanban)
    # POST /operarios/api/tarea/<id_asignacion>/estado/
    # ------------------------------------------------------------------
    path(
        'api/tarea/<int:id_asignacion>/estado/',
        views.api_actualizar_estado,
        name='api_actualizar_estado'
    ),

    path(
        'api/reporte/<int:id_incidencia>/editar/',
        views.api_editar_reporte,
        name='api_editar_reporte'
    ),

    # ------------------------------------------------------------------
    # API — Marcar la respuesta del admin como leída
    # POST /operarios/api/reporte/<id>/leer/
    # ------------------------------------------------------------------
    path(
        'api/reporte/<int:id_incidencia>/leer/',
        views.api_marcar_respuesta_leida,
        name='api_marcar_respuesta_leida'
    ),
 
    # ------------------------------------------------------------------
    # API — Eliminar un reporte (solo si estado = 'Generado')
    # POST /operarios/api/reporte/<id>/eliminar/
    # ------------------------------------------------------------------
    path(
        'api/reporte/<int:id_incidencia>/eliminar/',
        views.api_eliminar_reporte,
        name='api_eliminar_reporte'
    ),
 
    # ------------------------------------------------------------------
    # PDF — Descargar reporte como PDF
    # GET /operarios/api/reporte/<id>/pdf/
    # ------------------------------------------------------------------
    path(
        'api/reporte/<int:id_incidencia>/pdf/',
        views.generar_pdf_reporte,
        name='generar_pdf_reporte'
    ),

    # ------------------------------------------------------------------
    # API — Editar perfil desde el modal (nombre, correo, teléfono, foto, contraseña)
    # POST /operarios/api/perfil/editar/
    # ------------------------------------------------------------------
    path(
        'api/perfil/editar/',
        views.api_editar_perfil,
        name='api_editar_perfil'
    ),

]