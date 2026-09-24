// ---- Supabase connection ----
const SUPABASE_URL = "https://njcoublcsoglndpixnnw.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qY291Ymxjc29nbG5kcGl4bm53Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0NjMxODksImV4cCI6MjEwNDAzOTE4OX0.D6ncS4xzezhNkrhrFCXWZXi6xl6eWalj-qB53chaEVw";
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);




// ------------------------------------------------------------------
// Field Log — vanilla JS goal tracker
// State persists to localStorage (per-browser). Swap for a real
// backend (e.g. Supabase) later by replacing loadState/saveState.
// ------------------------------------------------------------------

const STORAGE_KEY = "field-log:goals";

let state = {
    projects: [],       // { id, title, startValue, targetValue, unit, secondaryLabel, secondaryTarget, entries: [] }
    selectedId: null,
    active: null,       // which nav tab is "on"
    showProjects: false,
    showAbout: false,
    modal: null,        // "new" | "update" | null
    dismissedCompleteId: null
};

// ---------- persistence (Supabase) ----------
let currentUser = null;

async function loadState() {
    const { data: goals, error } = await db
        .from("goals")
        .select("*, entries(*)")
        .order("created_at", { ascending: true });
    if (error) { console.error("load error:", error); return; }
    state.projects = (goals || []).map(g => ({
        id: g.id,
        title: g.title,
        startValue: g.start_value,
        targetValue: g.target_value,
        unit: g.unit,
        decreases: g.decreases,
        startDate: g.start_date,
        endDate: g.end_date,
        secondaryLabel: g.secondary_label,
        secondaryTarget: g.secondary_target,
        entries: (g.entries || [])
            .sort((a, b) => new Date(a.logged_at) - new Date(b.logged_at))
            .map(e => ({ id: e.id, date: (e.logged_at || "").slice(0, 10), add: e.add_value, second: e.second_value })),
    }));
}

function saveState() { }

// ---------- progress helpers ----------
function currentValue(goal) {
    const start = parseFloat(goal.startValue) || 0;
    const added = (goal.entries || []).reduce((s, e) => s + (e.add || 0), 0);
    return start + added;
}
function goalPct(goal) {
    if (!goal) return 0;
    const start = parseFloat(goal.startValue) || 0;
    const target = parseFloat(goal.targetValue);
    if (isNaN(target) || target === start) return 0;
    const p = (currentValue(goal) - start) / (target - start);
    return Math.min(Math.max(p, 0), 1);
}
function secondReads(goal) {
    return (goal.entries || []).filter(e => e.second !== null && e.second !== undefined);
}
function secondArrow(goal) {
    const reads = secondReads(goal);
    if (reads.length < 2) return null;
    const target = parseFloat(goal.secondaryTarget);
    if (isNaN(target)) return null;
    const latest = reads[reads.length - 1].second;
    const prev = reads[reads.length - 2].second;
    if (Math.abs(latest - target) < Math.abs(prev - target)) return "up";
    if (Math.abs(latest - target) > Math.abs(prev - target)) return "down";
    return null;
}
function lastSecond(goal) {
    const reads = secondReads(goal);
    return reads.length ? reads[reads.length - 1].second : null;
}
function avgSecond(goal) {
    const reads = secondReads(goal);
    if (!reads.length) return null;
    const avg = reads.reduce((s, e) => s + e.second, 0) / reads.length;
    return Math.round(avg * 10) / 10;
}

function completionDate(goal) {
    const start = parseFloat(goal.startValue) || 0;
    const target = parseFloat(goal.targetValue);
    if (isNaN(target)) return null;

    let running = start;
    for (const entry of goal.entries) {
        running += entry.add;
        const reachedTarget = goal.decreases ? running <= target : running >= target;
        if (reachedTarget) {
            return entry.date;
        }
    }
    return null;
}

function earnedStar(goal) {
    if (!goal.endDate) return false;
    const compDate = completionDate(goal);
    if (!compDate) return false;
    const completed = new Date(compDate);
    const deadline = new Date(goal.endDate);
    return completed <= deadline;
}

