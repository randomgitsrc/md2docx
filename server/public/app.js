/* md2docx Web 页面逻辑 */
'use strict';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ---------- 状态 ----------
let currentJobId = null;
let pollTimer = null;
let pollIntervalMs = 1000;

// ---------- DOM 引用 ----------
const el = {
  dropzone: $('#dropzone'),
  fileInput: $('#file-input'),
  fieldTitle: $('#field-title'),
  fieldCompany: $('#field-company'),
  fieldDate: $('#field-date'),
  btnSubmit: $('#btn-submit'),
  uploadCard: $('#upload-card'),
  progressCard: $('#progress-card'),
  progressFilename: $('#progress-filename'),
  statusChip: $('#status-chip'),
  progressFill: $('#progress-fill'),
  progressPercent: $('#progress-percent'),
  progressMessage: $('#progress-message'),
  btnDownload: $('#btn-download'),
  btnClean: $('#btn-clean'),
  btnDelete: $('#btn-delete'),
  warnings: $('#warnings'),
  logs: $('#logs'),
  jobsBody: $('#jobs-body'),
  depsBadges: $('#deps-badges'),
};

let selectedFile = null;

// ---------- 文件选择 ----------
function setSelected(file) {
  if (!file) {
    selectedFile = null;
    el.btnSubmit.disabled = true;
    return;
  }
  if (!/\.md$/i.test(file.name)) {
    alert('仅支持 .md 文件');
    selectedFile = null;
    el.btnSubmit.disabled = true;
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    alert('文件超过 20MB 上限');
    selectedFile = null;
    el.btnSubmit.disabled = true;
    return;
  }
  selectedFile = file;
  el.btnSubmit.disabled = false;
  el.progressFilename.textContent = file.name;
}

el.dropzone.addEventListener('click', () => el.fileInput.click());
el.fileInput.addEventListener('change', () => setSelected(el.fileInput.files[0]));
el.dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  el.dropzone.classList.add('dragover');
});
el.dropzone.addEventListener('dragleave', () => el.dropzone.classList.remove('dragover'));
el.dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  el.dropzone.classList.remove('dragover');
  setSelected(e.dataTransfer.files[0]);
});

// ---------- 提交 ----------
el.btnSubmit.addEventListener('click', async () => {
  if (!selectedFile) return;
  const fd = new FormData();
  fd.append('file', selectedFile);
  if (el.fieldTitle.value.trim()) fd.append('title', el.fieldTitle.value.trim());
  if (el.fieldCompany.value.trim()) fd.append('company', el.fieldCompany.value.trim());
  if (el.fieldDate.value.trim()) fd.append('date', el.fieldDate.value.trim());

  el.btnSubmit.disabled = true;
  try {
    const res = await fetch('/api/convert', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `提交失败 (${res.status})`);
    currentJobId = data.jobId;
    showProgressCard();
    startPolling(currentJobId);
  } catch (err) {
    alert('提交失败：' + err.message);
    el.btnSubmit.disabled = false;
  }
});

// ---------- 进度卡 ----------
function showProgressCard() {
  el.uploadCard.hidden = true;
  el.progressCard.hidden = false;
  el.progressFill.style.width = '0%';
  el.progressPercent.textContent = '0%';
  el.progressMessage.textContent = '等待队列…';
  el.statusChip.textContent = '排队中';
  el.statusChip.className = 'status-chip queued';
  el.btnDownload.hidden = true;
  el.btnClean.hidden = true;
  el.btnDelete.hidden = true;
  el.warnings.hidden = true;
  el.warnings.innerHTML = '';
  el.logs.textContent = '';
}

// ---------- 轮询（L2：带退避） ----------
function startPolling(jobId) {
  clearTimeout(pollTimer);
  let lastProgress = -1;
  let stalled = 0;

  const tick = async () => {
    if (currentJobId !== jobId) return;
    try {
      const res = await fetch(`/api/jobs/${jobId}`);
      const job = await res.json();
      if (res.status === 404) {
        setStatus('failed', '作业不存在或已过期');
        return;
      }
      renderJob(job);
      if (job.status === 'done' || job.status === 'failed') return;

      // 退避：进度停滞则拉长间隔
      if (job.progress === lastProgress) {
        stalled++;
        pollIntervalMs = stalled >= 3 ? 3000 : 2000;
      } else {
        stalled = 0;
        pollIntervalMs = 1000;
      }
      lastProgress = job.progress;
      pollTimer = setTimeout(tick, pollIntervalMs);
    } catch (err) {
      pollTimer = setTimeout(tick, 3000); // 网络错误也退避重试
    }
  };
  tick();
}

