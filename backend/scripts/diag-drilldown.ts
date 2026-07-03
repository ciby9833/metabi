/**
 * 端到端下钻验证：一个新对话连续 4 轮，每轮基于上一轮
 *   用法：npx ts-node scripts/diag-drilldown.ts
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ChatService } from '../src/modules/chat/services/chat.service';
import { Datasource } from '../src/database/entities';
import { DataSource } from 'typeorm';

const QUESTIONS = [
  '5月17日到5月24日每天的派件单量',
  '5月22日单量最高，按站点拆分看看 Top 5',
  'Top 1 那个站点对应的派件员有几个？',
  '那这个站点的人均派件量是多少？',
];

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const ds = await app.get(DataSource).getRepository(Datasource).findOne({ where: {} as any });
  if (!ds) {
    console.error('❌ 没数据源，先去前端建一个');
    await app.close();
    process.exit(1);
  }

  const chat = app.get(ChatService);
  let conversationId: string | undefined;

  for (let i = 0; i < QUESTIONS.length; i++) {
    const q = QUESTIONS[i];
    console.log('\n' + '='.repeat(80));
    console.log(`【第 ${i + 1} 轮】 ${q}`);
    console.log('='.repeat(80));
    const t0 = Date.now();
    try {
      const out = await chat.sendMessage({
        message: q,
        datasourceId: ds.id,
        conversationId,
      });
      conversationId = out.conversationId;
      const r: any = out.result;
      console.log(`Skill: ${r.provenance?.skill?.name}`);
      console.log(
        `Tools (${r.provenance?.steps?.length} 步): ${
          (r.provenance?.steps || [])
            .map((s: any) => `${s.step}.${s.name}`)
            .join(' → ')
        }`,
      );
      console.log(`置信度: ${(r.confidence * 100).toFixed(0)}%${r.refused ? ' [拒答]' : ''}`);
      if (r.sql) console.log(`SQL: ${r.sql.replace(/\s+/g, ' ').substring(0, 200)}`);
      console.log(`结果: ${r.resultSummary?.rowCount} 行 / 图表: ${r.chart?.type}`);
      console.log(`\n📝 ${r.narrative.substring(0, 400)}${r.narrative.length > 400 ? '...' : ''}`);
      console.log(`\n⏱ ${((Date.now() - t0) / 1000).toFixed(1)}s | tokens ${r.provenance?.totalTokens}`);
    } catch (err) {
      console.error('❌', (err as Error).message);
      console.error((err as Error).stack);
      break;
    }
  }

  await app.close();
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
