from pathlib import Path
from decouple import config

# --- RUTAS PRINCIPALES ---
BASE_DIR = Path(__file__).resolve().parent.parent.parent

# --- CONFIGURACIÓN DE SEGURIDAD ---
SECRET_KEY = config('SECRET_KEY', default='khu0^e#r85^iv@0b6ddi*ld%(g$ta2fz_8(hn7wcm&zzsxjj7%')
DEBUG = config('DEBUG', default=True, cast=bool)
ALLOWED_HOSTS = ['127.0.0.1', 'localhost']

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
    'django.contrib.humanize', # Requerido por allauth

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
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.mysql',
        'NAME': config('DB_NAME', default='hebratech'),
        'USER': config('DB_USER', default='root'),
        'PASSWORD': config('DB_PASSWORD', default='12345'),
        'HOST': config('DB_HOST', default='127.0.0.1'),
        'PORT': config('DB_PORT', default='3306'),
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

# --- PARCHE DE COMPATIBILIDAD MARIADB/MYSQL ---
import django.db.backends.mysql.base
from django.db.backends.mysql.features import DatabaseFeatures

DatabaseFeatures.can_return_rows_from_bulk_insert = False
DatabaseFeatures.has_select_for_update_returning = False
DatabaseFeatures._mysql_storage_engine = property(lambda self: "InnoDB")

SILENCED_SYSTEM_CHECKS = ['models.W036']

# --- FIX: forzar detección correcta de MySQL (no MariaDB) ---
from django.db.backends.mysql.base import DatabaseWrapper
DatabaseWrapper.mysql_is_mariadb = property(lambda self: False)

# --- CONFIGURACIÓN DE CORREO ELECTRÓNICO ---
EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'
EMAIL_HOST = 'smtp.gmail.com'
EMAIL_PORT = 587
EMAIL_USE_TLS = True

EMAIL_HOST_USER = config('EMAIL_HOST_USER', default='hebratechoficial@gmail.com')
EMAIL_HOST_PASSWORD = config('EMAIL_HOST_PASSWORD', default='qott jfmn uern pliy')
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
        }
    }
}