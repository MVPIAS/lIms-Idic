-- =============================================================================
-- LIMS IDIC · Cuarto envío IDIC (18-11-2026) · Tasa de internación 1,5 % (COM-03)
--   Idempotente: se puede ejecutar dos veces.
--
--   1 · calculo_tasa_internacion: conceptos de la base con la fórmula del IDIC
--       (planilla «Cálculo tasa internación» del DCO y Comunicación Breve):
--       ad valorem, flete nacional, factura de la agencia de aduana, IVA de
--       internación incluido en ella (no entra en la base), otros gastos por
--       cuenta del cliente; base y base afecta; datos del expediente para la
--       Comunicación Breve (Declaración de Ingreso, facturas de la agencia y
--       del transporte, fecha de recepción de documentos en la SDBPCH, agencia
--       de aduana). Todas opcionales: los cálculos anteriores siguen válidos
--       (base = CIF en pesos).
--   2 · bpch_tasa: reparto de la tasa por centro de costo (Sucursal 85, DTCG
--       10, SDBPCH 5). Parámetros nuevos, con su fila de historial. Se siembran
--       UNA vez (sql_paso_aplicado): lo que el IDIC cambie después en
--       Administración no se pisa.
--   3 · tasa_carta: textos de la carta al cliente (editables en Administración ›
--       Parámetros del sistema). Sin cuenta bancaria ni teléfonos: los completa
--       el IDIC. Una sola vez.
--   La lista «Agencia de aduana» (agencia_aduana) se administra en Parámetros
--   del sistema; aquí NO se siembran nombres (las de PRUEBA van en
--   seed_cuarto_envio_tasa_demo.sql, solo demo).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS sql_paso_aplicado (
  codigo      VARCHAR(80)  PRIMARY KEY,
  descripcion TEXT,
  aplicado_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION pg_temp.ce_primera_vez(p_codigo TEXT, p_descripcion TEXT)
RETURNS boolean AS $$
DECLARE n INTEGER;
BEGIN
  INSERT INTO sql_paso_aplicado (codigo, descripcion) VALUES (p_codigo, p_descripcion)
  ON CONFLICT (codigo) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- 1 · Columnas nuevas del cálculo de la tasa
-- -----------------------------------------------------------------------------
ALTER TABLE calculo_tasa_internacion ADD COLUMN IF NOT EXISTS ad_valorem_usd            NUMERIC(16,2);
ALTER TABLE calculo_tasa_internacion ADD COLUMN IF NOT EXISTS ad_valorem_clp            NUMERIC(18,2);
ALTER TABLE calculo_tasa_internacion ADD COLUMN IF NOT EXISTS flete_nacional            NUMERIC(18,2);
ALTER TABLE calculo_tasa_internacion ADD COLUMN IF NOT EXISTS agencia_total_factura     NUMERIC(18,2);
ALTER TABLE calculo_tasa_internacion ADD COLUMN IF NOT EXISTS agencia_iva_internacion   NUMERIC(18,2);
ALTER TABLE calculo_tasa_internacion ADD COLUMN IF NOT EXISTS otros_gastos_cliente      NUMERIC(18,2);
ALTER TABLE calculo_tasa_internacion ADD COLUMN IF NOT EXISTS base_calculo              NUMERIC(18,2);
ALTER TABLE calculo_tasa_internacion ADD COLUMN IF NOT EXISTS base_afecta               NUMERIC(18,2);
ALTER TABLE calculo_tasa_internacion ADD COLUMN IF NOT EXISTS din_numero                VARCHAR(40);
ALTER TABLE calculo_tasa_internacion ADD COLUMN IF NOT EXISTS factura_agencia_numero    VARCHAR(40);
ALTER TABLE calculo_tasa_internacion ADD COLUMN IF NOT EXISTS factura_agencia_emisor    VARCHAR(200);
ALTER TABLE calculo_tasa_internacion ADD COLUMN IF NOT EXISTS factura_transporte_numero VARCHAR(40);
ALTER TABLE calculo_tasa_internacion ADD COLUMN IF NOT EXISTS factura_transporte_emisor VARCHAR(200);
ALTER TABLE calculo_tasa_internacion ADD COLUMN IF NOT EXISTS fecha_recepcion_sdbpch    DATE;
ALTER TABLE calculo_tasa_internacion ADD COLUMN IF NOT EXISTS agencia_aduana_codigo     VARCHAR(60);
ALTER TABLE calculo_tasa_internacion ADD COLUMN IF NOT EXISTS agencia_aduana            VARCHAR(200);
-- distribucion_cc (JSONB) ya existía sin uso: guarda el reparto por centro de costo.
ALTER TABLE calculo_tasa_internacion ADD COLUMN IF NOT EXISTS distribucion_cc           JSONB;

COMMENT ON COLUMN calculo_tasa_internacion.agencia_iva_internacion IS
  'IVA de internación que la agencia de aduana pagó por cuenta del cliente e incluyó en su factura: NO entra en la base de la tasa (COM-03). Distinto de iva_internacion, que es el IVA de la tasa (exenta: 0).';
COMMENT ON COLUMN calculo_tasa_internacion.base_calculo IS
  'Base de la tasa en pesos (COM-03): CIF $ + ad valorem $ + flete nacional + (factura de la agencia − IVA de internación) + otros gastos por cuenta del cliente. NULL en cálculos anteriores (base = monto_cif_clp).';
COMMENT ON COLUMN calculo_tasa_internacion.distribucion_cc IS
  'Reparto de la tasa por centro de costo [{codigo, etiqueta, pct, monto}] (Sucursal / DTCG / SDBPCH, parámetros bpch_tasa.reparto_*_pct). Suma exactamente la tasa.';

-- -----------------------------------------------------------------------------
-- 2 · Reparto por centro de costo (bpch_tasa) · una sola vez
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF pg_temp.ce_primera_vez('ce1811.COM-03.reparto', 'Reparto de la tasa de internación por centro de costo 85/10/5 (COM-03)') THEN
    WITH nuevos AS (
      INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden, valor, activo)
      SELECT t.id, 'bpch_tasa', v.codigo, v.etiqueta, v.orden, v.valor, TRUE
        FROM tenant t
       CROSS JOIN (VALUES
        ('reparto_sucursal_pct', 'Reparto de la tasa · Sucursal que atendió la internación (%)', 3, '85'),
        ('reparto_dtcg_pct',     'Reparto de la tasa · DTCG (%)',                                4, '10'),
        ('reparto_sdbpch_pct',   'Reparto de la tasa · SDBPCH (%)',                              5, '5')
       ) AS v(codigo, etiqueta, orden, valor)
      ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING
      RETURNING id, tenant_id, codigo, valor
    )
    INSERT INTO parametro_sistema_historial (tenant_id, parametro_id, categoria, codigo, valor_anterior, valor_nuevo, motivo, usuario_id)
    SELECT n.tenant_id, n.id, 'bpch_tasa', n.codigo, NULL, n.valor,
           'Respuesta IDIC cuarto envío 18-11-2026 (COM-03): la tasa se carga Sucursal 85 %, DTCG 10 %, SDBPCH 5 %.', NULL
      FROM nuevos n;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3 · Textos de la carta al cliente (tasa_carta) · una sola vez
