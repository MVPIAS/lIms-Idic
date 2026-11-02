-- =============================================================================
-- Agenda de recursos y eventos · contrato §4.5.8 y §4.5.9
--
-- §4.5.8: agenda_recurso es el catálogo único de recursos materiales que se
-- reservan (vehículos, equipos, salas, servicios), con su horario disponible y
-- su valoración (costo por hora y costo fijo por uso). Puede apuntar a la ficha
-- de origen (equipo, vehiculo, ubicacion): un recurso ligado a un equipo cuenta
-- también como ocupado por la programación de análisis de ese equipo.
--
-- §4.5.9: agenda_evento guarda eventos únicos o recurrentes (diaria, semanal por
-- días, mensual; con fin por fecha o por número de repeticiones). Fechas en días
-- de calendario y horas de Chile; las ocurrencias las calcula la API
-- (apps/api/src/agenda/recurrencia.ts). Participantes y recursos en tablas
-- puente; agenda_evento_excepcion anula ocurrencias sueltas de una serie.
--
-- Permisos: agenda.ver (todo rol interno con ot.ver; CLIENTE no): ver el
-- calendario; agenda.crear (los mismos salvo LECTOR): crear eventos propios
-- y reservar recursos. recurso.gestionar: catálogo de
-- recursos, costos y editar eventos ajenos. Aditivo e idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS agenda_recurso (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenant(id),
  tipo           VARCHAR(12) NOT NULL,
  nombre         VARCHAR(120) NOT NULL,
  descripcion    TEXT,
  unidad_id      UUID REFERENCES unidad(id),           -- NULL = recurso institucional (todas las unidades)
  equipo_id      UUID REFERENCES equipo(id),
  vehiculo_id    UUID REFERENCES vehiculo(id),
  ubicacion_id   UUID REFERENCES ubicacion(id),
  capacidad      INT,
  costo_hora     NUMERIC(14,2),
  costo_uso      NUMERIC(14,2),
  moneda         VARCHAR(3) NOT NULL DEFAULT 'CLP',
  hora_desde     TIME NOT NULL DEFAULT '08:30',
  hora_hasta     TIME NOT NULL DEFAULT '17:30',
  dias_habiles   SMALLINT[] NOT NULL DEFAULT '{1,2,3,4,5}',
  activo         BOOLEAN NOT NULL DEFAULT TRUE,
  creado_por     UUID REFERENCES usuario(id),
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ,
  deleted_at     TIMESTAMPTZ,
  CONSTRAINT ck_agenda_recurso_tipo CHECK (tipo IN ('VEHICULO', 'EQUIPO', 'SALA', 'SERVICIO', 'OTRO')),
  CONSTRAINT ck_agenda_recurso_moneda CHECK (moneda IN ('CLP', 'USD')),
  CONSTRAINT ck_agenda_recurso_horario CHECK (hora_hasta > hora_desde),
  CONSTRAINT ck_agenda_recurso_costos CHECK (COALESCE(costo_hora, 0) >= 0 AND COALESCE(costo_uso, 0) >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_agenda_recurso_nombre
  ON agenda_recurso (tenant_id, lower(nombre)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_agenda_recurso_equipo ON agenda_recurso(equipo_id) WHERE equipo_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS agenda_evento (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenant(id),
  titulo          VARCHAR(160) NOT NULL,
  descripcion     TEXT,
  tipo            VARCHAR(20) NOT NULL DEFAULT 'REUNION',
  lugar           VARCHAR(160),
  unidad_id       UUID REFERENCES unidad(id),
  ot_id           UUID REFERENCES orden_trabajo(id),
  fecha           DATE NOT NULL,                        -- primera ocurrencia
  todo_dia        BOOLEAN NOT NULL DEFAULT FALSE,
  hora_inicio     TIME,
  hora_fin        TIME,
  recurrencia     VARCHAR(10) NOT NULL DEFAULT 'NINGUNA',
  intervalo       SMALLINT NOT NULL DEFAULT 1,
  dias_semana     SMALLINT[],
  repetir_hasta   DATE,
  repeticiones    SMALLINT,
  ultima_fecha    DATE,                                 -- última ocurrencia (NULL = sin fin); acota las consultas
  organizador_id  UUID REFERENCES usuario(id),
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_por UUID REFERENCES usuario(id),
  actualizado_en  TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ,
  CONSTRAINT ck_agenda_evento_tipo CHECK (tipo IN ('REUNION', 'SALIDA_TERRENO', 'MUESTREO', 'MANTENCION', 'CAPACITACION', 'AUDITORIA', 'OTRO')),
  CONSTRAINT ck_agenda_evento_recurrencia CHECK (recurrencia IN ('NINGUNA', 'DIARIA', 'SEMANAL', 'MENSUAL')),
  CONSTRAINT ck_agenda_evento_horas CHECK (todo_dia OR (hora_inicio IS NOT NULL AND hora_fin IS NOT NULL AND hora_fin > hora_inicio)),
  CONSTRAINT ck_agenda_evento_intervalo CHECK (intervalo BETWEEN 1 AND 99),
  CONSTRAINT ck_agenda_evento_fin CHECK (repetir_hasta IS NULL OR repetir_hasta >= fecha)
);
CREATE INDEX IF NOT EXISTS idx_agenda_evento_rango ON agenda_evento (tenant_id, fecha, ultima_fecha) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS agenda_evento_participante (
  evento_id  UUID NOT NULL REFERENCES agenda_evento(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES usuario(id),
  respuesta  VARCHAR(10) NOT NULL DEFAULT 'PENDIENTE',
  CONSTRAINT ck_agenda_participante_resp CHECK (respuesta IN ('PENDIENTE', 'ACEPTA', 'RECHAZA')),
  PRIMARY KEY (evento_id, usuario_id)
);
CREATE INDEX IF NOT EXISTS idx_agenda_participante_usuario ON agenda_evento_participante(usuario_id);

CREATE TABLE IF NOT EXISTS agenda_evento_recurso (
  evento_id  UUID NOT NULL REFERENCES agenda_evento(id) ON DELETE CASCADE,
  recurso_id UUID NOT NULL REFERENCES agenda_recurso(id),
  PRIMARY KEY (evento_id, recurso_id)
);
CREATE INDEX IF NOT EXISTS idx_agenda_evento_recurso_recurso ON agenda_evento_recurso(recurso_id);

CREATE TABLE IF NOT EXISTS agenda_evento_excepcion (
  evento_id UUID NOT NULL REFERENCES agenda_evento(id) ON DELETE CASCADE,
  fecha     DATE NOT NULL,
  PRIMARY KEY (evento_id, fecha)
);

COMMENT ON TABLE agenda_recurso  IS 'Agenda (§4.5.8): recursos materiales reservables (vehículo, equipo, sala, servicio) con horario y costos.';
COMMENT ON TABLE agenda_evento   IS 'Agenda (§4.5.9): eventos únicos o recurrentes; ocurrencias calculadas en la API (agenda/recurrencia.ts).';
COMMENT ON TABLE agenda_evento_excepcion IS 'Agenda (§4.5.9): ocurrencias anuladas de una serie recurrente.';

-- --------------------------------------------------------------- permisos ---
INSERT INTO permiso (id, codigo, modulo, accion, descripcion) VALUES
  (gen_random_uuid(), 'agenda.ver', 'agenda', 'ver',
   'Agenda: ver el calendario de eventos y la disponibilidad de recursos de su alcance, y crear sus propios eventos.'),
  (gen_random_uuid(), 'agenda.crear', 'agenda', 'crear',
   'Agenda: crear eventos propios, invitar participantes y reservar recursos.'),
  (gen_random_uuid(), 'recurso.gestionar', 'agenda', 'gestionar',
   'Agenda: mantener el catálogo de recursos (vehículos, equipos, salas, servicios), sus costos, y editar eventos de otros.')
ON CONFLICT (codigo) DO NOTHING;

-- agenda.ver: todo rol interno con ot.ver; agenda.crear: los mismos salvo LECTOR (solo lectura).
INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT DISTINCT rp.rol_id, p.id
  FROM rol_permiso rp
  JOIN permiso po ON po.id = rp.permiso_id AND po.codigo = 'ot.ver'
  JOIN rol r      ON r.id = rp.rol_id AND COALESCE(r.alias_de, r.codigo) <> 'CLIENTE'
  JOIN permiso p  ON p.codigo = 'agenda.ver' OR (p.codigo = 'agenda.crear' AND COALESCE(r.alias_de, r.codigo) <> 'LECTOR')
ON CONFLICT DO NOTHING;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM (VALUES ('DIRECTOR'), ('SUBDIRECTOR'), ('JEFE_DEPTO'), ('JEFE_LAB'), ('PLANIFICACION'), ('ADMIN'), ('SUPERADMIN')) AS m(rol)
  JOIN rol r     ON COALESCE(r.alias_de, r.codigo) = m.rol
  JOIN permiso p ON p.codigo IN ('agenda.ver', 'agenda.crear', 'recurso.gestionar')
ON CONFLICT DO NOTHING;