function renderSummary(goal) {
    const table = document.getElementById("summaryTable");
    table.innerHTML = "";

    const compDate = completionDate(goal);
    const onTime = earnedStar(goal) ? "Yes" : "No";

    const rows = [
        ["Project name", goal.title],
        ["Starting point", goal.startValue],
        ["Target", goal.targetValue],
        ["Unit", goal.unit || "—"],
        ["Started", goal.startDate || "—"],
        ["Target finish date", goal.endDate || "—"],
        ["Completed on", compDate || "—"],
        ["Finished on time", onTime],
        ["Total logs made", goal.entries.length],
    ];

    rows.forEach(([label, value]) => {
        const row = document.createElement("div");
        row.className = "hex-summary-row";

        const labelEl = document.createElement("div");
        labelEl.className = "hex-summary-label";
        labelEl.textContent = label;

        const valueEl = document.createElement("div");
        valueEl.className = "hex-summary-value";
        valueEl.textContent = value;

        row.appendChild(labelEl);
        row.appendChild(valueEl);
        table.appendChild(row);
    });
}

// ---------- shape rendering ----------
const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")";

const HEX_VERTICES = [
    { x: 50, y: 0 },
    { x: 100, y: 25 },
    { x: 100, y: 75 },
    { x: 50, y: 100 },
    { x: 0, y: 75 },
    { x: 0, y: 25 },
];

const MORPH_POINTS = 150; // more = smoother

function getHexPerimeterPoints(count) {
    const points = [];
    const edges = HEX_VERTICES.length;
    for (let i = 0; i < count; i++) {
        const along = (i / count) * edges;
        const edgeIndex = Math.floor(along) % edges;
        const t = along - Math.floor(along);
        const a = HEX_VERTICES[edgeIndex];
        const b = HEX_VERTICES[(edgeIndex + 1) % edges];
        points.push({
            x: a.x + (b.x - a.x) * t,   // this is a lerp, same concept as before
            y: a.y + (b.y - a.y) * t,
        });
    }
    return points;
}

function morphedClipPath(t) {
    const cx = 50, cy = 50, R = 50;
    const hexPoints = getHexPerimeterPoints(MORPH_POINTS);
    const coords = hexPoints.map(p => {
        const angle = Math.atan2(p.y - cy, p.x - cx);
        const circleX = cx + R * Math.cos(angle);
        const circleY = cy + R * Math.sin(angle);
        const x = p.x + (circleX - p.x) * t;
        const y = p.y + (circleY - p.y) * t;
        return `${x.toFixed(2)}% ${y.toFixed(2)}%`;
    });
    return `polygon(${coords.join(", ")})`;
}



function renderShape(pct) {
    const shape = document.getElementById("shape");
    const isEmpty = pct <= 0.0001;
    const round = pct;
    const hexClip = "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)";
    const isCircle = round >= 0.999;
    const hRatio = 1.15 - pct * 0.15;
    shape.style.height = "auto";
    shape.style.aspectRatio = `1 / ${hRatio}`;

    const morphStart = 0.5; // start morphing at 50% progress
    let t = 0;
    if (pct >= morphStart) {
        t = (pct - morphStart) / (1 - morphStart); // maps 0.5→1.0 progress to 0→1 morph
        t = Math.min(Math.max(t, 0), 1);
    }
    shape.style.clipPath = t > 0 ? morphedClipPath(t) : hexClip;
    shape.style.borderRadius = "0%"; // clip-path now handles all the shape's roundness

    // clear any existing grain overlay
    const existing = shape.querySelector(".grain");
    if (existing) existing.remove();

    if (isEmpty) {
        shape.style.background = "#EFEEE3";
        shape.style.boxShadow = "none";
        return;
    }

    const whiteStart = 18 + pct * 92;
    const darkEdge = Math.max(whiteStart - 14, 8);
    const midGreen = Math.max(darkEdge - 16, 4);
    const core = Math.max(midGreen * 0.4, 2);

    shape.style.background = `radial-gradient(circle at 50% 50%,
    #ECF71C 0%,
    #9FD22A ${core}%,
    #4F9E32 ${midGreen}%,
    #0E722E ${darkEdge}%,
    #0E722E ${whiteStart - 2}%,
    #FFFFFF ${whiteStart}%,
    #FFFFFF 100%)`;
    shape.style.boxShadow = pct > 0.02 ? "0 0 42px 8px rgba(180,220,120,0.25)" : "none";

    const grain = document.createElement("div");
    grain.className = "grain";
    grain.style.clipPath = t > 0 ? morphedClipPath(t) : hexClip;
    grain.style.borderRadius = "0%";
    grain.style.backgroundImage = GRAIN;
    shape.appendChild(grain);
}

