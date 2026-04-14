-- =============================================
-- ODONTOSAAS PRO — SCHEMA SUPABASE COMPLETO
-- Execute no Supabase SQL Editor
-- =============================================

-- Extensões necessárias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_cron";

-- ── TENANTS (clínicas) ──────────────────────
CREATE TABLE tenants (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome_clinica          TEXT NOT NULL,
  cnpj                  TEXT UNIQUE,
  email                 TEXT NOT NULL,
  telefone              TEXT,
  endereco              TEXT,
  site                  TEXT,
  logo_url              TEXT,
  horario_funcionamento TEXT DEFAULT 'Seg-Sex: 8h às 18h | Sáb: 8h às 12h',
  especialidades        TEXT[] DEFAULT ARRAY['Clínica Geral'],
  convenios             TEXT[],
  tabela_precos         JSONB DEFAULT '{}',
  condicoes_pagamento   TEXT,
  estacionamento        TEXT,
  acessibilidade        TEXT,
  plano                 TEXT NOT NULL DEFAULT 'starter' CHECK (plano IN ('starter', 'profissional', 'clinica', 'enterprise')),
  ativo                 BOOLEAN DEFAULT TRUE,
  email_admin           TEXT,
  evolution_instance    TEXT,
  whatsapp_numero       TEXT,
  asaas_customer_id     TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ── USUÁRIOS DA CLÍNICA ────────────────────
CREATE TABLE usuarios_clinica (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome            TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE,
  senha_hash      TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'recepcao'
                  CHECK (role IN ('admin', 'dentista', 'recepcao', 'financeiro')),
  ativo           BOOLEAN DEFAULT TRUE,
  ultimo_acesso   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── DENTISTAS ──────────────────────────────
CREATE TABLE dentistas (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome                    TEXT NOT NULL,
  cro                     TEXT,
  email                   TEXT,
  telefone                TEXT,
  especialidades          TEXT[] DEFAULT ARRAY['Clínico Geral'],
  horario_disponibilidade JSONB DEFAULT '{
    "segunda": {"inicio": "08:00", "fim": "18:00"},
    "terca":   {"inicio": "08:00", "fim": "18:00"},
    "quarta":  {"inicio": "08:00", "fim": "18:00"},
    "quinta":  {"inicio": "08:00", "fim": "18:00"},
    "sexta":   {"inicio": "08:00", "fim": "18:00"},
    "sabado":  {"inicio": "08:00", "fim": "12:00"}
  }',
  comissao_percentual     NUMERIC(5,2) DEFAULT 0,
  ativo                   BOOLEAN DEFAULT TRUE,
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

-- ── PACIENTES ──────────────────────────────
CREATE TABLE pacientes (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome                TEXT NOT NULL,
  telefone            TEXT NOT NULL,
  email               TEXT,
  cpf                 TEXT,
  data_nascimento     DATE,
  sexo                TEXT CHECK (sexo IN ('M', 'F', 'outro')),
  endereco            TEXT,
  convenio            TEXT,
  numero_convenio     TEXT,
  historico_alergias  TEXT,
  historico_medico    TEXT,
  historico_tratamentos TEXT,
  ultima_consulta     DATE,
  nps_score           INTEGER CHECK (nps_score BETWEEN 0 AND 10),
  nps_enviado_em      TIMESTAMPTZ,
  marketing_opt_in    BOOLEAN DEFAULT TRUE,
  lgpd_consent        BOOLEAN DEFAULT FALSE,
  lgpd_consent_at     TIMESTAMPTZ,
  asaas_id            TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, telefone)
);

-- ── AGENDAMENTOS ───────────────────────────
CREATE TABLE agendamentos (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  paciente_id          UUID NOT NULL REFERENCES pacientes(id),
  dentista_id          UUID NOT NULL REFERENCES dentistas(id),
  procedimento         TEXT NOT NULL,
  inicio               TIMESTAMPTZ NOT NULL,
  fim                  TIMESTAMPTZ,
  status               TEXT NOT NULL DEFAULT 'agendado'
                       CHECK (status IN ('agendado', 'confirmado', 'concluido', 'cancelado', 'faltou', 'remarcado')),
  observacoes          TEXT,
  confirmado_em        TIMESTAMPTZ,
  confirmacao_enviada  TIMESTAMPTZ,
  cancelado_em         TIMESTAMPTZ,
  motivo_cancelamento  TEXT,
  criado_por           UUID REFERENCES usuarios_clinica(id),
  origem               TEXT DEFAULT 'whatsapp' CHECK (origem IN ('whatsapp', 'painel', 'telefone', 'site')),
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ── PRONTUÁRIOS ────────────────────────────
CREATE TABLE prontuarios (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  paciente_id         UUID NOT NULL REFERENCES pacientes(id),
  dentista_id         UUID NOT NULL REFERENCES dentistas(id),
  agendamento_id      UUID REFERENCES agendamentos(id),
  odontograma         JSONB DEFAULT '{}',
  anamnese            JSONB DEFAULT '{}',
  diagnostico         TEXT,
  plano_tratamento    TEXT,
  evolucao            TEXT,
  imagens_urls        TEXT[],
  assinatura_digital  TEXT,
  assinado_em         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ── FINANCEIRO ─────────────────────────────
CREATE TABLE financeiro (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  paciente_id      UUID REFERENCES pacientes(id),
  agendamento_id   UUID REFERENCES agendamentos(id),
  descricao        TEXT NOT NULL,
  valor            NUMERIC(10,2) NOT NULL,
  tipo             TEXT NOT NULL DEFAULT 'receita' CHECK (tipo IN ('receita', 'despesa')),
  status           TEXT NOT NULL DEFAULT 'pendente'
                   CHECK (status IN ('pendente', 'pago', 'vencido', 'cancelado', 'estornado')),
  vencimento       DATE,
  pago_em          TIMESTAMPTZ,
  forma_pagamento  TEXT,
  parcelas         INTEGER DEFAULT 1,
  link_pagamento   TEXT,
  gateway_id       TEXT,
  gateway          TEXT DEFAULT 'asaas' CHECK (gateway IN ('asaas', 'stripe', 'manual')),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── ESTOQUE ────────────────────────────────
CREATE TABLE estoque (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  produto          TEXT NOT NULL,
  categoria        TEXT,
  unidade          TEXT DEFAULT 'unidade',
  quantidade       NUMERIC(10,2) NOT NULL DEFAULT 0,
  minimo_alerta    NUMERIC(10,2) DEFAULT 5,
  fornecedor       TEXT,
  preco_unitario   NUMERIC(10,2),
  ultima_atualizacao TIMESTAMPTZ DEFAULT NOW(),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, produto)
);

-- ── CONVERSAS WHATSAPP ─────────────────────
CREATE TABLE conversas_whatsapp (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  paciente_id       UUID REFERENCES pacientes(id),
  sessao_id         TEXT NOT NULL UNIQUE,
  mensagens         JSONB DEFAULT '[]',
  agente_utilizado  TEXT,
  intencao_detectada TEXT,
  confianca         NUMERIC(3,2),
  escalado          BOOLEAN DEFAULT FALSE,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── AUDIT LOG DE AGENTES ───────────────────
CREATE TABLE agent_audit_log (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agente        TEXT NOT NULL,
  input_resumo  TEXT,
  output_resumo TEXT,
  confianca     NUMERIC(3,2),
  escalado      BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── ESCALAÇÕES PARA HUMANO ─────────────────
CREATE TABLE escalacoes_humano (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  paciente_id UUID REFERENCES pacientes(id),
  motivo      TEXT,
  historico   JSONB,
  status      TEXT DEFAULT 'aguardando' CHECK (status IN ('aguardando', 'atendendo', 'resolvido')),
  atendido_por UUID REFERENCES usuarios_clinica(id),
  criado_em   TIMESTAMPTZ DEFAULT NOW(),
  resolvido_em TIMESTAMPTZ
);

-- =============================================
-- ÍNDICES PARA PERFORMANCE
-- =============================================
CREATE INDEX idx_agendamentos_tenant_data ON agendamentos(tenant_id, inicio);
CREATE INDEX idx_agendamentos_dentista ON agendamentos(dentista_id, inicio);
CREATE INDEX idx_agendamentos_paciente ON agendamentos(paciente_id);
CREATE INDEX idx_agendamentos_status ON agendamentos(tenant_id, status);
CREATE INDEX idx_pacientes_tenant_tel ON pacientes(tenant_id, telefone);
CREATE INDEX idx_pacientes_nome ON pacientes(tenant_id, nome);
CREATE INDEX idx_financeiro_tenant_status ON financeiro(tenant_id, status);
CREATE INDEX idx_financeiro_vencimento ON financeiro(tenant_id, vencimento);
CREATE INDEX idx_conversas_sessao ON conversas_whatsapp(sessao_id);
CREATE INDEX idx_audit_tenant_data ON agent_audit_log(tenant_id, created_at);

-- =============================================
-- ROW LEVEL SECURITY (RLS) — ISOLAMENTO MULTI-TENANT
-- =============================================

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios_clinica ENABLE ROW LEVEL SECURITY;
ALTER TABLE dentistas ENABLE ROW LEVEL SECURITY;
ALTER TABLE pacientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE agendamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE prontuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE financeiro ENABLE ROW LEVEL SECURITY;
ALTER TABLE estoque ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversas_whatsapp ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalacoes_humano ENABLE ROW LEVEL SECURITY;

-- Políticas por tenant_id via JWT claim
CREATE POLICY "tenant_isolation" ON tenants
  USING (id::text = auth.jwt() ->> 'tenantId');

CREATE POLICY "tenant_isolation" ON usuarios_clinica
  USING (tenant_id::text = auth.jwt() ->> 'tenantId');

CREATE POLICY "tenant_isolation" ON dentistas
  USING (tenant_id::text = auth.jwt() ->> 'tenantId');

CREATE POLICY "tenant_isolation" ON pacientes
  USING (tenant_id::text = auth.jwt() ->> 'tenantId');

CREATE POLICY "tenant_isolation" ON agendamentos
  USING (tenant_id::text = auth.jwt() ->> 'tenantId');

CREATE POLICY "tenant_isolation" ON prontuarios
  USING (tenant_id::text = auth.jwt() ->> 'tenantId');

CREATE POLICY "tenant_isolation" ON financeiro
  USING (tenant_id::text = auth.jwt() ->> 'tenantId');

CREATE POLICY "tenant_isolation" ON estoque
  USING (tenant_id::text = auth.jwt() ->> 'tenantId');

CREATE POLICY "tenant_isolation" ON conversas_whatsapp
  USING (tenant_id::text = auth.jwt() ->> 'tenantId');

CREATE POLICY "tenant_isolation" ON agent_audit_log
  USING (tenant_id::text = auth.jwt() ->> 'tenantId');

CREATE POLICY "tenant_isolation" ON escalacoes_humano
  USING (tenant_id::text = auth.jwt() ->> 'tenantId');

-- =============================================
-- FUNÇÃO: ESTATÍSTICAS DIÁRIAS
-- =============================================
CREATE OR REPLACE FUNCTION get_daily_stats(p_tenant_id UUID, p_data DATE)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'agendamentos_total', COUNT(*) FILTER (WHERE DATE(inicio) = p_data),
    'confirmados', COUNT(*) FILTER (WHERE DATE(inicio) = p_data AND status = 'confirmado'),
    'cancelados', COUNT(*) FILTER (WHERE DATE(inicio) = p_data AND status = 'cancelado'),
    'concluidos', COUNT(*) FILTER (WHERE DATE(inicio) = p_data AND status = 'concluido'),
    'receita_dia', COALESCE((
      SELECT SUM(valor) FROM financeiro
      WHERE tenant_id = p_tenant_id AND DATE(pago_em) = p_data AND status = 'pago'
    ), 0)
  ) INTO result
  FROM agendamentos
  WHERE tenant_id = p_tenant_id;

  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- TRIGGER: atualizar updated_at
-- =============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pacientes_updated BEFORE UPDATE ON pacientes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_prontuarios_updated BEFORE UPDATE ON prontuarios
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_conversas_updated BEFORE UPDATE ON conversas_whatsapp
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_tenants_updated BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
