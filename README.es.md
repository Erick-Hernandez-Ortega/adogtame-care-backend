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

La API expone 23 operaciones.

| Ruta                                          | Descripción                 | Token Bearer |
| --------------------------------------------- | --------------------------- | ------------ |
| `GET /`                                       | Mensaje de bienvenida       | No           |
| `POST /accounts`                              | Registrar cuenta            | No           |
| `POST /auth/login`                            | Obtener token               | No           |
| `GET /pets`                                   | Listar mascotas accesibles  | Sí           |
| `GET /pets/{petId}`                           | Consultar perfil de mascota | Sí           |
| `GET /pets/{petId}/members`                   | Listar miembros actuales | Sí           |
| `DELETE /pets/{petId}/members/{membershipId}` | Eliminar acceso de un colaborador | Sí |
| `POST /pets/{petId}/members/{membershipId}/promote` | Promover colaborador a owner | Sí |
| `PATCH /pets/{petId}`                         | Corregir perfil de mascota | Sí           |
| `POST /pets`                                  | Registrar mascota           | Sí           |
| `POST /pets/{petId}/invitations`              | Invitar colaborador         | Sí           |
| `POST /pets/{petId}/leave`                    | Abandonar una mascota  | Sí           |
| `POST /pets/{petId}/health/weight-records`    | Registrar peso (kg)         | Sí           |
| `GET /pets/{petId}/health/weight-records`     | Consultar historial de peso | Sí           |
| `PATCH /pets/{petId}/health/weight-records/{weightRecordId}` | Corregir registro de peso | Sí |
| `DELETE /pets/{petId}/health/weight-records/{weightRecordId}` | Eliminar registro de peso | Sí |
| `POST /pets/{petId}/health/vaccination-records` | Registrar aplicación de vacuna | Sí |
| `GET /pets/{petId}/health/vaccination-records` | Consultar historial de vacunación | Sí |
| `PATCH /pets/{petId}/health/vaccination-records/{vaccinationRecordId}` | Corregir registro de vacunación | Sí |
| `DELETE /pets/{petId}/health/vaccination-records/{vaccinationRecordId}` | Eliminar registro de vacunación | Sí |
| `POST /pet-invitations/{invitationId}/accept` | Aceptar invitación          | Sí           |
| `POST /pet-invitations/{invitationId}/reject` | Rechazar invitación         | Sí           |
| `POST /pet-invitations/{invitationId}/cancel` | Cancelar invitación         | Sí           |

Para listar los miembros actuales, envía `GET /pets/{petId}/members` con un token Bearer y sin body ni query parameters. Owners y collaborators activos pueden consultar mascotas activas o archivadas. La respuesta completa `200` es `{"members":[{"membershipId":"...","accountId":"...","email":"owner@example.com","role":"OWNER"}]}`. Incluye únicamente memberships activas, también la del requester y todos los owners; excluye invitaciones pendientes. Primero aparecen los owners y después los collaborators; dentro de cada rol se ordena por fecha de creación de la membership y luego por ID de membership, ambos ascendentes. Un UUID inválido o nil o un query parameter inesperado devuelve `400 INVALID_REQUEST`; un token ausente o inválido devuelve `401 UNAUTHENTICATED`. Una mascota inexistente, una membership ausente o una membership inactiva del requester devuelve `404 PET_NOT_FOUND`.

Para eliminar el acceso de un colaborador, envía `DELETE /pets/{petId}/members/{membershipId}` como owner activo de una mascota activa. Identifica al destinatario mediante el `membershipId` persistente que devuelve List Pet Members. La respuesta es `204` sin cuerpo, también al repetir la operación sobre un colaborador inactivo. La membership se conserva internamente como `INACTIVE COLLABORATOR`, con su identidad y cuenta; una invitación aceptada posteriormente puede reactivar la misma membership. El retry no ejecuta UPDATE y conserva `updated_at`. No se pueden remover owners, incluida la propia membership (`409 OWNER_REMOVAL_NOT_SUPPORTED`). Una mascota inexistente, archivada o inaccesible devuelve `404 PET_NOT_FOUND` antes de resolver el destinatario; solo después de autorizar al owner, una membership inexistente o de otra mascota devuelve `404 PET_MEMBER_NOT_FOUND`. Ambos IDs deben ser UUID válidos y no nil. Envía la solicitud sin query params y sin cuerpo o con `{}`; una estructura inválida devuelve `400 INVALID_REQUEST`. Un Bearer token ausente o inválido devuelve `401 UNAUTHENTICATED`.