function renderProgressMeter(pct) {
    const meter = document.getElementById("progressMeter");
    meter.innerHTML = "";

    const filledCount = Math.floor(pct * 10);

    for (let i = 0; i < 10; i++) {
        const seg = document.createElement("div");
        seg.className = "hex-meter-seg";
        if (i < filledCount) {
            seg.classList.add("filled");
        }
        meter.appendChild(seg);
    }
}


// function renderProgressMeter(pct) {
//     const meter = document.getElementById("progressMeter");
//     meter.innerHTML = "";

//     const wholeNumber = Math.floor(pct * 10);
//     const leftover = (pct * 10) - wholeNumber;
//     let filledCount = wholeNumber;
//     if (leftover >= 0.9) {
//         filledCount = wholeNumber + 1;
//     }

//     for (let i = 0; i < 10; i++) {
//         const seg = document.createElement("div");
//         seg.className = "hex-meter-seg";
//         if (i < filledCount) {
//             seg.classList.add("filled");
//         }
//         meter.appendChild(seg);
//     }
// }


const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

function renderCalendar(containerId, inputId, year, month) {
    const container = document.getElementById(containerId);
    container.innerHTML = "";

    const existingValue = document.getElementById(inputId).value;
    const selectedDate = existingValue ? new Date(existingValue) : null;

    // header row: prev arrow, month/year label, next arrow
    const header = document.createElement("div");
    header.className = "hex-cal-header";

    const prevBtn = document.createElement("button");
    prevBtn.className = "hex-cal-nav";
    prevBtn.textContent = "<";
    prevBtn.onclick = (e) => {
        e.stopPropagation();
        let newMonth = month - 1;
        let newYear = year;
        if (newMonth < 0) {
            newMonth = 11;
            newYear = year - 1;
        }
        renderCalendar(containerId, inputId, newYear, newMonth);
    };

    const label = document.createElement("span");
    label.className = "hex-cal-label";
    label.textContent = `${MONTH_NAMES[month]} ${year}`;

    const nextBtn = document.createElement("button");
    nextBtn.className = "hex-cal-nav";
    nextBtn.textContent = ">";
    nextBtn.onclick = (e) => {
        e.stopPropagation();
        let newMonth = month + 1;
        let newYear = year;
        if (newMonth > 11) {
            newMonth = 0;
            newYear = year + 1;
        }
        renderCalendar(containerId, inputId, newYear, newMonth);
    };

    // NEW — group both arrows together:
    const navGroup = document.createElement("div");
    navGroup.className = "hex-cal-nav-group";
    navGroup.appendChild(prevBtn);
    navGroup.appendChild(nextBtn);

    header.appendChild(label);
    header.appendChild(navGroup);
    container.appendChild(header);

    WEEKDAY_LABELS.forEach(label => {
        const headerCell = document.createElement("div");
        headerCell.className = "hex-cal-weekday";
        headerCell.textContent = label;
        container.appendChild(headerCell);
    });

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstWeekday = new Date(year, month, 1).getDay();

    for (let i = 0; i < firstWeekday; i++) {
        const filler = document.createElement("div");
        filler.className = "hex-cal-day hex-cal-empty";
        container.appendChild(filler);
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dayBtn = document.createElement("button");
        dayBtn.className = "hex-cal-day";
        dayBtn.textContent = day;

        const thisDate = new Date(year, month, day);
        if (selectedDate &&
            thisDate.getFullYear() === selectedDate.getFullYear() &&
            thisDate.getMonth() === selectedDate.getMonth() &&
            thisDate.getDate() === selectedDate.getDate()) {
            dayBtn.classList.add("hex-cal-selected");
        }

        dayBtn.onclick = () => {
            const picked = new Date(year, month, day);
            document.getElementById(inputId).value = picked.toLocaleDateString();
            container.hidden = true;
        };
        container.appendChild(dayBtn);
    }
}


