'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';

// Types
interface MenuItemOption {
  label?: string;
  action?: string;
  shortcut?: string;
  type?: 'item' | 'separator';
  hasSubmenu?: boolean;
}

interface MenuConfig {
  label: string;
  /** Dropdown items. Omit (or leave empty) to render this entry as a direct link. */
  items?: MenuItemOption[];
  /** Fired when a dropdown-less entry is clicked. */
  action?: string;
}

interface MacOSMenuBarProps {
  appName?: string;
  /** Fired when the brand/app name is clicked (e.g. navigate home). */
  appAction?: string;
  menus?: MenuConfig[];
  onMenuAction?: (action: string) => void;
  className?: string;
  /** Custom content rendered at the far right of the bar (e.g. an account menu). */
  rightSlot?: React.ReactNode;
  /** Action of the currently active top-level link, used for highlighting. */
  activeAction?: string;
  /** Show the decorative Apple logo on the left (default: true). */
  showAppleLogo?: boolean;
}

// Default Finder menus
const DEFAULT_MENUS: MenuConfig[] = [
  {
    label: 'File',
    items: [
      { label: 'New Tab', action: 'new-tab', shortcut: '⌘T' },
      { label: 'New Window', action: 'new-window', shortcut: '⌘N' },
      { label: 'New Private Window', action: 'new-private', shortcut: '⇧⌘N' },
      { type: 'separator' },
      { label: 'Open File...', action: 'open-file', shortcut: '⌘O' },
      { label: 'Open Location...', action: 'open-location', shortcut: '⌘L' },
      { type: 'separator' },
      { label: 'Close Window', action: 'close-window', shortcut: '⇧⌘W' },
      { label: 'Close Tab', action: 'close-tab', shortcut: '⌘W' },
      { label: 'Save Page As...', action: 'save-page', shortcut: '⌘S' },
      { type: 'separator' },
      { label: 'Share', action: 'share', hasSubmenu: true },
      { type: 'separator' },
      { label: 'Print...', action: 'print', shortcut: '⌘P' },
    ],
  },
  {
    label: 'Edit',
    items: [
      { label: 'Undo', action: 'undo', shortcut: '⌘Z' },
      { label: 'Redo', action: 'redo', shortcut: '⇧⌘Z' },
      { type: 'separator' },
      { label: 'Cut', action: 'cut', shortcut: '⌘X' },
      { label: 'Copy', action: 'copy', shortcut: '⌘C' },
      { label: 'Paste', action: 'paste', shortcut: '⌘V' },
      { label: 'Select All', action: 'select-all', shortcut: '⌘A' },
      { type: 'separator' },
      { label: 'Find', action: 'find', shortcut: '⌘F' },
      { label: 'Find Next', action: 'find-next', shortcut: '⌘G' },
      { label: 'Find Previous', action: 'find-prev', shortcut: '⇧⌘G' },
      { type: 'separator' },
      { label: 'Emoji & Symbols', action: 'emoji', shortcut: '⌃⌘␣' },
    ],
  },
  {
    label: 'View',
    items: [
      { label: 'as Icons', action: 'view-icons', shortcut: '⌘1' },
      { label: 'as List', action: 'view-list', shortcut: '⌘2' },
      { label: 'as Columns', action: 'view-columns', shortcut: '⌘3' },
      { label: 'as Gallery', action: 'view-gallery', shortcut: '⌘4' },
      { type: 'separator' },
      { label: 'Use Stacks', action: 'use-stacks', shortcut: '⌃⌘0' },
      { label: 'Sort By', action: 'sort-by', hasSubmenu: true },
      { type: 'separator' },
      { label: 'Hide Sidebar', action: 'hide-sidebar', shortcut: '⌥⌘S' },
      { label: 'Show Preview', action: 'show-preview', shortcut: '⇧⌘P' },
      { type: 'separator' },
      { label: 'Enter Full Screen', action: 'fullscreen', shortcut: '⌃⌘F' },
    ],
  },
  {
    label: 'Window',
    items: [
      { label: 'Minimize', action: 'minimize', shortcut: '⌘M' },
      { label: 'Zoom', action: 'zoom' },
      { type: 'separator' },
      { label: 'Cycle Through Windows', action: 'cycle-windows', shortcut: '⌘`' },
      { type: 'separator' },
      { label: 'Bring All to Front', action: 'bring-to-front' },
    ],
  },
  {
    label: 'Help',
    items: [
      { label: 'Search', action: 'search-help' },
      { type: 'separator' },
      { label: 'App Help', action: 'app-help' },
      { label: 'Keyboard Shortcuts', action: 'shortcuts' },
      { type: 'separator' },
      { label: 'Contact Support', action: 'contact-support' },
    ],
  },
];

