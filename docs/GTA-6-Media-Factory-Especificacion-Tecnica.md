# GTA 6 Media Factory
## Briefing actualizado y especificación técnica para Claude Code

**Versión:** 1.0  
**Fecha:** 17 de noviembre de 2026  
**Estado:** especificación de producto lista para iniciar discovery e implementación  
**Idioma de publicación:** español  
**Canales objetivo:** YouTube Shorts, Instagram Reels y TikTok

---

## 1. Resumen ejecutivo

GTA 6 Media Factory será una plataforma modular para detectar oportunidades editoriales sobre GTA 6, investigar y verificar información, preparar guiones en español, producir piezas audiovisuales verticales y adaptaciones por canal, programar o publicar mediante integraciones oficiales y aprender de sus resultados.

El sistema tendrá automatización de extremo a extremo como objetivo, con políticas configurables por etapa. No se publicará material dudoso, filtrado, sin licencia comprobable o que no supere las validaciones de calidad y derechos. Cuando la API, aprobación o política de una plataforma no permita publicación automática, el sistema generará un paquete listo para publicar y notificará al operador.

### Decisiones cerradas

| Área | Decisión |
|---|---|
| Material | Mixto: gameplay propio autorizado, clips/tráilers oficiales bajo revisión de derechos, imágenes y recursos generados con IA y recursos licenciados |
| Voz | Voz sintética profesional en español; conservar identificación del proveedor, licencia y consentimiento de voz |
| Automatización | Completa donde las APIs y políticas lo permitan; modo asistido como fallback |
| Cadencia | Adaptativa: oportunidad editorial × capacidad × estándar de calidad; sin cuota fija |
| Plataformas | Shorts, Reels y TikTok; conectores desacoplados |
| Optimización | Analítica por publicación y experimento controlado; no prometer viralidad ni crecimiento garantizado |

### Objetivos

1. Reducir el tiempo entre una noticia fiable y una pieza publicada.
2. Mantener consistencia editorial y visual, con formatos nativos por canal.
3. Aumentar alcance, retención y conversión a seguidores mediante aprendizaje basado en datos.
4. Conservar trazabilidad de fuentes, activos, licencias, transformaciones, aprobaciones y publicaciones.

### No objetivos de la primera versión

- Descargar o republicar filtraciones, copias del juego, material obtenido por scraping prohibido o contenido de terceros sin permiso.
- Automatizar interacción artificial, compra de seguidores, comentarios/likes masivos o evasión de límites de plataforma.
- Prometer ingresos, viralidad o una fecha/horario universalmente óptimo.
- Entrenar modelos con activos protegidos sin derechos.

---

## 2. Principios de producto y control

- **Fuente antes que velocidad:** cada afirmación factual relevante del guion debe vincularse a una o más fuentes y a una fecha de verificación.
- **Rights-aware:** ningún activo entra al render final sin origen, titular, licencia/permiso, restricciones y vencimiento registrados.
- **Automatización acotada:** publicación autónoma solo para contenido que cumpla política configurada y capacidades habilitadas; los bloqueos elevan a revisión humana.
- **Idempotencia:** una tarea reintentada no debe duplicar publicaciones.
- **Adaptación nativa:** render, duración, texto, título, descripción, hashtags, portada y CTA se preparan por plataforma.
- **Calidad por encima de volumen:** no publicar si la puntuación mínima de evidencia, derechos, audio, subtítulos o render no se alcanza.
- **Humano al mando:** controles de pausa global, pausa por canal, revocación de credenciales y anulación de programación.

### Modos de operación

1. **Draft:** investiga, propone y produce borradores; no publica.
2. **Approval:** automatiza hasta un paquete de publicación; requiere visto bueno por cada pieza.
3. **Autopublish:** publica cuando pasa todos los gates y la conexión de plataforma está aprobada. Debe activarse expresamente por canal y tipo de contenido.
4. **Degraded/manual:** si una API cae, expira una autorización o se rebasa una cuota, entrega archivos, metadatos y pasos de publicación manual.

Recomendación de salida inicial: Draft → Approval; activar Autopublish plataforma por plataforma después de pruebas y aprobación de API.

---

## 3. Arquitectura propuesta

### 3.1 Enfoque

Monolito modular con trabajos asíncronos en la primera versión. Mantiene límites de dominio para poder separar servicios si el uso lo exige, evitando el coste operativo prematuro de microservicios.

```text
Panel web / CLI
      │
API de aplicación ── Auth/RBAC ── Configuración y calendario
      │
Orquestador de workflows (Temporal; alternativa inicial: cola gestionada)
 ┌────┼─────────┬─────────┬──────────┬──────────┐
Fuentes  Editorial  Media   Publicadores  Analytics
         y guion   pipeline  por plataforma
 └────┴─────────┴─────────┴──────────┴──────────┘
      │                 │                   │
PostgreSQL         Object storage       APIs oficiales
Redis/cache        FFmpeg/workers       YouTube/Meta/TikTok
```

