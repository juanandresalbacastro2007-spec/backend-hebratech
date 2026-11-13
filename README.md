# 🧵 HebraTech — Backend

Sistema de gestión de producción textil multi-rol (administrador, operario, cliente), desarrollado con Django y MySQL. Proyecto académico y funcional para la Especialización en Gerencia de la Calidad.

<p align="center">
  <img src="https://img.shields.io/badge/Django-6.1-092E20?style=for-the-badge&logo=django&logoColor=white" />
  <img src="https://img.shields.io/badge/MySQL-8.0.44-4479A1?style=for-the-badge&logo=mysql&logoColor=white" />
  <img src="https://img.shields.io/badge/Python-3.x-3776AB?style=for-the-badge&logo=python&logoColor=white" />
  <img src="https://img.shields.io/badge/License-Academic-lightgrey?style=for-the-badge" />
</p>

---

## 📌 Descripción

**HebraTech** es un sistema de gestión empresarial orientado al sector textil que permite administrar producción, inventario, operarios, clientes y proveedores desde distintos roles con permisos diferenciados. Utiliza autenticación manual por sesión (no el sistema de auth nativo de Django), modelos `managed=False` sobre una base de datos MySQL existente, e incluye integración con **Google OAuth** vía `django-allauth`.

## 🚀 Características principales

- 🔐 Autenticación manual por sesión + login social con Google (OAuth2)
- 👥 Gestión de roles: administrador, operario y cliente (la gestión de proveedores está integrada en el panel del administrador)
- ✅ Flujo de aprobación de usuarios nuevos (estado `pendiente` / rol `sin_asignar` hasta que el administrador asigna un rol)
- 🔑 Recuperación de contraseña vía token + Gmail SMTP
- 🏭 Módulo de producción con órdenes de producción, asignación de tareas y barra de avance que se actualiza al completar tareas de los operarios
- 🔁 Reprogramación en cascada: al cambiar la fecha de inicio de una orden de producción, se desplazan las tareas pendientes o en progreso asociadas
- ⏰ Detección automática de retrasos mediante un comando de `manage.py` que notifica por correo (Gmail SMTP)
- 📦 Gestión de inventario en una sola página con pestañas (Productos Terminados, Materias Primas y Catálogo), modales, botones rápidos +/- de stock por AJAX e historial de movimientos
- 🧾 Cotizaciones: el cliente las consulta y descarga en PDF; el administrador crea nuevas (cliente + producto + cantidad)
- 🧵 Facturas y documentos en PDF con una identidad visual común (`WeasyPrint`)
- 📊 Tablero Kanban para operarios con drag & drop, reporte de incidencias y edición de perfil con foto
- 🔄 Seguimiento de pedidos en tiempo real (polling) en el portal del cliente
- 🕓 Historial de cambios en órdenes (`django-simple-history`) y estados controlados con `django-fsm-2`
- 🔌 API REST con `djangorestframework`, y `dj-rest-auth`
- 🛡️ Seguridad reforzada: decoradores personalizados centralizados, protección IDOR, fijación de sesión (`cycle_key()`) y mensajes de error unificados para evitar enumeración de usuarios

## 🛠️ Stack tecnológico

| Categoría | Tecnología |
|---|---|
| Backend | Django 6.1 |
| Base de datos | MySQL 8.4 (compatible con MariaDB/XAMPP) mediante PyMySQL |
| Autenticación social | django-allauth (Google OAuth) |
| API | Django REST Framework, SimpleJWT, dj-rest-auth |
| Estados e historial | django-fsm-2, django-simple-history |
| PDFs | WeasyPrint (servidor) y jsPDF (cotizaciones en el navegador) |
| Excel | openpyxl |
| Variables de entorno | python-decouple |
| Frontend | HTML, CSS (sistema de diseño propio), JS, Bootstrap 5 en el portal del cliente |

## 🎨 Sistema de diseño

Paleta de colores unificada en todos los módulos:

`#2C3333` `#395B64` `#A5C9CA` `#E7F6F2`

