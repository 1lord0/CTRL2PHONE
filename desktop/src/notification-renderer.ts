const notificationBannerNode = document.getElementById('notificationBanner');
const notificationIconNode = document.getElementById('notificationIcon');
const notificationTitleNode = document.getElementById('notificationTitle');
const notificationDescriptionNode = document.getElementById('notificationDesc');

const notificationBridge = window.bridge as import('./types').NotificationBridgeAPI;

const notificationIconTemplates: Record<'success' | 'info' | 'error' | 'sync', string> = {
  success: `
    <svg viewBox="0 0 24 24">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
  `,
  info: `
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="12" y1="16" x2="12" y2="12"></line>
      <line x1="12" y1="8" x2="12.01" y2="8"></line>
    </svg>
  `,
  error: `
    <svg viewBox="0 0 24 24">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
      <line x1="12" y1="9" x2="12" y2="13"></line>
      <line x1="12" y1="17" x2="12.01" y2="17"></line>
    </svg>
  `,
  sync: `
    <svg viewBox="0 0 24 24">
      <rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect>
      <line x1="12" y1="18" x2="12.01" y2="18"></line>
    </svg>
  `,
};

notificationBridge.onNotification((data) => {
  if (
    !notificationBannerNode ||
    !notificationIconNode ||
    !notificationTitleNode ||
    !notificationDescriptionNode
  ) {
    return;
  }

  notificationTitleNode.textContent = data.title;
  notificationDescriptionNode.textContent = data.body;
  notificationIconNode.innerHTML =
    notificationIconTemplates[data.type] ?? notificationIconTemplates.info;
  notificationBannerNode.classList.remove('slide-out');
  notificationBannerNode.classList.add('slide-in');
});

notificationBridge.onDismissNotification(() => {
  if (!notificationBannerNode) return;
  notificationBannerNode.classList.remove('slide-in');
  notificationBannerNode.classList.add('slide-out');
});