function setStatus(status, label) {
  el.statusChip.textContent = label;
  el.statusChip.className = `status-chip ${status}`;
}

function renderJob(job) {
  // 状态
  const statusLabel = { queued: '排队中', running: '转换中', done: '完成', failed: '失败' }[job.status] || job.status;
  setStatus(job.status, statusLabel);

  // 进度
  const pct = job.progress || 0;
  el.progressFill.style.width = pct + '%';
  el.progressPercent.textContent = pct + '%';
  const lastMsg = job.logs?.slice(-1)[0] || '';
  el.progressMessage.textContent = lastMsg;

  // 日志
  if (job.logs) el.logs.textContent = job.logs.join('\n');
  el.logs.scrollTop = el.logs.scrollHeight;

  // 警告
  if (job.warnings && job.warnings.length) {
    el.warnings.hidden = false;
    el.warnings.innerHTML = '<strong>警告：</strong><ul>' +
      job.warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('') + '</ul>';
  }

  // 完成
  if (job.status === 'done') {
    clearTimeout(pollTimer);
    el.progressFill.style.width = '100%';
    el.progressPercent.textContent = '100%';
    if (job.hasArtifact) {
      el.btnDownload.hidden = false;
      el.btnDownload.href = `/api/jobs/${job.id}/download`;
    }
    el.btnClean.hidden = false;
    el.btnClean.href = `/api/jobs/${job.id}/clean`;
    el.btnDelete.hidden = false;
  }
  if (job.status === 'failed') {
    clearTimeout(pollTimer);
    el.btnDelete.hidden = false;
    if (job.error) {
      el.warnings.hidden = false;
      el.warnings.innerHTML = `<strong>错误：</strong>${escapeHtml(job.error)}`;
      el.warnings.style.background = '#fef2f2';
      el.warnings.style.borderColor = '#fecaca';
    }
  }

  refreshJobsList();
}

// ---------- 删除 ----------
el.btnDelete.addEventListener('click', async () => {
  if (!currentJobId) return;
  if (!confirm('确定删除该作业（含产物）？')) return;
  await fetch(`/api/jobs/${currentJobId}`, { method: 'DELETE' });
  currentJobId = null;
  el.progressCard.hidden = true;
  el.uploadCard.hidden = false;
  el.btnSubmit.disabled = false;
  refreshJobsList();
});

// ---------- 作业列表 ----------
async function refreshJobsList() {
  try {
    const res = await fetch('/api/jobs?limit=10');
    const data = await res.json();
    if (!data.jobs?.length) {
      el.jobsBody.innerHTML = '<tr><td colspan="6" class="muted">暂无作业</td></tr>';
      return;
    }
    el.jobsBody.innerHTML = data.jobs.map(j => {
      const statusLabel = { queued: '排队中', running: '转换中', done: '完成', failed: '失败' }[j.status] || j.status;
      const time = new Date(j.createdAt).toLocaleTimeString();
      const ops = j.status === 'done' && j.hasArtifact
        ? `<a href="/api/jobs/${j.id}/download">下载</a>`
        : `<span class="muted">—</span>`;
      return `<tr>
        <td><code>${j.id.slice(0, 8)}</code></td>
        <td>${escapeHtml(j.originalName)}</td>
        <td class="job-status ${j.status}">${statusLabel}</td>
        <td>${j.progress}%</td>
        <td>${time}</td>
        <td class="job-actions">${ops}</td>
      </tr>`;
    }).join('');
  } catch (_) { /* 列表刷新失败不阻塞主流程 */ }
}

// ---------- 依赖健康徽标 ----------
async function refreshHealth() {
  try {
    const res = await fetch('/api/health');
    const d = await res.json();
    for (const key of ['node', 'chrome', 'java', 'graphviz', 'python', 'pythonDocx']) {
      const badge = $(`#dep-${key}`);
      const dep = d.deps?.[key];
      const nameMap = { node: 'Node', chrome: 'Chrome', java: 'Java', graphviz: 'Graphviz', python: 'Python', pythonDocx: 'python-docx' };
      if (badge) {
        if (dep?.ok) {
          badge.textContent = `${nameMap[key]} ✓`;
          badge.className = 'dep ok';
        } else {
          badge.textContent = `${nameMap[key]} ✗`;
          badge.className = 'dep fail';
        }
      }
    }
  } catch (_) { /* 健康检查失败不阻塞 */ }
}

// ---------- 工具 ----------
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------- 初始化 ----------
refreshHealth();             // 立即拉一次
setInterval(refreshHealth, 30000); // 低频刷新（M5）
refreshJobsList();