### 3.2 Módulos

- **Source Monitor:** conectores a feeds/RSS, comunicados oficiales, sitios autorizados y búsqueda web permitida. Mantiene deduplicación, fecha de publicación/actualización y capturas de evidencia.
- **Opportunity Scorer:** puntúa actualidad, relevancia para audiencia, novedad, evidencia, vida útil, saturación estimada, dificultad y riesgo de derechos. La puntuación ordena oportunidades; no decide por sí sola ante riesgo alto.
- **Editorial Studio:** genera brief, estructura de guion, variantes de hook, CTA, título, descripción y adaptaciones por canal. Incluye referencias por afirmación y etiquetas de incertidumbre.
- **Rights Registry:** inventario de activos, licencias, restricciones territoriales/temporales, uso comercial, atribución y comprobantes.
- **Media Pipeline:** selección de activos autorizados, TTS, composición, gráficos/subtítulos, loudness, render, miniaturas, verificación técnica y huellas del resultado.
- **Scheduler:** calendario en zona horaria configurable, ventanas elegibles por canal, límites de frecuencia, capacidad de workers y slots reservados.
- **Publisher Adapters:** interfaz común para validar, subir, programar, consultar estado y registrar errores por plataforma.
- **Analytics:** ingestión de métricas disponibles, normalización, cohortes temporales, experimentos y recomendaciones.
- **Admin Console:** colas, trabajos, calendario, conexión de cuentas, revisión editorial/derechos, métricas, logs y controles de emergencia.

### 3.3 Stack recomendado

- **Lenguaje/API:** TypeScript + Node.js LTS; NestJS o Fastify. Tipos compartidos con Zod.
- **Frontend:** Next.js + React; panel inicialmente de uso privado.
- **Persistencia:** PostgreSQL; migraciones Prisma o Drizzle.
- **Workflows:** Temporal para reintentos, señales, cron y procesos largos. MVP puede empezar con BullMQ/Redis si Temporal añade demasiada operación.
- **Cola/cache:** Redis gestionado; separar colas de render pesado y publicación.
- **Media:** FFmpeg con filtros reproducibles; workers contenedorizados. Evaluar Remotion para motion graphics programáticos; no obligar a una dependencia SaaS de editor.
- **Archivos:** almacenamiento S3 compatible con URLs firmadas, cifrado y lifecycle policies.
- **IA:** proveedor abstracto por interfaz para LLM, speech-to-text y TTS; configurar modelos y coste. No fijar proveedor irreversible. Mantener prompts versionados y salidas estructuradas.
- **Observabilidad:** OpenTelemetry, logs estructurados, métricas y alertas; Sentry o equivalente para errores.
- **Despliegue:** Docker; entorno gestionado con workers escalables. IaC con Terraform cuando haya entorno estable.
- **Secretos:** gestor de secretos del proveedor de nube; nunca `.env` en Git ni tokens en logs.

---

## 4. Flujos de trabajo

### 4.1 Investigación y selección

1. Ejecutar fuentes según calendario configurable o señal de noticia.
2. Normalizar título, URL canónica, editor, fecha original, fecha de observación y extracto permitido.
3. Deduplicar por URL, similitud y entidad/evento.
4. Clasificar como confirmada, reportada, rumor o especulación.
5. Para afirmaciones sensibles, requerir dos fuentes fiables independientes o una fuente primaria oficial; mostrar discrepancias.
6. Puntuar oportunidad y riesgo. Descartar filtraciones y material cuya procedencia no se pueda establecer.
7. Guardar una ficha que incluya razones, fuentes y expiración de relevancia.

### 4.2 Guion

1. Generar brief de 20–60 segundos como rango inicial configurable, con hook temprano, contexto, desarrollo, cierre/CTA.
2. Adjuntar `claim_refs[]` a cada afirmación verificable.
3. Producir guion de voz, texto en pantalla, pausas, pronunciación de nombres y notas visuales.
4. Comprobar español natural, exactitud, longitud, repetición, spoilers, afirmaciones inventadas y políticas editoriales.
5. Si hay rumor, etiquetarlo en el audio/copy como rumor/no confirmado; bloquear afirmación categórica.

### 4.3 Producción audiovisual

1. Resolver cada escena con prioridad: gameplay propio autorizado → material oficial cuyo uso esté permitido → imágenes/arte licenciados → recursos IA originales.
2. Validar derechos y restricciones antes de copiar el activo al proyecto de render.
3. Crear storyboard y mapa de tiempos desde el guion; respetar zonas seguras verticales.
4. Generar voz IA, normalizar pronunciación y revisar audio.
5. Componer video 9:16, subtítulos sincronizados, gráficos, música autorizada o sin música, marca propia y créditos cuando proceda.
6. Renderizar perfiles de salida configurables por plataforma y verificar códec, dimensiones, duración, tamaño, audio, subtítulos, cuadro negro y texto cortado.
7. Producir master limpio sin marcas de agua de otras plataformas; versiones por canal y una miniatura/portada si se admite.
8. Guardar manifiesto de render con hashes de fuentes y parámetros para reproducibilidad.

