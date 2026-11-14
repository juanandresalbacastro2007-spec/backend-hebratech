# usuarios/views.py

from django.shortcuts import render, redirect
from django.contrib import messages
from django.contrib.auth import logout
from django.contrib.auth.hashers import make_password, check_password
from django.db import connection
from django.core.mail import EmailMultiAlternatives
from django.contrib.staticfiles import finders
from email.mime.image import MIMEImage
from django.template.loader import render_to_string
import logging

from .models import Usuario, PasswordResetToken
from .recaptcha import verificar_recaptcha

from allauth.socialaccount.providers.google.views import GoogleOAuth2Adapter
from allauth.socialaccount.providers.oauth2.client import OAuth2Client
from dj_rest_auth.registration.views import SocialLoginView

logger = logging.getLogger(__name__)


# ==========================================
# VISTAS DE API (LOGIN CON GOOGLE)
# ==========================================

class GoogleLoginView(SocialLoginView):
    adapter_class = GoogleOAuth2Adapter
    client_class = OAuth2Client
    callback_url = 'http://127.0.0.1:8000/accounts/google/login/callback/'


# ==========================================
# VISTAS TRADICIONALES Y DE SESIÓN
# ==========================================

def login_view(request):
    correo = ''

    if request.method == 'POST':
        correo = request.POST.get('correo', '')
        contrasena = request.POST.get('contrasena', '')

        if not verificar_recaptcha(request):
            messages.error(request, 'Confirma que no eres un robot e inténtalo de nuevo.')
            return render(request, 'usuarios/login.html', {'correo': correo})

        error_generico = 'Usuario o contraseña incorrectos. Por favor, intente de nuevo.'

        try:
            usuario = Usuario.objects.get(
                correoElectronico=correo,
                estado='activo'
            )

            if check_password(contrasena, usuario.contrasena):
                request.session.cycle_key()

                request.session['usuario_id'] = usuario.idUsuario
                request.session['usuario_nombre'] = usuario.nombre
                request.session['usuario_rol'] = usuario.rol

                if usuario.rol == 'operario':
                    try:
                        from apps.operarios.models import Operario
                        operario = Operario.objects.get(idUsuario=usuario.idUsuario)
                        request.session['idOperario'] = operario.idOperario
                    except Exception:
                        pass

                if usuario.rol == 'cliente':
                    return redirect('cliente_portal')
                elif usuario.rol == 'administrador':
                    return redirect('admin_portal')
                elif usuario.rol == 'operario':
                    return redirect('operarios:tablero')
                else:
                    messages.error(request, 'Rol de usuario no reconocido.')
            else:
                messages.error(request, error_generico)

        except Usuario.DoesNotExist:
            messages.error(request, error_generico)

    return render(request, 'usuarios/login.html', {'correo': correo})


