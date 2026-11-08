# apps/usuarios/recaptcha.py
import json
import urllib.parse
import urllib.request

from django.conf import settings

VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify'


def _ip_cliente(request):
    # Detrás del proxy de PythonAnywhere la IP real llega en X-Forwarded-For
    xff = request.META.get('HTTP_X_FORWARDED_FOR', '')
    return xff.split(',')[0].strip() if xff else request.META.get('REMOTE_ADDR', '')


def verificar_recaptcha(request):
    """
    Valida el token 'g-recaptcha-response' del formulario contra Google.
    - Sin claves configuradas: solo deja pasar en DEBUG (desarrollo); en producción rechaza.
    - Si Google no responde o hay error de red: rechaza (falla cerrada).
    """
    if not settings.RECAPTCHA_SECRET_KEY:
        return settings.DEBUG

    token = request.POST.get('g-recaptcha-response', '')
    if not token:
        return False

    datos = urllib.parse.urlencode({
        'secret': settings.RECAPTCHA_SECRET_KEY,
        'response': token,
        'remoteip': _ip_cliente(request),
    }).encode()

    try:
        with urllib.request.urlopen(VERIFY_URL, data=datos, timeout=5) as resp:
            return bool(json.load(resp).get('success', False))
    except Exception:
        return False