--     Mismos valores por defecto que catalogo/parametro-configurable.ts.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF pg_temp.ce_primera_vez('ce1811.COM-03.carta', 'Textos de la carta al cliente de la tasa 1,5 % (COM-03)') THEN
    INSERT INTO parametro_sistema (tenant_id, categoria, codigo, etiqueta, orden, valor)
    SELECT t.id, v.categoria, v.codigo, v.etiqueta, v.orden, v.valor
      FROM tenant t
     CROSS JOIN (VALUES
      ('tasa_carta', 'referencia', 'Referencia legal', 1, 'Ley 17.798 «Control de armas»'),
      ('tasa_carta', 'parrafo_1', 'Párrafo 1 · certificados disponibles', 2, 'En conformidad a lo dispuesto en el cuerpo legal citado en «Referencia» y efectuada la inspección al producto individualizado en la Resolución que se señala, se informa a usted que el (los) certificado(s) correspondiente(s) se encuentra(n) a su disposición para ser retirado(s) en nuestras oficinas.'),
      ('tasa_carta', 'parrafo_2', 'Párrafo 2 · formas de pago', 3, 'El pago puede ser realizado en efectivo o con cheque nominativo y cruzado a nombre del «Instituto de Investigaciones y Control del Ejército».'),
      ('tasa_carta', 'parrafo_3', 'Párrafo 3 · depósitos directos', 4, ''),
      ('tasa_carta', 'parrafo_4', 'Párrafo 4 · plazo de retiro', 5, 'En caso que los certificados no sean pagados y retirados en el plazo de 15 días, contados a partir de la fecha de la presente carta, estos serán remitidos a vuestra empresa mediante correo certificado, junto con la factura correspondiente para su pago.'),
      ('tasa_carta', 'firma_cargo', 'Cargo de quien firma la carta y la Comunicación Breve', 6, 'Jefe Departamento Comercial')
     ) AS v(categoria, codigo, etiqueta, orden, valor)
    ON CONFLICT (tenant_id, categoria, codigo) DO NOTHING;
  END IF;
END $$;

COMMIT;
