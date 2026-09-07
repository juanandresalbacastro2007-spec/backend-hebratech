from django.urls import path, include
from . import views

urlpatterns = [
    # General / Portal
    path('', views.admin_portal, name='admin_portal'),
    path('editar-perfil/', views.editar_perfil, name='editar_perfil'),

    # Usuarios
    path('usuarios/', views.usuarios_lista, name='admin_usuarios'),
    path('usuarios/crear/', views.usuario_crear, name='admin_usuario_crear'),
    path('usuarios/<int:idUsuario>/editar/', views.usuario_editar, name='admin_usuario_editar'),
    path('usuarios/<int:idUsuario>/eliminar/', views.usuario_eliminar, name='admin_usuario_eliminar'),

    # Órdenes
    path('ordenes/', views.ordenes_lista, name='admin_ordenes'),
    path('ordenes/exportar/excel/', views.exportar_ordenes_excel, name='exportar_ordenes_excel'),
    path('ordenes/exportar/pdf/', views.exportar_ordenes_pdf, name='exportar_ordenes_pdf'),
    path('ordenes/<int:idOrden>/editar/', views.orden_editar, name='admin_editar_orden'),
    path('ordenes/<int:idOrden>/eliminar/', views.orden_eliminar, name='admin_eliminar_orden'),

    # Tareas
    path('tareas/', views.tareas_lista, name='admin_tareas'),
    path('tareas/asignar/', views.tarea_asignar, name='admin_tarea_asignar'),
    path('tareas/<int:idAsignacion>/editar/', views.tarea_editar, name='admin_editar_tarea'),
    path('tareas/<int:idAsignacion>/eliminar/', views.tarea_eliminar, name='admin_eliminar_tarea'),

    # Incidencias
    path('incidencias/', views.incidencias_lista, name='admin_incidencias'),
    path('incidencias/<int:idIncidencia>/editar/', views.incidencia_editar, name='admin_editar_incidencia'),
    path('incidencias/<int:idIncidencia>/eliminar/', views.incidencia_eliminar, name='admin_eliminar_incidencia'),

    # Facturas
    path('facturas/', views.facturas_lista, name='admin_facturas'),
    path('facturas/<int:idFactura>/marcar-pagada/', views.factura_marcar_pagada, name='admin_factura_marcar_pagada'),
    path('facturas/<int:idFactura>/descargar/', views.factura_descargar, name='admin_factura_descargar'),

    # Inventario & Exportaciones de Inventario
    path('inventario/', views.inventario_lista, name='admin_inventario'),
    path('inventario/crear/', views.crear_inventario, name='crear_inventario'),
    path('inventario/editar/<int:pk>/', views.editar_inventario, name='editar_inventario'),
    path('inventario/eliminar/<int:pk>/', views.eliminar_inventario, name='eliminar_inventario'),
    path('inventario/egreso/<int:pk>/', views.registrar_egreso, name='registrar_egreso'),
    path('inventario/egresos-masivo/', views.registrar_egresos_masivo, name='registrar_egresos_masivo'),
    path('inventario/exportar/pdf/', views.exportar_inventario_pdf, name='exportar_inventario_pdf'),
    path('inventario/exportar/excel/', views.exportar_inventario_excel, name='exportar_inventario_excel'),

    # Materiales
    path('materiales/crear/', views.crear_material, name='crear_material'),
    path('materiales/editar/<int:pk>/', views.editar_material, name='editar_material'),
    path('materiales/eliminar/<int:pk>/', views.eliminar_material, name='eliminar_material'),

    # Módulos externos
    path('produccion/', views.produccion_placeholder, name='admin_produccion'),
    path('proveedores/', include('apps.proveedores.urls')),
]