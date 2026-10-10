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

La API expone 35 operaciones.

| Ruta                                          | Descripción                 | Token Bearer |
| --------------------------------------------- | --------------------------- | ------------ |
| `GET /`                                       | Mensaje de bienvenida       | No           |
| `POST /accounts`                              | Registrar cuenta            | No           |
| `POST /auth/login`                            | Obtener token               | No           |
| `GET /pets`                                   | Listar mascotas accesibles  | Sí           |
| `GET /pets/{petId}`                           | Consultar perfil de mascota | Sí           |
| `GET /pets/{petId}/members`                   | Listar miembros actuales | Sí           |
| `DELETE /pets/{petId}/members/{membershipId}` | Remover acceso de otro miembro | Sí |
| `POST /pets/{petId}/members/{membershipId}/promote` | Promover colaborador a owner | Sí |
| `PATCH /pets/{petId}`                         | Corregir perfil de mascota | Sí           |
| `POST /pets`                                  | Registrar mascota           | Sí           |
| `POST /pets/{petId}/invitations`              | Invitar colaborador         | Sí           |
| `POST /pets/{petId}/archive` | Archivar una mascota | Sí |
| `POST /pets/{petId}/restore` | Restaurar una mascota | Sí |
| `POST /pets/{petId}/leave`                    | Abandonar una mascota  | Sí           |
| `POST /pets/{petId}/health/medical-conditions` | Registrar una condición médica conocida y actual | Sí |
| `GET /pets/{petId}/health/medical-conditions` | Consultar condiciones médicas registradas | Sí |
| `PATCH /pets/{petId}/health/medical-conditions/{conditionId}` | Corregir información de una condición médica registrada | Sí |
| `POST /pets/{petId}/health/medical-conditions/{conditionId}/resolve` | Resolver una condición médica activa | Sí |
| `POST /pets/{petId}/health/medical-conditions/{conditionId}/reopen` | Corregir una resolución errónea de condición médica | Sí |
| `DELETE /pets/{petId}/health/medical-conditions/{conditionId}` | Eliminar un registro erróneo de condición médica | Sí |
| `POST /pets/{petId}/health/allergies` | Registrar una alergia conocida de la mascota | Sí |
| `GET /pets/{petId}/health/allergies` | Consultar alergias conocidas de la mascota | Sí |
| `PATCH /pets/{petId}/health/allergies/{allergyId}` | Corregir una alergia conocida | Sí |
| `DELETE /pets/{petId}/health/allergies/{allergyId}` | Eliminar un registro erróneo de alergia | Sí |
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

Para archivar una mascota, envía `POST /pets/{petId}/archive` como owner activo. El éxito es `204 No Content`, también en retries sobre una mascota archivada después de volver a comprobar la autorización del owner. Un retry no ejecuta UPDATE y conserva `pets.updated_at`; una transición real lo cambia mediante el trigger existente. Archive conserva el perfil, memberships, invitaciones pendientes e historial Health. Collaborators, miembros inactivos, ausencia de membership y mascotas inexistentes reciben `404 PET_NOT_FOUND`. El ID debe ser un UUID non-nil. Envía sin query parameters y sin body o con `{}`; una estructura inválida devuelve `400 INVALID_REQUEST`. Un token Bearer ausente o inválido devuelve `401 UNAUTHENTICATED`.

Para restaurar una mascota archivada, envía `POST /pets/{petId}/restore` como owner activo. Archive realiza `ACTIVE → ARCHIVED`; Restore realiza `ARCHIVED → ACTIVE`. Ambos devuelven `204 No Content` y son idempotentes después de comprobar la autorización del owner activo: un retry autorizado no ejecuta UPDATE ni cambia timestamps. Restore conserva perfil, memberships (incluidos miembros inactivos), todos los estados y fechas de expiración de invitaciones e historial Health. Una invitación pendiente vigente puede volver a aceptarse mediante las reglas existentes; las vencidas no reviven. Restore usa el mismo contrato de Bearer, UUID non-nil, query vacío y body ausente/vacío y los errores `400 INVALID_REQUEST`, `401 UNAUTHENTICATED` y `404 PET_NOT_FOUND` de Archive.

