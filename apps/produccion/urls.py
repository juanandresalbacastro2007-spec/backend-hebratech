from django.urls import path
from . import views

urlpatterns = [
    # Portal HTML
    path('', views.produccion_portal, name='produccion_portal'),

    # Dashboard
    path('dashboard/', views.dashboard, name='produccion-dashboard'),

    # Productos (gestión)
    path('productos/',          views.productos,        name='productos'),
    path('productos/<int:id>/', views.producto_detalle, name='producto-detalle'),

    # Productos (para select)
    path('productos-lista/', views.productos_lista, name='productos-lista'),

    # Clientes (para select)
    path('clientes/', views.clientes_lista, name='clientes-lista'),

    # Datos de orden de cliente (autocompletar)
    path('orden-cliente/<int:id>/', views.orden_cliente_datos, name='orden-cliente-datos'),

    # Órdenes de producción
    path('ordenes-produccion/',          views.ordenes_produccion,        name='ordenes-produccion'),
    path('ordenes-produccion/<int:id>/', views.orden_produccion_detalle, name='orden-produccion-detalle'),

    # Órdenes de cliente
    path('ordenes-cliente/',          views.ordenes_cliente,        name='ordenes-cliente'),
    path('ordenes-cliente/<int:id>/', views.orden_cliente_detalle, name='orden-cliente-detalle'),

    # Eventos calendario
    path('eventos-calendario/', views.eventos_calendario, name='eventos-calendario'),

    # Avance de operarios
    path('operarios-avance/', views.avance_operarios, name='avance-operarios'),

    # KPIs legacy
    path('kpis/', views.kpis, name='kpis'),
]