// ---------- main render ----------
function render() {
    const selected = state.projects.find(p => p.id === state.selectedId) || null;

    // nav active states + dim
    document.querySelectorAll("#nav button").forEach(btn => {
        const nav = btn.getAttribute("data-nav");
        btn.classList.toggle("active", !!nav && state.active === nav);
    });
    document.getElementById("nav").classList.toggle("dimmed", state.modal === "new");

    // shape (dimmed when a modal is open)
    const stage = document.getElementById("stage");
    stage.classList.toggle("dimmed", !!state.modal);
    renderShape(selected ? goalPct(selected) : 0);
    renderProgressMeter(selected ? goalPct(selected) : 0);
    document.querySelector(".hex-tagline").style.display = selected ? "none" : "flex";
    const isComplete = selected && goalPct(selected) >= 1 && state.dismissedCompleteId !== selected.id;
    document.getElementById("completeMsg").hidden = !isComplete;

    // the bare shape is only clickable-to-create when no goal is selected
    const shapeBtn = document.getElementById("shapeBtn");
    shapeBtn.style.pointerEvents = selected ? "none" : "auto";

    // projects panel
    const panel = document.getElementById("projectsPanel");
    panel.hidden = !(state.showProjects && !state.modal);
    const aboutPanel = document.getElementById("aboutPanel");
    aboutPanel.hidden = !(state.showAbout && !state.modal);
    const list = document.getElementById("projectsList");
    list.innerHTML = "";
    if (state.projects.length === 0) {
        const empty = document.createElement("div");
        empty.className = "hex-proj-empty";
        empty.textContent = "No projects yet";
        list.appendChild(empty);
    } else {
        state.projects.forEach(p => {
            const row = document.createElement("div");
            row.className = "hex-proj-row";

            const b = document.createElement("button");
            b.className = "hex-proj-item";
            const isDone = goalPct(p) >= 1;

            const titleSpan = document.createElement("span");
            titleSpan.textContent = p.title;
            if (isDone) {
                titleSpan.classList.add("hex-proj-done");
            }
            b.appendChild(titleSpan);

            if (isDone) {
                b.append(" ⭐");
            }

            b.onclick = () => pickProject(p.id);

            const del = document.createElement("button");
            del.className = "hex-proj-delete";
            del.textContent = "🗑";
            del.onclick = (e) => {
                e.stopPropagation();
                deleteProject(p.id);
            };

            row.appendChild(b);
            row.appendChild(del);
            list.appendChild(row);
        });
    }

    // new modal
    document.getElementById("newModal").hidden = state.modal !== "new";

    // update modal
    const upd = document.getElementById("updateModal");
    upd.hidden = !(state.modal === "update" && selected);
    if (state.modal === "update" && selected) {
        const cur = currentValue(selected);
        document.getElementById("u_current").textContent =
            `Currently at ${cur}${selected.unit ? " " + selected.unit : ""}`;
        document.getElementById("u_target").textContent =
            `target is ${selected.targetValue}${selected.unit ? " " + selected.unit : ""}`;

        const hasSecond = !!selected.secondaryLabel;
        document.getElementById("u_secondWrap").style.display = hasSecond ? "" : "none";
        document.getElementById("u_sectargetWrap").style.display = hasSecond ? "" : "none";

        if (hasSecond) {
            const last = lastSecond(selected);
            const arrow = secondArrow(selected);
            const avg = avgSecond(selected);
            const lastEl = document.getElementById("u_lastlog");
            lastEl.innerHTML = "";
            lastEl.append(`Last log ${last !== null ? last : "—"} `);
            if (arrow) {
                const a = document.createElement("span");
                a.className = "hex-arrow " + arrow;
                a.textContent = arrow === "up" ? "↑" : "↓";
                lastEl.appendChild(a);
            }
            if (avg !== null) {
                const av = document.createElement("span");
                av.className = "hex-avg";
                av.textContent = "avg " + avg;
                lastEl.appendChild(av);
            }
            document.getElementById("u_sectarget").textContent =
                `Second target is ${selected.secondaryTarget}`;
        }
    }

    // summary modal        ← ADD HERE
    const summary = document.getElementById("summaryModal");
    summary.hidden = !(state.modal === "summary" && selected);
    if (state.modal === "summary" && selected) {
        renderSummary(selected);
    }
}

// ---------- actions ----------
function openNav(item) {
    if (!item) return;
    if ((item === "new" || item === "projects") && !currentUser) { showLogin(); return; }
    if (item === "projects") {
        state.showProjects = !state.showProjects;
        state.active = state.active === "projects" ? null : "projects";
        state.modal = null;
    } else if (item === "about") {
        state.showAbout = !state.showAbout;
        state.active = state.active === "about" ? null : "about";
        state.modal = null;
        state.showProjects = false;   // close projects if it was open    
    } else if (item === "new") {
        const on = state.modal === "new";
        state.modal = on ? null : "new";
        state.active = on ? null : "new";
        state.showProjects = false;
    } else {
        state.active = item;
        state.showProjects = false;
        state.modal = null;
    }
    render();
}