`GET /pets` incluye mascotas activas y archivadas con membership activa del requester y expone `status` en cada summary. `GET /pets/{petId}` también permite ambos estados para miembros activos. Las mascotas archivadas siguen siendo legibles mediante Members e historiales Health, y Leave sigue disponible. Los cambios de perfil, invitaciones, remoción/promoción de miembros y todas las escrituras Health requieren una mascota activa. Las invitaciones pendientes se conservan; aceptar una invitación pendiente vigente sobre una mascota archivada devuelve `409 INVITATION_NOT_ACCEPTABLE` sin conceder acceso. Cancel requiere una mascota activa; Reject sigue disponible según el lifecycle de la invitación. Consulta [pet archive](docs/pet-archive.md) para el orden de locks y concurrencia.

Para listar los miembros actuales, envía `GET /pets/{petId}/members` con un token Bearer y sin body ni query parameters. Owners y collaborators activos pueden consultar mascotas activas o archivadas. La respuesta completa `200` es `{"members":[{"membershipId":"...","accountId":"...","email":"owner@example.com","role":"OWNER"}]}`. Incluye únicamente memberships activas, también la del requester y todos los owners; excluye invitaciones pendientes. Primero aparecen los owners y después los collaborators; dentro de cada rol se ordena por fecha de creación de la membership y luego por ID de membership, ambos ascendentes. Un UUID inválido o nil o un query parameter inesperado devuelve `400 INVALID_REQUEST`; un token ausente o inválido devuelve `401 UNAUTHENTICATED`. Una mascota inexistente, una membership ausente o una membership inactiva del requester devuelve `404 PET_NOT_FOUND`.

Para remover a otro miembro de una mascota, envía `DELETE /pets/{petId}/members/{membershipId}` como owner activo de una mascota activa. Identifica al destinatario mediante el `membershipId` persistente que devuelve List Pet Members. Se pueden remover owners y colaboradores; cambia únicamente el estado a `INACTIVE`, conservando membership ID, account ID, rol y fecha de creación. El éxito devuelve `204` sin cuerpo, incluidos los reintentos sobre otro owner o colaborador inactivo. Un retry no ejecuta UPDATE y conserva `updated_at`; una transición real cambia `updated_at`. Removerse a uno mismo devuelve `409 SELF_REMOVAL_NOT_SUPPORTED`, incluso siendo el último owner; utiliza `POST /pets/{petId}/leave`. Una mascota inexistente, archivada o inaccesible devuelve `404 PET_NOT_FOUND` antes de resolver el destinatario o aplicar idempotencia. Solo después de autorizar al owner, una membership inexistente o de otra mascota devuelve `404 PET_MEMBER_NOT_FOUND`. Cada retry vuelve a verificar la autorización. Ambos IDs deben ser UUID válidos y no nil. Envía la solicitud sin query params y sin cuerpo o con `{}`; una estructura inválida devuelve `400 INVALID_REQUEST`. Un Bearer token ausente o inválido devuelve `401 UNAUTHENTICATED`. El dominio conserva `LAST_OWNER_CANNOT_BE_REMOVED` como resultado defensivo interno, no como caso HTTP normal: un requester autorizado distinto del target permanece como owner activo. Consulta [member removal](docs/pet-member-removal.md) para el protocolo transaccional y la concurrencia.

Para promover a un colaborador, envía `POST /pets/{petId}/members/{membershipId}/promote` como owner activo de una mascota activa. Un collaborator activo pasa a owner activo en la misma membership, conservando su ID, cuenta y fecha de creación. Un owner activo, incluido el requester, recibe `204` sin UPDATE ni cambio de `updated_at`. Un miembro inactivo devuelve `409 PET_MEMBER_INACTIVE` y no se reactiva. Una mascota inexistente, archivada o inaccesible devuelve `404 PET_NOT_FOUND` antes de resolver el destinatario; una membership inexistente o de otra mascota devuelve después `404 PET_MEMBER_NOT_FOUND`. Ambos IDs deben ser UUID válidos y no nil. Envía la solicitud sin query params y sin cuerpo o con `{}`; una estructura inválida devuelve `400 INVALID_REQUEST`. Un Bearer token ausente o inválido devuelve `401 UNAUTHENTICATED`.

