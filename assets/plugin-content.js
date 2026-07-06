/**
 * 新点小工具 V1.0 - Content Script
 * 工时统计 v1.0 + 快速文案 v1.0 + 工时计算器 v1.0 + 预算计算器 v1.0
 */
(function () {
  'use strict';

  if (window.__epointMiniToolsLoaded) return;
  window.__epointMiniToolsLoaded = true;

  const PRODUCT_NAME = '新点小工具';
  const PRODUCT_VERSION = 'V1.0';
  const WORK_HOURS_VERSION = 'v1.0';
  const QUICK_COPY_VERSION = 'v1.0';
  const TASK_CALC_VERSION = 'v1.0';
  const BUDGET_CALC_VERSION = 'v1.0';
  const STANDARD_HOURS_PER_DAY = 8;
  const CALENDAR_SELECTOR = '#calendar';
  const DAY_ITEM_SELECTOR = '.wd-day-item';
  const FRAME_MESSAGE_SOURCE = 'epoint-mini-tools';
  const QUICK_COPY_STORAGE_KEY = 'epoint_quick_copy_snippets';
  const QUICK_COPY_DEFAULT_GROUP_STORAGE_KEY = 'epoint_quick_copy_default_group';
  const DEFAULT_QUICK_COPY_GROUP = '默认分组';
  const SAVED_MONTH_REPORTS_STORAGE_KEY = 'epoint_saved_month_reports';
  const MONTH_LOG_CACHE_STORAGE_KEY = 'epoint_month_log_cache';
  const TASK_CALC_STORAGE_KEY = 'epoint_task_calculator_items';
  const BUDGET_CALC_STORAGE_KEY = 'epoint_budget_calculator_items';
  const BUDGET_LOG_REPORT_STORAGE_KEY = 'epoint_budget_log_report';
  const BUDGET_LOG_ACTIVE_MONTH_STORAGE_KEY = 'epoint_budget_log_active_month';
  const ACTIVE_TOOL_STORAGE_KEY = 'epoint_active_tool';
  const PANEL_OPEN_STORAGE_KEY = 'epoint_panel_open';
  const PANEL_HEIGHT_STORAGE_KEY = 'epoint_panel_height';
  const PANEL_MIN_HEIGHT = 360;
  const DAILY_LOG_FRAME_PATH = '/dailyreportmanage/pages/dailyrecord/dailyrecordaddv2/gzrz/gzrzframe';
  const DAILY_LOG_RECORD_PATH = '/dailyreportmanage/pages/dailyrecord/dailyrecordaddv2/gzrz/gzrzrecord';

  let quickCopySnippets = [];
  let quickCopyDefaultGroup = DEFAULT_QUICK_COPY_GROUP;
  let savedMonthReports = [];
  let monthLogCache = [];
  let savedTaskCalculations = [];
  let savedBudgetRecords = [];
  let budgetLogReports = [];
  let activeBudgetLogYearMonth = '';
  let discoveredDesignTasks = [];
  let currentBudgetRecord = null;
  let activeTool = 'workhours';
  let currentMonthReport = null;
  let expandedSavedYearMonth = null;
  let activeQuickCopyId = null;
  let editingSnippetId = null;
  let quickCopyEditorOpen = false;
  let collapsedQuickCopyGroups = new Set();
  let lastEditableEl = null;
  let lastEditableAt = 0;
  let lastEditableSelection = null;
  let lastEditableRange = null;
  let lastEditableFrameWindow = null;
  let lastEditableFrameAt = 0;
  let pendingFramePasteText = '';
  let framePasteTimer = null;
  let toastTimer = null;
  let reportRefreshTimer = null;
  let taskScanTimer = null;
  let budgetRefreshTimer = null;
  let budgetRefreshBurstTimer = null;
  let budgetFrameNotifyTimer = null;
  let panelHeight = 560;

  // ============ 基础工具 ============

  function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function getText(el) {
    return normalizeText(el ? (el.innerText || el.textContent || '') : '');
  }

  function firstNonEmptyText(els) {
    for (const el of els) {
      const text = getText(el);
      if (text) return text;
    }
    return '';
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function createId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function formatHours(value) {
    return `${(parseFloat(value) || 0).toFixed(1)}h`;
  }

  function parseLocalDate(dateStr) {
    const parts = (dateStr || '').split('-').map(n => parseInt(n, 10));
    if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function daysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  function formatWeekday(dayOfWeek) {
    return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][dayOfWeek] || '';
  }

  function getStorage(keys) {
    return new Promise(resolve => {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        resolve({});
        return;
      }
      chrome.storage.local.get(keys, result => resolve(result || {}));
    });
  }

  function setStorage(data) {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.set(data);
  }

  function showToast(message, type = 'info') {
    const toast = document.getElementById('ep-tool-toast');
    if (!toast) return;

    toast.textContent = message;
    toast.className = `ep-tool-toast ep-toast-${type} ep-toast-visible`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.className = 'ep-tool-toast';
    }, 1800);
  }

  function ensurePanelDialog() {
    const panel = document.getElementById('ep-tool-panel');
    if (!panel) return null;

    let dialog = document.getElementById('ep-tool-dialog');
    if (!dialog) {
      dialog = document.createElement('div');
      dialog.id = 'ep-tool-dialog';
      dialog.className = 'ep-tool-dialog';
      panel.appendChild(dialog);
    }
    return dialog;
  }

  function formatDialogText(value) {
    return escapeHtml(value).replace(/\n/g, '<br>');
  }

  function showPanelDialog(options = {}) {
    return new Promise(resolve => {
      const dialog = ensurePanelDialog();
      const title = options.title || '提示';
      const message = options.message || '';
      const type = options.type || 'info';
      const confirmText = options.confirmText || '确定';
      const cancelText = options.cancelText === undefined ? '取消' : options.cancelText;
      const hasInput = options.input === true;
      const defaultValue = options.defaultValue || '';

      if (!dialog) {
        resolve(hasInput ? null : false);
        return;
      }

      const inputHtml = hasInput
        ? `<input class="ep-dialog-input" type="text" value="${escapeHtml(defaultValue)}" autocomplete="off">`
        : '';
      const cancelHtml = cancelText
        ? `<button class="ep-dialog-btn" data-dialog-action="cancel">${escapeHtml(cancelText)}</button>`
        : '';

      dialog.className = `ep-tool-dialog ep-dialog-visible ep-dialog-${type}`;
      dialog.innerHTML = `
        <div class="ep-dialog-backdrop"></div>
        <div class="ep-dialog-card" role="dialog" aria-modal="true">
          <div class="ep-dialog-title">${escapeHtml(title)}</div>
          <div class="ep-dialog-message">${formatDialogText(message)}</div>
          ${inputHtml}
          <div class="ep-dialog-actions">
            ${cancelHtml}
            <button class="ep-dialog-btn ep-dialog-primary" data-dialog-action="confirm">${escapeHtml(confirmText)}</button>
          </div>
        </div>
      `;

      const input = dialog.querySelector('.ep-dialog-input');
      const cleanup = value => {
        dialog.className = 'ep-tool-dialog';
        dialog.innerHTML = '';
        dialog.removeEventListener('click', onClick);
        dialog.removeEventListener('keydown', onKeydown);
        resolve(value);
      };
      const onClick = e => {
        if (e.target.classList?.contains('ep-dialog-backdrop')) {
          cleanup(hasInput ? null : false);
          return;
        }
        const action = e.target.closest('[data-dialog-action]')?.getAttribute('data-dialog-action');
        if (action === 'cancel') cleanup(hasInput ? null : false);
        if (action === 'confirm') cleanup(hasInput ? (input?.value ?? '') : true);
      };
      const onKeydown = e => {
        if (e.key === 'Escape') {
          e.preventDefault();
          cleanup(hasInput ? null : false);
        }
        if (e.key === 'Enter' && (hasInput || e.target.closest('.ep-dialog-card'))) {
          e.preventDefault();
          cleanup(hasInput ? (input?.value ?? '') : true);
        }
      };

      dialog.addEventListener('click', onClick);
      dialog.addEventListener('keydown', onKeydown);
      setTimeout(() => {
        (input || dialog.querySelector('.ep-dialog-primary'))?.focus();
        input?.select();
      }, 0);
    });
  }

  function showPanelConfirm(message, options = {}) {
    return showPanelDialog({
      title: options.title || '需要确认',
      message,
      type: options.type || 'warning',
      confirmText: options.confirmText || '确认',
      cancelText: options.cancelText || '取消'
    });
  }

  function showPanelPrompt(message, defaultValue = '', options = {}) {
    return showPanelDialog({
      title: options.title || message,
      message: options.help || '',
      type: options.type || 'info',
      confirmText: options.confirmText || '保存',
      cancelText: options.cancelText || '取消',
      input: true,
      defaultValue
    });
  }

  function setButtonBusy(btn, text, duration = 1200) {
    if (!btn) return;
    const oldHTML = btn.innerHTML;
    btn.textContent = text;
    btn.classList.add('ep-btn-done');
    setTimeout(() => {
      btn.innerHTML = oldHTML;
      btn.classList.remove('ep-btn-done');
    }, duration);
  }

  function flashIconButton(btn, duration = 900) {
    if (!btn) return;
    btn.classList.add('ep-btn-done');
    setTimeout(() => btn.classList.remove('ep-btn-done'), duration);
  }

  function iconSvg(name) {
    const icons = {
      clock: '<svg class="ep-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg>',
      fileText: '<svg class="ep-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path><path d="M14 3v5h5"></path><path d="M9 13h6"></path><path d="M9 17h6"></path><path d="M9 9h1"></path></svg>',
      plus: '<svg class="ep-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>',
      save: '<svg class="ep-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><path d="M17 21v-8H7v8"></path><path d="M7 3v5h8"></path></svg>',
      download: '<svg class="ep-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path></svg>',
      eye: '<svg class="ep-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
      chevronUp: '<svg class="ep-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m18 15-6-6-6 6"></path></svg>',
      chevronDown: '<svg class="ep-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>',
      minus: '<svg class="ep-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"></path></svg>',
      send: '<svg class="ep-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4z"></path><path d="M22 2 11 13"></path></svg>',
      copy: '<svg class="ep-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>',
      edit: '<svg class="ep-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"></path></svg>',
      trash: '<svg class="ep-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v5"></path><path d="M14 11v5"></path></svg>',
      x: '<svg class="ep-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>',
      calculator: '<svg class="ep-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"></rect><path d="M8 7h8"></path><path d="M8 11h2"></path><path d="M12 11h2"></path><path d="M16 11h0"></path><path d="M8 15h2"></path><path d="M12 15h2"></path><path d="M16 15h0"></path></svg>',
      wallet: '<svg class="ep-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 7V5a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h14v10a2 2 0 0 1-2 2H6a3 3 0 0 1-3-3V6"></path><path d="M16 14h.01"></path></svg>',
      refresh: '<svg class="ep-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.7-4"></path><path d="M5 3v5h5"></path><path d="M4 13a8 8 0 0 0 14.7 4"></path><path d="M19 21v-5h-5"></path></svg>',
      check: '<svg class="ep-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>'
    };
    return icons[name] || '';
  }

  // ============ 工时统计：读取与计算 ============

  function waitForCalendar(timeoutOrOldHTML, maybeTimeout) {
    const oldHTML = typeof timeoutOrOldHTML === 'string' ? timeoutOrOldHTML : null;
    const timeout = typeof timeoutOrOldHTML === 'number' ? timeoutOrOldHTML : (maybeTimeout || 8000);

    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        const calendar = document.querySelector(CALENDAR_SELECTOR);
        if (!calendar) {
          reject(new Error('当前页面未找到日志月历'));
          return;
        }

        const currentHTML = calendar.innerHTML || '';
        const items = calendar.querySelectorAll(DAY_ITEM_SELECTOR);
        const ready = oldHTML ? (items.length >= 28 && currentHTML !== oldHTML) : (items.length >= 28);

        if (ready) {
          setTimeout(resolve, 240);
        } else if (Date.now() - start > timeout) {
          reject(new Error('等待日历渲染超时'));
        } else {
          setTimeout(check, 180);
        }
      };

      setTimeout(check, oldHTML ? 200 : 0);
    });
  }

  function extractDateFromDayItem(li, block) {
    const directDate = block.getAttribute('data-date') || li.getAttribute('data-date');
    if (directDate) return directDate;

    const html = decodeUrlText(block.outerHTML || li.outerHTML || '');
    const match = html.match(/openRZ\('(\d{4}-\d{2}-\d{2})'/);
    if (match) return match[1];

    const rzDateMatch = html.match(/[?&]RZDate=(\d{4}-\d{2}-\d{2})/i)
      || html.match(/\bRZDate['"]?\s*[:=]\s*['"]?(\d{4}-\d{2}-\d{2})/i);
    if (rzDateMatch) return rzDateMatch[1];

    const directDateMatch = html.match(/\b\d{4}-\d{2}-\d{2}\b/);
    return directDateMatch ? directDateMatch[0] : '';
  }

  function buildDailyLogUrl(dateStr) {
    return buildDailyRecordUrl(dateStr, '');
  }

  function buildDailyRecordUrl(dateStr, rowGuid = '') {
    if (!dateStr) return '';
    try {
      const url = new URL(rowGuid ? DAILY_LOG_RECORD_PATH : DAILY_LOG_FRAME_PATH, location.href);
      url.searchParams.set('RZDate', dateStr);
      if (rowGuid) url.searchParams.set('RowGuid', rowGuid);
      return url.href;
    } catch (e) {
      return '';
    }
  }

  function extractRowGuidFromText(value) {
    const text = String(value || '');
    const paramMatch = text.match(/RowGuid=([^&'"\s)]+)/i);
    if (paramMatch) return paramMatch[1];
    const guidMatch = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12,}/i);
    return guidMatch ? guidMatch[0] : '';
  }

  function decodeUrlText(value) {
    return String(value || '')
      .replace(/&amp;/g, '&')
      .replace(/&#38;/g, '&')
      .replace(/\\u0026/g, '&');
  }

  function extractDailyLogUrlFromText(value, dateStr) {
    const text = decodeUrlText(value);
    const directMatch = text.match(/(?:https?:\/\/[^'"\s)]+)?\/?dailyreportmanage\/pages\/dailyrecord\/dailyrecordaddv2\/gzrz\/gzrz(?:frame|record)[^'"\s)]*/i)
      || text.match(/(?:\.\.\/)*gzrz\/gzrz(?:frame|record)[^'"\s)]*/i);

    if (directMatch) {
      try {
        let rawUrl = directMatch[0].replace(/%26/ig, '&');
        if (/^dailyreportmanage\//i.test(rawUrl)) rawUrl = `/${rawUrl}`;
        const url = new URL(rawUrl, location.href);
        if (isValidDailyLogUrl(url.href)) return url.href;
      } catch (e) {
        // Fall back to RowGuid/date extraction below.
      }
    }

    const textDate = (text.match(/\d{4}-\d{2}-\d{2}/) || [dateStr || ''])[0];
    const rowGuid = extractRowGuidFromText(text);
    if (rowGuid && textDate) return buildDailyRecordUrl(textDate, rowGuid);
    return '';
  }

  function isValidDailyLogUrl(urlValue) {
    if (!urlValue) return false;
    try {
      const url = new URL(urlValue, location.href);
      return /gzrz(?:frame|record)/i.test(url.pathname) && url.searchParams.has('RZDate');
    } catch (e) {
      return false;
    }
  }

  function normalizeDailyLogUrl(urlValue, dateStr, rowGuid = '') {
    if (isValidDailyLogUrl(urlValue)) {
      return new URL(urlValue, location.href).href;
    }
    return buildDailyRecordUrl(dateStr, rowGuid);
  }

  function extractLogUrlFromDayItem(li, block, dateStr) {
    const scope = block || li;
    const nodes = Array.from(scope.querySelectorAll('a[href], [onclick], [data-url], [data-href]'));
    for (const node of nodes) {
      const href = node.getAttribute('href') || '';
      const dataUrl = node.getAttribute('data-url') || node.getAttribute('data-href') || '';
      const onclick = node.getAttribute('onclick') || '';
      const source = `${href} ${dataUrl} ${onclick}`;
      const sourceUrl = extractDailyLogUrlFromText(source, dateStr);
      if (sourceUrl) return sourceUrl;

      const openMatch = source.match(/openRZ\s*\(\s*['"](\d{4}-\d{2}-\d{2})['"]/);
      if (openMatch) return buildDailyRecordUrl(openMatch[1], extractRowGuidFromText(source));

      const candidate = dataUrl || href;
      if (candidate && !/^javascript:/i.test(candidate)) {
        try {
          const url = new URL(candidate, location.href);
          if (isValidDailyLogUrl(url.href)) return url.href;
        } catch (e) {
          // Ignore malformed hrefs and fall back to a constructed URL.
        }
      }
    }
    return extractDailyLogUrlFromText(scope.outerHTML || '', dateStr)
      || buildDailyRecordUrl(dateStr, extractRowGuidFromText(scope.outerHTML || ''));
  }

  function extractLogActionFromDayItem(li, block, dateStr) {
    const scope = block || li;
    const nodes = [
      scope,
      ...Array.from(scope.querySelectorAll('[onclick], a[href], [data-url], [data-href]'))
    ];
    for (const node of nodes) {
      const onclick = node.getAttribute?.('onclick') || '';
      const href = node.getAttribute?.('href') || '';
      const dataUrl = node.getAttribute?.('data-url') || node.getAttribute?.('data-href') || '';
      const source = `${onclick} ${href} ${dataUrl}`;
      const openMatch = source.match(/openRZ\s*\(([^)]*)\)/);
      if (openMatch) {
        return {
          type: 'openRZ',
          args: openMatch[1].split(',').map(arg => normalizeText(arg.replace(/^['"]|['"]$/g, ''))).filter(Boolean)
        };
      }
    }
    return dateStr ? { type: 'openRZ', args: [dateStr] } : null;
  }

  function extractWorkHoursValue(text) {
    const source = normalizeText(text);
    if (!source) return 0;

    const patterns = [
      /(?:填|工时|工作时长|时长|小时|hours|hour|h)\s*[:：]?\s*([+-]?\d+(?:\.\d+)?)/i,
      /([+-]?\d+(?:\.\d+)?)\s*(?:小时|h)\b/i
    ];

    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (match) return parseFloat(match[1]);
    }

    return 0;
  }

  function extractWorkHoursText(li, containers) {
    const candidates = [];

    if (containers[1]) {
      candidates.push(firstNonEmptyText(containers[1].querySelectorAll('a.center, a, span')));
      candidates.push(getText(containers[1]));
    }

    li.querySelectorAll('a.center, .container, [title]').forEach(el => {
      const text = getText(el) || normalizeText(el.getAttribute('title'));
      if (text) candidates.push(text);
    });

    const fullText = getText(li);
    if (fullText) candidates.push(fullText);

    return candidates.find(text => /填|工时|小时|hour|h|\d/.test(text) && extractWorkHoursValue(text) >= 0) || '';
  }

  function isFutureDate(dateStr) {
    const dateObj = parseLocalDate(dateStr);
    if (!dateObj) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return dateObj > today;
  }

  function parseDayItem(li) {
    const block = li.querySelector('.wd-day-block');
    if (!block) return null;

    const dateStr = extractDateFromDayItem(li, block);
    const dateObj = parseLocalDate(dateStr);
    if (!dateStr || !dateObj) return null;
    const logUrl = extractLogUrlFromDayItem(li, block, dateStr);
    const logAction = extractLogActionFromDayItem(li, block, dateStr);
    const logRowGuid = extractRowGuidFromText(`${logUrl} ${block.outerHTML || ''} ${li.outerHTML || ''}`);

    const containers = li.querySelectorAll('.container');
    const allText = getText(li);
    const statusText = containers[0]
      ? firstNonEmptyText(containers[0].querySelectorAll('a.center, a, span'))
      : '';
    const workHours = extractWorkHoursText(li, containers);
    const workHourValue = extractWorkHoursValue(workHours);
    const markerText = [
      getText(li.querySelector('.not-work')),
      ...Array.from(containers).map(getText),
      allText
    ].join(' ');
    const dayOfWeek = dateObj.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const hasHoliday = markerText.includes('休');
    const hasMakeupWork = markerText.includes('班');
    const hasLeave = markerText.includes('请假');
    const isStandardWorkday = hasMakeupWork || (!hasHoliday && !isWeekend);
    const standardHours = isStandardWorkday ? STANDARD_HOURS_PER_DAY : 0;
    const actualHours = parseFloat(workHourValue) || 0;

    let statusLabel = '未填';
    let statusType = 'missing';
    if (hasLeave) {
      statusLabel = '请假';
      statusType = 'leave';
    } else if (hasMakeupWork) {
      statusLabel = '调休上班';
      statusType = 'makeup';
    } else if (hasHoliday) {
      statusLabel = '法定节假日';
      statusType = 'holiday';
    } else if (isWeekend) {
      statusLabel = '周末休息';
      statusType = 'weekend';
    } else if (actualHours > 0) {
      statusLabel = '已填工时';
      statusType = 'filled';
    } else if (isFutureDate(dateStr)) {
      statusLabel = '未到日期';
      statusType = 'future';
    }

    return {
      date: dateStr,
      day: dateObj.getDate(),
      dayOfWeek,
      weekday: formatWeekday(dayOfWeek),
      logUrl,
      logAction,
      logRowGuid,
      statusText,
      workHours,
      workHourValue: actualHours,
      standardHours,
      hasHoliday,
      hasMakeupWork,
      hasLeave,
      isWeekend,
      isFuture: isFutureDate(dateStr),
      isStandardWorkday,
      isActualFilled: actualHours > 0,
      statusLabel,
      statusType,
      isOtherMonth: li.classList.contains('other-month'),
      isToday: li.classList.contains('today')
    };
  }

  function parseCalendar() {
    const items = document.querySelectorAll(`${CALENDAR_SELECTOR} li${DAY_ITEM_SELECTOR}`);
    const days = [];
    items.forEach(li => {
      const data = parseDayItem(li);
      if (data && !data.isOtherMonth) days.push(data);
    });
    return days;
  }

  function getCurrentPageYearMonth() {
    const year = parseInt(normalizeText(document.getElementById('year')?.textContent || document.getElementById('chooseyear$value')?.value), 10);
    const month = parseInt(normalizeText(document.getElementById('month')?.textContent || document.getElementById('choosemonth$value')?.value), 10);
    return {
      year: Number.isFinite(year) ? year : new Date().getFullYear(),
      month: Number.isFinite(month) ? month : new Date().getMonth() + 1
    };
  }

  function calcMonthReport(days, year, month) {
    const sortedDays = [...days].sort((a, b) => a.date.localeCompare(b.date));
    const standardWorkDays = sortedDays.filter(d => d.isStandardWorkday);
    const actualFilledDays = sortedDays.filter(d => d.isActualFilled);
    const missingWorkDays = sortedDays.filter(d => d.isStandardWorkday && !d.isActualFilled && !d.isFuture);
    const leaveDays = sortedDays.filter(d => d.hasLeave);
    const holidayDays = sortedDays.filter(d => d.hasHoliday && !d.hasMakeupWork);
    const makeupDays = sortedDays.filter(d => d.hasMakeupWork);
    const weekendRestDays = sortedDays.filter(d => d.isWeekend && !d.hasMakeupWork);
    const standardTotalHours = standardWorkDays.length * STANDARD_HOURS_PER_DAY;
    const actualTotalHours = sortedDays.reduce((sum, d) => sum + d.workHourValue, 0);

    return {
      year,
      month,
      yearMonth: `${year}-${pad2(month)}`,
      totalDays: daysInMonth(year, month),
      days: sortedDays,
      standardWorkDays: standardWorkDays.length,
      actualFilledDays: actualFilledDays.length,
      missingWorkDays: missingWorkDays.length,
      leaveDays: leaveDays.length,
      holidayDays: holidayDays.length,
      makeupDays: makeupDays.length,
      weekendRestDays: weekendRestDays.length,
      standardTotalHours,
      actualTotalHours,
      hourDiff: actualTotalHours - standardTotalHours
    };
  }

  function canUseCalendarApi() {
    return Boolean(document.querySelector(CALENDAR_SELECTOR));
  }

  function isDailyLogDetailPage() {
    return /\/dailyreportmanage\/pages\/dailyrecord\/dailyrecordaddv2\/gzrz\/gzrz(?:frame|record)/i.test(location.pathname);
  }

  function isBudgetTaskDetailUrl() {
    return /ProjectManage\/ProjectMission\/Record_Detail\.aspx/i.test(location.href);
  }

  function looksLikeDesignTaskPage() {
    return /designworkflow|jhsj|demandinfoadesign|设计任务/.test(location.href) || /设计任务|设计任务列表|预计工时/.test(getText(document.body));
  }

  function looksLikeBudgetTaskPage() {
    return isBudgetTaskDetailUrl();
  }

  function loadMonthCalendar(year, month) {
    return new Promise((resolve, reject) => {
      if (!canUseCalendarApi()) {
        reject(new Error('当前页面未找到日志月历'));
        return;
      }

      const sameMonth = getCurrentPageYearMonth().year === year && getCurrentPageYearMonth().month === month;
      if (sameMonth && document.querySelectorAll(`${CALENDAR_SELECTOR} ${DAY_ITEM_SELECTOR}`).length >= 28) {
        resolve(parseCalendar());
        return;
      }

      const oldHTML = document.querySelector(CALENDAR_SELECTOR)?.innerHTML || '';
      const finish = () => {
        try {
          resolve(parseCalendar());
        } catch (e) {
          reject(e);
        }
      };

      if (typeof window.setCurYear === 'function') window.setCurYear(String(year));
      if (typeof window.setCurMonth === 'function') window.setCurMonth(String(month));

      if (window.epoint && typeof window.epoint.execute === 'function' && typeof window.epoint.encodeJson === 'function' && typeof window.renderCalendar === 'function' && window.initData) {
        let done = false;
        const timer = setTimeout(() => {
          if (!done) {
            done = true;
            reject(new Error(`${year}-${pad2(month)} 读取超时`));
          }
        }, 12000);

        try {
          window.epoint.execute(window.initData, '@none', window.epoint.encodeJson({
            year: String(year),
            month: String(month)
          }), data => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            try {
              window.renderCalendar(data.msg);
              setTimeout(finish, 260);
            } catch (e) {
              reject(e);
            }
          });
        } catch (e) {
          clearTimeout(timer);
          reject(e);
        }
        return;
      }

      if (typeof window.onYearMonthChanged === 'function') {
        window.onYearMonthChanged(String(year), String(month));
        waitForCalendar(oldHTML, 12000).then(finish).catch(reject);
        return;
      }

      reject(new Error('当前页面不支持自动切换年月'));
    });
  }

  // ============ 面板 ============

  function createPanel() {
    document.getElementById('ep-stats-panel')?.remove();
    document.getElementById('ep-tool-panel')?.remove();
    document.getElementById('ep-tool-launcher')?.remove();

    const panel = document.createElement('div');
    panel.id = 'ep-tool-panel';
    panel.className = 'ep-tool-panel';
    panel.innerHTML = `
      <div id="ep-panel-resize-handle" class="ep-panel-resize-handle" title="拖动调整高度"></div>
      <div class="ep-tool-header">
        <div class="ep-brand">
          <div class="ep-brand-mark">
            <span class="ep-brand-e">E</span>
            <span class="ep-brand-red"></span>
          </div>
          <div class="ep-brand-title">
            <div class="ep-brand-name">${PRODUCT_NAME}</div>
            <div class="ep-brand-version">${PRODUCT_VERSION}</div>
          </div>
        </div>
        <div class="ep-header-actions">
          <button id="ep-btn-hide" class="ep-icon-btn" title="隐藏面板" aria-label="隐藏面板">${iconSvg('minus')}</button>
        </div>
      </div>
      <div class="ep-tool-layout" id="ep-tool-layout">
        <aside class="ep-tool-sidebar">
          <button class="ep-nav-item" data-tool="workhours">
            <span class="ep-nav-kicker">${iconSvg('clock')}</span>
            <span class="ep-nav-text">工时统计</span>
            <span class="ep-nav-version">${WORK_HOURS_VERSION}</span>
          </button>
          <button class="ep-nav-item" data-tool="quickcopy">
            <span class="ep-nav-kicker">${iconSvg('fileText')}</span>
            <span class="ep-nav-text">快速文案</span>
            <span class="ep-nav-version">${QUICK_COPY_VERSION}</span>
          </button>
          <button class="ep-nav-item" data-tool="taskcalc">
            <span class="ep-nav-kicker">${iconSvg('calculator')}</span>
            <span class="ep-nav-text">工时计算器</span>
            <span class="ep-nav-version">${TASK_CALC_VERSION}</span>
          </button>
          <button class="ep-nav-item" data-tool="budgetcalc">
            <span class="ep-nav-kicker">${iconSvg('wallet')}</span>
            <span class="ep-nav-text">预算计算器</span>
            <span class="ep-nav-version">${BUDGET_CALC_VERSION}</span>
          </button>
        </aside>
        <main class="ep-tool-main">
          <section id="ep-tool-workhours" class="ep-tool-section">
            <div class="ep-section-head">
              <div>
                <h3>工时统计 <span>${WORK_HOURS_VERSION}</span></h3>
                <p>当前页面自动生成，保存后在下方列表查看</p>
              </div>
            </div>
            <div id="ep-workhour-report"></div>
            <div id="ep-saved-reports" class="ep-saved-reports"></div>
          </section>

          <section id="ep-tool-quickcopy" class="ep-tool-section">
            <div class="ep-section-head">
              <div>
                <h3>快速文案 <span>${QUICK_COPY_VERSION}</span></h3>
                <p>常用文本库</p>
              </div>
            </div>
            <div class="ep-copy-shell">
              <div class="ep-copy-toolbar">
                <input id="ep-copy-search" class="ep-field" type="search" placeholder="搜索文案">
                <select id="ep-copy-filter" class="ep-field ep-copy-filter" title="分组"></select>
                <span id="ep-copy-count" class="ep-count">0</span>
                <button id="ep-copy-new" class="ep-btn ep-btn-primary">${iconSvg('plus')}<span>新建</span></button>
              </div>
              <div id="ep-copy-editor" class="ep-copy-editor">
                <div class="ep-copy-group-fields">
                  <select id="ep-copy-group" class="ep-field" title="选择分组"></select>
                  <input id="ep-copy-new-group" class="ep-field" type="text" placeholder="新建分组">
                </div>
                <textarea id="ep-copy-content" class="ep-field ep-textarea" placeholder="文案内容"></textarea>
                <div class="ep-copy-editor-actions">
                  <button id="ep-copy-save" class="ep-btn ep-btn-primary">${iconSvg('save')}<span>保存文案</span></button>
                  <button id="ep-copy-reset" class="ep-btn">${iconSvg('x')}<span>取消</span></button>
                </div>
              </div>
              <div id="ep-copy-list" class="ep-copy-list"></div>
            </div>
          </section>

          <section id="ep-tool-taskcalc" class="ep-tool-section">
            <div class="ep-section-head">
              <div>
                <h3>工时计算器 <span>${TASK_CALC_VERSION}</span></h3>
                <p>自动读取设计任务，保存后计算填写进度</p>
              </div>
            </div>
            <div class="ep-task-shell">
              <div class="ep-task-toolbar">
                <button id="ep-task-scan" class="ep-btn ep-btn-primary">${iconSvg('refresh')}<span>重新读取</span></button>
                <span id="ep-task-scan-status" class="ep-task-status">等待读取</span>
              </div>
              <div id="ep-task-discovered" class="ep-task-panel"></div>
              <div id="ep-task-saved" class="ep-task-panel"></div>
            </div>
          </section>

          <section id="ep-tool-budgetcalc" class="ep-tool-section">
            <div class="ep-section-head">
              <div>
                <h3>预算计算器 <span>${BUDGET_CALC_VERSION}</span></h3>
                <p>读取任务详情预算，保存后自动汇总</p>
              </div>
            </div>
            <div class="ep-budget-shell">
              <div id="ep-budget-month-log" class="ep-budget-log-panel"></div>
              <div id="ep-budget-current" class="ep-budget-current"></div>
              <div id="ep-budget-saved" class="ep-budget-panel"></div>
            </div>
          </section>
        </main>
      </div>
      <div id="ep-tool-toast" class="ep-tool-toast"></div>
    `;

    const launcher = document.createElement('button');
    launcher.id = 'ep-tool-launcher';
    launcher.className = 'ep-tool-launcher';
    launcher.innerHTML = `
      <span class="ep-launcher-mark">
        <span class="ep-brand-e">E</span>
        <span class="ep-brand-red"></span>
      </span>
      <span class="ep-launcher-copy">
        <strong>${PRODUCT_NAME}</strong>
        <small>打开工具面板</small>
      </span>
    `;

    document.body.appendChild(panel);
    document.body.appendChild(launcher);
    applyPanelHeight(panelHeight);
    bindPanelEvents();
    updateToolVisibility();
  }

  function bindPanelEvents() {
    document.querySelectorAll('.ep-nav-item').forEach(btn => {
      btn.addEventListener('click', () => switchTool(btn.getAttribute('data-tool')));
    });

    document.getElementById('ep-btn-hide')?.addEventListener('click', () => setPanelOpen(false));
    document.getElementById('ep-tool-launcher')?.addEventListener('click', () => setPanelOpen(true));
    bindPanelResize();
    document.getElementById('ep-saved-reports')?.addEventListener('click', handleSavedReportsClick);
    document.getElementById('ep-copy-new')?.addEventListener('click', openNewSnippetEditor);
    document.getElementById('ep-copy-save')?.addEventListener('click', saveSnippetFromForm);
    document.getElementById('ep-copy-reset')?.addEventListener('click', resetSnippetForm);
    document.getElementById('ep-copy-search')?.addEventListener('input', renderQuickCopyList);
    document.getElementById('ep-copy-filter')?.addEventListener('change', renderQuickCopyList);
    document.getElementById('ep-copy-list')?.addEventListener('click', handleQuickCopyListClick);
    document.getElementById('ep-task-scan')?.addEventListener('click', () => scanDesignTasks({ notify: true }));
    document.getElementById('ep-task-discovered')?.addEventListener('click', handleDiscoveredTasksClick);
    document.getElementById('ep-task-saved')?.addEventListener('input', handleSavedTaskInput);
    document.getElementById('ep-task-saved')?.addEventListener('click', handleSavedTasksClick);
    document.getElementById('ep-budget-current')?.addEventListener('click', handleBudgetCurrentClick);
    document.getElementById('ep-budget-month-log')?.addEventListener('click', handleBudgetMonthLogClick);
    document.getElementById('ep-budget-month-log')?.addEventListener('change', handleBudgetMonthLogChange);
    document.getElementById('ep-budget-month-log')?.addEventListener('keydown', handleBudgetMonthLogKeydown);
    document.getElementById('ep-budget-saved')?.addEventListener('click', handleBudgetSavedClick);
  }

  function switchTool(tool) {
    if (!['workhours', 'quickcopy', 'taskcalc', 'budgetcalc'].includes(tool)) return;
    activeTool = tool;
    setStorage({ [ACTIVE_TOOL_STORAGE_KEY]: activeTool });
    updateToolVisibility();

    if (tool === 'workhours') {
      updateCurrentMonthReport();
    } else if (tool === 'quickcopy') {
      renderQuickCopyList();
    } else if (tool === 'taskcalc') {
      scanDesignTasks();
      renderTaskCalculator();
    } else {
      refreshBudgetCalculator();
    }
  }

  function updateToolVisibility() {
    document.querySelectorAll('.ep-nav-item').forEach(btn => {
      btn.classList.toggle('is-active', btn.getAttribute('data-tool') === activeTool);
    });

    document.querySelectorAll('.ep-tool-section').forEach(section => {
      section.classList.toggle('is-active', section.id === `ep-tool-${activeTool}`);
    });
  }

  function getPanelMaxHeight() {
    return Math.max(PANEL_MIN_HEIGHT, window.innerHeight - 36);
  }

  function normalizePanelHeight(value) {
    const height = parseFloat(value) || 560;
    return Math.max(PANEL_MIN_HEIGHT, Math.min(height, getPanelMaxHeight()));
  }

  function applyPanelHeight(value) {
    const panel = document.getElementById('ep-tool-panel');
    if (!panel) return;
    panelHeight = normalizePanelHeight(value);
    panel.style.height = `${panelHeight}px`;
  }

  function bindPanelResize() {
    const handle = document.getElementById('ep-panel-resize-handle');
    const panel = document.getElementById('ep-tool-panel');
    if (!handle || !panel) return;

    handle.addEventListener('pointerdown', e => {
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = panel.getBoundingClientRect().height;
      handle.setPointerCapture?.(e.pointerId);
      panel.classList.add('is-resizing');

      const onMove = moveEvent => {
        const nextHeight = startHeight + (startY - moveEvent.clientY);
        applyPanelHeight(nextHeight);
      };

      const onEnd = () => {
        panel.classList.remove('is-resizing');
        setStorage({ [PANEL_HEIGHT_STORAGE_KEY]: panelHeight });
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onEnd);
      window.addEventListener('pointercancel', onEnd);
    });
  }

  function setPanelOpen(open) {
    const panel = document.getElementById('ep-tool-panel');
    panel?.classList.toggle('ep-panel-hidden', !open);
    if (open && panel) {
      applyPanelHeight(panelHeight);
    }
    document.getElementById('ep-tool-launcher')?.classList.toggle('is-visible', !open);
    setStorage({ [PANEL_OPEN_STORAGE_KEY]: open });
  }

  function togglePanelOpen() {
    const panel = document.getElementById('ep-tool-panel');
    const isHidden = panel?.classList.contains('ep-panel-hidden');
    setPanelOpen(Boolean(isHidden));
  }

  // ============ 工时报表 UI ============

  function renderReportError(message) {
    const el = document.getElementById('ep-workhour-report');
    if (!el) return;
    currentMonthReport = null;
    el.innerHTML = `
      <div class="ep-empty-state">
        <div class="ep-empty-title">无法生成工时报表</div>
        <div class="ep-empty-text">${escapeHtml(message || '请进入 OA 日志月历页面后重试')}</div>
      </div>
    `;
  }

  function renderDayRows(days) {
    return days.map(day => `
      <tr class="ep-day-row ep-status-${day.statusType}">
        <td>
          <div class="ep-date-chip">
            <strong>${escapeHtml(day.date)}</strong>
          </div>
        </td>
        <td>${escapeHtml(day.weekday)}</td>
        <td><span class="ep-status-badge ep-status-${day.statusType}">${escapeHtml(day.statusLabel)}</span></td>
        <td>${formatHours(day.standardHours)}</td>
        <td class="${day.workHourValue > 0 ? 'ep-text-success' : 'ep-text-muted'}">${formatHours(day.workHourValue)}</td>
      </tr>
    `).join('');
  }

  function renderReportTable(report, extraClass = '') {
    return `
      <div class="ep-table-wrap ep-workhour-table-wrap ${extraClass}">
        <table class="ep-table ep-workhour-table">
          <thead>
            <tr>
              <th>年月日</th>
              <th>星期</th>
              <th>日期类型</th>
              <th>标准工时</th>
              <th>实填工时</th>
            </tr>
          </thead>
          <tbody>${renderDayRows(report.days)}</tbody>
        </table>
      </div>
    `;
  }

  function renderMonthReport(report) {
    const el = document.getElementById('ep-workhour-report');
    if (!el) return;

    currentMonthReport = report;
    const diffClass = report.hourDiff >= 0 ? 'ep-text-success' : 'ep-text-danger';

    el.innerHTML = `
      <div class="ep-report-title">
        <strong>${report.year}年${report.month}月实时统计</strong>
        <span>每日月报明细已隐藏，保存后在下方月报栏查看。</span>
      </div>
      <div class="ep-stats-cards">
        <div class="ep-stat-card ep-stat-primary">
          <div class="ep-stat-value">${report.standardWorkDays}</div>
          <div class="ep-stat-label">标准工作天数</div>
        </div>
        <div class="ep-stat-card ep-stat-success">
          <div class="ep-stat-value">${report.actualFilledDays}</div>
          <div class="ep-stat-label">实际填工时天数</div>
        </div>
        <div class="ep-stat-card ep-stat-info">
          <div class="ep-stat-value">${formatHours(report.standardTotalHours)}</div>
          <div class="ep-stat-label">月标准总工时</div>
        </div>
        <div class="ep-stat-card ep-stat-warning">
          <div class="ep-stat-value">${formatHours(report.actualTotalHours)}</div>
          <div class="ep-stat-label">实际总工时</div>
        </div>
        <div class="ep-stat-card ep-stat-danger">
          <div class="ep-stat-value ${diffClass}">${report.hourDiff >= 0 ? '+' : ''}${report.hourDiff.toFixed(1)}h</div>
          <div class="ep-stat-label">工时差额</div>
        </div>
      </div>
      <div class="ep-info-row">
        <span>法定休 <strong>${report.holidayDays}</strong> 天</span>
        <span>调休上班 <strong>${report.makeupDays}</strong> 天</span>
        <span>周末休息 <strong>${report.weekendRestDays}</strong> 天</span>
        <span>请假 <strong>${report.leaveDays}</strong> 天</span>
        <span>工作日未填 <strong>${report.missingWorkDays}</strong> 天</span>
      </div>
    `;
  }

  async function updateCurrentMonthReport() {
    try {
      if (!canUseCalendarApi()) {
        renderReportError('进入日志月历页后可读取工时统计');
        return;
      }

      await waitForCalendar(5000);
      const current = getCurrentPageYearMonth();
      const report = calcMonthReport(parseCalendar(), current.year, current.month);
      renderMonthReport(report);
      cacheMonthLogReport(report);
    } catch (e) {
      renderReportError(e.message);
    }
  }

  function normalizeSavedReports(reports) {
    if (!Array.isArray(reports)) return [];
    return reports
      .filter(report => report && report.year && report.month && report.yearMonth && Array.isArray(report.days))
      .sort((a, b) => String(b.yearMonth).localeCompare(String(a.yearMonth)));
  }

  function normalizeMonthLogCache(reports) {
    if (!Array.isArray(reports)) return [];
    const map = new Map();
    reports
      .filter(report => report && report.year && report.month && report.yearMonth && Array.isArray(report.days))
      .forEach(report => {
        if (!map.has(report.yearMonth)) map.set(report.yearMonth, report);
      });
    return Array.from(map.values()).slice(0, 18);
  }

  function cloneMonthReportForCache(report) {
    const copy = JSON.parse(JSON.stringify(report));
    copy.cachedAt = Date.now();
    return copy;
  }

  function cacheMonthLogReport(report) {
    if (!report || !report.yearMonth || !Array.isArray(report.days)) return;
    const cached = cloneMonthReportForCache(report);
    monthLogCache = normalizeMonthLogCache([
      cached,
      ...monthLogCache.filter(item => item.yearMonth !== cached.yearMonth)
    ]);
    setStorage({ [MONTH_LOG_CACHE_STORAGE_KEY]: monthLogCache });
  }

  function cloneMonthReportForStorage(report) {
    const copy = JSON.parse(JSON.stringify(report));
    copy.savedAt = Date.now();
    return copy;
  }

  function saveSavedMonthReports() {
    setStorage({ [SAVED_MONTH_REPORTS_STORAGE_KEY]: savedMonthReports });
  }

  async function saveCurrentMonthReport(e) {
    const btn = e?.currentTarget || document.getElementById('ep-month-save');

    try {
      if (btn) btn.disabled = true;
      await updateCurrentMonthReport();

      if (!currentMonthReport || !Array.isArray(currentMonthReport.days) || currentMonthReport.days.length === 0) {
        showToast('当前页面还没有可保存的月报', 'warn');
        return;
      }

      const saved = cloneMonthReportForStorage(currentMonthReport);
      const existingIndex = savedMonthReports.findIndex(report => report.yearMonth === saved.yearMonth);
      const existed = existingIndex >= 0;

      if (existed) {
        savedMonthReports.splice(existingIndex, 1, saved);
      } else {
        savedMonthReports.push(saved);
      }

      savedMonthReports = normalizeSavedReports(savedMonthReports);
      saveSavedMonthReports();
      expandedSavedYearMonth = null;
      renderSavedReports();
      setButtonBusy(document.getElementById('ep-month-save'), existed ? '已更新' : '已保存');
      showToast(existed ? '当前月报已更新保存' : '当前月报已保存', 'success');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function renderSavedReports() {
    const el = document.getElementById('ep-saved-reports');
    if (!el) return;

    const count = savedMonthReports.length;
    const body = count
      ? `<div class="ep-saved-body">${savedMonthReports.map(renderSavedReportItem).join('')}</div>`
      : '<div class="ep-empty-state ep-empty-compact">暂无已保存月报</div>';

    el.innerHTML = `
      <div class="ep-saved-headbar">
        <div class="ep-saved-title">
          <strong>已保存月报</strong>
          <span>${count} 份</span>
        </div>
        <div class="ep-saved-head-actions">
          <button id="ep-month-save" class="ep-btn ep-btn-primary" data-action="save-current">${iconSvg('save')}<span>保存月报</span></button>
          <button id="ep-saved-download" class="ep-btn" data-action="download-all">${iconSvg('download')}<span>下载总表</span></button>
        </div>
      </div>
      ${body}
    `;
  }

  function renderSavedReportItem(report) {
    const isExpanded = report.yearMonth === expandedSavedYearMonth;
    const diffClass = report.hourDiff >= 0 ? 'ep-text-success' : 'ep-text-danger';
    const savedTime = report.savedAt ? formatSavedTime(report.savedAt) : '未记录保存时间';

    return `
      <article class="ep-saved-item ${isExpanded ? 'is-expanded' : ''}" data-year-month="${escapeHtml(report.yearMonth)}">
        <div class="ep-saved-item-head">
          <button class="ep-saved-item-trigger" data-action="toggle-report" data-year-month="${escapeHtml(report.yearMonth)}">
            <span class="ep-saved-month-title">${report.year}年${report.month}月月报</span>
            <span class="ep-saved-month-meta">保存于 ${escapeHtml(savedTime)}</span>
            <span class="ep-saved-mini-stats">
              <span>标准 ${report.standardWorkDays} 天</span>
              <span>已填 ${report.actualFilledDays} 天</span>
              <span>实填 ${formatHours(report.actualTotalHours)}</span>
            </span>
          </button>
          <div class="ep-saved-actions">
            <button class="ep-btn ep-saved-view" data-action="toggle-report" data-year-month="${escapeHtml(report.yearMonth)}">${iconSvg(isExpanded ? 'chevronUp' : 'eye')}<span>${isExpanded ? '收起' : '查看'}</span></button>
            <button class="ep-btn ep-saved-single-download" data-action="download-single" data-year-month="${escapeHtml(report.yearMonth)}">${iconSvg('download')}<span>单月下载</span></button>
            <button class="ep-icon-text-btn ep-saved-delete" data-action="delete-saved" data-year-month="${escapeHtml(report.yearMonth)}" title="删除">${iconSvg('trash')}</button>
          </div>
        </div>
        ${isExpanded ? `
          <div class="ep-summary-bar">
            <span>标准 <strong>${report.standardWorkDays}</strong> 天</span>
            <span>已填 <strong>${report.actualFilledDays}</strong> 天</span>
            <span>标准工时 <strong>${formatHours(report.standardTotalHours)}</strong></span>
            <span>实际工时 <strong>${formatHours(report.actualTotalHours)}</strong></span>
            <span>差额 <strong class="${diffClass}">${report.hourDiff >= 0 ? '+' : ''}${report.hourDiff.toFixed(1)}h</strong></span>
          </div>
          ${renderReportTable(report, 'ep-saved-report-table-wrap')}
        ` : ''}
      </article>
    `;
  }

  function formatSavedTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  function handleSavedReportsClick(e) {
    const btn = e.target.closest('button');
    if (!btn) return;

    const action = btn.getAttribute('data-action');
    const yearMonth = btn.getAttribute('data-year-month');

    if (action === 'save-current') {
      saveCurrentMonthReport({ currentTarget: btn });
      return;
    }

    if (action === 'download-all') {
      downloadSavedReportsWorkbook();
      return;
    }

    const report = savedMonthReports.find(item => item.yearMonth === yearMonth);
    if (!report) return;

    if (action === 'toggle-report') {
      expandedSavedYearMonth = expandedSavedYearMonth === report.yearMonth ? null : report.yearMonth;
      renderSavedReports();
    } else if (action === 'download-single') {
      downloadReportsWorkbook([report], `工时月报_${report.yearMonth}.xls`);
    } else if (action === 'delete-saved') {
      deleteSavedReport(report);
    }
  }

  async function deleteSavedReport(report) {
    const ok = await showPanelConfirm(`确定删除「${report.year}年${report.month}月月报」吗？`, {
      title: '删除月报',
      type: 'danger',
      confirmText: '删除'
    });
    if (!ok) return;
    savedMonthReports = savedMonthReports.filter(item => item.yearMonth !== report.yearMonth);
    if (expandedSavedYearMonth === report.yearMonth) expandedSavedYearMonth = null;
    saveSavedMonthReports();
    renderSavedReports();
    showToast('已删除保存的月报', 'success');
  }

  function downloadSavedReportsWorkbook() {
    if (savedMonthReports.length === 0) {
      showToast('请先保存月报', 'warn');
      return;
    }

    const orderedReports = [...savedMonthReports].sort((a, b) => String(a.yearMonth).localeCompare(String(b.yearMonth)));
    const first = orderedReports[0]?.yearMonth || '开始';
    const last = orderedReports[orderedReports.length - 1]?.yearMonth || '结束';
    downloadReportsWorkbook(orderedReports, `工时月报汇总_${first}_${last}.xls`);
  }

  function downloadReportsWorkbook(reports, filename) {
    if (!reports.length) {
      showToast('没有可下载的月报', 'warn');
      return;
    }

    const xml = `\uFEFF${buildWorkbookXml(reports)}`;
    const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
    showToast(reports.length > 1 ? '汇总表格已下载' : '单月表格已下载', 'success');
  }

  function buildWorkbookXml(reports) {
    const worksheets = reports.map((report, index) => buildWorksheetXml(report, index)).join('');
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<?mso-application progid="Excel.Sheet"?>',
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
      '<Styles>',
      '<Style ss:ID="title"><Font ss:Bold="1" ss:Size="14"/><Interior ss:Color="#D9F0ED" ss:Pattern="Solid"/></Style>',
      '<Style ss:ID="head"><Font ss:Bold="1"/><Interior ss:Color="#F7F9FC" ss:Pattern="Solid"/></Style>',
      '</Styles>',
      worksheets,
      '</Workbook>'
    ].join('');
  }

  function buildWorksheetXml(report, index) {
    const rows = [
      excelRow(['工时月报', `${report.year}年${report.month}月`], 'title'),
      excelRow(['汇总项', '数值'], 'head'),
      excelRow(['标准工作天数', `${report.standardWorkDays}天`]),
      excelRow(['实际填工时天数', `${report.actualFilledDays}天`]),
      excelRow(['月标准总工时', formatHours(report.standardTotalHours)]),
      excelRow(['实际总工时', formatHours(report.actualTotalHours)]),
      excelRow(['工时差额', `${report.hourDiff >= 0 ? '+' : ''}${report.hourDiff.toFixed(1)}h`]),
      excelRow(['法定休', `${report.holidayDays}天`]),
      excelRow(['调休上班', `${report.makeupDays}天`]),
      excelRow(['周末休息', `${report.weekendRestDays}天`]),
      excelRow(['请假', `${report.leaveDays}天`]),
      excelRow(['工作日未填', `${report.missingWorkDays}天`]),
      '<Row/>',
      excelRow(['每日明细'], 'title'),
      excelRow(['年月日', '星期', '日期类型', '标准工时', '实填工时'], 'head'),
      ...report.days.map(day => excelRow([
        day.date,
        day.weekday,
        day.statusLabel,
        formatHours(day.standardHours),
        formatHours(day.workHourValue)
      ]))
    ].join('');

    return `<Worksheet ss:Name="${xmlEscape(safeSheetName(report, index))}"><Table>${rows}</Table></Worksheet>`;
  }

  function excelRow(values, styleId = '') {
    return `<Row>${values.map(value => excelCell(value, styleId)).join('')}</Row>`;
  }

  function excelCell(value, styleId = '') {
    const style = styleId ? ` ss:StyleID="${styleId}"` : '';
    return `<Cell${style}><Data ss:Type="String">${xmlEscape(value)}</Data></Cell>`;
  }

  function safeSheetName(report, index) {
    const rawName = report.yearMonth || `${report.year}-${pad2(report.month)}` || `月报${index + 1}`;
    const safeName = String(rawName).replace(/[\[\]\*\/\\\?:]/g, ' ').trim().slice(0, 31);
    return safeName || `月报${index + 1}`;
  }

  function xmlEscape(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  // ============ 快速文案 ============

  function normalizeGroupName(value) {
    return normalizeText(value).slice(0, 24);
  }

  function normalizeSnippetGroup(value) {
    return normalizeGroupName(value) || quickCopyDefaultGroup || DEFAULT_QUICK_COPY_GROUP;
  }

  function getSnippetLabel(item, maxLength = 36) {
    const firstLine = normalizeText(String(item?.content || '').split(/\r?\n/)[0]);
    const label = firstLine || normalizeText(item?.title) || '未命名文案';
    return label.length > maxLength ? `${label.slice(0, maxLength)}...` : label;
  }

  function normalizeQuickCopySnippets(items) {
    if (!Array.isArray(items)) return [];
    return items
      .filter(item => item && typeof item === 'object')
      .map(item => ({
        ...item,
        id: item.id || createId('copy'),
        group: normalizeSnippetGroup(item.group),
        content: String(item.content || '').trim(),
        createdAt: item.createdAt || Date.now(),
        updatedAt: item.updatedAt || item.createdAt || Date.now()
      }))
      .filter(item => item.content);
  }

  function getQuickCopyGroups() {
    const groups = new Set([quickCopyDefaultGroup || DEFAULT_QUICK_COPY_GROUP]);
    quickCopySnippets.forEach(item => groups.add(normalizeSnippetGroup(item.group)));
    return Array.from(groups);
  }

  function renderQuickCopyGroupOptions(selectedGroup) {
    const groups = getQuickCopyGroups();
    const selected = normalizeSnippetGroup(selectedGroup);
    const groupEl = document.getElementById('ep-copy-group');
    if (groupEl) {
      groupEl.innerHTML = groups.map(group => `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`).join('');
      groupEl.value = groups.includes(selected) ? selected : quickCopyDefaultGroup;
    }
  }

  function renderQuickCopyFilterOptions() {
    const filterEl = document.getElementById('ep-copy-filter');
    if (!filterEl) return;
    const current = filterEl.value || '__all__';
    const options = [
      '<option value="__all__">全部分组</option>',
      ...getQuickCopyGroups().map(group => `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`)
    ];
    filterEl.innerHTML = options.join('');
    filterEl.value = Array.from(filterEl.options).some(option => option.value === current) ? current : '__all__';
  }

  function getSelectedSnippetGroup() {
    const groupEl = document.getElementById('ep-copy-group');
    const newGroupEl = document.getElementById('ep-copy-new-group');
    return normalizeSnippetGroup(newGroupEl?.value || groupEl?.value);
  }

  function saveSnippetFromForm() {
    const newGroupEl = document.getElementById('ep-copy-new-group');
    const contentEl = document.getElementById('ep-copy-content');
    const group = getSelectedSnippetGroup();
    const content = (contentEl?.value || '').trim();

    if (!content) {
      showToast('文案内容不能为空', 'warn');
      contentEl?.focus();
      return;
    }

    let savedId = editingSnippetId;

    if (editingSnippetId) {
      const target = quickCopySnippets.find(item => item.id === editingSnippetId);
      if (target) {
        target.group = group;
        target.content = content;
        target.updatedAt = Date.now();
        savedId = target.id;
      }
      showToast('文案已更新', 'success');
    } else {
      savedId = createId('copy');
      quickCopySnippets.unshift({
        id: savedId,
        group,
        content,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      showToast('文案已保存', 'success');
    }

    activeQuickCopyId = savedId || activeQuickCopyId;
    if (newGroupEl) newGroupEl.value = '';
    editingSnippetId = null;
    resetSnippetForm();
    saveQuickCopySnippets();
    renderQuickCopyFilterOptions();
    const filterEl = document.getElementById('ep-copy-filter');
    if (filterEl) filterEl.value = group;
    renderQuickCopyList();
  }

  function setQuickCopyEditorOpen(open) {
    quickCopyEditorOpen = Boolean(open);
    document.getElementById('ep-copy-editor')?.classList.toggle('is-open', quickCopyEditorOpen);
  }

  function openNewSnippetEditor() {
    editingSnippetId = null;
    const newGroupEl = document.getElementById('ep-copy-new-group');
    const contentEl = document.getElementById('ep-copy-content');
    const saveBtn = document.getElementById('ep-copy-save');
    renderQuickCopyGroupOptions(quickCopyDefaultGroup);
    if (newGroupEl) newGroupEl.value = '';
    if (contentEl) contentEl.value = '';
    if (saveBtn) saveBtn.innerHTML = `${iconSvg('save')}<span>保存文案</span>`;
    setQuickCopyEditorOpen(true);
    contentEl?.focus();
  }

  function resetSnippetForm() {
    editingSnippetId = null;
    const newGroupEl = document.getElementById('ep-copy-new-group');
    const contentEl = document.getElementById('ep-copy-content');
    const saveBtn = document.getElementById('ep-copy-save');
    renderQuickCopyGroupOptions(quickCopyDefaultGroup);
    if (newGroupEl) newGroupEl.value = '';
    if (contentEl) contentEl.value = '';
    if (saveBtn) saveBtn.innerHTML = `${iconSvg('save')}<span>保存文案</span>`;
    setQuickCopyEditorOpen(false);
  }

  function saveQuickCopySnippets() {
    setStorage({ [QUICK_COPY_STORAGE_KEY]: quickCopySnippets });
  }

  function saveQuickCopyDefaultGroup() {
    setStorage({ [QUICK_COPY_DEFAULT_GROUP_STORAGE_KEY]: quickCopyDefaultGroup });
  }

  function renderQuickCopyList() {
    renderQuickCopyFilterOptions();
    const listEl = document.getElementById('ep-copy-list');
    const countEl = document.getElementById('ep-copy-count');
    const search = normalizeText(document.getElementById('ep-copy-search')?.value).toLowerCase();
    const filterGroup = document.getElementById('ep-copy-filter')?.value || '__all__';
    if (!listEl) return;

    const filtered = quickCopySnippets.filter(item => {
      if (filterGroup !== '__all__' && normalizeSnippetGroup(item.group) !== filterGroup) return false;
      if (!search) return true;
      return `${item.group || ''} ${item.content || ''}`.toLowerCase().includes(search);
    });

    if (countEl) countEl.textContent = `${filtered.length}/${quickCopySnippets.length}`;

    if (filtered.length === 0) {
      listEl.innerHTML = '<div class="ep-empty-state ep-empty-compact">暂无文案</div>';
      return;
    }

    const grouped = filtered.reduce((map, item) => {
      const group = normalizeSnippetGroup(item.group);
      if (!map.has(group)) map.set(group, []);
      map.get(group).push(item);
      return map;
    }, new Map());

    listEl.innerHTML = Array.from(grouped.entries()).map(([group, items]) => `
      <section class="ep-copy-group-block ${collapsedQuickCopyGroups.has(group) ? 'is-collapsed' : ''}" data-group="${escapeHtml(group)}">
        <div class="ep-copy-group-head">
          <button class="ep-copy-group-toggle" data-action="toggle-group" data-group="${escapeHtml(group)}">
            ${iconSvg(collapsedQuickCopyGroups.has(group) ? 'chevronDown' : 'chevronUp')}
            <span>${escapeHtml(group)}</span>
            <em>${items.length}</em>
          </button>
          <div class="ep-copy-group-actions">
            <button class="ep-icon-text-btn ep-copy-group-rename" data-action="rename-group" data-group="${escapeHtml(group)}" title="改名">${iconSvg('edit')}</button>
            ${group === quickCopyDefaultGroup ? '' : `<button class="ep-icon-text-btn ep-copy-group-delete" data-action="delete-group" data-group="${escapeHtml(group)}" title="删除分组">${iconSvg('trash')}</button>`}
          </div>
        </div>
        ${collapsedQuickCopyGroups.has(group) ? '' : `
        ${items.map(item => {
      const isActive = item.id === activeQuickCopyId;
      return `
      <article class="ep-copy-item ${isActive ? 'is-active' : ''}" data-id="${escapeHtml(item.id)}">
        <div class="ep-copy-main">
          <div class="ep-copy-preview">${escapeHtml(item.content).replace(/\n/g, '<br>')}</div>
          <div class="ep-copy-row-meta">${formatSnippetTime(item.updatedAt || item.createdAt)}</div>
        </div>
        <div class="ep-copy-item-tools">
          <button class="ep-icon-text-btn ep-copy-paste ep-copy-primary-action" data-id="${escapeHtml(item.id)}" title="快速填入">${iconSvg('send')}</button>
          <button class="ep-icon-text-btn ep-copy-copy" data-id="${escapeHtml(item.id)}" title="复制">${iconSvg('copy')}</button>
          <button class="ep-icon-text-btn ep-copy-edit" data-id="${escapeHtml(item.id)}" title="编辑">${iconSvg('edit')}</button>
          <button class="ep-icon-text-btn ep-copy-delete" data-id="${escapeHtml(item.id)}" title="删除">${iconSvg('trash')}</button>
        </div>
      </article>
    `;
        }).join('')}
        `}
      </section>
    `).join('');
  }

  function formatSnippetTime(value) {
    if (!value) return '';
    const date = new Date(value);
    return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  async function handleQuickCopyListClick(e) {
    const btn = e.target.closest('button');
    const action = btn?.getAttribute('data-action');
    if (action === 'toggle-group') {
      const group = normalizeSnippetGroup(btn.getAttribute('data-group'));
      if (collapsedQuickCopyGroups.has(group)) {
        collapsedQuickCopyGroups.delete(group);
      } else {
        collapsedQuickCopyGroups.add(group);
      }
      renderQuickCopyList();
      return;
    }

    if (action === 'rename-group') {
      await renameQuickCopyGroup(btn.getAttribute('data-group'));
      return;
    }

    if (action === 'delete-group') {
      await deleteQuickCopyGroup(btn.getAttribute('data-group'));
      return;
    }

    if (!btn) {
      const itemEl = e.target.closest('.ep-copy-item');
      const itemId = itemEl?.getAttribute('data-id');
      if (!itemId) return;
      activeQuickCopyId = itemId;
      renderQuickCopyList();
      return;
    }

    const id = btn.getAttribute('data-id');
    const item = quickCopySnippets.find(snippet => snippet.id === id);
    if (!item) return;

    if (btn.classList.contains('ep-copy-paste')) {
      activeQuickCopyId = item.id;
      await pasteText(item.content);
    } else if (btn.classList.contains('ep-copy-copy')) {
      activeQuickCopyId = item.id;
      await copyText(item.content);
      flashIconButton(btn);
      showToast('已复制到剪贴板', 'success');
    } else if (btn.classList.contains('ep-copy-edit')) {
      editSnippet(item);
    } else if (btn.classList.contains('ep-copy-delete')) {
      await deleteSnippet(item.id);
    }
  }

  async function renameQuickCopyGroup(groupName) {
    const oldGroup = normalizeSnippetGroup(groupName);
    const rawName = await showPanelPrompt('输入新的分组名称', oldGroup, {
      title: '重命名分组'
    });
    if (rawName === null) return;

    const nextGroup = normalizeGroupName(rawName);
    if (!nextGroup) {
      showToast('分组名称不能为空', 'warn');
      return;
    }

    if (nextGroup === oldGroup) return;

    const existingGroups = getQuickCopyGroups().filter(group => group !== oldGroup);
    if (existingGroups.includes(nextGroup)) {
      const ok = await showPanelConfirm(`「${nextGroup}」已存在，是否合并到该分组？`, {
        title: '合并分组',
        type: 'warning',
        confirmText: '合并'
      });
      if (!ok) return;
    }

    const isDefaultGroup = oldGroup === quickCopyDefaultGroup;
    quickCopySnippets.forEach(item => {
      if (normalizeSnippetGroup(item.group) === oldGroup) {
        item.group = nextGroup;
        item.updatedAt = Date.now();
      }
    });

    if (isDefaultGroup) {
      quickCopyDefaultGroup = nextGroup;
      saveQuickCopyDefaultGroup();
    }

    const wasCollapsed = collapsedQuickCopyGroups.delete(oldGroup);
    if (wasCollapsed) collapsedQuickCopyGroups.add(nextGroup);

    const filterEl = document.getElementById('ep-copy-filter');
    if (filterEl && filterEl.value === oldGroup) filterEl.value = nextGroup;

    saveQuickCopySnippets();
    renderQuickCopyGroupOptions(nextGroup);
    renderQuickCopyFilterOptions();
    if (filterEl) filterEl.value = nextGroup;
    renderQuickCopyList();
    showToast('分组已改名', 'success');
  }

  async function deleteQuickCopyGroup(groupName) {
    const group = normalizeSnippetGroup(groupName);
    if (group === quickCopyDefaultGroup) {
      showToast('默认分组不能删除，可以改名', 'warn');
      return;
    }

    const groupItems = quickCopySnippets.filter(item => normalizeSnippetGroup(item.group) === group);
    if (groupItems.length === 0) return;
    const ok = await showPanelConfirm(`确定删除「${group}」分组及其中 ${groupItems.length} 条文案吗？`, {
      title: '删除分组',
      type: 'danger',
      confirmText: '删除'
    });
    if (!ok) return;

    const removedIds = new Set(groupItems.map(item => item.id));
    quickCopySnippets = quickCopySnippets.filter(item => normalizeSnippetGroup(item.group) !== group);
    if (activeQuickCopyId && removedIds.has(activeQuickCopyId)) activeQuickCopyId = null;
    if (editingSnippetId && removedIds.has(editingSnippetId)) resetSnippetForm();
    collapsedQuickCopyGroups.delete(group);

    const filterEl = document.getElementById('ep-copy-filter');
    if (filterEl && filterEl.value === group) filterEl.value = '__all__';

    saveQuickCopySnippets();
    renderQuickCopyGroupOptions(quickCopyDefaultGroup);
    renderQuickCopyList();
    showToast('分组已删除', 'success');
  }

  function editSnippet(item) {
    activeQuickCopyId = item.id;
    editingSnippetId = item.id;
    const newGroupEl = document.getElementById('ep-copy-new-group');
    const contentEl = document.getElementById('ep-copy-content');
    const saveBtn = document.getElementById('ep-copy-save');
    setQuickCopyEditorOpen(true);
    renderQuickCopyGroupOptions(item.group);
    if (newGroupEl) newGroupEl.value = '';
    if (contentEl) {
      contentEl.value = item.content;
      contentEl.focus();
    }
    if (saveBtn) saveBtn.innerHTML = `${iconSvg('save')}<span>更新文案</span>`;
    renderQuickCopyList();
  }

  async function deleteSnippet(id) {
    const item = quickCopySnippets.find(snippet => snippet.id === id);
    if (!item) return;
    const ok = await showPanelConfirm(`确定删除「${getSnippetLabel(item, 20)}」吗？`, {
      title: '删除文案',
      type: 'danger',
      confirmText: '删除'
    });
    if (!ok) return;
    quickCopySnippets = quickCopySnippets.filter(snippet => snippet.id !== id);
    if (activeQuickCopyId === id) activeQuickCopyId = null;
    if (editingSnippetId === id) resetSnippetForm();
    saveQuickCopySnippets();
    renderQuickCopyList();
    showToast('文案已删除', 'success');
  }

  // ============ 工时计算器 ============

  function parseHoursNumber(value) {
    const text = normalizeText(value);
    if (!text) return 0;
    const match = text.match(/(?:预计|预估|计划|总)\s*(?:工时|小时|人天)?\s*[:：]?\s*([0-9]+(?:\.[0-9]+)?)/)
      || text.match(/(?:工时|小时|人天)\s*[:：]?\s*([0-9]+(?:\.[0-9]+)?)/)
      || text.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:h|H|小时|工时)/);
    return match ? parseFloat(match[1]) : 0;
  }

  function stableHash(value) {
    const text = String(value || '');
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) {
      hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    }
    return Math.abs(hash).toString(36);
  }

  function taskKeyFor(task) {
    return stableHash(`${task.name}|${task.designer || ''}|${task.estimateHours}|${task.sourceUrl}`);
  }

  function legacyTaskKeyFor(task) {
    return stableHash(`${task.name}|${task.estimateHours}|${task.sourceUrl}`);
  }

  function normalizeTaskName(value) {
    return normalizeText(value)
      .replace(/^(任务名称|设计任务|任务|名称|标题|需求名称)\s*[:：]/, '')
      .slice(0, 80);
  }

  function normalizeTaskDesigner(value) {
    return normalizeText(value)
      .replace(/^(设计师|负责人|处理人|人员)\s*[:：]/, '')
      .slice(0, 32);
  }

  function getHeaderIndex(headers, patterns) {
    return headers.findIndex(header => patterns.some(pattern => pattern.test(header)));
  }

  function isVisibleElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function compactRepeatedText(value) {
    const text = normalizeText(value);
    if (!text) return '';
    const parts = text.split(/\s+/);
    if (parts.length % 2 === 0) {
      const mid = parts.length / 2;
      const left = parts.slice(0, mid).join(' ');
      const right = parts.slice(mid).join(' ');
      if (left && left === right) return left;
    }
    return text;
  }

  function getTaskText(el) {
    if (!el) return '';
    const values = [];
    const add = (value) => {
      const text = normalizeText(value);
      if (text && !values.includes(text)) values.push(text);
    };

    add(el.innerText || el.textContent || '');
    if (el.getAttribute) {
      add(el.getAttribute('title'));
      add(el.getAttribute('aria-label'));
      add(el.getAttribute('data-text'));
      add(el.getAttribute('data-value'));
    }

    if (/^(input|textarea|select)$/i.test(el.tagName || '')) {
      add(el.value);
      add(el.getAttribute && el.getAttribute('value'));
      add(el.placeholder);
    }

    el.querySelectorAll?.('input, textarea, select').forEach(input => {
      add(input.value);
      add(input.getAttribute('value'));
      add(input.placeholder);
    });

    return compactRepeatedText(values.join(' '));
  }

  function getTaskColumnId(el) {
    const id = el?.id || '';
    const headerMatch = id.match(/\$headerCell\d*\$(\d+)$/);
    if (headerMatch) return headerMatch[1];
    const cellMatch = id.match(/\$cell\$(\d+)$/);
    return cellMatch ? cellMatch[1] : '';
  }

  function parsePlainHoursNumber(value) {
    const text = compactRepeatedText(value);
    const match = text.match(/^([0-9]+(?:\.[0-9]+)?)$/);
    return match ? Number.parseFloat(match[1]) : 0;
  }

  function extractEstimateHours(headerText, valueText, rowText) {
    const header = normalizeText(headerText);
    const value = compactRepeatedText(valueText);
    if (/(预计|预估|计划|总).*(工时|小时)|工时|小时/.test(header)) {
      return parsePlainHoursNumber(value) || parseHoursNumber(`${header} ${value}`);
    }
    return parseHoursNumber(`${header} ${value}`) || parseHoursNumber(rowText);
  }

  function createTaskItem(doc, name, estimateHours, designer = '') {
    return {
      name,
      designer: normalizeTaskDesigner(designer),
      estimateHours,
      sourceUrl: doc.location?.href || location.href,
      sourceTitle: doc.title || document.title || '任务页面'
    };
  }

  function collectMiniGridTasks(doc) {
    const tasks = [];
    doc.querySelectorAll('#designdatagrid, .mini-grid.mini-datagrid, .mini-grid').forEach(grid => {
      if (!isVisibleElement(grid)) return;
      const gridText = getTaskText(grid);
      if (!/(任务列表|设计任务|任务名称)/.test(gridText) || !/(预计工时|预估工时|计划工时|工时|小时)/.test(gridText)) return;

      const headerMap = new Map();
      const headerList = [];
      grid.querySelectorAll('.mini-grid-headerCell').forEach((headerEl, index) => {
        const text = compactRepeatedText(getTaskText(headerEl));
        if (!text) return;
        const columnId = getTaskColumnId(headerEl) || String(index);
        headerMap.set(columnId, text);
        headerList.push({ columnId, text });
      });

      const nameHeader = headerList.find(item => /任务.*(名|称)?|名称|标题|需求/.test(item.text));
      const designerHeader = headerList.find(item => /设计师|负责人|处理人|人员/.test(item.text));
      const estimateHeader = headerList.find(item => /(预计|预估|计划).*(工时|小时)|总工时|工时|小时/.test(item.text));
      if (!nameHeader || !estimateHeader) return;

      const rows = Array.from(grid.querySelectorAll('.mini-grid-rowstable tr.mini-grid-row, .mini-grid-rows-view tr.mini-grid-row, tr.mini-grid-row, .mini-grid-row'));
      rows.forEach(row => {
        if (!isVisibleElement(row)) return;
        const cellMap = new Map();
        const cellTexts = [];
        row.querySelectorAll('.mini-grid-cell, td').forEach((cell, index) => {
          const text = compactRepeatedText(getTaskText(cell));
          if (!text) return;
          const columnId = getTaskColumnId(cell) || String(index);
          cellMap.set(columnId, text);
          cellTexts.push(text);
        });

        const rowText = cellTexts.join(' ');
        const nameSource = cellMap.get(nameHeader.columnId) || cellTexts.find(text => /任务|需求|设计|名称|标题/.test(text)) || '';
        const designerSource = designerHeader ? cellMap.get(designerHeader.columnId) : '';
        const estimateSource = cellMap.get(estimateHeader.columnId) || '';
        const estimateHours = extractEstimateHours(headerMap.get(estimateHeader.columnId), estimateSource, rowText);
        const name = normalizeTaskName(nameSource);
        if (!name || !estimateHours) return;

        tasks.push(createTaskItem(doc, name, estimateHours, designerSource));
      });
    });
    return tasks;
  }

  function collectTableTasks(doc) {
    const tasks = [];
    doc.querySelectorAll('table').forEach(table => {
      if (!isVisibleElement(table)) return;
      const rows = Array.from(table.querySelectorAll('tr'));
      if (rows.length < 2) return;

      const headerRow = rows.find(row => Array.from(row.children).some(cell => /任务|名称|标题|预计|预估|计划|工时|小时/.test(getTaskText(cell))));
      const headers = headerRow ? Array.from(headerRow.children).map(getTaskText) : [];
      const nameIndex = getHeaderIndex(headers, [/任务.*(名|称)?/, /名称/, /标题/, /需求/]);
      const designerIndex = getHeaderIndex(headers, [/设计师/, /负责人/, /处理人/, /人员/]);
      const estimateIndex = getHeaderIndex(headers, [/(预计|预估|计划).*(工时|小时)/, /总工时/, /工时/, /小时/]);
      const sectionText = getTaskText(table.closest('.panel, .layui-card, .mini-panel, fieldset, form') || table);
      const looksLikeDesignSection = /设计任务|设计.*列表|任务列表/.test(sectionText);

      rows.forEach(row => {
        if (row === headerRow || !isVisibleElement(row)) return;
        const cells = Array.from(row.children).map(getTaskText);
        const filledCells = cells.filter(Boolean);
        if (filledCells.length < 2) return;
        const rowText = filledCells.join(' ');
        if (!looksLikeDesignSection && !/设计|任务/.test(rowText)) return;

        const nameSource = nameIndex >= 0 ? cells[nameIndex] : cells.find(text => /任务|需求|设计|名称|标题/.test(text)) || cells[0];
        const designerSource = designerIndex >= 0 ? cells[designerIndex] : '';
        const estimateSource = estimateIndex >= 0 ? cells[estimateIndex] : rowText;
        const estimateHours = estimateIndex >= 0
          ? extractEstimateHours(headers[estimateIndex], estimateSource, rowText)
          : parseHoursNumber(rowText);
        const name = normalizeTaskName(nameSource);
        if (!name || !estimateHours) return;

        tasks.push(createTaskItem(doc, name, estimateHours, designerSource));
      });
    });
    return tasks;
  }

  function collectLooseTasks(doc) {
    const tasks = [];
    doc.querySelectorAll('li, .row, .list-item, .mini-grid-row, .mini-listbox-item, [class*="row"], [class*="item"]').forEach(el => {
      if (!isVisibleElement(el)) return;
      const text = getTaskText(el);
      if (!/设计/.test(text) || !/(任务|工时|小时|预计|预估)/.test(text)) return;
      const estimateHours = parseHoursNumber(text);
      if (!estimateHours) return;
      const nameMatch = text.match(/(?:任务名称|设计任务|任务|名称|标题|需求名称)\s*[:：]\s*([^，,。；;]+?)(?=\s*(?:预计|预估|计划|工时|小时|$))/);
      const designerMatch = text.match(/(?:设计师|负责人|处理人|人员)\s*[:：]\s*([^\s，,。；;]+)/);
      const name = normalizeTaskName(nameMatch ? nameMatch[1] : text.replace(/(预计|预估|计划)?工时\s*[:：]?\s*[0-9.]+.*/, ''));
      const designer = normalizeTaskDesigner(designerMatch ? designerMatch[1] : '');
      if (!name || name.length > 80) return;
      tasks.push(createTaskItem(doc, name, estimateHours, designer));
    });
    return tasks;
  }

  function collectDesignTasksFromDocument(doc) {
    return [...collectMiniGridTasks(doc), ...collectTableTasks(doc), ...collectLooseTasks(doc)];
  }

  function dedupeTasks(tasks) {
    const map = new Map();
    tasks.forEach(task => {
      const normalized = {
        ...task,
        name: normalizeTaskName(task.name),
        designer: normalizeTaskDesigner(task.designer),
        estimateHours: parseFloat(task.estimateHours) || 0
      };
      if (!normalized.name || !normalized.designer || !normalized.estimateHours) return;
      const key = taskKeyFor(normalized);
      if (!map.has(key)) map.set(key, { ...normalized, key, legacyKey: legacyTaskKeyFor(normalized) });
    });
    return Array.from(map.values());
  }

  function scanDesignTasks(options = {}) {
    clearTimeout(taskScanTimer);
    const tasks = collectDesignTasksFromDocument(document);
    document.querySelectorAll('iframe').forEach(frame => {
      try {
        if (frame.contentDocument) tasks.push(...collectDesignTasksFromDocument(frame.contentDocument));
      } catch (e) {
        // Cross-origin frames cannot be read.
      }
    });
    discoveredDesignTasks = dedupeTasks(tasks);
    renderTaskCalculator();
    const status = document.getElementById('ep-task-scan-status');
    if (status) status.textContent = discoveredDesignTasks.length ? `读取到 ${discoveredDesignTasks.length} 条` : '未读取到设计任务';
    if (options.notify) showToast(discoveredDesignTasks.length ? '设计任务已读取' : '未读取到设计任务', discoveredDesignTasks.length ? 'success' : 'warn');
  }

  function scheduleDesignTaskScan(delay = 800) {
    clearTimeout(taskScanTimer);
    taskScanTimer = setTimeout(() => scanDesignTasks(), delay);
  }

  function normalizeSavedTaskCalculations(items) {
    if (!Array.isArray(items)) return [];
    return items
      .filter(item => item && typeof item === 'object')
      .map(item => ({
        id: item.id || createId('task'),
        taskKey: item.taskKey || stableHash(`${item.name}|${item.estimateHours}|${item.sourceUrl}`),
        name: normalizeTaskName(item.name),
        designer: normalizeTaskDesigner(item.designer),
        estimateHours: parseFloat(item.estimateHours) || 0,
        filledHours: parseFloat(item.filledHours) || 0,
        sourceUrl: item.sourceUrl || '',
        sourceTitle: item.sourceTitle || '',
        savedAt: item.savedAt || Date.now(),
        updatedAt: item.updatedAt || Date.now()
      }))
      .filter(item => item.name && item.estimateHours);
  }

  function saveTaskCalculations() {
    setStorage({ [TASK_CALC_STORAGE_KEY]: savedTaskCalculations });
  }

  function getTaskProgress(task) {
    const estimate = parseFloat(task.estimateHours) || 0;
    const filled = parseFloat(task.filledHours) || 0;
    return estimate > 0 ? (filled / estimate) * 100 : 0;
  }

  function renderTaskCalculator() {
    renderDiscoveredTasks();
    renderSavedTasks();
  }

  function getSavedTaskKeySet() {
    const keys = new Set();
    savedTaskCalculations.forEach(item => {
      if (item.taskKey) keys.add(item.taskKey);
      keys.add(taskKeyFor(item));
      keys.add(legacyTaskKeyFor(item));
    });
    return keys;
  }

  function renderDiscoveredTasks() {
    const el = document.getElementById('ep-task-discovered');
    if (!el) return;
    const savedKeys = getSavedTaskKeySet();
    const count = discoveredDesignTasks.length;
    el.innerHTML = `
      <div class="ep-task-panel-head">
        <div>
          <strong>读取到的设计任务</strong>
          <span>${count} 条</span>
        </div>
        <button class="ep-btn ep-task-save-selected" data-action="save-selected" ${count ? '' : 'disabled'}>${iconSvg('save')}<span>保存选中</span></button>
      </div>
      ${count ? `
        <div class="ep-task-discovered-list">
          ${discoveredDesignTasks.map(task => {
            const isSaved = savedKeys.has(task.key) || savedKeys.has(task.legacyKey);
            const designer = task.designer || '未识别';
            return `
              <label class="ep-task-discovered-item ${isSaved ? 'is-saved' : ''}">
                <input type="checkbox" data-key="${escapeHtml(task.key)}" ${isSaved ? 'disabled' : ''}>
                <span class="ep-task-info">
                  <span class="ep-task-name">${escapeHtml(task.name)}</span>
                  <span class="ep-task-meta">设计师：${escapeHtml(designer)}</span>
                </span>
                <span class="ep-task-hours">${formatHours(task.estimateHours)}</span>
                <span class="ep-task-tag ${isSaved ? 'is-saved' : 'is-saveable'}">${isSaved ? '已保存' : '可保存'}</span>
              </label>
            `;
          }).join('')}
        </div>
      ` : '<div class="ep-empty-state ep-empty-compact">暂无设计任务</div>'}
    `;
  }

  function renderSavedTasks() {
    const el = document.getElementById('ep-task-saved');
    if (!el) return;
    const count = savedTaskCalculations.length;
    el.innerHTML = `
      <div class="ep-task-panel-head">
        <div>
          <strong>已保存任务</strong>
          <span>${count} 条</span>
        </div>
      </div>
      ${count ? `
        <div class="ep-task-saved-list">
          ${savedTaskCalculations.map(renderSavedTaskItem).join('')}
        </div>
      ` : '<div class="ep-empty-state ep-empty-compact">暂无已保存任务</div>'}
    `;
  }

  function renderSavedTaskItem(task) {
    const percent = getTaskProgress(task);
    const width = Math.max(0, Math.min(percent, 100));
    const overClass = percent > 100 ? ' is-over' : '';
    return `
      <article class="ep-task-saved-item" data-id="${escapeHtml(task.id)}">
        <div class="ep-task-saved-main">
          <div class="ep-task-saved-title">${escapeHtml(task.name)}</div>
          <div class="ep-task-saved-meta">设计师：${escapeHtml(task.designer || '未识别')}</div>
          <div class="ep-task-progress-row">
            <label>已填 <input class="ep-task-hours-input" data-id="${escapeHtml(task.id)}" type="number" min="0" step="0.1" value="${escapeHtml(task.filledHours)}"></label>
            <span>总 ${formatHours(task.estimateHours)}</span>
            <strong class="ep-task-percent${overClass}">${percent.toFixed(1)}%</strong>
          </div>
          <div class="ep-task-progress"><i style="width: ${width.toFixed(1)}%"></i></div>
        </div>
        <button class="ep-icon-text-btn ep-task-delete" data-action="delete-saved-task" data-id="${escapeHtml(task.id)}" title="删除">${iconSvg('trash')}</button>
      </article>
    `;
  }

  function handleDiscoveredTasksClick(e) {
    const btn = e.target.closest('button');
    if (!btn || btn.getAttribute('data-action') !== 'save-selected') return;
    const panel = document.getElementById('ep-task-discovered');
    const checkedKeys = Array.from(panel?.querySelectorAll('input[type="checkbox"]:checked') || []).map(input => input.getAttribute('data-key'));
    if (!checkedKeys.length) {
      showToast('请选择任务', 'warn');
      return;
    }
    const savedKeys = getSavedTaskKeySet();
    let added = 0;
    checkedKeys.forEach(key => {
      if (savedKeys.has(key)) return;
      const task = discoveredDesignTasks.find(item => item.key === key);
      if (!task) return;
      savedTaskCalculations.unshift({
        id: createId('task'),
        taskKey: task.key,
        name: task.name,
        designer: task.designer || '',
        estimateHours: task.estimateHours,
        filledHours: 0,
        sourceUrl: task.sourceUrl,
        sourceTitle: task.sourceTitle,
        savedAt: Date.now(),
        updatedAt: Date.now()
      });
      savedKeys.add(key);
      if (task.legacyKey) savedKeys.add(task.legacyKey);
      added += 1;
    });
    saveTaskCalculations();
    renderTaskCalculator();
    showToast(added ? `已保存 ${added} 条任务` : '选中任务已保存', added ? 'success' : 'warn');
  }

  function handleSavedTaskInput(e) {
    const input = e.target.closest('.ep-task-hours-input');
    if (!input) return;
    const id = input.getAttribute('data-id');
    const task = savedTaskCalculations.find(item => item.id === id);
    if (!task) return;
    task.filledHours = Math.max(0, parseFloat(input.value) || 0);
    task.updatedAt = Date.now();
    saveTaskCalculations();
    updateSavedTaskRow(task);
  }

  function updateSavedTaskRow(task) {
    const row = document.querySelector(`.ep-task-saved-item[data-id="${CSS.escape(task.id)}"]`);
    if (!row) return;
    const percent = getTaskProgress(task);
    const width = Math.max(0, Math.min(percent, 100));
    const percentEl = row.querySelector('.ep-task-percent');
    const barEl = row.querySelector('.ep-task-progress i');
    if (percentEl) {
      percentEl.textContent = `${percent.toFixed(1)}%`;
      percentEl.classList.toggle('is-over', percent > 100);
    }
    if (barEl) barEl.style.width = `${width.toFixed(1)}%`;
  }

  async function handleSavedTasksClick(e) {
    const btn = e.target.closest('button[data-action="delete-saved-task"]');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    const task = savedTaskCalculations.find(item => item.id === id);
    if (!task) return;
    const ok = await showPanelConfirm(`确定删除「${task.name}」吗？`, {
      title: '删除任务',
      type: 'danger',
      confirmText: '删除'
    });
    if (!ok) return;
    savedTaskCalculations = savedTaskCalculations.filter(item => item.id !== id);
    saveTaskCalculations();
    renderTaskCalculator();
    showToast('任务已删除', 'success');
  }

  // ============ 预算计算器 ============

  function normalizeBudgetText(value) {
    return compactRepeatedText(value).replace(/\s+/g, ' ').trim();
  }

  function parseBudgetAmount(value) {
    const text = normalizeBudgetText(value).replace(/,/g, '');
    const match = text.match(/-?[0-9]+(?:\.[0-9]+)?/);
    return match ? Number.parseFloat(match[0]) : 0;
  }

  function formatMoney(value) {
    const amount = Number.parseFloat(value) || 0;
    return `${amount.toFixed(2)} 元`;
  }

  function isZeroBudgetAmount(value) {
    return (Number.parseFloat(value) || 0) <= 0;
  }

  function getBudgetTaskKey(urlValue = location.href) {
    try {
      const url = new URL(urlValue, location.href);
      const rowGuid = url.searchParams.get('RowGuid') || url.searchParams.get('rowguid') || '';
      return (rowGuid ? `${url.origin}${url.pathname}?RowGuid=${rowGuid}` : `${url.origin}${url.pathname}${url.search}`).toLowerCase();
    } catch (e) {
      return String(urlValue || '').toLowerCase();
    }
  }

  function getBudgetRecordKey(sourceUrl, projectName, taskName) {
    if (isDailyLogDetailPage()) {
      const project = normalizeBudgetText(projectName).toLowerCase();
      const task = normalizeBudgetText(taskName).toLowerCase();
      if (project || task) {
        return `${location.origin}/daily-log-task?project=${encodeURIComponent(project)}&task=${encodeURIComponent(task)}`.toLowerCase();
      }
    }
    return getBudgetTaskKey(sourceUrl);
  }

  function getBudgetReadableDocuments() {
    const docs = [document];
    document.querySelectorAll('iframe, frame').forEach(frame => {
      try {
        if (frame.contentDocument) docs.push(frame.contentDocument);
      } catch (e) {
        // Cross-origin frames cannot be read.
      }
    });
    return docs;
  }

  function getBudgetDocumentText(root = document) {
    const body = root.body;
    if (!body) return '';
    const clone = body.cloneNode(true);
    clone.querySelectorAll?.('#ep-tool-panel, #ep-tool-launcher, #ep-tool-toast, #ep-tool-dialog').forEach(node => node.remove());
    return normalizeBudgetText(clone.innerText || clone.textContent || '');
  }

  function getBudgetFieldValue(labelPatterns, root = document) {
    if (!root || !root.querySelectorAll) return '';
    const patterns = Array.isArray(labelPatterns) ? labelPatterns : [labelPatterns];
    const rows = Array.from(root.querySelectorAll('tr'));
    for (const row of rows) {
      const cells = Array.from(row.children).map(cell => normalizeBudgetText(getTaskText(cell)));
      for (let i = 0; i < cells.length; i += 1) {
        const label = cells[i];
        if (!patterns.some(pattern => pattern.test(label))) continue;
        for (let j = i + 1; j < cells.length; j += 1) {
          const value = cells[j];
          if (!value || patterns.some(pattern => pattern.test(value))) continue;
          return normalizeBudgetText(value.replace(label, ''));
        }
      }
    }
    return '';
  }

  function getBudgetTotalFromDetailTable(root = document) {
    const table = root.getElementById?.('ctl00_ContentPlaceHolder1_dgBudgetInfoDetail');
    if (!table) return 0;
    const rows = Array.from(table.querySelectorAll('tr'));
    if (rows.length < 2) return 0;
    const headers = Array.from(rows[0].children).map(cell => normalizeBudgetText(getTaskText(cell)));
    const totalIndex = headers.findIndex(header => /^总额$/.test(header));
    if (totalIndex < 0) return 0;
    return rows.slice(1).reduce((sum, row) => {
      const cells = Array.from(row.children).map(cell => normalizeBudgetText(getTaskText(cell)));
      return sum + parseBudgetAmount(cells[totalIndex]);
    }, 0);
  }

  function hasBudgetDetailSignal(root = document, summaryTotal = '') {
    const summary = normalizeBudgetText(summaryTotal);
    if (summary && /-?\d/.test(summary)) return true;

    const detailTable = root.getElementById?.('ctl00_ContentPlaceHolder1_dgBudgetInfoDetail');
    if (detailTable && !isToolElement(detailTable)) return true;

    const budgetTable = Array.from(root.querySelectorAll('table')).some(table => {
      if (isToolElement(table)) return false;
      const text = normalizeBudgetText(getTaskText(table)).slice(0, 3000);
      return /(预算信息|预算明细|预算|BudgetInfo|Budget)/i.test(text) && /(总额|预算金额|金额|费用)/.test(text);
    });
    if (budgetTable) return true;

    const text = getBudgetDocumentText(root).slice(0, 12000);
    return /(预算信息|预算明细|BudgetInfo)/i.test(text) && /(总额|预算金额|金额|费用)/.test(text);
  }

  function parseTaskLogDate(value) {
    const text = normalizeBudgetText(value);
    let match = text.match(/(20\d{2})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})/);
    if (!match) match = text.match(/(20\d{2})(\d{2})(\d{2})/);
    if (!match) return '';
    return `${match[1]}-${pad2(match[2])}-${pad2(match[3])}`;
  }

  function parseTaskLogHours(value, allowPureNumber = false) {
    const text = normalizeBudgetText(value).replace(/,/g, '');
    if (!text) return 0;
    const labeled = text.match(/(?:工时|工作时长|耗时|时长|小时|hours?|h)\s*[:：]?\s*([+-]?\d+(?:\.\d+)?)/i)
      || text.match(/([+-]?\d+(?:\.\d+)?)\s*(?:小时|工时|hours?|h)\b/i);
    if (labeled) return Number.parseFloat(labeled[1]) || 0;
    if (allowPureNumber && /^-?\d+(?:\.\d+)?$/.test(text)) return Number.parseFloat(text) || 0;
    return 0;
  }

  function normalizeBudgetTaskLogs(logs) {
    if (!Array.isArray(logs)) return [];
    const map = new Map();
    logs.forEach(log => {
      const date = parseTaskLogDate(log?.date);
      const hours = Number.parseFloat(log?.hours) || 0;
      if (!date || hours <= 0) return;
      const content = normalizeBudgetText(log?.content || '').slice(0, 80);
      const key = `${date}|${hours}|${content}`;
      if (!map.has(key)) map.set(key, { date, hours, content });
    });
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  function buildTaskLogEntry(rowText, dateText, hourText, contentText = '') {
    const date = parseTaskLogDate(dateText || rowText);
    const hours = parseTaskLogHours(hourText, true) || parseTaskLogHours(rowText);
    if (!date || hours <= 0) return null;
    return {
      date,
      hours,
      content: normalizeBudgetText(contentText || rowText).slice(0, 80)
    };
  }

  function findTaskLogHeader(rows) {
    for (let index = 0; index < rows.length; index += 1) {
      const cells = rows[index].cells;
      const joined = cells.join(' ');
      const dateIndex = cells.findIndex(text => /填写时间|填报时间|日志日期|填写日期|日期|时间/.test(text));
      const hourIndex = cells.findIndex(text => /工时|工作时长|耗时|时长|小时/.test(text));
      const contentIndex = cells.findIndex(text => /日志内容|工作内容|内容|说明|描述/.test(text));
      if ((dateIndex >= 0 && hourIndex >= 0) || (/日志|填写/.test(joined) && hourIndex >= 0)) {
        return { rowIndex: index, dateIndex, hourIndex, contentIndex };
      }
    }
    return null;
  }

  function readBudgetTaskLogs(root = document) {
    const logs = [];
    const tables = Array.from(root.querySelectorAll('table'));
    tables.forEach(table => {
      const tableText = normalizeBudgetText(table.textContent || '').slice(0, 6000);
      if (!/日志|填写时间|填报时间|工时|小时/.test(tableText)) return;

      const rows = Array.from(table.querySelectorAll('tr')).map(row => ({
        row,
        cells: Array.from(row.children).map(cell => normalizeBudgetText(getTaskText(cell)))
      })).filter(item => item.cells.some(Boolean));

      const header = findTaskLogHeader(rows);
      if (header) {
        rows.slice(header.rowIndex + 1).forEach(item => {
          const rowText = normalizeBudgetText(getTaskText(item.row));
          const dateText = header.dateIndex >= 0 ? item.cells[header.dateIndex] : rowText;
          const hourText = header.hourIndex >= 0 ? item.cells[header.hourIndex] : rowText;
          const contentText = header.contentIndex >= 0 ? item.cells[header.contentIndex] : '';
          const entry = buildTaskLogEntry(rowText, dateText, hourText, contentText);
          if (entry) logs.push(entry);
        });
        return;
      }

      rows.forEach(item => {
        const rowText = normalizeBudgetText(getTaskText(item.row));
        if (!/日志|填写|填报|工时|小时|hours?|h/i.test(rowText)) return;
        const entry = buildTaskLogEntry(rowText, rowText, rowText);
        if (entry) logs.push(entry);
      });
    });

    return normalizeBudgetTaskLogs(logs);
  }

  function getTaskLogYearMonth(taskLogs) {
    const counts = new Map();
    taskLogs.forEach(log => {
      const yearMonth = String(log.date || '').slice(0, 7);
      if (!yearMonth) return;
      counts.set(yearMonth, (counts.get(yearMonth) || 0) + 1);
    });
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  }

  function getBudgetRecordYearMonths(record) {
    if (record?.yearMonth) return [record.yearMonth];
    const months = new Set();
    (record?.taskLogs || []).forEach(log => {
      const yearMonth = String(log.date || '').slice(0, 7);
      if (yearMonth) months.add(yearMonth);
    });
    return Array.from(months);
  }

  function getBudgetRecordStorageKey(record) {
    const yearMonth = record?.yearMonth || getTaskLogYearMonth(record?.taskLogs || []);
    return `${record?.recordKey || ''}|${yearMonth || ''}`;
  }

  function budgetRecordBelongsToMonth(record, yearMonth) {
    if (!yearMonth) return false;
    return getBudgetRecordYearMonths(record).includes(yearMonth);
  }

  function normalizeBudgetIdentityText(value) {
    const text = normalizeBudgetText(value).toLowerCase();
    return /^未识别/.test(text) ? '' : text;
  }

  function budgetRecordsSameTask(left, right) {
    if (!left || !right) return false;
    if (left.recordKey && right.recordKey && left.recordKey === right.recordKey) return true;

    const leftTask = normalizeBudgetIdentityText(left.taskName);
    const rightTask = normalizeBudgetIdentityText(right.taskName);
    if (!leftTask || !rightTask || leftTask !== rightTask) return false;

    const leftProject = normalizeBudgetIdentityText(left.projectName);
    const rightProject = normalizeBudgetIdentityText(right.projectName);
    if (leftProject && rightProject) return leftProject === rightProject;
    return true;
  }

  function findSavedBudgetRecordIndex(record, yearMonth) {
    return savedBudgetRecords.findIndex(item => (
      budgetRecordBelongsToMonth(item, yearMonth) &&
      budgetRecordsSameTask(item, record)
    ));
  }

  function getTaskLogMonthStats(taskLogs, yearMonth) {
    const normalized = normalizeBudgetTaskLogs(taskLogs);
    const monthSet = new Set();
    let totalHours = 0;
    let monthHours = 0;

    normalized.forEach(log => {
      const hours = Number.parseFloat(log.hours) || 0;
      const logMonth = String(log.date || '').slice(0, 7);
      if (!logMonth || hours <= 0) return;
      monthSet.add(logMonth);
      totalHours += hours;
      if (logMonth === yearMonth) monthHours += hours;
    });

    return {
      logs: normalized,
      months: Array.from(monthSet).sort(),
      isCrossMonth: monthSet.size > 1,
      totalHours,
      monthHours
    };
  }

  function buildMonthlyBudgetRecord(baseRecord, yearMonth, options = {}) {
    const stats = getTaskLogMonthStats(baseRecord.taskLogs, yearMonth);
    const originalTotalAmount = Number.parseFloat(options.originalTotalAmount ?? baseRecord.originalTotalAmount ?? baseRecord.totalAmount) || 0;
    const allocatedAmount = stats.isCrossMonth && stats.totalHours > 0
      ? originalTotalAmount * (stats.monthHours / stats.totalHours)
      : originalTotalAmount;

    return {
      ...baseRecord,
      originalTotalAmount,
      totalAmount: allocatedAmount,
      zeroBudget: isZeroBudgetAmount(allocatedAmount),
      taskLogs: stats.logs,
      yearMonth,
      allocation: {
        isCrossMonth: stats.isCrossMonth,
        months: stats.months,
        totalHours: stats.totalHours,
        monthHours: stats.monthHours,
        ratio: stats.totalHours > 0 ? stats.monthHours / stats.totalHours : 0
      }
    };
  }

  function findMonthLogReport(yearMonth) {
    const pools = [
      budgetLogReports,
      monthLogCache,
      savedMonthReports,
      currentMonthReport ? [currentMonthReport] : []
    ];
    for (const pool of pools) {
      const match = pool.find(report => report?.yearMonth === yearMonth);
      if (match) return match;
    }
    if (!yearMonth) return getBudgetDisplayLogReport();
    return null;
  }

  function normalizeBudgetLogReport(report) {
    return normalizeMonthLogCache(report ? [report] : [])[0] || null;
  }

  function normalizeBudgetLogReports(value) {
    const reports = Array.isArray(value) ? value : (value ? [value] : []);
    const map = new Map();

    normalizeMonthLogCache(reports).forEach(report => {
      if (!report?.yearMonth) return;
      const normalized = {
        ...report,
        savedForBudgetAt: Number(report.savedForBudgetAt || report.savedAt || Date.now())
      };
      const previous = map.get(normalized.yearMonth);
      if (!previous || normalized.savedForBudgetAt >= (previous.savedForBudgetAt || 0)) {
        map.set(normalized.yearMonth, normalized);
      }
    });

    return Array.from(map.values()).sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));
  }

  function cloneBudgetLogReport(report) {
    if (!report) return null;
    const copy = JSON.parse(JSON.stringify(report));
    copy.savedForBudgetAt = Date.now();
    return copy;
  }

  function getSavedBudgetLogReport(yearMonth) {
    if (!yearMonth) return null;
    return budgetLogReports.find(report => report.yearMonth === yearMonth) || null;
  }

  function getLatestMonthLogReport() {
    return monthLogCache[0] || currentMonthReport || savedMonthReports[0] || null;
  }

  function getBudgetDisplayLogReport() {
    const selected = getSavedBudgetLogReport(activeBudgetLogYearMonth);
    if (selected) return selected;
    const latest = getLatestMonthLogReport();
    return latest || budgetLogReports[0] || null;
  }

  function getBudgetActiveYearMonth() {
    return getBudgetDisplayLogReport()?.yearMonth || getTaskLogYearMonth(currentBudgetRecord?.taskLogs || []) || '';
  }

  function getBudgetRecordsForYearMonth(yearMonth = getBudgetActiveYearMonth()) {
    if (!yearMonth) return [];
    return savedBudgetRecords.filter(record => budgetRecordBelongsToMonth(record, yearMonth));
  }

  function getBudgetPersistentLogData(report = getBudgetDisplayLogReport()) {
    const yearMonth = report?.yearMonth || '';
    const savedByDate = new Map();
    getBudgetRecordsForYearMonth(yearMonth).forEach(record => {
      (record.taskLogs || []).forEach(log => {
        if (yearMonth && String(log.date).slice(0, 7) !== yearMonth) return;
        savedByDate.set(log.date, (savedByDate.get(log.date) || 0) + (Number.parseFloat(log.hours) || 0));
      });
    });

    const dateSet = new Set();
    (report?.days || []).forEach(day => {
      if (day?.date) dateSet.add(day.date);
    });
    savedByDate.forEach((hours, date) => {
      if (hours > 0) dateSet.add(date);
    });

    const rows = Array.from(dateSet).sort().map(date => {
      const day = (report?.days || []).find(item => item.date === date);
      const monthHours = Number.parseFloat(day?.workHourValue) || 0;
      const savedHours = Number.parseFloat(savedByDate.get(date)) || 0;
      const diffHours = monthHours - savedHours;
      return {
        date,
        weekday: day?.weekday || formatWeekday(parseLocalDate(date)?.getDay()),
        logRowGuid: day?.logRowGuid || extractRowGuidFromText(day?.logUrl),
        logUrl: normalizeDailyLogUrl(day?.logUrl, date, day?.logRowGuid || extractRowGuidFromText(day?.logUrl)),
        logAction: day?.logAction || { type: 'openRZ', args: [date] },
        monthHours,
        savedHours,
        diffHours,
        isWeekend: Boolean(day?.isWeekend),
        isWorkday: Boolean(day?.isStandardWorkday),
        covered: monthHours > 0 && savedHours >= monthHours,
        missing: monthHours > 0 && savedHours < monthHours,
        over: monthHours > 0 && savedHours > monthHours,
        empty: monthHours <= 0 && savedHours <= 0
      };
    });

    return {
      report,
      yearMonth,
      rows,
      monthTotal: rows.reduce((sum, row) => sum + row.monthHours, 0),
      savedTotal: rows.reduce((sum, row) => sum + row.savedHours, 0),
      diffTotal: rows.reduce((sum, row) => sum + row.diffHours, 0)
    };
  }

  function readCurrentBudgetRecord() {
    const fromDailyLogDetail = isDailyLogDetailPage();
    if (!fromDailyLogDetail && !looksLikeBudgetTaskPage()) return null;
    const docs = fromDailyLogDetail ? getBudgetReadableDocuments() : [document];

    for (const doc of docs) {
      const infoRoot = doc.getElementById?.('tableInfo') || doc;
      const projectName = getBudgetFieldValue([/^项目名称[:：]?$/], infoRoot);
      const taskName = getBudgetFieldValue([/^任务名称[:：]?$/], doc);
      const summaryTotal = getBudgetFieldValue([/^总额[:：]$/], doc);
      const totalAmount = parseBudgetAmount(summaryTotal) || getBudgetTotalFromDetailTable(doc);
      const taskLogs = readBudgetTaskLogs(doc);
      const hasBudgetDetail = hasBudgetDetailSignal(doc, summaryTotal);
      const hasTaskName = Boolean(normalizeBudgetText(taskName));
      const hasFilledWorkHours = taskLogs.some(log => (Number.parseFloat(log.hours) || 0) > 0);
      if (!hasBudgetDetail && totalAmount <= 0) continue;
      if (!hasTaskName || !hasFilledWorkHours) continue;
      if (fromDailyLogDetail && totalAmount <= 0 && (!projectName && !taskName)) continue;
      if (!projectName && !taskName && !totalAmount) continue;
      const sourceUrl = doc.location?.href || location.href;
      return {
        recordKey: getBudgetRecordKey(sourceUrl, projectName, taskName),
        projectName: projectName || '未识别项目',
        taskName: taskName || '未识别任务',
        totalAmount,
        zeroBudget: isZeroBudgetAmount(totalAmount),
        taskLogs,
        sourceUrl,
        sourceTitle: doc.title || document.title || '任务明细',
        readAt: Date.now()
      };
    }

    return null;
  }

  function normalizeBudgetRecords(items) {
    if (!Array.isArray(items)) return [];
    const map = new Map();
    items
      .filter(item => item && typeof item === 'object')
      .forEach(item => {
        const sourceUrl = item.sourceUrl || '';
        const record = {
          id: item.id || createId('budget'),
          recordKey: item.recordKey || getBudgetTaskKey(sourceUrl),
          projectName: normalizeBudgetText(item.projectName) || '未识别项目',
          taskName: normalizeBudgetText(item.taskName) || '未识别任务',
          originalTotalAmount: parseBudgetAmount(item.originalTotalAmount || item.totalAmount),
          totalAmount: parseBudgetAmount(item.totalAmount),
          zeroBudget: item.zeroBudget === true || isZeroBudgetAmount(item.totalAmount),
          taskLogs: normalizeBudgetTaskLogs(item.taskLogs),
          yearMonth: item.yearMonth || getTaskLogYearMonth(item.taskLogs || []),
          allocation: item.allocation && typeof item.allocation === 'object' ? item.allocation : null,
          sourceUrl,
          sourceTitle: item.sourceTitle || '任务明细',
          savedAt: item.savedAt || Date.now()
        };
        if (!record.recordKey) return;
        map.set(getBudgetRecordStorageKey(record), record);
      });
    return Array.from(map.values());
  }

  function saveBudgetRecords() {
    setStorage({ [BUDGET_CALC_STORAGE_KEY]: savedBudgetRecords });
  }

  function saveBudgetLogReport() {
    const latest = getLatestMonthLogReport();
    if (!latest) {
      showToast('请先打开整月日志页读取当月日志', 'warn');
      return;
    }
    const report = cloneBudgetLogReport(latest);
    budgetLogReports = normalizeBudgetLogReports([
      report,
      ...budgetLogReports.filter(item => item.yearMonth !== report.yearMonth)
    ]);
    activeBudgetLogYearMonth = report.yearMonth;
    setStorage({
      [BUDGET_LOG_REPORT_STORAGE_KEY]: budgetLogReports,
      [BUDGET_LOG_ACTIVE_MONTH_STORAGE_KEY]: activeBudgetLogYearMonth
    });
    renderBudgetCalculator();
    showToast('月日志已常驻保存', 'success');
  }

  async function deleteBudgetLogReport(yearMonth) {
    const targetYearMonth = yearMonth || activeBudgetLogYearMonth || getBudgetDisplayLogReport()?.yearMonth || '';
    if (!targetYearMonth || !getSavedBudgetLogReport(targetYearMonth)) {
      showToast('请选择要删除的常驻月日志', 'warn');
      return;
    }

    const ok = await showPanelConfirm(`确定删除 ${targetYearMonth} 常驻月日志吗？`, {
      title: '删除常驻月日志',
      type: 'danger',
      confirmText: '删除'
    });
    if (!ok) return;

    budgetLogReports = budgetLogReports.filter(report => report.yearMonth !== targetYearMonth);
    activeBudgetLogYearMonth = budgetLogReports[0]?.yearMonth || '';
    setStorage({
      [BUDGET_LOG_REPORT_STORAGE_KEY]: budgetLogReports,
      [BUDGET_LOG_ACTIVE_MONTH_STORAGE_KEY]: activeBudgetLogYearMonth
    });
    renderBudgetCalculator();
    showToast('常驻月日志已删除', 'success');
  }

  function isCurrentBudgetSaved() {
    if (!currentBudgetRecord) return false;
    const yearMonth = getBudgetActiveYearMonth();
    const monthlyRecord = buildMonthlyBudgetRecord(currentBudgetRecord, yearMonth);
    return findSavedBudgetRecordIndex(monthlyRecord, yearMonth) >= 0;
  }

  function syncCurrentBudgetRecordToSaved() {
    if (!currentBudgetRecord) return;
    const activeYearMonth = getBudgetActiveYearMonth();
    const monthlyRecord = buildMonthlyBudgetRecord(currentBudgetRecord, activeYearMonth);
    const index = findSavedBudgetRecordIndex(monthlyRecord, activeYearMonth);
    if (index < 0) return;

    const saved = savedBudgetRecords[index];
    const currentLogs = normalizeBudgetTaskLogs(monthlyRecord.taskLogs);
    const savedLogs = normalizeBudgetTaskLogs(saved.taskLogs);
    const changed = JSON.stringify(currentLogs) !== JSON.stringify(savedLogs)
      || saved.projectName !== monthlyRecord.projectName
      || saved.taskName !== monthlyRecord.taskName
      || Boolean(saved.zeroBudget) !== Boolean(monthlyRecord.zeroBudget)
      || (Number.parseFloat(saved.totalAmount) || 0) !== (Number.parseFloat(monthlyRecord.totalAmount) || 0)
      || (Number.parseFloat(saved.originalTotalAmount) || 0) !== (Number.parseFloat(monthlyRecord.originalTotalAmount) || 0);

    if (!changed) return;
    savedBudgetRecords.splice(index, 1, {
      ...saved,
      recordKey: monthlyRecord.recordKey,
      projectName: monthlyRecord.projectName,
      taskName: monthlyRecord.taskName,
      totalAmount: monthlyRecord.totalAmount,
      zeroBudget: monthlyRecord.zeroBudget,
      originalTotalAmount: monthlyRecord.originalTotalAmount,
      taskLogs: currentLogs,
      yearMonth: monthlyRecord.yearMonth,
      allocation: monthlyRecord.allocation,
      sourceUrl: monthlyRecord.sourceUrl,
      sourceTitle: monthlyRecord.sourceTitle,
      updatedAt: Date.now()
    });
    saveBudgetRecords();
  }

  function getBudgetSavedTotal() {
    return getBudgetRecordsForYearMonth().reduce((sum, item) => sum + (Number.parseFloat(item.totalAmount) || 0), 0);
  }

  async function refreshBudgetCalculator() {
    try {
      const result = await getStorage([MONTH_LOG_CACHE_STORAGE_KEY, BUDGET_LOG_REPORT_STORAGE_KEY, BUDGET_LOG_ACTIVE_MONTH_STORAGE_KEY]);
      monthLogCache = normalizeMonthLogCache(result[MONTH_LOG_CACHE_STORAGE_KEY]);
      budgetLogReports = normalizeBudgetLogReports(result[BUDGET_LOG_REPORT_STORAGE_KEY]);
      if (getSavedBudgetLogReport(result[BUDGET_LOG_ACTIVE_MONTH_STORAGE_KEY])) {
        activeBudgetLogYearMonth = result[BUDGET_LOG_ACTIVE_MONTH_STORAGE_KEY];
      } else if (activeBudgetLogYearMonth && !getSavedBudgetLogReport(activeBudgetLogYearMonth)) {
        activeBudgetLogYearMonth = '';
      }
    } catch (e) {
      // Keep the in-memory cache if storage is temporarily unavailable.
    }

    try {
      currentBudgetRecord = readCurrentBudgetRecord();
      syncCurrentBudgetRecordToSaved();
    } catch (e) {
      console.warn('[新点小工具] 预算读取失败', e);
      currentBudgetRecord = null;
    }
    renderBudgetCalculator();
  }

  function renderBudgetCalculator() {
    renderBudgetCurrent();
    renderBudgetMonthLog();
    renderBudgetSaved();
  }

  function formatBudgetCalendarHours(value) {
    const hours = Number.parseFloat(value) || 0;
    return `${Number.isInteger(hours) ? String(hours) : hours.toFixed(1)}h`;
  }

  function renderBudgetLogCalendar(data) {
    if (!data.rows.length) return '<div class="ep-budget-log-empty-row">当月暂无日志日期</div>';

    const firstDate = parseLocalDate(data.rows[0].date);
    const leadingBlanks = firstDate ? (firstDate.getDay() + 6) % 7 : 0;
    const blankCells = Array.from({ length: leadingBlanks }, () => '<div class="ep-budget-cal-cell is-blank"></div>').join('');
    const dayCells = data.rows.map(row => {
      const dateObj = parseLocalDate(row.date);
      const dayNumber = dateObj ? dateObj.getDate() : row.date.slice(-2);
      const logUrl = normalizeDailyLogUrl(row.logUrl, row.date, row.logRowGuid);
      const logAction = row.logAction ? JSON.stringify(row.logAction) : '';
      const classes = [
        'ep-budget-cal-cell',
        logUrl ? 'is-clickable' : '',
        row.covered ? 'is-covered' : '',
        row.missing ? 'is-missing' : '',
        row.over ? 'is-over' : '',
        row.empty ? 'is-empty' : '',
        row.isWeekend ? 'is-weekend' : '',
        row.isWorkday ? 'is-workday' : ''
      ].filter(Boolean).join(' ');

      return `
        <div class="${classes}" ${logUrl ? `data-log-url="${escapeHtml(logUrl)}"` : ''} ${logAction ? `data-log-action="${escapeHtml(logAction)}"` : ''} role="button" tabindex="0" title="${escapeHtml(row.date)} 月历 ${formatHours(row.monthHours)}，已记 ${formatHours(row.savedHours)}${logUrl ? '，点击打开日志' : ''}">
          <div class="ep-budget-cal-top">
            <strong>${escapeHtml(dayNumber)}</strong>
            <span>${escapeHtml(row.weekday || '')}</span>
          </div>
          <div class="ep-budget-cal-hours">
            <span>月${formatBudgetCalendarHours(row.monthHours)}</span>
            <span>记${row.savedHours > 0 ? formatBudgetCalendarHours(row.savedHours) : '-'}</span>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="ep-budget-calendar">
        <div class="ep-budget-weekdays">
          <span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span>
        </div>
        <div class="ep-budget-calendar-grid">${blankCells}${dayCells}</div>
      </div>
    `;
  }

  function renderBudgetMonthLog() {
    const el = document.getElementById('ep-budget-month-log');
    if (!el) return;

    const latest = getLatestMonthLogReport();
    const report = getBudgetDisplayLogReport();
    const monthSwitcher = budgetLogReports.length
      ? `<select class="ep-budget-log-switch" data-action="switch-budget-month-log" title="选择已保存年月">
          ${budgetLogReports.map(item => `<option value="${escapeHtml(item.yearMonth)}" ${report?.yearMonth === item.yearMonth ? 'selected' : ''}>${escapeHtml(item.yearMonth)}</option>`).join('')}
        </select>`
      : '';

    if (!report) {
      el.innerHTML = `
        <div class="ep-budget-log-fixed-head">
          <div>
            <strong>常驻月日志</strong>
            <span>先打开整月日志页读取当月工时</span>
          </div>
          <button class="ep-btn ep-budget-log-save" data-action="save-budget-month-log" disabled>${iconSvg('save')}<span>保存</span></button>
        </div>
        <div class="ep-empty-state ep-empty-compact ep-budget-log-empty">暂无当月日志</div>
      `;
      return;
    }

    const data = getBudgetPersistentLogData(report);
    const latestCanSave = Boolean(latest);
    const latestSaved = Boolean(latest && getSavedBudgetLogReport(latest.yearMonth));
    const saveDisabled = !latestCanSave;
    const saveLabel = latestSaved ? '更新常驻' : '保存常驻';
    const deleteTargetYearMonth = getSavedBudgetLogReport(report.yearMonth) ? report.yearMonth : '';
    const diffClass = data.diffTotal > 0 ? 'is-missing' : (data.diffTotal < 0 ? 'is-over' : 'is-covered');
    const latestHint = latest && latest.yearMonth !== report.yearMonth ? `，日志页最新 ${latest.yearMonth}` : '';

    el.innerHTML = `
      <div class="ep-budget-log-fixed-head">
        <div>
          <strong>${escapeHtml(report.yearMonth)} 常驻月日志</strong>
          <span class="${diffClass}">月 ${formatHours(data.monthTotal)} / 已记 ${formatHours(data.savedTotal)} / 未记 ${formatHours(Math.max(data.diffTotal, 0))}${escapeHtml(latestHint)}</span>
        </div>
        <div class="ep-budget-log-actions">
          ${monthSwitcher}
          <button class="ep-icon-text-btn ep-budget-log-delete" data-action="delete-budget-month-log" data-year-month="${escapeHtml(deleteTargetYearMonth)}" ${deleteTargetYearMonth ? '' : 'disabled'} title="删除当前年月常驻日志">${iconSvg('trash')}</button>
          <button class="ep-btn ep-budget-log-save" data-action="save-budget-month-log" ${saveDisabled ? 'disabled' : ''}>${iconSvg('save')}<span>${saveLabel}</span></button>
        </div>
      </div>
      ${renderBudgetLogCalendar(data)}
    `;
  }

  function renderBudgetCurrent() {
    const el = document.getElementById('ep-budget-current');
    if (!el) return;
    if (!currentBudgetRecord) {
      el.innerHTML = `
        <div class="ep-empty-state ep-empty-compact ep-budget-empty-current">
          <div class="ep-empty-title">未读取到任务预算</div>
          <div class="ep-empty-text">请进入任务明细页后查看。</div>
        </div>
      `;
      return;
    }
    const saved = isCurrentBudgetSaved();
    const zeroBudget = isZeroBudgetAmount(currentBudgetRecord.totalAmount);
    el.innerHTML = `
      <div class="ep-budget-current-compact ${zeroBudget ? 'is-zero-budget' : ''}">
        <div class="ep-budget-title-row">
          <strong title="${escapeHtml(currentBudgetRecord.projectName)}">${escapeHtml(currentBudgetRecord.projectName)}</strong>
          <span class="ep-budget-status ${saved ? 'is-saved' : 'is-unsaved'}">${saved ? '已保存' : '未保存'}</span>
        </div>
        <div class="ep-budget-task-row" title="${escapeHtml(currentBudgetRecord.taskName)}">
          ${escapeHtml(currentBudgetRecord.taskName)}
        </div>
        <div class="ep-budget-action-row">
          <span class="ep-budget-amount-inline ${zeroBudget ? 'is-zero-budget' : ''}">预算 <strong>${formatMoney(currentBudgetRecord.totalAmount)}</strong>${zeroBudget ? '<em>需注意检查</em>' : ''}</span>
          <button class="ep-btn ep-btn-primary ep-budget-save-btn" data-action="save-budget-current" ${saved ? 'disabled' : ''}>${iconSvg('save')}<span>${saved ? '已保存' : '保存'}</span></button>
        </div>
      </div>
    `;
  }

  function renderBudgetSaved() {
    const el = document.getElementById('ep-budget-saved');
    if (!el) return;
    const activeYearMonth = getBudgetActiveYearMonth();
    const visibleRecords = getBudgetRecordsForYearMonth(activeYearMonth);
    const count = visibleRecords.length;
    el.innerHTML = `
      <div class="ep-budget-panel-head">
        <div>
          <strong>已保存预算</strong>
          <span>${activeYearMonth ? `${activeYearMonth} · ` : ''}${count} 条</span>
        </div>
        <div class="ep-budget-total">合计 ${formatMoney(getBudgetSavedTotal())}</div>
      </div>
      ${count ? `
        <div class="ep-budget-list">
          ${visibleRecords.map(renderBudgetRecordItem).join('')}
        </div>
      ` : `<div class="ep-empty-state ep-empty-compact">${activeYearMonth ? `${activeYearMonth} 暂无已保存预算` : '暂无已保存预算'}</div>`}
    `;
  }

  function renderBudgetRecordItem(item) {
    const allocation = item.allocation || {};
    const zeroBudget = isZeroBudgetAmount(item.totalAmount);
    const allocationText = allocation.isCrossMonth
      ? `跨月分摊 ${formatHours(allocation.monthHours)} / ${formatHours(allocation.totalHours)}`
      : '';
    return `
      <article class="ep-budget-item ${zeroBudget ? 'is-zero-budget' : ''}" data-id="${escapeHtml(item.id)}">
        <div class="ep-budget-item-main">
          <div class="ep-budget-item-project">${escapeHtml(item.projectName)}</div>
          <div class="ep-budget-item-task">${escapeHtml(item.taskName)}</div>
          ${zeroBudget ? '<div class="ep-budget-item-warning">预算为 0，需注意检查</div>' : ''}
          ${allocationText ? `<div class="ep-budget-item-extra">${escapeHtml(allocationText)}</div>` : ''}
        </div>
        <strong class="ep-budget-item-amount ${zeroBudget ? 'is-zero-budget' : ''}">${formatMoney(item.totalAmount)}</strong>
        <button class="ep-icon-text-btn ep-budget-delete" data-action="delete-budget-record" data-id="${escapeHtml(item.id)}" title="删除">${iconSvg('trash')}</button>
      </article>
    `;
  }

  async function handleBudgetCurrentClick(e) {
    const btn = e.target.closest('button[data-action="save-budget-current"]');
    if (!btn) return;
    if (!currentBudgetRecord) {
      showToast('未读取到当前任务预算', 'warn');
      return;
    }
    const activeYearMonth = getBudgetActiveYearMonth() || getTaskLogYearMonth(currentBudgetRecord.taskLogs || []);
    if (!activeYearMonth) {
      showToast('未读取到当前预算月份', 'warn');
      return;
    }
    if (isCurrentBudgetSaved()) {
      showToast('当前任务已保存', 'warn');
      renderBudgetCalculator();
      return;
    }
    const stats = getTaskLogMonthStats(currentBudgetRecord.taskLogs, activeYearMonth);
    if (stats.totalHours > 0 && stats.monthHours <= 0) {
      showToast(`${activeYearMonth} 未找到该任务日志工时`, 'warn');
      return;
    }

    const record = buildMonthlyBudgetRecord(currentBudgetRecord, activeYearMonth);
    if (isZeroBudgetAmount(record.totalAmount)) {
      const ok = await showPanelConfirm(
        `当前任务预算为 0。\n\n任务名称：${currentBudgetRecord.taskName}\n项目名称：${currentBudgetRecord.projectName}\n\n可以继续保存，但建议确认预算信息是否遗漏。`,
        {
          title: '预算为 0，请注意检查',
          type: 'danger',
          confirmText: '仍然保存'
        }
      );
      if (!ok) return;
    }

    if (stats.isCrossMonth) {
      const ok = await showPanelConfirm(
        `检测到跨月任务，将开始计算 ${activeYearMonth} 当月预算。\n\n` +
        `跨月月份：${stats.months.join('、')}\n` +
        `当月工时：${formatHours(stats.monthHours)}\n` +
        `总工时：${formatHours(stats.totalHours)}\n` +
        `预算总额：${formatMoney(record.originalTotalAmount)}\n` +
        `当月预算：${formatMoney(record.totalAmount)}\n\n` +
        `确认后将按当月预算保存。`,
        {
          title: '跨月预算确认',
          type: 'warning',
          confirmText: '按当月保存'
        }
      );
      if (!ok) return;
    }

    const existingIndex = findSavedBudgetRecordIndex(record, activeYearMonth);
    if (existingIndex >= 0) {
      savedBudgetRecords.splice(existingIndex, 1, {
        ...savedBudgetRecords[existingIndex],
        ...record,
        id: savedBudgetRecords[existingIndex].id,
        savedAt: savedBudgetRecords[existingIndex].savedAt || Date.now(),
        updatedAt: Date.now()
      });
    } else {
      savedBudgetRecords.unshift({
        ...record,
        id: createId('budget'),
        savedAt: Date.now()
      });
    }
    saveBudgetRecords();
    renderBudgetCalculator();
    showToast('预算已保存', 'success');
  }

  async function handleBudgetMonthLogClick(e) {
    const deleteBtn = e.target.closest('button[data-action="delete-budget-month-log"]');
    if (deleteBtn) {
      if (!deleteBtn.disabled) await deleteBudgetLogReport(deleteBtn.getAttribute('data-year-month'));
      return;
    }

    const btn = e.target.closest('button[data-action="save-budget-month-log"]');
    if (btn) {
      if (!btn.disabled) saveBudgetLogReport();
      return;
    }

    const cell = e.target.closest('.ep-budget-cal-cell[data-log-url], .ep-budget-cal-cell[data-log-action]');
    if (!cell) return;
    openBudgetLogPage(cell.getAttribute('data-log-url'), cell.getAttribute('data-log-action'));
  }

  function handleBudgetMonthLogChange(e) {
    const select = e.target.closest('select[data-action="switch-budget-month-log"]');
    if (!select) return;

    activeBudgetLogYearMonth = select.value || '';
    setStorage({ [BUDGET_LOG_ACTIVE_MONTH_STORAGE_KEY]: activeBudgetLogYearMonth });
    renderBudgetCalculator();
  }

  function handleBudgetMonthLogKeydown(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const cell = e.target.closest('.ep-budget-cal-cell[data-log-url], .ep-budget-cal-cell[data-log-action]');
    if (!cell) return;
    e.preventDefault();
    openBudgetLogPage(cell.getAttribute('data-log-url'), cell.getAttribute('data-log-action'));
  }

  function openBudgetLogPage(url, actionText = '') {
    let action = null;
    try {
      action = actionText ? JSON.parse(actionText) : null;
    } catch (e) {
      // Fall back to direct URL.
    }

    try {
      const actionArgs = Array.isArray(action?.args) ? action.args : [];
      const actionDate = actionArgs.find(arg => /^\d{4}-\d{2}-\d{2}$/.test(arg));
      const actionRowGuid = actionArgs.map(extractRowGuidFromText).find(Boolean);
      const targetUrl = normalizeDailyLogUrl(url, actionDate, actionRowGuid || extractRowGuidFromText(url));
      if (isValidDailyLogUrl(targetUrl)) {
        const opened = window.open(targetUrl, '_blank', 'noopener');
        if (!opened) location.href = targetUrl;
        return;
      }

      if (action?.type === 'openRZ' && typeof window.openRZ === 'function') {
        window.openRZ(...actionArgs);
        return;
      }

      throw new Error('invalid log url');
    } catch (e) {
      showToast('未读取到该日期日志链接', 'warn');
    }
  }

  async function handleBudgetSavedClick(e) {
    const btn = e.target.closest('button[data-action="delete-budget-record"]');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    const record = savedBudgetRecords.find(item => item.id === id);
    if (!record) return;
    const ok = await showPanelConfirm(`确定删除「${record.taskName}」吗？`, {
      title: '删除预算记录',
      type: 'danger',
      confirmText: '删除'
    });
    if (!ok) return;
    savedBudgetRecords = savedBudgetRecords.filter(item => item.id !== id);
    saveBudgetRecords();
    renderBudgetCalculator();
    showToast('预算记录已删除', 'success');
  }

  function isTopFrame() {
    return window.top === window;
  }

  function postFrameMessage(targetWindow, data) {
    if (!targetWindow) return;
    targetWindow.postMessage({
      source: FRAME_MESSAGE_SOURCE,
      ...data
    }, '*');
  }

  function notifyFrameEditableFocused() {
    if (isTopFrame()) return;
    postFrameMessage(window.top, { type: 'EP_FRAME_EDITABLE_FOCUSED' });
  }

  function bindTopFrameMessages() {
    if (!isTopFrame()) return;
    window.addEventListener('message', async e => {
      const data = e.data || {};
      if (data.source !== FRAME_MESSAGE_SOURCE) return;

      if (data.type === 'EP_FRAME_EDITABLE_FOCUSED') {
        lastEditableFrameWindow = e.source;
        lastEditableFrameAt = Date.now();
        return;
      }

      if (data.type === 'EP_BUDGET_FRAME_CHANGED') {
        startBudgetRefreshBurst(5200, 700);
        return;
      }

      if (data.type === 'EP_FRAME_PASTE_RESULT') {
        clearTimeout(framePasteTimer);
        const text = pendingFramePasteText;
        pendingFramePasteText = '';

        if (data.ok) {
          showToast('已快速填入', 'success');
        } else {
          await copyText(text);
          showToast('未找到输入框，已复制', 'warn');
        }
      }
    });
  }

  function bindChildFrameMessages() {
    if (isTopFrame()) return;
    window.addEventListener('message', async e => {
      const data = e.data || {};
      if (data.source !== FRAME_MESSAGE_SOURCE || data.type !== 'EP_FRAME_PASTE_TEXT') return;

      const ok = await pasteText(data.text, { noCopy: true, silent: true });
      postFrameMessage(window.top, {
        type: 'EP_FRAME_PASTE_RESULT',
        ok
      });
    });
  }

  function pasteTextToLastFrame(text) {
    if (!lastEditableFrameWindow) return false;
    pendingFramePasteText = text;
    postFrameMessage(lastEditableFrameWindow, {
      type: 'EP_FRAME_PASTE_TEXT',
      text
    });
    clearTimeout(framePasteTimer);
    framePasteTimer = setTimeout(async () => {
      if (!pendingFramePasteText) return;
      const fallbackText = pendingFramePasteText;
      pendingFramePasteText = '';
      await copyText(fallbackText);
      showToast('未确认填入，已复制', 'warn');
    }, 1200);
    return true;
  }

  function trackEditableFocus() {
    const active = document.activeElement;
    rememberEditableTarget(active);

    document.addEventListener('pointerdown', e => {
      if (isToolElement(e.target)) {
        rememberCurrentEditableTarget();
        if (e.target.closest('button')) e.preventDefault();
        return;
      }

      const target = closestEditableTarget(e.target);
      if (target) rememberEditableTarget(target);
    }, true);

    document.addEventListener('focusin', e => {
      if (isToolElement(e.target)) return;
      rememberEditableTarget(e.target);
    }, true);

    document.addEventListener('selectionchange', rememberCurrentEditableTarget, true);

    ['keyup', 'mouseup', 'input'].forEach(eventName => {
      document.addEventListener(eventName, e => {
        if (isToolElement(e.target)) return;
        const target = closestEditableTarget(e.target);
        if (target) rememberEditableTarget(target);
      }, true);
    });
  }

  function isToolElement(el) {
    const panel = document.getElementById('ep-tool-panel');
    const launcher = document.getElementById('ep-tool-launcher');
    return Boolean((panel && panel.contains(el)) || (launcher && launcher.contains(el)));
  }

  function closestEditableTarget(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;
    if (isEditableTarget(el)) return el;
    return el.closest?.('textarea, input, [contenteditable=""], [contenteditable="true"]') || null;
  }

  function rememberCurrentEditableTarget() {
    const active = document.activeElement;
    if (isEditableTarget(active) && !isToolElement(active)) {
      rememberEditableTarget(active);
    } else if (lastEditableEl && document.contains(lastEditableEl)) {
      rememberEditableSelection(lastEditableEl);
    }
  }

  function rememberEditableTarget(el) {
    if (!isEditableTarget(el) || isToolElement(el)) return;
    lastEditableEl = el;
    lastEditableAt = Date.now();
    rememberEditableSelection(el);
    notifyFrameEditableFocused();
  }

  function rememberEditableSelection(el) {
    lastEditableSelection = null;
    lastEditableRange = null;

    try {
      if ('value' in el && typeof el.selectionStart === 'number') {
        lastEditableSelection = {
          start: el.selectionStart,
          end: typeof el.selectionEnd === 'number' ? el.selectionEnd : el.selectionStart
        };
        return;
      }

      if (el.isContentEditable) {
        const selection = window.getSelection();
        if (selection && selection.rangeCount && el.contains(selection.anchorNode)) {
          lastEditableRange = selection.getRangeAt(0).cloneRange();
        }
      }
    } catch (e) {
      // Some inputs do not expose selection APIs until focused.
    }
  }

  function rangeBelongsToTarget(range, target) {
    if (!range || !target) return false;
    const node = range.commonAncestorContainer;
    return node === target || target.contains(node);
  }

  function makeInputEvent(text) {
    try {
      return new InputEvent('input', {
        bubbles: true,
        data: text,
        inputType: 'insertText'
      });
    } catch (e) {
      return new Event('input', { bubbles: true });
    }
  }

  function getStoredSelectionFor(target) {
    if (target !== lastEditableEl || !lastEditableSelection) return null;
    return lastEditableSelection;
  }

  function getStoredRangeFor(target) {
    if (target !== lastEditableEl || !rangeBelongsToTarget(lastEditableRange, target)) return null;
    return lastEditableRange.cloneRange();
  }

  function updateStoredCaret(target, cursor) {
    lastEditableEl = target;
    lastEditableAt = Date.now();
    lastEditableSelection = { start: cursor, end: cursor };
    lastEditableRange = null;
  }

  function updateStoredEditableRange(target) {
    lastEditableEl = target;
    lastEditableAt = Date.now();
    rememberEditableSelection(target);
  }

  function focusTarget(target) {
    if (typeof target.focus === 'function') {
      try {
        target.focus({ preventScroll: true });
      } catch (e) {
        target.focus();
      }
    }
  }

  function isRememberedEditableAvailable(el) {
    return Boolean(el && document.contains(el) && !isToolElement(el) && isVisibleEditableTarget(el));
  }

  function isEditableTarget(el) {
    if (!el || el.disabled || el.readOnly) return false;
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (tag === 'textarea') return true;
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      return !['button', 'checkbox', 'radio', 'submit', 'reset', 'file', 'image', 'range', 'color', 'hidden'].includes(type);
    }
    return Boolean(el.isContentEditable);
  }

  function isVisibleEditableTarget(el) {
    if (!isEditableTarget(el)) return false;
    if (isToolElement(el)) return false;

    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 4 &&
      rect.height > 4 &&
      rect.bottom >= 0 &&
      rect.right >= 0 &&
      rect.top <= window.innerHeight &&
      rect.left <= window.innerWidth &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0';
  }

  function collectEditableTargets(root = document) {
    const selectors = 'textarea, input, [contenteditable=""], [contenteditable="true"]';
    const results = [];
    root.querySelectorAll(selectors).forEach(el => {
      if (isVisibleEditableTarget(el)) results.push(el);
    });
    root.querySelectorAll('*').forEach(el => {
      if (el.shadowRoot) results.push(...collectEditableTargets(el.shadowRoot));
    });
    return results;
  }

  function findVisibleEditableTarget() {
    const candidates = collectEditableTargets();
    if (candidates.length === 0) return null;

    return candidates
      .map(el => {
        const rect = el.getBoundingClientRect();
        const tag = el.tagName ? el.tagName.toLowerCase() : '';
        const hasValue = 'value' in el && Boolean(el.value);
        let score = 0;
        if (el === lastEditableEl) score += 80;
        if (el.hasAttribute('autofocus')) score += 30;
        if (tag === 'textarea' || el.isContentEditable) score += 24;
        if (!hasValue) score += 8;
        score += Math.min(rect.width, 520) / 26;
        score += Math.min(rect.height, 160) / 10;
        score -= Math.max(rect.top, 0) / 1000;
        return { el, score };
      })
      .sort((a, b) => b.score - a.score)[0].el;
  }

  function getPasteTarget() {
    const panel = document.getElementById('ep-tool-panel');
    const active = document.activeElement;
    if (isVisibleEditableTarget(active) && !panel?.contains(active)) return active;
    if (isRememberedEditableAvailable(lastEditableEl)) return lastEditableEl;
    return findVisibleEditableTarget();
  }

  async function pasteText(text, options = {}) {
    const active = document.activeElement;
    const activeIsFrame = active && ['iframe', 'frame'].includes(active.tagName?.toLowerCase());

    if (isTopFrame() && lastEditableFrameWindow && (activeIsFrame || lastEditableFrameAt >= lastEditableAt) && pasteTextToLastFrame(text)) {
      return true;
    }

    const target = getPasteTarget();
    if (!target) {
      if (isTopFrame() && pasteTextToLastFrame(text)) return true;
      if (options.noCopy) return false;
      await copyText(text);
      if (!options.silent) showToast('未找到输入框，已复制', 'warn');
      return false;
    }

    insertTextIntoTarget(target, text);
    if (!options.silent) showToast('已快速填入', 'success');
    return true;
  }

  function insertTextIntoTarget(target, text) {
    focusTarget(target);

    if ('value' in target) {
      const value = target.value || '';
      const storedSelection = getStoredSelectionFor(target);
      const start = storedSelection
        ? storedSelection.start
        : (typeof target.selectionStart === 'number' ? target.selectionStart : value.length);
      const end = storedSelection
        ? storedSelection.end
        : (typeof target.selectionEnd === 'number' ? target.selectionEnd : value.length);
      const nextValue = value.slice(0, start) + text + value.slice(end);
      setNativeValue(target, nextValue);
      const cursor = start + text.length;
      if (typeof target.setSelectionRange === 'function') {
        target.setSelectionRange(cursor, cursor);
      }
      target.dispatchEvent(makeInputEvent(text));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      updateStoredCaret(target, cursor);
      return;
    }

    if (target.isContentEditable) {
      const selection = window.getSelection();
      const storedRange = getStoredRangeFor(target);
      if (selection) {
        if (storedRange) {
          selection.removeAllRanges();
          selection.addRange(storedRange);
        } else if (!selection.rangeCount || !target.contains(selection.anchorNode)) {
          const range = document.createRange();
          range.selectNodeContents(target);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
      document.execCommand('insertText', false, text);
      target.dispatchEvent(new Event('input', { bubbles: true }));
      updateStoredEditableRange(target);
    }
  }

  function setNativeValue(target, value) {
    const prototype = target.tagName?.toLowerCase() === 'textarea'
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');

    if (descriptor?.set) {
      descriptor.set.call(target, value);
    } else {
      target.value = value;
    }
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return;
      }
    } catch (e) {
      // fallback below
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }

  // ============ 页面变化与扩展入口 ============

  function scheduleCurrentMonthReportUpdate(delay = 360) {
    clearTimeout(reportRefreshTimer);
    reportRefreshTimer = setTimeout(() => {
      updateCurrentMonthReport();
    }, delay);
  }

  function scheduleBudgetCalculatorRefresh(delay = 520) {
    clearTimeout(budgetRefreshTimer);
    budgetRefreshTimer = setTimeout(() => {
      if (activeTool === 'budgetcalc' || isBudgetTaskDetailUrl() || isDailyLogDetailPage()) {
        refreshBudgetCalculator();
      }
    }, delay);
  }

  function startBudgetRefreshBurst(duration = 9000, interval = 900) {
    if (!isBudgetTaskDetailUrl() && !isDailyLogDetailPage()) return;
    clearInterval(budgetRefreshBurstTimer);

    const endAt = Date.now() + duration;
    const tick = () => {
      scheduleBudgetCalculatorRefresh(80);
      if (Date.now() >= endAt) {
        clearInterval(budgetRefreshBurstTimer);
        budgetRefreshBurstTimer = null;
      }
    };

    tick();
    budgetRefreshBurstTimer = setInterval(tick, interval);
  }

  function hasBudgetContentSignals(root = document) {
    const text = normalizeBudgetText(root.body?.innerText || root.body?.textContent || '').slice(0, 12000);
    return /项目名称|任务名称|预算信息|总额|预算|工作明细|工时|填写时间|日志/.test(text);
  }

  function scheduleBudgetFrameNotify(delay = 520) {
    if (isTopFrame()) return;
    clearTimeout(budgetFrameNotifyTimer);
    budgetFrameNotifyTimer = setTimeout(() => {
      if (!hasBudgetContentSignals(document)) return;
      postFrameMessage(window.top, {
        type: 'EP_BUDGET_FRAME_CHANGED',
        href: location.href,
        title: document.title || ''
      });
    }, delay);
  }

  function observeYearMonthChange() {
    const yearEl = document.getElementById('year');
    const monthEl = document.getElementById('month');
    if (!yearEl || !monthEl) return;

    let lastYear = yearEl.textContent;
    let lastMonth = monthEl.textContent;

    const observer = new MutationObserver(async () => {
      const curYear = yearEl.textContent;
      const curMonth = monthEl.textContent;
      if (curYear !== lastYear || curMonth !== lastMonth) {
        lastYear = curYear;
        lastMonth = curMonth;
        scheduleCurrentMonthReportUpdate(500);
      }
    });

    observer.observe(yearEl, { characterData: true, childList: true, subtree: true });
    observer.observe(monthEl, { characterData: true, childList: true, subtree: true });
  }

  function observeCalendarContentChange() {
    let observedCalendar = null;
    let calendarObserver = null;

    const attachCalendarObserver = () => {
      const calendar = document.querySelector(CALENDAR_SELECTOR);
      if (!calendar || calendar === observedCalendar) return;

      observedCalendar = calendar;
      calendarObserver?.disconnect();
      calendarObserver = new MutationObserver(() => scheduleCurrentMonthReportUpdate());
      calendarObserver.observe(calendar, {
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true
      });
    };

    attachCalendarObserver();

    const mountObserver = new MutationObserver(attachCalendarObserver);
    mountObserver.observe(document.body, { childList: true, subtree: true });
  }

  function observeBudgetContentChange() {
    if (!document.body) return;

    const observer = new MutationObserver(mutations => {
      if (!isBudgetTaskDetailUrl() && !isDailyLogDetailPage()) return;

      const onlyToolChanged = mutations.every(mutation => {
        const target = mutation.target?.nodeType === Node.ELEMENT_NODE
          ? mutation.target
          : mutation.target?.parentElement;
        return target?.closest?.('#ep-tool-panel, #ep-tool-launcher, #ep-tool-toast');
      });
      if (onlyToolChanged) return;

      scheduleBudgetCalculatorRefresh(700);
    });

    observer.observe(document.body, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true
    });
  }

  function observeBudgetFrameLoads() {
    if (!isTopFrame() || !document.body) return;
    const watched = new WeakSet();

    const watchFrame = frame => {
      if (!frame || watched.has(frame)) return;
      watched.add(frame);
      frame.addEventListener('load', () => startBudgetRefreshBurst(7600, 800));
    };

    const scanFrames = () => {
      document.querySelectorAll('iframe, frame').forEach(watchFrame);
    };

    scanFrames();
    const observer = new MutationObserver(mutations => {
      let shouldRefresh = false;
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType !== Node.ELEMENT_NODE) return;
          if (/^(iframe|frame)$/i.test(node.tagName || '')) {
            watchFrame(node);
            shouldRefresh = true;
          }
          node.querySelectorAll?.('iframe, frame').forEach(frame => {
            watchFrame(frame);
            shouldRefresh = true;
          });
        });
      });
      if (shouldRefresh) startBudgetRefreshBurst(7600, 800);
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  function observeChildBudgetContentChange() {
    if (isTopFrame() || !document.body) return;

    const observer = new MutationObserver(() => {
      scheduleBudgetFrameNotify(650);
    });

    observer.observe(document.body, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true
    });

    ['click', 'input', 'change'].forEach(eventName => {
      document.addEventListener(eventName, () => scheduleBudgetFrameNotify(500), true);
    });

    setTimeout(() => scheduleBudgetFrameNotify(120), 600);
    setTimeout(() => scheduleBudgetFrameNotify(120), 1800);
    setTimeout(() => scheduleBudgetFrameNotify(120), 3600);
  }

  function bindDailyLogTaskClickRefresh() {
    document.addEventListener('click', e => {
      if (!isDailyLogDetailPage()) return;
      const target = e.target?.closest?.('a, button, [onclick], [role="button"], td, span');
      if (!target || target.closest?.('#ep-tool-panel, #ep-tool-launcher, #ep-tool-toast')) return;
      startBudgetRefreshBurst(12000, 900);
    }, true);
  }

  function bindExtensionMessages() {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) return;
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message && message.type === 'EP_TOGGLE_PANEL') {
        togglePanelOpen();
        sendResponse({ ok: true });
      }
      return false;
    });
  }

  function bindStorageChanges() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) return;
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      if (changes[MONTH_LOG_CACHE_STORAGE_KEY]) {
        monthLogCache = normalizeMonthLogCache(changes[MONTH_LOG_CACHE_STORAGE_KEY].newValue);
        if (activeTool === 'budgetcalc') renderBudgetCalculator();
      }
      if (changes[BUDGET_LOG_REPORT_STORAGE_KEY]) {
        budgetLogReports = normalizeBudgetLogReports(changes[BUDGET_LOG_REPORT_STORAGE_KEY].newValue);
        if (activeBudgetLogYearMonth && !getSavedBudgetLogReport(activeBudgetLogYearMonth)) {
          activeBudgetLogYearMonth = '';
        }
        if (activeTool === 'budgetcalc') renderBudgetCalculator();
      }
      if (changes[BUDGET_LOG_ACTIVE_MONTH_STORAGE_KEY]) {
        activeBudgetLogYearMonth = getSavedBudgetLogReport(changes[BUDGET_LOG_ACTIVE_MONTH_STORAGE_KEY].newValue)
          ? changes[BUDGET_LOG_ACTIVE_MONTH_STORAGE_KEY].newValue
          : '';
        if (activeTool === 'budgetcalc') renderBudgetCalculator();
      }
    });
  }

  async function init() {
    if (!isTopFrame()) {
      trackEditableFocus();
      bindChildFrameMessages();
      observeChildBudgetContentChange();
      return;
    }

    const result = await getStorage([
      QUICK_COPY_STORAGE_KEY,
      QUICK_COPY_DEFAULT_GROUP_STORAGE_KEY,
      SAVED_MONTH_REPORTS_STORAGE_KEY,
      MONTH_LOG_CACHE_STORAGE_KEY,
      TASK_CALC_STORAGE_KEY,
      BUDGET_CALC_STORAGE_KEY,
      BUDGET_LOG_REPORT_STORAGE_KEY,
      BUDGET_LOG_ACTIVE_MONTH_STORAGE_KEY,
      ACTIVE_TOOL_STORAGE_KEY,
      PANEL_OPEN_STORAGE_KEY,
      PANEL_HEIGHT_STORAGE_KEY
    ]);

    quickCopyDefaultGroup = normalizeGroupName(result[QUICK_COPY_DEFAULT_GROUP_STORAGE_KEY]) || DEFAULT_QUICK_COPY_GROUP;
    quickCopySnippets = normalizeQuickCopySnippets(result[QUICK_COPY_STORAGE_KEY]);
    saveQuickCopyDefaultGroup();
    saveQuickCopySnippets();
    savedMonthReports = normalizeSavedReports(result[SAVED_MONTH_REPORTS_STORAGE_KEY]);
    monthLogCache = normalizeMonthLogCache(result[MONTH_LOG_CACHE_STORAGE_KEY]);
    savedTaskCalculations = normalizeSavedTaskCalculations(result[TASK_CALC_STORAGE_KEY]);
    savedBudgetRecords = normalizeBudgetRecords(result[BUDGET_CALC_STORAGE_KEY]);
    budgetLogReports = normalizeBudgetLogReports(result[BUDGET_LOG_REPORT_STORAGE_KEY]);
    activeBudgetLogYearMonth = getSavedBudgetLogReport(result[BUDGET_LOG_ACTIVE_MONTH_STORAGE_KEY])
      ? result[BUDGET_LOG_ACTIVE_MONTH_STORAGE_KEY]
      : '';
    saveTaskCalculations();
    saveBudgetRecords();
    activeTool = result[ACTIVE_TOOL_STORAGE_KEY] || (canUseCalendarApi() ? 'workhours' : ((looksLikeBudgetTaskPage() || isDailyLogDetailPage()) ? 'budgetcalc' : (looksLikeDesignTaskPage() ? 'taskcalc' : 'quickcopy')));
    if (!['workhours', 'quickcopy', 'taskcalc', 'budgetcalc'].includes(activeTool)) activeTool = 'quickcopy';
    if (activeTool === 'workhours' && !canUseCalendarApi()) activeTool = (looksLikeBudgetTaskPage() || isDailyLogDetailPage()) ? 'budgetcalc' : (looksLikeDesignTaskPage() ? 'taskcalc' : 'quickcopy');
    panelHeight = normalizePanelHeight(result[PANEL_HEIGHT_STORAGE_KEY]);

    createPanel();
    setPanelOpen(result[PANEL_OPEN_STORAGE_KEY] !== false);
    trackEditableFocus();
    bindTopFrameMessages();
    bindExtensionMessages();
    bindStorageChanges();
    updateCurrentMonthReport();
    renderSavedReports();
    renderQuickCopyList();
    renderTaskCalculator();
    refreshBudgetCalculator();
    scheduleDesignTaskScan(900);
    setTimeout(() => scanDesignTasks(), 2600);
    setTimeout(() => scanDesignTasks(), 5200);
    observeYearMonthChange();
    observeCalendarContentChange();
    observeBudgetContentChange();
    observeBudgetFrameLoads();
    bindDailyLogTaskClickRefresh();

    console.log(`[${PRODUCT_NAME}] ${PRODUCT_VERSION} 初始化完成`);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