function openCreateFromShape() {
    state.modal = "new";
    state.active = "new";
    state.showProjects = false;
    render();
}

async function createGoal() {
    const title = document.getElementById("f_title").value.trim();
    if (!title) return;

    const { data, error } = await db.from("goals").insert({
        title,
        start_value: parseFloat(document.getElementById("f_start").value) || null,
        target_value: parseFloat(document.getElementById("f_target").value) || null,
        unit: document.getElementById("f_unit").value || null,
        decreases: document.getElementById("f_direction").checked,
        start_date: document.getElementById("f_startdate").value || null,
        end_date: document.getElementById("f_enddate").value || null,
    }).select().single();

    if (error) { console.error("create error:", error); return; }

    ["f_title", "f_start", "f_target", "f_unit", "f_startdate", "f_enddate"].forEach(id => {
        document.getElementById(id).value = "";
    });
    document.getElementById("f_direction").checked = false;

    await loadState();
    state.selectedId = data.id;
    state.modal = null;
    state.active = "projects";
    state.showProjects = true;
    render();
}

function pickProject(id) {
    state.selectedId = id;
    const goal = state.projects.find(p => p.id === id);
    const isDone = goal && goalPct(goal) >= 1;

    state.modal = isDone ? "summary" : "update";
    state.active = null;

    if (!isDone) {
        document.getElementById("u_add").value = "";
        document.getElementById("u_second").value = "";
    }
    render();
}

async function deleteProject(id) {
    const { error } = await db.from("goals").delete().eq("id", id);
    if (error) { console.error("delete error:", error); return; }
    if (state.selectedId === id) state.selectedId = null;
    await loadState();
    render();
}

async function logProgress() {
    const addRaw = document.getElementById("u_add").value;
    const secRaw = document.getElementById("u_second").value;
    if (addRaw === "" && secRaw === "") return;
    const goal = state.projects.find(p => p.id === state.selectedId);
    if (!goal) return;

    const addValue = addRaw !== "" ? parseFloat(addRaw) : 0;
    const finalAdd = goal.decreases ? addValue * -1 : addValue;

    const { error } = await db.from("entries").insert({
        goal_id: goal.id,
        add_value: finalAdd,
        second_value: secRaw !== "" ? parseFloat(secRaw) : null,
    });

    if (error) { console.error("log error:", error); return; }

    await loadState();
    state.modal = null;
    state.showProjects = false;
    render();
}

function dismissModal() {
    state.modal = null;
    state.active = null;
    render();
}

function dismissSummary() {
    state.modal = null;
    state.active = null;
    state.showProjects = false;
    render();
}

