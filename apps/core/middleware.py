from django.shortcuts import redirect
from django.contrib import messages

class RoleSecurityMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        path = request.path
        usuario_rol = request.session.get('usuario_rol')
        usuario_id = request.session.get('usuario_id')

        # 1. BLINDAR EL MÓDULO ADMINISTRADOR
        if path.startswith('/administrador/'):
            if not usuario_id:
                return redirect('login')
            if usuario_rol != 'administrador':
                messages.error(request, 'Acceso denegado. Esta área es exclusiva para administradores.')
                return self._redirect_by_role(usuario_rol)

        # 2. BLINDAR EL MÓDULO CLIENTE
        if path.startswith('/clientes/'):
            if not usuario_id:
                return redirect('login')
            if usuario_rol != 'cliente':
                messages.error(request, 'Acceso denegado. Esta área es exclusiva para clientes.')
                return self._redirect_by_role(usuario_rol)

        # 3. BLINDAR EL MÓDULO OPERARIO
        if path.startswith('/operarios/'):
            if not usuario_id:
                return redirect('login')
            if usuario_rol != 'operario':
                messages.error(request, 'Acceso denegado. Esta área es exclusiva para operarios.')
                return self._redirect_by_role(usuario_rol)

        return self.get_response(request)

    def _redirect_by_role(self, rol):
        """Redirige al usuario a su propio portal si intenta entrar a uno ajeno."""
        if rol == 'administrador':
            return redirect('admin_portal')
        elif rol == 'cliente':
            return redirect('cliente_portal')
        elif rol == 'operario':
            return redirect('operarios:tablero')
        return redirect('login')