### 4.4 Programación y publicación

1. Calcular slots disponibles con zona horaria IANA (por defecto `Europe/Madrid`, editable), días laborables/festivos y ventanas por canal.
2. Recomendar horario según historial propio por audiencia y formato; si faltan datos, usar franjas de exploración y declarar baja confianza.
3. Respetar volumen adaptativo, máximos diarios/semanales configurables, cooldowns y capacidad de revisión/render.
4. Validar derechos, metadata, elegibilidad, credenciales, cuotas y estado del canal.
5. Ejecutar publicación con clave idempotente y estado por plataforma; registrar ID, URL, timestamp y respuesta saneada.
6. Verificar estado final con polling/backoff; reintentar solo fallos recuperables y nunca crear un segundo post si el resultado es incierto.
7. Si no hay publicación directa habilitada, generar paquete manual con video, copy, horario recomendado y checklist.

### 4.5 Analítica y aprendizaje

1. Ingerir métricas en ventanas (p. ej. 1 h, 24 h, 7 d, 28 d; configurables según API).
2. Comparar piezas por canal, duración, tipo de hook, tema, horario, formato y fuente de activo; no mezclar métricas incompatibles.
3. Normalizar por impresiones/alcance cuando se disponga; retención y visualizaciones se definen según cada API.
4. Recomendar cambios de calendario, hook, duración y temas con nivel de confianza y tamaño de muestra.
5. No ajustar automáticamente voz, claims, derechos, límites de publicación ni reglas de seguridad.
6. Mantener pruebas A/B de una variable principal y grupo de control cuando el volumen lo permita.

---

## 5. Cadencia y calendario configurables

Configuración editable desde panel y archivo versionado:

- zona horaria IANA; idioma/variante regional del español;
- ventanas de investigación, síntesis, producción, revisión y publicación;
- días activos, festivos, ventanas por plataforma y horarios de silencio;
- máximo de publicaciones por canal/día/semana y tiempo mínimo entre posts;
- capacidad simultánea de investigación, render y revisión humana;
- umbral de oportunidad, calidad, evidencia y rights clearance;
- duración y perfiles de exportación;
- límites de gasto diario/mensual para LLM, voz, stock y render;
- política de aprobación y tipos de contenido autopublicables.

**Regla de volumen:** producir/publicar si `score_oportunidad × confianza × valor_audiencia` supera el umbral y existe capacidad dentro de límites; no aumentar ritmo si la calidad/retención cae o hay cola pendiente. El algoritmo debe explicar por qué selecciona o rechaza una oportunidad.

El sistema no debe afirmar que conoce el “mejor horario” universal. Estima ventanas con datos de la cuenta, controla estacionalidad y muestra confianza. Con datos insuficientes usa un calendario exploratorio limitado.

---

## 6. Modelo de datos inicial

PostgreSQL; IDs UUID; timestamps UTC; conservar zona original de planificación.

| Entidad | Campos principales |
|---|---|
| `Source` | id, url, canonical_url, publisher, title, published_at, observed_at, source_type, trust_level, excerpt, content_hash |
| `Opportunity` | id, topic, summary, status, score, confidence, risk_flags, expires_at, source_ids, decision_reason |
| `Claim` | id, opportunity_id, text, certainty, source_ids, verified_at, reviewer_id |
| `Script` | id, opportunity_id, version, locale, voice_text, scene_plan, captions, CTA, status, prompt_version |
| `Asset` | id, kind, origin, owner, source_url, license_id, rights_status, territory, commercial_allowed, valid_until, attribution, hash, metadata |
| `License` | id, licensor, terms_url, proof_uri, scope, allowed_platforms, allowed_transformations, expiration, notes |
| `MediaProject` | id, script_id, template_version, asset_ids, TTS_provider, voice_id, disclosure_flags, render_profile |
| `Render` | id, project_id, storage_uri, checksum, duration, dimensions, codec, QC_result, created_at |
| `Publication` | id, render_id, platform, account_id, metadata_json, scheduled_at, published_at, external_id, permalink, status, idempotency_key, error_code |
| `MetricSnapshot` | id, publication_id, captured_at, views, reach, impressions, likes, comments, shares, saves, watch_time, avg_watch_time, followers_delta, raw_metric_names |
| `ScheduleRule` | id, platform, timezone, windows, limits, cadence_policy, approval_mode, enabled |
| `CredentialRef` | id, platform, account_id, secret_ref, scopes, granted_at, expires_at, status; solo referencia al gestor de secretos |
| `Approval` | id, target_type, target_id, reviewer, decision, reason, created_at |
| `AuditEvent` | id, actor, action, object_type, object_id, timestamp, request_id, safe_details |
| `Experiment` | id, hypothesis, variable, variants, start/end, status, result_summary |