Tipografías: **Fredoka** (encabezados) y **Roboto** (texto general). Los módulos admiten modo claro y oscuro.

## 📂 Estructura del proyecto

```
backend-hebra/
├── apps/
│   ├── core/            # Decoradores, utilidades y seguridad transversal
│   ├── administrador/   # Panel admin, modelos centrales, inventario, cotizaciones y proveedores
│   ├── clientes/        # Portal de clientes
│   ├── produccion/      # Órdenes de producción, servicios y control de avance
│   └── operarios/       # Kanban, incidencias, perfil
├── hebratech/
│   └── config/          # settings.py, urls y configuración del proyecto
├── .env                 # Variables de entorno (no versionado)
└── manage.py
```

> `apps/administrador/models.py` es la fuente única de verdad de los modelos principales (Usuario, Cliente, Operario, Producto, Orden, AsignacionTarea, Tarea, Incidencia).

## ⚙️ Instalación local

```bash
# 1. Clonar el repositorio
git clone https://github.com/juanandresalbacastro2007-spec/backend-hebra.git
cd backend-hebra

# 2. Crear entorno virtual
python -m venv venv
source venv/bin/activate  # En Windows: venv\Scripts\activate

# 3. Instalar dependencias
pip install -r requirements.txt

# 4. Configurar variables de entorno
cp .env.example .env
# completar credenciales de MySQL, Google OAuth y Gmail SMTP

# 5. Importar la base de datos (dump SQL) o ejecutar migraciones
python manage.py migrate

# 6. Verificar y levantar el servidor
python manage.py check
python manage.py runserver
```

> **WeasyPrint** necesita librerías del sistema (Pango). En Windows consulta la [guía oficial de instalación](https://doc.courtbouillon.org/weasyprint/stable/first_steps.html).

## 🔑 Variables de entorno necesarias

```env
SECRET_KEY=
DEBUG=True
DB_NAME=
DB_USER=
DB_PASSWORD=
DB_HOST=
DB_PORT=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

EMAIL_HOST_USER=
EMAIL_HOST_PASSWORD=
```

⚠️ Nunca subas el `.env` ni dumps SQL con credenciales al repositorio (GitHub Push Protection bloqueará el push).

## 🗄️ Base de datos

Los modelos son `managed=False`, por lo que el esquema vive en MySQL (≈22 tablas de negocio: usuarios, clientes, operarios, proveedores, materiales, productos, inventario, órdenes, producción, tareas, facturas, cotizaciones, incidencias, notificaciones, entre otras). Para compartir el esquema entre MySQL 8.0 y MariaDB/XAMPP se adapta el dump (collation, `DEFINER`, cabeceras `DROP/CREATE DATABASE`, `LOCK TABLES`).

## ☁️ Despliegue

El proyecto está pensado para desplegarse en **PythonAnywhere**: subir el código, crear el entorno virtual con `requirements.txt`, importar el dump a MySQL, configurar las variables de entorno y apuntar el WSGI a `hebratech.config`.

## 📋 Gestión del proyecto

| Recurso | Enlace |
|---|---|
| 📌 Tablero Scrum (Trello) | [Ver tablero](https://trello.com/invite/b/689f62d2858160184aa70561/ATTIbf128c1aaca7ccb2036e0abc8d037bf7762A8D73/hebratech) |
| 📄 Documentación funcional | [Ver documento](https://docs.google.com/document/d/1RZGZ6BTMKZNsVewnjmvNmZEMG3kjPwWCvtkeXo6ph-I/edit?usp=sharing) |

## 👤 Autores

**Jorge Almanza** — Backend  
[GitHub](https://github.com/jorgeformulauno)

**Juan Alba** — Backend  
[GitHub](https://github.com/juanandresalbacastro2007-spec)

**David Sierra** — Backend  
[GitHub](https://github.com/David-sierra4444)

**Santiago Cano** — Backend  
[GitHub](https://github.com/ssantiagocubides-bit)

**Yeferson Idarraga** — Backend  
[GitHub](https://github.com/yeferson11-11)


<p align="center">Proyecto académico — Especialización en Gerencia de la Calidad</p>
