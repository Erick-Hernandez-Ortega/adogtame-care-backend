# Adogtame Care Backend

[English](README.md) | **Español**

Backend de Adogtame Care construido con NestJS, TypeScript, PostgreSQL y
Drizzle ORM.

## Requisitos

- Node.js
- pnpm
- Docker con Docker Compose

## Configuración

Instala las dependencias y crea el archivo de entorno local:

```bash
pnpm install
cp .env.example .env
```

La configuración se valida al iniciar la aplicación. `DATABASE_URL` debe usar
el protocolo `postgres://` o `postgresql://`.

## PostgreSQL local

Inicia PostgreSQL 18 y espera hasta que el contenedor esté saludable:

```bash
pnpm db:up
```

Comandos disponibles:

| Comando          | Descripción                                                       |
| ---------------- | ----------------------------------------------------------------- |
| `pnpm db:up`     | Inicia PostgreSQL y espera su healthcheck.                        |
| `pnpm db:down`   | Detiene los contenedores y conserva el volumen.                   |
| `pnpm db:status` | Muestra el estado del servicio PostgreSQL.                        |
| `pnpm db:logs`   | Sigue los logs de PostgreSQL.                                     |
| `pnpm db:check`  | Arranca el contexto NestJS y verifica la conexión con `SELECT 1`. |

Las credenciales incluidas en `.env.example` y `compose.yaml` son exclusivas
para desarrollo local.

## Desarrollo

```bash
pnpm start:dev
```

La API escucha en el puerto definido por `PORT`.

## Documentación de la API

Abre Swagger UI en `http://localhost:3000/docs` (usa el `PORT` configurado si
es diferente). El JSON de OpenAPI está en `/docs-json`. Ambos están disponibles
en todos los entornos.

Para probar rutas protegidas, regístrate con `POST /accounts` si hace falta y
después llama a `POST /auth/login` con tu correo y contraseña. Copia
`accessToken` de la respuesta, pulsa **Authorize** en Swagger e introduce el
token. Swagger añade automáticamente el prefijo Bearer a las peticiones.

| Ruta                                          | Descripción                 | Token Bearer |
| --------------------------------------------- | --------------------------- | ------------ |
| `GET /`                                       | Mensaje de bienvenida       | No           |
| `POST /accounts`                              | Registrar cuenta            | No           |
| `POST /auth/login`                            | Obtener token               | No           |
| `GET /pets`                                   | Listar mascotas accesibles  | Sí           |
| `GET /pets/{petId}`                           | Consultar perfil de mascota | Sí           |
| `POST /pets`                                  | Registrar mascota           | Sí           |
| `POST /pets/{petId}/invitations`              | Invitar colaborador         | Sí           |
| `POST /pets/{petId}/leave`                    | Abandonar como colaborador  | Sí           |
| `POST /pets/{petId}/health/weight-records`    | Registrar peso (kg)         | Sí           |
| `GET /pets/{petId}/health/weight-records`     | Consultar historial de peso | Sí           |
| `POST /pet-invitations/{invitationId}/accept` | Aceptar invitación          | Sí           |
| `POST /pet-invitations/{invitationId}/reject` | Rechazar invitación         | Sí           |
| `POST /pet-invitations/{invitationId}/cancel` | Cancelar invitación         | Sí           |

Para registrar un peso, envía `POST /pets/{petId}/health/weight-records` con un token Bearer y JSON como `{"weightKg":"12.3456","measuredDate":"2026-09-26"}`. El peso es un string decimal positivo en kilogramos con un máximo de cuatro decimales. La fecha de medición debe ser una fecha calendario válida no posterior a hoy en UTC. Un owner o collaborator activo de una mascota activa recibe `201` con el ID del registro, ID de la mascota, `weightKg` canónico, `measuredDate` y `recordedByAccountId`. Una mascota inaccesible o archivada devuelve `404 PET_NOT_FOUND`.

Para consultar el historial, envía `GET /pets/{petId}/health/weight-records` con un token Bearer. Owners y collaborators activos pueden consultar mascotas activas o archivadas. Los resultados se ordenan por fecha de medición, de más reciente a más antigua. `limit` es opcional, tiene valor predeterminado 20 y máximo 100; envía el `nextCursor` opaco como `cursor` para obtener la página siguiente. La respuesta `200` contiene `items` y `nextCursor` (`null` en la última página). Cada elemento contiene `id`, `weightKg` como string decimal, `measuredDate` y `recordedByAccountId`. Una mascota inexistente o inaccesible devuelve `404 PET_NOT_FOUND`.

## Migraciones

Los esquemas Drizzle vivirán en:

```text
src/<bounded-context>/infrastructure/persistence/drizzle/*.schema.ts
```

Cuando exista el primer esquema de dominio, genera y revisa la migración antes
de aplicarla:

```bash
pnpm db:generate
pnpm db:migrations:check
pnpm db:migrate
```

Las migraciones SQL versionadas se guardarán en `drizzle/`. No se genera una
migración vacía mientras no exista un esquema de dominio.

## Verificación

```bash
pnpm lint
pnpm test
pnpm build
```
