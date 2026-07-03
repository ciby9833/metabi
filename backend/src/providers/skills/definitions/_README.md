# Skills 编写指南

每个 Skill 是一份 markdown 文档，由两部分组成：

```markdown
---
name: my-skill-name              # 必填，全局唯一，与文件名一致
version: 1.0.0                   # 必填
description: 一句话说明什么场景调用  # 必填
match: "派件 | 站点 | dispatcher" # 选填，|分隔的关键词列表
priority: 100                    # 选填，命中分数相同时取大
datasourceTypes: [postgresql]    # 选填，限制数据源类型
---

# 标题

## 适用范围
明确什么问题用 / 不用这个 skill

## 数据源
表名、行数、时间范围

## 字段语义（重要！）
列出所有关键字段的业务含义、陷阱

## 业务术语词典
"人效" "单量" 等行业术语 → 对应 SQL 表达式

## 常见陷阱
去重？时区？单位？

## 工作流
告诉 LLM：先做什么，再做什么
```

## 设计原则

1. **写人话，不要写代码**：Skill 是给 LLM 当 context 用的，markdown 越人性化越好。
2. **一定包含陷阱**：业务术语的歧义、字段的"坑"是 Skill 价值的核心。
3. **明确告诉 LLM "不要做什么"**：例如"不要直接用 count(*) 算单量，必须 distinct"。
4. **小步迭代**：每次端到端测试发现 LLM 犯错，就补一行到 Skill，准确率慢慢爬。

## 文件命名
- `general-data-query.md` —— 兜底 skill，所有匹配不到的问题都用它
- `<domain>.md` —— 业务领域专用
- `_xxx.md` —— 下划线开头会被 loader 忽略（草稿/文档）
