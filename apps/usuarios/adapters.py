from urllib.parse import quote

from allauth.account.adapter import DefaultAccountAdapter
from allauth.socialaccount.adapter import DefaultSocialAccountAdapter
from django.contrib.auth.hashers import make_password
from django.db import connection
from django.urls import NoReverseMatch, reverse
from django.utils import timezone


class CustomAccountAdapter(DefaultAccountAdapter):
    """
    Redirige después del login social (Google).
    - Cuenta pendiente / inactiva → manda a /login/?pending=1 (login_view la
      desloguea y muestra aviso al usuario).
    - Usuario autenticado sin fila en `usuarios` → manda a /login/?register=1
      con el correo precargado para que complete el alta.
    - Resto → portal según rol.
    """

    def get_login_redirect_url(self, request):
        if not request.user.is_authenticated:
            return super().get_login_redirect_url(request)

        from apps.usuarios.models import Usuario

        # Alta recién creada por Google → queda pendiente, avisar y desloguear
        if request.session.pop('nuevo_registro_social', False):
            return f"{reverse('login')}?pending=1&correo={quote(request.user.email)}"

        try:
            usuario_db = Usuario.objects.get(correoElectronico=request.user.email)
        except Usuario.DoesNotExist:
            # Autenticado por allauth pero sin fila en `usuarios`
            return f"{reverse('login')}?register=1&correo={quote(request.user.email)}"

        # Entrar con Google demuestra que el correo es suyo: si se había
        # registrado con formulario y nunca verificó, queda verificado.
        if not usuario_db.emailVerificado:
            usuario_db.emailVerificado = True
            usuario_db.emailVerificadoEn = timezone.now()
            usuario_db.save(update_fields=['emailVerificado', 'emailVerificadoEn'])

        request.session['usuario_id'] = usuario_db.idUsuario
        request.session['usuario_nombre'] = usuario_db.nombre
        request.session['usuario_rol'] = usuario_db.rol

        # Cuenta pendiente / inactiva / sin rol → login_view la desloguea
        if usuario_db.estado != 'activo' or usuario_db.rol == 'sin_asignar':
            return f"{reverse('login')}?pending=1&correo={quote(usuario_db.correoElectronico)}"

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
        if message_template == "account/messages/logged_in.txt":
            return
        super().add_message(request, level, message_template, message_context, extra_tags)


class CustomSocialAccountAdapter(DefaultSocialAccountAdapter):
    """
    Puentea el alta social (Google) con la tabla `usuarios` propia.
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
                    (nombre, apellido, correoElectronico, contrasena, rol, estado, emailVerificado)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, [nombre, apellido, correo, contrasena_hash, 'sin_asignar', 'pendiente', 1])

        # Google ya verificó este correo; se guarda la fecha con el ORM
        # para que respete la zona horaria (USE_TZ=True).
        Usuario.objects.filter(correoElectronico=correo).update(
            emailVerificadoEn=timezone.now()
        )

        # Marca: la próxima redirección va a avisar "cuenta pendiente"
        request.session['nuevo_registro_social'] = True

        return user