---
status: 🟢 Active
type: LifeOS
repo:
  - schedule-assistant-focus-timer
  - Timeblocker and Task Timer
---

[[Schedule Assistant and Focus Timer Case Study Note]]


## Dev Log History
```dataviewjs
const current = dv.current();
if (!current || !current.file) return;
const currentFileName = current.file.name;

// 1. Determine project keywords and git repository names to match
const cleanName = currentFileName
    .replace(/dev log/i, "")
    .replace(/project/i, "")
    .trim()
    .toLowerCase();

const slugName = cleanName.replace(/[^a-z0-9]+/g, "-");

// Collect repo candidates
let candidates = new Set([cleanName, slugName]);

// Support explicit repo names listed in the note's frontmatter
if (current.repo) {
    const repos = Array.isArray(current.repo) ? current.repo : [current.repo];
    for (const r of repos) {
        if (r) {
            candidates.add(r.trim().toLowerCase());
            candidates.add(r.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"));
        }
    }
}

// Add known hardcoded fallbacks to maintain compatibility automatically
if (currentFileName.includes("Schedule Assistant")) {
    candidates.add("schedule-assistant-focus-timer");
    candidates.add("timeblocker and task timer");
}
if (currentFileName.includes("DRG")) {
    candidates.add("dynamical representation geometry");
}

const candidateList = Array.from(candidates);

// Filter out generic keywords for message-level matching
const genericNames = new Set(["untitled", "untitled.md", "dev log", "project", "log", "history", ""]);
const msgKeywords = candidateList.filter(c => c && !genericNames.has(c));

// 2. Fetch and process daily notes from "02_Journal/01_Daily"
const pages = dv.pages('"02_Journal/01_Daily"').sort(p => p.file.name, "desc");
const rows = [];

for (const p of pages) {
    const logs = [];
    
    // Check if this daily note explicitly links to this project page
    const projects = [].concat(p.Project || []);
    const isLinkedToThisProject = projects.some(proj => {
        if (proj && typeof proj === 'object' && proj.path) {
            return proj.path === current.file.path;
        }
        return String(proj).includes(currentFileName);
    });

    // A. Parse manual log entries (from Dev_Log or Log fields)
    const devLogs = [].concat(p.Dev_Log || []).concat(p.Log || []);
    for (const dl of devLogs) {
        if (!dl) continue;
        const dlStr = String(dl);
        const matchesManual = isLinkedToThisProject || 
                              dlStr.includes(currentFileName) || 
                              candidateList.some(cand => dlStr.toLowerCase().includes(cand));
        if (matchesManual && !logs.includes(dlStr)) {
            logs.push(dlStr);
        }
    }
    
    // B. Parse Antigravity Git Logs
    const content = await dv.io.load(p.file.path);
    if (content) {
        const gitLogRegex = /<!--\s*START(?:_|-)(?:antigravity|Antigravity)(?:_|-)(?:git|Git)(?:_|-)(?:log|Log)\s*-->([\s\S]*?)<!--\s*END(?:_|-)(?:antigravity|Antigravity)(?:_|-)(?:git|Git)(?:_|-)(?:log|Log)\s*-->/i;
        const match = content.match(gitLogRegex);
        if (match) {
            const gitBlock = match[1];
            const lines = gitBlock.split(/\r?\n/);
            let currentRepo = "";
            for (const line of lines) {
                const trimmedLine = line.trim();
                if (trimmedLine.startsWith("**") && trimmedLine.endsWith("**")) {
                    currentRepo = trimmedLine.replace(/\*\*/g, '').trim().toLowerCase();
                } else if (trimmedLine.startsWith("- ") && currentRepo) {
                    const commitLower = trimmedLine.toLowerCase();
                    const repoMatches = candidateList.some(cand => 
                        currentRepo === cand || 
                        currentRepo.includes(cand) || 
                        cand.includes(currentRepo)
                    );
                    const messageMatches = msgKeywords.some(kw => commitLower.includes(kw));
                    
                    if (repoMatches || messageMatches) {
                        const logLine = "🐙 **Git Log**: " + trimmedLine.substring(2);
                        if (!logs.includes(logLine)) {
                            logs.push(logLine);
                        }
                    }
                }
            }
        }
    }
    
    // C. Add to table if logs were found for this day
    if (logs.length > 0) {
        rows.push([p.file.link, logs.join("<br>")]);
    }
}

dv.table(["Date", "Notes"], rows);
```

## ToDo
- [x] Modular TypeScript and Python refactor for Schedule Assistant (break down monolithic 4,799 line main.js and 1,261 line timeblocker.py into clean modular packages: services, views, settings, scheduler, auth, and models under 1,000 lines; commit `d12ce47`) (Added: 2026-08-19, Completed: 2026-09-04)
- [x] Fix Web port blank view issue caused by duplicate `const now` / `currentHour` / `currentMin` identifier declarations in `renderGridView()` (`app.js`). Bind HTTP server explicitly to `0.0.0.0:8090` and surface live connection status badge. (Added: 2026-08-26, Completed: 2026-08-26)
- [x] Fix focus timer countdown drift and background throttling by syncing absolute wall-clock targetEndTime across Obsidian desktop, Web UI, and Android widget (Completed: 2026-08-19)
- [x] Implement interactive drag-and-drop focus block rearrangement, live snap preview, and untimed drawer integration in Schedule Grid View (Completed: 2026-08-18)
- [x] Webport day planner with interactive timeblock layout, schedule generation, and real-time bidirectional sync (Completed: 2026-08-18 via Web Schedule Grid & Timer app)
- [x] daily note being incredibly weird after schedule assistant updates. Clicking around goes to weird places, typing goes weird places and enters copies of laggy text (Added: 2026-07-16)
- [x] Fix android subtask view