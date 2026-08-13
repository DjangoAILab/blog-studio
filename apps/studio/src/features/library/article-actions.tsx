import { Menu } from '@base-ui/react/menu';

import type { ContentSummary } from '../../app/api.js';

interface ArticleActionsProps {
  readonly article: ContentSummary;
  readonly compact?: boolean;
  readonly onOpen: (article: ContentSummary) => void;
  readonly onPublish?: (article: ContentSummary) => void;
  readonly onDelete?: (article: ContentSummary) => void;
}

export function ArticleActions({
  article,
  compact = false,
  onOpen,
  onPublish,
  onDelete,
}: ArticleActionsProps) {
  return (
    <Menu.Root>
      <Menu.Trigger
        className={compact ? 'studio2-icon-more' : 'studio2-row-more is-action'}
        aria-label="更多操作"
        onClick={(event) => event.stopPropagation()}
      >
        •••
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          className="studio2-menu-positioner"
          align="end"
          sideOffset={6}
        >
          <Menu.Popup className="studio2-menu">
            <Menu.Group>
              <Menu.GroupLabel className="studio2-menu-label">
                文章
              </Menu.GroupLabel>
              <Menu.Item
                className="studio2-menu-item"
                onClick={() => onOpen(article)}
              >
                <span className="studio2-menu-avatar" aria-hidden="true">
                  开
                </span>
                <span>
                  <strong>打开</strong>
                  <small>在编辑器中查看</small>
                </span>
              </Menu.Item>
              {article.sourceState === 'draft' && onPublish ? (
                <Menu.Item
                  className="studio2-menu-item"
                  onClick={() => onPublish(article)}
                >
                  <span className="studio2-menu-avatar" aria-hidden="true">
                    发
                  </span>
                  <span>
                    <strong>转为正式文章</strong>
                    <small>从草稿移到已发布目录</small>
                  </span>
                </Menu.Item>
              ) : null}
              {onDelete ? (
                <Menu.Item
                  className="studio2-menu-item"
                  onClick={() => onDelete(article)}
                >
                  <span className="studio2-menu-avatar" aria-hidden="true">
                    删
                  </span>
                  <span>
                    <strong>删除</strong>
                    <small>
                      {article.sourceState === 'draft'
                        ? '从磁盘移除这篇草稿'
                        : '从磁盘删除这篇文章'}
                    </small>
                  </span>
                </Menu.Item>
              ) : null}
            </Menu.Group>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
