import React, { useState } from 'react';
import Link from 'next/link';
import {
  Button,
  Dropdown,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { MenuProps } from 'antd';
import {
  CaretDownOutlined,
  CaretRightOutlined,
  DeleteOutlined,
  EllipsisOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  PlusOutlined,
  ProjectOutlined,
  UpOutlined,
  DownOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
import { Conversation } from '@/types';
import type { Project } from '@/services';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const { Text } = Typography;

interface Props {
  conversations: Conversation[];
  projects: Project[];
  activeId?: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  /** 移动到项目（null = 移出项目）*/
  onMoveToProject: (conversationId: string, projectId: string | null) => void;
}

const PROJECTS_COLLAPSED = 4;
const PERSONAL_INITIAL = 20;
const PERSONAL_LOAD_STEP = 20;

function sortProjectsByLastActivity(
  projects: Project[],
  conversations: Conversation[],
): Project[] {
  const latest = new Map<string, number>();
  for (const c of conversations) {
    if (!c.projectId) continue;
    const ts = new Date(c.updatedAt).getTime();
    if (ts > (latest.get(c.projectId) || 0)) latest.set(c.projectId, ts);
  }
  return [...projects].sort((a, b) => {
    const tA = latest.get(a.id) || new Date(a.updatedAt).getTime();
    const tB = latest.get(b.id) || new Date(b.updatedAt).getTime();
    return tB - tA;
  });
}

function relativeLabel(ts: string): string {
  const d = dayjs(ts);
  const now = dayjs();
  if (d.isAfter(now.startOf('day'))) return d.format('HH:mm');
  if (d.isAfter(now.subtract(1, 'day').startOf('day'))) return '昨天';
  if (d.isAfter(now.subtract(7, 'day'))) return d.format('dddd');
  return d.format('MM-DD');
}

/** 单个对话项 — 行内 ⋮ 菜单 */
interface ConversationItemProps {
  conv: Conversation;
  active: boolean;
  inProject: boolean; // 当前展示是否在项目分组内
  projects: Project[];
  currentProjectId?: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onMoveToProject: (id: string, projectId: string | null) => void;
}

const ConversationItem: React.FC<ConversationItemProps> = ({
  conv,
  active,
  inProject,
  projects,
  currentProjectId,
  onSelect,
  onDelete,
  onMoveToProject,
}) => {
  // 构建"移动到项目"子菜单：
  //   - 项目对话内：候选包括"移出项目" + 其它所有项目（除自己）
  //   - 个人对话：候选是所有项目
  const moveItems: MenuProps['items'] = [];
  if (inProject) {
    moveItems.push({
      key: 'remove-from-project',
      icon: <FolderOutlined />,
      label: '移出项目',
      onClick: ({ domEvent }) => {
        domEvent.stopPropagation();
        onMoveToProject(conv.id, null);
      },
    });
    moveItems.push({ type: 'divider' });
  }
  for (const p of projects) {
    if (p.id === currentProjectId) continue;
    moveItems.push({
      key: `move-${p.id}`,
      icon: <span>{p.icon || <ProjectOutlined />}</span>,
      label: p.name,
      onClick: ({ domEvent }) => {
        domEvent.stopPropagation();
        onMoveToProject(conv.id, p.id);
      },
    });
  }
  if (moveItems.length === 0 || (moveItems.length === 1 && (moveItems[0] as any).type === 'divider')) {
    moveItems.push({
      key: 'no-project',
      disabled: true,
      label: <Text type="secondary" style={{ fontSize: 12 }}>暂无其它项目可移入</Text>,
    });
  }

  const dropdownItems: MenuProps['items'] = [
    {
      key: 'move',
      icon: <SwapOutlined />,
      label: '移动到',
      children: moveItems,
    },
    { type: 'divider' },
    {
      key: 'delete',
      icon: <DeleteOutlined />,
      label: '删除',
      danger: true,
      onClick: ({ domEvent }) => {
        domEvent.stopPropagation();
        onDelete(conv.id);
      },
    },
  ];

  return (
    <div
      onClick={() => onSelect(conv.id)}
      style={{
        cursor: 'pointer',
        background: active ? '#e6f4ff' : 'transparent',
        borderRadius: 6,
        padding: '6px 8px',
        marginBottom: 2,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}
      className={active ? '' : 'sidebar-hover'}
    >
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <Text
          ellipsis
          style={{
            display: 'block',
            fontSize: 13,
            fontWeight: active ? 600 : 400,
            lineHeight: 1.4,
          }}
        >
          {conv.title || '新对话'}
        </Text>
        <Text type="secondary" style={{ fontSize: 11 }}>
          {relativeLabel(conv.updatedAt)}
        </Text>
      </div>
      <Dropdown menu={{ items: dropdownItems }} trigger={['click']} placement="bottomRight">
        <Button
          type="text"
          size="small"
          icon={<EllipsisOutlined />}
          onClick={(e) => e.stopPropagation()}
          style={{ color: '#bfbfbf' }}
        />
      </Dropdown>
    </div>
  );
};

export const ConversationSidebar: React.FC<Props> = ({
  conversations,
  projects,
  activeId,
  onSelect,
  onCreate,
  onDelete,
  onMoveToProject,
}) => {
  const [projectsExpanded, setProjectsExpanded] = useState(false);
  const [personalLimit, setPersonalLimit] = useState(PERSONAL_INITIAL);
  /** 每个项目展开/折叠状态。默认全展开 */
  const [openProjects, setOpenProjects] = useState<Record<string, boolean>>({});

  const sortedProjects = sortProjectsByLastActivity(projects, conversations);
  const visibleProjects = projectsExpanded
    ? sortedProjects
    : sortedProjects.slice(0, PROJECTS_COLLAPSED);

  // 按项目分组
  const byProject = new Map<string, Conversation[]>();
  const personal: Conversation[] = [];
  for (const c of conversations) {
    if (c.projectId) {
      const arr = byProject.get(c.projectId) || [];
      arr.push(c);
      byProject.set(c.projectId, arr);
    } else {
      personal.push(c);
    }
  }

  const visiblePersonal = personal.slice(0, personalLimit);
  const hasMorePersonal = personal.length > personalLimit;

  const toggleProject = (pid: string) => {
    setOpenProjects((s) => ({ ...s, [pid]: !(s[pid] ?? true) }));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 新建对话 */}
      <div style={{ padding: 12 }}>
        <Button type="primary" block icon={<PlusOutlined />} onClick={onCreate}>
          新建对话
        </Button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 12px' }}>
        {/* 项目区 */}
        {sortedProjects.length > 0 && (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '4px 8px',
                color: '#8f959e',
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              <span>
                <ProjectOutlined /> 项目 ({sortedProjects.length})
              </span>
              <Link href="/projects" style={{ fontSize: 12 }}>
                管理
              </Link>
            </div>

            {visibleProjects.map((p) => {
              const convs = byProject.get(p.id) || [];
              const isOpen = openProjects[p.id] ?? true;
              return (
                <div key={p.id} style={{ marginBottom: 4 }}>
                  <div
                    onClick={() => toggleProject(p.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 8px',
                      borderRadius: 6,
                      cursor: 'pointer',
                    }}
                    className="sidebar-hover"
                  >
                    {isOpen ? (
                      <CaretDownOutlined style={{ fontSize: 10, color: '#8f959e' }} />
                    ) : (
                      <CaretRightOutlined style={{ fontSize: 10, color: '#8f959e' }} />
                    )}
                    <span style={{ fontSize: 14 }}>{p.icon || <FolderOpenOutlined />}</span>
                    <Text ellipsis strong style={{ flex: 1, fontSize: 13 }}>
                      {p.name}
                    </Text>
                    {convs.length > 0 && (
                      <Tag color="blue" style={{ marginInlineEnd: 0, fontSize: 11 }}>
                        {convs.length}
                      </Tag>
                    )}
                  </div>
                  {isOpen && (
                    <div style={{ paddingLeft: 18 }}>
                      {convs.length === 0 && (
                        <Text
                          type="secondary"
                          style={{ display: 'block', fontSize: 12, padding: '4px 8px' }}
                        >
                          暂无对话
                        </Text>
                      )}
                      {convs.map((c) => (
                        <ConversationItem
                          key={c.id}
                          conv={c}
                          active={c.id === activeId}
                          inProject={true}
                          currentProjectId={p.id}
                          projects={sortedProjects}
                          onSelect={onSelect}
                          onDelete={onDelete}
                          onMoveToProject={onMoveToProject}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {sortedProjects.length > PROJECTS_COLLAPSED && (
              <Button
                type="link"
                size="small"
                block
                onClick={() => setProjectsExpanded((v) => !v)}
                icon={projectsExpanded ? <UpOutlined /> : <DownOutlined />}
                style={{ fontSize: 12, padding: '4px 8px' }}
              >
                {projectsExpanded
                  ? '收起项目'
                  : `更多 ${sortedProjects.length - PROJECTS_COLLAPSED} 个项目`}
              </Button>
            )}

            <div style={{ height: 1, background: '#f0f0f0', margin: '8px 4px' }} />
          </>
        )}

        {/* 个人对话区 */}
        <div
          style={{
            padding: '4px 8px',
            fontSize: 12,
            fontWeight: 500,
            color: '#8f959e',
          }}
        >
          个人对话 ({personal.length})
        </div>
        {personal.length === 0 && (
          <Text
            type="secondary"
            style={{ display: 'block', padding: '8px 12px', fontSize: 12 }}
          >
            暂无个人对话
          </Text>
        )}
        {visiblePersonal.map((c) => (
          <ConversationItem
            key={c.id}
            conv={c}
            active={c.id === activeId}
            inProject={false}
            projects={sortedProjects}
            onSelect={onSelect}
            onDelete={onDelete}
            onMoveToProject={onMoveToProject}
          />
        ))}
        {hasMorePersonal && (
          <Button
            type="link"
            size="small"
            block
            onClick={() => setPersonalLimit((n) => n + PERSONAL_LOAD_STEP)}
            style={{ fontSize: 12, marginTop: 4 }}
          >
            加载更多（剩 {personal.length - personalLimit}）
          </Button>
        )}
      </div>

      <style jsx global>{`
        .sidebar-hover:hover {
          background: #f5f5f5;
        }
      `}</style>
    </div>
  );
};
