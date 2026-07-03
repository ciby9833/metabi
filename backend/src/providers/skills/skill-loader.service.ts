import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { SkillEntity } from '../../database/entities';
import { Skill } from './types';

/**
 * SkillLoader v2 — DB 存储
 *
 * 启动流程：
 *   1. 查 app.skills 表
 *   2. 如果空 → 从 src/providers/skills/definitions/*.md 一次性 seed 进 DB
 *   3. 把 DB 里 is_active=true 的 skill 加载到内存
 *
 * 热重载：
 *   - reload() 重新从 DB 拉，前端编辑保存后会调用
 *
 * 多实例（K8s 多 pod）：
 *   - 当前是各 pod 进程内缓存，编辑后只有响应该请求的 pod 立刻更新
 *   - 其他 pod 下次重启 / 30 分钟轮询时同步
 *   - 上生产真需要瞬时一致 → 用 Redis pub/sub 广播 reload 事件即可（留待 P2）
 */
@Injectable()
export class SkillLoaderService implements OnModuleInit {
  private readonly logger = new Logger(SkillLoaderService.name);
  private cache: Skill[] = [];
  private byName = new Map<string, Skill>();
  private lastLoadedAt = 0;
  /** 30 分钟无操作自动重拉，防多实例严重不同步 */
  private readonly STALE_MS = 30 * 60 * 1000;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(SkillEntity)
    private readonly repo: Repository<SkillEntity>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.syncSeedFromMarkdown();
    await this.reload();
  }

  /**
   * 把 src/providers/skills/definitions/*.md 同步进 DB：
   *   - DB 里没有 → 新建
   *   - DB 里 source='seed' 且 .md 版本号 > DB 版本号 → 自动升级（保留 previousBody）
   *   - DB 里 source='user'（被前端编辑过）→ 不动
   *
   * 这样开发者可以通过 bump 版本号 + 改 .md 来发布新版"内置 Skill"，
   * 用户在前端的自定义不会被覆盖。
   */
  private async syncSeedFromMarkdown(): Promise<void> {
    const dir = this.resolveDefinitionsDir();
    if (!dir) {
      this.logger.warn('No definitions dir found; skip seed sync');
      return;
    }
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.md') && !f.startsWith('_'));
    let created = 0;
    let upgraded = 0;
    let skippedUser = 0;
    for (const file of files) {
      try {
        const filePath = path.join(dir, file);
        const raw = fs.readFileSync(filePath, 'utf8');
        const { frontmatter, body } = this.splitFrontmatter(raw);
        const meta = await this.parseFrontmatter(frontmatter, filePath);
        const existing = await this.repo.findOne({ where: { name: meta.name } });
        if (!existing) {
          await this.repo.save(
            this.repo.create({
              name: meta.name,
              version: meta.version,
              description: meta.description,
              match: meta.match || null,
              priority: meta.priority ?? 0,
              tables: meta.tables || null,
              attributableDimensions: meta.attributableDimensions || null,
              datasourceTypes: meta.datasourceTypes || null,
              body,
              isActive: true,
              source: 'seed',
              updatedBy: null,
            }),
          );
          created++;
        } else if (existing.source === 'user') {
          skippedUser++;
        } else if (compareSemver(meta.version, existing.version) > 0) {
          existing.previousBody = existing.body;
          existing.version = meta.version;
          existing.description = meta.description;
          existing.match = meta.match || null;
          existing.priority = meta.priority ?? 0;
          existing.tables = meta.tables || null;
          existing.attributableDimensions = meta.attributableDimensions || null;
          existing.datasourceTypes = meta.datasourceTypes || null;
          existing.body = body;
          existing.source = 'seed';
          await this.repo.save(existing);
          upgraded++;
          this.logger.log(`Upgraded seed Skill "${meta.name}" → v${meta.version}`);
        }
      } catch (err) {
        this.logger.error(`Sync ${file} failed: ${(err as Error).message}`);
      }
    }
    this.logger.log(
      `Skill seed sync done: created=${created} upgraded=${upgraded} skipped_user=${skippedUser}`,
    );
  }

  /** 从 DB 加载到内存 */
  async reload(): Promise<void> {
    const rows = await this.repo.find({
      where: { isActive: true },
      order: { priority: 'DESC', name: 'ASC' },
    });
    this.cache = rows.map((r) => this.entityToSkill(r));
    this.byName.clear();
    for (const s of this.cache) this.byName.set(s.meta.name.toLowerCase(), s);
    this.lastLoadedAt = Date.now();
    this.logger.log(`Loaded ${this.cache.length} skills from DB: ${this.cache.map((s) => s.meta.name).join(', ')}`);
  }

  private entityToSkill(e: SkillEntity): Skill {
    return {
      meta: {
        name: e.name,
        version: e.version,
        description: e.description,
        match: e.match || undefined,
        priority: e.priority,
        tables: e.tables || undefined,
        attributableDimensions: e.attributableDimensions || undefined,
        datasourceTypes: e.datasourceTypes || undefined,
      },
      body: e.body,
      filePath: `db://skills/${e.name}`, // 不再有真实文件路径
      visibility: (e.visibility ?? 'global') as any,
      projectId: e.projectId ?? null,
      ownerUserId: e.ownerUserId ?? null,
    };
  }

  getAll(): Skill[] {
    // 缓存超期就懒重载
    if (Date.now() - this.lastLoadedAt > this.STALE_MS) {
      void this.reload().catch((err) =>
        this.logger.warn(`Stale reload failed: ${(err as Error).message}`),
      );
    }
    return this.cache;
  }

  getByName(name: string): Skill | undefined {
    return this.byName.get(name.toLowerCase());
  }

  // ============ helpers ============

  private resolveDefinitionsDir(): string | null {
    const candidates: string[] = [];
    const envPath = this.configService.get<string>('SKILLS_DIR');
    if (envPath) candidates.push(envPath);
    candidates.push(path.join(__dirname, 'definitions'));
    const distMarker = `${path.sep}dist${path.sep}`;
    if (__dirname.includes(distMarker)) {
      candidates.push(
        __dirname.replace(distMarker, `${path.sep}src${path.sep}`).replace(/\/$/, '') +
          path.sep +
          'definitions',
      );
    }
    for (const p of candidates) {
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return p;
    }
    return null;
  }

  private splitFrontmatter(raw: string): { frontmatter: string; body: string } {
    const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
    if (!m) return { frontmatter: '', body: raw };
    return { frontmatter: m[1], body: m[2].trim() };
  }

  private async parseFrontmatter(text: string, filePath: string) {
    if (!text.trim()) throw new Error(`Skill ${filePath} has no frontmatter`);
    const yaml = await import('js-yaml');
    const data = yaml.load(text) as any;
    if (!data?.name) throw new Error(`Skill ${filePath} missing required 'name'`);
    if (!data?.description) throw new Error(`Skill ${filePath} missing required 'description'`);
    return {
      name: data.name,
      version: data.version || '0.1.0',
      description: data.description,
      match: data.match,
      priority: typeof data.priority === 'number' ? data.priority : 0,
      datasourceTypes: Array.isArray(data.datasourceTypes) ? data.datasourceTypes : undefined,
      attributableDimensions: Array.isArray(data.attributableDimensions)
        ? data.attributableDimensions
        : undefined,
      tables: Array.isArray(data.tables) ? data.tables.map((t: any) => String(t)) : undefined,
    };
  }
}

/** 简易 semver 比较：1 = a>b, -1 = a<b, 0 = 相等 */
function compareSemver(a: string, b: string): number {
  const parse = (s: string) => s.split('.').map((n) => parseInt(n, 10) || 0);
  const ax = parse(a);
  const bx = parse(b);
  for (let i = 0; i < Math.max(ax.length, bx.length); i++) {
    const av = ax[i] ?? 0;
    const bv = bx[i] ?? 0;
    if (av !== bv) return av > bv ? 1 : -1;
  }
  return 0;
}
