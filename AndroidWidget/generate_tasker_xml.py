import os
import xml.etree.ElementTree as ET
from xml.dom import minidom

def create_tasker_project():
    project_name = "ObsidianTimeblocker"
    
    # Root element
    root = ET.Element("TaskerData", sr="lib", version="5.15.14")
    
    # Project node
    proj = ET.SubElement(root, "Project", sr="proj0", ve="2")
    ET.SubElement(proj, "cdate").text = "1622393307777"
    ET.SubElement(proj, "name").text = project_name
    
    task_names = [
        "Timeblocker_Init",
        "Timeblocker_Parse",
        "Timeblocker_Start",
        "Timeblocker_Pause",
        "Timeblocker_Resume",
        "Timeblocker_Complete",
        "Timeblocker_SyncTask",
        "Timeblocker_NotToday",
        "Timeblocker_Postpone",
        "Timeblocker_TimerWatcher",
        "Timeblocker_Alarm"
    ]
    ET.SubElement(proj, "tasks").text = ",".join(task_names)
    
    # --- Task 1: Timeblocker_Init ---
    t1 = ET.SubElement(root, "Task", sr="task1")
    ET.SubElement(t1, "cdate").text = "1622393307778"
    ET.SubElement(t1, "edate").text = "1622393307778"
    ET.SubElement(t1, "id").text = "1"
    ET.SubElement(t1, "nme").text = "Timeblocker_Init"
    
    # Action 0: Set default vault path if not set
    act1_0 = ET.SubElement(t1, "Action", sr="act0", ve="7")
    ET.SubElement(act1_0, "code").text = "547" # Variable Set
    ET.SubElement(act1_0, "Str", sr="arg0", ve="3").text = "%ObsidianVaultPath"
    ET.SubElement(act1_0, "Str", sr="arg1", ve="3").text = "/sdcard/Documents/Obsidian"
    ET.SubElement(act1_0, "Int", sr="arg2", val="0") # Do Maths: No
    ET.SubElement(act1_0, "Int", sr="arg3", val="0") # Append: No
    ET.SubElement(act1_0, "Int", sr="arg4", val="1") # If Condition: Yes (only set if not set)
    ET.SubElement(act1_0, "Int", sr="arg5", val="0")
    # Condition: %ObsidianVaultPath is not set
    cond1_0 = ET.SubElement(act1_0, "ConditionList", sr="cond")
    ET.SubElement(cond1_0, "Condition", sr="c0", ve="3")
    ET.SubElement(cond1_0, "lhs").text = "%ObsidianVaultPath"
    ET.SubElement(cond1_0, "op").text = "12" # Isn't Set
    ET.SubElement(cond1_0, "rhs").text = ""
    
    # Action 1: Perform task Parse
    act1_1 = ET.SubElement(t1, "Action", sr="act1", ve="7")
    ET.SubElement(act1_1, "code").text = "130" # Perform Task
    ET.SubElement(act1_1, "Str", sr="arg0", ve="3").text = "Timeblocker_Parse"
    ET.SubElement(act1_1, "Int", sr="arg1", val="100") # Priority
    
    # --- Task 2: Timeblocker_Parse ---
    t2 = ET.SubElement(root, "Task", sr="task2")
    ET.SubElement(t2, "cdate").text = "1622393307779"
    ET.SubElement(t2, "edate").text = "1622393307779"
    ET.SubElement(t2, "id").text = "2"
    ET.SubElement(t2, "nme").text = "Timeblocker_Parse"
    
    # Action 0: Javascriptlet for note parsing
    act2_0 = ET.SubElement(t2, "Action", sr="act0", ve="7")
    ET.SubElement(act2_0, "code").text = "129" # Javascriptlet
    
    parse_js = """var vault = global('ObsidianVaultPath');
if (!vault) {
    vault = "/sdcard/Documents/Obsidian";
    setGlobal('ObsidianVaultPath', vault);
}

var now = new Date();
var yyyy = now.getFullYear();
var mm = String(now.getMonth() + 1).padStart(2, '0');
var dd = String(now.getDate()).padStart(2, '0');
var today = yyyy + '-' + mm + '-' + dd;
var filePath = vault + '/02_Journal/01_Daily/' + today + '.md';

var file_contents = "";
try {
    file_contents = readFile(filePath);
} catch (e) {
    // File doesn't exist yet
}

if (!file_contents) {
    setGlobal('TbCurrentTask', "No daily note");
    setGlobal('TbCurrentTime', "");
    setGlobal('TbCurrentDuration', "0");
    setGlobal('TbCurrentStatus', "none");
    setGlobal('TbCurrentSrc', "");
    setGlobal('TbNextTask', "None");
    setGlobal('TbNextTime', "");
    setGlobal('TbScheduleSummary', "Please sync or create today's note.");
} else {
    var lines = file_contents.split('\\n');
    var inPlanner = false;
    var tasks = [];

    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (line.indexOf("## 📅Day Planner") !== -1) {
            inPlanner = true;
            continue;
        }
        if (inPlanner && line.indexOf("## ") === 0) {
            break;
        }
        if (inPlanner) {
            var trimmed = line.trim();
            if (trimmed.indexOf("- [ ]") === 0 || trimmed.indexOf("- [x]") === 0 || trimmed.indexOf("- [/]") === 0) {
                tasks.push(trimmed);
            }
        }
    }

    var currentMinutes = now.getHours() * 60 + now.getMinutes();

    var currentTaskName = "No active task";
    var currentTaskTime = "";
    var currentTaskDuration = 20; // default
    var currentTaskStatus = "none";
    var currentTaskSrc = "";
    var nextTaskName = "None";
    var nextTaskTime = "";
    var scheduleSummary = "";

    var parsedTasks = [];

    for (var j = 0; j < tasks.length; j++) {
        var t = tasks[j];
        var status = t.substring(3, 4) === 'x' ? 'completed' : (t.substring(3, 4) === '/' ? 'in-progress' : 'open');
        var rest = t.substring(6).trim();
        
        var timeMatch = rest.match(/^(\\d{1,2}):(\\d{2})\\s*-\\s*(\\d{1,2}):(\\d{2})\\s*(.*)$/);
        if (timeMatch) {
            var startHour = parseInt(timeMatch[1], 10);
            var startMin = parseInt(timeMatch[2], 10);
            var endHour = parseInt(timeMatch[3], 10);
            var endMin = parseInt(timeMatch[4], 10);
            var taskContent = timeMatch[5].trim();
            
            var startTotal = startHour * 60 + startMin;
            var endTotal = endHour * 60 + endMin;
            
            var timerMatch = taskContent.match(/`?BUTTON\\[timer-(\\d+)\\]`?/);
            var duration = timerMatch ? parseInt(timerMatch[1], 10) : (endTotal - startTotal);
            
            var cleanDesc = taskContent.replace(/`?BUTTON\\[[^\\]]+\\]`?/g, '').trim();
            var srcMatch = cleanDesc.match(/\\[src\\]\\(([^\\)]+)\\)/);
            var srcUrl = srcMatch ? srcMatch[1] : "";
            if (srcUrl) {
                cleanDesc = cleanDesc.replace(/\\[src\\]\\([^\\)]+\\)/g, '').trim();
            }
            
            cleanDesc = cleanDesc.replace(/\\[Google Tasks\\]/g, '').replace(/\\[Calendar\\]/g, '').replace(/#\\w+/g, '').replace(/\\s+/g, ' ').trim();
            
            var startStr = (startHour < 10 ? '0' + startHour : startHour) + ':' + (startMin < 10 ? '0' + startMin : startMin);
            var endStr = (endHour < 10 ? '0' + endHour : endHour) + ':' + (endMin < 10 ? '0' + endMin : endMin);
            
            var taskObj = {
                desc: cleanDesc,
                start: startTotal,
                end: endTotal,
                startStr: startStr,
                endStr: endStr,
                duration: duration,
                status: status,
                src: srcUrl,
                raw: t
            };
            parsedTasks.push(taskObj);
        }
    }

    var activeIndex = -1;
    for (var k = 0; k < parsedTasks.length; k++) {
        var pt = parsedTasks[k];
        if (currentMinutes >= pt.start && currentMinutes < pt.end) {
            activeIndex = k;
            break;
        }
    }

    var nextIndex = -1;
    if (activeIndex !== -1) {
        currentTaskName = parsedTasks[activeIndex].desc;
        currentTaskTime = parsedTasks[activeIndex].startStr + " - " + parsedTasks[activeIndex].endStr;
        currentTaskDuration = parsedTasks[activeIndex].duration;
        currentTaskStatus = parsedTasks[activeIndex].status;
        currentTaskSrc = parsedTasks[activeIndex].src;
        
        if (activeIndex + 1 < parsedTasks.length) {
            nextIndex = activeIndex + 1;
        }
    } else {
        for (var l = 0; l < parsedTasks.length; l++) {
            if (parsedTasks[l].start > currentMinutes) {
                nextIndex = l;
                break;
            }
        }
    }

    if (nextIndex !== -1) {
        nextTaskName = parsedTasks[nextIndex].desc;
        nextTaskTime = parsedTasks[nextIndex].startStr + " - " + parsedTasks[nextIndex].endStr;
    }

    var summaryLines = [];
    var startDisplayIndex = activeIndex !== -1 ? activeIndex : 0;
    for (var m = startDisplayIndex; m < Math.min(startDisplayIndex + 4, parsedTasks.length); m++) {
        var tItem = parsedTasks[m];
        var prefix = tItem.status === 'completed' ? '✓ ' : (m === activeIndex ? '▶ ' : '• ');
        summaryLines.push(prefix + tItem.startStr + ' ' + tItem.desc);
    }
    scheduleSummary = summaryLines.join('\\n') || "No upcoming tasks.";

    setGlobal('TbCurrentTask', currentTaskName);
    setGlobal('TbCurrentTime', currentTaskTime);
    setGlobal('TbCurrentDuration', String(currentTaskDuration));
    setGlobal('TbCurrentStatus', currentTaskStatus);
    setGlobal('TbCurrentSrc', currentTaskSrc);
    setGlobal('TbNextTask', nextTaskName);
    setGlobal('TbNextTime', nextTaskTime);
    setGlobal('TbScheduleSummary', scheduleSummary);
    setGlobal('TbAllTasksJson', JSON.stringify(parsedTasks));
}"""
    ET.SubElement(act2_0, "Str", sr="arg0", ve="3").text = parse_js
    ET.SubElement(act2_0, "Str", sr="arg1", ve="3").text = "" # libraries
    ET.SubElement(act2_0, "Int", sr="arg2", val="45") # timeout
    
    # --- Task 3: Timeblocker_Start ---
    t3 = ET.SubElement(root, "Task", sr="task3")
    ET.SubElement(t3, "cdate").text = "1622393307780"
    ET.SubElement(t3, "edate").text = "1622393307780"
    ET.SubElement(t3, "id").text = "3"
    ET.SubElement(t3, "nme").text = "Timeblocker_Start"
    
    # Action 0: Variable Set Active to 1
    act3_0 = ET.SubElement(t3, "Action", sr="act0", ve="7")
    ET.SubElement(act3_0, "code").text = "547"
    ET.SubElement(act3_0, "Str", sr="arg0", ve="3").text = "%TbTimerActive"
    ET.SubElement(act3_0, "Str", sr="arg1", ve="3").text = "1"
    
    # Action 1: Variable Set Duration Seconds
    act3_1 = ET.SubElement(t3, "Action", sr="act1", ve="7")
    ET.SubElement(act3_1, "code").text = "547"
    ET.SubElement(act3_1, "Str", sr="arg0", ve="3").text = "%TbTimerDurationSeconds"
    ET.SubElement(act3_1, "Str", sr="arg1", ve="3").text = "%TbCurrentDuration * 60"
    ET.SubElement(act3_1, "Int", sr="arg2", val="1") # Do Maths: Yes
    
    # Action 2: Get start epoch in JS
    act3_2 = ET.SubElement(t3, "Action", sr="act2", ve="7")
    ET.SubElement(act3_2, "code").text = "129"
    start_js = """var startEpoch = Math.floor(Date.now() / 1000);
setGlobal('TbTimerStartEpoch', String(startEpoch));"""
    ET.SubElement(act3_2, "Str", sr="arg0", ve="3").text = start_js
    
    # Action 3: JS to write focus log in Obsidian
    act3_3 = ET.SubElement(t3, "Action", sr="act3", ve="7")
    ET.SubElement(act3_3, "code").text = "129"
    log_start_js = """var vault = global('ObsidianVaultPath');
var taskName = global('TbCurrentTask');
if (taskName && taskName !== "No active task" && taskName !== "No daily note") {
    var now = new Date();
    var yyyy = now.getFullYear();
    var mm = String(now.getMonth() + 1).padStart(2, '0');
    var dd = String(now.getDate()).padStart(2, '0');
    var today = yyyy + '-' + mm + '-' + dd;
    var filePath = vault + '/02_Journal/01_Daily/' + today + '.md';
    
    var fileContent = "";
    try { fileContent = readFile(filePath); } catch(e) {}
    
    if (fileContent) {
        var lines = fileContent.split('\\n');
        var logHeaderIndex = -1;
        for (var i = 0; i < lines.length; i++) {
            if (lines[i].indexOf('## 🪵 Log') !== -1) {
                logHeaderIndex = i;
                break;
            }
        }
        
        var sh = String(now.getHours()).padStart(2, '0');
        var sm = String(now.getMinutes()).padStart(2, '0');
        var ss = String(now.getSeconds()).padStart(2, '0');
        var startTimeStr = sh + ':' + sm + ':' + ss;
        var logLine = '- [focus:: ' + taskName + '] [start-time:: ' + startTimeStr + '] [pause-start:: ] [pause-end:: ] [completed-time:: ]';
        
        if (logHeaderIndex !== -1) {
            var insertIndex = logHeaderIndex + 1;
            while (insertIndex < lines.length) {
                if (lines[insertIndex].indexOf('##') === 0 || lines[insertIndex].indexOf('# ') === 0) {
                    break;
                }
                insertIndex++;
            }
            lines.splice(insertIndex, 0, logLine);
        } else {
            lines.push('');
            lines.push('## 🪵 Log');
            lines.push(logLine);
        }
        writeFile(filePath, lines.join('\\n'), false);
    }
}"""
    ET.SubElement(act3_3, "Str", sr="arg0", ve="3").text = log_start_js
    
    # Action 4: Show Notification
    act3_4 = ET.SubElement(t3, "Action", sr="act4", ve="7")
    ET.SubElement(act3_4, "code").text = "525" # Notify
    ET.SubElement(act3_4, "Str", sr="arg0", ve="3").text = "Obsidian Task Timer" # Title
    ET.SubElement(act3_4, "Str", sr="arg1", ve="3").text = "Focusing on: %TbCurrentTask (%TbCurrentDuration min)" # Text
    ET.SubElement(act3_4, "Int", sr="arg2", val="0") # Icon
    
    # Action 5: Run Parse to update variables
    act3_5 = ET.SubElement(t3, "Action", sr="act5", ve="7")
    ET.SubElement(act3_5, "code").text = "130" # Perform Task
    ET.SubElement(act3_5, "Str", sr="arg0", ve="3").text = "Timeblocker_Parse"
    
    # Action 6: Start Timer Watcher in background
    act3_6 = ET.SubElement(t3, "Action", sr="act6", ve="7")
    ET.SubElement(act3_6, "code").text = "130" # Perform Task
    ET.SubElement(act3_6, "Str", sr="arg0", ve="3").text = "Timeblocker_TimerWatcher"
    ET.SubElement(act3_6, "Int", sr="arg1", val="99")
    ET.SubElement(act3_6, "Str", sr="arg2", ve="3").text = "%TbTimerDurationSeconds"
    ET.SubElement(act3_6, "Str", sr="arg3", ve="3").text = "%TbCurrentTask"
    
    # --- Task 4: Timeblocker_Pause ---
    t4 = ET.SubElement(root, "Task", sr="task4")
    ET.SubElement(t4, "cdate").text = "1622393307781"
    ET.SubElement(t4, "edate").text = "1622393307781"
    ET.SubElement(t4, "id").text = "4"
    ET.SubElement(t4, "nme").text = "Timeblocker_Pause"
    
    # Action 0: JS for pause calculation and logging
    act4_0 = ET.SubElement(t4, "Action", sr="act0", ve="7")
    ET.SubElement(act4_0, "code").text = "129"
    pause_js = """var active = global('TbTimerActive');
var vault = global('ObsidianVaultPath');
var taskName = global('TbCurrentTask');

if (active === '1') {
    var start = parseInt(global('TbTimerStartEpoch'), 10);
    var duration = parseInt(global('TbTimerDurationSeconds'), 10);
    var now = Math.floor(Date.now() / 1000);
    var elapsed = now - start;
    var remaining = duration - elapsed;
    if (remaining < 0) remaining = 0;
    setGlobal('TbTimerDurationSeconds', String(remaining));
    
    // Log pause event in daily note
    if (taskName && taskName !== "No active task") {
        var dNow = new Date();
        var yyyy = dNow.getFullYear();
        var mm = String(dNow.getMonth() + 1).padStart(2, '0');
        var dd = String(dNow.getDate()).padStart(2, '0');
        var today = yyyy + '-' + mm + '-' + dd;
        var filePath = vault + '/02_Journal/01_Daily/' + today + '.md';
        
        var fileContent = "";
        try { fileContent = readFile(filePath); } catch(e) {}
        
        if (fileContent) {
            var lines = fileContent.split('\\n');
            var sh = String(dNow.getHours()).padStart(2, '0');
            var sm = String(dNow.getMinutes()).padStart(2, '0');
            var ss = String(dNow.getSeconds()).padStart(2, '0');
            var pauseTimeStr = sh + ':' + sm + ':' + ss;
            
            for (var i = lines.length - 1; i >= 0; i--) {
                if (lines[i].indexOf('[focus:: ' + taskName + ']') !== -1 && lines[i].indexOf('[completed-time:: ]') !== -1) {
                    var match = lines[i].match(/\\[pause-start:: ([^\\]]*)\\]/);
                    var currentPauses = match ? match[1].trim() : "";
                    var newPauses = currentPauses ? currentPauses + ', ' + pauseTimeStr : pauseTimeStr;
                    lines[i] = lines[i].replace(/\\[pause-start:: [^\\]]*\\]/, '[pause-start:: ' + newPauses + ']');
                    break;
                }
            }
            writeFile(filePath, lines.join('\\n'), false);
        }
    }
}
setGlobal('TbTimerActive', '0');"""
    ET.SubElement(act4_0, "Str", sr="arg0", ve="3").text = pause_js
    
    # Action 1: Cancel Timer Notification
    act4_1 = ET.SubElement(t4, "Action", sr="act1", ve="7")
    ET.SubElement(act4_1, "code").text = "779" # Notify Cancel
    ET.SubElement(act4_1, "Str", sr="arg0", ve="3").text = "Obsidian Task Timer"
    
    # Action 2: Run Parse to update variables
    act4_2 = ET.SubElement(t4, "Action", sr="act2", ve="7")
    ET.SubElement(act4_2, "code").text = "130"
    ET.SubElement(act4_2, "Str", sr="arg0", ve="3").text = "Timeblocker_Parse"
    
    # Action 3: Stop alarm music if playing
    act4_3 = ET.SubElement(t4, "Action", sr="act3", ve="7")
    ET.SubElement(act4_3, "code").text = "193" # Music Stop
    
    # --- Task 5: Timeblocker_Resume ---
    t5 = ET.SubElement(root, "Task", sr="task5")
    ET.SubElement(t5, "cdate").text = "1622393307782"
    ET.SubElement(t5, "edate").text = "1622393307782"
    ET.SubElement(t5, "id").text = "5"
    ET.SubElement(t5, "nme").text = "Timeblocker_Resume"
    
    # Action 0: JS for resume and logging
    act5_0 = ET.SubElement(t5, "Action", sr="act0", ve="7")
    ET.SubElement(act5_0, "code").text = "129"
    resume_js = """var now = Math.floor(Date.now() / 1000);
setGlobal('TbTimerStartEpoch', String(now));
setGlobal('TbTimerActive', '1');

var vault = global('ObsidianVaultPath');
var taskName = global('TbCurrentTask');
if (taskName && taskName !== "No active task") {
    var dNow = new Date();
    var yyyy = dNow.getFullYear();
    var mm = String(dNow.getMonth() + 1).padStart(2, '0');
    var dd = String(dNow.getDate()).padStart(2, '0');
    var today = yyyy + '-' + mm + '-' + dd;
    var filePath = vault + '/02_Journal/01_Daily/' + today + '.md';
    
    var fileContent = "";
    try { fileContent = readFile(filePath); } catch(e) {}
    
    if (fileContent) {
        var lines = fileContent.split('\\n');
        var sh = String(dNow.getHours()).padStart(2, '0');
        var sm = String(dNow.getMinutes()).padStart(2, '0');
        var ss = String(dNow.getSeconds()).padStart(2, '0');
        var resumeTimeStr = sh + ':' + sm + ':' + ss;
        
        for (var i = lines.length - 1; i >= 0; i--) {
            if (lines[i].indexOf('[focus:: ' + taskName + ']') !== -1 && lines[i].indexOf('[completed-time:: ]') !== -1) {
                var match = lines[i].match(/\\[pause-end:: ([^\\]]*)\\]/);
                var currentResumes = match ? match[1].trim() : "";
                var newResumes = currentResumes ? currentResumes + ', ' + resumeTimeStr : resumeTimeStr;
                lines[i] = lines[i].replace(/\\[pause-end:: [^\\]]*\\]/, '[pause-end:: ' + newResumes + ']');
                break;
            }
        }
        writeFile(filePath, lines.join('\\n'), false);
    }
}"""
    ET.SubElement(act5_0, "Str", sr="arg0", ve="3").text = resume_js
    
    # Action 1: Show Notification
    act5_1 = ET.SubElement(t5, "Action", sr="act1", ve="7")
    ET.SubElement(act5_1, "code").text = "525"
    ET.SubElement(act5_1, "Str", sr="arg0", ve="3").text = "Obsidian Task Timer"
    ET.SubElement(act5_1, "Str", sr="arg1", ve="3").text = "Focusing on: %TbCurrentTask"
    
    # Action 2: Run Parse to update variables
    act5_2 = ET.SubElement(t5, "Action", sr="act2", ve="7")
    ET.SubElement(act5_2, "code").text = "130"
    ET.SubElement(act5_2, "Str", sr="arg0", ve="3").text = "Timeblocker_Parse"
    
    # Action 3: Start Timer Watcher in background
    act5_3 = ET.SubElement(t5, "Action", sr="act3", ve="7")
    ET.SubElement(act5_3, "code").text = "130"
    ET.SubElement(act5_3, "Str", sr="arg0", ve="3").text = "Timeblocker_TimerWatcher"
    ET.SubElement(act5_3, "Int", sr="arg1", val="99")
    ET.SubElement(act5_3, "Str", sr="arg2", ve="3").text = "%TbTimerDurationSeconds"
    ET.SubElement(act5_3, "Str", sr="arg3", ve="3").text = "%TbCurrentTask"
    
    # --- Task 6: Timeblocker_Complete ---
    t6 = ET.SubElement(root, "Task", sr="task6")
    ET.SubElement(t6, "cdate").text = "1622393307783"
    ET.SubElement(t6, "edate").text = "1622393307783"
    ET.SubElement(t6, "id").text = "6"
    ET.SubElement(t6, "nme").text = "Timeblocker_Complete"
    
    # Action 0: JS to complete timer and checkbox
    act6_0 = ET.SubElement(t6, "Action", sr="act0", ve="7")
    ET.SubElement(act6_0, "code").text = "129"
    complete_js = """setGlobal('TbTimerActive', '0');
var vault = global('ObsidianVaultPath');
var taskName = global('TbCurrentTask');
var srcUrl = global('TbCurrentSrc');

if (taskName && taskName !== "No active task") {
    var now = new Date();
    var yyyy = now.getFullYear();
    var mm = String(now.getMonth() + 1).padStart(2, '0');
    var dd = String(now.getDate()).padStart(2, '0');
    var today = yyyy + '-' + mm + '-' + dd;
    var filePath = vault + '/02_Journal/01_Daily/' + today + '.md';
    
    var fileContent = "";
    try { fileContent = readFile(filePath); } catch(e) {}
    
    if (fileContent) {
        var lines = fileContent.split('\\n');
        var sh = String(now.getHours()).padStart(2, '0');
        var sm = String(now.getMinutes()).padStart(2, '0');
        var ss = String(now.getSeconds()).padStart(2, '0');
        var endTimeStr = sh + ':' + sm + ':' + ss;
        
        // 1. Mark in Log
        for (var i = lines.length - 1; i >= 0; i--) {
            if (lines[i].indexOf('[focus:: ' + taskName + ']') !== -1 && lines[i].indexOf('[completed-time:: ]') !== -1) {
                lines[i] = lines[i].replace(/\\[completed-time:: \\]/, '[completed-time:: ' + endTimeStr + ']');
                break;
            }
        }
        
        // 2. Mark checkbox as completed in Day Planner
        var inPlanner = false;
        for (var j = 0; j < lines.length; j++) {
            if (lines[j].indexOf("## 📅Day Planner") !== -1) {
                inPlanner = true;
                continue;
            }
            if (inPlanner && lines[j].indexOf("## ") === 0) {
                break;
            }
            if (inPlanner) {
                if (lines[j].indexOf(taskName) !== -1 && lines[j].indexOf('- [ ]') !== -1) {
                    lines[j] = lines[j].replace('- [ ]', '- [x]');
                    break;
                }
            }
        }
        
        writeFile(filePath, lines.join('\\n'), false);
    }
}"""
    ET.SubElement(act6_0, "Str", sr="arg0", ve="3").text = complete_js
    
    # Action 1: Cancel Timer Notification
    act6_1 = ET.SubElement(t6, "Action", sr="act1", ve="7")
    ET.SubElement(act6_1, "code").text = "779"
    ET.SubElement(act6_1, "Str", sr="arg0", ve="3").text = "Obsidian Task Timer"
    
    # Action 2: Perform Task SyncTask (in the background)
    act6_2 = ET.SubElement(t6, "Action", sr="act2", ve="7")
    ET.SubElement(act6_2, "code").text = "130"
    ET.SubElement(act6_2, "Str", sr="arg0", ve="3").text = "Timeblocker_SyncTask"
    ET.SubElement(act6_2, "Str", sr="arg1", ve="3").text = "%TbCurrentSrc" # par1
    ET.SubElement(act6_2, "Str", sr="arg2", ve="3").text = "1" # par2 (completed)
    
    # Action 3: Run Parse to update variables
    act6_3 = ET.SubElement(t6, "Action", sr="act3", ve="7")
    ET.SubElement(act6_3, "code").text = "130"
    ET.SubElement(act6_3, "Str", sr="arg0", ve="3").text = "Timeblocker_Parse"
    
    # Action 4: Stop alarm music if playing
    act6_4 = ET.SubElement(t6, "Action", sr="act4", ve="7")
    ET.SubElement(act6_4, "code").text = "193" # Music Stop
    
    # --- Task 7: Timeblocker_SyncTask ---
    t7 = ET.SubElement(root, "Task", sr="task7")
    ET.SubElement(t7, "cdate").text = "1622393307784"
    ET.SubElement(t7, "edate").text = "1622393307784"
    ET.SubElement(t7, "id").text = "7"
    ET.SubElement(t7, "nme").text = "Timeblocker_SyncTask"
    
    # Action 0: JS to parse task URL and extract tokens
    act7_0 = ET.SubElement(t7, "Action", sr="act0", ve="7")
    ET.SubElement(act7_0, "code").text = "129"
    sync_parse_js = """var vault = global('ObsidianVaultPath');
var srcUrl = local('par1');
if (srcUrl) {
    if (srcUrl.indexOf('todoist.com') !== -1) {
        var match = srcUrl.match(/(?:showTask\\?id=|app\\/task\\/|app\\/project\\/[^\\/]+\\/task\\/)([A-Za-z0-9_-]+)/);
        if (match) {
            var taskId = match[1];
            var token = "";
            try {
                var dataJson = JSON.parse(readFile(vault + '/.obsidian/plugins/timeblocker-and-task-timer/data.json'));
                token = dataJson.todoistToken;
            } catch(e) {}
            if (!token) {
                try {
                    var configJson = JSON.parse(readFile(vault + '/.obsidian/plugins/timeblocker-and-task-timer/config.json'));
                    token = configJson.todoist_api_token;
                } catch(e) {}
            }
            if (token) {
                setLocal('todoist_token', token);
                setLocal('todoist_task_id', taskId);
                setLocal('is_todoist', '1');
            }
        }
    } else if (srcUrl.indexOf('tasks.google.com') !== -1) {
        var listId = "";
        var taskId = "";
        var googleMatch = srcUrl.match(/tasks\\.google\\.com\\/(?:#)?task\\/([^\\/]+)\\/([^\\s\\)]+)/);
        var googleQueryMatch = srcUrl.match(/tasks\\.google\\.com\\/[?#](?:listId|list)=([^&]+)&(?:taskId|task)=([^\\s\\)]+)/);
        
        if (googleMatch) {
            listId = googleMatch[1];
            taskId = googleMatch[2];
        } else if (googleQueryMatch) {
            listId = googleQueryMatch[1];
            taskId = googleQueryMatch[2];
        }
        
        if (listId && taskId) {
            try {
                var tokenJson = JSON.parse(readFile(vault + '/.obsidian/plugins/timeblocker-and-task-timer/token.json'));
                setLocal('g_refresh_token', tokenJson.refresh_token || "");
                setLocal('g_client_id', tokenJson.client_id || "");
                setLocal('g_client_secret', tokenJson.client_secret || "");
                setLocal('g_token_uri', tokenJson.token_uri || "https://oauth2.googleapis.com/token");
                setLocal('g_list_id', listId);
                setLocal('g_task_id', taskId);
                setLocal('is_google', '1');
            } catch(e) {}
        }
    }
}"""
    ET.SubElement(act7_0, "Str", sr="arg0", ve="3").text = sync_parse_js
    
    # Action 1: HTTP Request for Todoist completion
    act7_1 = ET.SubElement(t7, "Action", sr="act1", ve="7")
    ET.SubElement(act7_1, "code").text = "339" # HTTP Request
    ET.SubElement(act7_1, "Int", sr="arg0", val="1") # Method: POST
    ET.SubElement(act7_1, "Str", sr="arg1", ve="3").text = "https://api.todoist.com/rest/v2/tasks/%todoist_task_id/close" # URL
    ET.SubElement(act7_1, "Str", sr="arg2", ve="3").text = "Authorization: Bearer %todoist_token" # Headers
    # Conditional run: if is_todoist is set
    cond7_1 = ET.SubElement(act7_1, "ConditionList", sr="cond")
    ET.SubElement(cond7_1, "Condition", sr="c0", ve="3")
    ET.SubElement(cond7_1, "lhs").text = "%is_todoist"
    ET.SubElement(cond7_1, "op").text = "12" # Is Set (or equals 1)
    ET.SubElement(cond7_1, "rhs").text = ""
    
    # Action 2: HTTP Request for Google Tasks Refresh Token
    act7_2 = ET.SubElement(t7, "Action", sr="act2", ve="7")
    ET.SubElement(act7_2, "code").text = "339"
    ET.SubElement(act7_2, "Int", sr="arg0", val="1") # Method: POST
    ET.SubElement(act7_2, "Str", sr="arg1", ve="3").text = "%g_token_uri"
    ET.SubElement(act7_2, "Str", sr="arg2", ve="3").text = "Content-Type: application/x-www-form-urlencoded"
    ET.SubElement(act7_2, "Str", sr="arg3", ve="3").text = "grant_type=refresh_token&client_id=%g_client_id&client_secret=%g_client_secret&refresh_token=%g_refresh_token" # Body
    ET.SubElement(act7_2, "Str", sr="arg6", ve="3").text = "%g_auth_res" # Output variable
    cond7_2 = ET.SubElement(act7_2, "ConditionList", sr="cond")
    ET.SubElement(cond7_2, "Condition", sr="c0", ve="3")
    ET.SubElement(cond7_2, "lhs").text = "%is_google"
    ET.SubElement(cond7_2, "op").text = "12"
    ET.SubElement(cond7_2, "rhs").text = ""
    
    # Action 3: JS to parse Access Token
    act7_3 = ET.SubElement(t7, "Action", sr="act3", ve="7")
    ET.SubElement(act7_3, "code").text = "129"
    parse_access_js = """var res = JSON.parse(g_auth_res);
var g_access_token = res.access_token;
setLocal('g_access_token', g_access_token);"""
    ET.SubElement(act7_3, "Str", sr="arg0", ve="3").text = parse_access_js
    cond7_3 = ET.SubElement(act7_3, "ConditionList", sr="cond")
    ET.SubElement(cond7_3, "Condition", sr="c0", ve="3")
    ET.SubElement(cond7_3, "lhs").text = "%is_google"
    ET.SubElement(cond7_3, "op").text = "12"
    ET.SubElement(cond7_3, "rhs").text = ""
    
    # Action 4: HTTP Request to patch Google Task
    act7_4 = ET.SubElement(t7, "Action", sr="act4", ve="7")
    ET.SubElement(act7_4, "code").text = "339"
    ET.SubElement(act7_4, "Int", sr="arg0", val="5") # Method: PATCH (In Tasker, PATCH is usually 5 or 6, let's use custom and specify method PATCH if needed, or 339 supports it)
    ET.SubElement(act7_4, "Str", sr="arg1", ve="3").text = "https://tasks.googleapis.com/tasks/v1/lists/%g_list_id/tasks/%g_task_id"
    ET.SubElement(act7_4, "Str", sr="arg2", ve="3").text = "Authorization: Bearer %g_access_token\nContent-Type: application/json"
    ET.SubElement(act7_4, "Str", sr="arg3", ve="3").text = '{"id": "%g_task_id", "status": "completed"}'
    cond7_4 = ET.SubElement(act7_4, "ConditionList", sr="cond")
    ET.SubElement(cond7_4, "Condition", sr="c0", ve="3")
    ET.SubElement(cond7_4, "lhs").text = "%is_google"
    ET.SubElement(cond7_4, "op").text = "12"
    ET.SubElement(cond7_4, "rhs").text = ""
    
    # --- Task 8: Timeblocker_NotToday ---
    t8 = ET.SubElement(root, "Task", sr="task8")
    ET.SubElement(t8, "cdate").text = "1622393307785"
    ET.SubElement(t8, "edate").text = "1622393307785"
    ET.SubElement(t8, "id").text = "8"
    ET.SubElement(t8, "nme").text = "Timeblocker_NotToday"
    
    # Action 0: JS to cancel task
    act8_0 = ET.SubElement(t8, "Action", sr="act0", ve="7")
    ET.SubElement(act8_0, "code").text = "129"
    nottoday_js = """setGlobal('TbTimerActive', '0');
var vault = global('ObsidianVaultPath');
var taskName = global('TbCurrentTask');

if (taskName && taskName !== "No active task") {
    var now = new Date();
    var yyyy = now.getFullYear();
    var mm = String(now.getMonth() + 1).padStart(2, '0');
    var dd = String(now.getDate()).padStart(2, '0');
    var today = yyyy + '-' + mm + '-' + dd;
    var filePath = vault + '/02_Journal/01_Daily/' + today + '.md';
    
    var fileContent = "";
    try { fileContent = readFile(filePath); } catch(e) {}
    
    if (fileContent) {
        var lines = fileContent.split('\\n');
        var inPlanner = false;
        for (var j = 0; j < lines.length; j++) {
            if (lines[j].indexOf("## 📅Day Planner") !== -1) {
                inPlanner = true;
                continue;
            }
            if (inPlanner && lines[j].indexOf("## ") === 0) {
                break;
            }
            if (inPlanner) {
                if (lines[j].indexOf(taskName) !== -1 && (lines[j].indexOf('- [ ]') !== -1 || lines[j].indexOf('- [/]') !== -1)) {
                    lines[j] = lines[j].replace('- [ ]', '- [-]').replace('- [/]', '- [-]');
                    break;
                }
            }
        }
        writeFile(filePath, lines.join('\\n'), false);
    }
}"""
    ET.SubElement(act8_0, "Str", sr="arg0", ve="3").text = nottoday_js
    
    # Action 1: Cancel Notification
    act8_1 = ET.SubElement(t8, "Action", sr="act1", ve="7")
    ET.SubElement(act8_1, "code").text = "779"
    ET.SubElement(act8_1, "Str", sr="arg0", ve="3").text = "Obsidian Task Timer"
    
    # Action 2: Run Parse to update variables
    act8_2 = ET.SubElement(t8, "Action", sr="act2", ve="7")
    ET.SubElement(act8_2, "code").text = "130"
    ET.SubElement(act8_2, "Str", sr="arg0", ve="3").text = "Timeblocker_Parse"
    
    # Action 3: Stop alarm music if playing
    act8_3 = ET.SubElement(t8, "Action", sr="act3", ve="7")
    ET.SubElement(act8_3, "code").text = "193" # Music Stop

    # --- Task 9: Timeblocker_Postpone ---
    t9 = ET.SubElement(root, "Task", sr="task9")
    ET.SubElement(t9, "cdate").text = "1622393307786"
    ET.SubElement(t9, "edate").text = "1622393307786"
    ET.SubElement(t9, "id").text = "9"
    ET.SubElement(t9, "nme").text = "Timeblocker_Postpone"
    
    # Action 0: JS to add postpone tag
    act9_0 = ET.SubElement(t9, "Action", sr="act0", ve="7")
    ET.SubElement(act9_0, "code").text = "129"
    postpone_js = """setGlobal('TbTimerActive', '0');
var vault = global('ObsidianVaultPath');
var taskName = global('TbCurrentTask');

if (taskName && taskName !== "No active task") {
    var now = new Date();
    var yyyy = now.getFullYear();
    var mm = String(now.getMonth() + 1).padStart(2, '0');
    var dd = String(now.getDate()).padStart(2, '0');
    var today = yyyy + '-' + mm + '-' + dd;
    var filePath = vault + '/02_Journal/01_Daily/' + today + '.md';
    
    var fileContent = "";
    try { fileContent = readFile(filePath); } catch(e) {}
    
    if (fileContent) {
        var lines = fileContent.split('\n');
        
        // 1. Parse all tasks in the daily note
        var inPlanner = false;
        var parsedTasks = [];
        var fileTaskRegex = /^\\s*-\\s+\\[( |x|\\/|-)\\]\\s+(\\d{1,2}):(\\d{2})\\s*-\\s*(\\d{1,2}):(\\d{2})\\s+(.*)$/;
        var currentSubheading = "";
        
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (line.indexOf("## 📅Day Planner") !== -1) {
                inPlanner = true;
                continue;
            }
            if (inPlanner && line.indexOf("## ") === 0) {
                break;
            }
            if (inPlanner) {
                if (line.indexOf("### ") === 0) {
                    currentSubheading = line.trim();
                }
                var m = line.match(fileTaskRegex);
                if (m) {
                    var statusChar = m[1];
                    var sh = parseInt(m[2], 10);
                    var sm = parseInt(m[3], 10);
                    var eh = parseInt(m[4], 10);
                    var em = parseInt(m[5], 10);
                    var rest = m[6].trim();
                    
                    var startMinutes = sh * 60 + sm;
                    var endMinutes = eh * 60 + em;
                    var duration = endMinutes - startMinutes;
                    
                    parsedTasks.push({
                        lineIndex: i,
                        description: rest,
                        startMinutes: startMinutes,
                        endMinutes: endMinutes,
                        duration: duration,
                        status: statusChar === 'x' ? 'completed' : (statusChar === '/' ? 'in-progress' : 'pending'),
                        subheading: currentSubheading,
                        raw: line
                    });
                }
            }
        }
        
        // 2. Find the current task
        var currentTask = null;
        for (var k = 0; k < parsedTasks.length; k++) {
            var t = parsedTasks[k];
            var cleanDesc = t.description.replace(/`?BUTTON\\[[^\\]]+\\]`?/g, '').trim();
            var srcMatch = cleanDesc.match(/\\[src\\]\\(([^\\)]+)\\)/);
            if (srcMatch) {
                cleanDesc = cleanDesc.replace(/\\[src\\]\\([^\\)]+\\)/g, '').trim();
            }
            cleanDesc = cleanDesc.replace(/\\[Google Tasks\\]/g, '').replace(/\\[Calendar\\]/g, '').replace(/#\\w+/g, '').replace(/\\s+/g, ' ').trim();
            
            if (cleanDesc.toLowerCase() === taskName.toLowerCase()) {
                currentTask = t;
                break;
            }
        }
        
        if (currentTask) {
            // Find first free slot after now
            var currentMinutes = now.getHours() * 60 + now.getMinutes();
            
            var busyIntervals = [];
            for (var l = 0; l < parsedTasks.length; l++) {
                var pt = parsedTasks[l];
                if (pt.endMinutes > currentMinutes && pt.lineIndex !== currentTask.lineIndex) {
                    busyIntervals.push({
                        start: pt.startMinutes,
                        end: pt.endMinutes
                    });
                }
            }
            
            busyIntervals.sort(function(a, b) { return a.start - b.start; });
            
            var newStart = currentMinutes;
            var duration = currentTask.duration || 20;
            
            for (var m = 0; m < busyIntervals.length; m++) {
                var interval = busyIntervals[m];
                if (interval.start - newStart >= duration) {
                    break;
                }
                newStart = Math.max(newStart, interval.end);
            }
            
            var newEnd = newStart + duration;
            if (newEnd <= 1440) { // must be before midnight
                var newStartH = String(Math.floor(newStart / 60)).padStart(2, '0');
                var newStartM = String(newStart % 60).padStart(2, '0');
                var newEndH = String(Math.floor(newEnd / 60)).padStart(2, '0');
                var newEndM = String(newEnd % 60).padStart(2, '0');
                var newTimeRange = newStartH + ':' + newStartM + ' - ' + newEndH + ':' + newEndM;
                
                var originalLine = lines[currentTask.lineIndex];
                var oldTimeRangeRegex = /\\b\\d{1,2}:\\d{2}\\s*-\\s*\\d{1,2}:\\d{2}\\b/;
                var newLine = originalLine.replace(oldTimeRangeRegex, newTimeRange).replace('- [/]', '- [ ]');
                lines[currentTask.lineIndex] = newLine;
                
                // Re-sort within the subheading
                var subheadingIndices = [];
                var inSubheading = false;
                for (var i = 0; i < lines.length; i++) {
                    var line = lines[i];
                    if (line.indexOf('## ') === 0 || (line.indexOf('### ') === 0 && line.trim() !== currentTask.subheading)) {
                        if (inSubheading) break;
                    }
                    if (line.trim() === currentTask.subheading) {
                        inSubheading = true;
                        continue;
                    }
                    if (inSubheading) {
                        if (fileTaskRegex.test(line)) {
                            subheadingIndices.push(i);
                        }
                    }
                }
                
                if (subheadingIndices.length > 1) {
                    var subheadingTasks = [];
                    for (var s = 0; s < subheadingIndices.length; s++) {
                        var idx = subheadingIndices[s];
                        var line = lines[idx];
                        var match = line.match(fileTaskRegex);
                        if (match) {
                            var sh = parseInt(match[2], 10);
                            var sm = parseInt(match[3], 10);
                            subheadingTasks.push({
                                line: line,
                                startMinutes: sh * 60 + sm
                            });
                        }
                    }
                    
                    subheadingTasks.sort(function(a, b) { return a.startMinutes - b.startMinutes; });
                    
                    for (var s = 0; s < subheadingIndices.length; s++) {
                        lines[subheadingIndices[s]] = subheadingTasks[s].line;
                    }
                }
                
                writeFile(filePath, lines.join('\\n'), false);
            }
        }
    }
}"""
    ET.SubElement(act9_0, "Str", sr="arg0", ve="3").text = postpone_js
    
    # Action 1: Cancel Notification
    act9_1 = ET.SubElement(t9, "Action", sr="act1", ve="7")
    ET.SubElement(act9_1, "code").text = "779"
    ET.SubElement(act9_1, "Str", sr="arg0", ve="3").text = "Obsidian Task Timer"
    
    # Action 2: Run Parse to update variables
    act9_2 = ET.SubElement(t9, "Action", sr="act2", ve="7")
    ET.SubElement(act9_2, "code").text = "130"
    ET.SubElement(act9_2, "Str", sr="arg0", ve="3").text = "Timeblocker_Parse"
    
    # Action 3: Stop alarm music if playing
    act9_3 = ET.SubElement(t9, "Action", sr="act3", ve="7")
    ET.SubElement(act9_3, "code").text = "193" # Music Stop
    
    # --- Task 10: Timeblocker_TimerWatcher ---
    t10 = ET.SubElement(root, "Task", sr="task10")
    ET.SubElement(t10, "cdate").text = "1622393307787"
    ET.SubElement(t10, "edate").text = "1622393307787"
    ET.SubElement(t10, "id").text = "10"
    ET.SubElement(t10, "nme").text = "Timeblocker_TimerWatcher"
    
    # Action 0: Wait %par1 seconds
    act10_0 = ET.SubElement(t10, "Action", sr="act0", ve="7")
    ET.SubElement(act10_0, "code").text = "30" # Wait
    ET.SubElement(act10_0, "Int", sr="arg0", val="0") # MS
    ET.SubElement(act10_0, "Str", sr="arg1", ve="3").text = "%par1" # Seconds
    ET.SubElement(act10_0, "Int", sr="arg2", val="0") # Mins
    ET.SubElement(act10_0, "Int", sr="arg3", val="0") # Hours
    
    # Action 1: Call Alarm if timer is still active and same task
    act10_1 = ET.SubElement(t10, "Action", sr="act1", ve="7")
    ET.SubElement(act10_1, "code").text = "129" # Javascriptlet
    watcher_js = """if (global('TbTimerActive') === '1' && global('TbCurrentTask') === local('par2')) {
    performTask('Timeblocker_Alarm', 100, "", "");
}"""
    ET.SubElement(act10_1, "Str", sr="arg0", ve="3").text = watcher_js
    
    # --- Task 11: Timeblocker_Alarm ---
    t11 = ET.SubElement(root, "Task", sr="task11")
    ET.SubElement(t11, "cdate").text = "1622393307788"
    ET.SubElement(t11, "edate").text = "1622393307788"
    ET.SubElement(t11, "id").text = "11"
    ET.SubElement(t11, "nme").text = "Timeblocker_Alarm"
    
    # Action 0: Vibrate
    act11_0 = ET.SubElement(t11, "Action", sr="act0", ve="7")
    ET.SubElement(act11_0, "code").text = "59" # Vibrate
    ET.SubElement(act11_0, "Int", sr="arg0", val="1000") # Time MS
    
    # Action 1: Play Sound (Ringtone)
    act11_1 = ET.SubElement(t11, "Action", sr="act1", ve="7")
    ET.SubElement(act11_1, "code").text = "192" # Play Ringtone
    ET.SubElement(act11_1, "Int", sr="arg0", val="1") # Type: Alarm
    
    # Action 2: Show Notification Alert
    act11_2 = ET.SubElement(t11, "Action", sr="act2", ve="7")
    ET.SubElement(act11_2, "code").text = "525" # Notify
    ET.SubElement(act11_2, "Str", sr="arg0", ve="3").text = "Obsidian Task Timer"
    ET.SubElement(act11_2, "Str", sr="arg1", ve="3").text = "Focus timer finished: %TbCurrentTask! Tap widget to Complete, Postpone, or Cancel."
    ET.SubElement(act11_2, "Int", sr="arg2", val="0")
    
    # Action 3: Set TbTimerActive to 0 (stop state)
    act11_3 = ET.SubElement(t11, "Action", sr="act3", ve="7")
    ET.SubElement(act11_3, "code").text = "547" # Variable Set
    ET.SubElement(act11_3, "Str", sr="arg0", ve="3").text = "%TbTimerActive"
    ET.SubElement(act11_3, "Str", sr="arg1", ve="3").text = "0"
    
    # Action 4: Run Parse to update variables on widget
    act11_4 = ET.SubElement(t11, "Action", sr="act4", ve="7")
    ET.SubElement(act11_4, "code").text = "130"
    ET.SubElement(act11_4, "Str", sr="arg0", ve="3").text = "Timeblocker_Parse"

    # Write XML
    xml_str = minidom.parseString(ET.tostring(root)).toprettyxml(indent="  ")
    out_path = os.path.join(os.path.dirname(__file__), "ObsidianTimeblocker.prj.xml")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(xml_str)
    print(f"Generated Tasker Project XML at {out_path}!")

if __name__ == "__main__":
    create_tasker_project()
