/**
 * 端到端 Agent 诊断脚本
 * 用法：
 *   npx ts-node scripts/diag-agent.ts                 # 跑全部默认测试
 *   npx ts-node scripts/diag-agent.ts "你的自定义问题"  # 跑单条
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ChatOrchestratorService } from '../src/core/orchestrator/chat-orchestrator.service';
import { LLMGatewayService } from '../src/providers/llm/llm-gateway.service';
import { SkillLoaderService } from '../src/providers/skills/skill-loader.service';
import { ToolRegistry } from '../src/core/tools/tool-registry.service';
import { Datasource } from '../src/database/entities';
import { DataSource } from 'typeorm';

const DEFAULT_QUESTIONS = [
  '5月17日到5月24日每天的派件单量',
  '5月18日 Surabaya 区域准时签收率 Top 10 站点',
  'C 平台分批派送率最高的 5 个站点是什么',  // 故意问 C 平台（这表里没 C 平台字段，应该拒答或换字段）
  '6月的派件量趋势',  // 故意问数据范围外（应该拒答）
  '帮我看看公司今年的营收',  // 完全不相关（应该拒答 / 走 general skill）
];

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  console.log('\n========== Agent 自检 ==========');
  const gw = app.get(LLMGatewayService);
  console.log('  可用 LLM Provider:', gw.getAvailableProviders().join(', ') || '无');

  const skills = app.get(SkillLoaderService).getAll();
  console.log(`  已加载 Skill:`, skills.map((s) => `${s.meta.name} v${s.meta.version}`).join(', '));

  const tools = app.get(ToolRegistry).getAll();
  console.log(`  已注册 Tool:`, tools.map((t) => t.definition.name).join(', '));

  const ds = await app.get(DataSource).getRepository(Datasource).findOne({ where: {} as any });
  if (!ds) {
    console.error('❌ 没有数据源，请先在前端创建一个');
    await app.close();
    process.exit(1);
  }
  console.log(`  数据源: ${ds.name} (${ds.type} @ ${ds.config.host}:${ds.config.port}/${ds.config.database})`);

  // 跑测试
  const orchestrator = app.get(ChatOrchestratorService);
  const questions = process.argv[2] ? [process.argv[2]] : DEFAULT_QUESTIONS;

  for (const question of questions) {
    console.log('\n' + '='.repeat(70));
    console.log(`❓ ${question}`);
    console.log('='.repeat(70));
    const t0 = Date.now();
    try {
      const result = await orchestrator.run({
        question,
        datasourceId: ds.id,
      });
      console.log(`Skill: ${result.provenance.skill.name}`);
      console.log(`Tools (${result.provenance.steps.length}步):`,
        result.provenance.steps.map((s) => `${s.step}.${s.name}`).join(' → '));
      console.log(`置信度: ${(result.confidence * 100).toFixed(0)}%${result.refused ? ' [拒答]' : ''}`);
      if (result.sql) console.log(`SQL: ${result.sql.replace(/\s+/g, ' ').substring(0, 200)}`);
      console.log(`结果: ${result.resultSummary.rowCount} 行 / 图表: ${result.chart.type} (${result.chart.reason || '-'})`);
      if (result.provenance.review) {
        console.log(`Reviewer: ${result.provenance.review.summary}`);
        if (result.provenance.review.concerns.length) {
          console.log(`  疑点: ${result.provenance.review.concerns.join('; ')}`);
        }
      }
      console.log(`\n📝 播报:\n${result.narrative}`);
      console.log(`\n总耗时: ${((Date.now() - t0) / 1000).toFixed(1)}s | LLM tokens: ${result.provenance.totalTokens}`);
    } catch (err) {
      console.error('\n❌ 执行失败:', (err as Error).message);
      console.error((err as Error).stack);
    }
  }

  await app.close();
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