Para promover a un colaborador, envía `POST /pets/{petId}/members/{membershipId}/promote` como owner activo de una mascota activa. Un collaborator activo pasa a owner activo en la misma membership, conservando su ID, cuenta y fecha de creación. Un owner activo, incluido el requester, recibe `204` sin UPDATE ni cambio de `updated_at`. Un miembro inactivo devuelve `409 PET_MEMBER_INACTIVE` y no se reactiva. Una mascota inexistente, archivada o inaccesible devuelve `404 PET_NOT_FOUND` antes de resolver el destinatario; una membership inexistente o de otra mascota devuelve después `404 PET_MEMBER_NOT_FOUND`. Ambos IDs deben ser UUID válidos y no nil. Envía la solicitud sin query params y sin cuerpo o con `{}`; una estructura inválida devuelve `400 INVALID_REQUEST`. Un Bearer token ausente o inválido devuelve `401 UNAUTHENTICATED`.

Para corregir el perfil de una mascota, envía `PATCH /pets/{petId}` como owner activo de una mascota activa. Incluye al menos uno de `name`, `species`, `breed`, `sex`, `birthInformation`, `color`, `distinctiveMarks` o `microchip`. Los objetos `breed` y `birthInformation` usan las mismas estructuras completas que el registro. Los campos omitidos se conservan; envía `null` para limpiar `color`, `distinctiveMarks` o `microchip`. La respuesta `200` tiene la misma estructura que `GET /pets/{petId}`, con `role: "OWNER"`. Un no-op después de normalizar no cambia `updated_at`. Una estructura HTTP inválida devuelve `400 INVALID_REQUEST`; un valor rechazado por el dominio devuelve `422 INVALID_PET`. Una mascota inexistente, archivada o inaccesible devuelve `404 PET_NOT_FOUND`.

Para registrar un peso, envía `POST /pets/{petId}/health/weight-records` con un token Bearer y JSON como `{"weightKg":"12.3456","measuredDate":"2026-09-26"}`. El peso es un string decimal positivo en kilogramos con un máximo de cuatro decimales. La fecha de medición debe ser una fecha calendario válida no posterior a hoy en UTC. Un owner o collaborator activo de una mascota activa recibe `201` con el ID del registro, ID de la mascota, `weightKg` canónico, `measuredDate` y `recordedByAccountId`. Una mascota inaccesible o archivada devuelve `404 PET_NOT_FOUND`.

Para consultar el historial, envía `GET /pets/{petId}/health/weight-records` con un token Bearer. Owners y collaborators activos pueden consultar mascotas activas o archivadas. Los resultados se ordenan por fecha de medición, de más reciente a más antigua. `limit` es opcional, tiene valor predeterminado 20 y máximo 100; envía el `nextCursor` opaco como `cursor` para obtener la página siguiente. La respuesta `200` contiene `items` y `nextCursor` (`null` en la última página). Cada elemento contiene `id`, `weightKg` como string decimal, `measuredDate` y `recordedByAccountId`. Una mascota inexistente o inaccesible devuelve `404 PET_NOT_FOUND`.

Para corregir un registro, envía `PATCH /pets/{petId}/health/weight-records/{weightRecordId}` con `weightKg`, `measuredDate` o ambos. La respuesta `200` incluye los valores canónicos y el autor original. Para eliminarlo permanentemente, envía `DELETE` a la misma ruta sin body o con `{}`; la respuesta es `204`. Ambas acciones requieren ser owner o collaborator activo de una mascota activa, sin importar quién registró el peso. Una mascota inexistente o inaccesible devuelve `404 PET_NOT_FOUND`; si el registro falta o pertenece a otra mascota, devuelve `404 WEIGHT_RECORD_NOT_FOUND` después de confirmar el acceso.

