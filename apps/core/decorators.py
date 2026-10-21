# apps/core/decorators.py
"""
Decoradores de protección de sesión, reutilizables en todos los módulos.
Este proyecto no usa django.contrib.auth.login(), sino sesión manual
(request.session['usuario_id'], ['idOperario'], etc. — ver apps.usuarios.views.login_view).
"""

from functools import wraps
from django.http import JsonResponse
from django.shortcuts import redirect
from django.contrib import messages


def login_required_rol(rol_esperado=None, session_key='usuario_id'):
    """
    Decorador genérico para vistas HTML.
    - session_key: qué clave de sesión valida (ej. 'usuario_id', 'idOperario').
    - rol_esperado: si se pasa, además exige que session['usuario_rol'] == rol_esperado.
    """
    def decorador(view_func):
        @wraps(view_func)
        def wrapper(request, *args, **kwargs):
            usuario_id = request.session.get(session_key)
            usuario_rol = request.session.get('usuario_rol')

            # 1. Si no hay sesión, al login
            if not usuario_id:
                messages.error(request, 'Debes iniciar sesión para acceder a esta página.')
                return redirect('login')
            
            # 2. Si el rol no coincide, lo expulsamos a SU portal (no al login)
            if rol_esperado and usuario_rol != rol_esperado:
                messages.error(request, 'No tienes permisos para acceder a esta sección.')
                if usuario_rol == 'cliente':
                    return redirect('cliente_portal')
                elif usuario_rol == 'operario':
                    return redirect('operarios:tablero')
                elif usuario_rol == 'administrador':
                    return redirect('admin_portal')
                return redirect('login')
                
            return view_func(request, *args, **kwargs)
        return wrapper
    return decorador


def login_required_api(rol_esperado=None, session_key='usuario_id'):
    """Igual que arriba, pero para endpoints JSON: responde 401/403 en vez de redirigir."""
    def decorador(view_func):
        @wraps(view_func)
        def wrapper(request, *args, **kwargs):
            usuario_id = request.session.get(session_key)
            usuario_rol = request.session.get('usuario_rol')

            if not usuario_id:
                return JsonResponse({'ok': False, 'error': 'Sesión no válida'}, status=401)
            
            if rol_esperado and usuario_rol != rol_esperado:
                return JsonResponse({'ok': False, 'error': 'No autorizado'}, status=403)
                
            return view_func(request, *args, **kwargs)
        return wrapper
    return decorador