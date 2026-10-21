from allauth.account.adapter import DefaultAccountAdapter
from allauth.socialaccount.adapter import DefaultSocialAccountAdapter
from django.contrib.auth.hashers import make_password
from django.db import connection
from django.urls import reverse


class CustomAccountAdapter(DefaultAccountAdapter):
    """
    Controla a dónde se redirige después de un login (incluye login con Google).
    """

    def get_login_redirect_url(self, request):
        if not request.user.is_authenticated:
            return super().get_login_redirect_url(request)

        from apps.usuarios.models import Usuario

        try:
            usuario_db = Usuario.objects.get(correoElectronico=request.user.email)
        except Usuario.DoesNotExist:
            return super().get_login_redirect_url(request)

        if usuario_db.estado != 'activo':
            return super().get_login_redirect_url(request)

        request.session['usuario_id'] = usuario_db.idUsuario
        request.session['usuario_nombre'] = usuario_db.nombre
        request.session['usuario_rol'] = usuario_db.rol

        if usuario_db.rol == 'cliente':
            return reverse('cliente_portal')
        elif usuario_db.rol == 'administrador':
            return reverse('admin_portal')
        elif usuario_db.rol == 'operario':
            try:
                from apps.operarios.models import Operario
                operario = Operario.objects.get(idUsuario=usuario_db.idUsuario)
                request.session['idOperario'] = operario.idOperario
            except Exception:
                pass
            return reverse('operarios:tablero')

        return super().get_login_redirect_url(request)

    def add_message(self, request, level, message_template, message_context=None, extra_tags=""):
        # Evita mostrar el mensaje automático "Ha iniciado sesión exitosamente..."
        if message_template == "account/messages/logged_in.txt":
            return
        super().add_message(request, level, message_template, message_context, extra_tags)


class CustomSocialAccountAdapter(DefaultSocialAccountAdapter):
    """
    Puentea el registro por Google (allauth) con la tabla `usuarios` propia
    de HebraTech.
    """

    def save_user(self, request, sociallogin, form=None):
        user = super().save_user(request, sociallogin, form=form)

        from apps.usuarios.models import Usuario

        correo = user.email

        if Usuario.objects.filter(correoElectronico=correo).exists():
            return user

        extra_data = sociallogin.account.extra_data or {}

        if form is not None:
            nombre = form.cleaned_data.get('nombre', '')
            apellido = form.cleaned_data.get('apellido', '')
            contrasena_plana = form.cleaned_data.get('contrasena')
        else:
            nombre = extra_data.get('given_name', '')
            apellido = extra_data.get('family_name', '')
            contrasena_plana = None

        contrasena_hash = make_password(contrasena_plana)

        with connection.cursor() as cursor:
            cursor.execute("""
                INSERT INTO usuarios
                    (nombre, apellido, correoElectronico, contrasena, rol, estado)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, [nombre, apellido, correo, contrasena_hash, 'sin_asignar', 'pendiente'])

        return user