Para corregir el perfil de una mascota, envía `PATCH /pets/{petId}` como owner activo de una mascota activa. Incluye al menos uno de `name`, `species`, `breed`, `sex`, `birthInformation`, `color`, `distinctiveMarks` o `microchip`. Los objetos `breed` y `birthInformation` usan las mismas estructuras completas que el registro. Los campos omitidos se conservan; envía `null` para limpiar `color`, `distinctiveMarks` o `microchip`. La respuesta `200` tiene la misma estructura que `GET /pets/{petId}`, con `role: "OWNER"`. Un no-op después de normalizar no cambia `updated_at`. Una estructura HTTP inválida devuelve `400 INVALID_REQUEST`; un valor rechazado por el dominio devuelve `422 INVALID_PET`. Una mascota inexistente, archivada o inaccesible devuelve `404 PET_NOT_FOUND`.

Para registrar una condición médica conocida y actual, envía `POST /pets/{petId}/health/medical-conditions` con Bearer y JSON como `{"name":"Epilepsy","diagnosedDate":"2026-03-14","notes":"Recurring seizures monitored by veterinarian."}`. Owners y collaborators activos de mascotas activas reciben `201` con exactamente `id`, `petId`, `name`, `status`, `diagnosedDate` nullable, `resolvedDate` nullable, `notes` nullable y `recordedByAccountId`. Cada condición tiene identidad independiente. El lifecycle distingue `ACTIVE` de `RESOLVED`, pero Record siempre crea `ACTIVE` y no admite status enviado por el cliente ni condiciones ya resueltas. ACTIVE significa una condición reportada como vigente, sin expresar gravedad ni certificación profesional. `diagnosedDate` es la fecha exacta conocida del diagnóstico reportado, no el inicio de síntomas ni cuándo el owner conoció la condición; no acredita un diagnóstico profesional. Admite una fecha civil completa y válida `YYYY-MM-DD`, no posterior a hoy UTC. Omítela o envía null si se desconoce o solo se conoce aproximadamente; no hay campo de exactitud ni fechas parciales. Name es obligatorio, aplica trim, conserva casing y admite hasta 255 puntos de código Unicode. Notes es opcional, aplica trim y admite hasta 2,000 puntos de código Unicode; omisión/null representan ausencia, pero texto presente vacío o solo whitespace es inválido. El nombre no define identidad clínica: se permiten duplicados con IDs diferentes, sin catálogo ni deduplicación automática. La autoría identifica a la cuenta autenticada que registró el dato, no a un veterinario ni un permiso permanente. El body es estricto y no admite query params. La autenticación precede a validación HTTP, incluido JSON malformado; los valores de dominio se validan antes del acceso transaccional. Errores de estructura/path/query devuelven `400 INVALID_REQUEST`; los semánticos devuelven `400 INVALID_MEDICAL_CONDITION_NAME`, `INVALID_MEDICAL_CONDITION_DIAGNOSED_DATE` o `INVALID_MEDICAL_CONDITION_NOTES`. Autenticación ausente/inválida devuelve `401 UNAUTHENTICATED`; mascotas inexistentes/archivadas, memberships inactivas o ausencia de membership devuelven `404 PET_NOT_FOUND`. Autorización e INSERT son atómicos bajo READ COMMITTED con locks Pet → Membership del requester. Los timestamps técnicos quedan en persistence; Archive/Restore conserva condiciones y timestamps. Están disponibles Record, List, Update, Resolve, Reopen y Delete para condiciones médicas. No se incluyen gravedad genérica, tratamientos, medicamentos ni relaciones con veterinarios.

