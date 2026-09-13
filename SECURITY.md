# Seguridad

No reportes vulnerabilidades en issues publicos. Usa el canal privado de seguridad configurado en el repositorio remoto.

No subas secretos, tokens, contrasenas, dumps, `.env`, datos personales ni bases locales. Las credenciales se inyectan por el entorno de ejecucion.

Toda dependencia nueva debe pasar `npm audit --audit-level=high` y tener una razon documentada cuando incremente superficie de ataque.
