from django.urls import path, include
from django.views.generic import RedirectView
from django.templatetags.static import static
from . import views

urlpatterns = [
    # --- Vistas Web Estándar ---
    path('', views.home_view, name='home'),
    path('login/', views.login_view, name='login'),
    path('registro/', views.registro_view, name='registro'),
    path('logout/', views.logout_view, name='logout'),

    # --- Flujo de Recuperación de Contraseña ---
    path('recuperar/', views.recuperar_view, name='recuperar'),
    path('recuperar/<str:token>/', views.validar_reset_view, name='validar_reset'),
    path('recuperar/<str:token>/procesar/', views.procesar_reset_view, name='procesar_reset'),

    # --- Endpoints API REST (Google Login & JWT) ---
    path('api/auth/google/', views.GoogleLoginView.as_view(), name='google_login_api'),
    path('api/auth/', include('dj_rest_auth.urls')),
    
    #--- Página de Términos y Condiciones ---
    path('terminos-de-servicio/', views.terminos_de_servicio, name='terminos_de_servicio'),
    
    #--- Página de Políticas de Privacidad ---
    path('politicas-de-privacidad/', views.politicas_de_privacidad, name='politicas_de_privacidad'),

    # --- Silencia el 404 de /favicon.ico (los navegadores lo piden solos) ---
    path('favicon.ico', RedirectView.as_view(url=static('img/fondo_logo.jpg'), permanent=True)),
]