Para corregir información de una condición médica registrada, envía `PATCH /pets/{petId}/health/medical-conditions/{conditionId}` con Bearer y al menos uno de `name`, `diagnosedDate` o `notes`, por ejemplo `{"name":"Osteoarthritis","diagnosedDate":"2026-02-10","notes":"Confirmed during veterinary examination."}`. Los campos omitidos se conservan; `diagnosedDate: null` elimina la fecha conocida y `notes: null` elimina las notas. `name: null` es inválido. Name y notes mantienen sus reglas de trim, límites Unicode y texto no vacío. Se pueden corregir condiciones ACTIVE y RESOLVED; se preservan identidad, autor original y status clínico. Update no significa Resolve ni Reopen, no crea otra condición ni añade historial. La respuesta completa `200` contiene exactamente `id`, `petId`, `name`, `status`, `diagnosedDate` nullable, `resolvedDate` nullable, `notes` nullable y `recordedByAccountId`. Un no-op normalizado devuelve la representación actual sin UPDATE físico ni cambio de timestamps.

Owners y collaborators activos de una Pet ACTIVE pueden corregir registros de otro Account, incluso después de que su autor abandone la mascota. Las mascotas archivadas permanecen read-only. Ambos path IDs deben ser UUID non-nil; el body parcial es estricto y no se aceptan query params. La precedencia es autenticación (`401 UNAUTHENTICATED`), estructura HTTP (`400 INVALID_REQUEST`), Pet writable y acceso del requester (`404 PET_NOT_FOUND`), target por condition ID y pet ID (`404 PET_MEDICAL_CONDITION_NOT_FOUND`) y validación semántica con los códigos existentes `400 INVALID_MEDICAL_CONDITION_NAME`, `INVALID_MEDICAL_CONDITION_DIAGNOSED_DATE` e `INVALID_MEDICAL_CONDITION_NOTES`. Los locks READ COMMITTED siguen Pet → Membership del requester → Medical Condition; la reconstrucción utiliza la fila bloqueada y evita lost updates o acceso stale frente a Archive/Restore y Leave/Remove. Clock se consulta una sola vez después de esos locks y de encontrar el target. Las fechas de diagnóstico explícitas deben ser fechas de calendario válidas no posteriores a ese día UTC; las persistidas se reconstruyen estructuralmente y las omitidas se conservan sin aplicar la restricción temporal de una fecha nueva. No se exponen timestamps técnicos.

Para resolver una condición activa, envía `POST /pets/{petId}/health/medical-conditions/{conditionId}/resolve` con Bearer y un body estricto obligatorio como `{"resolvedDate":"2026-09-15"}` o `{"resolvedDate":null}` si la fecha clínica exacta se desconoce o solo se conoce aproximadamente. No hay fecha implícita ni default a hoy. Las fechas conocidas deben ser fechas civiles completas YYYY-MM-DD válidas, no posteriores a hoy UTC; no se exige orden respecto a diagnosedDate porque el diagnóstico reportado puede ser retrospectivo. Owners y collaborators activos de mascotas ACTIVE pueden resolver registros de otra cuenta. Resolve realiza ACTIVE → RESOLVED y conserva identidad, autor, diagnóstico, nombre y notas; la condición permanece como historial clínico. ACTIVE siempre tiene resolvedDate null; RESOLVED admite fecha o null, por lo que status es la fuente de verdad. Record devuelve resolvedDate null; Record, List, Update, Resolve y Reopen incluyen siempre el campo nullable. Update conserva status y resolvedDate y no admite ninguno en PATCH. List conserva su proyección sin petId y permite leer mascotas ARCHIVED, que permanecen read-only. Un reintento autorizado devuelve 200 y la representación actual sin UPDATE físico ni cambio de timestamps; un reintento exitoso nunca modifica la fecha de resolución existente, incluso si una nueva fecha string estructuralmente válida es semánticamente inválida. El campo obligatorio y el body estricto siguen aplicando a reintentos. No se admiten query params. Autenticación precede a validación de estructura HTTP, seguida de autorización de Pet, búsqueda del target y validación de Domain. Mascotas inexistentes/inaccesibles/archivadas devuelven 404 PET_NOT_FOUND; condiciones inexistentes o de otra mascota devuelven 404 PET_MEDICAL_CONDITION_NOT_FOUND; fechas inválidas para una primera resolución devuelven 400 INVALID_MEDICAL_CONDITION_RESOLVED_DATE. Resolve usa locks READ COMMITTED Pet → Membership del requester → MedicalCondition, consulta HEALTH_CLOCK una vez después de encontrar el target bloqueado y conserva fechas históricas persistidas sin compararlas con el Clock actual. Get Detail no está disponible para condiciones médicas.