// ---------- wire up events ----------
function init() {
    checkSession();

    document.querySelectorAll("#nav button").forEach(btn => {
        btn.addEventListener("click", () => openNav(btn.getAttribute("data-nav")));
    });

    document.getElementById("shapeBtn").addEventListener("click", (e) => {
        e.stopPropagation();
        if (!currentUser) { showLogin(); return; }
        const selected = state.projects.find(p => p.id === state.selectedId);
        if (!selected) openCreateFromShape();
    });

    document.getElementById("addProjectBtn").addEventListener("click", (e) => {
        e.stopPropagation();
        if (!currentUser) { showLogin(); return; }
        openCreateFromShape();
    });

    document.getElementById("f_startdate").addEventListener("click", () => {
        const cal = document.getElementById("startCalendar");
        const input = document.getElementById("f_startdate");
        const existingValue = input.value;
        const baseDate = existingValue ? new Date(existingValue) : new Date();
        renderCalendar("startCalendar", "f_startdate", baseDate.getFullYear(), baseDate.getMonth());
        cal.hidden = false;
    });

    document.getElementById("f_enddate").addEventListener("click", () => {
        const cal = document.getElementById("endCalendar");
        const input = document.getElementById("f_enddate");
        const existingValue = input.value;
        const baseDate = existingValue ? new Date(existingValue) : new Date();
        renderCalendar("endCalendar", "f_enddate", baseDate.getFullYear(), baseDate.getMonth());
        cal.hidden = false;
    });

    document.getElementById("aboutPanel").addEventListener("click", () => {
        state.showAbout = false;
        state.active = null;
        render();
    });
    document.querySelector("#aboutPanel .hex-about-panel").addEventListener("click", (e) => e.stopPropagation());

    document.addEventListener("click", (e) => {
        const startCal = document.getElementById("startCalendar");
        const startInput = document.getElementById("f_startdate");
        if (!startCal.hidden && !startCal.contains(e.target) && e.target !== startInput) {
            startCal.hidden = true;
        }

        const endCal = document.getElementById("endCalendar");
        const endInput = document.getElementById("f_enddate");
        if (!endCal.hidden && !endCal.contains(e.target) && e.target !== endInput) {
            endCal.hidden = true;
        }
    }, true);

    // click off (on the dimmed stage) to dismiss whichever form is open
    document.getElementById("stage").addEventListener("click", () => {
        if (state.modal) { dismissModal(); return; }
        if (state.showProjects) {
            state.showProjects = false;
            state.active = null;
            render();
            return;
        }
        const selected = state.projects.find(p => p.id === state.selectedId);
        if (selected && goalPct(selected) >= 1) {
            state.dismissedCompleteId = state.selectedId;
            render();
        }
    });

    // clicking a form's backdrop dismisses; clicking the panel itself does not
    document.getElementById("newModal").addEventListener("click", dismissModal);
    document.querySelector("#newModal .hex-panel").addEventListener("click", (e) => e.stopPropagation());

    document.getElementById("updateModal").addEventListener("click", dismissModal);
    document.querySelector("#updateModal .hex-panel").addEventListener("click", (e) => e.stopPropagation());

    document.getElementById("createBtn").addEventListener("click", createGoal);
    document.getElementById("logBtn").addEventListener("click", logProgress);
    document.getElementById("closeNewBtn").addEventListener("click", dismissModal);

    document.getElementById("summaryModal").addEventListener("click", dismissSummary);
    document.querySelector("#summaryModal .hex-panel").addEventListener("click", (e) => e.stopPropagation());

    document.getElementById("loginBtn").addEventListener("click", doLogin);
    document.getElementById("signupBtn").addEventListener("click", doSignup);

    document.getElementById("auth_password").addEventListener("keydown", (e) => {
        if (e.key === "Enter") doLogin();
    });
    document.getElementById("auth_email").addEventListener("keydown", (e) => {
        if (e.key === "Enter") doLogin();
    });

    document.querySelector("#authScreen .hex-auth-box").addEventListener("click", (e) => e.stopPropagation());
    document.getElementById("authScreen").addEventListener("click", () => hideLogin());

    document.getElementById("accountEmail").addEventListener("click", (e) => {
        e.stopPropagation();
        const btn = document.getElementById("signoutBtn");
        btn.hidden = !btn.hidden;
    });
    document.getElementById("signoutBtn").addEventListener("click", doSignout);

    render();
}

// ---------- auth ----------
function showLogin() {
    document.getElementById("authScreen").hidden = false;
    document.getElementById("stage").classList.add("dimmed");
}
function hideLogin() {
    document.getElementById("authScreen").hidden = true;
    document.getElementById("stage").classList.remove("dimmed");
    document.getElementById("authMsg").textContent = "";
}

async function doSignup() {
    const email = document.getElementById("auth_email").value.trim();
    const password = document.getElementById("auth_password").value;
    const { error } = await db.auth.signUp({ email, password });
    if (error) { document.getElementById("authMsg").textContent = error.message; return; }
    await afterAuth();
}

async function doLogin() {
    const email = document.getElementById("auth_email").value.trim();
    const password = document.getElementById("auth_password").value;
    const { error } = await db.auth.signInWithPassword({ email, password });
    if (error) { document.getElementById("authMsg").textContent = error.message; return; }
    await afterAuth();
}

async function afterAuth() {
    const { data } = await db.auth.getUser();
    currentUser = data.user;
    updateAccountUI();
    hideLogin();
    await loadState();
    render();
}

async function checkSession() {
    const { data } = await db.auth.getSession();
    if (data.session) {
        currentUser = data.session.user;
        updateAccountUI();
        await loadState();
        render();
    }
}

async function doSignout() {
    await db.auth.signOut();
    currentUser = null;
    state.projects = [];
    state.selectedId = null;
    updateAccountUI();
    render();
}

function updateAccountUI() {
    const acct = document.getElementById("account");
    const signout = document.getElementById("signoutBtn");
    if (currentUser) {
        document.getElementById("accountEmail").textContent = currentUser.email;
        acct.hidden = false;
        signout.hidden = true;
    } else {
        acct.hidden = true;
        signout.hidden = true;
    }
}

document.addEventListener("DOMContentLoaded", init);