Reglas: guardar solo los datos de terceros necesarios; retención configurable y borrado; acceso por rol; no persistir tokens directamente ni contenido íntegro de páginas si los términos no lo permiten.

---

## 7. Integraciones, APIs y estado de confirmación

Los endpoints y condiciones pueden cambiar. Antes de conectar una cuenta, validar documentación, scopes y aprobación vigentes; versionar adaptadores y probar en cuentas de desarrollo.

### YouTube Shorts

- **Publicación:** YouTube Data API v3 `videos.insert`, OAuth 2.0 con scope mínimo `youtube.upload`, subida reanudable; programar como privado con `status.publishAt` y `privacyStatus=private` cuando cumpla condiciones. La API no ofrece una API separada de Shorts: cargar el video vertical elegible con metadatos adecuados.
- **Analítica:** YouTube Analytics API y Data API para recursos disponibles; solicitar los scopes mínimos, respetar cuotas y reglas de datos.
- **Confirmable:** existe endpoint oficial de carga y posibilidad de programación con requisitos documentados. La cuota efectiva depende del proyecto y puede cambiar; consultar consola y proceso de extensión.
- **Dependencias:** proyecto Google Cloud, API habilitada, OAuth consent/configuración, autorización del canal y cuotas. Algunos proyectos/API auditados o no verificados pueden tener restricciones; verificar estado real del proyecto antes de asumir publicación pública.
- **Limitación:** Shorts y elegibilidad/visibilidad se rigen por criterios vigentes de YouTube, no por una bandera garantizada en la API.

### Instagram Reels

- **Publicación:** Instagram API/Graph API Content Publishing: crear contenedor de media Reel y publicar tras comprobar estado; flujo exacto, límites y host dependen de modalidad de login y versión.
- **Analítica:** insights de cuenta profesional y medios según permisos y campos admitidos.
- **Confirmable:** Meta documenta publicación de contenido para cuentas profesionales y una modalidad Instagram Login con permisos de publicación. Meta ha anunciado que esta modalidad puede evitar que sea necesaria una Página de Facebook.
- **Dependencias:** cuenta profesional apta, app Meta, permisos de publicación como `instagram_business_content_publishing` (Instagram Login) o scopes correspondientes de Instagram Graph API, OAuth, revisión de app/acceso avanzado cuando aplique y límites de publicación por cuenta. Confirmar el flujo disponible para la cuenta concreta.
- **Fallback:** notificación con archivo y copy si la app no tiene permiso, la cuenta no es apta o el formato queda fuera de especificación.

### TikTok

- **Publicación:** Content Posting API Direct Post; obtener información de creador, iniciar publicación y transferir video. Alternativa: flujo de carga a borrador/inbox si el producto aprobado lo permite.
- **Confirmable:** Direct Post existe y requiere app registrada, producto Content Posting, `video.publish`, autorización del usuario y configuración Direct Post. Clientes no auditados pueden quedar restringidos a publicación privada; la auditoría es necesaria para visibilidad pública en ese caso.
- **Dependencias:** aprobación del scope/app, consentimiento OAuth del usuario, auditoría, dominios verificados si se usa pull-from-URL, límites por usuario y UX requerida por TikTok. No diseñar el flujo suponiendo que el acceso público está concedido.
- **Fallback:** exportar MP4/copy para carga manual o usar el mecanismo de borrador aprobado.

### Fuentes y tendencias

- Priorizar páginas oficiales, newsroom, feeds permitidos, comunicados, APIs/licencias de búsqueda y fuentes abiertas que permitan uso automatizado. No depender de scraping de páginas con login, evadir CAPTCHA, ni acceder a endpoints privados. Implementar una interfaz `DiscoveryProvider` por proveedor y respetar términos, robots aplicables, cuotas y atribución.
- “Tendencia” no equivale a verdad: separar popularidad del nivel de evidencia.

### Texto a voz e IA

- Seleccionar proveedor con API comercial disponible para la cuenta, licencia explícita de voz, política de datos clara, controles de retención y calidad en español peninsular/latino según configuración.
- Registrar modelo/proveedor, versión, voz, fecha, consentimiento/licencia, texto y parámetros necesarios para reproducir; limitar almacenamiento de audio de entrada según política.
- Configurar aviso/etiqueta de contenido sintético cuando lo exija la política de la plataforma o jurisdicción. No clonar voz de una persona sin consentimiento verificable.

---

## 8. Derechos de autor, marcas y políticas

Este apartado es un control de producto, no un dictamen legal. Para monetización o uso frecuente de material oficial, obtener asesoría y permisos/licencias por escrito.

### Reglas operativas