Para corregir una resolución registrada por error, envía `POST /pets/{petId}/health/medical-conditions/{conditionId}/reopen` con Bearer y sin body o con `{}`. Resolve registra que una condición se resolvió; Reopen corrige una resolución errónea, no una recurrencia clínica ni recaída. Realiza RESOLVED → ACTIVE y establece `resolvedDate` en null, conservando el ID de condición, ID de mascota, cuenta autora original, nombre, fecha de diagnóstico y notas. **La fecha anterior de resolución se elimina permanentemente; el sistema no conserva ni audita un historial de transiciones.** El registro médico permanece, pero su resolución anterior no puede reconstruirse. El modelo actual no puede verificar la intención del usuario ni representar episodios. Owners y collaborators activos de mascotas ACTIVE pueden reabrir condiciones de otra cuenta. Las mascotas ARCHIVED siguen siendo legibles para miembros activos, pero no writable. Un Reopen autorizado sobre ACTIVE devuelve la representación completa actual con 200, sin UPDATE físico ni cambios de timestamps. La idempotencia corresponde al estado actual: si ocurre un nuevo Resolve entre requests, un Reopen posterior puede volver a cambiar el estado; no se implementan idempotency keys. Bodies no vacíos, propiedades inesperadas, arrays, scalars, JSON null, JSON malformado y cualquier query param devuelven 400 INVALID_REQUEST. Autenticación precede a validación de path/body/query, seguida de autorización de Pet y búsqueda del target: Bearer ausente/inválido devuelve 401 UNAUTHENTICATED; mascotas inexistentes/archivadas/inaccesibles devuelven 404 PET_NOT_FOUND; condiciones inexistentes o de otra mascota devuelven 404 PET_MEDICAL_CONDITION_NOT_FOUND. No hay 403 ni conflicto por una condición ya ACTIVE. Los locks READ COMMITTED Pet → Membership del requester → MedicalCondition protegen atómicamente autorización y transición. Solo se actualizan status y resolved_date ante una transición real; created_at y los demás datos se conservan, y el trigger existente actualiza updated_at. Reopen no utiliza Clock. Un List iniciado después del commit observa el estado confirmado salvo que otro comando haya confirmado posteriormente. Recurrencias, episodios, historial de transiciones y auditoría de resoluciones quedan fuera de la funcionalidad implementada.

Para eliminar una condición médica registrada por error, envía `DELETE /pets/{petId}/health/medical-conditions/{conditionId}` con Bearer y sin body o con `{}`. Delete elimina física y permanentemente el registro incorrecto de `health_pet_medical_conditions`; no representa resolución clínica, recuperación, recaída, finalización de tratamiento ni cambio de status. Utiliza Resolve para una condición que existió realmente y dejó de estar activa: Resolve conserva el registro como historial clínico. Se pueden eliminar condiciones ACTIVE y RESOLVED, con fecha de resolución conocida o null; no se exige Resolve previo ni se modifica status o fechas antes de borrar. Owners y collaborators activos de mascotas ACTIVE pueden eliminar registros de otra cuenta. Las mascotas ARCHIVED siguen siendo legibles, pero son read-only. La eliminación devuelve `204 No Content` sin body; un segundo DELETE autorizado devuelve `404 PET_MEDICAL_CONDITION_NOT_FOUND`. Un List iniciado después del commit ya no incluye el registro eliminado. **No se conserva la condición eliminada ni su historial: no hay auditoría de eliminación, tombstone, motivo, soft delete ni restauración.** Los IDs deben ser UUID non-nil, no se admiten query params y el body debe estar ausente o ser un objeto JSON vacío. La autenticación precede a validación HTTP, incluido JSON malformado: la precedencia es `401 UNAUTHENTICATED` → `400 INVALID_REQUEST` → `404 PET_NOT_FOUND` → `404 PET_MEDICAL_CONDITION_NOT_FOUND`. Mascotas inexistentes/archivadas y memberships inexistentes/inactivas devuelven PET_NOT_FOUND, sin 403; una condición de otra mascota es indistinguible de un target inexistente. Delete usa READ COMMITTED y locks Pet → Membership del requester → MedicalCondition, busca y borra por condition ID y pet ID, sin Clock ni lectura postcommit.

