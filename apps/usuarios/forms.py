from django import forms
from allauth.socialaccount.forms import SignupForm as BaseSocialSignupForm


class SocialSignupForm(BaseSocialSignupForm):
    """
    Registro cuando alguien entra por primera vez con Google.
    Muestra nombre / apellido / email prellenados desde Google y de solo
    lectura. El usuario solo define su contraseña.
    """
    nombre = forms.CharField(
        max_length=100,
        label='Nombre',
        widget=forms.TextInput(attrs={
            'readonly': 'readonly',
            'class': 'form-control',
        }),
    )
    apellido = forms.CharField(
        max_length=100,
        label='Apellido',
        widget=forms.TextInput(attrs={
            'readonly': 'readonly',
            'class': 'form-control',
        }),
    )
    contrasena = forms.CharField(
        widget=forms.PasswordInput(attrs={'class': 'form-control'}),
        label='Contraseña',
        min_length=8,
        help_text='La vas a poder usar para iniciar sesión sin Google también.',
    )
    confirmar_contrasena = forms.CharField(
        widget=forms.PasswordInput(attrs={'class': 'form-control'}),
        label='Confirmar contraseña',
    )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

        # ── Sacamos los datos que ya trae Google ──
        extra_data = {}
        sociallogin = getattr(self, 'sociallogin', None)
        if sociallogin is not None:
            extra_data = sociallogin.account.extra_data or {}

        # Nombre / Apellido: visibles, precargados, solo lectura
        self.fields['nombre'].initial = extra_data.get('given_name', '')
        self.fields['nombre'].required = False

        self.fields['apellido'].initial = extra_data.get('family_name', '')
        self.fields['apellido'].required = False

        # Email: visible, precargado, solo lectura
        if 'email' in self.fields:
            self.fields['email'].initial = extra_data.get('email', '')
            self.fields['email'].widget = forms.EmailInput(attrs={
                'readonly': 'readonly',
                'class': 'form-control',
            })
            self.fields['email'].required = False

        # allauth puede exigir 'username'; lo ocultamos y lo generamos solo
        if 'username' in self.fields:
            self.fields['username'].required = False
            self.fields['username'].widget = forms.HiddenInput()

        # Garantizamos la clase bootstrap en cualquier campo restante
        for field in self.fields.values():
            if 'class' not in field.widget.attrs:
                field.widget.attrs['class'] = 'form-control'

    def clean_nombre(self):
        nombre = self.cleaned_data.get('nombre')
        if nombre:
            return nombre
        sociallogin = getattr(self, 'sociallogin', None)
        if sociallogin is not None:
            extra_data = sociallogin.account.extra_data or {}
            return extra_data.get('given_name', '')
        return ''

    def clean_apellido(self):
        apellido = self.cleaned_data.get('apellido')
        if apellido:
            return apellido
        sociallogin = getattr(self, 'sociallogin', None)
        if sociallogin is not None:
            extra_data = sociallogin.account.extra_data or {}
            return extra_data.get('family_name', '')
        return ''

    def clean_username(self):
        username = self.cleaned_data.get('username')
        if username:
            return username
        email = self.data.get('email') or (
            getattr(self, 'sociallogin', None) and self.sociallogin.user.email
        )
        base = (email or 'usuario').split('@')[0]
        return base

    def clean(self):
        cleaned_data = super().clean()
        contrasena = cleaned_data.get('contrasena')
        confirmar = cleaned_data.get('confirmar_contrasena')

        if contrasena and confirmar and contrasena != confirmar:
            self.add_error('confirmar_contrasena', 'Las contraseñas no coinciden.')

        return cleaned_data