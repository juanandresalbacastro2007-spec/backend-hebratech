# usuarios/views.py

from django.shortcuts import render, redirect
from django.contrib import messages
from django.contrib.auth import logout  # 👈 IMPORTANTE PARA LIMPIAR ALLAUTH
from django.contrib.auth.hashers import make_password, check_password
from django.db import connection
from django.core.mail import send_mail
from django.template.loader import render_to_string
from django.utils.html import strip_tags
from .models import Usuario, PasswordResetToken

# Importaciones para API de Google con dj-rest-auth y allauth
from allauth.socialaccount.providers.google.views import GoogleOAuth2Adapter
from allauth.socialaccount.providers.oauth2.client import OAuth2Client
from dj_rest_auth.registration.views import SocialLoginView


# ==========================================
# VISTAS DE API (LOGIN CON GOOGLE)
# ==========================================

class GoogleLoginView(SocialLoginView):
    """
    Endpoint API para procesar el login con Google.
    """
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

        error_generico = '"Usuario o contraseña incorrectos. Por favor, intente de nuevo.'

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
    # 👇 Cierra sesión en Django y allauth (limpia cookies de sesión y tokens)
    logout(request)
    # Garantiza que cualquier rastro en la sesión se destruya
    request.session.flush()
    return redirect('login')


def recuperar_view(request):
    if request.method == 'POST':
        correo = request.POST.get('correo', '').strip()

        try:
            usuario = Usuario.objects.get(
                correoElectronico=correo,
                estado='activo'
            )

            reset_token = PasswordResetToken.generar_para_usuario(usuario.idUsuario)

            enlace = request.build_absolute_uri(
                f'/recuperar/{reset_token.token}/'
            )

            html_content = render_to_string('usuarios/email_recuperar.html', {
                'nombre': usuario.nombre,
                'enlace': enlace,
            })
            texto_plano = strip_tags(html_content)

            send_mail(
                subject='Recuperación de contraseña - HebraTech',
                message=texto_plano,
                from_email=None,
                recipient_list=[usuario.correoElectronico],
                html_message=html_content,
                fail_silently=False,
            )

        except Usuario.DoesNotExist:
            pass

        messages.success(
            request,
            'Si el correo está registrado, te enviamos un enlace de recuperación.'
        )
        return redirect('recuperar')

    return render(request, 'usuarios/recuperar.html')


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