Para consultar condiciones médicas registradas, envía `GET /pets/{petId}/health/medical-conditions` con un token Bearer. Owners y collaborators activos pueden leer mascotas ACTIVE o ARCHIVED; las archivadas siguen siendo read-only. La respuesta es `{ "items": [...] }` con todas las condiciones registradas, tanto `ACTIVE` como `RESOLVED`, conservando duplicados como registros independientes. Cada elemento contiene exactamente `id`, `name`, `status`, `diagnosedDate`, `resolvedDate`, `notes` y `recordedByAccountId`; fecha y notas siempre están presentes y son nullable. `diagnosedDate` conserva la fecha exacta conocida del diagnóstico reportado como fecha civil `YYYY-MM-DD`; fechas desconocidas o solo aproximadas permanecen null. Se omiten el ID de mascota, timestamps técnicos y enriquecimiento de Identity. El orden es `diagnosed_date DESC NULLS LAST, created_at DESC, id DESC`: fechas conocidas de más reciente a más antigua y después fechas desconocidas, con timestamp técnico de creación e ID para desempatar. La creación no representa una fecha clínica ni garantiza el orden de commits concurrentes. Mascotas accesibles sin condiciones devuelven `{ "items": [] }`. Mascotas inexistentes, memberships inactivas o ausencia de membership devuelven `404 PET_NOT_FOUND`; la autoría no concede acceso permanente y los registros permanecen visibles para miembros autorizados después de que su autor abandone la mascota. IDs inválidos o nil y cualquier query param devuelven `400 INVALID_REQUEST`; autenticación ausente/inválida devuelve `401 UNAUTHENTICATED`. No hay filtros, búsqueda, paginación ni orden configurable. Acceso y colección se leen en un solo statement SQL con snapshot READ COMMITTED, sin transacción explícita ni locks de filas. Los writes sin commit no son visibles; una lectura posterior al commit observa el estado confirmado. Un índice simple no único sobre `pet_id` localiza la colección y PostgreSQL ordena las filas seleccionadas.

Para registrar una alergia conocida en Health, envía `POST /pets/{petId}/health/allergies` con un token Bearer y JSON como `{"allergen":"Penicillin","category":"MEDICATION","severity":"SEVERE","notes":"Previous reaction reported by veterinarian."}`. Owners y collaborators activos de mascotas activas reciben `201` con `id`, `petId`, `allergen`, `category`, `severity`, `notes` nullable y `recordedByAccountId` de la cuenta autenticada. Allergen aplica trim, conserva mayúsculas/minúsculas y admite entre 1 y 255 caracteres Unicode. Category es `FOOD`, `MEDICATION`, `ENVIRONMENTAL` u `OTHER`; severity es obligatoria y debe ser `MILD`, `MODERATE`, `SEVERE` o `UNKNOWN`. Severity expresa gravedad conocida o reportada, sin representar un diagnóstico formal. Notes es opcional, aplica trim y admite hasta 2,000 caracteres Unicode; omisión o null representan ausencia, pero texto presente vacío es inválido. El body es estricto. Los errores estructurales devuelven `400 INVALID_REQUEST`; los semánticos, `400 INVALID_ALLERGEN`, `INVALID_ALLERGY_CATEGORY`, `INVALID_ALLERGY_SEVERITY` o `INVALID_ALLERGY_NOTES`. La autenticación ausente/inválida devuelve `401 UNAUTHENTICATED`; mascotas inexistentes, archivadas o inaccesibles devuelven `404 PET_NOT_FOUND`. Se permiten duplicados. Las alergias no tienen fecha clínica de identificación ni estado de lifecycle. Los timestamps técnicos permanecen en persistence y Archive/Restore conservan los datos de alergia. La autorización y el INSERT son atómicos bajo locks Pet → Membership. Están disponibles la creación, la consulta, la corrección y la eliminación.