// Apple menu items
const APPLE_MENU_ITEMS: MenuItemOption[] = [
  { label: 'About This Mac', action: 'about' },
  { type: 'separator' },
  { label: 'System Preferences...', action: 'preferences' },
  { label: 'App Store...', action: 'app-store' },
  { type: 'separator' },
  { label: 'Recent Items', action: 'recent', hasSubmenu: true },
  { type: 'separator' },
  { label: 'Force Quit Applications...', action: 'force-quit', shortcut: '⌥⌘⎋' },
  { type: 'separator' },
  { label: 'Sleep', action: 'sleep' },
  { label: 'Restart...', action: 'restart' },
  { label: 'Shut Down...', action: 'shutdown' },
  { type: 'separator' },
  { label: 'Lock Screen', action: 'lock', shortcut: '⌃⌘Q' },
  { label: 'Log Out...', action: 'logout', shortcut: '⇧⌘Q' },
];

// MenuDropdown Component (bundled inside)
interface MenuDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  items: MenuItemOption[];
  position: { x: number; y: number };
  onAction?: (action: string) => void;
}

const MenuDropdown: React.FC<MenuDropdownProps> = ({
  isOpen,
  onClose,
  items,
  position,
  onAction
}) => {
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={dropdownRef}
      className="absolute backdrop-blur-md z-[60]"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        background: 'rgba(40, 40, 40, 0.75)',
        border: '1px solid rgba(255, 255, 255, 0.18)',
        borderRadius: '8px',
        boxShadow: `
          0 8px 32px rgba(0, 0, 0, 0.4),
          0 2px 8px rgba(0, 0, 0, 0.3),
          inset 0 1px 0 rgba(255, 255, 255, 0.12)
        `,
        minWidth: '220px',
        animation: 'menuFadeIn 0.15s cubic-bezier(0.23, 1, 0.32, 1) forwards'
      }}
    >
      <div className="py-1">
        {items.map((item, index) => {
          if (item.type === 'separator') {
            return (
              <div
                key={index}
                className="h-px bg-white/15 mx-2 my-1"
              />
            );
          }

          return (
            <div
              key={index}
              className="px-4 py-1 text-white text-sm cursor-pointer hover:bg-white/10 transition-colors duration-100 flex justify-between items-center"
              onClick={() => {
                if (item.action) {
                  onAction?.(item.action);
                }
                onClose();
              }}
            >
              <span className="flex items-center">
                {item.label}
                {item.hasSubmenu && (
                  <span className="ml-2 text-xs opacity-70">▶</span>
                )}
              </span>
              {item.shortcut && (
                <span className="text-xs text-white/60 ml-4">
                  {item.shortcut}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <style jsx>{`
        @keyframes menuFadeIn {
          from {
            opacity: 0;
            transform: scale(0.95) translateY(-5px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
      `}</style>
    </div>
  );
};

/**
 * MacOS Menu Bar Component
 *
 * An authentic macOS-style menu bar with glassmorphic design, live clock,
 * and customizable menus.
 *
 * @param appName - The application name to display (default: "Finder")
 * @param appIcon - URL to the app icon/logo (default: Apple logo)
 * @param menus - Array of menu configurations (default: Finder menus)
 * @param onMenuAction - Callback when a menu item is clicked
 * @param className - Additional CSS classes
 *
 * @example
 * ```tsx
 * // Basic usage with defaults
 * <MacOSMenuBar />
 *
 * // With custom app name
 * <MacOSMenuBar appName="VS Code" />
 *
 * // With custom menus
 * <MacOSMenuBar
 *   appName="My App"
 *   menus={customMenus}
 *   onMenuAction={(action) => console.log(action)}
 * />
 * ```
 */
const MacOSMenuBar: React.FC<MacOSMenuBarProps> = ({
  appName = 'Finder',
  appAction,
  menus = DEFAULT_MENUS,
  onMenuAction,
  className = '',
  rightSlot,
  activeAction,
  showAppleLogo = true
}) => {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ x: 0, y: 0 });

  const appleLogoRef = useRef<HTMLDivElement>(null);
  const mobileBtnRef = useRef<HTMLButtonElement>(null);
  const menuRefs = useRef<{ [key: string]: HTMLSpanElement | null }>({});

  // Flattened list of all entries, used by the mobile hamburger dropdown.
  const mobileItems: MenuItemOption[] = menus.flatMap((menu) =>
    menu.items && menu.items.length > 0
      ? menu.items
      : [{ label: menu.label, action: menu.action }]
  );

  const handleAppleMenuClick = useCallback(() => {
    if (activeMenu === 'apple') {
      setActiveMenu(null);
    } else {
      if (appleLogoRef.current) {
        const rect = appleLogoRef.current.getBoundingClientRect();
        const parentRect = appleLogoRef.current.offsetParent?.getBoundingClientRect() || { left: 0, top: 0 };
        setDropdownPosition({
          x: rect.left - parentRect.left,
          y: 34 // Fixed position below the menu bar (32px height + 2px spacing)
        });
      }
      setActiveMenu('apple');
    }
  }, [activeMenu]);

  const handleMenuItemClick = useCallback((menuLabel: string) => {
    if (activeMenu === menuLabel) {
      setActiveMenu(null);
    } else {
      const menuRef = menuRefs.current[menuLabel];
      if (menuRef) {
        const rect = menuRef.getBoundingClientRect();
        const parentRect = menuRef.offsetParent?.getBoundingClientRect() || { left: 0, top: 0 };
        setDropdownPosition({
          x: rect.left - parentRect.left,
          y: 34 // Fixed position below the menu bar (32px height + 2px spacing)
        });
        setActiveMenu(menuLabel);
      }
    }
  }, [activeMenu]);

  const handleMobileClick = useCallback(() => {
    if (activeMenu === 'mobile') {
      setActiveMenu(null);
      return;
    }
    if (mobileBtnRef.current) {
      const rect = mobileBtnRef.current.getBoundingClientRect();
      const parentRect = mobileBtnRef.current.offsetParent?.getBoundingClientRect() || { left: 0, top: 0 };
      setDropdownPosition({ x: rect.left - parentRect.left, y: 34 });
    }
    setActiveMenu('mobile');
  }, [activeMenu]);

  const handleTopLevelClick = useCallback((menu: MenuConfig) => {
    if (menu.items && menu.items.length > 0) {
      handleMenuItemClick(menu.label);
    } else if (menu.action) {
      setActiveMenu(null);
      onMenuAction?.(menu.action);
    }
  }, [handleMenuItemClick, onMenuAction]);

  const closeDropdown = useCallback(() => {
    setActiveMenu(null);
  }, []);

  const handleMenuAction = useCallback((action: string) => {
    onMenuAction?.(action);
  }, [onMenuAction]);

  return (
    <div style={{ position: 'relative' }}>
      <div
        className={`backdrop-blur-md ${className}`}
        style={{
          height: '32px',
          background: 'rgba(40, 40, 40, 0.65)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: '8px',
          boxShadow: `
            0 2px 8px rgba(0, 0, 0, 0.2),
            inset 0 1px 0 rgba(255, 255, 255, 0.12)
          `
        }}
      >
        <div className="flex justify-between items-center h-full px-4">
          {/* Left section - brand and nav links */}
          <div className="flex items-center space-x-3">
            {/* Mobile hamburger (collapses nav links on small screens) */}
            {menus.length > 0 && (
              <button
                ref={mobileBtnRef}
                onClick={handleMobileClick}
                aria-label="Open navigation menu"
                className="md:hidden flex items-center justify-center text-white/80 hover:text-white transition-colors duration-150 -ml-1"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </button>
            )}

            {/* Apple Logo (decorative, optional) */}
            {showAppleLogo && (
              <div
                ref={appleLogoRef}
                onClick={handleAppleMenuClick}
                className="cursor-pointer hover:opacity-80 transition-opacity duration-150"
              >
                <svg
                  width="15"
                  height="19"
                  viewBox="0 0 110 140"
                  fill="white"
                  style={{ display: 'block' }}
                >
                  <path d="M0 0 C5.58236403 2.09904125 9.60467483 0.88914551 14.97265625 -1.09375 C24.52115711 -4.439908 34.11309717 -4.54862597 43.35546875 -0.23046875 C48.12396107 2.4076135 50.86575425 5.08527779 53.41015625 9.90625 C52.35828125 10.69 51.30640625 11.47375 50.22265625 12.28125 C44.71078889 17.03285979 41.56508326 23.28635633 40.47265625 30.46875 C40.03168138 38.29605399 41.87292643 44.10920342 46.82421875 50.18359375 C49.69950343 53.3067478 52.89615914 55.56358526 56.41015625 57.90625 C53.62981681 69.36905295 47.16852412 82.51930379 37.16015625 89.40625 C32.57853571 91.90531575 28.55304343 92.53884155 23.41015625 91.90625 C21.37403354 91.28785199 19.35323208 90.61750058 17.34765625 89.90625 C8.57237805 86.84256185 3.23794872 88.20952158 -5.43359375 91.00390625 C-10.61364364 92.48483636 -14.47478385 92.64004629 -19.65234375 90.84375 C-33.68747534 81.58653555 -41.78781841 64.33028781 -45.19067383 48.33569336 C-47.46721739 34.48010623 -46.65131557 19.75938694 -38.46484375 8.03125 C-28.23499655 -4.14713952 -14.17528672 -5.71090688 0 0 Z" transform="translate(45.58984375,33.09375)" />
                  <path d="M0 0 C0.57231958 7.72631433 -0.96546021 14.10973315 -5.80078125 20.30859375 C-10.93255592 25.73930675 -15.29387058 28.82351765 -22.9375 29.1875 C-23.948125 29.125625 -24.95875 29.06375 -26 29 C-26.59493662 20.81962143 -24.35167303 14.76774508 -19.375 8.25 C-14.46051828 2.89895264 -7.38077314 -0.97115436 0 0 Z" transform="translate(76,0)" />
                </svg>
              </div>
            )}

            {/* Brand / app name */}
            <span
              className={`text-white text-sm font-semibold select-none ${
                appAction ? 'cursor-pointer hover:opacity-80 transition-opacity duration-150' : ''
              }`}
              onClick={() => appAction && onMenuAction?.(appAction)}
            >
              {appName}
            </span>

            {/* Nav links (hidden on mobile, shown via hamburger) */}
            <div className="hidden md:flex items-center space-x-1">
              {menus.map((menu) => {
                const isDropdown = !!(menu.items && menu.items.length > 0);
                const isActive = !isDropdown && !!menu.action && menu.action === activeAction;
                return (
                  <span
                    key={menu.label}
                    ref={(el) => { menuRefs.current[menu.label] = el; }}
                    className={`text-sm rounded-md px-2.5 py-1 cursor-pointer select-none transition-colors duration-150 ${
                      isActive
                        ? 'text-white bg-white/15'
                        : 'text-white/75 hover:text-white hover:bg-white/10'
                    }`}
                    onClick={() => handleTopLevelClick(menu)}
                  >
                    {menu.label}
                    {isDropdown && <span className="ml-1 text-[10px] opacity-60">▾</span>}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Right section */}
          <div className="flex items-center space-x-4">
            {/* Custom right-side slot (e.g. account menu) */}
            {rightSlot && <div className="flex items-center">{rightSlot}</div>}
          </div>
        </div>
      </div>

      {/* Apple Menu Dropdown */}
      <MenuDropdown
        isOpen={activeMenu === 'apple'}
        onClose={closeDropdown}
        items={APPLE_MENU_ITEMS}
        position={dropdownPosition}
        onAction={handleMenuAction}
      />

      {/* Mobile navigation dropdown */}
      <MenuDropdown
        isOpen={activeMenu === 'mobile'}
        onClose={closeDropdown}
        items={mobileItems}
        position={dropdownPosition}
        onAction={handleMenuAction}
      />

      {/* Menu Dropdowns */}
      {menus.map((menu) =>
        menu.items && menu.items.length > 0 ? (
          <MenuDropdown
            key={menu.label}
            isOpen={activeMenu === menu.label}
            onClose={closeDropdown}
            items={menu.items}
            position={dropdownPosition}
            onAction={handleMenuAction}
          />
        ) : null
      )}
    </div>
  );
};

export default MacOSMenuBar;
