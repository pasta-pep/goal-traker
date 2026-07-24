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
    modal: null,        // "new" | "update" | null
};

// ---------- persistence ----------
function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            state.projects = parsed.projects || [];
        }
    } catch (e) { /* ignore */ }
}
function saveState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ projects: state.projects }));
    } catch (e) { /* ignore */ }
}

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

// ---------- shape rendering ----------
const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")";

function renderShape(pct) {
    const shape = document.getElementById("shape");
    const isEmpty = pct <= 0.0001;
    const round = pct;
    const hexClip = "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)";
    const isCircle = round >= 0.999;
    const hRatio = 1.15 - pct * 0.15;
    shape.style.height = "auto";
    shape.style.aspectRatio = `1 / ${hRatio}`;

    shape.style.clipPath = isCircle ? "none" : hexClip;
    shape.style.borderRadius = isCircle ? "50%" : (round * 50) + "%";

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
    grain.style.clipPath = isCircle ? "none" : hexClip;
    grain.style.borderRadius = isCircle ? "50%" : (round * 50) + "%";
    grain.style.backgroundImage = GRAIN;
    shape.appendChild(grain);
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

    // the bare shape is only clickable-to-create when no goal is selected
    const shapeBtn = document.getElementById("shapeBtn");
    shapeBtn.style.pointerEvents = selected ? "none" : "auto";

    // projects panel
    const panel = document.getElementById("projectsPanel");
    panel.hidden = !(state.showProjects && !state.modal);
    const list = document.getElementById("projectsList");
    list.innerHTML = "";
    if (state.projects.length === 0) {
        const empty = document.createElement("div");
        empty.className = "hex-proj-empty";
        empty.textContent = "No projects yet";
        list.appendChild(empty);
    } else {
        state.projects.forEach(p => {
            const b = document.createElement("button");
            b.className = "hex-proj-item";
            b.textContent = p.title;
            b.onclick = () => pickProject(p.id);
            list.appendChild(b);
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
}

// ---------- actions ----------
function openNav(item) {
    if (!item) return;
    if (item === "index") {
        state.showProjects = !state.showProjects;
        state.active = state.active === "index" ? null : "index";
        state.modal = null;
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

function createGoal() {
    const title = document.getElementById("f_title").value.trim();
    if (!title) return;
    const p = {
        id: Date.now(),
        title,
        startValue: document.getElementById("f_start").value,
        targetValue: document.getElementById("f_target").value,
        unit: document.getElementById("f_unit").value,
        secondaryLabel: document.getElementById("f_seclabel").value,
        secondaryTarget: document.getElementById("f_sectarget").value,
        entries: [],
    };
    state.projects.push(p);
    state.selectedId = p.id;
    saveState();

    // reset form
    ["f_title", "f_start", "f_target", "f_unit", "f_seclabel", "f_sectarget"].forEach(id => {
        document.getElementById(id).value = "";
    });

    state.modal = null;
    state.active = "index";
    state.showProjects = true;
    render();
}

function pickProject(id) {
    state.selectedId = id;
    state.modal = "update";
    state.active = null;
    document.getElementById("u_add").value = "";
    document.getElementById("u_second").value = "";
    render();
}

function logProgress() {
    const addRaw = document.getElementById("u_add").value;
    const secRaw = document.getElementById("u_second").value;
    if (addRaw === "" && secRaw === "") return;
    const goal = state.projects.find(p => p.id === state.selectedId);
    if (!goal) return;
    goal.entries.push({
        id: Date.now(),
        date: new Date().toISOString().slice(0, 10),
        add: addRaw !== "" ? parseFloat(addRaw) : 0,
        second: secRaw !== "" ? parseFloat(secRaw) : null,
    });
    saveState();
    state.modal = null;
    render();
}

function dismissModal() {
    state.modal = null;
    state.active = null;
    render();
}

// ---------- wire up events ----------
function init() {
    loadState();

    document.querySelectorAll("#nav button").forEach(btn => {
        btn.addEventListener("click", () => openNav(btn.getAttribute("data-nav")));
    });

    document.getElementById("shapeBtn").addEventListener("click", (e) => {
        e.stopPropagation();
        const selected = state.projects.find(p => p.id === state.selectedId);
        if (!selected) openCreateFromShape();
    });

    // click off (on the dimmed stage) to dismiss whichever form is open
    document.getElementById("stage").addEventListener("click", () => {
        if (state.modal) { dismissModal(); return; }
        if (state.showProjects) {
            state.showProjects = false;
            state.active = null;
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

    render();
}

document.addEventListener("DOMContentLoaded", init);