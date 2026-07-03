import { Injectable, Logger } from '@nestjs/common';

/**
 * SQL 安全检查
 *
 * 策略：
 *  1. 仅允许 SELECT / WITH（只读语句）
 *  2. 禁止 UPDATE / DELETE / DROP / INSERT / TRUNCATE / ALTER / CREATE / GRANT 等任何修改性关键字
 *  3. 禁止多语句（多个分号分隔的 SQL）
 *  4. 通过 sql AST 解析进一步验证（如果 node-sql-parser 可用）
 */
@Injectable()
export class SqlSafetyService {
  private readonly logger = new Logger(SqlSafetyService.name);

  private readonly forbiddenKeywords = [
    'UPDATE',
    'DELETE',
    'DROP',
    'INSERT',
    'TRUNCATE',
    'ALTER',
    'CREATE',
    'GRANT',
    'REVOKE',
    'EXEC',
    'EXECUTE',
    'CALL',
  ];

  /**
   * 检查 SQL 是否安全。
   * 如果不安全，抛出异常。
   */
  validate(sql: string): void {
    const trimmed = sql.trim();
    if (!trimmed) {
      throw new Error('SQL 为空');
    }

    // 1. 去除注释（-- 和 /* */）
    const stripped = this.stripComments(trimmed);

    // 2. 多语句检查（除末尾的分号外，不允许中间有分号）
    const withoutTrailing = stripped.replace(/;+\s*$/, '');
    if (withoutTrailing.includes(';')) {
      throw new Error('禁止多语句 SQL（包含中间分号）');
    }

    // 3. 必须以 SELECT 或 WITH 开头
    const firstWord = withoutTrailing.replace(/\s+/, ' ').trim().split(/\s+/)[0]?.toUpperCase();
    if (firstWord !== 'SELECT' && firstWord !== 'WITH') {
      throw new Error(`只允许 SELECT 查询，当前以 ${firstWord} 开头`);
    }

    // 4. 关键字黑名单
    const upper = withoutTrailing.toUpperCase();
    for (const kw of this.forbiddenKeywords) {
      // 使用单词边界匹配，避免误判 (例如 UPDATED_AT 字段名)
      const re = new RegExp(`\\b${kw}\\b`);
      if (re.test(upper)) {
        throw new Error(`SQL 包含禁止的关键字: ${kw}`);
      }
    }

    // 5. 尝试 AST 解析（可选，依赖 node-sql-parser）
    this.astValidate(withoutTrailing);
  }

  /** 移除 SQL 注释 */
  private stripComments(sql: string): string {
    // 移除 /* ... */
    let s = sql.replace(/\/\*[\s\S]*?\*\//g, ' ');
    // 移除行注释
    s = s.replace(/--[^\n]*/g, ' ');
    return s;
  }

  /** AST 验证 - 如果 node-sql-parser 已安装则使用 */
  private astValidate(sql: string): void {
    try {
      // 懒加载
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Parser } = require('node-sql-parser');
      const parser = new Parser();
      const ast = parser.astify(sql, { database: 'PostgreSQL' });
      const list = Array.isArray(ast) ? ast : [ast];

      for (const node of list) {
        const type = (node?.type || '').toLowerCase();
        if (type && type !== 'select') {
          throw new Error(`AST 校验失败：发现非 SELECT 语句 (${node.type})`);
        }
      }
    } catch (err) {
      // 如果是模块未找到，跳过；否则抛出
      const msg = (err as Error).message || '';
      if (msg.includes('Cannot find module') || msg.includes('node-sql-parser')) {
        this.logger.debug('node-sql-parser not installed; skipping AST validation');
        return;
      }
      throw err;
    }
  }

  /**
   * 确保 SQL 含有 LIMIT 子句，否则自动添加
   */
  ensureLimit(sql: string, maxRows: number): string {
    const upper = sql.toUpperCase();
    if (/\bLIMIT\b/.test(upper)) {
      return sql;
    }
    return sql.replace(/;?\s*$/, ` LIMIT ${maxRows}`);
  }
}
