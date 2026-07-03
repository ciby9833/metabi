import { BadRequestException, Injectable } from '@nestjs/common';
import { Widget } from '../../../database/entities';

type WidgetParam = NonNullable<Widget['params']>[number];

/**
 * SQL 参数化模板渲染
 *
 * 为什么走"严格值清洗后字符串替换"而不是绑定参数：
 *   1) 现有 sqlExecutor + connector 只接受 raw SQL string，改整链走 $1/$2 工程量大
 *   2) 权限边界已经在 datasourceId 层校验（用户 A 不能碰用户 B 的库）
 *   3) safety.validate 只放行 SELECT，即使值被完全控制，最坏也只能读用户自己有权的数据
 *   4) 类型白名单 + 单引号转义防语法崩坏 —— 数字校验为有限数字，日期校验为 YYYY-MM-DD
 *
 * daterange 语义：SQL 里用 {{startXxx}} 和 {{endXxx}}（约定：key 首字母大写拼接 start/end）
 *   例：param.key = 'range' → SQL 写 {{startRange}} {{endRange}}
 */
@Injectable()
export class SqlTemplateService {
  render(
    sqlTemplate: string,
    params: WidgetParam[] | null | undefined,
    values: Record<string, any> | null | undefined,
  ): string {
    if (!params || params.length === 0) return sqlTemplate;
    const v = values || {};

    let sql = sqlTemplate;
    for (const p of params) {
      const raw = v[p.key] !== undefined ? v[p.key] : p.default;
      if (p.type === 'daterange') {
        const arr = Array.isArray(raw) ? raw : [];
        const [start, end] = [arr[0], arr[1]];
        const cap = p.key.charAt(0).toUpperCase() + p.key.slice(1);
        sql = replaceAll(sql, `{{start${cap}}}`, this.formatValue(start, 'date', `${p.key}[0]`));
        sql = replaceAll(sql, `{{end${cap}}}`, this.formatValue(end, 'date', `${p.key}[1]`));
      } else {
        sql = replaceAll(sql, `{{${p.key}}}`, this.formatValue(raw, p.type, p.key));
      }
    }

    // 检查未替换的占位符 → 提示前端定义 param
    const leftover = sql.match(/\{\{[^}]+\}\}/g);
    if (leftover && leftover.length > 0) {
      throw new BadRequestException(
        `SQL 存在未定义的占位符：${[...new Set(leftover)].join(', ')} — 请在 params 中定义`,
      );
    }
    return sql;
  }

  /** 扫 SQL 提取 {{key}} — 用于「存到看板时识别 SQL 中的占位符」*/
  extractPlaceholders(sql: string): string[] {
    const matches = sql.match(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g);
    if (!matches) return [];
    return [...new Set(matches.map((m) => m.slice(2, -2)))];
  }

  private formatValue(v: any, type: WidgetParam['type'] | 'date', key: string): string {
    if (v === null || v === undefined || v === '') {
      throw new BadRequestException(`参数 ${key} 值缺失`);
    }
    switch (type) {
      case 'number': {
        const n = Number(v);
        if (!Number.isFinite(n)) {
          throw new BadRequestException(`参数 ${key} 必须是数字，收到：${JSON.stringify(v)}`);
        }
        return String(n);
      }
      case 'date': {
        const s = String(v).trim();
        // 宏优先：@today / @today-30d / @month_start ... — 每次 refresh 都基于当前时间重算
        const resolved = s.startsWith('@') ? SqlTemplateService.resolveDateMacro(s) : s;
        if (resolved === null) {
          throw new BadRequestException(`参数 ${key} 宏表达式无法解析：${s}`);
        }
        const dateOnly = resolved.length >= 10 ? resolved.substring(0, 10) : resolved;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
          throw new BadRequestException(`参数 ${key} 必须是 YYYY-MM-DD 日期或宏，收到：${s}`);
        }
        return `'${dateOnly}'`;
      }
      case 'enum':
      case 'text': {
        // 单引号加倍转义 —— PG 标准
        return `'${String(v).replace(/'/g, "''")}'`;
      }
      case 'daterange':
        // daterange 走上面的分支，这里不会命中
        throw new BadRequestException(`daterange 类型不应直接 formatValue`);
      default:
        throw new BadRequestException(`不支持的参数类型：${type}`);
    }
  }

  /**
   * 相对时间宏 → YYYY-MM-DD
   *
   * 支持：
   *   @today / @yesterday / @tomorrow
   *   @today-Nd / @today+Nd     — N 天前/后
   *   @today-Nw / @today+Nw     — N 周
   *   @today-Nm / @today+Nm     — N 月
   *   @today-Ny / @today+Ny     — N 年
   *   @month_start / @month_end
   *   @last_month_start / @last_month_end
   *   @quarter_start / @quarter_end
   *   @year_start / @year_end
   *
   * 静态方法便于测试；不合法宏返回 null。
   */
  static resolveDateMacro(macro: string, now: Date = new Date()): string | null {
    const s = macro.trim();
    const y = now.getFullYear();
    const m = now.getMonth(); // 0-11
    const d = now.getDate();

    const fmt = (dt: Date) => {
      const yy = dt.getFullYear();
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      const dd = String(dt.getDate()).padStart(2, '0');
      return `${yy}-${mm}-${dd}`;
    };

    // 简单常量宏
    if (s === '@today') return fmt(now);
    if (s === '@yesterday') return fmt(new Date(y, m, d - 1));
    if (s === '@tomorrow') return fmt(new Date(y, m, d + 1));
    if (s === '@month_start') return fmt(new Date(y, m, 1));
    if (s === '@month_end') return fmt(new Date(y, m + 1, 0));
    if (s === '@last_month_start') return fmt(new Date(y, m - 1, 1));
    if (s === '@last_month_end') return fmt(new Date(y, m, 0));
    if (s === '@year_start') return fmt(new Date(y, 0, 1));
    if (s === '@year_end') return fmt(new Date(y, 11, 31));
    if (s === '@quarter_start') {
      const qm = Math.floor(m / 3) * 3;
      return fmt(new Date(y, qm, 1));
    }
    if (s === '@quarter_end') {
      const qm = Math.floor(m / 3) * 3;
      return fmt(new Date(y, qm + 3, 0));
    }

    // @today±N[dwmy]
    const offsetMatch = s.match(/^@today([+-])(\d+)([dwmy])$/);
    if (offsetMatch) {
      const sign = offsetMatch[1] === '+' ? 1 : -1;
      const n = parseInt(offsetMatch[2], 10) * sign;
      const unit = offsetMatch[3];
      switch (unit) {
        case 'd':
          return fmt(new Date(y, m, d + n));
        case 'w':
          return fmt(new Date(y, m, d + n * 7));
        case 'm':
          return fmt(new Date(y, m + n, d));
        case 'y':
          return fmt(new Date(y + n, m, d));
      }
    }
    return null;
  }
}

function replaceAll(s: string, needle: string, replacement: string): string {
  return s.split(needle).join(replacement);
}
