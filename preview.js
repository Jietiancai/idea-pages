(function () {
  'use strict';

  const year = 2026;
  const month = 7;
  const yearMonth = '2026-07';
  const sampleUrl = new URL('ProjectManage/ProjectMission/Record_Detail.aspx?RowGuid=preview', location.href);
  const stamp = new Date('2026-07-31T09:00:00+08:00').getTime();
  const days = Array.from({ length: 31 }, (_, index) => {
    const day = index + 1;
    const weekday = new Date(year, month - 1, day).getDay();
    const isWeekend = weekday === 0 || weekday === 6;
    const hours = !isWeekend && day < 29 ? 8 : 0;
    return {
      date: `${yearMonth}-${String(day).padStart(2, '0')}`,
      day,
      dayOfWeek: weekday,
      weekday: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][weekday],
      workHourValue: hours,
      workHours: `${hours}h`,
      standardHours: isWeekend ? 0 : 8,
      isWeekend,
      isStandardWorkday: !isWeekend,
      isActualFilled: hours > 0,
      statusType: isWeekend ? 'weekend' : (hours ? 'filled' : 'missing'),
      statusLabel: isWeekend ? '周末休息' : (hours ? '已填工时' : '未填'),
      hasHoliday: false,
      hasMakeupWork: false,
      hasLeave: false
    };
  });
  const report = {
    year, month, yearMonth, days, totalDays: 31,
    standardWorkDays: 23, actualFilledDays: 20, missingWorkDays: 3,
    leaveDays: 0, holidayDays: 0, makeupDays: 0, weekendRestDays: 8,
    standardTotalHours: 184, actualTotalHours: 160, hourDiff: -24,
    savedAt: stamp
  };
  const workdays = days.filter(day => day.workHourValue > 0);
  const taskLogs = items => items.map(day => ({ date: day.date, hours: 8, content: '页面设计与调整' }));
  const budget = (id, taskName, totalAmount, items) => ({
    id, recordKey: `preview-${id}`, projectName: '示例项目', taskName,
    yearMonth, totalAmount, originalTotalAmount: totalAmount,
    taskLogs: taskLogs(items), sourceUrl: `${sampleUrl.href}&sample=${id}`, savedAt: stamp
  });
  const storage = {
    epoint_active_tool: 'workhours',
    epoint_panel_open: true,
    epoint_panel_width: 720,
    epoint_panel_height: 560,
    epoint_quick_copy_default_group: '默认分组',
    epoint_quick_copy_snippets: [
      { id: 'copy-1', group: '默认分组', content: '今日已完成相关功能调整，请确认。', createdAt: stamp, updatedAt: stamp },
      { id: 'copy-2', group: '项目沟通', content: '需求已收到，预计本周完成页面设计与联调。', createdAt: stamp, updatedAt: stamp }
    ],
    epoint_saved_month_reports: [report],
    epoint_month_log_cache: [report],
    epoint_budget_log_report: [report],
    epoint_budget_log_active_month: yearMonth,
    epoint_task_calculator_items: [{
      id: 'task-1', name: '项目表单交互优化', designer: '示例设计师',
      estimateHours: 12, filledHours: 6, sourceUrl: location.href,
      savedAt: stamp, updatedAt: stamp
    }],
    epoint_budget_calculator_items: [
      budget('budget-1', '项目表单交互优化', 12800, workdays.slice(0, 8)),
      budget('budget-2', '组件样式整理', 5800, workdays.slice(8, 16))
    ]
  };

  document.getElementById('preview-data').innerHTML = `
    <span id="year">${year}</span><span id="month">${month}</span>
    <ul id="calendar">${days.map(day => `
      <li class="wd-day-item" data-date="${day.date}">
        <div class="wd-day-block" data-date="${day.date}">
          <div class="container"><span>${day.workHourValue ? '已填写' : ''}</span></div>
          <div class="container"><span>${day.workHourValue}h</span></div>
        </div>
      </li>`).join('')}
    </ul>
    <table id="tableInfo">
      <tr><td>项目名称：</td><td>示例项目</td></tr>
      <tr><td>任务名称：</td><td>移动端页面适配</td></tr>
      <tr><td>总额：</td><td>12,800.00</td></tr>
    </table>
    <table><tr><th>填写时间</th><th>工时</th><th>日志内容</th></tr>
      ${workdays.slice(16, 20).map(day => `<tr><td>${day.date}</td><td>8</td><td>页面设计与调整</td></tr>`).join('')}
    </table>
    <section><h2>设计任务列表</h2><table>
      <tr><th>任务名称</th><th>设计师</th><th>预计工时</th></tr>
      <tr><td>项目表单交互优化</td><td>示例设计师</td><td>12</td></tr>
      <tr><td>移动端页面适配</td><td>示例设计师</td><td>16</td></tr>
    </table></section>`;

  const listeners = new Set();
  const chromePreview = {
    runtime: { onMessage: { addListener() {} }, lastError: null },
    storage: {
      local: {
        get(keys, callback) {
          callback(Object.fromEntries(keys.filter(key => key in storage).map(key => [key, structuredClone(storage[key])])));
        },
        set(values, callback) {
          const changes = {};
          for (const [key, value] of Object.entries(values)) {
            if (JSON.stringify(value) === JSON.stringify(storage[key])) continue;
            changes[key] = { oldValue: structuredClone(storage[key]), newValue: structuredClone(value) };
            storage[key] = structuredClone(value);
          }
          queueMicrotask(() => {
            if (Object.keys(changes).length) listeners.forEach(listener => listener(changes, 'local'));
            callback?.();
          });
        }
      },
      onChanged: { addListener(listener) { listeners.add(listener); } }
    }
  };

  // The extension runs inside the website iframe with isolated example data.
  let previewWindow;
  previewWindow = new Proxy(window, {
    get(target, key) {
      if (key === 'top') return previewWindow;
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' && !String(key).startsWith('__') ? value.bind(target) : value;
    }
  });
  window.__pluginPreview = { window: previewWindow, chrome: chromePreview, location: sampleUrl };
})();
