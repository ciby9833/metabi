import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  App,
  Empty,
  Layout,
  Segmented,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  ApartmentOutlined,
  BookOutlined,
  DatabaseOutlined,
  FolderOpenOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useRouter } from 'next/router';
import { Conversation, Datasource, Message, SuggestedQuestion } from '@/types';
import {
  chatService,
  datasourceService,
  metadataService,
  projectService,
  datasetService,
  Project,
} from '@/services';
import { UserDataset } from '@/types';
import { ConversationSidebar } from '@/components/chat/ConversationSidebar';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { ChatInput } from '@/components/chat/ChatInput';
import { AttachmentChips } from '@/components/chat/AttachmentChips';
import { AnalyzedScopeBar } from '@/components/chat/AnalyzedScopeBar';
import { LiveTurnBubble } from '@/components/chat/LiveTurnBubble';
import { ClarifyOverlay } from '@/components/chat/ClarifyOverlay';
import { useStreamingTurn } from '@/hooks/useStreamingTurn';

const { Text } = Typography;

export default function ChatPage() {
  const router = useRouter();
  const { message: msg, modal } = App.useApp();
  const scrollRef = useRef<HTMLDivElement>(null);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [sending, setSending] = useState(false);

  const [datasources, setDatasources] = useState<Datasource[]>([]);
  const [activeDatasourceId, setActiveDatasourceId] = useState<string | null>(null);
  const [suggestedQuestions, setSuggestedQuestions] = useState<SuggestedQuestion[]>([]);

  // 数据源模式：企业数据库 vs 用户自助数据集
  type DataMode = 'datasource' | 'dataset';
  const [dataMode, setDataMode] = useState<DataMode>('datasource');

  // 用户上传的 dataset 列表 + 选中的 project + 多选的 dataset
  const [datasets, setDatasets] = useState<UserDataset[]>([]);
  const [activeProjectIdForDataset, setActiveProjectIdForDataset] = useState<string | null>(null);
  const [activeDatasetIds, setActiveDatasetIds] = useState<string[]>([]);

  // Project 列表（既给 sidebar 分组用，也给 dataset 模式选 project 用）
  const [projects, setProjects] = useState<Project[]>([]);

  // 企业数据库模式：分析范围 — 用户在跑对话前选定的表清单
  //   - 缩小 Planner 搜索空间（省 token）
  //   - 提供 @ 联想的字段来源
  //   - 当前 datasource 全部表清单 + 已选 + 已拉到的字段 metadata
  const [datasourceTables, setDatasourceTables] = useState<string[]>([]);
  const [analyzedTables, setAnalyzedTables] = useState<string[]>([]);
  const [analyzedColumns, setAnalyzedColumns] = useState<
    Record<string, { name: string; type: string }[]>
  >({});

  /** 新对话用的 agent 模式（已有对话沿用其原 mode）；本地 storage 持久化偏好 */
  const [agentMode, setAgentMode] = useState<'single_skill' | 'master'>(() => {
    if (typeof window === 'undefined') return 'single_skill';
    return (localStorage.getItem('chatbi_agent_mode') as any) || 'single_skill';
  });

  // SSE 流式 turn 状态机
  const streaming = useStreamingTurn();

  // 初始化：拉取对话和数据源列表
  useEffect(() => {
    void refreshConversations();
    void refreshDatasources();
    void projectService
      .list()
      .then(setProjects)
      .catch(() => undefined);
    void datasetService
      .list()
      .then(setDatasets)
      .catch(() => undefined);
  }, []);

  // URL ?projectId=xxx&datasetId=xxx 来自 /datasets 或 /projects 跳转 — 自动进入 dataset 模式
  useEffect(() => {
    const pid = router.query.projectId;
    const dsid = router.query.datasetId;
    if (typeof pid === 'string' && pid !== activeProjectIdForDataset) {
      setDataMode('dataset');
      setActiveProjectIdForDataset(pid);
      // 选中指定 dataset；如果没指定，默认勾选该 project 全部 ready
      if (typeof dsid === 'string') {
        setActiveDatasetIds([dsid]);
      } else {
        const readyInProject = datasets
          .filter((d) => d.projectId === pid && d.status === 'ready')
          .map((d) => d.id);
        setActiveDatasetIds(readyInProject);
      }
      // dataset 模式仍需任一 datasource ID（后端复用其 PG 连接）
      if (!activeDatasourceId && datasources.length > 0) {
        setActiveDatasourceId(datasources[0].id);
      }
    }
  }, [
    router.query.projectId,
    router.query.datasetId,
    datasets,
    datasources,
    activeDatasourceId,
    activeProjectIdForDataset,
  ]);

  // 数据源切换 → 拉对应推荐问题
  useEffect(() => {
    if (!activeDatasourceId) {
      setSuggestedQuestions([]);
      return;
    }
    metadataService
      .listQuestions(activeDatasourceId)
      .then(setSuggestedQuestions)
      .catch(() => setSuggestedQuestions([]));
  }, [activeDatasourceId]);

  // 数据源切换 → 拉表清单（供「分析范围」下拉用）+ 清空已选
  useEffect(() => {
    if (!activeDatasourceId) {
      setDatasourceTables([]);
      return;
    }
    setAnalyzedTables([]);
    setAnalyzedColumns({});
    datasourceService
      .listTables(activeDatasourceId)
      .then(setDatasourceTables)
      .catch(() => setDatasourceTables([]));
  }, [activeDatasourceId]);

  // 分析范围变化 → 批量拉字段（供 @ 联想用）
  useEffect(() => {
    if (!activeDatasourceId || analyzedTables.length === 0) {
      setAnalyzedColumns({});
      return;
    }
    datasourceService
      .describeMany(activeDatasourceId, analyzedTables)
      .then(setAnalyzedColumns)
      .catch(() => setAnalyzedColumns({}));
  }, [activeDatasourceId, analyzedTables]);

  // 滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  // URL ?id= 切换对话
  useEffect(() => {
    const id = router.query.id;
    if (typeof id === 'string' && id !== activeId) {
      setActiveId(id);
    }
  }, [router.query.id]);

  // 切换对话时拉取历史
  useEffect(() => {
    if (activeId) {
      void loadHistory(activeId);
    } else {
      setMessages([]);
    }
  }, [activeId]);

  const refreshConversations = useCallback(async () => {
    try {
      const list = await chatService.listConversations();
      setConversations(list);
      if (!activeId && list.length > 0) {
        setActiveId(list[0].id);
      }
    } catch (err) {
      msg.error(`获取对话列表失败: ${(err as Error).message}`);
    }
  }, [activeId, msg]);

  const refreshDatasources = useCallback(async () => {
    try {
      const res = await datasourceService.list();
      setDatasources(res.data);
      if (res.data.length > 0 && !activeDatasourceId) {
        setActiveDatasourceId(res.data[0].id);
      }
    } catch (err) {
      msg.error(`获取数据源失败: ${(err as Error).message}`);
    }
  }, [activeDatasourceId, msg]);

  const loadHistory = useCallback(
    async (id: string) => {
      setLoadingHistory(true);
      try {
        const { conversation, messages: msgs } = await chatService.getHistory(id);
        setMessages(msgs);
        if (conversation.datasourceId) {
          setActiveDatasourceId(conversation.datasourceId);
        }
      } catch (err) {
        msg.error(`加载历史失败: ${(err as Error).message}`);
      } finally {
        setLoadingHistory(false);
      }
    },
    [msg],
  );

  /**
   * Claude-style SSE 流式发送。
   * 老的 axios POST /v1/chat 路径已删 — 唯一通路是 SSE。
   * clarify 答案不走这里，走 ClarifyOverlay 内的 streaming.submitClarifyAnswer。
   */
  const handleSend = async (text: string, attachmentIds?: string[]) => {
    if (!activeDatasourceId) {
      msg.warning('请先选择一个数据源');
      return;
    }
    const inDatasetMode = dataMode === 'dataset' && activeDatasetIds.length > 0;
    if (inDatasetMode && !activeProjectIdForDataset) {
      msg.warning('请选择项目');
      return;
    }
    const started = await streaming.startTurn({
      message: text,
      datasourceId: activeDatasourceId,
      conversationId: activeId || undefined,
      // dataset 模式强制 single_skill（后端也会强制；前端先提示一致）
      mode: !activeId ? (inDatasetMode ? 'single_skill' : agentMode) : undefined,
      projectId: inDatasetMode ? activeProjectIdForDataset! : undefined,
      datasetIds: inDatasetMode ? activeDatasetIds : undefined,
      // 企业模式的「分析范围」— dataset 模式不传（互斥）
      analyzedTables:
        !inDatasetMode && analyzedTables.length > 0 ? analyzedTables : undefined,
      attachmentIds,
    });
    if (!started) {
      msg.error('发送失败，请稍后重试');
      return;
    }
    // 立刻拉历史，让用户气泡出现（后端 prepareTurnForStream 已经把 user message 入库）
    await loadHistory(started.conversationId);
    if (!activeId) {
      setActiveId(started.conversationId);
      void refreshConversations();
    }
  };

  // Turn 完成（含拒答 / 错误退出）→ 轮询历史，等 assistant message 落库后渲染。
  // 后端 finalizeStreamingTurnInBackground 是 fire-and-forget 的，其中 Reviewer 一次 LLM
  // 调用通常 5–15s，所以不能用固定 timeout — 轮询直到看到新 assistant message。
  useEffect(() => {
    if (
      (streaming.state.status !== 'done' && streaming.state.status !== 'error') ||
      !streaming.state.conversationId
    ) {
      return;
    }
    const cid = streaming.state.conversationId;
    const userMsgId = streaming.state.userMessageId;
    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 30; // 30 * 800ms ≈ 24s 上限（reviewer 通常 5-15s，留余量）

    const poll = async () => {
      if (cancelled) return;
      attempts++;
      try {
        const { messages: msgs } = await chatService.getHistory(cid);
        // 判断：本次 turn 的 assistant message 是否已落库
        //   - userMsgId 存在 → 找它之后是否有 assistant
        //   - 否则只看是否比之前 messages 多
        const userIdx = userMsgId ? msgs.findIndex((m) => m.id === userMsgId) : -1;
        const hasNewAssistant =
          userIdx >= 0
            ? msgs.slice(userIdx + 1).some((m) => m.role === 'assistant')
            : msgs.length > messages.length;

        if (hasNewAssistant || attempts >= MAX_ATTEMPTS) {
          setMessages(msgs);
          void refreshConversations();
          if (!activeId) setActiveId(cid);
          return;
        }
      } catch {
        /* 网络抖动忽略，继续轮询 */
      }
      setTimeout(poll, 800);
    };

    // 立刻先 poll 一次（很多情况下 reviewer 很快就完成了）
    void poll();
    return () => {
      cancelled = true;
    };
  }, [streaming.state.status, streaming.state.conversationId, streaming.state.userMessageId]);

  const handleNewConversation = () => {
    setActiveId(null);
    setMessages([]);
  };

  const handleMoveToProject = async (
    conversationId: string,
    projectId: string | null,
  ) => {
    try {
      await chatService.updateConversation(conversationId, { projectId });
      msg.success(projectId ? '已移到项目' : '已移出项目');
      await refreshConversations();
    } catch (err) {
      msg.error(`移动失败: ${(err as Error).message}`);
    }
  };

  const handleDelete = (id: string) => {
    modal.confirm({
      title: '删除对话',
      content: '确定要删除这个对话吗？该操作不可撤销。',
      okType: 'danger',
      onOk: async () => {
        try {
          await chatService.deleteConversation(id);
          msg.success('已删除');
          if (id === activeId) {
            setActiveId(null);
            setMessages([]);
          }
          await refreshConversations();
        } catch (err) {
          msg.error(`删除失败: ${(err as Error).message}`);
        }
      },
    });
  };

  return (
    <Layout style={{ height: 'calc(100vh - 64px)' }}>
      <Layout.Sider width={240} theme="light" style={{ borderRight: '1px solid #f0f0f0' }}>
        <ConversationSidebar
          conversations={conversations}
          projects={projects}
          activeId={activeId}
          onSelect={(id) => setActiveId(id)}
          onCreate={handleNewConversation}
          onDelete={handleDelete}
          onMoveToProject={handleMoveToProject}
        />
      </Layout.Sider>
      <Layout.Content style={{ display: 'flex', flexDirection: 'column' }}>
        {/* 顶部：数据源选择 */}
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid #f0f0f0',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <Space wrap size={12}>
            <Segmented
              value={dataMode}
              onChange={(v) => setDataMode(v as DataMode)}
              disabled={!!activeId}
              options={[
                { label: <><DatabaseOutlined /> 企业数据库</>, value: 'datasource' },
                { label: <><FolderOpenOutlined /> 我的数据集</>, value: 'dataset' },
              ]}
            />

            {dataMode === 'datasource' ? (
              <>
                <Select
                  style={{ minWidth: 260 }}
                  value={activeDatasourceId || undefined}
                  onChange={(v) => setActiveDatasourceId(v)}
                  placeholder="选择数据库"
                  options={datasources.map((d) => ({
                    value: d.id,
                    label: (
                      <Space>
                        <Tag color="blue">{d.type}</Tag>
                        {d.name}
                      </Space>
                    ),
                  }))}
                  notFoundContent={
                    <div style={{ padding: 8 }}>
                      暂无数据源，
                      <a onClick={() => router.push('/datasource')}>去连接</a>
                    </div>
                  }
                />
                <Tooltip
                  title={
                    activeId
                      ? '已有对话沿用其原模式，新对话才能切换'
                      : 'single：单一 Skill 专注回答（快）；master：跨 Skill 智能调度子 agent（强）'
                  }
                >
                  <Segmented
                    size="small"
                    disabled={!!activeId}
                    value={agentMode}
                    onChange={(v) => {
                      const m = v as 'single_skill' | 'master';
                      setAgentMode(m);
                      if (typeof window !== 'undefined') localStorage.setItem('chatbi_agent_mode', m);
                    }}
                    options={[
                      { label: <><BookOutlined /> 单 Skill</>, value: 'single_skill' },
                      { label: <><ApartmentOutlined /> Master 调度</>, value: 'master' },
                    ]}
                  />
                </Tooltip>
              </>
            ) : (
              <>
                <Select
                  style={{ minWidth: 220 }}
                  value={activeProjectIdForDataset || undefined}
                  onChange={(pid) => {
                    setActiveProjectIdForDataset(pid);
                    // 切 project → 默认勾选该 project 下所有 ready dataset
                    const ready = datasets
                      .filter((d) => d.projectId === pid && d.status === 'ready')
                      .map((d) => d.id);
                    setActiveDatasetIds(ready);
                    // 确保有任一 datasource ID（后端复用其 PG 连接）
                    if (!activeDatasourceId && datasources.length > 0) {
                      setActiveDatasourceId(datasources[0].id);
                    }
                  }}
                  placeholder="选择项目"
                  options={projects.map((p) => ({
                    value: p.id,
                    label: (
                      <Space>
                        {p.isPersonalWorkspace ? <UserOutlined /> : <TeamOutlined />}
                        {p.name}
                      </Space>
                    ),
                  }))}
                  notFoundContent={
                    <div style={{ padding: 8 }}>
                      还没有项目数据集，
                      <a onClick={() => router.push('/datasets')}>去上传</a>
                    </div>
                  }
                />

                {activeProjectIdForDataset && (
                  <Select
                    mode="multiple"
                    style={{ minWidth: 280, maxWidth: 460 }}
                    value={activeDatasetIds}
                    onChange={setActiveDatasetIds}
                    placeholder="选择参与对话的数据集（多选 → 自动 JOIN）"
                    maxTagCount="responsive"
                    options={datasets
                      .filter(
                        (d) => d.projectId === activeProjectIdForDataset && d.status === 'ready',
                      )
                      .map((d) => ({
                        value: d.id,
                        label: (
                          <Space>
                            <DatabaseOutlined style={{ color: '#1677ff' }} />
                            {d.displayName}
                            <Text type="secondary" style={{ fontSize: 11 }}>
                              {d.rowCount} 行
                            </Text>
                          </Space>
                        ),
                      }))}
                    notFoundContent={<Text type="secondary">该项目下还没有可用数据集</Text>}
                  />
                )}

                {activeDatasetIds.length >= 2 && (
                  <Tooltip title="多张表可自动 JOIN">
                    <Tag color="purple">📐 多表 JOIN ({activeDatasetIds.length})</Tag>
                  </Tooltip>
                )}
              </>
            )}
          </Space>
        </div>

        {/* 消息流 */}
        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px 24px',
            background: '#fafafa',
          }}
        >
          {loadingHistory ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Spin />
            </div>
          ) : messages.length === 0 ? (
            <Empty
              description={
                activeDatasourceId
                  ? '输入问题开始分析 ✨'
                  : '请先选择或创建一个数据源'
              }
              style={{ marginTop: 80 }}
            />
          ) : (
            // SSE 路径：clarify 走 Overlay 不在消息流，user/assistant message 直出
            messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                onPickFollowUp={(text) => void handleSend(text)}
              />
            ))
          )}

          {/* 当前 turn 正在跑 → 流式显示推理过程
              即使 status=done，也保留直到 assistant message 真正出现在 messages 列表
              （后端 reviewer + DB 写入需要 5-15s，避免视觉断层）

              ⚠️ 关键：streaming 是全局 hook，必须**只在 streaming 关联到当前对话时**渲染。
              否则切换对话会看到别的对话的实时推理（SSE 串扰 bug）。*/}
          {(() => {
            const s = streaming.state.status;
            if (s === 'idle') return null;
            // 隔离：streaming 必须绑定当前打开的对话；否则可能是上一个对话的残留流
            if (streaming.state.conversationId !== activeId) return null;
            // 已完成 + assistant message 已落到 messages → 隐藏
            if (
              (s === 'done' || s === 'error') &&
              streaming.state.userMessageId
            ) {
              const userIdx = messages.findIndex(
                (m) => m.id === streaming.state.userMessageId,
              );
              const hasNewAssistant =
                userIdx >= 0 &&
                messages.slice(userIdx + 1).some((m) => m.role === 'assistant');
              if (hasNewAssistant) return null;
            }
            return <LiveTurnBubble state={streaming.state} />;
          })()}
        </div>

        {/* 推荐问题 chips */}
        {/* AI 生成的附件 chips（消息流与推荐问题之间）*/}
        <AttachmentChips conversationId={activeId} refreshKey={messages.length} />

        {/* 企业模式「分析范围」引导 — 傻瓜式 hint 条 + Modal 选表 */}
        {dataMode === 'datasource' && activeDatasourceId && (
          <AnalyzedScopeBar
            tables={datasourceTables}
            selected={analyzedTables}
            onChange={setAnalyzedTables}
            loading={datasourceTables.length === 0}
          />
        )}

        {activeDatasourceId && suggestedQuestions.length > 0 && (
          <div
            style={{
              padding: '8px 24px',
              borderTop: '1px solid #f0f0f0',
              background: '#fafafa',
            }}
          >
            <Space size={[6, 6]} wrap>
              <Text type="secondary" style={{ fontSize: 12 }}>
                <ThunderboltOutlined /> 推荐问题：
              </Text>
              {suggestedQuestions.slice(0, 8).map((q) => (
                <Tag
                  key={q.id}
                  color={q.source === 'learned' ? 'cyan' : 'blue'}
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => void handleSend(q.questionText)}
                >
                  {q.questionText}
                </Tag>
              ))}
            </Space>
          </div>
        )}

        {/* 输入框 + Clarify 浮层 */}
        <div style={{ position: 'relative', padding: '12px 24px', borderTop: '1px solid #f0f0f0' }}>
          {!activeDatasourceId && (
            <Alert
              type="warning"
              message="尚未选择数据源，请先在上方选择"
              style={{ marginBottom: 8 }}
            />
          )}

          {/* Claude-style：clarify 浮在输入框上方 — 同 turn 内一直浮着，用户答完后自动收起
              同样的对话隔离：只在 streaming 对应当前对话时才显示弹窗 */}
          {streaming.state.status === 'paused_clarify' &&
            streaming.state.pendingClarify &&
            streaming.state.conversationId === activeId && (
              <ClarifyOverlay
                clarify={streaming.state.pendingClarify}
                onAnswer={(answer) => void streaming.submitClarifyAnswer(answer)}
              />
            )}

          <ChatInput
            onSend={handleSend}
            loading={
              // 仅在 streaming 对应当前对话时锁输入框（避免别的对话跑流时本对话不能输入）
              streaming.state.conversationId === activeId &&
              (streaming.state.status === 'streaming' ||
                streaming.state.status === 'paused_clarify')
            }
            disabled={!activeDatasourceId}
            activeDatasets={
              dataMode === 'dataset'
                ? datasets.filter((d) => activeDatasetIds.includes(d.id))
                : []
            }
            mentionFields={
              dataMode === 'datasource' && analyzedTables.length > 0
                ? Object.entries(analyzedColumns).flatMap(([tableName, cols]) =>
                    cols.map((c) => ({
                      name: c.name,
                      type: c.type,
                      source: tableName,
                    })),
                  )
                : undefined
            }
            mentionLoading={
              // 已选表但字段还没到 → 字段加载中
              dataMode === 'datasource' &&
              analyzedTables.length > 0 &&
              Object.keys(analyzedColumns).length === 0
            }
          />
        </div>
      </Layout.Content>
    </Layout>
  );
}