- Gameplay: usar capturas propias de copias legítimas y seguir la política vigente del titular. La política pública de Rockstar describe uso ocasional no comercial de contenido de fans y se reserva retirada; excluye explotación comercial/publicitaria de ese permiso general. Este proyecto tiene objetivo de crecimiento y podría monetizar o promocionar una marca, por lo que no debe asumir que la política de fans cubre su caso. Consultar a Take-Two/Rockstar por permiso comercial antes de basar el negocio en gameplay/tráilers/arte protegidos.
- Tráilers, clips, capturas y arte oficiales: son material protegido; enlace o disponibilidad pública no significa licencia para reutilizar. Priorizar permiso escrito, uso expresamente autorizado o análisis/comentario transformativo revisado para cada jurisdicción; no automatizar una conclusión de “fair use/uso legítimo”.
- No usar filtraciones, builds no autorizadas, spoilers mayores o escenas aisladas de cinemáticas. Aplicar lista de bloqueo y escalamiento humano ante dudas.
- Música: usar música original, biblioteca con licencia comercial multiplataforma o audio autorizado en cada plataforma. Una licencia dentro de una app puede no cubrir exportación cruzada, monetización o uso fuera de esa plataforma.
- IA: utilizar recursos originales y proveedores con derechos de uso comercial; no imitar personajes/actores/voz identificable para inducir a error. Etiquetar cuando corresponda.
- Marcas: identidad visual propia; indicar que el canal es fan/editorial independiente cuando aplique; no sugerir afiliación oficial. Evitar logos y elementos de marca en portada salvo uso permitido.
- Cada pieza debe tener un manifiesto de derechos, con activo, titular, licencia/prueba, propósito, plataformas, periodo, territorio, transformación y atribución.
- Si se recibe reclamación: suspender publicación del activo afectado, bloquear reuso, preservar logs/licencia y abrir proceso de revisión. No disputar automáticamente reclamaciones.

### Gate de publicación de derechos

Publicar solo si todos los activos usados tienen estado `cleared` o `original`; `unknown`, `expired`, `restricted` o `disputed` bloquean Autopublish. Los clips oficiales y gameplay comercial deben poder marcarse como “requires_permission” hasta que se incorpore autorización explícita.

---

## 9. Seguridad, permisos y límites de automatización

### Seguridad

- OAuth con scopes mínimos, rotación y revocación; credenciales cifradas en gestor externo.
- RBAC: Admin, Editor, Rights Reviewer, Publisher, Analyst, Read-only. Permisos independientes de configuración, aprobación, publicación, credenciales y exportación.
- 2FA en consola si está disponible; sesiones cortas para acciones sensibles.
- URLs firmadas de corta duración para medios; cifrado en tránsito/reposo; aislamiento de workers de render.
- Validación y antivirus de archivos de entrada, límites de tamaño/tipo, protección SSRF en fetch, allowlist de dominios de medios.
- Sanitizar logs; no registrar tokens, prompts con secretos, enlaces firmados ni datos personales innecesarios.
- Auditoría inmutable de cambios de configuración, conexión, aprobación, publicación, borrado y anulación.
- Backups cifrados y prueba de restauración; borrado y retención definidos.

### Límites de automatización

Autopublish bloqueado cuando: fuente no verificable; score de evidencia bajo; rights clearance incompleto; guion contiene afirmaciones sin fuente; posible spoiler/filtración; calidad técnica fallida; disclaimer requerido ausente; canal/tokens expirados; API devuelve resultado ambiguo; límite/cuota superado; reclamación abierta; tema marcado sensible; sistema en pausa.

El sistema no puede autoelevar permisos, aceptar términos en nombre del usuario, solicitar aprobación de plataforma como si ya estuviese concedida, resolver reclamaciones de copyright, cambiar la política de derechos ni desactivar controles para alcanzar una cuota. Toda nueva plataforma inicia en Draft.

Controles: pausa global, pausa por canal, cancelar job, despublicación solo si API lo permite y la acción está autorizada, reintentos con backoff, circuit breaker y límites de coste.

---

## 10. Analítica y métricas

### Métricas operativas

- tiempo de oportunidad a guion/render/publicación;
- coste por pieza y por minuto renderizado;
- tasa de fallos/reintentos/duplicados evitados;
- porcentaje de piezas bloqueadas por verificación, derechos o calidad;
- disponibilidad de conectores y expiración de tokens.

### Métricas de contenido

- alcance/impresiones, reproducciones según definición de plataforma, retención, tiempo medio visto, porcentaje completado, interacción (me gusta, comentarios, compartidos, guardados), conversiones a seguidores y visitas al perfil.
- Rendimiento por tema, hook, duración, hora local, voz, estilo, formato de subtítulos y plataforma.
- Comparación de ventanas equivalentes y notas de cambios de definición de métricas.

### Reglas de análisis

- Mostrar fuente, fecha, ventana, tamaño de muestra y confianza.
- No atribuir causalidad a correlaciones ni declarar un ganador con muestra insuficiente.
- Recomendaciones automáticas solo modifican parámetros de bajo riesgo (p. ej. slots de prueba, variantes de hook) bajo límites; cambios de derechos, volumen máximo, tono/editorial o conexión requieren operador.
- Evitar recoger datos personales de comentaristas; analítica agregada siempre que sea posible.

---

## 11. Calidad y criterios de aceptación

