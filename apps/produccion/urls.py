from django.urls import path
from . import views

urlpatterns = [
    # ── Portal HTML ──────────────────────────────────
    path('', views.produccion_portal, name='produccion_portal'),

    # ── API Dashboard (Centro de Control) ────────────
    path('dashboard/', views.dashboard, name='produccion-dashboard'),

    # ── API Productos ────────────────────────────────
    path('productos/',          views.productos,        name='productos'),
    path('productos/<int:id>/', views.producto_detalle, name='producto-detalle'),

    # ── API Producción ───────────────────────────────
    path('ordenes/',          views.ordenes,       name='ordenes-produccion'),
    path('ordenes/<int:id>/', views.orden_detalle, name='orden-detalle'),

    # ── API KPIs (legacy, admin_portal.html) ─────────
    path('kpis/', views.kpis, name='kpis'),

    # ── API Avance de Operarios (proceso de confección) ──
    path('operarios-avance/', views.avance_operarios, name='avance-operarios'),
]
