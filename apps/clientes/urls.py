from django.urls import path
from . import views

urlpatterns = [
    # ── rutas existentes ─────────────────────────────────────
    path('', views.cliente_portal, name='cliente_portal'),
    path('editar-perfil/', views.editar_perfil_cliente, name='editar_perfil_cliente'),
    path('registrar/', views.registrar_orden, name='registrar_orden'),
    path('orden-exitosa/<int:idOrden>/', views.orden_exitosa, name='orden_exitosa'),
    path('orden/<int:idOrden>/editar/', views.editar_orden, name='editar_orden'),
    path('orden/<int:idOrden>/eliminar/', views.eliminar_orden, name='eliminar_orden'),
    path('factura/<int:idFactura>/descargar/', views.descargar_factura, name='descargar_factura'),
    path('actualizar-ordenes/', views.actualizar_ordenes, name='actualizar_ordenes'),
    path('cotizaciones/generar/', views.generar_cotizacion, name='generar_cotizacion'),
    path('cotizacion/<int:idCotizacion>/descargar/', views.descargar_cotizacion, name='descargar_cotizacion'),
    path('cotizacion/<int:idCotizacion>/eliminar/', views.eliminar_cotizacion, name='eliminar_cotizacion'),

    # ── historial de órdenes ─────────────────────────────────
    path('historial-ordenes/', views.historial_ordenes, name='historial_ordenes'),

    # ── notificaciones ───────────────────────────────────────
    path('notificaciones/', views.notificaciones_json, name='notificaciones_json'),
    path('notificaciones/<int:idNotificacion>/leer/', views.marcar_notificacion_leida, name='marcar_notificacion_leida'),
]