### Funcionales

1. Crear y editar calendario por canal con timezone configurable, ventanas, máximos y modo de aprobación.
2. Ingerir fuentes configuradas, deduplicar y mostrar vínculo y fecha por afirmación factual.
3. Generar guion estructurado con variantes, notas visuales y claim refs; no inventar citas/fuentes.
4. Bloquear de manera reproducible cualquier activo sin rights clearance.
5. Renderizar video vertical configurable con subtítulos legibles y manifiesto de activos.
6. Validar archivos y metadatos contra perfiles por canal antes de subir.
7. Publicar de prueba/privado en integraciones habilitadas, persistir ID y estado, soportar reanudación sin duplicar.
8. Pasar automáticamente a modo manual ante permisos ausentes o APIs no disponibles.
9. Ingerir snapshots de analítica y presentar comparaciones por plataforma con métricas diferenciadas.
10. Registrar toda acción de aprobación, configuración y publicación en auditoría.

### No funcionales

- Reintentos idempotentes y recuperación de tareas tras reinicio.
- Objetivo inicial de disponibilidad del panel: 99.5% mensual, excluyendo APIs de terceros; ajustar a presupuesto.
- Ningún secreto aparece en logs o repositorio; escaneo automatizado en CI.
- Limitar coste, almacenamiento y frecuencia con presupuestos configurables.
- Accesibilidad básica del panel, controles de teclado y estados claros.
- Trazabilidad de cada pieza hasta versión de guion, fuentes, activos, render y publicación.

### Puertas de salida a producción

- Derechos/permisos revisados para los tipos de assets usados.
- OAuth y permisos probados con cuenta de prueba por plataforma.
- Apps aprobadas/auditadas donde sea necesario para el nivel de publicación previsto.
- Un ciclo completo en Draft y uno en Approval sin errores críticos.
- Publicación privada/no listada de validación donde la plataforma lo permita.
- Plan de rollback, revocación de token, pausa y recuperación documentados.

---

## 12. Estrategia de pruebas

No usar cuentas reales de audiencia para las pruebas iniciales.

- **Unitarias:** puntuación, zonas horarias/DST, selección de calendario, derechos, idempotencia, normalización métrica y políticas de bloqueo.
- **Contrato:** esquemas de proveedores, OAuth, scopes, respuestas, cuota y cambios de API; fixtures sanitizados.
- **Integración:** PostgreSQL, cola, almacenamiento, FFmpeg y conectores en entorno de desarrollo.
- **Media QC:** resolución, fps, codec, duración, audio presente, loudness objetivo, subtítulos dentro de safe zones, cuadros negros, archivo reproducible y hash.
- **E2E:** oportunidad → guion → assets → render → aprobación → publicación de prueba → consulta estado → métricas simuladas.
- **Seguridad:** autorización por rol, expiración/revocación, SSRF, carga de archivo, secretos, rate limiting y auditoría.
- **Resiliencia:** API caída, token expirado, timeout después de aceptación, cuota excedida, worker muerto y reintento sin duplicado.
- **Evaluación editorial:** benchmark de exactitud de claims, citas, rumores etiquetados, español natural y rechazo de filtraciones; revisión humana de muestra.
- **No automatizar** pruebas de publicación pública sin entorno/cuenta y autorización explícita de la plataforma.

---

## 13. Despliegue y operación

### Entornos

- Local: Docker Compose, datos ficticios y conectores simulados.
- Staging: cuentas de prueba, modo Draft/Approval por defecto, buckets separados y allowlist de URLs.
- Producción: una instancia de API, PostgreSQL gestionado, Redis, almacenamiento privado, workers con escalado por cola y scheduler redundante.

### CI/CD

- lint, typecheck, pruebas, análisis de dependencias, escaneo de secretos, build de imágenes, migraciones revisadas y despliegue gradual.
- Feature flags por plataforma y cuenta.
- Versionar perfiles de render, prompts, políticas de rights, calendarios y adaptadores.
- Alertar por fallo consecutivo, job atascado, tokens próximos a expirar, gasto cercano al límite o API incompatible.

### Recuperación

- Backups diarios y PITR si el proveedor lo soporta; lifecycle para medios temporales y masters.
- Runbook de caída de cada API, revocación de credenciales, reconciliación de estado incierto, borrado de publicación y reclamación de derechos.
- Tras timeout de publicación, consultar el estado externo antes de reintentar.

---

## 14. Plan de implementación por fases

### Fase 0 — Discovery y permisos (1–2 semanas estimadas)

- Confirmar modelo de negocio/monetización y derechos para gameplay, tráilers, capturas y marcas.
- Crear cuentas de desarrollador, revisar políticas vigentes, scopes, revisión y auditoría requeridos.
- Elegir proveedor de nube, voz, LLM, TTS y almacenamiento según presupuesto y residencia de datos.
- Entregables: matriz de permisos por canal, registro inicial de riesgos, decisiones de producto y esquema de datos aprobado.