Para registrar una vacuna, envía `POST /pets/{petId}/health/vaccination-records` con un token Bearer y JSON como `{"vaccineName":"Rabies","appliedDate":"2026-09-20","nextDueDate":"2027-09-20"}`. `nextDueDate` puede omitirse o ser `null`; la respuesta `201` siempre lo incluye y usa `null` cuando se desconoce. El nombre se recorta, conserva las mayúsculas y admite hasta 255 caracteres. La fecha de aplicación debe ser válida y no posterior a hoy UTC; la próxima fecha, si existe, debe ser posterior a la aplicación aunque ya haya vencido. Owners y collaborators activos de una mascota activa pueden crear registros idénticos. Una mascota inexistente, archivada o inaccesible devuelve `404 PET_NOT_FOUND`.

Para consultar el historial de vacunación, envía `GET /pets/{petId}/health/vaccination-records` con un token Bearer. Owners y collaborators activos pueden leer mascotas activas o archivadas. Los registros se ordenan por fecha de aplicación, de más reciente a más antigua, con orden estable en empates. `limit` es opcional, tiene valor predeterminado 20 y máximo 100; envía el `nextCursor` opaco como `cursor` para la siguiente página. La respuesta `200` contiene `items` y `nextCursor` (`null` en la última página). Cada elemento contiene `id`, `vaccineName`, `appliedDate`, `nextDueDate` nullable y `recordedByAccountId`. Una mascota inexistente o inaccesible devuelve `404 PET_NOT_FOUND`.

Para corregir un registro de vacunación, envía `PATCH /pets/{petId}/health/vaccination-records/{vaccinationRecordId}` con al menos uno de `vaccineName`, `appliedDate` o `nextDueDate`. Omite `nextDueDate` para conservarla; envía `null` para limpiarla. La combinación final de fechas debe ser válida. Un no-op después de normalizar devuelve `200` sin cambiar `updated_at`. La respuesta conserva el `recordedByAccountId` original. Para eliminarlo físicamente, envía `DELETE` a la misma ruta sin body o con `{}`; devuelve `204` sin body, y un segundo DELETE devuelve `404 VACCINATION_RECORD_NOT_FOUND`. Ambas acciones requieren ser owner o collaborator activo de una mascota activa, sin importar quién registró la vacuna. Una mascota archivada o inaccesible devuelve `404 PET_NOT_FOUND`; un registro ausente o de otra mascota devuelve `404 VACCINATION_RECORD_NOT_FOUND` después de confirmar el acceso.

Para abandonar una mascota, envía `POST /pets/{petId}/leave` con Bearer token, sin query params y sin body o con `{}`. Owners y colaboradores pueden abandonar mascotas activas o archivadas. Un owner activo puede salir solo si permanece otro owner activo; el último recibe `409 LAST_OWNER_CANNOT_LEAVE` sin cambios. El éxito devuelve `204 No Content`, incluidos los reintentos de una membership inactiva. Leave cambia únicamente el estado de la membership a `INACTIVE`, conservando su ID, account ID, rol y fecha de creación. La transición real actualiza `updated_at`; los reintentos no ejecutan UPDATE. Quien abandona pierde acceso y deja de aparecer en List Pet Members. Una nueva invitación aceptada puede reactivar la misma membership histórica como colaborador, incluso si antes era owner. Una mascota inexistente o sin membership propia devuelve `404 PET_NOT_FOUND`. UUID inválido o nil, query params inesperados o body no vacío devuelven `400 INVALID_REQUEST`; un token ausente o inválido devuelve `401 UNAUTHENTICATED`.

Leave ahora devuelve `204` sin representación, reemplazando la respuesta JSON `200` anterior. Los clientes ya no deben esperar datos de membership en la respuesta. Consulta [Pet leave](docs/pet-leave.md) para la decisión de dominio y el protocolo de locks transaccionales.

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

Consulta [Lecturas de miembros de mascotas](docs/pet-members-read.md) para conocer
la frontera de consulta de email, la consistencia de lectura y la deuda técnica
separada sobre la FK ausente entre memberships y accounts.

## Verificación

```bash
pnpm lint
pnpm test
pnpm build
```
