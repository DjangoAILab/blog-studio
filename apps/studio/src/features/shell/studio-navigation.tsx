import { Menu } from '@base-ui/react/menu';
import type { Site } from '@blog-studio/core';
import { LayoutGroup, motion } from 'motion/react';

export type StudioDestination = 'site' | 'content' | 'settings';

interface StudioNavigationProps {
  readonly sites: readonly Site[];
  readonly site?: Site | undefined;
  readonly destination: StudioDestination;
  readonly pendingChanges: number;
  readonly preparing: boolean;
  readonly onDestinationChange: (destination: StudioDestination) => void;
  readonly onSiteChange: (site: Site) => void;
  readonly onCreateDocument: () => void;
  readonly onPrepareChanges: () => void;
}

const destinations: readonly {
  readonly id: StudioDestination;
  readonly label: string;
}[] = [
  { id: 'site', label: '站点' },
  { id: 'content', label: '内容' },
  { id: 'settings', label: '系统' },
];

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="10.8" cy="10.8" r="6.5" />
      <path d="m16 16 4.2 4.2" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="m4.5 6 3.5 3.5L11.5 6" />
    </svg>
  );
}

export function StudioNavigation({
  sites,
  site,
  destination,
  pendingChanges,
  preparing,
  onDestinationChange,
  onSiteChange,
  onCreateDocument,
  onPrepareChanges,
}: StudioNavigationProps) {
  return (
    <header className="studio2-nav-wrap">
      <div className="studio2-nav" aria-label="Blog Studio 主导航">
        <button
          className="studio2-wordmark"
          type="button"
          onClick={() => onDestinationChange('site')}
        >
          Blog Studio
        </button>

        <Menu.Root>
          <Menu.Trigger
            className="studio2-site-trigger"
            aria-label="当前站点"
            disabled={!site}
          >
            <span className="studio2-site-avatar" aria-hidden="true">
              {site?.displayName.slice(0, 1) ?? '站'}
            </span>
            <span className="studio2-site-copy">
              <strong>{site?.displayName ?? '尚未添加站点'}</strong>
              <small>{site?.canonicalUrl ?? '完成首次设置后开始写作'}</small>
            </span>
            <ChevronIcon />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner align="start" sideOffset={10}>
              <Menu.Popup className="studio2-menu">
                <Menu.Group>
                  <Menu.GroupLabel className="studio2-menu-label">
                    站点
                  </Menu.GroupLabel>
                  {sites.map((item) => (
                    <Menu.Item
                      className="studio2-menu-item"
                      key={item.id}
                      onClick={() => onSiteChange(item)}
                    >
                      <span className="studio2-menu-avatar" aria-hidden="true">
                        {item.displayName.slice(0, 1)}
                      </span>
                      <span>
                        <strong>{item.displayName}</strong>
                        <small>{item.canonicalUrl ?? item.id}</small>
                      </span>
                      {item.id === site?.id ? (
                        <b aria-label="当前选择">✓</b>
                      ) : null}
                    </Menu.Item>
                  ))}
                </Menu.Group>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>

        <LayoutGroup id="studio-destinations">
          <nav className="studio2-destinations" aria-label="主要区域">
            {destinations.map((item) => (
              <button
                aria-current={destination === item.id ? 'page' : undefined}
                className={destination === item.id ? 'is-current' : ''}
                key={item.id}
                type="button"
                onClick={() => onDestinationChange(item.id)}
              >
                {destination === item.id ? (
                  <motion.span
                    className="studio2-destination-pill"
                    layoutId="studio-destination-pill"
                    transition={{
                      type: 'spring',
                      stiffness: 460,
                      damping: 38,
                      mass: 0.72,
                    }}
                  />
                ) : null}
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </LayoutGroup>

        <div className="studio2-nav-actions">
          <button
            className="studio2-icon-button"
            type="button"
            aria-label="搜索内容"
            onClick={() => onDestinationChange('content')}
          >
            <SearchIcon />
          </button>
          <button
            className="studio2-secondary-button"
            type="button"
            onClick={onCreateDocument}
          >
            新建文章
          </button>
          <motion.button
            aria-label={preparing ? '正在整理更改' : '准备更改'}
            className="studio2-prepare-button"
            disabled={!site || preparing}
            layout
            whileTap={{ scale: 0.975 }}
            type="button"
            onClick={onPrepareChanges}
          >
            <span>{preparing ? '正在整理…' : '准备更改'}</span>
            {pendingChanges > 0 ? (
              <b aria-label={`${pendingChanges} 项待检查`}>{pendingChanges}</b>
            ) : null}
          </motion.button>
        </div>
      </div>
    </header>
  );
}
