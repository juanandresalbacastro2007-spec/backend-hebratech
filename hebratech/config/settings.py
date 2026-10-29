from pathlib import Path
from decouple import config, Csv

# --- RUTAS PRINCIPALES ---
BASE_DIR = Path(__file__).resolve().parent.parent.parent

# --- CONFIGURACIÓN DE SEGURIDAD (todo viene del archivo .env) ---
SECRET_KEY = config('SECRET_KEY')
DEBUG = config('DEBUG', default=False, cast=bool)
ALLOWED_HOSTS = config('ALLOWED_HOSTS', default='127.0.0.1,localhost', cast=Csv())
CSRF_TRUSTED_ORIGINS = config('CSRF_TRUSTED_ORIGINS', default='', cast=Csv())

SITE_ID = 1

# --- APLICACIONES ---
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'django.contrib.sites',
    'django.contrib.humanize',  # Requerido por allauth

    # Librerías de Autenticación y API
    'rest_framework',
    'rest_framework.authtoken',
    'dj_rest_auth',
    'dj_rest_auth.registration',
    'allauth',
    'allauth.account',
    'allauth.socialaccount',
    'allauth.socialaccount.providers.google',
    'django_fsm',
    'simple_history',

    # Tus aplicaciones
    'apps.usuarios',
    'apps.clientes',
    'apps.produccion',
    'apps.administrador',
    'apps.proveedores',
    'apps.operarios',
    'apps.core',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'allauth.account.middleware.AccountMiddleware',  # Requerido por allauth
    'simple_history.middleware.HistoryRequestMiddleware',  # para guardar el usuario que hizo el cambio
    'apps.core.middleware.RoleSecurityMiddleware',
]

# --- BACKENDS DE AUTENTICACIÓN ---
AUTHENTICATION_BACKENDS = [
    'django.contrib.auth.backends.ModelBackend',
    'allauth.account.auth_backends.AuthenticationBackend',
]

ROOT_URLCONF = 'hebratech.config.urls'

# --- PLANTILLAS ---
TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'hebratech' / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'hebratech.config.wsgi.application'

# --- BASE DE DATOS ---
# DB_ENGINE=mysql  -> MySQL (desarrollo local, como antes)
# DB_ENGINE=sqlite -> SQLite (por defecto; útil para el despliegue)
DB_ENGINE = config('DB_ENGINE', default='sqlite')

if DB_ENGINE == 'mysql':
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.mysql',
            'NAME': config('DB_NAME', default='hebratech'),
            'USER': config('DB_USER', default='root'),
            'PASSWORD': config('DB_PASSWORD'),
            'HOST': config('DB_HOST', default='127.0.0.1'),
            'PORT': config('DB_PORT', default='3306'),
        }
    }

    # --- PARCHE DE COMPATIBILIDAD MARIADB/MYSQL (solo aplica con MySQL) ---
    from django.db.backends.mysql.features import DatabaseFeatures
    from django.db.backends.mysql.base import DatabaseWrapper

    DatabaseFeatures.can_return_rows_from_bulk_insert = False
    DatabaseFeatures.has_select_for_update_returning = False
    DatabaseFeatures._mysql_storage_engine = property(lambda self: "InnoDB")
    DatabaseWrapper.mysql_is_mariadb = property(lambda self: False)

    SILENCED_SYSTEM_CHECKS = ['models.W036']
else:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'db.sqlite3',
        }
    }

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

# --- LOCALIZACIÓN ---
LANGUAGE_CODE = 'es-co'
TIME_ZONE = 'America/Bogota'
USE_I18N = True
USE_TZ = True
USE_THOUSAND_SEPARATOR = True

# --- ARCHIVOS ESTÁTICOS Y MEDIA ---
STATIC_URL = '/static/'
STATICFILES_DIRS = [
    BASE_DIR / 'static',
]
STATIC_ROOT = BASE_DIR / 'staticfiles'

MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'hebratech' / 'media'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# --- CONFIGURACIÓN DE CORREO ELECTRÓNICO ---
# En despliegue gratuito el SMTP puede estar bloqueado: usa el backend "console" en el .env
EMAIL_BACKEND = config('EMAIL_BACKEND', default='django.core.mail.backends.smtp.EmailBackend')
EMAIL_HOST = 'smtp.gmail.com'
EMAIL_PORT = 587
EMAIL_USE_TLS = True

EMAIL_HOST_USER = config('EMAIL_HOST_USER', default='')
EMAIL_HOST_PASSWORD = config('EMAIL_HOST_PASSWORD', default='')
DEFAULT_FROM_EMAIL = 'HebraTech <hebratechoficial@gmail.com>'

# --- CONFIGURACIÓN DE REST FRAMEWORK Y JWT ---
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    )
}

REST_AUTH = {
    'USE_JWT': True,
    'JWT_AUTH_HTTPONLY': False,
}

# --- REDIRECCIONES DE ALLAUTH ---
LOGIN_REDIRECT_URL = '/'
ACCOUNT_LOGOUT_REDIRECT_URL = '/login/'
SOCIALACCOUNT_LOGIN_ON_GET = True  # Permite clic directo en enlaces <a> para iniciar sesión con Google
SOCIALACCOUNT_ADAPTER = 'apps.usuarios.adapters.CustomSocialAccountAdapter'
SOCIALACCOUNT_FORMS = {'signup': 'apps.usuarios.forms.SocialSignupForm'}
ACCOUNT_ADAPTER = 'apps.usuarios.adapters.CustomAccountAdapter'
SOCIALACCOUNT_AUTO_SIGNUP = False

# --- CONFIGURACIÓN DE LOGIN SOCIAL CON GOOGLE ---
SOCIALACCOUNT_PROVIDERS = {
    'google': {
        'SCOPE': [
            'profile',
            'email',
        ],
        'AUTH_PARAMS': {
            'access_type': 'online',
            'prompt': 'select_account',  # OBLIGA A GOOGLE A PREGUNTAR LA CUENTA
        }
    }
}

ACCOUNT_PREVENT_ENUMERATION = False
ACCOUNT_EMAIL_UNKNOWN_ACCOUNTS = False

# --- SEGURIDAD EN PRODUCCIÓN (solo se activa con DEBUG=False) ---
if not DEBUG:
    # PythonAnywhere termina el HTTPS en su proxy; sin esto Django cree que
    # la petición es HTTP y SECURE_SSL_REDIRECT causaría un bucle de redirecciones.
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SECURE_SSL_REDIRECT = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True