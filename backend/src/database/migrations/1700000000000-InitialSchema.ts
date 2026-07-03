import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 基线 Migration — 一次性建出当前 16 张业务表
 *
 * 由 pg_dump --schema-only --schema=app 从 dev DB 生成，
 * 之后用 IF NOT EXISTS 包装以幂等。
 *
 * 适用：
 *   - 全新 DB：从零跑 init.sql + 这个 migration → 直接得到完整 schema
 *   - 已有 dev DB：用 "INSERT INTO typeorm_migrations" 直接标记为已执行（见 P0-5）
 *
 * 之后的 entity 改动：
 *   npm run migration:generate -- -d src/database/data-source.ts AddXxxColumn
 */
export class InitialSchema1700000000000 implements MigrationInterface {
  name = 'InitialSchema1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) schema 已由 init.sql 创建，这里保险加一次
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS app;`);

    // 2) UUID 函数（init.sql 用 pgcrypto.gen_random_uuid，但旧 dev DB 是 uuid-ossp.uuid_generate_v4）
    //    两个都装上，保证不管哪个 default 都能跑
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

    // ============== 业务表 ==============

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS app.users (
        id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
        created_at timestamptz DEFAULT now() NOT NULL,
        updated_at timestamptz DEFAULT now() NOT NULL,
        email varchar(255) NOT NULL,
        name varchar(255) NOT NULL,
        password_hash varchar(255),
        is_active boolean DEFAULT true NOT NULL,
        email_verified_at timestamptz,
        avatar_url varchar(500),
        last_login_at timestamptz,
        last_login_ip varchar(45),
        is_admin boolean DEFAULT false NOT NULL,
        CONSTRAINT "PK_users" PRIMARY KEY (id)
      );
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_users_email" ON app.users(email);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_users_active" ON app.users(is_active);`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS app.email_verifications (
        id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
        created_at timestamptz DEFAULT now() NOT NULL,
        updated_at timestamptz DEFAULT now() NOT NULL,
        email varchar(255) NOT NULL,
        code varchar(6) NOT NULL,
        purpose varchar(30) NOT NULL,
        expires_at timestamptz NOT NULL,
        consumed_at timestamptz,
        request_ip varchar(45),
        CONSTRAINT "PK_email_verifications" PRIMARY KEY (id)
      );
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_email_verif_email_purpose ON app.email_verifications(email, purpose);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_email_verif_expires ON app.email_verifications(expires_at);`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS app.user_oauth_bindings (
        id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
        created_at timestamptz DEFAULT now() NOT NULL,
        updated_at timestamptz DEFAULT now() NOT NULL,
        user_id uuid NOT NULL,
        provider varchar(20) NOT NULL,
        provider_user_id varchar(255) NOT NULL,
        provider_email varchar(255),
        provider_name varchar(255),
        provider_avatar_url varchar(500),
        CONSTRAINT "PK_user_oauth_bindings" PRIMARY KEY (id),
        CONSTRAINT "FK_user_oauth_bindings_user"
          FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE
      );
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_oauth_provider_pid ON app.user_oauth_bindings(provider, provider_user_id);`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS app.datasources (
        id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
        created_at timestamptz DEFAULT now() NOT NULL,
        updated_at timestamptz DEFAULT now() NOT NULL,
        name varchar(255) NOT NULL,
        type varchar(50) NOT NULL,
        description text,
        config jsonb NOT NULL,
        owner_id uuid,
        is_active boolean DEFAULT true NOT NULL,
        dataset_names text[] DEFAULT '{}'::text[] NOT NULL,
        CONSTRAINT "PK_datasources" PRIMARY KEY (id)
      );
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_datasources_active" ON app.datasources(is_active);`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS app.conversations (
        id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
        created_at timestamptz DEFAULT now() NOT NULL,
        updated_at timestamptz DEFAULT now() NOT NULL,
        user_id uuid NOT NULL,
        title varchar(255),
        datasource_id uuid,
        locked_skill_name varchar(100),
        CONSTRAINT "PK_conversations" PRIMARY KEY (id),
        CONSTRAINT "FK_conversations_user"
          FOREIGN KEY (user_id) REFERENCES app.users(id) ON DELETE CASCADE
      );
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_conversations_user" ON app.conversations(user_id);`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS app.messages (
        id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
        created_at timestamptz DEFAULT now() NOT NULL,
        updated_at timestamptz DEFAULT now() NOT NULL,
        conversation_id uuid NOT NULL,
        role varchar(50) NOT NULL,
        content text NOT NULL,
        sql_text text,
        chart_config jsonb,
        result_data jsonb,
        metadata jsonb,
        CONSTRAINT "PK_messages" PRIMARY KEY (id),
        CONSTRAINT "FK_messages_conversation"
          FOREIGN KEY (conversation_id) REFERENCES app.conversations(id) ON DELETE CASCADE
      );
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_messages_conversation" ON app.messages(conversation_id);`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS app.tasks (
        id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
        created_at timestamptz DEFAULT now() NOT NULL,
        updated_at timestamptz DEFAULT now() NOT NULL,
        name varchar(255) NOT NULL,
        description text,
        cron_expression varchar(100),
        question text NOT NULL,
        datasource_id uuid,
        conversation_id uuid,
        is_active boolean DEFAULT true NOT NULL,
        last_run_at timestamptz,
        next_run_at timestamptz,
        last_status varchar(50),
        feishu_webhook varchar(500),
        created_by uuid,
        retry_count integer DEFAULT 3 NOT NULL,
        CONSTRAINT "PK_tasks" PRIMARY KEY (id)
      );
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_tasks_active" ON app.tasks(is_active);`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS app.sql_records (
        id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
        created_at timestamptz DEFAULT now() NOT NULL,
        updated_at timestamptz DEFAULT now() NOT NULL,
        conversation_id uuid,
        datasource_id uuid,
        sql_text text NOT NULL,
        question text,
        execution_time_ms integer,
        result_rows integer,
        status varchar(50) NOT NULL,
        error_message text,
        user_id uuid,
        from_cache boolean DEFAULT false NOT NULL,
        CONSTRAINT "PK_sql_records" PRIMARY KEY (id)
      );
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_sql_records_conversation" ON app.sql_records(conversation_id);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_sql_records_datasource" ON app.sql_records(datasource_id);`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS app.datasource_metadata (
        id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
        created_at timestamptz DEFAULT now() NOT NULL,
        updated_at timestamptz DEFAULT now() NOT NULL,
        datasource_id uuid NOT NULL,
        table_name varchar(255) NOT NULL,
        column_name varchar(255),
        business_name varchar(255),
        description text,
        unit varchar(20),
        timezone varchar(64),
        synonyms text[] DEFAULT '{}'::text[] NOT NULL,
        CONSTRAINT "PK_datasource_metadata" PRIMARY KEY (id),
        CONSTRAINT uq_datasource_table_column UNIQUE (datasource_id, table_name, column_name)
      );
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_dsmeta_ds" ON app.datasource_metadata(datasource_id);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_dsmeta_table" ON app.datasource_metadata(table_name);`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS app.datasource_glossary (
        id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
        created_at timestamptz DEFAULT now() NOT NULL,
        updated_at timestamptz DEFAULT now() NOT NULL,
        datasource_id uuid NOT NULL,
        term varchar(255) NOT NULL,
        meaning text NOT NULL,
        example_sql text,
        applies_to_tables text[] DEFAULT '{}'::text[] NOT NULL,
        CONSTRAINT "PK_datasource_glossary" PRIMARY KEY (id)
      );
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_glossary_ds" ON app.datasource_glossary(datasource_id);`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS app.datasource_suggested_question (
        id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
        created_at timestamptz DEFAULT now() NOT NULL,
        updated_at timestamptz DEFAULT now() NOT NULL,
        datasource_id uuid NOT NULL,
        question_text text NOT NULL,
        source varchar(20) DEFAULT 'manual' NOT NULL,
        learned_sql text,
        priority integer DEFAULT 0 NOT NULL,
        created_by uuid,
        CONSTRAINT "PK_datasource_suggested_question" PRIMARY KEY (id)
      );
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_sq_ds" ON app.datasource_suggested_question(datasource_id);`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS app.message_feedback (
        id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
        created_at timestamptz DEFAULT now() NOT NULL,
        updated_at timestamptz DEFAULT now() NOT NULL,
        message_id uuid NOT NULL,
        user_id uuid,
        type varchar(20) NOT NULL,
        notes text,
        saved_as_template boolean DEFAULT false NOT NULL,
        CONSTRAINT "PK_message_feedback" PRIMARY KEY (id)
      );
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_feedback_msg" ON app.message_feedback(message_id);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_feedback_user" ON app.message_feedback(user_id);`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS app.turn_artifacts (
        id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
        created_at timestamptz DEFAULT now() NOT NULL,
        updated_at timestamptz DEFAULT now() NOT NULL,
        conversation_id uuid NOT NULL,
        message_id uuid NOT NULL,
        turn_index integer NOT NULL,
        raw_messages jsonb,
        result_columns jsonb,
        result_rows jsonb,
        result_row_count integer,
        final_sql text,
        user_question text NOT NULL,
        assistant_narrative text,
        refused boolean DEFAULT false NOT NULL,
        CONSTRAINT "PK_turn_artifacts" PRIMARY KEY (id)
      );
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_ta_conv" ON app.turn_artifacts(conversation_id);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_ta_msg" ON app.turn_artifacts(message_id);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_ta_turn" ON app.turn_artifacts(turn_index);`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS app.skills (
        id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
        created_at timestamptz DEFAULT now() NOT NULL,
        updated_at timestamptz DEFAULT now() NOT NULL,
        name varchar(100) NOT NULL,
        version varchar(50) DEFAULT '1.0.0' NOT NULL,
        description text NOT NULL,
        match text,
        priority integer DEFAULT 0 NOT NULL,
        tables jsonb,
        attributable_dimensions jsonb,
        datasource_types jsonb,
        body text NOT NULL,
        is_active boolean DEFAULT true NOT NULL,
        previous_body text,
        source varchar(20) DEFAULT 'user' NOT NULL,
        updated_by uuid,
        row_version integer NOT NULL DEFAULT 1,
        CONSTRAINT "PK_skills" PRIMARY KEY (id)
      );
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_skills_name" ON app.skills(name);`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS app.schema_embeddings (
        id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
        datasource_id uuid NOT NULL,
        kind varchar(20) NOT NULL,
        schema_name varchar(100) NOT NULL,
        table_name varchar(200) NOT NULL,
        column_name varchar(200),
        text text NOT NULL,
        embedding jsonb NOT NULL,
        created_at timestamptz DEFAULT now() NOT NULL,
        CONSTRAINT "PK_schema_embeddings" PRIMARY KEY (id)
      );
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_schema_emb_ds ON app.schema_embeddings(datasource_id);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_schema_emb_kind ON app.schema_embeddings(kind);`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS app.semantic_embeddings (
        id SERIAL,
        dataset_name varchar(100) NOT NULL,
        entity_type varchar(50) NOT NULL,
        entity_name varchar(255) NOT NULL,
        entity_alias varchar(255),
        description text,
        embedding jsonb,
        created_at timestamptz DEFAULT now() NOT NULL,
        updated_at timestamptz DEFAULT now() NOT NULL,
        CONSTRAINT "PK_semantic_embeddings" PRIMARY KEY (id)
      );
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_sem_emb_dataset" ON app.semantic_embeddings(dataset_name);`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 整张 baseline 不提供 down — 生产不允许回滚到"什么都没有"
    // 如确实需要重置：DROP SCHEMA app CASCADE; 然后从头跑
    throw new Error(
      'InitialSchema.down() is intentionally not implemented. ' +
        'To reset, drop the entire schema manually.',
    );
  }
}