def registro_view(request):
    if request.method == 'POST':
        nombre = request.POST.get('nombre', '')
        apellido = request.POST.get('apellido', '')
        correo = request.POST.get('correo', '')
        contrasena = request.POST.get('contrasena', '')
        confirmar = request.POST.get('confirmar', '')

        ctx_error = {
            'show_register': True,
            'reg_nombre': nombre,
            'reg_apellido': apellido,
            'reg_correo': correo,
        }

        if not verificar_recaptcha(request):
            messages.error(request, 'Confirma que no eres un robot e inténtalo de nuevo.')
            return render(request, 'usuarios/login.html', ctx_error)

        if contrasena != confirmar:
            messages.error(request, 'Las contraseñas no coinciden.')
            return render(request, 'usuarios/login.html', ctx_error)

        if Usuario.objects.filter(correoElectronico=correo).exists():
            messages.error(request, 'Ya existe una cuenta con ese correo.')
            return render(request, 'usuarios/login.html', ctx_error)

        with connection.cursor() as cursor:
            cursor.execute("""
                INSERT INTO usuarios 
                    (nombre, apellido, correoElectronico, contrasena, rol, estado)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, [nombre, apellido, correo, make_password(contrasena), 'sin_asignar', 'pendiente'])

        messages.success(request, '¡Cuenta creada! Un administrador debe aprobarla antes de que puedas iniciar sesión.')
        return redirect('login')

    return redirect('login')


def home_view(request):
    return render(request, 'usuarios/home.html')


def logout_view(request):
    logout(request)
    request.session.flush()
    return redirect('login')


def _adjuntar_logo(mensaje):
    """Incrusta static/img/logo.png como cid:logo_hebratech. Devuelve True si se adjuntó."""
    ruta = finders.find('img/logo.png')
    if not ruta:
        return False
    with open(ruta, 'rb') as f:
        logo = MIMEImage(f.read())
    logo.add_header('Content-ID', '<logo_hebratech>')
    logo.add_header('Content-Disposition', 'inline', filename='logo.png')
    mensaje.attach(logo)
    return True


def recuperar_view(request):
    """
    POST: intenta enviar el correo. Siempre renderiza la vista de éxito
    (seguridad: no revelar si el correo existe o no) y SIEMPRE devuelve
    el mismo template con success=True para que el usuario vea la tarjeta
    verde "Correo enviado".
    """
    if request.method == 'POST':
        correo = request.POST.get('correo', '').strip()
        ctx = {'success': True, 'email': correo}

        usuario = None
        try:
            usuario = Usuario.objects.get(
                correoElectronico=correo,
                estado='activo'
            )
        except Usuario.DoesNotExist:
            usuario = None

        if usuario is not None:
            try:
                reset_token = PasswordResetToken.generar_para_usuario(usuario.idUsuario)
                enlace = request.build_absolute_uri(
                    f'/recuperar/{reset_token.token}/'
                )

                texto_plano = (
                    f'Hola, {usuario.nombre}.\n\n'
                    'Recibimos una solicitud para restablecer tu contraseña en HebraTech.\n'
                    f'Abre este enlace para crear una nueva (válido por 15 minutos):\n{enlace}\n\n'
                    'Si no solicitaste este cambio, ignora este correo.'
                )

                mensaje = EmailMultiAlternatives(
                    subject='Recuperación de contraseña - HebraTech',
                    body=texto_plano,
                    from_email=None,
                    to=[usuario.correoElectronico],
                )
                mensaje.mixed_subtype = 'related'

                tiene_logo = _adjuntar_logo(mensaje)

                html_content = render_to_string('usuarios/email_recuperar.html', {
                    'nombre': usuario.nombre,
                    'enlace': enlace,
                    'tiene_logo': tiene_logo,
                })
                mensaje.attach_alternative(html_content, 'text/html')
                mensaje.send(fail_silently=False)

            except Exception as exc:
                # No filtramos al usuario si el envío falla por SMTP.
                # Solo lo dejamos en el log para diagnóstico.
                logger.exception(
                    'Error enviando correo de recuperación a %s: %s', correo, exc
                )

        return render(request, 'usuarios/recuperar.html', ctx)

    return render(request, 'usuarios/recuperar.html', {'success': False})


def validar_reset_view(request, token):
    try:
        reset_token = PasswordResetToken.objects.get(token=token)
    except PasswordResetToken.DoesNotExist:
        messages.error(request, 'El enlace de recuperación no es válido.')
        return redirect('recuperar')

    if not reset_token.es_valido():
        messages.error(request, 'El enlace de recuperación expiró o ya fue utilizado.')
        return redirect('recuperar')

    return render(request, 'usuarios/nueva_contrasena.html', {'token': token})


def procesar_reset_view(request, token):
    try:
        reset_token = PasswordResetToken.objects.get(token=token)
    except PasswordResetToken.DoesNotExist:
        messages.error(request, 'El enlace de recuperación no es válido.')
        return redirect('recuperar')

    if not reset_token.es_valido():
        messages.error(request, 'El enlace de recuperación expiró o ya fue utilizado.')
        return redirect('recuperar')

    if request.method == 'POST':
        nueva = request.POST.get('nueva_contrasena', '')
        repetir = request.POST.get('repetir_contrasena', '')

        if len(nueva) < 8:
            messages.error(request, 'La contraseña debe tener al menos 8 caracteres.')
            return render(request, 'usuarios/nueva_contrasena.html', {'token': token})

        if nueva != repetir:
            messages.error(request, 'Las contraseñas no coinciden.')
            return render(request, 'usuarios/nueva_contrasena.html', {'token': token})

        try:
            usuario = Usuario.objects.get(idUsuario=reset_token.idUsuario)
        except Usuario.DoesNotExist:
            messages.error(request, 'No se encontró el usuario asociado.')
            return redirect('recuperar')

        usuario.contrasena = make_password(nueva)
        usuario.save()

        reset_token.usado = True
        reset_token.save()

        messages.success(request, 'Tu contraseña fue actualizada. Ya puedes iniciar sesión.')
        return redirect('login')

    return redirect('validar_reset', token=token)


def terminos_de_servicio(request):
    return render(request, 'usuarios/terminos.html')


def politicas_de_privacidad(request):
    return render(request, 'usuarios/privacidad.html')