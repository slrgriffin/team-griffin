// ─────────────────────────────────────────────────────────────────
// Team Griffin · Morning Reminder + Checklist Write-back
//
// Reads schedule.json from GitHub (public, no auth needed for reads).
// Writes (checkbox actions from the newsletter page) use a GitHub
// token stored in Script Properties — it never touches the browser.
//
// Schema:
//   dailyReminders:  [{ id, label }, ...]
//   taskCompletions: { "<date>": { "<taskId>": true, ... } }  — sparse,
//                     a key only exists when that task is done that day.
//   weeklyNotes:     { "<week>": [{ text, completed }, ...] } — items are
//                     marked completed, never deleted.
//
// ONE-TIME SETUP:
//   Project Settings (gear icon, left sidebar) → Script Properties
//   → Add script property → name: GITHUB_PAT → value: (your token)
//
// Deploy: Deploy → Manage deployments → ✏️ → New version → Deploy
// (keeps the existing Web App URL — do not create a new deployment)
// ─────────────────────────────────────────────────────────────────

var OWNER = 'slrgriffin';
var REPO = 'team-griffin';
var FILE_PATH = 'schedule.json';
var RAW_JSON_URL = 'https://raw.githubusercontent.com/' + OWNER + '/' + REPO + '/main/' + FILE_PATH;
var PAGE_URL = 'https://slrgriffin.github.io/team-griffin/';

function doGet(e) {
  var params = e.parameter || {};
  if (params.mode === 'ping') return jsonOutput({ ok: true, deployedAt: new Date().toISOString() });
  if (params.mode === 'toggleTask') return toggleTask(params);
  if (params.mode === 'completeAction') return completeAction(params);
  if (params.mode === 'editActivity') return editActivity(params);
  if (params.mode === 'addSchoolItem') return addSchoolItem(params);
  if (params.mode === 'editSchoolItem') return editSchoolItem(params);
  if (params.mode === 'deleteSchoolItem') return deleteSchoolItem(params);
  return getMorningReminder();
}

// ── MORNING REMINDER ──────────────────────────────────────────────
function getMorningReminder() {
  var data;
  try {
    var resp = UrlFetchApp.fetch(RAW_JSON_URL + '?t=' + new Date().getTime(), { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) {
      return textOutput('☀️ Could not load schedule (HTTP ' + resp.getResponseCode() + ').');
    }
    data = JSON.parse(resp.getContentText());
  } catch (err) {
    return textOutput('☀️ Could not load schedule (' + err.message + ').');
  }

  var tz = Session.getScriptTimeZone();
  var now = new Date();
  var todayStr = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var dayName  = Utilities.formatDate(now, tz, 'EEEE');

  var dow = now.getDay();
  var diffToMonday = (dow === 0) ? 6 : dow - 1;
  var monday = new Date(now);
  monday.setDate(now.getDate() - diffToMonday);
  var mondayStr = Utilities.formatDate(monday, tz, 'yyyy-MM-dd');

  var lines = [];
  lines.push('☀️ Good morning! Today is ' + dayName + ', ' + Utilities.formatDate(now, tz, 'MMMM d') + '.');
  lines.push('');

  var override = (data.dateOverrides || {})[todayStr];

  if (override && override.vac) {
    lines.push(override.vac);
  } else {
    var day = override || (data.weeklyPattern || {})[dayName] || {};
    appendSection(lines, 'Nollen', day.n);
    appendSection(lines, 'Austin', day.a);
    appendSection(lines, 'Family', day.f);
    if (lines[lines.length - 1] === '') lines.pop();
  }

  // Only surface NOT-YET-completed action items in the morning text —
  // completed ones stay in the data for the record but don't need repeating.
  var allNotes = (data.weeklyNotes || {})[mondayStr] || [];
  var pendingNotes = [];
  for (var n = 0; n < allNotes.length; n++) {
    if (!allNotes[n].completed) pendingNotes.push(allNotes[n].text);
  }
  if (pendingNotes.length) {
    lines.push('');
    lines.push('📌 Action items this week:');
    for (var i = 0; i < pendingNotes.length; i++) lines.push('• ' + pendingNotes[i]);
  }

  var reminders = data.dailyReminders || [];
  if (reminders.length) {
    lines.push('');
    for (var j = 0; j < reminders.length; j++) lines.push('• ' + reminders[j].label);
  }

  lines.push('');
  lines.push('📱 ' + PAGE_URL);

  return textOutput(lines.join('\n'));
}

function appendSection(lines, label, items) {
  if (!items || !items.length) return;
  lines.push(label + ':');
  for (var i = 0; i < items.length; i++) lines.push('  • ' + items[i]);
}

function textOutput(text) {
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.TEXT);
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ── GITHUB READ/WRITE HELPERS ────────────────────────────────────
function ghToken() {
  var t = PropertiesService.getScriptProperties().getProperty('GITHUB_PAT');
  if (!t) throw new Error('GITHUB_PAT not set in Script Properties');
  return t;
}

function ghGetFile() {
  var url = 'https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + FILE_PATH + '?ref=main';
  var resp = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ghToken(), Accept: 'application/vnd.github+json' },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) throw new Error('GitHub read failed: ' + resp.getResponseCode());
  var json = JSON.parse(resp.getContentText());
  var content = Utilities.newBlob(Utilities.base64Decode(json.content.replace(/\n/g, ''))).getDataAsString('UTF-8');
  return { data: JSON.parse(content), sha: json.sha };
}