### Fase 1 — Fundaciones (2–3 semanas)

- Repositorio, configuración tipada, autenticación/RBAC, PostgreSQL, auditoría, almacenamiento, cola y consola mínima.
- Simuladores de conectores y pipeline de jobs.
- Aceptación: tareas persistentes, roles y secretos sin exposición; pausa global funciona.

### Fase 2 — Investigación y editorial (2–3 semanas)

- Proveedores de fuentes permitidas, deduplicación, opportunity scoring, claims con evidencias, guion estructurado y calendario.
- Aceptación: cada claim tiene fuente o se etiqueta como opinión/rumor; no se produce una pieza con fuentes débiles sin alerta.

### Fase 3 — Media factory (2–4 semanas)

- Rights Registry, plantillas, TTS español, subtítulos, FFmpeg, perfiles verticales, QC y manifiestos.
- Aceptación: bloqueos de derechos demostrables; render repetible y legible en pantalla móvil.

### Fase 4 — Publicación y programación (2–4 semanas, según aprobación externa)

- Conectores primero en YouTube; Meta e Instagram; TikTok tras permisos y auditoría. Modo manual disponible desde el inicio.
- Aceptación: subir/programar y reconciliar estados sin duplicados en entorno habilitado; cada canal puede pausarse separadamente.

### Fase 5 — Analítica y optimización (2–3 semanas)

- Ingesta de métricas, panel de rendimiento, experimentos y recomendaciones con incertidumbre.
- Aceptación: reportes distinguen métricas de plataformas y no presentan inferencias con certeza falsa.

### Fase 6 — Lanzamiento controlado y escala

- 2–4 semanas de Approval, muestreo de calidad/derechos y autopublish gradual por tipos de piezas aprobadas.
- Aumentar capacidad solo si tasas de calidad, derechos y rendimiento cumplen los objetivos definidos.
- Aceptación: runbooks, límites, backups, alertas, respuesta a reclamaciones y rollback ejercitados.

Los plazos son estimaciones de planificación y dependen del equipo, cuentas, revisiones y aprobación de plataformas.

---

## 15. Riesgos y decisiones pendientes

| Riesgo/decisión | Tratamiento requerido |
|---|---|
| Derechos comerciales de material GTA 6 | Obtener autorización específica; diseñar biblioteca de assets originales/licenciados como fallback |
| Aprobación de APIs | No asumir; modo manual y simuladores desde el MVP |
| Políticas cambian | Revisión trimestral y antes de cada integración/versionado |
| Noticias falsas o filtraciones | Evidencia por claim, procedencia y bloqueo de filtraciones |
| Contenido IA etiquetado | Campo de disclosure configurable por plataforma y obligación vigente |
| Costes variables | Límites por proveedor y alertas; aprobación para subir presupuesto |
| Dependencia de un proveedor | Interfaces intercambiables y exportación de datos/assets |
| “Escalar rápido” afecta calidad | volumen adaptativo con gates; priorizar retención/calidad y aprendizaje |
| Cambios de cuenta/API | reconciliación, renovaciones OAuth, feature flags y publicación manual |

Decisiones a cerrar en Fase 0: presupuesto mensual, proveedor cloud/región, variante de español, identidad de marca, política de monetización, reglas de spoilers, nivel de revisión humana inicial y qué clases de assets tienen permiso escrito.

---

## 16. Estructura inicial de repositorio sugerida

```text
apps/
  web/                 # panel
  api/                 # REST y autenticación
  worker/              # workflows y jobs
packages/
  domain/              # entidades y políticas
  config/              # configuración tipada
  connectors/          # discovery, LLM, TTS, plataformas
  media/               # FFmpeg, plantillas y QC
  rights/              # licencias y decisión de publicación
  analytics/           # normalización y agregaciones
infra/
  docker/
  terraform/
docs/
  architecture.md
  rights-policy.md
  runbooks/
```

Empezar con límites de módulo claros y contratos, no con servicios separados. Añadir ADR para decisiones que afecten proveedor, permisos o política de publicación.

---

## 17. Prompt maestro para iniciar el desarrollo con Claude Code