Para corregir una alergia existente, envía `PATCH /pets/{petId}/health/allergies/{allergyId}` con al menos uno de `allergen`, `category`, `severity` o `notes`. El body es estricto y no se aceptan query params. Los campos omitidos se conservan; `notes: null` elimina las notas, mientras los demás campos no admiten null. Se aplican las reglas de normalización y validación de creación. La respuesta `200` tiene la misma representación completa que POST y conserva identidad, mascota y `recordedByAccountId`, que identifica al autor original, no a quien corrigió. Un no-op normalizado no ejecuta UPDATE ni cambia `updated_at`; una corrección real conserva `created_at` y el trigger actualiza `updated_at`. Owners y collaborators activos pueden corregir registros de otros autores únicamente en mascotas activas. Autenticación y validación HTTP preceden al acceso: mascotas inexistentes, archivadas o inaccesibles devuelven `404 PET_NOT_FOUND`; después, un target ausente o de otra mascota devuelve `404 PET_ALLERGY_NOT_FOUND`; finalmente se valida el dominio con los mismos códigos 400 de creación. La transacción READ COMMITTED bloquea Pet → Membership → PetAllergy y reconstruye el estado actual antes de corregir, evitando lost updates. Los duplicados siguen permitidos.

Para eliminar un registro erróneo de alergia, envía `DELETE /pets/{petId}/health/allergies/{allergyId}` con un token Bearer. El hard delete corrige datos que no deberían existir; no significa resolución clínica, curación ni tolerancia. Owners y collaborators activos pueden eliminar registros de cualquier autor únicamente en mascotas ACTIVE; las mascotas archivadas son read-only para Health. Se acepta ausencia de body o `{}`; otros bodies JSON y cualquier query param devuelven `400 INVALID_REQUEST`. Ambos IDs deben ser UUID válidos non-nil. El éxito devuelve `204` sin body. La autenticación precede a validación HTTP, acceso a Pet y resolución del target: `401 UNAUTHENTICATED`, `400 INVALID_REQUEST`, `404 PET_NOT_FOUND` y `404 PET_ALLERGY_NOT_FOUND`, respectivamente. Un target ausente o de otra mascota, después de autorizar Pet, devuelve `PET_ALLERGY_NOT_FOUND`; un segundo DELETE también. La transacción READ COMMITTED bloquea Pet → Membership → PetAllergy y elimina únicamente el ID solicitado. Los duplicados restantes se conservan; eliminar el último registro deja `{ "items": [] }`. No se añade lifecycle, soft delete, historial ni migración.

Para consultar las alergias conocidas, envía `GET /pets/{petId}/health/allergies` con un token Bearer. Owners y collaborators activos pueden leer mascotas activas o archivadas. La respuesta `200` contiene `{ "items": [...] }` con todas las alergias registradas; una mascota accesible sin alergias devuelve `{ "items": [] }`. Cada elemento contiene `id`, `allergen`, `category`, `severity`, `notes` nullable y `recordedByAccountId`; se omiten `petId` y los timestamps técnicos. PostgreSQL ordena por `created_at DESC, id DESC`. Este orden técnico no representa una fecha de diagnóstico, inicio o reacción, ni garantiza el orden de commits concurrentes. Los duplicados permanecen como registros independientes. No hay paginación, filtros ni orden configurable; cualquier query param devuelve `400 INVALID_REQUEST`, al igual que un UUID de mascota inválido o nil. La autenticación ausente/inválida devuelve `401 UNAUTHENTICATED`; una mascota inexistente, membership inactiva o ausencia de membership devuelve `404 PET_NOT_FOUND`. La autoría original nunca concede acceso después de que la membership quede inactiva. Acceso y datos se consultan en un solo statement SQL sin locks de filas, usando su snapshot READ COMMITTED. Archive/Restore conserva alergias y timestamps. Un índice no único sobre `pet_id` permite localizar la colección; PostgreSQL ordena las filas seleccionadas.

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

Ejecuta `pnpm format` para aplicar el estilo del proyecto con ESLint y Prettier: indentación de cuatro espacios, ancho de 100 caracteres, llaves en control de flujo y líneas en blanco entre bloques lógicos y miembros de clases. Se utiliza rest/spread para proyecciones simples; las conversiones de dominio a respuestas se mantienen explícitas.

## Verificación

```bash
pnpm lint
pnpm test
pnpm build
```