function ghPutFile(dataObj, sha, message) {
  var url = 'https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + FILE_PATH;
  var contentStr = JSON.stringify(dataObj, null, 2);
  var b64 = Utilities.base64Encode(contentStr, Utilities.Charset.UTF_8);
  var payload = { message: message, content: b64, sha: sha, branch: 'main' };
  var resp = UrlFetchApp.fetch(url, {
    method: 'put',
    headers: { Authorization: 'Bearer ' + ghToken(), Accept: 'application/vnd.github+json' },
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  return resp.getResponseCode();
}

// Read-modify-write with one retry if the file changed underneath us (409).
function ghUpdate(mutateFn, message) {
  for (var attempt = 0; attempt < 2; attempt++) {
    var current = ghGetFile();
    mutateFn(current.data);
    var code = ghPutFile(current.data, current.sha, message);
    if (code === 200 || code === 201) return true;
    if (code !== 409) throw new Error('GitHub write failed: ' + code);
    Utilities.sleep(400);
  }
  return false;
}

// ── TOGGLE A DAILY TASK (by stable id, e.g. "exercises") FOR ONE DATE ────
// Sparse: a key only exists in taskCompletions[date] when that task is done.
function toggleTask(params) {
  var date = params.date;
  var taskId = params.taskId;
  if (!date || !taskId) return jsonOutput({ success: false, message: 'Missing date/taskId' });

  try {
    var ok = ghUpdate(function (data) {
      data.taskCompletions = data.taskCompletions || {};
      var forDate = data.taskCompletions[date] || {};
      if (forDate[taskId]) {
        delete forDate[taskId];
      } else {
        forDate[taskId] = true;
      }
      if (Object.keys(forDate).length) {
        data.taskCompletions[date] = forDate;
      } else {
        delete data.taskCompletions[date];
      }
    }, 'Toggle ' + taskId + ' for ' + date);
    return jsonOutput({ success: ok });
  } catch (err) {
    return jsonOutput({ success: false, message: err.message });
  }
}

// ── MARK AN ACTION ITEM COMPLETE FOR ONE WEEK (kept in data, not deleted) ─
// ── MARK AN ACTION ITEM COMPLETE FOR ONE WEEK (kept in data, not deleted) ─
// ── EDIT AN ACTIVITY OPTION'S FIELDS (from the timetable modal) ──────────
// If the edited item is someone's "preferred" (currently selected) pick,
// this automatically rewrites the matching string in weeklyPattern AND in
// every dateOverride that falls on this weekday — so the morning text and
// newsletter both pick up the change immediately, no manual reconcile step.
function editActivity(params) {
  var day = params.day;
  var index = Number(params.index);
  if (!day || isNaN(index)) return jsonOutput({ success: false, message: 'Missing day/index' });

  try {
    var ok = ghUpdate(function (data) {
      data.activityOptions = data.activityOptions || {};
      var list = data.activityOptions[day] || [];
      if (index < 0 || index >= list.length) throw new Error('Index out of range for ' + day);
      var item = list[index];
      var oldItem = { name: item.name, child: item.child, start: item.start, end: item.end, location: item.location };

      if (params.name) item.name = params.name;
      if (params.child) item.child = params.child;
      if (params.start) item.start = params.start;
      if (params.end) item.end = params.end;
      if (params.type) item.type = params.type;
      list[index] = item;
      data.activityOptions[day] = list;

      if (item.preferred) syncPatternForActivity(data, day, oldItem, item);
    }, 'Edit activity ' + index + ' on ' + day + ' via modal');
    return jsonOutput({ success: ok });
  } catch (err) {
    return jsonOutput({ success: false, message: err.message });
  }
}

// ── KEEP weeklyPattern / dateOverrides IN SYNC WITH PREFERRED ACTIVITY EDITS
function pad2(n) { return (n < 10 ? '0' : '') + n; }

function to12Hour(hhmm) {
  var parts = hhmm.split(':');
  var h = parseInt(parts[0], 10), m = parseInt(parts[1], 10);
  var ampm = h >= 12 ? 'pm' : 'am';
  var h12 = h % 12; if (h12 === 0) h12 = 12;
  return { h: h12, m: m, ampm: ampm };
}

function formatActivityString(item) {
  var s = to12Hour(item.start), e = to12Hour(item.end);
  var timeStr = (s.ampm === e.ampm)
    ? (s.h + ':' + pad2(s.m) + '\u2013' + e.h + ':' + pad2(e.m) + ' ' + e.ampm)
    : (s.h + ':' + pad2(s.m) + ' ' + s.ampm + '\u2013' + e.h + ':' + pad2(e.m) + ' ' + e.ampm);
  return item.name + ' \u00b7 ' + timeStr + (item.location ? ' @ ' + item.location : '');
}

function childKeys(child) {
  if (child === 'Both') return ['n', 'a'];
  return (child === 'Nollen') ? ['n'] : ['a'];
}

var WEEKDAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function syncPatternForActivity(data, day, oldItem, newItem) {
  var oldStr = formatActivityString(oldItem);
  var newStr = formatActivityString(newItem);
  var oldKeys = childKeys(oldItem.child);
  var newKeys = childKeys(newItem.child);

  data.weeklyPattern[day] = data.weeklyPattern[day] || { n: [], a: [], f: [] };
  oldKeys.forEach(function (k) {
    data.weeklyPattern[day][k] = (data.weeklyPattern[day][k] || []).filter(function (s) { return s !== oldStr; });
  });
  newKeys.forEach(function (k) {
    var arr = data.weeklyPattern[day][k] || [];
    if (arr.indexOf(newStr) === -1) arr.push(newStr);
    data.weeklyPattern[day][k] = arr;
  });

  var dayIndex = WEEKDAY_NAMES.indexOf(day);
  Object.keys(data.dateOverrides || {}).forEach(function (dateStr) {
    var entry = data.dateOverrides[dateStr];
    if (entry.vac) return;
    var parts = dateStr.split('-').map(Number);
    var d = new Date(parts[0], parts[1] - 1, parts[2]);
    if (d.getDay() !== dayIndex) return;

    oldKeys.forEach(function (k) {
      entry[k] = (entry[k] || []).filter(function (s) { return s !== oldStr; });
    });
    newKeys.forEach(function (k) {
      entry[k] = entry[k] || [];
      if (entry[k].indexOf(newStr) === -1) entry[k].push(newStr);
    });
  });
}

function completeAction(params) {
  var week = params.week;
  var index = Number(params.index);
  if (!week || isNaN(index)) return jsonOutput({ success: false, message: 'Missing week/index' });

  try {
    var ok = ghUpdate(function (data) {
      data.weeklyNotes = data.weeklyNotes || {};
      var list = data.weeklyNotes[week] || [];
      if (index >= 0 && index < list.length) list[index].completed = true;
      data.weeklyNotes[week] = list;
    }, 'Mark action item ' + index + ' complete for week ' + week);
    return jsonOutput({ success: ok });
  } catch (err) {
    return jsonOutput({ success: false, message: err.message });
  }
}

// ── SCHOOL TAB: ASSIGNMENTS / PROJECTS / EVENTS ──────────────────────────
// schoolItems is a flat array of { id, title, child, type, date, notes, completed }.
// Unlike activityOptions (keyed by weekday + index), items here are addressed
// by their own stable id, since the list grows/shrinks freely from the modal.
function addSchoolItem(params) {
  var id = params.id, title = params.title, child = params.child;
  var type = params.type, date = params.date;
  if (!id || !title || !child || !type || !date) {
    return jsonOutput({ success: false, message: 'Missing id/title/child/type/date' });
  }

  try {
    var ok = ghUpdate(function (data) {
      data.schoolItems = data.schoolItems || [];
      var newItem = {
        id: id,
        title: title,
        child: child,
        type: type,
        date: date,
        notes: params.notes || '',
        completed: params.completed === 'true'
      };
      if (params.docId) {
        newItem.docRef = { id: params.docId, summaryShort: params.docSummary || '', driveUrl: params.docUrl || '' };
      }
      data.schoolItems.push(newItem);
    }, 'Add school item: ' + title);
    return jsonOutput({ success: ok });
  } catch (err) {
    return jsonOutput({ success: false, message: err.message });
  }
}

function editSchoolItem(params) {
  var id = params.id;
  if (!id) return jsonOutput({ success: false, message: 'Missing id' });

  try {
    var found = false;
    var ok = ghUpdate(function (data) {
      data.schoolItems = data.schoolItems || [];
      for (var i = 0; i < data.schoolItems.length; i++) {
        if (data.schoolItems[i].id === id) {
          found = true;
          if (params.title) data.schoolItems[i].title = params.title;
          if (params.child) data.schoolItems[i].child = params.child;
          if (params.type) data.schoolItems[i].type = params.type;
          if (params.date) data.schoolItems[i].date = params.date;
          if (params.notes !== undefined) data.schoolItems[i].notes = params.notes;
          if (params.completed !== undefined) data.schoolItems[i].completed = params.completed === 'true';
          if (params.docId !== undefined) {
            if (params.docId) {
              data.schoolItems[i].docRef = { id: params.docId, summaryShort: params.docSummary || '', driveUrl: params.docUrl || '' };
            } else {
              delete data.schoolItems[i].docRef;
            }
          }
          break;
        }
      }
      if (!found) throw new Error('School item not found: ' + id);
    }, 'Edit school item ' + id);
    return jsonOutput({ success: ok });
  } catch (err) {
    return jsonOutput({ success: false, message: err.message });
  }
}

function deleteSchoolItem(params) {
  var id = params.id;
  if (!id) return jsonOutput({ success: false, message: 'Missing id' });

  try {
    var ok = ghUpdate(function (data) {
      data.schoolItems = data.schoolItems || [];
      data.schoolItems = data.schoolItems.filter(function (item) { return item.id !== id; });
    }, 'Delete school item ' + id);
    return jsonOutput({ success: ok });
  } catch (err) {
    return jsonOutput({ success: false, message: err.message });
  }
}