```text
Actúa como ingeniero principal y arquitecto de software para construir GTA 6 Media Factory, una plataforma privada de investigación, producción audiovisual y publicación multiplataforma en español. La especificación de producto y técnica está en docs/GTA-6-Media-Factory-Especificacion-Tecnica.md (si el archivo no existe en el repo, pide que se copie o trabaja con el contenido entregado por el usuario). Léela completa antes de proponer cambios.

OBJETIVO
Construir de forma incremental un monolito modular con workflows asíncronos que investiga fuentes permitidas, organiza evidencia por afirmación, genera guiones, produce videos verticales con activos autorizados, programa contenido y publica mediante conectores oficiales aprobados; aprende de analítica disponible. La cadencia es adaptativa a oportunidades, capacidad, presupuesto y calidad. No hay cuota fija ni promesa de viralidad.

REGLAS NO NEGOCIABLES
1. No publiques contenido real durante desarrollo. Usa simuladores y modo Draft por defecto; cualquier prueba pública requiere autorización explícita del propietario de la cuenta y credenciales correctamente configuradas.
2. No asumas permisos de API. Antes de implementar cada publicador, comprueba la documentación oficial vigente, scopes, revisión/auditoría, cuotas, elegibilidad y UX exigida. Documenta capacidades confirmadas y dependencias externas; ofrece fallback manual.
3. No descargues ni uses filtraciones, contenido robado, material de cuentas privadas o scraping que infrinja términos. No consideres que un trailer público equivale a licencia. Todo activo debe tener derechos registrados y estado cleared/original para autopublish; en caso contrario bloquea.
4. No generes afirmaciones factuales sin fuentes. Cada claim del guion debe tener referencia, fecha y nivel de confianza; rumores deben etiquetarse. No inventes citas ni enlaces.
5. No clones voces identificables sin consentimiento/licencia. Registra proveedor, voz, licencia y avisos de contenido sintético requeridos.
6. Nunca guardes secretos en código, fixtures, logs o commits. Usa referencias a un gestor de secretos, scopes mínimos, RBAC y auditoría.
7. Publicación idempotente: al recibir timeout consulta el estado externo antes de reintentar. Nunca arriesgues duplicados por resultado ambiguo.
8. Mantén pausa global, pausa por canal, límites de gasto y límites de frecuencia. No los eleves automáticamente.
9. Mantén interfaces intercambiables para LLM, TTS, discovery y cada plataforma. No acoples la lógica de dominio a un único proveedor.
10. No añadas funciones no solicitadas que automaticen likes, comentarios, seguidores o evasión de límites.

FORMA DE TRABAJO
- Primero inspecciona el repo, las instrucciones AGENTS.md y el estado de git. Resume hallazgos y detecta conflictos con esta especificación.
- Convierte el plan por fases en tareas pequeñas con criterios observables. No intentes implementar toda la plataforma en un solo cambio.
- Antes de cada fase, presenta arquitectura afectada, decisiones y riesgos. Implementa el mínimo vertical completo y documenta cómo ejecutarlo.
- Mantén tipos estrictos, validación de entradas/salidas, errores tipados, logs estructurados saneados y migraciones revisables.
- Añade pruebas unitarias/contrato/integración pertinentes a cada cambio, especialmente para derechos, permisos, timezone/DST, idempotencia, estados ambiguos y publicación simulada.
- No conectes cuentas reales hasta que el usuario configure credenciales y aprobación. No muestres ni solicites tokens en chat.
- Actualiza docs, `.env.example` sin secretos, diagramas/ADRs y runbooks cuando el diseño cambie.
- Si una política, permiso o requisito está incierto, implementa bloqueo seguro y deja un adaptador/fallback; no inventes que la capacidad está disponible.

PRIMERA TAREA
Realiza solo discovery del repositorio y propone la Fase 1: estructura, stack concreto, módulos, modelo mínimo, riesgos, lista de archivos a crear/modificar y comandos de desarrollo. No escribas código hasta presentar ese plan. Si no hay repo, propone el esqueleto y espera la instrucción del usuario para iniciar implementación.
```

---

## Fuentes oficiales consultadas

- YouTube Data API, carga de videos: https://developers.google.com/youtube/data/guides/uploading_a_video
- YouTube `videos.insert`: https://developers.google.com/youtube/data/reference/rest/v3/videos/insert
- YouTube estado y programación (`publishAt`): https://developers.google.com/youtube/data/reference/rest/v3/videos
- YouTube APIs y cuota: https://developers.google.com/youtube/v3/getting-started
- Requisitos mínimos de clientes YouTube: https://developers.google.com/youtube/terms/required-minimum-functionality
- TikTok Content Posting API, inicio Direct Post: https://developers.tiktok.com/docs/en/content-posting-api-get-started
- TikTok Direct Post API: https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post
- Meta Instagram API changelog / Instagram Login y permisos: https://developers.facebook.com/docs/instagram/platform/instagram-api/changelog/
- Meta Page Video Reels API: https://developers.facebook.com/docs/graph-api/reference/page/video_reels/
- Meta Page Videos API: https://developers.facebook.com/docs/graph-api/reference/page/videos/
- Rockstar, política sobre material protegido: https://support.rockstargames.com/articles/7bNaeoMFTV0iUDGhStTXvz/policy-on-posting-copyrighted-rockstar-games-material
- Rockstar, audio de juegos y reclamaciones: https://support.rockstargames.com/articles/3f8XH01Kodw4zKnwbF6yTB/information-about-being-safe-from-copyright-strikes-when-uploading-rockstar-editor-videos

> Verificar de nuevo la documentación y políticas en Fase 0 y antes de habilitar Autopublish: APIs, scopes, cuotas, criterios de elegibilidad y términos se actualizan sin que esta especificación pueda garantizar su permanencia.
