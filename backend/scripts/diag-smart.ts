/**
 * 验证 智能洞见 + 归因 + 关联 + 血缘 4 套机制
 * 用法：npx ts-node scripts/diag-smart.ts
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ChatService } from '../src/modules/chat/services/chat.service';
import { Datasource } from '../src/database/entities';
import { DataSource } from 'typeorm';

const QUESTIONS = [
  '5月17日到5月24日每天的派件单量',     // 基础查询 → 触发统计 insight + lineage
  '为什么5月22日单量这么高？',           // 触发归因模式 → decompose_by_dimensions
];

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const ds = await app.get(DataSource).getRepository(Datasource).findOne({ where: {} as any });
  if (!ds) { console.error('❌ 无数据源'); await app.close(); process.exit(1); }
  const chat = app.get(ChatService);
  let conversationId: string | undefined;

  for (const q of QUESTIONS) {
    console.log('\n' + '='.repeat(80));
    console.log(`❓ ${q}`);
    console.log('='.repeat(80));
    const t0 = Date.now();
    try {
      const out = await chat.sendMessage({ message: q, datasourceId: ds.id, conversationId });
      conversationId = out.conversationId;
      const r: any = out.result;
      console.log(`Tools: ${(r.provenance?.steps || []).map((s: any) => `${s.step}.${s.name}`).join(' → ')}`);
      console.log(`置信度: ${(r.confidence * 100).toFixed(0)}%${r.refused ? ' [拒答]' : ''}`);

      console.log(`\n🔍 Insights (${r.insights?.length || 0}):`);
      (r.insights || []).forEach((i: any, idx: number) => {
        console.log(`  ${idx + 1}. [${i.severity}|${i.kind}] ${i.text}`);
      });

      console.log(`\n⚡ FollowUps (${r.suggestedFollowUps?.length || 0}):`);
      (r.suggestedFollowUps || []).forEach((f: string, idx: number) =>
        console.log(`  ${idx + 1}. ${f}`));

      console.log(`\n💡 RelatedHints (${r.relatedHints?.length || 0}):`);
      (r.relatedHints || []).forEach((h: string, idx: number) =>
        console.log(`  ${idx + 1}. ${h}`));

      console.log(`\n📦 Lineage (${r.lineage?.length || 0}):`);
      (r.lineage || []).forEach((b: any, idx: number) =>
        console.log(`  ${idx + 1}. ${b.schema}.${b.table} · ~${b.estimatedRowCount} 行 · 活动 ${b.lastActivityHuman || 'unknown'}`));

      console.log(`\n⏱ ${((Date.now() - t0) / 1000).toFixed(1)}s | tokens ${r.provenance?.totalTokens}`);
    } catch (err) {
      console.error('❌', (err as Error).message);
    }
  }
  await app.close();
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
