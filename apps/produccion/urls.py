from django.urls import path
from . import views

urlpatterns = [
    # Portal HTML
    path('', views.produccion_portal, name='produccion_portal'),

    # Dashboard
    path('dashboard/', views.dashboard, name='produccion-dashboard'),

    # Productos (para el select del formulario de orden de producción)
    path('productos-lista/', views.productos_lista, name='productos-lista'),

    # Clientes (para select)
    path('clientes/', views.clientes_lista, name='clientes-lista'),

    # Órdenes de producción
    path('ordenes-produccion/',          views.ordenes_produccion,        name='ordenes-produccion'),
    path('ordenes-produccion/<int:id>/', views.orden_produccion_detalle, name='orden-produccion-detalle'),

    # Eventos calendario
    path('eventos-calendario/', views.eventos_calendario, name='eventos-calendario'),

    # Avance de operarios
    path('operarios-avance/', views.avance_operarios, name='avance-operarios'),

    # KPIs legacy
    path('kpis/', views.kpis, name='kpis'),
]