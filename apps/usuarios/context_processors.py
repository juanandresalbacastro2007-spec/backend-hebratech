# apps/usuarios/context_processors.py
from django.conf import settings


def recaptcha(request):
    """Expone la clave PÚBLICA del sitio a las plantillas ({{ RECAPTCHA_SITE_KEY }})."""
    return {'RECAPTCHA_SITE_KEY': settings.RECAPTCHA_SITE_KEY}